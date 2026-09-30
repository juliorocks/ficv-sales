// Tela "IA de Atendimento" (VivaConnect): persona/regras da IA + simulador de
// conversa. O simulador chama a edge function ai-agent com dry_run (não grava
// nada, não mexe em lead) — serve pra testar a base de conhecimento e o prompt
// antes de ligar a IA no WhatsApp.
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Activity, Bot, Loader2, RotateCcw, Send, UserRound, ArrowRightLeft, BookOpen } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Combobox } from "@/components/ui/combobox"
import { showError, showSuccess } from "@/utils/toast"
import { Skeleton } from "@/components/ui/skeleton"

interface AiSettings {
    enabled: boolean
    agent_name: string
    system_prompt: string
    handoff_instructions: string
    chat_model: string
    embedding_model: string
    temperature: number
    match_count: number
    min_similarity: number
    max_ai_turns: number
    handoff_message: string
    horario_atendimento: string
    /** reengajamento: lead ficou quieto depois de UMA mensagem nossa → a IA tenta de novo sozinha */
    followup_enabled: boolean
    followup_after_hours: number
    followup_max_count: number
    /** esgotou as tentativas acima e continuou sem responder → encerra sozinho (usa a
     * mensagem de despedida configurada em Gestão > VivaConnect > Finalizar) */
    followup_giveup_enabled: boolean
    followup_giveup_hours: number
}

interface ChatMsg {
    role: "user" | "assistant"
    content: string
    handoff?: boolean
    handoff_reason?: string | null
    summary?: string | null
    sources?: { title: string; similarity: number }[]
}

const fieldLabel = "text-xs font-bold uppercase tracking-widest text-muted-foreground"
const textareaCls = "w-full min-h-[160px] rounded-xl border border-[var(--border)] bg-muted/20 p-3 text-sm leading-relaxed text-[var(--text-main)] outline-none focus:border-primary custom-scrollbar"

export function AiAgentSettings() {
    const queryClient = useQueryClient()
    const [form, setForm] = useState<AiSettings | null>(null)
    const [saving, setSaving] = useState(false)

    const { data: settings, isLoading } = useQuery({
        queryKey: ["ai_agent_settings"],
        queryFn: async () => {
            const { data, error } = await supabase.from("ai_agent_settings").select("*").eq("id", 1).single()
            if (error) throw error
            return data as AiSettings
        },
    })

    const { data: kbStats } = useQuery({
        queryKey: ["kb_stats"],
        queryFn: async () => {
            const { data, error } = await supabase.from("knowledge_base").select("index_status, ai_enabled, chunk_count")
            if (error) throw error
            const inAi = (data ?? []).filter((d) => d.ai_enabled !== false)
            return {
                total: inAi.length,
                ready: inAi.filter((d) => d.index_status === "ready").length,
                chunks: inAi.reduce((s, d) => s + (d.chunk_count ?? 0), 0),
            }
        },
    })

    // Acompanhamento (29/09, pedido do usuário) — em especial o "leadsSemSessao": leads na
    // etapa "IA Atendendo" que NÃO têm sessão ativa de verdade em ai_lead_sessions. É
    // exatamente o sinal do bug achado ao vivo hoje (cron externo jogou ~210 leads nessa
    // etapa sem a IA ter feito nada) — com isso visível aqui, dá pra notar sem precisar
    // reparar sozinho no Kanban.
    const { data: health } = useQuery({
        queryKey: ["ai_health"],
        queryFn: async () => {
            const hojeInicio = new Date(); hojeInicio.setHours(0, 0, 0, 0)
            const [{ data: stage }, { count: ativas }, { count: handoffsHoje }, { count: followupsHoje }] = await Promise.all([
                supabase.from("stages").select("id").ilike("name", "%ia atend%").maybeSingle(),
                supabase.from("ai_lead_sessions").select("*", { count: "exact", head: true }).eq("status", "active"),
                supabase.from("ai_lead_sessions").select("*", { count: "exact", head: true }).gte("handed_off_at", hojeInicio.toISOString()),
                supabase.from("ai_lead_sessions").select("*", { count: "exact", head: true }).gte("last_followup_at", hojeInicio.toISOString()),
            ])
            let leadsSemSessao = 0
            if (stage?.id) {
                const [{ data: leadsNaEtapa }, { data: sessoesAtivas }] = await Promise.all([
                    supabase.from("leads").select("id").eq("stage_id", stage.id),
                    supabase.from("ai_lead_sessions").select("lead_id").eq("status", "active"),
                ])
                const comSessao = new Set((sessoesAtivas ?? []).map((s) => s.lead_id))
                leadsSemSessao = (leadsNaEtapa ?? []).filter((l) => !comSessao.has(l.id)).length
            }
            return { ativas: ativas ?? 0, handoffsHoje: handoffsHoje ?? 0, followupsHoje: followupsHoje ?? 0, leadsSemSessao }
        },
        refetchInterval: 60_000,
    })

    const { data: courses } = useQuery({
        queryKey: ["courses_min"],
        queryFn: async () => {
            const { data } = await supabase.from("courses").select("id, name").order("name")
            return data ?? []
        },
    })

    // Modelos de chat da conta OpenAI configurada — dropdown em vez de digitar o id na mão
    // (pedido do usuário 29/09). Cacheia 1h: a lista quase não muda de um dia pro outro.
    const { data: openaiModels, isFetching: loadingModels, refetch: refetchModels } = useQuery({
        queryKey: ["openai_models"],
        queryFn: async () => {
            const { data, error } = await supabase.functions.invoke("openai-models")
            if (error) throw error
            if (data?.error) throw new Error(data.error)
            return (data?.models ?? []) as { id: string; created: number }[]
        },
        staleTime: 60 * 60_000,
        retry: false,
    })

    useEffect(() => { if (settings) setForm(settings) }, [settings])

    const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

    const save = async () => {
        if (!form) return
        setSaving(true)
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase.from("ai_agent_settings").update({
            enabled: form.enabled,
            agent_name: form.agent_name.trim() || "Vivi",
            system_prompt: form.system_prompt,
            handoff_instructions: form.handoff_instructions,
            chat_model: form.chat_model.trim(),
            temperature: Number(form.temperature),
            match_count: Number(form.match_count),
            min_similarity: Number(form.min_similarity),
            max_ai_turns: Number(form.max_ai_turns),
            handoff_message: form.handoff_message,
            horario_atendimento: form.horario_atendimento,
            followup_enabled: form.followup_enabled,
            followup_after_hours: Number(form.followup_after_hours),
            followup_max_count: Number(form.followup_max_count),
            followup_giveup_enabled: form.followup_giveup_enabled,
            followup_giveup_hours: Number(form.followup_giveup_hours),
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
        }).eq("id", 1).select("id")
        setSaving(false)
        if (error || !data?.length) {
            showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada, recarregue a página."}`)
            return
        }
        queryClient.invalidateQueries({ queryKey: ["ai_agent_settings"] })
        showSuccess("Configurações da IA salvas.")
    }

    // ── simulador ────────────────────────────────────────────────────────────
    const [leadName, setLeadName] = useState("Ana")
    const [leadCourse, setLeadCourse] = useState("")
    const [chat, setChat] = useState<ChatMsg[]>([])
    const [draft, setDraft] = useState("")
    const [thinking, setThinking] = useState(false)
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [chat, thinking])

    const handedOff = chat.some((m) => m.handoff)

    const send = async () => {
        const text = draft.trim()
        if (!text || thinking || handedOff) return
        const next: ChatMsg[] = [...chat, { role: "user", content: text }]
        setChat(next)
        setDraft("")
        setThinking(true)
        const { data, error } = await supabase.functions.invoke("ai-agent", {
            body: {
                dry_run: true,
                lead: { nome: leadName || null, curso: leadCourse || null },
                messages: next.map(({ role, content }) => ({ role, content })),
            },
        })
        setThinking(false)
        if (error || data?.error) {
            const ctx = error ? await (error as any).context?.json?.().catch(() => null) : null
            showError(`IA: ${data?.error ?? ctx?.error ?? error?.message}`)
            setChat(chat)
            setDraft(text)
            return
        }
        // `replies` = a resposta em blocos (ex.: grade numa mensagem, valores em outra) —
        // cada bloco vira uma bolha própria no simulador, igual sairia no WhatsApp de
        // verdade. Só o ÚLTIMO bloco carrega handoff/summary/sources (é onde termina o turno).
        const blocks: string[] = Array.isArray(data.replies) && data.replies.length ? data.replies : [data.reply]
        setChat([...next, ...blocks.map((content, i) => ({
            role: "assistant" as const, content,
            ...(i === blocks.length - 1 ? { handoff: data.handoff, handoff_reason: data.handoff_reason, summary: data.summary, sources: data.sources } : {}),
        }))])
    }

    if (isLoading || !form) {
        return <div className="space-y-4 max-w-6xl mx-auto"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-96 w-full rounded-2xl" /></div>
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* ── Acompanhamento ───────────────────────────────────────── */}
            <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold flex items-center gap-2"><Activity size={16} className="text-primary" /> Acompanhamento</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-[var(--border)] p-3">
                            <p className="text-2xl font-bold">{health?.ativas ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Sessões ativas agora</p>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] p-3">
                            <p className="text-2xl font-bold">{health?.handoffsHoje ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Handoffs hoje</p>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] p-3">
                            <p className="text-2xl font-bold">{health?.followupsHoje ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Follow-ups hoje</p>
                        </div>
                        <div className={`rounded-xl border p-3 ${health && health.leadsSemSessao > 0 ? "border-amber-500/50 bg-amber-500/10" : "border-[var(--border)]"}`}>
                            <p className={`text-2xl font-bold ${health && health.leadsSemSessao > 0 ? "text-amber-500" : ""}`}>{health?.leadsSemSessao ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">
                                {health && health.leadsSemSessao > 0 ? "⚠️ Em IA Atendendo sem sessão real" : "Em IA Atendendo sem sessão real"}
                            </p>
                        </div>
                    </div>
                    {health && health.leadsSemSessao > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                            Tem lead na coluna "IA Atendendo" do Funil que a IA não está atendendo de verdade — pode ser um bug parecido com o de 29/09 (cron externo movendo leads sem a IA ter feito nada). Vale conferir o Funil de Leads.
                        </p>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* ── Configuração ─────────────────────────────────────────── */}
            <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                <CardHeader>
                    <CardTitle className="text-2xl font-bold flex items-center gap-2"><Bot size={22} className="text-primary" /> IA de Atendimento</CardTitle>
                    <CardDescription className="text-sm">
                        Persona e regras da IA que conduz a conversa com o lead no WhatsApp (VivaConnect) até passar para um consultor.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-4">
                        <div>
                            <p className="text-sm font-bold text-[var(--text-main)]">Responder leads automaticamente</p>
                            <p className="text-xs text-muted-foreground">
                                Desligado = a IA só responde aqui no simulador. Ligue quando o VivaConnect estiver conectado.
                            </p>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold">
                            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
                            {form.enabled ? "Ligada" : "Desligada"}
                        </label>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <BookOpen size={14} />
                        Base de conhecimento: <b className="text-[var(--text-main)]">{kbStats?.ready ?? 0}/{kbStats?.total ?? 0}</b> documentos indexados · {kbStats?.chunks ?? 0} trechos
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className={fieldLabel}>Nome da IA</Label>
                            <Input value={form.agent_name} onChange={(e) => set("agent_name", e.target.value)} className="bg-muted/20" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className={fieldLabel}>Modelo (OpenAI)</Label>
                                <button
                                    type="button" onClick={() => refetchModels()} disabled={loadingModels}
                                    className="text-muted-foreground hover:text-[var(--text-main)] disabled:opacity-50"
                                    title="Atualizar lista de modelos"
                                >
                                    <RotateCcw size={12} className={loadingModels ? "animate-spin" : ""} />
                                </button>
                            </div>
                            {/* Combobox (Popover+busca), não <select> nem <datalist>: o datalist nativo
                                só sugere o que bate com o texto JÁ digitado no campo — abrir com
                                "gpt-4.1-mini" preenchido mostrava só 2 de 69 modelos (achado ao vivo
                                29/09). O combobox sempre abre com a lista INTEIRA (zera a busca ao
                                abrir) e ainda aceita valor customizado (allowCustomValue) pro caso da
                                API Key não estar configurada ou um modelo novo que o filtro não pegue. */}
                            <Combobox
                                value={form.chat_model}
                                onValueChange={(v) => set("chat_model", v)}
                                allowCustomValue
                                placeholder="gpt-4.1-mini"
                                searchPlaceholder="Buscar modelo…"
                                emptyText={loadingModels ? "Carregando…" : "Nenhum modelo encontrado."}
                                className="h-10 w-full font-mono"
                                groups={[{ options: (openaiModels ?? []).map((m) => ({ value: m.id, label: m.id })) }]}
                            />
                            {!loadingModels && !openaiModels?.length && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                    Não consegui puxar a lista da OpenAI (confira a API Key em Gestão &gt; Integrações) — o campo continua funcionando, só sem sugestões.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className={fieldLabel}>Persona e instruções</Label>
                        <textarea className={textareaCls} value={form.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} />
                    </div>

                    <div className="space-y-2">
                        <Label className={fieldLabel}>Quando passar para um consultor (handoff)</Label>
                        <textarea className={`${textareaCls} min-h-[130px]`} value={form.handoff_instructions} onChange={(e) => set("handoff_instructions", e.target.value)} />
                    </div>

                    <div className="space-y-2">
                        <Label className={fieldLabel}>Aviso de transferência (sempre enviado ao passar pra consultor)</Label>
                        <textarea className={textareaCls} value={form.handoff_message} onChange={(e) => set("handoff_message", e.target.value)} />
                        <p className="text-[11px] text-muted-foreground">
                            Entra sempre logo depois da resposta da IA quando ela decide transferir — não depende do modelo lembrar de avisar.
                            Variáveis: {"{primeiro_nome}"}, {"{nome_virgula}"} (vira ", Maria" ou nada), {"{horario}"}.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label className={fieldLabel}>Horário de atendimento humano</Label>
                        <Input value={form.horario_atendimento} onChange={(e) => set("horario_atendimento", e.target.value)} className="bg-muted/20" />
                    </div>

                    <div className="rounded-xl border border-[var(--border)] p-4 space-y-4">
                        <div>
                            <p className="text-sm font-bold text-[var(--text-main)]">Reengajar lead que ficou quieto</p>
                            <p className="text-xs text-muted-foreground">
                                Se o lead não responde depois de UMA mensagem nossa, a IA tenta puxar assunto de novo sozinha — escrita na hora, com base no histórico real da conversa.
                            </p>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold">
                            <input type="checkbox" checked={form.followup_enabled} onChange={(e) => set("followup_enabled", e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
                            {form.followup_enabled ? "Ligado" : "Desligado"}
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className={fieldLabel} title="Quantas horas de silêncio esperar antes de tentar de novo">Esperar (horas)</Label>
                                <Input type="number" min="1" step="0.5" value={form.followup_after_hours} onChange={(e) => set("followup_after_hours", Number(e.target.value))} className="bg-muted/20" />
                            </div>
                            <div className="space-y-2">
                                <Label className={fieldLabel} title="Quantas vezes tenta reengajar antes de desistir">Tentativas</Label>
                                <Input type="number" min="1" value={form.followup_max_count} onChange={(e) => set("followup_max_count", Number(e.target.value))} className="bg-muted/20" />
                            </div>
                        </div>

                        <div className="border-t border-[var(--border)] pt-4">
                            <p className="text-sm font-bold text-[var(--text-main)]">Encerrar sozinho se continuar sem resposta</p>
                            <p className="text-xs text-muted-foreground">
                                Esgotadas as tentativas acima, se ainda assim o lead não responder, encerra o atendimento automaticamente (move pra Finalizado e manda a mensagem de despedida configurada em <b>Gestão &gt; VivaConnect &gt; Finalizar</b>).
                            </p>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold">
                            <input type="checkbox" checked={form.followup_giveup_enabled} onChange={(e) => set("followup_giveup_enabled", e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
                            {form.followup_giveup_enabled ? "Ligado" : "Desligado"}
                        </label>
                        <div className="space-y-2 max-w-[200px]">
                            <Label className={fieldLabel} title="Depois da última tentativa, quantas horas sem resposta até desistir de vez">Sem resposta por (horas)</Label>
                            <Input type="number" min="1" step="1" value={form.followup_giveup_hours} onChange={(e) => set("followup_giveup_hours", Number(e.target.value))} className="bg-muted/20" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <Label className={fieldLabel} title="0 = respostas mais previsíveis; 1 = mais criativas">Criatividade</Label>
                            <Input type="number" step="0.1" min="0" max="1" value={form.temperature} onChange={(e) => set("temperature", Number(e.target.value))} className="bg-muted/20" />
                        </div>
                        <div className="space-y-2">
                            <Label className={fieldLabel} title="Quantos trechos da base a IA lê por resposta">Trechos</Label>
                            <Input type="number" min="1" max="20" value={form.match_count} onChange={(e) => set("match_count", Number(e.target.value))} className="bg-muted/20" />
                        </div>
                        <div className="space-y-2">
                            <Label className={fieldLabel} title="Similaridade mínima (0–1) pra um trecho ser usado">Similaridade</Label>
                            <Input type="number" step="0.05" min="0" max="1" value={form.min_similarity} onChange={(e) => set("min_similarity", Number(e.target.value))} className="bg-muted/20" />
                        </div>
                        <div className="space-y-2">
                            <Label className={fieldLabel} title="Depois de N respostas da IA, passa pro consultor automaticamente">Máx. respostas</Label>
                            <Input type="number" min="1" value={form.max_ai_turns} onChange={(e) => set("max_ai_turns", Number(e.target.value))} className="bg-muted/20" />
                        </div>
                    </div>

                    <Button onClick={save} disabled={saving} className="min-w-[160px] bg-primary hover:bg-primary/90 h-11 shadow-lg shadow-primary/20">
                        {saving ? "Salvando..." : "Salvar configurações"}
                    </Button>
                </CardContent>
            </Card>

            {/* ── Simulador ────────────────────────────────────────────── */}
            <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md flex flex-col h-[calc(100vh-180px)] min-h-[560px]">
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <CardTitle className="text-lg font-bold">Simulador</CardTitle>
                            <CardDescription className="text-xs">Converse como se fosse o lead. Nada é gravado e nenhuma mensagem é enviada.</CardDescription>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setChat([])} className="gap-1.5 shrink-0">
                            <RotateCcw size={14} /> Recomeçar
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Nome do lead" className="h-9 bg-muted/20 text-sm" />
                        <select
                            value={leadCourse}
                            onChange={(e) => setLeadCourse(e.target.value)}
                            className="h-9 rounded-md border border-[var(--border)] bg-muted/20 px-2 text-sm text-[var(--text-main)]"
                        >
                            <option value="">Curso do formulário (nenhum)</option>
                            {(courses ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0 gap-3">
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                        {chat.length === 0 && (
                            <p className="text-center text-xs text-muted-foreground pt-10">
                                Mande a primeira mensagem como o lead — ex: "oi, quanto custa a pós em psicoteologia?"
                            </p>
                        )}
                        {chat.map((m, i) => (
                            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[85%] space-y-1.5 ${m.role === "user" ? "items-end" : ""}`}>
                                    <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${m.role === "user" ? "justify-end" : ""}`}>
                                        {m.role === "user" ? <><UserRound size={11} /> {leadName || "Lead"}</> : <><Bot size={11} /> {form.agent_name}</>}
                                    </div>
                                    <div className={`rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "bg-primary text-white rounded-br-sm" : "bg-[var(--bg-card-hover)] border border-[var(--border)] text-[var(--text-main)] rounded-bl-sm"}`}>
                                        {m.content}
                                    </div>
                                    {m.sources && m.sources.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {m.sources.map((s, j) => (
                                                <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground" title={`similaridade ${s.similarity}`}>
                                                    {s.title} · {Math.round(s.similarity * 100)}%
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {m.role === "assistant" && m.sources?.length === 0 && (
                                        <p className="text-[10px] text-amber-500">Nenhum trecho da base foi usado nesta resposta.</p>
                                    )}
                                    {m.handoff && (
                                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
                                            <p className="font-bold text-amber-500 flex items-center gap-1.5"><ArrowRightLeft size={13} /> Handoff para consultor</p>
                                            {m.handoff_reason && <p><b>Motivo:</b> {m.handoff_reason}</p>}
                                            {m.summary && <p><b>Resumo pro consultor:</b> {m.summary}</p>}
                                            <p className="text-muted-foreground">A partir daqui a IA não responde mais este lead.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {thinking && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> {form.agent_name} está digitando…</div>
                        )}
                        <div ref={endRef} />
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex gap-2">
                        <Input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={handedOff ? "Conversa passada ao consultor — clique em Recomeçar" : "Mensagem do lead…"}
                            disabled={thinking || handedOff}
                            className="bg-muted/20"
                        />
                        <Button type="submit" disabled={thinking || handedOff || !draft.trim()} className="bg-primary hover:bg-primary/90 px-3">
                            <Send size={16} />
                        </Button>
                    </form>
                </CardContent>
            </Card>
            </div>
        </div>
    )
}
