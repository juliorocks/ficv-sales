import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { dispatchWorkflow } from "../_shared/gh-dispatch.ts";
import { identify, isStaff } from "../_shared/ai.ts";

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isStaff(caller) || caller?.kind === "service") return json({ error: "Não autorizado." }, 401);
    const body = await req.json().catch(() => ({}));
    const days = Number(body.days_back ?? 90);
    if (!Number.isInteger(days) || days < 1 || days > 730) return json({ error: "days_back inválido." }, 400);
    const r = await dispatchWorkflow('sync-google-ads.yml', { days_back: String(days) });
    return json(r.ok ? { success: true, dispatched: true, message: 'Sync Google iniciado (~2 min).' }
        : { error: r.error ?? 'Falha', status: r.status }, r.ok ? 200 : 502);
});
