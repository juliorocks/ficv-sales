// cpa-portal — Avaliação CPA dentro do Portal do Aluno. Só enxerga o aluno LOGADO (JWT).
//   pendencias                              -> avaliações abertas pro aluno (geral + disciplinas)
//   form      { formulario_id, contexto }   -> formulário, se o aluno pode responder
//   submit    { formulario_id, contexto, respostas } -> grava (anônimo) e marca participação
// Nada aparece se o formulário não estiver com portal_ativo = true (desligado por padrão).
//   geral: principal nível do aluno (graduação > pós). Disciplina: disciplinas do boletim das turmas
//   vigentes, com o módulo atual (sufixo "P<n>" do nome da turma).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { alunoBoletins } from "../_shared/alunoSponte.ts";
import { contextoDisciplina, cursoRotulo, nivelDoCurso, participacaoHash, slug, validarRespostas } from "../_shared/cpa.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Matricula = { turma_id: number; nome_turma: string; nome_curso: string; data_inicio: string | null };
type Item = { formulario_id: number; nivel: string; tipo: string; contexto: string; disciplina: string | null; turma: string | null; curso: string };

async function contexto(db: any, A: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: ms } = await db.from("sponte_matriculas")
        .select("turma_id, nome_turma, nome_curso, data_inicio")
        .eq("aluno_id", A).eq("situacao_id", 1).not("turma_id", "is", null);
    const matriculas: Matricula[] = ms ?? [];
    if (!matriculas.length) return { principal: null as null | { nivel: string; curso: string }, itens: [] as Item[] };

    // principal: graduação se houver, senão pós; dentro do nível, a matrícula mais recente
    const ordenadas = [...matriculas].sort((a, b) => String(b.data_inicio ?? "").localeCompare(String(a.data_inicio ?? "")));
    const niveisPresentes = new Set(ordenadas.map((m) => nivelDoCurso(m.nome_curso)));
    const nivelPrincipal = niveisPresentes.has("graduacao") ? "graduacao" : "pos";
    const mp = ordenadas.find((m) => nivelDoCurso(m.nome_curso) === nivelPrincipal)!;
    const principal = { nivel: nivelPrincipal, curso: cursoRotulo(mp.nome_curso) };

    // disciplinas do boletim de cada turma vigente, só do módulo atual (P<n> no nome da turma)
    const boletins = await alunoBoletins(A, [...new Set(matriculas.map((m) => m.turma_id))]) ?? [];
    const itens: Item[] = [];
    for (const b of boletins) {
        const m = matriculas.find((x) => x.turma_id === b.turma_id);
        if (!m) continue;
        const moduloAtual = Number((m.nome_turma.match(/P(\d+)\s*$/) ?? [])[1]) || null;
        const nivel = nivelDoCurso(m.nome_curso);
        for (const d of b.disciplinas) {
            if (moduloAtual && d.modulo !== moduloAtual) continue;
            itens.push({
                formulario_id: 0, nivel, tipo: "disciplina",
                contexto: contextoDisciplina(m.nome_turma, d.disciplina),
                disciplina: d.disciplina, turma: m.nome_turma, curso: cursoRotulo(m.nome_curso),
            });
        }
    }
    return { principal, itens };
}

// formulários com o Portal ligado, do ano mais recente
async function formsAbertos(db: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data } = await db.from("cpa_formularios")
        .select("id, nivel, tipo, titulo, ano, status, intro")
        .eq("portal_ativo", true).in("status", ["teste", "aberto"]).order("ano", { ascending: false });
    return data ?? [];
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    try {
        const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: { user } } = await db.auth.getUser(jwt);
        if (!user?.email?.endsWith("@aluno.ficv.br")) return j({ error: "Sessão inválida." }, 401);
        const { data: aluno } = await db.from("alunos").select("sponte_aluno_id, nome, ra").eq("id", user.id).maybeSingle();
        if (!aluno?.sponte_aluno_id) return j({ error: "Conta não ligada ao Sponte." }, 404);
        const A = Number(aluno.sponte_aluno_id);
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const body = await req.json().catch(() => ({}));
        const acao = String(body.action ?? "pendencias");
        const forms = await formsAbertos(db);
        if (!forms.length) return j({ geral: null, disciplinas: [] }); // Portal desligado: nem chama o Sponte

        const { principal, itens } = await contexto(db, A);
        const geralForm = principal ? forms.find((f: any) => f.tipo === "geral" && f.nivel === principal.nivel) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
        const itensElegiveis = itens.map((i) => ({ ...i, formulario_id: forms.find((f: any) => f.tipo === "disciplina" && f.nivel === i.nivel)?.id ?? 0 })) // eslint-disable-line @typescript-eslint/no-explicit-any
            .filter((i) => i.formulario_id);

        // quem já respondeu (HMAC, sem identidade gravada)
        const hashes = new Map<string, string>();
        const chaves: { formulario_id: number; contexto: string; hash: string }[] = [];
        for (const it of [...(geralForm ? [{ formulario_id: geralForm.id, contexto: "" }] : []), ...itensElegiveis]) {
            const hash = await participacaoHash(key, A, it.formulario_id, it.contexto);
            hashes.set(`${it.formulario_id}|${it.contexto}`, hash);
            chaves.push({ formulario_id: it.formulario_id, contexto: it.contexto, hash });
        }
        const { data: feitas } = chaves.length
            ? await db.from("cpa_participacoes").select("formulario_id, contexto, respondente_hash").in("respondente_hash", chaves.map((c) => c.hash))
            : { data: [] };
        const respondido = (fid: number, ctx: string) => (feitas ?? []).some((p: any) => p.formulario_id === fid && p.contexto === ctx); // eslint-disable-line @typescript-eslint/no-explicit-any

        if (acao === "pendencias") {
            return j({
                geral: geralForm ? { formulario_id: geralForm.id, titulo: geralForm.titulo, nivel: geralForm.nivel, respondida: respondido(geralForm.id, "") } : null,
                disciplinas: itensElegiveis.map((i) => ({
                    formulario_id: i.formulario_id, contexto: i.contexto, disciplina: i.disciplina, turma: i.turma,
                    respondida: respondido(i.formulario_id, i.contexto),
                })),
            });
        }

        // elegível? (geral: principal; disciplina: alguma do boletim vigente)
        const alvo = acao === "form" || acao === "submit" ? String(body.contexto ?? "") : "";
        const fid = Number(body.formulario_id);
        const eleg = (geralForm && fid === geralForm.id && alvo === "")
            ? { formulario: geralForm, curso: principal!.curso }
            : (() => { const i = itensElegiveis.find((x) => x.formulario_id === fid && x.contexto === alvo); return i ? { formulario: forms.find((f: any) => f.id === fid), curso: i.curso } : null; })(); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!eleg) return j({ error: "Esta avaliação não está disponível para você." }, 403);

        const { data: perguntas } = await db.from("cpa_perguntas")
            .select("id, texto, tipo, escala_min, escala_max, opcoes, obrigatoria, chave, bloco_id, ordem, rotulo_min, rotulo_max")
            .eq("formulario_id", fid).order("ordem");
        const { data: blocos } = await db.from("cpa_blocos").select("id, ordem, titulo, incentivo").eq("formulario_id", fid).order("ordem");

        // o curso no Portal vem da matrícula: a pergunta de curso não é mostrada ao aluno, e o valor gravado
        // é a opção oficial do formulário (o nome do Sponte vem com outra grafia: "Pós Graduação Em ...")
        const perguntaCurso = (perguntas ?? []).find((p: any) => p.chave === "curso"); // eslint-disable-line @typescript-eslint/no-explicit-any
        const cursoOficial: string = perguntaCurso
            ? ((perguntaCurso.opcoes as string[] | null)?.find((o) => slug(o) === slug(eleg.curso)) ?? eleg.curso)
            : eleg.curso;

        if (acao === "form") {
            return j({
                formulario: { id: fid, nivel: eleg.formulario.nivel, titulo: eleg.formulario.titulo, ano: eleg.formulario.ano, intro: eleg.formulario.intro, teste: eleg.formulario.status === "teste", curso: cursoOficial },
                contexto: alvo,
                blocos: blocos ?? [],
                perguntas: (perguntas ?? []).filter((p: any) => p.chave !== "curso"), // eslint-disable-line @typescript-eslint/no-explicit-any
            });
        }

        if (acao === "submit") {
            if (respondido(fid, alvo)) return j({ error: "Você já respondeu esta avaliação." }, 409);
            const v = validarRespostas(perguntas ?? [], body.respostas && typeof body.respostas === "object" ? body.respostas : {}, { pularCurso: true });
            if (!v.ok) return j({ error: v.erro, pergunta_id: v.pergunta_id }, 400);
            if (perguntaCurso) v.limpas[perguntaCurso.id] = cursoOficial; // curso vem da matrícula, não do aluno

            const hash = hashes.get(`${fid}|${alvo}`)!;
            const { error: errPart } = await db.from("cpa_participacoes").insert({
                formulario_id: fid, contexto: alvo, respondente_hash: hash, teste: eleg.formulario.status === "teste",
            });
            if (errPart) {
                if (errPart.code === "23505") return j({ error: "Você já respondeu esta avaliação." }, 409);
                throw errPart;
            }
            const { data, error } = await db.rpc("cpa_registrar_resposta", {
                p_formulario: fid, p_respostas: v.limpas, p_curso: cursoOficial, p_contexto: alvo,
            });
            if (error) {
                await db.from("cpa_participacoes").delete().eq("formulario_id", fid).eq("contexto", alvo).eq("respondente_hash", hash);
                if (String(error.message).includes("formulario_fechado")) return j({ error: "Esta avaliação já foi encerrada." }, 409);
                throw error;
            }
            const linha = Array.isArray(data) ? data[0] : data;
            const { data: gravada } = await db.from("cpa_respostas").select("respondido_em").eq("id", linha.out_id).maybeSingle();
            const item = itensElegiveis.find((x) => x.formulario_id === fid && x.contexto === alvo);
            return j({
                ok: true, teste: linha.out_teste, protocolo: linha.out_seq, comprovante: linha.out_hash,
                formulario: eleg.formulario.titulo,
                disciplina: item?.disciplina ?? null,
                turma: item?.turma ?? null,
                respondido_em: gravada?.respondido_em ?? null,
                aluno: { nome: aluno.nome ?? null, ra: aluno.ra ?? null },
            });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("cpa-portal:", e);
        return j({ error: "Não foi possível carregar as avaliações agora." }, 500);
    }
});
