/**
 * TicketPortal — visão do ALUNO
 * Permite abrir novos tickets e acompanhar os seus.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/use-auth'
import type { Ticket, TicketCategoria, TicketPrioridade } from '../../types/database'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { TicketDetail } from './TicketDetail'
import { showSuccess, showError } from '../../utils/toast'
import {
  Plus, Ticket as TicketIcon, Clock, CheckCircle2, MessageSquare,
  AlertCircle, ChevronRight, Loader2, Search, Star
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Constants ────────────────────────────────────────────────

const CATEGORIAS: { value: TicketCategoria; label: string; desc: string; icon: string }[] = [
  { value: 'financeiro',     label: 'Financeiro',       desc: 'Boleto, pagamento, desconto',       icon: '💳' },
  { value: 'academico',      label: 'Acadêmico',        desc: 'Notas, conteúdo, dúvidas do curso', icon: '📚' },
  { value: 'secretaria',     label: 'Secretaria',       desc: 'Matrícula, documentos, declarações', icon: '📋' },
  { value: 'suporte_tecnico',label: 'Suporte Técnico',  desc: 'Acesso à plataforma, login, erros', icon: '🔧' },
  { value: 'certificado',    label: 'Certificado',      desc: 'Emissão, prazo, reenvio',           icon: '🎓' },
  { value: 'cancelamento',   label: 'Cancelamento',     desc: 'Cancelar matrícula ou curso',       icon: '❌' },
  { value: 'outros',         label: 'Outros',           desc: 'Outros assuntos',                   icon: '💬' },
]

const STATUS_LABELS: Record<string, string> = {
  aberto: 'Aberto',
  em_atendimento: 'Em Atendimento',
  aguardando_aluno: 'Aguardando você',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
}

const STATUS_COLORS: Record<string, string> = {
  aberto: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  em_atendimento: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aguardando_aluno: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  resolvido: 'bg-green-500/15 text-green-400 border-green-500/30',
  fechado: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

// ── New Ticket Form ──────────────────────────────────────────

function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [step, setStep] = useState<'categoria' | 'detalhes'>('categoria')
  const [categoria, setCategoria] = useState<TicketCategoria | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [prioridade, setPrioridade] = useState<TicketPrioridade>('media')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!titulo.trim() || !descricao.trim() || !categoria) {
      showError('Preencha todos os campos.')
      return
    }
    setSaving(true)
    try {
      // Criar ticket
      const { data: ticketData, error: tErr } = await supabase.from('tickets').insert({
        protocolo: '',   // trigger preencherá
        titulo: titulo.trim(),
        categoria,
        prioridade,
        status: 'aberto',
        aluno_id: user!.id,
        aluno_nome: user!.full_name,
        aluno_email: user!.email ?? '',
      }).select().single()
      if (tErr) throw tErr

      // Primeira mensagem = descrição do problema
      const { error: mErr } = await supabase.from('ticket_messages').insert({
        ticket_id: ticketData.id,
        autor_id: user!.id,
        autor_nome: user!.full_name,
        autor_role: 'aluno',
        conteudo: descricao.trim(),
        interno: false,
      })
      if (mErr) throw mErr

      qc.invalidateQueries({ queryKey: ['tickets'] })
      showSuccess(`Ticket ${ticketData.protocolo} aberto com sucesso!`)
      onClose()
    } catch (e: any) {
      showError(e?.message ?? 'Erro ao abrir ticket.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-[var(--bg-card)] border-[var(--border)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-main)]">
            {step === 'categoria' ? 'Qual é o assunto?' : 'Descreva sua solicitação'}
          </DialogTitle>
        </DialogHeader>

        {step === 'categoria' ? (
          <div className="grid grid-cols-1 gap-2 mt-2">
            {CATEGORIAS.map(cat => (
              <button
                key={cat.value}
                onClick={() => { setCategoria(cat.value); setStep('detalhes') }}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all text-left group"
              >
                <span className="text-2xl">{cat.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text-main)] group-hover:text-[var(--primary)]">{cat.label}</p>
                  <p className="text-xs text-[var(--text-muted)]">{cat.desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)]" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20">
              <span className="text-lg">{CATEGORIAS.find(c => c.value === categoria)?.icon}</span>
              <span className="text-sm text-[var(--primary)] font-medium">
                {CATEGORIAS.find(c => c.value === categoria)?.label}
              </span>
              <button onClick={() => setStep('categoria')} className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">
                Alterar
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Título da solicitação *</label>
              <Input
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                placeholder="Ex: Boleto com valor incorreto"
                className="bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-main)]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Descreva o problema *</label>
              <Textarea
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="Explique o que aconteceu, quando ocorreu e o que você já tentou..."
                className="resize-none bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-main)]"
                rows={4}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Urgência</label>
              <Select value={prioridade} onValueChange={v => setPrioridade(v as TicketPrioridade)}>
                <SelectTrigger className="bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-main)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">🟢 Baixa — Sem urgência</SelectItem>
                  <SelectItem value="media">🟡 Média — Pode aguardar</SelectItem>
                  <SelectItem value="alta">🟠 Alta — Preciso resolver em breve</SelectItem>
                  <SelectItem value="urgente">🔴 Urgente — Bloqueando meu acesso</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep('categoria')} className="flex-1">
                Voltar
              </Button>
              <Button onClick={submit} disabled={saving} className="flex-1 btn-primary">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Abrir Ticket
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Main ─────────────────────────────────────────────────────

export function TicketPortal() {
  const { user } = useAuth()
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [search, setSearch] = useState('')

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['tickets', 'aluno', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('aluno_id', user!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    refetchInterval: 30000,
  })

  const filtered = tickets.filter(t =>
    t.titulo.toLowerCase().includes(search.toLowerCase()) ||
    t.protocolo.toLowerCase().includes(search.toLowerCase())
  )

  const open = tickets.filter(t => !['fechado'].includes(t.status)).length
  const aguardando = tickets.filter(t => t.status === 'aguardando_aluno').length
  const fechados = tickets.filter(t => t.status === 'fechado').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Central de Atendimento</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Abra solicitações e acompanhe o status dos seus tickets</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="btn-primary gap-2">
          <Plus className="w-4 h-4" /> Novo Ticket
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Em aberto', value: open, icon: Clock, color: 'text-blue-400' },
          { label: 'Aguardando você', value: aguardando, icon: AlertCircle, color: 'text-purple-400' },
          { label: 'Encerrados', value: fechados, icon: CheckCircle2, color: 'text-green-400' },
        ].map(stat => (
          <div key={stat.label} className="glass-card p-4 flex items-center gap-3">
            <stat.icon className={`w-6 h-6 ${stat.color}`} />
            <div>
              <p className="text-2xl font-bold text-[var(--text-main)]">{stat.value}</p>
              <p className="text-xs text-[var(--text-muted)]">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por título ou protocolo..."
          className="pl-9 bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
        />
      </div>

      {/* Tickets list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <TicketIcon className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-40" />
          <p className="text-[var(--text-main)] font-medium">Nenhum ticket encontrado</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Clique em "Novo Ticket" para abrir uma solicitação</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className="w-full glass-card p-4 text-left hover:border-[var(--primary)]/40 transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono text-[var(--primary)]">{t.protocolo}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[t.status]}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                    {t.status === 'aguardando_aluno' && (
                      <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded animate-pulse">
                        Sua resposta é esperada
                      </span>
                    )}
                    {t.avaliado && (
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <Star className="w-3 h-3 fill-current" /> Avaliado
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-[var(--text-main)] truncate group-hover:text-[var(--primary)]">
                    {t.titulo}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {CATEGORIAS.find(c => c.value === t.categoria)?.label} ·{' '}
                    {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] mt-1 shrink-0" />
              </div>
            </button>
          ))}
        </div>
      )}

      {showNew && <NewTicketDialog onClose={() => setShowNew(false)} />}
      {selected && <TicketDetail ticket={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
