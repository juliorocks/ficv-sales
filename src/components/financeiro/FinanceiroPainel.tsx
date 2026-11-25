// Painel Financeiro do Sistema Pai: Faculdade e Escola lado a lado, ou consolidado (soma feita aqui).
// Dados hoje vêm do espelho do Sponte (RPC financeiro_painel); depois passam para o banco próprio.
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Building2, GraduationCap, Layers, Loader2, RefreshCw, School } from "lucide-react"
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { supabase } from "@/lib/supabase"
import { withTimeout } from "@/utils/withTimeout"

type Empresa = "faculdade" | "escola"
type Visao = "consolidado" | Empresa
interface Kpi {
    empresa: Empresa; recebido: number; recebido_qtd: number; previsto: number; previsto_qtd: number
    vencido: number; vencido_qtd: number; vencido_base: number; a_vencer: number; a_vencer_qtd: number
    alunos_vigentes: number; matriculas_periodo: number; com_bolsa: number; desconto_medio: number
}
interface Linha { empresa: Empresa; valor: number; qtd: number; forma?: string; categoria?: string; conta?: string }
interface Dados {
    kpis: Kpi[]
    mensal: { empresa: Empresa; mes: string; previsto: number; recebido: number; vencido: number }[]
    formas: Linha[]; categorias: Linha[]; contas: Linha[]
    sincronizado_em: Record<Empresa, string | null>
}

const NOME: Record<Empresa, string> = { faculdade: "Faculdade", escola: "Escola" }
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const brlCurto = (v: number) => (Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toFixed(1).replace(".", ",")} mi` : Math.abs(v) >= 1e3 ? `R$ ${Math.round(v / 1e3)} mil` : brl(v))
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
const fmtPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`
const iso = (d: Date) => d.toISOString().slice(0, 10)
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
const mesLabel = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`

const PERIODOS = [
    ["ano", "Este ano"], ["mes", "Este mês"], ["passado", "Mês passado"], ["90", "Últimos 90 dias"], ["12", "12 meses"],
] as const
function intervalo(k: string): [string, string] {
    const h = new Date(), y = h.getFullYear(), m = h.getMonth()
    if (k === "mes") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    if (k === "passado") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    if (k === "90") return [iso(new Date(h.getTime() - 90 * 864e5)), iso(h)]
    if (k === "12") return [iso(new Date(y, m - 11, 1)), iso(new Date(y, m + 1, 0))]
    return [`${y}-01-01`, `${y}-12-31`]
}

const soma = (ks: Kpi[], c: keyof Kpi) => ks.reduce((s, k) => s + (Number(k[c]) || 0), 0)

export function FinanceiroPainel() {
    const [visao, setVisao] = useState<Visao>("consolidado")
    const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number][0]>("ano")
    const [de, ate] = intervalo(periodo)

    const { data, isLoading, isFetching, error, refetch } = useQuery({
        queryKey: ["financeiro_painel", de, ate],
        queryFn: async () => {
            await supabase.auth.getSession()
            const { data, error } = await withTimeout(supabase.rpc("financeiro_painel", { p_inicio: de, p_fim: ate }), 30000, "O painel financeiro")
            if (error) throw error
            return data as Dados
        },
        staleTime: 60_000,
        placeholderData: (p) => p,
    })

    const empresas: Empresa[] = visao === "consolidado" ? ["faculdade", "escola"] : [visao]
    const v = useMemo(() => {
        if (!data) return null
        const ks = data.kpis.filter((k) => empresas.includes(k.empresa))
        const filtra = <T extends { empresa: Empresa }>(a: T[]) => a.filter((x) => empresas.includes(x.empresa))
        const agrupa = (a: Linha[], chave: "forma" | "categoria" | "conta") => {
            const m = new Map<string, { nome: string; valor: number; qtd: number }>()
            for (const l of filtra(a)) {
                const n = String(l[chave]); const o = m.get(n) ?? { nome: n, valor: 0, qtd: 0 }
                o.valor += Number(l.valor); o.qtd += Number(l.qtd); m.set(n, o)
            }
            return [...m.values()].sort((a, b) => b.valor - a.valor)
        }
        const meses = new Map<string, { mes: string; previsto: number; recebido: number; vencido: number }>()
        for (const l of filtra(data.mensal)) {
            const o = meses.get(l.mes) ?? { mes: l.mes, previsto: 0, recebido: 0, vencido: 0 }
            o.previsto += Number(l.previsto); o.recebido += Number(l.recebido); o.vencido += Number(l.vencido); meses.set(l.mes, o)
        }
        return {
            ks,
            recebido: soma(ks, "recebido"), recebido_qtd: soma(ks, "recebido_qtd"),
            previsto: soma(ks, "previsto"), vencido: soma(ks, "vencido"), vencido_qtd: soma(ks, "vencido_qtd"), vencido_base: soma(ks, "vencido_base"),
            a_vencer: soma(ks, "a_vencer"), a_vencer_qtd: soma(ks, "a_vencer_qtd"),
            alunos: soma(ks, "alunos_vigentes"), matriculas: soma(ks, "matriculas_periodo"),
            serie: [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map((m) => ({ ...m, nome: mesLabel(m.mes) })),
            formas: agrupa(data.formas, "forma"), categorias: agrupa(data.categorias, "categoria").slice(0, 8), contas: agrupa(data.contas, "conta"),
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, visao])

    if (error) return <div className="glass-card flex items-center gap-2 p-6 text-sm"><AlertCircle className="h-4 w-4 text-red-500" /> {(error as Error).message}</div>
    if (isLoading || !v || !data) return <div className="glass-card flex items-center gap-2 p-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Carregando o financeiro…</div>

    const inad = pct(v.vencido, v.vencido_base)
    const cartoes: { titulo: string; valor: string; sub: string; alerta?: boolean }[] = [
        { titulo: "Recebido no período", valor: brl(v.recebido), sub: `${v.recebido_qtd.toLocaleString("pt-BR")} parcelas pagas` },
        { titulo: "Previsto (vencimentos)", valor: brl(v.previsto), sub: `${fmtPct(pct(v.recebido, v.previsto))} já recebido, valor de face` },
        { titulo: "Em atraso", valor: brl(v.vencido), sub: `${v.vencido_qtd.toLocaleString("pt-BR")} parcelas · ${fmtPct(inad)} do vencido`, alerta: true },
        { titulo: "A vencer", valor: brl(v.a_vencer), sub: `${v.a_vencer_qtd.toLocaleString("pt-BR")} parcelas pendentes` },
        { titulo: "Alunos vigentes", valor: v.alunos.toLocaleString("pt-BR"), sub: "matrícula Vigente hoje" },
        { titulo: "Matrículas no período", valor: v.matriculas.toLocaleString("pt-BR"), sub: "contratos com data no período" },
    ]
    const ultima = empresas.map((e) => data.sincronizado_em[e]).filter(Boolean).sort().pop()

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Sistema Gerencial</p>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Financeiro</h1>
                    <p className="text-sm text-[var(--text-muted)]">Receita, atraso e matrículas por empresa ou consolidado. Dados do Sponte por enquanto.</p>
                </div>
                <button type="button" onClick={() => refetch()} aria-label="Atualizar"
                    className="rounded-full border border-[var(--border)] p-2 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]">
                    {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <div role="tablist" aria-label="Empresa" className="inline-flex rounded-full bg-[var(--bg-card)] p-1 ring-1 ring-[var(--border)]">
                    {([["consolidado", "Consolidado", Layers], ["faculdade", "Faculdade", GraduationCap], ["escola", "Escola", School]] as const).map(([k, nome, Icone]) => (
                        <button key={k} type="button" role="tab" aria-selected={visao === k} onClick={() => setVisao(k)}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium ${visao === k ? "bg-primary text-white" : "text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]"}`}>
                            <Icone className="h-4 w-4" /> {nome}
                        </button>
                    ))}
                    <button type="button" disabled title="Sem dados ainda: entra com contas a pagar e repasses"
                        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm text-[var(--text-muted)] opacity-60">
                        <Building2 className="h-4 w-4" /> Fundação <span className="text-[10px] uppercase">em breve</span>
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {PERIODOS.map(([k, nome]) => (
                        <button key={k} type="button" onClick={() => setPeriodo(k)}
                            className={`rounded-full px-3 py-1.5 text-sm ${periodo === k ? "bg-primary text-white" : "bg-[var(--bg-card)] text-[var(--text-main)] ring-1 ring-[var(--border)] hover:bg-[var(--bg-card-hover)]"}`}>{nome}</button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                {cartoes.map((c) => (
                    <div key={c.titulo} className="glass-card p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{c.titulo}</p>
                        <p className={`mt-1 text-xl font-bold tabular-nums ${c.alerta ? "text-red-500" : "text-[var(--text-main)]"}`}>{c.valor}</p>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{c.sub}</p>
                    </div>
                ))}
            </div>

            {visao === "consolidado" && (
                <div className="glass-card overflow-x-auto p-5">
                    <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">Comparativo por empresa</h2>
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                                <th className="py-2 pr-3">Empresa</th><th className="px-3 text-right">Recebido</th><th className="px-3 text-right">Previsto</th>
                                <th className="px-3 text-right">Em atraso</th><th className="px-3 text-right">% atraso</th><th className="px-3 text-right">Alunos vigentes</th>
                                <th className="pl-3 text-right">Participação na receita</th>
                            </tr>
                        </thead>
                        <tbody className="tabular-nums">
                            {v.ks.map((k) => (
                                <tr key={k.empresa} className="border-b border-[var(--border)]/60">
                                    <td className="py-2.5 pr-3 font-medium text-[var(--text-main)]">{NOME[k.empresa]}</td>
                                    <td className="px-3 text-right">{brl(k.recebido)}</td><td className="px-3 text-right">{brl(k.previsto)}</td>
                                    <td className="px-3 text-right text-red-500">{brl(k.vencido)}</td><td className="px-3 text-right">{fmtPct(pct(k.vencido, k.vencido_base))}</td>
                                    <td className="px-3 text-right">{k.alunos_vigentes.toLocaleString("pt-BR")}</td>
                                    <td className="pl-3 text-right">
                                        <div className="ml-auto flex w-40 items-center gap-2">
                                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full bg-primary" style={{ width: `${pct(k.recebido, v.recebido)}%` }} /></div>
                                            <span className="w-12 text-right text-xs">{fmtPct(pct(k.recebido, v.recebido))}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            <tr className="font-semibold text-[var(--text-main)]">
                                <td className="py-2.5 pr-3">Consolidado</td><td className="px-3 text-right">{brl(v.recebido)}</td><td className="px-3 text-right">{brl(v.previsto)}</td>
                                <td className="px-3 text-right text-red-500">{brl(v.vencido)}</td><td className="px-3 text-right">{fmtPct(inad)}</td>
                                <td className="px-3 text-right">{v.alunos.toLocaleString("pt-BR")}</td><td />
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            <div className="glass-card p-5">
                <h2 className="mb-1 text-sm font-semibold text-[var(--text-main)]">Mês a mês: previsto, recebido e em atraso</h2>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Previsto e atraso pelo mês do vencimento; recebido pelo mês do pagamento.</p>
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={v.serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="nome" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={brlCurto} width={78} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                            <Tooltip formatter={(val: number, n: string) => [brl(val), n]} contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="previsto" name="Previsto" fill="#64748b" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="recebido" name="Recebido" fill="#10b981" radius={[4, 4, 0, 0]} />
                            <Line dataKey="vencido" name="Em atraso" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <Lista titulo="Como o aluno paga" sub="Forma de cobrança, por valor recebido" itens={v.formas} total={v.recebido} />
                <Lista titulo="O que está sendo pago" sub="Categoria da parcela, maiores 8" itens={v.categorias} total={v.recebido} />
                <Lista titulo="Onde o dinheiro entra" sub="Conta de destino (base da conciliação)" itens={v.contas} total={v.recebido} />
            </div>

            <div className="glass-card p-5">
                <h2 className="mb-2 text-sm font-semibold text-[var(--text-main)]">Próximos módulos deste painel</h2>
                <ul className="grid gap-x-6 gap-y-1 text-sm text-[var(--text-muted)] sm:grid-cols-2">
                    <li>Conciliação de extrato e de cartão</li><li>Notas fiscais por competência</li>
                    <li>Créditos, devoluções e estornos</li><li>Cupons e regras de desconto</li>
                    <li>Contas a pagar e pagamentos do dia</li><li>Fundação: repasses e despesas centralizadas</li>
                </ul>
            </div>

            <p className="text-xs text-[var(--text-muted)]">
                Fonte: Sponte (Faculdade, conta 489166; Escola, conta 489164), espelho sincronizado de hora em hora{ultima ? `, última leitura ${new Date(ultima).toLocaleString("pt-BR")}` : ""}.
                Previsto e atraso usam o valor de face da parcela; recebido usa o valor pago. Canceladas e renegociadas ficam de fora. Não substitui o fechamento contábil.
            </p>
        </div>
    )
}

function Lista({ titulo, sub, itens, total }: { titulo: string; sub: string; itens: { nome: string; valor: number; qtd: number }[]; total: number }) {
    const lista = itens.slice(0, 8)
    return (
        <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-main)]">{titulo}</h2>
            <p className="mb-3 text-xs text-[var(--text-muted)]">{sub}</p>
            {lista.length === 0 && <p className="text-sm text-[var(--text-muted)]">Sem pagamentos no período.</p>}
            <ul className="space-y-2.5">
                {lista.map((i) => (
                    <li key={i.nome}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate text-[var(--text-main)]" title={i.nome}>{i.nome}</span>
                            <span className="shrink-0 tabular-nums text-[var(--text-main)]">{brlCurto(i.valor)} <span className="text-xs text-[var(--text-muted)]">{fmtPct(pct(i.valor, total))}</span></span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full bg-primary" style={{ width: `${Math.min(100, pct(i.valor, total))}%` }} /></div>
                    </li>
                ))}
            </ul>
        </div>
    )
}
