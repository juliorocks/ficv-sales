// aluno-portal — dados do Sponte do aluno LOGADO no Portal do Aluno (/aluno).
// Só enxerga o próprio aluno: o AlunoID vem de alunos.sponte_aluno_id do usuário
// do JWT, nunca do corpo da requisição.
//
//   overview                                  → dados, matrículas, parcelas
//   boletim  { turma_id }                     → notas/faltas por disciplina
//   pagamento { conta_receber_id, numero_parcela } → link Sponte Pay ou linha digitável
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { brDate, brNum, nivelDoCurso, records, retorno, sponteCall } from "../_shared/sponte.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const n = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);

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
                aluno: {
                    nome: n(a.Nome) ?? aluno.nome, ra: n(a.RA) ?? aluno.ra, email: n(a.Email) ?? aluno.email,
                    celular: n(a.Celular) ?? aluno.telefone, situacao: n(a.Situacao), turma_atual: n(a.TurmaAtual),
                    inadimplente: /sim|true|^1$/i.test(a.Inadimplente ?? ""),
                },
                matriculas, parcelas,
            });
        }

        if (action === "boletim") {
            const turma = Number(body.turma_id);
            if (!turma) return j({ error: "turma_id obrigatório." }, 400);
            // só turmas das matrículas do próprio aluno
            const xm = await sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${A}` });
            if (!records(xm, "wsMatricula").some((r) => Number(r.TurmaID) === turma)) return j({ error: "Turma não encontrada." }, 404);
            const xb = await sponteCall("GetBoletim", { nAlunoID: A, nTurmaID: turma, nDisciplinaID: 0, nModulo: 0 });
            const disciplinas = records(xb, "NotasBoletim").map((r) => ({
                disciplina: r.Disciplina, modulo: Number(r.Modulo) || null,
                notas: [1, 2, 3, 4].map((i) => n(r[`NotaAposRec${i}`]) ?? n(r[`Nota${i}`])).filter(Boolean),
                media: n(r.MediaFinal) ?? n(r.Media), faltas: n(r.TotalFaltas), situacao: n(r.SituacaoDidatica),
            }));
            return j({ disciplinas });
        }

        if (action === "pagamento") {
            const conta = Number(body.conta_receber_id), parc = Number(body.numero_parcela);
            const xp = await sponteCall("GetParcelas", { sParametrosBusca: `AlunoID=${A}` });
            const minha = records(xp, "wsParcela").find((r) => Number(r.ContaReceberID) === conta && Number(r.NumeroParcela) === parc);
            if (!minha) return j({ error: "Parcela não encontrada." }, 404);
            const xl = await sponteCall("GetLinkPagamentoSpontePay", { nContaReceberID: conta, nNumeroParcela: parc });
            const link = (xl.match(/https?:\/\/[^<\s"]+/g) ?? []).find((u) => !/sponteeducacional\.net\.br\/?$|w3\.org|microsoft|xmlsoap|api\.sponteeducacional/i.test(u));
            if (link) return j({ link: link.replace(/&amp;/g, "&") });
            const xd = await sponteCall("GetLinhaDigitavelBoletos", { nContaReceberID: conta, nNumeroParcela: parc });
            const linha = (xd.match(/<LinhaDigitavel>([^<]*)</) ?? [])[1];
            if (linha && linha !== "0") return j({ linha_digitavel: linha });
            return j({ indisponivel: true, motivo: retorno(xl).replace(/^\d+\s*-\s*/, "") || "Pagamento online ainda não disponível para esta parcela." });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("aluno-portal:", e);
        return j({ error: (e as Error).message.includes("Token do Sponte") ? "Portal em manutenção (Sponte não configurado)." : "Não foi possível falar com o Sponte agora. Tente de novo em instantes." }, 502);
    }
});
