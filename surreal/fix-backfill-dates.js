#!/usr/bin/env node
/**
 * fix-backfill-dates.js  (uso único)
 * O backfill interpretou add_date do SendPulse como -03:00; na verdade é UTC.
 * Isso deixou data_entrada 3h adiantada. Corrige subtraindo 3h dos leads de
 * formulário (observacoes "SendPulse — formulário: ...").
 *
 *   node surreal/fix-backfill-dates.js
 */
const S = process.env.SURREAL_ENDPOINT || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS = 'ficv', DB = 'salespulse';
const USER = process.env.SURREAL_USER || 'ficv_admin';
const PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';

const token = (await (await fetch(`${S}/signin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
  body: JSON.stringify({ ns: NS, user: USER, pass: PASS }),
})).json()).token;

async function sql(q, tries = 5) {
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
      console.log(`  retry ${i}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

console.log('buscando leads de formulário...');
const ids = (await sql('SELECT VALUE id FROM leads WHERE observacoes != NONE AND string::contains(observacoes, "SendPulse — formulário:");')) || [];
console.log(`encontrados: ${ids.length}`);

let ok = 0;
for (const id of ids) {
  await sql(`UPDATE ${id} SET data_entrada = data_entrada - 3h;`);
  if (++ok % 50 === 0) console.log(`  ${ok}/${ids.length}`);
}
console.log(`✓ ${ok} leads ajustados (-3h).`);

const sample = await sql('SELECT nome_completo, data_entrada FROM leads WHERE observacoes != NONE AND string::contains(observacoes, "SendPulse — formulário:") ORDER BY data_entrada DESC LIMIT 3;');
console.log('amostra:', JSON.stringify(sample));
