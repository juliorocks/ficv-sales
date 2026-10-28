// cpa-portal — Avaliação CPA dentro do Portal do Aluno. Só enxerga o aluno LOGADO (JWT).
//   pendencias                              -> avaliações abertas pro aluno (geral + disciplinas)
//   form      { formulario_id, contexto }   -> formulário, se o aluno pode responder
//   submit    { formulario_id, contexto, respostas } -> grava e marca participação (com aluno_id e resposta_id)
//   minhas                                  -> o aluno revê as próprias respostas (participação → resposta)
// Nada aparece se o formulário não estiver com portal_ativo = true (desligado por padrão).
//   geral: nível principal do aluno (graduação > pós), pela matrícula Vigente do Sponte.
//   disciplinas: cursos do Moodle em que o aluno está inscrito e que estão ativos no semestre
//   (_shared/cpaMoodle.ts). O professor vem do mesmo curso (cache em cpa_docentes; nas pós, a equipe preenche).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { cursoRotulo, nivelDoCurso, participacaoHash, slug, validarRespostas } from "../_shared/cpa.ts";
import { cursosDoUsuario, disciplinasAtivas, moodleUserIdPorEmail, professoresDoCurso, semestreAtual } from "../_shared/cpaMoodle.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Matricula = { turma_id: number; nome_turma: string; nome_curso: string; data_inicio: string | null };
type Item = {
    formulario_id: number; nivel: string; contexto: string; disciplina: string; turma: string; curso: string
    docente: string | null; docente_foto: string | null; moodle_id: number; periodo: string; disciplina_slug: string
}

// foto enviada pela equipe (bucket público cpa-docentes). null quando não há foto: a tela mostra avatar.
async function fotoDoDocente(db: any, nome: string | null): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!nome) return null;
    const { data } = await db.from("cpa_docente_fotos").select("foto_path").eq("nome", nome.split(" / ")[0]).maybeSingle();
    if (!data?.foto_path) return null;
    return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/cpa-docentes/${data.foto_path}`;
}

// Professor de cada disciplina: primeiro a tabela (inclui o que a equipe preencheu à mão); o que ainda não
// foi visto vai ao Moodle uma vez e fica guardado. Linha com docente nulo = "já olhei e não há professor".
async function resolverDocentes(db: any, ativas: ReturnType<typeof disciplinasAtivas>): Promise<Map<string, string | null>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const mapa = new Map<string, string | null>();
    if (!ativas.length) return mapa;
    const { data } = await db.from("cpa_docentes").select("periodo, disciplina, docente").in("periodo", [...new Set(ativas.map((a) => a.periodo))]);
    for (const r of data ?? []) mapa.set(`${r.periodo}~${r.disciplina}`, r.docente ?? null);
    const novas = ativas.filter((a) => !mapa.has(a.contexto));
    if (novas.length) {
        const achados = await Promise.all(novas.map(async (a) => {
            try { return (await professoresDoCurso(a.moodle_id)).join(" / ") || null; } catch { return undefined; } // Moodle falhou: não grava
        }));
        const gravar: Record<string, unknown>[] = [];
        novas.forEach((a, k) => {
            if (achados[k] === undefined) return;
            mapa.set(a.contexto, achados[k] ?? null);
            gravar.push({
                periodo: a.periodo, disciplina: a.disciplina, docente: achados[k], moodle_course_id: a.moodle_id, origem: "moodle",
                periodo_nome: a.periodo_nome, disciplina_nome: a.disciplina_nome, sincronizado_em: new Date().toISOString(),
            });
        });
        if (gravar.length) await db.from("cpa_docentes").upsert(gravar, { onConflict: "periodo,disciplina", ignoreDuplicates: true });
    }
    return mapa;
}

async function situacaoDoAluno(db: any, A: number, email: string | null, semestre: string, nivelTeste: string | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: ms } = await db.from("sponte_matriculas")
        .select("turma_id, nome_turma, nome_curso, data_inicio")
        .eq("aluno_id", A).eq("situacao_id", 1).not("turma_id", "is", null);
    const matriculas: Matricula[] = ms ?? [];
    // aluno de teste que não está no espelho do Sponte (equipe): vale o nível do cadastro, pra a CPA conseguir testar
    if (!matriculas.length && nivelTeste) {
        const nome = nivelTeste === "pos" ? "Pós Graduação em Teste" : "Bacharelado em Teste";
        matriculas.push({ turma_id: 0, nome_turma: "Teste", nome_curso: nome, data_inicio: null });
    }
    if (!matriculas.length) return { principal: null as null | { nivel: string; curso: string }, itens: [] as Omit<Item, "formulario_id">[] };

    // principal: graduação se houver, senão pós; dentro do nível, a matrícula mais recente
    const ordenadas = [...matriculas].sort((a, b) => String(b.data_inicio ?? "").localeCompare(String(a.data_inicio ?? "")));
    const nivelPrincipal = ordenadas.some((m) => nivelDoCurso(m.nome_curso) === "graduacao") ? "graduacao" : "pos";
    const cursoDoNivel = (n: string) => cursoRotulo((ordenadas.find((m) => nivelDoCurso(m.nome_curso) === n) ?? ordenadas[0]).nome_curso);
    const principal = { nivel: nivelPrincipal, curso: cursoDoNivel(nivelPrincipal) };

    let ativas: ReturnType<typeof disciplinasAtivas> = [];
    try {
        const uid = await moodleUserIdPorEmail(email);
        if (uid) {
            // só disciplinas dos níveis em que o aluno tem matrícula Vigente (aluno de pós com resquício de graduação no Moodle não entra)
            const niveis = new Set(matriculas.map((m) => nivelDoCurso(m.nome_curso)));
            ativas = disciplinasAtivas(await cursosDoUsuario(uid), { semestre }).filter((a) => niveis.has(a.nivel));
        }
    } catch (e) {
        console.error("cpa-portal moodle:", e); // Moodle fora do ar: o aluno segue só com a avaliação geral
    }
    const docentes = await resolverDocentes(db, ativas);
    const itens = await Promise.all(ativas.map(async (a) => {
        const docente = docentes.get(a.contexto) ?? null;
        return {
            nivel: a.nivel, contexto: a.contexto, disciplina: a.disciplina_nome, turma: a.periodo_nome, curso: cursoDoNivel(a.nivel),
            docente, docente_foto: await fotoDoDocente(db, docente), moodle_id: a.moodle_id, periodo: a.periodo, disciplina_slug: a.disciplina,
        };
    }));
    return { principal, itens };
}

// formulários com o Portal ligado, do ano mais recente
// Portal ligado (portal_ativo) ou, em status teste, aluno que a CPA cadastrou como aluno de teste.
async function formsAbertos(db: any, A: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data } = await db.from("cpa_formularios")
        .select("id, nivel, tipo, titulo, ano, status, intro, semestre, portal_ativo, alunos_teste")
        .in("status", ["teste", "aberto"]).order("ano", { ascending: false });
    return (data ?? []).filter((f: any) => f.portal_ativo || (f.status === "teste" && (f.alunos_teste ?? []).includes(A))); // eslint-disable-line @typescript-eslint/no-explicit-any
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    try {
        const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: { user } } = await db.auth.getUser(jwt);
        if (!user?.email?.endsWith("@aluno.ficv.br")) return j({ error: "Sessão inválida." }, 401);
        const { data: aluno } = await db.from("alunos").select("sponte_aluno_id, nome, ra, email, nivel").eq("id", user.id).maybeSingle();
        if (!aluno?.sponte_aluno_id) return j({ error: "Conta não ligada ao Sponte." }, 404);
        const A = Number(aluno.sponte_aluno_id);
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const body = await req.json().catch(() => ({}));
        const acao = String(body.action ?? "pendencias");

        if (acao === "minhas") {
            const { data: parts } = await db.from("cpa_participacoes").select("formulario_id, contexto, resposta_id, respondido_em")
                .eq("aluno_id", A).not("resposta_id", "is", null).order("respondido_em", { ascending: false });
            const ids = (parts ?? []).map((p: any) => p.resposta_id); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!ids.length) return j({ avaliacoes: [] });
            const fids = [...new Set((parts ?? []).map((p: any) => p.formulario_id))]; // eslint-disable-line @typescript-eslint/no-explicit-any
            const [{ data: resp }, { data: perg }, { data: frm }, { data: docs }] = await Promise.all([
                db.from("cpa_respostas").select("id, seq, teste, respostas, hash, respondido_em").in("id", ids),
                db.from("cpa_perguntas").select("id, formulario_id, ordem, texto, tipo, escala_max, chave").in("formulario_id", fids).order("ordem"),
                db.from("cpa_formularios").select("id, titulo, tipo, nivel").in("id", fids),
                db.from("cpa_docentes").select("periodo, disciplina, docente, periodo_nome, disciplina_nome"),
            ]);
            const nomes = new Map((docs ?? []).map((d: any) => [`${d.periodo}~${d.disciplina}`, d])); // eslint-disable-line @typescript-eslint/no-explicit-any
            const avaliacoes = (parts ?? []).map((p: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const r: any = (resp ?? []).find((x: any) => x.id === p.resposta_id); // eslint-disable-line @typescript-eslint/no-explicit-any
                const f: any = (frm ?? []).find((x: any) => x.id === p.formulario_id); // eslint-disable-line @typescript-eslint/no-explicit-any
                if (!r || !f) return null;
                const d: any = nomes.get(p.contexto); // eslint-disable-line @typescript-eslint/no-explicit-any
                return {
                    formulario_id: f.id, titulo: f.titulo, tipo: f.tipo, teste: r.teste, protocolo: r.seq, comprovante: r.hash, respondido_em: r.respondido_em,
                    disciplina: f.tipo === "disciplina" ? (d?.disciplina_nome ?? p.contexto.split("~")[1] ?? null) : null,
                    turma: f.tipo === "disciplina" ? (d?.periodo_nome ?? null) : null,
                    docente: f.tipo === "disciplina" ? (d?.docente ?? null) : null,
                    respostas: (perg ?? []).filter((q: any) => q.formulario_id === f.id && q.chave !== "curso" && r.respostas?.[q.id] !== undefined && r.respostas[q.id] !== "") // eslint-disable-line @typescript-eslint/no-explicit-any
                        .map((q: any) => ({ pergunta: q.texto, tipo: q.tipo, valor: r.respostas[q.id], escala_max: q.escala_max })), // eslint-disable-line @typescript-eslint/no-explicit-any
                };
            }).filter(Boolean);
            return j({ avaliacoes });
        }
        const forms = await formsAbertos(db, A);
        if (!forms.length) return j({ geral: null, disciplinas: [] }); // Portal desligado: nem chama Sponte nem Moodle

        // semestre das disciplinas: o que a CPA definiu no formulário de disciplina, senão o atual
        const semestre: string = forms.find((f: any) => f.tipo === "disciplina" && f.semestre)?.semestre ?? semestreAtual(); // eslint-disable-line @typescript-eslint/no-explicit-any
        const { principal, itens } = await situacaoDoAluno(db, A, aluno.email ?? null, semestre,
            forms.some((f: any) => f.status === "teste" && (f.alunos_teste ?? []).includes(A)) ? (aluno.nivel ?? null) : null); // eslint-disable-line @typescript-eslint/no-explicit-any
        const geralForm = principal ? forms.find((f: any) => f.tipo === "geral" && f.nivel === principal.nivel) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
        const itensElegiveis: Item[] = itens
            .map((i) => ({ ...i, formulario_id: forms.find((f: any) => f.tipo === "disciplina" && f.nivel === i.nivel)?.id ?? 0 })) // eslint-disable-line @typescript-eslint/no-explicit-any
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
                oficial: forms.some((f: any) => f.status === "aberto"), // eslint-disable-line @typescript-eslint/no-explicit-any
                geral: geralForm ? { formulario_id: geralForm.id, titulo: geralForm.titulo, nivel: geralForm.nivel, respondida: respondido(geralForm.id, "") } : null,
                disciplinas: itensElegiveis.map((i) => ({
                    formulario_id: i.formulario_id, contexto: i.contexto, disciplina: i.disciplina, turma: i.turma,
                    docente: i.docente, docente_foto: i.docente_foto, respondida: respondido(i.formulario_id, i.contexto),
                })),
            });
        }

        // elegível? (geral: principal; disciplina: ativa no Moodle)
        const alvo = acao === "form" || acao === "submit" ? String(body.contexto ?? "") : "";
        const fid = Number(body.formulario_id);
        const item = itensElegiveis.find((x) => x.formulario_id === fid && x.contexto === alvo);
        const eleg = (geralForm && fid === geralForm.id && alvo === "")
            ? { formulario: geralForm, curso: principal!.curso }
            : item ? { formulario: forms.find((f: any) => f.id === fid), curso: item.curso } : null; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!eleg) return j({ error: "Esta avaliação não está disponível para você." }, 403);

        const { data: perguntas } = await db.from("cpa_perguntas")
            .select("id, texto, tipo, escala_min, escala_max, opcoes, obrigatoria, chave, bloco_id, ordem, rotulo_min, rotulo_max")
            .eq("formulario_id", fid).order("ordem");
        const { data: blocos } = await db.from("cpa_blocos").select("id, ordem, titulo, incentivo").eq("formulario_id", fid).order("ordem");

        // o curso no Portal vem da matrícula: a pergunta de curso não é mostrada ao aluno, e o valor gravado
        // é a opção oficial do formulário (o nome do Sponte vem com outra grafia: "Pós Graduação Em ...")
        const perguntaCurso = (perguntas ?? []).find((p: any) => p.chave === "curso"); // eslint-disable-line @typescript-eslint/no-explicit-any
        // sem pergunta de curso neste formulário (disciplina), vale a lista de cursos dos outros formulários: mesma grafia em tudo
        const opcoesCurso: string[] = (perguntaCurso?.opcoes as string[] | null)
            ?? ((await db.from("cpa_perguntas").select("opcoes").eq("chave", "curso")).data ?? []).flatMap((r: any) => r.opcoes ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
        const cursoOficial: string = opcoesCurso.find((o) => slug(o) === slug(eleg.curso)) ?? eleg.curso;

        if (acao === "form") {
            return j({
                formulario: {
                    id: fid, nivel: eleg.formulario.nivel, titulo: eleg.formulario.titulo, ano: eleg.formulario.ano, intro: eleg.formulario.intro,
                    teste: eleg.formulario.status === "teste", curso: cursoOficial,
                    disciplina: item?.disciplina ?? null, turma: item?.turma ?? null, docente: item?.docente ?? null, docente_foto: item?.docente_foto ?? null,
                },
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
                formulario_id: fid, contexto: alvo, respondente_hash: hash, teste: eleg.formulario.status === "teste", aluno_id: A,
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
            await db.from("cpa_participacoes").update({ resposta_id: linha.out_id }).eq("formulario_id", fid).eq("contexto", alvo).eq("respondente_hash", hash);
            const { data: gravada } = await db.from("cpa_respostas").select("respondido_em").eq("id", linha.out_id).maybeSingle();
            return j({
                ok: true, teste: linha.out_teste, protocolo: linha.out_seq, comprovante: linha.out_hash,
                formulario: eleg.formulario.titulo,
                disciplina: item?.disciplina ?? null,
                turma: item?.turma ?? null,
                docente: item?.docente ?? null,
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
