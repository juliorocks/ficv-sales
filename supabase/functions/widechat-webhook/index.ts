import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS gracefully for preflight requests
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

        // Initialize Supabase using Service Role to bypass RLS
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // DEBUG: Save payload to see the shape
        await supabaseClient.from('widechat_webhook_logs').insert({ payload });

        const { event, data } = payload;
        const webhookEvent = payload.webhook?.key;
        const msgData = data?.content || data || {};
        
        // REFINED EXTRACTION
        let messageText = msgData.message || msgData.interactive?.body?.text || msgData.text || "";
        let senderName = payload.vars?.name || data?.user?.name || data?.contact?.name || "Desconhecido";
        let messagePhone = payload.vars?.number || data?.contact?.telephone || data?.content?.to || msgData.platform_id || "";

        // If template placeholders contain a name, try to extract it
        if (senderName === "Desconhecido" && msgData.placeholders && Array.isArray(msgData.placeholders)) {
            const possibleName = msgData.placeholders.find((p: any) => 
                typeof p === 'string' && p.length > 2 && p.includes(' ') && !p.includes(':')
            );
            if (possibleName) senderName = possibleName;
            else if (msgData.placeholders[1]) senderName = msgData.placeholders[1];
        }

        // IMPROVED isMessage filter (exclude notifications and meta-events)
        const eventName = String(data?.event || event || "");
        const blacklistedEvents = ["Notification", "Read", "Delivered", "error"];
        
        const isNotification = blacklistedEvents.some(be => eventName.includes(be));
        
        const isMessage = !isNotification && (
            eventName.toLowerCase().includes("message") ||
            webhookEvent === "client_message" ||
            webhookEvent === "agent_message" ||
            event === "message_received" ||
            event === "message_sent" ||
            event === "templateMessage" ||
            event === "messageContact" || 
            event === "message" ||
            !!messageText
        );

        if (!isMessage) {
            console.log(`Evento ignorado (não é mensagem): ${eventName}`);
            return new Response(JSON.stringify({ success: true, ignored: true, event: eventName }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        let leadId = null;
        const sessionId = data.session_id || payload.data?.session_id || msgData.session_id;

        // 1. Try to find the Lead based on the Widechat contact ID
        if (data && data.contact_id) {
            const { data: leadByContact } = await supabaseClient
                .from('leads')
                .select('id')
                .eq('widechat_contact_id', data.contact_id)
                .maybeSingle();

            if (leadByContact) leadId = leadByContact.id;
        }

        // 2. Search by phone number if not found by contact_id
        if (!leadId && messagePhone && messagePhone !== "00000000000") {
            const cleanPhone = String(messagePhone).replace(/\D/g, '');
            if (cleanPhone.length >= 8) {
                const phoneSuffix = cleanPhone.slice(-8);
                const { data: phoneMatch } = await supabaseClient
                    .from('leads')
                    .select('id')
                    .filter('telefone', 'ilike', `%${phoneSuffix}%`)
                    .limit(1)
                    .maybeSingle();

                if (phoneMatch) leadId = phoneMatch.id;
            }
        }

        // 3. Fallback to session_id matching
        if (!leadId && sessionId) {
            const { data: leadBySession } = await supabaseClient
                .from('leads')
                .select('id')
                .eq('widechat_session_id', sessionId)
                .maybeSingle();
            
            if (leadBySession) leadId = leadBySession.id;
        }

        // Ensure Widechat exists in lead_sources
        let sourceId = 8;
        try {
            const { data: existingSource } = await supabaseClient
                .from('lead_sources')
                .select('id')
                .ilike('name', 'Widechat')
                .maybeSingle();

            if (existingSource) {
                sourceId = existingSource.id;
            } else {
                const { data: newSource } = await supabaseClient
                    .from('lead_sources')
                    .insert({ name: 'Widechat' })
                    .select('id')
                    .single();
                if (newSource) sourceId = newSource.id;
            }
        } catch (e) {
            console.error("Erro ao gerenciar lead_source:", e);
        }

        if (leadId) {
            // Update existing lead
            const updatePayload: any = {
                source_id: sourceId,
                fonte_lead: 'Widechat',
                updated_at: new Date().toISOString()
            };
            if (data.contact_id) updatePayload.widechat_contact_id = data.contact_id;
            if (sessionId) updatePayload.widechat_session_id = sessionId;

            await supabaseClient
                .from('leads')
                .update(updatePayload)
                .eq('id', leadId);
        } else {
            // Check if we have enough info to create a lead
            const hasPhone = messagePhone && messagePhone !== "00000000000";
            const hasName = senderName && senderName !== "Desconhecido";

            if (!hasPhone && !hasName) {
                console.log("Skipping lead creation for anonymous/empty payload");
                return new Response(JSON.stringify({ success: true, skipped: true, reason: "Insufficient data" }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200,
                });
            }

            // CREATE LEAD
            try {
                const { data: firstStage } = await supabaseClient
                    .from('stages')
                    .select('id')
                    .order('order', { ascending: true })
                    .limit(1)
                    .maybeSingle();
                const stageId = firstStage?.id || 1;

                let newName = senderName;
                if (newName === "Desconhecido" && messagePhone) {
                    newName = `Lead WhatsApp - ${messagePhone}`;
                }

                const newLeadData = {
                    nome_completo: newName,
                    telefone: messagePhone || "00000000000",
                    stage_id: stageId,
                    source_id: sourceId,
                    fonte_lead: 'Widechat',
                    widechat_contact_id: data.contact_id || null,
                    widechat_session_id: sessionId || null,
                    temperatura: 'frio',
                    data_entrada: new Date().toISOString(),
                    valor_oportunidade: 0
                };

                const { data: insertedLead, error: insertLeadErr } = await supabaseClient
                    .from('leads')
                    .insert(newLeadData)
                    .select('id')
                    .single();

                if (insertLeadErr) {
                    console.error("ERRO AO INSERIR LEAD:", insertLeadErr);
                } else if (insertedLead) {
                    leadId = insertedLead.id;
                }
            } catch (e) {
                console.error("Erro no fluxo de auto-criação de lead:", e);
            }
        }

        // Insert message log if we have a lead
        if (leadId) {
            let origin = "auto";
            if (webhookEvent === "client_message" || msgData.origin === "contact" || event === "message_received" || event === "messageContact") origin = "channel";
            if (webhookEvent === "agent_message" || msgData.origin === "user" || event === "message_sent") origin = "agent";

            const messageInsertData = {
                lead_id: leadId,
                session_id: sessionId || "unknown",
                message_id: msgData.message_id || data._id || null,
                type: msgData.type || "text",
                message: messageText || "[Mídia/Outro]",
                origin: origin,
                sender_name: senderName,
                created_at: msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString(),
                raw_data: payload
            };

            const { error: msgInsertError } = await supabaseClient
                .from('widechat_messages')
                .insert(messageInsertData);

            if (msgInsertError) {
                console.error("Erro inserindo Widechat Message:", msgInsertError);
            }
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
