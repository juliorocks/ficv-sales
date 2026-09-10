import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Lead, User, LeadSource, Stage, Course } from "@/types/database"
import { Button } from "@/components/ui/button"
import { ArrowRightLeft, Check, Clock, HandHelping, Mail, MessageCircle, Pencil, Phone, RefreshCw } from "lucide-react"
import { EditLeadDialog } from "./EditLeadDialog"
import { LossReasonDialog } from "./LossReasonDialog"
import { useTimeInStage } from "@/hooks/use-time-in-stage"
import { useState } from "react"
import { LeadTemperature } from "./LeadTemperature"
import { AssignedUser } from "./AssignedUser"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconPreview } from "../admin/IconPreview"
import { Badge } from "@/components/ui/badge"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { showError, showSuccess } from "@/utils/toast"
import { withTimeout } from "@/utils/withTimeout"

interface LeadCardProps {
    lead: Lead
    users: User[]
    leadSources: LeadSource[]
    stages: Stage[]
    courses: Course[]
    /** nº de mensagens do cliente ainda sem resposta (badge piscante) */
    pending?: number
}

export function LeadCard({ lead, users, leadSources, stages, courses, pending }: LeadCardProps) {
    const timeInStage = useTimeInStage(lead.stage_entry_date);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editTab, setEditTab] = useState<"details" | "chat">("details");
    const [isLossOpen, setIsLossOpen] = useState(false);
    const openEdit = (tab: "details" | "chat") => { setEditTab(tab); setIsEditDialogOpen(true); };
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const source = lead.source_id ? leadSources.find(s => s.id === lead.source_id) : null;
    const course = lead.curso_interesse ? courses.find(c => c.id === lead.curso_interesse) : null;
    const orderedStages = [...stages].sort((a, b) => a.order - b.order);
    const lostStage = stages.find(s => s.name.toLowerCase().includes('perdido'));

    const moveStageMutation = useMutation({
        mutationFn: async (stageId: number) => {
            const now = new Date().toISOString();
            await withTimeout(supabase.auth.getSession(), 8000, "A sessão").catch(() => { });
            const { data, error } = await withTimeout(
                supabase.from('leads')
                    .update({ stage_id: stageId, stage_entry_date: now, updated_at: now })
                    .eq('id', lead.id)
                    .select('id'),
                15000,
                "Mover o lead",
            );
            if (error) throw error;
            if (!data || data.length === 0) {
                await supabase.auth.getSession().catch(() => { });
                throw new Error("Não foi possível mover (sessão expirada). Recarregue a página.");
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            showSuccess('Lead movido.');
        },
        onError: (e: any) => showError(`Não foi possível mover: ${e.message}`),
    });

    const handleMove = (stageId: number) => {
        if (lostStage && stageId === lostStage.id) { setIsLossOpen(true); return; }
        moveStageMutation.mutate(stageId);
    };

    const atenderMutation = useMutation({
        mutationFn: async () => {
            if (!user?.id) throw new Error("Sessão não identificada. Recarregue a página.");
            await withTimeout(supabase.auth.getSession(), 8000, "A sessão").catch(() => { });
            const { data, error } = await withTimeout(
                supabase
                    .from('leads')
                    .update({ assigned_to_id: user.id, updated_at: new Date().toISOString() })
                    .eq('id', lead.id)
                    .select('id'),
                15000,
                "Atribuir o lead",
            );
            if (error) throw error;
            if (!data || data.length === 0) {
                await supabase.auth.getSession().catch(() => { });
                throw new Error("Não foi possível atribuir (sessão expirada). Recarregue a página.");
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            showSuccess(`Lead atribuído a você.`);
        },
        onError: (e: any) => showError(`Não foi possível atender: ${e.message}`),
    });

    return (
        <>
            <Card className="transition-shadow hover:shadow-md mb-4">
                <CardHeader className="p-4 pb-2 flex flex-row justify-between items-start">
                    <div className="flex items-center gap-2 flex-1 overflow-hidden">
                        <AssignedUser userId={lead.assigned_to_id} users={users} />
                        <CardTitle className="text-base font-semibold truncate flex flex-col" title={lead.nome_completo}>
                            <span>{lead.nome_completo}</span>
                            <span className="flex flex-wrap gap-1 mt-0.5">
                                {lead.perfil === 'aluno' && (
                                    <span className="text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded w-fit">
                                        Aluno{course ? ` · ${course.name}` : ''}
                                    </span>
                                )}
                                {lead.perfil !== 'aluno' && (course || lead.observacoes?.includes('[O]')) && (
                                    <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-fit">
                                        {course ? course.name : lead.observacoes?.match(/\[O\]\s*([^:\n]+)/)?.[1] || 'SendPulse'}
                                    </span>
                                )}
                                {lead.status_wide && (
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit ${lead.status_wide === 'ok_wide'
                                        ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                                        : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>
                                        {lead.status_wide === 'ok_wide' ? 'OK WIDE' : 'ERRO'}
                                    </span>
                                )}
                            </span>
                        </CardTitle>
                    </div>
                    <div className="flex items-center flex-shrink-0 gap-2">
                        {typeof pending === 'number' && pending > 0 && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            onClick={() => openEdit('chat')}
                                            className="relative inline-flex items-center gap-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white animate-pulse"
                                            aria-label={`${pending} mensagem(ns) do cliente sem resposta`}
                                        >
                                            <span className="absolute -inset-0.5 rounded-full bg-amber-500/60 animate-ping" />
                                            <MessageCircle className="relative h-3 w-3" />
                                            <span className="relative">{pending > 9 ? '9+' : pending}</span>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{pending} mensagem{pending > 1 ? 's' : ''} nova{pending > 1 ? 's' : ''} do cliente — clique para abrir a conversa.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        {lead.contact_count > 1 && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Badge variant="secondary" className="flex items-center gap-1">
                                            <RefreshCw className="h-3 w-3" />
                                            {lead.contact_count}
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Este lead entrou em contato {lead.contact_count} vezes.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        {source && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <IconPreview name={source.icon} className="h-4 w-4" style={{ color: source.color }} />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Fonte: {source.name}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6" title="Mover para coluna" disabled={moveStageMutation.isPending}>
                                    <ArrowRightLeft className="h-4 w-4" />
                                    <span className="sr-only">Mover Lead</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>Mover para</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {orderedStages.map(s => (
                                    <DropdownMenuItem key={s.id} disabled={s.id === lead.stage_id} onClick={() => handleMove(s.id)}>
                                        {s.id === lead.stage_id && <Check className="h-3.5 w-3.5 mr-2" />}
                                        <span className={s.id === lead.stage_id ? 'font-medium' : ''}>{s.name}</span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('details')}>
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Editar Lead</span>
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 pb-2 space-y-2">
                    {lead.telefone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3 flex-shrink-0" />
                            <span>{lead.telefone}</span>
                        </div>
                    )}
                    {lead.email && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground truncate" title={lead.email}>
                            <Mail className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{lead.email}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center pt-1">
                        <div className="flex flex-wrap gap-1">
                            {/* Tags removed */}
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-4 pt-0 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                            {lead.valor_oportunidade.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                        <LeadTemperature temperatura={lead.temperatura} />
                    </div>
                    {timeInStage && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground" title="Tempo no estágio">
                            <Clock className="h-3 w-3" />
                            {timeInStage}
                        </div>
                    )}
                    <div className="text-xs text-muted-foreground" title="Data/Hora de Entrada">
                        {new Date(lead.data_entrada).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {new Date(lead.data_entrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                </CardFooter>
                {!lead.assigned_to_id && user && (
                    <div className="px-4 pb-4">
                        <Button
                            size="sm"
                            className="w-full bg-primary/90 hover:bg-primary"
                            disabled={atenderMutation.isPending}
                            onClick={() => atenderMutation.mutate()}
                        >
                            <HandHelping className="h-4 w-4 mr-2" />
                            {atenderMutation.isPending ? "Atribuindo..." : "Atender"}
                        </Button>
                    </div>
                )}
            </Card>
            {isEditDialogOpen && (
                <EditLeadDialog
                    lead={lead}
                    stages={stages}
                    isOpen={isEditDialogOpen}
                    onOpenChange={setIsEditDialogOpen}
                    initialTab={editTab}
                />
            )}
            {isLossOpen && lostStage && (
                <LossReasonDialog
                    isOpen={isLossOpen}
                    onOpenChange={setIsLossOpen}
                    leadId={Number(lead.id)}
                    lostStageId={lostStage.id}
                    onSuccess={() => { setIsLossOpen(false); queryClient.invalidateQueries({ queryKey: ['leads'] }); }}
                />
            )}
        </>
    )
}
