/**
 * Acadêmico (menu "Acadêmico", admin): estrutura do "nosso Sponte" — turmas, disciplinas ofertadas,
 * professores, programas (cursos) e salas/turnos. Programas e turmas vêm do Sponte; ofertas e professores do AVA/Moodle.
 * Leitura: equipe (RLS is_staff); edição: admin (RLS is_admin).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Building2, GraduationCap, Layers, Loader2, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { withTimeout } from '@/utils/withTimeout'
import { showError, showSuccess } from '@/utils/toast'
import { Btn, CAMPO, Inp } from '../cpa/cpaUi'
import { Modal, Rot } from '../ava-admin/ui'

type Nivel = 'graduacao' | 'pos'
type Programa = { id: number; nome: string; nivel: Nivel; ativo: boolean }
type Turno = { id: number; nome: string }
type Sala = { id: number; nome: string; polo: string | null; capacidade: number | null; ativo: boolean }
type Professor = { id: number; nome: string; email: string | null; ativo: boolean }
type Turma = { id: number; nome: string; semestre: string | null; periodo: string | null; modalidade: string; data_inicio: string | null; data_termino: string | null; ativo: boolean; programa_id: number | null; programa: string | null; nivel: Nivel | null; turno_id: number | null; sala_id: number | null; vigentes: number; total: number }
type Oferta = { id: number; ava_curso_id: number | null; disciplina: string; semestre: string | null; periodo: string | null; nivel: Nivel; programa_id: number | null; turma_id: number | null; turno_id: number | null; sala_id: number | null; ativo: boolean }
type OfProf = { oferta_id: number; professor_id: number }

const T = (p: PromiseLike<any>) => withTimeout(p, 20000, 'Consulta')
const NIVEL: Record<Nivel, string> = { graduacao: 'Graduação', pos: 'Pós-graduação' }

function useDados() {
  return useQuery({
    queryKey: ['academico'],
    queryFn: async () => {
      const [pg, tn, sl, pf, tm, of, op] = await Promise.all([
        T(supabase.from('ac_programas').select('id,nome,nivel,ativo').order('nome')),
        T(supabase.from('ac_turnos').select('id,nome').order('id')),
        T(supabase.from('ac_salas').select('id,nome,polo,capacidade,ativo').order('nome')),
        T(supabase.from('ac_professores').select('id,nome,email,ativo').order('nome')),
        T(supabase.rpc('ac_turmas_listar')),
        T(supabase.from('ac_ofertas').select('id,ava_curso_id,disciplina,semestre,periodo,nivel,programa_id,turma_id,turno_id,sala_id,ativo').order('semestre', { ascending: false }).limit(3000)),
        T(supabase.from('ac_oferta_professores').select('oferta_id,professor_id').limit(10000)),
      ])
      for (const r of [pg, tn, sl, pf, tm, of, op]) if (r.error) throw r.error
      return { programas: pg.data as Programa[], turnos: tn.data as Turno[], salas: sl.data as Sala[], professores: pf.data as Professor[], turmas: tm.data as Turma[], ofertas: of.data as Oferta[], ofProf: op.data as OfProf[] }
    },
  })
}

type Aba = 'turmas' | 'ofertas' | 'professores' | 'programas' | 'locais'

export function AcademicoGestao() {
  const q = useDados()
  const qc = useQueryClient()
  const [aba, setAba] = useState<Aba>('turmas')
  const sinc = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc('ac_sincronizar'); if (error) throw error; return data as Record<string, number> },
    onSuccess: r => { showSuccess(`Sincronizado: ${r.programas} programas, ${r.turmas} turmas, ${r.professores} professores, ${r.ofertas} ofertas novas.`); qc.invalidateQueries({ queryKey: ['academico'] }) },
    onError: (e: Error) => showError(e.message),
  })
  const abas: [Aba, string, typeof Users][] = [['turmas', 'Turmas', Users], ['ofertas', 'Disciplinas ofertadas', BookOpen], ['professores', 'Professores', GraduationCap], ['programas', 'Programas', Layers], ['locais', 'Salas e turnos', Building2]]
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary"><Layers size={14} /><span className="text-[10px] font-bold uppercase tracking-widest">Estrutura acadêmica</span></div>
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Acadêmico</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">Programas, turmas, disciplinas ofertadas, professores, salas e turnos. Turmas e programas vêm do Sponte; disciplinas e professores, do AVA/Moodle.</p>
        </div>
        <Btn onClick={() => sinc.mutate()} disabled={sinc.isPending}>{sinc.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronizar agora</Btn>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {abas.map(([k, t, I]) => (
          <button key={k} onClick={() => setAba(k)} className="px-4 py-2.5 -mb-px border-b-2 text-sm font-medium flex items-center gap-2"
            style={aba === k ? { borderColor: 'var(--primary)', color: 'var(--text-main)' } : { borderColor: 'transparent', color: 'var(--text-muted)' }}><I size={15} />{t}</button>
        ))}
      </div>
      {q.isLoading && <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>}
      {q.isError && <p className="text-sm text-[var(--danger)]">{(q.error as Error).message}</p>}
      {q.data && aba === 'turmas' && <Turmas d={q.data} />}
      {q.data && aba === 'ofertas' && <Ofertas d={q.data} />}
      {q.data && aba === 'professores' && <Professores d={q.data} />}
      {q.data && aba === 'programas' && <Programas d={q.data} />}
      {q.data && aba === 'locais' && <Locais d={q.data} />}
    </div>
  )
}
type D = NonNullable<ReturnType<typeof useDados>['data']>

function useSalvar(tabela: string, fechar: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id?: number; dados: Record<string, unknown> }) => {
      await supabase.auth.getSession()
      const r = v.id ? await T(supabase.from(tabela).update(v.dados).eq('id', v.id).select()) : await T(supabase.from(tabela).insert(v.dados).select())
      if (r.error) throw r.error
      if (!r.data?.length) throw new Error('Nada foi salvo (sem permissão?).')
    },
    onSuccess: () => { showSuccess('Salvo.'); qc.invalidateQueries({ queryKey: ['academico'] }); fechar() },
    onError: (e: Error) => showError(e.message),
  })
}
function useExcluir(tabela: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => { await supabase.auth.getSession(); const r = await T(supabase.from(tabela).delete().eq('id', id).select()); if (r.error) throw r.error; if (!r.data?.length) throw new Error('Nada foi excluído.') },
    onSuccess: () => { showSuccess('Excluído.'); qc.invalidateQueries({ queryKey: ['academico'] }) },
    onError: (e: Error) => showError(e.message),
  })
}
const Busca = ({ v, set, ph }: { v: string; set: (s: string) => void; ph: string }) => (
  <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /><Inp value={v} onChange={e => set(e.target.value)} placeholder={ph} className="pl-9" /></div>
)
const Sel = ({ v, set, children }: { v: string; set: (s: string) => void; children: React.ReactNode }) => <select value={v} onChange={e => set(e.target.value)} className={CAMPO + ' w-auto'}>{children}</select>
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const Tabela = ({ cab, children }: { cab: string[]; children: React.ReactNode }) => (
  <div className="overflow-x-auto rounded-xl bg-[var(--bg-card)]">
    <table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{cab.map(c => <th key={c} className="px-4 py-3 font-medium">{c}</th>)}</tr></thead>
      <tbody className="divide-y divide-[var(--border)]">{children}</tbody></table>
  </div>
)
const Vazio = ({ n }: { n: number }) => n === 0 ? <p className="py-10 text-center text-sm text-[var(--text-muted)]">Nada encontrado.</p> : null
const fmtData = (d: string | null) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—')

// ── Turmas ──────────────────────────────────────────────────
function Turmas({ d }: { d: D }) {
  const [busca, setBusca] = useState(''); const [nivel, setNivel] = useState('todos'); const [sem, setSem] = useState('todos'); const [soAtivas, setSoAtivas] = useState(true)
  const [edit, setEdit] = useState<Turma | null>(null)
  const semestres = useMemo(() => [...new Set(d.turmas.map(t => t.semestre).filter(Boolean) as string[])].sort().reverse(), [d.turmas])
  const lista = d.turmas.filter(t => (nivel === 'todos' || t.nivel === nivel || (nivel === 'pos' && t.modalidade === 'pos')) && (sem === 'todos' || t.semestre === sem) && (!soAtivas || t.vigentes > 0) && (!busca || norm(t.nome + (t.programa ?? '')).includes(norm(busca))))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Busca v={busca} set={setBusca} ph="Buscar turma ou curso" />
        <Sel v={nivel} set={setNivel}><option value="todos">Todos os níveis</option><option value="graduacao">Graduação</option><option value="pos">Pós-graduação</option></Sel>
        <Sel v={sem} set={setSem}><option value="todos">Todos os semestres</option>{semestres.map(s => <option key={s} value={s}>{s}</option>)}</Sel>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><input type="checkbox" checked={soAtivas} onChange={e => setSoAtivas(e.target.checked)} /> Só com alunos vigentes</label>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{lista.length} turmas · {lista.reduce((n, t) => n + t.vigentes, 0)} alunos vigentes</p>
      <Tabela cab={['Turma', 'Programa', 'Semestre', 'Período', 'Vigentes', 'Início', 'Término', 'Turno']}>
        {lista.map(t => (
          <tr key={t.id} onClick={() => setEdit(t)} className="cursor-pointer hover:bg-[var(--bg-card-hover)]">
            <td className="px-4 py-3 font-medium text-[var(--text-main)]">{t.nome}</td>
            <td className="px-4 py-3 text-[var(--text-muted)]">{t.programa ?? '—'}</td>
            <td className="px-4 py-3">{t.semestre ?? '—'}</td>
            <td className="px-4 py-3">{t.periodo ?? '—'}</td>
            <td className="px-4 py-3 tabular-nums">{t.vigentes}<span className="text-[var(--text-muted)]"> / {t.total}</span></td>
            <td className="px-4 py-3">{fmtData(t.data_inicio)}</td><td className="px-4 py-3">{fmtData(t.data_termino)}</td>
            <td className="px-4 py-3">{d.turnos.find(x => x.id === t.turno_id)?.nome ?? '—'}</td>
          </tr>
        ))}
      </Tabela>
      <Vazio n={lista.length} />
      {edit && <TurmaForm t={edit} d={d} onClose={() => setEdit(null)} />}
    </div>
  )
}
function TurmaForm({ t, d, onClose }: { t: Turma; d: D; onClose: () => void }) {
  const [f, setF] = useState({ nome: t.nome, semestre: t.semestre ?? '', periodo: t.periodo ?? '', programa_id: String(t.programa_id ?? ''), turno_id: String(t.turno_id ?? ''), sala_id: String(t.sala_id ?? ''), modalidade: t.modalidade, ativo: t.ativo })
  const m = useSalvar('ac_turmas', onClose)
  const num = (s: string) => (s ? Number(s) : null)
  return (
    <Modal titulo="Turma" onClose={onClose}>
      <Rot>Nome</Rot><Inp value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} />
      <div className="grid grid-cols-2 gap-3"><div><Rot>Semestre</Rot><Inp value={f.semestre} onChange={e => setF({ ...f, semestre: e.target.value })} placeholder="2026.2" /></div><div><Rot>Período</Rot><Inp value={f.periodo} onChange={e => setF({ ...f, periodo: e.target.value })} placeholder="P3, Modular" /></div></div>
      <Rot>Programa (curso)</Rot><Sel v={f.programa_id} set={v => setF({ ...f, programa_id: v })}><option value="">—</option>{d.programas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Sel>
      <Rot>Modalidade</Rot><Sel v={f.modalidade} set={v => setF({ ...f, modalidade: v })}><option value="periodo">Por período</option><option value="modular">Modular</option><option value="pos">Pós</option></Sel>
      <div className="grid grid-cols-2 gap-3"><div><Rot>Turno</Rot><Sel v={f.turno_id} set={v => setF({ ...f, turno_id: v })}><option value="">—</option>{d.turnos.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Sel></div>
        <div><Rot>Sala</Rot><Sel v={f.sala_id} set={v => setF({ ...f, sala_id: v })}><option value="">—</option>{d.salas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Sel></div></div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={e => setF({ ...f, ativo: e.target.checked })} /> Turma ativa</label>
      <div className="mt-5 flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn disabled={m.isPending} onClick={() => m.mutate({ id: t.id, dados: { nome: f.nome.trim(), semestre: f.semestre.trim() || null, periodo: f.periodo.trim() || null, programa_id: num(f.programa_id), turno_id: num(f.turno_id), sala_id: num(f.sala_id), modalidade: f.modalidade, ativo: f.ativo } })}>Salvar</Btn></div>
    </Modal>
  )
}

// ── Disciplinas ofertadas ────────────────────────────────────
function Ofertas({ d }: { d: D }) {
  const [busca, setBusca] = useState(''); const [nivel, setNivel] = useState('todos'); const [sem, setSem] = useState('todos'); const [semProf, setSemProf] = useState(false)
  const [edit, setEdit] = useState<Oferta | null>(null)
  const semestres = useMemo(() => [...new Set(d.ofertas.map(o => o.semestre).filter(Boolean) as string[])].sort().reverse(), [d.ofertas])
  const profs = useMemo(() => { const m = new Map<number, string[]>(); for (const x of d.ofProf) m.set(x.oferta_id, [...(m.get(x.oferta_id) ?? []), d.professores.find(p => p.id === x.professor_id)?.nome ?? '?']); return m }, [d])
  const lista = d.ofertas.filter(o => (nivel === 'todos' || o.nivel === nivel) && (sem === 'todos' || o.semestre === sem) && (!semProf || !profs.has(o.id)) && (!busca || norm(o.disciplina).includes(norm(busca)))).slice(0, 400)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Busca v={busca} set={setBusca} ph="Buscar disciplina" />
        <Sel v={nivel} set={setNivel}><option value="todos">Todos os níveis</option><option value="graduacao">Graduação</option><option value="pos">Pós-graduação</option></Sel>
        <Sel v={sem} set={setSem}><option value="todos">Todos os semestres</option>{semestres.map(s => <option key={s} value={s}>{s}</option>)}</Sel>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><input type="checkbox" checked={semProf} onChange={e => setSemProf(e.target.checked)} /> Sem professor</label>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{lista.length} de {d.ofertas.length} (mostra até 400; use os filtros)</p>
      <Tabela cab={['Disciplina', 'Nível', 'Semestre', 'Período', 'Professor(es)', 'Turma']}>
        {lista.map(o => (
          <tr key={o.id} onClick={() => setEdit(o)} className="cursor-pointer hover:bg-[var(--bg-card-hover)]">
            <td className="px-4 py-3 font-medium text-[var(--text-main)]">{o.disciplina}</td>
            <td className="px-4 py-3 text-[var(--text-muted)]">{NIVEL[o.nivel]}</td><td className="px-4 py-3">{o.semestre ?? '—'}</td><td className="px-4 py-3">{o.periodo ?? '—'}</td>
            <td className="px-4 py-3">{profs.get(o.id)?.join(', ') ?? <span className="text-amber-500">sem professor</span>}</td>
            <td className="px-4 py-3 text-[var(--text-muted)]">{d.turmas.find(t => t.id === o.turma_id)?.nome ?? '—'}</td>
          </tr>
        ))}
      </Tabela>
      <Vazio n={lista.length} />
      {edit && <OfertaForm o={edit} d={d} atuais={d.ofProf.filter(x => x.oferta_id === edit.id).map(x => x.professor_id)} onClose={() => setEdit(null)} />}
    </div>
  )
}
function OfertaForm({ o, d, atuais, onClose }: { o: Oferta; d: D; atuais: number[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ disciplina: o.disciplina, programa_id: String(o.programa_id ?? ''), turma_id: String(o.turma_id ?? ''), turno_id: String(o.turno_id ?? ''), sala_id: String(o.sala_id ?? ''), ativo: o.ativo })
  const [sel, setSel] = useState<number[]>(atuais)
  const [filtro, setFiltro] = useState('')
  const num = (s: string) => (s ? Number(s) : null)
  const m = useMutation({
    mutationFn: async () => {
      await supabase.auth.getSession()
      const r = await T(supabase.from('ac_ofertas').update({ disciplina: f.disciplina.trim(), programa_id: num(f.programa_id), turma_id: num(f.turma_id), turno_id: num(f.turno_id), sala_id: num(f.sala_id), ativo: f.ativo }).eq('id', o.id).select())
      if (r.error) throw r.error; if (!r.data?.length) throw new Error('Nada foi salvo (sem permissão?).')
      const del = await T(supabase.from('ac_oferta_professores').delete().eq('oferta_id', o.id)); if (del.error) throw del.error
      if (sel.length) { const ins = await T(supabase.from('ac_oferta_professores').insert(sel.map(id => ({ oferta_id: o.id, professor_id: id })))); if (ins.error) throw ins.error }
    },
    onSuccess: () => { showSuccess('Salvo.'); qc.invalidateQueries({ queryKey: ['academico'] }); onClose() }, onError: (e: Error) => showError(e.message),
  })
  const turmasDoNivel = d.turmas.filter(t => (o.semestre ? t.semestre === o.semestre : true)).slice(0, 300)
  return (
    <Modal titulo="Disciplina ofertada" onClose={onClose}>
      <Rot>Disciplina</Rot><Inp value={f.disciplina} onChange={e => setF({ ...f, disciplina: e.target.value })} />
      <p className="mt-1 text-xs text-[var(--text-muted)]">{NIVEL[o.nivel]} · {o.semestre ?? 'sem semestre'} · {o.periodo ?? 'sem período'}</p>
      <Rot>Programa</Rot><Sel v={f.programa_id} set={v => setF({ ...f, programa_id: v })}><option value="">—</option>{d.programas.filter(p => p.nivel === o.nivel).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Sel>
      <Rot>Turma</Rot><Sel v={f.turma_id} set={v => setF({ ...f, turma_id: v })}><option value="">—</option>{turmasDoNivel.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}</Sel>
      <div className="grid grid-cols-2 gap-3"><div><Rot>Turno</Rot><Sel v={f.turno_id} set={v => setF({ ...f, turno_id: v })}><option value="">—</option>{d.turnos.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Sel></div>
        <div><Rot>Sala</Rot><Sel v={f.sala_id} set={v => setF({ ...f, sala_id: v })}><option value="">—</option>{d.salas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Sel></div></div>
      <Rot>Professores</Rot>
      {sel.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{sel.map(id => <button key={id} onClick={() => setSel(sel.filter(x => x !== id))} className="rounded-full bg-primary/15 px-2.5 py-1 text-xs text-primary">{d.professores.find(p => p.id === id)?.nome} ×</button>)}</div>}
      <Inp value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar professor para adicionar" />
      {filtro.trim() && <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)]">
        {d.professores.filter(p => !sel.includes(p.id) && norm(p.nome).includes(norm(filtro))).slice(0, 10).map(p => <button key={p.id} onClick={() => { setSel([...sel, p.id]); setFiltro('') }} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-card-hover)]">{p.nome}</button>)}
      </div>}
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={e => setF({ ...f, ativo: e.target.checked })} /> Oferta ativa</label>
      <div className="mt-5 flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={m.isPending} onClick={() => m.mutate()}>Salvar</Btn></div>
    </Modal>
  )
}

// ── Professores ──────────────────────────────────────────────
function Professores({ d }: { d: D }) {
  const [busca, setBusca] = useState(''); const [edit, setEdit] = useState<Partial<Professor> | null>(null)
  const qtd = useMemo(() => { const m = new Map<number, number>(); for (const x of d.ofProf) m.set(x.professor_id, (m.get(x.professor_id) ?? 0) + 1); return m }, [d.ofProf])
  const lista = d.professores.filter(p => !busca || norm(p.nome).includes(norm(busca)))
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Busca v={busca} set={setBusca} ph="Buscar professor" /><Btn onClick={() => setEdit({ nome: '', email: '', ativo: true })}><Plus size={14} /> Novo</Btn></div>
      <Tabela cab={['Professor', 'E-mail', 'Disciplinas', 'Situação']}>
        {lista.map(p => (
          <tr key={p.id} onClick={() => setEdit(p)} className="cursor-pointer hover:bg-[var(--bg-card-hover)]">
            <td className="px-4 py-3 font-medium text-[var(--text-main)]">{p.nome}</td><td className="px-4 py-3 text-[var(--text-muted)]">{p.email ?? '—'}</td>
            <td className="px-4 py-3 tabular-nums">{qtd.get(p.id) ?? 0}</td><td className="px-4 py-3">{p.ativo ? 'Ativo' : 'Inativo'}</td>
          </tr>
        ))}
      </Tabela>
      <Vazio n={lista.length} />
      {edit && <SimplesForm titulo="Professor" tabela="ac_professores" inicial={edit} campos={[['nome', 'Nome'], ['email', 'E-mail']]} onClose={() => setEdit(null)} />}
    </div>
  )
}

// ── Programas ────────────────────────────────────────────────
function Programas({ d }: { d: D }) {
  const [busca, setBusca] = useState(''); const [edit, setEdit] = useState<Partial<Programa> | null>(null); const [nivel, setNivel] = useState('todos')
  const qtd = useMemo(() => { const m = new Map<number, number>(); for (const t of d.turmas) if (t.programa_id) m.set(t.programa_id, (m.get(t.programa_id) ?? 0) + t.vigentes); return m }, [d.turmas])
  const lista = d.programas.filter(p => (nivel === 'todos' || p.nivel === nivel) && (!busca || norm(p.nome).includes(norm(busca))))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2"><Busca v={busca} set={setBusca} ph="Buscar programa" /><Sel v={nivel} set={setNivel}><option value="todos">Todos</option><option value="graduacao">Graduação</option><option value="pos">Pós-graduação</option></Sel><Btn onClick={() => setEdit({ nome: '', nivel: 'graduacao', ativo: true })}><Plus size={14} /> Novo</Btn></div>
      <p className="text-xs text-[var(--text-muted)]">O Sponte tem vários cadastros do mesmo curso (por oferta). Ajuste o nível e desative os que não usa.</p>
      <Tabela cab={['Programa', 'Nível', 'Alunos vigentes', 'Situação']}>
        {lista.map(p => (
          <tr key={p.id} onClick={() => setEdit(p)} className="cursor-pointer hover:bg-[var(--bg-card-hover)]">
            <td className="px-4 py-3 font-medium text-[var(--text-main)]">{p.nome}</td><td className="px-4 py-3">{NIVEL[p.nivel]}</td><td className="px-4 py-3 tabular-nums">{qtd.get(p.id) ?? 0}</td><td className="px-4 py-3">{p.ativo ? 'Ativo' : 'Inativo'}</td>
          </tr>
        ))}
      </Tabela>
      <Vazio n={lista.length} />
      {edit && <SimplesForm titulo="Programa" tabela="ac_programas" inicial={edit} campos={[['nome', 'Nome']]} nivel onClose={() => setEdit(null)} />}
    </div>
  )
}

// ── Salas e turnos ───────────────────────────────────────────
function Locais({ d }: { d: D }) {
  const [salaEdit, setSalaEdit] = useState<Partial<Sala> | null>(null); const [turnoEdit, setTurnoEdit] = useState<Partial<Turno> | null>(null)
  const exSala = useExcluir('ac_salas'); const exTurno = useExcluir('ac_turnos')
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold text-[var(--text-main)]">Salas</h3><Btn onClick={() => setSalaEdit({ nome: '', ativo: true })}><Plus size={14} /> Nova sala</Btn></div>
        <Tabela cab={['Sala', 'Polo', 'Cap.', '']}>
          {d.salas.map(s => <tr key={s.id} className="hover:bg-[var(--bg-card-hover)]"><td className="px-4 py-3 cursor-pointer font-medium" onClick={() => setSalaEdit(s)}>{s.nome}</td><td className="px-4 py-3">{s.polo ?? '—'}</td><td className="px-4 py-3">{s.capacidade ?? '—'}</td>
            <td className="px-4 py-3 text-right"><button aria-label="Excluir" onClick={() => confirm(`Excluir a sala ${s.nome}?`) && exSala.mutate(s.id)} className="text-[var(--text-muted)] hover:text-red-500"><Trash2 size={15} /></button></td></tr>)}
        </Tabela><Vazio n={d.salas.length} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold text-[var(--text-main)]">Turnos</h3><Btn onClick={() => setTurnoEdit({ nome: '' })}><Plus size={14} /> Novo turno</Btn></div>
        <Tabela cab={['Turno', '']}>
          {d.turnos.map(t => <tr key={t.id} className="hover:bg-[var(--bg-card-hover)]"><td className="px-4 py-3 cursor-pointer font-medium" onClick={() => setTurnoEdit(t)}>{t.nome}</td>
            <td className="px-4 py-3 text-right"><button aria-label="Excluir" onClick={() => confirm(`Excluir o turno ${t.nome}?`) && exTurno.mutate(t.id)} className="text-[var(--text-muted)] hover:text-red-500"><Trash2 size={15} /></button></td></tr>)}
        </Tabela>
      </div>
      {salaEdit && <SimplesForm titulo="Sala" tabela="ac_salas" inicial={salaEdit} campos={[['nome', 'Nome'], ['polo', 'Polo / unidade'], ['capacidade', 'Capacidade']]} onClose={() => setSalaEdit(null)} />}
      {turnoEdit && <SimplesForm titulo="Turno" tabela="ac_turnos" inicial={turnoEdit} campos={[['nome', 'Nome']]} semAtivo onClose={() => setTurnoEdit(null)} />}
    </div>
  )
}

// formulário genérico de campos de texto (+ ativo e nível opcionais)
function SimplesForm({ titulo, tabela, inicial, campos, nivel, semAtivo, onClose }: { titulo: string; tabela: string; inicial: Record<string, any>; campos: [string, string][]; nivel?: boolean; semAtivo?: boolean; onClose: () => void }) {
  const [f, setF] = useState<Record<string, any>>({ ...inicial })
  const m = useSalvar(tabela, onClose)
  const salvar = () => {
    const dados: Record<string, unknown> = {}
    for (const [k] of campos) dados[k] = k === 'capacidade' ? (f[k] ? Number(f[k]) : null) : (String(f[k] ?? '').trim() || null)
    if (nivel) dados.nivel = f.nivel
    if (!semAtivo) dados.ativo = f.ativo !== false
    if (!dados.nome) return showError('Informe o nome.')
    m.mutate({ id: inicial.id, dados })
  }
  return (
    <Modal titulo={`${inicial.id ? 'Editar' : 'Novo'} · ${titulo}`} onClose={onClose}>
      {campos.map(([k, rot]) => <div key={k}><Rot>{rot}</Rot><Inp value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>)}
      {nivel && <><Rot>Nível</Rot><Sel v={f.nivel} set={v => setF({ ...f, nivel: v })}><option value="graduacao">Graduação</option><option value="pos">Pós-graduação</option></Sel></>}
      {!semAtivo && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo !== false} onChange={e => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>}
      <div className="mt-5 flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={m.isPending} onClick={salvar}>Salvar</Btn></div>
    </Modal>
  )
}
