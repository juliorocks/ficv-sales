import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── SurrealDB ────────────────────────────────────────────────────────────────
const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT')
    ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

async function getSurrealToken(): Promise<string> {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error(`SurrealDB signin failed: ${res.status}`);
    const { token } = await res.json() as { token?: string };
    if (!token) throw new Error('SurrealDB: no token');
    return token;
}

async function surrealSQL(token: string, sql: string): Promise<unknown[]> {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain', 'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}`);
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : json;
    if (entry?.status === 'ERR') throw new Error(entry.result);
    return Array.isArray(entry?.result) ? entry.result : [];
}

function toS(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    return JSON.stringify(v);
}

function parseId(v: unknown): number | string | null {
    if (v === null || v === undefined) return null;
    const s = String(v);
    const m = s.match(/^[a-z_]+:⟨(.+)⟩$/) ?? s.match(/^[a-z_]+:`(.+)`$/);
    if (m) {
        const inner = m[1];
        const asNum = Number(inner);
        return Number.isFinite(asNum) && String(asNum) === inner ? asNum : inner;
    }
    if (typeof v === 'number') return v;
    return s;
}

function ref(table: string, id: unknown): string {
    return `${table}:⟨${id}⟩`;
}

async function nextLeadId(token: string): Promise<number> {
    // sem ONLY -> resultado é array [{val}]; com ONLY o parser devolve [] e o id sai 0
    const rows = await surrealSQL(token, 'UPDATE seq:leads SET val += 1 RETURN val;');
    const val = (rows[0] as any)?.val;
    if (!val) throw new Error('seq:leads não retornou val');
    return val;
}

// ─── Message filter ───────────────────────────────────────────────────────────
const SYSTEM_PATTERNS = [
    'sessão irá expirar', 'sessão expirou', 'sua sessão',
    'atendimento encerrado', 'atendimento finalizado', 'atendimento transferido',
    'em fila de espera', 'aguarde na fila', 'aguardando atendimento',
    '[sistema]', '[bot]', 'obrigado pelo seu interesse', 'caso deseje outra informação',
];
const isSystemMessage = (text: string) => {
    const lower = (text || '').toLowerCase().trim();
    if (!lower) return true;
    return SYSTEM_PATTERNS.some(p => lower.includes(p));
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        let payload: any;
        const bodyText = await req.text();
        try { payload = JSON.parse(bodyText); } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
        }

        const token = await getSurrealToken();

        const { event, data } = payload;
        const webhookEvent = payload.webhook?.key;
        const msgData      = data?.content || data || {};

        let messageText  = msgData.message || msgData.interactive?.body?.text || msgData.text || "";
        let senderName   = payload.vars?.name || data?.user?.name || data?.contact?.name || "";
        let messagePhone = payload.vars?.number || data?.contact?.telephone || data?.content?.to || msgData.platform_id || "";

        if (!senderName && msgData.placeholders && Array.isArray(msgData.placeholders)) {
            const n = msgData.placeholders.find((p: any) => typeof p === 'string' && p.length > 2 && p.includes(' ') && !p.includes(':'));
            senderName = n || (msgData.placeholders[1] ? String(msgData.placeholders[1]) : '');
        }

        const eventName = String(data?.event || event || "");
        const sessionId = data?.session_id || msgData.session_id;

        const CONV_END_WEBHOOKS  = ["attendance_end", "finalize", "attendance_closed", "attendance_finish"];
        const CONV_END_EVENTS    = ["attendanceEnd", "finalize", "closed", "attendance_end", "finalized", "attendanceClosed", "autoFinish", "humanFinish"];
        const isConversationEnd  = CONV_END_WEBHOOKS.includes(webhookEvent) || CONV_END_EVENTS.includes(eventName);
        const isAcceptAttendance = webhookEvent === "accept_attendance" || eventName === "humanStart";
        const isSystemNotif      = ["messageNotificationAgent", "Read", "Delivered"].includes(eventName);
        const isMessage          = !isSystemNotif && (
            eventName.toLowerCase().includes("message") ||
            webhookEvent === "client_message" ||
            webhookEvent === "agent_message" ||
            !!messageText
        );

        // ── Capture every real message for transcript ─────────────────────────
        if (isMessage && sessionId && messageText && !isSystemMessage(messageText)) {
            let origin = "auto";
            if (eventName === "messageContact" || msgData.origin === "contact" || msgData.origin === "channel") origin = "channel";
            if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message" || msgData.user?.name) origin = "agent";
            await surrealSQL(token, `INSERT INTO widechat_raw_messages [{
                session_id: ${toS(sessionId)},
                origin: ${toS(origin)},
                sender_name: ${toS(msgData.user?.name || senderName || "")},
                message: ${toS(messageText)},
                platform_id: ${toS(messagePhone || msgData.platform_id || "")},
                message_id: ${toS(msgData.message_id || null)},
                created_at: ${toS(msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString())}
            }] RETURN NONE;`);
        }

        if (!isMessage && !isConversationEnd && !isAcceptAttendance) {
            return new Response(JSON.stringify({ success: true, ignored: true, event: eventName }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        const hasPhone = messagePhone && !["00000000000", ""].includes(messagePhone);
        const hasName  = senderName && senderName.trim().length > 0;

        if (!hasPhone && !hasName && !isConversationEnd && !isAcceptAttendance) {
            return new Response(JSON.stringify({ success: true, skipped: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        const TARGET_QUEUE = "FICV - COMERCIAL";
        const queueName    = payload.data?.transferHistory?.value;
        const isTransfer   = webhookEvent === "attendance_transfer" || payload.data?.event === "humanTransfer";

        // Find existing lead
        let leadId: number | string | null = null;
        let foundBy = "";
        if (sessionId) {
            const rows = await surrealSQL(token, `SELECT id FROM leads WHERE widechat_session_id = ${toS(sessionId)} LIMIT 1;`);
            if (rows[0]) { leadId = parseId((rows[0] as any).id); foundBy = "session"; }
        }
        if (!leadId && data?.contact_id) {
            const rows = await surrealSQL(token, `SELECT id FROM leads WHERE widechat_contact_id = ${toS(data.contact_id)} LIMIT 1;`);
            if (rows[0]) { leadId = parseId((rows[0] as any).id); foundBy = "contact_id"; }
        }
        if (!leadId && hasPhone) {
            const suffix = String(messagePhone).replace(/\D/g, '').slice(-8);
            if (suffix.length >= 8) {
                const rows = await surrealSQL(token, `SELECT id FROM leads WHERE string::contains(telefone, ${toS(suffix)}) LIMIT 1;`);
                if (rows[0]) { leadId = parseId((rows[0] as any).id); foundBy = "phone"; }
            }
        }

        console.log(`event=${eventName} wh=${webhookEvent} lead=${leadId}(${foundBy}) session=${sessionId}`);

        // ── Accept attendance ──────────────────────────────────────────────────
        if (isAcceptAttendance) {
            await surrealSQL(token, `INSERT INTO widechat_atendimentos [{
                lead_id: ${leadId ? ref('leads', leadId) : 'NONE'},
                protocol: ${toS(data?.protocol || null)},
                widechat_agent_id: ${toS(data?.agent_id || null)},
                session_id: ${toS(sessionId || null)},
                contact_id: ${toS(data?.contact_id || null)},
                aceito_em: ${toS(new Date().toISOString())}
            }] RETURN NONE;`);
            return new Response(JSON.stringify({ success: true, lead_id: leadId, action: "attendance_accepted" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        // ── Conversation end ───────────────────────────────────────────────────
        if (isConversationEnd) {
            if (leadId) {
                const stages = await surrealSQL(token,
                    `SELECT id FROM stages WHERE string::contains(string::lowercase(name), "finaliz") OR string::contains(string::lowercase(name), "encerr") OR string::contains(string::lowercase(name), "conclu") ORDER BY order DESC LIMIT 1;`
                );
                if (stages[0]) {
                    const finalStageId = parseId((stages[0] as any).id);
                    await surrealSQL(token, `UPDATE leads SET stage_id = ${ref('stages', finalStageId)}, stage_entry_date = ${toS(new Date().toISOString())} WHERE id = ${ref('leads', leadId)};`);
                }
            }
            return new Response(JSON.stringify({ success: true, lead_id: leadId, action: "conversation_ended" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        // ── New lead filter ────────────────────────────────────────────────────
        if (isTransfer && queueName && queueName !== TARGET_QUEUE) {
            return new Response(JSON.stringify({ success: true, ignored: true, reason: `Queue ${queueName} is not ${TARGET_QUEUE}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }
        if (!leadId) {
            const belongsToTargetQueue = !queueName || queueName === TARGET_QUEUE;
            if (!belongsToTargetQueue || (!hasPhone && !hasName)) {
                return new Response(JSON.stringify({ success: true, ignored: true, reason: "Lead admission denied" }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
                });
            }
        }

        // ── Source and stage lookup ────────────────────────────────────────────
        const srcRows = await surrealSQL(token, `SELECT id FROM lead_sources WHERE string::contains(string::lowercase(name), "widechat") LIMIT 1;`);
        const sourceId = srcRows[0] ? parseId((srcRows[0] as any).id) : 8;

        // ── Create/update lead ─────────────────────────────────────────────────
        if (leadId) {
            let setClause = `source_id = ${ref('lead_sources', sourceId)}, fonte_lead = "Widechat", updated_at = ${toS(new Date().toISOString())}`;
            if (data?.contact_id) setClause += `, widechat_contact_id = ${toS(data.contact_id)}`;
            if (sessionId) setClause += `, widechat_session_id = ${toS(sessionId)}`;
            await surrealSQL(token, `UPDATE leads SET ${setClause} WHERE id = ${ref('leads', leadId)};`);
        } else {
            const stageRows = await surrealSQL(token, `SELECT id FROM stages ORDER BY order ASC LIMIT 1;`);
            const firstStageId = stageRows[0] ? parseId((stageRows[0] as any).id) : 1;
            const newId = await nextLeadId(token);
            const inserted = await surrealSQL(token, `INSERT INTO leads [{ id: "${newId}",
                nome_completo: ${toS(senderName.trim() || `Lead WhatsApp - ${messagePhone}`)},
                telefone: ${toS(messagePhone || "00000000000")},
                stage_id: ${ref('stages', firstStageId)},
                source_id: ${ref('lead_sources', sourceId)},
                fonte_lead: "Widechat",
                widechat_contact_id: ${toS(data?.contact_id || null)},
                widechat_session_id: ${toS(sessionId || null)},
                temperatura: "frio",
                data_entrada: d${toS(new Date().toISOString())},
                valor_oportunidade: 0
            }] RETURN id;`);
            if (inserted[0]) leadId = parseId((inserted[0] as any).id);
        }

        // ── Store message in widechat_messages ────────────────────────────────
        let origin = "auto";
        if (eventName === "messageContact" || msgData.origin === "contact") origin = "channel";
        if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message") origin = "agent";

        if (leadId) {
            await surrealSQL(token, `INSERT INTO widechat_messages [{
                lead_id: ${ref('leads', leadId)},
                session_id: ${toS(sessionId || "unknown")},
                message_id: ${toS(msgData.message_id || null)},
                type: ${toS(msgData.type || "text")},
                message: ${toS(messageText || "[Mídia]")},
                origin: ${toS(origin)},
                sender_name: ${toS(senderName || "Desconhecido")},
                created_at: ${toS(msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString())}
            }] RETURN NONE;`);

            // Intelligent CRM updates
            const leadRows = await surrealSQL(token, `SELECT assigned_to_id, curso_interesse, valor_oportunidade FROM leads WHERE id = ${ref('leads', leadId)} LIMIT 1;`);
            const currentLead = leadRows[0] as any;
            const updates: string[] = [];

            if (origin === 'agent' && senderName && senderName !== 'Desconhecido' && !currentLead?.assigned_to_id) {
                const firstName = senderName.trim().split(' ')[0];
                const profRows = await surrealSQL(token,
                    `SELECT id FROM profiles WHERE string::contains(string::lowercase(full_name), ${toS(senderName.trim().toLowerCase())}) OR string::contains(string::lowercase(full_name), ${toS(firstName.toLowerCase())}) LIMIT 1;`
                );
                if (profRows[0]) {
                    const profId = parseId((profRows[0] as any).id);
                    updates.push(`assigned_to_id = ${ref('profiles', profId)}`);
                }
            }

            if (!currentLead?.curso_interesse && messageText) {
                const courseRows = await surrealSQL(token, `SELECT id, name, default_value FROM courses;`) as any[];
                if (courseRows.length) {
                    const msgNorm = messageText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                    const match = courseRows.find((c: any) => {
                        const cn = (c.name || '').toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                        if (msgNorm.includes(cn)) return true;
                        const words = cn.split(/\s+/).filter((w: string) => w.length > 4);
                        return words.length > 0 && words.every((w: string) => msgNorm.includes(w));
                    });
                    if (match) {
                        const courseId = parseId(match.id);
                        updates.push(`curso_interesse = ${ref('courses', courseId)}`);
                        if (match.default_value && !currentLead?.valor_oportunidade)
                            updates.push(`valor_oportunidade = ${match.default_value}`);
                    }
                }
            }

            if (updates.length > 0)
                await surrealSQL(token, `UPDATE leads SET ${updates.join(', ')} WHERE id = ${ref('leads', leadId)};`);
        }

        return new Response(JSON.stringify({ success: true, lead_id: leadId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });

    } catch (error: any) {
        console.error("Critical error Widechat webhook:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
    }
});
