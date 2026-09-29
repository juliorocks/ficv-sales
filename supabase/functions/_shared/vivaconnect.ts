// Helpers do VivaConnect (Z-PRO self-hosted). A API é POR CANAL: cada número
// tem seu {apiId} + Bearer token (vivaconnect_channels). Doc:
// ajuda.zdg.com.br/central-do-assinante/referencia-da-api (versões .md).
import { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";

export type Channel = {
    id: number; name: string; purpose: "official" | "pool"; kind: string;
    phone: string | null; api_id: string; api_token: string; active: boolean; daily_limit: number;
};

// ── Etapa "IA Atendendo" (28/09, ajustado 29/09) ────────────────────────────
// Entrada (1) → IA Atendendo (1ª resposta de verdade da IA) → de volta pra Entrada quando a IA
// para de atender sem ninguém ter respondido ainda (handoff da própria IA, ou agente só ASSUMIU
// o ticket sem falar nada) — fica na fila normal, com o botão Atender. "Em Contato" é reservado
// pra quando um agente de verdade MANDA uma mensagem (pedido explícito do usuário 29/09: "Em
// Contato é somente quando um agente nosso já respondeu alguma coisa"). Matriculado/Perdido/
// Finalizado nunca são tocados por essas funções.

/** Sai da etapa "IA Atendendo" (se estiver nela) → volta pra "Entrada" (fila de humano, com o
 *  botão Atender). Não mexe em nenhuma outra etapa. */
export async function moveToEntradaFromAiAttending(db: SupabaseClient, leadId: number) {
    const { data: lead } = await db.from("leads").select("stage_id").eq("id", leadId).maybeSingle();
    if (!lead?.stage_id || lead.stage_id === 1) return;
    const { data: st } = await db.from("stages").select("name").eq("id", lead.stage_id).maybeSingle();
    if (!st?.name || !/ia atend/i.test(st.name)) return;
    await db.from("leads").update({ stage_id: 1, stage_entry_date: new Date().toISOString() }).eq("id", leadId);
}

/** Agente ASSUMIU o ticket no Z-PRO (ainda não respondeu nada) → a IA já não deve mais responder,
 *  mas o lead continua esperando alguém falar de verdade: sai de "IA Atendendo" de volta pra
 *  Entrada, não "Em Contato". Idempotente. */
export async function markAiHandedOff(db: SupabaseClient, leadId: number, reason: string) {
    const { data: sess } = await db.from("ai_lead_sessions").select("status").eq("lead_id", leadId).maybeSingle();
    if (sess?.status === "handed_off") return;
    await db.from("ai_lead_sessions").upsert({
        lead_id: leadId, status: "handed_off", handoff_reason: reason,
        handed_off_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await moveToEntradaFromAiAttending(db, leadId);
}

/** Agente respondeu DE VERDADE (mensagem enviada por nós, pelo VivaConnect ou pelo CRM) → a IA
 *  sai desse lead E, se estava em Entrada ou "IA Atendendo", sobe pra "Em Contato" — só aqui, que
 *  é onde de fato existe conversa humana em andamento. */
export async function markHumanReplied(db: SupabaseClient, leadId: number, reason: string) {
    const { data: sess } = await db.from("ai_lead_sessions").select("status").eq("lead_id", leadId).maybeSingle();
    if (sess?.status !== "handed_off") {
        await db.from("ai_lead_sessions").upsert({
            lead_id: leadId, status: "handed_off", handoff_reason: reason,
            handed_off_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
    }
    const { data: lead } = await db.from("leads").select("stage_id").eq("id", leadId).maybeSingle();
    if (!lead?.stage_id) return;
    const { data: st } = await db.from("stages").select("name").eq("id", lead.stage_id).maybeSingle();
    if (lead.stage_id !== 1 && !/ia atend/i.test(st?.name ?? "")) return;
    const { data: ec } = await db.from("stages").select("id").ilike("name", "%contato%").order("order", { ascending: true }).limit(1).maybeSingle();
    if (ec) await db.from("leads").update({ stage_id: ec.id, stage_entry_date: new Date().toISOString() }).eq("id", leadId);
}

/** Depois de uma resposta da IA: sem handoff, 1ª resposta (lead ainda em Entrada) → "IA
 *  Atendendo". Com handoff (a própria IA decidiu passar pra um humano — ela mesma avisou o lead
 *  que um consultor vai continuar), volta pra "Entrada" — ninguém respondeu de verdade ainda. */
export async function advanceAiStage(db: SupabaseClient, leadId: number, handoff: boolean) {
    if (handoff) return moveToEntradaFromAiAttending(db, leadId);
    const { data: lead } = await db.from("leads").select("stage_id").eq("id", leadId).maybeSingle();
    if (lead?.stage_id === 1) {
        const { data: ia } = await db.from("stages").select("id").ilike("name", "%ia atend%").maybeSingle();
        if (ia) await db.from("leads").update({ stage_id: ia.id, stage_entry_date: new Date().toISOString() }).eq("id", leadId);
    }
}

export const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Número BR no formato que o Z-PRO espera (55 + DDD + número). */
export function toZproNumber(raw: unknown): string | null {
    let d = onlyDigits(raw);
    if (d.length < 10 || /^0+$/.test(d)) return null;
    if (d.length === 10 || d.length === 11) d = "55" + d;
    return d;
}

export async function loadSettings(db: SupabaseClient) {
    const { data, error } = await db.from("vivaconnect_settings").select("*").eq("id", 1).single();
    if (error || !data) throw new Error("vivaconnect_settings não encontrada");
    return data;
}

/** Chamada à API externa do Z-PRO pelo canal. Nunca lança: devolve ok/status/data. body undefined → GET. */
export async function zpro(baseUrl: string, ch: Pick<Channel, "api_id" | "api_token">, path: string, body?: unknown) {
    const url = `${baseUrl.replace(/\/$/, "")}/v2/api/external/${encodeURIComponent(ch.api_id)}${path}`;
    try {
        const r = await fetch(url, {
            method: body === undefined ? "GET" : "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ch.api_token}` },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(30000),
        });
        const text = await r.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch { /* texto puro */ }
        return { ok: r.ok, status: r.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { error: (e as Error).message } };
    }
}

/** Aceita a "URL de integração" do painel do Z-PRO ou só o ID. */
export function parseApiRef(input: string): { baseUrl: string | null; apiId: string } {
    const s = String(input ?? "").trim();
    const m = s.match(/^(https?:\/\/[^/]+)\/v2\/api\/external\/([^/?#\s]+)/i);
    return m ? { baseUrl: m[1], apiId: m[2] } : { baseUrl: null, apiId: s };
}

/** Lista de objetos dentro da resposta (array direto ou em data/channels/whatsapps/...). */
export function asList(d: any): any[] {
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") {
        for (const k of ["data", "channels", "whatsapps", "sessions", "apis", "rows", "result", "items"]) {
            if (Array.isArray(d[k])) return d[k];
            if (d[k] && typeof d[k] === "object") { const inner = asList(d[k]); if (inner.length) return inner; }
        }
    }
    return [];
}

export type DiscoveredChannel = { id: string; name: string; number: string | null; type: string | null; status: string | null };
export function toDiscovered(c: any): DiscoveredChannel {
    return {
        id: String(c.id ?? c.whatsappId ?? c.sessionId ?? ""),
        name: String(c.name ?? c.nome ?? `Canal ${c.id ?? ""}`),
        number: onlyDigits(c.number ?? c.phone ?? c.wid ?? c.me?.id ?? "").slice(0, 15) || null,
        type: c.type ?? c.channel ?? c.provider ?? null,
        status: c.status ?? null,
    };
}

export const zproErr = (status: number, data: any) =>
    `Z-PRO ${status || "sem resposta"}: ${typeof data === "string" ? data.slice(0, 300) : (data?.error || data?.message || JSON.stringify(data ?? {}).slice(0, 300))}`;

// ── leitura tolerante do webhook ────────────────────────────────────────────
// O schema do payload NÃO é documentado. Em vez de adivinhar UM formato, busca
// as chaves conhecidas (padrão whaticket/izing, base do Z-PRO) em qualquer
// profundidade. O payload bruto sempre fica em vivaconnect_webhook_logs pra
// ajustar isto quando o formato real aparecer.
function findKey(obj: any, names: string[], maxDepth = 5): any {
    const queue: Array<[any, number]> = [[obj, 0]];
    while (queue.length) {
        const [cur, depth] = queue.shift()!;
        if (!cur || typeof cur !== "object") continue;
        for (const n of names) {
            if (cur[n] !== undefined && cur[n] !== null && cur[n] !== "") return cur[n];
        }
        if (depth < maxDepth) for (const v of Object.values(cur)) if (v && typeof v === "object") queue.push([v, depth + 1]);
    }
    return undefined;
}

export type ParsedMsg = {
    messageId: string | null; body: string; fromMe: boolean; number: string | null;
    contactName: string | null; ticketId: string | null; contactId: string | null;
    mediaType: string | null; mediaUrl: string | null; isGroup: boolean; whatsappId: string | null;
    event: string | null;
    /** quando a mensagem foi enviada no WhatsApp (ISO) */
    sentAt: string;
    /** ticket.userId do Z-PRO: preenchido = um agente humano pegou o atendimento lá */
    agentUserId: string | null;
    ticketStatus: string | null;
    /** reação, edição, "apagou a mensagem"… — não é fala do cliente */
    ignorable: boolean;
};

// tipos de mensagem do Baileys → mesmo vocabulário do widechat_messages
const BAILEYS_TYPES: Record<string, string> = {
    conversation: "text", extendedTextMessage: "text",
    imageMessage: "images", stickerMessage: "images",
    audioMessage: "sounds", pttMessage: "sounds",
    videoMessage: "videos", ptvMessage: "videos",
    documentMessage: "files", documentWithCaptionMessage: "files",
    locationMessage: "location", liveLocationMessage: "location",
    contactMessage: "contact", contactsArrayMessage: "contact",
    buttonsResponseMessage: "text", listResponseMessage: "text", templateButtonReplyMessage: "text",
    interactiveResponseMessage: "text",
};
const IGNORABLE = ["reactionMessage", "protocolMessage", "editedMessage", "pollUpdateMessage", "senderKeyDistributionMessage"];

/** Tira caracteres invisíveis (o Z-PRO manda nomes com U+200E na frente). */
export const cleanName = (v: unknown) =>
    String(v ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "").trim() || null;

/**
 * Formato real do Z-PRO (Baileys), visto em 25/09/2026:
 *   { method: "message",
 *     msg:    { key: { id, fromMe, remoteJid: "...@lid", remoteJidAlt: "55...@s.whatsapp.net" },
 *               message: { conversation | extendedTextMessage.text | imageMessage.caption | ... },
 *               pushName, messageTimestamp },
 *     ticket: { id, status, userId, whatsappId, contact: { id, number, name, pushname, isGroup } } }
 * Outros formatos (WABA/Instagram ainda não vistos) caem na busca tolerante.
 */
export function parseWebhook(p: any): ParsedMsg | null {
    if (p?.msg?.key && p?.ticket) {
        const inner = p.msg.message ?? {};
        const kind = Object.keys(inner).find((k) => k !== "messageContextInfo") ?? "";
        const content = inner[kind] ?? {};
        const body = typeof content === "string" ? content
            : content.text ?? content.caption ?? content.selectedDisplayText ?? content.title
            ?? content.message?.documentMessage?.caption ?? content.fileName ?? "";
        const t = p.ticket, c = t.contact ?? {};
        const jidAlt = String(p.msg.key.remoteJidAlt ?? "");
        return {
            messageId: p.msg.key.id ? String(p.msg.key.id) : null,
            body: String(body ?? ""),
            fromMe: p.msg.key.fromMe === true,
            number: onlyDigits(c.number) || onlyDigits(jidAlt.split("@")[0]) || null,
            contactName: cleanName(c.name ?? c.pushname ?? p.msg.pushName),
            ticketId: t.id != null ? String(t.id) : null,
            contactId: c.id != null ? String(c.id) : null,
            mediaType: BAILEYS_TYPES[kind] ?? (kind || "text"),
            mediaUrl: null, // Baileys não manda URL no webhook (fica no Z-PRO)
            isGroup: !!(t.isGroup || c.isGroup) || String(p.msg.key.remoteJid ?? "").endsWith("@g.us"),
            whatsappId: t.whatsappId != null ? String(t.whatsappId) : null,
            event: p.method ?? null,
            sentAt: Number(p.msg.messageTimestamp) > 0 ? new Date(Number(p.msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
            agentUserId: t.userId != null ? String(t.userId) : null,
            ticketStatus: t.status ?? null,
            ignorable: IGNORABLE.includes(kind) || (!kind && !body),
        };
    }

    const msg = findKey(p, ["msg", "message", "mensagem"]) ?? p;
    const m = typeof msg === "object" ? msg : p;
    // 28/09: payload WABA real tem `msg.text = { body: "..." }` — findKey acha a CHAVE "text" e
    // devolve o objeto inteiro, que sem isso virava `{"body":"..."}` stringificado na tela (visto
    // ao vivo no chat do lead e no Kanban). Só desembrulha um objeto {body|text|caption: string}.
    const rawBody = findKey(m, ["body", "text", "conversation", "caption"]) ?? findKey(p, ["body", "text"]);
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody.body ?? rawBody.text ?? rawBody.caption ?? rawBody)
        : rawBody;
    const ticket = findKey(p, ["ticket"]);
    const contact = findKey(p, ["contact", "contato"]);
    const rawNum = (contact && (contact.number ?? contact.phone)) ?? findKey(p, ["number", "remoteJidAlt", "from", "phone"]);
    const numStr = String(rawNum ?? "");
    const isGroup = !!findKey(p, ["isGroup"]) || numStr.includes("@g.us") || /-\d+$/.test(numStr);
    const messageId = findKey(m, ["messageId", "id"]);
    const fromMe = findKey(m, ["fromMe"]);
    if (body === undefined && messageId === undefined) return null;
    return {
        messageId: messageId != null ? String(messageId) : null,
        body: typeof body === "string" ? body : (body != null ? JSON.stringify(body) : ""),
        fromMe: fromMe === true || fromMe === "true" || fromMe === 1,
        number: numStr ? onlyDigits(numStr.split("@")[0]) || null : null,
        contactName: cleanName((contact && (contact.name ?? contact.pushname)) ?? findKey(p, ["pushName", "pushname", "notifyName"])),
        ticketId: ticket?.id != null ? String(ticket.id) : (findKey(p, ["ticketId"]) != null ? String(findKey(p, ["ticketId"])) : null),
        contactId: contact?.id != null ? String(contact.id) : (findKey(p, ["contactId"]) != null ? String(findKey(p, ["contactId"])) : null),
        mediaType: findKey(m, ["mediaType"]) ?? null,
        mediaUrl: findKey(m, ["mediaUrl", "mediaURL", "media_url"]) ?? null,
        isGroup,
        whatsappId: findKey(p, ["whatsappId"]) != null ? String(findKey(p, ["whatsappId"])) : null,
        event: findKey(p, ["method", "event", "action"]) ?? null,
        sentAt: new Date().toISOString(),
        agentUserId: ticket?.userId != null ? String(ticket.userId) : null,
        ticketStatus: ticket?.status ?? null,
        ignorable: false,
    };
}

/** Lead pelo telefone (últimos 8 dígitos, igual ao widechat-webhook). */
export async function findLeadByPhone(db: SupabaseClient, phone: string | null) {
    const suffix = onlyDigits(phone).slice(-8);
    if (suffix.length < 8) return null;
    const { data } = await db.from("leads")
        .select("id, nome_completo, perfil, assigned_to_id, vivaconnect_channel_id, curso_interesse, stage_id")
        .ilike("telefone", `%${suffix}%`).order("id", { ascending: false }).limit(1).maybeSingle();
    return data;
}

export function fillTemplate(tpl: string, vars: Record<string, string>) {
    return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
export const firstName = (full: unknown) => {
    const f = String(full ?? "").trim().split(/\s+/)[0] ?? "";
    return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : "";
};
