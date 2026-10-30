import { Fragment, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, ChevronDown, ChevronRight, Download, Loader2, MessageCircle, RefreshCw, Search } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { supabase } from "@/lib/supabase"
import { withTimeout } from "@/utils/withTimeout"

type Detalhe = { vencimento: string; valor: number; categoria: string | null; atraso: number; atual?: number }
type AlunoInad = {
    aluno_id: number; nome: string | null; turma: string | null; curso: string | null; situacao: string | null; vigente: boolean | null
    celular: string | null; parcelas: number; valor: number; principal?: number; atraso_max: number
    f30: number | null; f60: number | null; f90: number | null; f90p: number | null; detalhe: Detalhe[]
}
type LinhaMes = { dia: string; curso: string; vigente: boolean; parcelas: number; valor: number; parcelas_abertas: number; valor_aberto: number; alunos: number; alunos_abertos: number }
type Relatorio = { alunos: AlunoInad[]; turmas: { turma: string | null; alunos: number; pre: number }[]; sincronizado_em: string | null; inpc?: { mes: string; v: number }[] }

const SEM_TURMA = "Sem turma"
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const dataBr = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR")
const FAIXAS = [["f30", "1 a 30 dias"], ["f60", "31 a 60 dias"], ["f90", "61 a 90 dias"], ["f90p", "Mais de 90 dias"]] as const
// Cláusula 9ª do contrato: principal corrigido pelo INPC desde o mês seguinte ao vencimento, multa de 2% e juros de 0,033% ao dia
const MULTA = 0.02
const JUROS_DIA = 0.00033
function valorAtualizado(valor: number, vencimento: string, atraso: number, inpc: { mes: string; v: number }[]) {
    const mesVenc = vencimento.slice(0, 7)
    const fator = inpc.filter((i) => i.mes > mesVenc).reduce((f, i) => f * (1 + i.v / 100), 1)
    const corrigido = valor * fator
    return corrigido * (1 + MULTA + JUROS_DIA * atraso)
}
const MARCA = "#5551FF"
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
type Preset = "mes" | "mes_passado" | "semestre" | "ano" | "90d" | "tudo" | "custom"
const PRESETS: [Preset, string][] = [["mes", "Este mês"], ["mes_passado", "Mês passado"], ["semestre", "Este semestre"], ["ano", "Este ano"], ["90d", "Últimos 90 dias"], ["tudo", "Todo o período"], ["custom", "Personalizado"]]
function faixaDoPreset(p: Preset): { de: string; ate: string } {
    const h = new Date()
    const ano = h.getFullYear(), mes = h.getMonth()
    switch (p) {
        case "mes": return { de: iso(new Date(ano, mes, 1)), ate: iso(h) }
        case "mes_passado": return { de: iso(new Date(ano, mes - 1, 1)), ate: iso(new Date(ano, mes, 0)) }
        case "semestre": return { de: iso(new Date(ano, mes < 6 ? 0 : 6, 1)), ate: iso(h) }
        case "ano": return { de: iso(new Date(ano, 0, 1)), ate: iso(h) }
        case "90d": return { de: iso(new Date(h.getTime() - 90 * 86400000)), ate: iso(h) }
        default: return { de: "", ate: "" }
    }
}
const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")}%`

function whatsapp(cel: string | null) {
    const d = (cel ?? "").replace(/\D/g, "")
    if (d.length < 10) return null
    return `https://wa.me/${d.startsWith("55") ? d : "55" + d}`
}

export function InadimplenciaDashboard() {
    const [todos, setTodos] = useState(false)
    const [turma, setTurma] = useState("")
    const [busca, setBusca] = useState("")
    const [aberto, setAberto] = useState<number | null>(null)
    const [atualizados, setAtualizados] = useState(true)
    const [preset, setPreset] = useState<Preset>("ano")
    const [custom, setCustom] = useState({ de: "", ate: "" })
    const { de, ate } = preset === "custom" ? custom : faixaDoPreset(preset)
    const dentro = (dia: string) => (!de || dia >= de) && (!ate || dia <= ate)
    const [ordemTurma, setOrdemTurma] = useState<"valor" | "pct" | "alunos">("valor")

    const { data, isLoading, isFetching, error, refetch } = useQuery({
        queryKey: ["inadimplencia"],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.rpc("inadimplencia_report"), 30000, "A consulta de inadimplência")
            if (error) throw new Error(error.message)
            return data as Relatorio
        },
    })

    const { data: mensal } = useQuery({
        queryKey: ["inadimplencia-mensal"],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.rpc("inadimplencia_mensal"), 30000, "A série mensal")
            if (error) throw new Error(error.message)
            return data as LinhaMes[]
        },
    })
    const [cursoSerie, setCursoSerie] = useState("")
    const cursosSerie = useMemo(() => [...new Set((mensal ?? []).filter((l) => todos || l.vigente).map((l) => l.curso))].sort(), [mensal, todos])
    const porDia = !!de && !!ate && (new Date(ate).getTime() - new Date(de).getTime()) / 86400000 <= 62
    const serie = useMemo(() => {
        const m = new Map<string, { chave: string; nome: string; valor: number; aberto: number; alunos: number; alunosAb: number }>()
        for (const l of mensal ?? []) {
            if (!todos && !l.vigente) continue
            if (cursoSerie && l.curso !== cursoSerie) continue
            if (!dentro(l.dia)) continue
            const chave = porDia ? l.dia : l.dia.slice(0, 7)
            const x = m.get(chave) ?? { chave, nome: porDia ? l.dia.slice(8) + "/" + l.dia.slice(5, 7) : rotuloMes(chave), valor: 0, aberto: 0, alunos: 0, alunosAb: 0 }
            x.valor += l.valor; x.aberto += l.valor_aberto; x.alunos += l.alunos; x.alunosAb += l.alunos_abertos
            m.set(chave, x)
        }
        return [...m.values()].sort((a, b) => a.chave.localeCompare(b.chave)).map((x) => ({ ...x, indice: x.valor ? (x.aberto / x.valor) * 100 : 0, indiceAlunos: x.alunos ? (x.alunosAb / x.alunos) * 100 : 0 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mensal, todos, cursoSerie, de, ate, porDia])

    const base = useMemo(() => (data?.alunos ?? []).filter((a) => todos || a.vigente).flatMap((a) => {
        const bruto = a.detalhe.filter((d) => dentro(d.vencimento))
        if (!bruto.length) return []
        const inpc = data?.inpc ?? []
        const det = bruto.map((d) => ({ ...d, atual: atualizados ? valorAtualizado(d.valor, d.vencimento, d.atraso, inpc) : d.valor }))
        const soma = (f: (d: Detalhe) => boolean) => det.filter(f).reduce((t, d) => t + (d.atual ?? d.valor), 0)
        return [{ ...a, detalhe: det, parcelas: det.length, valor: soma(() => true), principal: det.reduce((t, d) => t + d.valor, 0), atraso_max: Math.max(...bruto.map((d) => d.atraso)),
            f30: soma((d) => d.atraso <= 30), f60: soma((d) => d.atraso > 30 && d.atraso <= 60), f90: soma((d) => d.atraso > 60 && d.atraso <= 90), f90p: soma((d) => d.atraso > 90) }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [data, todos, de, ate, atualizados])
    const vigentesPorTurma = useMemo(() => new Map((data?.turmas ?? []).map((t) => [t.turma ?? SEM_TURMA, t.alunos])), [data])
    const preDaTurma = useMemo(() => new Map((data?.turmas ?? []).map((t) => [t.turma ?? SEM_TURMA, t.pre])), [data])
    const totalVigentes = useMemo(() => [...vigentesPorTurma.values()].reduce((s, n) => s + n, 0), [vigentesPorTurma])

    const porTurma = useMemo(() => {
        const m = new Map<string, { turma: string; inad: number; valor: number; atraso: number }>()
        for (const a of base) {
            const k = a.turma ?? SEM_TURMA
            const x = m.get(k) ?? { turma: k, inad: 0, valor: 0, atraso: 0 }
            x.inad++; x.valor += a.valor; x.atraso = Math.max(x.atraso, a.atraso_max)
            m.set(k, x)
        }
        const l = [...m.values()].map((x) => {
            const alunos = (vigentesPorTurma.get(x.turma) ?? 0) + (preDaTurma.get(x.turma) ?? 0)
            return { ...x, alunos, pct: alunos ? Math.min(100, (x.inad / alunos) * 100) : null }
        })
        return l.sort((a, b) => ordemTurma === "pct" ? (b.pct ?? -1) - (a.pct ?? -1) : ordemTurma === "alunos" ? b.inad - a.inad : b.valor - a.valor)
    }, [base, vigentesPorTurma, preDaTurma, ordemTurma])

    const lista = useMemo(() => {
        const q = busca.trim().toLowerCase()
        return base
            .filter((a) => !turma || (a.turma ?? SEM_TURMA) === turma)
            .filter((a) => !q || (a.nome ?? "").toLowerCase().includes(q) || String(a.aluno_id) === q)
            .sort((a, b) => b.valor - a.valor)
    }, [base, turma, busca])

    const totalValor = base.reduce((s, a) => s + a.valor, 0)
    const totalPrincipal = base.reduce((s, a) => s + (a.principal ?? a.valor), 0)
    const faixas = FAIXAS.map(([k, nome]) => ({ nome, valor: base.reduce((s, a) => s + (a[k] ?? 0), 0) }))
    const maiorFaixa = Math.max(...faixas.map((f) => f.valor), 1)
    const vencido = (mensal ?? []).filter((l) => (todos || l.vigente) && dentro(l.dia)).reduce((t, l) => t + l.valor, 0)
    const pctValor = vencido ? (totalPrincipal / vencido) * 100 : null
    const vigInad = base.filter((a) => a.vigente).length
    const pctGeral = totalVigentes ? (vigInad / totalVigentes) * 100 : 0
    const noRecorte = lista.reduce((s, a) => s + a.valor, 0)

    function exportar() {
        const cab = ["Aluno", "AlunoID", "Turma", "Curso", "Situação", "Celular", "Parcelas em atraso", "Principal", atualizados ? "Valor atualizado" : "Valor", "Maior atraso (dias)", "Venc. mais antigo"]
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
        const linhas = lista.map((a) => [a.nome, a.aluno_id, a.turma, a.curso, a.situacao, a.celular, a.parcelas, (a.principal ?? a.valor).toFixed(2).replace(".", ","), a.valor.toFixed(2).replace(".", ","), a.atraso_max, a.detalhe[0] ? dataBr(a.detalhe[0].vencimento) : ""].map(esc).join(";"))
        const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...linhas].join("\n")], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const l = document.createElement("a"); l.href = url; l.download = `inadimplencia-${new Date().toISOString().slice(0, 10)}.csv`; l.click()
        URL.revokeObjectURL(url)
    }

    if (isLoading) return <div className="flex items-center gap-2 p-8 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Consultando parcelas em aberto…</div>
    if (error) return <div className="glass-card flex items-center gap-2 p-6 text-sm"><AlertCircle className="h-4 w-4 text-red-500" /> {(error as Error).message}</div>

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Inadimplência</h1>
                    <p className="text-xs text-[var(--text-muted)]">
                        Parcelas pendentes já vencidas (Sponte){data?.sincronizado_em ? ` · atualizado em ${new Date(data.sincronizado_em).toLocaleString("pt-BR")}` : ""}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-main)]" title="Principal corrigido pelo INPC + multa de 2% + juros de 0,033% ao dia (cláusula 9ª)">
                        <input type="checkbox" checked={atualizados} onChange={(e) => setAtualizados(e.target.checked)} /> Valores atualizados (INPC + multa + juros)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-main)]">
                        <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Incluir alunos sem matrícula Vigente
                    </label>
                    <button type="button" onClick={() => refetch()} className="rounded-full border border-[var(--border)] p-2 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]" aria-label="Atualizar">
                        <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">Vencimento:</span>
                {PRESETS.map(([k, nome]) => (
                    <button key={k} type="button" onClick={() => { if (k === "custom" && !custom.de && !custom.ate) setCustom(faixaDoPreset("ano")); setPreset(k) }}
                        className={`rounded-full px-3 py-1.5 text-sm ${preset === k ? "bg-primary text-white" : "bg-[var(--bg-card)] text-[var(--text-main)] ring-1 ring-[var(--border)] hover:bg-[var(--bg-card-hover)]"}`}>{nome}</button>
                ))}
                {preset === "custom" && (
                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-main)]">
                        <input type="date" value={custom.de} max={custom.ate || undefined} onChange={(e) => setCustom((c) => ({ ...c, de: e.target.value }))} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1" aria-label="De" />
                        até
                        <input type="date" value={custom.ate} min={custom.de || undefined} onChange={(e) => setCustom((c) => ({ ...c, ate: e.target.value }))} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1" aria-label="Até" />
                    </span>
                )}
                {(de || ate) && <span className="text-xs text-[var(--text-muted)]">{de ? dataBr(de) : "início"} → {ate ? dataBr(ate) : "hoje"}</span>}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <div className="glass-card p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Valor em atraso</p>
                    <p className="mt-2 text-4xl font-bold text-[var(--text-main)]">{brl(totalValor)}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {atualizados && <>principal {brl(totalPrincipal)} + encargos {brl(totalValor - totalPrincipal)} · </>}
                        {pctValor !== null && <><b className="text-[var(--text-main)]">{pct1(pctValor)}</b> de {brl(vencido)} vencidos no período · </>}
                        {base.reduce((s, a) => s + a.parcelas, 0).toLocaleString("pt-BR")} parcelas
                    </p>
                </div>
                <div className="glass-card p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Alunos inadimplentes</p>
                    <p className="mt-2 text-4xl font-bold text-[var(--text-main)]">{base.length.toLocaleString("pt-BR")}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{pctGeral.toFixed(1).replace(".", ",")}% dos {totalVigentes.toLocaleString("pt-BR")} alunos Vigentes ({vigInad} Vigentes inadimplentes)</p>
                </div>
                <div className="glass-card p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Há mais de 90 dias</p>
                    <p className="mt-2 text-4xl font-bold text-[var(--text-main)]">{brl(faixas[3].valor)}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{totalValor ? Math.round((faixas[3].valor / totalValor) * 100) : 0}% do valor em atraso</p>
                </div>
            </div>

            <div className="glass-card space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Evolução mês a mês</p>
                        <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
                            Índice (sobre o principal, sem multa e juros) = valor ainda pendente ÷ valor das parcelas que venceram no mês (canceladas fora). Mostra a situação de hoje de cada mês, não a de quando venceu. O mês atual conta só até hoje. Dados a partir de jan/2026. Segue o período escolhido no topo.
                        </p>
                    </div>
                    <select value={cursoSerie} onChange={(e) => setCursoSerie(e.target.value)} className="max-w-[280px] rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-main)]" aria-label="Curso">
                        <option value="">Todos os cursos</option>
                        {cursosSerie.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                {serie.length === 0 ? <p className="py-6 text-center text-sm text-[var(--text-muted)]">Sem parcelas neste recorte.</p> : (
                    <div className="grid gap-6 lg:grid-cols-2">
                        <div>
                            <p className="mb-2 text-sm font-medium text-[var(--text-main)]">Índice de inadimplência (% do valor)</p>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid stroke="rgba(100,116,139,0.18)" vertical={false} />
                                        <XAxis dataKey="nome" tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} />
                                        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
                                        <Tooltip content={({ active, payload }) => {
                                            const x = active && payload?.[0]?.payload
                                            if (!x) return null
                                            return (
                                                <div className="rounded-xl bg-[var(--bg-card)] px-3 py-2 text-xs shadow-lg ring-1 ring-black/5">
                                                    <p className="mb-1 font-medium text-[var(--text-muted)]">{x.nome}</p>
                                                    <p className="text-sm font-semibold text-[var(--text-main)]">{pct1(x.indice)} do valor</p>
                                                    <p className="text-[var(--text-muted)]">{brl(x.aberto)} de {brl(x.valor)}</p>
                                                    <p className="text-[var(--text-muted)]">{pct1(x.indiceAlunos)} dos alunos ({x.alunosAb} de {x.alunos})</p>
                                                </div>
                                            )
                                        }} />
                                        <Line type="monotone" dataKey="indice" stroke={MARCA} strokeWidth={2} dot={{ r: 4, fill: MARCA, stroke: "var(--bg-card)", strokeWidth: 2 }} isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                        <div>
                            <p className="mb-2 text-sm font-medium text-[var(--text-main)]">Valor ainda em aberto (R$)</p>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid stroke="rgba(100,116,139,0.18)" vertical={false} />
                                        <XAxis dataKey="nome" tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} />
                                        <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(v))} tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
                                        <Tooltip cursor={{ fill: "rgba(100,116,139,0.10)" }} content={({ active, payload }) => {
                                            const x = active && payload?.[0]?.payload
                                            if (!x) return null
                                            return (
                                                <div className="rounded-xl bg-[var(--bg-card)] px-3 py-2 text-xs shadow-lg ring-1 ring-black/5">
                                                    <p className="mb-1 font-medium text-[var(--text-muted)]">{x.nome}</p>
                                                    <p className="text-sm font-semibold text-[var(--text-main)]">{brl(x.aberto)} em aberto</p>
                                                    <p className="text-[var(--text-muted)]">{x.alunosAb} alunos · {pct1(x.indice)} de {brl(x.valor)}</p>
                                                </div>
                                            )
                                        }} />
                                        <Bar dataKey="aberto" fill={MARCA} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="glass-card space-y-3 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Por tempo de atraso</p>
                {faixas.map((f) => (
                    <div key={f.nome} className="grid grid-cols-[120px_1fr_120px] items-center gap-3 text-sm">
                        <span className="text-[var(--text-main)]">{f.nome}</span>
                        <div className="h-5 rounded bg-[var(--bg-card-hover)]"><div className="h-full rounded" style={{ width: `${(f.valor / maiorFaixa) * 100}%`, background: MARCA }} /></div>
                        <span className="text-right font-semibold tabular-nums text-[var(--text-main)]">{brl(f.valor)}</span>
                    </div>
                ))}
            </div>

            <div className="glass-card p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Por turma (clique para ver os alunos)</p>
                    <div className="flex gap-1.5 text-xs">
                        {([["valor", "Maior valor"], ["pct", "Maior %"], ["alunos", "Mais alunos"]] as const).map(([k, n]) => (
                            <button key={k} type="button" onClick={() => setOrdemTurma(k)} className={`rounded-full px-3 py-1 ${ordemTurma === k ? "bg-primary text-white" : "bg-[var(--bg-card-hover)] text-[var(--text-main)]"}`}>{n}</button>
                        ))}
                    </div>
                </div>
                <div className="max-h-[420px] overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[var(--bg-card)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                            <tr><th className="py-2">Turma</th><th className="text-right">Alunos</th><th className="text-right">Inadimplentes</th><th className="w-40 pl-4">% da turma</th><th className="text-right">Valor</th><th className="text-right">Maior atraso</th></tr>
                        </thead>
                        <tbody>
                            {porTurma.map((t) => (
                                <tr key={t.turma} onClick={() => setTurma(turma === t.turma ? "" : t.turma)} className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-card-hover)] ${turma === t.turma ? "bg-primary/10" : ""}`}>
                                    <td className="py-2 pr-2 text-[var(--text-main)]">{t.turma}</td>
                                    <td className="text-right tabular-nums">{t.alunos || "–"}</td>
                                    <td className="text-right font-semibold tabular-nums">{t.inad}</td>
                                    <td className="pl-4">
                                        {t.pct === null ? "–" : (
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 flex-1 rounded bg-[var(--bg-card-hover)]"><div className="h-full rounded" style={{ width: `${t.pct}%`, background: MARCA }} /></div>
                                                <span className="w-10 text-right text-xs tabular-nums">{Math.round(t.pct)}%</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="text-right font-semibold tabular-nums">{brl(t.valor)}</td>
                                    <td className="text-right tabular-nums text-[var(--text-muted)]">{t.atraso} d</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="glass-card p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        Alunos{turma ? ` · ${turma}` : ""} · {lista.length} · {brl(noRecorte)}
                    </p>
                    {turma && <button type="button" onClick={() => setTurma("")} className="rounded-full bg-[var(--bg-card-hover)] px-3 py-1 text-xs">Limpar turma ✕</button>}
                    <div className="ml-auto flex items-center gap-2">
                        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno" className="rounded-full border border-[var(--border)] bg-transparent py-2 pl-8 pr-3 text-sm outline-none" /></div>
                        <button type="button" onClick={exportar} className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card-hover)]"><Download className="h-4 w-4" /> CSV</button>
                    </div>
                </div>
                <div className="max-h-[560px] overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[var(--bg-card)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                            <tr><th className="w-6" /><th className="py-2">Aluno</th><th>Turma</th><th className="text-right">Parcelas</th><th className="text-right">Valor</th><th className="text-right">Atraso</th><th className="w-10" /></tr>
                        </thead>
                        <tbody>
                            {lista.slice(0, 400).map((a) => {
                                const wa = whatsapp(a.celular)
                                const abre = aberto === a.aluno_id
                                return (
                                    <Fragment key={a.aluno_id}>
                                        <tr onClick={() => setAberto(abre ? null : a.aluno_id)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-card-hover)]">
                                            <td>{abre ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                                            <td className="py-2 pr-2"><span className="text-[var(--text-main)]">{a.nome ?? `Aluno ${a.aluno_id}`}</span>{!a.vigente && <span className="ml-2 text-[11px] text-[var(--text-muted)]">{a.situacao ?? "sem matrícula"}</span>}</td>
                                            <td className="max-w-[260px] truncate text-[var(--text-muted)]">{a.turma ?? SEM_TURMA}</td>
                                            <td className="text-right tabular-nums">{a.parcelas}</td>
                                            <td className="text-right font-semibold tabular-nums">{brl(a.valor)}</td>
                                            <td className="text-right tabular-nums text-[var(--text-muted)]">{a.atraso_max} d</td>
                                            <td className="text-right">{wa && <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Chamar no WhatsApp" className="inline-block p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"><MessageCircle className="h-4 w-4" /></a>}</td>
                                        </tr>
                                        {abre && (
                                            <tr className="bg-[var(--bg-card-hover)]"><td /><td colSpan={6} className="py-2">
                                                <p className="mb-1 text-xs text-[var(--text-muted)]">{a.curso ?? ""}{a.celular ? ` · ${a.celular}` : ""} · ID Sponte {a.aluno_id}</p>
                                                <ul className="grid gap-x-6 gap-y-0.5 text-xs md:grid-cols-2">
                                                    {a.detalhe.map((d, i) => (
                                                        <li key={i} className="flex justify-between gap-3"><span>{dataBr(d.vencimento)} · {d.categoria ?? "Parcela"}</span><span className="tabular-nums">{brl(d.valor)}{atualizados && d.atual !== undefined && d.atual !== d.valor ? ` → ${brl(d.atual)}` : ""} · {d.atraso} d</span></li>
                                                    ))}
                                                </ul>
                                            </td></tr>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                    {lista.length > 400 && <p className="py-2 text-center text-xs text-[var(--text-muted)]">Mostrando os 400 maiores valores. Use a busca, a turma ou o CSV para ver o resto.</p>}
                    {lista.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nenhum aluno inadimplente neste recorte.</p>}
                </div>
            </div>
        </div>
    )
}
