import { useEffect, useRef, useState } from "react"
import { Bell, Check, CheckCheck, Loader2, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { LeadDialogById } from "@/components/kanban/LeadDialogById"
import { showError, showSuccess } from "@/utils/toast"
import { useDueFollowups, useSetFollowupStatus } from "@/hooks/use-followups"

interface Props {
    profile: { id: string; role?: string } | null
    onOpenTab: (tab: string) => void
}

const overdueLabel = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const min = Math.round(diffMs / 60000)
    if (min < 1) return "agora"
    if (min < 60) return `há ${min} min`
    const h = Math.round(min / 60)
    if (h < 24) return `há ${h}h`
    return `há ${Math.round(h / 24)}d`
}

export function NotificationBell({ profile, onOpenTab }: Props) {
    const isAdmin = profile?.role === "admin"
    const [open, setOpen] = useState(false)
    const [showAll, setShowAll] = useState(false)
    const [openLeadId, setOpenLeadId] = useState<number | null>(null)

    const { data: due, isLoading } = useDueFollowups(profile?.id, isAdmin && showAll)
    const statusMut = useSetFollowupStatus()
    const count = due?.length ?? 0

    // toast quando um follow-up NOVO passa a estar vencido (entre um poll e outro)
    const knownIds = useRef<Set<number> | null>(null)
    useEffect(() => {
        if (!due) return
        const current = new Set(due.map((f) => f.id))
        if (knownIds.current) {
            for (const f of due) {
                if (!knownIds.current.has(f.id)) {
                    const name = f.lead?.nome_completo || f.title || "Tarefa"
                    toast(`🔔 Follow-up: ${name}`, {
                        description: f.note || "Está na hora de retornar.",
                        action: f.lead_id
                            ? { label: "Abrir", onClick: () => setOpenLeadId(f.lead_id!) }
                            : { label: "Ver", onClick: () => onOpenTab("followups") },
                    })
                }
            }
        }
        knownIds.current = current
    }, [due, onOpenTab])

    const completeOne = (id: number) =>
        statusMut.mutate({ ids: [id], status: "done" }, {
            onSuccess: () => showSuccess("Follow-up concluído."),
            onError: (e: any) => showError(e.message),
        })

    const completeAll = () => {
        if (!due?.length) return
        statusMut.mutate({ ids: due.map((f) => f.id), status: "done" }, {
            onSuccess: () => { showSuccess("Todos os follow-ups marcados como concluídos."); setOpen(false) },
            onError: (e: any) => showError(e.message),
        })
    }

    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--text-main)]"
                        title="Notificações / follow-ups"
                    >
                        <Bell size={18} className={count > 0 ? "animate-pulse" : ""} />
                        {count > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                                {count > 99 ? "99+" : count}
                            </span>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <span className="text-sm font-semibold">Follow-ups de hoje</span>
                        {isAdmin && (
                            <button
                                type="button"
                                onClick={() => setShowAll((v) => !v)}
                                className="text-[11px] text-primary hover:underline"
                            >
                                {showAll ? "Só os meus" : "De todos"}
                            </button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {isLoading ? (
                            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Carregando…</p>
                        ) : count === 0 ? (
                            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nada pendente por agora. 🎉</p>
                        ) : (
                            due!.map((f) => {
                                const name = f.lead?.nome_completo || f.title || "Tarefa"
                                return (
                                    <div key={f.id} className="flex items-start gap-2 border-b border-border/60 px-3 py-2 last:border-0">
                                        <div className="flex-1 min-w-0">
                                            <p className="truncate text-sm font-medium">{name}</p>
                                            {f.note && <p className="line-clamp-2 text-xs text-muted-foreground">{f.note}</p>}
                                            <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">venceu {overdueLabel(f.due_at)}</p>
                                        </div>
                                        <div className="flex shrink-0 flex-col gap-1">
                                            {f.lead_id ? (
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Abrir lead"
                                                    onClick={() => { setOpen(false); setOpenLeadId(f.lead_id!) }}>
                                                    <ExternalLink className="h-4 w-4" />
                                                </Button>
                                            ) : (
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Ver na página"
                                                    onClick={() => { setOpen(false); onOpenTab("followups") }}>
                                                    <ExternalLink className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-green-600" title="Concluir"
                                                disabled={statusMut.isPending} onClick={() => completeOne(f.id)}>
                                                <Check className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                        <button
                            type="button"
                            onClick={() => { setOpen(false); onOpenTab("followups") }}
                            className="text-[11px] text-primary hover:underline"
                        >
                            Ver histórico
                        </button>
                        {count > 0 && (
                            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={statusMut.isPending} onClick={completeAll}>
                                {statusMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                                Concluir todas
                            </Button>
                        )}
                    </div>
                </PopoverContent>
            </Popover>

            {openLeadId != null && <LeadDialogById leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
        </>
    )
}
