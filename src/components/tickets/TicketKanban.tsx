/**
 * TicketKanban — visão em quadro dos chamados do Portal do Aluno (Secretaria e demais
 * setores). Colunas = status do chamado; arrastar muda o status igual ao TicketDetail
 * (resolvido grava resolved_at e dispara o e-mail "chamado resolvido" pro aluno).
 * Filtro por FILA (Secretaria, Tutoria Graduação/Pós…) — cada pessoa já só recebe do banco
 * os chamados das filas dela (ticket_visible); aqui só organiza. Lembrado por navegador.
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { MessageCircleReply, Search, UserRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Ticket, TicketStatus } from '../../types/database'
import { showError, showSuccess } from '../../utils/toast'
import { Input } from '../ui/input'

const COLUMNS: { status: TicketStatus; label: string; hint: string; accent: string }[] = [
  { status: 'aberto', label: 'Novos', hint: 'Ninguém respondeu ainda', accent: 'border-t-blue-500' },
  { status: 'em_atendimento', label: 'Em atendimento', hint: 'Equipe trabalhando', accent: 'border-t-amber-500' },
  { status: 'aguardando_aluno', label: 'Aguardando aluno', hint: 'Esperando resposta do aluno', accent: 'border-t-purple-500' },
  { status: 'resolvido', label: 'Resolvidos', hint: 'Últimos 15 dias', accent: 'border-t-green-500' },
]

const CAT_ICON: Record<string, string> = {
  secretaria: '📋', financeiro: '💳', academico: '📚', certificado: '🎓', suporte_tecnico: '🔧', cancelamento: '❌', outros: '💬',
}

const PRIO_DOT: Record<string, string> = { urgente: 'bg-red-500', alta: 'bg-orange-500', media: 'bg-yellow-400', baixa: 'bg-green-500' }
const QUEUE_KEY = 'ficv_ticket_kanban_queue'

export function TicketKanban({ tickets, onOpen, defaultQueueName }: { tickets: Ticket[]; onOpen: (t: Ticket) => void; defaultQueueName?: string }) {
  const qc = useQueryClient()
  const { data: queues = [] } = useQuery<{ id: number; nome: string }[]>({
    queryKey: ['ticket-queues'],
    queryFn: async () => (await supabase.from('ticket_queues').select('id, nome').eq('ativo', true).order('ordem')).data ?? [],
    staleTime: 5 * 60_000,
  })
  const [queuePick, setQueuePick] = useState<string>(() => {
    if (defaultQueueName) return `name:${defaultQueueName}`
    try { return localStorage.getItem(QUEUE_KEY) || 'todas' } catch { return 'todas' }
  })
  const cat: number | 'todas' = queuePick === 'todas' ? 'todas'
    : queuePick.startsWith('name:') ? (queues.find((q) => q.nome.toLowerCase().startsWith(queuePick.slice(5).toLowerCase()))?.id ?? 'todas')
    : Number(queuePick)
  const [search, setSearch] = useState('')
  const pickCat = (q: number | 'todas') => { setQueuePick(String(q)); try { if (!defaultQueueName) localStorage.setItem(QUEUE_KEY, String(q)) } catch { /* sem storage */ } }

  // quem falou por último em cada chamado → destaca "aluno respondeu" nos que estão com a equipe
  const ids = tickets.map((t) => t.id)
  const { data: lastWho = {} } = useQuery<Record<number, string>>({
    queryKey: ['ticket-last-author', ids.length, ids[0]],
    queryFn: async () => {
      const { data } = await supabase.from('ticket_messages').select('ticket_id, autor_role, created_at')
        .in('ticket_id', ids).eq('interno', false).order('created_at', { ascending: true })
      const m: Record<number, string> = {}
      for (const r of data ?? []) m[r.ticket_id] = r.autor_role
      return m
    },
    enabled: ids.length > 0,
    refetchInterval: 30000,
  })

  const since15 = Date.now() - 15 * 86400_000
  const visible = useMemo(() => tickets.filter((t) => {
    if (cat !== 'todas' && (t as any).queue_id !== cat) return false
    if (t.status === 'fechado') return false
    if (t.status === 'resolvido' && new Date(t.resolved_at ?? t.updated_at).getTime() < since15) return false
    if (search) {
      const q = search.toLowerCase()
      if (!t.titulo.toLowerCase().includes(q) && !t.protocolo.toLowerCase().includes(q) && !t.aluno_nome.toLowerCase().includes(q)) return false
    }
    return true
  }), [tickets, cat, search, since15])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tickets) if (!['resolvido', 'fechado'].includes(t.status)) c[String((t as any).queue_id)] = (c[String((t as any).queue_id)] ?? 0) + 1
    c.todas = Object.values(c).reduce((a, b) => a + b, 0)
    return c
  }, [tickets])

  const onDragEnd = async (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return
    const status = r.destination.droppableId as TicketStatus
    const id = Number(r.draggableId)
    // otimista: move o card já
    qc.setQueryData<Ticket[]>(['tickets', 'dashboard'], (old) => old?.map((t) => (t.id === id ? { ...t, status } : t)))
    const { data, error } = await supabase.from('tickets').update({
      status,
      ...(status === 'resolvido' ? { resolved_at: new Date().toISOString() } : {}),
    }).eq('id', id).select('id')
    if (error || !data?.length) {
      showError(`Não foi possível mover: ${error?.message ?? 'sessão expirada, recarregue a página.'}`)
    } else {
      showSuccess(status === 'resolvido' ? 'Resolvido — o aluno recebe um e-mail em alguns minutos.' : `Movido para ${COLUMNS.find((c) => c.status === status)?.label}.`)
    }
    qc.invalidateQueries({ queryKey: ['tickets'] })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[{ id: 'todas' as const, nome: 'Todas as filas' }, ...queues].map((q) => (
          <button key={q.id} onClick={() => pickCat(q.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${cat === q.id
              ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
              : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
            {q.nome}{counts[String(q.id)] ? <span className="ml-1 opacity-80">({counts[String(q.id)]})</span> : null}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar aluno, título, protocolo…"
            className="pl-9 h-9 bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]" />
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {COLUMNS.map((col) => {
            const items = visible.filter((t) => t.status === col.status)
              .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
            return (
              <div key={col.status} className={`rounded-xl bg-[var(--bg-card)]/60 border border-[var(--border)] border-t-4 ${col.accent}`}>
                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-[var(--text-main)]">{col.label}</p>
                    <span className="text-xs font-semibold text-[var(--text-muted)] bg-[var(--bg-main)] rounded-full px-2 py-0.5">{items.length}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">{col.hint}</p>
                </div>
                <Droppable droppableId={col.status}>
                  {(prov, snap) => (
                    <div ref={prov.innerRef} {...prov.droppableProps}
                      className={`px-2 pb-2 space-y-2 min-h-[120px] max-h-[70vh] overflow-y-auto custom-scrollbar rounded-b-xl ${snap.isDraggingOver ? 'bg-[var(--primary)]/5' : ''}`}>
                      {items.map((t, i) => {
                        const alunoFalou = lastWho[t.id] === 'aluno' && ['em_atendimento', 'aguardando_aluno'].includes(t.status)
                        return (
                          <Draggable key={t.id} draggableId={String(t.id)} index={i}>
                            {(p) => (
                              <button ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} onClick={() => onOpen(t)}
                                className="w-full text-left rounded-lg bg-[var(--bg-main)] border border-[var(--border)] p-3 hover:border-[var(--primary)]/50 transition-colors shadow-sm">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${PRIO_DOT[t.prioridade] ?? 'bg-slate-400'}`} title={`Prioridade ${t.prioridade}`} />
                                  <span className="text-[11px] font-mono text-[var(--primary)]">{t.protocolo}</span>
                                  <span className="text-[11px]" title={t.categoria}>{CAT_ICON[t.categoria]}</span>
                                  {alunoFalou && (
                                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-purple-500">
                                      <MessageCircleReply className="w-3 h-3" /> aluno respondeu
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-[var(--text-main)] leading-snug line-clamp-2">{t.titulo}</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1 truncate">{t.aluno_nome}</p>
                                <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--text-muted)]">
                                  <span className="flex items-center gap-1 truncate">
                                    <UserRound className="w-3 h-3 shrink-0" /> {(t as any).atendente?.full_name ?? 'sem responsável'}
                                  </span>
                                  <span className="shrink-0">{formatDistanceToNow(new Date(t.updated_at), { addSuffix: false, locale: ptBR })}</span>
                                </div>
                              </button>
                            )}
                          </Draggable>
                        )
                      })}
                      {prov.placeholder}
                      {items.length === 0 && <p className="text-xs text-center text-[var(--text-muted)] py-6">Nenhum chamado</p>}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </div>
      </DragDropContext>
    </div>
  )
}
