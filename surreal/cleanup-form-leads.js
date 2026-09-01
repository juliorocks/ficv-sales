#!/usr/bin/env node
/**
 * cleanup-form-leads.js  (uso único)
 * Remove TODOS os leads cujo fonte_lead é um dos formulários SendPulse
 * (sendpulse_forms.form_name). Usa a janela do índice data_entrada em vez de
 * varrer observacoes (que retorna parcial sob pressão de memória). Reseta os
 * watermarks. Depois: rode surreal/backfill-sendpulse-forms.js --execute.
 *
 *   node surreal/cleanup-form-leads.js
 */
const S = process.env.SURREAL_ENDPOINT || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS = 'ficv', DB = 'salespulse';
const USER = process.env.SURREAL_USER || 'ficv_admin';
const PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';
const SINCE = process.env.SINCE || '2026-07-01T00:00:00Z';

const token = (await (await fetch(`${S}/signin`, {
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
      console.log(`  retry ${i}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

const formNames = new Set(await sql('SELECT VALUE form_name FROM sendpulse_forms;'));
console.log(`formulários: ${formNames.size}`);

let round = 0, totalDel = 0;
while (true) {
  round++;
  // janela indexada (SEM order by — combinar range + ORDER BY faz full scan aqui)
  const rows = await sql(`SELECT id, fonte_lead FROM leads WHERE data_entrada > d"${SINCE}";`);
  const ids = (rows || []).filter((r) => formNames.has(r.fonte_lead)).map((r) => r.id);
  console.log(`rodada ${round}: ${rows?.length || 0} recentes, ${ids.length} de formulário`);
  if (!ids.length) break;
  for (let i = 0; i < ids.length; i += 100) {
    await sql(`DELETE ${ids.slice(i, i + 100).join(', ')} RETURN NONE;`);
  }
  totalDel += ids.length;
  if (round > 20) { console.log('parando por segurança (>20 rodadas)'); break; }
}

await sql('UPDATE sendpulse_forms SET last_add_date = NONE, updated_at = time::now();');
const cnt = await sql('SELECT count() FROM leads GROUP ALL;');
console.log(`✓ ${totalDel} leads de formulário removidos. Watermarks resetados. total leads: ${JSON.stringify(cnt)}`);
