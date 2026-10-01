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
        // a disciplina é tudo DEPOIS do período (ver periodoDoCurso, calculado em cima do
        // PRÓPRIO nome do curso — evita qualquer mismatch de grafia/acentuação com turmaNome)
        // — nunca "o último trecho depois do último hífen", que quebra ao meio um nome de
        // disciplina que por si só já tem um hífen (ex.: "Projeto Integrador IV - Liderança";
        // achado ao vivo 01/10: virava período fantasma "... - P4 - Projeto Integrador Iv").
        const periodoReal = periodoDoCurso(c.fullname);
        const disciplina = c.fullname.slice(periodoReal.length).replace(/^\s*-\s*/, "").trim();
        if (!disciplina) continue;
        const items = await gradeItemsDoCurso(userid, c.id);
        if (!items.length) continue;
        const { avaliacoes, media } = extrairAvaliacoes(items);
        out.push({ disciplina, modulo: null, notas: [], media, faltas: null, situacao: null, avaliacoes: avaliacoes.length ? avaliacoes : null });
    }
    return out;
}

// "TEOLOGIA EAD - 2026.1 - P3 - HEBRAICO BÍBLICO I" → período = "TEOLOGIA EAD - 2026.1 - P3".
// O período SEMPRE termina em "- P<número>" ou "- Modular" (todo padrão visto até agora) —
// corta exatamente ALI, não no último "-" qualquer: uma disciplina que por si só tem um "-"
// no nome (ex.: "Projeto Integrador IV - Liderança") faria "o último trecho" cortar no hífen
// ERRADO, no meio do nome da disciplina (achado ao vivo 01/10).
const PERIODO_RE = /^(.*?-\s*(?:P\d+|Modular))\b/i;
const periodoDoCurso = (fullname: string): string => {
    const m = fullname.match(PERIODO_RE);
    if (m) return m[1].trim();
    // sem "- P#"/"Modular" reconhecível (curso avulso, tipo seminário) — cai pro antigo "tudo
    // menos o último trecho"; esses já são descartados depois por não terem ano.semestre
    const partes = fullname.split(" - ");
    return partes.length > 1 ? partes.slice(0, -1).join(" - ") : fullname;
};

/** Hash simples e ESTÁVEL (mesmo texto → sempre o mesmo número) pra servir de turma_id
 *  "sintético" de um período que só existe no Moodle — nunca colide com turma_id de verdade
 *  do Sponte (sempre positivo); não precisa guardar em lugar nenhum, só recalcular igual toda
 *  vez que for preciso (ver resolverTurmaSintetica no aluno-portal). */
export function periodoSinteticoId(periodo: string): number {
    let h = 0;
    for (let i = 0; i < periodo.length; i++) h = (Math.imul(h, 31) + periodo.charCodeAt(i)) | 0;
    return -(Math.abs(h) % 900000 + 100000);
}

/** Períodos que existem no Moodle mas NÃO em nenhuma matrícula do Sponte — achado ao vivo
 *  01/10, aluno real: reprovou "Hebraico Bíblico I" em 2025.2-P3, refez em 2026.1-P3 e passou
 *  — só que esse "2026.1-P3" NUNCA virou uma matrícula separada no Sponte (não é bug nosso, é
 *  assim que a secretaria registra reposição/adaptação por lá), então o aluno não tinha como
 *  ver a nota da refeita, só a da reprovação antiga. Devolve um "pseudo-período" por período
 *  extra, no MESMO formato de matrícula que o resto da tela já usa — a tela nem precisa saber
 *  que é diferente, só entra no agrupamento por curso normalmente (ver agruparCursos no
 *  front). `turma_id` negativo/estável funciona como id sintético: boletim() reconhece pelo
 *  sinal e não tenta buscar no Sponte.
 */
// "programa" = as 2 primeiras palavras do período ("teologia ead", "pos ead"...) — bom o
// suficiente pra distinguir Graduação de Pós (ou outro curso qualquer) sem precisar de uma
// lista fixa: o aluno pode ter MAIS de um curso, e cada período extra precisa herdar o curso
// certo, não um "curso modelo" único pra tudo (achado ao vivo 01/10: período extra de Pós
// estava sendo colocado junto da Graduação só porque usei o curso vigente como padrão geral).
// tira o "ano.semestre" (2024.1) e o "- P<número>"/"- Modular" do período, sobra só o que
// distingue o PROGRAMA de verdade — ex.: "TEOLOGIA EAD - 2026.1 - P3" → "teologia ead";
// "PÓS EAD - 2024.1 - POSLC/T1" → "pos ead poslc t1". Só as 2 primeiras palavras não bastava:
// "PÓS EAD - 2024.1 - POSLC/T1" e "PÓS EAD - 2024.1 - POSECC/T4" têm as mesmas 2 primeiras
// palavras ("pos ead") mas são PROGRAMAS diferentes (Liderança Cristã × Educação Cristã
// Clássica) — achado ao vivo 01/10, period extra de um ia pro curso do outro.
const programaDoPeriodo = (periodo: string) =>
    norm(periodo).replace(/\b20\d{2}\.\d\b/g, "").replace(/-\s*(?:p\d+|modular)\b/gi, "").replace(/[^a-z0-9]+/g, " ").trim();

export function periodosExtrasDoMoodle(
    courses: { id: number; fullname: string }[],
    matriculasConhecidas: { turma: string | null; curso: string | null; curso_base?: string | null }[],
): { turma_id: number; turma: string; curso: string | null; curso_base: string | null; situacao: null; data_matricula: null; data_inicio: null; data_termino: null; contrato_id: number }[] {
    const conhecidos = new Set(matriculasConhecidas.map((m) => norm(m.turma ?? "")).filter(Boolean));
    // 1º matrícula de cada programa vira o "modelo" de curso pros períodos extras daquele
    // mesmo programa — e a 1ª de TODAS vira o modelo padrão (fallback) se nada bater.
    const porPrograma = new Map<string, { curso: string | null; curso_base: string | null }>();
    for (const m of matriculasConhecidas) {
        if (!m.turma) continue;
        const p = programaDoPeriodo(m.turma);
        if (!porPrograma.has(p)) porPrograma.set(p, { curso: m.curso ?? null, curso_base: m.curso_base ?? m.curso ?? null });
    }
    const padrao = matriculasConhecidas[0] ? { curso: matriculasConhecidas[0].curso ?? null, curso_base: matriculasConhecidas[0].curso_base ?? matriculasConhecidas[0].curso ?? null } : { curso: null, curso_base: null };

    const vistos = new Set<string>();
    const out: ReturnType<typeof periodosExtrasDoMoodle> = [];
    for (const c of courses) {
        const periodo = periodoDoCurso(c.fullname);
        const chave = norm(periodo);
        if (!chave || conhecidos.has(chave) || vistos.has(chave)) continue;
        // só período que "parece" período acadêmico de verdade (tem ano.semestre, tipo
        // "2026.1") — sem isso juntaria curso avulso tipo "SEMINÁRIO VOCACIONAL: ..." que não
        // é período nenhum, é só uma atividade extra sem relação com boletim/matrícula.
        if (!/\b20\d{2}\.\d\b/.test(periodo)) continue;
        vistos.add(chave);
        const alvo = porPrograma.get(programaDoPeriodo(periodo)) ?? padrao;
        const id = periodoSinteticoId(periodo);
        out.push({ turma_id: id, turma: periodo, curso: alvo.curso, curso_base: alvo.curso_base, situacao: null, data_matricula: null, data_inicio: null, data_termino: null, contrato_id: id });
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
