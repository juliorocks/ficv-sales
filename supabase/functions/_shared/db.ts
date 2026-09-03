// Helper compartilhado das edge functions durante a migração SurrealDB -> Postgres.
// Postgres (Supabase) é o primário; SurrealDB recebe um espelho best-effort
// para manter o rollback sem perda durante a transição.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export function pg(): SupabaseClient {
    return createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
    );
}

const SURREAL_ENDPOINT = Deno.env.get("SURREAL_ENDPOINT")
    ?? "https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud";
const SURREAL_NS = "ficv", SURREAL_DB = "salespulse";
const SURREAL_PASS = Deno.env.get("SURREAL_PASS") ?? "Ficv@Surreal2026!";

let _surrealToken: string | null = null;
async function surrealToken(): Promise<string> {
    if (_surrealToken) return _surrealToken;
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "surreal-ns": SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: "ficv_admin", pass: SURREAL_PASS }),
    });
    const { token } = await res.json();
    _surrealToken = token;
    return token;
}

/** Escreve no SurrealDB. NUNCA lança — só loga. Usar só para o espelho de rollback. */
export async function mirror(sqlText: string): Promise<void> {
    try {
        const token = await surrealToken();
        const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain", "Authorization": `Bearer ${token}`,
                "surreal-ns": SURREAL_NS, "surreal-db": SURREAL_DB,
            },
            body: sqlText,
            signal: AbortSignal.timeout(15000),
        });
        if (res.status === 401) { _surrealToken = null; }
        if (!res.ok) console.error(`[mirror] HTTP ${res.status}`);
    } catch (e) {
        console.error("[mirror] falhou (ignorado):", (e as Error).message);
    }
}

/** Escapa valor para literal SurrealQL. */
export function sv(v: unknown): string {
    if (v === null || v === undefined) return "NONE";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** WideChat manda horário de Brasília sem fuso -> assume -03:00, devolve ISO UTC. */
export function wcToISO(raw: unknown): string {
    if (!raw) return new Date().toISOString();
    let s = String(raw).trim().replace(" ", "T");
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "-03:00";
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
