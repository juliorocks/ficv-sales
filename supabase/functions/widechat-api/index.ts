import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

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
        // nome do agente que está de fato operando — pra atribuir a msg no NOSSO
        // histórico mesmo quando o envio sai pela conta de integração.
        const callerName = (await supabase.from('profiles').select('full_name').eq('id', who.id).maybeSingle())
            .data?.full_name || who.email.split('@')[0] || 'Agente';

        // ── CONTA DEDICADA DE INTEGRAÇÃO ─────────────────────────────────────
        // Secret WIDECHAT_INTEGRATION_EMAIL: quando setado, TODA sessão do WideChat
        // usa essa conta (não o login pessoal do agente). Assim o token daqui nunca
        // briga com o painel do WideChat que o agente abre com a conta DELE.
        // (O WideChat só permite 1 sessão por conta.)
        const INTEG_EMAIL = (Deno.env.get('WIDECHAT_INTEGRATION_EMAIL') ?? '').trim().toLowerCase();
        let integ = INTEG_EMAIL
            ? (await supabase.from('user_integrations').select('*').ilike('widechat_email', INTEG_EMAIL).maybeSingle()).data
            : (await supabase.from('user_integrations').select('*').eq('user_id', who.id).maybeSingle()).data;

        // Nem todo agente cadastrou o login do WideChat. Sem isso NINGUÉM da equipe
        // conseguia operar pelo painel. Fallback: usa a credencial de OUTRO agente
        // (não-admin) — as mensagens saem atribuídas a essa conta.
        let usingSharedCreds = false;
        if (!integ?.widechat_email || !integ?.widechat_password) {
            const { data: rows } = await supabase.from('user_integrations')
                .select('*')
                .not('widechat_email', 'is', null).not('widechat_password', 'is', null)
                .neq('user_id', who.id)
                .order('updated_at', { ascending: false });
            // 1ª passada: aproveita uma conta que já tem token em cache válido (sem re-login)
            const cached = (rows ?? []).find((r) =>
                r.widechat_session_token && r.widechat_token_expires_at && new Date(r.widechat_token_expires_at) > new Date());
            if (cached) { integ = cached; usingSharedCreds = true; }
            for (const row of (integ ? [] : (rows ?? []))) {
                try {
                    const lr = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: row.widechat_email, password: row.widechat_password }),
                    });
                    if (!lr.ok) continue;
                    const lj = await lr.json();
                    if (!lj?.token || lj?.user?.type === 'admin') continue; // admin não lê nem envia
                    const shExp = new Date(Date.now() + 23 * 3600 * 1000).toISOString();
                    integ = { ...row, widechat_session_token: lj.token, widechat_token_expires_at: shExp };
                    usingSharedCreds = true;
                    await supabase.from('user_integrations').update({
                        widechat_session_token: lj.token, widechat_token_expires_at: shExp, updated_at: new Date().toISOString(),
                    }).eq('user_id', row.user_id);
                    break;
                } catch { /* próximo */ }
            }
            if (!integ?.widechat_email) {
                return jsonRes({ error: 'Nenhum agente tem o login do WideChat cadastrado. Vá em Configurações > Integração WideChat.', code: 'NO_CREDENTIALS' }, 400);
            }
        }

        // ── token de sessão do WideChat (cache 23h) ─────────────────────────────
        let wcToken: string = integ.widechat_session_token;
        let wcAgentId: string | undefined;
        const exp = integ.widechat_token_expires_at ? new Date(integ.widechat_token_expires_at) : null;
        const credOwner = integ.user_id;

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
            }).eq('user_id', credOwner);
            return true;
        }

        if (!wcToken || !exp || new Date() > exp) {
            if (!await freshLogin()) {
                return jsonRes({ error: 'Falha ao logar no WideChat. Revise a senha em Configurações > Integração WideChat.', code: 'LOGIN_FAILED' }, 400);
            }
        }
        if (usingSharedCreds) console.log(`widechat-api: ${who.email} sem creds próprias -> usando conta compartilhada ${integ.widechat_email}`);

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
        // O WideChat só deixa 1 sessão por conta: se um humano usa o painel do WideChat
        // com a MESMA conta, o token daqui é revogado a cada login dele. Por isso o
        // re-login + retry roda até 3x — em alguma das voltas a corrida é ganha.
        const wcCall = async (path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; asAgent: boolean }> => {
            const hdr = (auth: string) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth}` });
            const denied = (r: Response, d: any) => r.status === 401 || r.status === 403 || (d && d.status === false);
            let r = await fetch(`${WIDECHAT_BASE}${path}`, { ...init, headers: hdr(wcToken) });
            let data = await r.json().catch(() => null);
            for (let attempt = 0; attempt < 3 && denied(r, data); attempt++) {
                if (attempt > 0) await new Promise((res) => setTimeout(res, 400 * attempt));
                if (!await freshLogin()) break;
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

        // ── attendances: acha o atendimento do lead ───────────────────────────
        if (action === 'attendances') {
            const { ok, status, data } = await wcCall('/user/agents/attendances_plus');
            if (!ok) return jsonRes({ error: data }, status);
            const digits = String(body.telefone ?? '').replace(/\D/g, '');
            const sess = String(body.session_id ?? '').trim();
            const all = [...(data.attendance ?? []), ...(data.wait ?? [])];
            // casa por session_id (mais confiável) OU pelo telefone real (wa_id/phone —
            // platform_id é id interno "BR.xxx", nunca casava). Também aceita casar o
            // platform_id contra os dígitos, pro caso de leads cujo "telefone" salvo É
            // o id interno do WideChat (número estrangeiro sem wa_id no payload).
            const suf = digits.length >= 8 ? digits.slice(-8) : '';
            const match =
                (sess && all.find((a: any) => String(a.session_id ?? a.session ?? '') === sess)) ||
                (suf && all.find((a: any) => {
                    const wa = String(a.wa_id ?? a.phone ?? '').replace(/\D/g, '');
                    const pid = String(a.platform_id ?? '').replace(/\D/g, '');
                    return wa.endsWith(suf) || (pid && pid.endsWith(suf));
                })) || null;
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
            let platformId = brDigits(body.platform_id);
            let resolvedAttId = body.attendance_id as string | undefined;
            let resolvedAgentId: string | undefined;
            // token/email de quem vai ENVIAR — por padrão a conta de integração, mas
            // pra TEXTO LIVRE numa conversa em andamento o envio TEM que sair pela
            // conta que é DONA do atendimento no WideChat (senão a Meta recusa
            // "undeliverable" / 131026). Achamos o atendimento e mandamos por ela.
            let sendToken = wcToken;
            let sendEmail = integ.widechat_email as string;

            if (!body.is_hsm && body.session_id) {
                const ownRow = (await supabase.from('user_integrations')
                    .select('user_id, widechat_email, widechat_password')
                    .eq('user_id', who.id).maybeSingle()).data;
                const accts: Array<{ email: string; password: string; isInteg: boolean }> = [
                    { email: integ.widechat_email as string, password: integ.widechat_password as string, isInteg: true },
                    ...(ownRow?.widechat_email && ownRow.widechat_email !== integ.widechat_email
                        ? [{ email: ownRow.widechat_email as string, password: ownRow.widechat_password as string, isInteg: false }] : []),
                ];
                for (const acct of accts) {
                    try {
                        let tok = wcToken, aid: string | undefined;
                        if (!acct.isInteg) {
                            const lr = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email: acct.email, password: acct.password }),
                            });
                            const lj = await lr.json().catch(() => null);
                            if (!lj?.token) continue;
                            tok = lj.token; aid = lj.user?._id;
                        }
                        const ar = await fetch(`${WIDECHAT_BASE}/user/agents/attendances_plus`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` } });
                        const ad = await ar.json().catch(() => null);
                        const all = [...((ad as any)?.attendance ?? []), ...((ad as any)?.wait ?? [])];
                        const m = all.find((a: any) => String(a.session_id ?? a.session ?? '') === String(body.session_id));
                        if (m) {
                            if (m.wa_id && /^\d{10,15}$/.test(brDigits(m.wa_id))) platformId = brDigits(m.wa_id);
                            resolvedAttId = String(m._id ?? m.attendance_id ?? resolvedAttId ?? '');
                            // manda PELA conta dona do atendimento
                            sendToken = tok;
                            sendEmail = acct.email;
                            resolvedAgentId = m.agent_id ?? m.agent?._id ?? aid;
                            break;
                        }
                    } catch { /* próxima conta */ }
                }
            }

            const base: Record<string, unknown> = {
                platform_id: platformId,
                channel_id: body.channel_id,
                type: 'text',
                close_session: '0', // sessão continua aberta
            };
            if (resolvedAttId) base.attendance_id = resolvedAttId;
            if (body.contact_name) base.contact_name = body.contact_name;
            if (body.is_hsm) {
                base.is_hsm = true;
                base.hsm_template_name = body.hsm_template_name;
                base.hsm_placeholders = body.hsm_placeholders ?? [];
                base.message = body.message ?? '';
            } else {
                base.message = body.message;
            }
            // agent/agent_id só quando há attendance_id (regra do WideChat)
            if (resolvedAttId) {
                base.agent_id = resolvedAgentId ?? await agentId();
                base.agent = sendEmail;
            }
            // envia pela conta certa (não pelo wcCall, que usa sempre a de integração)
            const doSend = async (tok: string) => {
                const rr = await fetch(`${WIDECHAT_BASE}/message/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
                    body: JSON.stringify(base),
                });
                const dd = await rr.json().catch(() => null);
                return { r: rr, data: dd, ok: rr.ok && !(dd && dd.status === false) };
            };
            let sent = await doSend(sendToken);
            // token revogado (painel do WideChat aberto na mesma conta) -> re-login e tenta 1x
            if (!sent.ok && (sent.r.status === 401 || sent.r.status === 403 || (sent.data && sent.data.status === false))) {
                const pwd = sendEmail === integ.widechat_email ? integ.widechat_password
                    : (await supabase.from('user_integrations').select('widechat_password').ilike('widechat_email', sendEmail).maybeSingle()).data?.widechat_password;
                if (pwd) {
                    try {
                        const lr = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: sendEmail, password: pwd }),
                        });
                        const lj = await lr.json().catch(() => null);
                        if (lj?.token) sent = await doSend(lj.token);
                    } catch { /* fica com o resultado anterior */ }
                }
            }
            const { r, data } = sent;
            const status = r.status;
            const ok = sent.ok;
            const asAgent = sendEmail !== integ.widechat_email;
            console.log(`send_message ok=${ok} status=${status} via=${sendEmail} pid=${base.platform_id} chan=${base.channel_id} att=${base.attendance_id ?? '-'} resp=${JSON.stringify(data).slice(0, 600)}`);

            // registra a mensagem enviada no histórico com o TEXTO de verdade — o
            // webhook de `templateMessage` às vezes chega sem o corpo e grava só
            // "[Mídia]"; aqui a gente já tem o texto renderizado (base.message).
            const wcMsgId = (data as any)?.messages?.message_id ?? null;
            if (ok && body.lead_id && base.message) {
                try {
                    await supabase.from('widechat_messages').insert({
                        lead_id: body.lead_id,
                        session_id: body.attendance_id ?? 'api',
                        message_id: wcMsgId,
                        type: body.is_hsm ? 'template' : 'text',
                        message: String(base.message),
                        origin: 'agent',
                        sender_name: callerName, // quem operou de fato (não a conta de integração)
                        created_at: new Date().toISOString(),
                    });
                } catch { /* histórico é best-effort */ }
            }
            // SEMPRE 200: assim o front lê o erro REAL do WideChat (com 4xx/5xx o
            // supabase-js engole o corpo e só diz "non-2xx status code").
            if (!ok) {
                const detail = typeof data === 'string' ? data
                    : (data?.message || data?.error || data?.errors || JSON.stringify(data ?? {}));
                return jsonRes({ error: `WideChat ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, wc_status: status, wc_body: data });
            }
            return jsonRes({ success: true, data, message_id: wcMsgId });
        }

        // ── message_status: confere se a mensagem foi ENTREGUE (o /message/send só
        // confirma que a Meta ACEITOU o pedido; a entrega pode falhar depois, ex.
        // erro 131049 da Meta — limite de engajamento pra template de marketing) ──
        if (action === 'message_status') {
            const { ok, status, data } = await wcCall('/message/read', {
                method: 'POST',
                body: JSON.stringify({ platform_id: brDigits(body.platform_id), channel_id: body.channel_id }),
            });
            if (!ok) return jsonRes({ error: data }, status);
            const msgs = Array.isArray(data) ? data : (data?.data ?? []);
            const outbound = msgs.filter((m: any) => m?.origin === 'api' || m?.origin === 'agent' || m?.origin === 'user');
            const last = outbound[outbound.length - 1] ?? null;
            return jsonRes({
                success: true,
                last: last && {
                    message_id: last.message_id,
                    status: last.status ?? null,          // 'failed' | 'sent' | 'delivered' | 'read' | ...
                    created_at: last.created_at,
                    error_code: last.details?.code ?? null,
                    error_message: last.details?.error_data?.details ?? last.details?.message ?? null,
                },
            });
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
