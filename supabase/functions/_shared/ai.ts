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
export async function identify(req: Request, db: SupabaseClient): Promise<Caller | null> {
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
