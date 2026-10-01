/**
 * AlunoPainel — abas Início / Financeiro / Notas do Portal do Aluno.
 * Dados ao vivo do Sponte via edge function aluno-portal (só o aluno logado).
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { AlertCircle, BookOpen, CalendarDays, CheckCircle2, ChevronRight, ChevronsUpDown, Copy, CreditCard, ExternalLink, FileText, GraduationCap, Loader2, Printer, RefreshCw, Wallet } from 'lucide-react'
import { showError, showSuccess } from '../../utils/toast'

export interface Parcela {
  conta_receber_id: number; numero_parcela: number; vencimento: string | null; valor: number; valor_pago: number | null
  data_pagamento: string | null; situacao: string | null; forma: string | null; categoria: string | null; bolsa: string | null
}
export interface Matricula {
  contrato_id: number; curso: string | null; curso_base?: string | null; turma: string | null; turma_id: number | null; situacao: string | null
  data_matricula: string | null; data_inicio: string | null; data_termino: string | null
}
export interface Overview {
  aluno: {
    nome: string; ra: string | null; email: string | null; celular: string | null; situacao: string | null; turma_atual: string | null; inadimplente: boolean
    // Declaração de Matrícula (01/10)
    data_nascimento: string | null; cpf: string | null
  }
  matriculas: Matricula[]
  parcelas: Parcela[]
}

async function portal<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('aluno-portal', { body })
  if (error) {
    const ctx = await (error as any).context?.json?.().catch(() => null)
    throw new Error(ctx?.error ?? 'Não foi possível carregar agora.')
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

export function useOverview() {
  return useQuery<Overview>({ queryKey: ['aluno-overview'], queryFn: () => portal<Overview>({ action: 'overview' }), staleTime: 5 * 60_000, retry: 1 })
}

// ── Cursos: reúne as matrículas de um mesmo curso (períodos P1, P2… / turmas) — Início e Notas usam igual ──

const VIGENTE = /vigente|ativ|cursando/i
const rankSituacao = (s: string | null) => (VIGENTE.test(s ?? '') ? 0 : /encerr|conclu/i.test(s ?? '') ? 1 : 2)

// "Teologia Ead - 2025.1 - P2" → "P2 · 2025.1" (o nome do curso já aparece em cima)
function periodoLabel(turma: string | null) {
  const m = turma?.match(/(\d{4}\.\d)\s*-\s*(.+)$/)
  return m ? `${m[2]} · ${m[1]}` : turma ?? 'Turma'
}
// cronológico: semestre (2025.1) e depois P1, P2… ; sem semestre no nome vai pro começo
function periodoKey(turma: string | null) {
  const sem = turma?.match(/(\d{4})\.(\d)/), p = turma?.match(/\bP(\d+)\b/i)
  return sem ? Number(sem[1]) * 100 + Number(sem[2]) * 10 + (p ? Number(p[1]) / 10 : 0) : 0
}

/** Período escolhido no Início: a aba Notas abre nesse curso e rola até o período. */
export interface NotasFoco { curso: string; turma_id: number | null }

interface CursoAgrupado { nome: string; turmas: Matricula[]; vigente: boolean; ultima: string }
// curso_base vem do servidor (o Sponte cria um "curso" por ciclo de entrada); cursos vigentes primeiro,
// períodos do mais recente pro mais antigo, e a mesma turma em 2 contratos vira 1 período só (fica a situação melhor)
function agruparCursos(ms: Matricula[]): CursoAgrupado[] {
  const por = new Map<string, CursoAgrupado>()
  for (const m of ms) {
    const nome = m.curso_base ?? m.curso ?? 'Curso'
    const c = por.get(nome) ?? { nome, turmas: [], vigente: false, ultima: '' }
    const i = m.turma_id ? c.turmas.findIndex((t) => t.turma_id === m.turma_id) : -1
    if (i < 0) c.turmas.push(m)
    else if (rankSituacao(m.situacao) < rankSituacao(c.turmas[i].situacao)) c.turmas[i] = m
    c.vigente ||= VIGENTE.test(m.situacao ?? '')
    c.ultima = [c.ultima, m.data_matricula ?? ''].sort().pop()!
    por.set(nome, c)
  }
  return [...por.values()]
    .map((c) => ({ ...c, turmas: c.turmas.sort((x, y) => periodoKey(y.turma) - periodoKey(x.turma) || String(y.data_matricula).localeCompare(String(x.data_matricula))) }))
    .sort((x, y) => Number(y.vigente) - Number(x.vigente) || y.ultima.localeCompare(x.ultima))
}

/** Foto do aluno no Sponte (só ~7% têm); cache longo — a foto quase não muda e vem pesada (base64). */
function useFoto() {
  return useQuery<string | null>({
    queryKey: ['aluno-foto'],
    queryFn: async () => (await portal<{ foto: string | null }>({ action: 'foto' })).foto,
    staleTime: 30 * 60_000, retry: 0,
  })
}

/** Foto redonda; sem foto (ou se ela falhar ao carregar), as iniciais do nome. */
function Avatar({ nome, src, size = 56, light = false }: { nome: string; src?: string | null; size?: number; light?: boolean }) {
  const [falhou, setFalhou] = useState(false)
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const iniciais = ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
  const box = { width: size, height: size }
  return src && !falhou
    ? <img src={src} alt={nome} style={box} onError={() => setFalhou(true)} className={`rounded-full object-cover object-top shrink-0 border ${light ? 'border-[#13161D]/15' : 'border-[var(--border)]'}`} />
    : <div style={{ ...box, fontSize: size * 0.36 }} aria-label={nome} className={`rounded-full font-bold flex items-center justify-center shrink-0 select-none ${light ? 'bg-white/50 text-[#13161D]' : 'bg-[var(--primary)]/10 text-[var(--primary)]'}`}>{iniciais || '?'}</div>
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—')
const today = new Date().toISOString().slice(0, 10)
const isPaid = (p: Parcela) => /quit|pag|baix/i.test(p.situacao ?? '') || !!p.data_pagamento
const isLate = (p: Parcela) => !isPaid(p) && !!p.vencimento && p.vencimento < today

function Box({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass-card p-4 ${className}`}>{children}</div>
}

function LoadState({ isLoading, error, refetch }: { isLoading: boolean; error: unknown; refetch: () => void }) {
  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
  return (
    <Box className="text-center py-10 space-y-3">
      <AlertCircle className="w-8 h-8 mx-auto text-amber-400" />
      <p className="text-sm text-[var(--text-main)]">{(error as Error)?.message}</p>
      <button onClick={refetch} className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline"><RefreshCw className="w-3.5 h-3.5" /> Tentar de novo</button>
    </Box>
  )
}

// ── Início ───────────────────────────────────────────────────

export function AlunoInicio({ onGo, onDeclaracao }: { onGo: (tab: 'financeiro' | 'notas' | 'chamados', foco?: NotasFoco) => void; onDeclaracao: () => void }) {
  const q = useOverview()
  const foto = useFoto()
  if (!q.data) return <LoadState isLoading={q.isLoading} error={q.error} refetch={q.refetch} />
  const { aluno, matriculas, parcelas } = q.data
  const proxima = parcelas.find((p) => !isPaid(p))
  const atrasadas = parcelas.filter(isLate)
  const cursos = agruparCursos(matriculas)
  const meuCurso = cursos[0] // vigentes primeiro
  const emAndamento = meuCurso?.turmas.filter((t) => VIGENTE.test(t.situacao ?? '')) ?? []
  const atual = emAndamento[0] ?? meuCurso?.turmas[0] // sem vigente: o período mais recente (turmas já vêm do mais novo pro mais velho)

  return (
    <div className="space-y-4">
      <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 py-5 sm:py-6 rounded-b-2xl shadow-lg shadow-black/10 bg-gradient-to-br from-[#E2C878] to-[#C9A84C] flex items-center gap-4">
        <Avatar nome={aluno.nome} src={foto.data} size={64} light />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-[#13161D]/60">Olá,</p>
          <p className="text-xl font-bold text-[#13161D] leading-tight">{aluno.nome}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2 text-xs text-[#13161D]/60">
            {aluno.ra && <span>RA <b className="text-[#13161D]">{aluno.ra}</b></span>}
            {aluno.situacao && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${/^ativ/i.test(aluno.situacao.trim()) ? 'bg-emerald-700/15 text-emerald-900' : 'bg-red-700/15 text-red-900'}`}>
                {aluno.situacao}
              </span>
            )}
            {aluno.email && <span className="break-all">{aluno.email}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Box>
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Próxima parcela</p>
          {proxima ? (
            <>
              <p className="text-2xl font-bold text-[var(--text-main)] mt-1">{brl(proxima.valor)}</p>
              <p className={`text-xs mt-0.5 ${isLate(proxima) ? 'text-red-400 font-semibold' : 'text-[var(--text-muted)]'}`}>
                {isLate(proxima) ? 'Venceu em ' : 'Vence em '}{dt(proxima.vencimento)}
              </p>
            </>
          ) : <p className="text-sm text-green-400 mt-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Nada em aberto</p>}
          {atrasadas.length > 0 && <p className="text-xs text-red-400 mt-2">{atrasadas.length} parcela(s) em atraso</p>}
          <button onClick={() => onGo('financeiro')} className="text-xs text-[var(--primary)] hover:underline mt-3">Ver financeiro →</button>
        </Box>
        <Box>
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> Meu curso</p>
          {meuCurso ? (
            <>
              <p className="text-sm font-semibold text-[var(--text-main)] mt-1 leading-snug">{meuCurso.nome}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {emAndamento.length > 1 ? `${emAndamento.length} períodos em andamento` : `${periodoLabel(atual!.turma)} · ${atual!.situacao}`}
              </p>
            </>
          ) : <p className="text-sm text-[var(--text-muted)] mt-2">Nenhuma matrícula encontrada.</p>}
          <button onClick={() => onGo('notas')} className="text-xs text-[var(--primary)] hover:underline mt-3">Ver notas →</button>
        </Box>
      </div>

      {cursos.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2 px-1"><BookOpen className="w-4 h-4" /> Matrículas</p>
          {/* um bloco por curso, fechado; toque abre os períodos */}
          {cursos.map((c) => {
            const melhor = [...c.turmas].sort((x, y) => rankSituacao(x.situacao) - rankSituacao(y.situacao))[0].situacao
            return (
              <details key={c.nome} className="glass-card group">
                <summary className="list-none cursor-pointer px-4 py-3 flex items-center gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-main)] leading-snug">{c.nome}</p>
                    <p className="text-xs text-[var(--text-muted)]">{c.turmas.length} {c.turmas.length === 1 ? 'período' : 'períodos'}</p>
                  </div>
                  {melhor && <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${VIGENTE.test(melhor) ? 'border-emerald-500/40 text-emerald-500' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>{melhor}</span>}
                  <ChevronsUpDown className="w-4 h-4 text-[var(--text-muted)] shrink-0 group-open:rotate-90 transition-transform" />
                </summary>
                <div className="px-4 py-3 space-y-3 border-t border-[var(--border)]">
                  {c.turmas.map((m) => {
                    const chip = <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${VIGENTE.test(m.situacao ?? '') ? 'border-emerald-500/40 text-emerald-500' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>{m.situacao}</span>
                    const info = (
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text-main)] leading-snug">{periodoLabel(m.turma)}</p>
                        <p className="text-xs text-[var(--text-muted)]">matrícula {dt(m.data_matricula)}{m.data_termino ? ` · término ${dt(m.data_termino)}` : ''}</p>
                      </div>
                    )
                    // tocar no período abre as Notas dele (sem turma no Sponte não há boletim → fica só informativo)
                    return m.turma_id ? (
                      <button key={m.contrato_id} onClick={() => onGo('notas', { curso: c.nome, turma_id: m.turma_id })} aria-label={`Ver notas de ${periodoLabel(m.turma)}`}
                        className="w-full text-left flex items-center justify-between gap-2 rounded-lg -mx-2 px-2 py-1.5 hover:bg-[var(--border)]/40 active:bg-[var(--border)]/60 transition-colors">
                        {info}
                        <span className="flex items-center gap-1 shrink-0">{chip}<ChevronRight className="w-4 h-4 text-[var(--text-muted)]" /></span>
                      </button>
                    ) : (
                      <div key={m.contrato_id} className="flex items-start justify-between gap-3">{info}{chip}</div>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      )}

      <Box className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <p className="text-sm text-[var(--text-main)]">Declaração de Matrícula</p>
        </div>
        <button onClick={onDeclaracao} className="text-xs text-[var(--primary)] hover:underline shrink-0">Gerar →</button>
      </Box>

      <Box className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-main)]">Precisa de ajuda com algo?</p>
        <button onClick={() => onGo('chamados')} className="btn-primary text-sm px-4 py-2 rounded-lg">Abrir chamado</button>
      </Box>
    </div>
  )
}

// ── Financeiro ───────────────────────────────────────────────

export function AlunoFinanceiro() {
  const q = useOverview()
  const [busy, setBusy] = useState<string | null>(null)
  const [pay, setPay] = useState<Record<string, { link?: string; linha?: string; msg?: string }>>({})
  if (!q.data) return <LoadState isLoading={q.isLoading} error={q.error} refetch={q.refetch} />
  const { parcelas } = q.data
  const abertas = parcelas.filter((p) => !isPaid(p))
  const pagas = parcelas.filter(isPaid).reverse()

  const pagar = async (p: Parcela) => {
    const k = `${p.conta_receber_id}-${p.numero_parcela}`
    setBusy(k)
    try {
      const r = await portal<{ link?: string; linha_digitavel?: string; indisponivel?: boolean; motivo?: string }>({
        action: 'pagamento', conta_receber_id: p.conta_receber_id, numero_parcela: p.numero_parcela,
      })
      if (r.link) { window.open(r.link, '_blank', 'noopener'); setPay((s) => ({ ...s, [k]: { link: r.link } })) }
      else if (r.linha_digitavel) setPay((s) => ({ ...s, [k]: { linha: r.linha_digitavel } }))
      else setPay((s) => ({ ...s, [k]: { msg: r.motivo ?? 'Pagamento online ainda não disponível.' } }))
    } catch (e) { showError((e as Error).message) }
    setBusy(null)
  }

  const Row = ({ p }: { p: Parcela }) => {
    const k = `${p.conta_receber_id}-${p.numero_parcela}`
    const st = pay[k]
    const paid = isPaid(p), late = isLate(p)
    return (
      <div className="py-3 border-b border-[var(--border)] last:border-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-[var(--text-main)]">
              {p.categoria ?? 'Parcela'} <span className="text-[var(--text-muted)]">· parcela {p.numero_parcela}</span>
            </p>
            <p className={`text-xs ${late ? 'text-red-400 font-semibold' : 'text-[var(--text-muted)]'}`}>
              {paid ? `Pago em ${dt(p.data_pagamento)}` : `${late ? 'Venceu' : 'Vence'} em ${dt(p.vencimento)}`}
              {p.forma ? ` · ${p.forma}` : ''}{p.bolsa ? ` · bolsa ${p.bolsa}` : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-[var(--text-main)]">{brl(paid && p.valor_pago ? p.valor_pago : p.valor)}</p>
            {paid
              ? <span className="text-[11px] text-green-400">Pago</span>
              : <button onClick={() => pagar(p)} disabled={busy === k}
                  className="text-[11px] text-[var(--primary)] hover:underline inline-flex items-center gap-1">
                  {busy === k ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />} Pagar
                </button>}
          </div>
        </div>
        {st?.link && <a href={st.link} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] inline-flex items-center gap-1 mt-1">Abrir página de pagamento <ExternalLink className="w-3 h-3" /></a>}
        {st?.linha && (
          <button onClick={() => navigator.clipboard.writeText(st.linha!).then(() => showSuccess('Linha digitável copiada.'))}
            className="mt-1 text-xs font-mono text-[var(--text-main)] bg-[var(--bg-main)] rounded px-2 py-1 inline-flex items-center gap-1.5 break-all text-left">
            <Copy className="w-3 h-3 shrink-0" /> {st.linha}
          </button>
        )}
        {st?.msg && <p className="text-xs text-amber-400 mt-1">{st.msg} Se precisar, abra um chamado no Financeiro.</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Box><p className="text-xs text-[var(--text-muted)]">Em aberto</p><p className="text-xl font-bold text-[var(--text-main)]">{brl(abertas.reduce((s, p) => s + p.valor, 0))}</p><p className="text-xs text-[var(--text-muted)]">{abertas.length} parcela(s)</p></Box>
        <Box><p className="text-xs text-[var(--text-muted)]">Em atraso</p><p className={`text-xl font-bold ${parcelas.some(isLate) ? 'text-red-400' : 'text-green-400'}`}>{brl(parcelas.filter(isLate).reduce((s, p) => s + p.valor, 0))}</p><p className="text-xs text-[var(--text-muted)]">{parcelas.filter(isLate).length} parcela(s)</p></Box>
      </div>
      <Box>
        <p className="text-sm font-semibold text-[var(--text-main)] mb-1 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> A pagar</p>
        {abertas.length ? abertas.map((p) => <Row key={`${p.conta_receber_id}-${p.numero_parcela}`} p={p} />) : <p className="text-sm text-green-400 py-3">Nenhuma parcela em aberto. 🎉</p>}
      </Box>
      {pagas.length > 0 && (
        <Box>
          <p className="text-sm font-semibold text-[var(--text-main)] mb-1">Pagas</p>
          {pagas.map((p) => <Row key={`${p.conta_receber_id}-${p.numero_parcela}`} p={p} />)}
        </Box>
      )}
      <p className="text-xs text-[var(--text-muted)] text-center">Parcelas com vencimento a partir de 01/02/2026, do sistema acadêmico (Sponte). Pagou há pouco? Pode levar até 3 dias úteis para aparecer.</p>
    </div>
  )
}

// ── Notas ────────────────────────────────────────────────────

type Avaliacao = { nome: string; nota: string }
type Disciplina = {
  disciplina: string; modulo: number | null; notas: string[]; media: string | null; faltas: string | null; situacao: string | null
  // 01/10: AV1/AV2 nomeados (só turma presencial lança assim no Sponte; achado ao vivo
  // comparando print do Sponte com o do Moodle) e Exame Final (só quando a disciplina tem
  // exame e a nota já foi lançada) — ver alunoSponte.ts
  avaliacoes: Avaliacao[] | null; exame_final: string | null
}

// Aprovado em verde, reprovado em vermelho, em recuperação/cursando em âmbar — pedido do usuário
// 29/09. Reprovado primeiro na checagem: "reprovado por falta" também bate em /aprovado/ se fosse
// checado depois (contém "provado").
const situacaoCor = (s: string | null) =>
  s && /reprovad/i.test(s) ? 'text-red-500 dark:text-red-400'
    : s && /aprovad/i.test(s) ? 'text-green-600 dark:text-green-400'
    : s && /recupera|cursando/i.test(s) ? 'text-amber-600 dark:text-amber-400'
    : 'text-[var(--text-main)]'

export function AlunoNotas({ foco }: { foco?: NotasFoco | null }) {
  const q = useOverview()
  // um curso (ex.: Bacharelado em Teologia - EAD) reúne todos os períodos/turmas em que o aluno esteve
  const cursos = useMemo(() => agruparCursos((q.data?.matriculas ?? []).filter((m) => m.turma_id)), [q.data])
  const [escolhido, setEscolhido] = useState<string | null>(foco?.curso ?? null)
  const curso = cursos.find((c) => c.nome === escolhido) ?? cursos[0] ?? null
  const ids = curso?.turmas.map((t) => t.turma_id!) ?? []
  const b = useQuery<{ turmas: { turma_id: number; disciplinas: Disciplina[] }[] }>({
    queryKey: ['aluno-boletim', ids.join(',')],
    queryFn: () => portal({ action: 'boletim', turma_ids: ids }),
    enabled: ids.length > 0, staleTime: 5 * 60_000, retry: 1,
  })
  // veio do Início tocando num período: rola até ele quando o boletim carregar (uma vez)
  const [rolou, setRolou] = useState(false)
  useEffect(() => {
    if (!foco?.turma_id || rolou || !b.data) return
    setRolou(true)
    requestAnimationFrame(() => document.getElementById(`periodo-${foco.turma_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [foco, rolou, b.data])
  if (!q.data) return <LoadState isLoading={q.isLoading} error={q.error} refetch={q.refetch} />
  if (!curso) return <Box className="text-center py-10 text-sm text-[var(--text-muted)]">Nenhuma turma encontrada.</Box>

  // só períodos com disciplina lançada viram seção; os vazios (cancelados etc.) entram na contagem no rodapé
  const secoes = curso.turmas
    .map((t) => ({ t, disciplinas: b.data?.turmas.find((x) => x.turma_id === t.turma_id)?.disciplinas ?? [] }))
    .filter((x) => x.disciplinas.length > 0 || x.t.turma_id === foco?.turma_id) // o período tocado no Início aparece mesmo vazio
  return (
    <div className="space-y-4">
      {/* Curso: cartão com o nome inteiro (quebra linha, não corta); com mais de 1 curso o cartão
          inteiro vira o seletor (select nativo invisível por cima → picker do celular) */}
      <div className="relative glass-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{cursos.length > 1 ? 'Curso · toque para trocar' : 'Curso'}</p>
          <p className="text-sm font-semibold text-[var(--text-main)] leading-snug">{curso.nome}</p>
          <p className="text-xs text-[var(--text-muted)]">{curso.turmas.length} {curso.turmas.length === 1 ? 'período' : 'períodos'}{curso.vigente ? ' · Cursando' : ''}</p>
        </div>
        {cursos.length > 1 && (
          <>
            <ChevronsUpDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
            <select value={curso.nome} onChange={(e) => setEscolhido(e.target.value)} aria-label="Trocar curso"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base">
              {cursos.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
            </select>
          </>
        )}
      </div>
      {!b.data ? <LoadState isLoading={b.isLoading} error={b.error} refetch={b.refetch} /> : secoes.length === 0 ? (
        <Box><p className="text-sm text-[var(--text-muted)]">Nenhuma disciplina lançada ainda.</p></Box>
      ) : (
        <>
          {secoes.map(({ t, disciplinas }) => (
            <details key={t.turma_id} id={`periodo-${t.turma_id}`} open className={`glass-card group scroll-mt-20 ${foco?.turma_id === t.turma_id ? 'ring-2 ring-[var(--primary)]/40' : ''}`}>
              <summary className="list-none cursor-pointer px-4 py-3 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                <p className="text-sm font-semibold text-[var(--text-main)] flex-1 min-w-0 truncate">{periodoLabel(t.turma)}</p>
                {t.situacao && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${VIGENTE.test(t.situacao) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-[var(--border)] text-[var(--text-muted)]'}`}>{t.situacao}</span>
                )}
                <ChevronsUpDown className="w-4 h-4 text-[var(--text-muted)] shrink-0 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="px-4 pb-1 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {disciplinas.length === 0 && <p className="py-3 text-sm text-[var(--text-muted)]">Nenhuma disciplina lançada neste período.</p>}
                {disciplinas.map((d, i) => {
                  // Módulo/Exame Final/faltas seguem numa linha só (são informação avulsa);
                  // AV1/AV2/Fase 1... (só presencial e EAD lançam assim — ver avaliacoes em
                  // alunoSponte.ts/alunoMoodle.ts) ganham cada um a PRÓPRIA linha (pedido do
                  // usuário 01/10: "deixar melhor diagramado" — antes vinha tudo espremido
                  // numa linha só, separado por "·", difícil de ler com mais de 2 itens)
                  const meta = [
                    d.modulo ? `Módulo ${d.modulo}` : null,
                    !d.avaliacoes?.length && d.notas.length > 1 ? `notas ${d.notas.join(' · ')}` : null,
                    d.exame_final ? `Exame Final ${d.exame_final}` : null,
                    d.faltas ? `${d.faltas} falta(s)` : null,
                  ].filter(Boolean).join(' · ')
                  return (
                  <div key={i} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--text-main)] leading-snug">{d.disciplina}</p>
                      {meta && <p className="text-xs text-[var(--text-muted)] mt-0.5">{meta}</p>}
                      {!!d.avaliacoes?.length && (
                        <div className="mt-1 space-y-0.5 max-w-[240px]">
                          {d.avaliacoes.map((a, j) => (
                            <p key={j} className="text-xs text-[var(--text-muted)] flex items-baseline justify-between gap-3">
                              <span className="truncate">{a.nome}</span>
                              <span className="shrink-0 font-medium text-[var(--text-main)]">{a.nota}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-lg font-bold ${situacaoCor(d.situacao)}`}>{d.media ?? '—'}</p>
                      <p className={`text-[11px] ${d.situacao ? situacaoCor(d.situacao) : 'text-[var(--text-muted)]'}`}>{d.situacao ?? (d.media ? 'média' : 'sem nota')}</p>
                    </div>
                  </div>
                  )
                })}
              </div>
            </details>
          ))}
          {curso.turmas.length > secoes.length && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              {curso.turmas.length - secoes.length} {curso.turmas.length - secoes.length === 1 ? 'período sem disciplinas lançadas' : 'períodos sem disciplinas lançadas'} no sistema acadêmico.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Declaração de Matrícula ─────────────────────────────────
// Pedido do usuário 01/10: "dá pra fazer isso direto pelo Sponte?" — não: a API do Sponte
// (WSAPIEdu, as 138 funções do WSDL) não tem um "gerar declaração", só GetContratoPDFBase64
// (o contrato, documento diferente) e GetCertificadoValido (só VALIDA um certificado que já
// existe). O documento aqui é montado por nós, com os dados reais do aluno (Sponte) — mesmo
// texto/layout que a secretaria já emite hoje pelo sistema deles (modelo que o usuário mandou).

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const dataPorExtenso = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
// aluno.data_nascimento vem "AAAA-MM-DD" (brDate do Sponte) → "DD/MM/AAAA" pro texto da declaração
const dataBr = (iso: string | null) => {
  const [y, m, d] = (iso ?? '').split('-')
  return d && m && y ? `${d}/${m}/${y}` : null
}
// "Teologia Ead - 2026.2 - P4" / "Modular - 2026.2" → "2026.2" (mesmo padrão de periodoKey acima)
const semestreDaTurma = (turma: string | null) => turma?.match(/\b(20\d{2}\.\d)\b/)?.[1] ?? null

export function AlunoDeclaracao({ onVoltar }: { onVoltar: () => void }) {
  const q = useOverview()
  if (!q.data) return <div className="p-4 sm:p-6 max-w-2xl mx-auto"><LoadState isLoading={q.isLoading} error={q.error} refetch={q.refetch} /></div>
  const { aluno, matriculas } = q.data
  const vig = matriculas.find((m) => VIGENTE.test(m.situacao ?? '')) ?? matriculas[0] ?? null
  const semestre = semestreDaTurma(vig?.turma ?? null)
  const nascimento = dataBr(aluno.data_nascimento)

  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      {/* barra de ação — some ao imprimir (@media print), só o documento sai na folha */}
      <div className="print:hidden sticky top-0 z-10 bg-[var(--bg-main)]/95 backdrop-blur border-b border-[var(--border)] px-4 py-3 flex items-center justify-between">
        <button onClick={onVoltar} className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">
          <ChevronRight className="w-4 h-4 rotate-180" /> Voltar
        </button>
        <button onClick={() => window.print()} className="btn-primary text-sm px-4 py-2 rounded-lg flex items-center gap-2">
          <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
        </button>
      </div>

      {!vig && (
        <p className="print:hidden max-w-2xl mx-auto mt-4 px-4 text-sm text-red-500">
          Nenhuma matrícula encontrada no sistema acadêmico — a declaração pode sair incompleta. Procure a secretaria se precisar dela com urgência.
        </p>
      )}

      {/* o documento: fundo branco/texto preto FIXO (é uma folha pra imprimir, não segue o tema escuro do portal) */}
      <div className="max-w-2xl mx-auto bg-white text-black p-8 sm:p-12 my-4 sm:my-8 rounded-xl shadow-sm print:shadow-none print:rounded-none print:max-w-none print:m-0 print:p-10">
        <div className="flex justify-center mb-6">
          <img src="https://siteficv.vercel.app/images/test-logo.png" alt="FICV" className="h-20 w-auto object-contain" />
        </div>
        <div className="text-center space-y-0.5 mb-8">
          <p className="font-bold text-sm">FACULDADE INTERNACIONAL CIDADE VIVA</p>
          <p className="font-bold text-sm">Credenciada pelo MEC - Portaria nº 35 de 19/01/2018</p>
          <p className="font-bold text-sm">CNPJ: 09.491.298/0003-16</p>
        </div>
        <p className="text-center font-bold text-base mb-10">DECLARAÇÃO DE MATRÍCULA</p>
        <p className="text-center font-bold text-sm leading-relaxed mb-10 px-2">
          Declaramos para os devidos fins que, o(a) aluno(a) {aluno.nome}, matrícula nº {aluno.ra ?? '—'}
          {nascimento ? `, nascido(a) em ${nascimento}` : ''}
          {aluno.cpf ? `, portador(a) do documento de número ${aluno.cpf}` : ''}
          , encontra-se regularmente matriculado(a) no curso:{' '}
          {vig?.curso ?? '—'}, nesta Instituição de Ensino Superior{semestre ? `, no semestre letivo de ${semestre}` : ''}.
        </p>
        <p className="text-center font-bold text-sm mb-20">João Pessoa/PB, {dataPorExtenso(new Date())}.</p>

        {/* assinatura da Secretaria Acadêmica — TODO: imagem (ver pedido ao usuário) */}
        <div className="flex flex-col items-center h-24" />

        <div className="text-center text-xs mt-8 space-y-0.5">
          <p>Rua Luzia Simões Bertoline, nº 50, Aeroclube</p>
          <p>João Pessoa/PB - CEP: 58.036.630</p>
          <p className="underline">83 3041-7471</p>
          <p className="underline">ficv.edu.br</p>
          <p className="underline">faculdade@cidadeviva.org</p>
        </div>
      </div>
    </div>
  )
}
