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
        const startTime = Date.now();
        const MAX_EXECUTION_MS = 25000; // 25s safety limit (Supabase edge functions timeout at ~30s)

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
                client_secret: '15653f34547a43aeaf40f602cf15ebe3'
            })
        });

        const authData = await authRes.json();
        const token = authData.access_token;
        if (!token) throw new Error("Could not authenticate with Sendpulse API.");

        // 2. Fetch all Addressbooks
        const booksRes = await fetch('https://api.sendpulse.com/addressbooks', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const booksData = await booksRes.json();
        if (!Array.isArray(booksData)) throw new Error("Invalid addressbooks response");

        const allActiveBooks = booksData.filter((b: any) => b.all_email_qty && b.all_email_qty > 0);

        // Fetch courses for filtering and matching
        const { data: coursesForFilter } = await supabaseClient.from('courses').select('id, name, default_value');

        // Exclude obvious student/alumni lists
        const EXCLUDE_PATTERNS = ['ALUNOS', 'ALUMNI', 'FORMADOS', 'EGRESSOS', 'MATRICULADOS'];
        const activeBooks = allActiveBooks.filter((b: any) => {
            const bookNameUpper = String(b.name || '').toUpperCase();
            return !EXCLUDE_PATTERNS.some(pattern => bookNameUpper.includes(pattern));
        });

        console.log(`Addressbooks: ${allActiveBooks.length} total, ${activeBooks.length} elegíveis`);

        // 3. Build dedup sets from existing leads (only email and phone, lightweight)
        const { data: currentLeads } = await supabaseClient.from('leads').select('email, telefone');
        const existingEmails = new Set(currentLeads?.filter((l: any) => l.email).map((l: any) => String(l.email).toLowerCase().trim()));
        const existingPhones = new Set(currentLeads?.filter((l: any) => l.telefone && l.telefone !== '00000000000').map((l: any) => String(l.telefone).replace(/\D/g, '')));

        // 4. Get source and stage IDs
        let sourceId = 1;
        const { data: siteSource } = await supabaseClient.from('lead_sources').select('id').ilike('name', 'Site').maybeSingle();
        if (siteSource) sourceId = siteSource.id;

        const { data: stageData } = await supabaseClient.from('stages').select('id').order('order', { ascending: true }).limit(1).single();
        const stageId = stageData?.id;
        if (!stageId) throw new Error("No initial stage found in Kanban");

        const courses = coursesForFilter;

        // 5. Process books SEQUENTIALLY (not Promise.all) to avoid memory/CPU limits
        let totalInserted = 0;
        let totalSkipped = 0;
        let booksProcessed = 0;
        let timedOut = false;

        for (const book of activeBooks) {
            // Check time budget before each book
            if (Date.now() - startTime > MAX_EXECUTION_MS) {
                timedOut = true;
                console.log(`Tempo limite atingido após ${booksProcessed} books. Continuará na próxima execução.`);
                break;
            }

            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                if (Date.now() - startTime > MAX_EXECUTION_MS) {
                    timedOut = true;
                    break;
                }

                const emailsRes = await fetch(`https://api.sendpulse.com/addressbooks/${book.id}/emails?limit=100&offset=${offset}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const emailsData = await emailsRes.json();

                if (!Array.isArray(emailsData) || emailsData.length === 0) {
                    hasMore = false;
                    break;
                }

                const leadsToInsert: any[] = [];

                for (const contact of emailsData) {
                    const emailLower = contact.email ? String(contact.email).toLowerCase().trim() : "";
                    const phoneRaw = contact.phone ? String(contact.phone) : "";
                    const phoneCleanStr = phoneRaw.replace(/\D/g, '');

                    // Dedup check
                    if ((emailLower && existingEmails.has(emailLower)) || (phoneCleanStr && phoneCleanStr.length >= 8 && existingPhones.has(phoneCleanStr))) {
                        totalSkipped++;
                        continue;
                    }

                    if (emailLower) existingEmails.add(emailLower);
                    if (phoneCleanStr && phoneCleanStr.length >= 8) existingPhones.add(phoneCleanStr);

                    // Parse name
                    let nameStr = "Novo Contato (SendPulse)";
                    if (contact.variables && Array.isArray(contact.variables)) {
                        const nameVar = contact.variables.find((v: any) => v.name?.toLowerCase().includes('nome') || v.name?.toLowerCase() === 'name');
                        if (nameVar && nameVar.value) nameStr = String(nameVar.value).trim();
                    }
                    if (nameStr === "Novo Contato (SendPulse)" && emailLower) {
                        nameStr = emailLower.split('@')[0];
                    }

                    const origin = book.name || "";

                    // Course matching
                    let courseId = null;
                    let courseDefaultVal = 0;
                    if (courses && courses.length > 0) {
                        const formNameUpper = String(origin).toUpperCase();
                        const matchedCourse = courses.find((c: any) => formNameUpper.includes(String(c.name).toUpperCase()));
                        if (matchedCourse) {
                            courseId = matchedCourse.id;
                            courseDefaultVal = matchedCourse.default_value || 0;
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

                // Insert this batch immediately instead of accumulating
                if (leadsToInsert.length > 0) {
                    const { error: insertError } = await supabaseClient.from('leads').insert(leadsToInsert);
                    if (insertError) {
                        console.error(`Erro insert batch (book ${book.name}):`, insertError.message);
                    } else {
                        totalInserted += leadsToInsert.length;
                    }
                }

                offset += 100;
                if (emailsData.length < 100) hasMore = false;
            }

            if (timedOut) break;
            booksProcessed++;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Sync concluída em ${elapsed}s: ${totalInserted} inseridos, ${totalSkipped} duplicados, ${booksProcessed}/${activeBooks.length} books processados`);

        return new Response(JSON.stringify({
            success: true,
            message: timedOut
                ? `Sincronização parcial (${booksProcessed}/${activeBooks.length} books). Continuará na próxima execução.`
                : "Sincronização concluída com sucesso!",
            newLeadsInserted: totalInserted,
            skipped: totalSkipped,
            booksProcessed,
            totalBooks: activeBooks.length,
            partial: timedOut
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
