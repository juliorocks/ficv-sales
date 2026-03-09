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
    FormDescription,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Stage } from "@/types/database"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog"

const hexColorRegex = /^#([0-9a-f]{3}){1,2}$/i;

const formSchema = z.object({
    name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }),
    title_color: z.string()
        .refine((val) => val === '' || hexColorRegex.test(val), {
            message: "Deve ser um código de cor hexadecimal válido (ex: #RRGGBB).",
        })
        .optional(),
    bg_color: z.string()
        .refine((val) => val === '' || hexColorRegex.test(val), {
            message: "Deve ser um código de cor hexadecimal válido (ex: #RRGGBB).",
        })
        .optional(),
})

interface EditStageFormProps {
    stage: Stage
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function EditStageForm({ stage, isOpen, onOpenChange }: EditStageFormProps) {
    const queryClient = useQueryClient()

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        values: {
            name: stage.name || "",
            title_color: stage.title_color || "",
            bg_color: stage.bg_color || "",
        },
    })

    const updateStageMutation = useMutation({
        mutationFn: async (values: z.infer<typeof formSchema>) => {
            const { error } = await supabase
                .from('stages')
                .update({
                    name: values.name,
                    title_color: values.title_color || null,
                    bg_color: values.bg_color || null,
                })
                .eq('id', stage.id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stages'] })
            showSuccess("Estágio atualizado com sucesso!")
            onOpenChange(false)
        },
        onError: (error: any) => {
            showError(`Erro ao atualizar estágio: ${error.message}`)
        }
    })

    function onSubmit(values: z.infer<typeof formSchema>) {
        updateStageMutation.mutate(values)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Editar Estágio: {stage.name}</DialogTitle>
                    <DialogDescription>
                        Personalize o nome e as cores deste estágio.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nome do Estágio</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Ex: Contato Inicial" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="bg_color"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Cor de Fundo da Coluna</FormLabel>
                                    <div className="flex items-center gap-2">
                                        <FormControl>
                                            <Input
                                                type="color"
                                                {...field}
                                                value={field.value || '#ffffff'}
                                                className="p-1 h-10 w-12"
                                            />
                                        </FormControl>
                                        <Input
                                            placeholder="#f0f9ff"
                                            {...field}
                                            value={field.value || ''}
                                            className="flex-1"
                                        />
                                    </div>
                                    <FormDescription>
                                        Escolha uma cor ou insira um valor hexadecimal.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="title_color"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Cor do Título</FormLabel>
                                    <div className="flex items-center gap-2">
                                        <FormControl>
                                            <Input
                                                type="color"
                                                {...field}
                                                value={field.value || '#000000'}
                                                className="p-1 h-10 w-12"
                                            />
                                        </FormControl>
                                        <Input
                                            placeholder="#1e293b"
                                            {...field}
                                            value={field.value || ''}
                                            className="flex-1"
                                        />
                                    </div>
                                    <FormDescription>
                                        Escolha uma cor ou insira um valor hexadecimal.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit" disabled={updateStageMutation.isPending}>
                                {updateStageMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
