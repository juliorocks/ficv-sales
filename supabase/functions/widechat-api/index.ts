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
//   send_message -> POST /message/send                  (texto, HSM ou mídia — body.media)
//   list_agents  -> GET /user/agents/online              (agentes p/ transferir)
//   list_teams   -> GET /campaigns                       (filas/equipes p/ transferir)
//   transfer     -> POST /attendances/transfer           (transfere a conversa)
//   finish_attendance -> POST /attendances/finish        (encerra o atendimento)
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

        // agent_id (usado no send_message pra atribuir/reivindicar attendance). Só vem
        // preenchido quando freshLogin() rodou nessa request (token expirado/ausente);
        // com token em CACHE (caso comum) fica undefined. `/agents/profile` NÃO serve de
        // fallback — devolve 404 "Agente não encontrado" pra conta de integração
        // (confirmado ao vivo, 2026-09-16). Único jeito confiável de obter o id é o
        // `user._id` da resposta de login — por isso refaz login (freshLogin já grava o
        // token novo em cache, sem custo extra real).
        async function agentId(): Promise<string | undefined> {
            if (wcAgentId) return wcAgentId;
            await freshLogin();
            return wcAgentId;
        }

        // ── attendances: acha o atendimento do lead ───────────────────────────
        if (action === 'attendances') {
            const { ok, status, data } = await wcCall('/user/agents/attendances_plus');
            if (!ok) return jsonRes({ error: data }, status);
            const rawTel = String(body.telefone ?? '');
            const digits = rawTel.replace(/\D/g, '');
            const sess = String(body.session_id ?? '').trim();
            const all = [...(data.attendance ?? []), ...(data.wait ?? [])];
            // o `_id` da attendance É o session_id do lead. Casa por ele, ou pelo
            // platform_id (= leads.telefone, ex "US.xxx" ou "5583..."), ou pelos
            // últimos 8 dígitos do wa_id/telefone.
            const suf = digits.length >= 8 ? digits.slice(-8) : '';
            const match =
                (sess && all.find((a: any) => String(a._id ?? '') === sess)) ||
                (rawTel && all.find((a: any) => String(a.platform_id ?? '') === rawTel)) ||
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
            // platform_id do WideChat: número BR = "5583..." (dá pra prepender 55);
            // estrangeiro = id interno "US.21493..." — passa CRU (brDigits comia o "US."
            // e a Meta recusava "undeliverable" 131026).
            const rawPid = String(body.platform_id ?? '');
            const platformId = /[^\d+]/.test(rawPid) ? rawPid : brDigits(rawPid);

            // ATRIBUIÇÃO: se o agente logado tem login PRÓPRIO no WideChat, a mensagem
            // sai por ele (aparece com o nome dele no WhatsApp). Só cai na conta de
            // integração quem não cadastrou o próprio login.
            const ownRow = (await supabase.from('user_integrations')
                .select('widechat_email, widechat_password').eq('user_id', who.id).maybeSingle()).data;
            let sendEmail = integ.widechat_email as string;
            let sendPwd = integ.widechat_password as string;
            // agentId() pode chamar freshLogin() e reatribuir o wcToken do módulo (quando
            // o token em cache não tinha o id do agente ainda) — por isso sendToken só
            // pode ser lido DEPOIS, senão fica com um token velho enquanto o resto da
            // função já está usando o novo (bug real, pego ao vivo 2026-09-16: a busca de
            // attendance com o token velho voltava vazia mesmo a conversa existindo).
            let sendAgentId = await agentId();
            let sendToken = wcToken;
            if (ownRow?.widechat_email && ownRow?.widechat_password && ownRow.widechat_email !== integ.widechat_email) {
                try {
                    const lr = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: ownRow.widechat_email, password: ownRow.widechat_password }),
                    });
                    const lj = await lr.json().catch(() => null);
                    if (lj?.token && lj?.user?.type !== 'admin') {
                        sendEmail = ownRow.widechat_email; sendPwd = ownRow.widechat_password;
                        sendToken = lj.token; sendAgentId = lj.user?._id;
                    }
                } catch { /* fica com a conta de integração */ }
            }

            // ── mídia (arquivo/áudio) ──────────────────────────────────────────
            // Doc oficial (SZ.chat/Fortics, plataforma por trás do WideChat — achada
            // via /docs/pt-br/messages/send_message do próprio tenant): `/message/send`
            // aceita `type:"media"` + `file:"<url pública>"` + `legend` opcional. NÃO
            // precisa de upload/storage_id — a mídia é só uma URL acessível de fora.
            // `body.media.public_url` já vem pronto do front (getPublicUrl do bucket
            // widechat-attachments, que é público).
            const mediaUrl: string | undefined = !body.is_hsm ? body.media?.public_url : undefined;

            // attendance_id: procura o atendimento ABERTO desse contato NA CONTA que
            // vai enviar (casa por platform_id — o objeto de attendance NÃO tem
            // session_id). Com ele o WideChat aceita agent/agent_id e a msg fica
            // amarrada na conversa certa.
            // body.attendance_id às vezes já vem pronto do front (WideChatHistory.tsx chama
            // action=attendances antes e manda o `_id` do match) — mas aquele endpoint devolve
            // tanto attendance de verdade quanto item ainda em fila ("wait"), sem distinguir.
            // NÃO dá pra confiar nele cru: precisa confirmar `isAttendance` fresco abaixo.
            let resolvedAttId = body.attendance_id as string | undefined;
            // SEMPRE o agent_id de quem está de fato autenticando o envio (sendAgentId),
            // nunca de outra fonte — agent_id e agent (email) têm que ser sempre o MESMO
            // login, senão o WideChat recusa.
            const resolvedAgentId: string | undefined = sendAgentId;
            // guarda a attendance encontrada (mesmo se ainda em "wait") — usada depois do
            // envio pra reivindicar a conversa pro agente (ver claimWaitAttendance abaixo).
            let foundAttendance: any = null;
            let attendanceLookupOk = false;
            {
                // Rodava só pra texto/mídia (`!body.is_hsm`) — bug real, 2026-09-17: isso
                // deixava TODO template sem a validação de platform_id "de verdade" (ver
                // sendPlatformId abaixo) e sem a chance de reivindicar um atendimento já
                // existente em "wait" ANTES de enviar (só sobrava o hsmRouting, que roda
                // DEPOIS do send). Rodar sempre (mesmo pra HSM) só ENRIQUECE os dados —
                // não bloqueia nada sozinho (quem bloqueia é o guard ATTENDANCE_NOT_VISIBLE
                // logo abaixo, esse sim continua exclusivo de texto/mídia, pra não quebrar
                // o cold-start de template pra contato novo).
                try {
                    const ar = await fetch(`${WIDECHAT_BASE}/user/agents/attendances_plus`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendToken}` } });
                    const ad = await ar.json().catch(() => null);
                    const all = [...((ad as any)?.attendance ?? []), ...((ad as any)?.wait ?? [])];
                    attendanceLookupOk = ar.ok && ad != null;
                    // o `_id` da attendance É o session_id (= leads.widechat_session_id).
                    // TELEFONE primeiro, sempre — platform_id/wa_id são estáveis (o número
                    // não muda), enquanto session_id/attendance_id vêm do FRONT e podem estar
                    // até 5min desatualizados (query sem staleTime curto, sem realtime, sem
                    // refetch antes de enviar — ver WideChatHistory.tsx). Bug real, 2026-09-16,
                    // lead "jcs.sjc"/agente Thayanne: a sessão desse contato mudou várias vezes
                    // no mesmo dia; o `body.session_id` velho ainda batia com uma attendance
                    // ANTIGA que a WideChat listava em attendances_plus, e como o `.find()`
                    // testava session_id ANTES de platform_id, ganhava essa attendance errada —
                    // cujo contexto de fila/equipe não incluía a agente, gerando 422 "não faz
                    // parte desta equipe" mesmo com a conta dela 100% correta (confirmado: o
                    // mesmo envio funcionou normalmente direto no painel nativo da WideChat).
                    const m = all.find((a: any) => String(a.platform_id ?? '') === platformId)
                        ?? all.find((a: any) => a.wa_id && brDigits(String(a.wa_id)) === brDigits(platformId))
                        ?? all.find((a: any) => body.session_id && String(a._id ?? '') === String(body.session_id))
                        ?? all.find((a: any) => body.attendance_id && String(a._id ?? '') === String(body.attendance_id))
                        ?? null;
                    foundAttendance = m ?? null;
                    // só usa attendance_id (e por consequência agent/agent_id, exigidos junto)
                    // quando é uma attendance DE VERDADE, já aceita por alguém (`isAttendance:
                    // true`). Um item ainda na fila (`wait`, isAttendance:false, agent_id:null —
                    // "Em alguns instantes um consultor falará contigo") não pertence a nenhum
                    // agente ainda; mandar agent/agent_id nele faz o WideChat recusar 422 "o
                    // agente X não faz parte desta equipe", mesmo com X sendo um agente válido.
                    // SEMPRE decide pelo resultado fresco daqui — mesmo que body.attendance_id já
                    // tivesse vindo preenchido do front (1ª tentativa de fix não pegou esse caso:
                    // só setava resolvedAttId, nunca limpava o que já tinha vindo pronto).
                    if (m?._id) resolvedAttId = m.isAttendance ? String(m._id) : undefined;
                } catch { /* segue com o que veio do body */ }
            }

            // Sem attendance nenhuma (nem em "wait") pra esse contato NA CONTA que vai
            // enviar: o botão de texto livre só aparece com conversa recente aberta
            // (windowOpen em WideChatHistory.tsx), então isso quase sempre quer dizer
            // que a conta que está mandando (conta compartilhada de fallback, quando o
            // agente não tem login próprio) não enxerga a conversa — não que ela não
            // existe. Mandar mesmo assim faz o WideChat abrir uma sessão NOVA e
            // paralela (reinicia o bot do zero pro cliente) em vez de continuar a
            // conversa real. Bug real, 2026-09-16: duplicou a conversa da "Iza" e saiu
            // atribuído a "Julio César" (nome da conta de integração no WideChat) em
            // vez da agente que respondeu de verdade. Só bloqueia quando a busca
            // realmente RODOU e voltou vazia — erro de rede na busca não deve travar
            // o envio (mesma filosofia do catch acima).
            if (!body.is_hsm && attendanceLookupOk && !foundAttendance) {
                return jsonRes({
                    error: `Não encontrei o atendimento ativo desse contato na conta usada pra enviar (${sendEmail}). Isso costuma acontecer quando o agente ainda não tem login próprio do WideChat cadastrado. Peça pra cadastrar em Configurações > Integração WideChat — enviar assim criaria uma conversa duplicada no WideChat.`,
                    code: 'ATTENDANCE_NOT_VISIBLE',
                });
            }

            // ── reivindica attendance ainda em "wait" — ANTES de mandar, não depois ──
            // Bug real, 2026-09-16, lead "jcs.sjc": a ordem antiga era mandar a mensagem
            // PRIMEIRO (sem attendance_id/agent, porque o WideChat recusa esses campos
            // pra item ainda em "wait") e só aceitar DEPOIS do envio (ver claim mais
            // abaixo). O aceite chegava e era confirmado pela própria WideChat
            // (accept_attendance, protocolo certo, sessão certa) — mas o /message/send
            // que já tinha saído segundos antes SEM attendance vinculada bagunçava o
            // roteamento: a PRÓXIMA mensagem do cliente caía numa sessão NOVA e
            // paralela, onde o bot tratava como conversa do zero. No painel nativo da
            // WideChat isso nunca acontece porque o agente sempre aceita a fila antes
            // de poder digitar. Aceitando aqui ANTES de montar `base`, o send já sai
            // com attendance_id/agent corretos desde a primeira tentativa.
            //
            // Também roda pra HSM agora (não excluído mais por `!body.is_hsm`) — achado
            // na varredura de 2026-09-17: template mandado pra um contato com atendimento
            // já em "wait" (visível, diferente do cold-start que nasce em fase "bot" —
            // ver [[project_widechat_bot_reentry]]) não reivindicava antes de enviar,
            // dependendo só do `hsmRouting` pós-envio pra consertar depois. Reivindicar
            // aqui elimina essa janela por completo pra quem já tem attendance visível.
            let justAccepted = false;
            if (foundAttendance?._id && foundAttendance.isAttendance === false && resolvedAgentId) {
                try {
                    const xr = await fetch(`${WIDECHAT_BASE}/attendances/accept`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendToken}` },
                        body: JSON.stringify({ session_id: String(foundAttendance._id), agent_id: resolvedAgentId }),
                    });
                    const xj = await xr.json().catch(() => null);
                    if (xr.ok && !(xj && xj.status === false)) {
                        foundAttendance.isAttendance = true;
                        resolvedAttId = String(foundAttendance._id);
                        justAccepted = true;
                        // o accept confirma na hora ("Contato aceito!"), mas o vínculo
                        // agente↔equipe usado pelo /message/send pra validar `agent_id` leva
                        // um instante pra propagar do lado da WideChat — mandar o send na
                        // sequência, sem pausa, corre pra trás dessa propagação e volta 422
                        // "o agente X não faz parte desta equipe" mesmo com o accept já ok
                        // (bug real, 2026-09-16, lead "jcs.sjc"/Thayanne — accept confirmado,
                        // sessão certa, sem sessão duplicada, e o send ainda assim recusou).
                        await new Promise((res) => setTimeout(res, 1200));
                    }
                } catch { /* segue sem accept — send vai sem attendance_id, mesmo comportamento de antes */ }
            }

            // platform_id de VERDADE é o que já está gravado na própria attendance
            // encontrada, quando existe — a suposição antiga "BR sempre bate com o
            // telefone puro" (comentário acima) não vale pra todo canal: essa attendance
            // tinha `platform_id:"BR.1804740536986870"` (id interno da WideChat) enquanto
            // calculávamos "5512996836409" a partir do telefone puro. Mandar o platform_id
            // errado faz o /message/send não reconhecer o vínculo com a campanha/equipe —
            // mesmo com agent_id/attendance_id/channel_id todos certos (bug real,
            // 2026-09-16, lead "jcs.sjc"/Thayanne — só apareceu depois do DIAG mostrar
            // tudo certo, exceto isso). Sem attendance encontrada (ex: HSM cold-start pra
            // contato novo), cai no valor calculado do telefone — não tem outra fonte.
            const sendPlatformId = foundAttendance?.platform_id ? String(foundAttendance.platform_id) : platformId;

            const base: Record<string, unknown> = {
                platform_id: sendPlatformId,
                channel_id: body.channel_id,
                type: 'text',
                // REVERTIDO (testado ao vivo, 2026-09-11): '2' devolve 422 "attendance_id
                // é obrigatório quando close_session=2" — só serve pra fechar uma
                // attendance QUE JÁ EXISTE, não serve pra contato novo. '0' é o único
                // valor que funciona sem attendance_id. O problema do "cai no bot" segue
                // sendo resolvido só pelo post-transfer logo abaixo (hsmRouting).
                close_session: '0',
            };
            if (resolvedAttId) base.attendance_id = resolvedAttId;
            if (body.contact_name) base.contact_name = body.contact_name;
            if (body.is_hsm) {
                base.is_hsm = true;
                base.hsm_template_name = body.hsm_template_name;
                base.hsm_placeholders = body.hsm_placeholders ?? [];
                base.message = body.message ?? '';
            } else if (mediaUrl) {
                base.type = 'media';
                base.file = mediaUrl;
                if (body.media.legend) base.legend = body.media.legend;
            } else {
                base.message = body.message;
            }
            // agent/agent_id só quando há attendance_id (regra do WideChat)
            if (resolvedAttId) {
                base.agent_id = resolvedAgentId;
                base.agent = sendEmail;
            }

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
            // token revogado (painel do WideChat aberto na mesma conta) -> re-login 1x
            if (!sent.ok && (sent.r.status === 401 || sent.r.status === 403 || (sent.data && sent.data.status === false)) && sendPwd) {
                try {
                    const lr = await fetch(`${WIDECHAT_BASE}/auth/login`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: sendEmail, password: sendPwd }),
                    });
                    const lj = await lr.json().catch(() => null);
                    if (lj?.token) sent = await doSend(lj.token);
                } catch { /* fica com o resultado anterior */ }
            }
            // ainda 422 "não faz parte desta equipe" logo depois de um accept que
            // acabou de confirmar sucesso — é a mesma janela de propagação do comentário
            // acima, só que a pausa de 1.2s não foi suficiente. Espera mais um pouco e
            // tenta mandar de novo, 1x só (não é problema de credencial, retry de login
            // não ajudaria).
            if (justAccepted && !sent.ok && sent.r.status === 422 &&
                /n[ãa]o faz parte (desta|da) equipe/i.test(JSON.stringify(sent.data ?? ''))) {
                await new Promise((res) => setTimeout(res, 2000));
                sent = await doSend(sendToken);
            }
            const { r, data } = sent;
            const status = r.status;
            const ok = sent.ok;
            const asAgent = sendEmail !== integ.widechat_email;
            console.log(`send_message ok=${ok} status=${status} via=${sendEmail} pid=${platformId} chan=${body.channel_id} att=${base.attendance_id ?? '-'} resp=${JSON.stringify(data).slice(0, 600)}`);

            // ── TEMPLATE OU MÍDIA = risco de cair no BOT. Sem isso, quando o cliente
            // responde (a um template OU a uma mídia mandada por aqui) ele cai no BOT
            // (LGPD, menu "com qual área...") em vez de falar com o agente — mesmo numa
            // attendance que já estava 'human' ANTES do envio (bug real, 2026-09-17:
            // áudio mandado numa conversa já ativa e aceita, cliente respondeu o áudio,
            // bot reentrou do mesmo jeito que reentrava com template). Reafirma/reclama
            // a attendance certa logo após o envio. O painel do WideChat já faz isso
            // sozinho pra template; pra mídia parece ser o mesmo comportamento interno
            // do lado deles (não documentado, mas a mitigação é a mesma e é barata —
            // não HÁ efeito colateral quando a attendance já está 'human': o `if
            // (m.phase !== 'human')` abaixo simplesmente não faz nada).
            const hsmRouting: any = {};
            if (ok && (body.is_hsm || mediaUrl)) {
                const COMERCIAL_Q = Deno.env.get('WIDECHAT_COMERCIAL_QUEUE_ID') ?? '690caf35d66ff3152c0917e8';
                const findAtt = async (): Promise<any> => {
                    for (const url of [
                        `${WIDECHAT_BASE}/user/agents/attendances_plus`,
                        `${WIDECHAT_BASE}/attendances?limit=80`,
                    ]) {
                        try {
                            const rr = await fetch(url, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendToken}` } });
                            const dd = await rr.json().catch(() => null);
                            const arr = Array.isArray(dd) ? dd
                                : [...((dd as any)?.attendance ?? []), ...((dd as any)?.wait ?? []), ...((dd as any)?.data ?? [])];
                            const hit = arr.find((a: any) => String(a.platform_id ?? '') === platformId
                                || (a.wa_id && brDigits(String(a.wa_id)) === brDigits(platformId)));
                            if (hit) return hit;
                        } catch { /* próxima url */ }
                    }
                    return null;
                };
                try {
                    let m: any = null;
                    for (let i = 0; i < 2 && !m; i++) {
                        await new Promise((res) => setTimeout(res, i === 0 ? 1500 : 2200));
                        m = await findAtt();
                    }
                    hsmRouting.attendance = m ? { _id: m._id, phase: m.phase, campaign_id: m.campaign_id } : null;
                    if (m?._id && m.phase !== 'human') {
                        // `/attendances/transfer` com type:'agent' devolve 412 "Sessão não está em
                        // atendimento" pra item ainda em "wait" (confirmado ao vivo, 2026-09-16) —
                        // transfer só move entre attendances JÁ aceitas. A rota certa pra reivindicar
                        // um item de fila é `/attendances/accept` (achada por tentativa, mesma data;
                        // devolve "Contato aceito!" e vira isAttendance:true/phase:human).
                        if (asAgent && sendAgentId) {
                            const xr = await fetch(`${WIDECHAT_BASE}/attendances/accept`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendToken}` },
                                body: JSON.stringify({ session_id: String(m._id), agent_id: sendAgentId }),
                            });
                            hsmRouting.transfer = { to: 'agent', http: xr.status, body: await xr.text().catch(() => '') };
                        } else {
                            const xr = await fetch(`${WIDECHAT_BASE}/attendances/transfer`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendToken}` },
                                body: JSON.stringify({ session_id: String(m._id), type: 'attendance', attendance_id: COMERCIAL_Q, transfer_wait: true }),
                            });
                            hsmRouting.transfer = { to: 'comercial', http: xr.status, body: await xr.text().catch(() => '') };
                        }
                    }
                    console.log('hsm routing:', JSON.stringify(hsmRouting).slice(0, 500));
                } catch (e) { hsmRouting.error = String(e); }
            }

            // ── reivindica attendance ainda em "wait" — fallback ─────────────────
            // O aceite principal agora acontece ANTES do envio (ver bloco acima, perto
            // do guard ATTENDANCE_NOT_VISIBLE) — isso aqui só dispara se aquele aceite
            // falhou (ex: erro de rede) e o send ainda assim saiu sem attendance_id.
            // Mantido como segunda tentativa; `/attendances/accept` (não /transfer — ver
            // comentário no hsmRouting acima) confirmado ao vivo: devolve
            // isAttendance:true/phase:human.
            const claimWait: any = {};
            if (ok && !body.is_hsm && foundAttendance?._id && foundAttendance.isAttendance === false && resolvedAgentId) {
                try {
                    const xr = await fetch(`${WIDECHAT_BASE}/attendances/accept`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendToken}` },
                        body: JSON.stringify({ session_id: String(foundAttendance._id), agent_id: resolvedAgentId }),
                    });
                    claimWait.http = xr.status;
                    claimWait.body = await xr.text().catch(() => '');
                    console.log('claim wait attendance:', JSON.stringify(claimWait).slice(0, 400));
                } catch (e) { claimWait.error = String(e); }
            }

            // registra a mensagem enviada no histórico com o TEXTO de verdade — o
            // webhook de `templateMessage` às vezes chega sem o corpo e grava só
            // "[Mídia]"; aqui a gente já tem o texto renderizado (base.message).
            const wcMsgId = (data as any)?.messages?.message_id ?? null;
            if (ok && body.lead_id && (base.message || mediaUrl)) {
                try {
                    await supabase.from('widechat_messages').insert({
                        lead_id: body.lead_id,
                        session_id: body.attendance_id ?? 'api',
                        message_id: wcMsgId,
                        type: mediaUrl ? String(body.media.type || 'files') : (body.is_hsm ? 'template' : 'text'),
                        message: mediaUrl ? String(body.media.legend || body.media.filename || '[Mídia]') : String(base.message),
                        ...(mediaUrl ? { media_url: mediaUrl } : {}),
                        origin: 'agent',
                        sender_name: callerName, // quem operou de fato (não a conta de integração)
                        created_at: new Date().toISOString(),
                    });
                } catch { /* histórico é best-effort */ }
            }

            // avança Entrada -> Em Contato e atribui o agente, direto aqui (não
            // depende de eco de webhook). O `widechat-webhook` já faz isso quando
            // recebe uma mensagem com origin='agent' — mas isso só existe se o
            // WideChat de fato reenviar via webhook uma mensagem que a gente mandou
            // pela API (nunca confirmado — só visto acontecer pro painel NATIVO
            // deles, num registro de meses atrás). Bug real, 2026-09-17: lead
            // "jcs.sjc" ficou preso em Entrada apesar de vários envios da Thayanne
            // pelo nosso painel. Fazendo aqui, não depende dessa suposição.
            if (ok && body.lead_id) {
                try {
                    const { data: leadRow } = await supabase.from('leads')
                        .select('stage_id, assigned_to_id').eq('id', body.lead_id).maybeSingle();
                    if (leadRow) {
                        const upd: Record<string, unknown> = {};
                        const { data: stg0 } = await supabase.from('stages').select('id')
                            .order('order', { ascending: true }).limit(1).maybeSingle();
                        if (stg0?.id && leadRow.stage_id === stg0.id) {
                            const { data: emContato } = await supabase.from('stages').select('id')
                                .ilike('name', '%contato%').order('order', { ascending: true }).limit(1).maybeSingle();
                            if (emContato?.id) { upd.stage_id = emContato.id; upd.stage_entry_date = new Date().toISOString(); }
                        }
                        if (!leadRow.assigned_to_id) upd.assigned_to_id = who.id;
                        if (Object.keys(upd).length) await supabase.from('leads').update(upd).eq('id', body.lead_id);
                    }
                } catch { /* best-effort, não trava o envio */ }
            }
            // SEMPRE 200: assim o front lê o erro REAL do WideChat (com 4xx/5xx o
            // supabase-js engole o corpo e só diz "non-2xx status code").
            if (!ok) {
                const detail = typeof data === 'string' ? data
                    : (data?.message || data?.error || data?.errors || JSON.stringify(data ?? {}));
                // DEBUG TEMP 2026-09-16: 422 "não faz parte desta equipe" persistindo pra
                // Thayanne mesmo depois de 2 tentativas de fix (propagação, prioridade de
                // telefone no match) — em vez de adivinhar de novo, expõe as variáveis de
                // decisão direto na mensagem de erro (aparece no toast do front) pra
                // diagnosticar com o dado real da PRÓXIMA tentativa. Remover depois.
                const diag = {
                    sendEmail, sendAgentId: resolvedAgentId, attId: resolvedAttId,
                    justAccepted, sentChannelId: body.channel_id, sentPlatformId: sendPlatformId,
                    foundAtt: foundAttendance ? {
                        _id: foundAttendance._id, isAttendance: foundAttendance.isAttendance,
                        campaign_id: foundAttendance.campaign_id, phase: foundAttendance.phase,
                        agent_id: foundAttendance.agent_id, platform_id: foundAttendance.platform_id,
                        channel_id: foundAttendance.channel_id,
                    } : null,
                };
                return jsonRes({ error: `WideChat ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)} | DIAG ${JSON.stringify(diag)}`, wc_status: status, wc_body: data });
            }
            return jsonRes({ success: true, data, message_id: wcMsgId, ...((body.is_hsm || mediaUrl) ? { hsm_routing: hsmRouting } : {}), ...(Object.keys(claimWait).length ? { claim_wait: claimWait } : {}) });
        }

        // ── message_status: confere se a mensagem foi ENTREGUE (o /message/send só
        // confirma que a Meta ACEITOU o pedido; a entrega pode falhar depois, ex.
        // erro 131049 da Meta — limite de engajamento pra template de marketing) ──
        if (action === 'message_status') {
            const rawPid = String(body.platform_id ?? '');
            const pidForRead = /[^\d+]/.test(rawPid) ? rawPid : brDigits(rawPid);
            const { ok, status, data } = await wcCall('/message/read', {
                method: 'POST',
                body: JSON.stringify({ platform_id: pidForRead, channel_id: body.channel_id }),
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
                    error_code: last.details?.code ?? last.details?.error_data?.code ?? null,
                    error_message: last.details?.error_data?.details ?? last.details?.message ?? last.details?.title ?? null,
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
            if (!ok) {
                const d = typeof data === 'string' ? data : (data?.message || data?.error || JSON.stringify(data ?? {}));
                return jsonRes({ error: `WideChat ${status}: ${d}` });
            }
            return jsonRes({ success: true, data });
        }

        // ── finish: encerra o atendimento NO WideChat (não só localmente) ────────
        // Doc oficial (/docs/pt-br/attendances/finish): POST /attendances/finish
        // {session_id, tabulation_id?}. O webhook já escuta o evento de finalização
        // que a WideChat dispara depois disso e move o lead pra Finalizado sozinho
        // (mesma lógica que já existe pra finalização vinda do painel nativo deles).
        if (action === 'finish_attendance') {
            if (!body.session_id) return jsonRes({ error: 'session_id é obrigatório (widechat_session_id do lead).' }, 400);
            const payload: Record<string, unknown> = { session_id: body.session_id };
            if (body.tabulation_id) payload.tabulation_id = body.tabulation_id;
            const { ok, status, data } = await wcCall('/attendances/finish', {
                method: 'POST', body: JSON.stringify(payload),
            });
            if (!ok) {
                const d = typeof data === 'string' ? data : (data?.message || data?.error || JSON.stringify(data ?? {}));
                return jsonRes({ error: `WideChat ${status}: ${d}` });
            }
            return jsonRes({ success: true, data });
        }

        return jsonRes({ error: `Ação não suportada: ${action}` }, 400);

    } catch (error: any) {
        console.error('widechat-api:', error);
        return jsonRes({ error: error.message }, 500);
    }
});
