// Helpers do motor de IA (VivaConnect): OpenAI (embeddings + chat), auth e
// chunking da base de conhecimento. Usado por kb-ingest e ai-agent.
import { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import { getSecret } from "./secrets.ts";

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonRes(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

export type Caller = { kind: "service" } | { kind: "user"; id: string; role: string };

function jwtRole(jwt: string): string | null {
    try {
        const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4))).role ?? null;
    } catch { return null; }
}

/**
 * Service role (chamada interna entre functions) ou usuário logado com perfil.
 * O claim role só é confiável porque essas functions rodam com verify_jwt = true
 * (padrão): o gateway do Supabase já validou a assinatura do JWT antes de chegar aqui.
 */
let _cronKey: string | null = null;

export async function identify(req: Request, db: SupabaseClient): Promise<Caller | null> {
    // cron do Postgres (public.cron_call): chave interna em app_internal, header x-cron-key
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey) {
        _cronKey ??= (await db.from("app_internal").select("value").eq("key", "cron_key").maybeSingle()).data?.value ?? null;
        if (_cronKey && cronKey === _cronKey) return { kind: "service" };
    }
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return null;
    if (jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || jwtRole(jwt) === "service_role") {
        return { kind: "service" };
    }
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return null;
    const { data: prof } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return { kind: "user", id: user.id, role: prof?.role ?? "" };
}

export const isAdmin = (c: Caller | null) => c?.kind === "service" || (c?.kind === "user" && c.role === "admin");
export const isStaff = (c: Caller | null) =>
    c?.kind === "service" || (c?.kind === "user" && ["admin", "agent"].includes(c.role));

// ── OpenAI ──────────────────────────────────────────────────────────────────
async function openaiKey(): Promise<string> {
    const k = await getSecret("OPENAI_API_KEY");
    if (!k) throw new Error("Chave da OpenAI não configurada (Gestão > Integrações).");
    return k;
}

async function openai(path: string, body: Record<string, unknown>): Promise<any> {
    const call = async (b: Record<string, unknown>) => {
        const r = await fetch(`https://api.openai.com/v1${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${await openaiKey()}` },
            body: JSON.stringify(b),
            signal: AbortSignal.timeout(60000),
        });
        return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    };
    let res = await call(body);
    // Alguns modelos mais novos (achado ao vivo 29/09, trocando pra gpt-5.6-luna pelo painel)
    // só aceitam o "temperature" DEFAULT (1) — mandar o valor configurado (Gestão > IA de
    // Atendimento) dá 400. Em vez de manter uma lista de nomes de modelo que fica
    // desatualizada a cada lançamento novo da OpenAI, detecta pelo texto do próprio erro e
    // tenta de novo sem o parâmetro (fica no default 1 da API).
    if (!res.ok && "temperature" in body && /temperature['"]?\s+does not support|unsupported.{0,20}temperature/i.test(res.data?.error?.message ?? "")) {
        const { temperature: _drop, ...rest } = body;
        res = await call(rest);
    }
    if (!res.ok) throw new Error(`OpenAI ${path} HTTP ${res.status}: ${res.data?.error?.message ?? "sem detalhe"}`);
    return res.data;
}

/** Embeddings em lote (a API aceita até 2048 entradas; mandamos de 64 em 64). */
export async function embed(texts: string[], model: string): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
        const data = await openai("/embeddings", { model, input: texts.slice(i, i + 64) });
        for (const d of data.data) out.push(d.embedding);
    }
    return out;
}

export async function chatJSON(
    model: string, temperature: number,
    messages: { role: string; content: string }[],
): Promise<{ json: any; usage: any }> {
    const data = await openai("/chat/completions", {
        model, temperature, messages, response_format: { type: "json_object" },
    });
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    try {
        return { json: JSON.parse(raw), usage: data.usage };
    } catch {
        return { json: { reply: raw }, usage: data.usage };
    }
}

/**
 * Chat com ferramentas (function calling da OpenAI): o modelo pede uma ferramenta,
 * `run` executa (ex.: consulta ao Sponte do aluno) e o resultado volta pro modelo,
 * até ele responder em texto (máx. `maxRounds` idas e voltas).
 */
export async function chatWithTools(
    model: string, temperature: number, messages: any[],
    tools: { name: string; description: string; parameters: Record<string, unknown> }[],
    run: (name: string, args: any) => Promise<unknown>, maxRounds = 4,
): Promise<{ text: string; toolsUsed: string[]; usage: any[] }> {
    const msgs = [...messages];
    const used: string[] = [];
    const usage: any[] = [];
    for (let round = 0; round <= maxRounds; round++) {
        const data = await openai("/chat/completions", {
            model, temperature, messages: msgs,
            ...(round < maxRounds ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
        });
        usage.push(data.usage);
        const m = data.choices?.[0]?.message;
        if (!m?.tool_calls?.length) return { text: String(m?.content ?? "").trim(), toolsUsed: used, usage };
        msgs.push(m);
        for (const tc of m.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* args vazios */ }
            used.push(tc.function.name);
            let result: unknown;
            try { result = await run(tc.function.name, args); } catch (e) { result = { erro: (e as Error).message }; }
            msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) });
        }
    }
    return { text: "", toolsUsed: used, usage };
}

// ── busca na base: vetorial + palavra ──────────────────────────────────────
// A busca vetorial confunde nomes parecidos (Psicoteologia × Psicopedagogia) e perde
// trechos que misturam vários cursos. Junta com busca por PALAVRA (termos distintivos
// da pergunta, ex.: nome do curso) — os trechos que casam a maioria dos termos entram
// primeiro. Usado pela IA do WhatsApp, Tutor Virtual e consulta dos atendentes.
const STOP = new Set(("quanto quantos quanta quais qual sobre curso cursos valor valores preco preço tempo gostaria " +
    "informacao informação informacoes informações faculdade ficv favor obrigado obrigada tenho quero queria saber " +
    "pode poderia vocês voces vocês como onde quando porque então entao ainda também tambem minha minhas meus seus " +
    "sobre para pelo pela pelos pelas esse essa isso este esta isto aqui agora mesmo muito mais menos todas todos " +
    "fazer sendo estou estão estao boa bom dia tarde noite olá ola consigo consegue conseguir preciso precisa " +
    "gostar existe existem voces falar falou poderiam seria teria tenho entrar começar comecar posso").split(/\s+/));
export function keywordTerms(text: string): string[] {
    const words = String(text).toLowerCase().match(/[a-zà-ú0-9]{5,}/gi) ?? [];
    const terms = [...new Set(words.filter((w) => !STOP.has(w)).map((w) => (w.length >= 8 ? w.slice(0, w.length - 2) : w)))].slice(0, 6);
    // pergunta de preço: os valores ficam em linhas "N parcelas de R$ …" / "Até X% desconto"
    if (/pre[çc]o|valor|mensalidade|parcela|custa|custo|investimento|desconto|pagar|pagamento/i.test(text)) {
        for (const t of ["parcela", "desconto"]) if (!terms.includes(t)) terms.push(t);
    }
    return terms;
}
async function searchOnce(
    db: SupabaseClient, text: string,
    opts: { publico: string; embeddingModel: string; count: number; minSimilarity?: number },
): Promise<any[]> {
    const [qv] = await embed([text], opts.embeddingModel);
    const terms = keywordTerms(text);
    const [vec, kw] = await Promise.all([
        db.rpc("match_knowledge_chunks", { query_embedding: toVector(qv), match_count: opts.count, min_similarity: opts.minSimilarity ?? 0.25, p_publico: opts.publico }),
        terms.length ? db.rpc("match_knowledge_keywords", { p_terms: terms, p_publico: opts.publico, p_limit: 5 }) : Promise.resolve({ data: [] as any[] }),
    ]);
    if ((vec as any).error) throw new Error(`busca na base: ${(vec as any).error.message}`);
    // trechos que casam ao menos metade dos termos vêm primeiro; depois os vetoriais
    const strong = ((kw as any).data ?? []).filter((h: any) => h.similarity >= 0.5).slice(0, 4);
    return [...strong, ...((vec as any).data ?? [])];
}

// Documentos marcados "essencial" (Gestão > Base de Conhecimento) sempre entram no
// contexto, sem depender de bater similaridade/palavra-chave nenhuma. Achado ao vivo
// (29/09): "teria outros pós?" só trazia 6 chunks do MESMO PPC (Psicoteologia) — cada
// PPC tem dezenas/centenas de chunks, então um catálogo curto listando os 10 cursos de
// pós perdia a disputa de similaridade pura contra qualquer PPC específico, mesmo com
// min_similarity=0 (o teto é o `match_count`, não o `min_similarity`). Pra informação
// que não pode depender de sorte de embedding (catálogo completo, horário de
// atendimento) a garantia tem que ser estrutural, não estatística — daí sempre incluir,
// fora do teto de `count`. Uso esperado: poucos documentos curtos, não uma muleta geral.
async function essentialChunks(db: SupabaseClient, publico: string): Promise<any[]> {
    const { data: docs } = await db.from("knowledge_base")
        .select("id, title, category")
        .eq("essencial", true).eq("ai_enabled", true)
        .in("publico", [publico, "ambos"]);
    if (!docs?.length) return [];
    const byId = new Map(docs.map((d: any) => [d.id, d]));
    const { data: chunks } = await db.from("knowledge_chunks")
        .select("document_id, content")
        .in("document_id", docs.map((d: any) => d.id));
    return (chunks ?? []).map((c: any) => ({
        document_id: c.document_id, title: byId.get(c.document_id)?.title,
        category: byId.get(c.document_id)?.category, content: c.content, similarity: 1,
    }));
}

/**
 * Busca na base. `focus` = a pergunta que precisa de resposta AGORA (última mensagem):
 * ela é buscada sozinha e os trechos dela vêm primeiro; `text` (contexto da conversa)
 * completa. Motivo (25/09): 3 mensagens juntas — duas sobre Liderança Cristã e a última
 * sobre Psicoteologia — enterravam o trecho com a duração da Psicoteologia.
 */
export async function searchKnowledge(
    db: SupabaseClient, text: string,
    opts: { publico: string; embeddingModel: string; count?: number; minSimilarity?: number; focus?: string },
): Promise<{ document_id: string; title: string; category: string; content: string; similarity: number }[]> {
    const count = opts.count ?? 6;
    const focus = (opts.focus ?? "").trim();
    const [runs, essential] = await Promise.all([
        Promise.all([
            focus ? searchOnce(db, focus, { ...opts, count }) : Promise.resolve([]),
            !focus || focus !== text.trim() ? searchOnce(db, text, { ...opts, count }) : Promise.resolve([]),
        ]),
        essentialChunks(db, opts.publico),
    ]);
    const out: any[] = [];
    const seen = new Set<string>();
    for (const h of essential) {
        const k = String(h.content).slice(0, 120);
        if (seen.has(k)) continue;
        seen.add(k); out.push(h);
    }
    let added = 0;
    for (const h of [...runs[0], ...runs[1]]) {
        const k = String(h.content).slice(0, 120);
        if (seen.has(k)) continue;
        seen.add(k); out.push(h); added++;
        if (added >= count + 3) break;
    }
    return out;
}

/** pgvector aceita o literal '[0.1,0.2,...]'. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

// ── formatação/completude das respostas das IAs (ai-agent, tutor-virtual) ───────────────
/**
 * Rede de segurança: o prompt já pede pra formatar em parágrafos curtos (\n\n entre
 * ideias), mas numa conversa longa e cheia de respostas antigas sem quebra o modelo tende
 * a imitar o próprio histórico e ignora a instrução (achado ao vivo 29/09, ai-agent). Se
 * ainda assim vier tudo num parágrafo só, quebra por frase aqui — nunca manda bloco corrido.
 */
export function ensureLineBreaks(text: string): string {
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

const OFERTA_DETALHAR = /detalh|list(ar|a)\s+(completa|todas|tudo)|grade\s+completa|explicar\s+cada|mostrar\s+todas|ementa/i;
const CONFIRMACAO_CURTA = /^\s*(sim|quero|pode|claro|manda|vai|com\s*certeza|isso|ok|t[áa]|beleza|show|perfeito|quero\s*sim|pode\s*ser|quero\s*saber)\b/i;

/** Detecta se algum trecho já tem uma lista numerada (item "1)"/"1." seguido, em algum
 *  ponto do mesmo texto, de um item "2)"/"2.") — sinal de que uma grade/lista estruturada
 *  JÁ foi mandada antes. Usado pelo follow-up (achado ao vivo 29/09: a mensagem de
 *  reengajamento perguntou "posso te enviar a grade completa?" MESMO com a grade completa
 *  já mandada 4h antes, na mesma conversa, visível no histórico — o modelo tinha a
 *  informação no contexto mas não "prestou atenção"; aqui a checagem é estrutural, não só
 *  uma instrução no prompt pra "ler com atenção"). */
function hasNumberedList(text: string): boolean {
    const nums = new Set<number>();
    for (const m of text.matchAll(/(?:^|\n)\s*(\d{1,2})[.)]\s/g)) nums.add(Number(m[1]));
    return nums.has(1) && nums.has(2);
}
export function listAlreadySentIn(histMsgs: { role: string; content: string }[]): boolean {
    return histMsgs.some((m) => m.role === "assistant" && hasNumberedList(m.content));
}

/** Pergunta que pede lista COMPLETA (grade, disciplinas, ementa, módulos) — sinal de que
 *  os poucos trechos da busca por similaridade não bastam, precisa do documento inteiro
 *  (ver findCourseDoc). Frase informal ("quero a grade", "qual as disciplinas" — concordância
 *  errada é comum em português falado) conta igual.
 *
 *  `prevAssistant`: o(s) bloco(s) que A PRÓPRIA IA escreveu logo antes desta fala do lead
 *  (ver trailingAssistantText). Cobre o caso em que é a IA quem oferece ("posso detalhar a
 *  ementa de cada disciplina também?") e o lead só confirma com um "sim quero" — essa fala
 *  curta sozinha não bate nas palavras-chave acima, mas a intenção de "tudo" já foi
 *  estabelecida pela OFERTA da IA, não precisa o lead repetir "ementa"/"disciplinas" (achado
 *  ao vivo 29/09: sem isso, a IA detalhava só 3 das 10 disciplinas e perguntava se quer
 *  continuar — o lead reclamou "já detalhe todas de uma vez"). */
export function wantsFullCourseList(text: string, prevAssistant?: string): boolean {
    if (/\bgrade\b|\bdisciplinas?\b|\bementa\b|\bm[oó]dulos?\b|curr[íi]culo|conte[uú]do\s+program[áa]tico/i.test(text)) return true;
    return !!prevAssistant && OFERTA_DETALHAR.test(prevAssistant) && CONFIRMACAO_CURTA.test(text.trim());
}

/** Bloco(s) que a IA escreveu logo ANTES da última fala do lead — pode ser mais de uma
 *  "bolha" (ver `replies`/multi-bubble) — usado por wantsFullCourseList pra achar uma
 *  OFERTA da própria IA que o lead só confirmou. */
export function trailingAssistantText(messages: { role: string; content: string }[]): string {
    const out: string[] = [];
    for (let i = messages.length - 2; i >= 0 && messages[i].role === "assistant"; i--) out.unshift(messages[i].content);
    return out.join("\n");
}

/**
 * Acha o documento (PPC) da base que corresponde ao curso, comparando as PALAVRAS
 * SIGNIFICATIVAS DO TÍTULO de cada documento contra um texto de referência — não usa
 * embedding aqui de propósito: com poucos documentos (~15-20 por público), comparar
 * palavra a palavra em memória é mais confiável do que confiar na busca por similaridade
 * pra decidir QUAL documento é (achado ao vivo 29/09, ai-agent: pra uma pergunta curta tipo
 * "qual as disciplinas?", a busca vetorial trouxe o PPC de outro curso como resultado nº1).
 *
 * `hints`: candidatos em ORDEM DE PRIORIDADE (mais confiável/recente primeiro) — testados
 * UM DE CADA VEZ, isolado, parando no primeiro que bater. Por quê não juntar tudo num texto
 * só: o campo `curso` do lead/ticket costuma estar vazio ou desatualizado (achado ao vivo
 * 29/09, lead Thayanne Sales: `curso_interesse` nulo mesmo com a conversa deixando claro,
 * várias vezes, que o assunto era "Liderança Cristã"), então a pista real vem das ÚLTIMAS
 * falas da conversa — só que juntar várias falas num blob só quebra quando UMA delas lista
 * VÁRIOS cursos ao mesmo tempo (ex.: "temos Psicoteologia, Liderança Cristã, Teologia
 * Bíblica do Novo Testamento..."): o nome de um curso errado entra no mesmo blob e pode
 * empatar ou vencer o curso certo na contagem de palavras batidas. Testando cada fala
 * ISOLADA, da mais recente pra mais antiga, essa mistura não acontece.
 */
export async function findCourseDoc(db: SupabaseClient, hints: (string | null | undefined)[], publicos: string[]): Promise<string | null> {
    const real = hints.filter((h): h is string => !!h && h.trim().length > 0);
    if (!real.length) return null;
    const { data: docs } = await db.from("knowledge_base").select("id, title")
        .in("publico", publicos).eq("index_status", "ready").eq("ai_enabled", true);
    if (!docs?.length) return null;
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const stop = new Set(["pos", "graduacao", "curso", "em", "de", "da", "do", "dos", "das", "e", "a", "o", "ead", "presencial", "ppc"]);
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const titled = (docs as { id: string; title: string }[])
        .map((d) => ({
            id: d.id,
            words: norm(d.title ?? "").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w))
                // \b (palavra inteira), não substring — achado ao vivo 29/09: título curto
                // "[TEO] PPC - GRADUAÇÃO EM TEOLOGIA" sobra só "teo"+"teologia" depois do
                // stopword; "teo" batia por SUBSTRING dentro de "teologia", e como uma das
                // disciplinas da grade de Liderança Cristã se chama "Teologia Bíblica da
                // Liderança", o texto continha "teologia" → as DUAS palavras do título de
                // Teologia "batiam" por coincidência, empatando (e às vezes vencendo) com o
                // curso certo.
                .map((w) => new RegExp(`\\b${esc(w)}\\b`)),
        }))
        .filter((d) => d.words.length > 0);
    for (const hint of real) {
        const nh = norm(hint);
        // entre os que batem o mínimo de 60%, fica com a MAIOR proporção de palavras do
        // título batidas (não só a maior contagem bruta) — um título curto e 100% coberto
        // ("Liderança Cristã") vence um título longo só parcialmente coberto por coincidência.
        let best: { id: string; ratio: number } | null = null;
        for (const { id, words } of titled) {
            const score = words.filter((re) => re.test(nh)).length;
            const ratio = score / words.length;
            if (score >= Math.ceil(words.length * 0.6) && (!best || ratio > best.ratio)) best = { id, ratio };
        }
        if (best) return best.id;
    }
    return null;
}

/**
 * Soma ao `hits` da busca normal TODOS os trechos do PPC do curso, quando a pergunta pede
 * lista completa (ver wantsFullCourseList) — sem substituir os hits normais, porque preço/
 * desconto costuma morar em outro documento (ex.: "Orientações Gerais"), não no PPC
 * (achado ao vivo 29/09: substituir deixava a IA sem saber responder "e os valores?" logo
 * depois de mandar a grade completa). Devolve os hits (talvez ampliados) + o título do
 * documento usado (pra avisar no prompt que aquilo ali é o documento INTEIRO).
 */
export async function expandForFullList(
    db: SupabaseClient, hits: { document_id: string; title: string; category: string; content: string; similarity: number }[],
    hints: (string | null | undefined)[], publicos: string[],
): Promise<{ hits: typeof hits; fullDocUsed: string | null }> {
    let docId = await findCourseDoc(db, hints, publicos);
    if (!docId) {
        // Último recurso, sem NENHUM nome de curso reconhecível: pega o 1º hit que não seja
        // um documento "essencial" (Catálogo Completo, Orientações Gerais — ver
        // essentialChunks) — esses sempre entram primeiro em `hits`, mas não são o PPC de um
        // curso específico; expandir eles não ajuda o pedido de "grade completa" (achado ao
        // vivo 29/09: sem esse filtro, o fallback pegava sempre "Catálogo Completo de
        // Cursos" como se fosse o PPC do curso perguntado).
        const { data: essentialDocs } = await db.from("knowledge_base").select("id").eq("essencial", true);
        const essentialIds = new Set((essentialDocs ?? []).map((d: any) => d.id));
        docId = hits.find((h) => !essentialIds.has(h.document_id))?.document_id ?? null;
    }
    if (!docId) return { hits, fullDocUsed: null };
    const { data: allChunks } = await db.from("knowledge_chunks")
        .select("content, chunk_index").eq("document_id", docId).order("chunk_index").limit(80);
    if (!allChunks?.length) return { hits, fullDocUsed: null };
    const { data: docRow } = await db.from("knowledge_base").select("title").eq("id", docId).maybeSingle();
    const fullDocUsed = docRow?.title ?? hits[0]?.title ?? null;
    const seen = new Set(hits.map((h) => String(h.content).slice(0, 120)));
    const extra = allChunks
        .filter((c: any) => !seen.has(String(c.content).slice(0, 120)))
        .map((c: any) => ({ document_id: docId, title: fullDocUsed as string, category: "", similarity: 1, content: c.content }));
    return { hits: [...extra, ...hits], fullDocUsed };
}

// ── chunking ────────────────────────────────────────────────────────────────
/**
 * Quebra por parágrafo e junta até ~maxChars, com sobreposição do fim do trecho
 * anterior (pra não cortar uma informação ao meio). Parágrafo gigante (ex: tabela
 * de planilha numa linha só) é cortado por frase/linha.
 */
export function chunkText(text: string, maxChars = 1200, overlap = 200): string[] {
    const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) return [];
    const pieces: string[] = [];
    for (const para of clean.split(/\n\s*\n/)) {
        if (para.length <= maxChars) { pieces.push(para); continue; }
        let buf = "";
        for (const part of para.split(/(?<=[.!?;])\s+|\n/)) {
            if (buf && buf.length + part.length + 1 > maxChars) { pieces.push(buf); buf = ""; }
            if (part.length > maxChars) {
                for (let i = 0; i < part.length; i += maxChars) pieces.push(part.slice(i, i + maxChars));
            } else buf = buf ? `${buf} ${part}` : part;
        }
        if (buf) pieces.push(buf);
    }
    const chunks: string[] = [];
    let cur = "";
    for (const p of pieces) {
        if (cur && cur.length + p.length + 2 > maxChars) {
            chunks.push(cur);
            const tail = cur.slice(-overlap);
            cur = p.length + overlap + 2 <= maxChars ? `${tail.slice(tail.indexOf(" ") + 1)}\n\n${p}` : p;
        } else cur = cur ? `${cur}\n\n${p}` : p;
    }
    if (cur) chunks.push(cur);
    return chunks;
}
