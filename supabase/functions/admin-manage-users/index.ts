import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-surreal-token',
};

const SURREAL_ENDPOINT = 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

function toS(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    return JSON.stringify(v);
}

function parseId(v: unknown): string {
    const s = String(v ?? '');
    const m = s.match(/^[a-z_]+:⟨(.+)⟩$/) ?? s.match(/^[a-z_]+:`(.+)`$/);
    return m ? m[1] : s;
}

async function surrealSQL(token: string, sql: string): Promise<unknown[]> {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain', 'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : json;
    if (entry?.status === 'ERR') throw new Error(entry.result);
    return Array.isArray(entry?.result) ? entry.result : [];
}

async function getAdminToken(): Promise<string> {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error('Falha ao autenticar no SurrealDB.');
    const { token } = await res.json() as { token?: string };
    if (!token) throw new Error('SurrealDB: no token');
    return token;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Autenticação via token SurrealDB do usuário logado (enviado no header X-Surreal-Token)
        const surrealUserToken = req.headers.get('X-Surreal-Token') ?? '';
        if (!surrealUserToken) throw new Error('Usuário não autenticado.');

        const surrealPayload = (() => {
            try {
                const part = surrealUserToken.split('.')[1];
                const padded = part.replace(/-/g, '+').replace(/_/g, '/')
                    .padEnd(part.length + (4 - part.length % 4) % 4, '=');
                return JSON.parse(atob(padded)) as Record<string, unknown>;
            } catch { return null; }
        })();

        const idStr = String(surrealPayload?.ID ?? '');
        const m = idStr.match(/^profiles:`(.+)`$/) ?? idStr.match(/^profiles:⟨(.+)⟩$/);
        const profileId = m ? m[1] : '';
        if (!profileId) throw new Error('Usuário não autenticado.');

        const adminToken = await getAdminToken();

        const callerRows = await surrealSQL(adminToken,
            `SELECT role FROM profiles WHERE id = profiles:⟨${profileId}⟩ LIMIT 1;`
        );
        const callerRole = (callerRows[0] as any)?.role;
        if (callerRole !== 'admin') {
            return new Response(JSON.stringify({ error: 'Apenas administradores podem gerenciar usuários.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }

        const { action, payload } = await req.json();

        // ── list ──────────────────────────────────────────────────────────────
        if (action === 'list') {
            const rows = await surrealSQL(adminToken,
                `SELECT id, email, full_name, role, created_at FROM profiles WHERE email != NONE ORDER BY full_name ASC;`
            ) as any[];
            const profiles = rows.map(r => ({ ...r, id: parseId(r.id) }));
            return new Response(JSON.stringify({ success: true, profiles }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        // ── create ────────────────────────────────────────────────────────────
        if (action === 'create') {
            const { email, password, full_name, role } = payload ?? {};
            if (!email || !password || !full_name) throw new Error('email, password e full_name são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            const newId = crypto.randomUUID();
            await surrealSQL(adminToken, `INSERT INTO profiles [{
                id: ${toS(newId)},
                email: ${toS(email)},
                full_name: ${toS(full_name)},
                role: ${toS(role ?? 'agent')},
                password: crypto::argon2::generate(${toS(password)}),
                active: true,
                created_at: time::now()
            }] RETURN NONE;`);

            return new Response(JSON.stringify({ success: true, user: { id: newId, email } }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        // ── update_profile ────────────────────────────────────────────────────
        if (action === 'update_profile') {
            const { userId, full_name, email, role } = payload ?? {};
            if (!userId) throw new Error('userId é obrigatório.');

            await surrealSQL(adminToken,
                `UPDATE profiles SET full_name = ${toS(full_name)}, email = ${toS(email)}, role = ${toS(role)} WHERE id = profiles:⟨${userId}⟩;`
            );

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        // ── reset_password ────────────────────────────────────────────────────
        if (action === 'reset_password') {
            const { userId, password } = payload ?? {};
            if (!userId || !password) throw new Error('userId e password são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            await surrealSQL(adminToken,
                `UPDATE profiles SET password = crypto::argon2::generate(${toS(password)}) WHERE id = profiles:⟨${userId}⟩;`
            );

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
            });
        }

        throw new Error(`Ação desconhecida: ${action}`);
    } catch (error: any) {
        console.error('Erro em admin-manage-users:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
