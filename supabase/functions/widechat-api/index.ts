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

        // login fresco (o WideChat só permite 1 sessão por conta — se alguém logou
        // do painel/outra aba, o token cacheado aqui foi revogado; por isso o wcCall
        // também refaz login no 401).
        async function freshLogin(): Promise<boolean> {
            const loginRes = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: integ.widechat_email, password: integ.widechat_password }),
            });
            if (!loginRes.ok) return false;
            const login = await loginRes.json();
            if (!login?.token) return false;
            wcToken = login.token;
            wcAgentId = login.user?._id;
            const newExp = new Date(); newExp.setHours(newExp.getHours() + 23);
            await supabase.from('user_integrations').update({
                widechat_session_token: wcToken,
                widechat_token_expires_at: newExp.toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('user_id', who.id);
            return true;
        }

        if (!wcToken || !exp || new Date() > exp) {
            if (!await freshLogin()) {
                return jsonRes({ error: 'Falha ao logar no WideChat. Revise a senha em Configurações > Integração WideChat.', code: 'LOGIN_FAILED' }, 400);
            }
        }

        const wcHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${wcToken}` });
        const body = await req.json().catch(() => ({}));
        const action = body.action as string;

        // Número BR sem DDI -> prepende 55 (WideChat espera "55" + DDD + número).
        const brDigits = (raw: unknown): string => {
            let d = String(raw ?? '').replace(/\D/g, '');
            if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
            return d;
        };

        // Endpoints de leitura/envio não funcionam pra conta ADMIN do WideChat (401 "sem
        // permissão"). Nesse caso cai pra credencial de um AGENTE qualquer de
        // user_integrations. É leitura de dado compartilhado / envio já atribuído ao agente.
        let _afTried = false;
        let _af: { token: string; email: string; id: string } | null = null;
        const getAgentFallback = async () => {
            if (_afTried) return _af;
            _afTried = true;
            const { data: rows } = await supabase.from('user_integrations')
                .select('widechat_email, widechat_password')
                .not('widechat_email', 'is', null).not('widechat_password', 'is', null)
                .neq('user_id', who.id);
            for (const row of rows ?? []) {
                try {
                    const lr = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: row.widechat_email, password: row.widechat_password }),
                    });
                    if (!lr.ok) continue;
                    const lj = await lr.json();
                    if (lj?.user?.type === 'admin' || !lj?.token) continue;
                    _af = { token: lj.token, email: row.widechat_email as string, id: lj.user?._id ?? '' };
                    return _af;
                } catch { /* próximo */ }
            }
            return null;
        };
        // faz a chamada com o token do usuário; no 401/403/{status:false}:
        //   1) refaz login do próprio usuário (token cacheado pode estar revogado) e tenta de novo
        //   2) se ainda falhar (ex: conta admin), refaz como um agente qualquer
        const wcCall = async (path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; asAgent: boolean }> => {
            const hdr = (auth: string) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth}` });
            const denied = (r: Response, d: any) => r.status === 401 || r.status === 403 || (d && d.status === false);
            let r = await fetch(`${WIDECHAT_BASE}${path}`, { ...init, headers: hdr(wcToken) });
            let data = await r.json().catch(() => null);
            if (denied(r, data) && await freshLogin()) {
                r = await fetch(`${WIDECHAT_BASE}${path}`, { ...init, headers: hdr(wcToken) });
                data = await r.json().catch(() => null);
            }
            if (denied(r, data)) {
                const af = await getAgentFallback();
                if (af) {
                    r = await fetch(`${WIDECHAT_BASE}${path}`, { ...init, headers: hdr(af.token) });
                    data = await r.json().catch(() => null);
                    return { ok: r.ok, status: r.status, data, asAgent: true };
                }
            }
            return { ok: r.ok, status: r.status, data, asAgent: false };
        };

        if (action === 'whoami') {
            const r = await fetch(`${WIDECHAT_BASE}/agents/profile`, { headers: wcHeaders() });
            return jsonRes({ crm_profile: who, widechat_email: integ.widechat_email, profile_status: r.status, profile: await r.json().catch(() => null) });
        }

        // agent_id (só usado no send_message; opcional). Busca o profile se não veio do login.
        async function agentId(): Promise<string | undefined> {
            if (wcAgentId) return wcAgentId;
            try {
                const r = await fetch(`${WIDECHAT_BASE}/agents/profile`, { headers: wcHeaders() });
                const p = await r.json();
                wcAgentId = p?._id ?? p?.user?._id ?? p?.agent?._id;
            } catch { /* opcional */ }
            return wcAgentId;
        }

        // ── attendances: acha o atendimento do lead pelo telefone ──────────────
        if (action === 'attendances') {
            const { ok, status, data } = await wcCall('/user/agents/attendances_plus');
            if (!ok) return jsonRes({ error: data }, status);
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
            const { ok, status, data } = await wcCall('/hsm/listAll', {
                method: 'POST',
                body: JSON.stringify({ attendance_id: body.attendance_id ?? undefined, channel_id: body.channel_id ?? undefined }),
            });
            return jsonRes(ok ? { success: true, templates: Array.isArray(data) ? data : (data?.data ?? []) } : { error: data }, ok ? 200 : status);
        }

        // ── send_message: texto ou HSM ───────────────────────────────────────
        if (action === 'send_message') {
            const base: Record<string, unknown> = {
                platform_id: brDigits(body.platform_id),
                channel_id: body.channel_id,
                type: 'text',
                // '0' = a sessão continua ABERTA. Com '3' ("mantém o status atual"), numa
                // conversa nova iniciada por template (sem sessão aberta), o WideChat
                // finaliza na hora a sessão recém-criada -> dispara o webhook de
                // "atendimento finalizado" e o card pulava direto pra coluna Finalizado.
                close_session: '0',
            };
            if (body.attendance_id) base.attendance_id = body.attendance_id;
            if (body.contact_name) base.contact_name = body.contact_name;
            if (body.is_hsm) {
                base.is_hsm = true;
                base.hsm_template_name = body.hsm_template_name;
                base.hsm_placeholders = body.hsm_placeholders ?? [];
                base.message = body.message ?? '';
            } else {
                base.message = body.message;
            }

            // O WideChat só aceita os campos agent/agent_id quando há attendance_id
            // ("attendance id é obrigatório quando agent está presente"). Numa conversa
            // nova (iniciada por template, sem atendimento) NÃO manda agent — a mensagem
            // já sai atribuída ao dono do token.
            if (body.attendance_id) {
                base.agent_id = await agentId();
                base.agent = integ.widechat_email;
            }
            const { ok, status, data } = await wcCall('/message/send', {
                method: 'POST', body: JSON.stringify(base),
            });
            return jsonRes(ok ? { success: true, data } : { error: data }, ok ? 200 : status);
        }

        // ── list_agents: agentes online p/ transferir a conversa ────────────
        if (action === 'list_agents') {
            const { ok, status, data } = await wcCall('/user/agents/online?allUsers=true&paginate=false');
            return jsonRes(ok ? { success: true, agents: Array.isArray(data) ? data : (data?.data ?? []) } : { error: data }, ok ? 200 : status);
        }

        // ── list_teams: filas/equipes (campanhas) p/ transferir a conversa ───
        if (action === 'list_teams') {
            const { ok, status, data } = await wcCall('/campaigns');
            return jsonRes(ok ? { success: true, teams: Array.isArray(data) ? data : (data?.data ?? []) } : { error: data }, ok ? 200 : status);
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
            const { ok, status, data } = await wcCall('/attendances/transfer', {
                method: 'POST', body: JSON.stringify(payload),
            });
            return jsonRes(ok ? { success: true, data } : { error: data }, ok ? 200 : status);
        }

        return jsonRes({ error: `Ação não suportada: ${action}` }, 400);

    } catch (error: any) {
        console.error('widechat-api:', error);
        return jsonRes({ error: error.message }, 500);
    }
});
