import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase credentials missing. Please check your .env file.');
}

// Lock de refresh de token entre abas. O padrão do supabase-js usa `navigator.locks`
// e pode TRAVAR PRA SEMPRE se uma aba morre segurando o lock (ou o navegador buga) —
// aí `getSession()` / qualquer query fica pendurada e a tela não carrega ("Sincronizando
// Funil" infinito, botão "Salvando..." travado). Aqui: tenta o lock, mas se não
// conseguir em ~10s, SEGUE MESMO ASSIM. Um refresh concorrente é tolerado pelo
// supabase-js (relê o storage); travar a UI não é.
const boundedLock = async <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
    if (typeof navigator === 'undefined' || !('locks' in navigator) || !navigator.locks) {
        return fn();
    }
    const ms = acquireTimeout > 0 ? acquireTimeout : 10000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await navigator.locks.request(name, { signal: ctrl.signal }, async () => fn());
    } catch {
        // não conseguiu o lock a tempo (ou foi abortado) — não trava a UI, segue.
        return fn();
    } finally {
        clearTimeout(timer);
    }
};

// Cliente Supabase direto — sem o proxy SurrealDB (migração de volta ao Supabase).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        lock: boundedLock,
    },
});

// Compat: alguns módulos importavam `supabaseRaw` (mesmo cliente).
export const supabaseRaw = supabase;
