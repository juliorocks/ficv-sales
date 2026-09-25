// Tela "Integrações": colar/trocar/apagar chaves de API e testar a conexão.
// O valor vai direto pra edge function `integrations`, que grava no Supabase
// Vault — o navegador nunca recebe a chave de volta (só os 4 últimos
// caracteres). Sem chave no painel, vale a do ambiente (supabase secrets).
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, Trash2, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { showError, showSuccess } from "@/utils/toast"

interface Field {
    key: string
    label: string
    placeholder?: string
    optional?: boolean
    help?: string
    source: "painel" | "ambiente" | "faltando"
    hint: string | null
    updated_at: string | null
    plain?: boolean        // não é segredo (remetente, endereço…): campo visível
    value?: string | null  // valor salvo, só nos campos plain
}
interface Integration {
    id: string
    name: string
    description: string
    fields: Field[]
    manageTab?: string
    last_test: { ok: boolean; at: string; message: string } | null
    info?: { label: string; value: string }[]
}

const fieldLabel = "text-xs font-bold uppercase tracking-widest text-muted-foreground"
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "")

async function call(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke("integrations", { body })
    if (error || data?.error) {
        const ctx = error ? await (error as any).context?.json?.().catch(() => null) : null
        throw new Error(data?.error ?? ctx?.error ?? error?.message ?? "erro desconhecido")
    }
    return data
}

function SourceBadge({ f }: { f: Field }) {
    if (f.source === "painel") return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500">{f.plain ? "Salvo" : `Painel ${f.hint}`}</span>
    if (f.source === "ambiente") return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-500">Secrets do servidor</span>
    return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${f.optional ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-500"}`}>Não configurada</span>
}

export function IntegrationsSettings({ onNavigate }: { onNavigate?: (tab: string) => void }) {
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState<string | null>(null)

    const { data, isLoading, refetch } = useQuery({
        queryKey: ["integrations"],
        queryFn: async () => (await call({ action: "list" })).integrations as Integration[],
    })

    const test = async (id: string, quiet = false) => {
        setBusy(`test-${id}`)
        try {
            const r = await call({ action: "test", integration: id })
            if (!quiet || !r.ok) (r.ok ? showSuccess : showError)(r.message)
            else showSuccess(`Salvo e testado: ${r.message}`)
        } catch (e) { showError((e as Error).message) }
        setBusy(null)
        refetch()
    }

    const save = async (integ: Integration) => {
        const entries = integ.fields.filter((f) => drafts[f.key]?.trim())
        if (!entries.length) return showError("Cole pelo menos uma chave antes de salvar.")
        setBusy(`save-${integ.id}`)
        try {
            for (const f of entries) await call({ action: "set", key: f.key, value: drafts[f.key].trim() })
            setDrafts((d) => { const n = { ...d }; entries.forEach((f) => delete n[f.key]); return n })
        } catch (e) {
            setBusy(null)
            return showError(`Não foi possível salvar: ${(e as Error).message}`)
        }
        await test(integ.id, true)
    }

    const clear = async (f: Field) => {
        if (!confirm(`Apagar a chave "${f.label}" do painel?${f.source === "painel" ? " Se existir uma nos secrets do servidor, ela volta a valer." : ""}`)) return
        setBusy(`clear-${f.key}`)
        try { await call({ action: "clear", key: f.key }); showSuccess("Chave apagada.") }
        catch (e) { showError((e as Error).message) }
        setBusy(null)
        refetch()
    }

    if (isLoading) {
        return <div className="space-y-4 max-w-5xl mx-auto"><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h2 className="text-2xl font-bold flex items-center gap-2 text-[var(--text-main)]"><KeyRound size={22} className="text-primary" /> Integrações</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Cole as chaves aqui. Elas ficam criptografadas no servidor (Supabase Vault) e nunca voltam pro navegador: depois de salva, só aparecem os 4 últimos caracteres.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {data?.map((integ) => (
                    <Card key={integ.id} className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg font-bold flex items-center justify-between gap-2">
                                <span>{integ.name}</span>
                                {integ.last_test && (integ.last_test.ok
                                    ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                    : <XCircle size={18} className="text-red-500 shrink-0" />)}
                            </CardTitle>
                            <CardDescription className="text-sm">{integ.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {integ.fields.map((f) => (
                                <div key={f.key} className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <Label className={fieldLabel}>{f.label}{f.optional ? "" : " *"}</Label>
                                        {drafts[f.key] !== undefined && drafts[f.key].trim() !== (f.plain ? (f.value ?? "") : "")
                                            ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500">Não salvo — clique em Salvar</span>
                                            : <SourceBadge f={f} />}
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            type={f.plain ? "text" : "password"}
                                            autoComplete="off"
                                            value={drafts[f.key] ?? (f.plain ? (f.value ?? "") : "")}
                                            onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                                            placeholder={f.plain ? (f.placeholder ?? "") : f.source === "faltando" ? (f.placeholder ?? "Cole a chave aqui") : "Cole uma nova para substituir"}
                                            className="bg-muted/20 font-mono text-xs"
                                        />
                                        {f.source === "painel" && (
                                            <Button size="icon" variant="ghost" title="Apagar do painel" onClick={() => clear(f)} disabled={busy === `clear-${f.key}`}>
                                                {busy === `clear-${f.key}` ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                                            </Button>
                                        )}
                                    </div>
                                    {(f.help || f.updated_at) && (
                                        <p className="text-[11px] text-muted-foreground">
                                            {f.help}{f.help && f.updated_at ? " · " : ""}{f.updated_at ? `salva em ${fmt(f.updated_at)}` : ""}
                                        </p>
                                    )}
                                </div>
                            ))}

                            {integ.info?.map((inf) => (
                                <div key={inf.label} className="space-y-1">
                                    <Label className={fieldLabel}>{inf.label}</Label>
                                    <div className="flex gap-2">
                                        <Input readOnly value={inf.value} className="bg-muted/20 font-mono text-[10px]" />
                                        <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(inf.value).then(() => showSuccess("Copiado."))}>Copiar</Button>
                                    </div>
                                </div>
                            ))}

                            {integ.last_test && (
                                <p className={`text-xs rounded-lg p-2 break-words ${integ.last_test.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-500"}`}>
                                    {fmt(integ.last_test.at)} — {integ.last_test.message}
                                </p>
                            )}

                            <div className="flex gap-2 justify-end">
                                {integ.manageTab && onNavigate && (
                                    <Button size="sm" variant="outline" onClick={() => onNavigate(integ.manageTab!)}>
                                        <ExternalLink size={14} className="mr-1" /> Gerenciar números
                                    </Button>
                                )}
                                <Button size="sm" variant="outline" onClick={() => test(integ.id)} disabled={!!busy}>
                                    {busy === `test-${integ.id}` ? <Loader2 className="animate-spin" size={14} /> : <><PlugZap size={14} className="mr-1" /> Testar conexão</>}
                                </Button>
                                {integ.fields.length > 0 && (
                                    <Button size="sm" onClick={() => save(integ)} disabled={!!busy || !integ.fields.some((f) => drafts[f.key]?.trim())}>
                                        {busy === `save-${integ.id}` ? <Loader2 className="animate-spin" size={14} /> : "Salvar e testar"}
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
