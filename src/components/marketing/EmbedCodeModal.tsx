import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { showSuccess } from "@/utils/toast"
import { buildEmbedSnippet } from "@/utils/marketingForms"

interface EmbedCodeModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    slug: string
}

export function EmbedCodeModal({ open, onOpenChange, slug }: EmbedCodeModalProps) {
    const { script, html } = buildEmbedSnippet(slug)

    const copy = async (text: string) => {
        await navigator.clipboard.writeText(text)
        showSuccess("Código copiado!")
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Código de incorporação do formulário</DialogTitle>
                    <DialogDescription>Cole este código na página onde o formulário deve aparecer.</DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="script">
                    <TabsList>
                        <TabsTrigger value="script">Script</TabsTrigger>
                        <TabsTrigger value="html">HTML</TabsTrigger>
                    </TabsList>
                    <TabsContent value="script" className="mt-3">
                        <pre className="text-xs bg-muted/50 border rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">{script}</pre>
                        <Button className="mt-3" variant="outline" onClick={() => copy(script)}>
                            <Copy className="mr-2 h-4 w-4" /> Copiar código
                        </Button>
                    </TabsContent>
                    <TabsContent value="html" className="mt-3">
                        <pre className="text-xs bg-muted/50 border rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">{html}</pre>
                        <Button className="mt-3" variant="outline" onClick={() => copy(html)}>
                            <Copy className="mr-2 h-4 w-4" /> Copiar código
                        </Button>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
