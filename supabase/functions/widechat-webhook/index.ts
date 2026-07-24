import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

// ─── System messages that should be ignored in analysis ──────────────────────
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

// ─── Gemini analysis ──────────────────────────────────────────────────────────
const ANALYSIS_PROMPT = `Você é o Auditor Master de Qualidade da FICV, especializado em auditoria de alta precisão.

PASSO 1 — INVALIDAÇÃO (shouldInvalidate):
INVALIDE quando: conversa é transferência pura; menos de 2 trocas reais; bot/automação sem agente humano; atendimento terminou antes de qualquer interação significativa.
NÃO INVALIDE quando: houve pelo menos 1 pergunta do cliente E 1 resposta real do agente.
Quando shouldInvalidate for true, preencha invalidateReason em 1 frase e scores com valor 5.

PASSO 2 — CLASSIFICAÇÃO (isCommercial):
- false: cliente já é aluno com dúvidas, suporte técnico, processos acadêmicos
- true: objetivo é venda de NOVO curso/produto para lead
No suporte (false), commercial_score recebe 5 neutro; nota final = média de empatia, clareza, profundidade e agilidade.

PASSO 3 — PONTUAÇÃO:
Suporte: resolveu? 9-10. Robótico/não resolveu? <5.
Vendas: tentativa real de fechamento? nota alta. Ignorou? nota baixa.

RETORNE APENAS JSON VÁLIDO (sem markdown):
{"messagesFeedback":[{"index":0,"score":"excelente"|"bom"|"melhorar","feedback":"texto","suggestion":"texto"}],"globalScores":{"empathy":0,"clarity":0,"depth":0,"commercial":0,"agility":0},"isCommercial":false,"shouldInvalidate":false,"invalidateReason":null,"overallConclusion":"texto","improvements":["Ação 1"]}`;

async function analyzeWithGemini(messages: { role: string; text: string }[]): Promise<any> {
    if (!GEMINI_API_KEY) return null;

    const conversation = messages
        .map((m, i) => `[${i}] ${m.role === 'agent' ? 'AGENTE' : 'CLIENTE'}: ${m.text}`)
        .join('\n');

    const body = {
        contents: [{
            parts: [{
                text: `${ANALYSIS_PROMPT}\n\nCONVERSA:\n${conversation}`
            }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    };

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    if (!res.ok) {
        console.error('Gemini error:', await res.text());
        return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    try { return jsonMatch ? JSON.parse(jsonMatch[0]) : null; } catch { return null; }
}

// ─── Heuristic fallback scores ────────────────────────────────────────────────
const EMPATHY_KW   = ['bom dia', 'boa tarde', 'obrigado', 'obrigada', 'posso ajudar', 'fico feliz'];
const CLOSING_KW   = ['posso enviar o link', 'deseja se inscrever', 'quer fazer sua matrícula', 'enviar o link de inscrição', 'fazer a inscrição'];

function heuristicScores(msgs: { role: string; text: string }[]) {
    const empathy    = Math.min(10, msgs.filter(m => EMPATHY_KW.some(k => m.text.toLowerCase().includes(k))).length * 2 + 5);
    const commercial = Math.min(10, msgs.filter(m => CLOSING_KW.some(k => m.text.toLowerCase().includes(k))).length * 4 + 2);
    const clarity    = Math.min(10, msgs.filter(m => m.role === 'agent' && m.text.length > 60).length * 2 + 5);
    const depth      = Math.min(10, msgs.filter(m => m.role === 'agent' && m.text.includes('?')).length * 2 + 3);
    const agility    = msgs.length > 5 ? 9 : 7;
    return { empathy, commercial, clarity, depth, agility };
}

// ─── Analyze a finished session and save to messages_logs ────────────────────
async function analyzeAndSaveSession(supabase: ReturnType<typeof createClient>, sessionData: any): Promise<void> {
    const sessionId  = sessionData.session_id;
    const protocol   = sessionData.protocol || sessionId;
    const contactName = sessionData.name || 'Desconhecido';
    const phone       = sessionData.platform_id || '';

    // Fetch all stored raw messages for this session
    const { data: rawMsgs } = await supabase
        .from('widechat_raw_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    if (!rawMsgs || rawMsgs.length === 0) {
        console.log(`[Analysis] Sem mensagens armazenadas para sessão ${sessionId}. Abortando.`);
        return;
    }

    // Detect agent name (last distinct agent sender)
    const agentNames: string[] = [];
    for (const m of rawMsgs) {
        if (m.origin === 'agent' && m.sender_name && !agentNames.includes(m.sender_name)) {
            agentNames.push(m.sender_name);
        }
    }
    const agentName = agentNames[agentNames.length - 1] || 'Desconhecido';

    // Find entry point of the real agent (ignore bot messages before)
    const agentEntryIdx = rawMsgs.findIndex(m => m.origin === 'agent' && m.sender_name === agentName);
    const relevantRaw   = agentEntryIdx >= 0 ? rawMsgs.slice(agentEntryIdx) : rawMsgs;

    // Build transcript
    const transcript = rawMsgs.map(m => ({
        role: m.origin === 'agent' ? 'agent' as const : 'client' as const,
        text: m.message || '',
        time: m.created_at || m.received_at,
    }));

    // Build AI messages (only relevant, no system noise)
    const aiMessages = relevantRaw
        .filter(m => !isSystemMessage(m.message || ''))
        .map(m => ({ role: m.origin === 'agent' ? 'agent' : 'client', text: m.message || '' }));

    // Count real client messages after agent entry
    const realClientMsgs = aiMessages.filter(m => m.role === 'client');

    // Auto-invalidate if client never responded
    if (realClientMsgs.length === 0) {
        console.log(`[Analysis] Sessão ${sessionId} auto-invalidada: cliente não respondeu.`);
        await supabase.from('messages_logs').upsert({
            protocol,
            agent_name: agentName,
            contact: `${contactName} (${phone})`,
            message_content: JSON.stringify(transcript),
            final_score: 0, empathy_score: 0, clarity_score: 0,
            depth_score: 0, commercial_score: 0, agility_score: 0,
            closing_attempt: false, message_count: 0, is_commercial: true,
            overall_conclusion: 'Invalidado automaticamente: cliente não respondeu após o agente entrar.',
            improvements: [], status: 'invalidated',
            timestamp: rawMsgs[0]?.created_at || new Date().toISOString(),
        }, { onConflict: 'protocol' });
        await supabase.from('widechat_raw_messages').delete().eq('session_id', sessionId);
        return;
    }

    // Run AI analysis (or fall back to heuristics)
    const aiResult = await analyzeWithGemini(aiMessages);

    if (aiResult?.shouldInvalidate) {
        console.log(`[Analysis] Sessão ${sessionId} invalidada pela IA: ${aiResult.invalidateReason}`);
        await supabase.from('messages_logs').upsert({
            protocol,
            agent_name: agentName,
            contact: `${contactName} (${phone})`,
            message_content: JSON.stringify(transcript),
            final_score: 0, empathy_score: 0, clarity_score: 0,
            depth_score: 0, commercial_score: 0, agility_score: 0,
            closing_attempt: false, message_count: relevantRaw.filter(m => m.origin === 'agent').length,
            is_commercial: false, status: 'invalidated',
            overall_conclusion: `Invalidado automaticamente: ${aiResult.invalidateReason}`,
            improvements: [], timestamp: rawMsgs[0]?.created_at || new Date().toISOString(),
        }, { onConflict: 'protocol' });
        await supabase.from('widechat_raw_messages').delete().eq('session_id', sessionId);
        return;
    }

    // Calculate scores
    const h = heuristicScores(aiMessages);
    const scores = {
        empathy:    aiResult?.globalScores?.empathy    ?? h.empathy,
        clarity:    aiResult?.globalScores?.clarity    ?? h.clarity,
        depth:      aiResult?.globalScores?.depth      ?? h.depth,
        commercial: aiResult?.globalScores?.commercial ?? h.commercial,
        agility:    aiResult?.globalScores?.agility    ?? h.agility,
    };
    const isCommercial  = aiResult?.isCommercial ?? true;
    const scoreValues   = isCommercial
        ? [scores.empathy, scores.clarity, scores.depth, scores.commercial, scores.agility]
        : [scores.empathy, scores.clarity, scores.depth, scores.agility];
    const finalScore    = Number((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(1));
    const closingAttempt = aiMessages.some(m => m.role === 'agent' && CLOSING_KW.some(k => m.text.toLowerCase().includes(k)));
    const agentMsgCount  = relevantRaw.filter(m => m.origin === 'agent').length;

    // Apply AI feedback to transcript
    const finalTranscript = transcript.map((m, i) => ({
        ...m,
        feedback: m.role === 'agent'
            ? aiResult?.messagesFeedback?.find((f: any) => f.index === i)?.feedback
            : undefined,
    }));

    await supabase.from('messages_logs').upsert({
        protocol,
        agent_name: agentName,
        contact: `${contactName} (${phone})`,
        message_content: JSON.stringify(finalTranscript),
        final_score: finalScore,
        empathy_score: scores.empathy,
        clarity_score: scores.clarity,
        depth_score: scores.depth,
        commercial_score: scores.commercial,
        agility_score: scores.agility,
        closing_attempt: closingAttempt,
        message_count: agentMsgCount,
        is_commercial: isCommercial,
        status: 'approved',
        overall_conclusion: aiResult?.overallConclusion ?? (finalScore >= 8 ? 'Excelente atendimento.' : 'Atendimento regular.'),
        improvements: aiResult?.improvements ?? [],
        timestamp: rawMsgs[0]?.created_at || new Date().toISOString(),
    }, { onConflict: 'protocol' });

    // Clean up raw messages for this session
    await supabase.from('widechat_raw_messages').delete().eq('session_id', sessionId);

    console.log(`[Analysis] Sessão ${sessionId} analisada → score ${finalScore} (agente: ${agentName})`);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
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

        // Extract fields
        let messageText  = msgData.message || msgData.interactive?.body?.text || msgData.text || "";
        let senderName   = payload.vars?.name || data?.user?.name || data?.contact?.name || "";
        let messagePhone = payload.vars?.number || data?.contact?.telephone || data?.content?.to || msgData.platform_id || "";

        if (!senderName && msgData.placeholders && Array.isArray(msgData.placeholders)) {
            const n = msgData.placeholders.find((p: any) => typeof p === 'string' && p.length > 2 && p.includes(' ') && !p.includes(':'));
            senderName = n || (msgData.placeholders[1] ? String(msgData.placeholders[1]) : '');
        }

        const eventName = String(data?.event || event || "");
        const sessionId = data?.session_id || msgData.session_id;

        // Detect event types
        const CONV_END_WEBHOOKS = ["attendance_end", "finalize", "attendance_closed", "attendance_finish"];
        const CONV_END_EVENTS   = ["attendanceEnd", "finalize", "closed", "attendance_end", "finalized", "attendanceClosed", "autoFinish", "humanFinish"];
        const isConversationEnd = CONV_END_WEBHOOKS.includes(webhookEvent) || CONV_END_EVENTS.includes(eventName);
        const isHumanFinish     = eventName === "humanFinish" || (isConversationEnd && data?.isAttendance === true);
        const isAcceptAttendance = webhookEvent === "accept_attendance" || eventName === "humanStart";
        const isSystemNotif     = ["messageNotificationAgent", "Read", "Delivered"].includes(eventName);
        const isMessage         = !isSystemNotif && (
            eventName.toLowerCase().includes("message") ||
            webhookEvent === "client_message" ||
            webhookEvent === "agent_message" ||
            !!messageText
        );

        // ── Store every real message to widechat_raw_messages (for transcript) ──
        if (isMessage && sessionId && messageText && !isSystemMessage(messageText)) {
            let origin = "auto";
            if (eventName === "messageContact" || msgData.origin === "contact" || msgData.origin === "channel") origin = "channel";
            if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message" || msgData.user?.name) origin = "agent";
            const resolvedSender = msgData.user?.name || senderName || "";

            await supabase.from('widechat_raw_messages').insert({
                session_id:  sessionId,
                origin,
                sender_name: resolvedSender,
                message:     messageText,
                platform_id: messagePhone || msgData.platform_id || "",
                message_id:  msgData.message_id || null,
                created_at:  msgData.created_at ? new Date(msgData.created_at).toISOString() : new Date().toISOString(),
            });
        }

        // Skip non-actionable events
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
        let leadId = null;
        let foundBy = "";
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

        console.log(`event=${eventName} wh=${webhookEvent} lead=${leadId}(${foundBy}) session=${sessionId} isEnd=${isConversationEnd} isHumanFinish=${isHumanFinish}`);

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

        // ── Conversation end ───────────────────────────────────────────────────
        if (isConversationEnd) {
            // Move lead to final stage
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

            // Analyze only real human-finished sessions
            if (isHumanFinish && sessionId) {
                console.log(`[Analysis] Disparando análise para sessão ${sessionId} (${eventName})`);
                // Run async — return 200 immediately to Widechat, analysis continues in background
                analyzeAndSaveSession(supabase, data).catch(e =>
                    console.error('[Analysis] Erro na análise:', e.message)
                );
            }

            return new Response(JSON.stringify({ success: true, lead_id: leadId, action: "conversation_ended", analyzing: isHumanFinish }), {
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

        // ── Store message in widechat_messages (for CRM kanban view) ──────────
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
