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
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 1. Get Sendpulse Token
        const authRes = await fetch('https://api.sendpulse.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: '2cac91a87f0304d8cc5ba849431c260b',
                client_secret: '15653f34547a43aeaf40f602cf15ebe3' // Set explicitly as requested
            })
        });

        const authData = await authRes.json();
        const token = authData.access_token;
        if (!token) throw new Error("Could not authenticate with Sendpulse API. Verifica as credenciais.");

        // 2. Fetch all Addressbooks (mailing lists/forms)
        const booksRes = await fetch('https://api.sendpulse.com/addressbooks', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const booksData = await booksRes.json();
        if (!Array.isArray(booksData)) throw new Error("Invalid addressbooks response");

        // Only process books that actually have emails to save API requests
        const activeBooks = booksData.filter((b: any) => b.all_email_qty && b.all_email_qty > 0);

        // 3. Fetch all current Leads from Supabase to avoid duplicates
        const { data: currentLeads } = await supabaseClient.from('leads').select('email, telefone');
        const existingEmails = new Set(currentLeads?.filter((l: any) => l.email).map((l: any) => String(l.email).toLowerCase().trim()));
        const existingPhones = new Set(currentLeads?.filter((l: any) => l.telefone && l.telefone !== '00000000000').map((l: any) => String(l.telefone).replace(/\D/g, '')));

        // 4b. Detect source_id for 'Site'
        let sourceId = 1;
        const { data: siteSource } = await supabaseClient.from('lead_sources').select('id').ilike('name', 'Site').maybeSingle();
        if (siteSource) sourceId = siteSource.id;

        // 4. Fetch the initial stage ID
        const { data: stages } = await supabaseClient.from('stages').select('id').order('order', { ascending: true }).limit(1).single();
        const stageId = stages?.id;
        if (!stageId) throw new Error("No initial stage found in Kanban");

        // 5. Fetch courses WITH default_value
        const { data: courses } = await supabaseClient.from('courses').select('id, name, default_value');

        // 6. Fetch all emails from all active books
        let totalInserted = 0;
        const leadsToInsert: any[] = [];

        // Promise.all to fetch lists concurrently
        const listsPromises = activeBooks.map(async (book: any) => {
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                const emailsRes = await fetch(`https://api.sendpulse.com/addressbooks/${book.id}/emails?limit=100&offset=${offset}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const emailsData = await emailsRes.json();

                if (!Array.isArray(emailsData) || emailsData.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const contact of emailsData) {
                    const emailLower = contact.email ? String(contact.email).toLowerCase().trim() : "";
                    const phoneRaw = contact.phone ? String(contact.phone) : "";
                    const phoneCleanStr = phoneRaw.replace(/\D/g, '');

                    // Prevent duplicate by generic email or phone match
                    if ((emailLower && existingEmails.has(emailLower)) || (phoneCleanStr && String(phoneCleanStr).length >= 8 && existingPhones.has(phoneCleanStr))) {
                        continue; // Already exists
                    }

                    if (emailLower) existingEmails.add(emailLower);
                    if (phoneCleanStr && String(phoneCleanStr).length >= 8) existingPhones.add(phoneCleanStr);

                    // Parse variables (name)
                    let nameStr = "Novo Contato (SendPulse)";

                    if (contact.variables && Array.isArray(contact.variables)) {
                        // Tenta achar variavel com 'nome', 'name'
                        const nameVar = contact.variables.find((v: any) => v.name?.toLowerCase().includes('nome') || v.name?.toLowerCase() === 'name');
                        if (nameVar && nameVar.value) nameStr = String(nameVar.value).trim();
                    }

                    // Handle case where sometimes only name is provided and it might be email prefix
                    if (nameStr === "Novo Contato (SendPulse)" && emailLower) {
                        nameStr = emailLower.split('@')[0];
                    }

                    const origin = book.name || ""; // Form name like "[O] POS LC"

                    // Detect course mapping
                    let courseId = null;
                    let courseDefaultVal = 0;
                    if (courses && courses.length > 0) {
                        const formNameUpper = String(origin).toUpperCase();
                        const matchedCourse = courses.find((c: any) => formNameUpper.includes(String(c.name).toUpperCase()));
                        if (matchedCourse) {
                            courseId = matchedCourse.id;
                            courseDefaultVal = matchedCourse.default_value || 0; // Agora default_value veio na query!
                        }
                    }

                    const dateEntrada = contact.add_date ? new Date(contact.add_date).toISOString() : new Date().toISOString();

                    leadsToInsert.push({
                        nome_completo: nameStr,
                        email: emailLower,
                        telefone: phoneRaw || "00000000000",
                        stage_id: stageId,
                        source_id: sourceId,
                        observacoes: `Origem API Oficial SendPulse: ${origin}`,
                        valor_oportunidade: courseDefaultVal,
                        data_entrada: dateEntrada,
                        curso_interesse: courseId,
                        temperatura: 'frio',
                        fonte_lead: origin || 'Site'
                    });
                }

                offset += 100;
            }
        });

        await Promise.all(listsPromises);

        // 7. Insert new leads in smaller batches to avoid timeout
        // Split into leads with unique phone vs leads without phone (can't use phone as conflict key)
        const leadsWithPhone = leadsToInsert.filter((l: any) => l.telefone && l.telefone !== '00000000000');
        const leadsWithoutPhone = leadsToInsert.filter((l: any) => !l.telefone || l.telefone === '00000000000');

        const BATCH_SIZE = 50;
        for (let i = 0; i < leadsWithPhone.length; i += BATCH_SIZE) {
            const batch = leadsWithPhone.slice(i, i + BATCH_SIZE);
            const { error: upsertError } = await supabaseClient
                .from('leads')
                .upsert(batch, { onConflict: 'telefone', ignoreDuplicates: true });
            if (upsertError) {
                console.error(`Erro upsert leads batch ${i}:`, upsertError);
            } else {
                totalInserted += batch.length;
            }
        }

        // For leads without phone, use email as duplicate-check (done in-memory above)
        for (let i = 0; i < leadsWithoutPhone.length; i += BATCH_SIZE) {
            const batch = leadsWithoutPhone.slice(i, i + BATCH_SIZE);
            const { error: insertError } = await supabaseClient.from('leads').insert(batch);
            if (insertError) {
                console.error(`Erro insert leads sem telefone batch ${i}:`, insertError);
            } else {
                totalInserted += batch.length;
            }
        }

        return new Response(JSON.stringify({
            success: true,
            message: "Sincronização via API Oficial concluída com sucesso!",
            newLeadsInserted: totalInserted
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: any) {
        console.error("Error syncing SendPulse API:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
