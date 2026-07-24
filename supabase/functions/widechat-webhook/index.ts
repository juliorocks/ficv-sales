import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        await supabase.from('widechat_webhook_logs').insert({ payload });

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

        // ── Capture every real message for transcript (keyed by session_id) ─────
        if (isMessage && sessionId && messageText && !isSystemMessage(messageText)) {
            let origin = "auto";
            if (eventName === "messageContact" || msgData.origin === "contact" || msgData.origin === "channel") origin = "channel";
            if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message" || msgData.user?.name) origin = "agent";

            await supabase.from('widechat_raw_messages').insert({
                session_id:  sessionId,
                origin,
                sender_name: msgData.user?.name || senderName || "",
                message:     messageText,
                platform_id: messagePhone || msgData.platform_id || "",
                message_id:  msgData.message_id || null,
                created_at:  msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString(),
            });
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
        let leadId = null, foundBy = "";
        if (sessionId) {
            const { data: l } = await supabase.from('leads').select('id').eq('widechat_session_id', sessionId).maybeSingle();
            if (l) { leadId = l.id; foundBy = "session"; }
        }
        if (!leadId && data?.contact_id) {
            const { data: l } = await supabase.from('leads').select('id').eq('widechat_contact_id', data.contact_id).maybeSingle();
            if (l) { leadId = l.id; foundBy = "contact_id"; }
        }
        if (!leadId && hasPhone) {
            const suffix = String(messagePhone).replace(/\D/g, '').slice(-8);
            if (suffix.length >= 8) {
                const { data: l } = await supabase.from('leads').select('id').filter('telefone', 'ilike', `%${suffix}%`).limit(1).maybeSingle();
                if (l) { leadId = l.id; foundBy = "phone"; }
            }
        }

        console.log(`event=${eventName} wh=${webhookEvent} lead=${leadId}(${foundBy}) session=${sessionId}`);

        // ── Accept attendance ──────────────────────────────────────────────────
        if (isAcceptAttendance) {
            await supabase.from('widechat_atendimentos').insert({
                lead_id: leadId, protocol: data?.protocol || null,
                widechat_agent_id: data?.agent_id || null,
                session_id: sessionId || null, contact_id: data?.contact_id || null,
                aceito_em: new Date().toISOString(),
            });
            return new Response(JSON.stringify({ success: true, lead_id: leadId, action: "attendance_accepted" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        // ── Conversation end: move lead to final stage ─────────────────────────
        if (isConversationEnd) {
            if (leadId) {
                const { data: finalStage } = await supabase.from('stages').select('id, name')
                    .or('name.ilike.%finaliza%,name.ilike.%encerra%,name.ilike.%conclu%')
                    .order('order', { ascending: false }).limit(1).maybeSingle();
                if (finalStage) {
                    await supabase.from('leads').update({
                        stage_id: finalStage.id, stage_entry_date: new Date().toISOString()
                    }).eq('id', leadId);
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

        // ── Create/update lead ─────────────────────────────────────────────────
        let sourceId = 8;
        const { data: src } = await supabase.from('lead_sources').select('id').ilike('name', 'Widechat').maybeSingle();
        if (src) sourceId = src.id;
        const { data: firstStage } = await supabase.from('stages').select('id').order('order', { ascending: true }).limit(1).maybeSingle();

        if (leadId) {
            const upd: any = { source_id: sourceId, fonte_lead: 'Widechat', updated_at: new Date().toISOString() };
            if (data?.contact_id) upd.widechat_contact_id = data.contact_id;
            if (sessionId) upd.widechat_session_id = sessionId;
            await supabase.from('leads').update(upd).eq('id', leadId);
        } else {
            const { data: upserted } = await supabase.from('leads').insert({
                nome_completo: senderName.trim() || `Lead WhatsApp - ${messagePhone}`,
                telefone: messagePhone || "00000000000",
                stage_id: firstStage?.id || 1, source_id: sourceId, fonte_lead: 'Widechat',
                widechat_contact_id: data?.contact_id || null,
                widechat_session_id: sessionId || null,
                temperatura: 'frio', data_entrada: new Date().toISOString(), valor_oportunidade: 0
            }).select('id').maybeSingle();
            if (upserted) leadId = upserted.id;
        }

        // ── Store message in widechat_messages (CRM kanban view) ──────────────
        let origin = "auto";
        if (eventName === "messageContact" || msgData.origin === "contact") origin = "channel";
        if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message") origin = "agent";

        if (leadId) {
            await supabase.from('widechat_messages').insert({
                lead_id: leadId, session_id: sessionId || "unknown",
                message_id: msgData.message_id || null, type: msgData.type || "text",
                message: messageText || "[Mídia]", origin,
                sender_name: senderName || "Desconhecido",
                created_at: msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString(),
                raw_data: payload
            });

            // Intelligent CRM updates
            const { data: currentLead } = await supabase.from('leads')
                .select('assigned_to_id, curso_interesse, valor_oportunidade').eq('id', leadId).maybeSingle();
            const updates: any = {};

            if (origin === 'agent' && senderName && senderName !== 'Desconhecido' && !currentLead?.assigned_to_id) {
                const firstName = senderName.trim().split(' ')[0];
                const { data: profile } = await supabase.from('profiles').select('id, full_name')
                    .or(`full_name.ilike.%${senderName.trim()}%,full_name.ilike.%${firstName}%`).limit(1).maybeSingle();
                if (profile) updates.assigned_to_id = profile.id;
            }

            if (!currentLead?.curso_interesse && messageText) {
                const { data: courses } = await supabase.from('courses').select('id, name, default_value');
                if (courses?.length) {
                    const msgNorm = messageText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                    const match = courses.find((c: any) => {
                        const cn = c.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                        if (msgNorm.includes(cn)) return true;
                        const words = cn.split(/\s+/).filter((w: string) => w.length > 4);
                        return words.length > 0 && words.every((w: string) => msgNorm.includes(w));
                    });
                    if (match) {
                        updates.curso_interesse = match.id;
                        if (match.default_value && !currentLead?.valor_oportunidade)
                            updates.valor_oportunidade = match.default_value;
                    }
                }
            }

            if (Object.keys(updates).length > 0)
                await supabase.from('leads').update(updates).eq('id', leadId);
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
