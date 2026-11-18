import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MessageCircle, Search } from "lucide-react"
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
    const [soPendentes, setSoPendentes] = useState(false)
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
    const lista = useMemo(() => {
        const t = busca.trim().toLowerCase()
        return (data ?? [])
            .filter((p) => ids.has(p.contrato_id))
            .filter((p) => !soPendentes || !p.contatado)
            .filter((p) => !t || `${p.aluno} ${p.curso ?? ""} ${p.turma ?? ""}`.toLowerCase().includes(t))
            // quem ainda não foi contatado primeiro; dentro disso, o que espera há mais tempo
            .sort((a, b) => Number(a.contatado) - Number(b.contatado) || (a.data_matricula ?? "").localeCompare(b.data_matricula ?? ""))
    }, [data, ids, busca, soPendentes])

    const total = (data ?? []).filter((p) => ids.has(p.contrato_id))
    const contatados = total.filter((p) => p.contatado).length

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

    return (
        <>
            <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
                <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden flex flex-col bg-[var(--bg-card)] border-[var(--border)]">
                    <DialogHeader>
                        <DialogTitle className="text-[var(--text-main)]">
                            Pré-matrículas — {total.length} {total.length === 1 ? "pessoa" : "pessoas"}
                            <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">{contatados} já contatada{contatados === 1 ? "" : "s"}</span>
                        </DialogTitle>
                        <p className="text-xs text-[var(--text-muted)]">
                            Quem ainda está em pré-matrícula no Sponte. Marque quando o Comercial falar com a pessoa; o ícone de conversa abre o card no seu Kanban com o template pronto.
                        </p>
                    </DialogHeader>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, curso ou turma"
                                className="pl-8 h-8 text-sm bg-[var(--bg-main)] border-[var(--border)]" />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-[var(--text-main)] cursor-pointer">
                            <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
                            Só os ainda não contatados
                        </label>
                    </div>

                    <div className="flex-1 overflow-y-auto -mx-1 px-1">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12 text-[var(--text-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>
                        ) : error ? (
                            <p className="text-sm text-red-600 py-6 text-center">Não consegui carregar: {(error as Error).message}</p>
                        ) : lista.length === 0 ? (
                            <p className="text-sm text-[var(--text-muted)] py-8 text-center">Nenhuma pré-matrícula nesta lista.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-[var(--bg-card)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                                    <tr className="text-left border-b border-[var(--border)]">
                                        <th className="py-2 pr-2 w-10">Contatado</th>
                                        <th className="py-2 pr-3">Aluno</th>
                                        <th className="py-2 pr-3">Matrícula</th>
                                        <th className="py-2 pr-3">Situação</th>
                                        <th className="py-2 pr-3">No Kanban</th>
                                        <th className="py-2 w-10 text-center">Conversa</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lista.map((p) => {
                                        const dias = diasDesde(p.data_matricula)
                                        const iniciou = p.data_inicio ? p.data_inicio.slice(0, 10) <= new Date().toISOString().slice(0, 10) : null
                                        return (
                                            <tr key={p.contrato_id} className={`border-b border-[var(--border)]/60 align-top ${p.contatado ? "opacity-60" : ""}`}>
                                                <td className="py-2.5 pr-2 text-center">
                                                    <input type="checkbox" checked={p.contatado} onChange={(e) => marcar(p, e.target.checked)}
                                                        title={p.contatado ? `Contatado por ${p.contatado_por ?? "—"} em ${dia(p.contatado_em)}` : "Marcar como contatado"} />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <p className="font-medium text-[var(--text-main)]">{p.aluno}</p>
                                                    <p className="text-[11px] text-[var(--text-muted)] max-w-[320px]">{(p.curso ?? "—").replace(/\s*\(.*\)\s*$/, "")}</p>
                                                    {p.contatado && <p className="text-[10px] text-emerald-700">Contatado por {p.contatado_por ?? "—"} em {dia(p.contatado_em)}</p>}
                                                </td>
                                                <td className="py-2.5 pr-3 whitespace-nowrap">
                                                    <p className="text-[var(--text-main)]">{dia(p.data_matricula)}</p>
                                                    <p className="text-[11px] text-[var(--text-muted)]">{dias === null ? "" : dias === 0 ? "hoje" : `há ${dias} dia${dias === 1 ? "" : "s"}`}</p>
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <div className="flex flex-wrap gap-1 max-w-[300px]">
                                                        {iniciou === null ? null : iniciou
                                                            ? <Selo cor="ambar">Turma já começou ({dia(p.data_inicio)})</Selo>
                                                            : <Selo cor="cinza">Turma começa {dia(p.data_inicio)}</Selo>}
                                                        {p.financeiro_lancado && p.financeiro_lancado !== "SIM" && <Selo cor="vermelho">Financeiro não lançado</Selo>}
                                                        {p.pagas > 0 && <Selo cor="verde">{p.pagas} parcela{p.pagas === 1 ? "" : "s"} paga{p.pagas === 1 ? "" : "s"}</Selo>}
                                                        {p.vencidas > 0
                                                            ? <Selo cor="vermelho">{p.vencidas} vencida{p.vencidas === 1 ? "" : "s"}</Selo>
                                                            : p.abertas > 0 ? <Selo cor="cinza">Vence {dia(p.proximo)}</Selo> : null}
                                                        {p.pagas === 0 && p.abertas === 0 && <Selo cor="cinza">Sem parcelas</Selo>}
                                                        {!p.tem_portal && <Selo cor="ambar">Sem acesso ao Portal</Selo>}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 pr-3 text-[11px]">
                                                    {p.lead_id ? (
                                                        <button type="button" className="text-left hover:underline text-[var(--primary)]" onClick={() => setLeadAberto(p.lead_id!)}>
                                                            {p.stage ?? "—"}<br /><span className="text-[var(--text-muted)]">{p.owner ?? "sem atendente"}</span>
                                                        </button>
                                                    ) : <span className="text-[var(--text-muted)]">Não está</span>}
                                                </td>
                                                <td className="py-2.5 text-center">
                                                    <button type="button" disabled={abrindo === p.contrato_id} onClick={() => abrirConversa(p)}
                                                        title="Abrir conversa no Kanban com template"
                                                        className="p-1.5 rounded hover:bg-[var(--primary)]/10 text-[var(--primary)] disabled:opacity-50">
                                                        {abrindo === p.contrato_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

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
        </>
    )
}
