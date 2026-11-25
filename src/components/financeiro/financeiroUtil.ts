export type Empresa = "faculdade" | "escola"
export type Visao = "consolidado" | Empresa

export const NOME: Record<Empresa, string> = { faculdade: "Faculdade", escola: "Escola" }
export const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
export const brlCurto = (v: number) => {
    const n = Number(v) || 0
    return Math.abs(n) >= 1e6 ? `R$ ${(n / 1e6).toFixed(1).replace(".", ",")} mi` : Math.abs(n) >= 1e3 ? `R$ ${Math.round(n / 1e3)} mil` : brl(n)
}
export const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
export const fmtPct = (v: number) => `${(Number(v) || 0).toFixed(1).replace(".", ",")}%`
export const iso = (d: Date) => d.toISOString().slice(0, 10)
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
export const mesLabel = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
export const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "")

export const PERIODOS = [["ano", "Este ano"], ["mes", "Este mês"], ["passado", "Mês passado"], ["90", "Últimos 90 dias"], ["12", "12 meses"]] as const
export function intervalo(k: string): [string, string] {
    const h = new Date(), y = h.getFullYear(), m = h.getMonth()
    if (k === "mes") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    if (k === "passado") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    if (k === "90") return [iso(new Date(h.getTime() - 90 * 864e5)), iso(h)]
    if (k === "12") return [iso(new Date(y, m - 11, 1)), iso(new Date(y, m + 1, 0))]
    return [`${y}-01-01`, `${y}-12-31`]
}

export interface Kpi {
    empresa: Empresa; recebido: number; recebido_qtd: number; previsto: number; previsto_qtd: number
    vencido: number; vencido_qtd: number; vencido_base: number; a_vencer: number; a_vencer_qtd: number
    alunos_vigentes: number; matriculas_periodo: number; com_bolsa: number; desconto_medio: number
}
export interface Linha { empresa: Empresa; valor: number; qtd: number; forma?: string; categoria?: string; conta?: string }
export interface Dados {
    kpis: Kpi[]
    mensal: { empresa: Empresa; mes: string; previsto: number; recebido: number; vencido: number }[]
    formas: Linha[]; categorias: Linha[]; contas: Linha[]
    sincronizado_em: Record<Empresa, string | null>
}
export interface Detalhe {
    dre: { empresa: Empresa; mes: string; grupo: string; face: number; desconto: number; atraso: number; recebido: number; qtd: number }[]
    dia_conta: { empresa: Empresa; dia: string; conta: string; qtd: number; valor: number }[]
    verificacoes: { empresa: Empresa; pagas_abaixo: number; pagas_abaixo_valor: number; pago_zero: number; sem_conta: number; pendente_antigo: number; pendente_antigo_valor: number; pagas_acima: number; pendente_com_data: number }[]
    semanas: { empresa: Empresa; semana: string; liquido: number; face: number; qtd: number }[]
    realizacao: { empresa: Empresa; q_face: number; q_pago: number; h_pagas: number; h_total: number; h_pago: number }[]
    recebimentos: { empresa: Empresa; data: string; sacado: string | null; categoria: string | null; forma: string | null; conta: string | null; face: number; pago: number; desconto: number }[]
    faixas: { empresa: Empresa; faixa: string; face: number; liquido: number; qtd: number }[]
    devedores: { empresa: Empresa; sacado: string; face: number; qtd: number; atraso: number }[]
    categorias: { empresa: Empresa; categoria: string; face: number; pago: number; qtd: number }[]
}

export const soma = (ks: Kpi[], c: keyof Kpi) => ks.reduce((s, k) => s + (Number(k[c]) || 0), 0)

export function baixarCsv(nome: string, linhas: (string | number | null)[][]) {
    const esc = (c: string | number | null) => `"${String(c ?? "").replace(/"/g, '""')}"`
    const blob = new Blob(["﻿" + linhas.map((l) => l.map(esc).join(";")).join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob); a.download = nome; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
