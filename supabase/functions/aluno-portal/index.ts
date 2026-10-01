// aluno-portal — dados do Sponte do aluno LOGADO no Portal do Aluno (/aluno).
// Só enxerga o próprio aluno: o AlunoID vem de alunos.sponte_aluno_id do usuário
// do JWT, nunca do corpo da requisição.
//
//   overview                                  → dados, matrículas, parcelas
//   boletim  { turma_id }                     → notas/faltas por disciplina
//   boletim  { turma_ids: [...] }             → o mesmo, de vários períodos do curso de uma vez
//   foto                                      → foto do aluno (data URL) ou null
//   pagamento { conta_receber_id, numero_parcela } → link Sponte Pay ou linha digitável
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { nivelDoCurso } from "../_shared/sponte.ts";
import { alunoBoletins, alunoFoto, alunoOverview, alunoPagamento } from "../_shared/alunoSponte.ts";
import { moodleAvaliacoes, moodleCourses, moodleDisciplinasDoPeriodo, moodleUserId } from "../_shared/alunoMoodle.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const n = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);

// Completa com o Moodle as notas que o Sponte NÃO tem (turma EAD — ver _shared/alunoMoodle.ts)
// — pedido do usuário 01/10: "casar" as duas fontes pra o painel de notas ficar 100% completo.
// Dois casos, nunca sobrescreve o que o Sponte já tem (presencial sempre vem de lá):
//   1. Sponte tem a disciplina lançada mas sem o detalhe (AV1/AV2) → completa só isso.
//   2. Sponte não lançou NENHUMA disciplina pro período inteiro (comum em turma EAD encerrada
//      — achado ao vivo 01/10, print do usuário: Moodle tinha nota completa pra um período que
//      sumia do portal) → monta a lista de disciplinas inteira a partir do Moodle.
// Só entra no Moodle se precisar — aluno 100% presencial não gasta a chamada à toa. Nunca
// derruba a tela: qualquer falha no Moodle deixa a turma como já estava.
async function completarComMoodle(
    turmas: { turma_id: number; turma?: string | null; disciplinas: { avaliacoes: unknown[] | null; media: string | null; disciplina: string }[] }[],
    email: string | null,
) {
    const precisaCompletar = turmas.some((t) => t.disciplinas.some((d) => !d.avaliacoes?.length));
    const precisaSintetizar = turmas.some((t) => t.disciplinas.length === 0 && t.turma);
    if (!precisaCompletar && !precisaSintetizar) return;
    const uid = await moodleUserId(email);
    if (!uid) return;
    const cursos = await moodleCourses(uid);
    if (!cursos.length) return;
    for (const t of turmas) {
        if (t.disciplinas.length === 0 && t.turma) {
            const sintetizadas = await moodleDisciplinasDoPeriodo(uid, cursos, t.turma);
            if (sintetizadas.length) (t as any).disciplinas = sintetizadas;
            continue;
        }
        for (const d of t.disciplinas) {
            if (d.avaliacoes?.length) continue;
            const m = await moodleAvaliacoes(uid, cursos, d.disciplina);
            if (m?.avaliacoes.length) {
                (d as any).avaliacoes = m.avaliacoes;
                if (!d.media && m.media) (d as any).media = m.media;
            }
        }
    }
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user?.email?.endsWith("@aluno.ficv.br")) return j({ error: "Sessão inválida." }, 401);
    const { data: aluno } = await db.from("alunos").select("id, nome, cpf, email, telefone, ra, sponte_aluno_id, nivel").eq("id", user.id).maybeSingle();
    if (!aluno?.sponte_aluno_id) return j({ error: "Sua conta ainda não está ligada ao Sponte. Procure a secretaria." }, 404);
    const A = aluno.sponte_aluno_id;

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "overview";

        if (action === "overview") {
            const { raw: a, aluno: sa, matriculas, parcelas } = await alunoOverview(A);

            // mantém o cadastro do portal em dia com o Sponte (e-mail é pra onde vão os avisos)
            const patch: Record<string, unknown> = {};
            if (n(a.Email) && !aluno.email) patch.email = a.Email.toLowerCase();
            if (n(a.Celular) && !aluno.telefone) patch.telefone = a.Celular;
            if (n(a.RA) && !aluno.ra) patch.ra = a.RA;
            // nível (graduação/pós) decide a fila da Tutoria nos chamados acadêmicos
            const vig = matriculas.find((m) => /vigente|ativ|cursando/i.test(m.situacao ?? "")) ?? matriculas[0];
            const nivel = nivelDoCurso(vig?.curso) ?? matriculas.map((m) => nivelDoCurso(m.curso)).find(Boolean) ?? null;
            if (nivel && nivel !== aluno.nivel) patch.nivel = nivel;
            if (Object.keys(patch).length) await db.from("alunos").update(patch).eq("id", aluno.id);

            return j({
                // cpf vem só do nosso cadastro (é o que já usamos pra login) — o Sponte não
                // devolve isso em GetAlunos; usado na Declaração de Matrícula.
                aluno: { ...sa, nome: sa.nome ?? aluno.nome, ra: sa.ra ?? aluno.ra, email: sa.email ?? aluno.email, celular: sa.celular ?? aluno.telefone, cpf: aluno.cpf ?? null },
                matriculas, parcelas,
            });
        }

        if (action === "boletim" && Array.isArray(body.turma_ids)) {
            const ids = body.turma_ids.map(Number).filter((t: number) => t > 0).slice(0, 20);
            if (!ids.length) return j({ error: "turma_ids obrigatório." }, 400);
            const turmas = await alunoBoletins(A, ids);
            if (!turmas) return j({ error: "Turma não encontrada." }, 404);
            await completarComMoodle(turmas, aluno.email ?? null);
            return j({ turmas });
        }

        if (action === "boletim") {
            const turma = Number(body.turma_id);
            if (!turma) return j({ error: "turma_id obrigatório." }, 400);
            const turmas = await alunoBoletins(A, [turma]);
            if (!turmas?.length) return j({ error: "Turma não encontrada." }, 404);
            await completarComMoodle(turmas, aluno.email ?? null);
            return j({ disciplinas: turmas[0].disciplinas });
        }

        if (action === "foto") return j({ foto: await alunoFoto(A) });

        if (action === "pagamento") {
            const r = await alunoPagamento(A, Number(body.conta_receber_id), Number(body.numero_parcela));
            if (r.notFound) return j({ error: "Parcela não encontrada." }, 404);
            return j(r);
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("aluno-portal:", e);
        return j({ error: (e as Error).message.includes("Token do Sponte") ? "Portal em manutenção (Sponte não configurado)." : "Não foi possível falar com o Sponte agora. Tente de novo em instantes." }, 502);
    }
});
