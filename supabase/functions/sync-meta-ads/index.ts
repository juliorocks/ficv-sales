import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { dispatchWorkflow } from "../_shared/gh-dispatch.ts";

// Dispara o workflow sync-meta-ads.yml (scripts/sync-meta-ads.mjs, dual-write).
const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const body = await req.json().catch(() => ({}));
    const r = await dispatchWorkflow('sync-meta-ads.yml', { date_preset: String(body.date_preset ?? 'last_90d') });
    return new Response(JSON.stringify(
        r.ok ? { success: true, dispatched: true, message: 'Sync Meta iniciado (~2 min).' }
             : { error: r.error ?? 'Falha', status: r.status }
    ), { status: r.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'application/json' } });
});
