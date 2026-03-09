import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Lead, User, LeadSource, Stage, Course } from "@/types/database"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuth } from "@/hooks/use-auth"
import { useState } from "react"
import { LossReasonDialog } from "./LossReasonDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AddLeadNoteForm } from "./AddLeadNoteForm"
import { LeadHistoryFeed } from "./LeadHistoryFeed"
import { WideChatHistory } from "./WideChatHistory"
import { MessageCircle } from "lucide-react"

const formSchema = z.object({
    nome_completo: z.string().min(2, "O nome é obrigatório."),
    email: z.string().email("E-mail inválido.").or(z.literal("")).optional(),
    telefone: z.string().min(1, "O telefone é obrigatório."),
    valor_oportunidade: z.coerce.number().min(0, "O valor deve ser positivo."),
    observacoes: z.string().nullable().optional(),
    temperatura: z.enum(['frio', 'morno', 'quente']).nullable().optional(),
    assigned_to_id: z.string().nullable().optional(),
    source_id: z.coerce.number().nullable().optional(),
    curso_interesse: z.coerce.number().nullable().optional(),
})

interface EditLeadDialogProps {
    lead: Lead
    stages: Stage[]
    children?: React.ReactNode
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function EditLeadDialog({ lead, stages, children, isOpen, onOpenChange }: EditLeadDialogProps) {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()
    const [isLossReasonOpen, setIsLossReasonOpen] = useState(false)
    const [localSaving, setLocalSaving] = useState(false)

    const { data: users, isLoading: isLoadingUsers } = useQuery<User[]>({
        queryKey: ['users'],
        queryFn: async () => {
            const { data, error } = await supabase.from('profiles').select('*')
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const { data: leadSources, isLoading: isLoadingSources } = useQuery<LeadSource[]>({
        queryKey: ['lead_sources'],
        queryFn: async () => {
            const { data, error } = await supabase.from('lead_sources').select('*')
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const { data: courses, isLoading: isLoadingCourses } = useQuery<Course[]>({
        queryKey: ['courses'],
        queryFn: async () => {
            const { data, error } = await supabase.from('courses').select('*')
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        values: {
            nome_completo: lead.nome_completo,
            email: lead.email || "",
            telefone: lead.telefone || "",
            valor_oportunidade: lead.valor_oportunidade || 0,
            observacoes: lead.observacoes || "",
            temperatura: lead.temperatura || 'frio',
            assigned_to_id: lead.assigned_to_id || undefined,
            source_id: lead.source_id || undefined,
            curso_interesse: lead.curso_interesse || undefined,
        },
    })


    const moveLeadMutation = useMutation({
        mutationFn: async (newStageId: number) => {
            const { error } = await supabase
                .from('leads')
                .update({ stage_id: newStageId, stage_entry_date: new Date().toISOString() })
                .eq('id', lead.id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads', 'lead_history'] });
            showSuccess("Lead movido com sucesso!");
            onOpenChange(false);
        },
        onError: (error: any) => showError(`Erro ao mover lead: ${error.message}`)
    });

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (localSaving) return
        setLocalSaving(true)

        try {
            const { error } = await supabase
                .from('leads')
                .update({
                    ...values,
                    updated_at: new Date().toISOString()
                })
                .eq('id', lead.id);

            if (error) throw error;

            showSuccess("Lead atualizado com sucesso!");
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            onOpenChange(false);
        } catch (err: any) {
            showError(`Erro ao salvar lead: ${err.message}`);
        } finally {
            setLocalSaving(false);
        }
    }

    const wonStage = stages.find(s => s.name.toLowerCase() === 'matriculado');
    const lostStage = stages.find(s => s.name.toLowerCase().includes('perdido'));
    const currentStage = stages.find(s => s.id === lead.stage_id);
    const isFinalStage = currentStage?.name.toLowerCase().includes('matriculado') || currentStage?.name.toLowerCase().includes('perdido');

    const deleteLeadMutation = useMutation({
        mutationFn: async () => {
            const { error } = await supabase.from('leads').delete().eq('id', lead.id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            showSuccess("Lead excluído com sucesso!");
            onOpenChange(false);
        },
        onError: (error: any) => showError(`Erro ao excluir lead: ${error.message}`)
    });

    const handleDelete = () => {
        if (window.confirm("Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita.")) {
            deleteLeadMutation.mutate();
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                {children && <DialogTrigger asChild>{children}</DialogTrigger>}
                <DialogContent className="sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Lead: {lead.nome_completo}</DialogTitle>
                        <DialogDescription>Gerencie as informações e o histórico do lead.</DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="details" className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="details">Detalhes</TabsTrigger>
                            <TabsTrigger value="chat">Conversas</TabsTrigger>
                            <TabsTrigger value="history">Histórico</TabsTrigger>
                        </TabsList>
                        <TabsContent value="details">
                            <div className="py-4 max-h-[60vh] overflow-y-auto pr-4">
                                <Form {...form}>
                                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                        <FormField control={form.control} name="nome_completo" render={({ field }) => (
                                            <FormItem><FormLabel>Nome Completo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                        )} />
                                        <FormField control={form.control} name="email" render={({ field }) => (
                                            <FormItem><FormLabel>E-mail</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                        )} />
                                        <FormField control={form.control} name="telefone" render={({ field }) => (
                                            <FormItem><FormLabel>Telefone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                        )} />
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <FormField control={form.control} name="valor_oportunidade" render={({ field }) => (
                                                <FormItem><FormLabel>Valor da Oportunidade</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                                            )} />
                                            <FormField control={form.control} name="temperatura" render={({ field }) => (
                                                <FormItem><FormLabel>Temperatura</FormLabel><Select onValueChange={field.onChange} value={field.value || 'frio'}><FormControl><SelectTrigger><SelectValue placeholder="Selecione a temperatura" /></SelectTrigger></FormControl><SelectContent><SelectItem value="frio">Frio</SelectItem><SelectItem value="morno">Morno</SelectItem><SelectItem value="quente">Quente</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                                            )} />
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="curso_interesse"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Curso de Interesse</FormLabel>
                                                    <Select
                                                        onValueChange={(v) => field.onChange(v === "none" ? null : parseInt(v))}
                                                        value={field.value?.toString() || "none"}
                                                        disabled={isLoadingCourses}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Selecione o curso..." />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="none">Nenhum</SelectItem>
                                                            {courses?.map(course => (
                                                                <SelectItem key={course.id} value={course.id.toString()}>
                                                                    {course.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField control={form.control} name="assigned_to_id" render={({ field }) => (
                                            <FormItem><FormLabel>Atendente Responsável</FormLabel><Select onValueChange={(v) => field.onChange(v === "unassigned" ? null : v)} value={field.value || "unassigned"} disabled={isLoadingUsers}><FormControl><SelectTrigger><SelectValue placeholder="Ninguém atribuído" /></SelectTrigger></FormControl><SelectContent><SelectItem value="unassigned">Ninguém atribuído</SelectItem>{users?.filter(u => u.role !== 'visualizador').map(atendente => (<SelectItem key={atendente.id} value={atendente.id}><div className="flex items-center gap-2"><Avatar className="h-6 w-6"><AvatarImage src={atendente.avatar_url || undefined} alt={atendente.full_name} /><AvatarFallback>{atendente.full_name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><span>{atendente.full_name}</span></div></SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>
                                        )} />
                                        <FormField control={form.control} name="source_id" render={({ field }) => (
                                            <FormItem><FormLabel>Canal de Aquisição</FormLabel><Select onValueChange={(v) => field.onChange(v === "none" ? null : parseInt(v))} value={field.value?.toString() || "none"} disabled={isLoadingSources}><FormControl><SelectTrigger><SelectValue placeholder="Selecione o canal..." /></SelectTrigger></FormControl><SelectContent><SelectItem value="none">Nenhum</SelectItem>{leadSources?.map(source => (<SelectItem key={source.id} value={source.id.toString()}>{source.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>
                                        )} />

                                        <FormField control={form.control} name="observacoes" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Observações</FormLabel>
                                                <FormControl>
                                                    <textarea
                                                        className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                        {...field}
                                                        value={field.value || ""}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />

                                        <DialogFooter className="pt-4 flex justify-between items-center sm:justify-between">
                                            <Button type="button" variant="destructive" size="sm" onClick={handleDelete} title="Excluir Lead permanentemente">
                                                Excluir
                                            </Button>
                                            <div className="flex gap-2">
                                                {!isFinalStage && (
                                                    <>
                                                        {lostStage && <Button type="button" variant="secondary" onClick={() => setIsLossReasonOpen(true)}>Marcar como Perda</Button>}
                                                        {wonStage && <Button type="button" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => moveLeadMutation.mutate(wonStage.id)} disabled={moveLeadMutation.isPending}>Marcar como Ganho</Button>}
                                                    </>
                                                )}
                                                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                                                <Button type="submit" disabled={localSaving}>{localSaving ? "Salvando..." : "Salvar"}</Button>
                                            </div>
                                        </DialogFooter>
                                    </form>
                                </Form>
                            </div>
                        </TabsContent>
                        <TabsContent value="chat">
                            <div className="py-2">
                                {lead.widechat_contact_id ? (
                                    <WideChatHistory widechatContactId={lead.widechat_contact_id} />
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground bg-slate-50 dark:bg-slate-900 rounded-md border border-dashed text-center">
                                        <MessageCircle className="h-10 w-10 mb-2 opacity-20" />
                                        <p>Este lead não possui identificador do Wide Chat.</p>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                        <TabsContent value="history">
                            <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-4">
                                <AddLeadNoteForm leadId={lead.id} />
                                <LeadHistoryFeed lead={lead} stages={stages} users={users || []} courses={courses || []} leadSources={leadSources || []} />
                            </div>
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>
            {lostStage && (
                <LossReasonDialog
                    isOpen={isLossReasonOpen}
                    onOpenChange={setIsLossReasonOpen}
                    onSuccess={() => { setIsLossReasonOpen(false); onOpenChange(false); }}
                    leadId={lead.id}
                    lostStageId={lostStage.id}
                />
            )}
        </>
    )
}
