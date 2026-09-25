// Chaves de integração: primeiro a colada no painel (Gestão > Integrações,
// guardada no Supabase Vault), depois a variável de ambiente (supabase secrets).
// Cache de 60s por instância pra não bater no banco a cada chamada.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const cache = new Map<string, { v: string; at: number }>();
let _db: ReturnType<typeof createClient> | null = null;
const db = () => _db ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });

export async function getSecret(key: string): Promise<string> {
    const c = cache.get(key);
    if (c && Date.now() - c.at < 60_000) return c.v;
    let v = "";
    try {
        const { data, error } = await db().rpc("integ_get_secret", { p_key: key });
        if (error) console.error(`getSecret(${key}):`, error.message);
        v = (data as string | null) ?? "";
    } catch (e) { console.error(`getSecret(${key}):`, (e as Error).message); }
    if (!v) v = Deno.env.get(key) ?? "";
    cache.set(key, { v, at: Date.now() });
    return v;
}

export function forgetSecret(key: string) { cache.delete(key); }
