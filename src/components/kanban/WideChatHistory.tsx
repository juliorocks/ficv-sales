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
    leadId: number | string // Useful for Fallback mapping if webhook matches lead_id
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

export function WideChatHistory({ widechatContactId, leadId }: WideChatHistoryProps) {
    const queryClient = useQueryClient()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [newMessage, setNewMessage] = useState("")

    const { data: messages, isLoading, error } = useQuery<WideChatMessage[]>({
        queryKey: ['widechat-messages', leadId, widechatContactId],
        queryFn: async () => {
            // Fetching by leadId to get all history mapped to this lead
            const { data, error } = await supabase
                .from('widechat_messages')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: true })

            if (error) throw error
            return data || []
        },
        enabled: !!leadId,
    })

    // 2. Realtime Subscription
    useEffect(() => {
        if (!leadId) return

        const channel = supabase
            .channel('schema-db-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'widechat_messages',
                    filter: `lead_id=eq.${leadId}`,
                },
                (payload) => {
                    const newMsg = payload.new as WideChatMessage
                    queryClient.setQueryData(['widechat-messages', widechatContactId], (old: WideChatMessage[] | undefined) => {
                        if (!old) return [newMsg]
                        // Prevent duplicates if we already optimistically inserted
                        if (old.find(m => m.message_id === newMsg.message_id || m.id === newMsg.id)) return old
                        return [...old, newMsg]
                    })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [leadId, widechatContactId, queryClient])

    // Auto scroll down
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])


    // 3. Send Message Mutation
    const sendMessageMutation = useMutation({
        mutationFn: async (text: string) => {
            if (!widechatContactId) throw new Error("Não é possível enviar mensagens: Identificador do contato ausente.")
            
            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: {
                    action: 'send_message',
                    contact_id: widechatContactId,
                    message: text,
                    lead_id: leadId
                }
            })

            if (error) throw error
            if (data?.error) throw new Error(data.error)

            return data
        },
        onMutate: async (text) => {
            await queryClient.cancelQueries({ queryKey: ['widechat-messages', leadId, widechatContactId] })
            const previousMessages = queryClient.getQueryData(['widechat-messages', leadId, widechatContactId])

            const tempId = crypto.randomUUID()
            const optimisticMsg: WideChatMessage = {
                id: tempId,
                lead_id: leadId,
                message_id: tempId,
                message: text,
                created_at: new Date().toISOString(),
                origin: 'agent',
                type: 'text',
                sender_name: 'Você (Enviando...)'
            }

            queryClient.setQueryData(['widechat-messages', leadId, widechatContactId], (old: any) => [...(old || []), optimisticMsg])

            return { previousMessages, tempId }
        },
        onError: (err, newTodo, context: any) => {
            if (context?.previousMessages) {
                queryClient.setQueryData(['widechat-messages', leadId, widechatContactId], context.previousMessages)
            }
        },
        onSuccess: (data, variables, context) => {
            queryClient.invalidateQueries({ queryKey: ['widechat-messages', leadId, widechatContactId] })
        }
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
        const errorMessage = (error as Error).message;
        const isDebug = errorMessage.includes("Debug");
        return (
            <Alert variant={isDebug ? "default" : "destructive"} className="m-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="break-all whitespace-pre-wrap">
                    {errorMessage}
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <div className="flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-card)] shadow-sm">
            {!widechatContactId && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                        Exibindo histórico vinculado pelo telefone. O envio de mensagens será habilitado no próximo contato do cliente.
                    </AlertDescription>
                </Alert>
            )}
            <ScrollArea className="h-[400px] w-full p-4 bg-slate-50 dark:bg-[#0D1117]">
                {!messages || messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                        <MessageSquare className="h-8 w-8 mb-2" />
                        <p className="text-sm font-medium">Nenhuma mensagem no histórico local.</p>
                        {!widechatContactId && <p className="text-xs mt-1">Este lead ainda não interagiu pelo WhatsApp.</p>}
                        {widechatContactId && <p className="text-xs mt-1">Envie a primeira mensagem para iniciar.</p>}
                    </div>
                ) : (
                    <div className="flex flex-col space-y-4">
                        {messages.map((msg) => {
                            const isUser = msg.origin === 'channel'
                            const isBot = msg.origin === 'auto'
                            const isAgent = msg.origin === 'agent' || (!isUser && !isBot)

                            return (
                                <div
                                    key={msg.id}
                                    className={`flex flex-col max-w-[85%] ${isUser ? "self-start" : "self-end items-end"
                                        }`}
                                >
                                    <div
                                        className={`px-4 py-2 text-sm shadow-sm ${isUser
                                            ? "bg-white dark:bg-[#161B22] border border-[var(--border)] text-[var(--text-main)] rounded-2xl rounded-tl-md"
                                            : isBot
                                                ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl rounded-tr-md"
                                                : "bg-primary text-white rounded-2xl rounded-tr-md"
                                            }`}
                                    >
                                        {msg.type === 'text' ? (
                                            <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                                        ) : (
                                            <p className="italic text-xs opacity-70">Arquivo de mídia ({msg.type})</p>
                                        )}
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

            <div className={`p-3 border-t border-[var(--border)] ${!widechatContactId ? 'bg-slate-100/50 dark:bg-slate-900/50 opacity-60 grayscale' : 'bg-[var(--bg-card-hover)]'}`}>
                <form onSubmit={handleSend} className="flex gap-2 items-center">
                    <Input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={!widechatContactId ? "Envio desabilitado (falta ID do contato)..." : "Digite sua mensagem via WhatsApp..."}
                        className="flex-1 bg-white dark:bg-[#0D1117] border-[var(--border)] focus-visible:ring-primary shadow-sm rounded-full px-4"
                        disabled={sendMessageMutation.isPending || !widechatContactId}
                    />
                    <Button
                        type="submit"
                        size="icon"
                        className="rounded-full shadow-md bg-primary hover:bg-primary/90 text-white transition-all w-10 h-10 shrink-0"
                        disabled={!newMessage.trim() || sendMessageMutation.isPending || !widechatContactId}
                    >
                        {sendMessageMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                    </Button>
                </form>
            </div>

            {sendMessageMutation.isError && (
                <Alert variant="destructive" className="rounded-none border-x-0 border-b-0">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs font-medium">
                        Erro ao enviar: {sendMessageMutation.error?.message}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    )
}
