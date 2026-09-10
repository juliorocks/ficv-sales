import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { User } from "@/types/database";
import { withTimeout } from "@/utils/withTimeout";

// Lê a sessão direto do localStorage sem passar pelo supabase-js — usado como
// fallback quando `getSession()` estola (o lock de refresh entre abas do
// supabase-js pode travar se uma aba morre segurando o lock).
function readStoredUserId(): string | null {
    try {
        const url = import.meta.env.VITE_SUPABASE_URL || "";
        const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/i)?.[1];
        if (!ref) return null;
        const raw = localStorage.getItem(`sb-${ref}-auth-token`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? null;
    } catch {
        return null;
    }
}

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const loadProfile = async (userId: string) => {
            try {
                const { data: profile } = await withTimeout(
                    supabase.from("profiles").select("*").eq("id", userId).single(),
                    8000,
                    "O perfil",
                );
                if (!cancelled && profile) setUser(profile as User);
            } catch {
                /* mantém o user atual / null — não trava a tela */
            }
        };

        const resolve = async () => {
            let userId: string | null = null;
            try {
                const { data } = await withTimeout(supabase.auth.getSession(), 5000, "A sessão");
                userId = data.session?.user?.id ?? null;
            } catch {
                // getSession travou (lock de refresh entre abas) — cai pro storage
                userId = readStoredUserId();
            }
            if (cancelled) return;
            if (userId) await loadProfile(userId);
            if (!cancelled) setIsLoading(false);
        };

        resolve();

        // Rede de segurança: aconteça o que acontecer, libera a tela em 6s.
        const safety = setTimeout(() => { if (!cancelled) setIsLoading(false); }, 6000);

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (cancelled) return;
            if (session?.user) {
                await loadProfile(session.user.id);
            } else {
                setUser(null);
            }
            setIsLoading(false);
        });

        return () => {
            cancelled = true;
            clearTimeout(safety);
            subscription.unsubscribe();
        };
    }, []);

    return { user, isLoading };
}
