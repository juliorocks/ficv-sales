import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Lead, Stage } from "@/types/database"
import { EditLeadDialog } from "./EditLeadDialog"

/**
 * Abre o modal do lead (EditLeadDialog) só com o id — busca lead + stages sob
 * demanda. Usado pelo sino de notificações e pela página de Follow-ups, onde não
 * temos o objeto Lead completo em mãos.
 */
export function LeadDialogById({
    leadId,
    onClose,
    initialTab = "chat",
}: {
    leadId: number
    onClose: () => void
    initialTab?: "details" | "chat" | "history"
}) {
    const { data: lead } = useQuery<Lead | null>({
        queryKey: ["lead", leadId],
        queryFn: async () => {
            const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).single()
            if (error) throw error
            return data as Lead
        },
    })
    const { data: stages } = useQuery<Stage[]>({
        queryKey: ["stages"],
        queryFn: async () => {
            const { data, error } = await supabase.from("stages").select("*").order("order")
            if (error) throw error
            return data || []
        },
        staleTime: 5 * 60 * 1000,
    })

    if (!lead || !stages) return null
    return (
        <EditLeadDialog
            lead={lead}
            stages={stages}
            isOpen
            onOpenChange={(o) => { if (!o) onClose() }}
            initialTab={initialTab}
        />
    )
}
