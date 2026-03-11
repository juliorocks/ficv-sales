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
        const url = new URL(req.url);

        // Handle stringified payloads or default json
        let payload;
        const bodyText = await req.text();
        try {
            if (bodyText) {
                payload = JSON.parse(bodyText);
            } else {
                payload = {};
            }
        } catch {
            payload = { rawBody: bodyText };
        }

        console.log("Payload recebido do SendPulse:", JSON.stringify(payload, null, 2));

        // Initialize Supabase using Service Role to bypass RLS
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // DEBUG: Save payload to log table
        await supabaseClient.from('sendpulse_webhook_logs').insert({ payload });

        const contact = Array.isArray(payload) ? payload[0] : payload;

        // Mapping SendPulse's potentially nested variables structure to standard fields
        let emailStr = "";
        let phoneStr = "";
        let nameStr = "Novo Contato (SendPulse)";

        if (contact && contact.email) emailStr = String(contact.email);
        else if (contact && contact.emails && Array.isArray(contact.emails)) emailStr = String(contact.emails[0]?.email);
        else emailStr = "sem_email@sendpulse.com";

        if (contact && contact.phone) phoneStr = String(contact.phone);
        else if (contact && contact.phones && Array.isArray(contact.phones)) phoneStr = String(contact.phones[0]?.phone);

        if (contact && (contact.name || contact.first_name)) {
            nameStr = String(contact.name || contact.first_name);
            if (contact.last_name) nameStr += " " + String(contact.last_name);
        } else if (contact && contact.title) {
            nameStr = "Contato: " + String(contact.title);
        }

        // Extract Form/Funnel name for context
        const origin = String((contact && (contact.form_name || contact.book_name || contact.list_name || contact.source)) || url.searchParams.get('form') || "Integração SendPulse");

        const observations = `Origem SendPulse: ${origin}\n\n=== Status Payload ===\n${JSON.stringify(contact, null, 2)}`;

        // Find the first Stage in the Kanban
        const { data: stages } = await supabaseClient
            .from('stages')
            .select('id')
            .order('order', { ascending: true })
            .limit(1)
            .maybeSingle();

        const stageId = stages?.id || 1;

        // Detect Course ID by scraping the form name
        let courseId = null;
        let courseDefaultVal = 0;
        const { data: courses } = await supabaseClient.from('courses').select('id, name, default_value');
        if (courses && courses.length > 0) {
            const formNameUpper = origin.toUpperCase();
            const matchedCourse = courses.find((c: any) => {
                const courseDbName = String(c.name).toUpperCase();
                return formNameUpper.includes(courseDbName);
            });
            if (matchedCourse) {
                courseId = matchedCourse.id;
                courseDefaultVal = matchedCourse.default_value || 0;
            }
        }

        // Detect Source ID (Site)
        let sourceId = 1; // Default to 1 (Site)
        try {
            const { data: existingSource } = await supabaseClient
                .from('lead_sources')
                .select('id')
                .ilike('name', 'Site')
                .maybeSingle();

            if (existingSource) {
                sourceId = existingSource.id;
            }
        } catch (e) {
            console.error("Erro ao buscar lead_source Site:", e);
        }

        // Base properties that we always provide
        const leadInsertData: any = {
            nome_completo: nameStr,
            email: emailStr,
            telefone: phoneStr || "00000000000",
            stage_id: stageId,
            source_id: sourceId,
            fonte_lead: 'Site',
            observacoes: observations,
            valor_oportunidade: courseDefaultVal,
            data_entrada: new Date().toISOString(),
            curso_interesse: courseId,
            temperatura: 'frio',
        };

        // Insert into Leads table
        const { data: newLead, error: insertError } = await supabaseClient
            .from('leads')
            .insert(leadInsertData)
            .select()
            .maybeSingle();

        if (insertError) {
            console.error("Erro inserindo Lead SendPulse:", JSON.stringify(insertError, null, 2));
            throw insertError;
        }

        console.log("Lead criado com sucesso:", newLead);

        return new Response(JSON.stringify({ success: true, lead: newLead }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: any) {
        console.error("Error processing Sendpulse webhook:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }
});
