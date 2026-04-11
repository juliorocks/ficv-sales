/**
 * AlunoHistorico — drawer lateral com todos os tickets de um aluno
 * Aberto no TicketDashboard ao clicar no nome/email do aluno.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Ticket, TicketEvaluation } from '../../types/database'
import { TicketDetail } from './TicketDetail'
import {
  X, Ticket as TicketIcon, Star, CheckCircle2, Clock,
  ChevronRight, Loader2, User, Mail
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Constants (duplicadas localmente para não criar dep circular) ─────────────

const CATEGORIA_ICON: Record<string, string> = {
  financeiro: '💳', academico: '📚', secretaria: '📋',
  suporte_tecnico: '🔧', certificado: '🎓', cancelamento: '❌', outros: '💬',
}

const CATEGORIAS_LABEL: Record<string, string> = {
  financeiro: 'Financeiro', academico: 'Acadêmico', secretaria: 'Secretaria',
  suporte_tecnico: 'Suporte Técnico', certificado: 'Certificado',
  cancelamento: 'Cancelamento', outros: 'Outros',
}

const STATUS_COLORS: Record<string, string> = {
  aberto: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  em_atendimento: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aguardando_aluno: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  resolvido: 'bg-green-500/15 text-green-400 border-green-500/30',
  fechado: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  aberto: 'Aberto', em_atendimento: 'Em Atendimento',
  aguardando_aluno: 'Aguardando Aluno', resolvido: 'Resolvido', fechado: 'Fechado',
}

// ── Component ────────────────────────────────────────────────

interface Props {
  alunoId: string
  alunoNome: string
  alunoEmail: string
  onClose: () => void
}

export function AlunoHistorico({ alunoId, alunoNome, alunoEmail, onClose }: Props) {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['tickets', 'aluno-historico', alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*, atendente:profiles!tickets_atendente_profile_fkey(full_name), curso:courses(name, type)')
        .eq('aluno_id', alunoId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: evaluations = [] } = useQuery<TicketEvaluation[]>({
    queryKey: ['ticket-evaluations', 'aluno', alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_evaluations')
        .select('*')
        .eq('aluno_id', alunoId)
      if (error) throw error
      return data
    },
  })

  // Métricas do aluno
  const total = tickets.length
  const resolvidos = tickets.filter(t => ['resolvido', 'fechado'].includes(t.status)).length
  const abertos = tickets.filter(t => !['resolvido', 'fechado'].includes(t.status)).length
  const csatAvg = evaluations.length
    ? (evaluations.reduce((a, e) => a + e.csat_nota, 0) / evaluations.length).toFixed(1)
    : null
  const npsValid = evaluations.filter(e => e.nps_nota !== null)
  const nps = npsValid.length
    ? Math.round(
        ((npsValid.filter(e => e.nps_nota! >= 9).length - npsValid.filter(e => e.nps_nota! <= 6).length)
          / npsValid.length) * 100
      )
    : null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-[var(--bg-card)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--border)] flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] font-bold text-lg">
              {alunoNome.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-main)] flex items-center gap-2">
                <User className="w-4 h-4 text-[var(--text-muted)]" />
                {alunoNome}
              </h2>
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                <Mail className="w-3 h-3" /> {alunoEmail}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors mt-0.5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Métricas */}
        <div className="px-6 py-4 grid grid-cols-4 gap-3 border-b border-[var(--border)] shrink-0">
          {[
            { label: 'Total', value: total, icon: TicketIcon, color: 'text-[var(--primary)]' },
            { label: 'Abertos', value: abertos, icon: Clock, color: 'text-blue-400' },
            { label: 'Resolvidos', value: resolvidos, icon: CheckCircle2, color: 'text-green-400' },
            { label: 'CSAT', value: csatAvg ? `${csatAvg}/5` : '—', icon: Star, color: 'text-amber-400' },
          ].map(m => (
            <div key={m.label} className="bg-[var(--bg-main)] rounded-lg p-3 text-center">
              <m.icon className={`w-4 h-4 mx-auto mb-1 ${m.color}`} />
              <p className="text-lg font-bold text-[var(--text-main)]">{m.value}</p>
              <p className="text-xs text-[var(--text-muted)]">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Lista de tickets */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4">
            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
              Histórico de Tickets
            </h3>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-10">
                <TicketIcon className="w-10 h-10 mx-auto mb-2 text-[var(--text-muted)] opacity-30" />
                <p className="text-sm text-[var(--text-muted)]">Nenhum ticket encontrado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tickets.map(t => {
                  const eval_ = evaluations.find(e => e.ticket_id === t.id)
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTicket(t)}
                      className="w-full text-left bg-[var(--bg-main)] hover:border-[var(--primary)]/40 border border-[var(--border)] rounded-lg p-3.5 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* Protocolo + status */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-mono text-[var(--primary)]">{t.protocolo}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_COLORS[t.status]}`}>
                              {STATUS_LABELS[t.status]}
                            </span>
                          </div>

                          {/* Título */}
                          <p className="text-sm font-medium text-[var(--text-main)] truncate group-hover:text-[var(--primary)]">
                            {t.titulo}
                          </p>

                          {/* Meta */}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-[var(--text-muted)]">
                              {CATEGORIA_ICON[t.categoria]} {CATEGORIAS_LABEL[t.categoria]}
                            </span>
                            {t.curso && (
                              <span className="text-xs text-[var(--primary)]/70">· {t.curso.name}</span>
                            )}
                            <span className="text-xs text-[var(--text-muted)]">
                              · {format(new Date(t.created_at), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                          </div>

                          {/* Atendente + avaliação */}
                          <div className="flex items-center gap-3 mt-1.5">
                            {(t as any).atendente?.full_name && (
                              <span className="text-xs text-[var(--text-muted)]">
                                Atendente: <span className="text-[var(--text-main)]">{(t as any).atendente.full_name}</span>
                              </span>
                            )}
                            {eval_ && (
                              <span className="flex items-center gap-1 text-xs text-amber-400">
                                <Star className="w-3 h-3 fill-amber-400" /> {eval_.csat_nota}/5
                                {eval_.nps_nota !== null && (
                                  <span className="text-[var(--text-muted)] ml-1">NPS {eval_.nps_nota}</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] shrink-0 mt-1" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer com NPS geral */}
        {nps !== null && (
          <div className="px-6 py-3 border-t border-[var(--border)] shrink-0">
            <p className="text-xs text-[var(--text-muted)] text-center">
              NPS deste aluno:{' '}
              <span className={`font-bold ${nps >= 50 ? 'text-green-400' : nps >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                {nps}
              </span>
              {' '}· {evaluations.length} avaliação{evaluations.length !== 1 ? 'ões' : ''}
            </p>
          </div>
        )}
      </div>

      {/* Abre o ticket selecionado por cima do drawer */}
      {selectedTicket && (
        <TicketDetail
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </>
  )
}
