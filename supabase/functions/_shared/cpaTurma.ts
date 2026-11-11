// Avaliação CPA: a turma do aluno vem da matrícula Vigente do Sponte; o Moodle só diz em que cursos ele está
// inscrito, e a inscrição sobra (disciplina de outro período, disciplina compartilhada de Teologia em aluno de
// Direito). Aqui a lista do Moodle é cortada para o que bate com a turma do aluno.
import type { DisciplinaAtiva } from "./cpaMoodle.ts";
import { nivelDoCurso } from "./cpa.ts";

export type MatriculaTurma = { nome_turma: string; nome_curso: string }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const familiaDe = (s: string): string | null => {
    const n = norm(s);
    if (n.includes("direito")) return "direito";
    if (n.includes("teologia")) return "teologia";
    return null;
};

// "Pós Tnt 2025" -> TNT + T3. Sigla e termo não vêm no nome da turma do Sponte, então a tabela é conferida contra
// o Moodle (alunos com uma turma só). Reposição e nome sem termo conhecido valem para qualquer termo do programa.
const SIGLAS: Record<string, string> = { tnt: "TNT", ge: "GE", lc: "LC", mis: "MU", psicopedag: "PSIP", psicoteo: "PSIT", ts: "TS", ecc: "ECC", cp: "CP", hc: "HC" };
const TERMOS: Record<string, string> = {
    TNT2025: "T3", TNT2026: "T4", GE2025: "T1", GE2026: "T2", LC2025: "T3", LC2026: "T4", MU2025: "T2",
    PSIP2025: "T1", PSIP2026: "T2", PSIT2026: "T1", TS2025: "T1", TS2026: "T2", CP2024: "T1",
};

export function programaDaTurmaPos(nomeTurma: string): { programa: string; termo: string | null } | null {
    const t = nomeTurma.trim();
    const embutido = t.match(/POS([A-Z]+)\/T(\d+)/i);
    if (embutido) return { programa: embutido[1].toUpperCase(), termo: `T${embutido[2]}` };
    const semTermo = t.match(/P[ÓO]S EAD - POS([A-Z]+) - 2026\.2/i);
    if (semTermo) return { programa: semTermo[1].toUpperCase(), termo: null };
    const curto = norm(t).match(/^pos ([a-z]+)\b(?: - (reposicao))?.*?(\d{4})?\s*$/);
    const sigla = curto && SIGLAS[curto[1]];
    if (!curto || !sigla) return null;
    return { programa: sigla, termo: curto[2] ? null : TERMOS[`${sigla}${curto[3] ?? ""}`] ?? null };
}

// Fica só o que é da turma do aluno. Sem informação suficiente na matrícula, a disciplina passa. Aluno cujo período
// do Sponte não bate com NENHUMA disciplina do Moodle (Sponte desatualizado ou Moodle de outro período) fica sem o
// corte por período: não dá para saber qual dos dois está certo, e esconder tudo seria pior.
export function disciplinasDaTurma(matriculas: MatriculaTurma[], semestre: string, ativas: DisciplinaAtiva[]): DisciplinaAtiva[] {
    const completo = testeDeTurma(matriculas, semestre, true);
    const semPeriodo = testeDeTurma(matriculas, semestre, false);
    const gradDoMoodle = ativas.filter((d) => d.nivel === "graduacao");
    const periodoBate = !gradDoMoodle.length || gradDoMoodle.some(completo);
    return ativas.filter((d) => (d.nivel === "graduacao" && !periodoBate ? semPeriodo(d) : completo(d)));
}

function testeDeTurma(matriculas: MatriculaTurma[], semestre: string, comPeriodo: boolean): (d: DisciplinaAtiva) => boolean {
    const grad = matriculas.filter((m) => nivelDoCurso(m.nome_curso) === "graduacao");
    const familias = new Set(grad.map((m) => familiaDe(m.nome_turma) ?? familiaDe(m.nome_curso)).filter(Boolean));
    const periodos = grad.flatMap((m) => {
        const x = m.nome_turma.match(/^(.+?) - (\d{4}\.\d) - (P\d+|Ciclo [IVX]+)$/i);
        return x && x[2] === semestre ? [{ familia: familiaDe(x[1]), periodo: x[3].toUpperCase() }] : [];
    });
    const pos = matriculas.filter((m) => nivelDoCurso(m.nome_curso) === "pos").map((m) => programaDaTurmaPos(m.nome_turma));

    return (d) => {
        if (d.nivel === "pos") {
            if (!pos.length || pos.some((p) => !p)) return true;
            const [sigla, termo] = (d.codigo ?? "").replace(/^POS/, "").split("/");
            return pos.some((p) => p!.programa === sigla && (!p!.termo || p!.termo === termo));
        }
        const familia = familiaDe(d.periodo_nome);
        if (familia && familias.size && !familias.has(familia)) return false;
        if (!comPeriodo || !periodos.length) return true;
        const periodo = d.periodo_nome.match(/ - ([^-]+?)$/)?.[1].trim().toUpperCase();
        return periodos.some((p) => p.periodo === periodo && (!p.familia || !familia || p.familia === familia));
    };
}
