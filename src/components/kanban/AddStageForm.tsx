import { useState } from "react"
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import { Stage } from "@/types/database"

const formSchema = z.object({
    name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }),
})

interface AddStageFormProps {
    stages: Stage[]
}

export function AddStageForm({ stages }: AddStageFormProps) {
    const queryClient = useQueryClient()
    const [isOpen, setIsOpen] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: { name: "" },
    })

    const addStageMutation = useMutation({
        mutationFn: async (values: z.infer<typeof formSchema>) => {
            const maxOrder = (stages || []).reduce((max, stage) => Math.max(max, stage.order), 0)
            const { error } = await supabase
                .from('stages')
                .insert({ name: values.name, order: maxOrder + 1 })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stages'] })
            showSuccess("Novo estágio criado com sucesso!")
            setIsOpen(false)
            form.reset()
        },
        onError: (error: any) => {
            showError(`Erro ao criar estágio: ${error.message}`)
        }
    })

    function onSubmit(values: z.infer<typeof formSchema>) {
        addStageMutation.mutate(values)
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">
                    + Adicionar Coluna
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Adicionar Nova Coluna</DialogTitle>
                    <DialogDescription>
                        Digite o nome para o novo estágio do seu funil.
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
                                        <Input placeholder="Ex: Proposta Enviada" {...field} autoFocus />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                            <Button type="submit" disabled={addStageMutation.isPending}>
                                {addStageMutation.isPending ? "Criando..." : "Criar Estágio"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
