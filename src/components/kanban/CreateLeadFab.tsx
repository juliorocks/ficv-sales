import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Plus } from "lucide-react"
import { NewLeadForm } from "./NewLeadForm"
import { EditLeadDialog } from "./EditLeadDialog"
import { supabase } from "@/lib/supabase"
import { Lead, Stage } from "@/types/database"

export function CreateLeadFab() {
    const [isOpen, setIsOpen] = useState(false)
    const [createdLead, setCreatedLead] = useState<Lead | null>(null)

    const { data: stages } = useQuery<Stage[]>({
        queryKey: ['stages'],
        queryFn: async () => {
            const { data, error } = await supabase.from('stages').select('*').order('order')
            if (error) throw error
            return data
        },
        staleTime: 5 * 60_000,
    })

    return (
        <>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <Button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
                    size="icon"
                >
                    <Plus className="h-6 w-6" />
                    <span className="sr-only">Adicionar Novo Lead</span>
                </Button>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Adicionar Novo Lead</DialogTitle>
                        <DialogDescription>
                            Preencha as informações. Depois de criar, a conversa abre pra você já mandar um template.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 max-h-[70vh] overflow-y-auto pr-2">
                        <NewLeadForm onSuccess={(lead) => { setIsOpen(false); setCreatedLead(lead) }} />
                    </div>
                </DialogContent>
            </Dialog>

            {createdLead && (
                <EditLeadDialog
                    lead={createdLead}
                    stages={stages ?? []}
                    isOpen={!!createdLead}
                    onOpenChange={(open) => { if (!open) setCreatedLead(null) }}
                    initialTab="chat"
                />
            )}
        </>
    )
}
