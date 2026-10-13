// Gestão > Templates WhatsApp — VISUALIZAÇÃO dos templates aprovados do número oficial
// (3041-7471), puxados DIRETO da Graph API da Meta (pedido do usuário 13/10).
//
// A API externa do Z-PRO não tem endpoint de listagem de templates (só envio de um já
// aprovado) — confirmado na doc oficial. O painel nativo do Z-PRO consegue mostrar isso
// porque fala direto com a Meta usando o token da conta de negócios (bmToken) que o Z-PRO
// guarda por número. Achamos esse token com acesso direto ao banco de produção do Z-PRO
// (autorizado pelo usuário) e colamos no nosso Vault (META_WABA_TOKEN_OFICIAL) — a edge
// function vivaconnect-api (action=list_meta_templates) usa ele pra bater direto na Graph
// API (graph.facebook.com/.../message_templates), sem depender do WideChat nem do Z-PRO.
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Loader2, MessageSquareText, RefreshCw, Search } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface MetaTemplateComponent {
    type: string
    text?: string
    format?: string
    [k: string]: unknown
}

interface MetaTemplate {
    id: string
    name: string
    language?: string
    category?: string
    status?: string
    components?: MetaTemplateComponent[]
    [k: string]: unknown
}

export function WidechatTemplates() {
    const [search, setSearch] = useState("")

    const { data: templates, isFetching, isError, error, refetch } = useQuery<MetaTemplate[]>({
        queryKey: ["meta-templates-admin"],
        queryFn: async () => {
            const { data, error } = await supabase.functions.invoke("vivaconnect-api", {
                body: { action: "list_meta_templates" },
            })
            if (error) throw error
            if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Falha ao listar templates na Meta.")
            const raw: MetaTemplate[] = data?.templates ?? []
            return [...raw].sort((a, b) => a.name.localeCompare(b.name))
        },
        staleTime: 5 * 60_000,
    })

    const term = search.trim().toLowerCase()
    const filtered = (templates ?? []).filter((t) => {
        if (!term) return true
        const body = t.components?.find((c) => c.type === "BODY")?.text ?? ""
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
                        Templates de mensagem já aprovados pela Meta pro número oficial (3041-7471), puxados direto da Graph API da Meta. É só
                        visualização por enquanto — criar, editar ou acompanhar aprovação de um template novo continua sendo pelo painel nativo do
                        Z-PRO (não tem endpoint pra isso na nossa integração).
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
                                <p className="font-medium">Não consegui carregar os templates da Meta.</p>
                                <p className="text-xs opacity-80 mt-0.5">{(error as Error)?.message ?? "Tenta recarregar."}</p>
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
                            const body = t.components?.find((c) => c.type === "BODY")?.text ?? ""
                            const header = t.components?.find((c) => c.type === "HEADER")
                            const nVars = (body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length
                            return (
                                <div key={t.id ?? t.name} className="rounded-xl border border-[var(--border)] p-4 space-y-1.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-sm text-[var(--text-main)]">{t.name}</p>
                                        {!!t.status && (
                                            <Badge variant={t.status === "APPROVED" ? "secondary" : "outline"} className="text-[10px]">{t.status}</Badge>
                                        )}
                                        {nVars > 0 && <Badge variant="secondary" className="text-[10px]">{nVars} variáve{nVars > 1 ? "is" : "l"}</Badge>}
                                        {!!t.language && <Badge variant="outline" className="text-[10px]">{t.language}</Badge>}
                                        {!!t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}
                                    </div>
                                    {header?.text && <p className="text-sm font-medium text-[var(--text-main)]">{header.text}</p>}
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
