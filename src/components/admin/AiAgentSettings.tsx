// Tela "IA de Atendimento" (VivaConnect): persona/regras da IA + simulador de
// conversa. O simulador chama a edge function ai-agent com dry_run (não grava
// nada, não mexe em lead) — serve pra testar a base de conhecimento e o prompt
// antes de ligar a IA no WhatsApp.
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Bot, Loader2, RotateCcw, Send, UserRound, ArrowRightLeft, BookOpen } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

    const { data: courses } = useQuery({
        queryKey: ["courses_min"],
        queryFn: async () => {
            const { data } = await supabase.from("courses").select("id, name").order("name")
            return data ?? []
        },
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
        setChat([...next, {
            role: "assistant", content: data.reply, handoff: data.handoff,
            handoff_reason: data.handoff_reason, summary: data.summary, sources: data.sources,
        }])
    }

    if (isLoading || !form) {
        return <div className="space-y-4 max-w-6xl mx-auto"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-96 w-full rounded-2xl" /></div>
    }

    return (
        <div className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-2 gap-6">
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
                            <Label className={fieldLabel}>Modelo (OpenAI)</Label>
                            <Input value={form.chat_model} onChange={(e) => set("chat_model", e.target.value)} className="bg-muted/20 font-mono text-sm" />
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
    )
}
