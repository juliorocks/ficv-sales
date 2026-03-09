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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import { Stage, LeadSource, Course } from "@/types/database"
import { useAuth } from "@/hooks/use-auth"

const formSchema = z.object({
    nome_completo: z.string().min(2, "O nome é obrigatório."),
    email: z.string().email("E-mail inválido.").or(z.literal("")).optional(),
    telefone: z.string().min(1, "O telefone é obrigatório."),
    valor_oportunidade: z.coerce.number().min(0, "O valor deve ser positivo.").optional().default(0),
    observacoes: z.string().optional(),
    stage_id: z.coerce.number().min(1, "Selecione um estágio inicial."),
    curso_interesse: z.coerce.number().optional().nullable(),
    source_id: z.coerce.number().optional().nullable(),
})

interface NewLeadFormProps {
    onSuccess?: () => void;
}

export function NewLeadForm({ onSuccess }: NewLeadFormProps) {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()

    const { data: stages, isLoading: isLoadingStages } = useQuery<Stage[]>({
        queryKey: ['stages'],
        queryFn: async () => {
            const { data, error } = await supabase.from('stages').select('*').order('order')
            if (error) throw error
            return data
        },
        enabled: !isAuthLoading && !!user,
    })

    const { data: courses, isLoading: isLoadingCourses } = useQuery<Course[]>({
        queryKey: ['courses'],
        queryFn: async () => {
            const { data, error } = await supabase.from('courses').select('*')
            if (error) throw error
            return data
        },
        enabled: !isAuthLoading && !!user,
    })

    const { data: leadSources, isLoading: isLoadingSources } = useQuery<LeadSource[]>({
        queryKey: ['lead_sources'],
        queryFn: async () => {
            const { data, error } = await supabase.from('lead_sources').select('*')
            if (error) throw error
            return data
        },
        enabled: !isAuthLoading && !!user,
    })

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nome_completo: "",
            email: "",
            telefone: "",
            valor_oportunidade: 0,
            observacoes: "",
        },
    })

    const createLeadMutation = useMutation({
        mutationFn: async (values: z.infer<typeof formSchema>) => {
            const { data: leadData, error } = await supabase
                .from('leads')
                .insert({
                    ...values,
                    data_entrada: new Date().toISOString(),
                    stage_entry_date: new Date().toISOString(),
                    temperatura: 'frio',
                })
                .select()
                .single()
            if (error) throw error
            if (!leadData) throw new Error("A criação do lead falhou")

            const changes = Object.entries(values)
                .filter(([, value]) => value !== undefined && value !== null && value !== '')
                .map(([key, value]) => ({ field: key, from: null, to: value }))

            if (changes.length > 0) {
                await supabase.from('audit_logs').insert({
                    user_id: user?.id,
                    action: 'lead_created',
                    details: { lead_id: leadData.id, changes }
                })
            }
            return leadData
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['leads'] })
            queryClient.invalidateQueries({ queryKey: ['audit_logs', data.id] })
            showSuccess("Lead criado com sucesso!")
            form.reset()
            onSuccess?.()
        },
        onError: (error: any) => {
            showError(`Erro ao criar lead: ${error.message}`)
        }
    })

    function onSubmit(values: z.infer<typeof formSchema>) {
        createLeadMutation.mutate(values)
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome_completo" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Nome Completo</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                        <FormLabel>E-mail</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="telefone" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Telefone</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="valor_oportunidade" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Valor da Oportunidade (R$)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="stage_id" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Estágio Inicial</FormLabel>
                            <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                                <FormControl>
                                    <SelectTrigger disabled={isLoadingStages}>
                                        <SelectValue placeholder="Selecione o estágio..." />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {stages?.map(stage => (
                                        <SelectItem key={stage.id} value={stage.id.toString()}>{stage.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="curso_interesse" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Curso de Interesse</FormLabel>
                            <Select
                                onValueChange={(value) => {
                                    const courseId = parseInt(value);
                                    field.onChange(courseId);
                                    const selectedCourse = courses?.find(c => c.id === courseId);
                                    if (selectedCourse && selectedCourse.default_value != null) {
                                        const currentVal = form.getValues('valor_oportunidade');
                                        if (!currentVal || currentVal === 0) {
                                            form.setValue('valor_oportunidade', selectedCourse.default_value, {
                                                shouldDirty: true,
                                                shouldValidate: true
                                            });
                                        }
                                    }
                                }}
                                value={field.value?.toString()}
                            >
                                <FormControl>
                                    <SelectTrigger disabled={isLoadingCourses}>
                                        <SelectValue placeholder="Selecione o curso..." />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {courses?.map(course => (
                                        <SelectItem key={course.id} value={course.id.toString()}>{course.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
                <FormField control={form.control} name="source_id" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Canal de Aquisição</FormLabel>
                        <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                            <FormControl>
                                <SelectTrigger disabled={isLoadingSources}>
                                    <SelectValue placeholder="Selecione o canal..." />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {leadSources?.map(source => (
                                    <SelectItem key={source.id} value={source.id.toString()}>{source.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="observacoes" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Observações</FormLabel>
                        <FormControl><Textarea {...field} value={field.value || ""} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createLeadMutation.isPending}>
                    {createLeadMutation.isPending ? "Criando..." : "Criar Lead"}
                </Button>
            </form>
        </Form>
    )
}
