import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { PlusCircle, Edit, Trash2, XCircle } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { LossReason } from "@/types/database"

export function LossReasonManagement() {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingReason, setEditingReason] = useState<LossReason | null>(null)
    const [formState, setFormState] = useState({ motivo: "" })

    const { data: reasons, isLoading } = useQuery<LossReason[]>({
        queryKey: ["motivos_perda"],
        queryFn: async () => {
            const { data, error } = await supabase.from("motivos_perda").select("*").order("motivo")
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const mutation = useMutation({
        mutationFn: async (reasonData: { motivo: string }) => {
            let error
            if (editingReason) {
                ({ error } = await supabase.from("motivos_perda").update(reasonData).eq("id", editingReason.id))
            } else {
                ({ error } = await supabase.from("motivos_perda").insert(reasonData))
            }
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["motivos_perda"] })
            showSuccess(`Motivo ${editingReason ? "atualizado" : "criado"} com sucesso!`)
            setIsDialogOpen(false)
        },
        onError: (error: any) => showError(`Erro: ${error.message}`),
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const { error } = await supabase.from("motivos_perda").delete().eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["motivos_perda"] })
            showSuccess("Motivo removido com sucesso!")
        },
        onError: (error: any) => showError(`Erro: ${error.message}`),
    })

    const handleOpenDialog = (reason: LossReason | null = null) => {
        setEditingReason(reason)
        setFormState(reason ? { motivo: reason.motivo } : { motivo: "" })
        setIsDialogOpen(true)
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (formState.motivo.trim()) {
            mutation.mutate(formState)
        }
    }

    if (isLoading || isAuthLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando motivos...</div>

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Motivos de Perda</h1>
                    <p className="text-sm text-muted-foreground">Gerencie os motivos que podem ser selecionados ao marcar um lead como perdido.</p>
                </div>
                {user?.role === 'admin' && (
                    <Button onClick={() => handleOpenDialog()} className="bg-primary hover:bg-primary/90">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Novo Motivo
                    </Button>
                )}
            </div>

            <div className="border rounded-xl bg-card/40 overflow-hidden mt-6">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Descrição do Motivo</TableHead>
                            {user?.role === 'admin' && (
                                <TableHead className="text-right w-[120px]">Ações</TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {reasons && reasons.length > 0 ? reasons.map((reason) => (
                            <TableRow key={reason.id} className="hover:bg-muted/30">
                                <TableCell className="font-semibold text-foreground">
                                    <div className="flex items-center gap-3">
                                        <XCircle className="h-4 w-4 text-destructive/60" />
                                        {reason.motivo}
                                    </div>
                                </TableCell>
                                {user?.role === 'admin' && (
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(reason)} className="h-8 w-8 hover:text-primary transition-colors">
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => {
                                                if (window.confirm("Deseja realmente excluir este motivo de perda?")) {
                                                    deleteMutation.mutate(reason.id)
                                                }
                                            }} className="h-8 w-8 text-destructive hover:text-destructive/80 hover:bg-destructive/10 transition-colors">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                )}
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={user?.role === 'admin' ? 2 : 1} className="h-32 text-center text-muted-foreground">
                                    Nenhum motivo de perda encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {user?.role === 'admin' && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>{editingReason ? "Editar Motivo" : "Novo Motivo"}</DialogTitle>
                            <DialogDescription>
                                Este motivo aparecerá na lista quando um lead for marcado como perdido.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="reason-motivo" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Descrição curta e direta</Label>
                                    <Input id="reason-motivo" value={formState.motivo} onChange={(e) => setFormState({ motivo: e.target.value })} placeholder="Ex: Valor muito alto" autoFocus />
                                </div>
                            </div>
                            <DialogFooter className="pt-2">
                                <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                                <Button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 min-w-32">
                                    {mutation.isPending ? "Salvando..." : "Salvar Motivo"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
