import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { LeadFollowup, FollowupStatus } from "@/types/database"

// Colunas + joins usados em todo lugar. Dois FKs pra profiles -> desambigua pelo
// nome do constraint (padrão do Postgres: <tabela>_<coluna>_fkey).
// Sem espaços: o PostgREST não aceita whitespace no parâmetro `select`.
const SELECT =
    "*," +
    "lead:leads!lead_followups_lead_id_fkey(id,nome_completo,telefone)," +
    "assignee:profiles!lead_followups_assigned_to_fkey(full_name,avatar_url)," +
    "creator:profiles!lead_followups_created_by_fkey(full_name)"

export const followupKeys = {
    all: ["followups"] as const,
    lead: (leadId: number) => ["lead_followups", leadId] as const,
    due: (scope: string) => ["followups", "due", scope] as const,
}

export interface FollowupFilters {
    start?: string        // ISO date (yyyy-mm-dd)
    end?: string          // ISO date (yyyy-mm-dd)
    status?: FollowupStatus | "all"
    assignedTo?: string | "all"
}

export function useFollowups(filters: FollowupFilters) {
    return useQuery<LeadFollowup[]>({
        queryKey: [...followupKeys.all, filters],
        queryFn: async () => {
            let q = supabase.from("lead_followups").select(SELECT).order("due_at", { ascending: true })
            if (filters.start) q = q.gte("due_at", `${filters.start}T00:00:00`)
            if (filters.end) q = q.lte("due_at", `${filters.end}T23:59:59`)
            if (filters.status && filters.status !== "all") q = q.eq("status", filters.status)
            if (filters.assignedTo && filters.assignedTo !== "all") q = q.eq("assigned_to", filters.assignedTo)
            const { data, error } = await q
            if (error) throw error
            return (data || []) as unknown as LeadFollowup[]
        },
        staleTime: 30 * 1000,
    })
}

export function useLeadFollowups(leadId: number | null) {
    return useQuery<LeadFollowup[]>({
        queryKey: followupKeys.lead(leadId ?? 0),
        queryFn: async () => {
            const { data, error } = await supabase
                .from("lead_followups")
                .select(SELECT)
                .eq("lead_id", leadId!)
                .order("due_at", { ascending: true })
            if (error) throw error
            return (data || []) as unknown as LeadFollowup[]
        },
        enabled: leadId != null,
        staleTime: 30 * 1000,
    })
}

/** Follow-ups pendentes já vencidos — alimenta o sino. */
export function useDueFollowups(userId: string | undefined, showAll: boolean) {
    return useQuery<LeadFollowup[]>({
        queryKey: followupKeys.due(showAll ? "all" : (userId ?? "none")),
        queryFn: async () => {
            let q = supabase
                .from("lead_followups")
                .select(SELECT)
                .eq("status", "pending")
                .lte("due_at", new Date().toISOString())
                .order("due_at", { ascending: true })
            if (!showAll && userId) q = q.eq("assigned_to", userId)
            const { data, error } = await q
            if (error) throw error
            return (data || []) as unknown as LeadFollowup[]
        },
        enabled: showAll || !!userId,
        refetchInterval: 60 * 1000,
        staleTime: 30 * 1000,
    })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
    qc.invalidateQueries({ queryKey: ["followups"] })
    qc.invalidateQueries({ queryKey: ["lead_followups"] })
}

export interface NewFollowupInput {
    lead_id?: number | null
    title?: string | null
    note?: string | null
    due_at: string
    assigned_to?: string | null
}

export function useCreateFollowup() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async (input: NewFollowupInput) => {
            const { data: u } = await supabase.auth.getUser()
            const { error } = await supabase.from("lead_followups").insert({
                lead_id: input.lead_id ?? null,
                title: input.title ?? null,
                note: input.note ?? null,
                due_at: input.due_at,
                assigned_to: input.assigned_to ?? u.user?.id ?? null,
                created_by: u.user?.id ?? null,
            })
            if (error) throw error
        },
        onSuccess: () => invalidateAll(qc),
    })
}

export function useUpdateFollowup() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, patch }: { id: number; patch: Partial<LeadFollowup> }) => {
            const { error } = await supabase.from("lead_followups").update(patch).eq("id", id)
            if (error) throw error
        },
        onSuccess: () => invalidateAll(qc),
    })
}

export function useSetFollowupStatus() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async ({ ids, status }: { ids: number[]; status: FollowupStatus }) => {
            const { data: u } = await supabase.auth.getUser()
            const done = status === "done"
            const { error } = await supabase
                .from("lead_followups")
                .update({
                    status,
                    completed_at: done ? new Date().toISOString() : null,
                    completed_by: done ? (u.user?.id ?? null) : null,
                })
                .in("id", ids)
            if (error) throw error
        },
        onSuccess: () => invalidateAll(qc),
    })
}

export function useDeleteFollowups() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async (ids: number[]) => {
            const { error } = await supabase.from("lead_followups").delete().in("id", ids)
            if (error) throw error
        },
        onSuccess: () => invalidateAll(qc),
    })
}
