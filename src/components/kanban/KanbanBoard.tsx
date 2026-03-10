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

export function KanbanBoard({ searchTerm }: { searchTerm: string }): JSX.Element {
    const queryClient = useQueryClient()
    const { user, isLoading: isAuthLoading } = useAuth()
    const [columns, setColumns] = useState<Record<string, Lead[]>>({})
    const [orderedStages, setOrderedStages] = useState<Stage[]>([])

    const { data: stages, isLoading: isLoadingStages, error: stagesError } = useQuery<Stage[]>({
        queryKey: ['stages'],
        queryFn: async () => {
            const { data, error } = await supabase.from('stages').select('*').order('order')
            if (error) throw error
            return data
        },
        enabled: !isAuthLoading && !!user,
        refetchInterval: 30000, // Refetch every 30 seconds
    })

    const { data: leads, isLoading: isLoadingLeads, error: leadsError } = useQuery<Lead[]>({
        queryKey: ['leads'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('leads')
                .select('*')
                .order('data_entrada', { ascending: false })
                .limit(2000); // Fetch the 2000 most recent leads to prevent slowdown

            if (error) throw error
            return data || []
        },
        enabled: !isAuthLoading && !!user,
        refetchInterval: 60000, // Reduced polling frequency to 1 minute
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

    const filteredLeads = useMemo(() => {
        if (!leads) return [];
        if (!searchTerm.trim()) return leads;

        const term = searchTerm.toLowerCase().trim();
        return leads.filter(lead => {
            const inName = lead.nome_completo.toLowerCase().includes(term);
            const inEmail = (lead.email || '').toLowerCase().includes(term);
            const inPhone = (lead.telefone || '').toLowerCase().includes(term);
            return inName || inEmail || inPhone;
        });
    }, [leads, searchTerm]);

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
                () => {
                    queryClient.invalidateQueries({ queryKey: ['leads'] });
                }
            )
            .subscribe();

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
        return <div>Erro ao carregar dados.</div>
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
        <div>
            <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="board" type="COLUMN" direction="horizontal" isDropDisabled={user?.role !== 'admin'}>
                    {(provided) => (
                        <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex overflow-x-auto items-start gap-6 pb-4 -mx-6 px-6"
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
