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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import { useAuth } from "@/hooks/use-auth"

const formSchema = z.object({
    motivo_perda_id: z.coerce.number().min(1, "A seleção do motivo é obrigatória."),
})

type FormValues = z.infer<typeof formSchema>

interface LossReason {
    id: number;
    motivo: string;
}

interface LossReasonDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    onSuccess: () => void
    leadId: number
    lostStageId: number
}

export function LossReasonDialog({ isOpen, onOpenChange, onSuccess, leadId, lostStageId }: LossReasonDialogProps) {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()

    const { data: reasons, isLoading } = useQuery<LossReason[]>({
        queryKey: ["motivos_perda"],
        queryFn: async () => {
            const { data, error } = await supabase.from("motivos_perda").select("*").order("motivo")
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
    })

    const form = useForm({
        resolver: zodResolver(formSchema),
    })

    const moveLeadMutation = useMutation({
        mutationFn: async (values: FormValues) => {
            const { error } = await supabase
                .from('leads')
                .update({
                    stage_id: lostStageId,
                    stage_entry_date: new Date().toISOString(),
                    motivo_perda_id: values.motivo_perda_id,
                })
                .eq('id', leadId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            showSuccess("Lead movido para 'Perdido' com sucesso!");
            onSuccess();
        },
        onError: (error: any) => showError(`Erro ao mover lead: ${error.message}`)
    });

    function onSubmit(values: FormValues) {
        moveLeadMutation.mutate(values)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Motivo da Perda</DialogTitle>
                    <DialogDescription>
                        Por favor, selecione o motivo pelo qual este lead foi perdido.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="motivo_perda_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Motivo</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value?.toString()}>
                                        <FormControl>
                                            <SelectTrigger disabled={isLoading || isAuthLoading}>
                                                <SelectValue placeholder="Selecione um motivo..." />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {reasons?.map(reason => (
                                                <SelectItem key={reason.id} value={reason.id.toString()}>{reason.motivo}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit" variant="destructive" disabled={moveLeadMutation.isPending}>
                                {moveLeadMutation.isPending ? "Confirmando..." : "Confirmar Perda"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
