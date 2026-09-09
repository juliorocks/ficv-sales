import { useMemo, useState } from "react"
import { Loader2, Search, X } from "lucide-react"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { User } from "@/types/database"
import { useAuth } from "@/hooks/use-auth"
import { useSupabaseSearch } from "@/hooks/use-supabase-search"
import { useCreateFollowup } from "@/hooks/use-followups"
import { showError, showSuccess } from "@/utils/toast"

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

interface Props {
    isOpen: boolean
    onOpenChange: (o: boolean) => void
    users: User[]
    /** pré-fixa um lead (usado quando aberto de dentro do card) */
    fixedLead?: { id: number; nome_completo: string }
}

export function NewFollowupDialog({ isOpen, onOpenChange, users, fixedLead }: Props) {
    const { user } = useAuth()
    const createMut = useCreateFollowup()

    const [pickedLead, setPickedLead] = useState<{ id: number; nome_completo: string } | null>(fixedLead ?? null)
    const [title, setTitle] = useState("")
    const [note, setNote] = useState("")
    const [dueAt, setDueAt] = useState(defaultDue())
    const [assignedTo, setAssignedTo] = useState<string>(user?.id || "")

    const { searchTerm, setSearchTerm, data: leadResults, isFetching } = useSupabaseSearch(
        "leads",
        ["nome_completo", "telefone", "email"],
    )

    const agents = useMemo(() => users.filter((u) => u.role === "admin" || u.role === "agent"), [users])

    const reset = () => {
        setPickedLead(fixedLead ?? null)
        setTitle(""); setNote(""); setDueAt(defaultDue()); setAssignedTo(user?.id || "")
        setSearchTerm("")
    }

    const submit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!dueAt) return
        createMut.mutate(
            {
                lead_id: pickedLead?.id ?? null,
                title: !pickedLead ? (title.trim() || null) : null,
                note: note.trim() || null,
                due_at: new Date(dueAt).toISOString(),
                assigned_to: assignedTo || null,
            },
            {
                onSuccess: () => { showSuccess("Tarefa criada."); reset(); onOpenChange(false) },
                onError: (err: any) => showError(`Erro ao criar: ${err.message}`),
            },
        )
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Nova tarefa / follow-up</DialogTitle>
                    <DialogDescription>Um lembrete com data e hora. Pode estar ligado a um lead ou ser uma tarefa solta.</DialogDescription>
                </DialogHeader>

                <form onSubmit={submit} className="space-y-3">
                    {/* lead */}
                    {fixedLead ? (
                        <div className="text-sm">Lead: <span className="font-medium">{fixedLead.nome_completo}</span></div>
                    ) : pickedLead ? (
                        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                            <span className="truncate font-medium">{pickedLead.nome_completo}</span>
                            <button type="button" onClick={() => setPickedLead(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <label className="text-[11px] font-medium text-muted-foreground">Lead (opcional)</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input className="pl-9" placeholder="Buscar por nome, telefone, e-mail…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                            {searchTerm && (
                                <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                                    {isFetching && <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>}
                                    {!isFetching && (leadResults?.length ?? 0) === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nada encontrado.</p>}
                                    {(leadResults as any[] | undefined)?.slice(0, 8).map((l) => (
                                        <button
                                            key={l.id}
                                            type="button"
                                            onClick={() => { setPickedLead({ id: l.id, nome_completo: l.nome_completo }); setSearchTerm("") }}
                                            className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                        >
                                            {l.nome_completo}
                                            {l.telefone && <span className="ml-2 text-xs text-muted-foreground">{l.telefone}</span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {!pickedLead && !fixedLead && (
                        <div className="space-y-1">
                            <label className="text-[11px] font-medium text-muted-foreground">Título da tarefa</label>
                            <Input placeholder="Ex: revisar planilha de metas" value={title} onChange={(e) => setTitle(e.target.value)} />
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Observações</label>
                        <textarea
                            className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" disabled={createMut.isPending}>
                            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar tarefa"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
