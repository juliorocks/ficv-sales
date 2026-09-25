// ai-agent — motor de conversa da IA de atendimento (VivaConnect).
//
// action "reply" (padrão):
//   { messages: [{role:'user'|'assistant', content}], lead_id?, lead?: {nome, curso}, dry_run? }
//   → { reply, handoff, handoff_reason, summary, sources[], skipped? }
//   Com lead_id (e sem dry_run) aplica a TRAVA: se a sessão do lead não está
//   'active' (já houve handoff / IA desligada), NÃO responde — devolve skipped.
//   O playground da tela manda dry_run sem lead_id: não grava nada.
//
// action "takeover"   { lead_id, reason? } → agente humano assumiu: IA sai de vez.
// action "reactivate" { lead_id }          → admin devolve o lead pra IA.
//
// Quem chama em produção (futuro vivaconnect-webhook) usa a service role key.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { chatJSON, corsHeaders, embed, identify, isAdmin, isStaff, jsonRes, toVector } from "../_shared/ai.ts";

type Msg = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const caller = await identify(req, db);
    if (!isStaff(caller)) return jsonRes({ error: "Não autorizado." }, 401);

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "reply";
        const leadId: number | null = body.lead_id ? Number(body.lead_id) : null;

        if (action === "takeover" || action === "reactivate") {
            if (!leadId) return jsonRes({ error: "lead_id obrigatório." }, 400);
            if (action === "reactivate" && !isAdmin(caller)) return jsonRes({ error: "Só admin reativa a IA." }, 403);
            const now = new Date().toISOString();
            const row = action === "takeover"
                ? { lead_id: leadId, status: "handed_off", handoff_reason: body.reason ?? "Agente assumiu a conversa", handed_off_at: now, updated_at: now }
                : { lead_id: leadId, status: "active", ai_turns: 0, handoff_reason: null, handoff_summary: null, handed_off_at: null, updated_at: now };
            const { error } = await db.from("ai_lead_sessions").upsert(row);
            if (error) return jsonRes({ error: error.message }, 500);
            return jsonRes({ ok: true, status: row.status });
        }

        if (action !== "reply") return jsonRes({ error: `Ação desconhecida: ${action}` }, 400);

        const messages: Msg[] = (body.messages ?? [])
            .filter((m: Msg) => m?.content && (m.role === "user" || m.role === "assistant"))
            .slice(-20);
        if (!messages.length || messages[messages.length - 1].role !== "user") {
            return jsonRes({ error: "A última mensagem precisa ser do lead (role 'user')." }, 400);
        }
        const dryRun = !!body.dry_run || !leadId;

        const { data: s, error: sErr } = await db.from("ai_agent_settings").select("*").eq("id", 1).single();
        if (sErr || !s) return jsonRes({ error: "Configuração da IA não encontrada." }, 500);

        // ── TRAVA: IA nunca reentra depois do handoff ──────────────────────
        let session: any = null;
        if (leadId) {
            session = (await db.from("ai_lead_sessions").select("*").eq("lead_id", leadId).maybeSingle()).data;
            if (session && session.status !== "active") {
                return jsonRes({ skipped: true, reason: `IA fora deste lead (status: ${session.status}).` });
            }
            if (!dryRun && !s.enabled) {
                return jsonRes({ skipped: true, reason: "IA desligada nas configurações." });
            }
        }

        // ── contexto do lead ────────────────────────────────────────────────
        let lead = body.lead ?? null;
        if (leadId && !lead) {
            const { data: l } = await db.from("leads")
                .select("nome_completo, curso_interesse, courses:curso_interesse(name)")
                .eq("id", leadId).maybeSingle();
            if (l) lead = { nome: l.nome_completo, curso: (l as any).courses?.name ?? null };
        }

        // ── busca na base: últimas falas do lead viram a consulta ───────────
        const query = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join("\n");
        const [qVec] = await embed([lead?.curso ? `${lead.curso}\n${query}` : query], s.embedding_model);
        const { data: hits, error: mErr } = await db.rpc("match_knowledge_chunks", {
            query_embedding: toVector(qVec), match_count: s.match_count, min_similarity: Number(s.min_similarity),
        });
        if (mErr) throw new Error(`busca na base: ${mErr.message}`);

        const knowledge = (hits ?? []).length
            ? (hits as any[]).map((h, i) => `[${i + 1}] ${h.content}`).join("\n\n---\n\n")
            : "(nenhum trecho relevante encontrado na base de conhecimento)";

        const leadCtx = lead
            ? `Dados do lead: nome ${lead.nome ?? "desconhecido"}${lead.curso ? `; curso de interesse informado no formulário: ${lead.curso}` : ""}.`
            : "Dados do lead: não informados.";

        const system = [
            s.system_prompt,
            `Seu nome é ${s.agent_name}.`,
            s.handoff_instructions,
            leadCtx,
            `BASE DE CONHECIMENTO (use só isto como fonte de fatos):\n\n${knowledge}`,
            `Responda SEMPRE em JSON com as chaves:
{"reply": "mensagem para enviar ao lead",
 "handoff": true|false,
 "handoff_reason": "motivo curto quando handoff=true, senão null",
 "summary": "quando handoff=true: resumo para o consultor (curso, modalidade, objeções, o que o lead pediu); senão null"}
Quando handoff=true, a "reply" deve avisar com naturalidade que um consultor vai continuar o atendimento.`,
        ].join("\n\n");

        const { json, usage } = await chatJSON(s.chat_model, Number(s.temperature), [
            { role: "system", content: system },
            ...messages,
        ]);

        let handoff = !!json.handoff;
        let reason: string | null = json.handoff_reason ?? null;
        const turns = (session?.ai_turns ?? 0) + 1;
        if (!handoff && leadId && turns >= s.max_ai_turns) {
            handoff = true;
            reason = `Limite de ${s.max_ai_turns} respostas da IA atingido`;
        }

        if (leadId && !dryRun) {
            const now = new Date().toISOString();
            await db.from("ai_lead_sessions").upsert({
                lead_id: leadId, ai_turns: turns, updated_at: now,
                ...(handoff
                    ? { status: "handed_off", handoff_reason: reason, handoff_summary: json.summary ?? null, handed_off_at: now }
                    : { status: "active" }),
            });
        }

        return jsonRes({
            reply: String(json.reply ?? "").trim(),
            handoff,
            handoff_reason: reason,
            summary: handoff ? (json.summary ?? null) : null,
            sources: (hits ?? []).map((h: any) => ({
                document_id: h.document_id, title: h.title, similarity: Math.round(h.similarity * 100) / 100,
            })),
            usage,
            dry_run: dryRun,
        });
    } catch (e) {
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
