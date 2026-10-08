// vivaconnect-webhook — recebe o webhook de mensagens do Z-PRO (VivaConnect).
//
// URL cadastrada na API do canal no painel do Z-PRO:
//   https://<proj>.supabase.co/functions/v1/vivaconnect-webhook?secret=<vivaconnect_settings.webhook_secret>&channel=<vivaconnect_channels.id>
//
// 1. Sempre grava o payload BRUTO (vivaconnect_webhook_logs) — o schema não é
//    documentado, é daqui que se ajusta o parseWebhook.
// 2. Com vivaconnect_settings.enabled = false, para por aí (modo "só escuta").
// 3. Ligado: casa/cria o lead pelo telefone, grava a mensagem em
//    widechat_messages (provider='vivaconnect') e:
//    - mensagem do NOSSO lado que não saiu da fila (agente digitou no painel do
//      Z-PRO) → trava a IA daquele lead (IA nunca reentra);
//    - canal oficial + aluno (Sponte) → resposta com link do portal (fila);
//    - não-aluno num canal com "IA responde" marcado (vivaconnect_channels.ai_enabled) → IA responde (fila).
// 4. Canal com "Hub do Grupo" (vivaconnect_channels.hub_enabled — o número antigo do Grupo
//    Cidade Viva): contato NOVO (sem lead, não-aluno) passa antes pela triagem (_shared/hub.ts):
//    Faculdade segue o fluxo acima; outra empresa recebe o número novo; sem assunto claro →
//    a IA pergunta de forma natural (nunca um menu numerado).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { mirror, sv } from "../_shared/db.ts";
import { advanceAiStage, fillTemplate, findLeadByPhone, firstName, loadSettings, markAiHandedOff, markHumanReplied, parseWebhook, toZproNumber, zpro, zproErr } from "../_shared/vivaconnect.ts";
import { type HubMsg, loadDestinations, planejar } from "../_shared/hub.ts";

// Bots de IA embutidos do Z-PRO que vêm LIGADOS por padrão em ticket novo
// (ex.: chatgptStatus:true sem chave → nota "Falha na resposta automática").
// Quem responde é a NOSSA IA — desligamos no ticket pra nunca ter 2 bots.
// Typebot/chatflow (menus) ficam como estão.
const ZPRO_AI_FLAGS = ["chatgptStatus", "difyStatus", "dialogflowStatus", "n8nStatus"];

// ── trava: evita ping-pong infinito com OUTRO sistema automático do outro lado ──────
// (pedido do usuário 29/09: "não responder outra IA que entrar em contato com a gente").
// Dois sinais, cada um já basta sozinho:
//   1. a ÚLTIMA fala do "lead" bate com frase típica de autoresponder/bot (fora do
//      horário, "retornaremos em breve", away message, etc.);
//   2. as 2 últimas respostas do "lead" chegaram em MENOS de 5s depois da NOSSA
//      mensagem anterior — ninguém lê e digita uma resposta de verdade tão rápido,
//      2 vezes seguidas; bot sim.
// Ação: marca handed_off (a IA já sai da conversa) + nota no lead, pra um humano dar
// uma olhada — nunca apaga o lead nem o histórico, só para de alimentar o loop.
const AUTORESPONDER_RX = /mensagem\s+autom[aá]tica|resposta\s+autom[aá]tica|fora\s+do\s+hor[aá]rio\s+de\s+atendimento|recebemos\s+(o\s+)?(seu|sua)\s+(contato|mensagem).{0,60}(retornaremos|em\s+breve)|no\s+momento\s+n[aã]o\s+(posso|podemos)\s+(atender|responder)|estou\s+ausente|ausente\s+no\s+momento|away\s+message|out\s+of\s+office|this\s+is\s+an?\s+automat(ed|ic)\s+(reply|response|message)|i.?m\s+currently\s+(away|unavailable)/i;
function detectAutomatedPeer(hist: { origin: string; message: string | null; created_at: string }[]): string | null {
    const lastChannel = hist.find((h) => h.origin === "channel" && h.message); // hist vem DESC
    if (lastChannel?.message && AUTORESPONDER_RX.test(lastChannel.message)) {
        return "a última mensagem do lead parece resposta automática de outro sistema (texto padrão de autoresponder)";
    }
    const asc = [...hist].reverse();
    let fastStreak = 0;
    for (let i = 1; i < asc.length; i++) {
        if (asc[i].origin === "channel" && asc[i - 1].origin !== "channel") {
            const gapMs = new Date(asc[i].created_at).getTime() - new Date(asc[i - 1].created_at).getTime();
            fastStreak = gapMs >= 0 && gapMs < 5000 ? fastStreak + 1 : 0;
            if (fastStreak >= 2) return "as últimas respostas chegaram rápido demais pra ser gente digitando (possível outro bot do outro lado)";
        }
    }
    return null;
}

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const VIVACONNECT_SOURCE = "WhatsApp (VivaConnect)";

Deno.serve(async (req) => {
    if (req.method !== "POST") return j({ ok: true }); // alguns painéis testam a URL com GET
    const url = new URL(req.url);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const settings = await loadSettings(db);
    if (url.searchParams.get("secret") !== settings.webhook_secret) return j({ error: "secret inválido" }, 401);

    const reqChannel = Number(url.searchParams.get("channel")) || null;
    const { data: ch } = reqChannel
        ? await db.from("vivaconnect_channels").select("id, name, purpose, kind, zpro_whatsapp_id, ai_enabled, hub_enabled, zpro_type, zpro_hybrid_mode").eq("id", reqChannel).maybeSingle()
        : { data: null };
    const raw = await req.text();
    let payload: any;
    try { payload = JSON.parse(raw); } catch { payload = { _raw: raw }; }

    const { data: log, error: logErr } = await db.from("vivaconnect_webhook_logs")
        .insert({ channel_id: ch?.id ?? null, payload }).select("id").single();
    if (logErr) console.error("vivaconnect-webhook log:", logErr.message);
    const done = async (outcome: string, leadId: number | null = null) => {
        if (log?.id) await db.from("vivaconnect_webhook_logs").update({ outcome, lead_id: leadId }).eq("id", log.id);
        return j({ ok: true, outcome });
    };

    try {
        if (!settings.enabled) return await done(ch ? "logged:integração desligada" : `logged:integração desligada; canal desconhecido (?channel=${reqChannel ?? "faltando"})`);

        if (!ch) return await done(`ignored:canal desconhecido (?channel=${reqChannel ?? "faltando"})`);
        // canal "modo captura" (Instagram, 30/09) — o payload bruto já foi gravado acima
        // (vivaconnect_webhook_logs); NÃO tenta processar como WhatsApp: o formato real da
        // mensagem do Instagram no Z-PRO nunca foi visto (não tem número de telefone pra
        // casar/criar lead), então parseWebhook/findLeadByPhone/etc. daria resultado
        // imprevisível. Este log bruto é justamente o material pra adaptar o parser depois.
        if (ch.kind === "instagram") return await done("logged:instagram (modo captura — parser ainda não suporta)");
        // número de OUTRA empresa do grupo (só usado pelo Hub pra avisar): nunca vira lead da Faculdade
        if (ch.purpose === "grupo") return await done("ignored:canal de outra empresa do grupo");

        const m = parseWebhook(payload);
        if (!m) return await done("ignored:sem mensagem reconhecível");
        if (m.event && m.event !== "message") return await done(`ignored:evento ${m.event}`);
        if (m.ignorable) return await done("ignored:reação/edição/sistema");
        if (m.isGroup) return await done("ignored:grupo");
        if (!m.number) return await done("ignored:sem número");
        // Lista de bloqueio (Gestão > VivaConnect ou excluir lead com "bloquear número"):
        // ignora ANTES de criar/reabrir lead — excluir o card sozinho não impede uma
        // mensagem nova de criar outro do zero (achado ao vivo 08/10, número do Hub do
        // Grupo da própria FICV num loop bot-contra-bot).
        const blockedNumber = toZproNumber(m.number) ?? m.number;
        const { data: blocked } = await db.from("vivaconnect_blocked_numbers").select("number").eq("number", blockedNumber).maybeSingle();
        if (blocked) return await done("ignored:número bloqueado");
        const botsOn = ZPRO_AI_FLAGS.filter((f) => payload?.ticket?.[f] === true);
        if (botsOn.length && m.ticketId) {
            const { data: tok } = await db.from("vivaconnect_channels").select("api_id, api_token").eq("id", ch.id).single();
            const r = await zpro(settings.base_url, tok, "/updateticketinfo",
                { ticketId: Number(m.ticketId), ...Object.fromEntries(botsOn.map((f) => [f, false])) });
            if (!r.ok) console.error(`vivaconnect-webhook: desligar ${botsOn.join(",")} no ticket ${m.ticketId}:`, zproErr(r.status, r.data));
        }

        // modo do número no Z-PRO (waba/baileys + Híbrido) — base da trava de custo Meta no envio.
        // 28/09: payload de ticket WABA nunca manda `hybridMode` (só canal Baileys manda) — "campo
        // ausente" NÃO é "híbrido desligado". Sem essa distinção, toda mensagem recebida reescrevia
        // zpro_hybrid_mode pra null e apagava até a confirmação MANUAL feita em Gestão > VivaConnect
        // (confirmado ao vivo: usuário confirmava, próxima msg zerava de novo, resposta falhava).
        const zw = payload?.ticket?.whatsapp;
        if (zw && (zw.type != null || "hybridMode" in zw)) {
            const zType = zw.type != null ? String(zw.type) : null;
            const patch: Record<string, unknown> = {};
            if (zType !== (ch as any).zpro_type) patch.zpro_type = zType;
            if ("hybridMode" in zw) {
                const zHyb = zw.hybridMode != null ? String(zw.hybridMode) : null;
                if (zHyb !== (ch as any).zpro_hybrid_mode) patch.zpro_hybrid_mode = zHyb;
            }
            if (Object.keys(patch).length) {
                await db.from("vivaconnect_channels").update({ ...patch, zpro_mode_seen_at: new Date().toISOString() }).eq("id", ch.id);
            }
        }

        if (m.whatsappId && !ch.zpro_whatsapp_id) {
            await db.from("vivaconnect_channels").update({ zpro_whatsapp_id: m.whatsappId }).eq("id", ch.id);
        }

        if (m.messageId) {
            const { data: dup } = await db.from("widechat_messages").select("id")
                .eq("provider", "vivaconnect").eq("message_id", m.messageId).limit(1).maybeSingle();
            if (dup) return await done("ignored:duplicada");
        }

        // eco de envio da nossa fila (1ª mensagem / portal / IA / CRM): o worker já
        // gravou em widechat_messages na hora do envio — não duplica.
        if (m.fromMe) {
            const since = new Date(Date.now() - 10 * 60_000).toISOString();
            const { data: ours } = await db.from("vivaconnect_outbox").select("id")
                .eq("number", toZproNumber(m.number) ?? m.number).in("status", ["sending", "sent"]).gte("created_at", since)
                .eq("body", m.body).limit(1).maybeSingle();
            if (ours) return await done(`ignored:eco do envio #${ours.id}`);
        }
        // fromMe fora da fila = agente digitou direto no painel do Z-PRO
        const origin: "channel" | "agent" = m.fromMe ? "agent" : "channel";

        const aluno = !m.fromMe
            ? (await db.rpc("match_aluno_by_phone", { p_phone: m.number }).maybeSingle()).data
            : null;

        let lead = await findLeadByPhone(db, m.number);
        const leadExisted = !!lead;

        // ── Hub do Grupo: contato novo no número antigo do grupo → triagem ──────
        let hubBacklog: HubMsg[] = [];
        let hubRoutingId: number | null = null;
        if (ch.hub_enabled && !m.fromMe && !aluno && !lead && !m.agentUserId) {
            const r = await hubRouteLocked(db, settings, ch, m, log?.id ?? 0);
            if (r.handled) return await done(r.outcome);
            hubBacklog = r.backlog;
            hubRoutingId = r.routingId;
        }
        if (!lead && !m.fromMe && !(aluno && ch.purpose === "official")) {
            const { data: src } = await db.from("lead_sources").select("id").eq("name", VIVACONNECT_SOURCE).maybeSingle();
            const now = new Date().toISOString();
            const name = String(m.contactName ?? "").trim() || `Lead WhatsApp - ${m.number}`;
            const { data: created, error } = await db.from("leads").insert({
                nome_completo: name, telefone: m.number, stage_id: 1, source_id: src?.id ?? null,
                fonte_lead: `VivaConnect — ${ch.name}`, temperatura: "frio", contact_count: 1,
                data_entrada: now, stage_entry_date: now, valor_oportunidade: 0,
                vivaconnect_channel_id: ch.id, vivaconnect_ticket_id: m.ticketId, vivaconnect_contact_id: m.contactId,
                preferred_contact: "whatsapp",
            }).select("id, nome_completo, perfil, assigned_to_id, vivaconnect_channel_id, curso_interesse, stage_id").single();
            if (error) throw new Error(`criar lead: ${error.message}`);
            lead = created;
            await mirror(
                `UPDATE seq:leads SET val = math::max([val, ${created.id}]);\n` +
                `INSERT INTO leads [{ id:"${created.id}", nome_completo:${sv(name)}, telefone:${sv(m.number)}, ` +
                `stage_id:stages:⟨1⟩, fonte_lead:${sv(`VivaConnect — ${ch.name}`)}, temperatura:"frio", ` +
                `data_entrada:d${sv(now)}, valor_oportunidade:0 }] RETURN NONE;`,
            );
        }

        // precisa estar FORA do if(lead) — usada lá embaixo, já fora do escopo do bloco, na
        // chamada de aiReply() (bug real 02/10: `reopenNote` não existia ali, a function
        // quebrava com "ReferenceError: reopenNote is not defined" e ficava muda, sem
        // responder NADA — nem a mensagem antiga nem a nova lógica de reabertura chegavam a
        // rodar; só apareceu no vivaconnect_webhook_logs.outcome, não em lugar nenhum visível
        // no chat)
        let leadReopened = false;
        if (lead) {
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
            // Segue o canal de CADA mensagem, igual ticket_id/contact_id logo abaixo — não fica
            // "preso" pro sempre no primeiro canal que falou com esse telefone. Achado ao vivo
            // (29/09): lead antigo tinha vivaconnect_channel_id=2 (Secretaria, teste de 26/09) e
            // continuou "dono" da Secretaria mesmo depois de dias de conversa real acontecendo no
            // canal 5 (FICV 2) — ticket_id/contact_id atualizavam certinho a cada mensagem, só o
            // canal ficava congelado, quebrando o acesso por canal (Gestão > VivaConnect > "Quem
            // atende cada canal") e o indicador de canal no card. Comentário antigo ("FIXO no
            // número que mandou a 1ª mensagem") era sobre a fila de 1ª mensagem automática
            // (vivaconnect-api, lead ainda sem conversa) — não sobre webhook de mensagem recebida.
            if (ch.id !== lead.vivaconnect_channel_id) patch.vivaconnect_channel_id = ch.id;
            if (m.ticketId) patch.vivaconnect_ticket_id = m.ticketId;
            if (m.contactId) patch.vivaconnect_contact_id = m.contactId;

            // ── reabertura: mesma regra do widechat-webhook (decisão do usuário 17/09), agora
            // cobrindo Perdido também (28/09, pedido do usuário) ── cliente escreveu num lead
            // Finalizado/Perdido → volta pra Entrada sem agente; se a fala anterior era de agente
            // (conversa humana em andamento) → Em Contato, mantém o agente.
            let reopenNote: string | null = null;
            if (leadExisted && !m.fromMe && lead.stage_id) {
                const { data: st } = await db.from("stages").select("name").eq("id", lead.stage_id).maybeSingle();
                const eraPerdido = st?.name ? /perdid/i.test(st.name) : false;
                if (st?.name && /finaliz|encerr|conclu/i.test(st.name) || eraPerdido) {
                    const { data: last } = await db.from("widechat_messages").select("origin, raw_data")
                        .eq("lead_id", lead.id).eq("interno", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
                    const now = new Date().toISOString();
                    patch.stage_entry_date = now;
                    if (eraPerdido) patch.motivo_perda_id = null; // não é mais um lead perdido
                    // Bug real 07/10: Thayanne clicou "Finalizar" com a Gabriela (mensagem de
                    // despedida sai com origin='auto', kind='farewell' — quem mandou de verdade foi
                    // o botão, não a Gabriela nem a IA). 5min depois ela respondeu só "Muito
                    // obrigada" — a despedida é que ficou sendo a ÚLTIMA mensagem não-interna, então
                    // `last?.origin === "agent"` dava falso e caía no else: tirava a Thayanne do
                    // lead (assigned_to_id=null) e jogava direto pra "IA Atendendo", que respondeu
                    // de novo com uma pergunta de continuação pra uma conversa que já tinha sido
                    // encerrada de propósito minutos antes. Despedida (farewell) conta igual
                    // 'agent' aqui — é sempre um encerramento DELIBERADO (clique humano no painel ou
                    // o cron de desistência depois de 24h parado), nunca o fim de uma IA solta no
                    // meio de assunto.
                    const lastWasFarewell = (last as any)?.raw_data?.kind === "farewell";
                    if (last?.origin === "agent" || lastWasFarewell) {
                        const { data: ec } = await db.from("stages").select("id").ilike("name", "%contato%")
                            .order("order", { ascending: true }).limit(1).maybeSingle();
                        patch.stage_id = ec?.id ?? 1;
                        reopenNote = `🔁 Reaberto para Em Contato (agente mantido) — cliente retomou a conversa pelo VivaConnect após o atendimento ter sido ${eraPerdido ? "marcado como perdido" : "finalizado"}.`;
                    } else {
                        patch.assigned_to_id = null;
                        // ninguém ficou dono desse atendimento → libera a IA de novo (sem isso, o
                        // handed_off de uma resposta humana antiga travava a IA pra sempre, mesmo
                        // depois do atendimento finalizado/perdido e reaberto do zero; 28/09)
                        await db.from("ai_lead_sessions").delete().eq("lead_id", lead.id);
                        // sem agente e o canal tem "IA responde" ligado → já cai direto em "IA
                        // Atendendo" (mesma condição de baixo que decide se a IA vai responder
                        // de verdade); nunca mais passa visualmente por Entrada nesse caso —
                        // pedido do usuário 29/09: "já pode cair diretamente na coluna IA, primeiro".
                        const willAi = ch.ai_enabled && !((!!aluno || lead.perfil === "aluno") && ch.purpose === "official") && !m.agentUserId;
                        if (willAi) {
                            const { data: ia } = await db.from("stages").select("id").ilike("name", "%ia atend%").maybeSingle();
                            patch.stage_id = ia?.id ?? 1;
                            reopenNote = `🔁 Reaberto — a IA volta a atender (${eraPerdido ? "estava marcado como perdido" : "estava finalizado"}).`;
                        } else {
                            patch.stage_id = 1;
                            reopenNote = `🔁 Reaberto para Entrada (sem agente atribuído) — cliente voltou a escrever pelo VivaConnect após o atendimento ter sido ${eraPerdido ? "marcado como perdido" : "finalizado"}.`;
                        }
                    }
                }
            }
            await db.from("leads").update(patch).eq("id", lead.id);
            leadReopened = !!reopenNote;
            if (reopenNote) {
                const now = String(patch.stage_entry_date);
                await db.from("lead_notes").insert({ lead_id: lead.id, note: reopenNote, created_at: now });
                await mirror(
                    `UPDATE leads SET stage_id = stages:⟨${patch.stage_id}⟩, stage_entry_date = d${sv(now)}` +
                    `${"assigned_to_id" in patch ? ", assigned_to_id = NONE" : ""} WHERE id = leads:⟨${lead.id}⟩;\n` +
                    `INSERT INTO lead_notes [{ lead_id: leads:⟨${lead.id}⟩, note: ${sv(reopenNote)}, created_at: d${sv(now)} }] RETURN NONE;`,
                );
            }

            // veio do hub (menu, etc.): leva a conversa da triagem pro chat do lead (contexto da IA/agente)
            if (hubBacklog.length) {
                await db.from("widechat_messages").insert(hubBacklog.map((h) => ({
                    lead_id: lead!.id, provider: "vivaconnect", channel_id: ch.id, session_id: m.ticketId,
                    type: "text", message: h.texto, origin: h.de === "contato" ? "channel" : "auto",
                    sender_name: h.de === "contato" ? m.contactName : null, raw_data: { hub: true }, created_at: h.em,
                })));
            }
            if (hubRoutingId) await db.from("vivaconnect_hub_routings").update({ lead_id: lead.id }).eq("id", hubRoutingId);

            const { error: msgInsertErr } = await db.from("widechat_messages").insert({
                lead_id: lead.id, provider: "vivaconnect", channel_id: ch.id,
                session_id: m.ticketId, message_id: m.messageId,
                type: m.mediaType && m.mediaType !== "chat" && m.mediaType !== "conversation" ? m.mediaType : "text",
                message: m.body, media_url: m.mediaUrl, origin,
                sender_name: m.fromMe ? null : m.contactName, raw_data: payload, created_at: m.sentAt,
            });
            // 29/09, achado ao vivo: resposta de handoff saiu DUPLICADA pro cliente. A checagem
            // de duplicado lá em cima ("olha antes, grava depois") tem uma janela de corrida —
            // Z-PRO reentrega o webhook se a resposta demorar (e demora: só respondemos depois
            // da IA terminar), e a 2ª entrega passava pela checagem ANTES da 1ª acabar de gravar
            // (lead lookup + reabertura no meio do caminho), chamando a IA e mandando a mesma
            // resposta 2x. `widechat_messages_provider_message_id_key` (unique) pega isso de
            // verdade: 23505 aqui = a OUTRA entrega já processou esta mensagem — para tudo, sem
            // tocar em handoff/IA de novo.
            if (msgInsertErr) {
                if (msgInsertErr.code === "23505") return await done("ignored:duplicada (concorrência)", lead.id);
                throw new Error(`gravar mensagem: ${msgInsertErr.message}`);
            }

            // agente respondeu de verdade → IA sai de vez + sobe pra "Em Contato" (só aqui existe
            // conversa humana em andamento). Só ASSUMIU o ticket sem falar nada ainda → IA sai
            // igual, mas o lead volta pra Entrada (fila, botão Atender), não "Em Contato".
            if (m.fromMe) {
                await markHumanReplied(db, lead.id, "Agente respondeu pelo VivaConnect");
            } else if (m.agentUserId) {
                await markAiHandedOff(db, lead.id, "Agente assumiu o ticket no VivaConnect");
            }
        }

        if (m.fromMe) return await done(`stored:${origin}`, lead?.id ?? null);

        // aluno = matrícula ativa no Sponte OU o NOSSO lead já diz que é aluno (perfil/etapa
        // Matriculado). Só o Sponte não basta: o telefone de lá costuma ser outro (caso real
        // 25/09: aluna em Matriculado escreveu no número da secretaria e o Sponte não casou).
        let isStudent = !!aluno || lead?.perfil === "aluno";
        if (!isStudent && lead?.stage_id) {
            const { data: st } = await db.from("stages").select("name").eq("id", lead.stage_id).maybeSingle();
            isStudent = /matricul/i.test(st?.name ?? "");
        }

        // ── canal oficial: aluno → link do portal ───────────────────────────
        if (ch.purpose === "official" && isStudent) {
            if (!settings.student_reply_enabled) return await done("stored:aluno (resposta do portal desligada)", lead?.id ?? null);
            const since = new Date(Date.now() - 24 * 3600_000).toISOString();
            const number = toZproNumber(m.number)!;
            const { data: recent } = await db.from("vivaconnect_outbox").select("id")
                .eq("kind", "student_reply").eq("number", number).gte("created_at", since).limit(1).maybeSingle();
            if (recent) return await done("stored:aluno (portal já enviado nas últimas 24h)", lead?.id ?? null);
            await db.from("vivaconnect_outbox").insert({
                lead_id: lead?.id ?? null, channel_id: ch.id, kind: "student_reply", number,
                body: fillTemplate(settings.student_reply_template, { primeiro_nome: firstName(m.contactName ?? (aluno as any)?.aluno) || "tudo bem" }),
            });
            return await done("stored:aluno → link do portal enfileirado", lead?.id ?? null);
        }

        // ── canal com "IA responde" marcado: IA de vendas ────────────────────
        // isStudent só bloqueia a IA de vendas no canal OFICIAL (ali quem é aluno já saiu
        // acima com o link do portal). Em canal de vendas (pool/marketing), um match de
        // aluno não deve travar a IA: 29/09, achado ao vivo — dois leads de teste (telefones
        // reaproveitados de alunos de teste no Sponte, "Teste Thayanne"/"karina canciano")
        // batiam em match_aluno_by_phone (só últimos 8 dígitos, colisão fácil) e a IA nunca
        // respondia nem 1x, mesmo com o canal "IA responde" ligado — card ficava preso em
        // Entrada pra sempre porque advanceAiStage nunca era chamado.
        if (ch.ai_enabled && lead && !(isStudent && ch.purpose === "official") && !m.agentUserId) {
            const outcome = await aiReply(db, settings, lead.id, ch.id, m.number, leadReopened);
            return await done(`stored:${outcome}`, lead.id);
        }

        return await done("stored", lead?.id ?? null);
    } catch (e) {
        console.error("vivaconnect-webhook:", e);
        return await done(`error:${(e as Error).message}`.slice(0, 500));
    }
});

async function aiReply(db: any, settings: any, leadId: number, channelId: number, number: string, isReopen: boolean): Promise<string> {
    const { data: hist } = await db.from("widechat_messages").select("origin, message, created_at")
        .eq("lead_id", leadId).eq("provider", "vivaconnect").eq("interno", false).order("created_at", { ascending: false }).limit(20);
    const messages = (hist ?? []).reverse()
        .filter((h: any) => h.message)
        .map((h: any) => ({ role: h.origin === "channel" ? "user" : "assistant", content: h.message }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return "ia:sem fala do lead";

    const botPeer = detectAutomatedPeer(hist ?? []);
    if (botPeer) {
        await markAiHandedOff(db, leadId, `Possível robô do outro lado — ${botPeer}`);
        await db.from("lead_notes").insert({
            lead_id: leadId, created_at: new Date().toISOString(),
            note: `🤖⚠️ IA parou de responder — ${botPeer}. Revise manualmente antes de continuar.`,
        });
        return `ia:pulou (${botPeer})`;
    }

    // 1º turno da IA com esse lead (nunca teve ai_lead_sessions: é lead novo, ou reabriu
    // depois de Finalizado/Perdido — o reopen já apaga a sessão antiga): manda o texto FIXO
    // de "1ª mensagem" (Gestão > VivaConnect), não uma saudação inventada pela OpenAI —
    // pedido do usuário 29/09: "você não está respeitando o texto cadastrado". Da 2ª
    // mensagem em diante a conversa segue livre, pela IA de verdade.
    //
    // EXCETO se o contato já falou com a gente há pouco (first_message_skip_hours, padrão
    // 48h) — achado ao vivo: lead pediu contato da Igreja (encerra o atendimento da
    // Faculdade), 12 min depois voltou perguntando de Direito, e levou a saudação inteira
    // de novo porque a sessão tinha sido apagada. Contato recente → pula a saudação, a IA já
    // responde direto ao que foi perguntado (o prompt já instrui a nunca se reapresentar).
    //
    // EXCETO TAMBÉM se for uma REABERTURA de verdade (isReopen, vindo do Finalizado/Perdido lá
    // de cima) — achado ao vivo 02/10: o texto fixo usa {curso} = leads.curso_interesse, que
    // nunca é limpo no encerramento; lead que writeu de novo sobre OUTRO assunto (matrícula do
    // fundamental) recebeu "Recebemos seu interesse no curso de História do Cristianismo"
    // (assunto do atendimento ANTERIOR, já finalizado) — presumindo continuação em vez de
    // perguntar. Reabertura cai direto na IA de verdade, com instrução própria pra perguntar
    // se é o mesmo assunto de antes ou algo novo (`reopened: true` no corpo abaixo) — nunca o
    // texto fixo de 1ª mensagem, que é pra lead literalmente novo vindo de anúncio.
    const { data: sess } = await db.from("ai_lead_sessions").select("lead_id").eq("lead_id", leadId).maybeSingle();

    // Contato ATIVO nosso (a 1ª mensagem saiu de nós, kind='first_message' — "pool, contato
    // ativo" em Gestão > VivaConnect): a IA não pode assumir sozinha a 1ª resposta do lead,
    // pedido do usuário 06/10 ("quando for contato ativo nosso, a IA não pode entrar
    // automaticamente"). Fica em handed_off (igual um agente já ter assumido) até um humano
    // decidir — "Devolver para a IA" no painel. Só vale a 1ª vez (!sess); depois que a sessão
    // existe, segue o fluxo normal de handed_off/reactivate que já existe.
    if (!sess) {
        const { data: activeContact } = await db.from("vivaconnect_outbox").select("id")
            .eq("lead_id", leadId).eq("kind", "first_message").limit(1).maybeSingle();
        if (activeContact) {
            await markAiHandedOff(db, leadId, "Contato ativo nosso — 1ª resposta do lead aguarda atendimento humano");
            return "ia:pulou (contato ativo, aguardando humano)";
        }
    }

    const lastAuto = (hist ?? []).find((h: any) => h.origin === "auto" && h.message);
    const contatoRecente = !!lastAuto && Date.now() - new Date(lastAuto.created_at).getTime() < Number(settings.first_message_skip_hours ?? 48) * 3600_000;
    if (!sess && !isReopen && !contatoRecente && settings.first_message_enabled && String(settings.first_message_template ?? "").trim()) {
        // lead literalmente recém-criado nesta mesma request já pode ter o gatilho do banco
        // (vivaconnect_enqueue_first_message) enfileirado o mesmo texto — não manda 2x.
        const { data: already } = await db.from("vivaconnect_outbox").select("id")
            .eq("lead_id", leadId).eq("kind", "first_message")
            .gte("created_at", new Date(Date.now() - 60_000).toISOString()).limit(1).maybeSingle();
        if (!already) {
            const { data: leadRow } = await db.from("leads")
                .select("nome_completo, courses:curso_interesse(name)").eq("id", leadId).maybeSingle();
            const curso = (leadRow as any)?.courses?.name as string | undefined;
            const nome = firstName(leadRow?.nome_completo ?? "");
            const msg = fillTemplate(settings.first_message_template, {
                primeiro_nome: nome || "tudo bem", curso: curso ?? "",
                curso_trecho: curso ? ` no curso de ${curso}` : "",
            });
            // kind 'ai_reply', não 'first_message': isto é RESPOSTA a uma mensagem que o
            // lead acabou de mandar (reabriu a conversa, ou é lead novo sem o gatilho ainda
            // ter enfileirado) — não é disparo proativo/frio. 'first_message' tem janela de
            // horário + intervalo mínimo por número (proteção contra número cair por disparo
            // em masso pra quem nunca falou com a gente); 'ai_reply' sai na hora, sem essa
            // trava — mesmo risco de responder rápido que já existe pra qualquer outra
            // resposta da IA. 29/09, pedido do usuário: 1ª resposta em ~5s.
            await db.from("vivaconnect_outbox").insert({
                lead_id: leadId, channel_id: channelId, kind: "ai_reply",
                number: toZproNumber(number) ?? number, body: msg,
            });
            await kickOutbox();
        }
        await db.from("ai_lead_sessions").upsert({ lead_id: leadId, status: "active", ai_turns: 0, updated_at: new Date().toISOString() });
        await advanceAiStage(db, leadId, false);
        return "ia:1ª mensagem (texto configurado)";
    }

    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "reply", lead_id: leadId, messages, ...(!sess && isReopen ? { reopened: true } : {}) }),
        signal: AbortSignal.timeout(90000),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return `ia:erro ${out?.error ?? r.status}`;
    if (out.skipped) return `ia:pulou (${out.reason})`;
    // `replies` = a resposta quebrada em BLOCOS (ex.: grade numa mensagem, valores em
    // outra — pedido do usuário 29/09) — cada item vira uma linha própria na fila, todas
    // com o mesmo scheduled_at (agora), pra sair juntas no mesmo kickOutbox como mensagens
    // sequenciais de verdade, não só parágrafos emendados numa mensagem só. `reply` (string
    // única) é fallback se a IA ainda devolver o formato antigo.
    const blocks: string[] = Array.isArray(out.replies) && out.replies.length ? out.replies : (out.reply ? [out.reply] : []);
    if (!blocks.length) return "ia:resposta vazia";
    const num = toZproNumber(number) ?? number;

    // Assunto de OUTRA empresa do grupo (Igreja/Escola/Fundação/etc), mesmo o lead já sendo
    // da Faculdade (29/09, achado ao vivo: "como faço pra ser membro?" — a IA da Faculdade
    // tentava responder sozinha, chutava a empresa errada e ainda fazia handoff pra um
    // consultor da Faculdade sem sentido). ai-agent já reconheceu e devolveu o redirect
    // pronto em `replies` — só falta mandar (kind hub_redirect, mesma regra de custo Meta
    // de um redirect do Hub) e ENCERRAR esse atendimento da Faculdade (não fica pendente
    // esperando um humano da Faculdade agir em algo que não é da Faculdade).
    if (out.otherCompany) {
        for (const body of blocks) await db.from("vivaconnect_outbox").insert({ lead_id: leadId, channel_id: channelId, kind: "hub_redirect", number: num, body });
        await kickOutbox();
        const { data: fin } = await db.from("stages").select("id").or("name.ilike.%finaliz%,name.ilike.%encerr%").limit(1).maybeSingle();
        const now = new Date().toISOString();
        const note = `🔀 Transferência de setor — assunto de "${out.otherCompany.nome}", não da Faculdade. Encaminhado com o contato deles.`;
        if (fin) await db.from("leads").update({ stage_id: fin.id, stage_entry_date: now, updated_at: now }).eq("id", leadId);
        await db.from("lead_notes").insert({ lead_id: leadId, note, created_at: now });
        await db.from("ai_lead_sessions").delete().eq("lead_id", leadId);
        return `ia:transferência de setor → ${out.otherCompany.nome}`;
    }

    for (const body of blocks) {
        await db.from("vivaconnect_outbox").insert({ lead_id: leadId, channel_id: channelId, kind: "ai_reply", number: num, body });
    }
    await kickOutbox();
    await advanceAiStage(db, leadId, !!out.handoff);
    return out.handoff ? "ia:respondeu + handoff" : "ia:respondeu";
}

/** Dispara o worker da fila agora (senão só sai no próximo ciclo do cron, até 1 min). */
async function kickOutbox() {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vivaconnect-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "process_outbox" }),
        signal: AbortSignal.timeout(30000),
    }).catch((e) => console.error("vivaconnect-webhook: process_outbox:", e.message));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HUB_DEBOUNCE_MS = 4000;

/**
 * Um contato por vez + espera curta: se chegar outra mensagem do mesmo número enquanto
 * isso ("Oi" … "quero ser membro"), esta só entra no histórico e a MAIS NOVA decide por todas.
 */
async function hubRouteLocked(db: any, settings: any, ch: any, m: any, logId: number) {
    const number = toZproNumber(m.number) ?? m.number;
    const t0 = Date.now();
    while (!(await db.rpc("hub_try_lock", { p_number: number })).data) {
        if (Date.now() - t0 > 25000) break; // trava presa: segue sem ela
        await sleep(700);
    }
    try {
        await sleep(HUB_DEBOUNCE_MS);
        const sufixo = number.slice(-8);
        const { data: newer } = await db.from("vivaconnect_webhook_logs").select("id, payload")
            .eq("channel_id", ch.id).gt("id", logId).limit(20);
        const chegouOutra = (newer ?? []).some((l: any) => {
            const p = parseWebhook(l.payload);
            return p && !p.fromMe && String(p.number ?? "").endsWith(sufixo);
        });
        return await hubRoute(db, settings, ch, m, chegouOutra);
    } finally {
        await db.from("vivaconnect_hub_locks").delete().eq("number", number);
    }
}

/**
 * Triagem do Hub do Grupo. handled=true → o hub respondeu (perguntou/encaminhou/ignorou) e o
 * webhook para aqui (não vira lead). handled=false → é da Faculdade: segue o fluxo normal
 * levando as falas anteriores da triagem (backlog) pro chat do lead.
 */
async function hubRoute(db: any, settings: any, ch: any, m: any, soAcumular = false): Promise<{ handled: boolean; outcome: string; backlog: HubMsg[]; routingId: number | null }> {
    const number = toZproNumber(m.number) ?? m.number;
    const now = new Date().toISOString();
    const texto = String(m.body ?? "").trim() || "[mídia]";
    const { data: sessao } = await db.from("vivaconnect_hub_routings").select("*")
        .eq("number", number).gte("updated_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (sessao?.status === "faculdade") return { handled: false, outcome: "", backlog: [], routingId: sessao.id };

    const falaEm = m.sentAt ?? now;
    const msgs: HubMsg[] = [...(sessao?.messages ?? []), { de: "contato", texto, em: falaEm }];
    // resposta do hub sempre DEPOIS da fala (ordem certa no chat, mesmo com relógio do WhatsApp adiantado)
    const hubEm = new Date(Math.max(Date.now(), Date.parse(falaEm) + 1000 || 0)).toISOString();
    const dests = await loadDestinations(db);
    const save = async (patch: Record<string, unknown>) => {
        const row = { channel_id: ch.id, number, contact_name: m.contactName ?? sessao?.contact_name ?? null, messages: msgs, updated_at: now, ...patch };
        if (sessao) { await db.from("vivaconnect_hub_routings").update(row).eq("id", sessao.id); return sessao.id as number; }
        const { data } = await db.from("vivaconnect_hub_routings").insert(row).select("id").single();
        return (data?.id ?? null) as number | null;
    };
    // chegou outra mensagem logo depois: guarda esta no histórico e deixa a próxima decidir
    if (soAcumular) {
        await save(sessao ? {} : { status: "perguntando" });
        return { handled: true, outcome: "hub:aguardando próxima mensagem do contato", backlog: [], routingId: null };
    }
    const plano = await planejar(db, { settings, dests, sessao, texto, nome: m.contactName });
    const enqueue = (channelId: number, kind: string, body: string) =>
        db.from("vivaconnect_outbox").insert({ lead_id: null, channel_id: channelId, kind, number, body });

    if (plano.acao === "faculdade") {
        const id = await save({ status: "faculdade", destination_id: plano.destino.id, metodo: plano.metodo, confianca: plano.confianca, motivo: plano.motivo });
        return { handled: false, outcome: "", backlog: msgs.slice(0, -1), routingId: id };
    }
    if (plano.acao === "encaminhar") {
        await enqueue(ch.id, "hub_redirect", plano.redirect);
        msgs.push({ de: "hub", texto: plano.redirect, em: hubEm });
        if (plano.forward && plano.destino.channel_id) await enqueue(plano.destino.channel_id, "hub_forward", plano.forward);
        await save({ status: "encaminhado", destination_id: plano.destino.id, metodo: plano.metodo, confianca: plano.confianca, motivo: plano.motivo, redirected_at: now });
        await kickOutbox();
        return { handled: true, outcome: `hub:encaminhado → ${plano.destino.nome}${plano.forward ? " (+ canal da empresa avisado)" : ""}`, backlog: [], routingId: null };
    }
    if (plano.acao === "perguntar") {
        await enqueue(ch.id, "hub_ask", plano.texto);
        msgs.push({ de: "hub", texto: plano.texto, em: hubEm });
        await save({ status: "perguntando", menus: (sessao?.menus ?? 0) + 1, motivo: plano.motivo });
        await kickOutbox();
        return { handled: true, outcome: "hub:pergunta enviada", backlog: [], routingId: null };
    }
    await save({});
    return { handled: true, outcome: `hub:ignorado (${plano.motivo})`, backlog: [], routingId: null };
}

