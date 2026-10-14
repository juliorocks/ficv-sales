/**
 * QuickReplies — mensagens rápidas (atalhos de texto) compartilhadas entre o chat do
 * lead (Kanban) e os chamados (Portal do Aluno). Tabela quick_replies, sem depender de
 * nenhuma API externa; qualquer atendente (CRM ou Chamados) pode ler, criar, editar e
 * apagar (RLS: is_ticket_staff()).
 *
 * QuickRepliesMenu = botão com a lista + atalho "Gerenciar atalhos" (abre o painel em Dialog).
 * QuickRepliesPage = a mesma edição, mas como página cheia (Gestão > Leads (Kanban) > Mensagens
 * Rápidas). As duas usam QuickRepliesEditor por baixo — a lógica de salvar/apagar não duplica.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileAudio, FileText, Loader2, Paperclip, Pencil, Plus, Search, Settings2, Trash2, X, Zap } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { showError, showSuccess } from "@/utils/toast"

export interface QuickReply {
  id: number; title: string; content: string
  // anexo (PDF/imagem) opcional — pedido do usuário 14/10 ("inserir nas mensagens rápidas a
  // opção de cadastrar documentos"); já hospedado no bucket quando o atalho é salvo, então
  // usar o atalho nunca precisa fazer upload de novo, só referencia a URL.
  attachment_url?: string | null
  attachment_name?: string | null
  attachment_mime?: string | null
}

export const attachmentKind = (mime?: string | null): "images" | "sounds" | "videos" | "files" =>
  mime?.startsWith("image/") ? "images" : mime?.startsWith("audio/") ? "sounds" : mime?.startsWith("video/") ? "videos" : "files"

export function useQuickReplies() {
  return useQuery<QuickReply[]>({
    queryKey: ["quick-replies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quick_replies")
        .select("id, title, content, attachment_url, attachment_name, attachment_mime").order("title")
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** Botão (ícone de raio) com a lista de atalhos pra inserir na mensagem + "Gerenciar atalhos". */
/** Filtra por título OU conteúdo, sem acento/maiúscula atrapalhar. */
function filterReplies(replies: QuickReply[], query: string): QuickReply[] {
  const q = query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  if (!q) return replies
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  return replies.filter((r) => norm(r.title).includes(q) || norm(r.content).includes(q))
}

export function QuickRepliesMenu({ onPick, triggerClassName }: { onPick: (reply: QuickReply) => void; triggerClassName?: string }) {
  const { data: replies = [] } = useQuickReplies()
  const [managerOpen, setManagerOpen] = useState(false)
  const [search, setSearch] = useState("")
  const filtered = useMemo(() => filterReplies(replies, search), [replies, search])
  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (!open) setSearch("") }}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" title="Mensagens rápidas"
            className={triggerClassName ?? "rounded-full h-9 w-9 text-slate-600"}>
            <Zap className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-h-96 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuLabel>Mensagens rápidas</DropdownMenuLabel>
          <div className="px-2 pb-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Buscar…"
                className="w-full h-8 rounded-md border border-input bg-transparent pl-7 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <DropdownMenuSeparator />
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {replies.length === 0 ? "Nenhum atalho cadastrado ainda." : "Nada encontrado."}
            </div>
          )}
          {filtered.map((q) => (
            <DropdownMenuItem key={q.id} onClick={() => onPick(q)} className="flex flex-col items-start gap-0.5">
              <span className="font-medium flex items-center gap-1">
                {q.title}
                {q.attachment_url && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
              </span>
              <span className="text-[11px] text-muted-foreground line-clamp-2">{q.content}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setManagerOpen(true)} className="gap-2 text-primary">
            <Settings2 className="h-3.5 w-3.5" /> Gerenciar atalhos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QuickRepliesManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
    </>
  )
}

/**
 * Digitou "/" (início da mensagem ou depois de um espaço) seguido de texto sem espaço →
 * mostra a lista de atalhos filtrada por isso, flutuando acima da caixa de texto — pedido
 * do usuário 14/10: "ao digitar / aparecer essa caixinha com as opções e busca". Clique
 * troca o "/busca" pelo conteúdo do atalho; Escape só fecha a sugestão (mantém o texto).
 * Quem usa precisa envolver a textarea numa div com `className="relative"`.
 */
export function QuickReplySlash({ value, onChange, textareaRef, onAttachment }: {
  value: string
  onChange: (v: string) => void
  textareaRef: RefObject<HTMLTextAreaElement>
  // atalho com anexo (PDF/imagem) escolhido pelo "/" — sem isso, cai no comportamento de
  // sempre (só insere o texto); com isso, o anexo é enviado direto (ver onPick do menu ⚡)
  onAttachment?: (reply: QuickReply) => void
}) {
  const { data: replies = [] } = useQuickReplies()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const match = value.match(/(?:^|\s)\/(\S*)$/)
  const query = match?.[1] ?? null
  const filtered = query !== null ? filterReplies(replies, query) : []
  const show = query !== null && !!replies.length && dismissed !== value && !!filtered.length

  // Escape fecha a sugestão sem mexer no texto — o foco continua na textarea (não neste
  // popup), então o teclado precisa ser ouvido no document, não num onKeyDown aqui.
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDismissed(value) }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [show, value])

  if (!show) return null

  const pick = (reply: QuickReply) => {
    const cutAt = value.length - (query as string).length - 1 // posição do "/"
    if (reply.attachment_url && onAttachment) {
      // anexo: tira o "/busca" (nunca envia esse texto) e dispara o envio direto
      onChange(value.slice(0, cutAt))
      onAttachment(reply)
    } else {
      onChange(value.slice(0, cutAt) + reply.content + " ")
    }
    setDismissed(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div
      role="listbox"
      className="absolute bottom-full left-0 mb-1.5 w-80 max-h-72 overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg z-50"
    >
      <div className="sticky top-0 bg-popover px-2 py-1.5 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query ?? ""}
            onChange={(e) => onChange(value.slice(0, value.length - (query ?? "").length - 1) + "/" + e.target.value)}
            placeholder="Buscar…"
            className="w-full h-7 rounded-md border border-input bg-transparent pl-7 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div className="py-1">
        {filtered.map((q) => (
          <button key={q.id} type="button" onClick={() => pick(q)}
            className="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground flex flex-col gap-0.5">
            <span className="text-xs font-medium flex items-center gap-1">
              {q.title}
              {q.attachment_url && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
            </span>
            <span className="text-[11px] text-muted-foreground line-clamp-1">{q.content}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Listar, criar, editar e apagar atalhos — corpo reutilizado pelo Dialog e pela página cheia. */
type EditingReply = { id: number | null; title: string; content: string; attachment_url: string | null; attachment_name: string | null; attachment_mime: string | null }

function QuickRepliesEditor() {
  const qc = useQueryClient()
  const { data: replies = [], isLoading } = useQuickReplies()
  const [editing, setEditing] = useState<EditingReply | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const saveMutation = useMutation({
    mutationFn: async (v: EditingReply) => {
      const payload = {
        title: v.title.trim(), content: v.content.trim(),
        attachment_url: v.attachment_url, attachment_name: v.attachment_name, attachment_mime: v.attachment_mime,
      }
      if (v.id) {
        const { error } = await supabase.from("quick_replies")
          .update({ ...payload, updated_at: new Date().toISOString() }).eq("id", v.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from("quick_replies").insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => { showSuccess("Atalho salvo."); qc.invalidateQueries({ queryKey: ["quick-replies"] }); setEditing(null) },
    onError: (e: any) => showError(`Erro ao salvar: ${e.message}`),
  })

  // anexo (PDF/imagem) do atalho — sobe de uma vez pro bucket já público, pra usar o atalho
  // depois nunca precisar fazer upload de novo (só referencia a URL salva aqui)
  async function handleAttachmentSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !editing) return
    if (file.size > 10 * 1024 * 1024) { showError("Arquivo maior que 10MB."); return }
    setUploading(true)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      const path = `quick-replies/${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from("widechat-attachments").upload(path, file, { contentType: file.type || "application/octet-stream", cacheControl: "3600" })
      if (error) throw error
      const { data: pub } = supabase.storage.from("widechat-attachments").getPublicUrl(path)
      setEditing((ed) => ed && ({ ...ed, attachment_url: pub.publicUrl, attachment_name: file.name, attachment_mime: file.type || "application/octet-stream" }))
    } catch (e: any) {
      showError(`Erro ao subir o arquivo: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("quick_replies").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => { showSuccess("Atalho excluído."); qc.invalidateQueries({ queryKey: ["quick-replies"] }) },
    onError: (e: any) => showError(`Erro ao excluir: ${e.message}`),
  })

  return (
    <>
      {editing ? (
        <div className="space-y-3 border rounded-lg p-3 shrink-0">
          <div className="space-y-1">
            <Label>Título</Label>
            <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder='Ex.: "Pedir documento"' autoFocus />
          </div>
          <div className="space-y-1">
            <Label>Mensagem</Label>
            <Textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={4} placeholder="Texto que vai ser inserido na conversa..." />
          </div>
          <div className="space-y-1">
            <Label>Anexo (opcional)</Label>
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={handleAttachmentSelect} />
            {editing.attachment_url ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 rounded-md border border-input px-2.5 py-2 text-sm">
                  {editing.attachment_mime?.startsWith("audio/") ? <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" /> : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">{editing.attachment_name}</span>
                  <button type="button" title="Remover anexo" className="text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setEditing({ ...editing, attachment_url: null, attachment_name: null, attachment_mime: null })}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {editing.attachment_mime?.startsWith("audio/") && <audio src={editing.attachment_url} controls className="w-full h-9" />}
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                {uploading ? "Enviando…" : "Anexar PDF, imagem ou áudio"}
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">
              Com anexo, usar o atalho manda o arquivo direto (com a mensagem como legenda) em vez de só inserir o texto.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="button" disabled={saveMutation.isPending || uploading} onClick={() => {
              if (!editing.title.trim() || !editing.content.trim()) { showError("Preencha título e mensagem."); return }
              saveMutation.mutate(editing)
            }}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="gap-2 self-start shrink-0"
          onClick={() => setEditing({ id: null, title: "", content: "", attachment_url: null, attachment_name: null, attachment_mime: null })}>
          <Plus className="h-4 w-4" /> Novo atalho
        </Button>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>}
        {!isLoading && replies.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nenhum atalho cadastrado ainda.</p>}
        {replies.map((q) => (
          <div key={q.id} className="border rounded-lg p-3 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium flex items-center gap-1.5">
                {q.title}
                {q.attachment_url && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{q.content}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Editar"
                onClick={() => setEditing({ id: q.id, title: q.title, content: q.content, attachment_url: q.attachment_url ?? null, attachment_name: q.attachment_name ?? null, attachment_mime: q.attachment_mime ?? null })}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" title="Excluir"
                onClick={() => { if (confirm(`Excluir o atalho "${q.title}"?`)) deleteMutation.mutate(q.id) }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/** Painel de gerenciar em Dialog (aberto de dentro do QuickRepliesMenu, ou solto se quiser). */
export function QuickRepliesManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Mensagens rápidas</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Atalhos de texto pra usar nas conversas do Kanban e nos chamados. Qualquer atendente pode criar e editar.
        </p>
        <QuickRepliesEditor />
      </DialogContent>
    </Dialog>
  )
}

/** Página cheia (Gestão > Leads (Kanban) > Mensagens Rápidas). Mesma edição, sem o Dialog em volta. */
export function QuickRepliesPage() {
  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mensagens Rápidas</h1>
        <p className="text-sm text-muted-foreground">
          Atalhos de texto prontos pra usar nas conversas do Kanban e nos chamados do Portal do Aluno.
          Qualquer atendente pode criar, editar e apagar.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <QuickRepliesEditor />
      </div>
    </div>
  )
}
