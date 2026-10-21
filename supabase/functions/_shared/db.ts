// Helper compartilhado das edge functions: cliente do Postgres (Supabase).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";

export function pg(): SupabaseClient {
    return createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
    );
}

/** WideChat manda horário de Brasília sem fuso -> assume -03:00, devolve ISO UTC. */
export function wcToISO(raw: unknown): string {
    if (!raw) return new Date().toISOString();
    let s = String(raw).trim().replace(" ", "T");
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "-03:00";
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
