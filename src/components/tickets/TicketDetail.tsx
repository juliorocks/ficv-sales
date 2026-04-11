import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/use-auth'
import type { Ticket, TicketMessage, TicketEvaluation, TicketStatus } from '../../types/database'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { showSuccess, showError } from '../../utils/toast'
import {
  X, Send, Lock, Clock, CheckCircle2, Star, ChevronRight,
  MessageSquare, Shield, Loader2, UserCircle2, AlertCircle
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Helpers ─────────────────────────────────────────────────

const STATUS_LABELS: Record<TicketStatus, string> = {
  aberto: 'Aberto',
  em_atendimento: 'Em Atendimento',
  aguardando_aluno: 'Aguardando Aluno',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  aberto: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  em_atendimento: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aguardando_aluno: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  resolvido: 'bg-green-500/15 text-green-400 border-green-500/30',
  fechado: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

// ── Evaluation Form ──────────────────────────────────────────

function EvaluationForm({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [csat, setCsat] = useState(0)
  const [ces, setCes] = useState(0)
  const [fcr, setFcr] = useState<boolean | null>(null)
  const [nps, setNps] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!csat || !ces || fcr === null || nps === null) {
      showError('Preencha todas as avaliações antes de enviar.')
      return
    }
    setSaving(true)
    try {
      const { error: evErr } = await supabase.from('ticket_evaluations').insert({
        ticket_id: ticket.id,
        aluno_id: user!.id,
        csat_nota: csat,
        ces_nota: ces,
        fcr_resolvido: fcr,
        nps_nota: nps,
        comentario: comentario || null,
      })
      if (evErr) throw evErr

      const { error: tErr } = await supabase
        .from('tickets')
        .update({ avaliado: true, status: 'fechado' })
        .eq('id', ticket.id)
      if (tErr) throw tErr

      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
      showSuccess('Avaliação enviada! Obrigado pelo feedback.')
      onDone()
    } catch {
      showError('Erro ao enviar avaliação.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* CSAT */}
      <div>
        <p className="text-sm font-medium text-[var(--text-main)] mb-2">
          Qual sua satisfação com o atendimento? <span className="text-[var(--danger)]">*</span>
        </p>
        <p className="text-xs text-[var(--text-muted)] mb-3">CSAT — Customer Satisfaction Score</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setCsat(n)}
              className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${
                csat === n
                  ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]'
              }`}
            >
              <Star className={`w-4 h-4 mx-auto mb-1 ${csat >= n ? 'fill-current' : ''}`} />
              {['Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'][n - 1]}
            </button>
          ))}
        </div>
      </div>

      {/* CES */}
      <div>
        <p className="text-sm font-medium text-[var(--text-main)] mb-2">
          Qual foi o esforço para resolver seu problema? <span className="text-[var(--danger)]">*</span>
        </p>
        <p className="text-xs text-[var(--text-muted)] mb-3">CES — Customer Effort Score (1 = Muito fácil · 7 = Muito difícil)</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <button
              key={n}
              onClick={() => setCes(n)}
              className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${
                ces === n
                  ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-green-400">Muito fácil</span>
          <span className="text-xs text-red-400">Muito difícil</span>
        </div>
      </div>

      {/* FCR */}
      <div>
        <p className="text-sm font-medium text-[var(--text-main)] mb-2">
          Seu problema foi resolvido neste atendimento? <span className="text-[var(--danger)]">*</span>
        </p>
        <p className="text-xs text-[var(--text-muted)] mb-3">FCR — First Contact Resolution</p>
        <div className="flex gap-3">
          {[true, false].map(val => (
            <button
              key={String(val)}
              onClick={() => setFcr(val)}
              className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${
                fcr === val
                  ? val
                    ? 'bg-green-500/20 border-green-500 text-green-400'
                    : 'bg-red-500/20 border-red-500 text-red-400'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]'
              }`}
            >
              {val ? '✓ Sim, foi resolvido' : '✗ Não foi resolvido'}
            </button>
          ))}
        </div>
      </div>

      {/* NPS */}
      <div>
        <p className="text-sm font-medium text-[var(--text-main)] mb-2">
          De 0 a 10, qual a chance de recomendar nosso suporte? <span className="text-[var(--danger)]">*</span>
        </p>
        <p className="text-xs text-[var(--text-muted)] mb-3">NPS — Net Promoter Score</p>
        <div className="flex gap-1">
          {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
            <button
              key={n}
              onClick={() => setNps(n)}
              className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${
                nps === n
                  ? n >= 9 ? 'bg-green-500 border-green-500 text-white'
                  : n >= 7 ? 'bg-amber-500 border-amber-500 text-white'
                  : 'bg-red-500 border-red-500 text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-red-400">Detrator</span>
          <span className="text-xs text-green-400">Promotor</span>
        </div>
      </div>

      {/* Comentário */}
      <div>
        <p className="text-sm font-medium text-[var(--text-main)] mb-2">Comentário adicional (opcional)</p>
        <Textarea
          value={comentario}
          onChange={e => setComentario(e.target.value)}
          placeholder="Conte-nos mais sobre sua experiência..."
          className="resize-none bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
          rows={3}
        />
      </div>

      <Button onClick={submit} disabled={saving} className="w-full btn-primary">
        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
        Enviar Avaliação e Fechar Ticket
      </Button>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────

interface Props {
  ticket: Ticket
  onClose: () => void
}

export function TicketDetail({ ticket, onClose }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const isStaff = user?.role === 'admin' || user?.role === 'agent'

  const [msg, setMsg] = useState('')
  const [interno, setInterno] = useState(false)
  const [sending, setSending] = useState(false)
  const [showEval, setShowEval] = useState(false)

  // Fetch messages
  const { data: messages = [], isLoading } = useQuery<TicketMessage[]>({
    queryKey: ['ticket-messages', ticket.id],
    queryFn: async () => {
      const q = supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true })
      if (!isStaff) q.eq('interno', false)
      const { data, error } = await q
      if (error) throw error
      return data
    },
    refetchInterval: 10000,
  })

  // Fetch ticket (para status atualizado)
  const { data: currentTicket } = useQuery<Ticket>({
    queryKey: ['ticket', ticket.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*, atendente:profiles!tickets_atendente_id_fkey(full_name), curso:courses(name, type)')
        .eq('id', ticket.id)
        .single()
      if (error) throw error
      return data
    },
    refetchInterval: 15000,
    initialData: ticket,
  })

  const t = currentTicket ?? ticket

  // Buscar atendentes (staff)
  const { data: atendentes = [] } = useQuery({
    queryKey: ['staff-profiles'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['admin', 'agent'])
      return data ?? []
    },
    enabled: isStaff,
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!msg.trim()) return
    setSending(true)
    try {
      const role = isStaff ? (user?.role === 'admin' ? 'admin' : 'atendente') : 'aluno'
      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: ticket.id,
        autor_id: user!.id,
        autor_nome: user!.full_name,
        autor_role: role,
        conteudo: msg.trim(),
        interno: isStaff ? interno : false,
      })
      if (error) throw error

      // Se staff respondeu pela 1ª vez → registrar first_response_at e mudar status
      if (isStaff && !t.first_response_at) {
        await supabase.from('tickets').update({
          first_response_at: new Date().toISOString(),
          status: 'em_atendimento',
          atendente_id: user!.id,
        }).eq('id', ticket.id)
      }
      // Se aluno respondeu → aguardando_aluno vira aberto novamente
      if (!isStaff && t.status === 'aguardando_aluno') {
        await supabase.from('tickets').update({ status: 'em_atendimento' }).eq('id', ticket.id)
      }

      setMsg('')
      setInterno(false)
      qc.invalidateQueries({ queryKey: ['ticket-messages', ticket.id] })
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    } catch {
      showError('Erro ao enviar mensagem.')
    } finally {
      setSending(false)
    }
  }

  const changeStatus = async (status: TicketStatus) => {
    const { error } = await supabase.from('tickets').update({
      status,
      ...(status === 'resolvido' ? { resolved_at: new Date().toISOString() } : {}),
    }).eq('id', ticket.id)
    if (error) { showError('Erro ao atualizar status.'); return }
    qc.invalidateQueries({ queryKey: ['ticket', ticket.id] })
    qc.invalidateQueries({ queryKey: ['tickets'] })
    showSuccess('Status atualizado.')
  }

  const assignTo = async (atendente_id: string) => {
    const { error } = await supabase.from('tickets').update({ atendente_id }).eq('id', ticket.id)
    if (error) { showError('Erro ao atribuir.'); return }
    qc.invalidateQueries({ queryKey: ['ticket', ticket.id] })
    qc.invalidateQueries({ queryKey: ['tickets'] })
    showSuccess('Atendente atribuído.')
  }

  const canEvaluate = !isStaff && (t.status === 'resolvido') && !t.avaliado

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 bg-[var(--bg-card)] border-[var(--border)]">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded">
                  {t.protocolo}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[t.status]}`}>
                  {STATUS_LABELS[t.status]}
                </span>
              </div>
              <DialogTitle className="text-base font-semibold text-[var(--text-main)] leading-tight">
                {t.titulo}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Aberto por <strong>{t.aluno_nome}</strong> · {format(new Date(t.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                {t.curso && <> · <span className="text-[var(--primary)]/80">{t.curso.name}</span></>}
              </p>
            </div>

            {/* Staff controls */}
            {isStaff && (
              <div className="flex items-center gap-2 shrink-0">
                <Select value={t.status} onValueChange={(v) => changeStatus(v as TicketStatus)}>
                  <SelectTrigger className="h-8 text-xs w-40 bg-[var(--bg-main)] border-[var(--border)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(STATUS_LABELS) as [TicketStatus, string][]).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={t.atendente_id ?? ''} onValueChange={assignTo}>
                  <SelectTrigger className="h-8 text-xs w-36 bg-[var(--bg-main)] border-[var(--border)]">
                    <SelectValue placeholder="Atribuir" />
                  </SelectTrigger>
                  <SelectContent>
                    {atendentes.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Avaliação pendente */}
        {canEvaluate && !showEval && (
          <div className="mx-6 mt-4 shrink-0 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" />
              <p className="text-sm text-amber-300">Seu atendimento foi marcado como resolvido. Avalie para fechar o ticket.</p>
            </div>
            <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setShowEval(true)}>
              Avaliar <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}

        {/* Formulário de avaliação */}
        {showEval && (
          <div className="mx-6 mt-4 shrink-0 bg-[var(--bg-main)] border border-[var(--border)] rounded-lg p-4 overflow-y-auto max-h-[55vh]">
            <h3 className="font-semibold text-[var(--text-main)] mb-4 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" /> Avaliação do Atendimento
            </h3>
            <EvaluationForm ticket={t} onDone={() => { setShowEval(false); onClose() }} />
          </div>
        )}

        {/* Messages */}
        {!showEval && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhuma mensagem ainda.</p>
              </div>
            ) : (
              messages.map(m => {
                const isMine = m.autor_id === user?.id
                const isInterno = m.interno

                return (
                  <div key={m.id} className={`flex gap-3 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                      ${m.autor_role === 'aluno'
                        ? 'bg-[var(--primary)]/20 text-[var(--primary)]'
                        : 'bg-green-500/20 text-green-400'
                      }`}>
                      {m.autor_nome.charAt(0).toUpperCase()}
                    </div>
                    <div className={`max-w-[70%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)] font-medium">{m.autor_nome}</span>
                        {isInterno && (
                          <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            <Lock className="w-2.5 h-2.5" /> Interno
                          </span>
                        )}
                        <span className="text-xs text-[var(--text-muted)]">
                          {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ptBR })}
                        </span>
                      </div>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                        ${isInterno
                          ? 'bg-amber-500/10 border border-amber-500/20 text-amber-200'
                          : isMine
                            ? 'bg-[var(--primary)] text-white rounded-tr-sm'
                            : 'bg-[var(--bg-main)] border border-[var(--border)] text-[var(--text-main)] rounded-tl-sm'
                        }`}>
                        {m.conteudo}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input */}
        {!showEval && t.status !== 'fechado' && (
          <div className="px-6 pb-5 pt-3 border-t border-[var(--border)] shrink-0">
            {isStaff && (
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setInterno(false)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-all ${
                    !interno ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <MessageSquare className="w-3 h-3" /> Resposta
                </button>
                <button
                  onClick={() => setInterno(true)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-all ${
                    interno ? 'bg-amber-500 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <Lock className="w-3 h-3" /> Nota Interna
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                value={msg}
                onChange={e => setMsg(e.target.value)}
                placeholder={interno ? 'Nota interna (não visível ao aluno)...' : 'Digite sua mensagem...'}
                className={`resize-none flex-1 bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-main)] ${
                  interno ? 'border-amber-500/50' : ''
                }`}
                rows={2}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                }}
              />
              <Button
                onClick={sendMessage}
                disabled={sending || !msg.trim()}
                className="self-end btn-primary h-10 w-10 p-0"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">Enter para enviar · Shift+Enter para nova linha</p>
          </div>
        )}

        {t.status === 'fechado' && !showEval && (
          <div className="px-6 pb-5 pt-3 border-t border-[var(--border)] shrink-0">
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] bg-[var(--bg-main)] rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              Ticket fechado {t.avaliado ? '· Avaliação recebida' : ''}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
