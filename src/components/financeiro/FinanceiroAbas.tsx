// Abas do painel Financeiro: drilldown dos cartões, fluxo de caixa, DRE, conciliação e módulos planejados.
// Onde há dado real (Sponte) ele é usado; o que depende de extrato ou contas a pagar aparece marcado como modelo.
import { useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, X } from "lucide-react"
import { Detalhe, Empresa, NOME, baixarCsv, brl, brlCurto, dataBr, fmtPct, mesLabel, pct } from "./financeiroUtil"

const TIP = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }
const eixo = { fontSize: 11, fill: "var(--text-muted)" }

function Selo({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "neutro" | "modelo" | "ok" | "alerta" }) {
    const c = { neutro: "bg-[var(--bg-card-hover)] text-[var(--text-muted)]", modelo: "bg-amber-500/15 text-amber-600", ok: "bg-emerald-500/15 text-emerald-600", alerta: "bg-red-500/15 text-red-500" }[tom]
    return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c}`}>{children}</span>
}
const Th = ({ children, d }: { children?: React.ReactNode; d?: boolean }) => <th className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] ${d ? "text-right" : "text-left"}`}>{children}</th>

// ---------------------------------------------------------------- drilldown
export type DrillTipo = "recebido" | "previsto" | "atraso" | "vencer" | "realizacao"
const TITULOS: Record<DrillTipo, string> = {
    recebido: "Recebido no período", previsto: "Previsto: o que vence no período", atraso: "Em atraso", vencer: "A vencer nas próximas 12 semanas", realizacao: "Realização: do valor de tabela ao valor pago",
}

export function Drilldown({ tipo, det, empresas, onClose }: { tipo: DrillTipo; det: Detalhe | undefined; empresas: Empresa[]; onClose: () => void }) {
    useEffect(() => {
        const f = (e: KeyboardEvent) => e.key === "Escape" && onClose()
        window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f)
    }, [onClose])
    const dentro = <T extends { empresa: Empresa }>(a: T[] | undefined) => (a ?? []).filter((x) => empresas.includes(x.empresa))

    return createPortal(
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose} role="presentation">
            <aside role="dialog" aria-modal="true" aria-label={TITULOS[tipo]} onClick={(e) => e.stopPropagation()}
                className="h-full w-full max-w-3xl overflow-y-auto bg-[var(--bg-main)] p-5 shadow-2xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-[var(--text-main)]">{TITULOS[tipo]}</h2>
                        <p className="text-xs text-[var(--text-muted)]">{empresas.length === 2 ? "Consolidado" : NOME[empresas[0]]}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full border border-[var(--border)] p-2 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]"><X className="h-4 w-4" /></button>
                </div>
                {!det ? <p className="text-sm text-[var(--text-muted)]">Carregando detalhes…</p> : (
                    <>
                        {tipo === "recebido" && <Recebido det={det} dentro={dentro} />}
                        {tipo === "previsto" && <Previsto det={det} dentro={dentro} />}
                        {tipo === "atraso" && <Atraso det={det} dentro={dentro} />}
                        {tipo === "vencer" && <Semanas det={det} dentro={dentro} />}
                        {tipo === "realizacao" && <Realizacao det={det} dentro={dentro} />}
                    </>
                )}
            </aside>
        </div>, document.body)
}
type Dentro = <T extends { empresa: Empresa }>(a: T[] | undefined) => T[]

function Recebido({ det, dentro }: { det: Detalhe; dentro: Dentro }) {
    const lista = dentro(det.recebimentos).sort((a, b) => b.data.localeCompare(a.data) || b.pago - a.pago).slice(0, 100)
    const porDia = useMemo(() => {
        const m = new Map<string, number>()
        for (const l of dentro(det.dia_conta)) m.set(l.dia, (m.get(l.dia) ?? 0) + Number(l.valor))
        return [...m.entries()].sort().map(([dia, valor]) => ({ nome: dataBr(dia).slice(0, 5), valor }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [det, dentro])
    const csv = () => baixarCsv("recebimentos.csv", [["Empresa", "Data", "Pagador", "Categoria", "Forma", "Conta", "Valor de tabela", "Desconto %", "Valor pago"],
        ...lista.map((l) => [NOME[l.empresa], dataBr(l.data), l.sacado, l.categoria, l.forma, l.conta, l.face, l.desconto, l.pago])])
    return (
        <div className="space-y-5">
            <section className="glass-card p-4">
                <h3 className="mb-1 text-sm font-semibold text-[var(--text-main)]">Entrada por dia (últimos 30 dias)</h3>
                <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={porDia}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="nome" tick={eixo} axisLine={false} tickLine={false} interval={2} /><YAxis tickFormatter={brlCurto} width={70} tick={eixo} axisLine={false} tickLine={false} />
                            <Tooltip formatter={(v: number) => [brl(v), "Recebido"]} contentStyle={TIP} /><Bar dataKey="valor" fill="#10b981" radius={[4, 4, 0, 0]} /></ComposedChart>
                    </ResponsiveContainer>
                </div>
            </section>
            <section className="glass-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-main)]">Últimos 100 pagamentos do período</h3>
                    <button type="button" onClick={csv} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--bg-card-hover)]"><Download className="h-3.5 w-3.5" /> CSV</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-xs"><thead><tr className="border-b border-[var(--border)]"><Th>Data</Th><Th>Pagador</Th><Th>Categoria</Th><Th>Forma</Th><Th d>Tabela</Th><Th d>Desc.</Th><Th d>Pago</Th></tr></thead>
                        <tbody className="tabular-nums">{lista.map((l, i) => (
                            <tr key={i} className="border-b border-[var(--border)]/50">
                                <td className="px-2 py-1.5">{dataBr(l.data)}</td><td className="max-w-[180px] truncate px-2" title={l.sacado ?? ""}>{l.sacado}</td>
                                <td className="max-w-[160px] truncate px-2" title={l.categoria ?? ""}>{l.categoria}</td><td className="px-2">{l.forma}</td>
                                <td className="px-2 text-right">{brl(l.face)}</td><td className="px-2 text-right">{l.desconto ? `${l.desconto}%` : ""}</td><td className="px-2 text-right font-medium">{brl(l.pago)}</td>
                            </tr>))}</tbody></table>
                </div>
            </section>
        </div>
    )
}

function Previsto({ det, dentro }: { det: Detalhe; dentro: Dentro }) {
    const cats = useMemo(() => {
        const m = new Map<string, { nome: string; face: number; pago: number; qtd: number }>()
        for (const c of dentro(det.categorias)) { const o = m.get(c.categoria) ?? { nome: c.categoria, face: 0, pago: 0, qtd: 0 }; o.face += Number(c.face); o.pago += Number(c.pago); o.qtd += Number(c.qtd); m.set(c.categoria, o) }
        return [...m.values()].sort((a, b) => b.face - a.face).slice(0, 15)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [det, dentro])
    return (
        <div className="space-y-4">
            <p className="rounded-xl bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)] ring-1 ring-[var(--border)]">
                Previsto é a soma do <b>valor de tabela</b> das parcelas que vencem no período, pagas ou não. Descontos negociados fora do campo de bolsa do Sponte não aparecem aqui, por isso o recebido costuma ficar abaixo.
            </p>
            <section className="glass-card overflow-x-auto p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--text-main)]">Por categoria (maiores 15)</h3>
                <table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b border-[var(--border)]"><Th>Categoria</Th><Th d>Parcelas</Th><Th d>Previsto</Th><Th d>Pago</Th></tr></thead>
                    <tbody className="tabular-nums">{cats.map((c) => (
                        <tr key={c.nome} className="border-b border-[var(--border)]/50"><td className="px-2 py-1.5">{c.nome}</td><td className="px-2 text-right">{c.qtd.toLocaleString("pt-BR")}</td><td className="px-2 text-right">{brl(c.face)}</td><td className="px-2 text-right">{brl(c.pago)}</td></tr>))}</tbody></table>
            </section>
        </div>
    )
}

function Atraso({ det, dentro }: { det: Detalhe; dentro: Dentro }) {
    const ORDEM = ["1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias"]
    const faixas = ORDEM.map((f) => {
        const l = dentro(det.faixas).filter((x) => x.faixa === f)
        return { f, face: l.reduce((s, x) => s + Number(x.face), 0), liq: l.reduce((s, x) => s + Number(x.liquido), 0), qtd: l.reduce((s, x) => s + Number(x.qtd), 0) }
    })
    const total = faixas.reduce((s, x) => s + x.face, 0)
    const dev = dentro(det.devedores).sort((a, b) => b.face - a.face).slice(0, 15)
    return (
        <div className="space-y-5">
            <section className="glass-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-[var(--text-main)]">Por tempo de atraso</h3>
                <ul className="space-y-3">{faixas.map((x) => (
                    <li key={x.f}><div className="flex items-baseline justify-between text-sm"><span>{x.f}</span><span className="tabular-nums">{brl(x.face)} <span className="text-xs text-[var(--text-muted)]">· {x.qtd.toLocaleString("pt-BR")} parcelas · com desconto registrado {brl(x.liq)}</span></span></div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full bg-red-500" style={{ width: `${pct(x.face, total)}%` }} /></div></li>))}</ul>
                <p className="mt-3 text-xs text-[var(--text-muted)]">Considera os vencimentos do período escolhido. Valores de tabela.</p>
            </section>
            <section className="glass-card overflow-x-auto p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--text-main)]">Maiores saldos em atraso (15)</h3>
                <table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b border-[var(--border)]"><Th>Responsável</Th><Th d>Parcelas</Th><Th d>Maior atraso</Th><Th d>Valor de tabela</Th></tr></thead>
                    <tbody className="tabular-nums">{dev.map((d, i) => (
                        <tr key={i} className="border-b border-[var(--border)]/50"><td className="max-w-[220px] truncate px-2 py-1.5" title={d.sacado}>{d.sacado}</td><td className="px-2 text-right">{d.qtd}</td><td className="px-2 text-right">{d.atraso} dias</td><td className="px-2 text-right">{brl(d.face)}</td></tr>))}</tbody></table>
                <p className="mt-2 text-xs text-[var(--text-muted)]">A lista completa, com WhatsApp e régua de cobrança, está em Inadimplência.</p>
            </section>
        </div>
    )
}

function Realizacao({ det, dentro }: { det: Detalhe; dentro: Dentro }) {
    return (
        <div className="space-y-4">
            <p className="rounded-xl bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)] ring-1 ring-[var(--border)]">
                Realização = valor pago ÷ valor de tabela, nas parcelas já quitadas com vencimento no período. Mostra quanto do preço de tabela vira dinheiro depois de bolsas e descontos negociados.
            </p>
            <section className="glass-card overflow-x-auto p-4">
                <table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b border-[var(--border)]"><Th>Empresa</Th><Th d>Tabela das pagas</Th><Th d>Valor pago</Th><Th d>Realização</Th><Th d>Pagas abaixo do esperado</Th></tr></thead>
                    <tbody className="tabular-nums">{dentro(det.realizacao).map((r) => {
                        const v = det.verificacoes.find((x) => x.empresa === r.empresa)
                        return <tr key={r.empresa} className="border-b border-[var(--border)]/50"><td className="px-2 py-2 font-medium">{NOME[r.empresa]}</td><td className="px-2 text-right">{brl(r.q_face)}</td><td className="px-2 text-right">{brl(r.q_pago)}</td>
                            <td className="px-2 text-right font-semibold">{fmtPct(pct(r.q_pago, r.q_face))}</td><td className="px-2 text-right">{v ? `${v.pagas_abaixo.toLocaleString("pt-BR")} parcelas · ${brlCurto(v.pagas_abaixo_valor)}` : ""}</td></tr>
                    })}</tbody></table>
            </section>
            <p className="text-sm text-[var(--text-muted)]">"Abaixo do esperado" = pago menor que o valor de tabela menos a bolsa registrada. É a pista de desconto que o Sponte não classifica; vale entender com o Financeiro de onde vem.</p>
        </div>
    )
}

// ---------------------------------------------------------------- fluxo de caixa
function calcSemanas(det: Detalhe, empresas: Empresa[]) {
    const taxa: Record<string, number> = {}
    for (const r of det.realizacao) taxa[r.empresa] = r.h_total > 0 ? Number(r.h_pago) / Number(r.h_total) : 0
    const m = new Map<string, { semana: string; face: number; liquido: number; provavel: number; qtd: number }>()
    for (const s of det.semanas.filter((x) => empresas.includes(x.empresa))) {
        const o = m.get(s.semana) ?? { semana: s.semana, face: 0, liquido: 0, provavel: 0, qtd: 0 }
        o.face += Number(s.face); o.liquido += Number(s.liquido); o.provavel += Number(s.face) * (taxa[s.empresa] ?? 0); o.qtd += Number(s.qtd); m.set(s.semana, o)
    }
    let acc = 0
    return { linhas: [...m.values()].sort((a, b) => a.semana.localeCompare(b.semana)).map((x) => { acc += x.provavel; return { ...x, nome: dataBr(x.semana).slice(0, 5), acumulado: acc } }), taxa }
}
function Semanas({ det, dentro }: { det: Detalhe; dentro: Dentro }) {
    const emp = [...new Set(dentro(det.semanas).map((s) => s.empresa))]
    const { linhas } = calcSemanas(det, emp)
    return (
        <section className="glass-card overflow-x-auto p-4">
            <table className="w-full min-w-[460px] text-sm"><thead><tr className="border-b border-[var(--border)]"><Th>Semana de</Th><Th d>Parcelas</Th><Th d>Valor de tabela</Th><Th d>Provável</Th></tr></thead>
                <tbody className="tabular-nums">{linhas.map((l) => (<tr key={l.semana} className="border-b border-[var(--border)]/50"><td className="px-2 py-1.5">{dataBr(l.semana)}</td><td className="px-2 text-right">{l.qtd}</td><td className="px-2 text-right">{brl(l.face)}</td><td className="px-2 text-right">{brl(l.provavel)}</td></tr>))}</tbody></table>
            <p className="mt-2 text-xs text-[var(--text-muted)]">Provável = valor de tabela × realização histórica de cada empresa (pago ÷ tabela das parcelas que venceram nos últimos 180 dias).</p>
        </section>
    )
}

export function FluxoCaixa({ det, empresas }: { det: Detalhe | undefined; empresas: Empresa[] }) {
    if (!det) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
    const { linhas, taxa } = calcSemanas(det, empresas)
    const totFace = linhas.reduce((s, x) => s + x.face, 0), totProv = linhas.reduce((s, x) => s + x.provavel, 0)
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><Selo tom="modelo">Projeção simples</Selo><span className="text-sm text-[var(--text-muted)]">Entradas das próximas 12 semanas, a partir das parcelas pendentes que vencem nelas.</span></div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="glass-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">A vencer (tabela)</p><p className="mt-1 text-xl font-bold tabular-nums">{brl(totFace)}</p></div>
                <div className="glass-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Entrada provável</p><p className="mt-1 text-xl font-bold tabular-nums text-emerald-500">{brl(totProv)}</p></div>
                {empresas.map((e) => <div key={e} className="glass-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Realização histórica · {NOME[e]}</p><p className="mt-1 text-xl font-bold tabular-nums">{fmtPct((taxa[e] ?? 0) * 100)}</p><p className="text-xs text-[var(--text-muted)]">pago ÷ tabela, 180 dias</p></div>)}
            </div>
            <div className="glass-card p-5">
                <div className="h-72"><ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={linhas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="nome" tick={eixo} axisLine={false} tickLine={false} /><YAxis tickFormatter={brlCurto} width={78} tick={eixo} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number, n: string) => [brl(v), n]} labelFormatter={(l) => `Semana de ${l}`} contentStyle={TIP} /><Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="face" name="A vencer (tabela)" fill="#64748b" radius={[4, 4, 0, 0]} /><Bar dataKey="provavel" name="Entrada provável" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Line dataKey="acumulado" name="Provável acumulado" stroke="#f59e0b" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div>
            </div>
            <div className="glass-card p-5"><div className="mb-1 flex items-center gap-2"><h3 className="text-sm font-semibold">Saídas</h3><Selo tom="modelo">Falta contas a pagar</Selo></div>
                <p className="text-sm text-[var(--text-muted)]">Com o Contas a Pagar no sistema (despesas, folha, encargos, repasse à Fundação), esta tela passa a mostrar o saldo projetado semana a semana: entradas menos saídas, por empresa e consolidado.</p></div>
        </div>
    )
}

// ---------------------------------------------------------------- DRE
export function Dre({ det, empresas }: { det: Detalhe | undefined; empresas: Empresa[] }) {
    const t = useMemo(() => {
        if (!det) return null
        const meses = [...new Set(det.dre.filter((x) => empresas.includes(x.empresa)).map((x) => x.mes))].sort()
        const val = (mes: string, f: (x: Detalhe["dre"][number]) => number, grupo?: string) =>
            det.dre.filter((x) => empresas.includes(x.empresa) && x.mes === mes && (!grupo || x.grupo === grupo)).reduce((s, x) => s + f(x), 0)
        const GRUPOS = ["Mensalidades", "Matrículas", "Acordos", "Outras receitas"]
        const linha = (nome: string, f: (m: string) => number, o: { forte?: boolean; neg?: boolean } = {}) => ({ nome, v: meses.map(f), ...o })
        const bruta = (m: string) => val(m, (x) => Number(x.face)), desc = (m: string) => val(m, (x) => Number(x.desconto)), atr = (m: string) => val(m, (x) => Number(x.atraso))
        const linhas = [
            ...GRUPOS.map((g) => linha(`   ${g}`, (m) => val(m, (x) => Number(x.face), g))),
            linha("Receita bruta (valor de tabela)", bruta, { forte: true }),
            linha("(−) Descontos e bolsas registrados", (m) => -desc(m)),
            linha("Receita líquida de competência", (m) => bruta(m) - desc(m), { forte: true }),
            linha("(−) Inadimplência (pendentes vencidas)", (m) => -atr(m)),
            linha("Receita líquida após inadimplência", (m) => bruta(m) - desc(m) - atr(m), { forte: true }),
            linha("(−) A vencer (ainda não venceu)", (m) => -val(m, (x) => Number(x.a_vencer))),
            linha("(−) Pago abaixo do esperado (desconto fora do cadastro de bolsa)", (m) => -val(m, (x) => Number(x.abaixo))),
            linha("(+) Pago acima do esperado (juros e multa)", (m) => val(m, (x) => Number(x.acima))),
            linha("Recebido das parcelas do mês (caixa)", (m) => val(m, (x) => Number(x.recebido)), { forte: true }),
        ]
        return { meses, linhas }
    }, [det, empresas])
    if (!det || !t) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
    const csv = () => baixarCsv("dre.csv", [["Linha", ...t.meses.map(mesLabel), "Total"], ...t.linhas.map((l) => [l.nome.trim(), ...l.v.map((x) => Math.round(x)), Math.round(l.v.reduce((a, b) => a + b, 0))])])
    const DESPESAS = ["Pessoal e encargos", "Corpo docente e pedagógico", "Administrativo e utilidades", "Tarifas e taxas (Pix, boleto, cartão)", "Tributos e impostos", "Repasse à Fundação"]
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2"><Selo tom="ok">Receita: dado real</Selo><Selo tom="modelo">Despesas: a integrar</Selo><span className="text-sm text-[var(--text-muted)]">DRE gerencial por competência (mês do vencimento). Da tabela até o caixa, cada degrau explica a diferença.</span></div>
                <button type="button" onClick={csv} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--bg-card-hover)]"><Download className="h-3.5 w-3.5" /> CSV</button>
            </div>
            <div className="glass-card overflow-x-auto p-4">
                <table className="w-full min-w-[820px] text-sm">
                    <thead><tr className="border-b border-[var(--border)]"><Th>Linha</Th>{t.meses.map((m) => <Th key={m} d>{mesLabel(m)}</Th>)}<Th d>Total</Th></tr></thead>
                    <tbody className="tabular-nums">
                        {t.linhas.map((l) => (
                            <tr key={l.nome} className={`border-b border-[var(--border)]/50 ${l.forte ? "bg-[var(--bg-card-hover)] font-semibold" : ""}`}>
                                <td className="whitespace-pre px-2 py-1.5">{l.nome}</td>
                                {l.v.map((x, i) => <td key={i} className={`px-2 text-right ${x < 0 ? "text-red-500" : ""}`}>{brlCurto(x)}</td>)}
                                <td className={`px-2 text-right ${l.v.reduce((a, b) => a + b, 0) < 0 ? "text-red-500" : ""}`}>{brlCurto(l.v.reduce((a, b) => a + b, 0))}</td>
                            </tr>))}
                        <tr><td colSpan={t.meses.length + 2} className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Despesas (modelo, entram com o Contas a Pagar)</td></tr>
                        {DESPESAS.map((d) => <tr key={d} className="border-b border-[var(--border)]/40 text-[var(--text-muted)]"><td className="px-2 py-1.5">(−) {d}</td>{t.meses.map((m) => <td key={m} className="px-2 text-right">—</td>)}<td className="px-2 text-right">—</td></tr>)}
                        <tr className="bg-[var(--bg-card-hover)] font-semibold text-[var(--text-muted)]"><td className="px-2 py-2">Resultado operacional</td>{t.meses.map((m) => <td key={m} className="px-2 text-right">—</td>)}<td className="px-2 text-right">—</td></tr>
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Receita bruta é o valor de tabela; descontos são só os registrados no campo de bolsa do Sponte; inadimplência é o que venceu e segue pendente (líquida do desconto registrado). "Pago abaixo do esperado" é a diferença que o Sponte não explica: desconto fora do cadastro de bolsa ou baixa parcial. A última linha é o dinheiro que entrou, igual ao cartão Recebido da Visão geral. Quando existir plano de contas próprio, cada linha passa a ter detalhe por conta e centro de custo, com o filtro de empresa já aplicado.</p>
        </div>
    )
}

// ---------------------------------------------------------------- conciliação
export function Conciliacao({ det, empresas }: { det: Detalhe | undefined; empresas: Empresa[] }) {
    const t = useMemo(() => {
        if (!det) return null
        const l = det.dia_conta.filter((x) => empresas.includes(x.empresa))
        const tot = new Map<string, number>(); l.forEach((x) => tot.set(x.conta, (tot.get(x.conta) ?? 0) + Number(x.valor)))
        const contas = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0])
        const dias = [...new Set(l.map((x) => x.dia))].sort().reverse().slice(0, 14)
        return { contas, dias: dias.map((d) => { const doDia = l.filter((x) => x.dia === d); return { d, cel: contas.map((c) => doDia.filter((x) => x.conta === c).reduce((s, x) => s + Number(x.valor), 0)), outras: doDia.filter((x) => !contas.includes(x.conta)).reduce((s, x) => s + Number(x.valor), 0), n: doDia.reduce((s, x) => s + Number(x.qtd), 0), total: doDia.reduce((s, x) => s + Number(x.valor), 0) } }) }
    }, [det, empresas])
    if (!det || !t) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
    const v = det.verificacoes.filter((x) => empresas.includes(x.empresa))
    const s = (k: keyof (typeof v)[number]) => v.reduce((a, x) => a + Number(x[k] ?? 0), 0)
    const checks: { t: string; qtd: number; extra?: string; tom: "ok" | "alerta"; txt: string }[] = [
        { t: "Pagas por menos do esperado", qtd: s("pagas_abaixo"), extra: brlCurto(s("pagas_abaixo_valor")), tom: s("pagas_abaixo") ? "alerta" : "ok", txt: "Valor pago menor que a tabela menos a bolsa registrada. Pode ser desconto fora do cadastro ou baixa parcial." },
        { t: "Pagas por mais do esperado", qtd: s("pagas_acima"), tom: "ok", txt: "Normalmente juros e multa de parcela paga em atraso. Conferir se a cobrança de encargos está correta." },
        { t: "Pagamentos sem conta de destino", qtd: s("sem_conta"), tom: s("sem_conta") ? "alerta" : "ok", txt: "Sem conta, não há como conciliar com o extrato." },
        { t: "Pagamentos com valor zero (sem bolsa de 100%)", qtd: s("pago_zero"), tom: s("pago_zero") ? "alerta" : "ok", txt: "Parcela quitada sem valor pago e sem bolsa integral." },
        { t: "Pendentes há mais de 180 dias", qtd: s("pendente_antigo"), extra: brlCurto(s("pendente_antigo_valor")), tom: s("pendente_antigo") ? "alerta" : "ok", txt: "Candidatas a renegociação, baixa por perda ou limpeza de cadastro." },
        { t: "Pendentes que têm data de pagamento", qtd: s("pendente_com_data"), tom: s("pendente_com_data") ? "alerta" : "ok", txt: "Inconsistência entre situação e pagamento." },
    ]
    return (
        <div className="space-y-5">
            <section className="glass-card overflow-x-auto p-5">
                <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Entradas por conta e dia: o que o extrato deveria mostrar</h3><Selo tom="ok">Dado real</Selo></div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Últimos 14 dias com pagamento. A coluna Stone fica em branco até a integração direta com a Stone existir.</p>
                <table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-[var(--border)]"><Th>Dia</Th>{t.contas.map((c) => <Th key={c} d>{c.length > 22 ? c.slice(0, 21) + "…" : c}</Th>)}<Th d>Outras</Th><Th d>Parcelas</Th><Th d>Total do sistema</Th><Th d>Stone</Th><Th>Situação</Th></tr></thead>
                    <tbody className="tabular-nums">{t.dias.map((d) => (
                        <tr key={d.d} className="border-b border-[var(--border)]/50"><td className="px-2 py-1.5">{dataBr(d.d)}</td>{d.cel.map((x, i) => <td key={i} className="px-2 text-right">{x ? brlCurto(x) : ""}</td>)}
                            <td className="px-2 text-right">{d.outras ? brlCurto(d.outras) : ""}</td><td className="px-2 text-right">{d.n}</td><td className="px-2 text-right font-medium">{brl(d.total)}</td>
                            <td className="px-2 text-right text-[var(--text-muted)]">—</td><td className="px-2"><Selo>Sem Stone</Selo></td></tr>))}</tbody></table>
                <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"><FileSpreadsheet className="h-3.5 w-3.5" /> Integração direta com a Stone · em breve</button>
                    <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"><FileSpreadsheet className="h-3.5 w-3.5" /> Outros bancos (OFX) e SpontePay · depois</button>
                </div>
            </section>
            <section className="glass-card p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Verificações automáticas</h3><Selo tom="ok">Dado real</Selo><span className="text-xs text-[var(--text-muted)]">no período escolhido</span></div>
                <ul className="divide-y divide-[var(--border)]">{checks.map((c) => (
                    <li key={c.t} className="flex items-start gap-3 py-2.5">
                        {c.tom === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                        <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--text-main)]">{c.t}</p><p className="text-xs text-[var(--text-muted)]">{c.txt}</p></div>
                        <div className="shrink-0 text-right tabular-nums"><p className="text-sm font-semibold">{c.qtd.toLocaleString("pt-BR")}</p>{c.extra && <p className="text-xs text-[var(--text-muted)]">{c.extra}</p>}</div>
                    </li>))}</ul>
            </section>
            <section className="glass-card p-5">
                <div className="mb-3 flex items-center gap-2"><h3 className="text-sm font-semibold">Como a conciliação vai funcionar</h3><Selo tom="modelo">Modelo</Selo></div>
                <ol className="grid gap-3 sm:grid-cols-4">
                    {[["1. Receber", "Os dados chegam direto da Stone, sem digitar nada. Outros bancos e o SpontePay entram depois, por arquivo ou integração."], ["2. Casar", "O sistema liga cada crédito da Stone às parcelas baixadas, por valor, data e identificador."], ["3. Resolver", "Sobras e faltas viram uma fila: ajuste de centavos, pagamento em duplicidade, tarifa, transferência entre contas."], ["4. Fechar o dia", "Dia sem divergência fica marcado como conciliado, com quem fechou e quando."]].map(([a, b]) => (
                        <li key={a} className="rounded-xl bg-[var(--bg-card)] p-3 ring-1 ring-[var(--border)]"><p className="text-sm font-semibold text-[var(--text-main)]">{a}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{b}</p></li>))}
                </ol>
            </section>
        </div>
    )
}

// ---------------------------------------------------------------- módulos
const MODULOS: { n: string; d: string; s: "Nesta tela" | "Parcial" | "Planejado" }[] = [
    { n: "DRE gerencial", d: "Resultado por empresa e consolidado, por competência. Receita já real; despesas entram com o Contas a Pagar.", s: "Nesta tela" },
    { n: "Fluxo de caixa", d: "Entradas prováveis das próximas semanas e, depois, saldo projetado com as saídas.", s: "Nesta tela" },
    { n: "Conciliação bancária", d: "Dados direto da Stone contra as baixas, fila de divergências e fechamento do dia. Outros bancos por OFX, depois.", s: "Parcial" },
    { n: "Conciliação de cartão e SpontePay", d: "Vendas e repasses da Stone contra as parcelas, com as taxas; SpontePay em seguida.", s: "Planejado" },
    { n: "Notas fiscais (NFS-e)", d: "Emissão por competência, fila com reenvio, rejeições e envio ao aluno e ao Portal.", s: "Planejado" },
    { n: "Contas a pagar", d: "Agenda do dia, aprovação por alçada, DDA, cartões corporativos e comprovantes.", s: "Planejado" },
    { n: "Repasses e Fundação", d: "Transferências entre as empresas sem virar receita ou despesa, e pagamentos centralizados.", s: "Planejado" },
    { n: "Créditos, devoluções e estornos", d: "Pagamento em duplicidade vira crédito do aluno; devolução total ou parcial com multa retida.", s: "Planejado" },
    { n: "Cupons e regras de desconto", d: "Valor ou %, validade, limite de uso, curso, aprovação e um único desconto por aluno.", s: "Planejado" },
    { n: "Cobrança e acordos", d: "Régua por WhatsApp e acordos de parcelamento. A régua já funciona em Inadimplência.", s: "Parcial" },
    { n: "Fechamento do mês", d: "Lista do que falta: dias conciliados, notas emitidas, pendências, aprovações.", s: "Planejado" },
    { n: "Orçamento e realizado", d: "Meta de receita e despesa por centro de custo contra o que aconteceu.", s: "Planejado" },
    { n: "Segunda via, extrato e informe de IR", d: "O responsável baixa no Portal sem pedir à secretaria.", s: "Planejado" },
    { n: "Auditoria e alçadas", d: "Quem alterou, aprovou ou baixou o quê, com histórico.", s: "Planejado" },
]
export function Modulos() {
    return (
        <div className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">O que o Financeiro pode ter no sistema e em que ponto cada módulo está. Serve de roteiro para priorizar com a equipe.</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {MODULOS.map((m) => (
                    <div key={m.n} className="glass-card p-4">
                        <div className="mb-1 flex items-start justify-between gap-2"><h3 className="text-sm font-semibold text-[var(--text-main)]">{m.n}</h3><Selo tom={m.s === "Nesta tela" ? "ok" : m.s === "Parcial" ? "modelo" : "neutro"}>{m.s}</Selo></div>
                        <p className="text-xs text-[var(--text-muted)]">{m.d}</p>
                    </div>))}
            </div>
        </div>
    )
}
