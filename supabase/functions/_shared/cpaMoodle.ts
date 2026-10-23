// Avaliação CPA: disciplinas ativas do aluno e professor, lidos do Moodle.
// O curso do Moodle é uma disciplina de um período: "TEOLOGIA EAD - 2026.2 - P1 - Introdução ao EAD",
// "DIREITO - 2026.2 - P10 - Compliance", "TEOLOGIA PRESENCIAL - 2026.2 - CICLO I - TCC II" e, nas pós,
// "PÓS EAD - POSMU/T3 - 03 CONTEXTUALIZAÇÃO DO EVANGELHO". Professor = papel editingteacher no curso
// (edteacher é tutor/mediador). Nas pós o Moodle não tem professor titular: a equipe preenche no painel.
import { getSecret } from "./secrets.ts";
import { slug } from "./cpa.ts";

export type CursoParte = {
    nivel: "graduacao" | "pos"
    periodo_nome: string
    disciplina_nome: string
    semestre: string | null // "2026.2" (graduação); null na pós
    codigo: string | null // "POSMU/T3" (pós)
}

export function partirCurso(fullname: string): CursoParte | null {
    const t = fullname.trim()
    const pos = t.match(/^(P[ÓO]S EAD - ([A-Z]+\/T\d+)) - (.+)$/i)
    if (pos) {
        return {
            nivel: "pos", periodo_nome: pos[1], codigo: pos[2].toUpperCase(), semestre: null,
            disciplina_nome: pos[3].replace(/^(\d+|XX)\s+/i, "").trim(),
        }
    }
    const grad = t.match(/^(.+? - (\d{4}\.\d) - [^-]+?) - (.+)$/)
    if (grad) return { nivel: "graduacao", periodo_nome: grad[1], semestre: grad[2], codigo: null, disciplina_nome: grad[3].trim() }
    return null
}

// "2026.2" a partir de julho, "2026.1" antes (os cursos do 2º semestre abrem no fim de julho)
export const semestreAtual = (d = new Date()) => `${d.getFullYear()}.${d.getMonth() >= 6 ? 2 : 1}`

export type CursoMoodle = { id: number; fullname: string; startdate?: number; enddate?: number; hidden?: boolean }

// Disciplina ativa: curso visível e não encerrado; graduação = do semestre atual; pós = já aberto
// (startdate no passado). Na pós o aluno só fica inscrito no termo atual do programa, então não precisa
// casar o código do termo com a turma do Sponte (que nem sempre traz esse código).
export function cursoAtivo(c: CursoMoodle, parte: CursoParte, ctx: { semestre: string; agora: number }): boolean {
    if (c.hidden) return false
    if (c.enddate && c.enddate < ctx.agora) return false
    if (parte.nivel === "graduacao") return parte.semestre === ctx.semestre
    return !!c.startdate && c.startdate <= ctx.agora
}

export type DisciplinaAtiva = CursoParte & { moodle_id: number; periodo: string; disciplina: string; contexto: string }

export function disciplinasAtivas(cursos: CursoMoodle[], ctx: { semestre: string; agora?: number }): DisciplinaAtiva[] {
    const agora = ctx.agora ?? Math.floor(Date.now() / 1000)
    const vistos = new Set<string>()
    const out: DisciplinaAtiva[] = []
    for (const c of cursos) {
        const parte = partirCurso(c.fullname)
        if (!parte || !cursoAtivo(c, parte, { ...ctx, agora })) continue
        const periodo = slug(parte.periodo_nome)
        const disciplina = slug(parte.disciplina_nome)
        const contexto = `${periodo}~${disciplina}`
        if (!periodo || !disciplina || vistos.has(contexto)) continue
        vistos.add(contexto)
        out.push({ ...parte, moodle_id: c.id, periodo, disciplina, contexto })
    }
    return out.sort((a, b) => a.periodo_nome.localeCompare(b.periodo_nome) || a.disciplina_nome.localeCompare(b.disciplina_nome))
}

async function moodleCall(fn: string, params: Record<string, string | number> = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const url = (await getSecret("MOODLE_URL")).replace(/\/+$/, "")
    const token = await getSecret("MOODLE_TOKEN")
    if (!url || !token) throw new Error("Moodle não configurado (Gestão > Integrações).")
    const qs = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
    const r = await fetch(`${url}/webservice/rest/server.php?${qs}`, { signal: AbortSignal.timeout(20000) })
    return await r.json()
}

export async function moodleUserIdPorEmail(email: string | null): Promise<number | null> {
    if (!email) return null
    const d = await moodleCall("core_user_get_users_by_field", { field: "email", "values[0]": email.trim().toLowerCase() })
    return Array.isArray(d) && d[0]?.id ? Number(d[0].id) : null
}

export async function cursosDoUsuario(userid: number): Promise<CursoMoodle[]> {
    const d = await moodleCall("core_enrol_get_users_courses", { userid })
    return Array.isArray(d) ? d.map((c) => ({ id: c.id, fullname: String(c.fullname), startdate: c.startdate, enddate: c.enddate, hidden: !!c.hidden })) : []
}

export async function todosOsCursos(): Promise<CursoMoodle[]> {
    const d = await moodleCall("core_course_get_courses")
    return Array.isArray(d) ? d.map((c) => ({ id: c.id, fullname: String(c.fullname), startdate: c.startdate, enddate: c.enddate, hidden: c.visible === 0 })) : []
}

export async function professoresDoCurso(courseId: number): Promise<string[]> {
    const p = await moodleCall("core_enrol_get_enrolled_users", { courseid: courseId })
    return (Array.isArray(p) ? p : [])
        .filter((u) => (u.roles ?? []).some((r: { shortname: string }) => r.shortname === "editingteacher"))
        .map((u) => String(u.fullname))
}
