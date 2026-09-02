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
// ============================================================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-surreal-token',
};

const WIDECHAT_BASE = 'https://igrejabatista.widechat.com.br/api/v4';

function jsonRes(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

// profile id (uuid) a partir do JWT de RECORD-access do SurrealDB
function profileIdFromSurrealToken(token: string): { id: string; email: string } | null {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const p = JSON.parse(atob(b64)) as Record<string, unknown>;
        if (p['exp'] && Date.now() / 1000 > (p['exp'] as number)) return null;
        const idStr = String(p['ID'] ?? '');
        const m = idStr.match(/^profiles:`(.+)`$/) ?? idStr.match(/^profiles:⟨(.+)⟩$/) ?? idStr.match(/^profiles:(.+)$/);
        return m ? { id: m[1], email: String(p['email'] ?? '') } : null;
    } catch {
        return null;
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const surrealToken = req.headers.get('x-surreal-token') ?? '';
        const who = profileIdFromSurrealToken(surrealToken);
        if (!who) return jsonRes({ error: 'Sessão não identificada. Faça login de novo.' }, 401);

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

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
            const match = digits
                ? all.find((a: any) => String(a.platform_id ?? '').replace(/\D/g, '').endsWith(digits.slice(-8)))
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

        return jsonRes({ error: `Ação não suportada: ${action}` }, 400);

    } catch (error: any) {
        console.error('widechat-api:', error);
        return jsonRes({ error: error.message }, 500);
    }
});
