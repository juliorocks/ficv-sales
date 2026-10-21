import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
                .select('id, email, full_name, role, must_change_password').order('full_name', { ascending: true });
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
            // senha escolhida pelo ADMIN, não pela pessoa → troca obrigatória no 1º login
            // (pedido do usuário 02/10, ver migration 20261002090000)
            const { error: pErr } = await admin.from('profiles')
                .upsert({ id, email, full_name, role: role ?? 'agent', must_change_password: true }, { onConflict: 'id' });
            if (pErr) throw pErr;

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

            return json({ success: true });
        }

        if (action === 'reset_password') {
            const { userId, password } = payload ?? {};
            if (!userId || !password) throw new Error('userId e password são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            const { error } = await admin.auth.admin.updateUserById(userId, { password });
            if (error) throw error;
            // reset = o ADMIN escolheu a senha nova, não a pessoa → troca obrigatória de novo
            // no próximo login (mesma regra do 'create' acima)
            await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);
            return json({ success: true });
        }

        throw new Error(`Ação desconhecida: ${action}`);
    } catch (error) {
        console.error('Erro em admin-manage-users:', error);
        return json({ error: (error as Error).message }, 400);
    }
});
