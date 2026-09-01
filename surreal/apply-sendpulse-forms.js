#!/usr/bin/env node
/**
 * apply-sendpulse-forms.js
 * Aplica surreal/schema-sendpulse-forms.surql (tabela sendpulse_forms + seed dos
 * 23 formulários + índice idx_leads_email CONCURRENTLY) no SurrealDB Cloud.
 *
 *   node surreal/apply-sendpulse-forms.js
 */
import { readFileSync } from 'node:fs';

const S    = process.env.SURREAL_ENDPOINT || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS   = process.env.SURREAL_NS   || 'ficv';
const DB   = process.env.SURREAL_DB   || 'salespulse';
const USER = process.env.SURREAL_USER || 'ficv_admin';
const PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';

const sql = readFileSync(new URL('./schema-sendpulse-forms.surql', import.meta.url), 'utf8');

const token = await (await fetch(`${S}/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
  body: JSON.stringify({ ns: NS, user: USER, pass: PASS }),
}).then((r) => r.json())).token;
if (!token) { console.error('sem token'); process.exit(1); }

const res = await fetch(`${S}/sql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain', Accept: 'application/json',
    Authorization: `Bearer ${token}`, 'surreal-ns': NS, 'surreal-db': DB,
  },
  body: sql,
});
const out = await res.json();
let ok = 0, err = 0;
for (const r of Array.isArray(out) ? out : [out]) {
  if (r?.status === 'OK') { ok++; }
  else { err++; console.error(' !', String(r?.result || r).slice(0, 300)); }
}
console.log(`HTTP ${res.status}  —  OK: ${ok}  ERR: ${err}`);

const check = await fetch(`${S}/sql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain', Accept: 'application/json',
    Authorization: `Bearer ${token}`, 'surreal-ns': NS, 'surreal-db': DB,
  },
  body: 'SELECT count() FROM sendpulse_forms GROUP ALL; INFO FOR INDEX idx_leads_email ON TABLE leads;',
}).then((r) => r.json());
console.log('sendpulse_forms:', JSON.stringify(check[0]?.result));
console.log('idx_leads_email:', JSON.stringify(check[1]?.result));
process.exit(err ? 1 : 0);
