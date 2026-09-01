#!/usr/bin/env node
/**
 * purge-sendpulse-leads.js
 * ---------------------------------------------------------------------------
 * A Edge Function `sync-sendpulse-api` importava TODOS os contatos de TODAS as
 * addressbooks do SendPulse como `leads` (stage "Entrada"). A tabela `leads`
 * chegou a ~820k linhas e o Kanban (`SELECT * ... ORDER BY data_entrada`, sem
 * índice) travava por minutos — full scan + sort estourava a memória da
 * instância SurrealDB Cloud.
 *
 * ESTRATÉGIA: como a instância está sem memória para varrer a tabela, NÃO dá
 * para deletar em lotes (`SELECT ... LIMIT n` nem responde). Em vez disso:
 *   1. lê os ~98 leads reais por acesso direto de chave (assigned_to_id,
 *      widechat_contact_id, stage != Entrada) — não varre nada;
 *   2. salva backup JSON;
 *   3. REMOVE TABLE leads  (operação de metadados, memória mínima);
 *   4. recria a tabela + campos + índices (inclui idx_leads_data_entrada novo);
 *   5. reinsere os ~98 leads reais com os MESMOS ids (links do WideChat etc
 *      continuam válidos).
 * Tudo dentro de um BEGIN/COMMIT — se qualquer passo falhar, faz rollback e a
 * tabela fica intacta.
 *
 * Uso:
 *   node surreal/purge-sendpulse-leads.js            # dry-run: conta + backup
 *   node surreal/purge-sendpulse-leads.js --execute  # executa de fato
 */

import { writeFileSync } from 'node:fs';

const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT
  || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS   = process.env.SURREAL_NS   || 'ficv';
const SURREAL_DB   = process.env.SURREAL_DB   || 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER || 'ficv_admin';
const SURREAL_PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';

const EXECUTE     = process.argv.includes('--execute');
const KEEPER_STAGES = ['2', '3', '5', '6', '7']; // tudo que não é "Entrada" (1)
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let TOKEN = '';

async function signin() {
  const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
    body: JSON.stringify({ ns: SURREAL_NS, user: SURREAL_USER, pass: SURREAL_PASS }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`signin HTTP ${res.status}`);
  TOKEN = (await res.json()).token;
  if (!TOKEN) throw new Error('signin: sem token');
}

async function sql(query, { retries = MAX_RETRIES, timeoutMs = 90000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res, text;
    try {
      res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Accept: 'application/json',
          Authorization: `Bearer ${TOKEN}`,
          'surreal-ns': SURREAL_NS,
          'surreal-db': SURREAL_DB,
        },
        body: query,
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (e) {
      if (attempt > retries) throw e;
      log(`  erro de rede (tentativa ${attempt}): ${e.message} — retry em ${3 * attempt}s`);
      await sleep(3000 * attempt);
      continue;
    }

    if (res.status === 401) { await signin(); continue; }

    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    const entries = Array.isArray(json) ? json : [json];
    const bad = entries.find((e) => e && e.status === 'ERR');

    if (res.ok && !bad) return entries.map((e) => e && e.result);

    const msg = bad?.result || text || `HTTP ${res.status}`;
    const isMem = String(msg).includes('memory threshold');
    if (attempt > retries) throw new Error(String(msg));
    log(`  ${isMem ? 'memory threshold' : 'erro'} (tentativa ${attempt}) — aguardando ${(isMem ? 8 : 3) * attempt}s`);
    await sleep((isMem ? 8000 : 3000) * attempt);
  }
}

// ── serialização de valores para reinsert ────────────────────────────────────
const REF_FIELDS = {
  stage_id: 'stages', source_id: 'lead_sources', assigned_to_id: 'profiles',
  motivo_perda_id: 'motivos_perda', curso_interesse: 'courses',
};
const DATE_FIELDS = new Set(['data_entrada', 'stage_entry_date', 'created_at', 'updated_at']);
const NUM_FIELDS = new Set(['valor_oportunidade', 'contact_count']);

function valLit(v) {
  if (v === null || v === undefined) return 'NONE';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(valLit).join(', ')}]`;
  if (typeof v === 'object') {
    return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${valLit(x)}`).join(', ')} }`;
  }
  return JSON.stringify(v);
}

function fieldLit(key, val) {
  if (val === null || val === undefined) return 'NONE';
  if (REF_FIELDS[key]) return String(val);           // já vem como "stages:`1`"
  if (DATE_FIELDS.has(key)) return `d${JSON.stringify(String(val))}`;
  if (NUM_FIELDS.has(key)) {
    const n = Number(val);
    return Number.isFinite(n) ? String(n) : '0';
  }
  return valLit(val);
}

function rowLit(row) {
  const parts = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id') { parts.push(`id: ${v}`); continue; } // record id, sem aspas
    parts.push(`${k}: ${fieldLit(k, v)}`);
  }
  return `{ ${parts.join(', ')} }`;
}

// ── schema (espelho de surreal/schema.surql, linhas 188-221) + índice novo ────
const SCHEMA = `
DEFINE TABLE leads SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update WHERE $auth.id != NONE,
    FOR delete WHERE $auth.role = 'admin';
DEFINE FIELD nome_completo          ON leads TYPE string;
DEFINE FIELD email                  ON leads TYPE option<string>;
DEFINE FIELD telefone               ON leads TYPE string;
DEFINE FIELD curso_interesse        ON leads TYPE option<record<courses>>;
DEFINE FIELD valor_oportunidade     ON leads TYPE decimal DEFAULT 0;
DEFINE FIELD stage_id               ON leads TYPE record<stages>;
DEFINE FIELD data_entrada           ON leads TYPE datetime DEFAULT time::now();
DEFINE FIELD stage_entry_date       ON leads TYPE option<datetime>;
DEFINE FIELD observacoes            ON leads TYPE option<string>;
DEFINE FIELD attachments            ON leads TYPE option<array<string>>;
DEFINE FIELD source_id              ON leads TYPE option<record<lead_sources>>;
DEFINE FIELD temperatura            ON leads TYPE option<string> ASSERT $value = NONE OR $value IN ['frio', 'morno', 'quente'];
DEFINE FIELD assigned_to_id         ON leads TYPE option<record<profiles>>;
DEFINE FIELD motivo_perda_id        ON leads TYPE option<record<motivos_perda>>;
DEFINE FIELD contact_count          ON leads TYPE int DEFAULT 0;
DEFINE FIELD widechat_contact_id    ON leads TYPE option<string>;
DEFINE FIELD widechat_session_id    ON leads TYPE option<string>;
DEFINE FIELD widechat_attendance_id ON leads TYPE option<string>;
DEFINE FIELD fonte_lead             ON leads TYPE option<string>;
DEFINE FIELD partner_id             ON leads TYPE option<string>;
DEFINE FIELD created_at             ON leads TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at             ON leads TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_leads_telefone      ON leads FIELDS telefone;
DEFINE INDEX idx_leads_stage         ON leads FIELDS stage_id;
DEFINE INDEX idx_leads_assigned      ON leads FIELDS assigned_to_id;
DEFINE INDEX idx_leads_widechat      ON leads FIELDS widechat_contact_id;
DEFINE INDEX idx_leads_data_entrada  ON leads FIELDS data_entrada;
`.trim();

async function main() {
  await signin();
  log(`Conectado. Modo: ${EXECUTE ? 'EXECUTE (recria a tabela)' : 'DRY-RUN'}`);

  const total0 = (await sql('SELECT count() FROM leads GROUP ALL;'))[0]?.[0]?.count ?? 0;
  log(`Total de leads agora: ${total0.toLocaleString('pt-BR')}`);

  // 1. ids de keepers (queries indexadas, leves) ----------------------------
  log('Coletando ids de keepers…');
  const ids = new Set();
  (await sql('SELECT VALUE id FROM leads WHERE assigned_to_id != NONE;'))[0]?.forEach((i) => ids.add(String(i)));
  log(`  após assigned_to_id: ${ids.size}`);
  (await sql('SELECT VALUE id FROM leads WHERE widechat_contact_id != NONE;'))[0]?.forEach((i) => ids.add(String(i)));
  log(`  após widechat_contact_id: ${ids.size}`);
  const stageList = KEEPER_STAGES.map((s) => `stages:\`${s}\``).join(', ');
  (await sql(`SELECT VALUE id FROM leads WHERE stage_id IN [${stageList}];`))[0]?.forEach((i) => ids.add(String(i)));
  log(`  após stages ${KEEPER_STAGES.join(',')}: ${ids.size}`);

  const keeperIds = [...ids];

  // 2. linhas completas por acesso direto de chave (sem varredura) ----------
  let keepers = [];
  if (keeperIds.length) {
    const rows = (await sql(`SELECT * FROM ${keeperIds.join(', ')};`, { timeoutMs: 120000 }))[0] || [];
    keepers = rows.filter(Boolean);
  }
  const file = `surreal/backup-keeper-leads-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(keepers, null, 2));
  log(`Backup de ${keepers.length} keeper(s) salvo em ${file}`);

  if (keepers.length !== keeperIds.length) {
    throw new Error(`esperava ${keeperIds.length} keepers no backup, obtive ${keepers.length} — abortando`);
  }

  log(`A remover: ~${(total0 - keepers.length).toLocaleString('pt-BR')}   | a preservar: ${keepers.length}`);

  if (!EXECUTE) {
    log('DRY-RUN concluído. Confira o backup e rode com --execute.');
    return;
  }

  // 3-5. recria a tabela e reinsere os keepers, tudo numa transação ---------
  const insert = keepers.length
    ? `INSERT INTO leads [\n${keepers.map(rowLit).join(',\n')}\n];`
    : '';
  const tx = `BEGIN;\nREMOVE TABLE leads;\n${SCHEMA};\n${insert}\nCOMMIT;`;

  log('Executando REMOVE TABLE + recriação + reinsert (transação)…');
  await sql(tx, { timeoutMs: 180000, retries: 3 });

  const total1 = (await sql('SELECT count() FROM leads GROUP ALL;'))[0]?.[0]?.count ?? 0;
  log(`Concluído. Total de leads: ${total1} (esperado: ${keepers.length})`);
  if (total1 !== keepers.length) {
    log('⚠️  contagem diferente do esperado — verifique a tabela e o backup.');
  } else {
    log('✓ Tabela leads limpa. O Kanban deve abrir instantâneo agora.');
  }
}

main().catch((e) => {
  console.error('\nFALHOU:', e.message);
  console.error('Se a mensagem acima for de rede/memória, a transação fez ROLLBACK e a');
  console.error('tabela `leads` está intacta — pode rodar de novo.');
  console.error('Se a tabela sumiu, reaplique surreal/schema.surql e restaure o backup JSON.');
  process.exit(1);
});
