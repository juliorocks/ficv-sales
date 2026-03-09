import { Droppable, Draggable } from "@hello-pangea/dnd";
import { Lead, Stage, User, LeadSource, Course } from "@/types/database";
import { LeadCard } from "./LeadCard";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Pencil, Trash2, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { EditStageForm } from "./EditStageForm";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { showError, showSuccess } from "@/utils/toast";
import { KanbanSort } from "./KanbanSort";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";

interface KanbanColumnProps {
    stage: Stage;
    leads: Lead[];
    users: User[];
    leadSources: LeadSource[];
    index: number;
    allStages: Stage[];
    courses: Course[];
}

type SortOption = {
    key: string;
    label: string;
    direction: 'asc' | 'desc';
};

export function KanbanColumn({ stage, leads, users, leadSources, courses, index, allStages }: KanbanColumnProps) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [localSearchTerm, setLocalSearchTerm] = useState('');
    const debouncedLocalSearchTerm = useDebounce(localSearchTerm, 300);
    const [sortBy, setSortBy] = useState<SortOption>({
        key: 'stage_entry_date',
        label: 'Data no Estágio',
        direction: 'desc'
    });

    const locallyFilteredLeads = useMemo(() => {
        if (!debouncedLocalSearchTerm.trim()) {
            return leads;
        }
        const term = debouncedLocalSearchTerm.toLowerCase();
        return leads.filter(lead =>
            lead.nome_completo.toLowerCase().includes(term) ||
            (lead.email && lead.email.toLowerCase().includes(term)) ||
            (lead.telefone && lead.telefone.toLowerCase().includes(term))
        );
    }, [leads, debouncedLocalSearchTerm]);

    const sortedLeads = useMemo(() => {
        const tempOrder: { [key: string]: number } = { 'quente': 3, 'morno': 2, 'frio': 1 };

        const sorted = [...locallyFilteredLeads].sort((a, b) => {
            const key = sortBy.key as keyof Lead;
            let aValue: any;
            let bValue: any;

            if (key === 'temperatura') {
                aValue = tempOrder[a.temperatura || ''] || 0;
                bValue = tempOrder[b.temperatura || ''] || 0;
            } else if (key === 'stage_entry_date' || key === 'data_entrada') {
                aValue = a[key] ? new Date(a[key]!).getTime() : 0;
                bValue = b[key] ? new Date(b[key]!).getTime() : 0;
            } else {
                aValue = (a as any)[key];
                bValue = (b as any)[key];
            }

            if (aValue === null || aValue === undefined) aValue = sortBy.direction === 'asc' ? Infinity : -Infinity;
            if (bValue === null || bValue === undefined) bValue = sortBy.direction === 'asc' ? Infinity : -Infinity;

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortBy.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            }

            if (aValue < bValue) return sortBy.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortBy.direction === 'asc' ? 1 : -1;

            return 0;
        });

        return sorted;
    }, [locallyFilteredLeads, sortBy]);

    const deleteStageMutation = useMutation({
        mutationFn: async (stageId: number) => {
            // @ts-ignore
            const { error } = await supabase.rpc('delete_stage_and_leads', { stage_id_to_delete: stageId });
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stages'] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            showSuccess("Coluna e leads associados foram excluídos.");
            setIsDeleteDialogOpen(false);
        },
        onError: (error: any) => {
            showError(`Erro ao excluir coluna: ${error.message}`);
        }
    });

    const totalValue = sortedLeads.reduce((sum, lead) => sum + (lead.valor_oportunidade || 0), 0);
    const formattedValue = totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
        <>
            <Draggable draggableId={`column-${stage.id}`} index={index} isDragDisabled={user?.role !== 'admin'}>
                {(provided) => (
                    <div
                        {...provided.draggableProps}
                        ref={provided.innerRef}
                        className="flex-1 min-w-[300px] rounded-lg bg-muted/50"
                    >
                        <div className="p-4">
                            <div {...provided.dragHandleProps} className={`flex justify-between items-start mb-4 ${user?.role === 'admin' ? 'cursor-grab' : ''}`}>
                                <div className="space-y-1">
                                    <h3 className="font-bold text-lg" style={{ color: stage.title_color || undefined }}>
                                        {stage.name}
                                    </h3>
                                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">{formattedValue}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium bg-primary/10 text-primary px-2 py-1 rounded-full">{sortedLeads.length}</span>
                                    {user?.role === 'admin' && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 cursor-pointer">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
                                                    <Pencil className="mr-2 h-4 w-4" />
                                                    <span>Editar</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)} className="text-red-600 focus:text-red-600">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    <span>Excluir</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between items-center mb-4 gap-2">
                                <div className="relative flex-grow">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                                    <Input
                                        placeholder="Buscar na coluna..."
                                        value={localSearchTerm}
                                        onChange={(e) => setLocalSearchTerm(e.target.value)}
                                        className="pl-10 h-10 bg-background text-foreground border-border focus:ring-primary"
                                    />
                                </div>
                                <KanbanSort sortBy={sortBy} onSortChange={setSortBy} />
                            </div>

                            <Droppable droppableId={String(stage.id)} type="CARD">
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        className={`min-h-[500px] transition-colors rounded-md p-1 ${snapshot.isDraggingOver ? 'bg-primary/10' : ''}`}
                                    >
                                        {sortedLeads.map((lead, index) => (
                                            <Draggable key={lead.id} draggableId={String(lead.id)} index={index}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        {...provided.dragHandleProps}
                                                        className={`${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
                                                    >
                                                        <LeadCard lead={lead} users={users} leadSources={leadSources} stages={allStages} courses={courses} />
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    </div>
                )}
            </Draggable>

            {user?.role === 'admin' && (
                <>
                    <EditStageForm
                        stage={stage}
                        isOpen={isEditDialogOpen}
                        onOpenChange={setIsEditDialogOpen}
                    />

                    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. Isso excluirá permanentemente a coluna
                                    "{stage.name}" e todos os <strong>{leads.length} leads</strong> contidos nela.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={() => deleteStageMutation.mutate(stage.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    Sim, excluir tudo
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            )}
        </>
    );
}
