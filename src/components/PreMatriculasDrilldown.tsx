import { Fragment, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Download, KanbanSquare, Loader2, MessageCircle, Search, X } from "lucide-react"
import { LeadDialogById } from "./kanban/LeadDialogById"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { showError, showSuccess } from "@/utils/toast"
import { withTimeout } from "@/utils/withTimeout"

// utilidade (não conta no limite de marketing da Meta) e existe no WABA do canal 8 (CIDADE VIVA - OFICIAL)
const TEMPLATE_PRE_MATRICULA = "ficv_continuidade_atendimento"

interface PreMat {
    contrato_id: number
    aluno_id: number
    aluno: string
    curso: string | null
    turma: string | null
    data_matricula: string | null
    data_inicio: string | null
    financeiro_lancado: string | null
    pagas: number
    abertas: number
    vencidas: number
    proximo: string | null
    tem_portal: boolean
    tem_telefone: boolean
    lead_id: number | null
    stage: string | null
    owner: string | null
    contatado: boolean
    contatado_por: string | null
    contatado_em: string | null
}

const dia = (s: string | null) => (s ? new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—")
const diasDesde = (s: string | null) => (s ? Math.max(0, Math.floor((Date.now() - new Date(s.slice(0, 10) + "T12:00:00").getTime()) / 86400000)) : null)

function Selo({ cor, children }: { cor: "verde" | "ambar" | "vermelho" | "cinza"; children: React.ReactNode }) {
    const c = {
        verde: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
        ambar: "bg-amber-500/15 text-amber-700 border-amber-500/30",
        vermelho: "bg-red-500/15 text-red-700 border-red-500/30",
        cinza: "bg-slate-500/10 text-slate-600 border-slate-400/30",
    }[cor]
    return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${c}`}>{children}</span>
}


export function PreMatriculasDrilldown({ contratos, onClose }: { contratos: number[]; onClose: () => void }) {
    const qc = useQueryClient()
    const [busca, setBusca] = useState("")
    const [filtroContato, setFiltroContato] = useState<"todos" | "fora" | "dentro">("todos")
    const [filtroKanban, setFiltroKanban] = useState<"todos" | "fora" | "dentro">("todos")
    const [aberto, setAberto] = useState<number | null>(null)
    const [abrindo, setAbrindo] = useState<number | null>(null)
    const [leadAberto, setLeadAberto] = useState<number | null>(null)
    const [pedirTelefone, setPedirTelefone] = useState<PreMat | null>(null)
    const [telefone, setTelefone] = useState("")

    const { data, isLoading, error } = useQuery<PreMat[]>({
        queryKey: ["pre-matriculas"],
        queryFn: async () => {
            await supabase.auth.getSession()
            const { data, error } = await withTimeout(supabase.rpc("pre_matricula_report"), 30000, "A lista de pré-matrículas")
            if (error) throw new Error(error.message)
            return (data ?? []) as PreMat[]
        },
        staleTime: 30_000,
    })

    const ids = useMemo(() => new Set(contratos), [contratos])
    const base = useMemo(() => (data ?? []).filter((p) => ids.has(p.contrato_id)), [data, ids])
    const lista = useMemo(() => {
        const t = busca.trim().toLowerCase()
        return base
            .filter((p) => filtroContato === "todos" || (filtroContato === "dentro" ? p.contatado : !p.contatado))
            .filter((p) => filtroKanban === "todos" || (filtroKanban === "dentro" ? !!p.lead_id : !p.lead_id))
            .filter((p) => !t || `${p.aluno} ${p.curso ?? ""} ${p.turma ?? ""}`.toLowerCase().includes(t))
            // quem ainda não foi contatado primeiro; dentro disso, o que espera há mais tempo
            .sort((a, b) => Number(a.contatado) - Number(b.contatado) || (a.data_matricula ?? "").localeCompare(b.data_matricula ?? ""))
    }, [base, busca, filtroContato, filtroKanban])
    const contatados = base.filter((p) => p.contatado).length

    const marcar = async (p: PreMat, valor: boolean) => {
        const anterior = qc.getQueryData<PreMat[]>(["pre-matriculas"])
        qc.setQueryData<PreMat[]>(["pre-matriculas"], (old) =>
            (old ?? []).map((x) => (x.contrato_id === p.contrato_id ? { ...x, contatado: valor, contatado_em: valor ? new Date().toISOString() : null } : x)))
        try {
            await supabase.auth.getSession()
            const { error } = await withTimeout(supabase.rpc("pre_matricula_marcar", { p_contrato_id: p.contrato_id, p_contatado: valor }), 15000, "O registro")
            if (error) throw new Error(error.message)
            qc.invalidateQueries({ queryKey: ["pre-matriculas"] })
        } catch (e) {
            qc.setQueryData(["pre-matriculas"], anterior)
            showError(`Não consegui salvar: ${(e as Error).message}`)
        }
    }

    const abrirConversa = async (p: PreMat, fone?: string) => {
        setAbrindo(p.contrato_id)
        try {
            await supabase.auth.getSession()
            const { data, error } = await withTimeout(
                supabase.rpc("pre_matricula_abrir_lead", fone ? { p_aluno_id: p.aluno_id, p_telefone: fone } : { p_aluno_id: p.aluno_id }),
                20000, "A abertura do card")
            if (error) {
                if (error.message === "SEM_CELULAR") { setTelefone(""); setPedirTelefone(p); return }
                throw new Error(error.message)
            }
            setPedirTelefone(null)
            const r = data as { lead_id: number; criado: boolean; outro_dono: boolean; owner: string | null; stage: string | null }
            for (const k of ["leads", "inbox-leads", "leads-stage-counts"]) qc.invalidateQueries({ queryKey: [k] })
            qc.invalidateQueries({ queryKey: ["pre-matriculas"] })
            if (r.outro_dono) showSuccess(`Este aluno já está no Kanban de ${r.owner ?? "outra pessoa"} (${r.stage ?? "sem etapa"}).`)
            else if (r.criado) showSuccess("Card criado em Em Contato. Confirme o template para começar a conversa.")
            setLeadAberto(r.lead_id)
        } catch (e) {
            showError(`Não consegui abrir a conversa: ${(e as Error).message}`)
        } finally {
            setAbrindo(null)
        }
    }

    const exportar = () => {
        const cab = ["Aluno", "Curso", "Turma", "Matrícula", "Início da turma", "Financeiro lançado", "Parcelas pagas", "Parcelas em aberto", "Vencidas", "Portal", "Kanban", "Atendente", "Contatado", "Contatado por", "Contatado em"]
        const linhas = lista.map((p) => [p.aluno, p.curso ?? "", p.turma ?? "", dia(p.data_matricula), dia(p.data_inicio), p.financeiro_lancado ?? "", p.pagas, p.abertas, p.vencidas,
            p.tem_portal ? "Sim" : "Não", p.stage ?? "", p.owner ?? "", p.contatado ? "Sim" : "Não", p.contatado_por ?? "", p.contatado ? dia(p.contatado_em) : ""])
        const csv = [cab, ...linhas].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")
        const a = document.createElement("a")
        a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }))
        a.download = `pre-matriculas-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
    }

    return (
        <div className="glass-card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Pré-matrículas · {base.length} · {contatados} já contatada{contatados === 1 ? "" : "s"}
                </p>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <select value={filtroContato} onChange={(e) => setFiltroContato(e.target.value as typeof filtroContato)} aria-label="Filtrar por contato"
                        className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-main)]">
                        <option value="todos">Contato: todos</option>
                        <option value="fora">Ainda não contatados ({base.filter((p) => !p.contatado).length})</option>
                        <option value="dentro">Já contatados ({contatados})</option>
                    </select>
                    <select value={filtroKanban} onChange={(e) => setFiltroKanban(e.target.value as typeof filtroKanban)} aria-label="Filtrar por Kanban"
                        className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-main)]">
                        <option value="todos">Kanban: todos</option>
                        <option value="fora">Ainda não no Kanban</option>
                        <option value="dentro">Já no Kanban</option>
                    </select>
                    <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno" className="rounded-full border border-[var(--border)] bg-transparent py-2 pl-8 pr-3 text-sm outline-none" /></div>
                    <button type="button" onClick={exportar} className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card-hover)]"><Download className="h-4 w-4" /> CSV</button>
                    <button type="button" onClick={onClose} aria-label="Fechar" title="Fechar a lista" className="rounded-full border border-[var(--border)] p-2 hover:bg-[var(--bg-card-hover)]"><X className="h-4 w-4" /></button>
                </div>
            </div>

            <div className="max-h-[560px] overflow-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center py-12 text-[var(--text-muted)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : error ? (
                    <p className="py-6 text-center text-sm text-red-600">Não consegui carregar: {(error as Error).message}</p>
                ) : lista.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[var(--text-muted)]">Nenhuma pré-matrícula nesta lista.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[var(--bg-card)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                            <tr><th className="w-6" /><th className="py-2">Aluno</th><th>Turma</th><th>Matrícula</th><th className="text-right">Dias em pré</th><th>Situação</th><th className="text-center">Contatado</th><th className="w-12" /></tr>
                        </thead>
                        <tbody>
                            {lista.map((p) => {
                                const dias = diasDesde(p.data_matricula)
                                const iniciou = p.data_inicio ? p.data_inicio.slice(0, 10) <= new Date().toISOString().slice(0, 10) : null
                                const abre = aberto === p.contrato_id
                                return (
                                    <Fragment key={p.contrato_id}>
                                        <tr onClick={() => setAberto(abre ? null : p.contrato_id)} className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-card-hover)] ${p.contatado ? "opacity-60" : ""}`}>
                                            <td>{abre ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                                            <td className="py-2 pr-2">
                                                <button type="button" onClick={(e) => { e.stopPropagation(); abrirConversa(p) }} disabled={abrindo === p.contrato_id}
                                                    title="Abrir a conversa no Kanban" className="text-left text-[var(--text-main)] hover:text-primary hover:underline disabled:opacity-60">{p.aluno}</button>
                                                {p.lead_id && (
                                                    <button type="button" onClick={(e) => { e.stopPropagation(); setLeadAberto(p.lead_id!) }}
                                                        title={`Já está no Kanban${p.owner ? ` de ${p.owner}` : " (sem atendente)"}${p.stage ? ` · ${p.stage}` : ""}. Clique para abrir a conversa.`}
                                                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[11px] font-medium text-primary hover:bg-primary/20">
                                                        <KanbanSquare className="h-3 w-3" />{p.stage ?? "No Kanban"}{p.owner ? ` · ${p.owner.split(" ")[0]}` : ""}
                                                    </button>
                                                )}</td>
                                            <td className="max-w-[260px] truncate text-[var(--text-muted)]">{p.turma ?? "—"}</td>
                                            <td className="whitespace-nowrap tabular-nums">{dia(p.data_matricula)}</td>
                                            <td className="text-right tabular-nums text-[var(--text-muted)]">{dias ?? "—"} d</td>
                                            <td className="py-1">
                                                <div className="flex max-w-[330px] flex-wrap gap-1">
                                                    {iniciou === null ? null : iniciou
                                                        ? <Selo cor="ambar">Turma já começou</Selo>
                                                        : <Selo cor="cinza">Começa {dia(p.data_inicio)}</Selo>}
                                                    {p.financeiro_lancado && p.financeiro_lancado !== "SIM" && <Selo cor="vermelho">Financeiro não lançado</Selo>}
                                                    {p.pagas > 0 && <Selo cor="verde">{p.pagas} paga{p.pagas === 1 ? "" : "s"}</Selo>}
                                                    {p.vencidas > 0 && <Selo cor="vermelho">{p.vencidas} vencida{p.vencidas === 1 ? "" : "s"}</Selo>}
                                                    {!p.tem_portal && <Selo cor="ambar">Sem Portal</Selo>}
                                                </div>
                                            </td>
                                            <td className="text-center">
                                                <input type="checkbox" checked={p.contatado} onClick={(e) => e.stopPropagation()} onChange={(e) => marcar(p, e.target.checked)}
                                                    title={p.contatado ? `Contatado por ${p.contatado_por ?? "—"} em ${dia(p.contatado_em)}` : "Marcar como contatado"} />
                                            </td>
                                            <td className="whitespace-nowrap text-right">
                                                <button type="button" disabled={abrindo === p.contrato_id} onClick={(e) => { e.stopPropagation(); abrirConversa(p) }}
                                                    aria-label="Abrir conversa no Kanban" title={p.lead_id ? "Abrir a conversa no Kanban" : "Criar o card em Em Contato e abrir a conversa"}
                                                    className={`inline-block p-1.5 hover:text-[var(--text-main)] disabled:opacity-60 ${p.lead_id ? "text-primary" : "text-[var(--text-muted)]"}`}>
                                                    {abrindo === p.contrato_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                                                </button></td>
                                        </tr>
                                        {abre && (
                                            <tr className="bg-[var(--bg-card-hover)]"><td /><td colSpan={7} className="py-2">
                                                <p className="mb-1 text-xs text-[var(--text-muted)]">{p.curso ?? ""} · ID Sponte {p.aluno_id}</p>
                                                <ul className="grid gap-x-6 gap-y-0.5 text-xs md:grid-cols-2">
                                                    <li>Início da turma: {dia(p.data_inicio)}</li>
                                                    <li>Financeiro lançado: {p.financeiro_lancado ?? "—"}</li>
                                                    <li>Parcelas: {p.pagas} paga{p.pagas === 1 ? "" : "s"}, {p.abertas} em aberto{p.vencidas > 0 ? ` (${p.vencidas} vencida${p.vencidas === 1 ? "" : "s"})` : ""}{p.proximo ? ` · próximo vencimento ${dia(p.proximo)}` : ""}</li>
                                                    <li>Portal do aluno: {p.tem_portal ? "conta criada" : "sem conta (sem acesso às aulas)"}</li>
                                                    <li>Telefone: {p.tem_telefone ? "encontrado no Sponte ou no Portal" : "não encontrado (será pedido ao abrir a conversa)"}</li>
                                                    <li>{p.contatado ? `Contatado por ${p.contatado_por ?? "—"} em ${dia(p.contatado_em)}` : "Ainda não contatado"}</li>
                                                </ul>
                                            </td></tr>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {leadAberto && (
                <LeadDialogById leadId={leadAberto} autoTemplate={TEMPLATE_PRE_MATRICULA} initialTab="chat"
                    onClose={() => { setLeadAberto(null); qc.invalidateQueries({ queryKey: ["pre-matriculas"] }) }} />
            )}

            {pedirTelefone && (
                <Dialog open onOpenChange={(o) => { if (!o) setPedirTelefone(null) }}>
                    <DialogContent className="max-w-sm bg-[var(--bg-card)] border-[var(--border)]">
                        <DialogHeader><DialogTitle className="text-[var(--text-main)]">WhatsApp de {pedirTelefone.aluno}</DialogTitle></DialogHeader>
                        <p className="text-xs text-[var(--text-muted)]">Não há telefone no Sponte nem no Portal. Informe o número com DDD.</p>
                        <Input autoFocus value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(83) 99999-9999"
                            onKeyDown={(e) => { if (e.key === "Enter" && telefone.replace(/\D/g, "").length >= 10) abrirConversa(pedirTelefone, telefone) }} />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setPedirTelefone(null)}>Cancelar</Button>
                            <Button disabled={telefone.replace(/\D/g, "").length < 10} onClick={() => abrirConversa(pedirTelefone, telefone)}>Abrir conversa</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
