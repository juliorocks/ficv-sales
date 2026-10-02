/**
 * NewTicketDialog — a equipe abre um chamado em nome de um aluno específico, ou de uma turma
 * inteira de uma vez (pedido do usuário 02/10). Busca aluno/turma direto no Sponte (não só
 * quem já tem conta no Portal — a function `staff-tickets` cria a conta na hora, se precisar,
 * mesmo fluxo do 1º acesso normal).
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { showError, showSuccess } from '../../utils/toast'
import { Loader2, Search, User, Users, X, Check, AlertCircle } from 'lucide-react'

const CATEGORIAS = [
  { value: 'financeiro', label: '💳 Financeiro' },
  { value: 'academico', label: '📚 Acadêmico' },
  { value: 'secretaria', label: '📋 Secretaria' },
  { value: 'suporte_tecnico', label: '🔧 Suporte Técnico' },
  { value: 'certificado', label: '🎓 Certificado' },
  { value: 'biblioteca', label: '📖 Biblioteca' },
  { value: 'cancelamento', label: '❌ Cancelamento' },
  { value: 'outros', label: '💬 Outros' },
]

type AlunoResult = { aluno_id: number; nome: string; situacao: string | null; turma_atual: string | null }
type TurmaResult = { turma_id: number; nome: string; curso_id: number | null; curso: string | null; vagas_ocupadas: number }
type RosterItem = { aluno_id: number; nome: string; situacao: string | null }
type CreateResult = { aluno_id: number; nome: string; ok: boolean; ticket_id?: number; protocolo?: string; created_account?: boolean; error?: string }

async function callStaffTickets(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('staff-tickets', { body })
  if (error) {
    const ctx = await (error as any).context?.json?.().catch(() => null)
    throw new Error(ctx?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export function NewTicketDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const [tipo, setTipo] = useState<'aluno' | 'turma'>('aluno')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [alunoResults, setAlunoResults] = useState<AlunoResult[]>([])
  const [turmaResults, setTurmaResults] = useState<TurmaResult[]>([])
  const [alunoSel, setAlunoSel] = useState<AlunoResult | null>(null)
  const [turmaSel, setTurmaSel] = useState<TurmaResult | null>(null)
  const [roster, setRoster] = useState<RosterItem[] | null>(null)
  const [loadingRoster, setLoadingRoster] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<CreateResult[] | null>(null)

  const trocarTipo = (t: 'aluno' | 'turma') => {
    setTipo(t); setQuery(''); setAlunoSel(null); setTurmaSel(null); setRoster(null)
    setAlunoResults([]); setTurmaResults([])
  }

  // Busca (com debounce) — só roda enquanto nada foi escolhido ainda
  useEffect(() => {
    if (alunoSel || turmaSel) return
    const q = query.trim()
    if (q.length < 3) { setAlunoResults([]); setTurmaResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const data = await callStaffTickets({ action: tipo === 'aluno' ? 'search_aluno' : 'search_turma', q })
        if (tipo === 'aluno') setAlunoResults(data.results ?? [])
        else setTurmaResults(data.results ?? [])
      } catch (e: any) {
        showError(e?.message ?? 'Erro ao buscar no Sponte.')
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query, tipo, alunoSel, turmaSel])

  // Lista de matriculados ao escolher a turma
  useEffect(() => {
    if (!turmaSel) { setRoster(null); return }
    setLoadingRoster(true)
    callStaffTickets({ action: 'turma_roster', turma_id: turmaSel.turma_id })
      .then((d) => setRoster(d.roster ?? []))
      .catch((e) => showError(e?.message ?? 'Erro ao buscar matriculados.'))
      .finally(() => setLoadingRoster(false))
  }, [turmaSel])

  const podeSubmeter = !!titulo.trim() && !!descricao.trim() && !!categoria
    && (tipo === 'aluno' ? !!alunoSel : (!!turmaSel && !!roster?.length))

  const submit = async () => {
    if (!podeSubmeter) { showError('Preencha o assunto, o título, a mensagem e escolha o(s) aluno(s).'); return }
    setSaving(true)
    try {
      const targets = tipo === 'aluno'
        ? [{ aluno_id: alunoSel!.aluno_id, nome: alunoSel!.nome }]
        : (roster ?? []).map((r) => ({ aluno_id: r.aluno_id, nome: r.nome }))
      const data = await callStaffTickets({
        action: 'create', targets, categoria, titulo: titulo.trim(), descricao: descricao.trim(),
        curso_nome: tipo === 'turma' ? turmaSel!.curso : null,
      })
      setResults(data.results ?? [])
      showSuccess(`${data.created} chamado(s) aberto(s)${data.failed ? `, ${data.failed} falharam` : ''}.`)
      onCreated?.()
    } catch (e: any) {
      showError(e?.message ?? 'Erro ao abrir chamado(s).')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-[var(--bg-card)] border-[var(--border)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-main)]">
            {results ? 'Resultado' : 'Abrir chamado'}
          </DialogTitle>
        </DialogHeader>

        {results ? (
          <div className="space-y-3">
            <div className="max-h-80 overflow-y-auto space-y-1.5 border border-[var(--border)] rounded-lg p-2">
              {results.map((r) => (
                <div key={r.aluno_id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg bg-[var(--bg-main)]">
                  {r.ok ? <Check className="w-4 h-4 text-green-500 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--text-main)] truncate">{r.nome}</p>
                    {r.ok
                      ? <p className="text-xs text-[var(--text-muted)]">{r.protocolo}{r.created_account ? ' · conta criada agora' : ''}</p>
                      : <p className="text-xs text-red-400">{r.error}</p>}
                  </div>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={onClose}>Fechar</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pra quem */}
            <div className="flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--bg-main)]">
              {(['aluno', 'turma'] as const).map((t) => (
                <button key={t} onClick={() => trocarTipo(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${tipo === t ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                  {t === 'aluno' ? <User className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                  {t === 'aluno' ? 'Aluno específico' : 'Turma inteira'}
                </button>
              ))}
            </div>

            {/* Busca / seleção */}
            {tipo === 'aluno' ? (
              alunoSel ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border)]">
                  <User className="w-4 h-4 text-[var(--primary)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-main)] truncate">{alunoSel.nome}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{alunoSel.turma_atual ?? alunoSel.situacao ?? ''}</p>
                  </div>
                  <button onClick={() => setAlunoSel(null)} className="text-[var(--text-muted)] hover:text-red-400 shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome do aluno (direto no Sponte)…" className="pl-9" />
                  {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
                  {alunoResults.length > 0 && (
                    <div className="mt-1.5 max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                      {alunoResults.map((a) => (
                        <button key={a.aluno_id} onClick={() => { setAlunoSel(a); setAlunoResults([]) }}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--bg-card-hover)] transition-colors">
                          <p className="text-sm text-[var(--text-main)]">{a.nome}</p>
                          <p className="text-xs text-[var(--text-muted)]">{a.turma_atual ?? a.situacao ?? ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {!searching && query.trim().length >= 3 && alunoResults.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)] mt-1.5">Nenhum aluno encontrado com esse nome.</p>
                  )}
                </div>
              )
            ) : (
              turmaSel ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border)]">
                    <Users className="w-4 h-4 text-[var(--primary)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--text-main)] truncate">{turmaSel.nome}</p>
                      <p className="text-xs text-[var(--text-muted)] truncate">{turmaSel.curso}</p>
                    </div>
                    <button onClick={() => setTurmaSel(null)} className="text-[var(--text-muted)] hover:text-red-400 shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                  {loadingRoster ? (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] px-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando matriculados…</div>
                  ) : roster && (
                    <p className="text-xs text-[var(--text-muted)] px-1">
                      {roster.length} aluno{roster.length === 1 ? '' : 's'} vai{roster.length === 1 ? '' : 'ão'} receber este chamado.
                      {roster.length === 0 && ' Essa turma não tem matrícula ativa.'}
                    </p>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome da turma (ex.: Teologia EAD 2026.1)…" className="pl-9" />
                  {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
                  {turmaResults.length > 0 && (
                    <div className="mt-1.5 max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                      {turmaResults.map((t) => (
                        <button key={t.turma_id} onClick={() => { setTurmaSel(t); setTurmaResults([]) }}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--bg-card-hover)] transition-colors">
                          <p className="text-sm text-[var(--text-main)]">{t.nome}</p>
                          <p className="text-xs text-[var(--text-muted)]">{t.curso} · {t.vagas_ocupadas} matriculados</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {!searching && query.trim().length >= 3 && turmaResults.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)] mt-1.5">Nenhuma turma aberta encontrada com esse nome.</p>
                  )}
                </div>
              )
            )}

            {/* Assunto / título / mensagem */}
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue placeholder="Assunto do chamado" /></SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título do chamado" maxLength={120} />
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Mensagem inicial — o que o aluno vai ler primeiro" rows={4} />

            <Button className="w-full" disabled={!podeSubmeter || saving} onClick={submit}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : tipo === 'turma' && roster ? `Abrir ${roster.length} chamado(s)` : 'Abrir chamado'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
