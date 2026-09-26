/**
 * AlunoPainel — abas Início / Financeiro / Notas do Portal do Aluno.
 * Dados ao vivo do Sponte via edge function aluno-portal (só o aluno logado).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { AlertCircle, BookOpen, CalendarDays, CheckCircle2, ChevronsUpDown, Copy, CreditCard, ExternalLink, GraduationCap, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { showError, showSuccess } from '../../utils/toast'

export interface Parcela {
  conta_receber_id: number; numero_parcela: number; vencimento: string | null; valor: number; valor_pago: number | null
  data_pagamento: string | null; situacao: string | null; forma: string | null; categoria: string | null; bolsa: string | null
}
export interface Matricula {
  contrato_id: number; curso: string | null; turma: string | null; turma_id: number | null; situacao: string | null
  data_matricula: string | null; data_inicio: string | null; data_termino: string | null
}
export interface Overview {
  aluno: { nome: string; ra: string | null; email: string | null; celular: string | null; situacao: string | null; turma_atual: string | null; inadimplente: boolean }
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

export function AlunoInicio({ onGo }: { onGo: (tab: 'financeiro' | 'notas' | 'chamados') => void }) {
  const q = useOverview()
  if (!q.data) return <LoadState isLoading={q.isLoading} error={q.error} refetch={q.refetch} />
  const { aluno, matriculas, parcelas } = q.data
  const proxima = parcelas.find((p) => !isPaid(p))
  const atrasadas = parcelas.filter(isLate)
  const vigentes = matriculas.filter((m) => /vigente|ativ|cursando/i.test(m.situacao ?? ''))

  return (
    <div className="space-y-4">
      <Box>
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">Olá,</p>
        <p className="text-xl font-bold text-[var(--text-main)]">{aluno.nome}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-[var(--text-muted)]">
          {aluno.ra && <span>RA <b className="text-[var(--text-main)]">{aluno.ra}</b></span>}
          {aluno.situacao && <span>Situação <b className="text-[var(--text-main)]">{aluno.situacao}</b></span>}
          {aluno.email && <span>{aluno.email}</span>}
        </div>
      </Box>

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
          {(vigentes[0] ?? matriculas[0]) ? (
            <>
              <p className="text-sm font-semibold text-[var(--text-main)] mt-1 leading-snug">{(vigentes[0] ?? matriculas[0]).curso}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{(vigentes[0] ?? matriculas[0]).turma} · {(vigentes[0] ?? matriculas[0]).situacao}</p>
            </>
          ) : <p className="text-sm text-[var(--text-muted)] mt-2">Nenhuma matrícula encontrada.</p>}
          <button onClick={() => onGo('notas')} className="text-xs text-[var(--primary)] hover:underline mt-3">Ver notas →</button>
        </Box>
      </div>

      {matriculas.length > 0 && (
        <Box>
          <p className="text-sm font-semibold text-[var(--text-main)] mb-3 flex items-center gap-2"><BookOpen className="w-4 h-4" /> Matrículas</p>
          <div className="space-y-2">
            {matriculas.map((m) => (
              <div key={m.contrato_id} className="flex items-start justify-between gap-3 border-b border-[var(--border)] last:border-0 pb-2 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text-main)] leading-snug">{m.curso}</p>
                  <p className="text-xs text-[var(--text-muted)]">{m.turma} · matrícula {dt(m.data_matricula)}{m.data_termino ? ` · término ${dt(m.data_termino)}` : ''}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)] shrink-0">{m.situacao}</span>
              </div>
            ))}
          </div>
        </Box>
      )}

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
      <p className="text-xs text-[var(--text-muted)] text-center">Dados do sistema acadêmico (Sponte). Pagou há pouco? Pode levar até 3 dias úteis para aparecer.</p>
    </div>
  )
}

// ── Notas ────────────────────────────────────────────────────

export function AlunoNotas() {
  const q = useOverview()
  const turmas = (q.data?.matriculas ?? []).filter((m) => m.turma_id)
  const [turma, setTurma] = useState<number | null>(null)
  const sel = turma ?? turmas.find((m) => /vigente|ativ|cursando/i.test(m.situacao ?? ''))?.turma_id ?? turmas[0]?.turma_id ?? null
  const b = useQuery<{ disciplinas: { disciplina: string; modulo: number | null; notas: string[]; media: string | null; faltas: string | null; situacao: string | null }[] }>({
    queryKey: ['aluno-boletim', sel],
    queryFn: () => portal({ action: 'boletim', turma_id: sel }),
    enabled: !!sel, staleTime: 5 * 60_000, retry: 1,
  })
  if (!q.data) return <LoadState isLoading={q.isLoading} error={q.error} refetch={q.refetch} />
  if (!turmas.length) return <Box className="text-center py-10 text-sm text-[var(--text-muted)]">Nenhuma turma encontrada.</Box>

  return (
    <div className="space-y-4">
      {/* Curso: cartão com o nome inteiro (quebra linha, não corta); com mais de 1 turma o cartão
          inteiro vira o seletor (select nativo invisível por cima → picker do celular) */}
      {(() => {
        const m = turmas.find((m) => m.turma_id === sel) ?? turmas[0]
        return (
          <div className="relative glass-card px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{turmas.length > 1 ? 'Curso · toque para trocar' : 'Curso'}</p>
              <p className="text-sm font-semibold text-[var(--text-main)] leading-snug">{m.curso}</p>
              {m.turma && m.turma !== m.curso && <p className="text-xs text-[var(--text-muted)]">{m.turma}{m.situacao ? ` · ${m.situacao}` : ''}</p>}
            </div>
            {turmas.length > 1 && (
              <>
                <ChevronsUpDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                <select value={sel ?? ''} onChange={(e) => setTurma(Number(e.target.value))} aria-label="Trocar curso"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base">
                  {turmas.map((t) => <option key={t.contrato_id} value={t.turma_id!}>{t.curso}{t.turma && t.turma !== t.curso ? ` — ${t.turma}` : ''}</option>)}
                </select>
              </>
            )}
          </div>
        )
      })()}
      {!b.data ? <LoadState isLoading={b.isLoading} error={b.error} refetch={b.refetch} /> : (
        <Box>
          {b.data.disciplinas.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nenhuma disciplina lançada ainda.</p> : (
            <div className="divide-y divide-[var(--border)]">
              {b.data.disciplinas.map((d, i) => (
                <div key={i} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-main)] leading-snug">{d.disciplina}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {d.modulo ? `Módulo ${d.modulo}` : ''}{d.notas.length ? ` · notas ${d.notas.join(' · ')}` : ''}{d.faltas ? ` · ${d.faltas} falta(s)` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-[var(--text-main)]">{d.media ?? '—'}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{d.situacao ?? (d.media ? 'média' : 'sem nota')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Box>
      )}
    </div>
  )
}
