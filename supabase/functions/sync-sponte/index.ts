import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { dispatchWorkflow } from "../_shared/gh-dispatch.ts";

// Thin dispatcher: dispara o workflow sync-sponte.yml (que roda scripts/sync-sponte.mjs com
// dual-write SurrealDB + Postgres). O trabalho pesado NÃO roda aqui.
const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const body = await req.json().catch(() => ({}));
    const inputs: Record<string, string> = {};
    if (body.start_date) inputs.start_date = String(body.start_date);
    if (body.end_date) inputs.end_date = String(body.end_date);
    // recalc_goals (botão do GoalGauge) -> re-sincroniza parcelas, que recalcula financial_goals
    if (body.mode) inputs.mode = body.mode === 'recalc_goals' ? 'parcelas' : String(body.mode);
    if (!inputs.mode) inputs.mode = 'full';
    const r = await dispatchWorkflow('sync-sponte.yml', inputs);
    return new Response(JSON.stringify(
        r.ok
            ? { success: true, dispatched: true, message: 'Sync iniciado no GitHub Actions (~2 min).' }
            : { error: r.error ?? 'Falha ao disparar workflow', status: r.status }
    ), { status: r.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'application/json' } });
});
