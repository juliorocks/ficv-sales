// cpa-admin — painel da Avaliação CPA (staff). Sempre com JWT (verify_jwt padrão).
//   forms                     -> formulários, contagem de oficiais/teste e população ativa (Sponte)
//   form        { formulario_id }                 -> formulário + blocos + perguntas
//   stats       { formulario_id, filtros }        -> indicadores do dashboard
//   export      { formulario_id, filtros }        -> CSV + SHA-256 + resultado da verificação da cadeia
//   verify      { formulario_id }                 -> recalcula a cadeia de hash das oficiais
//   update_form { formulario_id, status?, portal_ativo?, titulo? }   (admin)
//   delete_tests{ formulario_id }                 (admin) apaga só respostas de teste
//   reset_aluno_teste { aluno_id }                (admin) libera o aluno de teste (participações de teste) pra responder de novo
//   sync_docentes { offset? }                     (admin) professores titulares pelo Moodle, em lotes
// filtros: { origem: 'oficial'|'teste'|'todas', curso?: string, de?: 'AAAA-MM-DD', ate?: 'AAAA-MM-DD' }
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { partirCurso, professoresDoCurso, semestreAtual, todosOsCursos } from "../_shared/cpaMoodle.ts";
import { nivelDoCurso, participacaoHash, slug } from "../_shared/cpa.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const sha256Hex = async (s: string) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// PostgREST devolve no máximo 1000 linhas por chamada: pagina até acabar.
// deno-lint-ignore no-explicit-any
async function todas(montar: () => any): Promise<any[]> {
    const out: unknown[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await montar().order("id").range(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
    }
    return out as never[];
}

// deno-lint-ignore no-explicit-any
type Db = any;
type Filtros = { origem?: string; curso?: string; contexto?: string; de?: string; ate?: string };

function aplicarFiltros(q: Db, formId: number, f: Filtros) {
    q = q.eq("formulario_id", formId);
    if (f.origem === "oficial" || !f.origem) q = q.eq("teste", false);
    if (f.origem === "teste") q = q.eq("teste", true);
    if (f.curso) q = q.eq("curso", f.curso);
    if (f.contexto && /^[a-z0-9~-]+$/.test(f.contexto)) q = q.eq("contexto", f.contexto);
    if (f.de) q = q.gte("respondido_em", `${f.de}T00:00:00-03:00`);
    if (f.ate) q = q.lte("respondido_em", `${f.ate}T23:59:59-03:00`);
    return q;
}

async function carregarRespostas(db: Db, formId: number, f: Filtros) {
    return await todas(() => aplicarFiltros(
        db.from("cpa_respostas").select("id, seq, teste, respondido_em, respostas, curso, contexto, hash, hash_anterior, canonico"),
        formId, f));
}

async function carregarPerguntas(db: Db, formId: number) {
    const [{ data: blocos }, { data: perguntas }] = await Promise.all([
        db.from("cpa_blocos").select("id, ordem, titulo, incentivo").eq("formulario_id", formId).order("ordem"),
        db.from("cpa_perguntas").select("id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max, opcoes, obrigatoria, chave").eq("formulario_id", formId).order("ordem"),
    ]);
    return { blocos: blocos ?? [], perguntas: perguntas ?? [] };
}

// População ativa = alunos com matrícula Vigente (situação 1 no Sponte). Cada aluno conta uma vez, no
// nível do curso principal (graduação se tiver qualquer graduação; senão pós), o mesmo critério do Portal.
async function populacaoAtiva(db: Db) {
    const linhas = await todas(() => db.from("sponte_matriculas").select("id, aluno_id, nome_curso").eq("situacao_id", 1).not("turma_id", "is", null));
    const niveisPorAluno = new Map<number, Set<string>>();
    for (const l of linhas) {
        if (!niveisPorAluno.has(l.aluno_id)) niveisPorAluno.set(l.aluno_id, new Set());
        niveisPorAluno.get(l.aluno_id)!.add(nivelDoCurso(l.nome_curso ?? ""));
    }
    const pop = { graduacao: 0, pos: 0 };
    for (const niveis of niveisPorAluno.values()) pop[niveis.has("graduacao") ? "graduacao" : "pos"]++;
    return pop;
}

// Cadeia: seq contínuo a partir de 1, hash_anterior = hash da linha anterior, e
// hash = sha256(hash_anterior || '|' || canonico). Mesma fórmula de cpa_registrar_resposta.
// canonico = seq|timestamp|formulario|oficial|contexto|respostas(jsonb). O contexto não tem '|' (regra do banco).
// Também confere se as colunas (protocolo, data, contexto, respostas) ainda batem com o texto hasheado.
async function verificarCadeia(db: Db, formId: number) {
    const linhas = await todas(() => db.from("cpa_respostas")
        .select("id, seq, hash, hash_anterior, canonico, respostas, respondido_em, contexto")
        .eq("formulario_id", formId).eq("teste", false));
    let prev = "";
    let esperado = 1;
    for (const r of linhas) {
        const motivo = (m: string) => ({ integra: false, total: linhas.length, primeiro_erro: { seq: r.seq, motivo: m }, cabeca: null });
        if (r.seq !== esperado) return motivo("sequência quebrada");
        if ((r.hash_anterior ?? "") !== prev) return motivo("hash anterior não confere");
        const [seqTxt, ts, , , ctxCanon, ...jsonPartes] = String(r.canonico).split("|");
        if (Number(seqTxt) !== r.seq) return motivo("conteúdo não corresponde ao protocolo");
        if (new Date(ts).getTime() !== new Date(r.respondido_em).getTime()) return motivo("data não corresponde ao texto gravado");
        if (ctxCanon !== (r.contexto ?? "")) return motivo("contexto alterado após a gravação");
        const json = jsonPartes.join("|");
        if (JSON.stringify(ordenarChaves(JSON.parse(json))) !== JSON.stringify(ordenarChaves(r.respostas))) {
            return motivo("respostas alteradas após a gravação");
        }
        const h = await sha256Hex(`${r.hash_anterior ?? ""}|${r.canonico}`);
        if (h !== r.hash) return motivo("conteúdo alterado após a gravação");
        prev = r.hash;
        esperado++;
    }
    return { integra: true, total: linhas.length, primeiro_erro: null, cabeca: linhas.length ? prev : null };
}

const ordenarChaves = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, ordenarChaves((v as Record<string, unknown>)[k])]))
    : v;

const media = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

// Faixas de leitura de qualquer nota: favorável = top 10% da escala (9 e 10 de 10; 5 de 5), neutra = de 70% a
// 90% (7 e 8 de 10), crítica = abaixo disso. É a leitura de NPS/Likert, igual para 0–10, 1–10 e 0–5.
type Aval = { v: number; max: number };
const faixaDe = (v: number, max: number): "c" | "n" | "f" => (v >= max * 0.9 ? "f" : v >= max * 0.7 ? "n" : "c");
const nota10 = (a: Aval) => (a.v * 10) / a.max;
function resumir(lista: Aval[]) {
    const bandas = { c: 0, n: 0, f: 0 };
    for (const a of lista) bandas[faixaDe(a.v, a.max)]++;
    return { n: lista.length, media: media(lista.map(nota10)), bandas };
}

// Pergunta de nível ("Muito baixo" … "Muito alto") vira nota como no relatório da Prime: 2, 4, 6, 8 e 10.
// (conferido: 12 Muito alto + 1 Alto + 1 Médio = 9,57, o mesmo do relatório)
const ehOrdinal = (p: Db) => p.tipo === "escolha" && Array.isArray(p.opcoes) && p.opcoes.length === 5 && p.opcoes.includes("Muito alto");
// Dificuldade não é "quanto melhor, mais alto": mostra a distribuição, mas fica fora das médias e faixas
const ehNeutra = (p: Db) => /dificuldade/i.test(String(p.texto));
function avalDe(p: Db, l: Db): Aval | null {
    const v = l.respostas?.[String(p.id)];
    if (v === undefined || v === null || v === "") return null;
    if (p.tipo === "escala") return { v: Number(v), max: p.escala_max };
    if (ehOrdinal(p)) {
        const i = (p.opcoes as string[]).indexOf(String(v));
        return i >= 0 ? { v: (i + 1) * 2, max: 10 } : null;
    }
    return null;
}
const juntar = <K>(m: Map<K, Aval[]>, k: K, a: Aval) => { const l = m.get(k); if (l) l.push(a); else m.set(k, [a]); };

function estatisticas(form: Db, perguntas: Db[], blocos: Db[], linhas: Db[], todasRespostas: { teste: boolean }[], docentes: Map<string, string>, populacao: number | null, nomes: Map<string, { disciplina_nome: string | null; periodo_nome: string | null }> = new Map(), alunos: number | null = null) {
    const porDia = new Map<string, number>();
    const comentarios: Db[] = [];
    const semCurso = "(sem curso)";
    const avaliativas = perguntas.filter((p) => (p.tipo === "escala" || ehOrdinal(p)) && !ehNeutra(p));

    // um passo pelas respostas alimenta todos os recortes (geral, bloco, curso, curso×bloco, disciplina, professor)
    const total: Aval[] = [];
    const porBlocoAv = new Map<number, Aval[]>();
    const porCursoAv = new Map<string, Aval[]>();
    const porCursoBlocoAv = new Map<string, Aval[]>();
    const porDiscAv = new Map<string, Aval[]>();
    const porDocAv = new Map<string, Aval[]>();
    const linhasPorCurso = new Map<string, number>();
    const linhasPorDisc = new Map<string, number>();
    const linhasPorDoc = new Map<string, number>();
    const discsDoDoc = new Map<string, Set<string>>();
    for (const l of linhas) {
        const dia = String(l.respondido_em).slice(0, 10);
        porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
        const curso = l.curso ?? semCurso;
        linhasPorCurso.set(curso, (linhasPorCurso.get(curso) ?? 0) + 1);
        const docente = l.contexto ? docentes.get(l.contexto) ?? null : null;
        if (l.contexto) {
            linhasPorDisc.set(l.contexto, (linhasPorDisc.get(l.contexto) ?? 0) + 1);
            if (docente) {
                linhasPorDoc.set(docente, (linhasPorDoc.get(docente) ?? 0) + 1);
                (discsDoDoc.get(docente) ?? discsDoDoc.set(docente, new Set()).get(docente)!).add(l.contexto);
            }
        }
        for (const p of avaliativas) {
            const a = avalDe(p, l);
            if (!a) continue;
            total.push(a);
            juntar(porBlocoAv, p.bloco_id, a);
            juntar(porCursoAv, curso, a);
            juntar(porCursoBlocoAv, `${curso}|${p.bloco_id}`, a);
            if (l.contexto) juntar(porDiscAv, l.contexto, a);
            if (docente) juntar(porDocAv, docente, a);
        }
    }

    const itens = perguntas.map((p) => {
        const base = { id: p.id, bloco_id: p.bloco_id, ordem: p.ordem, texto: p.texto, tipo: p.tipo };
        const valores = linhas.map((l) => l.respostas[String(p.id)]).filter((v) => v !== undefined && v !== null && v !== "");
        if (p.tipo === "escala" || ehOrdinal(p)) {
            const avs = linhas.map((l) => ({ l, a: avalDe(p, l) })).filter((x): x is { l: Db; a: Aval } => !!x.a);
            const porCursoQ = new Map<string, number[]>();
            for (const { l, a } of avs) { const c = l.curso ?? semCurso; (porCursoQ.get(c) ?? porCursoQ.set(c, []).get(c)!).push(a.v); }
            const comum = {
                ...base, n: avs.length, media: media(avs.map((x) => x.a.v)), neutra: ehNeutra(p),
                bandas: resumir(avs.map((x) => x.a)).bandas,
                por_curso: [...porCursoQ.entries()].map(([curso, vs]) => ({ curso, n: vs.length, media: media(vs) })).sort((x, y) => y.n - x.n),
            };
            if (p.tipo === "escala") {
                const dist = [];
                for (let v = p.escala_min; v <= p.escala_max; v++) dist.push({ valor: v, n: avs.filter((x) => x.a.v === v).length });
                return { ...comum, distribuicao: dist, min: p.escala_min, max: p.escala_max };
            }
            return { ...comum, ordinal: true, opcoes: (p.opcoes as string[]).map((op) => ({ valor: op, n: valores.filter((v) => v === op).length })) };
        }
        if (p.tipo === "escolha") {
            return { ...base, n: valores.length, opcoes: (p.opcoes as string[]).map((op) => ({ valor: op, n: valores.filter((v) => v === op).length })) };
        }
        for (const l of linhas) {
            const t = String(l.respostas[String(p.id)] ?? "").trim();
            if (t) comentarios.push({ seq: l.seq, teste: l.teste, curso: l.curso, contexto: l.contexto, respondido_em: l.respondido_em, texto: t, pergunta: p.texto });
        }
        return { ...base, n: valores.length };
    });

    const pct = (parte: number, todo: number) => (todo ? Math.round((parte / todo) * 1000) / 10 : null);
    const geral = resumir(total);
    const perguntaIndicacao = avaliativas.find((p) => /indicaria/i.test(String(p.texto)));
    const indicacao = perguntaIndicacao
        ? (() => {
            const r = resumir(linhas.map((l) => avalDe(perguntaIndicacao, l)).filter((x): x is Aval => !!x));
            return r.n ? { pergunta_id: perguntaIndicacao.id, n: r.n, bandas: r.bandas, nps: Math.round(((r.bandas.f - r.bandas.c) / r.n) * 100) } : null;
        })()
        : null;

    return {
        formulario: { id: form.id, titulo: form.titulo, nivel: form.nivel, tipo: form.tipo, status: form.status, portal_ativo: form.portal_ativo },
        totais: {
            respondentes: linhas.length,
            alunos,
            populacao_ativa: populacao,
            percentual: populacao ? pct(linhas.length, populacao) : null,
            testes: todasRespostas.filter((r) => r.teste).length,
            media_geral: geral.media,
            bandas: geral.bandas,
            pct_favoraveis: pct(geral.bandas.f, geral.n),
            pct_neutros: pct(geral.bandas.n, geral.n),
            pct_criticos: pct(geral.bandas.c, geral.n),
        },
        indicacao,
        por_dia: [...porDia.entries()].sort().map(([dia, n]) => ({ dia, n })),
        por_curso: [...linhasPorCurso.entries()].map(([curso, n]) => ({
            curso, n, ...resumir(porCursoAv.get(curso) ?? []),
            por_bloco: Object.fromEntries(blocos.map((b) => [b.id, resumir(porCursoBlocoAv.get(`${curso}|${b.id}`) ?? []).media])),
        })).sort((a, b) => b.n - a.n),
        por_disciplina: [...linhasPorDisc.entries()].map(([contexto, n]) => {
            const [periodo, disc] = contexto.split("~");
            const r = resumir(porDiscAv.get(contexto) ?? []);
            return { contexto, periodo, disciplina: disc, disciplina_nome: nomes.get(contexto)?.disciplina_nome ?? null, periodo_nome: nomes.get(contexto)?.periodo_nome ?? null, docente: docentes.get(contexto) ?? null, n, media: r.media, bandas: r.bandas };
        }).sort((a, b) => b.n - a.n),
        por_docente: [...linhasPorDoc.entries()].map(([docente, n]) => {
            const r = resumir(porDocAv.get(docente) ?? []);
            return { docente, n, disciplinas: discsDoDoc.get(docente)?.size ?? 0, media: r.media, bandas: r.bandas };
        }).sort((a, b) => b.n - a.n),
        blocos: blocos.map((b) => ({ id: b.id, ordem: b.ordem, titulo: b.titulo, ...resumir(porBlocoAv.get(b.id) ?? []) })),
        perguntas: itens,
        comentarios: comentarios.sort((a, b) => String(b.respondido_em).localeCompare(String(a.respondido_em))),
    };
}

// CSV com ';' (Excel em português) e BOM UTF-8. Uma linha por resposta, colunas por pergunta.
function csvDe(perguntas: Db[], linhas: Db[]): string {
    const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cab = ["protocolo", "comprovante", "respondido_em", "origem", "curso", "contexto", ...perguntas.map((p) => `${p.ordem}. ${p.texto}`)];
    const corpo = linhas.map((l) => [
        l.seq, l.hash, l.respondido_em, l.teste ? "teste" : "oficial", l.curso, l.contexto,
        ...perguntas.map((p) => l.respostas[String(p.id)]),
    ].map(esc).join(";"));
    return "﻿" + [cab.map(esc).join(";"), ...corpo].join("\r\n") + "\r\n";
}

// Professores titulares das disciplinas ativas no Moodle (papel editingteacher; edteacher é tutor/mediador).
// Processa em lotes: a função tem limite de tempo, então o painel chama de novo com o offset devolvido.
// Linhas preenchidas à mão (origem 'manual') nunca são sobrescritas. Disciplina sem professor no Moodle
// (as pós) entra com docente nulo e aparece no painel para a equipe preencher.
const LOTE_CURSOS = 40;
async function sincronizarDocentes(db: Db, offset: number, semestre: string) {
    const agora = Math.floor(Date.now() / 1000);
    const ativos = (await todosOsCursos()).flatMap((c) => {
        const p = partirCurso(c.fullname);
        if (!p || c.hidden || (c.enddate && c.enddate < agora)) return [];
        if (p.nivel === "graduacao" ? p.semestre !== semestre : !(c.startdate && c.startdate <= agora)) return [];
        return [{ id: c.id, periodo: slug(p.periodo_nome), disciplina: slug(p.disciplina_nome), periodo_nome: p.periodo_nome, disciplina_nome: p.disciplina_nome }];
    });
    const unicos = [...new Map(ativos.map((a) => [`${a.periodo}~${a.disciplina}`, a])).values()];

    const { data: manuais } = await db.from("cpa_docentes").select("periodo, disciplina").eq("origem", "manual");
    const travados = new Set((manuais ?? []).map((m: Db) => `${m.periodo}~${m.disciplina}`));
    const lote = unicos.slice(offset, offset + LOTE_CURSOS).filter((c) => !travados.has(`${c.periodo}~${c.disciplina}`));

    const gravar = await Promise.all(lote.map(async (c) => {
        let docentes: string[] = [];
        try { docentes = await professoresDoCurso(c.id); } catch { /* Moodle falhou nesse curso: segue sem professor */ }
        return {
            periodo: c.periodo, disciplina: c.disciplina, docente: docentes.join(" / ") || null, moodle_course_id: c.id, origem: "moodle",
            periodo_nome: c.periodo_nome, disciplina_nome: c.disciplina_nome, sincronizado_em: new Date().toISOString(),
        };
    }));
    if (gravar.length) {
        const { error } = await db.from("cpa_docentes").upsert(gravar, { onConflict: "periodo,disciplina" });
        if (error) throw error;
    }
    const proximo = offset + LOTE_CURSOS;
    return {
        total_cursos: unicos.length, processados: Math.min(proximo, unicos.length),
        com_professor: gravar.filter((g) => g.docente).length, sem_professor: gravar.filter((g) => !g.docente).length,
        proximo: proximo < unicos.length ? proximo : null,
    };
}

// Perguntas que já têm resposta OFICIAL gravada. Depois de respondida, a estrutura não muda.
async function perguntasRespondidas(db: Db, formId: number): Promise<Set<string>> {
    // só resposta OFICIAL trava a pergunta; resposta de teste não: a equipe testa e depois enxuga o formulário
    const linhas = await todas(() => db.from("cpa_respostas").select("id, respostas").eq("formulario_id", formId).eq("teste", false));
    const s = new Set<string>();
    for (const l of linhas) for (const [k, v] of Object.entries(l.respostas ?? {})) if (v !== null && v !== "") s.add(k);
    return s;
}

const TIPOS = ["escala", "escolha", "texto"];
const diferentes = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

// Valida e normaliza uma pergunta vinda do editor. Devolve o registro pronto pra gravar ou o erro.
function normalizarPergunta(p: Db): { ok: true; reg: Db } | { ok: false; erro: string } {
    const texto = String(p.texto ?? "").trim();
    if (!texto || texto.length > 500) return { ok: false, erro: "Texto da pergunta: 1 a 500 caracteres." };
    if (!TIPOS.includes(p.tipo)) return { ok: false, erro: "Tipo inválido." };
    const reg: Db = {
        texto, tipo: p.tipo, bloco_id: Number(p.bloco_id), obrigatoria: p.obrigatoria !== false,
        chave: p.chave === "curso" ? "curso" : null,
        escala_min: null, escala_max: null, rotulo_min: null, rotulo_max: null, opcoes: [],
    };
    if (!Number.isInteger(reg.bloco_id)) return { ok: false, erro: "Bloco inválido." };
    if (p.tipo === "escala") {
        const mn = Number(p.escala_min), mx = Number(p.escala_max);
        if (!Number.isInteger(mn) || !Number.isInteger(mx) || mn >= mx || mx - mn > 10) return { ok: false, erro: "Escala: mínimo < máximo, no máximo 10 valores." };
        reg.escala_min = mn; reg.escala_max = mx;
        reg.rotulo_min = String(p.rotulo_min ?? "").trim() || null;
        reg.rotulo_max = String(p.rotulo_max ?? "").trim() || null;
    }
    if (p.tipo === "escolha") {
        const ops = (Array.isArray(p.opcoes) ? p.opcoes : []).map((o: unknown) => String(o).trim()).filter(Boolean);
        if (ops.length < 2 || new Set(ops).size !== ops.length) return { ok: false, erro: "Escolha: pelo menos 2 opções, sem repetir." };
        reg.opcoes = ops;
    }
    return { ok: true, reg };
}

async function proximaOrdem(db: Db, tabela: "cpa_perguntas" | "cpa_blocos", formId: number): Promise<number> {
    const { data } = await db.from(tabela).select("ordem").eq("formulario_id", formId).order("ordem", { ascending: false }).limit(1);
    return ((data?.[0]?.ordem as number | undefined) ?? 0) + 1;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db: Db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    try {
        const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: { user } } = await db.auth.getUser(jwt);
        if (!user) return j({ error: "Sessão inválida." }, 401);
        const { data: caller } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
        const role = caller?.role ?? "";
        if (!["admin", "agent"].includes(role)) return j({ error: "Sem acesso à Avaliação CPA." }, 403);
        const ehAdmin = role === "admin";

        const body = await req.json().catch(() => ({}));
        const acao = String(body.action ?? "");
        const formId = Number(body.formulario_id);
        const filtros: Filtros = body.filtros ?? {};

        if (acao === "forms") {
            const { data: forms, error } = await db.from("cpa_formularios").select("*").order("id");
            if (error) throw error;
            const pop = await populacaoAtiva(db);
            const contagens = await Promise.all((forms ?? []).map(async (f: Db) => {
                const { count: oficiais } = await db.from("cpa_respostas").select("id", { count: "exact", head: true }).eq("formulario_id", f.id).eq("teste", false);
                const { count: testes } = await db.from("cpa_respostas").select("id", { count: "exact", head: true }).eq("formulario_id", f.id).eq("teste", true);
                return { ...f, oficiais: oficiais ?? 0, testes: testes ?? 0, populacao_ativa: pop[f.nivel as "graduacao" | "pos"] ?? null };
            }));
            return j({ forms: contagens, admin: ehAdmin });
        }

        if (acao === "sync_docentes") {
            if (!ehAdmin) return j({ error: "Só admin atualiza professores." }, 403);
            const { data: fd } = await db.from("cpa_formularios").select("semestre").eq("tipo", "disciplina").not("semestre", "is", null).limit(1);
            return j(await sincronizarDocentes(db, Number(body.offset ?? 0), fd?.[0]?.semestre ?? semestreAtual()));
        }

        if (!Number.isInteger(formId) || formId <= 0) return j({ error: "formulario_id obrigatório." }, 400);
        const { data: form } = await db.from("cpa_formularios").select("*").eq("id", formId).maybeSingle();
        if (!form) return j({ error: "Formulário não encontrado." }, 404);

        if (acao === "form") {
            const { blocos, perguntas } = await carregarPerguntas(db, formId);
            return j({ form, blocos, perguntas });
        }

        if (acao === "testadores") {
            // contas dos alunos de teste (só nome e matrícula, para o painel mostrar quem está na lista)
            const ids: number[] = form.alunos_teste ?? [];
            if (!ids.length) return j({ alunos: [] });
            const { data } = await db.from("alunos").select("sponte_aluno_id, nome, ra").in("sponte_aluno_id", ids);
            return j({ alunos: data ?? [] });
        }

        if (acao === "stats") {
            const { blocos, perguntas } = await carregarPerguntas(db, formId);
            const linhas = await carregarRespostas(db, formId, filtros);
            const todasLinhas = await todas(() => db.from("cpa_respostas").select("id, teste").eq("formulario_id", formId));
            const pop = await populacaoAtiva(db);
            const { data: docs } = await db.from("cpa_docentes").select("periodo, disciplina, docente, periodo_nome, disciplina_nome");
            const docentes = new Map<string, string>((docs ?? []).map((d: Db) => [`${d.periodo}~${d.disciplina}`, d.docente]));
            const nomes = new Map<string, { disciplina_nome: string | null; periodo_nome: string | null }>((docs ?? []).map((d: Db) => [`${d.periodo}~${d.disciplina}`, { disciplina_nome: d.disciplina_nome ?? null, periodo_nome: d.periodo_nome ?? null }]));
            // na disciplina cada resposta é um aluno × disciplina: alunos = participantes distintos (a participação não guarda curso)
            let alunos: number | null = null;
            if (form.tipo === "disciplina" && !filtros.curso) {
                let q = db.from("cpa_participacoes").select("respondente_hash").eq("formulario_id", formId).eq("teste", filtros.origem === "teste");
                if (filtros.contexto && /^[a-z0-9~-]+$/.test(filtros.contexto)) q = q.eq("contexto", filtros.contexto);
                if (filtros.de) q = q.gte("respondido_em", `${filtros.de}T00:00:00-03:00`);
                if (filtros.ate) q = q.lte("respondido_em", `${filtros.ate}T23:59:59-03:00`);
                const part = await todas(() => q.order("respondente_hash"));
                alunos = new Set(part.map((r: Db) => r.respondente_hash)).size;
            }
            return j(estatisticas(form, perguntas, blocos, linhas, todasLinhas, docentes, pop[form.nivel as "graduacao" | "pos"] ?? null, nomes, alunos));
        }

        if (acao === "export") {
            const { perguntas } = await carregarPerguntas(db, formId);
            const linhas = await carregarRespostas(db, formId, filtros);
            const csv = csvDe(perguntas, linhas);
            const cadeia = await verificarCadeia(db, formId);
            return j({
                csv,
                sha256: await sha256Hex(csv),
                linhas: linhas.length,
                gerado_em: new Date().toISOString(),
                gerado_por: user.email ?? user.id,
                filtros,
                cadeia,
            });
        }

        if (acao === "verify") return j(await verificarCadeia(db, formId));

        if (acao === "update_form") {
            if (!ehAdmin) return j({ error: "Só admin altera o formulário." }, 403);
            const alt: Db = {};
            if (["teste", "aberto", "encerrado"].includes(body.status)) alt.status = body.status;
            if (typeof body.portal_ativo === "boolean") alt.portal_ativo = body.portal_ativo;
            if (typeof body.titulo === "string" && body.titulo.trim()) alt.titulo = body.titulo.trim();
            let naoEncontrados: string[] = [];
            if (Array.isArray(body.alunos_teste_cpf)) {
                // o CPF está guardado com pontuação em alunos: compara só os dígitos
                const cpfs: string[] = [...new Set<string>(body.alunos_teste_cpf.map((c: unknown) => String(c).replace(/\D/g, "")).filter((c: string) => c.length === 11))];
                const contas = await todas(() => db.from("alunos").select("id, sponte_aluno_id, cpf").not("sponte_aluno_id", "is", null));
                const porCpf = new Map<string, number>(contas.map((a: Db) => [String(a.cpf).replace(/\D/g, ""), Number(a.sponte_aluno_id)]));
                alt.alunos_teste = cpfs.filter((c) => porCpf.has(c)).map((c) => porCpf.get(c)!);
                naoEncontrados = cpfs.filter((c) => !porCpf.has(c));
            }
            if (body.semestre === null || /^\d{4}\.[12]$/.test(String(body.semestre ?? ""))) { if (body.semestre !== undefined) alt.semestre = body.semestre; }
            if (!Object.keys(alt).length) return j({ error: "Nada para alterar." }, 400);
            const { data, error } = await db.from("cpa_formularios").update(alt).eq("id", formId).select("*").maybeSingle();
            if (error) throw error;
            return j({ form: data, nao_encontrados: naoEncontrados });
        }

        if (acao === "delete_tests") {
            if (!ehAdmin) return j({ error: "Só admin apaga respostas de teste." }, 403);
            const { data, error } = await db.from("cpa_respostas").delete().eq("formulario_id", formId).eq("teste", true).select("id");
            if (error) throw error;
            await db.from("cpa_participacoes").delete().eq("formulario_id", formId).eq("teste", true);
            return j({ apagadas: (data ?? []).length });
        }

        if (acao === "reset_aluno_teste") {
            if (!ehAdmin) return j({ error: "Só admin reinicia aluno de teste." }, 403);
            const A = Number(body.aluno_id);
            if (!A) return j({ error: "aluno_id obrigatório." }, 400);
            const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const { data: parts, error } = await db.from("cpa_participacoes").select("formulario_id, contexto, respondente_hash").eq("teste", true);
            if (error) throw error;
            let apagadas = 0;
            for (const p of parts ?? []) {
                if (p.respondente_hash !== await participacaoHash(key, A, p.formulario_id, p.contexto)) continue;
                await db.from("cpa_participacoes").delete().eq("formulario_id", p.formulario_id).eq("contexto", p.contexto).eq("respondente_hash", p.respondente_hash);
                apagadas++;
            }
            return j({ apagadas });
        }

        if (acao === "estrutura") {
            // formulário inteiro pro editor: blocos, perguntas e quais perguntas já têm resposta
            const { blocos, perguntas } = await carregarPerguntas(db, formId);
            const respondidas = [...(await perguntasRespondidas(db, formId))];
            return j({ form, blocos, perguntas, respondidas });
        }

        if (acao.startsWith("bloco_") || acao.startsWith("pergunta_") || acao === "reordenar") {
            if (!ehAdmin) return j({ error: "Só admin altera as perguntas." }, 403);
        }

        if (acao === "bloco_salvar") {
            const b = body.bloco ?? {};
            const titulo = String(b.titulo ?? "").trim();
            if (!titulo || titulo.length > 200) return j({ error: "Título do bloco: 1 a 200 caracteres." }, 400);
            const incentivo = String(b.incentivo ?? "").trim() || null;
            if (b.id) {
                const { data, error } = await db.from("cpa_blocos").update({ titulo, incentivo }).eq("id", Number(b.id)).eq("formulario_id", formId).select("*").maybeSingle();
                if (error) throw error;
                if (!data) return j({ error: "Bloco não encontrado neste formulário." }, 404);
                return j({ bloco: data });
            }
            const ordem = await proximaOrdem(db, "cpa_blocos", formId);
            const { data, error } = await db.from("cpa_blocos").insert({ formulario_id: formId, ordem, titulo, incentivo }).select("*").single();
            if (error) throw error;
            return j({ bloco: data });
        }

        if (acao === "bloco_excluir") {
            const bid = Number(body.bloco_id);
            const { count } = await db.from("cpa_perguntas").select("id", { count: "exact", head: true }).eq("bloco_id", bid);
            if (count) return j({ error: "Esse bloco ainda tem perguntas. Mova ou exclua as perguntas primeiro." }, 400);
            const { error } = await db.from("cpa_blocos").delete().eq("id", bid).eq("formulario_id", formId);
            if (error) throw error;
            return j({ ok: true });
        }

        if (acao === "pergunta_salvar") {
            const norm = normalizarPergunta(body.pergunta ?? {});
            if (!norm.ok) return j({ error: norm.erro }, 400);
            const reg = norm.reg;
            const { data: bl } = await db.from("cpa_blocos").select("id").eq("id", reg.bloco_id).eq("formulario_id", formId).maybeSingle();
            if (!bl) return j({ error: "Bloco não pertence a este formulário." }, 400);
            if (reg.chave === "curso") {
                const { count } = await db.from("cpa_perguntas").select("id", { count: "exact", head: true }).eq("formulario_id", formId).eq("chave", "curso").neq("id", Number(body.pergunta?.id ?? 0));
                if (count) return j({ error: "Já existe uma pergunta de curso neste formulário." }, 400);
            }
            const id = Number(body.pergunta?.id ?? 0);
            if (id) {
                const { data: atual } = await db.from("cpa_perguntas").select("*").eq("id", id).eq("formulario_id", formId).maybeSingle();
                if (!atual) return j({ error: "Pergunta não encontrada neste formulário." }, 404);
                const respondidas = await perguntasRespondidas(db, formId);
                if (respondidas.has(String(id))) {
                    const estrutura = atual.tipo !== reg.tipo || atual.escala_min !== reg.escala_min || atual.escala_max !== reg.escala_max
                        || diferentes(atual.opcoes, reg.opcoes) || atual.chave !== reg.chave;
                    if (estrutura) return j({ error: "Esta pergunta já tem respostas: não dá pra mudar tipo, escala, opções ou o papel de curso. Só texto, rótulos e obrigatoriedade." }, 400);
                }
                const { data, error } = await db.from("cpa_perguntas").update({ ...reg, ordem: atual.ordem }).eq("id", id).eq("formulario_id", formId).select("*").single();
                if (error) throw error;
                return j({ pergunta: data });
            }
            const ordem = await proximaOrdem(db, "cpa_perguntas", formId);
            const { data, error } = await db.from("cpa_perguntas").insert({ ...reg, formulario_id: formId, ordem }).select("*").single();
            if (error) throw error;
            return j({ pergunta: data });
        }

        if (acao === "pergunta_excluir") {
            const id = Number(body.pergunta_id);
            const respondidas = await perguntasRespondidas(db, formId);
            if (respondidas.has(String(id))) return j({ error: "Esta pergunta já tem respostas: não pode ser excluída (use o status 'encerrado' se precisar tirar do ar)." }, 400);
            const { error } = await db.from("cpa_perguntas").delete().eq("id", id).eq("formulario_id", formId);
            if (error) throw error;
            return j({ ok: true });
        }

        if (acao === "reordenar") {
            // itens: [{ kind: 'bloco'|'pergunta', id, ordem, bloco_id? }]. Duas fases: a unicidade de ordem
            // (formulario_id, ordem) não aceita trocas diretas, então primeiro joga tudo pra valores negativos.
            const itens: Db[] = Array.isArray(body.itens) ? body.itens : [];
            const tabela = (i: Db) => (i.kind === "bloco" ? "cpa_blocos" : "cpa_perguntas");
            for (let i = 0; i < itens.length; i++) {
                const { error } = await db.from(tabela(itens[i])).update({ ordem: -(i + 1) }).eq("id", Number(itens[i].id)).eq("formulario_id", formId);
                if (error) throw error;
            }
            for (const it of itens) {
                const alt: Db = { ordem: Number(it.ordem) };
                if (it.kind === "pergunta" && it.bloco_id) alt.bloco_id = Number(it.bloco_id);
                const { error } = await db.from(tabela(it)).update(alt).eq("id", Number(it.id)).eq("formulario_id", formId);
                if (error) throw error;
            }
            return j({ ok: true });
        }

        if (acao === "docentes") {
            // professores identificados (Moodle) e se já têm foto enviada pela equipe
            const { data: rows } = await db.from("cpa_docentes").select("docente");
            const nomes = [...new Set((rows ?? []).flatMap((r: Db) => String(r.docente).split(" / ").map((n: string) => n.trim())).filter(Boolean))].sort();
            const { data: fotos } = await db.from("cpa_docente_fotos").select("nome, foto_path");
            const mapa = new Map((fotos ?? []).map((f: Db) => [f.nome, f.foto_path]));
            return j({ docentes: nomes.map((n) => ({ nome: n, foto_path: mapa.get(n) ?? null })), admin: ehAdmin });
        }

        if (acao === "docente_foto") {
            if (!ehAdmin) return j({ error: "Só admin envia foto." }, 403);
            const nome = String(body.nome ?? "").trim();
            const m = String(body.imagem ?? "").match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
            if (!nome || !m) return j({ error: "Envie uma imagem PNG, JPG ou WebP." }, 400);
            const bytes = Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0));
            if (bytes.length > 1_000_000) return j({ error: "Foto acima de 1 MB." }, 400);
            const path = `${slug(nome)}.${m[2] === "jpeg" ? "jpg" : m[2]}`;
            const { error: eUp } = await db.storage.from("cpa-docentes").upload(path, bytes, { contentType: m[1], upsert: true });
            if (eUp) throw eUp;
            const { error: eDb } = await db.from("cpa_docente_fotos").upsert({ nome, foto_path: path, atualizado_em: new Date().toISOString() }, { onConflict: "nome" });
            if (eDb) throw eDb;
            return j({ ok: true, foto_path: path });
        }

        if (acao === "disciplinas_docentes") {
            // disciplinas ativas conhecidas (sync do Moodle ou vistas no Portal), com professor e origem
            const out: Db[] = [];
            for (let from = 0; ; from += 1000) {
                const { data, error } = await db.from("cpa_docentes")
                    .select("periodo, disciplina, periodo_nome, disciplina_nome, docente, origem")
                    .not("periodo_nome", "is", null).order("periodo").order("disciplina").range(from, from + 999);
                if (error) throw error;
                out.push(...(data ?? []));
                if ((data ?? []).length < 1000) break;
            }
            return j({ disciplinas: out, admin: ehAdmin });
        }

        if (acao === "docente_definir") {
            if (!ehAdmin) return j({ error: "Só admin define o professor." }, 403);
            const periodo = String(body.periodo ?? "").trim();
            const disciplina = String(body.disciplina ?? "").trim();
            if (!/^[a-z0-9-]+$/.test(periodo) || !/^[a-z0-9-]+$/.test(disciplina)) return j({ error: "Disciplina inválida." }, 400);
            const docente = String(body.docente ?? "").trim().slice(0, 200);
            // com nome: vira manual (a sincronização não sobrescreve). Sem nome: volta pro Moodle.
            const alt = docente
                ? { docente, origem: "manual", sincronizado_em: new Date().toISOString() }
                : { docente: null, origem: "moodle", sincronizado_em: new Date().toISOString() };
            const { data, error } = await db.from("cpa_docentes").update(alt).eq("periodo", periodo).eq("disciplina", disciplina).select("periodo");
            if (error) throw error;
            if (!(data ?? []).length) return j({ error: "Disciplina não encontrada. Atualize os professores primeiro." }, 404);
            return j({ ok: true });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("cpa-admin:", e);
        return j({ error: "Erro ao processar a Avaliação CPA." }, 500);
    }
});
