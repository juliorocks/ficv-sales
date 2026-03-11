import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        let payload;
        const bodyText = await req.text();
        try {
            payload = JSON.parse(bodyText);
        } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
        }

        console.log("Payload recebido do Widechat Webhook:", JSON.stringify(payload, null, 2));

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        await supabaseClient.from('widechat_webhook_logs').insert({ payload });

        const { event, data } = payload;
        const webhookEvent = payload.webhook?.key;
        const msgData = data?.content || data || {};

        // Extract key fields
        let messageText = msgData.message || msgData.interactive?.body?.text || msgData.text || "";
        let senderName = payload.vars?.name || data?.user?.name || data?.contact?.name || "";
        let messagePhone = payload.vars?.number || data?.contact?.telephone || data?.content?.to || msgData.platform_id || "";

        // Try to extract name from template placeholders
        if (!senderName && msgData.placeholders && Array.isArray(msgData.placeholders)) {
            const possibleName = msgData.placeholders.find((p: any) =>
                typeof p === 'string' && p.length > 2 && p.includes(' ') && !p.includes(':')
            );
            if (possibleName) senderName = possibleName;
            else if (msgData.placeholders[1]) senderName = String(msgData.placeholders[1]);
        }

        // Filter out system notification events (not real messages)
        const eventName = String(data?.event || event || "");
        const isSystemNotification = ["messageNotificationAgent", "Read", "Delivered"].includes(eventName);

        const isMessage = !isSystemNotification && (
            eventName.toLowerCase().includes("message") ||
            webhookEvent === "client_message" ||
            webhookEvent === "agent_message" ||
            !!messageText
        );

        if (!isMessage) {
            console.log(`Evento ignorado: ${eventName}`);
            return new Response(JSON.stringify({ success: true, ignored: true, event: eventName }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        // Require at minimum a valid phone or name to create/find lead
        const hasPhone = messagePhone && !["00000000000", ""].includes(messagePhone);
        const hasName = senderName && senderName.trim().length > 0;

        if (!hasPhone && !hasName) {
            console.log("Skipping: no phone or name available");
            return new Response(JSON.stringify({ success: true, skipped: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        const sessionId = data.session_id || msgData.session_id;

        // --- Filter by Queue ---
        const queueName = payload.data?.transferHistory?.value;
        const isTransfer = webhookEvent === "attendance_transfer" || payload.data?.event === "humanTransfer";

        // --- Find existing lead ---
        let leadId = null;
        let foundBy = "";

        // 1. By contact_id
        if (data?.contact_id) {
            const { data: l } = await supabaseClient.from('leads').select('id').eq('widechat_contact_id', data.contact_id).maybeSingle();
            if (l) { leadId = l.id; foundBy = "contact_id"; }
        }

        // 2. By phone
        if (!leadId && hasPhone) {
            const cleanPhone = String(messagePhone).replace(/\D/g, '');
            if (cleanPhone.length >= 8) {
                const suffix = cleanPhone.slice(-8);
                const { data: l } = await supabaseClient.from('leads').select('id').filter('telefone', 'ilike', `%${suffix}%`).limit(1).maybeSingle();
                if (l) { leadId = l.id; foundBy = "phone"; }
            }
        }

        // 3. By session_id
        if (!leadId && sessionId) {
            const { data: l } = await supabaseClient.from('leads').select('id').eq('widechat_session_id', sessionId).maybeSingle();
            if (l) { leadId = l.id; foundBy = "session"; }
        }

        console.log(`Lead encontrado por: ${foundBy || "nenhum"}, leadId: ${leadId}`);

        // --- Filter Logic for New Leads ---
        // If the lead doesn't exist, we ONLY create it if it's a transfer to "FICV - COMERCIAL"
        const isTargetQueue = queueName === "FICV - COMERCIAL";
        
        if (!leadId) {
            if (!isTransfer || !isTargetQueue) {
                console.log(`Evento ignorado: Lead não existe e não é transferência para FICV - COMERCIAL (Queue: ${queueName || 'não informada'})`);
                return new Response(JSON.stringify({ 
                    success: true, 
                    ignored: true, 
                    reason: "Lead not found and not a transfer to target queue",
                    queue: queueName 
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200,
                });
            }
        }

        // --- Get sourceId ---
        let sourceId = 8;
        const { data: src } = await supabaseClient.from('lead_sources').select('id').ilike('name', 'Widechat').maybeSingle();
        if (src) sourceId = src.id;

        // --- Get first stage ---
        const { data: firstStage } = await supabaseClient.from('stages').select('id').order('order', { ascending: true }).limit(1).maybeSingle();
        const stageId = firstStage?.id || 1;

        if (leadId) {
            // Update existing
            const updateData: any = { source_id: sourceId, fonte_lead: 'Widechat', updated_at: new Date().toISOString() };
            if (data?.contact_id) updateData.widechat_contact_id = data.contact_id;
            if (sessionId) updateData.widechat_session_id = sessionId;
            await supabaseClient.from('leads').update(updateData).eq('id', leadId);
        } else {
            // Create new lead ONLY if it was approved by the filter above
            const finalName = senderName.trim() || (messagePhone ? `Lead WhatsApp - ${messagePhone}` : "Desconhecido");
            const finalPhone = messagePhone || "00000000000";

            const { data: upserted, error: upsertError } = await supabaseClient
                .from('leads')
                .insert({
                    nome_completo: finalName,
                    telefone: finalPhone,
                    stage_id: stageId,
                    source_id: sourceId,
                    fonte_lead: 'Widechat',
                    widechat_contact_id: data?.contact_id || null,
                    widechat_session_id: sessionId || null,
                    temperatura: 'frio',
                    data_entrada: new Date().toISOString(),
                    valor_oportunidade: 0
                })
                .select('id')
                .maybeSingle();

            if (upsertError) {
                console.error("Erro upsert lead:", upsertError);
            } else if (upserted) {
                leadId = upserted.id;
            }
        }

        // --- Store message ---
        if (leadId) {
            let origin = "auto";
            if (eventName === "messageContact" || msgData.origin === "contact") origin = "channel";
            if (msgData.origin === "user" || msgData.origin === "agent") origin = "agent";

            await supabaseClient.from('widechat_messages').insert({
                lead_id: leadId,
                session_id: sessionId || "unknown",
                message_id: msgData.message_id || null,
                type: msgData.type || "text",
                message: messageText || "[Mídia]",
                origin,
                sender_name: senderName || "Desconhecido",
                created_at: msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString(),
                raw_data: payload
            });
        }

        return new Response(JSON.stringify({ success: true, lead_id: leadId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error: any) {
        console.error("Critical error Widechat webhook:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }
});
