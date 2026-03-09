
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { AlertCircle, MessageSquare } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface WideChatHistoryProps {
    widechatContactId: string
}

interface WideChatMessage {
    _id: string
    message: string
    created_at: string
    origin: string // 'channel' (user), 'agent' (human), 'auto' (bot)
    type: string
    sender?: {
        name: string
    }
}

export function WideChatHistory({ widechatContactId }: WideChatHistoryProps) {
    const { data: messages, isLoading, error } = useQuery<WideChatMessage[]>({
        queryKey: ['widechat-messages', widechatContactId],
        queryFn: async () => {
            const { data, error } = await supabase.functions.invoke('widechat-get-messages', {
                body: { contact_id: widechatContactId }
            })

            if (error) throw error

            if (data && data.error) {
                let errorMsg = data.error + (data.details ? ` (${data.details})` : "")
                if (data.contact_structure) {
                    errorMsg += "\n\nJSON Contato:\n" + JSON.stringify(data.contact_structure, null, 2)
                }
                throw new Error(errorMsg)
            }

            return Array.isArray(data) ? data : (data.messages || data.data || [])
        },
        enabled: !!widechatContactId,
        refetchInterval: 10000,
        retry: false
    })

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

    if (!messages || messages.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
                <p>Nenhuma mensagem encontrada.</p>
            </div>
        )
    }

    const sortedMessages = [...messages].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

    return (
        <ScrollArea className="h-[400px] w-full p-4 rounded-md border bg-slate-50 dark:bg-slate-900/50">
            <div className="flex flex-col space-y-4">
                {sortedMessages.map((msg) => {
                    const isUser = msg.origin === 'channel'
                    const isBot = msg.origin === 'auto'
                    const isAgent = msg.origin === 'agent' || (!isUser && !isBot)

                    return (
                        <div
                            key={msg._id}
                            className={`flex flex-col max-w-[80%] ${isUser ? "self-start" : "self-end items-end"
                                }`}
                        >
                            <div
                                className={`px-4 py-2 rounded-lg text-sm ${isUser
                                    ? "bg-white dark:bg-slate-800 border text-slate-800 dark:text-slate-100 rounded-tl-none shadow-sm"
                                    : isBot
                                        ? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-tr-none"
                                        : "bg-primary text-primary-foreground rounded-tr-none shadow-md"
                                    }`}
                            >
                                {msg.type === 'text' ? (
                                    <p className="whitespace-pre-wrap">{msg.message}</p>
                                ) : (
                                    <p className="italic text-xs opacity-70">Arquivo de mídia ({msg.type})</p>
                                )}
                            </div>
                            <span className="text-[10px] text-muted-foreground mt-1 px-1">
                                {isAgent && msg.sender?.name && <span className="mr-1 font-medium">{msg.sender.name} •</span>}
                                {format(new Date(msg.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                        </div>
                    )
                })}
            </div>
        </ScrollArea>
    )
}
