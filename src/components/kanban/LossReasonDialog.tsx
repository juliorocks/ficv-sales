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
import { useAuth } from "@/hooks/use-auth"
import { withTimeout } from "@/utils/withTimeout"

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

    // Só busca quando o diálogo de perda ABRE de fato E a sessão já resolveu — antes
    // a query disparava no mount (o componente fica montado junto com o EditLeadDialog)
    // e corria com o refresh de token: dava 401 "JWT expired" ou estolava até o
    // timeout e mostrava "não consegui carregar". O KanbanBoard também já deixa essa
    // mesma queryKey quente com um fetch propriamente gated.
    const { data: reasons, isLoading, isError, refetch } = useQuery<LossReason[]>({
        queryKey: ["motivos_perda"],
        queryFn: async () => {
            // timeout: se a sessão do navegador expirou, o supabase-js pode segurar a
            // request esperando um refresh de token que não vem — melhor falhar rápido
            // e mostrar "tentar de novo" do que travar em "Carregando..." pra sempre.
            try {
                const res = await Promise.race([
                    supabase.from("motivos_perda").select("id, motivo").order("motivo"),
                    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
                ])
                const { data, error } = res as { data: LossReason[] | null; error: any }
                if (error) throw error
                return data || []
            } catch (e) {
                // força um refresh de token antes do retry do React Query resolver o
                // caso "sessão velha" sem o usuário precisar dar F5.
                await supabase.auth.getSession().catch(() => { })
                throw e
            }
        },
        enabled: isOpen && !isAuthLoading && !!user,
        staleTime: 10 * 60_000,
        retry: 2,
    })

    const form = useForm({
        resolver: zodResolver(formSchema),
    })

    const moveLeadMutation = useMutation({
        mutationFn: async (values: FormValues) => {
            await withTimeout(supabase.auth.getSession(), 8000, "A sessão").catch(() => { });
            const { data, error } = await withTimeout(
                supabase
                    .from('leads')
                    .update({
                        stage_id: lostStageId,
                        stage_entry_date: new Date().toISOString(),
                        motivo_perda_id: values.motivo_perda_id,
                    })
                    .eq('id', leadId)
                    .select('id'),
                15000,
                "Marcar a perda",
            );
            if (error) throw error;
            if (!data || data.length === 0) {
                await supabase.auth.getSession().catch(() => { });
                throw new Error("Não foi possível salvar (sessão expirada). Recarregue a página.");
            }
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
                                    {isError && (
                                        <p className="text-xs text-destructive">
                                            Não consegui carregar os motivos.{' '}
                                            <button type="button" className="underline" onClick={() => refetch()}>tentar de novo</button>
                                            {' '}— se persistir, atualize a página (a sessão pode ter expirado).
                                        </p>
                                    )}
                                    {!isLoading && !isError && reasons !== undefined && reasons.length === 0 && (
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
