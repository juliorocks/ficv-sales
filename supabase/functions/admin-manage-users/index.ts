import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-surreal-token',
};

const SURREAL_ENDPOINT = 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            throw new Error('Nenhum token de autorização fornecido.');
        }

        // Autenticação via token SurrealDB do usuário logado
        const surrealUserToken = req.headers.get('X-Surreal-Token') ?? '';
        if (!surrealUserToken) throw new Error('Usuário não autenticado.');

        // Decodifica o JWT SurrealDB para obter o profile ID
        const surrealPayload = (() => {
            try {
                const part = surrealUserToken.split('.')[1];
                const padded = part.replace(/-/g, '+').replace(/_/g, '/')
                    .padEnd(part.length + (4 - part.length % 4) % 4, '=');
                return JSON.parse(atob(padded)) as Record<string, unknown>;
            } catch { return null; }
        })();
        const idStr = String(surrealPayload?.ID ?? '');
        const profileIdMatch = idStr.match(/^profiles:`(.+)`$/) ?? idStr.match(/^profiles:⟨(.+)⟩$/);
        const profileId = profileIdMatch ? profileIdMatch[1] : '';
        if (!profileId) throw new Error('Usuário não autenticado.');

        // Verifica role=admin no SurrealDB
        const signRes = await fetch(`${SURREAL_ENDPOINT}/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
            body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
        });
        if (!signRes.ok) throw new Error('Falha ao autenticar no SurrealDB.');
        const { token: adminToken } = await signRes.json() as { token?: string };
        if (!adminToken) throw new Error('Falha ao obter token do SurrealDB.');

        const profileRes = await fetch(`${SURREAL_ENDPOINT}/sql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain', 'Accept': 'application/json',
                'Authorization': `Bearer ${adminToken}`,
                'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
            },
            body: `SELECT role FROM profiles WHERE id = profiles:⟨${profileId}⟩ LIMIT 1;`,
        });
        const profileJson = await profileRes.json();
        const profileRole = (Array.isArray(profileJson) ? profileJson[0]?.result?.[0] : null)?.role;
        if (profileRole !== 'admin') {
            return new Response(JSON.stringify({ error: 'Apenas administradores podem gerenciar usuários.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { action, payload } = await req.json();

        if (action === 'list') {
            const { data: profiles, error: profilesError } = await supabaseAdmin
                .from('profiles')
                .select('*')
                .order('full_name');
            if (profilesError) throw profilesError;

            const { data: usersList, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
            if (usersError) throw usersError;

            const authById = new Map(usersList.users.map((u) => [u.id, u]));

            const merged = (profiles ?? []).map((p) => {
                const authUser = authById.get(p.id);
                return {
                    ...p,
                    email: authUser?.email ?? null,
                    created_at: authUser?.created_at ?? null,
                };
            });

            return new Response(JSON.stringify({ success: true, profiles: merged }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        if (action === 'create') {
            const { email, password, full_name, role } = payload ?? {};
            if (!email || !password || !full_name) throw new Error('email, password e full_name são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name, role: role ?? 'agent' },
            });
            if (authError) throw authError;

            await supabaseAdmin
                .from('profiles')
                .update({ full_name, role: role ?? 'agent' })
                .eq('id', authData.user.id);

            return new Response(JSON.stringify({ success: true, user: { id: authData.user.id, email } }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        if (action === 'update_profile') {
            const { userId, full_name, email, role } = payload ?? {};
            if (!userId) throw new Error('userId é obrigatório.');

            if (email) {
                const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
                if (emailError) throw emailError;
            }

            const { error: profileError } = await supabaseAdmin
                .from('profiles')
                .update({ full_name, role })
                .eq('id', userId);
            if (profileError) throw profileError;

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        if (action === 'reset_password') {
            const { userId, password } = payload ?? {};
            if (!userId || !password) throw new Error('userId e password são obrigatórios.');
            if (password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

            const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
            if (passwordError) throw passwordError;

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
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
