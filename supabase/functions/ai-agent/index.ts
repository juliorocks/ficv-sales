// ai-agent — motor de conversa da IA de atendimento (VivaConnect).
//
// action "reply" (padrão):
//   { messages: [{role:'user'|'assistant', content}], lead_id?, lead?: {nome, curso}, dry_run? }
//   → { replies: string[], reply (= replies.join), handoff, handoff_reason, summary, sources[], skipped? }
//   `replies` é o texto quebrado em BLOCOS — cada item vira uma mensagem separada de
//   verdade no WhatsApp (bolhas diferentes), não parágrafos amontoados numa mensagem só
//   (29/09, pedido do usuário: "grade" e "valores" pedidos juntos merecem 2 mensagens).
//   Com lead_id (e sem dry_run) aplica a TRAVA: se a sessão do lead não está
//   'active' (já houve handoff / IA desligada), NÃO responde — devolve skipped.
//   O playground da tela manda dry_run sem lead_id: não grava nada.
//
// action "takeover"   { lead_id, reason? } → agente humano assumiu: IA sai de vez.
// action "reactivate" { lead_id }          → admin devolve o lead pra IA.
// action "followup"   { lead_id }          → cron de reengajamento (ver cron_ai_followups).
//
// Quem chama em produção (futuro vivaconnect-webhook) usa a service role key.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { chatJSON, corsHeaders, identify, isAdmin, isStaff, jsonRes, searchKnowledge } from "../_shared/ai.ts";
import { mirror, sv } from "../_shared/db.ts";
import { fillTemplate, firstName } from "../_shared/vivaconnect.ts";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Rede de segurança: o prompt já pede pra formatar como WhatsApp (\n\n entre ideias),
 * mas numa conversa longa e cheia de respostas antigas sem quebra o modelo tende a
 * imitar o próprio histórico e ignora a instrução (achado ao vivo 29/09). Se ainda
 * assim vier tudo num parágrafo só, quebra por frase aqui — nunca manda bloco corrido.
 */
function ensureLineBreaks(text: string): string {
    if (!text || text.includes("\n")) return text;
    // .split() nunca perde conteúdo (ao contrário de .match(/g), que ignora trechos sem
    // bater no padrão) — achado ao vivo: ".sjc" de "jcs.sjc" batia como fim de frase e
    // comia o resto. Só corta depois de .!? seguido de espaço + maiúscula/dígito (início
    // de frase nova de verdade), nunca no meio de um e-mail/username/decimal.
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length < 2) return text;
    const first = sentences[0];
    const last = sentences[sentences.length - 1];
    const middle = sentences.slice(1, -1).join(" ");
    return [first, middle, last].filter(Boolean).join("\n\n");
}

/**
 * Acha o documento (PPC) da base que corresponde ao curso do lead, comparando o NOME
 * do curso contra os TÍTULOS da base — não usa embedding aqui de propósito: com poucos
 * documentos (~15-20 "vendas"), comparar palavra a palavra em memória é mais confiável do
 * que confiar na busca por similaridade pra decidir QUAL documento é (achado ao vivo
 * 29/09: pra uma pergunta curta tipo "qual as disciplinas?", a busca vetorial trouxe o PPC
 * de outro curso como resultado nº1).
 */
async function findCourseDoc(db: any, curso: string | null | undefined): Promise<string | null> {
    if (!curso) return null;
    const { data: docs } = await db.from("knowledge_base").select("id, title")
        .in("publico", ["vendas", "ambos"]).eq("index_status", "ready").eq("ai_enabled", true);
    if (!docs?.length) return null;
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const stop = new Set(["pos", "graduacao", "curso", "em", "de", "da", "do", "dos", "das", "e", "a", "o", "ead", "presencial"]);
    const words = norm(curso).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
    if (!words.length) return null;
    let best: { id: string; score: number } | null = null;
    for (const d of docs as { id: string; title: string }[]) {
        const t = norm(d.title ?? "");
        const score = words.filter((w) => t.includes(w)).length;
        if (score > 0 && (!best || score > best.score)) best = { id: d.id, score };
    }
    // exige bater a MAIORIA das palavras significativas do nome do curso — evita pegar
    // um PPC qualquer só porque uma palavra genérica coincidiu
    return best && best.score >= Math.ceil(words.length * 0.6) ? best.id : null;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const caller = await identify(req, db);
    if (!isStaff(caller)) return jsonRes({ error: "Não autorizado." }, 401);

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "reply";
        const leadId: number | null = body.lead_id ? Number(body.lead_id) : null;

        // ── follow-up (chamado pelo cron vivaconnect-ai-followups) ──────────
        // Lead ficou quieto depois da última mensagem NOSSA: escreve UMA mensagem de
        // reengajamento com base no histórico de verdade da conversa, não um texto fixo
        // ("com base no histórico, nas últimas interações" — pedido do usuário 29/09).
        if (action === "followup") {
            if (!leadId) return jsonRes({ error: "lead_id obrigatório." }, 400);
            const { data: s } = await db.from("ai_agent_settings").select("*").eq("id", 1).single();
            if (!s) return jsonRes({ error: "Configuração da IA não encontrada." }, 500);
            if (!s.enabled || !s.followup_enabled) return jsonRes({ skipped: true, reason: "follow-up desligado" });
            const { data: hist } = await db.from("widechat_messages").select("origin, message")
                .eq("lead_id", leadId).eq("provider", "vivaconnect").order("created_at", { ascending: false }).limit(20);
            const histMsgs: Msg[] = (hist ?? []).reverse().filter((h: any) => h.message)
                .map((h: any) => ({ role: h.origin === "channel" ? "user" : "assistant", content: h.message }));
            if (!histMsgs.length) return jsonRes({ skipped: true, reason: "sem histórico" });
            const { data: l } = await db.from("leads")
                .select("nome_completo, courses:curso_interesse(name)").eq("id", leadId).maybeSingle();
            const nome = firstName(l?.nome_completo ?? "");
            const curso = (l as any)?.courses?.name as string | undefined;
            const agora = new Date().toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric",
                hour: "2-digit", minute: "2-digit",
            });
            const system = [
                s.system_prompt,
                `Seu nome é ${s.agent_name}. Agora é ${agora} (horário de Brasília).`,
                `O lead${nome ? ` (${nome})` : ""}${curso ? `, interessado em ${curso},` : ""} ficou um tempo sem responder depois da sua última mensagem na conversa abaixo. Escreva UMA mensagem curta e natural de reengajamento — NUNCA um "oi, tudo bem?" genérico. Retome o assunto específico de vocês (o curso, a dúvida, a condição que estavam discutindo) com leveza, como quem lembrou de continuar uma conversa, não como cobrança. Se fizer sentido, ofereça ajudar com o próximo passo (ex.: valores, matrícula, tirar mais dúvidas). NÃO se apresente de novo (você já se apresentou nesta conversa). NÃO diga explicitamente "faz um tempo que você não responde" nem nada que soe como pressão.`,
                `Responda em JSON: {"reply": "a mensagem de follow-up — pule uma linha (\\n\\n) se precisar de mais de uma ideia, senão 1 frase só já resolve"}`,
            ].join("\n\n");
            const { json } = await chatJSON(s.chat_model, Number(s.temperature), [{ role: "system", content: system }, ...histMsgs]);
            const reply = ensureLineBreaks(String(json.reply ?? "").trim());
            return jsonRes({ reply: reply || null });
        }

        if (action === "takeover" || action === "reactivate") {
            if (!leadId) return jsonRes({ error: "lead_id obrigatório." }, 400);
            if (action === "reactivate" && !isAdmin(caller)) return jsonRes({ error: "Só admin reativa a IA." }, 403);
            const now = new Date().toISOString();
            const row = action === "takeover"
                ? { lead_id: leadId, status: "handed_off", handoff_reason: body.reason ?? "Agente assumiu a conversa", handed_off_at: now, updated_at: now }
                : { lead_id: leadId, status: "active", ai_turns: 0, handoff_reason: null, handoff_summary: null, handed_off_at: null, updated_at: now };
            const { error } = await db.from("ai_lead_sessions").upsert(row);
            if (error) return jsonRes({ error: error.message }, 500);
            return jsonRes({ ok: true, status: row.status });
        }

        if (action !== "reply") return jsonRes({ error: `Ação desconhecida: ${action}` }, 400);

        const messages: Msg[] = (body.messages ?? [])
            .filter((m: Msg) => m?.content && (m.role === "user" || m.role === "assistant"))
            .slice(-20);
        if (!messages.length || messages[messages.length - 1].role !== "user") {
            return jsonRes({ error: "A última mensagem precisa ser do lead (role 'user')." }, 400);
        }
        const dryRun = !!body.dry_run || !leadId;

        const { data: s, error: sErr } = await db.from("ai_agent_settings").select("*").eq("id", 1).single();
        if (sErr || !s) return jsonRes({ error: "Configuração da IA não encontrada." }, 500);

        // ── TRAVA: IA nunca reentra depois do handoff ──────────────────────
        let session: any = null;
        if (leadId) {
            session = (await db.from("ai_lead_sessions").select("*").eq("lead_id", leadId).maybeSingle()).data;
            if (session && session.status !== "active") {
                return jsonRes({ skipped: true, reason: `IA fora deste lead (status: ${session.status}).` });
            }
            if (!dryRun && !s.enabled) {
                return jsonRes({ skipped: true, reason: "IA desligada nas configurações." });
            }
        }

        // ── contexto do lead ────────────────────────────────────────────────
        let lead = body.lead ?? null;
        if (leadId && !lead) {
            const { data: l } = await db.from("leads")
                .select("nome_completo, curso_interesse, courses:curso_interesse(name)")
                .eq("id", leadId).maybeSingle();
            if (l) lead = { nome: l.nome_completo, curso: (l as any).courses?.name ?? null };
        }

        // ── busca na base: últimas falas do lead viram a consulta ───────────
        const query = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join("\n");
        const lastMsg = messages[messages.length - 1].content;
        const hits = await searchKnowledge(db, lead?.curso ? `${lead.curso}\n${query}` : query, {
            publico: "vendas", embeddingModel: s.embedding_model, count: s.match_count, minSimilarity: Number(s.min_similarity),
            focus: lastMsg,
        });

        // Pedido de lista COMPLETA (grade, disciplinas, ementa, módulos): os `match_count`
        // trechos por similaridade (6 por padrão) não bastam pra cobrir um PPC inteiro (pode
        // ter 40+ trechos) — o lead pergunta "quais as disciplinas?" e a IA só via uma
        // amostra, respondia "algumas" e parava por aí (achado ao vivo 29/09, lead Thayanne
        // Sales). Quando detecta esse pedido, troca a base desta resposta por TODOS os
        // trechos do PPC do curso, na ordem — garante completude de verdade, não só pede pro
        // modelo "não resumir". Achar o documento certo pela busca por similaridade (hits[0])
        // não é confiável o bastante pra isso (testado ao vivo: "qual as disciplinas?" sozinho
        // trouxe PPC de OUTRO curso como 1º resultado) — em vez disso casa o nome do curso do
        // lead direto contra os títulos da base (poucos documentos, ~15-20; dá pra comparar
        // todos em memória, sem depender de embedding pra achar QUAL documento é).
        // frase informal ("quero a grade", "qual as disciplinas" — concordância errada é comum
        // em português falado) conta igual: qualquer menção a grade/disciplina/ementa/módulo/
        // currículo já é sinal de que o lead quer o conteúdo de verdade, não um resumo de 2 linhas.
        const wantsFullList = /\bgrade\b|\bdisciplinas?\b|\bementa\b|\bm[oó]dulos?\b|curr[íi]culo|conte[uú]do\s+program[áa]tico/i.test(lastMsg);
        let fullDocUsed: string | null = null;
        let knowledgeHits = hits ?? [];
        if (wantsFullList) {
            const docId = await findCourseDoc(db, lead?.curso) ?? (knowledgeHits[0] as any)?.document_id ?? null;
            if (docId) {
                const { data: allChunks } = await db.from("knowledge_chunks")
                    .select("content, chunk_index").eq("document_id", docId).order("chunk_index").limit(80);
                if (allChunks?.length) {
                    const { data: docRow } = await db.from("knowledge_base").select("title").eq("id", docId).maybeSingle();
                    fullDocUsed = docRow?.title ?? (knowledgeHits[0] as any)?.title ?? null;
                    // SOMA ao que a busca normal já achou, não substitui — o PPC não tem preço/
                    // desconto (isso mora em "Orientações Gerais", um documento à parte); trocar
                    // a base inteira pelo PPC completo deixava a IA sem saber responder "valores"
                    // na mesma conversa (achado ao vivo 29/09, lead Thayanne: grade completa saiu
                    // certa, mas "e os valores?" foi pro vazio/handoff por falta de contexto).
                    const seen = new Set(knowledgeHits.map((h: any) => String(h.content).slice(0, 120)));
                    const extra = allChunks
                        .filter((c: any) => !seen.has(String(c.content).slice(0, 120)))
                        .map((c: any) => ({ document_id: docId, title: fullDocUsed, category: "", similarity: 1, content: c.content }));
                    knowledgeHits = [...extra, ...knowledgeHits];
                }
            }
        }

        const knowledge = knowledgeHits.length
            ? (knowledgeHits as any[]).map((h, i) => `[${i + 1}] ${h.content}`).join("\n\n---\n\n")
            : "(nenhum trecho relevante encontrado na base de conhecimento)";

        const leadCtx = lead
            ? `Dados do lead: nome ${lead.nome ?? "desconhecido"}${lead.curso ? `; curso de interesse informado no formulário: ${lead.curso}` : ""}.`
            : "Dados do lead: não informados.";

        // o modelo não sabe a data de hoje (chutava 2024) — manda sempre no fuso de Brasília
        const agora = new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
        const system = [
            s.system_prompt,
            `Seu nome é ${s.agent_name}.`,
            `Agora é ${agora} (horário de Brasília). Use essa data para "hoje", prazos e saudações (bom dia/boa tarde/boa noite).
Se a base de conhecimento citar uma data que JÁ PASSOU (início de aulas, prazo de matrícula, promoção "deste mês"), não a apresente como futura nem garanta que ainda vale: diga que um consultor vai confirmar a próxima data/condição e faça o handoff (handoff=true).`,
            s.handoff_instructions,
            leadCtx,
            `BASE DE CONHECIMENTO (use só isto como fonte de fatos)${fullDocUsed ? ` — o lead pediu a lista completa de "${fullDocUsed}", isto AQUI É O DOCUMENTO INTEIRO, liste TODOS os itens relevantes que aparecerem, não resuma pra "alguns"` : ""}:\n\n${knowledge}`,
            `Quando o lead pedir uma LISTA COMPLETA de algo (disciplinas, grade, módulos, ementa) e a base tiver essa informação, liste TODOS os itens que a base mostrar — nunca corte pra "algumas" ou "principais" quando a pessoa pediu "todas"/"completa". Só resuma se a lista for enorme (20+ itens); mesmo assim avise que está resumindo e pergunte se quer a lista completa.`,
            `Formate cada item do array "replies" como uma mensagem de WhatsApp de verdade: frases curtas, e pule uma linha (\\n\\n) entre ideias diferentes dentro do MESMO item (ex.: a saudação numa linha, o assunto principal em outra) — nunca um parágrafo gigante. Quando o lead pedir DUAS (ou mais) COISAS na mesma mensagem (ex.: "quero a grade e depois os valores", "quais as disciplinas e o valor"), responda TODAS elas, sem exceção — cada uma num item SEPARADO do array "replies", na ordem pedida. NUNCA responda só a primeira e pare: se esquecer da segunda, o lead fica sem a resposta que pediu (isso já aconteceu e é o pior erro possível aqui). "replies" só tem 1 item quando o pedido era mesmo uma coisa só.`,
            `Se já existe QUALQUER mensagem sua (role "assistant") no histórico abaixo, você já se apresentou antes nesta conversa — NUNCA se apresente de novo ("Oi, aqui é a ${s.agent_name}...") nem repita a saudação de abertura, mesmo que a última fala do lead seja só um cumprimento curto ("oi", "olá", "bom dia"). Isso vale mesmo que pareça que a conversa "recomeçou" (ex.: o lead sumiu e voltou) — é a MESMA pessoa, você já a conhece. Trate como continuação natural: responda ao que ele disse ou pergunte no que pode ajudar agora, direto ao ponto, sem se reapresentar.`,
            `Você só se comunica por TEXTO — nunca tem arquivo, PDF, link de grade curricular ou documento pra enviar de verdade. Se o lead pedir a grade/conteúdo programático/ementa ou algo do tipo: se a base de conhecimento tiver essa informação, escreva ela direto na mensagem (resumida, os módulos/disciplinas principais); se a base NÃO tiver esse detalhe, diga com honestidade que vai confirmar com um consultor (handoff=true). NUNCA diga "vou te enviar", "vou te mandar" ou parecido — você não tem como cumprir isso, e prometer e não cumprir é pior que admitir que não tem a informação agora.`,
            `Nunca prometa fazer algo ("vou verificar", "vou te passar isso", "vou te enviar") e na MESMA resposta ou na próxima já emende outra pergunta sem cumprir o que prometeu — isso deixa o lead sem resposta pro que ele pediu. Resolva o que foi pedido primeiro (respondendo de verdade com o que a base tem, ou fazendo handoff se não tiver), só depois siga com novas perguntas.`,
            `Responda SEMPRE em JSON com as chaves:
{"replies": ["1ª mensagem — já com \\n formatado", "2ª mensagem (só se for outro assunto claramente separado)"],
 "handoff": true|false,
 "handoff_reason": "motivo curto quando handoff=true, senão null",
 "summary": "quando handoff=true: resumo para o consultor (curso, modalidade, objeções, o que o lead pediu); senão null"}
Quando handoff=true, não precisa mencionar consultor/horário em nenhum item de "replies" — o sistema acrescenta esse aviso sozinho, como uma mensagem a mais, depois das suas.`,
        ].join("\n\n");

        const { json, usage } = await chatJSON(s.chat_model, Number(s.temperature), [
            { role: "system", content: system },
            ...messages,
        ]);

        let handoff = !!json.handoff;
        let reason: string | null = json.handoff_reason ?? null;
        const turns = (session?.ai_turns ?? 0) + 1;
        if (!handoff && leadId && turns >= s.max_ai_turns) {
            handoff = true;
            reason = `Limite de ${s.max_ai_turns} respostas da IA atingido`;
        }

        if (leadId && !dryRun) {
            const now = new Date().toISOString();
            await db.from("ai_lead_sessions").upsert({
                // lead respondeu de verdade → zera follow-up (achado ao vivo 29/09: sem isso,
                // depois de 1 follow-up o lead nunca mais recebia outro, mesmo ficando quieto
                // de novo dias depois numa conversa nova)
                lead_id: leadId, ai_turns: turns, followup_count: 0, updated_at: now,
                ...(handoff
                    ? { status: "handed_off", handoff_reason: reason, handoff_summary: json.summary ?? null, handed_off_at: now }
                    : { status: "active" }),
            });
            // handoff → o consultor precisa SABER: nota no lead com motivo + resumo, e o lead
            // sobe no Kanban (updated_at). O badge de "mensagem nova" acende sozinho, porque
            // a view lead_pending_replies ignora leads com IA ativa.
            if (handoff) {
                const note = `🤖 IA passou para consultor — ${reason ?? "sem motivo informado"}` +
                    (json.summary ? `\n\nResumo: ${json.summary}` : "");
                await db.from("lead_notes").insert({ lead_id: leadId, note, created_at: now });
                await db.from("leads").update({ updated_at: now }).eq("id", leadId);
                await mirror(`INSERT INTO lead_notes [{ lead_id: leads:⟨${leadId}⟩, note: ${sv(note)}, created_at: d${sv(now)} }] RETURN NONE;`);
            }
        }

        // Blocos de conteúdo da IA (2+ quando o lead pediu 2 coisas separadas, ex. "grade e
        // depois valores" — 29/09, pedido do usuário: virar mensagens de verdade, não uma só
        // emendada). Aceita "reply" (string) como fallback se o modelo ainda devolver o
        // formato antigo, pra nunca ficar sem resposta por causa disso.
        let replies: string[] = Array.isArray(json.replies) && json.replies.length
            ? json.replies.map((r: unknown) => ensureLineBreaks(String(r ?? "").trim())).filter(Boolean)
            : [ensureLineBreaks(String(json.reply ?? "").trim())].filter(Boolean);

        // Aviso de transferência GARANTIDO quando handoff=true — mensagem A MAIS no final
        // (não substitui mais os blocos de conteúdo, já que agora podem ter respondido de
        // verdade o que o lead pediu antes do handoff): achado ao vivo 29/09 — às vezes a IA
        // marcava handoff=true mas o texto ficava só uma pergunta ("posso te explicar como
        // funciona a matrícula?"), nunca avisando de verdade, e a trava bloqueava a próxima
        // mensagem do lead (silêncio total). Como não dá pra confiar que o modelo vai avisar
        // sozinho, o texto configurado (Gestão > IA de Atendimento) sempre entra como o
        // ÚLTIMO item — sempre igual, sempre presente.
        if (handoff) {
            const nome = firstName(lead?.nome ?? "");
            replies.push(fillTemplate(s.handoff_message, { primeiro_nome: nome || "", nome_virgula: nome ? `, ${nome}` : "", horario: s.horario_atendimento ?? "" }));
        }
        if (!replies.length) replies = [""];

        return jsonRes({
            replies,
            reply: replies.join("\n\n"),
            handoff,
            handoff_reason: reason,
            summary: handoff ? (json.summary ?? null) : null,
            sources: knowledgeHits.map((h: any) => ({
                document_id: h.document_id, title: h.title, similarity: Math.round(h.similarity * 100) / 100,
            })),
            usage,
            dry_run: dryRun,
        });
    } catch (e) {
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
