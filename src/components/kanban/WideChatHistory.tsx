import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { AlertCircle, MessageSquare, Send, Loader2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface WideChatHistoryProps {
    widechatContactId: string
    leadId: number | string
    telefone?: string | null // usado p/ achar conversas ligadas a outro registro do mesmo lead
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
            //    mesmo quando o WhatsApp não gerou um lead (ex: fora da fila comercial)
            if (phoneVariants.length) {
                try {
                    const { data } = await supabase.from('widechat_raw_messages').select('*').in('platform_id', phoneVariants)
                    ;(data || []).forEach((m: any) => out.push({
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

    const sendMessageMutation = useMutation({
        mutationFn: async (text: string) => {
            if (!contactId) throw new Error("Não é possível enviar mensagens: identificador do contato ausente.")
            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'send_message', contact_id: contactId, message: text, lead_id: leadId },
            })
            if (error) throw error
            if (data?.error) throw new Error(data.error)
            return data
        },
        onMutate: async (text) => {
            await queryClient.cancelQueries({ queryKey: msgKey })
            const previous = queryClient.getQueryData(msgKey)
            const tempId = crypto.randomUUID()
            queryClient.setQueryData(msgKey, (old: any) => [...(old || []), {
                id: tempId, lead_id: leadId, message_id: tempId, message: text,
                created_at: new Date().toISOString(), origin: 'agent', type: 'text',
                sender_name: 'Você (enviando...)',
            }])
            return { previous }
        },
        onError: (_e, _v, ctx: any) => {
            if (ctx?.previous) queryClient.setQueryData(msgKey, ctx.previous)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: msgKey }),
    })

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault()
        if (!newMessage.trim() || sendMessageMutation.isPending) return
        sendMessageMutation.mutate(newMessage)
        setNewMessage("")
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
            {!contactId && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                        Histórico vinculado pelo telefone. O envio de mensagens é habilitado quando o cliente inicia uma conversa no WhatsApp.
                    </AlertDescription>
                </Alert>
            )}
            <ScrollArea className="h-[400px] w-full p-4 bg-slate-50 dark:bg-[#0D1117]">
                {!messages || messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
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
                                        ? "bg-white dark:bg-[#161B22] text-[var(--text-main)] rounded-2xl rounded-tl-md"
                                        : isBot
                                            ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl rounded-tr-md"
                                            : "bg-primary text-white rounded-2xl rounded-tr-md"}`}>
                                        {msg.type === 'text'
                                            ? <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                                            : <p className="italic text-xs opacity-70">Arquivo de mídia ({msg.type})</p>}
                                    </div>
                                    <span className="text-[10px] text-muted-foreground mt-1 px-1">
                                        {isAgent && msg.sender_name && <span className="mr-1 font-medium">{msg.sender_name} •</span>}
                                        {format(new Date(msg.created_at), "dd/MM HH:mm", { locale: ptBR })}
                                    </span>
                                </div>
                            )
                        })}
                        <div ref={scrollRef} />
                    </div>
                )}
            </ScrollArea>

            <div className={`p-3 border-t border-[var(--border)] ${!contactId ? 'bg-slate-100/50 dark:bg-slate-900/50 opacity-60 grayscale' : 'bg-[var(--bg-card-hover)]'}`}>
                <form onSubmit={handleSend} className="flex gap-2 items-center">
                    <Input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={!contactId ? "Envio desabilitado (cliente não iniciou conversa)..." : "Digite sua mensagem via WhatsApp..."}
                        className="flex-1 bg-white dark:bg-[#0D1117] border-[var(--border)] focus-visible:ring-primary shadow-sm rounded-full px-4"
                        disabled={sendMessageMutation.isPending || !contactId}
                    />
                    <Button type="submit" size="icon"
                        className="rounded-full shadow-md bg-primary hover:bg-primary/90 text-white transition-all w-10 h-10 shrink-0"
                        disabled={!newMessage.trim() || sendMessageMutation.isPending || !contactId}>
                        {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                </form>
            </div>

            {sendMessageMutation.isError && (
                <Alert variant="destructive" className="rounded-none border-x-0 border-b-0">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs font-medium">Erro ao enviar: {sendMessageMutation.error?.message}</AlertDescription>
                </Alert>
            )}
        </div>
    )
}
