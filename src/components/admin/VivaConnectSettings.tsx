// Tela "VivaConnect" (Z-PRO self-hosted): chave geral, 1ª mensagem automática,
// resposta pro aluno no oficial, canais (1 API do Z-PRO por número) com saúde,
// e os últimos webhooks/envios — o schema do webhook do Z-PRO não é
// documentado, então a lista de webhooks brutos é a ferramenta de diagnóstico.
// O token da API nunca é lido de volta: a lista vem da view
// vivaconnect_channel_health (sem api_token).
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Loader2, Plug, Plus, RefreshCw, Send, Smartphone, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { showError, showSuccess } from "@/utils/toast"

interface VcSettings {
    enabled: boolean
    base_url: string
    webhook_secret: string
    first_message_enabled: boolean
    first_message_template: string
    send_window_start: number
    send_window_end: number
    min_interval_seconds: number
    student_reply_enabled: boolean
    student_reply_template: string
}

interface ChannelHealth {
    id: number
    name: string
    purpose: "official" | "pool"
    kind: string
    phone: string | null
    api_id: string
    active: boolean
    daily_limit: number
    last_sent_at: string | null
    last_ok_at: string | null
    last_error: string | null
    last_error_at: string | null
    first_sent_today: number
    failed_24h: number
    leads_fixed: number
    has_token: boolean
    ai_enabled: boolean
}

const fieldLabel = "text-xs font-bold uppercase tracking-widest text-muted-foreground"
const textareaCls = "w-full min-h-[110px] rounded-xl border border-[var(--border)] bg-muted/20 p-3 text-sm leading-relaxed text-[var(--text-main)] outline-none focus:border-primary custom-scrollbar"
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—")

async function fnError(error: any, data: any) {
    if (data?.error) return data.error as string
    const ctx = error ? await error.context?.json?.().catch(() => null) : null
    return ctx?.error ?? error?.message ?? "erro desconhecido"
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-4">
            <div>
                <p className="text-sm font-bold text-[var(--text-main)]">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm font-bold shrink-0">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
                {checked ? "Ligado" : "Desligado"}
            </label>
        </div>
    )
}

const emptyChannel = {
    api_ref: "", api_token: "",
    // preenchidos pela busca no Z-PRO (editáveis)
    found: false, name: "", purpose: "pool" as "official" | "pool", kind: "baileys", phone: "", api_id: "",
    zpro_whatsapp_id: "", daily_limit: 40, zpro_info: null as unknown,
    options: [] as { id: string; name: string; number: string | null; type: string | null; status: string | null }[],
}
const kindFromType = (t: string | null) => {
    const v = String(t ?? "").toLowerCase()
    return v.includes("hybrid") || v.includes("hibrid") ? "hybrid" : v.includes("waba") || v.includes("cloud") || v.includes("meta") ? "waba" : "baileys"
}

export function VivaConnectSettings() {
    const qc = useQueryClient()
    const [form, setForm] = useState<VcSettings | null>(null)
    const [saving, setSaving] = useState(false)
    const [newCh, setNewCh] = useState<typeof emptyChannel | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const [testNumber, setTestNumber] = useState("")
    const [openLog, setOpenLog] = useState<number | null>(null)

    const { data: settings, isLoading } = useQuery({
        queryKey: ["vivaconnect_settings"],
        queryFn: async () => {
            const { data, error } = await supabase.from("vivaconnect_settings").select("*").eq("id", 1).single()
            if (error) throw error
            return data as VcSettings
        },
    })
    useEffect(() => { if (settings) setForm(settings) }, [settings])

    const { data: channels, refetch: refetchChannels } = useQuery({
        queryKey: ["vivaconnect_channels"],
        queryFn: async () => {
            const { data, error } = await supabase.from("vivaconnect_channel_health").select("*").order("id")
            if (error) throw error
            return data as ChannelHealth[]
        },
        refetchInterval: 30000,
    })

    const { data: logs, refetch: refetchLogs } = useQuery({
        queryKey: ["vivaconnect_webhook_logs"],
        queryFn: async () => {
            const { data, error } = await supabase.from("vivaconnect_webhook_logs")
                .select("id, channel_id, outcome, lead_id, payload, created_at").order("id", { ascending: false }).limit(25)
            if (error) throw error
            return data ?? []
        },
        refetchInterval: 15000,
    })

    const { data: outbox, refetch: refetchOutbox } = useQuery({
        queryKey: ["vivaconnect_outbox"],
        queryFn: async () => {
            const { data, error } = await supabase.from("vivaconnect_outbox")
                .select("id, lead_id, channel_id, kind, number, body, status, attempts, error, scheduled_at, sent_at, created_at")
                .order("id", { ascending: false }).limit(25)
            if (error) throw error
            return data ?? []
        },
        refetchInterval: 15000,
    })

    const set = <K extends keyof VcSettings>(k: K, v: VcSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

    const save = async () => {
        if (!form) return
        setSaving(true)
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase.from("vivaconnect_settings").update({
            enabled: form.enabled,
            base_url: form.base_url.trim().replace(/\/$/, ""),
            first_message_enabled: form.first_message_enabled,
            first_message_template: form.first_message_template,
            send_window_start: Number(form.send_window_start),
            send_window_end: Number(form.send_window_end),
            min_interval_seconds: Number(form.min_interval_seconds),
            student_reply_enabled: form.student_reply_enabled,
            student_reply_template: form.student_reply_template,
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
        }).eq("id", 1).select("id")
        setSaving(false)
        if (error || !data?.length) return showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada, recarregue a página."}`)
        qc.invalidateQueries({ queryKey: ["vivaconnect_settings"] })
        showSuccess("Configurações do VivaConnect salvas.")
    }

    const pickOption = (ch: typeof emptyChannel, id: string) => {
        const o = ch.options.find((x) => x.id === id)
        return o ? { ...ch, zpro_whatsapp_id: o.id, name: o.name, phone: o.number ?? "", kind: kindFromType(o.type) } : { ...ch, zpro_whatsapp_id: id }
    }

    const discover = async () => {
        if (!newCh?.api_ref.trim() || !newCh.api_token.trim()) return showError("Cole a URL de integração e o token.")
        setBusy("discover")
        const { data, error } = await supabase.functions.invoke("vivaconnect-api", {
            body: { action: "discover", api_ref: newCh.api_ref, api_token: newCh.api_token },
        })
        setBusy(null)
        if (error || data?.error) return showError(await fnError(error, data))
        const base = { ...newCh, found: true, api_id: data.api_id, options: data.channels ?? [], zpro_info: data.raw }
        if (!data.channels?.length) {
            showSuccess("Token aceito, mas o Z-PRO não listou canais. Preencha nome e número à mão.")
            return setNewCh(base)
        }
        const pre = data.bound_channel_id ?? data.channels[0].id
        setNewCh(pickOption(base, pre))
        showSuccess(data.bound_channel_id ? "Canal desta API encontrado — confira e salve." : "Token aceito. Escolha o canal desta API na lista.")
    }

    const addChannel = async () => {
        if (!newCh?.found) return
        if (!newCh.name.trim()) return showError("Informe um nome.")
        setBusy("add")
        const { data, error } = await supabase.from("vivaconnect_channels").insert({
            name: newCh.name.trim(), purpose: newCh.purpose, kind: newCh.kind,
            phone: newCh.phone.replace(/\D/g, "") || null, api_id: newCh.api_id, api_token: newCh.api_token.trim(),
            zpro_whatsapp_id: newCh.zpro_whatsapp_id || null, zpro_info: newCh.zpro_info,
            daily_limit: Number(newCh.daily_limit) || 40,
        }).select("id")
        setBusy(null)
        if (error || !data?.length) return showError(`Não foi possível cadastrar: ${error?.message ?? "sessão expirada."}`)
        setNewCh(null)
        refetchChannels()
        showSuccess("Canal cadastrado. Copie a URL do webhook dele e cole na API do Z-PRO.")
    }

    const updateChannel = async (id: number, patch: Partial<{ active: boolean; daily_limit: number; ai_enabled: boolean }>) => {
        const { data, error } = await supabase.from("vivaconnect_channels").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id")
        if (error || !data?.length) return showError(`Não foi possível atualizar: ${error?.message ?? "sessão expirada."}`)
        refetchChannels()
    }

    const removeChannel = async (c: ChannelHealth) => {
        if (!confirm(`Remover o canal "${c.name}"? ${c.leads_fixed} lead(s) fixos nele voltam pro pool.`)) return
        const { error } = await supabase.from("vivaconnect_channels").delete().eq("id", c.id)
        if (error) return showError(error.message)
        refetchChannels()
    }

    const testChannel = async (id: number) => {
        setBusy(`test-${id}`)
        const { data, error } = await supabase.functions.invoke("vivaconnect-api", { body: { action: "test_channel", channel_id: id } })
        setBusy(null)
        refetchChannels()
        if (error || data?.error) return showError(`Teste: ${await fnError(error, data)}`)
        if (!data.ok) return showError(`Z-PRO: ${data.error}`)
        showSuccess(data.channel ? `OK — ${data.channel.name} (${data.channel.number ?? "sem número"})${data.status ? ` · ${data.status}` : ""}` : "Token OK — dados atualizados do Z-PRO.")
    }

    const sendTest = async (id: number) => {
        if (!testNumber.replace(/\D/g, "")) return showError("Informe um número pra teste.")
        setBusy(`send-${id}`)
        const { data, error } = await supabase.functions.invoke("vivaconnect-api", {
            body: { action: "send_test", channel_id: id, number: testNumber, body: "Teste de envio do SalesPulse via VivaConnect ✅" },
        })
        setBusy(null)
        refetchOutbox(); refetchChannels()
        if (error || !data?.ok) return showError(`Envio: ${data?.error ?? await fnError(error, data)}`)
        showSuccess("Mensagem de teste enviada.")
    }

    const webhookUrl = (channelId: number) =>
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vivaconnect-webhook?secret=${form?.webhook_secret ?? ""}&channel=${channelId}`
    const copy = (t: string) => navigator.clipboard.writeText(t).then(() => showSuccess("Copiado."))

    if (isLoading || !form) {
        return <div className="space-y-4 max-w-6xl mx-auto"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-96 w-full rounded-2xl" /></div>
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* ── Configurações ───────────────────────────────────────── */}
                <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="text-2xl font-bold flex items-center gap-2"><Plug size={22} className="text-primary" /> VivaConnect</CardTitle>
                        <CardDescription className="text-sm">
                            Integração com o WhatsApp próprio (Z-PRO). Roda em paralelo ao WideChat — nada do WideChat muda.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label="Integração ativa"
                            hint="Desligada = os webhooks só ficam registrados (lista abaixo) e nada é enviado." />
                        <div className="space-y-2">
                            <Label className={fieldLabel}>Endereço da API do Z-PRO</Label>
                            <Input value={form.base_url} onChange={(e) => set("base_url", e.target.value)} className="bg-muted/20 font-mono text-sm" />
                        </div>

                        <Toggle checked={form.first_message_enabled} onChange={(v) => set("first_message_enabled", v)} label="1ª mensagem automática"
                            hint="Lead do formulário que escolheu WhatsApp recebe a mensagem abaixo por um número do pool." />
                        <div className="space-y-2">
                            <Label className={fieldLabel}>Texto da 1ª mensagem</Label>
                            <textarea className={textareaCls} value={form.first_message_template} onChange={(e) => set("first_message_template", e.target.value)} />
                            <p className="text-[11px] text-muted-foreground">Variáveis: {"{primeiro_nome}"}, {"{curso}"}, {"{curso_trecho}"} (vira " no curso de X" ou nada).</p>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                                <Label className={fieldLabel}>Envia das</Label>
                                <Input type="number" min={0} max={23} value={form.send_window_start} onChange={(e) => set("send_window_start", Number(e.target.value))} className="bg-muted/20" />
                            </div>
                            <div className="space-y-2">
                                <Label className={fieldLabel}>Até as</Label>
                                <Input type="number" min={1} max={24} value={form.send_window_end} onChange={(e) => set("send_window_end", Number(e.target.value))} className="bg-muted/20" />
                            </div>
                            <div className="space-y-2">
                                <Label className={fieldLabel}>Intervalo (s)</Label>
                                <Input type="number" min={10} value={form.min_interval_seconds} onChange={(e) => set("min_interval_seconds", Number(e.target.value))} className="bg-muted/20" />
                            </div>
                        </div>

                        <Toggle checked={form.student_reply_enabled} onChange={(v) => set("student_reply_enabled", v)} label="Aluno no número oficial → link do portal"
                            hint="Telefone com matrícula ativa no Sponte recebe o texto abaixo (1x a cada 24h) e não vira lead." />
                        <textarea className={textareaCls} value={form.student_reply_template} onChange={(e) => set("student_reply_template", e.target.value)} />

                        <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-[var(--border)] p-3">
                            🤖 <b>IA</b>: marque <b>“IA responde”</b> em cada número (ao lado) para a IA atender automaticamente quem escrever nele. Também precisa estar ligada em <b>IA de Atendimento</b>.
                        </p>

                        <Button onClick={save} disabled={saving} className="w-full">
                            {saving ? <Loader2 className="animate-spin" size={16} /> : "Salvar configurações"}
                        </Button>
                    </CardContent>
                </Card>

                {/* ── Canais ──────────────────────────────────────────────── */}
                <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-bold flex items-center gap-2"><Smartphone size={20} className="text-primary" /> Números (canais)</CardTitle>
                            <CardDescription className="text-sm">Cada número do Z-PRO tem sua própria API (ID + token).</CardDescription>
                        </div>
                        {!newCh && <Button size="sm" onClick={() => setNewCh({ ...emptyChannel })}><Plus size={14} className="mr-1" /> Número</Button>}
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {newCh && (
                            <div className="rounded-xl border border-primary/40 p-4 space-y-3">
                                <p className="text-xs text-muted-foreground">
                                    No Z-PRO, em <b>APIs</b>, copie a <b>URL de integração</b> e o <b>token</b> (o token só aparece quando a API é criada — se não guardou, gere outro no botão de atualizar da API).
                                </p>
                                <div className="space-y-1"><Label className={fieldLabel}>URL de integração</Label>
                                    <Input value={newCh.api_ref} disabled={newCh.found} onChange={(e) => setNewCh({ ...newCh, api_ref: e.target.value })}
                                        placeholder="https://api.ficv.edu.br/v2/api/external/..." className="bg-muted/20 font-mono text-xs" /></div>
                                <div className="space-y-1"><Label className={fieldLabel}>Token</Label>
                                    <Input type="password" autoComplete="off" value={newCh.api_token} disabled={newCh.found} onChange={(e) => setNewCh({ ...newCh, api_token: e.target.value })}
                                        className="bg-muted/20 font-mono text-xs" /></div>

                                {newCh.found && (
                                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]">
                                        {newCh.options.length > 1 && (
                                            <div className="space-y-1 col-span-2"><Label className={fieldLabel}>Canal desta API</Label>
                                                <select value={newCh.zpro_whatsapp_id} onChange={(e) => setNewCh(pickOption(newCh, e.target.value))}
                                                    className="w-full h-10 rounded-md border border-[var(--border)] bg-muted/20 px-3 text-sm">
                                                    {newCh.options.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.number ?? "sem número"} · {o.type ?? "?"}{o.status ? ` · ${o.status}` : ""}</option>)}
                                                </select></div>
                                        )}
                                        <div className="space-y-1"><Label className={fieldLabel}>Nome</Label>
                                            <Input value={newCh.name} onChange={(e) => setNewCh({ ...newCh, name: e.target.value })} className="bg-muted/20" /></div>
                                        <div className="space-y-1"><Label className={fieldLabel}>Número</Label>
                                            <Input value={newCh.phone} onChange={(e) => setNewCh({ ...newCh, phone: e.target.value })} placeholder="5583999999999" className="bg-muted/20" /></div>
                                        <div className="space-y-1"><Label className={fieldLabel}>Uso</Label>
                                            <select value={newCh.purpose} onChange={(e) => setNewCh({ ...newCh, purpose: e.target.value as "official" | "pool" })}
                                                className="w-full h-10 rounded-md border border-[var(--border)] bg-muted/20 px-3 text-sm">
                                                <option value="pool">Pool — contato ativo (1ª mensagem)</option>
                                                <option value="official">Oficial — entrada (WABA/Híbrido)</option>
                                            </select></div>
                                        <div className="space-y-1"><Label className={fieldLabel}>Tipo</Label>
                                            <select value={newCh.kind} onChange={(e) => setNewCh({ ...newCh, kind: e.target.value })}
                                                className="w-full h-10 rounded-md border border-[var(--border)] bg-muted/20 px-3 text-sm">
                                                <option value="baileys">Baileys</option>
                                                <option value="waba">WABA</option>
                                                <option value="hybrid">Híbrido</option>
                                            </select></div>
                                        <div className="space-y-1"><Label className={fieldLabel}>Limite de 1ªs mensagens/dia</Label>
                                            <Input type="number" value={newCh.daily_limit} onChange={(e) => setNewCh({ ...newCh, daily_limit: Number(e.target.value) })} className="bg-muted/20" /></div>
                                    </div>
                                )}

                                <div className="flex gap-2 justify-end">
                                    <Button variant="ghost" size="sm" onClick={() => setNewCh(null)}>Cancelar</Button>
                                    {newCh.found && <Button variant="ghost" size="sm" onClick={() => setNewCh({ ...newCh, found: false })}>Trocar token</Button>}
                                    {!newCh.found
                                        ? <Button size="sm" onClick={discover} disabled={busy === "discover"}>{busy === "discover" ? <Loader2 className="animate-spin" size={14} /> : "Buscar no Z-PRO"}</Button>
                                        : <Button size="sm" onClick={addChannel} disabled={busy === "add"}>{busy === "add" ? <Loader2 className="animate-spin" size={14} /> : "Salvar número"}</Button>}
                                </div>
                            </div>
                        )}

                        {!channels?.length && !newCh && (
                            <p className="text-sm text-muted-foreground">Nenhum número cadastrado ainda. Clique em “+ Número” e cole a URL de integração + token da API do Z-PRO: nome, número e tipo vêm sozinhos.</p>
                        )}

                        {channels?.map((c) => (
                            <div key={c.id} className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-bold text-[var(--text-main)] flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${!c.active ? "bg-muted-foreground" : c.last_error_at && (!c.last_ok_at || c.last_error_at > c.last_ok_at) ? "bg-red-500" : c.last_ok_at ? "bg-emerald-500" : "bg-amber-500"}`} />
                                            {c.name} <span className="text-xs font-normal text-muted-foreground">#{c.id} · {c.purpose === "pool" ? "Pool" : "Oficial"} · {c.kind}</span>
                                        </p>
                                        <p className="text-xs text-muted-foreground font-mono">{c.phone ?? "sem número"} · API {c.api_id}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <label className="flex items-center gap-1 text-xs cursor-pointer mr-2" title="A IA responde automaticamente quem escrever neste número (não-alunos)">
                                            <input type="checkbox" checked={c.ai_enabled} onChange={(e) => updateChannel(c.id, { ai_enabled: e.target.checked })} className="accent-[var(--primary)]" /> 🤖 IA responde
                                        </label>
                                        <label className="flex items-center gap-1 text-xs cursor-pointer mr-2">
                                            <input type="checkbox" checked={c.active} onChange={(e) => updateChannel(c.id, { active: e.target.checked })} className="accent-[var(--primary)]" /> ativo
                                        </label>
                                        <Button size="icon" variant="ghost" title="Testar e atualizar do Z-PRO" onClick={() => testChannel(c.id)} disabled={busy === `test-${c.id}`}>
                                            {busy === `test-${c.id}` ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                                        </Button>
                                        <Button size="icon" variant="ghost" title="Remover" onClick={() => removeChannel(c)}><Trash2 size={14} /></Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 gap-2 text-center">
                                    <div className="rounded-lg bg-muted/30 p-2"><p className="text-lg font-bold">{c.first_sent_today}/{c.daily_limit}</p><p className="text-[10px] uppercase text-muted-foreground">1ªs hoje</p></div>
                                    <div className="rounded-lg bg-muted/30 p-2"><p className="text-lg font-bold">{c.leads_fixed}</p><p className="text-[10px] uppercase text-muted-foreground">leads fixos</p></div>
                                    <div className="rounded-lg bg-muted/30 p-2"><p className={`text-lg font-bold ${c.failed_24h ? "text-red-500" : ""}`}>{c.failed_24h}</p><p className="text-[10px] uppercase text-muted-foreground">falhas 24h</p></div>
                                    <div className="rounded-lg bg-muted/30 p-2"><p className="text-xs font-bold pt-1">{fmt(c.last_sent_at)}</p><p className="text-[10px] uppercase text-muted-foreground">último envio</p></div>
                                </div>
                                {c.last_error && (!c.last_ok_at || (c.last_error_at ?? "") > c.last_ok_at) && (
                                    <p className="text-xs text-red-500 break-all">Último erro ({fmt(c.last_error_at)}): {c.last_error}</p>
                                )}
                                <div className="flex items-center gap-2">
                                    <Input readOnly value={webhookUrl(c.id)} className="bg-muted/20 font-mono text-[10px] h-8" />
                                    <Button size="sm" variant="outline" onClick={() => copy(webhookUrl(c.id))} title="Copiar URL do webhook"><Copy size={12} className="mr-1" /> Webhook</Button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="Número p/ teste (5583...)" className="bg-muted/20 h-8 text-xs" />
                                    <Button size="sm" variant="outline" onClick={() => sendTest(c.id)} disabled={busy === `send-${c.id}`}>
                                        {busy === `send-${c.id}` ? <Loader2 className="animate-spin" size={12} /> : <><Send size={12} className="mr-1" /> Enviar teste</>}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            {/* ── Diagnóstico ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg font-bold">Webhooks recebidos</CardTitle>
                        <Button size="icon" variant="ghost" onClick={() => refetchLogs()}><RefreshCw size={14} /></Button>
                    </CardHeader>
                    <CardContent className="space-y-1 max-h-[480px] overflow-y-auto custom-scrollbar">
                        {!logs?.length && <p className="text-sm text-muted-foreground">Nada recebido ainda.</p>}
                        {logs?.map((l: any) => (
                            <div key={l.id} className="text-xs border-b border-[var(--border)] py-1.5">
                                <button className="w-full text-left flex gap-2" onClick={() => setOpenLog(openLog === l.id ? null : l.id)}>
                                    <span className="text-muted-foreground shrink-0">{fmt(l.created_at)}</span>
                                    <span className="text-muted-foreground shrink-0">canal {l.channel_id ?? "?"}</span>
                                    <span className={`truncate ${String(l.outcome ?? "").startsWith("error") ? "text-red-500" : "text-[var(--text-main)]"}`}>{l.outcome ?? "…"}</span>
                                    {l.lead_id && <span className="text-primary shrink-0">lead {l.lead_id}</span>}
                                </button>
                                {openLog === l.id && (
                                    <pre className="mt-1 p-2 rounded bg-muted/30 overflow-x-auto text-[10px] max-h-72">{JSON.stringify(l.payload, null, 2)}</pre>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>

                <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg font-bold">Fila de envio</CardTitle>
                        <Button size="icon" variant="ghost" onClick={() => refetchOutbox()}><RefreshCw size={14} /></Button>
                    </CardHeader>
                    <CardContent className="space-y-1 max-h-[480px] overflow-y-auto custom-scrollbar">
                        {!outbox?.length && <p className="text-sm text-muted-foreground">Nenhum envio ainda.</p>}
                        {outbox?.map((o: any) => (
                            <div key={o.id} className="text-xs border-b border-[var(--border)] py-1.5 space-y-0.5">
                                <div className="flex gap-2">
                                    <span className="text-muted-foreground shrink-0">{fmt(o.sent_at ?? o.created_at)}</span>
                                    <span className={`font-bold shrink-0 ${o.status === "sent" ? "text-emerald-500" : o.status === "failed" ? "text-red-500" : "text-amber-500"}`}>{o.status}</span>
                                    <span className="shrink-0">{o.kind}</span>
                                    <span className="font-mono text-muted-foreground shrink-0">{o.number}</span>
                                    {o.lead_id && <span className="text-primary shrink-0">lead {o.lead_id}</span>}
                                </div>
                                <p className="text-muted-foreground truncate">{o.body}</p>
                                {o.error && <p className="text-red-500 break-all">{o.error}</p>}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
