import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import { useAuth } from "@/hooks/use-auth"

const formSchema = z.object({
    note: z.string().min(1, "A nota não pode estar vazia."),
})

interface AddLeadNoteFormProps {
    leadId: number
}

export function AddLeadNoteForm({ leadId }: AddLeadNoteFormProps) {
    const queryClient = useQueryClient()
    const { user } = useAuth()

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: { note: "" },
    })

    const addNoteMutation = useMutation({
        mutationFn: async (values: z.infer<typeof formSchema>) => {
            const { error } = await supabase.from("lead_notes").insert({
                lead_id: leadId,
                note: values.note,
                created_by: user?.id,
            })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lead_notes", leadId] })
            showSuccess("Nota adicionada com sucesso!")
            form.reset()
        },
        onError: (error: any) => {
            showError(`Erro ao adicionar nota: ${error.message}`)
        },
    })

    function onSubmit(values: z.infer<typeof formSchema>) {
        addNoteMutation.mutate(values)
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-start gap-2">
                <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                        <FormItem className="flex-grow">
                            <FormControl>
                                <Textarea placeholder="Adicionar uma nota..." {...field} rows={2} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit" disabled={addNoteMutation.isPending}>
                    {addNoteMutation.isPending ? "..." : "Salvar"}
                </Button>
            </form>
        </Form>
    )
}
