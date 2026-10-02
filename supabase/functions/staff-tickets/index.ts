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

const TICKET_STAFF_ROLES = ["admin", "agent", "secretaria", "tutor", "coordenador", "atendente", "biblioteca"];

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
