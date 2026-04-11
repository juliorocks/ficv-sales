/**
 * TicketDashboard — visão do ADMIN / ATENDENTE
 * Painel completo com métricas, filtros e lista de tickets.
 */
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/use-auth'
import type { Ticket, TicketCategoria, TicketStatus, TicketEvaluation } from '../../types/database'
import { TicketDetail } from './TicketDetail'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Badge } from '../ui/badge'
import {
  Ticket as TicketIcon, Clock, CheckCircle2, AlertCircle, Star,
  Search, Filter, Users, TrendingUp, MessageSquare, Timer,
  ChevronRight, Loader2, RefreshCw
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import { formatDistanceToNow, format, differenceInMinutes, subDays, startOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Constants ────────────────────────────────────────────────

const CATEGORIAS_LABEL: Record<TicketCategoria, string> = {
  financeiro: 'Financeiro',
  academico: 'Acadêmico',
  secretaria: 'Secretaria',
  suporte_tecnico: 'Suporte Técnico',
  certificado: 'Certificado',
  cancelamento: 'Cancelamento',
  outros: 'Outros',
}

const CATEGORIA_ICON: Record<TicketCategoria, string> = {
  financeiro: '💳', academico: '📚', secretaria: '📋',
  suporte_tecnico: '🔧', certificado: '🎓', cancelamento: '❌', outros: '💬',
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  aberto: 'Aberto', em_atendimento: 'Em Atendimento',
  aguardando_aluno: 'Aguardando Aluno', resolvido: 'Resolvido', fechado: 'Fechado',
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  aberto: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  em_atendimento: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aguardando_aluno: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  resolvido: 'bg-green-500/15 text-green-400 border-green-500/30',
  fechado: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

const PIE_COLORS = ['#5551FF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA', '#60A5FA', '#F87171']

// ── Metrics helpers ──────────────────────────────────────────

function calcMetrics(tickets: Ticket[], evaluations: TicketEvaluation[]) {
  const total = tickets.length
  const resolved = tickets.filter(t => ['resolvido', 'fechado'].includes(t.status))

  // TMA — Tempo Médio de 1ª Resposta (em minutos)
  const tmaSamples = tickets.filter(t => t.first_response_at)
  const tma = tmaSamples.length
    ? tmaSamples.reduce((acc, t) => {
        return acc + differenceInMinutes(new Date(t.first_response_at!), new Date(t.created_at))
      }, 0) / tmaSamples.length
    : null

  // TMR — Tempo Médio de Resolução (em minutos)
  const tmrSamples = tickets.filter(t => t.resolved_at)
  const tmr = tmrSamples.length
    ? tmrSamples.reduce((acc, t) => {
        return acc + differenceInMinutes(new Date(t.resolved_at!), new Date(t.created_at))
      }, 0) / tmrSamples.length
    : null

  // CSAT médio
  const csatAvg = evaluations.length
    ? evaluations.reduce((a, e) => a + e.csat_nota, 0) / evaluations.length
    : null

  // FCR %
  const fcrCount = evaluations.filter(e => e.fcr_resolvido).length
  const fcrPct = evaluations.length ? (fcrCount / evaluations.length) * 100 : null

  // NPS
  const npsValid = evaluations.filter(e => e.nps_nota !== null)
  const promotores = npsValid.filter(e => e.nps_nota! >= 9).length
  const detratores = npsValid.filter(e => e.nps_nota! <= 6).length
  const nps = npsValid.length ? Math.round(((promotores - detratores) / npsValid.length) * 100) : null

  // CES médio
  const cesAvg = evaluations.length
    ? evaluations.reduce((a, e) => a + e.ces_nota, 0) / evaluations.length
    : null

  return { total, resolved: resolved.length, tma, tmr, csatAvg, fcrPct, nps, cesAvg }
}

function formatMinutes(min: number | null) {
  if (min === null) return '—'
  if (min < 60) return `${Math.round(min)}min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

// ── Charts data ──────────────────────────────────────────────

function buildChartData(tickets: Ticket[]) {
  const days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i))
  return days.map(day => {
    const label = format(day, 'dd/MM', { locale: ptBR })
    const dayStart = startOfDay(day).getTime()
    const dayEnd = dayStart + 86400000
    const abertos = tickets.filter(t => {
      const d = new Date(t.created_at).getTime()
      return d >= dayStart && d < dayEnd
    }).length
    const resolvidos = tickets.filter(t => {
      if (!t.resolved_at) return false
      const d = new Date(t.resolved_at).getTime()
      return d >= dayStart && d < dayEnd
    }).length
    return { label, abertos, resolvidos }
  })
}

function buildCatData(tickets: Ticket[]) {
  const counts: Partial<Record<TicketCategoria, number>> = {}
  tickets.forEach(t => { counts[t.categoria] = (counts[t.categoria] ?? 0) + 1 })
  return Object.entries(counts).map(([cat, value]) => ({
    name: CATEGORIAS_LABEL[cat as TicketCategoria],
    value,
  }))
}

// ── Priority badge ───────────────────────────────────────────

function PriBadge({ p }: { p: string }) {
  const colors: Record<string, string> = {
    baixa: 'bg-green-500/15 text-green-400',
    media: 'bg-amber-500/15 text-amber-400',
    alta: 'bg-orange-500/15 text-orange-400',
    urgente: 'bg-red-500/15 text-red-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[p] ?? ''}`}>
      {p.charAt(0).toUpperCase() + p.slice(1)}
    </span>
  )
}

// ── Main ─────────────────────────────────────────────────────

export function TicketDashboard() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [selected, setSelected] = useState<Ticket | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<TicketStatus | 'todos'>('todos')
  const [filterCat, setFilterCat] = useState<TicketCategoria | 'todos'>('todos')
  const [filterAtendente, setFilterAtendente] = useState<string>('todos')
  const [filterCurso, setFilterCurso] = useState<string>('todos')

  const { data: tickets = [], isLoading, refetch, isFetching } = useQuery<Ticket[]>({
    queryKey: ['tickets', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*, atendente:profiles!tickets_atendente_id_fkey(full_name), curso:courses(name, type)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    refetchInterval: 30000,
  })

  const { data: evaluations = [] } = useQuery<TicketEvaluation[]>({
    queryKey: ['ticket-evaluations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ticket_evaluations').select('*')
      if (error) throw error
      return data
    },
    refetchInterval: 60000,
  })

  const { data: atendentes = [] } = useQuery({
    queryKey: ['staff-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').in('role', ['admin', 'agent'])
      return data ?? []
    },
  })

  const { data: cursos = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => {
      const { data } = await supabase.from('courses').select('id, name, type').order('type').order('name')
      return data ?? []
    },
  })

  const metrics = useMemo(() => calcMetrics(tickets, evaluations), [tickets, evaluations])
  const chartData = useMemo(() => buildChartData(tickets), [tickets])
  const catData = useMemo(() => buildCatData(tickets), [tickets])
  const cursoData = useMemo(() => {
    const counts: Record<string, number> = {}
    tickets.forEach(t => {
      const nome = (t as any).curso?.name ?? 'Sem curso'
      counts[nome] = (counts[nome] ?? 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }))
  }, [tickets])

  const filtered = tickets.filter(t => {
    if (filterStatus !== 'todos' && t.status !== filterStatus) return false
    if (filterCat !== 'todos' && t.categoria !== filterCat) return false
    if (filterAtendente !== 'todos' && t.atendente_id !== filterAtendente) return false
    if (filterCurso !== 'todos' && String(t.curso_id ?? '') !== filterCurso) return false
    if (search) {
      const q = search.toLowerCase()
      if (!t.titulo.toLowerCase().includes(q) &&
          !t.protocolo.toLowerCase().includes(q) &&
          !t.aluno_nome.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Tickets de Atendimento</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Gerencie e acompanhe todos os atendimentos</p>
        </div>
        <button
          onClick={() => refetch()}
          className={`flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors ${isFetching ? 'animate-spin' : ''}`}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total', value: metrics.total, sub: 'tickets', icon: TicketIcon, color: 'text-[var(--primary)]' },
          { label: 'Resolvidos', value: metrics.resolved, sub: 'tickets', icon: CheckCircle2, color: 'text-green-400' },
          { label: 'TMA', value: formatMinutes(metrics.tma), sub: '1ª resposta', icon: Timer, color: 'text-blue-400' },
          { label: 'TMR', value: formatMinutes(metrics.tmr), sub: 'resolução', icon: Clock, color: 'text-amber-400' },
          { label: 'CSAT', value: metrics.csatAvg ? `${metrics.csatAvg.toFixed(1)}/5` : '—', sub: 'satisfação', icon: Star, color: 'text-yellow-400' },
          { label: 'FCR', value: metrics.fcrPct !== null ? `${Math.round(metrics.fcrPct)}%` : '—', sub: '1º contato', icon: CheckCircle2, color: 'text-green-400' },
          { label: 'NPS', value: metrics.nps !== null ? metrics.nps : '—', sub: 'net promoter', icon: TrendingUp, color: metrics.nps !== null ? (metrics.nps >= 50 ? 'text-green-400' : metrics.nps >= 0 ? 'text-amber-400' : 'text-red-400') : 'text-[var(--text-muted)]' },
        ].map(kpi => (
          <div key={kpi.label} className="glass-card p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
              <p className="text-xs text-[var(--text-muted)]">{kpi.label}</p>
            </div>
            <p className="text-xl font-bold text-[var(--text-main)]">{kpi.value}</p>
            <p className="text-xs text-[var(--text-muted)]">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Line chart */}
        <div className="lg:col-span-2 glass-card p-5">
          <h3 className="text-sm font-semibold text-[var(--text-main)] mb-4">Tickets — últimos 7 dias</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text-main)' }}
              />
              <Line type="monotone" dataKey="abertos" stroke="#5551FF" strokeWidth={2} dot={false} name="Abertos" />
              <Line type="monotone" dataKey="resolvidos" stroke="#00D4AA" strokeWidth={2} dot={false} name="Resolvidos" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Pie — Por Categoria */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-[var(--text-main)] mb-4">Por Categoria</h3>
          {catData.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Sem dados</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={catData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                  {catData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bar chart — Por Curso */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-[var(--text-main)] mb-1">Tickets por Curso</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">Top 10 cursos com mais solicitações</p>
        {cursoData.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-[var(--text-muted)] text-sm">Sem dados</div>
        ) : (
          <ResponsiveContainer width="100%" height={cursoData.length * 36 + 20}>
            <BarChart data={cursoData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text-main)', fontWeight: 600 }}
                cursor={{ fill: 'var(--primary)', opacity: 0.08 }}
              />
              <Bar dataKey="value" name="Tickets" radius={[0, 4, 4, 0]}>
                {cursoData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, protocolo ou aluno..."
            className="pl-9 bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)] h-9"
          />
        </div>

        <Select value={filterStatus} onValueChange={v => setFilterStatus(v as any)}>
          <SelectTrigger className="w-40 h-9 text-sm bg-[var(--bg-card)] border-[var(--border)]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos status</SelectItem>
            {(Object.entries(STATUS_LABELS) as [TicketStatus, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterCat} onValueChange={v => setFilterCat(v as any)}>
          <SelectTrigger className="w-44 h-9 text-sm bg-[var(--bg-card)] border-[var(--border)]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas categorias</SelectItem>
            {(Object.entries(CATEGORIAS_LABEL) as [TicketCategoria, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{CATEGORIA_ICON[k]} {v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterCurso} onValueChange={setFilterCurso}>
          <SelectTrigger className="w-44 h-9 text-sm bg-[var(--bg-card)] border-[var(--border)]">
            <SelectValue placeholder="Curso" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os cursos</SelectItem>
            <SelectItem value="">Sem curso</SelectItem>
            {['Graduação', 'Pós-Graduação', 'Curso Livre'].map(tipo => {
              const grupo = cursos.filter((c: any) => c.type === tipo)
              if (!grupo.length) return null
              return (
                <div key={tipo}>
                  <div className="px-2 py-1 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{tipo}</div>
                  {grupo.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </div>
              )
            })}
          </SelectContent>
        </Select>

        {isAdmin && (
          <Select value={filterAtendente} onValueChange={setFilterAtendente}>
            <SelectTrigger className="w-44 h-9 text-sm bg-[var(--bg-card)] border-[var(--border)]">
              <SelectValue placeholder="Atendente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos atendentes</SelectItem>
              {atendentes.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <p className="text-xs text-[var(--text-muted)] ml-auto">
          {filtered.length} de {tickets.length} tickets
        </p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 glass-card">
          <TicketIcon className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-40" />
          <p className="text-[var(--text-main)] font-medium">Nenhum ticket encontrado</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {['Protocolo', 'Aluno', 'Assunto', 'Curso', 'Categoria', 'Prioridade', 'Status', 'Atendente', 'Criado', 'Avaliação', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const eval_ = evaluations.find(e => e.ticket_id === t.id)
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelected(t)}
                      className="border-b border-[var(--border)] hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-[var(--primary)]">{t.protocolo}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--text-main)] whitespace-nowrap">{t.aluno_nome}</p>
                        <p className="text-xs text-[var(--text-muted)]">{t.aluno_email}</p>
                      </td>
                      <td className="px-4 py-3 max-w-48">
                        <p className="text-[var(--text-main)] truncate">{t.titulo}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {t.curso ? (
                          <div>
                            <p className="text-xs font-medium text-[var(--text-main)]">{t.curso.name}</p>
                            <p className="text-xs text-[var(--text-muted)]">{t.curso.type}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)] italic">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span>{CATEGORIA_ICON[t.categoria]} {CATEGORIAS_LABEL[t.categoria]}</span>
                      </td>
                      <td className="px-4 py-3">
                        <PriBadge p={t.prioridade} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${STATUS_COLORS[t.status]}`}>
                          {STATUS_LABELS[t.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {(t as any).atendente?.full_name ?? <span className="italic">Não atribuído</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: ptBR })}
                      </td>
                      <td className="px-4 py-3">
                        {eval_ ? (
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                            <span className="text-xs text-amber-400 font-medium">{eval_.csat_nota}/5</span>
                            <span className="text-xs text-[var(--text-muted)]">NPS {eval_.nps_nota ?? '—'}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)] italic">Pendente</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <TicketDetail ticket={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
