// Curso do chamado (2026-11-09): chamado aberto pela equipe ou transferido do funil leva o curso
// do aluno (matrícula no Sponte) ou o de interesse do lead, igual ao que o Portal já grava.
// A regra de casamento de nome é a mesma de src/components/tickets/TicketPortal.tsx (cursoDoCatalogo):
// mudou uma, muda a outra.

const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PALAVRAS_VAZIAS = new Set(["e", "de", "do", "da", "dos", "das", "em", "o", "a", "presencial"]);

type Curso = { id: number; name: string; type?: string | null };

export function nivelDoCurso(nome: string): "pos" | "graduacao" | null {
    const n = norm(nome);
    if (/\bpos\b|pos-|especializa|mba/.test(n)) return "pos";
    if (/bacharel|licencia|tecnolog|gradua/.test(n)) return "graduacao";
    return null;
}

// Palavra INTEIRA e mesmo nível: o nome do Sponte ("Bacharelado Em Teologia - Ead (...)") vira o id do catálogo.
export function cursoDoCatalogo(nomeSponte: string, cursos: Curso[]): number | null {
    const alvo = norm(nomeSponte);
    const palavras = new Set(alvo.split(/[^a-z0-9]+/).filter(Boolean));
    const ead = palavras.has("ead");
    const nivel = nivelDoCurso(nomeSponte);
    let melhor: { id: number; n: number } | null = null;
    for (const c of cursos) {
        const nome = norm(c.name);
        if (/\bead\b/.test(nome) !== ead && /(\bead\b|presencial)/.test(nome)) continue;
        if (nivel && c.type) {
            const tipo = /p[oó]s/i.test(c.type) ? "pos" : /gradua/i.test(c.type) ? "graduacao" : null;
            if (tipo && tipo !== nivel) continue;
        }
        const toks = nome.split(/[^a-z0-9]+/).filter((t) => t && !PALAVRAS_VAZIAS.has(t) && t !== "ead");
        if (toks.length && toks.every((t) => palavras.has(t)) && (!melhor || toks.length > melhor.n)) melhor = { id: c.id, n: toks.length };
    }
    return melhor?.id ?? null;
}

const nivelDoCatalogo = (c: Curso) => (/p[oó]s/i.test(c.type ?? "") ? "pos" : /gradua/i.test(c.type ?? "") ? "graduacao" : null);

/** Curso do chamado: o nome informado (turma escolhida pelo agente) ou, sem ele, o da matrícula do aluno
 *  (Vigente primeiro, depois a mais recente — mesma ordem do Portal). */
export async function cursoDoAluno(db: any, sponteAlunoId: number, nomeInformado: string | null = null) {
    let nome = nomeInformado;
    if (!nome) {
        const { data: matriculas } = await db.from("sponte_matriculas").select("nome_curso, situacao_id, data_matricula")
            .eq("aluno_id", sponteAlunoId).not("nome_curso", "is", null).order("data_matricula", { ascending: false }).limit(50);
        const lista = matriculas ?? [];
        nome = (lista.find((r: any) => r.situacao_id === 1) ?? lista[0])?.nome_curso ?? null;
    }
    if (!nome) return { curso_id: null, curso_nome: null, nivel: null };
    const { data: cursos } = await db.from("courses").select("id, name, type");
    return { curso_id: cursoDoCatalogo(nome, cursos ?? []), curso_nome: nome, nivel: nivelDoCurso(nome) };
}

/** Curso de interesse do lead (já é o id do catálogo). */
export async function cursoDoCatalogoPorId(db: any, cursoId: number | null) {
    if (!cursoId) return { curso_id: null, curso_nome: null, nivel: null };
    const { data: c } = await db.from("courses").select("id, name, type").eq("id", cursoId).maybeSingle();
    if (!c) return { curso_id: null, curso_nome: null, nivel: null };
    return { curso_id: c.id, curso_nome: null, nivel: nivelDoCatalogo(c) };
}
