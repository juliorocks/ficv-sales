import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { dispatchWorkflow } from "../_shared/gh-dispatch.ts";
import { identify, isStaff } from "../_shared/ai.ts";

// Thin dispatcher: dispara o workflow sync-sponte.yml (que roda scripts/sync-sponte.mjs com
// dual-write SurrealDB + Postgres). O trabalho pesado NÃO roda aqui.
const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODES = ["full", "matriculas", "parcelas", "recalc_goals"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isStaff(caller) || caller?.kind === "service") {
        return new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const body = await req.json().catch(() => ({}));
    const inputs: Record<string, string> = {};
    if (body.start_date !== undefined && body.start_date !== "") {
        if (!DATE.test(String(body.start_date))) return new Response(JSON.stringify({ error: "start_date inválida." }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
        inputs.start_date = String(body.start_date);
    }
    if (body.end_date !== undefined && body.end_date !== "") {
        if (!DATE.test(String(body.end_date))) return new Response(JSON.stringify({ error: "end_date inválida." }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
        inputs.end_date = String(body.end_date);
    }
    // recalc_goals (botão do GoalGauge) -> re-sincroniza parcelas, que recalcula financial_goals
    const mode = body.mode === 'recalc_goals' ? 'parcelas' : String(body.mode ?? 'full');
    if (!MODES.includes(String(body.mode ?? 'full'))) return new Response(JSON.stringify({ error: "mode inválido." }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    inputs.mode = mode;
    const r = await dispatchWorkflow('sync-sponte.yml', inputs);
    return new Response(JSON.stringify(
        r.ok
            ? { success: true, dispatched: true, message: 'Sync iniciado no GitHub Actions (~2 min).' }
            : { error: r.error ?? 'Falha ao disparar workflow', status: r.status }
    ), { status: r.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'application/json' } });
});
