// Espelho Postgres (Supabase) para os syncs — zero dependência, via PostgREST.
// Ativo só se SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY estiverem no ambiente.
// Durante a transição SurrealDB→Supabase os syncs gravam nos dois bancos.

const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const pgEnabled = Boolean(URL_ && KEY);

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function req(path, opts) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`PG ${opts.method} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// upsert em lote; onConflict = coluna(s) da chave natural (ex: "campaign_id" ou "campaign_id,date")
// PostgREST não aceita 2 linhas com a mesma chave no mesmo request -> dedup (última vence).
export async function pgUpsert(table, rows, onConflict) {
  if (!pgEnabled || !rows.length) return;
  const keys = onConflict.split(',').map(s => s.trim());
  const seen = new Map();
  for (const r of rows) seen.set(keys.map(k => r[k]).join(''), r);
  const deduped = [...seen.values()];
  for (let i = 0; i < deduped.length; i += 500) {
    await req(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(deduped.slice(i, i + 500)),
    });
  }
}

// delete com filtro PostgREST (ex: { date: 'gte.2026-01-01' } vira ?date=gte.2026-01-01)
export async function pgDelete(table, filters) {
  if (!pgEnabled) return;
  const qs = Object.entries(filters).map(([k, v]) => `${k}=${v}`).join('&');
  await req(`${table}?${qs}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

export async function pgRpc(fn, args) {
  if (!pgEnabled) return null;
  return req(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) });
}

// wrapper: roda fn e engole erro (não derruba o sync do SurrealDB se o Postgres falhar)
export async function pgTry(label, fn) {
  if (!pgEnabled) return;
  try { await fn(); console.log(`  ↳ Postgres: ${label} ok`); }
  catch (e) { console.error(`  ↳ Postgres: ${label} FALHOU — ${e.message}`); }
}
