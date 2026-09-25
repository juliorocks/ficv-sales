// vivaconnect-webhook — recebe o webhook de mensagens do Z-PRO (VivaConnect).
//
// URL cadastrada na API do canal no painel do Z-PRO:
//   https://<proj>.supabase.co/functions/v1/vivaconnect-webhook?secret=<vivaconnect_settings.webhook_secret>&channel=<vivaconnect_channels.id>
//
// 1. Sempre grava o payload BRUTO (vivaconnect_webhook_logs) — o schema não é
//    documentado, é daqui que se ajusta o parseWebhook.
// 2. Com vivaconnect_settings.enabled = false, para por aí (modo "só escuta").
// 3. Ligado: casa/cria o lead pelo telefone, grava a mensagem em
//    widechat_messages (provider='vivaconnect') e:
//    - mensagem do NOSSO lado que não saiu da fila (agente digitou no painel do
//      Z-PRO) → trava a IA daquele lead (IA nunca reentra);
//    - canal oficial + aluno (Sponte) → resposta com link do portal (fila);
//    - não-aluno num canal com "IA responde" marcado (vivaconnect_channels.ai_enabled) → IA responde (fila).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { mirror, sv } from "../_shared/db.ts";
import { fillTemplate, findLeadByPhone, firstName, loadSettings, parseWebhook, toZproNumber, zpro, zproErr } from "../_shared/vivaconnect.ts";

// Bots de IA embutidos do Z-PRO que vêm LIGADOS por padrão em ticket novo
// (ex.: chatgptStatus:true sem chave → nota "Falha na resposta automática").
// Quem responde é a NOSSA IA — desligamos no ticket pra nunca ter 2 bots.
// Typebot/chatflow (menus) ficam como estão.
const ZPRO_AI_FLAGS = ["chatgptStatus", "difyStatus", "dialogflowStatus", "n8nStatus"];

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const VIVACONNECT_SOURCE = "WhatsApp (VivaConnect)";

Deno.serve(async (req) => {
    if (req.method !== "POST") return j({ ok: true }); // alguns painéis testam a URL com GET
    const url = new URL(req.url);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const settings = await loadSettings(db);
    if (url.searchParams.get("secret") !== settings.webhook_secret) return j({ error: "secret inválido" }, 401);

    const reqChannel = Number(url.searchParams.get("channel")) || null;
    const { data: ch } = reqChannel
        ? await db.from("vivaconnect_channels").select("id, name, purpose, zpro_whatsapp_id, ai_enabled").eq("id", reqChannel).maybeSingle()
        : { data: null };
    const raw = await req.text();
    let payload: any;
    try { payload = JSON.parse(raw); } catch { payload = { _raw: raw }; }

    const { data: log, error: logErr } = await db.from("vivaconnect_webhook_logs")
        .insert({ channel_id: ch?.id ?? null, payload }).select("id").single();
    if (logErr) console.error("vivaconnect-webhook log:", logErr.message);
    const done = async (outcome: string, leadId: number | null = null) => {
        if (log?.id) await db.from("vivaconnect_webhook_logs").update({ outcome, lead_id: leadId }).eq("id", log.id);
        return j({ ok: true, outcome });
    };

    try {
        if (!settings.enabled) return await done(ch ? "logged:integração desligada" : `logged:integração desligada; canal desconhecido (?channel=${reqChannel ?? "faltando"})`);

        if (!ch) return await done(`ignored:canal desconhecido (?channel=${reqChannel ?? "faltando"})`);

        const m = parseWebhook(payload);
        if (!m) return await done("ignored:sem mensagem reconhecível");
        if (m.event && m.event !== "message") return await done(`ignored:evento ${m.event}`);
        if (m.ignorable) return await done("ignored:reação/edição/sistema");
        if (m.isGroup) return await done("ignored:grupo");
        if (!m.number) return await done("ignored:sem número");
        const botsOn = ZPRO_AI_FLAGS.filter((f) => payload?.ticket?.[f] === true);
        if (botsOn.length && m.ticketId) {
            const { data: tok } = await db.from("vivaconnect_channels").select("api_id, api_token").eq("id", ch.id).single();
            const r = await zpro(settings.base_url, tok, "/updateticketinfo",
                { ticketId: Number(m.ticketId), ...Object.fromEntries(botsOn.map((f) => [f, false])) });
            if (!r.ok) console.error(`vivaconnect-webhook: desligar ${botsOn.join(",")} no ticket ${m.ticketId}:`, zproErr(r.status, r.data));
        }

        if (m.whatsappId && !ch.zpro_whatsapp_id) {
            await db.from("vivaconnect_channels").update({ zpro_whatsapp_id: m.whatsappId }).eq("id", ch.id);
        }

        if (m.messageId) {
            const { data: dup } = await db.from("widechat_messages").select("id")
                .eq("provider", "vivaconnect").eq("message_id", m.messageId).limit(1).maybeSingle();
            if (dup) return await done("ignored:duplicada");
        }

        // eco de envio da nossa fila (1ª mensagem / portal / IA / CRM): o worker já
        // gravou em widechat_messages na hora do envio — não duplica.
        if (m.fromMe) {
            const since = new Date(Date.now() - 10 * 60_000).toISOString();
            const { data: ours } = await db.from("vivaconnect_outbox").select("id")
                .eq("number", toZproNumber(m.number) ?? m.number).in("status", ["sending", "sent"]).gte("created_at", since)
                .eq("body", m.body).limit(1).maybeSingle();
            if (ours) return await done(`ignored:eco do envio #${ours.id}`);
        }
        // fromMe fora da fila = agente digitou direto no painel do Z-PRO
        const origin: "channel" | "agent" = m.fromMe ? "agent" : "channel";

        const aluno = !m.fromMe
            ? (await db.rpc("match_aluno_by_phone", { p_phone: m.number }).maybeSingle()).data
            : null;

        let lead = await findLeadByPhone(db, m.number);
        const leadExisted = !!lead;
        if (!lead && !m.fromMe && !(aluno && ch.purpose === "official")) {
            const { data: src } = await db.from("lead_sources").select("id").eq("name", VIVACONNECT_SOURCE).maybeSingle();
            const now = new Date().toISOString();
            const name = String(m.contactName ?? "").trim() || `Lead WhatsApp - ${m.number}`;
            const { data: created, error } = await db.from("leads").insert({
                nome_completo: name, telefone: m.number, stage_id: 1, source_id: src?.id ?? null,
                fonte_lead: `VivaConnect — ${ch.name}`, temperatura: "frio", contact_count: 1,
                data_entrada: now, stage_entry_date: now, valor_oportunidade: 0,
                vivaconnect_channel_id: ch.id, vivaconnect_ticket_id: m.ticketId, vivaconnect_contact_id: m.contactId,
                preferred_contact: "whatsapp",
            }).select("id, nome_completo, perfil, assigned_to_id, vivaconnect_channel_id, curso_interesse, stage_id").single();
            if (error) throw new Error(`criar lead: ${error.message}`);
            lead = created;
            await mirror(
                `UPDATE seq:leads SET val = math::max([val, ${created.id}]);\n` +
                `INSERT INTO leads [{ id:"${created.id}", nome_completo:${sv(name)}, telefone:${sv(m.number)}, ` +
                `stage_id:stages:⟨1⟩, fonte_lead:${sv(`VivaConnect — ${ch.name}`)}, temperatura:"frio", ` +
                `data_entrada:d${sv(now)}, valor_oportunidade:0 }] RETURN NONE;`,
            );
        }

        if (lead) {
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (!lead.vivaconnect_channel_id) patch.vivaconnect_channel_id = ch.id;
            if (m.ticketId) patch.vivaconnect_ticket_id = m.ticketId;
            if (m.contactId) patch.vivaconnect_contact_id = m.contactId;

            // ── reabertura: mesma regra do widechat-webhook (decisão do usuário 17/09) ──
            // cliente escreveu num lead Finalizado → volta pra Entrada sem agente; se a fala
            // anterior era de agente (conversa humana em andamento) → Em Contato, mantém o agente.
            let reopenNote: string | null = null;
            if (leadExisted && !m.fromMe && lead.stage_id) {
                const { data: st } = await db.from("stages").select("name").eq("id", lead.stage_id).maybeSingle();
                if (st?.name && /finaliz|encerr|conclu/i.test(st.name)) {
                    const { data: last } = await db.from("widechat_messages").select("origin")
                        .eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
                    const now = new Date().toISOString();
                    patch.stage_entry_date = now;
                    if (last?.origin === "agent") {
                        const { data: ec } = await db.from("stages").select("id").ilike("name", "%contato%")
                            .order("order", { ascending: true }).limit(1).maybeSingle();
                        patch.stage_id = ec?.id ?? 1;
                        reopenNote = "🔁 Reaberto para Em Contato (agente mantido) — cliente retomou a conversa pelo VivaConnect após o atendimento ter sido finalizado.";
                    } else {
                        patch.stage_id = 1;
                        patch.assigned_to_id = null;
                        reopenNote = "🔁 Reaberto para Entrada (sem agente atribuído) — cliente voltou a escrever pelo VivaConnect após o atendimento ter sido finalizado.";
                    }
                }
            }
            await db.from("leads").update(patch).eq("id", lead.id);
            if (reopenNote) {
                const now = String(patch.stage_entry_date);
                await db.from("lead_notes").insert({ lead_id: lead.id, note: reopenNote, created_at: now });
                await mirror(
                    `UPDATE leads SET stage_id = stages:⟨${patch.stage_id}⟩, stage_entry_date = d${sv(now)}` +
                    `${"assigned_to_id" in patch ? ", assigned_to_id = NONE" : ""} WHERE id = leads:⟨${lead.id}⟩;\n` +
                    `INSERT INTO lead_notes [{ lead_id: leads:⟨${lead.id}⟩, note: ${sv(reopenNote)}, created_at: d${sv(now)} }] RETURN NONE;`,
                );
            }

            await db.from("widechat_messages").insert({
                lead_id: lead.id, provider: "vivaconnect", channel_id: ch.id,
                session_id: m.ticketId, message_id: m.messageId,
                type: m.mediaType && m.mediaType !== "chat" && m.mediaType !== "conversation" ? m.mediaType : "text",
                message: m.body, media_url: m.mediaUrl, origin,
                sender_name: m.fromMe ? null : m.contactName, raw_data: payload, created_at: m.sentAt,
            });

            // agente humano falou (ou pegou o ticket no painel do Z-PRO) → IA sai de vez desse lead
            const { data: sess } = await db.from("ai_lead_sessions").select("status").eq("lead_id", lead.id).maybeSingle();
            if ((m.fromMe || m.agentUserId) && sess?.status !== "handed_off") {
                await db.from("ai_lead_sessions").upsert({
                    lead_id: lead.id, status: "handed_off", handoff_reason: m.fromMe ? "Agente respondeu pelo VivaConnect" : "Agente assumiu o ticket no VivaConnect",
                    handed_off_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                });
            }
        }

        if (m.fromMe) return await done(`stored:${origin}`, lead?.id ?? null);

        // ── canal oficial: aluno → link do portal ───────────────────────────
        if (ch.purpose === "official" && aluno) {
            if (!settings.student_reply_enabled) return await done("stored:aluno (resposta do portal desligada)", lead?.id ?? null);
            const since = new Date(Date.now() - 24 * 3600_000).toISOString();
            const number = toZproNumber(m.number)!;
            const { data: recent } = await db.from("vivaconnect_outbox").select("id")
                .eq("kind", "student_reply").eq("number", number).gte("created_at", since).limit(1).maybeSingle();
            if (recent) return await done("stored:aluno (portal já enviado nas últimas 24h)", lead?.id ?? null);
            await db.from("vivaconnect_outbox").insert({
                lead_id: lead?.id ?? null, channel_id: ch.id, kind: "student_reply", number,
                body: fillTemplate(settings.student_reply_template, { primeiro_nome: firstName(m.contactName ?? (aluno as any).aluno) || "tudo bem" }),
            });
            return await done("stored:aluno → link do portal enfileirado", lead?.id ?? null);
        }

        // ── canal com "IA responde" marcado: não-aluno → IA ─────────────────
        // (aluno no oficial já saiu acima com o link do portal; a trava de handoff
        //  e a chave geral da IA ficam no ai-agent)
        if (ch.ai_enabled && lead && lead.perfil !== "aluno" && !aluno && !m.agentUserId) {
            const outcome = await aiReply(db, lead.id, ch.id, m.number);
            return await done(`stored:${outcome}`, lead.id);
        }

        return await done("stored", lead?.id ?? null);
    } catch (e) {
        console.error("vivaconnect-webhook:", e);
        return await done(`error:${(e as Error).message}`.slice(0, 500));
    }
});

async function aiReply(db: any, leadId: number, channelId: number, number: string): Promise<string> {
    const { data: hist } = await db.from("widechat_messages").select("origin, message, created_at")
        .eq("lead_id", leadId).eq("provider", "vivaconnect").order("created_at", { ascending: false }).limit(20);
    const messages = (hist ?? []).reverse()
        .filter((h: any) => h.message)
        .map((h: any) => ({ role: h.origin === "channel" ? "user" : "assistant", content: h.message }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return "ia:sem fala do lead";

    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "reply", lead_id: leadId, messages }),
        signal: AbortSignal.timeout(90000),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return `ia:erro ${out?.error ?? r.status}`;
    if (out.skipped) return `ia:pulou (${out.reason})`;
    if (!out.reply) return "ia:resposta vazia";
    await db.from("vivaconnect_outbox").insert({
        lead_id: leadId, channel_id: channelId, kind: "ai_reply", number: toZproNumber(number) ?? number, body: out.reply,
    });
    // dispara o worker agora (senão a resposta só sai no próximo ciclo do cron, até 1 min)
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vivaconnect-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "process_outbox" }),
        signal: AbortSignal.timeout(30000),
    }).catch((e) => console.error("vivaconnect-webhook: process_outbox:", e.message));
    return out.handoff ? "ia:respondeu + handoff" : "ia:respondeu";
}
