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
            // Declaração de Matrícula (01/10): precisa da data de nascimento, que mais nada do
            // portal usava até agora.
            data_nascimento: brDate(a.DataNascimento),
        },
        matriculas, parcelas,
    };
}

type Avaliacao = { nome: string; nota: string };
type Disciplina = {
    disciplina: string; modulo: number | null; notas: string[]; media: string | null; faltas: string | null; situacao: string | null;
    // 01/10: achado ao vivo com os prints que o usuário trouxe (Sponte "Lançamento de notas" +
    // Moodle) — ver avaliacoesPorDisciplina() logo abaixo pra entender por que só turma
    // presencial preenche isto.
    avaliacoes: Avaliacao[] | null;
    exame_final: string | null;
};

// NotaAposRec vem "0" (não vazio) quando NÃO houve recuperação — só vale se Recuperacao foi lançada.
// Antes o "0" ganhava da Nota real (ex.: Nota1=85,0 aparecia como sem nota).
const notaDe = (r: Record<string, string>, i: number) => {
    const apos = n(r[`NotaAposRec${i}`]);
    return n(r[`Recuperacao${i}`]) && apos && brNum(apos) > 0 ? apos : n(r[`Nota${i}`]);
};
// O Sponte lança nota em escala diferente conforme o curso/turma (achado ao vivo 29/09: turma
// presencial vinha 0–100 — "85,0" —, turma EAD já vinha 0–10 — "5,9"). Nota válida em 0–10 NUNCA
// passa de 10 — qualquer valor MAIOR só pode estar na escala 0–100, então normaliza dividindo por
// 10, sem precisar saber de antemão qual curso usa qual escala.
function escala10(v: string | null): string | null {
    if (!v) return v;
    const num = brNum(v);
    if (!num && v.trim() !== "0" && !/^0([.,]0*)?$/.test(v.trim())) return v; // não parseou — devolve cru
    const ajustado = num > 10 ? num / 10 : num;
    return ajustado.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
// GetNotaParcial — descoberto ao vivo 01/10 (o usuário trouxe o print do Sponte "Lançamento de
// notas", com colunas AV1/AV2/Média prevista, pra comparar com o Moodle). O GetBoletim normal só
// devolve a nota JÁ CONSOLIDADA (Nota1 = a média de AV1+AV2, sem abrir os dois valores) — é por
// isso que turma presencial sempre aparecia com "uma nota só" aqui, mesmo tendo lançamento em
// duas partes lá no painel do professor. Esta chamada traz o detalhe por avaliação (AV1, AV2…,
// cada uma com o nome que o próprio Sponte usa) — mas só existe pra quem usa esse sistema de
// "Avaliação Parcial": testado ao vivo com turma EAD real (mesma disciplina do print do Moodle)
// e não veio nada — EAD não lança por aqui, o detalhe por avaliação do EAD mora só dentro do
// Moodle (integração ainda não está no ar, ver Gestão > Integrações).
// Pegadinha de parâmetro (achada testando, não documentada): sParametrosBusca PRECISA ir
// presente mesmo vazio, e SEM DisciplinaID — com DisciplinaID=0 a API devolve erro "02"; só
// manda numa disciplina específica (DisciplinaID=X) se quiser UMA; vazio devolve TODAS as
// disciplinas da turma de uma vez, uma chamada só (sem precisar de N chamadas por disciplina).
async function avaliacoesPorDisciplina(A: number, turma: number): Promise<Map<number, Avaliacao[]>> {
    const map = new Map<number, Avaliacao[]>();
    let x: string;
    try {
        x = await sponteCall("GetNotaParcial", { nCursoID: 0, nTurmaID: turma, nAlunoID: A, sParametrosBusca: "" });
    } catch {
        return map; // melhor mostrar só a média (como sempre foi) do que quebrar o boletim inteiro
    }
    for (const bloco of x.matchAll(/<wsDisciplinasNotasParciais>([\s\S]*?)<\/wsDisciplinasNotasParciais>/g)) {
        const discId = Number((bloco[1].match(/<DisciplinaID>([^<]*)</) ?? [])[1]);
        if (!discId) continue;
        const avaliacoes = [...bloco[1].matchAll(/<wsNotaParcial>([\s\S]*?)<\/wsNotaParcial>/g)].map((a) => ({
            nome: (a[1].match(/<NomeAvaliacao>([^<]*)</) ?? [])[1] ?? "",
            nota: escala10((a[1].match(/<Nota>([^<]*)</) ?? [])[1] ?? null) ?? "",
        })).filter((a) => a.nome && a.nota);
        if (avaliacoes.length) map.set(discId, avaliacoes);
    }
    return map;
}

async function boletimDaTurma(A: number, turma: number): Promise<Disciplina[]> {
    const [xb, porDisciplina] = await Promise.all([
        sponteCall("GetBoletim", { nAlunoID: A, nTurmaID: turma, nDisciplinaID: 0, nModulo: 0 }),
        avaliacoesPorDisciplina(A, turma),
    ]);
    return records(xb, "NotasBoletim").map((r) => {
        const notasRaw = [1, 2, 3, 4].map((i) => notaDe(r, i)).filter((v): v is string => !!v);
        // o Sponte da FICV não preenche Media/MediaFinal — com uma nota só, ela é o resultado
        const mediaRaw = n(r.MediaFinal) ?? n(r.Media) ?? (notasRaw.length === 1 ? notasRaw[0] : null);
        // Exame Final: campo próprio (ExameFinal), separado de Nota1-4 — só existe de verdade
        // quando a disciplina tem exame (TemExame) e a nota já foi lançada (>0); "0,0" com
        // TemExame=Sim é só "ainda não fez", não é zero de verdade.
        const exameRaw = /^sim$/i.test(r.TemExame ?? "") ? escala10(n(r.ExameFinal)) : null;
        return {
            disciplina: r.Disciplina, modulo: Number(r.Modulo) || null,
            notas: notasRaw.map((v) => escala10(v)!), media: escala10(mediaRaw),
            faltas: n(r.TotalFaltas), situacao: n(r.SituacaoDidatica),
            avaliacoes: porDisciplina.get(Number(r.DisciplinaID)) ?? null,
            exame_final: exameRaw && brNum(exameRaw) > 0 ? exameRaw : null,
        };
    });
}

/** Boletim de uma turma — só se a turma for de uma matrícula do próprio aluno. */
export async function alunoBoletim(A: number, turma: number): Promise<Disciplina[] | null> {
    return (await alunoBoletins(A, [turma]))?.[0]?.disciplinas ?? null;
}

/** Boletins de várias turmas de uma vez (os períodos de um mesmo curso). Só turmas do próprio aluno;
 *  null se nenhuma for. Uma consulta de matrículas + os boletins em paralelo.
 *  `turma` (NomeTurma, ex.: "Teologia EAD - 2025.2 - P3") vai junto — o aluno-portal usa pra
 *  achar o período certo no Moodle quando o Sponte não tem NENHUMA disciplina lançada ali
 *  (ver moodleDisciplinasDoPeriodo em _shared/alunoMoodle.ts). */
export async function alunoBoletins(A: number, turmas: number[]): Promise<{ turma_id: number; turma: string | null; disciplinas: Disciplina[] }[] | null> {
    const xm = await sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${A}` });
    const minhas = new Set<number>();
    const nomes = new Map<number, string>();
    for (const r of records(xm, "wsMatricula")) {
        const tid = Number(r.TurmaID);
        if (!tid) continue;
        minhas.add(tid);
        if (n(r.NomeTurma)) nomes.set(tid, n(r.NomeTurma)!);
    }
    const ids = [...new Set(turmas)].filter((t) => minhas.has(t));
    if (!ids.length) return null;
    return await Promise.all(ids.map(async (t) => ({ turma_id: t, turma: nomes.get(t) ?? null, disciplinas: await boletimDaTurma(A, t) })));
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
