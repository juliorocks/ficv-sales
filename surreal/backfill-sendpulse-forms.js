#!/usr/bin/env node
/**
 * backfill-sendpulse-forms.js
 * Backfill único: traz os inscritos recentes dos formulários do SendPulse para
 * o Kanban, usando a mesma lógica da Edge Function sync-sendpulse-forms.
 * Depois disso, o cron (sync-sendpulse-forms) cuida do tempo real.
 *
 *   node surreal/backfill-sendpulse-forms.js            # dry-run: só conta
 *   node surreal/backfill-sendpulse-forms.js --execute  # cria os leads
 *
 * Env: SENDPULSE_API_KEY (lê do .env.local automaticamente), BACKFILL_DAYS (35)
 */
import { readFileSync } from 'node:fs';

// carrega .env.local
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* ok */ }

const EXECUTE = process.argv.includes('--execute');
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || 35);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 3000);
const TZ = process.env.SENDPULSE_TZ_OFFSET || 'Z'; // add_date do SendPulse vem em UTC

const API_KEY = process.env.SENDPULSE_API_KEY || '';
if (!API_KEY) { console.error('sem SENDPULSE_API_KEY'); process.exit(1); }

const S    = process.env.SURREAL_ENDPOINT || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS = 'ficv', DB = 'salespulse';
const USER = process.env.SURREAL_USER || 'ficv_admin';
const PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let TOKEN = '';
async function signin() {
  const r = await fetch(`${S}/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
    body: JSON.stringify({ ns: NS, user: USER, pass: PASS }),
  });
  TOKEN = (await r.json()).token;
  if (!TOKEN) throw new Error('sem token surreal');
}
async function sql(q, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${S}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, 'surreal-ns': NS, 'surreal-db': DB },
        body: q, signal: AbortSignal.timeout(120000),
      });
      if (res.status === 401) { await signin(); continue; }
      const j = await res.json();
      const e = Array.isArray(j) ? j[j.length - 1] : j;
      if (e?.status === 'ERR') throw new Error(e.result);
      return Array.isArray(e?.result) ? e.result : [];
    } catch (err) {
      if (i > tries) throw err;
      log(`  retry ${i}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
}
async function sp(path) {
  const r = await fetch(`https://api.sendpulse.com${path}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!r.ok) throw new Error(`SendPulse ${path} HTTP ${r.status}`);
  return r.json();
}
const toS = (v) => v == null ? 'NONE'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
function stripId(v) {
  if (v == null) return null;
  const s = String(v), m = s.match(/^[a-z_]+:⟨(.+)⟩$/) ?? s.match(/^[a-z_]+:`(.+)`$/);
  const inner = m ? m[1] : s, n = Number(inner);
  return Number.isFinite(n) && String(n) === inner ? n : inner;
}
function spDateISO(s) {
  const d = new Date(String(s).replace(' ', 'T') + TZ);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
function subName(sub) {
  const v = sub.variables ?? {};
  const c = v.Nome ?? v.nome ?? v.name ?? v.Name ?? [v.first_name, v.last_name].filter(Boolean).join(' ');
  const s = String(c ?? '').trim();
  return s || (sub.email ? String(sub.email).split('@')[0] : 'Novo Lead (SendPulse)');
}

async function main() {
  await signin();
  log(`modo: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} | backfill ${BACKFILL_DAYS} dias`);

  const forms = await sql('SELECT book_id, form_name, course_id, source_id, last_add_date FROM sendpulse_forms WHERE ativo = true;');
  const courseRows = await sql('SELECT id, default_value FROM courses;');
  const courseVal = new Map();
  for (const c of courseRows) { const id = stripId(c.id); if (typeof id === 'number') courseVal.set(id, Number(c.default_value) || 0); }

  const cutoff = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');

  // 1. coletar candidatos de todos os forms
  const candidates = [];
  for (const f of forms) {
    const wm = f.last_add_date || cutoff;
    let got = 0;
    for (let off = 0; off < 2000; off += 100) {
      let page;
      try { page = await sp(`/addressbooks/${f.book_id}/emails?limit=100&offset=${off}`); }
      catch (e) { log(`  ${f.form_name}: ${e.message}`); break; }
      if (!Array.isArray(page) || !page.length) break;
      let stop = false;
      for (const s of page) {
        const add = String(s.add_date || '');
        if (add && add <= wm) { stop = true; break; }
        candidates.push({ form: f, sub: s, add });
        got++;
      }
      if (stop || page.length < 100) break;
    }
    if (got) log(`  ${f.form_name}: ${got} candidato(s)`);
  }
  log(`total candidatos: ${candidates.length}`);
  if (!candidates.length) return;

  // 2. dedup: 1 query com todos os emails
  const emails = [...new Set(candidates.map((c) => String(c.sub.email || '').toLowerCase().trim()).filter(Boolean))];
  log(`checando ${emails.length} emails já existentes (pode demorar, índice ainda construindo)...`);
  const existing = new Set();
  for (let i = 0; i < emails.length; i += 300) {
    const chunk = emails.slice(i, i + 300);
    const rows = await sql(`SELECT VALUE string::lowercase(email) FROM leads WHERE email IN [${chunk.map(toS).join(', ')}];`);
    rows.forEach((e) => existing.add(String(e)));
  }
  log(`já existem: ${existing.size}`);

  const novos = candidates.filter((c) => {
    const e = String(c.sub.email || '').toLowerCase().trim();
    return !e || !existing.has(e);
  });
  // ordenar do mais antigo pro mais novo
  novos.sort((a, b) => a.add.localeCompare(b.add));
  log(`a inserir: ${novos.length}`);

  if (!EXECUTE) { log('DRY-RUN — rode com --execute'); return; }
  if (novos.length > MAX_TOTAL) { log(`ABORT: ${novos.length} > MAX_TOTAL ${MAX_TOTAL}`); return; }

  const seen = new Set();
  const watermarks = new Map();
  let done = 0;
  for (const { form, sub, add } of novos) {
    const email = String(sub.email || '').toLowerCase().trim();
    if (email && seen.has(email)) continue;
    if (email) seen.add(email);
    const cid = form.course_id != null ? Number(form.course_id) : null;
    const sid = form.source_id != null ? Number(form.source_id) : 1;
    const valor = cid != null ? (courseVal.get(cid) ?? 0) : 0;
    const phone = sub.phone ? String(sub.phone).replace(/\D/g, '') : '';
    const v = sub.variables ?? {};
    const local = [v.autoCity, v.autoRegion].filter(Boolean).join(' / ');
    const obs = `SendPulse — formulário: ${form.form_name}` + (local ? `\nLocal: ${local}` : '');
    const nid = (await sql('UPDATE seq:leads SET val += 1 RETURN val;'))[0]?.val;
    if (!nid) throw new Error('seq:leads não retornou val');

    await sql(`INSERT INTO leads [{
      id: "${nid}", nome_completo: ${toS(subName(sub))}, email: ${toS(email || null)},
      telefone: ${toS(phone || '00000000000')}, stage_id: stages:\`1\`,
      source_id: lead_sources:\`${sid}\`,
      curso_interesse: ${cid != null ? `courses:\`${cid}\`` : 'NONE'},
      valor_oportunidade: ${valor}, fonte_lead: ${toS(form.form_name)},
      observacoes: ${toS(obs)}, temperatura: "frio", contact_count: 1,
      data_entrada: d${toS(spDateISO(add))}, stage_entry_date: d${toS(new Date().toISOString())}
    }] RETURN NONE;`);

    const cur = watermarks.get(form.book_id) || '';
    if (add > cur) watermarks.set(form.book_id, add);
    if (++done % 25 === 0) log(`  ${done}/${novos.length}`);
  }

  for (const [book_id, wm] of watermarks) {
    await sql(`UPDATE sendpulse_forms SET last_add_date = ${toS(wm)}, updated_at = time::now() WHERE book_id = ${book_id};`);
  }
  log(`✓ ${done} leads criados. Watermarks atualizados — o cron continua daqui.`);
}
main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
