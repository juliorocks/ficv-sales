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
// 4. Canal com "Hub do Grupo" (vivaconnect_channels.hub_enabled — o número antigo do Grupo
//    Cidade Viva): contato NOVO (sem lead, não-aluno) passa antes pela triagem (_shared/hub.ts):
//    Faculdade segue o fluxo acima; outra empresa recebe o número novo; sem assunto → menu.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { mirror, sv } from "../_shared/db.ts";
import { fillTemplate, findLeadByPhone, firstName, loadSettings, parseWebhook, toZproNumber, zpro, zproErr } from "../_shared/vivaconnect.ts";
import { type HubMsg, loadDestinations, planejar } from "../_shared/hub.ts";

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
        ? await db.from("vivaconnect_channels").select("id, name, purpose, zpro_whatsapp_id, ai_enabled, hub_enabled, zpro_type, zpro_hybrid_mode").eq("id", reqChannel).maybeSingle()
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
        // número de OUTRA empresa do grupo (só usado pelo Hub pra avisar): nunca vira lead da Faculdade
        if (ch.purpose === "grupo") return await done("ignored:canal de outra empresa do grupo");

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

        // modo do número no Z-PRO (waba/baileys + Híbrido) — base da trava de custo Meta no envio.
        // 28/09: payload de ticket WABA nunca manda `hybridMode` (só canal Baileys manda) — "campo
        // ausente" NÃO é "híbrido desligado". Sem essa distinção, toda mensagem recebida reescrevia
        // zpro_hybrid_mode pra null e apagava até a confirmação MANUAL feita em Gestão > VivaConnect
        // (confirmado ao vivo: usuário confirmava, próxima msg zerava de novo, resposta falhava).
        const zw = payload?.ticket?.whatsapp;
        if (zw && (zw.type != null || "hybridMode" in zw)) {
            const zType = zw.type != null ? String(zw.type) : null;
            const patch: Record<string, unknown> = {};
            if (zType !== (ch as any).zpro_type) patch.zpro_type = zType;
            if ("hybridMode" in zw) {
                const zHyb = zw.hybridMode != null ? String(zw.hybridMode) : null;
                if (zHyb !== (ch as any).zpro_hybrid_mode) patch.zpro_hybrid_mode = zHyb;
            }
            if (Object.keys(patch).length) {
                await db.from("vivaconnect_channels").update({ ...patch, zpro_mode_seen_at: new Date().toISOString() }).eq("id", ch.id);
            }
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

        // ── Hub do Grupo: contato novo no número antigo do grupo → triagem ──────
        let hubBacklog: HubMsg[] = [];
        let hubRoutingId: number | null = null;
        if (ch.hub_enabled && !m.fromMe && !aluno && !lead && !m.agentUserId) {
            const r = await hubRouteLocked(db, settings, ch, m, log?.id ?? 0);
            if (r.handled) return await done(r.outcome);
            hubBacklog = r.backlog;
            hubRoutingId = r.routingId;
        }
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

            // veio do hub (menu, etc.): leva a conversa da triagem pro chat do lead (contexto da IA/agente)
            if (hubBacklog.length) {
                await db.from("widechat_messages").insert(hubBacklog.map((h) => ({
                    lead_id: lead!.id, provider: "vivaconnect", channel_id: ch.id, session_id: m.ticketId,
                    type: "text", message: h.texto, origin: h.de === "contato" ? "channel" : "auto",
                    sender_name: h.de === "contato" ? m.contactName : null, raw_data: { hub: true }, created_at: h.em,
                })));
            }
            if (hubRoutingId) await db.from("vivaconnect_hub_routings").update({ lead_id: lead.id }).eq("id", hubRoutingId);

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

        // aluno = matrícula ativa no Sponte OU o NOSSO lead já diz que é aluno (perfil/etapa
        // Matriculado). Só o Sponte não basta: o telefone de lá costuma ser outro (caso real
        // 25/09: aluna em Matriculado escreveu no número da secretaria e o Sponte não casou).
        let isStudent = !!aluno || lead?.perfil === "aluno";
        if (!isStudent && lead?.stage_id) {
            const { data: st } = await db.from("stages").select("name").eq("id", lead.stage_id).maybeSingle();
            isStudent = /matricul/i.test(st?.name ?? "");
        }

        // ── canal oficial: aluno → link do portal ───────────────────────────
        if (ch.purpose === "official" && isStudent) {
            if (!settings.student_reply_enabled) return await done("stored:aluno (resposta do portal desligada)", lead?.id ?? null);
            const since = new Date(Date.now() - 24 * 3600_000).toISOString();
            const number = toZproNumber(m.number)!;
            const { data: recent } = await db.from("vivaconnect_outbox").select("id")
                .eq("kind", "student_reply").eq("number", number).gte("created_at", since).limit(1).maybeSingle();
            if (recent) return await done("stored:aluno (portal já enviado nas últimas 24h)", lead?.id ?? null);
            await db.from("vivaconnect_outbox").insert({
                lead_id: lead?.id ?? null, channel_id: ch.id, kind: "student_reply", number,
                body: fillTemplate(settings.student_reply_template, { primeiro_nome: firstName(m.contactName ?? (aluno as any)?.aluno) || "tudo bem" }),
            });
            return await done("stored:aluno → link do portal enfileirado", lead?.id ?? null);
        }

        // ── canal com "IA responde" marcado: não-aluno → IA ─────────────────
        // (aluno no oficial já saiu acima com o link do portal; a trava de handoff
        //  e a chave geral da IA ficam no ai-agent)
        if (ch.ai_enabled && lead && !isStudent && !m.agentUserId) {
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
    await kickOutbox();
    return out.handoff ? "ia:respondeu + handoff" : "ia:respondeu";
}

/** Dispara o worker da fila agora (senão só sai no próximo ciclo do cron, até 1 min). */
async function kickOutbox() {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vivaconnect-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "process_outbox" }),
        signal: AbortSignal.timeout(30000),
    }).catch((e) => console.error("vivaconnect-webhook: process_outbox:", e.message));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HUB_DEBOUNCE_MS = 4000;

/**
 * Um contato por vez + espera curta: se chegar outra mensagem do mesmo número enquanto
 * isso ("Oi" … "quero ser membro"), esta só entra no histórico e a MAIS NOVA decide por todas.
 */
async function hubRouteLocked(db: any, settings: any, ch: any, m: any, logId: number) {
    const number = toZproNumber(m.number) ?? m.number;
    const t0 = Date.now();
    while (!(await db.rpc("hub_try_lock", { p_number: number })).data) {
        if (Date.now() - t0 > 25000) break; // trava presa: segue sem ela
        await sleep(700);
    }
    try {
        await sleep(HUB_DEBOUNCE_MS);
        const sufixo = number.slice(-8);
        const { data: newer } = await db.from("vivaconnect_webhook_logs").select("id, payload")
            .eq("channel_id", ch.id).gt("id", logId).limit(20);
        const chegouOutra = (newer ?? []).some((l: any) => {
            const p = parseWebhook(l.payload);
            return p && !p.fromMe && String(p.number ?? "").endsWith(sufixo);
        });
        return await hubRoute(db, settings, ch, m, chegouOutra);
    } finally {
        await db.from("vivaconnect_hub_locks").delete().eq("number", number);
    }
}

/**
 * Triagem do Hub do Grupo. handled=true → o hub respondeu (menu/encaminhou/ignorou) e o
 * webhook para aqui (não vira lead). handled=false → é da Faculdade: segue o fluxo normal
 * levando as falas anteriores da triagem (backlog) pro chat do lead.
 */
async function hubRoute(db: any, settings: any, ch: any, m: any, soAcumular = false): Promise<{ handled: boolean; outcome: string; backlog: HubMsg[]; routingId: number | null }> {
    const number = toZproNumber(m.number) ?? m.number;
    const now = new Date().toISOString();
    const texto = String(m.body ?? "").trim() || "[mídia]";
    const { data: sessao } = await db.from("vivaconnect_hub_routings").select("*")
        .eq("number", number).gte("updated_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (sessao?.status === "faculdade") return { handled: false, outcome: "", backlog: [], routingId: sessao.id };

    const falaEm = m.sentAt ?? now;
    const msgs: HubMsg[] = [...(sessao?.messages ?? []), { de: "contato", texto, em: falaEm }];
    // resposta do hub sempre DEPOIS da fala (ordem certa no chat, mesmo com relógio do WhatsApp adiantado)
    const hubEm = new Date(Math.max(Date.now(), Date.parse(falaEm) + 1000 || 0)).toISOString();
    const dests = await loadDestinations(db);
    const save = async (patch: Record<string, unknown>) => {
        const row = { channel_id: ch.id, number, contact_name: m.contactName ?? sessao?.contact_name ?? null, messages: msgs, updated_at: now, ...patch };
        if (sessao) { await db.from("vivaconnect_hub_routings").update(row).eq("id", sessao.id); return sessao.id as number; }
        const { data } = await db.from("vivaconnect_hub_routings").insert(row).select("id").single();
        return (data?.id ?? null) as number | null;
    };
    // chegou outra mensagem logo depois: guarda esta no histórico e deixa a próxima decidir
    if (soAcumular) {
        await save(sessao ? {} : { status: "perguntando" });
        return { handled: true, outcome: "hub:aguardando próxima mensagem do contato", backlog: [], routingId: null };
    }
    const plano = await planejar(db, { settings, dests, sessao, texto, nome: m.contactName });
    const enqueue = (channelId: number, kind: string, body: string) =>
        db.from("vivaconnect_outbox").insert({ lead_id: null, channel_id: channelId, kind, number, body });

    if (plano.acao === "faculdade") {
        const id = await save({ status: "faculdade", destination_id: plano.destino.id, metodo: plano.metodo, confianca: plano.confianca, motivo: plano.motivo });
        return { handled: false, outcome: "", backlog: msgs.slice(0, -1), routingId: id };
    }
    if (plano.acao === "encaminhar") {
        await enqueue(ch.id, "hub_redirect", plano.redirect);
        msgs.push({ de: "hub", texto: plano.redirect, em: hubEm });
        if (plano.forward && plano.destino.channel_id) await enqueue(plano.destino.channel_id, "hub_forward", plano.forward);
        await save({ status: "encaminhado", destination_id: plano.destino.id, metodo: plano.metodo, confianca: plano.confianca, motivo: plano.motivo, redirected_at: now });
        await kickOutbox();
        return { handled: true, outcome: `hub:encaminhado → ${plano.destino.nome}${plano.forward ? " (+ canal da empresa avisado)" : ""}`, backlog: [], routingId: null };
    }
    if (plano.acao === "menu") {
        await enqueue(ch.id, "hub_menu", plano.texto);
        msgs.push({ de: "hub", texto: plano.texto, em: hubEm });
        await save({ status: "perguntando", menus: (sessao?.menus ?? 0) + 1, motivo: plano.motivo });
        await kickOutbox();
        return { handled: true, outcome: "hub:menu enviado", backlog: [], routingId: null };
    }
    await save({});
    return { handled: true, outcome: `hub:ignorado (${plano.motivo})`, backlog: [], routingId: null };
}

