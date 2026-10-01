// Cruzamento entre um contato de atendimento (messages_logs.contact, formato
// "Nome (telefone)") e uma matrícula real do Sponte — usado tanto pro relatório
// de matrículas por agente (SponteDashboard) quanto pra corrigir a nota Comercial
// da análise de IA quando o lead realmente fechou (csvProcessor).

export function normalizeName(s: string): string {
    return (s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

export function extractContactPhone(contact: string): string | null {
    const m = contact.match(/\((\d{8,15})\)/)
    if (!m) return null
    const digits = m[1].replace(/[^0-9]/g, '')
    return digits.length >= 8 ? digits.slice(-11) : null
}

export function normalizeStudentPhone(celular: string | null | undefined): string | null {
    if (!celular) return null
    const digits = celular.replace(/[^0-9]/g, '')
    return digits.length >= 8 ? digits.slice(-11) : null
}

export function daysDiff(from: string, to: string): number {
    return Math.floor((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000)
}

export interface SponteMatriculaLite {
    aluno: string
    celular: string | null
    data_matricula: string // YYYY-MM-DD
    nome_curso: string
    situacao_id: number
}

/**
 * Lead fechou matrícula de verdade depois (ou no mesmo dia d)e um atendimento?
 * Mesma regra do SponteDashboard (computeMatriculasPorAgente): telefone exato tem
 * prioridade, nome normalizado como fallback; matrícula tem que ser no mesmo dia
 * do atendimento ou depois, dentro da janela (padrão 30 dias) — matrícula ANTES
 * do atendimento não conta (não foi esse atendimento que fechou).
 */
export function findMatriculaMatch(
    contact: string,
    protocolDate: string, // YYYY-MM-DD
    matriculas: SponteMatriculaLite[],
    windowDays = 30,
): SponteMatriculaLite | null {
    const contactPhone = extractContactPhone(contact)
    const normContact = normalizeName(contact.replace(/\s*\([^)]*\)\s*$/, ''))

    const inWindow = (sm: SponteMatriculaLite) =>
        sm.data_matricula >= protocolDate && daysDiff(protocolDate, sm.data_matricula) <= windowDays

    if (contactPhone) {
        const byPhone = matriculas.find((sm) => normalizeStudentPhone(sm.celular) === contactPhone && inWindow(sm))
        if (byPhone) return byPhone
    }
    return matriculas.find((sm) => normalizeName(sm.aluno) === normContact && inWindow(sm)) ?? null
}
