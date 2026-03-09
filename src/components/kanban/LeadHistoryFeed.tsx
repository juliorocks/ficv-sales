import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Lead, LeadHistory, LeadNote, AuditLog, Stage, User, Course, LeadSource } from "@/types/database"
import { useMemo } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowRightLeft, MessageSquare, Pencil, PlusCircle, User as UserIcon, HeartCrack, RefreshCw } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface LeadHistoryFeedProps {
    lead: Lead
    stages: Stage[]
    users: User[]
    courses: Course[]
    leadSources: LeadSource[]
}

type HistoryEvent = {
    type: 'stage_change' | 'update' | 'note' | 'creation' | 'recontact'
    timestamp: string
    data: any
}

function HistorySkeleton() {
    return (
        <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-start gap-4">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-2 flex-grow">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                    </div>
                </div>
            ))}
        </div>
    )
}

export function LeadHistoryFeed({ lead, stages, users, courses, leadSources }: LeadHistoryFeedProps) {
    const { data: stageHistory, isLoading: isLoadingStageHistory } = useQuery<LeadHistory[]>({
        queryKey: ['lead_history', lead.id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('lead_history')
                .select('*, from_stage:stages!lead_history_from_stage_id_fkey(name), to_stage:stages!lead_history_to_stage_id_fkey(name), users:profiles(name:full_name, avatar_url), motivos_perda(motivo)')
                .eq('lead_id', lead.id)
                .order('changed_at', { ascending: false })
            if (error) {
                console.error("Error fetching stage history:", error)
                throw error
            }
            return data || []
        }
    })

    const { data: auditLogs, isLoading: isLoadingAuditLogs } = useQuery<AuditLog[]>({
        queryKey: ['audit_logs', lead.id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('audit_logs')
                .select('*, users:profiles(name:full_name, avatar_url)')
                .eq('details->>lead_id', lead.id.toString())
                .in('action', ['lead_updated', 'lead_created', 'lead_recontacted'])
                .order('created_at', { ascending: false })
            if (error) {
                console.error("Error fetching audit logs:", error)
                throw error
            }
            return data || []
        }
    })

    const { data: notes, isLoading: isLoadingNotes } = useQuery<LeadNote[]>({
        queryKey: ['lead_notes', lead.id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('lead_notes')
                .select('*, users:profiles(name:full_name, avatar_url)')
                .eq('lead_id', lead.id)
                .order('created_at', { ascending: false })
            if (error) {
                console.error("Error fetching notes:", error)
                throw error
            }
            return data || []
        }
    })

    const combinedHistory = useMemo(() => {
        const events: HistoryEvent[] = []
        const creationLog = auditLogs?.find(log => log.action === 'lead_created');

        if (creationLog) {
            events.push({ type: 'creation', timestamp: creationLog.created_at, data: creationLog });
        } else {
            events.push({ type: 'creation', timestamp: lead.data_entrada, data: lead });
        }

        stageHistory?.forEach(item => events.push({ type: 'stage_change', timestamp: item.changed_at, data: item }))
        auditLogs?.forEach(item => {
            if (item.action === 'lead_updated' && item.details.changes) {
                events.push({ type: 'update', timestamp: item.created_at, data: item })
            } else if (item.action === 'lead_recontacted') {
                events.push({ type: 'recontact', timestamp: item.created_at, data: item })
            }
        })
        notes?.forEach(item => events.push({ type: 'note', timestamp: item.created_at, data: item }))

        return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    }, [lead, stageHistory, auditLogs, notes])

    const formatValue = (field: string, value: any) => {
        if (value === null || value === undefined) return "vazio"
        switch (field) {
            case 'curso_interesse':
                return courses.find(c => c.id === value)?.name || value
            case 'source_id':
                return leadSources.find(s => s.id === value)?.name || value
            case 'assigned_to_id':
                return users.find(u => u.id === value)?.full_name || value
            case 'stage_id':
                return stages.find(s => s.id === value)?.name || value
            case 'valor_oportunidade':
                return (typeof value === 'number' ? value : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            default:
                return value.toString()
        }
    }

    const renderEvent = (event: HistoryEvent) => {
        const user = event.data.users
        const timestamp = format(new Date(event.timestamp), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })

        const EventWrapper = ({ children }: { children: React.ReactNode }) => (
            <div className="flex items-start gap-4">
                <Avatar className="h-8 w-8 border">
                    <AvatarImage src={user?.avatar_url || undefined} />
                    <AvatarFallback>{(user?.full_name || user?.name || 'U').slice(0, 2).toUpperCase() || <UserIcon size={16} />}</AvatarFallback>
                </Avatar>
                <div className="flex-grow">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold">{user?.name || user?.full_name || 'Sistema'}</span>
                        <span className="text-muted-foreground">{timestamp}</span>
                    </div>
                    <div className="text-sm mt-1 p-3 bg-muted/50 rounded-md">{children}</div>
                </div>
            </div>
        )

        switch (event.type) {
            case 'creation': {
                const isFromAuditLog = event.data.action === 'lead_created';
                if (isFromAuditLog) {
                    return (
                        <EventWrapper>
                            <p className="font-semibold flex items-center gap-2"><PlusCircle size={16} /> Lead criado com as seguintes informações:</p>
                            <ul className="list-disc pl-5 mt-1 space-y-1">
                                {event.data.details.changes.map((change: any, index: number) => (
                                    <li key={index}>
                                        <strong>{formatValue(change.field, 'field')}:</strong> {formatValue(change.field, change.to)}
                                    </li>
                                ))}
                            </ul>
                        </EventWrapper>
                    )
                } else {
                    const creationData = event.data as Lead;
                    const course = courses.find(c => c.id === creationData.curso_interesse);
                    const source = leadSources.find(s => s.id === creationData.source_id);
                    const assignedUser = users.find(u => u.id === creationData.assigned_to_id);
                    return (
                        <EventWrapper>
                            <div className="space-y-1">
                                <p>Lead criado no sistema.</p>
                                <ul className="list-disc pl-5 text-muted-foreground">
                                    {course && <li>Interesse em: <strong>{course.name}</strong></li>}
                                    {source && <li>Canal de Aquisição: <strong>{source.name}</strong></li>}
                                    {assignedUser && <li>Atribuído a: <strong>{assignedUser.full_name}</strong></li>}
                                    <li>Valor da Oportunidade: <strong>{creationData.valor_oportunidade.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></li>
                                </ul>
                            </div>
                        </EventWrapper>
                    );
                }
            }
            case 'note':
                return <EventWrapper><p className="font-semibold flex items-center gap-2"><MessageSquare size={16} /> Adicionou uma nota:</p><p className="pt-1">{event.data.note}</p></EventWrapper>
            case 'stage_change': {
                const isLoss = event.data.to_stage?.name.toLowerCase().includes('perdido');
                const lossReason = event.data.motivos_perda?.motivo;
                return (
                    <EventWrapper>
                        <div className="flex items-start gap-2">
                            {isLoss ? <HeartCrack size={16} className="text-destructive mt-0.5" /> : <ArrowRightLeft size={16} className="mt-0.5" />}
                            <div>
                                <p className="font-semibold">
                                    Moveu o lead de <strong>{event.data.from_stage?.name || 'Início'}</strong> para <strong>{event.data.to_stage?.name || 'Fim'}</strong>.
                                </p>
                                {isLoss && lossReason && (
                                    <div className="mt-1 text-sm text-destructive">
                                        <span className="font-medium">Motivo:</span> {lossReason}
                                    </div>
                                )}
                            </div>
                        </div>
                    </EventWrapper>
                )
            }
            case 'update':
                return (
                    <EventWrapper>
                        <p className="font-semibold flex items-center gap-2"><Pencil size={16} /> Atualizou as seguintes informações:</p>
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                            {event.data.details.changes.map((change: any, index: number) => (
                                <li key={index}>
                                    <strong>{formatValue(change.field, 'field')}:</strong> de "{formatValue(change.field, change.from)}" para "{formatValue(change.field, change.to)}"
                                </li>
                            ))}
                        </ul>
                    </EventWrapper>
                )
            case 'recontact':
                return (
                    <EventWrapper>
                        <div className="flex items-center gap-2">
                            <RefreshCw size={16} className="text-primary" />
                            <div>
                                <p className="font-semibold">Novo contato recebido.</p>
                                <p className="text-muted-foreground text-xs">Este é o {event.data.details.new_contact_count}º contato deste lead.</p>
                            </div>
                        </div>
                    </EventWrapper>
                )
            default:
                return null
        }
    }

    if (isLoadingStageHistory || isLoadingAuditLogs || isLoadingNotes) {
        return <HistorySkeleton />
    }

    return (
        <div className="space-y-6">
            {combinedHistory.map((event, index) => (
                <div key={`${event.type}-${index}`}>
                    {renderEvent(event)}
                </div>
            ))}
        </div>
    )
}
