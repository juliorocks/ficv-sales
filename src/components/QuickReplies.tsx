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
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, Settings2, Trash2, Zap } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { showError, showSuccess } from "@/utils/toast"

export interface QuickReply { id: number; title: string; content: string }

export function useQuickReplies() {
  return useQuery<QuickReply[]>({
    queryKey: ["quick-replies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quick_replies").select("id, title, content").order("title")
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** Botão (ícone de raio) com a lista de atalhos pra inserir na mensagem + "Gerenciar atalhos". */
export function QuickRepliesMenu({ onPick, triggerClassName }: { onPick: (content: string) => void; triggerClassName?: string }) {
  const { data: replies = [] } = useQuickReplies()
  const [managerOpen, setManagerOpen] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" title="Mensagens rápidas"
            className={triggerClassName ?? "rounded-full h-9 w-9 text-slate-600"}>
            <Zap className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
          <DropdownMenuLabel>Mensagens rápidas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {replies.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">Nenhum atalho cadastrado ainda.</div>}
          {replies.map((q) => (
            <DropdownMenuItem key={q.id} onClick={() => onPick(q.content)} className="flex flex-col items-start gap-0.5">
              <span className="font-medium">{q.title}</span>
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

/** Listar, criar, editar e apagar atalhos — corpo reutilizado pelo Dialog e pela página cheia. */
function QuickRepliesEditor() {
  const qc = useQueryClient()
  const { data: replies = [], isLoading } = useQuickReplies()
  const [editing, setEditing] = useState<{ id: number | null; title: string; content: string } | null>(null)

  const saveMutation = useMutation({
    mutationFn: async (v: { id: number | null; title: string; content: string }) => {
      if (v.id) {
        const { error } = await supabase.from("quick_replies")
          .update({ title: v.title.trim(), content: v.content.trim(), updated_at: new Date().toISOString() }).eq("id", v.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from("quick_replies").insert({ title: v.title.trim(), content: v.content.trim() })
        if (error) throw error
      }
    },
    onSuccess: () => { showSuccess("Atalho salvo."); qc.invalidateQueries({ queryKey: ["quick-replies"] }); setEditing(null) },
    onError: (e: any) => showError(`Erro ao salvar: ${e.message}`),
  })
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="button" disabled={saveMutation.isPending} onClick={() => {
              if (!editing.title.trim() || !editing.content.trim()) { showError("Preencha título e mensagem."); return }
              saveMutation.mutate(editing)
            }}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="gap-2 self-start shrink-0" onClick={() => setEditing({ id: null, title: "", content: "" })}>
          <Plus className="h-4 w-4" /> Novo atalho
        </Button>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>}
        {!isLoading && replies.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nenhum atalho cadastrado ainda.</p>}
        {replies.map((q) => (
          <div key={q.id} className="border rounded-lg p-3 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{q.title}</p>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{q.content}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Editar"
                onClick={() => setEditing({ id: q.id, title: q.title, content: q.content })}>
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
