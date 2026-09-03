import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { dispatchWorkflow } from "../_shared/gh-dispatch.ts";

// Dispara o workflow sync-google-ads.yml (scripts/sync-google-ads.mjs, dual-write).
const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const body = await req.json().catch(() => ({}));
    const r = await dispatchWorkflow('sync-google-ads.yml', { days_back: String(body.days_back ?? '90') });
    return new Response(JSON.stringify(
        r.ok ? { success: true, dispatched: true, message: 'Sync Google iniciado (~2 min).' }
             : { error: r.error ?? 'Falha', status: r.status }
    ), { status: r.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'application/json' } });
});
