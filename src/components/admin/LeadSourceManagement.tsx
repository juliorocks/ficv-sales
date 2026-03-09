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
import { PlusCircle, Edit, Trash2, Globe } from "lucide-react"
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
import { IconPreview } from "./IconPreview"
import { useAuth } from "@/hooks/use-auth"
import { LeadSource } from "@/types/database"

export function LeadSourceManagement() {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingSource, setEditingSource] = useState<LeadSource | null>(null)
    const [formState, setFormState] = useState({ name: "", icon: "", color: "#5b51ff" })

    const { data: sources, isLoading } = useQuery<LeadSource[]>({
        queryKey: ["lead_sources"],
        queryFn: async () => {
            const { data, error } = await supabase.from("lead_sources").select("*").order("name")
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const mutation = useMutation({
        mutationFn: async (sourceData: Omit<LeadSource, 'id'>) => {
            let error
            if (editingSource) {
                ({ error } = await supabase.from("lead_sources").update(sourceData).eq("id", editingSource.id))
            } else {
                ({ error } = await supabase.from("lead_sources").insert(sourceData))
            }
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lead_sources"] })
            showSuccess(`Fonte ${editingSource ? "atualizada" : "criada"} com sucesso!`)
            setIsDialogOpen(false)
        },
        onError: (error: any) => showError(`Erro: ${error.message}`),
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const { error } = await supabase.from("lead_sources").delete().eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lead_sources"] })
            showSuccess("Fonte removida com sucesso!")
        },
        onError: (error: any) => showError(`Erro: ${error.message}`),
    })

    const handleOpenDialog = (source: LeadSource | null = null) => {
        setEditingSource(source)
        setFormState(source ? { name: source.name, icon: source.icon || "Globe", color: source.color || "#5b51ff" } : { name: "", icon: "Globe", color: "#5b51ff" })
        setIsDialogOpen(true)
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (formState.name.trim()) {
            mutation.mutate(formState)
        }
    }

    if (isLoading || isAuthLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando canais...</div>

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Canais de Aquisição</h1>
                    <p className="text-sm text-muted-foreground">Gerencie as fontes de onde seus leads estão vindo.</p>
                </div>
                {user?.role === 'admin' && (
                    <Button onClick={() => handleOpenDialog()} className="bg-primary hover:bg-primary/90">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Novo Canal
                    </Button>
                )}
            </div>

            <div className="border rounded-xl bg-card/40 overflow-hidden mt-6">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead className="w-[80px]">Ícone</TableHead>
                            <TableHead>Nome</TableHead>
                            <TableHead>Cor</TableHead>
                            {user?.role === 'admin' && (
                                <TableHead className="text-right w-[120px]">Ações</TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sources && sources.length > 0 ? sources.map((source) => (
                            <TableRow key={source.id} className="hover:bg-muted/30">
                                <TableCell>
                                    <div className="p-2 rounded-lg bg-muted/50 w-fit">
                                        <IconPreview name={source.icon || "Globe"} className="h-5 w-5" style={{ color: source.color }} />
                                    </div>
                                </TableCell>
                                <TableCell className="font-semibold text-foreground">{source.name}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <div className="h-4 w-4 rounded-full border border-muted" style={{ backgroundColor: source.color }} />
                                        <span className="text-xs font-mono text-muted-foreground uppercase">{source.color}</span>
                                    </div>
                                </TableCell>
                                {user?.role === 'admin' && (
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(source)} className="h-8 w-8 hover:text-primary hover:bg-primary/10 transition-colors">
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => {
                                                if (window.confirm("Deseja realmente excluir este canal?")) {
                                                    deleteMutation.mutate(source.id)
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
                                <TableCell colSpan={user?.role === 'admin' ? 4 : 3} className="h-32 text-center text-muted-foreground">
                                    Nenhum canal de aquisição encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {user?.role === 'admin' && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent className="sm:max-w-[450px]">
                        <DialogHeader>
                            <DialogTitle>{editingSource ? "Editar Canal" : "Novo Canal"}</DialogTitle>
                            <DialogDescription>
                                Personalize como as fontes de leads são exibidas no sistema.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="source-name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nome do Canal</Label>
                                    <Input id="source-name" value={formState.name} onChange={(e) => setFormState(s => ({ ...s, name: e.target.value }))} placeholder="Ex: WhatsApp, Instagram, Google" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="source-icon" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ícone (Lucide)</Label>
                                        <Input id="source-icon" value={formState.icon} onChange={(e) => setFormState(s => ({ ...s, icon: e.target.value }))} placeholder="Ex: Instagram" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="source-color" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cor da Marca</Label>
                                        <Input id="source-color" type="color" value={formState.color} onChange={(e) => setFormState(s => ({ ...s, color: e.target.value }))} className="h-10 cursor-pointer p-1" />
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl border border-dashed bg-muted/5 flex items-center justify-center gap-4">
                                    <div className="text-center">
                                        <div className="p-3 rounded-2xl bg-muted/20 w-fit mx-auto shadow-inner mb-2">
                                            <IconPreview name={formState.icon || "Globe"} className="h-8 w-8" style={{ color: formState.color }} />
                                        </div>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Preview no Sistema</p>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter className="pt-2">
                                <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                                <Button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 min-w-32">
                                    {mutation.isPending ? "Processando..." : (editingSource ? "Atualizar Canal" : "Criar Canal")}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
