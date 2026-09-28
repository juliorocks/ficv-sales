// Dados do Sponte de UM aluno (AlunoID) — usados pelo Portal do Aluno (aluno-portal)
// e pelo Tutor Virtual (tutor-virtual), pra que os dois mostrem exatamente o mesmo.
import { brDate, brNum, records, retorno, sponteCall } from "./sponte.ts";

const n = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);

// Financeiro no Portal do Aluno / Tutor Virtual: só parcelas com vencimento a partir desta data
// (decisão do usuário 28/09/2026 — o histórico anterior do Sponte não é mostrado nem cobrado).
export const FINANCEIRO_DESDE = "2026-02-01";
const noPeriodo = (vencimento: string | null) => !vencimento || vencimento >= FINANCEIRO_DESDE;

// O Sponte cria um "curso" por ciclo de entrada: "Bacharelado Em Teologia - Ead (Teologia Ead 2026.1)",
// "Teologia - EAD - 2024.2"… — é tudo o mesmo curso, só muda o período. Nome-base = sem o "(ciclo)" e sem
// o "- 2024.2" do fim. Cursos com a mesma chave (sem acento/pontuação/ano e sem o "Bacharelado Em" inicial,
// que os cadastros antigos não têm) são juntados; o nome exibido é o mais completo do grupo.
const cursoLimpo = (nome: string) => nome.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s*-\s*\d{4}(\.\d)?\s*$/, "").replace(/\s+/g, " ").trim();
const cursoChave = (nome: string) => cursoLimpo(nome).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^bacharelado em\s+/, "").replace(/\b(19|20)\d{2}(\.\d)?\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export function comCursoBase<T extends { curso: string | null; data_matricula: string | null }>(ms: T[]): (T & { curso_base: string | null })[] {
    const nomes = new Map<string, string>(); // chave → nome mais completo (empate: matrícula mais recente)
    for (const m of [...ms].sort((a, b) => String(b.data_matricula).localeCompare(String(a.data_matricula)))) {
        if (!m.curso) continue;
        const k = cursoChave(m.curso), nome = cursoLimpo(m.curso);
        if (k && nome.length > (nomes.get(k)?.length ?? 0)) nomes.set(k, nome);
    }
    return ms.map((m) => ({ ...m, curso_base: m.curso ? (nomes.get(cursoChave(m.curso)) ?? cursoLimpo(m.curso)) : null }));
}

export async function alunoOverview(A: number) {
    const [xa, xm, xp] = await Promise.all([
        sponteCall("GetAlunos", { sParametrosBusca: `AlunoID=${A}` }),
        sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${A}` }),
        sponteCall("GetParcelas", { sParametrosBusca: `AlunoID=${A}` }),
    ]);
    const a = records(xa, "wsAluno").find((r) => Number(r.AlunoID) === A) ?? {};
    const matriculas = comCursoBase(records(xm, "wsMatricula").filter((r) => r.ContratoID && r.ContratoID !== "0").map((r) => ({
        contrato_id: Number(r.ContratoID), curso: n(r.NomeCurso), turma: n(r.NomeTurma), turma_id: Number(r.TurmaID) || null,
        situacao: n(r.Situacao), data_matricula: brDate(r.DataMatricula), data_inicio: brDate(r.DataInicio), data_termino: brDate(r.DataTermino),
    }))).sort((x, y) => String(y.data_matricula).localeCompare(String(x.data_matricula)));
    const parcelas = records(xp, "wsParcela").filter((r) => r.ContaReceberID && r.ContaReceberID !== "0").map((r) => ({
        conta_receber_id: Number(r.ContaReceberID), numero_parcela: Number(r.NumeroParcela) || 0,
        vencimento: brDate(r.Vencimento), valor: brNum(r.ValorParcela), valor_pago: brNum(r.ValorPago) || null,
        data_pagamento: brDate(r.DataPagamento), situacao: n(r.SituacaoParcela), forma: n(r.FormaCobranca),
        categoria: n(r.Categoria), bolsa: n(r.BolsaAssociada),
    })).filter((p) => noPeriodo(p.vencimento)).sort((x, y) => String(x.vencimento).localeCompare(String(y.vencimento)));
    return {
        raw: a,
        aluno: {
            nome: n(a.Nome), ra: n(a.RA), email: n(a.Email), celular: n(a.Celular), situacao: n(a.Situacao),
            turma_atual: n(a.TurmaAtual), inadimplente: /sim|true|^1$/i.test(a.Inadimplente ?? ""),
        },
        matriculas, parcelas,
    };
}

type Disciplina = { disciplina: string; modulo: number | null; notas: string[]; media: string | null; faltas: string | null; situacao: string | null };

// NotaAposRec vem "0" (não vazio) quando NÃO houve recuperação — só vale se Recuperacao foi lançada.
// Antes o "0" ganhava da Nota real (ex.: Nota1=85,0 aparecia como sem nota).
const notaDe = (r: Record<string, string>, i: number) => {
    const apos = n(r[`NotaAposRec${i}`]);
    return n(r[`Recuperacao${i}`]) && apos && brNum(apos) > 0 ? apos : n(r[`Nota${i}`]);
};
async function boletimDaTurma(A: number, turma: number): Promise<Disciplina[]> {
    const xb = await sponteCall("GetBoletim", { nAlunoID: A, nTurmaID: turma, nDisciplinaID: 0, nModulo: 0 });
    return records(xb, "NotasBoletim").map((r) => {
        const notas = [1, 2, 3, 4].map((i) => notaDe(r, i)).filter((v): v is string => !!v);
        return {
            disciplina: r.Disciplina, modulo: Number(r.Modulo) || null, notas,
            // o Sponte da FICV não preenche Media/MediaFinal — com uma nota só, ela é o resultado
            media: n(r.MediaFinal) ?? n(r.Media) ?? (notas.length === 1 ? notas[0] : null),
            faltas: n(r.TotalFaltas), situacao: n(r.SituacaoDidatica),
        };
    });
}

/** Boletim de uma turma — só se a turma for de uma matrícula do próprio aluno. */
export async function alunoBoletim(A: number, turma: number): Promise<Disciplina[] | null> {
    return (await alunoBoletins(A, [turma]))?.[0]?.disciplinas ?? null;
}

/** Boletins de várias turmas de uma vez (os períodos de um mesmo curso). Só turmas do próprio aluno;
 *  null se nenhuma for. Uma consulta de matrículas + os boletins em paralelo. */
export async function alunoBoletins(A: number, turmas: number[]): Promise<{ turma_id: number; disciplinas: Disciplina[] }[] | null> {
    const xm = await sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${A}` });
    const minhas = new Set(records(xm, "wsMatricula").map((r) => Number(r.TurmaID)));
    const ids = [...new Set(turmas)].filter((t) => minhas.has(t));
    if (!ids.length) return null;
    return await Promise.all(ids.map(async (t) => ({ turma_id: t, disciplinas: await boletimDaTurma(A, t) })));
}

/** Foto do aluno (a do app do Sponte) como data URL, ou null se não tiver. Só ~7% dos alunos têm foto lá.
 *  Só aceita JPEG/PNG em base64 válido — o valor vai direto pra um <img src>. */
export async function alunoFoto(A: number): Promise<string | null> {
    const x = await sponteCall("GetImageApp", { nAlunoID: A, nResponsavelID: 0 });
    const b64 = ((x.match(/<Foto>([^<]*)<\/Foto>/) ?? [])[1] ?? "").replace(/\s+/g, "");
    if (b64.length < 100 || b64.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
    const mime = b64.startsWith("/9j/") ? "image/jpeg" : b64.startsWith("iVBOR") ? "image/png" : null;
    return mime ? `data:${mime};base64,${b64}` : null;
}

/** Link Sponte Pay ou linha digitável de uma parcela do próprio aluno. */
export async function alunoPagamento(A: number, conta: number, parc: number):
    Promise<{ notFound?: true; link?: string; linha_digitavel?: string; indisponivel?: true; motivo?: string }> {
    const xp = await sponteCall("GetParcelas", { sParametrosBusca: `AlunoID=${A}` });
    // só parcela do próprio aluno E dentro do período exibido no portal
    if (!records(xp, "wsParcela").some((r) => Number(r.ContaReceberID) === conta && Number(r.NumeroParcela) === parc
        && noPeriodo(brDate(r.Vencimento)))) return { notFound: true };
    const xl = await sponteCall("GetLinkPagamentoSpontePay", { nContaReceberID: conta, nNumeroParcela: parc });
    const link = (xl.match(/https?:\/\/[^<\s"]+/g) ?? []).find((u) => !/sponteeducacional\.net\.br\/?$|w3\.org|microsoft|xmlsoap|api\.sponteeducacional/i.test(u));
    if (link) return { link: link.replace(/&amp;/g, "&") };
    const xd = await sponteCall("GetLinhaDigitavelBoletos", { nContaReceberID: conta, nNumeroParcela: parc });
    const linha = (xd.match(/<LinhaDigitavel>([^<]*)</) ?? [])[1];
    if (linha && linha !== "0") return { linha_digitavel: linha };
    return { indisponivel: true, motivo: retorno(xl).replace(/^\d+\s*-\s*/, "") || "Pagamento online ainda não disponível para esta parcela." };
}
