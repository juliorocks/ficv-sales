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

async function openai(path: string, body: unknown): Promise<any> {
    const r = await fetch(`https://api.openai.com/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${await openaiKey()}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`OpenAI ${path} HTTP ${r.status}: ${data?.error?.message ?? "sem detalhe"}`);
    return data;
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
    "fazer fazer sendo estou estão estao boa bom dia tarde noite olá ola").split(/\s+/));
export function keywordTerms(text: string): string[] {
    const words = String(text).toLowerCase().match(/[a-zà-ú0-9]{5,}/gi) ?? [];
    const terms = [...new Set(words.filter((w) => !STOP.has(w)).map((w) => (w.length >= 8 ? w.slice(0, w.length - 2) : w)))].slice(0, 6);
    // pergunta de preço: os valores ficam em linhas "N parcelas de R$ …" / "Até X% desconto"
    if (/pre[çc]o|valor|mensalidade|parcela|custa|custo|investimento|desconto|pagar|pagamento/i.test(text)) {
        for (const t of ["parcela", "desconto"]) if (!terms.includes(t)) terms.push(t);
    }
    return terms;
}
export async function searchKnowledge(
    db: SupabaseClient, text: string,
    opts: { publico: string; embeddingModel: string; count?: number; minSimilarity?: number },
): Promise<{ document_id: string; title: string; category: string; content: string; similarity: number }[]> {
    const count = opts.count ?? 6;
    const [qv] = await embed([text], opts.embeddingModel);
    const terms = keywordTerms(text);
    const [vec, kw] = await Promise.all([
        db.rpc("match_knowledge_chunks", { query_embedding: toVector(qv), match_count: count, min_similarity: opts.minSimilarity ?? 0.25, p_publico: opts.publico }),
        terms.length ? db.rpc("match_knowledge_keywords", { p_terms: terms, p_publico: opts.publico, p_limit: 5 }) : Promise.resolve({ data: [] as any[] }),
    ]);
    if ((vec as any).error) throw new Error(`busca na base: ${(vec as any).error.message}`);
    // trechos que casam ao menos metade dos termos vêm primeiro; depois os vetoriais
    const strong = ((kw as any).data ?? []).filter((h: any) => h.similarity >= 0.5).slice(0, 4);
    const out: any[] = [];
    const seen = new Set<string>();
    for (const h of [...strong, ...((vec as any).data ?? [])]) {
        const k = String(h.content).slice(0, 120);
        if (seen.has(k)) continue;
        seen.add(k); out.push(h);
        if (out.length >= count + 2) break;
    }
    return out;
}

/** pgvector aceita o literal '[0.1,0.2,...]'. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

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
