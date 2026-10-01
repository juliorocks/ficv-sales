// aluno-portal — dados do Sponte do aluno LOGADO no Portal do Aluno (/aluno).
// Só enxerga o próprio aluno: o AlunoID vem de alunos.sponte_aluno_id do usuário
// do JWT, nunca do corpo da requisição.
//
//   overview                                  → dados, matrículas (+ períodos só-Moodle, ver
//                                                abaixo), parcelas
//   boletim  { turma_id }                     → notas/faltas por disciplina
//   boletim  { turmas: [{turma_id, turma}] }  → o mesmo, de vários períodos de uma vez
//                                                (turma_id negativo = período só-Moodle, ver
//                                                periodosExtrasDoMoodle)
//   foto                                      → foto do aluno (data URL) ou null
//   pagamento { conta_receber_id, numero_parcela } → link Sponte Pay ou linha digitável
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { nivelDoCurso } from "../_shared/sponte.ts";
import { alunoBoletins, alunoFoto, alunoOverview, alunoPagamento } from "../_shared/alunoSponte.ts";
import { moodleAvaliacoes, moodleCourses, moodleDisciplinasDoPeriodo, moodleUserId, periodosExtrasDoMoodle } from "../_shared/alunoMoodle.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const n = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);

type TurmaBoletim = { turma_id: number; turma?: string | null; disciplinas: { avaliacoes: unknown[] | null; media: string | null; disciplina: string }[] };

// Completa com o Moodle as disciplinas das turmas (dadas uid/cursos JÁ resolvidos — pra não
// repetir a busca de usuário/cursos quando o chamador já tem os dois à mão, ex.: junto com as
// turmas "sintéticas" só-Moodle). Dois casos, nunca sobrescreve o que o Sponte já tem
// (presencial sempre vem de lá):
//   1. Sponte tem a disciplina lançada mas sem o detalhe (AV1/AV2) → completa só isso.
//   2. Sponte não lançou NENHUMA disciplina pro período inteiro (comum em turma EAD encerrada
//      — achado ao vivo 01/10, print do usuário: Moodle tinha nota completa pra um período que
//      sumia do portal) → monta a lista de disciplinas inteira a partir do Moodle.
async function completarTurmasComMoodle(turmas: TurmaBoletim[], uid: number, cursos: { id: number; fullname: string }[]) {
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

// Pedido do usuário 01/10: "casar" as duas fontes pra o painel de notas ficar 100% completo —
// só entra no Moodle se precisar (aluno 100% presencial não gasta a chamada à toa). Nunca
// derruba a tela: qualquer falha no Moodle deixa a turma como já estava.
async function completarComMoodle(turmas: TurmaBoletim[], email: string | null) {
    const precisa = turmas.some((t) => t.disciplinas.some((d) => !d.avaliacoes?.length) || (t.disciplinas.length === 0 && t.turma));
    if (!precisa) return;
    const uid = await moodleUserId(email);
    if (!uid) return;
    const cursos = await moodleCourses(uid);
    if (!cursos.length) return;
    await completarTurmasComMoodle(turmas, uid, cursos);
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

            // Períodos que só existem no Moodle (retake/reposição sem matrícula própria no
            // Sponte — achado ao vivo 01/10, ver periodosExtrasDoMoodle em _shared/
            // alunoMoodle.ts). Nunca derruba a tela: Moodle fora do ar/aluno sem conta lá →
            // matriculas segue só com o que o Sponte tem, igual sempre foi.
            const email = sa.email ?? aluno.email ?? null;
            let matriculasCompletas = matriculas;
            const uidOverview = await moodleUserId(email);
            if (uidOverview) {
                const cursosOverview = await moodleCourses(uidOverview);
                if (cursosOverview.length) {
                    const extras = periodosExtrasDoMoodle(cursosOverview, matriculas.map((m) => ({ turma: m.turma, curso: m.curso, curso_base: m.curso_base })));
                    if (extras.length) matriculasCompletas = [...matriculas, ...extras];
                }
            }

            return j({
                // cpf vem só do nosso cadastro (é o que já usamos pra login) — o Sponte não
                // devolve isso em GetAlunos; usado na Declaração de Matrícula.
                aluno: { ...sa, nome: sa.nome ?? aluno.nome, ra: sa.ra ?? aluno.ra, email: sa.email ?? aluno.email, celular: sa.celular ?? aluno.telefone, cpf: aluno.cpf ?? null },
                matriculas: matriculasCompletas, parcelas,
            });
        }

        if (action === "boletim" && (Array.isArray(body.turmas) || Array.isArray(body.turma_ids))) {
            // `turmas` (novo, com o nome do período junto) é o formato de verdade — `turma_ids`
            // (só números) continua aceito por compatibilidade, mas não reconhece período
            // sintético (turma_id negativo) por não ter como saber o nome do período dele.
            const pedidos: { turma_id: number; turma: string | null }[] = Array.isArray(body.turmas)
                ? body.turmas.map((t: any) => ({ turma_id: Number(t?.turma_id), turma: t?.turma ? String(t.turma) : null }))
                : body.turma_ids.map((id: unknown) => ({ turma_id: Number(id), turma: null }));
            const validos = pedidos.filter((p) => Number.isFinite(p.turma_id) && p.turma_id !== 0).slice(0, 20);
            if (!validos.length) return j({ error: "turmas obrigatório." }, 400);

            const idsReais = validos.filter((p) => p.turma_id > 0).map((p) => p.turma_id);
            const sinteticas = validos.filter((p) => p.turma_id < 0 && p.turma);

            const turmasReais = idsReais.length ? await alunoBoletins(A, idsReais) : [];
            if (idsReais.length && !turmasReais) return j({ error: "Turma não encontrada." }, 404);

            const turmas: TurmaBoletim[] = [...(turmasReais ?? [])];
            const precisaMoodle = sinteticas.length > 0 || turmas.some((t) => t.disciplinas.some((d) => !d.avaliacoes?.length) || t.disciplinas.length === 0);
            if (precisaMoodle) {
                const uid = await moodleUserId(aluno.email ?? null);
                const cursos = uid ? await moodleCourses(uid) : [];
                if (uid && cursos.length) {
                    if (turmasReais?.length) await completarTurmasComMoodle(turmasReais, uid, cursos);
                    for (const s of sinteticas) turmas.push({ turma_id: s.turma_id, turma: s.turma, disciplinas: await moodleDisciplinasDoPeriodo(uid, cursos, s.turma!) });
                } else {
                    for (const s of sinteticas) turmas.push({ turma_id: s.turma_id, turma: s.turma, disciplinas: [] });
                }
            }
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
