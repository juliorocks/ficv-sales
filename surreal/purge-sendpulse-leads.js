#!/usr/bin/env node
/**
 * purge-sendpulse-leads.js
 * ---------------------------------------------------------------------------
 * A Edge Function `sync-sendpulse-api` importava TODOS os contatos de TODAS as
 * addressbooks do SendPulse como `leads` (stage "Entrada"). Isso inflou a tabela
 * `leads` para ~820k linhas — o Kanban fazia `SELECT * ... ORDER BY data_entrada`
 * sem índice e travava por minutos (full scan + sort de 820k linhas, estourando
 * a memória da instância SurrealDB Cloud).
 *
 * Este script remove esse lixo, preservando qualquer lead com sinal de
 * engajamento real:
 *   - assigned_to_id != NONE        (atribuído a um agente)
 *   - widechat_contact_id != NONE   (conversa de WhatsApp vinculada)
 *   - stage_id fora de "Entrada"    (movido no funil)
 *
 * Antes de deletar, salva um backup JSON dos "keepers".
 * Deleta em lotes pequenos com pausa entre eles para não estourar a memória.
 * É resumível: se cair no meio, rode de novo que ele continua.
 *
 * Uso:
 *   node surreal/purge-sendpulse-leads.js            # dry-run: conta + backup, NÃO deleta
 *   node surreal/purge-sendpulse-leads.js --execute  # deleta de fato
 */

import { writeFileSync } from 'node:fs';

const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT
  || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS   = process.env.SURREAL_NS   || 'ficv';
const SURREAL_DB   = process.env.SURREAL_DB   || 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER || 'ficv_admin';
const SURREAL_PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';

const EXECUTE     = process.argv.includes('--execute');
const BATCH_SIZE  = Number(process.env.BATCH_SIZE  || 4000);   // ids selecionados por rodada
const DELETE_CHUNK = Number(process.env.DELETE_CHUNK || 1000); // ids por statement DELETE
const PAUSE_MS    = Number(process.env.PAUSE_MS    || 1200);   // pausa entre lotes
const MAX_RETRIES = 6;

const KEEPER_STAGES = ['2', '3', '5', '6', '7']; // tudo que não é "Entrada" (1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let TOKEN = '';

async function signin() {
  const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
    body: JSON.stringify({ ns: SURREAL_NS, user: SURREAL_USER, pass: SURREAL_PASS }),
  });
  if (!res.ok) throw new Error(`signin HTTP ${res.status}`);
  TOKEN = (await res.json()).token;
  if (!TOKEN) throw new Error('signin: sem token');
}

async function sql(query, { retries = MAX_RETRIES } = {}) {
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
      });
      text = await res.text();
    } catch (e) {
      if (attempt > retries) throw e;
      log(`  network error (tentativa ${attempt}): ${e.message} — retry`);
      await sleep(2000 * attempt);
      continue;
    }

    if (res.status === 401) { await signin(); continue; }

    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    const entry = Array.isArray(json) ? json[json.length - 1] : json;

    if (res.ok && entry && entry.status === 'OK') return entry.result;

    const msg = entry?.result || text || `HTTP ${res.status}`;
    const isMem = String(msg).includes('memory threshold');
    if (attempt > retries) throw new Error(`sql falhou: ${msg}`);
    log(`  ${isMem ? 'memory threshold' : 'erro'} (tentativa ${attempt}) — aguardando…`);
    await sleep((isMem ? 5000 : 2000) * attempt);
  }
}

// record-id string -> literal usável em query. SurrealDB devolve "leads:123" ou
// "leads:`abc`"; ambos os formatos são válidos como literais.
const asRecordLiteral = (id) => String(id);

async function collectKeeperIds() {
  const set = new Set();
  const add = (rows) => (rows || []).forEach((id) => set.add(String(id)));

  add(await sql('SELECT VALUE id FROM leads WHERE assigned_to_id != NONE;'));
  log(`  keepers após assigned_to_id: ${set.size}`);
  add(await sql('SELECT VALUE id FROM leads WHERE widechat_contact_id != NONE;'));
  log(`  keepers após widechat_contact_id: ${set.size}`);
  for (const s of KEEPER_STAGES) {
    add(await sql(`SELECT VALUE id FROM leads WHERE stage_id = type::thing('stages', '${s}');`));
  }
  log(`  keepers após stages ${KEEPER_STAGES.join(',')}: ${set.size}`);
  return set;
}

async function backupKeepers(keeperIds) {
  if (keeperIds.size === 0) { log('Nenhum keeper para backup.'); return; }
  const list = [...keeperIds].map(asRecordLiteral).join(', ');
  const rows = await sql(`SELECT * FROM leads WHERE id INSIDE [${list}];`);
  const file = `surreal/backup-keeper-leads-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(rows, null, 2));
  log(`Backup de ${rows.length} keeper(s) salvo em ${file}`);
}

async function count() {
  const r = await sql('SELECT count() FROM leads GROUP ALL;');
  return r?.[0]?.count ?? 0;
}

async function main() {
  await signin();
  log(`Conectado. Modo: ${EXECUTE ? 'EXECUTE (deleta)' : 'DRY-RUN (não deleta)'}`);

  const total0 = await count();
  log(`Total de leads agora: ${total0.toLocaleString('pt-BR')}`);

  log('Coletando ids de keepers…');
  const keeperIds = await collectKeeperIds();
  await backupKeepers(keeperIds);

  const toDelete = total0 - keeperIds.size;
  log(`A remover: ~${toDelete.toLocaleString('pt-BR')}   | a preservar: ${keeperIds.size}`);

  if (!EXECUTE) {
    log('DRY-RUN concluído. Rode com --execute para deletar.');
    return;
  }
  if (toDelete <= 0) { log('Nada a remover.'); return; }

  let removed = 0;
  let emptyStreak = 0;
  const t0 = Date.now();

  while (true) {
    const ids = (await sql(`SELECT VALUE id FROM leads LIMIT ${BATCH_SIZE};`))
      .map(String)
      .filter((id) => !keeperIds.has(id));

    if (ids.length === 0) {
      if (++emptyStreak >= 3) break;
      await sleep(PAUSE_MS);
      continue;
    }
    emptyStreak = 0;

    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK).map(asRecordLiteral).join(', ');
      await sql(`DELETE ${chunk};`);
    }

    removed += ids.length;
    const rate = removed / ((Date.now() - t0) / 1000);
    const eta = rate > 0 ? Math.round((toDelete - removed) / rate) : 0;
    log(`removidos ${removed.toLocaleString('pt-BR')}/${toDelete.toLocaleString('pt-BR')}  (~${rate.toFixed(0)}/s, ETA ${Math.floor(eta / 60)}m${eta % 60}s)`);

    await sleep(PAUSE_MS);
  }

  const total1 = await count();
  log(`Concluído. Total de leads: ${total1.toLocaleString('pt-BR')} (keepers esperados: ${keeperIds.size})`);
  log('Sugestão: DEFINE INDEX idx_leads_data_entrada ON leads FIELDS data_entrada; (tabela pequena agora)');
}

main().catch((e) => { console.error(e); process.exit(1); });
