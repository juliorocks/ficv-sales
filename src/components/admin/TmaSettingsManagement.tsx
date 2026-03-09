import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showError, showSuccess } from "@/utils/toast"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"

const TMA_SETTING_KEY = 'tma_goal_days'

export function TmaSettingsManagement() {
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const [goal, setGoal] = useState("")

    const { data: currentGoal, isLoading } = useQuery({
        queryKey: ['settings', TMA_SETTING_KEY],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', TMA_SETTING_KEY)
                .single()

            if (error && error.code !== 'PGRST116') throw error
            return data?.value || '3'
        },
    })

    useEffect(() => {
        if (currentGoal) {
            setGoal(currentGoal)
        }
    }, [currentGoal])

    const updateGoalMutation = useMutation({
        mutationFn: async (newGoal: string) => {
            const { error } = await supabase
                .from('app_settings')
                .upsert({ key: TMA_SETTING_KEY, value: newGoal }, { onConflict: 'key' })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings', TMA_SETTING_KEY] })
            showSuccess("Meta de TMA atualizada com sucesso!")
        },
        onError: (error: any) => {
            showError(`Erro ao atualizar a meta: ${error.message}`)
        }
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const numericGoal = parseFloat(goal)
        if (!isNaN(numericGoal) && numericGoal > 0) {
            updateGoalMutation.mutate(goal)
        } else {
            showError("Por favor, insira um número válido e positivo para a meta.")
        }
    }

    if (user?.role !== 'admin') {
        return <div className="p-8 text-center text-muted-foreground">Acesso restrito a administradores.</div>
    }

    return (
        <Card className="max-w-2xl mx-auto border-none shadow-xl bg-card/60 backdrop-blur-md">
            <CardHeader>
                <CardTitle className="text-2xl font-bold">Meta de Tempo Médio de Atendimento (TMA)</CardTitle>
                <CardDescription className="text-sm">
                    Defina a meta de dias para o tempo médio que um lead permanece com um atendente.
                    Essa meta será exibida como uma linha de referência nos gráficos do dashboard.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-4">
                        <Skeleton className="h-4 w-1/4" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                        <Skeleton className="h-10 w-32 mt-2 rounded-xl" />
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="tma-goal" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Meta de TMA (em dias)</Label>
                            <Input
                                id="tma-goal"
                                type="number"
                                step="0.1"
                                value={goal}
                                onChange={(e) => setGoal(e.target.value)}
                                placeholder="Ex: 3.5"
                                className="h-12 text-lg font-semibold bg-muted/20"
                            />
                        </div>
                        <Button type="submit" disabled={updateGoalMutation.isPending} className="w-full sm:w-auto min-w-[150px] bg-primary hover:bg-primary/90 h-12 shadow-lg shadow-primary/20">
                            {updateGoalMutation.isPending ? "Salvando..." : "Salvar Configuração"}
                        </Button>
                    </form>
                )}
            </CardContent>
        </Card>
    )
}
