import { useState, useMemo } from "react"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
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
import { PlusCircle, Edit, Trash2, Search } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { Course } from "@/types/database"

const COURSE_TYPES = ["Graduação", "Pós-Graduação", "Curso Livre"]

export function CourseManagement() {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingCourse, setEditingCourse] = useState<Course | null>(null)
    const [formState, setFormState] = useState({ name: "", type: "", default_value: "" })
    const [searchTerm, setSearchTerm] = useState("")
    const [filterType, setFilterType] = useState<string>("all")
    const [localSaving, setLocalSaving] = useState(false)

    const { data: courses, isLoading } = useQuery<Course[]>({
        queryKey: ["courses"],
        queryFn: async () => {
            const { data, error } = await supabase.from("courses").select("*").order("name")
            if (error) {
                showError("Não foi possível carregar os cursos.")
                console.error(error)
                return []
            }
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const filteredCourses = useMemo(() => {
        if (!courses) return []

        let result = courses

        if (filterType !== "all") {
            result = result.filter(course => course.type === filterType)
        }

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase().trim()
            result = result.filter(course =>
                course.name.toLowerCase().includes(term) ||
                (course.type || "").toLowerCase().includes(term)
            )
        }

        return result
    }, [courses, searchTerm, filterType])

    const handleOpenDialog = (course: Course | null = null) => {
        setEditingCourse(course)
        setFormState(course ?
            { name: course.name, type: course.type || "", default_value: (course.default_value || 0).toString() } :
            { name: "", type: "", default_value: "" }
        )
        setIsDialogOpen(true)
        setLocalSaving(false)
    }

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const { error } = await supabase.from("courses").delete().eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["courses"] })
            showSuccess("Curso removido com sucesso!")
        },
        onError: (error: any) => showError(`Erro ao remover: ${error.message}`),
    })

    const mutation = useMutation({
        mutationFn: async (courseData: Partial<Course>) => {
            let error
            if (editingCourse) {
                ({ error } = await supabase.from("courses").update(courseData).eq("id", editingCourse.id))
            } else {
                ({ error } = await supabase.from("courses").insert(courseData))
            }
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["courses"] })
            showSuccess("Curso salvo com sucesso!")
            setIsDialogOpen(false)
        },
        onError: (error: any) => showError(`Erro ao salvar: ${error.message}`),
        onSettled: () => setLocalSaving(false)
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        const name = formState.name.trim()
        const type = formState.type.trim()
        if (!name || !type) {
            showError("Nome e tipo são obrigatórios")
            return
        }

        const cleanValue = formState.default_value.toString()
            .replace(/[R$\s.]/g, "")
            .replace(",", ".")
        const numValue = parseFloat(cleanValue) || 0

        setLocalSaving(true)
        mutation.mutate({ name, type, default_value: numValue })
    }

    if (isLoading || isAuthLoading) {
        return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando cursos...</div>
    }

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Gerenciar Cursos</h1>
                    <p className="text-sm text-muted-foreground">Crie e gerencie os cursos que podem ser oferecidos aos leads.</p>
                </div>
                <Button onClick={() => handleOpenDialog()} className="bg-primary hover:bg-primary/90">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Novo Curso
                </Button>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 py-2">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                    <Input
                        placeholder="Buscar curso..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 h-10"
                    />
                </div>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-full md:w-[200px] h-10">
                        <SelectValue placeholder="Todos os tipos" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os tipos</SelectItem>
                        {COURSE_TYPES.map(type => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="border rounded-xl bg-card/40 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Nome do Curso</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Valor Padrão</TableHead>
                            <TableHead className="text-right w-[120px]">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredCourses.length > 0 ? filteredCourses.map((course) => (
                            <TableRow key={course.id}>
                                <TableCell className="font-semibold text-foreground">{course.name}</TableCell>
                                <TableCell className="text-muted-foreground">{course.type}</TableCell>
                                <TableCell className="font-medium text-green-600 dark:text-green-400">
                                    {(course.default_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(course)} className="h-8 w-8">
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                                if (window.confirm("Certeza que deseja excluir este curso?")) {
                                                    deleteMutation.mutate(course.id)
                                                }
                                            }}
                                            className="h-8 w-8 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                                    Nenhum curso encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{editingCourse ? "Editar Curso" : "Novo Curso"}</DialogTitle>
                        <DialogDescription>
                            Preencha as informações do curso abaixo.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="course-name">Nome do Curso</Label>
                            <Input
                                id="course-name"
                                value={formState.name}
                                onChange={(e) => setFormState(s => ({ ...s, name: e.target.value }))}
                                placeholder="Ex: Graduação em Administração"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tipo do Curso</Label>
                            <Select
                                value={formState.type}
                                onValueChange={(value) => setFormState(s => ({ ...s, type: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione o tipo do curso" />
                                </SelectTrigger>
                                <SelectContent>
                                    {COURSE_TYPES.map(type => (
                                        <SelectItem key={type} value={type}>{type}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="course-value">Valor Padrão da Oportunidade (R$)</Label>
                            <Input
                                id="course-value"
                                type="text"
                                value={formState.default_value}
                                onChange={(e) => setFormState(s => ({ ...s, default_value: e.target.value }))}
                                placeholder="Ex: 5000"
                            />
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                            <Button type="submit" disabled={localSaving}>
                                {localSaving ? "Salvando..." : "Salvar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
