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

const norm = (s: string) => (s || '').toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// "já preenchi meus dados na página X" -> o lead veio do SITE (LP), não do WhatsApp.
const SITE_ORIGIN_RE = /preenchi\s+meus\s+dados|vim\s+(?:pelo|do|atrav[ée]s\s+do)\s+site|pelo\s+site|no\s+formul[áa]rio\s+d[oa]\s+site/i;

// Casa o nome que a pessoa citou ("página <X>") com o curso, por sobreposição de
// palavras — exige um vencedor claro pra não chutar no genérico ("teologia" sozinho
// bate com 5 cursos). Ex: "Teologia Novo Testamento" -> "Teologia Bíblica e
// Exegética do Novo Testamento" (2 palavras em comum) ganha de "Teologia EAD" (1).
function bestCourseByPhrase(phrase: string, courses: any[]): any | null {
    const pWords = new Set(norm(phrase).split(/\s+/).filter((w) => w.length >= 3));
    if (!pWords.size) return null;
    const scored = courses.map((c) => {
        const cWords = norm(c.name).split(/\s+/).filter((w: string) => w.length >= 3);
        const overlap = cWords.filter((w: string) => pWords.has(w)).length;
        return { c, overlap, frac: cWords.length ? overlap / cWords.length : 0 };
    }).filter((x) => x.overlap > 0).sort((a, b) => b.overlap - a.overlap || b.frac - a.frac);
    if (!scored.length) return null;
    if (scored.length === 1 || scored[0].overlap > scored[1].overlap || scored[0].overlap >= 2) return scored[0].c;
    return null;
}

// Varredura genérica no texto todo — trava: exige o nome inteiro OU >= 2 palavras
// significativas (antes bastava 1, e "teologia" sozinho já bagunçava tudo).
function looseCourseScan(text: string, courses: any[]): any | null {
    const t = norm(text);
    return courses.find((c) => {
        const cn = norm(c.name);
        if (cn && t.includes(cn)) return true;
        const words = cn.split(/\s+/).filter((w: string) => w.length > 4);
        return words.length >= 2 && words.every((w: string) => t.includes(w));
    }) ?? null;
}

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

        // memória durável por telefone: uma vez identificado o setor não-comercial (via
        // agente/fila), toda mensagem SEGUINTE dessa mesma pessoa é bloqueada de novo —
        // mesmo vindo do próprio cliente, sem nome de agente nenhum no payload (senão o
        // lead reaparecia toda vez que o cliente respondia "ok"/"obrigada").
        const phoneSuffix = String(messagePhone || '').replace(/\D/g, '').slice(-8);
        let alreadyBlocked = false;
        if (phoneSuffix.length >= 8) {
            const { data: bl } = await db.from('widechat_blocklist_contacts')
                .select('telefone').eq('telefone', phoneSuffix).maybeSingle();
            alreadyBlocked = !!bl;
        }

        const isNonCommercial = alreadyBlocked ||
            (queueVal && !/comercial/i.test(queueVal) && NON_COMMERCIAL.test(queueVal)) ||
            NON_COMMERCIAL.test(agentName) ||
            NON_COMMERCIAL.test(String(msgData.prefix ?? "")) ||
            (!!agentLc && !agentInRoster);

        if (isNonCommercial && !alreadyBlocked && phoneSuffix.length >= 8) {
            const motivo = queueVal || agentName || 'roster';
            await db.from('widechat_blocklist_contacts')
                .upsert({ telefone: phoneSuffix, motivo }, { onConflict: 'telefone' });
        }

        const CONV_END_WEBHOOKS = ["attendance_end", "finalize", "attendance_closed", "attendance_finish"];
        const CONV_END_EVENTS = ["attendanceEnd", "finalize", "closed", "attendance_end", "finalized", "attendanceClosed", "autoFinish", "humanFinish"];
        // o WideChat manda "Atendimento Finalizado!"/"Conversa finalizada com sucesso!" como
        // mensagem normal do bot (origin=auto), não como um event/webhook.key estruturado — só dá
        // pra pegar pelo TEXTO da mensagem de fechamento.
        const CONV_END_TEXT = /atendimento finalizado|conversa finalizada|atendimento encerrado/i;
        const isConversationEnd = CONV_END_WEBHOOKS.includes(webhookEvent) || CONV_END_EVENTS.includes(eventName)
            || CONV_END_TEXT.test(messageText);
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
            const { data: existing } = await db.from('leads').select('fonte_lead, status_wide, stage_id').eq('id', leadId).maybeSingle();
            const cameFromForm = !!existing?.fonte_lead && existing.fonte_lead !== 'Widechat';
            const justConfirmed = existing?.status_wide !== 'ok_wide';
            // lead "esquecido" (ainda em Entrada) que volta a dar sinal de vida — o Kanban busca só
            // os ~500 mais recentes por data_entrada, então um lead antigo intocado fica invisível
            // pra sempre pro time comercial mesmo com contato novo acontecendo agora. Traz de volta
            // pro topo. Lead que já saiu de Entrada (alguém já está trabalhando) não mexe na data.
            const isStaleReentry = existing?.stage_id === firstStageId;

            const patch: Record<string, unknown> = { updated_at: now };
            if (!cameFromForm) { patch.source_id = sourceId; patch.fonte_lead = 'Widechat'; }
            if (data?.contact_id) patch.widechat_contact_id = data.contact_id;
            if (sessionId) patch.widechat_session_id = sessionId;
            if (justConfirmed) patch.status_wide = 'ok_wide';
            // "Data no Estágio" (stage_entry_date) é o critério de ordenação PADRÃO da coluna no
            // Kanban (não data_entrada) — sem bumpar os dois, o card continua enterrado no fim
            // da lista mesmo com data_entrada corrigida.
            if (isStaleReentry) { patch.data_entrada = now; patch.stage_entry_date = now; }
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
            const { data: cur } = await db.from('leads').select('assigned_to_id, curso_interesse, valor_oportunidade, perfil, stage_id, fonte_lead, source_id').eq('id', leadId).maybeSingle();
            const updates: Record<string, unknown> = {};
            const stillFresh = cur?.stage_id === firstStageId; // ninguém trabalhou o lead ainda

            // ── origem SITE: "já preenchi meus dados na página X" ──────────────
            const cameFromSite = SITE_ORIGIN_RE.test(messageText);
            const pagePhrase = (messageText.match(/p[áa]gina\s+(.+?)(?:\s+e\s+(?:quero|gostaria|preciso|tenho)\b|[.!?\n]|$)/i) ?? [])[1]?.trim() ?? '';
            if (cameFromSite && (!cur?.fonte_lead || cur.fonte_lead === 'Widechat')) {
                updates.source_id = 1; // "Site"
                updates.fonte_lead = pagePhrase ? `Site — ${pagePhrase}` : 'Site';
            }

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

            // atribui pro agente que respondeu. Usa agentName (extraído de content.user.name / prefixo
            // "*Nome:*") — NÃO senderName, que prioriza payload.vars.name (nome do CONTATO, sempre
            // presente, inclusive em mensagens de agente) e por isso quase nunca casava com um agente
            // de verdade (medido: Izabelly 4/24, Karina 2/23 atribuições em 2 dias).
            if (origin === 'agent' && agentName && !cur?.assigned_to_id) {
                const first = agentName.trim().split(' ')[0].toLowerCase();
                const { data: prof } = await db.from('profiles').select('id')
                    .or(`full_name.ilike.%${agentName.trim().toLowerCase()}%,full_name.ilike.%${first}%`).limit(1).maybeSingle();
                if (prof?.id) updates.assigned_to_id = prof.id;
            }

            // agente respondeu e o lead ainda está em "Entrada" (ninguém tinha atendido) →
            // avança pra "Em Contato" sozinho, sem precisar o agente mexer no Kanban.
            if (origin === 'agent' && cur?.stage_id === firstStageId) {
                const { data: emContato } = await db.from('stages').select('id')
                    .ilike('name', '%contato%').order('order', { ascending: true }).limit(1).maybeSingle();
                if (emContato?.id) {
                    updates.stage_id = emContato.id;
                    updates.stage_entry_date = now;
                }
            }

            // curso: preenche se vazio; e CORRIGE um curso errado quando a pessoa cita a
            // página que preencheu e o lead ainda está fresco (o auto-chute anterior errou).
            const canSetCourse = !cur?.curso_interesse || (!!pagePhrase && stillFresh);
            if (canSetCourse && messageText) {
                const { data: courses } = await db.from('courses').select('id, name, default_value');
                const match = (pagePhrase ? bestCourseByPhrase(pagePhrase, courses ?? []) : null)
                    ?? looseCourseScan(messageText, courses ?? []);
                if (match && match.id !== cur?.curso_interesse) {
                    updates.curso_interesse = match.id;
                    if (match.default_value && !cur?.valor_oportunidade) updates.valor_oportunidade = match.default_value;
                }
            }

            if (Object.keys(updates).length) {
                await db.from('leads').update(updates).eq('id', leadId);
                const sets = Object.entries(updates).map(([k, v]) =>
                    k === 'assigned_to_id' ? `assigned_to_id = profiles:⟨${v}⟩`
                    : k === 'curso_interesse' ? `curso_interesse = courses:⟨${v}⟩`
                    : k === 'stage_id' ? `stage_id = stages:⟨${v}⟩`
                    : k === 'source_id' ? `source_id = lead_sources:⟨${v}⟩`
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
