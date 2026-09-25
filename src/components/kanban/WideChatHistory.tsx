import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, MessageSquare, Send, Loader2, FileText, Zap, Plus, Smile, Paperclip, Mic, Square, X, Image as ImageIcon, FileAudio } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { showError, showSuccess } from "@/utils/toast"
import { useAuth } from "@/hooks/use-auth"

// ── Templates HSM: variáveis ────────────────────────────────────────────────
// Um template pode ter variáveis no corpo — numeradas ({{1}}, {{2}}) ou nomeadas
// ({{NOME}}, {{SALUTATION}}). O WideChat manda essas variáveis em `tags`
// ({placeholder, variable, example}); quando `tags` vem vazio, a gente descobre
// pelos {{n}} do próprio corpo. Cada variável precisa de um valor ANTES de enviar
// (a Meta rejeita o template com variável em branco).
type TplSlot = { placeholder: string; variable: string; example: string }

const saudacaoAgora = () => {
    const h = Number(new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }))
    return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"
}

const tplBody = (t: any) => (Array.isArray(t?.message) ? t.message.join("\n") : String(t?.message ?? ""))

function parseTemplate(t: any): { body: string; slots: TplSlot[] } {
    const body = tplBody(t)
    const tags: any[] = Array.isArray(t?.tags) ? t.tags : []
    let slots: TplSlot[]
    if (tags.length) {
        // O WideChat casa hsm_placeholders[i] com tags[i] (ordem do array), NÃO com o
        // número do {{n}}. Ex: tags [{{2}},{{1}}] + valores ["A","B"] => {{2}}=A, {{1}}=B.
        // Então NÃO reordena — mantém a ordem de `tags`.
        slots = tags.map((tag) => ({
            placeholder: String(tag?.placeholder ?? ""),
            variable: String(tag?.variable ?? tag?.placeholder ?? ""),
            example: String(tag?.example ?? ""),
        }))
    } else {
        const nums = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
        slots = nums.map((n) => ({ placeholder: `{{${n}}}`, variable: `{{${n}}}`, example: "" }))
    }
    return { body, slots }
}

function suggestValue(slot: TplSlot, ctx: { leadName?: string; agentName?: string }): string {
    const v = (slot.variable || "").toUpperCase()
    if (/SALUTATION|SAUDA/.test(v)) return saudacaoAgora()
    if (/NAME|NOME|CLIENTE|ALUNO/.test(v)) return (ctx.leadName || "").trim().split(/\s+/)[0] || slot.example
    if (/AGENT|ATENDENTE|CONSULTOR|VENDEDOR/.test(v)) return (ctx.agentName || "").trim().split(/\s+/)[0] || slot.example
    return slot.example
}

function fillTemplate(body: string, slots: TplSlot[], values: string[]): string {
    let out = body
    slots.forEach((s, i) => {
        if (s.placeholder) out = out.split(s.placeholder).join(values[i] ?? s.placeholder)
    })
    return out
}

const rotuloVar = (s: TplSlot) => {
    const v = (s.variable || s.placeholder).replace(/[{}]/g, "")
    const map: Record<string, string> = { SALUTATION: "Saudação", NAME: "Nome do cliente", AGENT: "Seu nome", NAN: "Saudação" }
    return map[v.toUpperCase()] || v
}

// Canal padrão da Faculdade (mesmo default usado no widechat-webhook) — usado como
// fallback pra listar/enviar template quando ainda não existe nenhum atendimento
// (ex: iniciar conversa nova com um lead que só preencheu formulário até agora).
const DEFAULT_CHANNEL_ID = '694534a0132843fbb436bd48'

interface WideChatHistoryProps {
    widechatContactId: string
    leadId: number | string
    telefone?: string | null // usado p/ achar conversas ligadas a outro registro do mesmo lead
    leadName?: string // p/ preencher {{NOME}} nos templates
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

// nome legível pro card de anexo — nosso path de upload é "{leadId}/{timestamp}-{nome}";
// tira o timestamp e decodifica %20 etc. Se não achar padrão nenhum (ex: link do
// WideChat, que é só um id de storage), cai num rótulo genérico.
const fileNameFromUrl = (url?: string | null): string | null => {
    if (!url) return null
    try {
        const last = decodeURIComponent(url.split('/').pop() || '')
        return last.replace(/^\d{10,}-/, '') || null
    } catch { return null }
}

// O navegador só grava áudio em webm/opus (Chrome/Edge/Firefox) — formato que o
// WhatsApp/Meta NÃO aceita pra nota de voz (só AAC, MP3, AMR ou OGG/Opus; confirmado
// ao vivo 2026-09-17: WideChat recusa webm com 422 "O campo file deve conter um
// arquivo", mesmo com a URL 100% válida/servível). Converte pra MP3 no navegador via
// ffmpeg.wasm antes de enviar. Import dinâmico: o pacote (~30MB de core wasm) só
// carrega quando alguém de fato grava um áudio, nunca no carregamento normal da tela.
async function transcodeToMp3(blob: Blob): Promise<Blob> {
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
    ])
    const ffmpeg = new FFmpeg()
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    await ffmpeg.writeFile('input.webm', await fetchFile(blob))
    await ffmpeg.exec(['-i', 'input.webm', 'output.mp3'])
    const data = await ffmpeg.readFile('output.mp3') as Uint8Array
    // TS 5.7+: Uint8Array.buffer é tipado como ArrayBufferLike (inclui
    // SharedArrayBuffer), que BlobPart não aceita — copia pra um ArrayBuffer normal.
    const buf = new ArrayBuffer(data.byteLength)
    new Uint8Array(buf).set(data)
    return new Blob([buf], { type: 'audio/mpeg' })
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
    media_url?: string | null
    provider?: string
}

// emojis mais usados no atendimento — sem dependência de lib
const EMOJIS = "😀 😅 😊 🙂 😉 😍 🥰 🤩 😎 🤔 🙌 👏 👍 🙏 💪 ✅ ❌ ⚠️ ℹ️ 📌 📎 📄 📅 ⏰ 💰 💸 🎓 📚 ✏️ 📝 📞 📲 💬 ✨ 🎉 🔥 ❤️ 🧡 💛 💚 💙 💜 🤝 👋 😢 😔 🥳".split(" ")

export function WideChatHistory({ widechatContactId, leadId, telefone, leadName }: WideChatHistoryProps) {
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const scrollRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [newMessage, setNewMessage] = useState("")
    // anexo (arquivo escolhido, aguardando confirmação/legenda antes de enviar)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [pendingFile, setPendingFile] = useState<File | null>(null)
    // gravação de áudio — mesma técnica do módulo de Tickets (MediaRecorder)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const [recording, setRecording] = useState(false)
    const [recordingSeconds, setRecordingSeconds] = useState(0)
    const [convertingAudio, setConvertingAudio] = useState(false)

    // insere texto na posição do cursor do textarea
    const insertAtCursor = (text: string) => {
        const el = textareaRef.current
        if (!el) { setNewMessage((p) => p + text); return }
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? el.value.length
        setNewMessage((p) => p.slice(0, start) + text + p.slice(end))
        requestAnimationFrame(() => {
            el.focus()
            el.selectionStart = el.selectionEnd = start + text.length
        })
    }

    // id numérico do lead (a tela "Histórico WideChat" usa leadId="" — aí não marca nada)
    const numericLeadId = typeof leadId === 'number'
        ? leadId
        : (/^\d+$/.test(String(leadId)) ? Number(leadId) : null)

    // "conversa vista" (compartilhada): zera o badge de mensagem nova no card do
    // Kanban. SÓ é chamado quando um agente RESPONDE (não ao abrir o card) — o
    // usuário quer que o alerta persista até alguém de fato falar com o lead ou a
    // conversa ser finalizada. O `origin='agent'` da resposta já zera pela view;
    // esse upsert é só o feedback imediato antes do webhook gravar a msg.
    const markSeen = () => {
        if (numericLeadId == null) return
        supabase
            .from('lead_conversation_seen')
            .upsert({ lead_id: numericLeadId, seen_at: new Date().toISOString(), seen_by: user?.id ?? null }, { onConflict: 'lead_id' })
            .then(() => queryClient.invalidateQueries({ queryKey: ['lead_pending_replies'] }))
    }
    const [hsmOpen, setHsmOpen] = useState(false)
    // template escolhido aguardando o preenchimento das variáveis
    const [tplForm, setTplForm] = useState<{ t: any; slots: TplSlot[]; values: string[] } | null>(null)

    // O mesmo cliente pode ter vários registros de lead (formulário + WhatsApp).
    // Casa pelo telefone EXATO (telefone e platform_id são indexados e guardam o
    // mesmo formato, ex: "258824984519").
    const phoneRaw = (telefone || '').trim()
    const phoneDigits = phoneRaw.replace(/\D/g, '')
    const phoneVariants = [...new Set([phoneRaw, phoneDigits].filter((p) => p.length >= 8))]
    const msgKey = ['widechat-messages', String(leadId), phoneDigits]

    const { data: related } = useQuery<{ ids: (number | string)[]; contactId: string; sessionId: string }>({
        queryKey: ['widechat-related-leads', String(leadId), phoneDigits],
        queryFn: async () => {
            const ids = new Set<number | string>([leadId])
            let contactId = widechatContactId
            let sessionId = ''
            if (phoneVariants.length) {
                try {
                    const { data } = await supabase.from('leads').select('id, widechat_contact_id, widechat_session_id').in('telefone', phoneVariants)
                    data?.forEach((l: any) => {
                        ids.add(l.id)
                        if (!contactId && l.widechat_contact_id) contactId = String(l.widechat_contact_id)
                        if (!sessionId && l.widechat_session_id) sessionId = String(l.widechat_session_id)
                    })
                } catch { /* segue */ }
            }
            return { ids: [...ids], contactId, sessionId }
        },
        enabled: !!leadId,
    })
    const relatedIds = related?.ids
    const contactId = related?.contactId || widechatContactId
    const sessionId = related?.sessionId || ''

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
            // ruído do WideChat que não interessa na conversa
            const NOISE = /sua sess[ãa]o (ir[áa] expirar|expirou)|sess[ãa]o encerrada por inatividade/i
            // dedup por message_id — se houver duplicata, fica com a que tem texto de
            // verdade (o webhook às vezes grava "[Mídia]" pra mesma msg que a API já
            // gravou com o corpo renderizado).
            const byId = new Map<string, any>()
            const loose: any[] = []
            for (const m of out) {
                if (m.message && NOISE.test(m.message)) continue
                const k = String(m.message_id || '')
                if (!k) { loose.push(m); continue }
                const prev = byId.get(k)
                const better = (x: any) => x && x.message && x.message !== '[Mídia]'
                if (!prev || (better(m) && !better(prev))) byId.set(k, m)
            }
            return [...byId.values(), ...loose]
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

    // ── VivaConnect (WhatsApp próprio, Z-PRO) ────────────────────────────────
    // O lead fala pelo VivaConnect quando já tem número fixo lá ou quando a última
    // mensagem da conversa veio de lá. Lead sem conversa nenhuma: continua WideChat por
    // padrão (o pool ainda é só o número de teste, 25/09) — o agente pode trocar no seletor.
    // Tudo acontece aqui: agente nunca precisa abrir o painel do Z-PRO.
    const { data: vc } = useQuery<{ enabled: boolean; channels: { id: number; name: string; kind: string; purpose: string; phone: string | null }[]; lead_channel_id: number | null } | null>({
        queryKey: ['vivaconnect-chat-context', String(leadId)],
        queryFn: async () => {
            const { data, error } = await supabase.functions.invoke('vivaconnect-api', { body: { action: 'chat_context', lead_id: leadId } })
            return error || data?.error ? null : data
        },
        enabled: numericLeadId != null,
        staleTime: 60_000,
    })
    const vcAvailable = !!vc?.enabled && (vc.channels?.length ?? 0) > 0
    const lastProvider = [...(messages ?? [])].reverse().find((m) => m.provider)?.provider
    const autoProvider: 'widechat' | 'vivaconnect' =
        vcAvailable && (vc?.lead_channel_id != null || lastProvider === 'vivaconnect') ? 'vivaconnect' : 'widechat'
    const [providerChoice, setProviderChoice] = useState<'widechat' | 'vivaconnect' | null>(null)
    const provider = vcAvailable ? (providerChoice ?? autoProvider) : 'widechat'
    const isViva = provider === 'vivaconnect'
    const [vcChannelChoice, setVcChannelChoice] = useState<number | null>(null)
    const vcFixedChannel = vc?.channels.find((c) => c.id === vc?.lead_channel_id) ?? null
    const vcChannel = vcFixedChannel ?? vc?.channels.find((c) => c.id === vcChannelChoice) ?? vc?.channels.find((c) => c.purpose === 'pool') ?? vc?.channels[0] ?? null
    // Baileys não tem janela de 24h da Meta; WABA tem (e templates ainda não são suportados no VivaConnect)
    const vcNeedsWindow = vcChannel?.kind === 'waba'

    // mídia RECEBIDA pelo VivaConnect chega sem link — busca no Z-PRO (o servidor guarda cópia no nosso storage)
    const vcMediaAsked = useRef(new Set<string>())
    useEffect(() => {
        const pending = (messages ?? []).filter((m) => m.provider === 'vivaconnect' && !m.media_url
            && ['images', 'sounds', 'videos', 'files'].includes(m.type) && !vcMediaAsked.current.has(String(m.id)))
        if (!pending.length) return
        pending.forEach((m) => vcMediaAsked.current.add(String(m.id)))
        Promise.all(pending.map((m) => supabase.functions.invoke('vivaconnect-api', { body: { action: 'media', message_row_id: m.id } })))
            .then((rs) => { if (rs.some((r) => r.data?.url)) queryClient.invalidateQueries({ queryKey: msgKey }) })
    }, [messages])

    // Atendimento no WideChat — SÓ pra pegar channel_id/attendance_id (envio atribuído
    // ao agente) e alimentar o botão Transferir. NÃO é mais o que decide se dá pra
    // mandar texto: essa chamada depende do token do WideChat (que fica em disputa
    // quando o agente tem o painel do WideChat aberto) e do match por wa_id — falhava
    // direto e travava o painel inteiro ("ninguém consegue conversar por aqui").
    const { data: att } = useQuery<{ match: any; agent_id?: string } | null>({
        queryKey: ['widechat-attendance', String(leadId), phoneDigits, sessionId],
        queryFn: async () => {
            if (phoneDigits.length < 8 && !sessionId) return null
            const { data } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'attendances', telefone: phoneRaw || phoneDigits, session_id: sessionId || undefined },
            })
            return data?.error ? null : data
        },
        enabled: phoneDigits.length >= 8 || !!sessionId,
        staleTime: 60_000,
        retry: 1,
    })
    const attendance = att?.match ?? null

    // A JANELA DE 24H VEM DA NOSSA BASE: se o cliente mandou uma mensagem
    // (origin='channel') nas últimas 24h, a Meta deixa mandar texto livre — não
    // importa o que a API de atendimentos do WideChat responde.
    const lastInboundAt = (() => {
        let t = 0
        for (const m of messages ?? []) {
            if (m.origin === 'channel') {
                const ts = new Date(m.created_at).getTime()
                if (!isNaN(ts) && ts > t) t = ts
            }
        }
        return t
    })()
    const windowOpen = lastInboundAt > 0 && (Date.now() - lastInboundAt) < 24 * 3600 * 1000
    const hasAnyConversation = (messages?.length ?? 0) > 0
    const canSendText = isViva ? (!vcNeedsWindow || windowOpen) : windowOpen
    // sem atendimento identificado -> usa o canal padrão pra listar/enviar template.
    const effectiveChannelId = attendance?.channel_id || DEFAULT_CHANNEL_ID

    const sendMessageMutation = useMutation({
        mutationFn: async (arg: string | { hsm_template_name: string; hsm_placeholders: string[]; preview: string } | { media: File; caption: string }) => {
            const isHsm = typeof arg === 'object' && 'hsm_template_name' in arg
            const isMedia = typeof arg === 'object' && 'media' in arg
            if (!isHsm && !isMedia && !canSendText) throw new Error("Passaram 24h da última mensagem do cliente — só dá pra enviar um template aprovado.")
            if (isViva && isHsm) throw new Error("Templates ainda não estão disponíveis pelo VivaConnect.")

            let mediaField: Record<string, unknown> | undefined
            if (isMedia) {
                const file = arg.media
                const mime = file.type || 'application/octet-stream'
                // schema confirmado nos payloads REAIS de mídia recebida do WideChat
                const mediaType = mime.startsWith('image/') ? 'images' : mime.startsWith('audio/') ? 'sounds' : mime.startsWith('video/') ? 'videos' : 'files'
                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
                const path = `${leadId}/${Date.now()}-${safeName}`
                const { error: upErr } = await supabase.storage.from('widechat-attachments').upload(path, file, { contentType: mime, cacheControl: '3600' })
                if (upErr) throw new Error(`Erro ao subir arquivo: ${upErr.message}`)
                // WideChat manda mídia por URL pública, não upload/storage_id (doc oficial
                // da plataforma por trás, SZ.chat/Fortics — /message/send com type:"media"
                // + file:"<url>"). Nosso bucket já é público.
                const { data: pub } = supabase.storage.from('widechat-attachments').getPublicUrl(path)
                mediaField = { public_url: pub.publicUrl, filename: file.name, mime_type: mime, type: mediaType, legend: arg.caption || undefined }
            }

            if (isViva) {
                        const { data, error } = await supabase.functions.invoke('vivaconnect-api', {
                    body: {
                        action: 'send', lead_id: leadId, channel_id: vcChannel?.id,
                        body: isMedia ? (arg.caption || '') : (arg as string),
                        ...(isMedia && mediaField ? { media: { url: mediaField.public_url, type: mediaField.type, file_name: mediaField.filename } } : {}),
                    },
                })
                if (error) {
                    const ctx = await (error as any).context?.json?.().catch(() => null)
                    throw new Error(ctx?.error ?? error.message)
                }
                if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
                return data
            }

            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: {
                    action: 'send_message',
                    // manda o telefone CRU (leads.telefone) — pode ser "5583..." (BR) ou
                    // um id interno do WideChat "US.21493..." (estrangeiro). O widechat-api
                    // normaliza. NÃO mandar só os dígitos: comeria o prefixo "US.".
                    platform_id: phoneRaw || phoneDigits,
                    channel_id: effectiveChannelId,
                    attendance_id: attendance?._id,
                    session_id: sessionId || undefined,
                    contact_name: attendance?.contact_name ?? leadName,
                    lead_id: leadId,
                    ...(isHsm
                        ? { is_hsm: true, hsm_template_name: arg.hsm_template_name, hsm_placeholders: arg.hsm_placeholders, message: arg.preview }
                        : isMedia
                            ? { media: mediaField }
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
            const text = typeof arg === 'string' ? arg : ('hsm_template_name' in arg ? arg.preview : `📎 ${arg.media.name}`)
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
        onSuccess: (_data, variables) => {
            const isHsm = typeof variables === 'object' && 'hsm_template_name' in variables
            queryClient.invalidateQueries({ queryKey: msgKey })
            markSeen()
            // O /message/send só confirma que a Meta ACEITOU o pedido — a entrega pode
            // falhar depois (número inválido; erro 131049 pra template de marketing;
            // etc). Confere o status REAL alguns segundos depois — vale pra texto E
            // template (o "deu sucesso mas não chegou" era isso).
            showSuccess(isHsm ? 'Template enviado — confirmando a entrega…' : 'Enviado — confirmando a entrega…')
            if (isViva) {
                const sentBody = typeof variables === 'string' ? variables.trim() : ('caption' in variables ? (variables.caption || '').trim() : '')
                const checkViva = async (tries: number) => {
                    try {
                        const { data } = await supabase.functions.invoke('vivaconnect-api', {
                            body: { action: 'message_status', lead_id: leadId, body: sentBody },
                        })
                        const st = data?.last?.status
                        if (st === 'failed') { showError(`O WhatsApp NÃO entregou a mensagem.${data.last.error ? ` ${data.last.error}` : ''}`); return }
                        if (st === 'delivered' || st === 'read') { showSuccess(st === 'read' ? 'Entregue e lida ✔✔' : 'Entregue no WhatsApp ✔'); return }
                        if (tries > 0) { window.setTimeout(() => checkViva(tries - 1), 8000); return }
                        if (st === 'missing') showError('A mensagem não apareceu no WhatsApp. Se era um anexo, tente de novo (arquivo pode não ter sido baixado).')
                    } catch {
                        if (tries > 0) window.setTimeout(() => checkViva(tries - 1), 8000)
                    }
                }
                window.setTimeout(() => checkViva(3), 5000)
                return
            }
            const checkDelivery = async (tries: number) => {
                try {
                    const { data } = await supabase.functions.invoke('widechat-api', {
                        body: { action: 'message_status', platform_id: phoneRaw || phoneDigits, channel_id: effectiveChannelId },
                    })
                    const last = data?.last
                    if (last?.status === 'failed') {
                        const cod = last.error_code ? ` (Meta ${last.error_code})` : ''
                        const dica = last.error_code === 131049
                            ? ' A Meta limita quantos templates de MARKETING um número recebe por período. Use um template UTILITY, outro número, ou aguarde ~24h.'
                            : (last.error_message ? ` ${last.error_message}` : '')
                        showError(`O WhatsApp NÃO entregou a mensagem${cod}.${dica}`)
                        return
                    }
                    if (last?.status === 'delivered' || last?.status === 'read' || last?.status === 'sent') {
                        showSuccess('Entregue no WhatsApp ✔')
                        return
                    }
                    if (tries > 0) window.setTimeout(() => checkDelivery(tries - 1), 8000)
                } catch {
                    if (tries > 0) window.setTimeout(() => checkDelivery(tries - 1), 8000)
                }
            }
            window.setTimeout(() => checkDelivery(3), 6000)
        },
    })

    const doSend = () => {
        if (sendMessageMutation.isPending || !canSendText) return
        if (pendingFile) {
            sendMessageMutation.mutate({ media: pendingFile, caption: newMessage.trim() })
            setPendingFile(null)
            setNewMessage("")
            return
        }
        if (!newMessage.trim()) return
        sendMessageMutation.mutate(newMessage)
        setNewMessage("")
    }
    const handleSend = (e: React.FormEvent) => { e.preventDefault(); doSend() }

    const MAX_ATTACHMENT_MB = 25
    const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (!file) return
        if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
            showError(`Arquivo muito grande (máx. ${MAX_ATTACHMENT_MB}MB).`)
            return
        }
        setPendingFile(file)
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
            const mr = new MediaRecorder(stream, { mimeType })
            audioChunksRef.current = []
            mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
            mr.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop())
                const cleanType = mimeType.split(';')[0]
                const rawBlob = new Blob(audioChunksRef.current, { type: cleanType })
                // webm (único formato que o navegador grava) não é aceito pelo
                // WhatsApp/Meta pra nota de voz — converte pra MP3 antes de enviar (ver
                // transcodeToMp3 acima).
                try {
                    setConvertingAudio(true)
                    const mp3Blob = await transcodeToMp3(rawBlob)
                    const file = new File([mp3Blob], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' })
                    sendMessageMutation.mutate({ media: file, caption: '' })
                } catch {
                    showError('Não foi possível converter o áudio gravado. Tente de novo.')
                } finally {
                    setConvertingAudio(false)
                }
            }
            mr.start(200)
            mediaRecorderRef.current = mr
            setRecording(true)
            setRecordingSeconds(0)
            recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
        } catch {
            showError('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
        }
    }
    function stopRecording() {
        if (mediaRecorderRef.current && recording) {
            mediaRecorderRef.current.stop()
            setRecording(false)
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
            setRecordingSeconds(0)
        }
    }
    function cancelRecording() {
        if (mediaRecorderRef.current && recording) {
            mediaRecorderRef.current.ondataavailable = null
            mediaRecorderRef.current.onstop = null
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop())
            setRecording(false)
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
            setRecordingSeconds(0)
        }
    }
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter') return
        if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+Enter → nova linha (o browser não faz isso sozinho num textarea)
            e.preventDefault()
            insertAtCursor('\n')
            return
        }
        if (!e.shiftKey) {
            // Enter → envia. Shift+Enter cai aqui e quebra linha (comportamento padrão)
            e.preventDefault()
            doSend()
        }
    }

    // nome de quem está logado — pra sugerir o valor de {{AGENT}} nos templates
    const { data: agentName } = useQuery<string>({
        queryKey: ['me-full-name'],
        queryFn: async () => {
            const { data: u } = await supabase.auth.getUser()
            if (!u.user) return ''
            const { data: p } = await supabase.from('profiles').select('full_name').eq('id', u.user.id).maybeSingle()
            return (p?.full_name || u.user.email || '').split('@')[0]
        },
        staleTime: 30 * 60_000,
    })

    // Templates HSM — usados quando a janela de 24h fechou OU quando ainda não existe
    // nenhum atendimento (inicia a conversa do zero com um template aprovado).
    const { data: hsm, isFetching: hsmLoading, isError: hsmError, refetch: refetchHsm } = useQuery<any[]>({
        queryKey: ['widechat-hsm', effectiveChannelId],
        queryFn: async () => {
            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'list_hsm', channel_id: effectiveChannelId, attendance_id: attendance?._id },
            })
            // erro do WideChat (ex: token da conta em disputa com o painel) — deixa o
            // React Query marcar isError pra UI oferecer "tentar de novo", em vez de
            // mostrar "nenhum template" (que faz parecer que não existe nenhum).
            if (error) throw error
            if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : 'Falha ao listar templates no WideChat.')
            const raw: any[] = data?.templates ?? []
            // o WideChat costuma devolver cada template DUAS vezes (uma sem `tags`, outra
            // com). Fica só com uma por nome, preferindo a que traz as variáveis.
            const byName = new Map<string, any>()
            for (const t of raw) {
                if (!t?.name) continue
                const prev = byName.get(t.name)
                const score = Array.isArray(t.tags) ? t.tags.length : 0
                if (!prev || score > (Array.isArray(prev.tags) ? prev.tags.length : 0)) byName.set(t.name, t)
            }
            return [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
        },
        enabled: !canSendText && phoneDigits.length >= 8,
        staleTime: 5 * 60_000,
        retry: 2,
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

    // Transferir a conversa pra outro agente ou fila/equipe. Basta ter uma session
    // (conversa real) — o widechat-api resolve o atendimento no servidor. Antes exigia
    // `attendance` (que quase nunca vinha) e o botão nunca aparecia.
    const canTransfer = isViva ? hasAnyConversation : (!!sessionId && hasAnyConversation)
    // VivaConnect: transferência é entre agentes DO CRM (ninguém trabalha no Z-PRO)
    const { data: crmAgents, refetch: loadCrmAgents } = useQuery<{ id: string; full_name: string }[]>({
        queryKey: ['crm-agents-for-transfer'],
        queryFn: async () => {
            const { data } = await supabase.from('profiles').select('id, full_name').in('role', ['agent', 'admin']).order('full_name')
            return (data ?? []).filter((p: any) => p.full_name)
        },
        enabled: false,
        staleTime: 5 * 60_000,
    })
    const { data: agentsForTransfer, refetch: loadAgents } = useQuery<any[]>({
        queryKey: ['widechat-agents'],
        queryFn: async () => {
            const { data } = await supabase.functions.invoke('widechat-api', { body: { action: 'list_agents' } })
            return data?.error ? [] : (data?.agents ?? [])
        },
        enabled: false,
        staleTime: 60_000,
    })
    const { data: teamsForTransfer, refetch: loadTeams } = useQuery<any[]>({
        queryKey: ['widechat-teams'],
        queryFn: async () => {
            const { data } = await supabase.functions.invoke('widechat-api', { body: { action: 'list_teams' } })
            return data?.error ? [] : (data?.teams ?? [])
        },
        enabled: false,
        staleTime: 60_000,
    })

    const transferMutation = useMutation({
        mutationFn: async (arg: { type: 'agent'; agent_id: string; label: string } | { type: 'attendance'; team_id: string; label: string } | { type: 'crm'; profile_id: string; label: string }) => {
            if (arg.type === 'crm') {
                const { data, error } = await supabase.functions.invoke('vivaconnect-api', { body: { action: 'transfer', lead_id: leadId, profile_id: arg.profile_id } })
                if (error || data?.error) throw new Error(data?.error ?? error?.message)
                queryClient.invalidateQueries({ queryKey: ['leads'] })
                return arg.label
            }
            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'transfer', session_id: sessionId, ...arg },
            })
            if (error) throw error
            if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
            return arg.label
        },
        onSuccess: (label) => showSuccess(`Conversa transferida para ${label}.`),
        onError: (e: any) => showError(`Erro ao transferir: ${e.message}`),
    })

    // Finaliza o atendimento NO WideChat (não só localmente) — POST /attendances/finish.
    // Útil pra tirar a conversa de um estado travado (ex: bot preso num menu) e pra
    // encerrar de verdade quando o atendimento acabou, sem precisar abrir o painel
    // nativo do WideChat pra isso.
    const finishMutation = useMutation({
        mutationFn: async () => {
            if (isViva) {
                const { data, error } = await supabase.functions.invoke('vivaconnect-api', { body: { action: 'finish', lead_id: leadId } })
                if (error || data?.error) throw new Error(data?.error ?? error?.message)
                queryClient.invalidateQueries({ queryKey: ['leads'] })
                return
            }
            const { data, error } = await supabase.functions.invoke('widechat-api', {
                body: { action: 'finish_attendance', session_id: sessionId },
            })
            if (error) throw error
            if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
        },
        onSuccess: () => {
            showSuccess(isViva ? 'Atendimento finalizado — lead movido para Finalizado.' : 'Atendimento finalizado no WideChat.')
            queryClient.invalidateQueries({ queryKey: msgKey })
        },
        onError: (e: any) => showError(`Erro ao finalizar: ${e.message}`),
    })

    // ── Transferir pra Secretaria: a conversa vira CHAMADO do Portal do Aluno ─────
    // 1) ticket-transfer cria o chamado (histórico do WhatsApp junto, e-mail pro aluno)
    // 2) despedida no WhatsApp pelo canal do lead (se der pra enviar texto agora)
    // 3) finaliza a conversa no WhatsApp — dali em diante é Portal/e-mail
    const [secOpen, setSecOpen] = useState(false)
    const [secForm, setSecForm] = useState({ cpf: '', email: '', titulo: '', resumo: '', categoria: 'secretaria' })
    const openSecretaria = async () => {
        let email = ''
        if (numericLeadId != null) {
            const { data } = await supabase.from('leads').select('email').eq('id', numericLeadId).maybeSingle()
            email = data?.email ?? ''
        }
        setSecForm({ cpf: '', email, titulo: '', resumo: '', categoria: 'secretaria' })
        setSecOpen(true)
    }
    const transferSecMutation = useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('ticket-transfer', { body: { lead_id: numericLeadId, ...secForm } })
            if (error) {
                const ctx = await (error as any).context?.json?.().catch(() => null)
                throw new Error(ctx?.error ?? error.message)
            }
            if (data?.error) throw new Error(data.error)
            let avisoWhats = ''
            if (canSendText && data.whatsapp_msg) {
                try { await sendMessageMutation.mutateAsync(data.whatsapp_msg) } catch { avisoWhats = ' (não consegui enviar a despedida no WhatsApp)' }
            } else avisoWhats = ' (janela do WhatsApp fechada — despedida não enviada)'
            if (canTransfer) { try { await finishMutation.mutateAsync() } catch { /* finalizar é best-effort */ } }
            return { protocolo: data.protocolo as string, portal: !!data.portal, avisoWhats }
        },
        onSuccess: ({ protocolo, portal, avisoWhats }) => {
            setSecOpen(false)
            showSuccess(`Chamado ${protocolo} aberto na Secretaria${portal ? ' (Portal do Aluno)' : ' (por e-mail)'}${avisoWhats}.`)
            queryClient.invalidateQueries({ queryKey: ['leads'] })
            queryClient.invalidateQueries({ queryKey: ['tickets'] })
        },
        onError: (e: any) => showError(`Transferência: ${e.message}`),
    })

    // escolheu um template: se tem variável, abre o formulário pra preencher;
    // se não tem, envia direto.
    const openTemplate = (t: any) => {
        const { slots } = parseTemplate(t)
        if (slots.length === 0) {
            sendMessageMutation.mutate({ hsm_template_name: t.name, hsm_placeholders: [], preview: tplBody(t) })
            return
        }
        setTplForm({
            t,
            slots,
            values: slots.map((s) => suggestValue(s, { leadName, agentName })),
        })
    }

    const confirmTemplate = () => {
        if (!tplForm) return
        const { t, slots, values } = tplForm
        const preview = fillTemplate(tplBody(t), slots, values)
        sendMessageMutation.mutate({ hsm_template_name: t.name, hsm_placeholders: values, preview })
        setTplForm(null)
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
            {vcAvailable && (
                <div className="flex items-center gap-2 px-3 pt-2 text-[11px] text-muted-foreground bg-[var(--bg-card)]">
                    <span className="font-semibold uppercase tracking-wide">Enviar por</span>
                    <select value={provider} onChange={(e) => setProviderChoice(e.target.value as 'widechat' | 'vivaconnect')}
                        className="h-6 rounded-md border border-[var(--border)] bg-transparent px-1.5 text-[11px]">
                        <option value="vivaconnect">VivaConnect</option>
                        <option value="widechat">WideChat</option>
                    </select>
                    {isViva && (vcFixedChannel
                        ? <span title="O cliente conversa com esse número — as respostas sempre saem dele">· {vcFixedChannel.name}{vcFixedChannel.phone ? ` (${vcFixedChannel.phone})` : ''}</span>
                        : (vc?.channels.length ?? 0) > 1
                            ? <select value={vcChannel?.id ?? ''} onChange={(e) => setVcChannelChoice(Number(e.target.value))}
                                className="h-6 rounded-md border border-[var(--border)] bg-transparent px-1.5 text-[11px]">
                                {vc!.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            : <span>· {vcChannel?.name}</span>)}
                </div>
            )}
            {canTransfer && (
                <div className="flex justify-end gap-1 px-3 pt-2 bg-[var(--bg-card)]">
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-primary"
                        disabled={transferSecMutation.isPending || numericLeadId == null} onClick={openSecretaria}
                        title="A conversa vira um chamado da Secretaria no Portal do Aluno (com o histórico)">
                        {transferSecMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        → Secretaria
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-red-600"
                        disabled={finishMutation.isPending}
                        onClick={() => { if (window.confirm(isViva ? 'Finalizar esse atendimento? O lead vai para Finalizado (se o cliente escrever de novo, ele reabre sozinho).' : 'Finalizar esse atendimento no WideChat? Isso encerra a conversa lá (não só aqui).')) finishMutation.mutate() }}>
                        {finishMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        Finalizar
                    </Button>
                    <DropdownMenu onOpenChange={(open) => { if (open) { if (isViva) loadCrmAgents(); else { loadAgents(); loadTeams() } } }}>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" disabled={transferMutation.isPending}>
                                {transferMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 rotate-45" />}
                                Transferir
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                            {isViva ? (<>
                                <DropdownMenuLabel>Transferir para agente</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {!crmAgents?.length && <div className="px-2 py-2 text-xs text-muted-foreground">Carregando…</div>}
                                {crmAgents?.map((a) => (
                                    <DropdownMenuItem key={a.id} onClick={() => transferMutation.mutate({ type: 'crm', profile_id: a.id, label: a.full_name })}>
                                        {a.full_name}
                                    </DropdownMenuItem>
                                ))}
                            </>) : (<>
                            <DropdownMenuLabel>Transferir para agente</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {(!agentsForTransfer || agentsForTransfer.length === 0) && <div className="px-2 py-2 text-xs text-muted-foreground">Carregando / nenhum agente online.</div>}
                            {agentsForTransfer?.map((a: any) => (
                                <DropdownMenuItem key={a._id} onClick={() => transferMutation.mutate({ type: 'agent', agent_id: a._id, label: a.name })}>
                                    <span className={`mr-2 h-1.5 w-1.5 rounded-full ${a.status === 'online' ? 'bg-green-500' : 'bg-slate-300'}`} />
                                    {a.name}
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Transferir para fila/equipe</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {(!teamsForTransfer || teamsForTransfer.length === 0) && <div className="px-2 py-2 text-xs text-muted-foreground">Carregando / nenhuma fila encontrada.</div>}
                            {teamsForTransfer?.map((t: any) => (
                                <DropdownMenuItem key={t._id} onClick={() => transferMutation.mutate({ type: 'attendance', team_id: t._id, label: t.name })}>
                                    {t.name}
                                </DropdownMenuItem>
                            ))}
                            </>)}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
            {!hasAnyConversation && !isViva && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                        Ainda não teve nenhuma conversa por aqui. Para texto livre é preciso o cliente escrever primeiro — mas dá pra <strong>iniciar a conversa agora com um template aprovado</strong>.
                    </AlertDescription>
                </Alert>
            )}
            {hasAnyConversation && !canSendText && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                        Passou de 24h da última mensagem do cliente. Só é possível enviar um <strong>template aprovado</strong> — depois que ele responder, o texto livre volta.
                    </AlertDescription>
                </Alert>
            )}
            {!hasAnyConversation && isViva && (
                <Alert className="rounded-none border-x-0 border-t-0 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                        Ainda não teve conversa com esse lead. A 1ª mensagem sai pelo número <strong>{vcChannel?.name}</strong> e o lead fica fixo nele.
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
                                        {(() => {
                                            const isTpl = msg.type === 'template' || msg.type === 'hsm'
                                            const isMedia = ['images', 'sounds', 'files', 'videos'].includes(msg.type)
                                            const hasText = !!msg.message && msg.message !== '[Mídia]'
                                            const mediaLabel = msg.type === 'images' ? 'imagem' : msg.type === 'sounds' ? 'áudio' : msg.type === 'videos' ? 'vídeo' : 'arquivo'
                                            if (isMedia) {
                                                const fname = fileNameFromUrl(msg.media_url)
                                                return (
                                                    <div className="space-y-1.5">
                                                        {!msg.media_url ? (
                                                            <span className="flex items-center gap-1.5 text-xs opacity-70">
                                                                <Paperclip className="h-3.5 w-3.5 shrink-0" /> Anexo ({mediaLabel}) — link indisponível
                                                            </span>
                                                        ) : msg.type === 'images' ? (
                                                            <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                                                                <img src={msg.media_url} alt={fname ?? 'imagem'} className="rounded-lg max-w-full max-h-64 object-cover" />
                                                            </a>
                                                        ) : msg.type === 'videos' ? (
                                                            <video src={msg.media_url} controls className="rounded-lg max-w-full max-h-64" />
                                                        ) : msg.type === 'sounds' ? (
                                                            <audio src={msg.media_url} controls className="max-w-full h-10" />
                                                        ) : (
                                                            <a href={msg.media_url} target="_blank" rel="noopener noreferrer"
                                                                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${isUser ? 'bg-slate-100' : 'bg-white/10'}`}>
                                                                <FileText className="h-6 w-6 shrink-0" />
                                                                <span className="text-xs font-medium underline underline-offset-2 truncate">{fname || 'Abrir arquivo'}</span>
                                                            </a>
                                                        )}
                                                        {hasText && <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>}
                                                    </div>
                                                )
                                            }
                                            if (msg.type === 'text' || (isTpl && hasText)) {
                                                return (
                                                    <p className="whitespace-pre-wrap leading-relaxed">
                                                        {isTpl && <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-0.5">Template</span>}
                                                        {msg.message}
                                                    </p>
                                                )
                                            }
                                            if (isTpl) return <p className="text-xs opacity-80">📄 Template enviado</p>
                                            return <p className="italic text-xs opacity-70">Arquivo de mídia ({msg.type})</p>
                                        })()}
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
                    <form onSubmit={handleSend} className="flex flex-col gap-2">
                        {pendingFile && (
                            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm">
                                {pendingFile.type.startsWith('image/')
                                    ? <ImageIcon className="h-4 w-4 text-slate-500 shrink-0" />
                                    : pendingFile.type.startsWith('audio/')
                                        ? <FileAudio className="h-4 w-4 text-slate-500 shrink-0" />
                                        : <Paperclip className="h-4 w-4 text-slate-500 shrink-0" />}
                                <span className="truncate flex-1 text-slate-700">{pendingFile.name}</span>
                                <button type="button" onClick={() => setPendingFile(null)} className="text-slate-400 hover:text-slate-700 shrink-0" title="Remover anexo">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                        {recording && (
                            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
                                <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse shrink-0" />
                                <span className="flex-1">Gravando áudio… {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span>
                                <button type="button" onClick={cancelRecording} className="text-red-500 hover:text-red-800 text-xs font-medium">Cancelar</button>
                            </div>
                        )}
                        {convertingAudio && (
                            <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600">
                                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                                <span>Convertendo áudio…</span>
                            </div>
                        )}
                        <div className="flex gap-2 items-end">
                        <div className="flex gap-1 shrink-0 pb-0.5">
                            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
                            <Button type="button" variant="outline" size="icon" className="rounded-full h-9 w-9 text-slate-600" title="Anexar arquivo"
                                disabled={sendMessageMutation.isPending || recording || convertingAudio} onClick={() => fileInputRef.current?.click()}>
                                <Paperclip className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="outline" size="icon" className="rounded-full h-9 w-9 text-slate-600" title="Mensagens rápidas">
                                        <Zap className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
                                    <DropdownMenuLabel>Mensagens rápidas</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {(!quickReplies || quickReplies.length === 0) && <div className="px-2 py-3 text-xs text-muted-foreground">Nenhum atalho cadastrado ainda.</div>}
                                    {quickReplies?.map((q) => (
                                        <DropdownMenuItem key={q.id} onClick={() => insertAtCursor((newMessage && !newMessage.endsWith(' ') ? ' ' : '') + q.content)} className="flex flex-col items-start gap-0.5">
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
                            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                                <PopoverTrigger asChild>
                                    <Button type="button" variant="outline" size="icon" className="rounded-full h-9 w-9 text-slate-600" title="Emojis">
                                        <Smile className="h-4 w-4" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-64 p-2">
                                    <div className="grid grid-cols-8 gap-0.5">
                                        {EMOJIS.map((em) => (
                                            <button key={em} type="button" onClick={() => { insertAtCursor(em); setEmojiOpen(false) }}
                                                className="h-7 w-7 rounded hover:bg-slate-100 text-lg leading-none">
                                                {em}
                                            </button>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <textarea
                            ref={textareaRef}
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            placeholder={pendingFile ? "Legenda (opcional)…" : "Mensagem…  (Enter envia · Shift/Ctrl+Enter quebra linha)"}
                            className="flex-1 resize-none bg-white text-slate-800 border border-slate-200 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary shadow-sm rounded-2xl px-4 py-2 text-sm max-h-32 overflow-y-auto"
                            style={{ height: 'auto', minHeight: '2.25rem' }}
                            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 128) + 'px' }}
                            disabled={sendMessageMutation.isPending || recording || convertingAudio}
                        />
                        {newMessage.trim() || pendingFile ? (
                            <Button type="submit" size="icon"
                                className="rounded-full shadow-md bg-primary hover:bg-primary/90 text-white w-9 h-9 shrink-0"
                                disabled={sendMessageMutation.isPending}>
                                {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        ) : (
                            <Button type="button" size="icon"
                                className={`rounded-full shadow-md w-9 h-9 shrink-0 text-white ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'}`}
                                disabled={sendMessageMutation.isPending || convertingAudio}
                                title={recording ? 'Parar e enviar áudio' : 'Gravar áudio'}
                                onClick={recording ? stopRecording : startRecording}>
                                {convertingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                            </Button>
                        )}
                        </div>
                    </form>
                ) : (
                    <Popover open={hsmOpen} onOpenChange={setHsmOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full gap-2 text-slate-700" disabled={sendMessageMutation.isPending}>
                                {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                {attendance ? "Enviar template" : "Iniciar conversa (template)"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[22rem] p-0">
                            {hsmError ? (
                                <div className="p-4 text-center space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        Não consegui carregar os templates do WideChat agora. Costuma ser a sessão da conta em disputa com o painel do WideChat aberto em outra aba.
                                    </p>
                                    <Button size="sm" variant="outline" onClick={() => refetchHsm()} disabled={hsmLoading}>
                                        {hsmLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Tentar de novo
                                    </Button>
                                </div>
                            ) : (
                            <Command filter={(value, search) => value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
                                <CommandInput placeholder="Buscar template..." />
                                <CommandList className="max-h-80">
                                    <CommandEmpty>
                                        {hsmLoading ? "Carregando templates…" : (!hsm || hsm.length === 0) ? "Nenhum template disponível." : "Nenhum resultado."}
                                    </CommandEmpty>
                                    <CommandGroup heading="Templates aprovados">
                                        {(hsm ?? []).map((t: any) => {
                                            const body = Array.isArray(t.message) ? t.message.join(' ') : String(t.message ?? '')
                                            const nVars = parseTemplate(t).slots.length
                                            return (
                                                <CommandItem key={t.name} value={`${t.name} ${body}`} onSelect={() => { setHsmOpen(false); openTemplate(t) }} className="flex flex-col items-start gap-0.5">
                                                    <span className="font-medium">
                                                        {t.name}
                                                        {nVars > 0 && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">· {nVars} variáve{nVars > 1 ? 'is' : 'l'}</span>}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground line-clamp-2">{body}</span>
                                                </CommandItem>
                                            )
                                        })}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                            )}
                        </PopoverContent>
                    </Popover>
                )}
            </div>

            <Dialog open={secOpen} onOpenChange={setSecOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-base">Transferir para a Secretaria</DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">
                        A conversa vira um <b>chamado no Portal do Aluno</b>, com o histórico do WhatsApp. O aluno recebe e-mail com o protocolo,
                        o WhatsApp recebe uma mensagem de despedida e a conversa é finalizada aqui.
                    </p>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-xs">CPF do aluno (Sponte)</Label>
                            <Input value={secForm.cpf} onChange={(e) => setSecForm((f) => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" />
                            <p className="text-[11px] text-muted-foreground">Com CPF, o aluno acompanha pelo Portal. Sem CPF, o chamado segue só por e-mail.</p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">E-mail do aluno</Label>
                            <Input value={secForm.email} onChange={(e) => setSecForm((f) => ({ ...f, email: e.target.value }))} placeholder="usado se o Sponte não tiver e-mail" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Assunto do chamado *</Label>
                            <Input value={secForm.titulo} onChange={(e) => setSecForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Ex: Declaração de matrícula" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Recado para o aluno (opcional)</Label>
                            <textarea value={secForm.resumo} onChange={(e) => setSecForm((f) => ({ ...f, resumo: e.target.value }))} rows={3}
                                placeholder="Ex: A secretaria vai emitir sua declaração e te envia por aqui."
                                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSecOpen(false)}>Cancelar</Button>
                        <Button onClick={() => transferSecMutation.mutate()}
                            disabled={transferSecMutation.isPending || !secForm.titulo.trim() || (!secForm.cpf.replace(/\D/g, '') && !secForm.email.includes('@'))}>
                            {transferSecMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            Transferir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* preenchimento das variáveis do template antes de enviar */}
            <Dialog open={!!tplForm} onOpenChange={(o) => { if (!o) setTplForm(null) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-base">
                            Preencher o template <span className="font-mono text-sm">{tplForm?.t?.name}</span>
                        </DialogTitle>
                    </DialogHeader>
                    {tplForm && (
                        <div className="space-y-4">
                            <p className="text-xs text-muted-foreground">
                                Esse template tem {tplForm.slots.length} variáve{tplForm.slots.length > 1 ? 'is' : 'l'}. Confira os valores — já sugerimos com base no lead e no horário.
                            </p>
                            <div className="space-y-3">
                                {tplForm.slots.map((s, i) => (
                                    <div key={`${s.placeholder}-${i}`} className="space-y-1">
                                        <Label className="text-xs flex items-center gap-1.5">
                                            {rotuloVar(s)}
                                            <span className="font-mono text-[10px] text-muted-foreground">{s.placeholder}</span>
                                        </Label>
                                        <Input
                                            value={tplForm.values[i] ?? ''}
                                            onChange={(e) => setTplForm((f) => f && ({ ...f, values: f.values.map((v, k) => k === i ? e.target.value : v) }))}
                                            placeholder={s.example || 'valor'}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="rounded-lg bg-[#eef1f5] p-3 text-sm text-slate-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                {fillTemplate(tplBody(tplForm.t), tplForm.slots, tplForm.values)}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTplForm(null)}>Cancelar</Button>
                        <Button
                            onClick={confirmTemplate}
                            disabled={sendMessageMutation.isPending || !!tplForm?.values.some((v) => !v.trim())}
                        >
                            {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            Enviar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
