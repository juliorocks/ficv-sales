import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Copy, Edit, ExternalLink, PlusCircle, Search, Trash2 } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Course, LeadSource, MarketingForm } from "@/types/database"
import { slugify } from "@/utils/marketingForms"

interface MarketingFormsListProps {
    onEdit: (id: number) => void
}

export function MarketingFormsList({ onEdit }: MarketingFormsListProps) {
    const queryClient = useQueryClient()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [newName, setNewName] = useState("")
    const [newCourseId, setNewCourseId] = useState<string>("")
    const [newSourceId, setNewSourceId] = useState<string>("")
    const [saving, setSaving] = useState(false)

    const { data: forms, isLoading } = useQuery<MarketingForm[]>({
        queryKey: ["marketing_forms"],
        queryFn: async () => {
            const { data, error } = await supabase.from("marketing_forms")
                .select("id, slug, name, course_id, source_id, ativo, view_count, created_at, updated_at, courses(name)")
                .order("created_at", { ascending: false })
            if (error) throw error
            return (data ?? []) as unknown as MarketingForm[]
        },
    })

    const { data: courses } = useQuery<Course[]>({
        queryKey: ["courses"],
        queryFn: async () => {
            const { data, error } = await supabase.from("courses").select("*").order("name")
            if (error) throw error
            return data ?? []
        },
    })

    const { data: sources } = useQuery<LeadSource[]>({
        queryKey: ["lead_sources"],
        queryFn: async () => {
            const { data, error } = await supabase.from("lead_sources").select("*").order("name")
            if (error) throw error
            return data ?? []
        },
    })

    const filtered = useMemo(() => {
        if (!forms) return []
        const term = searchTerm.toLowerCase().trim()
        if (!term) return forms
        return forms.filter((f) => f.name.toLowerCase().includes(term) || f.slug.toLowerCase().includes(term))
    }, [forms, searchTerm])

    const createMutation = useMutation({
        mutationFn: async () => {
            const name = newName.trim()
            if (!name) throw new Error("Nome é obrigatório.")
            if (!newSourceId) throw new Error("Canal de aquisição é obrigatório.")

            let slug = slugify(name)
            const { data: clash } = await supabase.from("marketing_forms").select("id").eq("slug", slug).maybeSingle()
            if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

            const seedFields = [
                { id: crypto.randomUUID(), type: "text", label: "Nome", required: true, role: "name" },
                { id: crypto.randomUUID(), type: "phone", label: "WhatsApp", required: true, role: "whatsapp" },
                { id: crypto.randomUUID(), type: "email", label: "Email", required: false, role: "email" },
                {
                    id: crypto.randomUUID(), type: "select", label: "Prefiro contato por", required: false,
                    role: "preferred_contact", options: ["Whatsapp", "E-mail"],
                },
            ]
            const { data: authData } = await supabase.auth.getUser()
            const { data, error } = await supabase.from("marketing_forms").insert({
                slug, name,
                course_id: newCourseId ? Number(newCourseId) : null,
                source_id: Number(newSourceId),
                fields: seedFields,
                created_by: authData.user?.id ?? null,
            }).select("id").single()
            if (error) throw error
            return data.id as number
        },
        onSuccess: (id) => {
            queryClient.invalidateQueries({ queryKey: ["marketing_forms"] })
            showSuccess("Formulário criado!")
            setIsDialogOpen(false)
            setNewName(""); setNewCourseId(""); setNewSourceId("")
            onEdit(id)
        },
        onError: (error: any) => showError(error.message),
        onSettled: () => setSaving(false),
    })

    const duplicateMutation = useMutation({
        mutationFn: async (form: MarketingForm) => {
            let slug = `${slugify(form.name)}-copia`
            const { data: clash } = await supabase.from("marketing_forms").select("id").eq("slug", slug).maybeSingle()
            if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
            const { data: full } = await supabase.from("marketing_forms").select("*").eq("id", form.id).single()
            const { error } = await supabase.from("marketing_forms").insert({
                slug, name: `${form.name} (cópia)`, course_id: full?.course_id ?? null, source_id: full?.source_id,
                fields: full?.fields ?? [], design: full?.design ?? {}, post_submit: full?.post_submit,
                allowed_domains: full?.allowed_domains ?? [], lgpd_enabled: full?.lgpd_enabled ?? true,
                lgpd_text: full?.lgpd_text, ativo: false,
            })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["marketing_forms"] })
            showSuccess("Formulário duplicado (inativo).")
        },
        onError: (error: any) => showError(error.message),
    })

    const toggleMutation = useMutation({
        mutationFn: async ({ id, ativo }: { id: number; ativo: boolean }) => {
            const { error } = await supabase.from("marketing_forms").update({ ativo }).eq("id", id)
            if (error) throw error
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["marketing_forms"] }),
        onError: (error: any) => showError(error.message),
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const { error } = await supabase.from("marketing_forms").delete().eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["marketing_forms"] })
            showSuccess("Formulário removido.")
        },
        onError: (error: any) => showError(error.message),
    })

    if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando formulários...</div>

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Formulários</h1>
                    <p className="text-sm text-muted-foreground">Crie formulários de captação para suas landing pages, já conectados aos cursos e ao Kanban.</p>
                </div>
                <Button onClick={() => setIsDialogOpen(true)} className="bg-primary hover:bg-primary/90">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Novo Formulário
                </Button>
            </div>

            <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input placeholder="Buscar formulário..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 h-10" />
            </div>

            <div className="border rounded-xl bg-card/40 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Nome</TableHead>
                            <TableHead>Curso</TableHead>
                            <TableHead>Visualizações</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right w-[180px]">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length > 0 ? filtered.map((form) => (
                            <TableRow key={form.id} className="cursor-pointer" onClick={() => onEdit(form.id)}>
                                <TableCell className="font-semibold text-foreground">{form.name}</TableCell>
                                <TableCell className="text-muted-foreground">{form.courses?.name ?? "—"}</TableCell>
                                <TableCell className="text-muted-foreground">{form.view_count}</TableCell>
                                <TableCell>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: form.id, ativo: !form.ativo }) }}
                                        className={`text-xs px-2 py-1 rounded-full font-medium ${form.ativo ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}
                                    >
                                        {form.ativo ? "Ativo" : "Inativo"}
                                    </button>
                                </TableCell>
                                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(form.id)} title="Editar">
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(`/f/${form.slug}`, "_blank")} title="Ver formulário público">
                                            <ExternalLink className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateMutation.mutate(form)} title="Duplicar">
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-8 w-8 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                                            onClick={() => { if (window.confirm("Certeza que deseja excluir este formulário?")) deleteMutation.mutate(form.id) }}
                                            title="Excluir"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                    Nenhum formulário encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Novo Formulário</DialogTitle>
                        <DialogDescription>Depois de criado, edite os campos e o design no editor.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="form-name">Nome do Formulário</Label>
                            <Input id="form-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Pós HC" />
                        </div>
                        <div className="space-y-2">
                            <Label>Curso vinculado (opcional)</Label>
                            <Select value={newCourseId} onValueChange={setNewCourseId}>
                                <SelectTrigger><SelectValue placeholder="Sem curso vinculado" /></SelectTrigger>
                                <SelectContent>
                                    {courses?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Canal de Aquisição</Label>
                            <Select value={newSourceId} onValueChange={setNewSourceId}>
                                <SelectTrigger><SelectValue placeholder="Selecione o canal..." /></SelectTrigger>
                                <SelectContent>
                                    {sources?.map((s) => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={() => { setSaving(true); createMutation.mutate() }} disabled={saving}>
                            {saving ? "Criando..." : "Criar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
