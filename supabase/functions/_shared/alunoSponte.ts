// Dados do Sponte de UM aluno (AlunoID) — usados pelo Portal do Aluno (aluno-portal)
// e pelo Tutor Virtual (tutor-virtual), pra que os dois mostrem exatamente o mesmo.
import { brDate, brNum, records, retorno, sponteCall } from "./sponte.ts";

const n = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);

export async function alunoOverview(A: number) {
    const [xa, xm, xp] = await Promise.all([
        sponteCall("GetAlunos", { sParametrosBusca: `AlunoID=${A}` }),
        sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${A}` }),
        sponteCall("GetParcelas", { sParametrosBusca: `AlunoID=${A}` }),
    ]);
    const a = records(xa, "wsAluno").find((r) => Number(r.AlunoID) === A) ?? {};
    const matriculas = records(xm, "wsMatricula").filter((r) => r.ContratoID && r.ContratoID !== "0").map((r) => ({
        contrato_id: Number(r.ContratoID), curso: n(r.NomeCurso), turma: n(r.NomeTurma), turma_id: Number(r.TurmaID) || null,
        situacao: n(r.Situacao), data_matricula: brDate(r.DataMatricula), data_inicio: brDate(r.DataInicio), data_termino: brDate(r.DataTermino),
    })).sort((x, y) => String(y.data_matricula).localeCompare(String(x.data_matricula)));
    const parcelas = records(xp, "wsParcela").filter((r) => r.ContaReceberID && r.ContaReceberID !== "0").map((r) => ({
        conta_receber_id: Number(r.ContaReceberID), numero_parcela: Number(r.NumeroParcela) || 0,
        vencimento: brDate(r.Vencimento), valor: brNum(r.ValorParcela), valor_pago: brNum(r.ValorPago) || null,
        data_pagamento: brDate(r.DataPagamento), situacao: n(r.SituacaoParcela), forma: n(r.FormaCobranca),
        categoria: n(r.Categoria), bolsa: n(r.BolsaAssociada),
    })).sort((x, y) => String(x.vencimento).localeCompare(String(y.vencimento)));
    return {
        raw: a,
        aluno: {
            nome: n(a.Nome), ra: n(a.RA), email: n(a.Email), celular: n(a.Celular), situacao: n(a.Situacao),
            turma_atual: n(a.TurmaAtual), inadimplente: /sim|true|^1$/i.test(a.Inadimplente ?? ""),
        },
        matriculas, parcelas,
    };
}

/** Boletim de uma turma — só se a turma for de uma matrícula do próprio aluno. */
export async function alunoBoletim(A: number, turma: number) {
    const xm = await sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${A}` });
    if (!records(xm, "wsMatricula").some((r) => Number(r.TurmaID) === turma)) return null;
    const xb = await sponteCall("GetBoletim", { nAlunoID: A, nTurmaID: turma, nDisciplinaID: 0, nModulo: 0 });
    return records(xb, "NotasBoletim").map((r) => ({
        disciplina: r.Disciplina, modulo: Number(r.Modulo) || null,
        notas: [1, 2, 3, 4].map((i) => n(r[`NotaAposRec${i}`]) ?? n(r[`Nota${i}`])).filter(Boolean),
        media: n(r.MediaFinal) ?? n(r.Media), faltas: n(r.TotalFaltas), situacao: n(r.SituacaoDidatica),
    }));
}

/** Link Sponte Pay ou linha digitável de uma parcela do próprio aluno. */
export async function alunoPagamento(A: number, conta: number, parc: number):
    Promise<{ notFound?: true; link?: string; linha_digitavel?: string; indisponivel?: true; motivo?: string }> {
    const xp = await sponteCall("GetParcelas", { sParametrosBusca: `AlunoID=${A}` });
    if (!records(xp, "wsParcela").some((r) => Number(r.ContaReceberID) === conta && Number(r.NumeroParcela) === parc)) return { notFound: true };
    const xl = await sponteCall("GetLinkPagamentoSpontePay", { nContaReceberID: conta, nNumeroParcela: parc });
    const link = (xl.match(/https?:\/\/[^<\s"]+/g) ?? []).find((u) => !/sponteeducacional\.net\.br\/?$|w3\.org|microsoft|xmlsoap|api\.sponteeducacional/i.test(u));
    if (link) return { link: link.replace(/&amp;/g, "&") };
    const xd = await sponteCall("GetLinhaDigitavelBoletos", { nContaReceberID: conta, nNumeroParcela: parc });
    const linha = (xd.match(/<LinhaDigitavel>([^<]*)</) ?? [])[1];
    if (linha && linha !== "0") return { linha_digitavel: linha };
    return { indisponivel: true, motivo: retorno(xl).replace(/^\d+\s*-\s*/, "") || "Pagamento online ainda não disponível para esta parcela." };
}
