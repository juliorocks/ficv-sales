// evaluate-conversations — nota de atendimento em tempo real (e backfill heurístico).
//
//   mode "live" (cron a cada 10 min, x-cron-key): leads que entraram em "Finalizado" nos
//     últimos 3 dias ganham uma avaliação por finalização (IA; heurística se a IA falhar).
//   mode "backfill_viva" (admin): leads finalizados desde 25/09 — só heurística (sem OpenAI).
//   mode "backfill_wc" (admin): sessões do WideChat de 01/10 a 09/10 — só heurística. Antes de
//     01/10 já existe avaliação pela exportação (CSV), que termina em 30/09.
//   mode "refresh" (admin): reavalia as linhas novas (método != csv) com a lógica atual, para
//     corrigir transcrição, data do atendimento e segmentação.
//
// Segmentos por lead usam só mensagens do VivaConnect: o histórico do WideChat já foi avaliado
// (CSV até 30/09, sessões em outubro). Cada atendimento vira uma linha em messages_logs com
// protocolo fixo, então rodar de novo não duplica.
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
type FullMsg = Msg & { session_id?: string | null; lead_id?: number | null };

const emptyCounts = (): Counts => ({ avaliados: 0, ia: 0, heuristica: 0, invalidadas: 0, ignorados: 0 });

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

async function lastEndBefore(db: SupabaseClient, leadId: number, endIso: string): Promise<string | null> {
    const { data } = await db.from("messages_logs").select("protocol").like("protocol", `lead:${leadId}:%`);
    const ends = (data ?? []).map((r) => r.protocol.slice(`lead:${leadId}:`.length)).filter((e) => e && e < endIso).sort();
    return ends.length ? ends[ends.length - 1] : null;
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

const fmtTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Transcrição no formato que o painel de análise já lê (array {role, text, time}); robôs ficam de fora.
function buildTranscript(msgs: FullMsg[]) {
    return msgs
        .filter((m) => !m.interno && m.origin !== "auto")
        .map((m) => ({ role: m.origin === "agent" ? "agent" : "client", text: m.message ?? "", time: fmtTime(m.created_at) }));
}

// Data do atendimento = última mensagem humana do segmento (não o momento da finalização).
function attendanceEnd(msgs: FullMsg[], fallbackIso: string) {
    const human = msgs.filter((m) => !m.interno && (m.origin === "agent" || m.origin === "channel"));
    return human.length ? human[human.length - 1].created_at : fallbackIso;
}

function rowFor(protocol: string, contact: string, ev: Evaluation, msgs: FullMsg[], endIso: string, agentId: string | null) {
    return {
        protocol, contact, agent_name: ev.agent, agent_id: agentId,
        message_content: JSON.stringify(buildTranscript(msgs)),
        timestamp: attendanceEnd(msgs, endIso), has_empathy: ev.hasEmpathy, closing_attempt: ev.closingAttempt,
        final_score: ev.finalScore, empathy_score: ev.empathy, clarity_score: ev.clarity,
        depth_score: ev.depth, commercial_score: ev.commercial, agility_score: ev.agility,
        message_count: ev.messageCount, status: ev.status, is_commercial: ev.isCommercial,
        overall_conclusion: ev.overallConclusion, improvements: ev.improvements,
        avaliacao_metodo: ev.method, upload_id: null,
    };
}

// Heurística sempre; IA só quando pedido (live e refresh de linhas que já eram IA).
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

async function finalizadoStageId(db: SupabaseClient): Promise<number> {
    const { data: stages } = await db.from("stages").select("id, name");
    const fin = (stages ?? []).find((s) => String(s.name).trim().toLowerCase() === "finalizado");
    if (!fin) throw new Error("Etapa 'Finalizado' não encontrada");
    return fin.id;
}

// Um atendimento de lead = mensagens do VivaConnect entre o fim da avaliação anterior e a finalização.
async function leadSegment(db: SupabaseClient, leadId: number, endIso: string): Promise<{ start: string; msgs: FullMsg[] }> {
    const last = await lastEndBefore(db, leadId, endIso);
    const start = last && last > VIVA_FLOOR ? last : VIVA_FLOOR;
    const msgs = await fetchAll<FullMsg>((from, to) => db.from("widechat_messages")
        .select("origin, sender_name, message, created_at, interno, session_id, lead_id")
        .eq("lead_id", leadId).eq("provider", "vivaconnect")
        .gt("created_at", start).lte("created_at", endIso)
        .order("created_at", { ascending: true }).range(from, to));
    return { start, msgs };
}

async function gravar(db: SupabaseClient, protocol: string, contact: string, ev: Evaluation, msgs: FullMsg[], endIso: string, agents: Map<string, string>) {
    const agentId = agents.get(ev.agent.trim().toLowerCase()) ?? null;
    const { error } = await db.from("messages_logs").upsert(rowFor(protocol, contact, ev, msgs, endIso, agentId), { onConflict: "protocol" });
    if (error) throw error;
}

async function runLive(db: SupabaseClient, limit: number): Promise<Counts> {
    const c = emptyCounts();
    const finId = await finalizadoStageId(db);
    const since = new Date(Date.now() - LIVE_WINDOW_DAYS * 86400000).toISOString();
    const { data: leads, error } = await db.from("leads").select("id, nome_completo, stage_entry_date")
        .eq("stage_id", finId).gte("stage_entry_date", since).limit(limit);
    if (error) throw error;
    const agents = await profilesByName(db);
    for (const lead of leads ?? []) {
        if (!lead.stage_entry_date) { c.ignorados++; continue; }
        const endIso = new Date(lead.stage_entry_date).toISOString();
        const protocol = `lead:${lead.id}:${endIso}`;
        if (await protocolExists(db, protocol)) { c.ignorados++; continue; }
        const { msgs } = await leadSegment(db, lead.id, endIso);
        if (msgs.length === 0) { c.ignorados++; continue; }
        const ev = await evaluateSegment(msgs, true);
        if (ev.messageCount === 0) { c.ignorados++; continue; }
        await gravar(db, protocol, lead.nome_completo ?? "", ev, msgs, endIso, agents);
        bump(c, ev);
    }
    return c;
}

async function runBackfillViva(db: SupabaseClient, limit: number, offset: number): Promise<Counts> {
    const c = emptyCounts();
    const finId = await finalizadoStageId(db);
    const { data: leads, error } = await db.from("leads").select("id, nome_completo, stage_entry_date")
        .eq("stage_id", finId).gte("stage_entry_date", VIVA_FLOOR).order("id", { ascending: true }).range(offset, offset + limit - 1);
    if (error) throw error;
    const agents = await profilesByName(db);
    for (const lead of leads ?? []) {
        if (!lead.stage_entry_date) { c.ignorados++; continue; }
        const endIso = new Date(lead.stage_entry_date).toISOString();
        const protocol = `lead:${lead.id}:${endIso}`;
        if (await protocolExists(db, protocol)) { c.ignorados++; continue; }
        const { msgs } = await leadSegment(db, lead.id, endIso);
        if (msgs.length === 0) { c.ignorados++; continue; }
        const ev = evaluateAtendimento(msgs, null);
        if (ev.messageCount === 0) { c.ignorados++; continue; }
        await gravar(db, protocol, lead.nome_completo ?? "", ev, msgs, endIso, agents);
        bump(c, ev);
    }
    return c;
}

async function runBackfillWc(db: SupabaseClient, limit: number): Promise<Counts> {
    const c = emptyCounts();
    const msgs = await fetchAll<FullMsg>((from, to) => db.from("widechat_messages")
        .select("origin, sender_name, message, created_at, interno, session_id, lead_id")
        .eq("provider", "widechat").gte("created_at", WC_FROM).lt("created_at", WC_TO)
        .order("created_at", { ascending: true }).range(from, to));
    const bySession = new Map<string, FullMsg[]>();
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
        await gravar(db, protocol, "WideChat", ev, list, endIso, agents);
        bump(c, ev);
    }
    return c;
}

// Reavalia as linhas novas (método != csv) com a segmentação corrigida. Mantém o método original
// (linhas de IA continuam com IA) e atualiza transcrição e data do atendimento.
async function runRefresh(db: SupabaseClient, limit: number, offset: number): Promise<Counts> {
    const c = emptyCounts();
    const rows = await fetchAll<{ protocol: string; avaliacao_metodo: string; contact: string | null; agent_name: string | null }>((from, to) => db.from("messages_logs")
        .select("protocol, avaliacao_metodo, contact, agent_name").neq("avaliacao_metodo", "csv")
        .order("protocol", { ascending: true }).range(from, to));
    const agents = await profilesByName(db);
    for (const row of rows.slice(offset, offset + limit)) {
        const useAi = row.avaliacao_metodo === "ia";
        if (row.protocol.startsWith("lead:")) {
            const [, idStr, ...rest] = row.protocol.split(":");
            const endIso = rest.join(":");
            const { msgs } = await leadSegment(db, Number(idStr), endIso);
            if (msgs.length === 0) { c.ignorados++; continue; }
            const ev = await evaluateSegment(msgs, useAi);
            await gravar(db, row.protocol, row.contact ?? "", ev, msgs, endIso, agents);
            bump(c, ev);
        } else if (row.protocol.startsWith("wc:")) {
            const session = row.protocol.slice(3);
            const msgs = await fetchAll<FullMsg>((from, to) => db.from("widechat_messages")
                .select("origin, sender_name, message, created_at, interno, session_id, lead_id")
                .eq("session_id", session).order("created_at", { ascending: true }).range(from, to));
            if (msgs.length === 0) { c.ignorados++; continue; }
            const ev = evaluateAtendimento(msgs, null);
            await gravar(db, row.protocol, row.contact ?? "WideChat", ev, msgs, msgs[msgs.length - 1].created_at, agents);
            bump(c, ev);
        } else {
            c.ignorados++;
        }
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
        const offset = Number(body.offset ?? 0);
        const mode = String(body.mode ?? "live");
        if (mode === "live") return jsonRes({ mode, ...(await runLive(db, limit)) });
        if (mode === "backfill_viva") return jsonRes({ mode, offset, ...(await runBackfillViva(db, limit, offset)) });
        if (mode === "backfill_wc") return jsonRes({ mode, ...(await runBackfillWc(db, limit)) });
        if (mode === "refresh") return jsonRes({ mode, offset, ...(await runRefresh(db, limit, offset)) });
        return jsonRes({ error: "mode inválido" }, 400);
    } catch (e) {
        console.error("evaluate-conversations:", e);
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
