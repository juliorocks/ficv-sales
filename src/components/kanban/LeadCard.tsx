import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Lead, User, LeadSource, Stage, Course } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Clock, Mail, Pencil, Phone, RefreshCw } from "lucide-react"
import { EditLeadDialog } from "./EditLeadDialog"
import { useTimeInStage } from "@/hooks/use-time-in-stage"
import { useState } from "react"
import { LeadTemperature } from "./LeadTemperature"
import { AssignedUser } from "./AssignedUser"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { IconPreview } from "../admin/IconPreview"
import { Badge } from "@/components/ui/badge"

interface LeadCardProps {
    lead: Lead
    users: User[]
    leadSources: LeadSource[]
    stages: Stage[]
    courses: Course[]
}

export function LeadCard({ lead, users, leadSources, stages, courses }: LeadCardProps) {
    const timeInStage = useTimeInStage(lead.stage_entry_date);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const source = lead.source_id ? leadSources.find(s => s.id === lead.source_id) : null;
    const course = lead.curso_interesse ? courses.find(c => c.id === lead.curso_interesse) : null;

    return (
        <>
            <Card className="transition-shadow hover:shadow-md mb-4">
                <CardHeader className="p-4 pb-2 flex flex-row justify-between items-start">
                    <div className="flex items-center gap-2 flex-1 overflow-hidden">
                        <AssignedUser userId={lead.assigned_to_id} users={users} />
                        <CardTitle className="text-base font-semibold truncate flex flex-col" title={lead.nome_completo}>
                            <span>{lead.nome_completo}</span>
                            {(course || lead.observacoes?.includes('[O]')) && (
                                <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-fit mt-0.5">
                                    {course ? course.name : lead.observacoes?.match(/\[O\]\s*([^:\n]+)/)?.[1] || 'SendPulse'}
                                </span>
                            )}
                        </CardTitle>
                    </div>
                    <div className="flex items-center flex-shrink-0 gap-2">
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
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsEditDialogOpen(true)}>
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
            </Card>
            <EditLeadDialog
                lead={lead}
                stages={stages}
                isOpen={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
            />
        </>
    )
}
