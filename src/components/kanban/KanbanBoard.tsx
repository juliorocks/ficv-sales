import { useState, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { DragDropContext, DropResult, Droppable } from "@hello-pangea/dnd"
import { supabase } from "@/lib/supabase"
import { Lead, Stage, User, LeadSource, Course } from "@/types/database"
import { KanbanColumn } from "./KanbanColumn"
import { KanbanSkeleton } from "./KanbanSkeleton"
import { showError, showSuccess } from "@/utils/toast"
import { KanbanSquare } from "lucide-react"
import { AddStageForm } from "./AddStageForm"
import { useAuth } from "@/hooks/use-auth"
import { withTimeout } from "@/utils/withTimeout"

export function KanbanBoard({ searchTerm, assigneeFilter = 'all' }: { searchTerm: string; assigneeFilter?: string }): JSX.Element {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()
    const [columns, setColumns] = useState<Record<string, Lead[]>>({})
    const [orderedStages, setOrderedStages] = useState<Stage[]>([])

    const { data: stages, isLoading: isLoadingStages, error: stagesError, refetch: refetchStages } = useQuery<Stage[]>({
        queryKey: ['stages'],
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.from('stages').select('*').order('order'), 20000, "Carregar as etapas")
            if (error) throw error
            return data
        },
        enabled: !isAuthLoading && !!user,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    })

    const { data: leads, isLoading: isLoadingLeads, error: leadsError, refetch: refetchLeads } = useQuery<Lead[]>({
        queryKey: ['leads'],
        queryFn: async () => {
            const { data, error } = await withTimeout(
                supabase
                    .from('leads')
                    .select('*')
                    .order('data_entrada', { ascending: false })
                    .limit(500), // Cap: a coluna renderiza cada card com um EditLeadDialog
                                  // completo; acima disso o browser trava. Ver paginação
                                  // por coluna em KanbanColumn (visibleCount).
                20000,
                "Carregar os leads",
            );

            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
        // No polling: the realtime subscription below already invalidates on any
        // change. Polling re-ran a full-table sort every minute and starved the DB.
        staleTime: 60 * 1000,
        retry: 1,
    })

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

    // Deixa o cache de motivos de perda quente ANTES de qualquer card abrir o
    // LossReasonDialog — a query de lá (mesma queryKey) disparava no mount sem gate
    // de auth e falhava correndo com o refresh de token.
    useQuery<{ id: number; motivo: string }[]>({
        queryKey: ['motivos_perda'],
        queryFn: async () => {
            const { data, error } = await supabase.from('motivos_perda').select('id, motivo').order('motivo')
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
        staleTime: 10 * 60 * 1000,
    })

    // Leads com mensagem do cliente ainda sem resposta (badge piscante no card).
    // A view devolve só as linhas com pending_count > 0.
    const { data: pendingReplies } = useQuery<{ lead_id: number; pending_count: number }[]>({
        queryKey: ['lead_pending_replies'],
        queryFn: async () => {
            const { data, error } = await withTimeout(
                supabase.from('lead_pending_replies').select('lead_id, pending_count'),
                20000,
                "Carregar os alertas",
            )
            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
        staleTime: 60 * 1000,
        // 90s: a subscription realtime de widechat_messages já invalida na hora que
        // chega mensagem nova; o poll é só rede de segurança. Não roda com a aba oculta.
        refetchInterval: 90 * 1000,
        retry: 1,
    })

    const pendingByLead = useMemo(() => {
        const m = new Map<number, number>()
        for (const r of pendingReplies || []) m.set(r.lead_id, r.pending_count)
        return m
    }, [pendingReplies])

    const filteredLeads = useMemo(() => {
        if (!leads) return [];
        let out = leads;

        // filtro de atendente — vale pro funil inteiro, em todas as colunas de uma vez.
        // Filtrando por UM agente específico, os leads SEM atendente continuam
        // aparecendo — é a fila compartilhada de Entrada, qualquer agente precisa ver
        // pra poder "Atender"; escondê-los junto faria leads novos sumirem da tela.
        if (assigneeFilter === 'unassigned') {
            out = out.filter(lead => !lead.assigned_to_id);
        } else if (assigneeFilter && assigneeFilter !== 'all') {
            out = out.filter(lead => lead.assigned_to_id === assigneeFilter || !lead.assigned_to_id);
        }

        const term = searchTerm.toLowerCase().trim();
        if (term) {
            out = out.filter(lead => {
                const inName = lead.nome_completo.toLowerCase().includes(term);
                const inEmail = (lead.email || '').toLowerCase().includes(term);
                const inPhone = (lead.telefone || '').toLowerCase().includes(term);
                return inName || inEmail || inPhone;
            });
        }
        return out;
    }, [leads, searchTerm, assigneeFilter]);

    useEffect(() => {
        if (stages) {
            setOrderedStages([...stages].sort((a, b) => a.order - b.order));
        }
        if (stages && filteredLeads) {
            const newColumns: Record<string, Lead[]> = {}
            stages.forEach(stage => {
                newColumns[stage.id] = filteredLeads
                    .filter(lead => lead.stage_id === stage.id)
                    .sort((a, b) => new Date(a.data_entrada).getTime() - new Date(b.data_entrada).getTime())
            })
            setColumns(newColumns)
        }
    }, [stages, filteredLeads])

    // Realtime subscription for Leads
    useEffect(() => {
        if (isAuthLoading || !user) return;

        const channel = supabase
            .channel('public:leads-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'leads'
                },
                (payload) => {
                    console.log('Realtime change detected in leads:', payload);
                    queryClient.invalidateQueries({ queryKey: ['leads'] });
                    queryClient.invalidateQueries({ queryKey: ['lead_pending_replies'] });

                    // Show a subtle notification if a new lead enters
                    if (payload.eventType === 'INSERT') {
                        // @ts-ignore
                        const leadName = payload.new?.nome_completo || 'Novo Lead';
                        showSuccess(`Novo lead: ${leadName}`);
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'widechat_messages' },
                () => queryClient.invalidateQueries({ queryKey: ['lead_pending_replies'] }),
            )
            .subscribe((status) => {
                console.log('Realtime subscription status:', status);
            });

        return () => {
            supabase.removeChannel(channel);
        }
    }, [user, isAuthLoading, queryClient])

    const updateLeadStageMutation = useMutation({
        mutationFn: async ({ leadId, newStageId }: { leadId: number, newStageId: number }) => {
            const { error } = await supabase.from('leads').update({ stage_id: newStageId, stage_entry_date: new Date().toISOString() }).eq('id', leadId)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            showSuccess("Lead movido com sucesso!")
        },
        onError: () => {
            showError("Erro ao mover o lead.");
            queryClient.invalidateQueries({ queryKey: ['leads'] });
        }
    })

    const updateStageOrderMutation = useMutation({
        mutationFn: async (updates: { id: number; order: number }[]) => {
            // @ts-ignore
            const { error } = await supabase.from('stages').upsert(updates);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stages'] });
        },
        onError: (error: any) => {
            showError(`Erro ao reordenar colunas: ${error.message}`);
            queryClient.invalidateQueries({ queryKey: ['stages'] });
        }
    });

    const onDragEnd = (result: DropResult) => {
        const { source, destination, type } = result

        if (!destination) return

        if (type === 'COLUMN' && user?.role === 'admin') {
            const newOrderedStages = Array.from(orderedStages);
            const [movedStage] = newOrderedStages.splice(source.index, 1);
            newOrderedStages.splice(destination.index, 0, movedStage);

            setOrderedStages(newOrderedStages);

            const orderUpdates = newOrderedStages.map((stage, index) => ({
                id: stage.id,
                order: index,
            }));
            updateStageOrderMutation.mutate(orderUpdates);
            return;
        }

        if (type === 'CARD') {
            const startColId = source.droppableId
            const endColId = destination.droppableId

            if (startColId === endColId && source.index === destination.index) return

            const leadId = parseInt(result.draggableId)
            const newColumns = { ...columns }
            const startColLeads = Array.from(newColumns[startColId])
            const [movedLead] = startColLeads.splice(source.index, 1)
            newColumns[startColId] = startColLeads

            const endColLeads = startColId === endColId ? startColLeads : Array.from(newColumns[endColId])
            endColLeads.splice(destination.index, 0, movedLead)
            newColumns[endColId] = endColLeads

            setColumns(newColumns)

            if (startColId !== endColId) {
                updateLeadStageMutation.mutate({ leadId, newStageId: parseInt(endColId) })
            }
        }
    }

    if (isAuthLoading || isLoadingStages || isLoadingLeads || isLoadingUsers || isLoadingSources || isLoadingCourses) {
        return <KanbanSkeleton />
    }

    if (stagesError || leadsError) {
        const msg = (leadsError as Error)?.message || (stagesError as Error)?.message || "";
        return (
            <div className="text-center py-16">
                <KanbanSquare className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Não consegui carregar o funil</h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
                    {/demorou demais|sess/i.test(msg)
                        ? "A conexão com o servidor demorou demais (sessão pode ter expirado). Tente de novo ou recarregue a página."
                        : "Houve um erro ao buscar os dados. Tente de novo."}
                </p>
                <div className="mt-4 flex gap-2 justify-center">
                    <button
                        onClick={() => { refetchStages(); refetchLeads(); }}
                        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
                    >
                        Tentar de novo
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted"
                    >
                        Recarregar a página
                    </button>
                </div>
            </div>
        );
    }

    if (!stages || stages.length === 0) {
        return (
            <div className="text-center py-10">
                <KanbanSquare className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-xl font-semibold text-foreground">Nenhum estágio encontrado</h3>
                <p className="mt-2 text-sm text-muted-foreground">Para começar, crie os estágios do seu funil de vendas.</p>
                <div className="mt-4">
                    {user?.role === 'admin' && <AddStageForm stages={stages || []} />}
                </div>
            </div>
        )
    }

    return (
        <div className="min-w-0 overflow-x-clip">
            <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="board" type="COLUMN" direction="horizontal" isDropDisabled={user?.role !== 'admin'}>
                    {(provided) => (
                        <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex overflow-x-auto items-start gap-5 pb-4 -mx-8 px-8 custom-scrollbar"
                        >
                            {orderedStages.map((stage, index) => (
                                <KanbanColumn
                                    key={stage.id}
                                    stage={stage}
                                    leads={columns[stage.id] || []}
                                    users={users || []}
                                    leadSources={leadSources || []}
                                    courses={courses || []}
                                    index={index}
                                    allStages={orderedStages}
                                    pendingByLead={pendingByLead}
                                />
                            ))}
                            {provided.placeholder}
                            {user?.role === 'admin' && (
                                <div className="flex-shrink-0">
                                    <AddStageForm stages={stages} />
                                </div>
                            )}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>
        </div>
    )
}
