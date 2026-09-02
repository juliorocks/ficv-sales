#!/usr/bin/env node
/**
 * reset-sendpulse-forms.js  (uso único — corrige a bagunça de duplicatas)
 *
 *   1. desativa os forms (ativo=false) -> o cron sync-sendpulse-forms para
 *   2. apaga TODOS os leads de formulário (fonte_lead em sendpulse_forms)
 *   3. reseta watermarks
 *   4. re-importa 35 dias, dedup por email + telefone (contra o banco e entre si)
 *   5. reativa os forms (ativo=true) -> cron volta, agora incremental
 *
 *   node surreal/reset-sendpulse-forms.js
 *
 * Env: SENDPULSE_API_KEY (do .env.local), BACKFILL_DAYS (35)
 */
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* ok */ }

const API_KEY = process.env.SENDPULSE_API_KEY || '';
if (!API_KEY) { console.error('sem SENDPULSE_API_KEY'); process.exit(1); }
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || 35);
const SINCE_WINDOW = '2026-07-01T00:00:00Z';

const S = process.env.SURREAL_ENDPOINT || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS = 'ficv', DB = 'salespulse';
const USER = process.env.SURREAL_USER || 'ficv_admin';
const PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let token = (await (await fetch(`${S}/signin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
  body: JSON.stringify({ ns: NS, user: USER, pass: PASS }),
})).json()).token;

async function sql(q, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${S}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json', Authorization: `Bearer ${token}`, 'surreal-ns': NS, 'surreal-db': DB },
        body: q, signal: AbortSignal.timeout(120000),
      });
      const j = await res.json();
      const e = Array.isArray(j) ? j[j.length - 1] : j;
      if (e?.status === 'ERR') throw new Error(e.result);
      return e?.result;
    } catch (err) {
      if (i > tries) throw err;
      log(`  retry ${i}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
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
const stripId = (v) => {
  const s = String(v ?? ''), m = s.match(/^[a-z_]+:⟨(.+)⟩$/) ?? s.match(/^[a-z_]+:`(.+)`$/);
  const inner = m ? m[1] : s, n = Number(inner);
  return Number.isFinite(n) && String(n) === inner ? n : inner;
};
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const nemail = (v) => String(v ?? '').toLowerCase().trim();
const spISO = (s) => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
const subName = (sub) => {
  const v = sub.variables ?? {};
  const c = String(v.Nome ?? v.nome ?? v.name ?? v.Name ?? '').trim();
  return c || (sub.email ? String(sub.email).split('@')[0] : 'Novo Lead (SendPulse)');
};

// 1. desativa ------------------------------------------------------------------
log('1. desativando forms (para o cron)...');
await sql('UPDATE sendpulse_forms SET ativo = false;');
const forms = await sql('SELECT book_id, form_name, course_id, source_id FROM sendpulse_forms;');
const formNames = new Set(forms.map((f) => f.form_name));
await new Promise((r) => setTimeout(r, 5000)); // deixa um run em voo terminar

// 2. apaga leads de formulário -----------------------------------------------
log('2. apagando leads de formulário...');
let del = 0;
for (let round = 0; round < 25; round++) {
  const rows = await sql(`SELECT id, fonte_lead FROM leads WHERE data_entrada > d"${SINCE_WINDOW}";`);
  const ids = (rows || []).filter((r) => formNames.has(r.fonte_lead)).map((r) => r.id);
  if (!ids.length) break;
  for (let i = 0; i < ids.length; i += 100) await sql(`DELETE ${ids.slice(i, i + 100).join(', ')} RETURN NONE;`);
  del += ids.length;
  log(`   apagados ${del}`);
}
await sql('UPDATE sendpulse_forms SET last_add_date = NONE;');

// 3. courses default_value ---------------------------------------------------
const courseVal = new Map();
for (const c of await sql('SELECT id, default_value FROM courses;')) {
  const id = stripId(c.id);
  if (typeof id === 'number') courseVal.set(id, Number(c.default_value) || 0);
}

// 4. coleta candidatos ------------------------------------------------------
log('4. coletando inscritos do SendPulse...');
const cutoff = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');
const cands = [];
for (const f of forms) {
  for (let off = 0; off < 3000; off += 100) {
    let page;
    try { page = await sp(`/addressbooks/${f.book_id}/emails?limit=100&offset=${off}`); }
    catch (e) { log(`   ${f.form_name}: ${e.message}`); break; }
    if (!Array.isArray(page) || !page.length) break;
    let stop = false;
    for (const s of page) {
      const add = String(s.add_date || '');
      if (add && add <= cutoff) { stop = true; break; }
      cands.push({ f, s, add });
    }
    if (stop || page.length < 100) break;
  }
}
log(`   ${cands.length} candidatos`);

// 5. dedup — real -> pula; só lixo -> apaga o lixo e cria o certo ----------
const REAL_FONTES = new Set(['Widechat', 'Wide Chat', 'Brevo Form', ...formNames]);
const isReal = (r) => r.assigned_to_id != null || r.widechat_contact_id != null || REAL_FONTES.has(String(r.fonte_lead));
const F = 'id, string::lowercase(email ?? "") AS email, telefone, assigned_to_id, widechat_contact_id, fonte_lead';
const emails = [...new Set(cands.map((c) => nemail(c.s.email)).filter(Boolean))];
const phones = [...new Set(cands.map((c) => digits(c.s.phone)).filter((p) => p.length >= 8))];
const realE = new Set(), realP = new Set(), junkE = new Map(), junkP = new Map();
for (let i = 0; i < emails.length; i += 200) {
  for (const r of (await sql(`SELECT ${F} FROM leads WHERE email IN [${emails.slice(i, i + 200).map(toS).join(', ')}];`) || [])) {
    const e = String(r.email || '');
    if (isReal(r)) realE.add(e); else { if (!junkE.has(e)) junkE.set(e, []); junkE.get(e).push(String(r.id)); }
  }
}
for (let i = 0; i < phones.length; i += 200) {
  for (const r of (await sql(`SELECT ${F} FROM leads WHERE telefone IN [${phones.slice(i, i + 200).map(toS).join(', ')}];`) || [])) {
    const p = digits(r.telefone);
    if (isReal(r)) realP.add(p); else { if (!junkP.has(p)) junkP.set(p, []); junkP.get(p).push(String(r.id)); }
  }
}
log(`   real: ${realE.size}e/${realP.size}t | lixo: ${junkE.size}e/${junkP.size}t`);

// 6. insere ----------------------------------------------------------------
cands.sort((a, b) => a.add.localeCompare(b.add));
const seenE = new Set(), seenP = new Set();
let novos = 0, lixo = 0;
for (const { f, s, add } of cands) {
  const email = nemail(s.email), phone = digits(s.phone);
  if (email && (realE.has(email) || seenE.has(email))) continue;
  if (phone.length >= 8 && (realP.has(phone) || seenP.has(phone))) continue;
  if (email) seenE.add(email);
  if (phone.length >= 8) seenP.add(phone);

  const junk = [...new Set([...(junkE.get(email) || []), ...(phone.length >= 8 ? junkP.get(phone) || [] : [])])];
  for (let i = 0; i < junk.length; i += 100) { try { await sql(`DELETE ${junk.slice(i, i + 100).join(', ')} RETURN NONE;`); } catch {} }
  lixo += junk.length;

  const cid = f.course_id != null ? Number(f.course_id) : null;
  const sid = f.source_id != null ? Number(f.source_id) : 1;
  const valor = cid != null ? (courseVal.get(cid) ?? 0) : 0;
  const v = s.variables ?? {};
  const local = [v.autoCity, v.autoRegion].filter(Boolean).join(' / ');
  const obs = `SendPulse — formulário: ${f.form_name}` + (local ? `\nLocal: ${local}` : '');
  const nid = (await sql('UPDATE seq:leads SET val += 1 RETURN val;'))[0]?.val;

  await sql(`INSERT INTO leads [{
    id: "${nid}", nome_completo: ${toS(subName(s))}, email: ${toS(email || null)},
    telefone: ${toS(phone || '00000000000')}, stage_id: stages:\`1\`,
    source_id: lead_sources:\`${sid}\`,
    curso_interesse: ${cid != null ? `courses:\`${cid}\`` : 'NONE'},
    valor_oportunidade: ${valor}, fonte_lead: ${toS(f.form_name)}, observacoes: ${toS(obs)},
    temperatura: "frio", contact_count: 1,
    data_entrada: d${toS(spISO(add))}, stage_entry_date: d${toS(new Date().toISOString())}
  }] RETURN NONE;`);

  const wm = f._wm || '';
  if (add > wm) f._wm = add;
  if (++novos % 25 === 0) log(`   inseridos ${novos}`);
}

// 7. watermarks + reativa ------------------------------------------------
for (const f of forms) {
  if (f._wm) await sql(`UPDATE sendpulse_forms SET last_add_date = ${toS(f._wm)} WHERE book_id = ${f.book_id};`);
}
log('7. reativando forms...');
await sql('UPDATE sendpulse_forms SET ativo = true, updated_at = time::now();');

const cnt = await sql('SELECT count() FROM leads GROUP ALL;');
log(`✓ ${del} apagados, ${lixo} lixo promovido, ${novos} re-importados. total leads: ${JSON.stringify(cnt)}. Cron reativado.`);
