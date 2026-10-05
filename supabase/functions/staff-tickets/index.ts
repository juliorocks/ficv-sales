// staff-tickets — agente/equipe abre um chamado em nome de um aluno (ou de uma turma inteira),
// pedido do usuário 02/10: "precisamos ter a opção de nós, agentes, abrir um chamado para
// determinado aluno, ou por turma etc."
//
//   search_aluno { q }        → busca aluno pelo nome direto no Sponte (não só quem já tem Portal)
//   search_turma { q }        → busca turma ABERTA pelo nome
//   turma_roster { turma_id } → matriculados na turma (pra conferir antes de abrir pra todos)
//   create { targets: [{aluno_id, nome}], curso_nome?, nivel?, categoria, titulo, descricao }
//       → pra cada aluno: garante a conta do Portal (cria na hora se não tiver, mesmo fluxo do
//         1º acesso) e abre 1 chamado, já com a 1ª mensagem (o texto que o agente escreveu).
//
// Só staff (qualquer papel que atende chamado, não só admin/agent — achado ao vivo 02/10 no
// apagar-mensagem: um coordenador de verdade fica de fora do is_staff() genérico).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, jsonRes } from "../_shared/ai.ts";
import { ensureAlunoAccountById } from "../_shared/aluno.ts";
import { sponteBuscarAlunos, sponteBuscarTurmas, sponteRosterTurma } from "../_shared/sponte.ts";
import { boletimFor, overviewFor } from "../_shared/alunoPortalCore.ts";

const TICKET_STAFF_ROLES = ["admin", "agent", "secretaria", "tutor", "coordenador", "atendente", "biblioteca"];
// mesmo critério de 3 níveis que ticket_visible() já usa no Postgres (RLS) — repetido aqui
// porque essa function roda com service role (sem auth.uid() de contexto pra chamar a RPC
// direto) e o transfer_queue abaixo PRECISA checar isso na mão antes de mexer.
const TICKET_FULL_ACCESS_ROLES = ["admin", "agent", "coordenador"];
// Financeiro (parcelas) é dado mais sensível — pedido do usuário 02/10: só quem já lida com
// cobrança/financeiro vê. Notas/cadastro (aluno_overview sem parcelas, aluno_boletim) seguem
// abertos a todo TICKET_STAFF_ROLES, igual à visibilidade de chamados em si.
const FINANCEIRO_ROLES = ["admin", "agent", "secretaria", "coordenador"];

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return jsonRes({ error: "Sessão inválida." }, 401);
    const { data: caller } = await db.from("profiles").select("id, full_name, role").eq("id", user.id).maybeSingle();
    if (!caller || !TICKET_STAFF_ROLES.includes(caller.role)) return jsonRes({ error: "Só a equipe pode abrir chamado em nome de um aluno." }, 403);

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action;

        if (action === "search_aluno") {
            const q = String(body.q ?? "").trim();
            if (q.length < 3) return jsonRes({ results: [] });
            const results = await sponteBuscarAlunos(q);
            return jsonRes({ results: results.slice(0, 20) });
        }

        if (action === "search_turma") {
            const q = String(body.q ?? "").trim();
            if (q.length < 3) return jsonRes({ results: [] });
            const results = await sponteBuscarTurmas(q);
            return jsonRes({ results: results.slice(0, 20) });
        }

        if (action === "turma_roster") {
            const turmaId = Number(body.turma_id);
            if (!turmaId) return jsonRes({ error: "turma_id obrigatório." }, 400);
            const roster = await sponteRosterTurma(turmaId);
            return jsonRes({ roster });
        }

        // Painel do aluno dentro do chamado (pedido do usuário 02/10: atendente ver Financeiro/Notas
        // sem sair da tela de Chamados — mesmo dado que o aluno vê no /aluno, mas pelo aluno_id do
        // ticket em vez do JWT do próprio aluno).
        if (action === "aluno_overview" || action === "aluno_boletim") {
            const alunoId = String(body.aluno_id ?? "");
            if (!alunoId) return jsonRes({ error: "aluno_id obrigatório." }, 400);
            const { data: aluno } = await db.from("alunos")
                .select("id, nome, cpf, email, telefone, ra, sponte_aluno_id, nivel").eq("id", alunoId).maybeSingle();
            if (!aluno?.sponte_aluno_id) return jsonRes({ error: "Aluno sem matrícula vinculada ao Sponte." }, 404);

            if (action === "aluno_boletim") {
                const r = await boletimFor(aluno.sponte_aluno_id, aluno.email ?? null, body);
                return jsonRes(r.body, r.status);
            }
            const result = await overviewFor(db, aluno as any);
            if (!FINANCEIRO_ROLES.includes(caller.role)) (result as any).parcelas = [];
            return jsonRes(result);
        }

        // Transferir pra OUTRA fila (equipe diferente) — pedido do usuário 05/10 (print da
        // Izabelly: "apareceu a mensagem que foi, mas está ainda na minha caixa"). Isso solta o
        // atendente atual (volta pro status Aberto), senão o chamado continua "preso" na caixa
        // de quem transferiu mesmo depois de mudar de fila (ticket_visible() libera visão pra
        // quem é o atendente, independente da fila). Precisa rodar com service role: o UPDATE
        // que zera atendente_id + muda queue_id ao mesmo tempo faz o RLS normal (tickets_update)
        // rejeitar a PRÓPRIA transferência — a policy reavalia visibilidade em cima da LINHA
        // NOVA (sem atendente, fila que quem transferiu não é membro) e barra o UPDATE. Por
        // isso a checagem de acesso abaixo é feita na mão, igual ticket_visible() faz, antes de
        // usar o service role (que não passa pelo RLS).
        if (action === "transfer_queue") {
            const ticketId = Number(body.ticket_id);
            const queueId = Number(body.queue_id);
            if (!ticketId || !queueId) return jsonRes({ error: "ticket_id e queue_id obrigatórios." }, 400);
            const { data: t } = await db.from("tickets").select("id, queue_id, atendente_id").eq("id", ticketId).maybeSingle();
            if (!t) return jsonRes({ error: "Chamado não encontrado." }, 404);
            const podeVer = TICKET_FULL_ACCESS_ROLES.includes(caller.role)
                || t.atendente_id === caller.id
                || !!(await db.from("ticket_queue_members").select("queue_id").eq("queue_id", t.queue_id).eq("profile_id", caller.id).maybeSingle()).data;
            if (!podeVer) return jsonRes({ error: "Você não tem acesso a este chamado." }, 403);
            const { error: upErr } = await db.from("tickets").update({ queue_id: queueId, atendente_id: null, status: "aberto" }).eq("id", ticketId);
            if (upErr) return jsonRes({ error: upErr.message }, 500);
            const { data: fila } = await db.from("ticket_queues").select("nome").eq("id", queueId).maybeSingle();
            return jsonRes({ ok: true, queue_nome: fila?.nome ?? null });
        }

        // Apagar chamado de vez — pedido do usuário 05/10 ("colocar pra Admins poder apagar
        // cards e, consequentemente, os NPS ligados"). Só admin. Roda com service role: as
        // tabelas filhas (ticket_messages, ticket_evaluations, ticket_email_outbox) já têm
        // ON DELETE CASCADE no banco, mas RLS de DELETE não existe em NENHUMA delas — um
        // DELETE direto do cliente (mesmo como admin) falharia tentando cascatear pra
        // ticket_evaluations sem policy de DELETE lá. Service role bypassa RLS nas 4 tabelas
        // de uma vez, sem precisar abrir policy de DELETE em nenhuma (mais contido/auditável
        // só aqui do que espalhar "admin pode apagar" em 4 tabelas diferentes).
        if (action === "delete_ticket") {
            if (caller.role !== "admin") return jsonRes({ error: "Só administradores podem apagar chamados." }, 403);
            const ticketId = Number(body.ticket_id);
            if (!ticketId) return jsonRes({ error: "ticket_id obrigatório." }, 400);
            const { error, count } = await db.from("tickets").delete({ count: "exact" }).eq("id", ticketId);
            if (error) return jsonRes({ error: error.message }, 500);
            if (!count) return jsonRes({ error: "Chamado não encontrado." }, 404);
            return jsonRes({ ok: true });
        }

        if (action === "create") {
            const targets = Array.isArray(body.targets) ? body.targets : [];
            const titulo = String(body.titulo ?? "").trim();
            const descricao = String(body.descricao ?? "").trim();
            const categoria = String(body.categoria ?? "").trim();
            const cursoNome = body.curso_nome ? String(body.curso_nome) : null;
            const nivel = body.nivel === "pos" || body.nivel === "graduacao" ? body.nivel : null;
            if (!targets.length) return jsonRes({ error: "Selecione ao menos 1 aluno." }, 400);
            if (!titulo || !descricao || !categoria) return jsonRes({ error: "Preencha assunto, título e mensagem." }, 400);
            // mesmo limite de segurança que o 1º-acesso/transferência já respeitam implicitamente
            // (nunca disparado em massa de uma vez) — turma inteira cabe folgado nisso.
            if (targets.length > 300) return jsonRes({ error: "No máximo 300 alunos por vez." }, 400);

            const results: { aluno_id: number; nome: string; ok: boolean; ticket_id?: number; protocolo?: string; created_account?: boolean; error?: string }[] = [];
            for (const t of targets) {
                const sponteId = Number(t?.aluno_id);
                const nomeAlvo = String(t?.nome ?? "");
                if (!sponteId) { results.push({ aluno_id: sponteId, nome: nomeAlvo, ok: false, error: "aluno_id inválido" }); continue; }
                try {
                    const r = await ensureAlunoAccountById(db, sponteId);
                    if (r.error || !r.aluno) { results.push({ aluno_id: sponteId, nome: nomeAlvo, ok: false, error: r.error ?? "sem conta" }); continue; }
                    const aluno = r.aluno;
                    const now = new Date().toISOString();
                    const { data: ticketData, error: tErr } = await db.from("tickets").insert({
                        protocolo: "", titulo, categoria, prioridade: "media", status: "aguardando_aluno", origem: "agente",
                        aluno_id: aluno.id, aluno_nome: aluno.nome, aluno_email: aluno.email || null,
                        curso_nome: cursoNome, nivel: nivel ?? aluno.nivel ?? null,
                        atendente_id: caller.id, first_response_at: now,
                    }).select().single();
                    if (tErr || !ticketData) { results.push({ aluno_id: sponteId, nome: aluno.nome, ok: false, error: tErr?.message ?? "erro ao criar chamado" }); continue; }
                    const { error: mErr } = await db.from("ticket_messages").insert({
                        ticket_id: ticketData.id, autor_id: caller.id, autor_nome: caller.full_name, autor_role: caller.role,
                        conteudo: descricao, interno: false,
                    });
                    if (mErr) { results.push({ aluno_id: sponteId, nome: aluno.nome, ok: false, error: mErr.message }); continue; }
                    results.push({ aluno_id: sponteId, nome: aluno.nome, ok: true, ticket_id: ticketData.id, protocolo: ticketData.protocolo, created_account: r.created });
                } catch (e) {
                    results.push({ aluno_id: sponteId, nome: nomeAlvo, ok: false, error: (e as Error).message });
                }
            }
            return jsonRes({ results, created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
        }

        return jsonRes({ error: `Ação desconhecida: ${action}` }, 400);
    } catch (e) {
        console.error("staff-tickets:", e);
        return jsonRes({ error: "Serviço indisponível no momento. Tente de novo em instantes." }, 500);
    }
});
