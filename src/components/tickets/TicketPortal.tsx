/**
 * TicketPortal — visão do ALUNO
 * Permite abrir novos tickets e acompanhar os seus.
 * Props passadas pelo AlunoPortalPage (auth separado do sistema interno).
 */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Ticket, TicketCategoria, TicketPrioridade } from '../../types/database'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { TicketDetail } from './TicketDetail'
import { InstallAppBanner } from './InstallAppBanner'
import { AlunoInicio, AlunoFinanceiro, AlunoNotas, useOverview } from './AlunoPainel'
import { showSuccess, showError } from '../../utils/toast'
import {
  Plus, Ticket as TicketIcon, Clock, CheckCircle2,
  AlertCircle, ChevronRight, Loader2, Search, Star, LogOut, Home, Wallet, BookOpen, RefreshCw
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Constants ────────────────────────────────────────────────

const CATEGORIAS: { value: TicketCategoria; label: string; desc: string; icon: string }[] = [
  { value: 'financeiro',      label: 'Financeiro',      desc: 'Boleto, pagamento, desconto',        icon: '💳' },
  { value: 'tutoria',         label: 'Tutoria',         desc: 'Dúvidas de conteúdo e atividades com o tutor do seu curso', icon: '🧑‍🏫' },
  { value: 'academico',       label: 'Acadêmico',       desc: 'Notas, conteúdo, dúvidas do curso',  icon: '📚' },
  { value: 'secretaria',      label: 'Secretaria',      desc: 'Matrícula, documentos, declarações', icon: '📋' },
  { value: 'suporte_tecnico', label: 'Suporte Técnico', desc: 'Acesso à plataforma, login, erros',  icon: '🔧' },
  { value: 'certificado',     label: 'Certificado',     desc: 'Emissão, prazo, reenvio',            icon: '🎓' },
  { value: 'biblioteca',      label: 'Biblioteca',      desc: 'Acervo, empréstimos, biblioteca virtual', icon: '📖' },
  { value: 'cancelamento',    label: 'Cancelamento',    desc: 'Cancelar matrícula ou curso',        icon: '❌' },
  { value: 'outros',          label: 'Outros',          desc: 'Outros assuntos',                    icon: '💬' },
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

// ── Curso do chamado = matrículas do aluno no Sponte ─────────
// O nome do Sponte ("Bacharelado Em Teologia - Ead (Teologia Ead 2026.1)") é ligado ao
// catálogo do CRM (courses) quando todas as palavras do curso aparecem nele; EAD ×
// Presencial pela palavra "ead". O nível (graduação/pós) decide a fila da Tutoria.
const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
// "Bacharelado Em Teologia - Ead (Teologia Ead 2026.1)" → "Bacharelado Em Teologia - Ead" (mesmo curso, outra turma)
const semTurma = (v: string) => v.replace(/\s*\([^)]*\)\s*$/, '').trim()
const cursoBase = (v: string) => norm(semTurma(v))
const PALAVRAS_VAZIAS = new Set(['e', 'de', 'do', 'da', 'dos', 'das', 'em', 'o', 'a', 'presencial'])
function cursoDoCatalogo(nomeSponte: string, cursos: { id: number; name: string }[]): number | null {
  const alvo = norm(nomeSponte)
  const ead = /\bead\b/.test(alvo)
  let melhor: { id: number; n: number } | null = null
  for (const c of cursos) {
    const nome = norm(c.name)
    if (/\bead\b/.test(nome) !== ead && /(\bead\b|presencial)/.test(nome)) continue
    const toks = nome.split(/[^a-z0-9]+/).filter(t => t && !PALAVRAS_VAZIAS.has(t) && t !== 'ead')
    if (toks.length && toks.every(t => alvo.includes(t)) && (!melhor || toks.length > melhor.n)) melhor = { id: c.id, n: toks.length }
  }
  return melhor?.id ?? null
}
const nivelDoCurso = (nome: string): 'pos' | 'graduacao' | null => {
  const n = norm(nome)
  if (/\bpos\b|pos-|especializa|mba/.test(n)) return 'pos'
  if (/bacharel|licencia|tecnolog|gradua/.test(n)) return 'graduacao'
  return null
}

// ── New Ticket Form ──────────────────────────────────────────

interface NewTicketDialogProps {
  alunoId: string
  alunoNome: string
  alunoEmail: string
  onClose: () => void
  onCreated?: (t: Ticket) => void  // abre a conversa do chamado recém-criado
}

function NewTicketDialog({ alunoId, alunoNome, alunoEmail, onClose, onCreated }: NewTicketDialogProps) {
  const qc = useQueryClient()
  const [step, setStep] = useState<'categoria' | 'detalhes'>('categoria')
  const [categoria, setCategoria] = useState<TicketCategoria | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [prioridade, setPrioridade] = useState<TicketPrioridade>('media')
  const [cursoId, setCursoId] = useState<string>('__nenhum__')
  const [saving, setSaving] = useState(false)

  const { data: cursos = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => {
      const { data } = await supabase.from('courses').select('id, name, type').order('type').order('name')
      return data ?? []
    },
  })
  // matrículas do próprio aluno no Sponte (vigentes primeiro, sem repetir o curso)
  const ov = useOverview()
  const minhas = (() => {
    const vistos = new Set<string>()
    return [...(ov.data?.matriculas ?? [])]
      .sort((a, b) => Number(/vigente|ativ|cursando/i.test(b.situacao ?? '')) - Number(/vigente|ativ|cursando/i.test(a.situacao ?? ''))
        || String(b.data_matricula).localeCompare(String(a.data_matricula)))
      .filter(m => m.curso && !vistos.has(cursoBase(m.curso)) && vistos.add(cursoBase(m.curso)))
  })()
  const usaSponte = minhas.length > 0
  // já vem marcada a matrícula atual (quem tem um curso só não precisa escolher)
  const [autoSel, setAutoSel] = useState(false)
  useEffect(() => {
    if (usaSponte && !autoSel && cursoId === '__nenhum__') { setCursoId('m:0'); setAutoSel(true) }
  }, [usaSponte, autoSel, cursoId])

  // nível do curso marcado (decide a fila da Tutoria: graduação × pós)
  const nivelEscolhido: 'pos' | 'graduacao' | null = (() => {
    if (!cursoId || cursoId === '__nenhum__') return null
    if (cursoId.startsWith('m:')) { const m = minhas[Number(cursoId.slice(2))]; return m?.curso ? nivelDoCurso(m.curso) : null }
    const t = (cursos as any[]).find(c => String(c.id) === cursoId)?.type ?? ''
    return /p[oó]s/i.test(t) ? 'pos' : /gradua/i.test(t) ? 'graduacao' : null
  })()

  const submit = async () => {
    if (!titulo.trim() || !descricao.trim() || !categoria) {
      showError('Preencha todos os campos obrigatórios.')
      return
    }
    if (categoria === 'tutoria' && (!cursoId || cursoId === '__nenhum__')) {
      showError('Para a Tutoria, escolha o curso — é ele que define a sua turma de tutores.')
      return
    }
    setSaving(true)
    try {
      const { data: ticketData, error: tErr } = await supabase.from('tickets').insert({
        protocolo: '',   // trigger preencherá
        titulo: titulo.trim(),
        categoria,
        prioridade,
        status: 'aberto',
        aluno_id: alunoId,
        aluno_nome: alunoNome,
        aluno_email: alunoEmail,
        ...(() => {
          if (!cursoId || cursoId === '__nenhum__') return { curso_id: null }
          if (usaSponte && cursoId.startsWith('m:')) {
            const m = minhas[Number(cursoId.slice(2))]
            if (!m?.curso) return { curso_id: null }
            return { curso_nome: m.curso, curso_id: cursoDoCatalogo(m.curso, cursos as any), nivel: nivelDoCurso(m.curso) }
          }
          return { curso_id: Number(cursoId) }
        })(),
      }).select().single()
      if (tErr) throw tErr

      const { error: mErr } = await supabase.from('ticket_messages').insert({
        ticket_id: ticketData.id,
        autor_id: alunoId,
        autor_nome: alunoNome,
        autor_role: 'aluno',
        conteudo: descricao.trim(),
        interno: false,
      })
      if (mErr) throw mErr

      qc.invalidateQueries({ queryKey: ['tickets'] })
      showSuccess(`Chamado ${ticketData.protocolo} aberto!`)
      onClose()
      onCreated?.(ticketData as Ticket)
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
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">
                {categoria === 'tutoria' ? 'Curso *' : usaSponte ? 'Curso (das suas matrículas)' : 'Curso (opcional)'}
              </label>
              <Select value={cursoId} onValueChange={setCursoId}>
                <SelectTrigger className="bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-main)]">
                  <SelectValue placeholder="Selecione o curso relacionado..." />
                </SelectTrigger>
                <SelectContent>
                  {categoria !== 'tutoria' && <SelectItem value="__nenhum__">— Não se aplica —</SelectItem>}
                  {usaSponte ? (
                    <div>
                      <div className="px-2 py-1.5 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">Minhas matrículas</div>
                      {minhas.map((m, i) => (
                        <SelectItem key={m.contrato_id} value={`m:${i}`}>
                          {semTurma(m.curso!)}{m.situacao && !/vigente|ativ|cursando/i.test(m.situacao) ? ` (${m.situacao.toLowerCase()})` : ''}
                        </SelectItem>
                      ))}
                    </div>
                  ) : ['Graduação', 'Pós-Graduação', 'Curso Livre'].map(tipo => {
                    const grupo = cursos.filter((c: any) => c.type === tipo)
                    if (!grupo.length) return null
                    return (
                      <div key={tipo}>
                        <div className="px-2 py-1.5 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{tipo}</div>
                        {grupo.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </div>
                    )
                  })}
                </SelectContent>
              </Select>
              {categoria === 'tutoria' && nivelEscolhido && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Vai para a <b className="text-[var(--text-main)]">Tutoria da {nivelEscolhido === 'pos' ? 'Pós-graduação' : 'Graduação'}</b>.</p>
              )}
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

interface TicketPortalProps {
  alunoId: string
  alunoNome: string
  alunoEmail: string
  appInstalado?: boolean
  onLogout?: () => void
}

// Versão nova publicada? Compara o script principal (nome com hash, muda a cada deploy)
// da página que está rodando com o da página no servidor. Em dev não há hash → nunca "nova".
async function hasNewVersion(): Promise<boolean> {
  try {
    const current = document.querySelector<HTMLScriptElement>('script[type=module][src*="/assets/index-"]')?.src.match(/\/assets\/index-[^/]+\.js/)?.[0]
    if (!current) return false
    const html = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text())
    const latest = html.match(/\/assets\/index-[^"']+\.js/)?.[0]
    return !!latest && latest !== current
  } catch { return false }
}

export function TicketPortal({ alunoId, alunoNome, alunoEmail, appInstalado, onLogout }: TicketPortalProps) {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  // App instalado (principalmente iPhone) não tem "puxar pra atualizar" → botão no cabeçalho
  // Se já saiu versão nova do portal, recarrega o app inteiro; senão só os dados.
  const refreshAll = async () => {
    setRefreshing(true)
    if (await hasNewVersion()) { window.location.reload(); return }
    await qc.invalidateQueries().catch(() => {})
    setTimeout(() => setRefreshing(false), 400)
  }
  // App instalado fica "vivo" em segundo plano: ao voltar pra ele, pega a versão nova sozinho
  useEffect(() => {
    const onVisible = async () => { if (document.visibilityState === 'visible' && await hasNewVersion()) window.location.reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  const [tab, setTab] = useState<'inicio' | 'financeiro' | 'notas' | 'chamados'>('inicio')
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [search, setSearch] = useState('')

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['tickets', 'aluno', alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*, curso:courses(name, type)')
        .eq('aluno_id', alunoId)
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

  const open = tickets.filter(t => !['resolvido', 'fechado'].includes(t.status)).length
  const aguardando = tickets.filter(t => t.status === 'aguardando_aluno').length
  const fechados = tickets.filter(t => ['resolvido', 'fechado'].includes(t.status)).length
  const tabs = [
    { id: 'inicio', label: 'Início', icon: Home },
    { id: 'financeiro', label: 'Financeiro', icon: Wallet },
    { id: 'notas', label: 'Notas', icon: BookOpen },
    { id: 'chamados', label: 'Chamados', icon: TicketIcon, badge: aguardando },
  ] as const

  return (
    <div className="min-h-screen bg-[var(--bg-main)] overflow-x-clip">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-[#2A2D36] bg-[#13161D] px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="https://siteficv.vercel.app/images/test-logo.png"
            alt="FICV"
            className="h-8 sm:h-9 w-auto object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="border-l border-[#2A2D36] pl-3">
            <p className="text-xs font-semibold text-[#F0EDE8]">Portal do Aluno</p>
            <p className="text-xs text-[#8A8A9A] truncate max-w-[45vw] sm:max-w-none">{alunoNome}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-5">
        <button onClick={refreshAll} disabled={refreshing} aria-label="Atualizar"
          className="flex items-center gap-1.5 text-xs text-[#8A8A9A] hover:text-[#F0EDE8] transition-colors">
          <RefreshCw className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Atualizar</span>
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 text-xs text-[#8A8A9A] hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> <span className="hidden sm:inline">Sair</span>
          </button>
        )}
        </div>
      </header>

      {/* Abas — no computador ficam em cima; no celular viram a barra fixa de baixo (estilo app) */}
      <nav className="hidden sm:block border-b border-[#2A2D36] bg-[#13161D] px-6">
        <div className="max-w-3xl mx-auto flex gap-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-[#C9A84C] text-[#F0EDE8] font-semibold' : 'border-transparent text-[#8A8A9A] hover:text-[#F0EDE8]'}`}>
              <t.icon className="w-4 h-4" /> {t.label}
              {'badge' in t && t.badge > 0 && <span className="ml-0.5 text-[10px] bg-purple-500 text-white rounded-full px-1.5">{t.badge}</span>}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'inicio' && !appInstalado && <InstallAppBanner />}

      {tab !== 'chamados' && (
        <div className="p-4 sm:p-6 pb-28 sm:pb-6 max-w-3xl mx-auto">
          {tab === 'inicio' && <AlunoInicio onGo={(t) => { setTab(t); if (t === 'chamados') setShowNew(true) }} />}
          {tab === 'financeiro' && <AlunoFinanceiro />}
          {tab === 'notas' && <AlunoNotas />}
        </div>
      )}

      {tab === 'chamados' && <div className="p-4 sm:p-6 pb-28 sm:pb-6 max-w-3xl mx-auto space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[var(--text-main)]">Meus Chamados</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Abra solicitações e acompanhe o atendimento</p>
          </div>
          <Button onClick={() => setShowNew(true)} className="btn-primary gap-2 hidden sm:inline-flex">
            <Plus className="w-4 h-4" /> Novo Chamado
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Em aberto', value: open, icon: Clock, color: 'text-blue-400' },
            { label: 'Aguardando você', value: aguardando, icon: AlertCircle, color: 'text-purple-400' },
            { label: 'Encerrados', value: fechados, icon: CheckCircle2, color: 'text-green-400' },
          ].map(stat => (
            <div key={stat.label} className="glass-card p-3 sm:p-4 flex flex-col sm:flex-row items-center sm:items-center gap-1 sm:gap-3 text-center sm:text-left">
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
              <div>
                <p className="text-xl font-bold text-[var(--text-main)]">{stat.value}</p>
                <p className="text-[11px] sm:text-xs leading-tight text-[var(--text-muted)]">{stat.label}</p>
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
          <div className="text-center py-16 glass-card">
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
                      {CATEGORIAS.find(c => c.value === t.categoria)?.label}
                      {(t.curso?.name || (t as any).curso_nome) && <> · <span className="text-[var(--primary)]/70">{t.curso?.name ?? (t as any).curso_nome}</span></>}
                      {' · '}{formatDistanceToNow(new Date(t.updated_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] mt-1 shrink-0" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>}

      {/* Celular: botão flutuante de novo chamado + barra de navegação de baixo */}
      {tab === 'chamados' && (
        <button onClick={() => setShowNew(true)} aria-label="Novo chamado"
          className="sm:hidden fixed right-4 z-40 bottom-[calc(5rem+env(safe-area-inset-bottom))] flex items-center gap-2 rounded-full bg-[var(--primary)] pl-4 pr-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/30 active:scale-95 transition-transform">
          <Plus className="w-5 h-5" /> Novo chamado
        </button>
      )}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#2A2D36] bg-[#13161D]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); window.scrollTo({ top: 0 }) }}
              className={`relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] transition-colors ${tab === t.id ? 'text-[#C9A84C] font-semibold' : 'text-[#8A8A9A]'}`}>
              {tab === t.id && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[#C9A84C]" />}
              <span className="relative">
                <t.icon className="w-[22px] h-[22px]" />
                {'badge' in t && t.badge > 0 && <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] text-[10px] leading-[18px] text-center bg-purple-500 text-white rounded-full px-1">{t.badge}</span>}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {showNew && (
        <NewTicketDialog
          alunoId={alunoId}
          alunoNome={alunoNome}
          alunoEmail={alunoEmail}
          onClose={() => setShowNew(false)}
          onCreated={(t) => setSelected(t)}
        />
      )}
      {selected && (
        <TicketDetail
          ticket={selected}
          onClose={() => setSelected(null)}
          alunoId={alunoId}
          alunoNome={alunoNome}
        />
      )}
    </div>
  )
}
