import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Plus } from "lucide-react"
import { NewLeadForm } from "./NewLeadForm"

export function CreateLeadFab() {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-30"
                    size="icon"
                >
                    <Plus className="h-6 w-6" />
                    <span className="sr-only">Adicionar Novo Lead</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Adicionar Novo Lead</DialogTitle>
                    <DialogDescription>
                        Preencha as informações abaixo para adicionar um novo lead ao funil.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 max-h-[70vh] overflow-y-auto pr-2">
                    <NewLeadForm onSuccess={() => setIsOpen(false)} />
                </div>
            </DialogContent>
        </Dialog>
    )
}
