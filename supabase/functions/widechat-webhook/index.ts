import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { pg, mirror, sv, wcToISO } from "../_shared/db.ts";

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

const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        let payload: any;
        try { payload = JSON.parse(await req.text()); } catch { return j({ error: "Invalid JSON" }, 400); }
        const db = pg();

        const { event, data } = payload;
        const webhookEvent = payload.webhook?.key;
        const msgData = data?.content || data || {};

        const messageText = msgData.message || msgData.interactive?.body?.text || msgData.text || "";
        let senderName = payload.vars?.name || data?.user?.name || data?.contact?.name || "";
        const messagePhone = payload.vars?.number || data?.contact?.telephone || data?.content?.to || msgData.platform_id || "";

        if (!senderName && Array.isArray(msgData.placeholders)) {
            const n = msgData.placeholders.find((p: any) => typeof p === 'string' && p.length > 2 && p.includes(' ') && !p.includes(':'));
            senderName = n || (msgData.placeholders[1] ? String(msgData.placeholders[1]) : '');
        }

        const eventName = String(data?.event || event || "");
        const sessionId = data?.session_id || msgData.session_id;
        const channelId = data?.channel_id || msgData.channel_id || "";

        // Só criamos lead das conversas do WhatsApp da FACULDADE (não Escola / outras
        // empresas do grupo). Transcript continua sendo gravado pra todos os canais.
        const LEAD_CHANNELS = (Deno.env.get('WIDECHAT_LEAD_CHANNELS')
            ?? '694534a0132843fbb436bd48').split(',').map(s => s.trim()).filter(Boolean);

        // O número da Faculdade é compartilhado com outros setores do grupo (RH,
        // Secretaria, Escola, Fundação, Igreja). Só queremos a fila FICV - COMERCIAL.
        const queueVal = String(data?.transferHistory?.value ?? "");
        // nome do agente: content.user.name, data.name, ou o prefixo "*Nome:*" da mensagem
        const prefixName = (String(messageText).match(/^\*([^:*]+):\*/) ?? [])[1] ?? "";
        const agentName = String(msgData.user?.name ?? data?.name ?? prefixName ?? "");
        const NON_COMMERCIAL = /\b(RH|secretaria|financeiro|escola|funda[çc][ãa]o|sistema cidade viva|conex[ãa]o de casais)\b/i;
        const agentLc = agentName.toLowerCase().trim();

        // roster da(s) equipe(s) que atendem lead (por padrão só Comercial — ver
        // Equipes no app). Um agente fora da lista = não-comercial.
        const LEAD_TEAMS = (Deno.env.get('WIDECHAT_LEAD_TEAMS') ?? 'Comercial').split(',').map(s => s.trim()).filter(Boolean);
        let agentInRoster = true; // sem agente ainda (fase de bot), ou roster vazio -> não bloqueia por isso
        if (agentLc) {
            const { data: roster } = await db.rpc('agent_names_in_teams', { p_teams: LEAD_TEAMS });
            const names: string[] = (roster ?? []).map((r: any) => r.name);
            // equipe ainda não configurada em Equipes -> não usa o roster como filtro (só os marcadores abaixo)
            if (names.length > 0) agentInRoster = names.some(n => agentLc.includes(n) || n.includes(agentLc));
        }

        const isNonCommercial =
            (queueVal && !/comercial/i.test(queueVal) && NON_COMMERCIAL.test(queueVal)) ||
            NON_COMMERCIAL.test(agentName) ||
            NON_COMMERCIAL.test(String(msgData.prefix ?? "")) ||
            (!!agentLc && !agentInRoster);

        const CONV_END_WEBHOOKS = ["attendance_end", "finalize", "attendance_closed", "attendance_finish"];
        const CONV_END_EVENTS = ["attendanceEnd", "finalize", "closed", "attendance_end", "finalized", "attendanceClosed", "autoFinish", "humanFinish"];
        const isConversationEnd = CONV_END_WEBHOOKS.includes(webhookEvent) || CONV_END_EVENTS.includes(eventName);
        const isAcceptAttendance = webhookEvent === "accept_attendance" || eventName === "humanStart";
        const isSystemNotif = ["messageNotificationAgent", "Read", "Delivered"].includes(eventName);
        const isMessage = !isSystemNotif && (
            eventName.toLowerCase().includes("message") ||
            webhookEvent === "client_message" || webhookEvent === "agent_message" || !!messageText
        );

        // ── raw transcript ────────────────────────────────────────────────────
        if (isMessage && sessionId && messageText && !isSystemMessage(messageText)) {
            let origin = "auto";
            if (eventName === "messageContact" || msgData.origin === "contact" || msgData.origin === "channel") origin = "channel";
            if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message" || msgData.user?.name) origin = "agent";
            const raw = {
                session_id: sessionId, origin,
                sender_name: msgData.user?.name || senderName || "",
                message: messageText,
                platform_id: messagePhone || msgData.platform_id || "",
                message_id: msgData.message_id ?? null,
                created_at: wcToISO(msgData.created_at),
                payload: { channel_id: channelId, event: eventName, wh: webhookEvent, vars: payload.vars, data },
            };
            await db.from('widechat_raw_messages').insert(raw);
            await mirror(`INSERT INTO widechat_raw_messages [{ session_id:${sv(raw.session_id)}, origin:${sv(raw.origin)}, sender_name:${sv(raw.sender_name)}, message:${sv(raw.message)}, platform_id:${sv(raw.platform_id)}, message_id:${sv(raw.message_id)}, created_at:${sv(raw.created_at)} }] RETURN NONE;`);
        }

        if (!isMessage && !isConversationEnd && !isAcceptAttendance)
            return j({ success: true, ignored: true, event: eventName });

        const hasPhone = messagePhone && !["00000000000", ""].includes(messagePhone);
        const hasName = senderName && senderName.trim().length > 0;
        if (!hasPhone && !hasName && !isConversationEnd && !isAcceptAttendance)
            return j({ success: true, skipped: true });

        const TARGET_QUEUE = "FICV - COMERCIAL";
        const queueName = payload.data?.transferHistory?.value;
        const isTransfer = webhookEvent === "attendance_transfer" || payload.data?.event === "humanTransfer";

        // ── achar lead ────────────────────────────────────────────────────────
        let leadId: number | null = null;
        let foundBy = "";
        const findLead = async (col: string, val: string) => {
            const { data } = await db.from('leads').select('id').eq(col, val).limit(1).maybeSingle();
            return data?.id ?? null;
        };
        if (sessionId) { leadId = await findLead('widechat_session_id', sessionId); if (leadId) foundBy = "session"; }
        if (!leadId && data?.contact_id) { leadId = await findLead('widechat_contact_id', data.contact_id); if (leadId) foundBy = "contact_id"; }
        if (!leadId && hasPhone) {
            const suffix = String(messagePhone).replace(/\D/g, '').slice(-8);
            if (suffix.length >= 8) {
                const { data } = await db.from('leads').select('id').ilike('telefone', `%${suffix}%`).limit(1).maybeSingle();
                leadId = data?.id ?? null;
                if (leadId) foundBy = "phone";
            }
        }
        console.log(`event=${eventName} wh=${webhookEvent} lead=${leadId}(${foundBy}) session=${sessionId} nonComm=${isNonCommercial} q=${queueVal} agent=${agentName}`);

        const { data: stg0 } = await db.from('stages').select('id').order('order', { ascending: true }).limit(1).maybeSingle();
        const firstStageId = stg0?.id ?? 1;

        // ── setor não-comercial (RH/Secretaria/Escola/Fundação) ───────────────
        if (isNonCommercial) {
            // se um lead vazou pra esse contato e ninguém da comercial trabalhou nele, remove
            if (leadId) {
                const { data: l } = await db.from('leads')
                    .select('id, assigned_to_id, stage_id').eq('id', leadId).maybeSingle();
                const { count: notes } = await db.from('lead_notes')
                    .select('id', { count: 'exact', head: true }).eq('lead_id', leadId);
                if (l && !l.assigned_to_id && l.stage_id === firstStageId && !notes) {
                    await db.from('widechat_messages').delete().eq('lead_id', leadId);
                    await db.from('widechat_atendimentos').delete().eq('lead_id', leadId);
                    await db.from('leads').delete().eq('id', leadId);
                    await mirror(`DELETE leads:⟨${leadId}⟩; DELETE widechat_messages WHERE lead_id = leads:⟨${leadId}⟩;`);
                    return j({ success: true, ignored: true, reason: `setor não-comercial (${queueVal || agentName}) — lead ${leadId} removido` });
                }
            }
            return j({ success: true, ignored: true, reason: `setor não-comercial (${queueVal || agentName})` });
        }

        // ── accept attendance ─────────────────────────────────────────────────
        if (isAcceptAttendance) {
            const at = {
                lead_id: leadId, protocol: data?.protocol ?? null,
                widechat_agent_id: data?.agent_id ?? null, session_id: sessionId ?? null,
                contact_id: data?.contact_id ?? null, aceito_em: new Date().toISOString(),
            };
            await db.from('widechat_atendimentos').insert(at);
            await mirror(`INSERT INTO widechat_atendimentos [{ lead_id:${leadId ? `leads:⟨${leadId}⟩` : 'NONE'}, protocol:${sv(at.protocol)}, widechat_agent_id:${sv(at.widechat_agent_id)}, session_id:${sv(at.session_id)}, contact_id:${sv(at.contact_id)}, aceito_em:${sv(at.aceito_em)} }] RETURN NONE;`);
            return j({ success: true, lead_id: leadId, action: "attendance_accepted" });
        }

        // ── conversation end ──────────────────────────────────────────────────
        if (isConversationEnd) {
            if (leadId) {
                const { data: st } = await db.from('stages').select('id, name')
                    .or('name.ilike.%finaliz%,name.ilike.%encerr%,name.ilike.%conclu%')
                    .order('order', { ascending: false }).limit(1).maybeSingle();
                if (st?.id) {
                    const now = new Date().toISOString();
                    await db.from('leads').update({ stage_id: st.id, stage_entry_date: now }).eq('id', leadId);
                    await mirror(`UPDATE leads SET stage_id = stages:⟨${st.id}⟩, stage_entry_date = ${sv(now)} WHERE id = leads:⟨${leadId}⟩;`);
                }
            }
            return j({ success: true, lead_id: leadId, action: "conversation_ended" });
        }

        // ── filtro de admissão de lead novo ──────────────────────────────────
        if (isTransfer && queueName && queueName !== TARGET_QUEUE)
            return j({ success: true, ignored: true, reason: `Queue ${queueName} is not ${TARGET_QUEUE}` });
        if (!leadId) {
            // canal errado (Escola / outra empresa do grupo) → só transcript, sem lead
            if (channelId && !LEAD_CHANNELS.includes(channelId))
                return j({ success: true, ignored: true, reason: `channel ${channelId} não é da Faculdade` });
            // sem channel_id identificável → não cria lead novo (estrito)
            if (!channelId)
                return j({ success: true, ignored: true, reason: "sem channel_id — lead novo não criado" });
            const belongsToTargetQueue = !queueName || queueName === TARGET_QUEUE;
            if (!belongsToTargetQueue || (!hasPhone && !hasName))
                return j({ success: true, ignored: true, reason: "Lead admission denied" });
        } else if (channelId && !LEAD_CHANNELS.includes(channelId)) {
            // lead já existe mas veio por canal errado — não mexe nele
            return j({ success: true, ignored: true, reason: `channel ${channelId} não é da Faculdade (lead existente intacto)` });
        }

        // ── source ────────────────────────────────────────────────────────────
        const { data: src } = await db.from('lead_sources').select('id').ilike('name', '%widechat%').limit(1).maybeSingle();
        const sourceId = src?.id ?? 8;

        // ── achar-ou-criar lead (atômico, sem corrida) ───────────────────────
        const now = new Date().toISOString();
        const leadName = senderName.trim() || `Lead WhatsApp - ${messagePhone}`;
        const { data: foc, error: focErr } = await db.rpc('wc_find_or_create_lead', {
            p_session: sessionId ?? null, p_contact: data?.contact_id ?? null,
            p_phone: messagePhone || null, p_name: leadName,
            p_stage_id: firstStageId, p_source_id: sourceId,
        }).single();
        if (focErr) throw focErr;
        leadId = (foc as { lead_id: number }).lead_id;
        const wasCreated = (foc as { created: boolean }).created;

        if (wasCreated) {
            // lead nasceu agora pelo Widechat: o próprio contato via WhatsApp já É a confirmação.
            await mirror(
                `UPDATE seq:leads SET val = math::max([val, ${leadId}]);\n` +
                `INSERT INTO leads [{ id:"${leadId}", nome_completo:${sv(leadName)}, telefone:${sv(messagePhone || "00000000000")}, ` +
                `stage_id:stages:⟨${firstStageId}⟩, source_id:lead_sources:⟨${sourceId}⟩, fonte_lead:"Widechat", ` +
                `widechat_contact_id:${sv(data?.contact_id ?? null)}, widechat_session_id:${sv(sessionId ?? null)}, ` +
                `temperatura:"frio", data_entrada:d${sv(now)}, valor_oportunidade:0, status_wide:"ok_wide" }] RETURN NONE;`
            );
        } else {
            // lead já existia — pode ter vindo antes do formulário do SendPulse (LP → form → link do
            // WhatsApp). Nesse caso NÃO sobrescreve fonte_lead/source_id (preserva a origem/atribuição
            // de marketing), só confirma que o contato de fato prosseguiu pro WhatsApp.
            const { data: existing } = await db.from('leads').select('fonte_lead, status_wide').eq('id', leadId).maybeSingle();
            const cameFromForm = !!existing?.fonte_lead && existing.fonte_lead !== 'Widechat';
            const justConfirmed = existing?.status_wide !== 'ok_wide';

            const patch: Record<string, unknown> = { updated_at: now };
            if (!cameFromForm) { patch.source_id = sourceId; patch.fonte_lead = 'Widechat'; }
            if (data?.contact_id) patch.widechat_contact_id = data.contact_id;
            if (sessionId) patch.widechat_session_id = sessionId;
            if (justConfirmed) patch.status_wide = 'ok_wide';
            await db.from('leads').update(patch).eq('id', leadId);
            const sets = Object.entries(patch).map(([k, v]) => k === 'source_id' ? `source_id = lead_sources:⟨${v}⟩` : `${k} = ${sv(v)}`).join(', ');
            await mirror(`UPDATE leads SET ${sets} WHERE id = leads:⟨${leadId}⟩;`);

            if (justConfirmed) {
                const nota = `✅ Confirmado contato via WhatsApp (${new Date(now).toLocaleDateString('pt-BR')})`;
                await db.from('lead_notes').insert({ lead_id: leadId, note: nota, created_at: now });
                await mirror(`INSERT INTO lead_notes [{ lead_id: leads:⟨${leadId}⟩, note: ${sv(nota)}, created_at: d${sv(now)} }] RETURN NONE;`);
            }
        }

        // ── mensagem ─────────────────────────────────────────────────────────
        let origin = "auto";
        if (eventName === "messageContact" || msgData.origin === "contact") origin = "channel";
        if (msgData.origin === "user" || msgData.origin === "agent" || webhookEvent === "agent_message") origin = "agent";

        if (leadId) {
            const msg = {
                lead_id: leadId, session_id: sessionId || "unknown", message_id: msgData.message_id ?? null,
                type: msgData.type || "text", message: messageText || "[Mídia]", origin,
                sender_name: senderName || "Desconhecido", created_at: wcToISO(msgData.created_at),
            };
            await db.from('widechat_messages').insert(msg);
            await mirror(`INSERT INTO widechat_messages [{ lead_id:leads:⟨${leadId}⟩, session_id:${sv(msg.session_id)}, message_id:${sv(msg.message_id)}, type:${sv(msg.type)}, message:${sv(msg.message)}, origin:${sv(msg.origin)}, sender_name:${sv(msg.sender_name)}, created_at:${sv(msg.created_at)} }] RETURN NONE;`);

            // ── CRM inteligente ───────────────────────────────────────────────
            const { data: cur } = await db.from('leads').select('assigned_to_id, curso_interesse, valor_oportunidade, perfil').eq('id', leadId).maybeSingle();
            const updates: Record<string, unknown> = {};

            // perfil "aluno": telefone casa com matrícula do Sponte
            if (cur?.perfil !== 'aluno' && messagePhone) {
                const { data: al } = await db.rpc('match_aluno_by_phone', { p_phone: messagePhone }).maybeSingle();
                if (al) {
                    updates.perfil = 'aluno';
                    if (!cur?.curso_interesse && al.nome_curso) {
                        const nc = String(al.nome_curso).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                        const { data: cs } = await db.from('courses').select('id, name');
                        const cm = (cs ?? []).find((c: any) => {
                            const cn = (c.name || '').toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                            return cn && nc.includes(cn);
                        });
                        if (cm) updates.curso_interesse = cm.id;
                    }
                }
            }

            if (origin === 'agent' && senderName && senderName !== 'Desconhecido' && !cur?.assigned_to_id) {
                const first = senderName.trim().split(' ')[0].toLowerCase();
                const { data: prof } = await db.from('profiles').select('id')
                    .or(`full_name.ilike.%${senderName.trim().toLowerCase()}%,full_name.ilike.%${first}%`).limit(1).maybeSingle();
                if (prof?.id) updates.assigned_to_id = prof.id;
            }

            if (!cur?.curso_interesse && messageText) {
                const { data: courses } = await db.from('courses').select('id, name, default_value');
                const msgNorm = messageText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                const match = (courses ?? []).find((c: any) => {
                    const cn = (c.name || '').toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                    if (cn && msgNorm.includes(cn)) return true;
                    const words = cn.split(/\s+/).filter((w: string) => w.length > 4);
                    return words.length > 0 && words.every((w: string) => msgNorm.includes(w));
                });
                if (match) {
                    updates.curso_interesse = match.id;
                    if (match.default_value && !cur?.valor_oportunidade) updates.valor_oportunidade = match.default_value;
                }
            }

            if (Object.keys(updates).length) {
                await db.from('leads').update(updates).eq('id', leadId);
                const sets = Object.entries(updates).map(([k, v]) =>
                    k === 'assigned_to_id' ? `assigned_to_id = profiles:⟨${v}⟩`
                    : k === 'curso_interesse' ? `curso_interesse = courses:⟨${v}⟩`
                    : `${k} = ${sv(v)}`).join(', ');
                await mirror(`UPDATE leads SET ${sets} WHERE id = leads:⟨${leadId}⟩;`);
            }
        }

        return j({ success: true, lead_id: leadId });
    } catch (error) {
        console.error("Critical error Widechat webhook:", error);
        return j({ error: (error as Error).message }, 200);
    }
});
