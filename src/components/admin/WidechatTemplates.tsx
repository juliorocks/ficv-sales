// Gestão > Templates WhatsApp — só VISUALIZAÇÃO dos templates aprovados que já estão
// salvos no WideChat (pedido do usuário 13/10). Reaproveita a mesma ação já usada no
// seletor de template do chat do lead (widechat-api, action=list_hsm) — nenhuma rota nova
// no backend, só uma tela dedicada pra ver a lista inteira sem precisar abrir um chat.
//
// Gerenciar (criar/editar/apagar/consultar aprovação da Meta) não dá: a API externa do
// Z-PRO só tem endpoint de ENVIO de template já aprovado — gerenciamento de template é
// recurso do painel nativo de lá (ou da própria Graph API da Meta, com o token da conta de
// negócios, que não temos guardado aqui ainda).
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Loader2, MessageSquareText, RefreshCw, Search } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

// mesmo canal padrão que o chat do lead usa quando a conversa ainda não tem um
// attendance/channel próprio (WideChatHistory.tsx, DEFAULT_CHANNEL_ID)
const DEFAULT_CHANNEL_ID = "694534a0132843fbb436bd48"

interface WcTemplate {
    name: string
    message?: string | string[]
    tags?: unknown[]
    language?: string
    category?: string
    [k: string]: unknown
}

export function WidechatTemplates() {
    const [search, setSearch] = useState("")

    const { data: templates, isFetching, isError, error, refetch } = useQuery<WcTemplate[]>({
        queryKey: ["widechat-templates-admin"],
        queryFn: async () => {
            const { data, error } = await supabase.functions.invoke("widechat-api", {
                body: { action: "list_hsm", channel_id: DEFAULT_CHANNEL_ID },
            })
            if (error) throw error
            if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Falha ao listar templates no WideChat.")
            const raw: WcTemplate[] = data?.templates ?? []
            // o WideChat costuma devolver cada template 2x (uma sem `tags`, outra com) —
            // mesma dedup já usada no seletor do chat (WideChatHistory.tsx)
            const byName = new Map<string, WcTemplate>()
            for (const t of raw) {
                if (!t?.name) continue
                const prev = byName.get(t.name)
                const score = Array.isArray(t.tags) ? t.tags.length : 0
                if (!prev || score > (Array.isArray(prev.tags) ? prev.tags.length : 0)) byName.set(t.name, t)
            }
            return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
        },
        staleTime: 5 * 60_000,
    })

    const term = search.trim().toLowerCase()
    const filtered = (templates ?? []).filter((t) => {
        if (!term) return true
        const body = Array.isArray(t.message) ? t.message.join(" ") : String(t.message ?? "")
        return t.name.toLowerCase().includes(term) || body.toLowerCase().includes(term)
    })

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                <CardHeader>
                    <CardTitle className="text-2xl font-bold flex items-center gap-2">
                        <MessageSquareText size={22} className="text-primary" /> Templates WhatsApp
                    </CardTitle>
                    <CardDescription className="text-sm">
                        Templates de mensagem já aprovados pela Meta, puxados direto do WideChat. É só visualização por enquanto — criar, editar ou
                        acompanhar aprovação de um template novo continua sendo pelo painel nativo (WideChat ou Z-PRO), não tem endpoint pra isso na API.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou texto…" className="pl-9" />
                        </div>
                        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
                            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Recarregar
                        </Button>
                    </div>

                    {isError && (
                        <div className="rounded-xl p-4 text-sm bg-red-500/10 text-red-600 dark:text-red-400 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium">Não consegui carregar os templates do WideChat.</p>
                                <p className="text-xs opacity-80 mt-0.5">{(error as Error)?.message ?? "Costuma ser a sessão da conta em disputa com o painel aberto em outra aba."}</p>
                            </div>
                        </div>
                    )}

                    {!isError && isFetching && !templates && (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    )}

                    {!isError && templates && filtered.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            {templates.length === 0 ? "Nenhum template aprovado encontrado." : "Nenhum resultado pra essa busca."}
                        </p>
                    )}

                    <div className="space-y-2">
                        {filtered.map((t) => {
                            const body = Array.isArray(t.message) ? t.message.join("\n") : String(t.message ?? "")
                            const nVars = Array.isArray(t.tags) ? t.tags.length : 0
                            return (
                                <div key={t.name} className="rounded-xl border border-[var(--border)] p-4 space-y-1.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-sm text-[var(--text-main)]">{t.name}</p>
                                        {nVars > 0 && <Badge variant="secondary" className="text-[10px]">{nVars} variáve{nVars > 1 ? "is" : "l"}</Badge>}
                                        {!!t.language && <Badge variant="outline" className="text-[10px]">{String(t.language)}</Badge>}
                                        {!!t.category && <Badge variant="outline" className="text-[10px]">{String(t.category)}</Badge>}
                                    </div>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{body || "(sem corpo de texto)"}</p>
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
