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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"

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

    // sem gate de auth: o RLS (is_staff) já garante a segurança. O gate anterior
    // (useAuth, que roda a checagem do zero em cada componente por não ser um contexto)
    // deixava o dropdown vazio enquanto a sessão não resolvia.
    const { data: reasons, isLoading } = useQuery<LossReason[]>({
        queryKey: ["motivos_perda"],
        queryFn: async () => {
            const { data, error } = await supabase.from("motivos_perda").select("id, motivo").order("motivo")
            if (error) throw error
            return data || []
        },
        staleTime: 10 * 60_000,
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
                                    <FormControl>
                                        <select
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                            value={(field.value as any)?.toString() ?? ''}
                                            onChange={(e) => field.onChange(e.target.value)}
                                            disabled={isLoading}
                                        >
                                            <option value="" disabled>{isLoading ? 'Carregando motivos...' : 'Selecione um motivo...'}</option>
                                            {reasons?.map(reason => (
                                                <option key={reason.id} value={String(reason.id)}>{reason.motivo}</option>
                                            ))}
                                        </select>
                                    </FormControl>
                                    {!isLoading && (!reasons || reasons.length === 0) && (
                                        <p className="text-xs text-destructive">Nenhum motivo cadastrado. Peça pra um admin cadastrar em Motivos de Perda.</p>
                                    )}
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
