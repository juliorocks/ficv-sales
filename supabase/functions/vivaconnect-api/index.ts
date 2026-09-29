// vivaconnect-api — envio pelo VivaConnect (Z-PRO) + worker da fila.
//
// actions:
//   discover       { api_ref, api_token }    (admin)   → com a URL de integração + token, lista os
//                                                        canais do Z-PRO e diz a qual canal essa API pertence
//   test_channel   { channel_id }            (admin)   → testa o token e atualiza nome/número/status do Z-PRO
//   send_test      { channel_id, number, body } (admin) → envio avulso de teste
//   chat_context   { lead_id }               (staff)   → pro chat do lead: integração ligada? canais? número fixo?
//   send           { lead_id, body?, media?, channel_id? } (staff) → mensagem do agente pelo CRM
//                    media = { url, type: images|sounds|videos|files, file_name }
//   message_status { lead_id, body? }        (staff)   → ack da mensagem nossa no Z-PRO (entregue/lida/missing)
//   media          { message_row_id }        (staff)   → busca no Z-PRO o link de uma mídia RECEBIDA
//   finish         { lead_id }               (staff)   → fecha o ticket no Z-PRO + lead → Finalizado
//   transfer       { lead_id, profile_id }   (staff)   → passa o lead pra outro agente do CRM
//   enqueue_first  { lead_id }               (staff)   → força a 1ª mensagem de um lead
//   process_outbox {}                        (service, cron 1/min)  → esvazia a fila
//   run_followups  {}                        (service, cron 15/min) → IA reengaja lead quieto após silêncio
//   run_lead_followups {}                    (service, cron 5/min)  → dispara follow-up AGENDADO por humano vencido
//
// Regras da fila:
//   - first_message (contato ativo, número Baileys): só dentro da janela de
//     horário, respeita intervalo mínimo por número e limite diário; sai pelo
//     canal gravado em leads.vivaconnect_channel_id no momento da criação do lead
//     (não muda durante a fila). DEPOIS que o lead responde, esse campo passa a
//     acompanhar o canal de CADA mensagem recebida (vivaconnect-webhook) — não fica
//     mais "preso" no primeiro canal (bug corrigido 29/09, ver comentário lá).
//   - student_reply / ai_reply / manual: resposta a quem falou com a gente —
//     sai na hora, sem janela nem limite.
//   - toda mensagem enviada é gravada em widechat_messages (provider
//     'vivaconnect'); o webhook ignora o eco.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isAdmin, isStaff, jsonRes } from "../_shared/ai.ts";
import { asList, fillTemplate, firstName, loadSettings, markHumanReplied, parseApiRef, toDiscovered, toZproNumber, zpro, zproErr } from "../_shared/vivaconnect.ts";
import { mirror, sv } from "../_shared/db.ts";
import { type HubMsg, loadDestinations, planejar } from "../_shared/hub.ts";

const CH_COLS = "id, name, purpose, kind, phone, api_id, api_token, active, daily_limit, zpro_whatsapp_id, last_sent_at, zpro_type, zpro_hybrid_mode, send_via_channel_id";

// Respostas automáticas (IA / Hub / portal / 1ª mensagem) nunca saem pela API OFICIAL paga
// da Meta: número WABA só envia automático com o Modo Híbrido ativo no Z-PRO (decisão 26/09).
const AUTO_KINDS = new Set(["ai_reply", "hub_ask", "hub_redirect", "hub_forward", "student_reply", "first_message"]);
function hybridBlock(ch: any, kind: string): string | null {
    if (!AUTO_KINDS.has(kind)) return null;
    const isWaba = ch.zpro_type ? /waba|official|cloud/i.test(ch.zpro_type) : ch.kind === "waba" || ch.kind === "hybrid";
    if (!isWaba) return null;
    const mode = String(ch.zpro_hybrid_mode ?? "");
    if (mode && !/^(disabled|false|off|0)$/i.test(mode)) return null;
    // número de outra empresa do grupo declarado Híbrido: não manda webhook pra cá, então o modo nunca é "visto"
    if (!mode && ch.purpose === "grupo" && ch.kind === "hybrid") return null;
    return mode
        ? "Número oficial com o Modo Híbrido DESLIGADO no Z-PRO — resposta automática bloqueada pra não gerar custo Meta. Ative o Híbrido no canal."
        : "Modo do número oficial ainda não confirmado pelo Z-PRO (chega na 1ª mensagem recebida) — resposta automática bloqueada até confirmar o Híbrido.";
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isStaff(caller)) return jsonRes({ error: "Não autorizado." }, 401);

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action;
        const settings = await loadSettings(db);
        const createdBy = caller?.kind === "user" ? caller.id : null;

        if (action === "discover") {
            if (!isAdmin(caller)) return jsonRes({ error: "Só admin." }, 403);
            const ref = parseApiRef(body.api_ref);
            const token = String(body.api_token ?? "").trim();
            if (!ref.apiId || !token) return jsonRes({ error: "Cole a URL de integração (ou o ID) e o token." }, 400);
            const baseUrl = ref.baseUrl ?? settings.base_url;
            const d = await discover(baseUrl, { api_id: ref.apiId, api_token: token });
            if (!d.ok) return jsonRes({ error: d.error, raw: d.raw }, 400);
            return jsonRes({ ...d, api_id: ref.apiId, base_url: baseUrl });
        }

        if (action === "test_channel" || action === "send_test") {
            if (!isAdmin(caller)) return jsonRes({ error: "Só admin." }, 403);
            const { data: ch } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", body.channel_id).maybeSingle();
            if (!ch) return jsonRes({ error: "Canal não encontrado." }, 404);

            if (action === "test_channel") {
                const d = await discover(settings.base_url, ch);
                await markChannel(db, ch.id, d.ok, d.ok ? null : d.error);
                if (!d.ok) return jsonRes({ ok: false, error: d.error });
                const bound = d.channels.find((c) => c.id === d.bound_channel_id);
                const patch: Record<string, unknown> = { zpro_info: d.raw, updated_at: new Date().toISOString() };
                if (bound) {
                    patch.zpro_whatsapp_id = bound.id;
                    if (bound.number) patch.phone = bound.number;
                }
                await db.from("vivaconnect_channels").update(patch).eq("id", ch.id);
                return jsonRes({ ok: true, channel: bound ?? null, status: bound?.status ?? null });
            }

            const number = toZproNumber(body.number);
            if (!number || !body.body) return jsonRes({ error: "number e body obrigatórios." }, 400);
            const { data: row, error } = await db.from("vivaconnect_outbox").insert({
                channel_id: ch.id, kind: "manual", number, body: String(body.body), created_by: createdBy,
            }).select("*").single();
            if (error) return jsonRes({ error: error.message }, 500);
            return jsonRes(await sendRow(db, settings, row, ch));
        }

        if (action === "chat_context") {
            const leadId = Number(body.lead_id);
            const { data: lead } = await db.from("leads").select("vivaconnect_channel_id, vivaconnect_ticket_id").eq("id", leadId).maybeSingle();
            // canais de OUTRAS empresas do grupo (purpose 'grupo') nunca aparecem no chat dos leads
            const { data: chans } = await db.from("vivaconnect_channels").select("id, name, kind, purpose, phone").eq("active", true).neq("purpose", "grupo").order("id");
            return jsonRes({
                enabled: !!settings.enabled,
                channels: chans ?? [],
                lead_channel_id: lead?.vivaconnect_channel_id ?? null,
                ticket_id: lead?.vivaconnect_ticket_id ?? null,
            });
        }

        if (action === "send") {
            if (!settings.enabled) return jsonRes({ error: "A integração VivaConnect está desligada (Gestão > VivaConnect)." }, 400);
            const leadId = Number(body.lead_id);
            const text = String(body.body ?? "").trim();
            const media = body.media && body.media.url ? body.media : null;
            if (!leadId || (!text && !media)) return jsonRes({ error: "lead_id e mensagem (ou anexo) obrigatórios." }, 400);
            if (media && !["images", "sounds", "videos", "files"].includes(media.type)) return jsonRes({ error: "Tipo de mídia inválido." }, 400);
            const { data: lead } = await db.from("leads").select("id, telefone, vivaconnect_channel_id").eq("id", leadId).maybeSingle();
            if (!lead) return jsonRes({ error: "Lead não encontrado." }, 404);
            const number = toZproNumber(lead.telefone);
            if (!number) return jsonRes({ error: "Lead sem telefone válido." }, 400);
            // lead já tem número fixo → sempre ele (a conversa do cliente está nesse número)
            const channelId = lead.vivaconnect_channel_id ?? (Number(body.channel_id) || null)
                ?? (await db.rpc("vivaconnect_pick_pool_channel")).data;
            if (!channelId) return jsonRes({ error: "Nenhum número do VivaConnect disponível (cadastre um canal ativo)." }, 400);
            const { data: ch } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", channelId).maybeSingle();
            if (!ch?.active) return jsonRes({ error: `Canal ${ch?.name ?? channelId} está desativado.` }, 400);
            // Gestão > VivaConnect > "Quem atende cada canal": sem nenhuma linha pro agente
            // = sem restrição; com pelo menos 1 canal marcado, só pode enviar por eles.
            // Espelha o filtro do Kanban (KanbanBoard.tsx) — aqui é a trava de verdade.
            if (!isAdmin(caller) && createdBy) {
                const { data: myChannels } = await db.from("vivaconnect_agent_channels").select("channel_id").eq("profile_id", createdBy);
                if (myChannels?.length && !myChannels.some((r: { channel_id: number }) => r.channel_id === ch.id)) {
                    return jsonRes({ error: `Você não está apto a enviar pelo canal "${ch.name}" (Gestão > VivaConnect).` }, 403);
                }
            }
            const senderName = createdBy
                ? ((await db.from("profiles").select("full_name").eq("id", createdBy).maybeSingle()).data?.full_name ?? null)
                : null;
            const { data: row, error } = await db.from("vivaconnect_outbox").insert({
                lead_id: leadId, channel_id: ch.id, kind: "manual", number, body: text, created_by: createdBy,
                sender_name: senderName,
                ...(media ? { media_url: String(media.url), media_type: media.type, file_name: media.file_name ?? null } : {}),
            }).select("*").single();
            if (error) return jsonRes({ error: error.message }, 500);
            const res = await sendRow(db, settings, row, ch);
            // agente respondeu de verdade pelo CRM → IA sai desse lead e sobe pra "Em Contato"
            if (res.ok && createdBy) await markHumanReplied(db, leadId, "Agente respondeu pelo CRM");
            return jsonRes(res, res.ok ? 200 : 502);
        }

        if (action === "message_status" || action === "media" || action === "finish") {
            let leadId = Number(body.lead_id) || null;
            let msgRow: any = null;
            if (action === "media") {
                msgRow = (await db.from("widechat_messages").select("id, lead_id, channel_id, session_id, message_id, media_url")
                    .eq("id", body.message_row_id).eq("provider", "vivaconnect").maybeSingle()).data;
                if (!msgRow) return jsonRes({ error: "Mensagem não encontrada." }, 404);
                if (msgRow.media_url) return jsonRes({ url: msgRow.media_url });
                leadId = msgRow.lead_id;
            }
            const { data: lead } = await db.from("leads").select("id, nome_completo, telefone, vivaconnect_channel_id, vivaconnect_ticket_id").eq("id", leadId).maybeSingle();
            if (!lead) return jsonRes({ error: "Lead não encontrado." }, 404);
            const chId = msgRow?.channel_id ?? lead.vivaconnect_channel_id;
            const { data: ch } = chId ? await db.from("vivaconnect_channels").select(CH_COLS).eq("id", chId).maybeSingle() : { data: null };
            if (!ch) return jsonRes({ error: "Lead sem número do VivaConnect." }, 400);
            const ticketId = msgRow?.session_id ?? await ticketFor(settings, ch, lead);

            if (action === "finish") {
                if (ticketId) {
                    const r = await zpro(settings.base_url, ch, "/updateticketinfo", { ticketId: Number(ticketId), status: "closed" });
                    if (!r.ok) return jsonRes({ error: zproErr(r.status, r.data) }, 502);
                }
                // mensagem de despedida (opcional, Gestão > VivaConnect) — sai igual um envio
                // manual: na hora, sem trava de janela/Meta (é a equipe finalizando de propósito).
                if (settings.farewell_message_enabled && String(settings.farewell_message_template ?? "").trim()) {
                    const number = toZproNumber(lead.telefone);
                    if (number) {
                        const nome = firstName(lead.nome_completo ?? "");
                        const body = fillTemplate(settings.farewell_message_template, { primeiro_nome: nome || "tudo bem", nome_virgula: nome ? `, ${nome}` : "" });
                        const { data: row } = await db.from("vivaconnect_outbox").insert({
                            lead_id: lead.id, channel_id: ch.id, kind: "farewell", number, body, created_by: createdBy,
                        }).select("*").single();
                        if (row) await sendRow(db, settings, row, ch);
                    }
                }
                const { data: fin } = await db.from("stages").select("id").or("name.ilike.%finaliz%,name.ilike.%encerr%").limit(1).maybeSingle();
                const now = new Date().toISOString();
                const who = createdBy ? (await db.from("profiles").select("full_name").eq("id", createdBy).maybeSingle()).data?.full_name : null;
                const note = `✅ Atendimento finalizado pelo painel${who ? ` (${who})` : ""}.`;
                if (fin) {
                    await db.from("leads").update({ stage_id: fin.id, stage_entry_date: now, updated_at: now }).eq("id", lead.id);
                    await db.from("lead_notes").insert({ lead_id: lead.id, note, created_at: now });
                    await mirror(`UPDATE leads SET stage_id = stages:⟨${fin.id}⟩, stage_entry_date = d${sv(now)} WHERE id = leads:⟨${lead.id}⟩;\n` +
                        `INSERT INTO lead_notes [{ lead_id: leads:⟨${lead.id}⟩, note: ${sv(note)}, created_at: d${sv(now)} }] RETURN NONE;`);
                }
                return jsonRes({ ok: true, ticket_closed: !!ticketId });
            }

            if (!ticketId) return jsonRes({ error: "Conversa ainda não tem ticket no Z-PRO." }, 404);
            const r = await zpro(settings.base_url, ch, "/showAllMessages", { ticket: Number(ticketId) });
            if (!r.ok) return jsonRes({ error: zproErr(r.status, r.data) }, 502);
            const list = asList(r.data);

            if (action === "media") {
                const hit = list.find((x: any) => x.messageId === msgRow.message_id || x.id === msgRow.message_id);
                const raw = hit?.mediaUrl ?? hit?.storageUrl ?? null;
                if (!raw) return jsonRes({ url: null, pending: true });
                const zUrl = /^https?:\/\//i.test(raw) ? raw : `${settings.base_url.replace(/\/$/, "")}/${String(raw).replace(/^\//, "")}`;
                // o /public do Z-PRO só serve com Referer do painel dele (sem isso: 403 "Access denied")
                // → baixa aqui e guarda cópia no nosso bucket público (link permanente pro chat)
                const referer = settings.base_url.replace("://api.", "://chat.").replace(/\/?$/, "/");
                const f = await fetch(zUrl, { headers: { Referer: referer }, signal: AbortSignal.timeout(30000) });
                if (!f.ok) return jsonRes({ error: `Z-PRO não liberou a mídia (HTTP ${f.status}).` }, 502);
                const mime = f.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
                const ext = (zUrl.split("?")[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? mime.split("/")[1] ?? "bin").toLowerCase();
                const path = `${msgRow.lead_id}/vc-${String(msgRow.message_id ?? msgRow.id).replace(/[^a-zA-Z0-9_-]/g, "")}.${ext}`;
                const { error: upErr } = await db.storage.from("widechat-attachments")
                    .upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: mime, upsert: true });
                if (upErr) return jsonRes({ error: `Falha ao guardar a mídia: ${upErr.message}` }, 500);
                const url = db.storage.from("widechat-attachments").getPublicUrl(path).data.publicUrl;
                await db.from("widechat_messages").update({ media_url: url }).eq("id", msgRow.id);
                return jsonRes({ url });
            }

            // message_status: última mensagem NOSSA no ticket (ack 0 pendente · 1 servidor · 2 entregue · 3 lida · <0 erro)
            // com `body` (o que o agente acabou de mandar): procura ESSA mensagem nos últimos 10 min —
            // o Z-PRO responde "sucesso" até quando a mídia falha depois; se não aparecer → missing.
            const expected = typeof body.body === "string" ? body.body.trim() : null;
            const since = new Date(Date.now() - 10 * 60_000).toISOString();
            const mine = list.filter((x: any) => x.fromMe && !String(x.body ?? "").startsWith("*System:*"))
                .filter((x: any) => expected == null || (String(x.body ?? "").trim() === expected && String(x.createdAt) >= since))
                .sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)));
            const last = mine[mine.length - 1];
            if (!last) return jsonRes({ last: expected != null ? { status: "missing" } : null });
            const ack = Number(last.ack ?? 0);
            return jsonRes({
                last: {
                    ack, body: last.body, created_at: last.createdAt, error: last.statusError ?? null,
                    status: ack < 0 || last.status === "error" ? "failed" : ack >= 3 ? "read" : ack === 2 ? "delivered" : ack === 1 ? "sent" : "pending",
                },
            });
        }

        if (action === "transfer") {
            const leadId = Number(body.lead_id);
            const { data: to } = await db.from("profiles").select("id, full_name").eq("id", body.profile_id).maybeSingle();
            if (!leadId || !to) return jsonRes({ error: "Lead ou agente inválido." }, 400);
            const now = new Date().toISOString();
            const who = createdBy ? (await db.from("profiles").select("full_name").eq("id", createdBy).maybeSingle()).data?.full_name : null;
            const note = `🔀 Conversa transferida para ${to.full_name}${who ? ` por ${who}` : ""}.`;
            const { error } = await db.from("leads").update({ assigned_to_id: to.id, updated_at: now }).eq("id", leadId);
            if (error) return jsonRes({ error: error.message }, 500);
            await db.from("lead_notes").insert({ lead_id: leadId, note, created_at: now });
            await mirror(`UPDATE leads SET assigned_to_id = ${sv(to.id)} WHERE id = leads:⟨${leadId}⟩;\n` +
                `INSERT INTO lead_notes [{ lead_id: leads:⟨${leadId}⟩, note: ${sv(note)}, created_at: d${sv(now)} }] RETURN NONE;`);
            return jsonRes({ ok: true, to: to.full_name });
        }

        if (action === "enqueue_first") {
            const leadId = Number(body.lead_id);
            const { data: lead } = await db.from("leads")
                .select("id, nome_completo, telefone, vivaconnect_channel_id, courses:curso_interesse(name)").eq("id", leadId).maybeSingle();
            if (!lead) return jsonRes({ error: "Lead não encontrado." }, 404);
            const number = toZproNumber(lead.telefone);
            if (!number) return jsonRes({ error: "Lead sem telefone válido." }, 400);
            const curso = (lead as any).courses?.name as string | undefined;
            const first = String(lead.nome_completo ?? "").trim().split(/\s+/)[0] ?? "";
            const msg = settings.first_message_template
                .replaceAll("{primeiro_nome}", first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "tudo bem")
                .replaceAll("{curso_trecho}", curso ? ` no curso de ${curso}` : "")
                .replaceAll("{curso}", curso ?? "");
            const { data: row, error } = await db.from("vivaconnect_outbox").insert({
                lead_id: leadId, channel_id: lead.vivaconnect_channel_id, kind: "first_message", number, body: msg, created_by: createdBy,
            }).select("id").single();
            if (error) return jsonRes({ error: error.code === "23505" ? "Esse lead já tem 1ª mensagem na fila/enviada." : error.message }, 400);
            return jsonRes({ ok: true, outbox_id: row.id });
        }

        // Simulador do Hub do Grupo: roda a triagem numa conversa de mentira, sem enviar nada
        //   { mensagens: ["oi", "quero ser membro"], nome?: "Maria" }
        if (action === "hub_simulate") {
            if (!isAdmin(caller)) return jsonRes({ error: "Só admin." }, 403);
            const falas: string[] = (body.mensagens ?? []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 8);
            if (!falas.length) return jsonRes({ error: "Escreva ao menos uma mensagem." }, 400);
            const dests = await loadDestinations(db);
            let sessao: any = null;
            const passos: any[] = [];
            for (const texto of falas) {
                if (sessao?.status === "faculdade") { passos.push({ fala: texto, acao: "faculdade", motivo: "já está no atendimento da Faculdade" }); continue; }
                const plano = await planejar(db, { settings, dests, sessao, texto, nome: body.nome ?? null });
                const now = new Date().toISOString();
                const msgs: HubMsg[] = [...(sessao?.messages ?? []), { de: "contato", texto, em: now }];
                if (plano.acao === "perguntar") { msgs.push({ de: "hub", texto: plano.texto, em: now }); sessao = { status: "perguntando", menus: (sessao?.menus ?? 0) + 1, destination_id: null, redirected_at: null, messages: msgs }; }
                else if (plano.acao === "encaminhar") { sessao = { status: "encaminhado", menus: sessao?.menus ?? 0, destination_id: plano.destino.id, redirected_at: now, messages: msgs }; }
                else if (plano.acao === "faculdade") { sessao = { ...(sessao ?? {}), status: "faculdade", messages: msgs }; }
                else sessao = { ...(sessao ?? { status: "perguntando", menus: 0, destination_id: null, redirected_at: null }), messages: msgs };
                passos.push({
                    fala: texto, acao: plano.acao, motivo: plano.motivo,
                    destino: "destino" in plano ? `${plano.destino.emoji} ${plano.destino.nome}` : null,
                    confianca: "confianca" in plano ? plano.confianca : null,
                    metodo: "metodo" in plano ? plano.metodo : null,
                    envia: plano.acao === "perguntar" ? plano.texto : plano.acao === "encaminhar" ? plano.redirect : null,
                    avisa_empresa: plano.acao === "encaminhar" ? plano.forward : null,
                });
            }
            return jsonRes({ passos, destinos_ativos: dests.map((d) => `${d.emoji} ${d.nome}`) });
        }

        if (action === "process_outbox") {
            if (caller?.kind !== "service") return jsonRes({ error: "Só o cron." }, 403);
            return jsonRes(await processOutbox(db, settings));
        }

        if (action === "run_followups") {
            if (caller?.kind !== "service") return jsonRes({ error: "Só o cron." }, 403);
            return jsonRes(await runFollowups(db, settings));
        }

        // Follow-up AGENDADO por um humano (checkbox "Enviar mensagem automaticamente",
        // Gestão > lembrete "Retornar em") — pedido do usuário 29/09. Diferente do
        // "run_followups" acima (reengajamento automático da IA por silêncio): aqui é uma
        // tarefa que o próprio atendente marcou, com nota. Só dispara pra lead do VivaConnect
        // (WideChat depende de credencial pessoal do agente logado — não dá pra automatizar
        // sem alguém logado, ver comentário em runLeadFollowups); WideChat só ganha um aviso.
        if (action === "run_lead_followups") {
            if (caller?.kind !== "service") return jsonRes({ error: "Só o cron." }, 403);
            return jsonRes(await runLeadFollowups(db, settings));
        }

        return jsonRes({ error: `Ação desconhecida: ${action}` }, 400);
    } catch (e) {
        console.error("vivaconnect-api:", e);
        return jsonRes({ error: (e as Error).message }, 500);
    }
});

async function markChannel(db: any, id: number, ok: boolean, err: string | null, sent = false) {
    const now = new Date().toISOString();
    await db.from("vivaconnect_channels").update({
        ...(ok ? { last_ok_at: now } : { last_error: err, last_error_at: now }),
        ...(sent ? { last_sent_at: now } : {}),
        updated_at: now,
    }).eq("id", id);
}

/** Envia UMA linha da fila (já com canal definido). Trava a linha com status 'sending'. */
async function sendRow(db: any, settings: any, row: any, ch: any) {
    // "Enviar automáticos por" (Gestão > VivaConnect): resposta AUTOMÁTICA de um canal com
    // send_via_channel_id configurado sai pela API do canal delegado (normalmente a Baileys
    // vinculada de verdade) — a gente decide o caminho, não confia na Coexistência do Z-PRO
    // escolher sozinha (28/09: não dava pra confirmar qual caminho ele usava). `ch` continua
    // sendo o canal "dono" pra tudo o mais (histórico, lead fixo, limites/contadores do pool);
    // só a chamada HTTP de envio usa `execCh`. Envio manual e HSM (só a oficial manda) não mudam.
    let execCh = ch;
    if (AUTO_KINDS.has(row.kind) && ch.send_via_channel_id) {
        const { data: via } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", ch.send_via_channel_id).maybeSingle();
        if (via?.active) execCh = via;
    }
    // a trava de custo Meta só faz sentido quando a chamada REALMENTE pode cair na API paga —
    // com canal delegado configurado, já sabemos que não vai (é a Baileys por baixo)
    const blocked = execCh.id === ch.id ? hybridBlock(ch, row.kind) : null;
    if (blocked) {
        await db.from("vivaconnect_outbox").update({ status: "failed", error: blocked }).eq("id", row.id).eq("status", "queued");
        await markChannel(db, ch.id, false, blocked);
        return { ok: false, error: blocked };
    }
    const { data: claimed } = await db.from("vivaconnect_outbox")
        .update({ status: "sending", channel_id: ch.id, attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id).eq("status", "queued").select("id").maybeSingle();
    if (!claimed) return { ok: false, error: "linha já processada por outro worker" };

    const base = { number: row.number, externalKey: row.external_key };
    // Mensagem com `sender_name` conhecido sai ASSINADA pro cliente — mesmo padrão que o
    // painel nativo do Z-PRO já usa sozinho quando alguém responde por lá ("*Administrador*:\n
    // texto"); só que com o nome de quem realmente "assina" essa mensagem (pedido do usuário
    // 29/09: no WhatsApp do cliente as respostas da equipe apareciam sem nome nenhum, só o
    // texto puro). Não trava em kind='manual': o follow-up agendado por um humano (kind=
    // 'ai_reply', pra respeitar hybridBlock/AUTO_KINDS igual qualquer envio automático) também
    // grava `sender_name` do atendente responsável e precisa sair assinado como se fosse ele
    // continuando a conversa, mesmo sendo a IA quem escreveu o texto. `sender_name` só é
    // gravado de propósito nesses casos — nunca por acidente. Só o texto que sai pro Z-PRO
    // leva a assinatura — o histórico interno (`widechat_messages.message` logo abaixo)
    // continua com `row.body` puro, porque a tela já mostra o nome separado.
    const signedBody = row.sender_name && row.body
        ? `*${row.sender_name}:*\n${row.body}`
        : row.body;
    const r = row.media_type === "sounds" && row.media_url
        ? await zpro(settings.base_url, execCh, "/voice", { ...base, audio: row.media_url })
        : row.media_url
            ? await zpro(settings.base_url, execCh, "/url", { ...base, mediaUrl: row.media_url, body: signedBody || row.file_name || "" })
            : await zpro(settings.base_url, execCh, "", { ...base, body: signedBody });
    const now = new Date().toISOString();
    if (!r.ok) {
        const err = zproErr(r.status, r.data);
        // número do CLIENTE sem WhatsApp/inválido (Z-PRO devolve 500 "reading 'jid'"): falha
        // do destino, não do canal — não tenta de novo nem pinta o número de vermelho
        const badRecipient = /jid|not.*(exist|registered|on whatsapp)|invalid.*number|n[úu]mero inv/i.test(err);
        // erro de rede/5xx: volta pra fila (até 3 tentativas); 4xx: falha definitiva
        const retry = !badRecipient && (r.status === 0 || r.status >= 500) && (row.attempts ?? 0) + 1 < 3;
        await db.from("vivaconnect_outbox").update({
            status: retry ? "queued" : "failed", error: err, response: r.data,
            scheduled_at: retry ? new Date(Date.now() + 5 * 60_000).toISOString() : row.scheduled_at,
        }).eq("id", row.id);
        if (!badRecipient) {
            await markChannel(db, ch.id, false, err);
            if (execCh.id !== ch.id) await markChannel(db, execCh.id, false, err); // saúde da conexão que de fato tentou enviar
        }
        return { ok: false, error: badRecipient ? `Esse número não tem WhatsApp ou é inválido (${row.number}).` : err, retry };
    }

    await db.from("vivaconnect_outbox").update({ status: "sent", sent_at: now, response: r.data, error: null }).eq("id", row.id);
    await markChannel(db, ch.id, true, null, true);
    if (execCh.id !== ch.id) await markChannel(db, execCh.id, true, null, false);
    if (row.lead_id) {
        const d = r.data ?? {};
        const ticketId = d.ticket?.id ?? d.ticketId ?? d.message?.ticketId ?? null;
        await db.from("widechat_messages").insert({
            lead_id: row.lead_id, provider: "vivaconnect", channel_id: ch.id,
            session_id: ticketId != null ? String(ticketId) : null,
            message_id: String(d.message?.id ?? d.messageId ?? d.id ?? row.external_key),
            type: row.media_type ?? "text", message: row.body, media_url: row.media_url ?? null,
            sender_name: row.sender_name ?? null,
            origin: row.kind === "manual" ? "agent" : "auto",
            raw_data: { outbox_id: row.id, kind: row.kind, response: d }, created_at: now,
        });
        // lead fica fixo no primeiro número que falou com ele
        await db.from("leads").update({ vivaconnect_channel_id: ch.id }).eq("id", row.lead_id).is("vivaconnect_channel_id", null);
        await db.from("leads").update({
            updated_at: now, ...(ticketId != null ? { vivaconnect_ticket_id: String(ticketId) } : {}),
        }).eq("id", row.lead_id);
    }
    return { ok: true, outbox_id: row.id, response: r.data };
}

/** Ticket ATUAL do lead no Z-PRO (showticket pelo número — ticket fechado vira outro);
 *  se o Z-PRO não achar, usa o último gravado. */
async function ticketFor(settings: any, ch: any, lead: any): Promise<string | null> {
    const number = toZproNumber(lead.telefone);
    if (number) {
        const r = await zpro(settings.base_url, ch, "/showticket", { number });
        const t = r.ok ? (Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data) : null;
        if (t?.id != null) return String(t.id);
    }
    return lead.vivaconnect_ticket_id ? String(lead.vivaconnect_ticket_id) : null;
}

/** listChannels + getAllSessionApis: canais do tenant e a qual canal essa API está ligada. */
async function discover(baseUrl: string, ch: { api_id: string; api_token: string }) {
    const [lc, apis] = await Promise.all([zpro(baseUrl, ch, "/listChannels"), zpro(baseUrl, ch, "/getAllSessionApis")]);
    const raw = { listChannels: lc.data, getAllSessionApis: apis.data, fetched_at: new Date().toISOString() };
    if (!lc.ok) {
        const msg = lc.status === 401 || lc.status === 403 ? "Token recusado pelo Z-PRO (confira se copiou o token completo)."
            : lc.status === 404 ? "API não encontrada — confira a URL de integração." : zproErr(lc.status, lc.data);
        return { ok: false as const, error: msg, raw, channels: [], bound_channel_id: null };
    }
    const channels = asList(lc.data).map(toDiscovered).filter((c) => c.id);
    const me = asList(apis.data).find((a: any) => String(a.id ?? a.apiId ?? a.uuid ?? "") === ch.api_id);
    let bound = me ? String(me.sessionId ?? me.whatsappId ?? me.channelId ?? "") || null : null;
    if (!bound && channels.length === 1) bound = channels[0].id;
    return { ok: true as const, error: null, raw, channels, bound_channel_id: bound };
}

function spHour(): number {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date()));
}

/** Follow-up automático (29/09, cron vivaconnect-ai-followups, a cada 15 min): lead que ficou
 *  quieto depois da IA falar algo recebe UMA mensagem de reengajamento, escrita na hora
 *  pelo ai-agent com base no histórico — não um texto fixo. Mesma janela de horário do
 *  outbox (nunca manda fora do expediente); candidatos vêm de ai_followup_candidates()
 *  (SQL — já filtra sessão ativa, silêncio mínimo, limite de tentativas). */
async function runFollowups(db: any, settings: any) {
    if (!settings.enabled) return { skipped: "integração desligada" };
    if (!settings.followup_enabled) return { skipped: "follow-up desligado" };
    const hour = spHour();
    if (!(hour >= settings.send_window_start && hour < settings.send_window_end)) return { skipped: "fora da janela de horário" };

    const { data: candidates, error: candErr } = await db.rpc("ai_followup_candidates", {
        p_after_hours: settings.followup_after_hours, p_max_count: settings.followup_max_count,
    });
    if (candErr) return { error: candErr.message };
    const out = { sent: 0, failed: 0, skipped: 0, details: [] as string[] };

    for (const c of candidates ?? []) {
        const number = toZproNumber(c.telefone);
        let chId: number | null = c.vivaconnect_channel_id;
        if (!chId) chId = (await db.rpc("vivaconnect_pick_pool_channel")).data ?? null;
        if (!number || !chId) { out.skipped++; out.details.push(`lead #${c.lead_id}: sem número/canal`); continue; }
        const { data: ch } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", chId).maybeSingle();
        if (!ch?.active) { out.skipped++; out.details.push(`lead #${c.lead_id}: canal inativo`); continue; }

        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ action: "followup", lead_id: c.lead_id }),
            signal: AbortSignal.timeout(30000),
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok || res.skipped || !res.reply) { out.skipped++; out.details.push(`lead #${c.lead_id}: ${res.reason ?? res.error ?? "sem resposta"}`); continue; }

        const { data: row } = await db.from("vivaconnect_outbox").insert({
            lead_id: c.lead_id, channel_id: ch.id, kind: "ai_reply", number, body: res.reply,
        }).select("*").single();
        const sendRes = row ? await sendRow(db, settings, row, ch) : { ok: false, error: "falha ao enfileirar" };
        const now = new Date().toISOString();
        await db.from("ai_lead_sessions").update({ followup_count: c.followup_count + 1, last_followup_at: now, updated_at: now }).eq("lead_id", c.lead_id);
        if (sendRes.ok) { out.sent++; } else { out.failed++; out.details.push(`lead #${c.lead_id}: ${sendRes.error}`); }
    }
    return out;
}

/** Follow-up AGENDADO por um humano ("Retornar em", checkbox "Enviar mensagem
 * automaticamente") — pedido do usuário 29/09. A Vivi escreve a retomada com base na nota
 * do atendente (ação "scheduled_followup" do ai-agent) e o texto sai ASSINADO com o nome do
 * responsável (sendRow assina qualquer envio com `sender_name`, não só kind='manual') —
 * pro cliente parecer que é o próprio atendente continuando a conversa, não um robô.
 * kind='ai_reply' de propósito (não 'manual'): respeita hybridBlock/AUTO_KINDS e a
 * delegação "Enviar automáticos por" igual qualquer outro envio automático — isto é um
 * disparo do CRON, não um humano de verdade clicando enviar, mesmo saindo assinado como um. */
async function runLeadFollowups(db: any, settings: any) {
    const { data: dues, error } = await db.from("lead_followups")
        .select("id, lead_id, note, assigned_to, assignee:profiles!lead_followups_assigned_to_fkey(full_name)")
        .eq("status", "pending").eq("auto_send", true).not("lead_id", "is", null)
        .lte("due_at", new Date().toISOString()).limit(20);
    if (error) return { error: error.message };
    const out = { sent: 0, skipped: 0, failed: 0, details: [] as string[] };
    const now = () => new Date().toISOString();

    for (const f of dues ?? []) {
        const { data: lead } = await db.from("leads").select("id, telefone, vivaconnect_channel_id").eq("id", f.lead_id).maybeSingle();
        if (!lead) { out.skipped++; continue; }
        // WideChat depende de login PESSOAL do agente que está mandando (widechat-api resolve
        // a credencial pelo `who.id` de quem chamou) — um cron sem ninguém logado não tem como
        // autenticar como o responsável. Só avisa no lead, não marca como enviado, deixa
        // pendente pro humano mandar na mão (não silencia o follow-up).
        if (!lead.vivaconnect_channel_id) {
            await db.from("lead_notes").insert({
                lead_id: f.lead_id, created_at: now(),
                note: `⏰ Follow-up venceu${f.note ? ` ("${f.note}")` : ""}, mas este lead é do WideChat — envio automático ainda não dá aqui (depende do login do atendente). Responda manualmente, por favor.`,
            });
            out.skipped++; out.details.push(`followup #${f.id}: lead WideChat, avisado`);
            continue;
        }
        const number = toZproNumber(lead.telefone);
        if (!number) { out.skipped++; out.details.push(`followup #${f.id}: lead sem telefone válido`); continue; }
        const { data: ch } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", lead.vivaconnect_channel_id).maybeSingle();
        if (!ch?.active) { out.skipped++; out.details.push(`followup #${f.id}: canal inativo`); continue; }

        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ action: "scheduled_followup", lead_id: f.lead_id, note: f.note }),
            signal: AbortSignal.timeout(30000),
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok || !res.reply) { out.failed++; out.details.push(`followup #${f.id}: ${res.error ?? res.reason ?? "sem resposta"}`); continue; }

        const senderName = (f.assignee as any)?.full_name ?? null;
        const { data: row } = await db.from("vivaconnect_outbox").insert({
            lead_id: f.lead_id, channel_id: ch.id, kind: "ai_reply", number, body: res.reply,
            sender_name: senderName, created_by: f.assigned_to ?? null,
        }).select("*").single();
        const sendRes = row ? await sendRow(db, settings, row, ch) : { ok: false, error: "falha ao enfileirar" };
        if (sendRes.ok) {
            const ts = now();
            await db.from("lead_followups").update({ status: "done", completed_at: ts, auto_sent_at: ts }).eq("id", f.id);
            await db.from("lead_notes").insert({
                lead_id: f.lead_id, created_at: ts,
                note: `🔔 Follow-up automático enviado${senderName ? ` (assinado como ${senderName})` : ""}: "${res.reply}"`,
            });
            out.sent++;
        } else {
            out.failed++; out.details.push(`followup #${f.id}: ${sendRes.error}`);
        }
    }
    return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function processOutbox(db: any, settings: any) {
    if (!settings.enabled) return { skipped: "integração desligada" };
    const inWindow = (() => { const h = spHour(); return h >= settings.send_window_start && h < settings.send_window_end; })();

    const { data: rows } = await db.from("vivaconnect_outbox").select("*")
        .eq("status", "queued").lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at").limit(30);
    const { data: chans } = await db.from("vivaconnect_channels").select(CH_COLS).eq("active", true);
    const byId = new Map<number, any>((chans ?? []).map((c: any) => [c.id, c]));
    const usedThisRun = new Set<number>(); // no máximo 1 first_message por número por execução
    const out = { sent: 0, failed: 0, waiting: 0, details: [] as string[] };

    // pausa curta entre bolhas da MESMA resposta (mesmo lead, mesma leva de ai_reply) — sem
    // isso saíam quase simultâneas, parecendo disparo de robô em vez de alguém digitando
    // (29/09, pedido do usuário: "sistema realmente inteligente"). Só entre mensagens
    // CONSECUTIVAS do mesmo lead — não atrasa leads diferentes na mesma leva do cron.
    let prevReplyLeadId: number | null = null;

    for (const row of rows ?? []) {
        if (row.kind === "ai_reply" && row.lead_id && row.lead_id === prevReplyLeadId) await sleep(1500);
        prevReplyLeadId = row.kind === "ai_reply" ? row.lead_id : null;

        const automatic = row.kind === "first_message";
        if (automatic && (!settings.first_message_enabled || !inWindow)) { out.waiting++; continue; }

        let chId: number | null = row.channel_id;
        if (!chId && automatic) chId = (await db.rpc("vivaconnect_pick_pool_channel")).data ?? null;
        const ch = chId ? byId.get(chId) : null;
        if (!ch) { out.waiting++; out.details.push(`#${row.id}: sem número disponível`); continue; }

        if (automatic) {
            if (usedThisRun.has(ch.id)) { out.waiting++; continue; }
            const last = ch.last_sent_at ? new Date(ch.last_sent_at).getTime() : 0;
            if (Date.now() - last < settings.min_interval_seconds * 1000) { out.waiting++; continue; }
            const { data: h } = await db.from("vivaconnect_channel_health").select("first_sent_today, daily_limit").eq("id", ch.id).single();
            if (h && h.first_sent_today >= h.daily_limit) { out.waiting++; out.details.push(`#${row.id}: ${ch.name} no limite diário`); continue; }
            usedThisRun.add(ch.id);
        }

        const res = await sendRow(db, settings, row, ch);
        if (res.ok) { out.sent++; ch.last_sent_at = new Date().toISOString(); }
        else { out.failed++; out.details.push(`#${row.id}: ${res.error}`); }
    }
    return out;
}
