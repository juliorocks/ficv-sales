import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, MessageSquare, Send, Loader2, FileText, Zap, Plus } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { showError, showSuccess } from "@/utils/toast"

// Canal padrão da Faculdade (mesmo default usado no widechat-webhook) — usado como
// fallback pra listar/enviar template quando ainda não existe nenhum atendimento
// (ex: iniciar conversa nova com um lead que só preencheu formulário até agora).
const DEFAULT_CHANNEL_ID = '694534a0132843fbb436bd48'

interface WideChatHistoryProps {
    widechatContactId: string
    leadId: number | string
    telefone?: string | null // usado p/ achar conversas ligadas a outro registro do mesmo lead
}

// O WideChat mandava a hora em horário de Brasília SEM fuso e o webhook gravava
// como se fosse UTC -> mensagens antigas estão 3h atrás do instante real.
// A partir de WEBHOOK_TZFIX o webhook grava o UTC correto. Aqui: exibimos sempre
// no fuso de Brasília (independente da máquina de quem olha) e somamos 3h nas
// mensagens gravadas antes da correção.
const WEBHOOK_TZFIX = new Date("2026-09-03T13:55:34Z").getTime()
const fmtHora = (iso: string) => {
    const t = new Date(iso).getTime()
    if (isNaN(t)) return ""
    const d = new Date(t < WEBHOOK_TZFIX ? t + 3 * 3600_000 : t)
    return d.toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
    })
}

interface WideChatMessage {
    id: string
    lead_id: number | string
    message_id: string
    message: string
    created_at: string
    origin: string // 'channel' (user), 'agent' (human), 'auto' (bot)
    type: string
    sender_name?: string
}

export function WideChatHistory({ widechatContactId, leadId, telefone }: WideChatHistoryProps) {
    const queryClient = useQueryClient()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [newMessage, setNewMessage] = useState("")

    // O mesmo cliente pode ter vários registros de lead (formulário + WhatsApp).
    // Casa pelo telefone EXATO (telefone e platform_id são indexados e guardam o
    // mesmo formato, ex: "258824984519").
    const phoneRaw = (telefone || '').trim()
    const phoneDigits = phoneRaw.replace(/\D/g, '')
    const phoneVariants = [...new Set([phoneRaw, phoneDigits].filter((p) => p.length >= 8))]
    const msgKey = ['widechat-messages', String(leadId), phoneDigits]

    const { data: related } = useQuery<{ ids: (number | string)[]; contactId: string }>({
        queryKey: ['widechat-related-leads', String(leadId), phoneDigits],
        queryFn: async () => {
            const ids = new Set<number | string>([leadId])
            let contactId = widechatContactId
            if (phoneVariants.length) {
                try {
                    const { data } = await supabase.from('leads').select('id, widechat_contact_id').in('telefone', phoneVariants)
                    data?.forEach((l: any) => {
                        ids.add(l.id)
                        if (!contactId && l.widechat_contact_id) contactId = String(l.widechat_contact_id)
                    })
                } catch { /* segue */ }
            }
            return { ids: [...ids], contactId }
        },
        enabled: !!leadId,
    })
    const relatedIds = related?.ids
    const contactId = related?.contactId || widechatContactId

    const { data: messages, isLoading, error } = useQuery<WideChatMessage[]>({
        queryKey: msgKey,
        queryFn: async () => {
            const out: WideChatMessage[] = []
            // 1. mensagens já vinculadas a um lead
            if (relatedIds?.length) {
                try {
                    const { data } = await supabase.from('widechat_messages').select('*').in('lead_id', relatedIds as any)
                    ;(data || []).forEach((m: any) => out.push(m))
                } catch { /* segue */ }
            }
            // 2. transcript bruto (widechat_raw_messages) — captado pelo telefone,
            //    mesmo quando o WhatsApp não gerou um lead (ex: fora da fila comercial).
            //    timeout de 45s: sem o índice ainda a instância pode demorar.
            if (phoneVariants.length) {
                try {
                    const raw = await Promise.race([
                        supabase.from('widechat_raw_messages').select('*').in('platform_id', phoneVariants),
                        new Promise<{ data: null }>((r) => setTimeout(() => r({ data: null }), 45000)),
                    ]) as { data: any[] | null }
                    ;(raw.data || []).forEach((m: any) => out.push({
                        id: m.id ?? m.message_id, lead_id: leadId, message_id: m.message_id ?? m.id,
                        message: m.message, created_at: m.created_at, origin: m.origin,
                        type: m.type ?? 'text', sender_name: m.sender_name,
                    }))
                } catch { /* segue */ }
            }
            // dedup por message_id + ordena
            const seen = new Set<string>()
            return out
                .filter((m) => { const k = String(m.message_id || m.id); if (seen.has(k)) return false; seen.add(k); return true })
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        },
        enabled: relatedIds !== undefined,
    })

    // Realtime (só pega escrita no Postgres — SurrealDB não dispara; mantido p/ compat)
    useEffect(() => {
        if (!leadId) return
        const channel = supabase
            .channel(`widechat-${leadId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'widechat_messages', filter: `lead_id=eq.${leadId}` },
                () => queryClient.invalidateQueries({ queryKey: msgKey }),
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [leadId, phoneDigits, queryClient])

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Atendimento ativo do lead no WideChat (dá channel_id, attendance_id e a
    // data da última mensagem do cliente -> janela de 24h)
    const { data: att } = useQuery<{ match: any; agent_id?: string } | null>({
        queryKey: ['widechat-attendance', String(leadId), phoneDigits],
        queryFn: async () => {
            if (phoneDigits.length < 8) return null
            const { data } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'attendances', telefone: phoneDigits },
            })
            return data?.error ? null : data
        },
        enabled: phoneDigits.length >= 8,
        staleTime: 60_000,
    })
    const attendance = att?.match ?? null
    const within24h = attendance?.lastInteraction
        ? (Date.now() - new Date(attendance.lastInteraction).getTime()) < 24 * 3600 * 1000
        : false
    const canSendText = !!attendance?.channel_id && within24h
    // sem atendimento (ainda) ativo -> usa o canal padrão pra listar/enviar template e
    // iniciar a conversa do zero, em vez de ficar travado esperando o cliente escrever primeiro.
    const effectiveChannelId = attendance?.channel_id || DEFAULT_CHANNEL_ID

    const sendMessageMutation = useMutation({
        mutationFn: async (arg: string | { hsm_template_name: string; hsm_placeholders: string[]; preview: string }) => {
            const isHsm = typeof arg !== 'string'
            if (!isHsm && !attendance?.channel_id) throw new Error("Sem atendimento ativo no WideChat para este cliente.")
            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: {
                    action: 'send_message',
                    platform_id: phoneDigits,
                    channel_id: effectiveChannelId,
                    attendance_id: attendance?._id,
                    contact_name: attendance?.contact_name,
                    ...(isHsm
                        ? { is_hsm: true, hsm_template_name: arg.hsm_template_name, hsm_placeholders: arg.hsm_placeholders, message: arg.preview }
                        : { message: arg }),
                },
            })
            if (error) throw error
            if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
            return data
        },
        onMutate: async (arg) => {
            await queryClient.cancelQueries({ queryKey: msgKey })
            const previous = queryClient.getQueryData(msgKey)
            const tempId = crypto.randomUUID()
            const text = typeof arg === 'string' ? arg : arg.preview
            queryClient.setQueryData(msgKey, (old: any) => [...(old || []), {
                id: tempId, lead_id: leadId, message_id: tempId, message: text,
                created_at: new Date().toISOString(), origin: 'agent', type: 'text',
                sender_name: 'Você (enviando...)',
            }])
            return { previous }
        },
        onError: (e: any, _v, ctx: any) => {
            if (ctx?.previous) queryClient.setQueryData(msgKey, ctx.previous)
            showError(`Erro ao enviar: ${e.message}`)
        },
        onSuccess: () => { showSuccess('Mensagem enviada'); queryClient.invalidateQueries({ queryKey: msgKey }) },
    })

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault()
        if (!newMessage.trim() || sendMessageMutation.isPending || !canSendText) return
        sendMessageMutation.mutate(newMessage)
        setNewMessage("")
    }

    // Templates HSM — usados quando a janela de 24h fechou OU quando ainda não existe
    // nenhum atendimento (inicia a conversa do zero com um template aprovado).
    const { data: hsm } = useQuery<any[]>({
        queryKey: ['widechat-hsm', effectiveChannelId],
        queryFn: async () => {
            const { data } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'list_hsm', channel_id: effectiveChannelId, attendance_id: attendance?._id },
            })
            return data?.error ? [] : (data?.templates ?? [])
        },
        enabled: !canSendText && phoneDigits.length >= 8,
        staleTime: 5 * 60_000,
    })

    // Mensagens rápidas (atalhos nossos, não dependem do WideChat)
    const { data: quickReplies } = useQuery<{ id: number; title: string; content: string }[]>({
        queryKey: ['quick-replies'],
        queryFn: async () => {
            const { data, error } = await supabase.from('quick_replies').select('id, title, content').order('title')
            if (error) throw error
            return data || []
        },
        staleTime: 5 * 60_000,
    })

    const addQuickReplyMutation = useMutation({
        mutationFn: async () => {
            const title = window.prompt('Título do atalho (ex: "Pedir documento"):')
            if (!title) return null
            const content = window.prompt('Texto da mensagem:')
            if (!content) return null
            const { error } = await supabase.from('quick_replies').insert({ title, content })
            if (error) throw error
            return true
        },
        onSuccess: (created) => {
            if (created) { showSuccess('Atalho criado.'); queryClient.invalidateQueries({ queryKey: ['quick-replies'] }) }
        },
        onError: (e: any) => showError(`Erro ao criar atalho: ${e.message}`),
    })

    const sendTemplate = (t: any) => {
        const tags: any[] = t.tags ?? []
        const placeholders: string[] = tags.map((tag) => {
            const label = tag.placeholder ?? '{{?}}'
            return window.prompt(`Valor para ${label} (${tag.tags_value ?? ''})`) ?? ''
        })
        const preview = (Array.isArray(t.message) ? t.message.join('\n') : String(t.message ?? ''))
            .replace(/\{\{(\d+)\}\}/g, (_m: string, i: string) => placeholders[Number(i) - 1] ?? `{{${i}}}`)
        sendMessageMutation.mutate({ hsm_template_name: t.name, hsm_placeholders: placeholders, preview })
    }

    if (isLoading) {
        return (
            <div className="space-y-4 p-4">
                <Skeleton className="h-10 w-3/4 rounded-r-lg rounded-tl-lg" />
                <Skeleton className="h-10 w-3/4 ml-auto rounded-l-lg rounded-tr-lg" />
                <Skeleton className="h-10 w-1/2 rounded-r-lg rounded-tl-lg" />
            </div>
        )
    }

    if (error) {
        return (
            <Alert variant="destructive" className="m-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="break-all whitespace-pre-wrap">{(error as Error).message}</AlertDescription>
            </Alert>
        )
    }

    return (
        <div className="flex flex-col rounded-xl overflow-hidden bg-[var(--bg-card)] shadow-[var(--card-shadow)]">
            {!attendance && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                        Sem atendimento ativo no WideChat ainda. Para conversar por texto livre é preciso o cliente escrever primeiro — mas dá pra <strong>iniciar a conversa agora com um template aprovado</strong>.
                    </AlertDescription>
                </Alert>
            )}
            {attendance && !within24h && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                        Passou de 24h da última mensagem do cliente. Só é possível enviar um <strong>template aprovado</strong>.
                    </AlertDescription>
                </Alert>
            )}
            {/* área de conversa sempre em tema claro — legibilidade acima de tudo */}
            <ScrollArea className="h-[400px] w-full p-4 bg-[#eef1f5]">
                {!messages || messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <MessageSquare className="h-8 w-8 mb-2" />
                        <p className="text-sm font-medium">Nenhuma conversa encontrada.</p>
                        <p className="text-xs mt-1">
                            {contactId ? "Envie a primeira mensagem para iniciar." : "Este cliente ainda não interagiu pelo WhatsApp."}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col space-y-4">
                        {messages.map((msg) => {
                            const isUser = msg.origin === 'channel'
                            const isBot = msg.origin === 'auto'
                            const isAgent = msg.origin === 'agent' || (!isUser && !isBot)
                            return (
                                <div key={msg.id} className={`flex flex-col max-w-[85%] ${isUser ? "self-start" : "self-end items-end"}`}>
                                    <div className={`px-4 py-2 text-sm shadow-sm ${isUser
                                        ? "bg-white text-slate-800 rounded-2xl rounded-tl-md"
                                        : isBot
                                            ? "bg-slate-200 text-slate-600 rounded-2xl rounded-tr-md"
                                            : "bg-[#2563eb] text-white rounded-2xl rounded-tr-md"}`}>
                                        {msg.type === 'text'
                                            ? <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                                            : <p className="italic text-xs opacity-70">Arquivo de mídia ({msg.type})</p>}
                                    </div>
                                    <span className="text-[10px] text-slate-500 mt-1 px-1">
                                        {isAgent && msg.sender_name && <span className="mr-1 font-medium">{msg.sender_name} •</span>}
                                        {fmtHora(msg.created_at)}
                                    </span>
                                </div>
                            )
                        })}
                        <div ref={scrollRef} />
                    </div>
                )}
            </ScrollArea>

            <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2">
                {canSendText ? (
                    <form onSubmit={handleSend} className="flex gap-2 items-center">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button type="button" variant="outline" size="icon" className="rounded-full shrink-0 text-slate-600" title="Mensagens rápidas">
                                    <Zap className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
                                <DropdownMenuLabel>Mensagens rápidas</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {(!quickReplies || quickReplies.length === 0) && <div className="px-2 py-3 text-xs text-muted-foreground">Nenhum atalho cadastrado ainda.</div>}
                                {quickReplies?.map((q) => (
                                    <DropdownMenuItem key={q.id} onClick={() => setNewMessage((prev) => prev ? `${prev} ${q.content}` : q.content)} className="flex flex-col items-start gap-0.5">
                                        <span className="font-medium">{q.title}</span>
                                        <span className="text-[11px] text-muted-foreground line-clamp-2">{q.content}</span>
                                    </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => addQuickReplyMutation.mutate()} className="gap-2 text-primary">
                                    <Plus className="h-3.5 w-3.5" /> Novo atalho
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Input
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Digite sua mensagem via WhatsApp..."
                            className="flex-1 bg-white text-slate-800 border-slate-200 placeholder:text-slate-400 focus-visible:ring-primary shadow-sm rounded-full px-4"
                            disabled={sendMessageMutation.isPending}
                        />
                        <Button type="submit" size="icon"
                            className="rounded-full shadow-md bg-primary hover:bg-primary/90 text-white w-10 h-10 shrink-0"
                            disabled={!newMessage.trim() || sendMessageMutation.isPending}>
                            {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </form>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full gap-2 text-slate-700" disabled={sendMessageMutation.isPending}>
                                {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                {attendance ? "Enviar template" : "Iniciar conversa (template)"}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
                            <DropdownMenuLabel>Templates aprovados</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {(!hsm || hsm.length === 0) && <div className="px-2 py-3 text-xs text-muted-foreground">Nenhum template disponível.</div>}
                            {hsm?.map((t: any) => (
                                <DropdownMenuItem key={t.name} onClick={() => sendTemplate(t)} className="flex flex-col items-start gap-0.5">
                                    <span className="font-medium">{t.name}</span>
                                    <span className="text-[11px] text-muted-foreground line-clamp-2">
                                        {Array.isArray(t.message) ? t.message.join(' ') : t.message}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    )
}
