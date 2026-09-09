import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarClock, Check, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { User, FollowupStatus } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { periodToDates, PERIOD_OPTIONS } from "@/utils/dashboardFilters"
import { showError, showSuccess } from "@/utils/toast"
import { LeadDialogById } from "@/components/kanban/LeadDialogById"
import { NewFollowupDialog } from "./NewFollowupDialog"
import { useFollowups, useSetFollowupStatus, useDeleteFollowups, FollowupFilters } from "@/hooks/use-followups"

const STATUS_OPTIONS: { value: FollowupStatus | "all"; label: string }[] = [
    { value: "pending", label: "Pendentes" },
    { value: "done", label: "Concluídas" },
    { value: "cancelled", label: "Canceladas" },
    { value: "all", label: "Todas" },
]

const fmt = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })

export function FollowupsPage({ profile }: { profile: { id: string; role?: string } | null }) {
    const isAdmin = profile?.role === "admin"

    const [period, setPeriod] = useState("month")
    const [customStart, setCustomStart] = useState("")
    const [customEnd, setCustomEnd] = useState("")
    const [status, setStatus] = useState<FollowupStatus | "all">("pending")
    const [assignee, setAssignee] = useState<string>("all")
    const [selected, setSelected] = useState<Set<number>>(new Set())
    const [newOpen, setNewOpen] = useState(false)
    const [openLeadId, setOpenLeadId] = useState<number | null>(null)

    const { start, end } = periodToDates(period, customStart, customEnd)

    const filters: FollowupFilters = {
        start: start || undefined,
        end: end || undefined,
        status,
        assignedTo: isAdmin ? assignee : profile?.id,
    }
    const { data: followups, isLoading } = useFollowups(filters)
    const statusMut = useSetFollowupStatus()
    const deleteMut = useDeleteFollowups()
    const busy = statusMut.isPending || deleteMut.isPending

    const { data: users } = useQuery<User[]>({
        queryKey: ["users"],
        queryFn: async () => {
            const { data, error } = await supabase.from("profiles").select("*")
            if (error) throw error
            return data || []
        },
    })
    const agents = useMemo(() => (users || []).filter((u) => u.role === "admin" || u.role === "agent"), [users])

    const rows = followups || []
    const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
    const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
    const toggle = (id: number) => {
        const next = new Set(selected)
        next.has(id) ? next.delete(id) : next.add(id)
        setSelected(next)
    }

    const bulkStatus = (s: FollowupStatus) => {
        if (!selected.size) return
        statusMut.mutate({ ids: [...selected], status: s }, {
            onSuccess: () => { showSuccess("Follow-ups atualizados."); setSelected(new Set()) },
            onError: (e: any) => showError(e.message),
        })
    }
    const bulkDelete = () => {
        if (!selected.size || !window.confirm(`Excluir ${selected.size} item(ns)?`)) return
        deleteMut.mutate([...selected], {
            onSuccess: () => { showSuccess("Excluídos."); setSelected(new Set()) },
            onError: (e: any) => showError(e.message),
        })
    }

    return (
        <div className="max-w-6xl mx-auto py-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-[var(--text-main)] flex items-center gap-2">
                        <CalendarClock className="h-6 w-6 text-primary" /> Follow-ups & Tarefas
                    </h2>
                    <p className="text-sm text-[var(--text-muted)] mt-1">Lembretes de retorno ao cliente e tarefas da equipe.</p>
                </div>
                <Button onClick={() => setNewOpen(true)} className="gap-2">
                    <Plus className="h-4 w-4" /> Nova tarefa
                </Button>
            </div>

            {/* filtros */}
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Período</span>
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary"
                    >
                        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {period === "custom" && (
                    <>
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Início</span>
                            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Fim</span>
                            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                        </div>
                    </>
                )}
                <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Status</span>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as FollowupStatus | "all")}
                        className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary"
                    >
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {isAdmin && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Responsável</span>
                        <select
                            value={assignee}
                            onChange={(e) => setAssignee(e.target.value)}
                            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary"
                        >
                            <option value="all">Todos</option>
                            {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name || "Sem nome"}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {/* ações em massa */}
            {selected.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">{selected.size} selecionado(s)</span>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-green-600" disabled={busy} onClick={() => bulkStatus("done")}>
                        <Check className="h-3.5 w-3.5" /> Concluir
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={busy} onClick={() => bulkStatus("pending")}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive" disabled={busy} onClick={bulkDelete}>
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                </div>
            )}

            <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} /></TableHead>
                            <TableHead>Lead / Tarefa</TableHead>
                            <TableHead>Observação</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead>Responsável</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && (
                            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                                <Loader2 className="h-5 w-5 animate-spin inline" />
                            </TableCell></TableRow>
                        )}
                        {!isLoading && rows.length === 0 && (
                            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Nenhum follow-up no período.</TableCell></TableRow>
                        )}
                        {rows.map((f) => {
                            const overdue = f.status === "pending" && new Date(f.due_at) <= new Date()
                            const who = agents.find((a) => a.id === f.assigned_to)?.full_name || f.assignee?.full_name || "—"
                            return (
                                <TableRow key={f.id} data-state={selected.has(f.id) ? "selected" : undefined}>
                                    <TableCell><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} /></TableCell>
                                    <TableCell className="font-medium">
                                        {f.lead_id ? (
                                            <button className="text-primary hover:underline text-left" onClick={() => setOpenLeadId(f.lead_id!)}>
                                                {f.lead?.nome_completo || `Lead #${f.lead_id}`}
                                            </button>
                                        ) : (f.title || "Tarefa")}
                                    </TableCell>
                                    <TableCell className="max-w-[240px] truncate text-muted-foreground" title={f.note || ""}>{f.note || "—"}</TableCell>
                                    <TableCell className={overdue ? "text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap" : "whitespace-nowrap"}>{fmt(f.due_at)}</TableCell>
                                    <TableCell className="whitespace-nowrap">{who}</TableCell>
                                    <TableCell>
                                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                            f.status === "done" ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                            : f.status === "cancelled" ? "bg-muted text-muted-foreground"
                                            : overdue ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                            : "bg-blue-500/15 text-blue-600 dark:text-blue-400"}`}>
                                            {f.status === "done" ? "Concluída" : f.status === "cancelled" ? "Cancelada" : overdue ? "Vencida" : "Pendente"}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        {f.status === "pending" ? (
                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" title="Concluir" disabled={busy}
                                                onClick={() => statusMut.mutate({ ids: [f.id], status: "done" })}>
                                                <Check className="h-4 w-4" />
                                            </Button>
                                        ) : (
                                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Reabrir" disabled={busy}
                                                onClick={() => statusMut.mutate({ ids: [f.id], status: "pending" })}>
                                                <RotateCcw className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Excluir" disabled={busy}
                                            onClick={() => { if (window.confirm("Excluir este follow-up?")) deleteMut.mutate([f.id]) }}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            <NewFollowupDialog isOpen={newOpen} onOpenChange={setNewOpen} users={users || []} />
            {openLeadId != null && <LeadDialogById leadId={openLeadId} onClose={() => setOpenLeadId(null)} initialTab="chat" />}
        </div>
    )
}
