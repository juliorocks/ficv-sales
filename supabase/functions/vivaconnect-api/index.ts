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
//   process_outbox {}                        (service, cron 1/min) → esvazia a fila
//
// Regras da fila:
//   - first_message (contato ativo, número Baileys): só dentro da janela de
//     horário, respeita intervalo mínimo por número e limite diário; o lead fica
//     FIXO no número que mandou a 1ª mensagem (leads.vivaconnect_channel_id).
//   - student_reply / ai_reply / manual: resposta a quem falou com a gente —
//     sai na hora, sem janela nem limite.
//   - toda mensagem enviada é gravada em widechat_messages (provider
//     'vivaconnect'); o webhook ignora o eco.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isAdmin, isStaff, jsonRes } from "../_shared/ai.ts";
import { asList, loadSettings, parseApiRef, toDiscovered, toZproNumber, zpro, zproErr } from "../_shared/vivaconnect.ts";
import { mirror, sv } from "../_shared/db.ts";

const CH_COLS = "id, name, purpose, kind, phone, api_id, api_token, active, daily_limit, zpro_whatsapp_id, last_sent_at";

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
            const { data: chans } = await db.from("vivaconnect_channels").select("id, name, kind, purpose, phone").eq("active", true).order("id");
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
            // agente humano falou pelo CRM → IA sai desse lead
            if (res.ok && createdBy) {
                await db.from("ai_lead_sessions").upsert({
                    lead_id: leadId, status: "handed_off", handoff_reason: "Agente respondeu pelo CRM",
                    handed_off_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                });
            }
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
            const { data: lead } = await db.from("leads").select("id, telefone, vivaconnect_channel_id, vivaconnect_ticket_id").eq("id", leadId).maybeSingle();
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

        if (action === "process_outbox") {
            if (caller?.kind !== "service") return jsonRes({ error: "Só o cron." }, 403);
            return jsonRes(await processOutbox(db, settings));
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
    const { data: claimed } = await db.from("vivaconnect_outbox")
        .update({ status: "sending", channel_id: ch.id, attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id).eq("status", "queued").select("id").maybeSingle();
    if (!claimed) return { ok: false, error: "linha já processada por outro worker" };

    const base = { number: row.number, externalKey: row.external_key };
    const r = row.media_type === "sounds" && row.media_url
        ? await zpro(settings.base_url, ch, "/voice", { ...base, audio: row.media_url })
        : row.media_url
            ? await zpro(settings.base_url, ch, "/url", { ...base, mediaUrl: row.media_url, body: row.body || row.file_name || "" })
            : await zpro(settings.base_url, ch, "", { ...base, body: row.body });
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
        if (!badRecipient) await markChannel(db, ch.id, false, err);
        return { ok: false, error: badRecipient ? `Esse número não tem WhatsApp ou é inválido (${row.number}).` : err, retry };
    }

    await db.from("vivaconnect_outbox").update({ status: "sent", sent_at: now, response: r.data, error: null }).eq("id", row.id);
    await markChannel(db, ch.id, true, null, true);
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

    for (const row of rows ?? []) {
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
