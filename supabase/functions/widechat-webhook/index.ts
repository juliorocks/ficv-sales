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

        // Initialize Supabase using Service Role to bypass RLS since Webhooks are unauthenticated
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // DEBUG: Save payload to see the shape
        await supabaseClient.from('widechat_webhook_logs').insert({ payload });

        const { event, data } = payload;
        const webhookEvent = payload.webhook?.key;
        const msgData = data?.content || data || {}; // 'content' holds the message for "message" events
        let messageText = msgData.message || msgData.interactive?.body?.text || msgData.text || "";
        let senderName = payload.vars?.name || data?.user?.name || data?.contact?.name || "Desconhecido";
        let messagePhone = payload.vars?.number || data?.contact?.telephone || "";

        let leadId = null;

        // Try to find the Lead based on the Widechat contact ID
        // OR try to find by phone number
        if (data && data.contact_id) {
            const { data: leadData } = await supabaseClient
                .from('leads')
                .select('id')
                .eq('widechat_contact_id', data.contact_id)
                .single();

            if (leadData) {
                leadId = leadData.id;
            }
        }

        if (!leadId && messagePhone) {
            const cleanPhone = String(messagePhone).replace(/\D/g, '');
            // Simple match for the last 8 digits
            if (cleanPhone.length >= 8) {
                const { data: possibleLeads } = await supabaseClient
                    .from('leads')
                    .select('id, telefone');

                if (possibleLeads) {
                    const match = possibleLeads.find((l: any) => {
                        if (!l.telefone) return false;
                        const lPhone = String(l.telefone).replace(/\D/g, '');
                        if (lPhone.length < 8) return false;
                        return lPhone.endsWith(cleanPhone) || cleanPhone.endsWith(lPhone);
                    });
                    if (match) leadId = match.id;
                }
            }
        }

        // We only care about message events for the real-time chat
        const isMessage =
            String(data?.event || "").toLowerCase().includes("message") ||
            webhookEvent === "client_message" ||
            webhookEvent === "agent_message" ||
            event === "message_received" ||
            event === "message_sent";

        if (isMessage) {

            // 1. Get or create 'Widechat' source
            let sourceId = 8; // Default to 8 if known, but we'll fetch it
            try {
                const { data: existingSource } = await supabaseClient
                    .from('lead_sources')
                    .select('id')
                    .ilike('name', 'Widechat')
                    .single();

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

            // Link or create the lead
            if (leadId) {
                // Update existing lead with contact ID and source if missing
                const updatePayload: any = {};
                if (data.contact_id) updatePayload.widechat_contact_id = data.contact_id;
                updatePayload.source_id = sourceId;

                await supabaseClient
                    .from('leads')
                    .update(updatePayload)
                    .eq('id', leadId);
            } else {
                // Auto-create lead
                try {
                    // 2. Get first stage
                    const { data: firstStage } = await supabaseClient
                        .from('stages')
                        .select('id')
                        .order('order', { ascending: true })
                        .limit(1)
                        .single();
                    const stageId = firstStage?.id || 1;

                    // 3. Insert Lead
                    let newName = "Desconhecido (Widechat)";
                    if (data.contact?.name && data.contact.name.trim() !== '') {
                        newName = data.contact.name;
                    } else if (data.contact?.telephone) {
                        newName = `Lead WhatsApp - ${data.contact.telephone}`;
                    }

                    const newLeadData = {
                        nome_completo: newName,
                        telefone: data.contact?.telephone || "",
                        stage_id: stageId,
                        source_id: sourceId,
                        widechat_contact_id: data.contact_id || null,
                        temperatura: 'frio'
                    };

                    const { data: insertedLead } = await supabaseClient
                        .from('leads')
                        .insert(newLeadData)
                        .select('id')
                        .single();

                    if (insertedLead) {
                        leadId = insertedLead.id;
                    }
                } catch (e) {
                    console.error("Erro ao auto-criar lead:", e);
                }
            }
            let origin = "auto";
            if (webhookEvent === "client_message" || msgData.origin === "contact") origin = "channel";
            if (webhookEvent === "agent_message" || msgData.origin === "user") origin = "agent";

            const messageInsertData = {
                lead_id: leadId,
                session_id: data.session_id || "unknown",
                message_id: msgData.message_id || data._id || null,
                type: msgData.type || "text",
                message: messageText,
                origin: origin,
                sender_name: senderName,
                created_at: msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString(),
                raw_data: payload
            };

            const { error: insertError } = await supabaseClient
                .from('widechat_messages')
                .insert(messageInsertData);

            if (insertError) {
                console.error("Erro inserindo Widechat Message:", insertError);
            }
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error: any) {
        console.error("Error processing Widechat webhook:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200, // Important: Always return 200 OK so Widechat doesn't block the webhook queue
        });
    }
});
