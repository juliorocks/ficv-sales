// Lógica de overview/boletim do Portal do Aluno — extraída de aluno-portal/index.ts
// pra ser reusada também por staff-tickets (atendente vendo o painel de QUALQUER
// aluno durante um chamado, não só o próprio aluno logado). Garante que os dois
// caminhos mostrem exatamente o mesmo dado, sem duplicar a lógica de Moodle.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { nivelDoCurso } from "./sponte.ts";
import { alunoBoletins, alunoOverview } from "./alunoSponte.ts";
import { moodleCourses, moodleDisciplinasDoPeriodo, moodleAvaliacoes, moodleUserId, periodosExtrasDoMoodle } from "./alunoMoodle.ts";

type Db = ReturnType<typeof createClient>;
type AlunoRow = { id: string; nome: string | null; cpf: string | null; email: string | null; telefone: string | null; ra: string | null; sponte_aluno_id: number; nivel: string | null };
const n = (v?: string | null) => (v && v.trim() !== "" ? v.trim() : null);

type TurmaBoletim = { turma_id: number; turma?: string | null; disciplinas: { avaliacoes: unknown[] | null; media: string | null; disciplina: string }[] };

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
        // O Sponte só lista disciplina com nota consolidada; no EAD o resto já tem nota (ou ao menos o curso) no Moodle
        // (achado 23/10: aluno de pós com 5 disciplinas de 10,0 no Moodle e 2 no Portal).
        if (t.turma && EAD_RE.test(t.turma)) {
            const chave = (s: string) => norm(s).replace(/^\d+\s+/, "");
            const tem = (nome: string) => t.disciplinas.some((d) => { const a = chave(d.disciplina), b = chave(nome); return a === b || a.includes(b) || b.includes(a); });
            // turma Modular: o Moodle nomeia os cursos pelo módulo ("... - 2026.2 - P4 - <disciplina>")
            let prefixo = t.turma;
            if (/modular\s*$/i.test(t.turma)) {
                const mods = t.disciplinas.map((d) => (d as any).modulo).filter(Boolean);
                const modulo = mods.sort((a, b) => mods.filter((x) => x === b).length - mods.filter((x) => x === a).length)[0];
                if (!modulo) continue;
                prefixo = t.turma.replace(/modular\s*$/i, `P${modulo}`);
            }
            // período em andamento = o semestre mais novo entre os cursos do aluno no Moodle: lá a disciplina
            // aparece mesmo sem nota; nos períodos antigos só entra a que tem nota
            const semestres = cursos.map((c) => c.fullname.match(/\b(20\d\d\.\d)\b/)?.[1]).filter(Boolean) as string[];
            const atual = semestres.sort().pop();
            const emAndamento = !!atual && prefixo.includes(atual);
            const doMoodle = await moodleDisciplinasDoPeriodo(uid, cursos, prefixo);
            for (const s of doMoodle) {
                if (tem(s.disciplina) || /^0+\s/.test(s.disciplina)) continue;
                if (!emAndamento && !s.avaliacoes?.length && !s.media) continue;
                (t as any).disciplinas.push({ ...s, disciplina: s.disciplina.replace(/^\d+\s+/, "") });
            }
        }
    }
}

const EAD_RE = /\bEAD\b/i;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function completarComMoodle(turmas: TurmaBoletim[], email: string | null) {
    const precisa = turmas.some((t) => t.disciplinas.some((d) => !d.avaliacoes?.length) || (t.disciplinas.length === 0 && t.turma) || (t.turma && EAD_RE.test(t.turma)));
    if (!precisa) return;
    const uid = await moodleUserId(email);
    if (!uid) return;
    const cursos = await moodleCourses(uid);
    if (!cursos.length) return;
    await completarTurmasComMoodle(turmas, uid, cursos);
}

/** { aluno, matriculas, parcelas } — mesmo shape que aluno-portal action:overview devolvia. */
export async function overviewFor(db: Db, aluno: AlunoRow) {
    const A = aluno.sponte_aluno_id;
    const { raw: a, aluno: sa, matriculas, parcelas } = await alunoOverview(A);

    const patch: Record<string, unknown> = {};
    if (n(a.Email) && !aluno.email) patch.email = a.Email.toLowerCase();
    if (n(a.Celular) && !aluno.telefone) patch.telefone = a.Celular;
    if (n(a.RA) && !aluno.ra) patch.ra = a.RA;
    const vig = matriculas.find((m) => /vigente|ativ|cursando/i.test(m.situacao ?? "")) ?? matriculas[0];
    const nivel = nivelDoCurso(vig?.curso) ?? matriculas.map((m) => nivelDoCurso(m.curso)).find(Boolean) ?? null;
    if (nivel && nivel !== aluno.nivel) patch.nivel = nivel;
    if (Object.keys(patch).length) await db.from("alunos").update(patch).eq("id", aluno.id);

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

    return {
        // nome: LOCAL primeiro, não o do Sponte — achado ao vivo 08/10: o GetAlunos (API) pode
        // devolver um Nome errado pra um AlunoID mesmo com a grade de administração do Sponte já
        // certa (CPF/RA/Celular sempre bateram certo nos casos encontrados, só o Nome divergia).
        // `aluno.nome` já passa pela checagem contra `sponte_matriculas` na criação da conta
        // ([[nomeDivergeDoHistorico]], _shared/aluno.ts) — mais confiável que confiar cegamente
        // na resposta ao vivo. Só cai pro nome do Sponte se não tiver nada salvo localmente.
        aluno: { ...sa, nome: aluno.nome ?? sa.nome, ra: sa.ra ?? aluno.ra, email: sa.email ?? aluno.email, celular: sa.celular ?? aluno.telefone, cpf: aluno.cpf ?? null },
        matriculas: matriculasCompletas, parcelas,
    };
}

/** { turmas } ou { disciplinas } ou { error, status } — mesmo dispatch de aluno-portal action:boletim. */
export async function boletimFor(A: number, email: string | null, body: any): Promise<{ status: number; body: any }> {
    if (Array.isArray(body.turmas) || Array.isArray(body.turma_ids)) {
        const pedidos: { turma_id: number; turma: string | null }[] = Array.isArray(body.turmas)
            ? body.turmas.map((t: any) => ({ turma_id: Number(t?.turma_id), turma: t?.turma ? String(t.turma) : null }))
            : body.turma_ids.map((id: unknown) => ({ turma_id: Number(id), turma: null }));
        const validos = pedidos.filter((p) => Number.isFinite(p.turma_id) && p.turma_id !== 0).slice(0, 20);
        if (!validos.length) return { status: 400, body: { error: "turmas obrigatório." } };

        const idsReais = validos.filter((p) => p.turma_id > 0).map((p) => p.turma_id);
        const sinteticas = validos.filter((p) => p.turma_id < 0 && p.turma);

        const turmasReais = idsReais.length ? await alunoBoletins(A, idsReais) : [];
        if (idsReais.length && !turmasReais) return { status: 404, body: { error: "Turma não encontrada." } };

        const turmas: TurmaBoletim[] = [...(turmasReais ?? [])];
        const precisaMoodle = sinteticas.length > 0 || turmas.some((t) => t.disciplinas.some((d) => !d.avaliacoes?.length) || t.disciplinas.length === 0);
        if (precisaMoodle) {
            const uid = await moodleUserId(email);
            const cursos = uid ? await moodleCourses(uid) : [];
            if (uid && cursos.length) {
                if (turmasReais?.length) await completarTurmasComMoodle(turmasReais, uid, cursos);
                for (const s of sinteticas) turmas.push({ turma_id: s.turma_id, turma: s.turma, disciplinas: await moodleDisciplinasDoPeriodo(uid, cursos, s.turma!) });
            } else {
                for (const s of sinteticas) turmas.push({ turma_id: s.turma_id, turma: s.turma, disciplinas: [] });
            }
        }
        return { status: 200, body: { turmas } };
    }

    const turma = Number(body.turma_id);
    if (!turma) return { status: 400, body: { error: "turma_id obrigatório." } };
    const turmas = await alunoBoletins(A, [turma]);
    if (!turmas?.length) return { status: 404, body: { error: "Turma não encontrada." } };
    await completarComMoodle(turmas, email);
    return { status: 200, body: { disciplinas: turmas[0].disciplinas } };
}
