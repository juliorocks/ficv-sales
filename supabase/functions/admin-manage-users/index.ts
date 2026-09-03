import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── espelho SurrealDB (transição) — best-effort ──────────────────────────────
const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT') ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv', SURREAL_DB = 'salespulse';
const SURREAL_PASS = Deno.env.get('SURREAL_PASS') ?? 'Ficv@Surreal2026!';
function sq(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
async function surrealMirror(sqlFn: (esc: typeof sq) => string) {
    try {
        const auth = await fetch(`${SURREAL_ENDPOINT}/signin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
            body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: SURREAL_PASS }),
        });
        const { token } = await auth.json();
        await fetch(`${SURREAL_ENDPOINT}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', 'Authorization': `Bearer ${token}`, 'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB },
            body: sqlFn(sq),
        });
    } catch (e) {
        console.error('surrealMirror falhou (ignorado):', e);
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });

    try {
        const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

        // autentica o chamador pelo JWT Supabase
        const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
        if (!jwt) return json({ error: 'Não autenticado.' }, 401);
        const { data: { user }, error: uErr } = await admin.auth.getUser(jwt);
        if (uErr || !user) return json({ error: 'Sessão inválida.' }, 401);

        const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single();
        if (caller?.role !== 'admin') return json({ error: 'Apenas administradores podem gerenciar usuários.' }, 403);

        const { action, payload } = await req.json();

        if (action === 'list') {
            const { data, error } = await admin.from('profiles')
                .select('id, email, full_name, role').order('full_name', { ascending: true });
            if (error) throw error;
            return json({ success: true, profiles: data });
        }

        if (action === 'create') {
            const { email, password, full_name, role } = payload ?? {};
            if (!email || !password || !full_name) throw new Error('email, password e full_name são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            const { data: created, error: cErr } = await admin.auth.admin.createUser({
                email, password, email_confirm: true, user_metadata: { full_name },
            });
            if (cErr) throw cErr;
            const id = created.user.id;
            const { error: pErr } = await admin.from('profiles')
                .upsert({ id, email, full_name, role: role ?? 'agent' }, { onConflict: 'id' });
            if (pErr) throw pErr;

            await surrealMirror(esc => `INSERT INTO profiles [{ id: ${esc(id)}, email: ${esc(email)}, full_name: ${esc(full_name)}, role: ${esc(role ?? 'agent')}, password: crypto::argon2::generate(${esc(password)}), active: true, created_at: time::now() }] RETURN NONE;`);
            return json({ success: true, user: { id, email } });
        }

        if (action === 'update_profile') {
            const { userId, full_name, email, role } = payload ?? {};
            if (!userId) throw new Error('userId é obrigatório.');
            const patch: Record<string, unknown> = {};
            if (full_name !== undefined) patch.full_name = full_name;
            if (email !== undefined) patch.email = email;
            if (role !== undefined) patch.role = role;

            const { error } = await admin.from('profiles').update(patch).eq('id', userId);
            if (error) throw error;
            if (email) await admin.auth.admin.updateUserById(userId, { email }).catch(() => {});

            const sets = Object.entries(patch).map(([k, v]) => `${k} = ${sq(v)}`).join(', ');
            if (sets) await surrealMirror(() => `UPDATE profiles SET ${sets} WHERE id = profiles:⟨${userId}⟩;`);
            return json({ success: true });
        }

        if (action === 'reset_password') {
            const { userId, password } = payload ?? {};
            if (!userId || !password) throw new Error('userId e password são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            const { error } = await admin.auth.admin.updateUserById(userId, { password });
            if (error) throw error;
            await surrealMirror(esc => `UPDATE profiles SET password = crypto::argon2::generate(${esc(password)}) WHERE id = profiles:⟨${userId}⟩;`);
            return json({ success: true });
        }

        throw new Error(`Ação desconhecida: ${action}`);
    } catch (error) {
        console.error('Erro em admin-manage-users:', error);
        return json({ error: (error as Error).message }, 400);
    }
});
