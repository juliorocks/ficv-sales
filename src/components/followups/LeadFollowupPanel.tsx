import { useMemo, useState } from "react"
import { CalendarClock, Check, Loader2, RotateCcw, Trash2 } from "lucide-react"
import { Lead, User, LeadFollowup } from "@/types/database"
import { Button } from "@/components/ui/button"
import { showError, showSuccess } from "@/utils/toast"
import { useAuth } from "@/hooks/use-auth"
import {
    useLeadFollowups,
    useCreateFollowup,
    useSetFollowupStatus,
    useDeleteFollowups,
} from "@/hooks/use-followups"

// datetime-local <-> ISO
const toLocalInput = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const defaultDue = () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return toLocalInput(d)
}
const fmtDue = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

function FollowupRow({ f, users, onDone, onReopen, onDelete, busy }: {
    f: LeadFollowup
    users: User[]
    onDone: () => void
    onReopen: () => void
    onDelete: () => void
    busy: boolean
}) {
    const who = users.find((u) => u.id === f.assigned_to)?.full_name || f.assignee?.full_name || "—"
    const overdue = f.status === "pending" && new Date(f.due_at) <= new Date()
    return (
        <div className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${overdue ? "border-amber-400/60 bg-amber-500/5" : "border-border"}`}>
            <div className="flex-1 min-w-0">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${overdue ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    {fmtDue(f.due_at)}
                    <span className="text-muted-foreground">· {who}</span>
                    {f.status === "done" && <span className="text-green-600 dark:text-green-400">· concluído</span>}
                </div>
                {f.note && <p className={`mt-0.5 whitespace-pre-wrap ${f.status === "done" ? "text-muted-foreground line-through" : ""}`}>{f.note}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
                {f.status === "pending" ? (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Concluir" disabled={busy} onClick={onDone}>
                        <Check className="h-4 w-4" />
                    </Button>
                ) : (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Reabrir" disabled={busy} onClick={onReopen}>
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                )}
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Excluir" disabled={busy} onClick={onDelete}>
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}

export function LeadFollowupPanel({ lead, users }: { lead: Lead; users: User[] }) {
    const { user } = useAuth()
    const { data: followups, isLoading } = useLeadFollowups(lead.id)
    const createMut = useCreateFollowup()
    const statusMut = useSetFollowupStatus()
    const deleteMut = useDeleteFollowups()
    const busy = createMut.isPending || statusMut.isPending || deleteMut.isPending

    const [note, setNote] = useState("")
    const [dueAt, setDueAt] = useState(defaultDue())
    const [assignedTo, setAssignedTo] = useState<string>(lead.assigned_to_id || user?.id || "")
    const [showDone, setShowDone] = useState(false)

    const pending = useMemo(() => (followups || []).filter((f) => f.status !== "done"), [followups])
    const done = useMemo(() => (followups || []).filter((f) => f.status === "done"), [followups])

    const agents = users.filter((u) => u.role === "admin" || u.role === "agent")

    const submit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!dueAt) return
        createMut.mutate(
            {
                lead_id: lead.id,
                note: note.trim() || null,
                due_at: new Date(dueAt).toISOString(),
                assigned_to: assignedTo || null,
            },
            {
                onSuccess: () => {
                    showSuccess("Follow-up agendado.")
                    setNote("")
                    setDueAt(defaultDue())
                },
                onError: (err: any) => showError(`Erro ao agendar: ${err.message}`),
            },
        )
    }

    return (
        <div className="rounded-xl border border-border bg-[var(--bg-card)] p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-primary" />
                Follow-up / lembrete
            </div>

            <form onSubmit={submit} className="space-y-2">
                <textarea
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Ex: ligar sobre a bolsa, mandar link da matrícula…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Retornar em</label>
                        <input
                            type="datetime-local"
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={dueAt}
                            onChange={(e) => setDueAt(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Responsável</label>
                        <select
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={assignedTo}
                            onChange={(e) => setAssignedTo(e.target.value)}
                        >
                            <option value="">Ninguém</option>
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>{a.full_name || "Sem nome"}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <Button type="submit" size="sm" disabled={busy}>
                    {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Agendar follow-up"}
                </Button>
            </form>

            {isLoading ? (
                <p className="text-xs text-muted-foreground">Carregando…</p>
            ) : (
                <div className="space-y-2">
                    {pending.length === 0 && <p className="text-xs text-muted-foreground">Nenhum follow-up pendente.</p>}
                    {pending.map((f) => (
                        <FollowupRow
                            key={f.id}
                            f={f}
                            users={users}
                            busy={busy}
                            onDone={() => statusMut.mutate({ ids: [f.id], status: "done" })}
                            onReopen={() => statusMut.mutate({ ids: [f.id], status: "pending" })}
                            onDelete={() => deleteMut.mutate([f.id])}
                        />
                    ))}
                    {done.length > 0 && (
                        <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-primary hover:underline">
                            {showDone ? "Ocultar" : `Ver concluídos (${done.length})`}
                        </button>
                    )}
                    {showDone && done.map((f) => (
                        <FollowupRow
                            key={f.id}
                            f={f}
                            users={users}
                            busy={busy}
                            onDone={() => statusMut.mutate({ ids: [f.id], status: "done" })}
                            onReopen={() => statusMut.mutate({ ids: [f.id], status: "pending" })}
                            onDelete={() => deleteMut.mutate([f.id])}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
