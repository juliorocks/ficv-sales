#!/usr/bin/env node
/**
 * cleanup-backfill-leads.js
 * Remove os leads criados pela 1ª rodada do backfill-sendpulse-forms (que
 * saíram com id aleatório e data_entrada como string por causa de 2 bugs).
 * Identifica por observacoes = "SendPulse — formulário: ...". Reseta os
 * watermarks em sendpulse_forms. Uso único; depois roda o backfill corrigido.
 *
 *   node surreal/cleanup-backfill-leads.js
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

console.log('buscando ids do backfill...');
const ids = (await sql('SELECT VALUE id FROM leads WHERE observacoes != NONE AND string::contains(observacoes, "SendPulse — formulário:");')) || [];
console.log(`encontrados: ${ids.length}`);

let apagados = 0;
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100).join(', '); // já vêm como leads:xxx
  const r = await sql(`DELETE ${chunk} RETURN BEFORE;`);
  apagados += (r || []).length;
  console.log(`  ${apagados}/${ids.length}`);
}

await sql('UPDATE sendpulse_forms SET last_add_date = NONE, updated_at = time::now();');
const cnt = await sql('SELECT count() FROM leads GROUP ALL;');
console.log(`✓ ${apagados} apagados. Watermarks resetados. leads agora: ${JSON.stringify(cnt)}`);
