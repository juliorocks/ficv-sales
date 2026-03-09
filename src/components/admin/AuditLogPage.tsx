"use client"

import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"

interface AuditLog {
    id: number
    created_at: string
    user_id: string | null
    action: string
    details: any
    profiles: { full_name: string; email: string } | null
}

function AuditLogSkeleton() {
    return (
        <div className="space-y-4 animate-pulse">
            <Skeleton className="h-8 w-1/4" />
            <div className="border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Ação</TableHead>
                            <TableHead>Usuário</TableHead>
                            <TableHead>Detalhes</TableHead>
                            <TableHead>Data</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {[...Array(10)].map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}

export function AuditLogPage() {
    const { user, isLoading: isAuthLoading } = useAuth()
    const { data: auditLogs, isLoading } = useQuery<AuditLog[]>({
        queryKey: ['audit_logs'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('audit_logs')
                .select(`
          *,
          profiles (
            full_name,
            email
          )
        `)
                .order('created_at', { ascending: false })
                .limit(100)

            if (error) throw error
            return (data || []) as any[]
        },
        enabled: !isAuthLoading && !!user,
    })

    const renderActionBadge = (action: string) => {
        let variant: "default" | "secondary" | "destructive" | "outline" = "secondary"
        if (action.includes('created')) variant = "default"
        if (action.includes('updated')) variant = "outline"
        if (action.includes('deleted') || action.includes('removed')) variant = "destructive"

        return <Badge variant={variant} className="capitalize">{action.replace(/_/g, ' ')}</Badge>
    }

    if (isLoading || isAuthLoading) {
        return <AuditLogSkeleton />
    }

    return (
        <div className="space-y-4 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Logs de Auditoria</h1>
                <p className="text-sm text-muted-foreground">
                    Registro das atividades e mudanças de estágio dos leads.
                </p>
            </div>

            <div className="border rounded-xl bg-card/40 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Ação</TableHead>
                            <TableHead>Usuário</TableHead>
                            <TableHead>Detalhes</TableHead>
                            <TableHead>Data</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {auditLogs && auditLogs.length > 0 ? auditLogs.map((log) => (
                            <TableRow key={log.id} className="hover:bg-muted/30">
                                <TableCell>{renderActionBadge(log.action)}</TableCell>
                                <TableCell>
                                    {log.profiles ? (
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-foreground text-sm">{log.profiles.full_name}</span>
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{log.profiles.email}</span>
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground italic text-xs">Sistema / Automação</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="max-w-md">
                                        <pre className="text-[10px] bg-muted/50 p-3 rounded-lg overflow-x-auto font-mono text-muted-foreground border shadow-inner">
                                            {JSON.stringify(log.details, null, 2)}
                                        </pre>
                                    </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                    {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                                    Nenhum log encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
