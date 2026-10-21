// evaluate-conversations — nota de atendimento em tempo real (e backfill heurístico).
//
//   mode "live" (cron a cada 10 min, x-cron-key): leads que entraram em "Finalizado" nos
//     últimos 3 dias ganham uma avaliação por finalização (IA; heurística se a IA falhar).
//   mode "backfill_viva" (admin): leads finalizados desde 25/09 — só mensagens do VivaConnect,
//     só heurística (sem OpenAI).
//   mode "backfill_wc" (admin): sessões do WideChat de 01/10 a 09/10 — só heurística. Antes de
//     01/10 já existe avaliação pela exportação (CSV), que termina em 30/09.
//
// Cada atendimento vira uma linha em messages_logs com protocolo fixo, então rodar de novo não
// duplica. Dashboards seguem lendo a mesma tabela.
import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isAdmin, jsonRes } from "../_shared/ai.ts";
import { evaluateAtendimento, AiResult, Evaluation, Msg } from "../_shared/conversationScore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIVE_WINDOW_DAYS = 3;
const VIVA_FLOOR = "2026-09-25T00:00:00-03:00";
const WC_FROM = "2026-10-01T00:00:00-03:00";
const WC_TO = "2026-10-10T00:00:00-03:00";

type Counts = { avaliados: number; ia: number; heuristica: number; invalidadas: number; ignorados: number };

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await page(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
    }
    return out;
}

async function protocolExists(db: SupabaseClient, protocol: string) {
    const { data } = await db.from("messages_logs").select("id").eq("protocol", protocol).limit(1).maybeSingle();
    return !!data;
}

async function lastEndForLead(db: SupabaseClient, leadId: number): Promise<string | null> {
    const { data } = await db.from("messages_logs").select("timestamp").like("protocol", `lead:${leadId}:%`)
        .order("timestamp", { ascending: false }).limit(1).maybeSingle();
    return data?.timestamp ?? null;
}

async function callAi(messages: { role: string; text: string }[]): Promise<AiResult | null> {
    try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/analyze-conversation`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY },
            body: JSON.stringify({ messages }),
            signal: AbortSignal.timeout(90000),
        });
        if (!r.ok) return null;
        const j = await r.json();
        return (j?.result as AiResult) ?? null;
    } catch {
        return null;
    }
}

function rowFor(protocol: string, contact: string, ev: Evaluation, endIso: string, agentId: string | null) {
    return {
        protocol, contact, agent_name: ev.agent, agent_id: agentId, message_content: null,
        timestamp: endIso, has_empathy: ev.hasEmpathy, closing_attempt: ev.closingAttempt,
        final_score: ev.finalScore, empathy_score: ev.empathy, clarity_score: ev.clarity,
        depth_score: ev.depth, commercial_score: ev.commercial, agility_score: ev.agility,
        message_count: ev.messageCount, status: ev.status, is_commercial: ev.isCommercial,
        overall_conclusion: ev.overallConclusion, improvements: ev.improvements,
        avaliacao_metodo: ev.method, upload_id: null,
    };
}

// Avalia um segmento: heurística primeiro; se houver conversa real e a IA estiver liberada, reavalia com IA.
async function evaluateSegment(msgs: Msg[], useAi: boolean): Promise<Evaluation> {
    const pre = evaluateAtendimento(msgs, null);
    if (pre.method === "auto_invalidada" || !useAi) return pre;
    const ai = await callAi(pre.aiMessages);
    return evaluateAtendimento(msgs, ai);
}

function bump(c: Counts, ev: Evaluation) {
    c.avaliados++;
    if (ev.status === "invalidated") c.invalidadas++;
    if (ev.method === "ia") c.ia++;
    if (ev.method === "heuristica") c.heuristica++;
}

async function profilesByName(db: SupabaseClient) {
    const { data } = await db.from("profiles").select("id, full_name");
    const m = new Map<string, string>();
    for (const p of data ?? []) if (p.full_name) m.set(String(p.full_name).trim().toLowerCase(), p.id);
    return m;
}

async function runLive(db: SupabaseClient, limit: number): Promise<Counts> {
    const c: Counts = { avaliados: 0, ia: 0, heuristica: 0, invalidadas: 0, ignorados: 0 };
    const { data: stages } = await db.from("stages").select("id, name");
    const fin = (stages ?? []).find((s) => String(s.name).trim().toLowerCase() === "finalizado");
    if (!fin) throw new Error("Etapa 'Finalizado' não encontrada");
    const since = new Date(Date.now() - LIVE_WINDOW_DAYS * 86400000).toISOString();
    const { data: leads, error } = await db.from("leads").select("id, nome_completo, stage_entry_date")
        .eq("stage_id", fin.id).gte("stage_entry_date", since).limit(limit);
    if (error) throw error;
    const agents = await profilesByName(db);
    for (const lead of leads ?? []) {
        if (!lead.stage_entry_date) { c.ignorados++; continue; }
        const endIso = new Date(lead.stage_entry_date).toISOString();
        const protocol = `lead:${lead.id}:${endIso}`;
        if (await protocolExists(db, protocol)) { c.ignorados++; continue; }
        const start = (await lastEndForLead(db, lead.id)) ?? "1970-01-01T00:00:00Z";
        const msgs = await fetchAll<Msg>((from, to) => db.from("widechat_messages")
            .select("origin, sender_name, message, created_at, interno")
            .eq("lead_id", lead.id).gt("created_at", start).lte("created_at", endIso)
            .order("created_at", { ascending: true }).range(from, to));
        if (msgs.length === 0) { c.ignorados++; continue; }
        const ev = await evaluateSegment(msgs, true);
        if (ev.messageCount === 0 && ev.status === "invalidated") { c.ignorados++; continue; }
        const agentId = agents.get(ev.agent.trim().toLowerCase()) ?? null;
        const { error: wErr } = await db.from("messages_logs").upsert(rowFor(protocol, lead.nome_completo ?? "", ev, endIso, agentId), { onConflict: "protocol" });
        if (wErr) throw wErr;
        bump(c, ev);
    }
    return c;
}

async function runBackfillViva(db: SupabaseClient, limit: number, offset: number): Promise<Counts> {
    const c: Counts = { avaliados: 0, ia: 0, heuristica: 0, invalidadas: 0, ignorados: 0 };
    const { data: stages } = await db.from("stages").select("id, name");
    const fin = (stages ?? []).find((s) => String(s.name).trim().toLowerCase() === "finalizado");
    if (!fin) throw new Error("Etapa 'Finalizado' não encontrada");
    const { data: leads, error } = await db.from("leads").select("id, nome_completo, stage_entry_date")
        .eq("stage_id", fin.id).gte("stage_entry_date", VIVA_FLOOR).order("id", { ascending: true }).range(offset, offset + limit - 1);
    if (error) throw error;
    const agents = await profilesByName(db);
    for (const lead of leads ?? []) {
        if (!lead.stage_entry_date) { c.ignorados++; continue; }
        const endIso = new Date(lead.stage_entry_date).toISOString();
        const protocol = `lead:${lead.id}:${endIso}`;
        if (await protocolExists(db, protocol)) { c.ignorados++; continue; }
        const last = await lastEndForLead(db, lead.id);
        const start = last && last > VIVA_FLOOR ? last : VIVA_FLOOR;
        const msgs = await fetchAll<Msg>((from, to) => db.from("widechat_messages")
            .select("origin, sender_name, message, created_at, interno")
            .eq("lead_id", lead.id).eq("provider", "vivaconnect")
            .gt("created_at", start).lte("created_at", endIso)
            .order("created_at", { ascending: true }).range(from, to));
        if (msgs.length === 0) { c.ignorados++; continue; }
        const ev = evaluateAtendimento(msgs, null);
        if (ev.messageCount === 0) { c.ignorados++; continue; }
        const agentId = agents.get(ev.agent.trim().toLowerCase()) ?? null;
        const { error: wErr } = await db.from("messages_logs").upsert(rowFor(protocol, lead.nome_completo ?? "", ev, endIso, agentId), { onConflict: "protocol" });
        if (wErr) throw wErr;
        bump(c, ev);
    }
    return c;
}

async function runBackfillWc(db: SupabaseClient, limit: number): Promise<Counts> {
    const c: Counts = { avaliados: 0, ia: 0, heuristica: 0, invalidadas: 0, ignorados: 0 };
    const msgs = await fetchAll<Msg & { session_id: string | null; lead_id: number | null }>((from, to) => db.from("widechat_messages")
        .select("origin, sender_name, message, created_at, interno, session_id, lead_id")
        .eq("provider", "widechat").gte("created_at", WC_FROM).lt("created_at", WC_TO)
        .order("created_at", { ascending: true }).range(from, to));
    const bySession = new Map<string, typeof msgs>();
    for (const m of msgs) {
        const key = m.session_id ?? `lead-${m.lead_id}`;
        if (!bySession.has(key)) bySession.set(key, []);
        bySession.get(key)!.push(m);
    }
    const agents = await profilesByName(db);
    let processed = 0;
    for (const [session, list] of bySession) {
        if (processed++ >= limit) break;
        const protocol = `wc:${session}`;
        if (await protocolExists(db, protocol)) { c.ignorados++; continue; }
        const ev = evaluateAtendimento(list, null);
        if (ev.messageCount === 0) { c.ignorados++; continue; }
        const endIso = list[list.length - 1].created_at;
        const agentId = agents.get(ev.agent.trim().toLowerCase()) ?? null;
        const { error: wErr } = await db.from("messages_logs").upsert(rowFor(protocol, "WideChat", ev, endIso, agentId), { onConflict: "protocol" });
        if (wErr) throw wErr;
        bump(c, ev);
    }
    return c;
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isAdmin(caller)) return jsonRes({ error: "Não autorizado." }, 401);
    try {
        const body = await req.json().catch(() => ({}));
        const limit = Math.min(Number(body.limit ?? 500), 2000);
        const mode = String(body.mode ?? "live");
        if (mode === "live") return jsonRes({ mode, ...(await runLive(db, limit)) });
        if (mode === "backfill_viva") return jsonRes({ mode, offset: Number(body.offset ?? 0), ...(await runBackfillViva(db, limit, Number(body.offset ?? 0))) });
        if (mode === "backfill_wc") return jsonRes({ mode, ...(await runBackfillWc(db, limit)) });
        return jsonRes({ error: "mode inválido" }, 400);
    } catch (e) {
        console.error("evaluate-conversations:", e);
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
