// vivaconnect-api — envio pelo VivaConnect (Z-PRO) + worker da fila.
//
// actions:
//   test_channel   { channel_id }            (admin)   → checa token/API no Z-PRO
//   send_test      { channel_id, number, body } (admin) → envio avulso de teste
//   send           { lead_id, body }         (staff)   → mensagem do agente pelo CRM (fila + envio imediato)
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
import { loadSettings, toZproNumber, zpro, zproErr } from "../_shared/vivaconnect.ts";

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

        if (action === "test_channel" || action === "send_test") {
            if (!isAdmin(caller)) return jsonRes({ error: "Só admin." }, 403);
            const { data: ch } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", body.channel_id).maybeSingle();
            if (!ch) return jsonRes({ error: "Canal não encontrado." }, 404);

            if (action === "test_channel") {
                // showChannel pede o número do canal; sem número, qualquer resposta ≠ 401 já prova token válido
                const r = await zpro(settings.base_url, ch, "/showChannel", { number: ch.phone ?? "" });
                const authOk = r.status !== 401 && r.status !== 403 && r.status !== 0;
                await markChannel(db, ch.id, r.ok, r.ok ? null : zproErr(r.status, r.data));
                if (r.ok) {
                    const wid = r.data?.id ?? r.data?.whatsapp?.id ?? r.data?.channel?.id;
                    if (wid && !ch.zpro_whatsapp_id) await db.from("vivaconnect_channels").update({ zpro_whatsapp_id: String(wid) }).eq("id", ch.id);
                }
                return jsonRes({ ok: r.ok, auth_ok: authOk, status: r.status, data: r.data });
            }

            const number = toZproNumber(body.number);
            if (!number || !body.body) return jsonRes({ error: "number e body obrigatórios." }, 400);
            const { data: row, error } = await db.from("vivaconnect_outbox").insert({
                channel_id: ch.id, kind: "manual", number, body: String(body.body), created_by: createdBy,
            }).select("*").single();
            if (error) return jsonRes({ error: error.message }, 500);
            return jsonRes(await sendRow(db, settings, row, ch));
        }

        if (action === "send") {
            const leadId = Number(body.lead_id);
            const text = String(body.body ?? "").trim();
            if (!leadId || !text) return jsonRes({ error: "lead_id e body obrigatórios." }, 400);
            const { data: lead } = await db.from("leads").select("id, telefone, vivaconnect_channel_id").eq("id", leadId).maybeSingle();
            if (!lead) return jsonRes({ error: "Lead não encontrado." }, 404);
            const number = toZproNumber(lead.telefone);
            if (!number) return jsonRes({ error: "Lead sem telefone válido." }, 400);
            const channelId = lead.vivaconnect_channel_id ?? (await db.rpc("vivaconnect_pick_pool_channel")).data;
            if (!channelId) return jsonRes({ error: "Nenhum número do VivaConnect disponível (cadastre um canal ativo)." }, 400);
            const { data: ch } = await db.from("vivaconnect_channels").select(CH_COLS).eq("id", channelId).maybeSingle();
            if (!ch?.active) return jsonRes({ error: `Canal ${ch?.name ?? channelId} está desativado.` }, 400);
            const { data: row, error } = await db.from("vivaconnect_outbox").insert({
                lead_id: leadId, channel_id: ch.id, kind: "manual", number, body: text, created_by: createdBy,
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

    const r = await zpro(settings.base_url, ch, "", { body: row.body, number: row.number, externalKey: row.external_key });
    const now = new Date().toISOString();
    if (!r.ok) {
        const err = zproErr(r.status, r.data);
        // erro de rede/5xx: volta pra fila (até 3 tentativas); 4xx: falha definitiva
        const retry = (r.status === 0 || r.status >= 500) && (row.attempts ?? 0) + 1 < 3;
        await db.from("vivaconnect_outbox").update({
            status: retry ? "queued" : "failed", error: err, response: r.data,
            scheduled_at: retry ? new Date(Date.now() + 5 * 60_000).toISOString() : row.scheduled_at,
        }).eq("id", row.id);
        await markChannel(db, ch.id, false, err);
        return { ok: false, error: err, retry };
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
            type: "text", message: row.body,
            origin: row.kind === "manual" ? "agent" : "auto",
            raw_data: { outbox_id: row.id, kind: row.kind, response: d },
        });
        // lead fica fixo no primeiro número que falou com ele
        await db.from("leads").update({ vivaconnect_channel_id: ch.id }).eq("id", row.lead_id).is("vivaconnect_channel_id", null);
        await db.from("leads").update({
            updated_at: now, ...(ticketId != null ? { vivaconnect_ticket_id: String(ticketId) } : {}),
        }).eq("id", row.lead_id);
    }
    return { ok: true, outbox_id: row.id, response: r.data };
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
