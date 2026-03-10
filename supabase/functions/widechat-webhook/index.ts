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

        const { event, data } = payload;

        let leadId = null;

        // Try to find the Lead based on the Widechat contact ID (assuming we saved it when we started the session)
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

        if (!leadId && data && data.contact?.telephone) {
            const cleanPhone = String(data.contact.telephone).replace(/\D/g, '');
            // Simple match for the last 8 digits (ignoring country code/DDD differences for now)
            const { data: possibleLeads } = await supabaseClient
                .from('leads')
                .select('id, telefone');

            if (possibleLeads) {
                const match = possibleLeads.find((l: any) => {
                    const lPhone = String(l.telefone).replace(/\D/g, '');
                    return lPhone.endsWith(cleanPhone) || cleanPhone.endsWith(lPhone);
                });
                if (match) leadId = match.id;
            }
        }

        // We only care about message events for the real-time chat
        if (event === "message_received" || event === "message_sent") {
            const origin = event === "message_received" ? "channel" : (data.user_id ? "agent" : "auto");

            const messageInsertData = {
                lead_id: leadId,
                session_id: data.session_id || "unknown",
                message_id: data.message_id || data._id || null,
                type: data.type || "text",
                message: data.message || "",
                origin: origin,
                sender_name: data.user?.name || data.contact?.name || "Desconhecido",
                created_at: data.created_at ? new Date(data.created_at).toISOString() : new Date().toISOString(),
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
