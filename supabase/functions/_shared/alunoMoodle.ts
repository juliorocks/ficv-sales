// Dados do Moodle de UM aluno (EAD) — usado pelo Portal do Aluno (aluno-portal) pra COMPLETAR
// as notas que o Sponte não lança em detalhe pra turma EAD (ver alunoSponte.ts,
// avaliacoesPorDisciplina: GetNotaParcial só tem o detalhe por avaliação — AV1/AV2 — pra turma
// presencial; testado ao vivo com turma EAD real e não veio nada, o detalhe mora só no Moodle).
// Pedido do usuário 01/10: "casar" as duas fontes pro painel de notas ficar 100% completo —
// nunca substitui o que o Sponte já tem (presencial segue vindo de lá), só preenche o que
// falta (EAD). Mesma ideia da honestidade das outras integrações: nunca inventa número, só
// repassa o que o Moodle já calculou (os totais por categoria são do PRÓPRIO Moodle, não
// recalculados aqui — a lógica de peso/arredondamento dele é complexa demais pra reproduzir
// sem risco de divergir do que o aluno vê na tela dele).
import { getSecret } from "./secrets.ts";

async function moodleCall(fn: string, params: Record<string, unknown> = {}): Promise<any> {
    const rawUrl = (await getSecret("MOODLE_URL")).replace(/\/+$/, "");
    const url = rawUrl.replace(/\/webservice\/rest\/server\.php$/i, "");
    const token = await getSecret("MOODLE_TOKEN");
    if (!url || !token) throw new Error("Moodle não configurado.");
    const qs = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json" });
    // PHP-style: lista vira chave[0]=x, objeto vira chave[campo]=x, aninhado quando precisa.
    const append = (key: string, v: unknown): void => {
        if (v == null) return;
        if (Array.isArray(v)) v.forEach((vv, i) => append(`${key}[${i}]`, vv));
        else if (typeof v === "object") Object.entries(v as Record<string, unknown>).forEach(([k, v2]) => append(`${key}[${k}]`, v2));
        else qs.append(key, String(v));
    };
    for (const [k, v] of Object.entries(params)) append(k, v);
    const r = await fetch(`${url}/webservice/rest/server.php?${qs}`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => null);
    if (!r.ok || d?.exception) throw new Error(d?.message ?? `Moodle: HTTP ${r.status}`);
    return d;
}

/** userid do Moodle a partir do e-mail do aluno — null se não achar, Moodle não estiver
 *  configurado, ou a chamada falhar (nunca derruba o boletim por causa do Moodle). */
export async function moodleUserId(email: string | null): Promise<number | null> {
    if (!email) return null;
    try {
        const d = await moodleCall("core_user_get_users_by_field", { field: "email", values: [email] });
        return d?.[0]?.id ?? null;
    } catch { return null; }
}

/** Todos os cursos do aluno no Moodle (id + nome completo) — pra casar com a disciplina do Sponte. */
export async function moodleCourses(userid: number): Promise<{ id: number; fullname: string }[]> {
    try {
        const d = await moodleCall("core_enrol_get_users_courses", { userid });
        return (d ?? []).map((c: any) => ({ id: Number(c.id), fullname: String(c.fullname ?? "") }));
    } catch { return []; }
}

type Avaliacao = { nome: string; nota: string };
const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

// O Moodle nomeia o curso "TEOLOGIA EAD - 2025.2 - P3 - METODOLOGIA" — a disciplina do Sponte
// ("Metodologia") é sempre o ÚLTIMO trecho depois do " - ". Compara normalizado (sem acento/
// caixa); se não bater exato (pontuação ligeiramente diferente), cai pra "contém".
function matchCourse(disciplina: string, courses: { id: number; fullname: string }[]): number | null {
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const alvo = norm(disciplina);
    if (!alvo) return null;
    for (const c of courses) {
        const partes = c.fullname.split(" - ");
        if (norm(partes[partes.length - 1]) === alvo) return c.id;
    }
    for (const c of courses) if (norm(c.fullname).includes(alvo)) return c.id;
    return null;
}

/** `gradereport_user_get_grade_items` cru → {avaliacoes, media}, já agrupado/nomeado.
 *  Item sozinho na categoria do Moodle → mostra ele mesmo (ex.: "AV2"); vários itens na mesma
 *  categoria (ex.: 15 questionários de módulo dentro de "AV1") → mostra só o TOTAL da
 *  categoria (já calculado pelo Moodle, nunca recalculado aqui), nomeado pelo prefixo comum
 *  dos itens ("AV1 - Módulo 1" → "AV1"). `media`: a nota final do curso (itemtype='course').
 *  Compartilhado por moodleAvaliacoes (1 disciplina já casada) e
 *  moodleDisciplinasDoPeriodo (Sponte sem nada lançado — monta a disciplina inteira). */
function extrairAvaliacoes(items: any[]): { avaliacoes: Avaliacao[]; media: string | null } {
    const avaliados = items.filter((it) => (it.itemtype === "mod" || it.itemtype === "manual") && it.graderaw != null);
    const categorias = items.filter((it) => it.itemtype === "category");
    const itemCurso = items.find((it) => it.itemtype === "course");

    const porCategoria = new Map<number, typeof avaliados>();
    for (const it of avaliados) {
        const arr = porCategoria.get(it.categoryid) ?? [];
        arr.push(it);
        porCategoria.set(it.categoryid, arr);
    }
    const avaliacoes: Avaliacao[] = [];
    for (const [catId, grupo] of porCategoria) {
        if (grupo.length === 1) {
            avaliacoes.push({ nome: grupo[0].itemname || "Avaliação", nota: fmt(grupo[0].graderaw) });
        } else {
            const cat = categorias.find((c) => c.iteminstance === catId);
            const nome = (String(grupo[0].itemname ?? "").split(" - ")[0] || "Avaliação").trim();
            if (cat?.graderaw != null) avaliacoes.push({ nome, nota: fmt(cat.graderaw) });
        }
    }
    return { avaliacoes: semPrefixoComum(avaliacoes), media: itemCurso?.graderaw != null ? fmt(itemCurso.graderaw) : null };
}

async function gradeItemsDoCurso(userid: number, courseId: number): Promise<any[]> {
    try {
        const d = await moodleCall("gradereport_user_get_grade_items", { courseid: courseId, userid });
        return d?.usergrades?.[0]?.gradeitems ?? [];
    } catch { return []; }
}

/** Notas parciais de UMA disciplina já identificada (o Sponte tem a disciplina lançada, só
 *  falta o detalhe — ver avaliacoesPorDisciplina em alunoSponte.ts), puxadas do Moodle no
 *  mesmo formato {nome,nota} que o Sponte usa pra turma presencial — cabe no mesmo campo
 *  `avaliacoes` da tela sem mudar nada no front. */
export async function moodleAvaliacoes(userid: number, courses: { id: number; fullname: string }[], disciplina: string):
    Promise<{ avaliacoes: Avaliacao[]; media: string | null } | null> {
    const courseId = matchCourse(disciplina, courses);
    if (!courseId) return null;
    const items = await gradeItemsDoCurso(userid, courseId);
    if (!items.length) return null;
    return extrairAvaliacoes(items);
}

type DisciplinaSintetizada = {
    disciplina: string; modulo: null; notas: string[]; media: string | null; faltas: null; situacao: null; avaliacoes: Avaliacao[] | null;
};

// normaliza (sem acento/caixa) pra comparar nome de turma do Sponte com o do Moodle
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Quando o Sponte não tem NENHUMA disciplina lançada pro período (achado ao vivo 01/10:
 *  acontece com turma EAD encerrada — o período existe e tem matrícula, mas o boletim do
 *  Sponte vem vazio, mesmo com nota completa no Moodle), monta a lista de disciplinas DIRETO
 *  do Moodle: acha todos os cursos cujo nome começa com o mesmo período do Sponte
 *  ("Teologia EAD - 2025.2 - P3 - <disciplina>") e trata cada um como uma disciplina. */
export async function moodleDisciplinasDoPeriodo(userid: number, courses: { id: number; fullname: string }[], turmaNome: string):
    Promise<DisciplinaSintetizada[]> {
    const prefixo = norm(turmaNome);
    if (!prefixo) return [];
    const doPeriodo = courses.filter((c) => norm(c.fullname).startsWith(`${prefixo} - `));
    const out: DisciplinaSintetizada[] = [];
    for (const c of doPeriodo) {
        const partes = c.fullname.split(" - ");
        const disciplina = partes[partes.length - 1].trim();
        if (!disciplina) continue;
        const items = await gradeItemsDoCurso(userid, c.id);
        if (!items.length) continue;
        const { avaliacoes, media } = extrairAvaliacoes(items);
        out.push({ disciplina, modulo: null, notas: [], media, faltas: null, situacao: null, avaliacoes: avaliacoes.length ? avaliacoes : null });
    }
    return out;
}

// Vários itens avaliados SEM estar na mesma categoria do Moodle (por isso não entraram no
// agrupamento acima) às vezes compartilham um prefixo (ex.: "Declaração de Leitura - Fase 1",
// "... - Fase 2", "... - Fase 3"...) — achado ao vivo 01/10, pedido do usuário pra ficar mais
// legível na tela. Se TODOS os nomes começam com o mesmo trecho antes de " - ", tira esse
// trecho de todos (sobra só "Fase 1", "Fase 2"...); nunca tira a parte final (não esvazia o nome).
function semPrefixoComum(avaliacoes: Avaliacao[]): Avaliacao[] {
    if (avaliacoes.length < 2) return avaliacoes;
    const partes = avaliacoes.map((a) => a.nome.split(" - "));
    const minLen = Math.min(...partes.map((p) => p.length));
    let comum = 0;
    for (let i = 0; i < minLen - 1; i++) {
        if (partes.every((p) => p[i] === partes[0][i])) comum = i + 1;
        else break;
    }
    if (!comum) return avaliacoes;
    return avaliacoes.map((a, i) => ({ ...a, nome: partes[i].slice(comum).join(" - ") }));
}
