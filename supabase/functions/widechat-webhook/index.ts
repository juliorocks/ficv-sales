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

        const eventName = String(data?.event || event || "");

        // Detect conversation end events (before isMessage filter)
        // IMPORTANT: Use exact matches only — "attendance" contains "end" and "attend" as substrings,
        // so substring checks would incorrectly flag attendance_transfer as a conversation end.
        const CONVERSATION_END_WEBHOOK_EVENTS = ["attendance_end", "finalize", "attendance_closed"];
        const CONVERSATION_END_EVENT_NAMES = ["attendanceEnd", "finalize", "closed", "attendance_end", "finalized", "attendanceClosed"];
        const isConversationEnd =
            CONVERSATION_END_WEBHOOK_EVENTS.includes(webhookEvent) ||
            CONVERSATION_END_EVENT_NAMES.includes(eventName);

        // Filter out system notification events (not real messages)
        const isSystemNotification = ["messageNotificationAgent", "Read", "Delivered"].includes(eventName);

        const isMessage = !isSystemNotification && (
            eventName.toLowerCase().includes("message") ||
            webhookEvent === "client_message" ||
            webhookEvent === "agent_message" ||
            !!messageText
        );

        // Skip if not a message and not a conversation end
        if (!isMessage && !isConversationEnd) {
            console.log(`Evento ignorado: ${eventName}`);
            return new Response(JSON.stringify({ success: true, ignored: true, event: eventName }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        // Require at minimum a valid phone or name to find lead
        const hasPhone = messagePhone && !["00000000000", ""].includes(messagePhone);
        const hasName = senderName && senderName.trim().length > 0;

        if (!hasPhone && !hasName && !isConversationEnd) {
            console.log("Skipping: no phone or name available");
            return new Response(JSON.stringify({ success: true, skipped: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        const sessionId = data.session_id || msgData.session_id;

        const TARGET_QUEUE = "FICV - COMERCIAL";
        const queueName = payload.data?.transferHistory?.value;
        const isTransfer = webhookEvent === "attendance_transfer" || payload.data?.event === "humanTransfer";

        // --- Find existing lead ---
        let leadId = null;
        let foundBy = "";

        // 1. By session_id (Strongest link for active interactions)
        if (sessionId) {
            const { data: l } = await supabaseClient.from('leads').select('id').eq('widechat_session_id', sessionId).maybeSingle();
            if (l) { leadId = l.id; foundBy = "session"; }
        }

        // 2. By contact_id
        if (!leadId && data?.contact_id) {
            const { data: l } = await supabaseClient.from('leads').select('id').eq('widechat_contact_id', data.contact_id).maybeSingle();
            if (l) { leadId = l.id; foundBy = "contact_id"; }
        }

        // 3. By phone (Fuzzy matching)
        if (!leadId && hasPhone) {
            const cleanPhone = String(messagePhone).replace(/\D/g, '');
            if (cleanPhone.length >= 8) {
                const suffix = cleanPhone.slice(-8);
                const { data: l } = await supabaseClient.from('leads').select('id').filter('telefone', 'ilike', `%${suffix}%`).limit(1).maybeSingle();
                if (l) { leadId = l.id; foundBy = "phone"; }
            }
        }

        console.log(`Lead status: leadId=${leadId}, foundBy=${foundBy}, isTransfer=${isTransfer}, queue=${queueName}, isConversationEnd=${isConversationEnd}`);

        // --- Handle conversation end ---
        if (isConversationEnd) {
            if (leadId) {
                const { data: finalStage } = await supabaseClient
                    .from('stages')
                    .select('id, name')
                    .or('name.ilike.%finaliza%,name.ilike.%encerra%,name.ilike.%conclu%')
                    .order('order', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (finalStage) {
                    await supabaseClient.from('leads').update({
                        stage_id: finalStage.id,
                        stage_entry_date: new Date().toISOString()
                    }).eq('id', leadId);
                    console.log(`Lead ${leadId} movido para estágio "${finalStage.name}" (Finalizados)`);
                } else {
                    console.log("Estágio 'Finalizados' não encontrado no banco");
                }
            }
            return new Response(JSON.stringify({ success: true, lead_id: leadId, action: "conversation_ended" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        // --- Filter Logic for new leads ---
        // 1. If it's a transfer to a DIFFERENT queue, stop here
        if (isTransfer && queueName && queueName !== TARGET_QUEUE) {
            console.log(`Ignorando: Transferência para fila diferente: ${queueName}`);
            return new Response(JSON.stringify({ success: true, ignored: true, reason: `Queue ${queueName} is not ${TARGET_QUEUE}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        // 2. If lead doesn't exist, create it for any event that belongs to our queue
        // Accept: transfers to FICV - COMERCIAL, messages with valid phone/name, or events without queue info (default to our queue)
        if (!leadId) {
            const belongsToTargetQueue = !queueName || queueName === TARGET_QUEUE;
            if (belongsToTargetQueue && (hasPhone || hasName)) {
                console.log(`Admitindo novo lead (queue=${queueName || 'default'}, phone=${hasPhone}, name=${hasName})`);
            } else {
                console.log(`Ignorando: Lead não encontrado, sem dados suficientes ou fila diferente (queue=${queueName || 'n/a'}, phone=${hasPhone}, name=${hasName})`);
                return new Response(JSON.stringify({
                    success: true,
                    ignored: true,
                    reason: "Lead admission denied: insufficient data or wrong queue"
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
        let origin = "auto";
        if (eventName === "messageContact" || msgData.origin === "contact") origin = "channel";
        if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message") origin = "agent";

        if (leadId) {
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

            // --- INTELLIGENT CRM UPDATES ---
            const { data: currentLead } = await supabaseClient
                .from('leads')
                .select('assigned_to_id, curso_interesse, valor_oportunidade')
                .eq('id', leadId)
                .maybeSingle();

            const intelligentUpdates: any = {};

            // 1. AUTO-ASSIGN AGENT: When an agent sends a message, match their name to a profile
            if (origin === 'agent' && senderName && senderName !== 'Desconhecido' && !currentLead?.assigned_to_id) {
                const firstName = senderName.trim().split(' ')[0];
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('id, full_name')
                    .or(`full_name.ilike.%${senderName.trim()}%,full_name.ilike.%${firstName}%`)
                    .limit(1)
                    .maybeSingle();

                if (profile) {
                    intelligentUpdates.assigned_to_id = profile.id;
                    console.log(`[CRM Auto] Atendente detectado: ${profile.full_name} → lead ${leadId}`);
                } else {
                    console.log(`[CRM Auto] Agente "${senderName}" não encontrado em profiles`);
                }
            }

            // 2. AUTO-DETECT COURSE: Scan all messages for course keywords
            if (!currentLead?.curso_interesse && messageText) {
                const { data: courses } = await supabaseClient
                    .from('courses')
                    .select('id, name, default_value');

                if (courses && courses.length > 0) {
                    const msgLower = messageText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const matchedCourse = courses.find((c: any) => {
                        const courseLower = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        // Match full name or significant words (>4 chars)
                        if (msgLower.includes(courseLower)) return true;
                        const words = courseLower.split(/\s+/).filter((w: string) => w.length > 4);
                        return words.length > 0 && words.every((w: string) => msgLower.includes(w));
                    });

                    if (matchedCourse) {
                        intelligentUpdates.curso_interesse = matchedCourse.id;
                        if (matchedCourse.default_value && !currentLead?.valor_oportunidade) {
                            intelligentUpdates.valor_oportunidade = matchedCourse.default_value;
                        }
                        console.log(`[CRM Auto] Curso detectado: "${matchedCourse.name}" → lead ${leadId}`);
                    }
                }
            }

            // Apply intelligent updates if any
            if (Object.keys(intelligentUpdates).length > 0) {
                await supabaseClient.from('leads').update(intelligentUpdates).eq('id', leadId);
                console.log(`[CRM Auto] Updates aplicados ao lead ${leadId}:`, intelligentUpdates);
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
