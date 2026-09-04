import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ============================================================================
// widechat-api — envio de WhatsApp pelo Kanban, via WideChat, no login do agente.
// Auth: o app manda o token do SurrealDB no header X-Surreal-Token (o app migrou
// de Supabase Auth p/ SurrealDB). A partir dele achamos o profile do agente e
// as credenciais em user_integrations (Postgres).
//
// Ações:
//   attendances  -> GET /user/agents/attendances_plus  (acha o atendimento do lead)
//   list_hsm     -> POST /hsm/listAll                   (templates aprovados)
//   send_message -> POST /message/send                  (texto ou HSM)
//   list_agents  -> GET /user/agents/online              (agentes p/ transferir)
//   list_teams   -> GET /campaigns                       (filas/equipes p/ transferir)
//   transfer     -> POST /attendances/transfer           (transfere a conversa)
// ============================================================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WIDECHAT_BASE = 'https://igrejabatista.widechat.com.br/api/v4';

function jsonRes(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { auth: { persistSession: false } },
        );

        // auth: JWT Supabase do agente logado
        const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(jwt);
        if (!user) return jsonRes({ error: 'Sessão não identificada. Faça login de novo.' }, 401);
        const who = { id: user.id, email: user.email ?? '' };

        const { data: integ } = await supabase
            .from('user_integrations')
            .select('*')
            .eq('user_id', who.id)
            .maybeSingle();

        if (!integ?.widechat_email || !integ?.widechat_password) {
            return jsonRes({ error: 'Credenciais do WideChat não configuradas. Vá em Configurações > Integração WideChat.', code: 'NO_CREDENTIALS' }, 400);
        }

        // ── token de sessão do WideChat (cache 23h) ─────────────────────────────
        let wcToken: string = integ.widechat_session_token;
        let wcAgentId: string | undefined;
        const exp = integ.widechat_token_expires_at ? new Date(integ.widechat_token_expires_at) : null;

        if (!wcToken || !exp || new Date() > exp) {
            const loginRes = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: integ.widechat_email, password: integ.widechat_password }),
            });
            if (!loginRes.ok) {
                return jsonRes({ error: `Falha ao logar no WideChat: ${await loginRes.text()}`, code: 'LOGIN_FAILED' }, 400);
            }
            const login = await loginRes.json();
            wcToken = login.token;
            wcAgentId = login.user?._id;
            const newExp = new Date(); newExp.setHours(newExp.getHours() + 23);
            await supabase.from('user_integrations').update({
                widechat_session_token: wcToken,
                widechat_token_expires_at: newExp.toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('user_id', who.id);
        }

        const wcHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${wcToken}` };
        const body = await req.json().catch(() => ({}));
        const action = body.action as string;

        if (action === 'whoami') {
            const r = await fetch(`${WIDECHAT_BASE}/agents/profile`, { headers: wcHeaders });
            return jsonRes({ crm_profile: who, widechat_email: integ.widechat_email, profile_status: r.status, profile: await r.json().catch(() => null) });
        }

        // agent_id (só usado no send_message; opcional). Busca o profile se não veio do login.
        async function agentId(): Promise<string | undefined> {
            if (wcAgentId) return wcAgentId;
            try {
                const r = await fetch(`${WIDECHAT_BASE}/agents/profile`, { headers: wcHeaders });
                const p = await r.json();
                wcAgentId = p?._id ?? p?.user?._id ?? p?.agent?._id;
            } catch { /* opcional */ }
            return wcAgentId;
        }

        // ── attendances: acha o atendimento do lead pelo telefone ──────────────
        if (action === 'attendances') {
            const r = await fetch(`${WIDECHAT_BASE}/user/agents/attendances_plus`, { headers: wcHeaders });
            const data = await r.json();
            if (!r.ok) return jsonRes({ error: data }, r.status);
            const digits = String(body.telefone ?? '').replace(/\D/g, '');
            const all = [...(data.attendance ?? []), ...(data.wait ?? [])];
            // platform_id é um id interno do WideChat (ex: "BR.3020350278297153"), NÃO o telefone —
            // o telefone de verdade vem em wa_id/phone. Comparar com platform_id nunca casava.
            const match = digits
                ? all.find((a: any) =>
                    String(a.wa_id ?? a.phone ?? '').replace(/\D/g, '').endsWith(digits.slice(-8)))
                : null;
            return jsonRes({ success: true, match: match ?? null, all, agent_email: integ.widechat_email });
        }

        // ── list_hsm: templates aprovados ─────────────────────────────────────
        if (action === 'list_hsm') {
            const r = await fetch(`${WIDECHAT_BASE}/hsm/listAll`, {
                method: 'POST', headers: wcHeaders,
                body: JSON.stringify({
                    attendance_id: body.attendance_id ?? undefined,
                    channel_id: body.channel_id ?? undefined,
                }),
            });
            const data = await r.json();
            return jsonRes(r.ok ? { success: true, templates: data } : { error: data }, r.ok ? 200 : r.status);
        }

        // ── send_message: texto ou HSM ───────────────────────────────────────
        if (action === 'send_message') {
            const payload: Record<string, unknown> = {
                platform_id: String(body.platform_id ?? '').replace(/\D/g, ''),
                channel_id: body.channel_id,
                agent_id: await agentId(),
                agent: integ.widechat_email,
                type: 'text',
                close_session: '3', // mantém o atendimento como está
            };
            if (body.attendance_id) payload.attendance_id = body.attendance_id;
            if (body.contact_name) payload.contact_name = body.contact_name;

            if (body.is_hsm) {
                payload.is_hsm = true;
                payload.hsm_template_name = body.hsm_template_name;
                payload.hsm_placeholders = body.hsm_placeholders ?? [];
                payload.message = body.message ?? '';
            } else {
                payload.message = body.message;
            }

            const r = await fetch(`${WIDECHAT_BASE}/message/send`, {
                method: 'POST', headers: wcHeaders, body: JSON.stringify(payload),
            });
            const data = await r.json();
            return jsonRes(r.ok ? { success: true, data } : { error: data }, r.ok ? 200 : r.status);
        }

        // ── list_agents: agentes online p/ transferir a conversa ────────────
        if (action === 'list_agents') {
            const r = await fetch(`${WIDECHAT_BASE}/user/agents/online?allUsers=true&paginate=false`, { headers: wcHeaders });
            const data = await r.json();
            return jsonRes(r.ok ? { success: true, agents: data?.data ?? data ?? [] } : { error: data }, r.ok ? 200 : r.status);
        }

        // ── list_teams: filas/equipes (campanhas) p/ transferir a conversa ───
        if (action === 'list_teams') {
            const r = await fetch(`${WIDECHAT_BASE}/campaigns`, { headers: wcHeaders });
            const data = await r.json();
            return jsonRes(r.ok ? { success: true, teams: data?.data ?? data ?? [] } : { error: data }, r.ok ? 200 : r.status);
        }

        // ── transfer: manda a conversa pra outro agente ou fila/equipe ───────
        // Doc: https://igrejabatista.widechat.com.br/docs/pt-br/attendances/transfer
        // body.type = 'agent' (usa body.agent_id) ou 'attendance' (usa body.team_id,
        // que na terminologia do WideChat é chamado de "attendance_id" — é o id da
        // FILA/CAMPANHA de /campaigns, não o id da conversa em si; renomeado aqui pra
        // não confundir com o attendance_id usado em send_message/list_hsm, que é o
        // id da conversa).
        if (action === 'transfer') {
            if (!body.session_id) return jsonRes({ error: 'session_id é obrigatório (widechat_session_id do lead).' }, 400);
            if (body.type !== 'agent' && body.type !== 'attendance') return jsonRes({ error: "type deve ser 'agent' ou 'attendance'." }, 400);
            const payload: Record<string, unknown> = {
                session_id: body.session_id,
                type: body.type,
                transfer_wait: body.transfer_wait ?? true,
            };
            if (body.type === 'agent') payload.agent_id = body.agent_id;
            if (body.type === 'attendance') payload.attendance_id = body.team_id;
            const r = await fetch(`${WIDECHAT_BASE}/attendances/transfer`, {
                method: 'POST', headers: wcHeaders, body: JSON.stringify(payload),
            });
            const data = await r.json();
            return jsonRes(r.ok ? { success: true, data } : { error: data }, r.ok ? 200 : r.status);
        }

        return jsonRes({ error: `Ação não suportada: ${action}` }, 400);

    } catch (error: any) {
        console.error('widechat-api:', error);
        return jsonRes({ error: error.message }, 500);
    }
});
