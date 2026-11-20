import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Loader2, Play, LogOut, GraduationCap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { avaCall, AVA_BG, programaDe, type AvaCursoResumo } from './avaApi'

const GOLD = '#C9A84C'

const PALETAS = [
  ['#1f2a44', '#3b2f5c'], ['#17323a', '#2d5a52'], ['#40281f', '#6b3f2a'], ['#2a1f40', '#4a2d6b'], ['#33301a', '#5e5526'], ['#2b2b33', '#4a4a58'],
]

export function grupoDe(c: AvaCursoResumo): string {
  if (c.periodo) return c.periodo
  const m = c.nome.match(/\b(POS[A-Z]+)\s*\/\s*(T\d+)/i)
  return m ? `${m[1].toUpperCase()} · ${m[2].toUpperCase()}` : 'Outras'
}
function rotuloGrupo(g: string, grad = false) {
  const m = g.match(/^P(\d+)$/i)
  return m ? `${m[1]}º ${grad ? 'semestre' : 'período'}` : /^modular$/i.test(g) ? 'Modular' : g
}
const ordemGrupo = (g: string) => { const m = g.match(/^P(\d+)$/i); return m ? Number(m[1]) : 100 }

function Capa({ c, className = '' }: { c: AvaCursoResumo; className?: string }) {
  const g = grupoDe(c)
  const [c1, c2] = PALETAS[(g.length + (c.curso_area ?? '').length + ordemGrupo(g)) % PALETAS.length]
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
      <span className="absolute -right-2 -bottom-5 text-[5.5rem] font-black leading-none select-none text-white/10">{ordemGrupo(g) < 100 ? `P${ordemGrupo(g)}` : ''}</span>
      <img src="/ficv-simbolo.png" alt="" className="absolute left-3 top-3 h-6 w-6 object-contain opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
    </div>
  )
}

const pct = (c: AvaCursoResumo) => (c.total_aulas ? Math.round((c.concluidas / c.total_aulas) * 100) : 0)

type Programa = { key: string; label: string; nivel: string; cursos: AvaCursoResumo[] }

export function AvaHome({ nome }: { nome: string }) {
  const { programa: chave } = useParams()
  const q = useQuery({ queryKey: ['ava-cursos'], queryFn: () => avaCall<{ cursos: AvaCursoResumo[] }>('meus_cursos') })
  const [filtro, setFiltro] = useState<string>('todos')
  const cursos = q.data?.cursos ?? []

  const programas = useMemo(() => {
    const m = new Map<string, Programa>()
    for (const c of cursos) {
      const p = programaDe(c)
      m.set(p.key, { ...p, cursos: [...(m.get(p.key)?.cursos ?? []), c] })
    }
    return [...m.values()].sort((a, b) => a.nivel.localeCompare(b.nivel) || a.label.localeCompare(b.label))
  }, [cursos])
  const atual = chave ? programas.find(p => p.key === chave) : undefined
  const doPrograma = atual?.cursos ?? []

  const ehGrad = atual?.nivel !== 'Pós-graduação'
  const semestres = useMemo(() => [...new Set(doPrograma.map(c => c.semestre).filter(Boolean) as string[])].sort().reverse(), [doPrograma])
  // graduação: a mesma disciplina existe como cópia em cada semestre letivo no Moodle; mostra só a oferta mais recente
  const unicas = useMemo(() => (ehGrad ? semRepetidas(doPrograma) : doPrograma), [doPrograma, ehGrad])
  const visiveis = ehGrad ? unicas : doPrograma.filter(c => filtro === 'todos' || c.semestre === filtro)
  const gradGrupos = useMemo(() => {
    const m = new Map<string, AvaCursoResumo[]>()
    for (const c of unicas) m.set(grupoDe(c), [...(m.get(grupoDe(c)) ?? []), c])
    return [...m.entries()].sort((a, b) => ordemGrupo(a[0]) - ordemGrupo(b[0]) || a[0].localeCompare(b[0]))
  }, [unicas])
  // semestre (mais novo primeiro) → período (1º, 2º, ...)
  const grupos = useMemo(() => {
    const porSem = new Map<string, AvaCursoResumo[]>()
    for (const c of visiveis) porSem.set(c.semestre ?? 'sem', [...(porSem.get(c.semestre ?? 'sem') ?? []), c])
    return [...porSem.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([sem, lista]) => {
      const m = new Map<string, AvaCursoResumo[]>()
      for (const c of lista) m.set(grupoDe(c), [...(m.get(grupoDe(c)) ?? []), c])
      const itens = [...m.entries()].sort((a, b) => ordemGrupo(a[0]) - ordemGrupo(b[0]) || a[0].localeCompare(b[0]))
      return [sem, itens] as [string, [string, AvaCursoResumo[]][]]
    })
  }, [visiveis])
  const continuar = useMemo(
    () => [...(atual ? doPrograma : cursos)].filter(c => c.ultimo_acesso && pct(c) < 100).sort((a, b) => (b.ultimo_acesso! > a.ultimo_acesso! ? 1 : -1)),
    [cursos, doPrograma, atual],
  )
  const destaque = continuar[0]

  // um único curso: pula a tela de escolha
  if (q.data && !chave && programas.length === 1) return <Navigate to={`/ava/c/${programas[0].key}`} replace />
  if (q.data && chave && !atual) return <Navigate to="/ava" replace />

  return (
    <div className="min-h-dvh text-[#F0EDE8]" style={{ background: AVA_BG }}>
      <header className="sticky top-0 z-30 backdrop-blur border-b border-white/5" style={{ background: 'rgba(11,13,18,.88)' }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <img src="/ficv-simbolo.png" alt="FICV" className="h-7 w-7 object-contain" />
          <span className="font-semibold tracking-wide text-sm">Ambiente de Estudos</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#C9A84C]/50 text-[#E0BF6A] uppercase tracking-wider">teste</span>
          <div className="flex-1" />
          <Link to="/aluno" className="text-xs text-[#8A8A9A] hover:text-white hidden sm:block">Portal do Aluno</Link>
          <button onClick={() => supabase.auth.signOut()} aria-label="Sair" className="p-2 -mr-2 text-[#8A8A9A] hover:text-white"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pb-16">
        {q.isLoading && <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} /></div>}
        {q.isError && <p className="py-24 text-center text-sm text-[#8A8A9A]">{(q.error as Error).message}</p>}

        {q.data && cursos.length === 0 && (
          <div className="py-24 text-center text-[#8A8A9A]">
            <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-60" />
            <p className="text-sm">Nenhuma disciplina disponível para você ainda.</p>
          </div>
        )}

        {q.data && cursos.length > 0 && (atual || !chave) && (
          <>
            {atual ? (
              <div className="mt-5">
                <Link to={programas.length > 1 ? '/ava' : '/aluno'} className="inline-flex items-center gap-1 text-sm text-[#cfcfd6] hover:text-white -ml-1 py-1"><ChevronLeft className="w-5 h-5" /> {programas.length > 1 ? 'Meus cursos' : 'Portal do Aluno'}</Link>
                <p className="text-[11px] uppercase tracking-widest text-[#E0BF6A] mt-2">{atual.nivel}</p>
                <h1 className="text-2xl font-semibold leading-tight">{atual.label}</h1>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-semibold mt-6">Olá{nome ? `, ${nome}` : ''}</h1>
                <p className="text-sm text-[#8A8A9A] mt-1">Escolha o curso que você quer estudar.</p>
              </>
            )}

            {destaque && (
              <Link to={`/ava/curso/${destaque.id}`} className="mt-5 block rounded-2xl overflow-hidden relative group border border-white/10">
                <Capa c={destaque} className="h-44 sm:h-60" />
                <div className="absolute inset-0 p-5 flex flex-col justify-end">
                  <span className="text-[11px] uppercase tracking-widest text-[#E0BF6A]">Continuar assistindo</span>
                  <h2 className="text-xl sm:text-3xl font-semibold leading-tight mt-1 max-w-2xl">{destaque.titulo}</h2>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold rounded-md px-4 py-2 group-hover:bg-[#E0BF6A] transition-colors"><Play className="w-4 h-4 fill-current" /> Retomar</span>
                    <span className="text-xs text-white/80">{[programaDe(destaque).label, `${pct(destaque)}% concluído`].join(' · ')}</span>
                  </div>
                </div>
              </Link>
            )}

            {!atual && (
              <section className="mt-8">
                <h3 className="text-base font-semibold mb-3">Meus cursos</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {programas.map(p => <CartaoPrograma key={p.key} p={p} />)}
                </div>
              </section>
            )}

            {atual && (
              <section className="mt-6">
                {ehGrad && gradGrupos.map(([g, lista]) => (
                  <div key={g} className="mt-6">
                    <h4 className="text-lg font-semibold">{rotuloGrupo(g, true)} <span className="text-sm text-[#8A8A9A] font-normal">· {lista.length} {lista.length === 1 ? 'disciplina' : 'disciplinas'}</span></h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mt-3">
                      {lista.map(c => <CartaoCurso key={c.id} c={c} grad />)}
                    </div>
                  </div>
                ))}
                {!ehGrad && <Chips opcoes={['todos', ...semestres]} valor={filtro} onChange={setFiltro} rotulo={x => (x === 'todos' ? 'Todos os semestres' : x)} />}
                {!ehGrad && grupos.map(([sem, porGrupo]) => (
                  <div key={sem} className="mt-5">
                    <h4 className="text-lg font-semibold">{sem === 'sem' ? 'Sem semestre' : `Semestre ${sem}`}</h4>
                    {porGrupo.map(([g, lista]) => (
                      <div key={g} className="mt-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#E0BF6A] mb-2.5">{rotuloGrupo(g)} <span className="text-[#8A8A9A] font-normal normal-case tracking-normal">· {lista.length} {lista.length === 1 ? 'disciplina' : 'disciplinas'}</span></p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                          {lista.map(c => <CartaoCurso key={c.id} c={c} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function CartaoPrograma({ p }: { p: Programa }) {
  const total = p.cursos.reduce((n, c) => n + c.total_aulas, 0)
  const feitas = p.cursos.reduce((n, c) => n + c.concluidas, 0)
  const pr = total ? Math.round((feitas / total) * 100) : 0
  return (
    <Link to={`/ava/c/${p.key}`} className="group relative block rounded-2xl overflow-hidden border border-white/10 hover:border-[#C9A84C]/60 transition-colors">
      <Capa c={p.cursos[0]} className="h-36 sm:h-44" />
      <div className="absolute inset-0 p-4 flex flex-col justify-end">
        <span className="text-[10px] uppercase tracking-widest text-[#E0BF6A]">{p.nivel}</span>
        <h3 className="text-lg font-semibold leading-snug">{p.label}</h3>
        <p className="text-xs text-white/70 mt-1 flex items-center gap-1">{p.cursos.length} disciplinas{pr > 0 ? ` · ${pr}% concluído` : ''} <ChevronRight className="w-3.5 h-3.5 ml-auto" /></p>
      </div>
      {pr > 0 && <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20"><div className="h-full" style={{ width: `${pr}%`, background: GOLD }} /></div>}
    </Link>
  )
}

function CartaoCurso({ c, className = '', grad = false }: { c: AvaCursoResumo; className?: string; grad?: boolean }) {
  const p = pct(c)
  return (
    <Link to={`/ava/curso/${c.id}`} className={`group block rounded-xl overflow-hidden border border-white/10 bg-[#13161D] hover:border-[#C9A84C]/60 transition-colors ${className}`}>
      <div className="relative">
        <Capa c={c} className="aspect-video" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center"><Play className="w-5 h-5 text-black fill-black ml-0.5" /></span>
        </div>
        {p > 0 && <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20"><div className="h-full" style={{ width: `${p}%`, background: GOLD }} /></div>}
      </div>
      <div className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-[#8A8A9A] truncate">{(grad ? [rotuloGrupo(grupoDe(c), true), c.semestre].filter(Boolean).join(' · ') : rotuloGrupo(grupoDe(c)))}</p>
        <h4 className="text-sm font-medium leading-snug mt-1 line-clamp-2 min-h-[2.5rem]">{c.titulo}</h4>
        <p className="text-[11px] text-[#8A8A9A] mt-1.5">{c.total_aulas} aulas{p > 0 ? ` · ${p}%` : ''}</p>
      </div>
    </Link>
  )
}

function Chips({ opcoes, valor, onChange, rotulo }: { opcoes: string[]; valor: string; onChange: (v: string) => void; rotulo: (v: string) => string }) {
  if (opcoes.length <= 2) return null
  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2.5 [scrollbar-width:none]">
      {opcoes.map(o => (
        <button key={o} onClick={() => onChange(o)} className="shrink-0 text-xs rounded-full px-3.5 py-1.5 border transition-colors"
          style={valor === o ? { background: GOLD, color: '#111', borderColor: GOLD } : { borderColor: 'rgba(255,255,255,.15)', color: '#cfcfd6' }}>{rotulo(o)}</button>
      ))}
    </div>
  )
}

const normTitulo = (t: string) => t.split(/\s+-\s+/)[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
const contem = (a: string[], b: string[]) => {
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a]
  for (let i = 0; i + curto.length <= longo.length; i++) if (curto.every((w, j) => longo[i + j] === w)) return true
  return false
}
/** Mesma disciplina no mesmo período em semestres letivos diferentes: fica a oferta mais recente. */
function semRepetidas(cursos: AvaCursoResumo[]): AvaCursoResumo[] {
  const ord = [...cursos].sort((a, b) => (b.semestre ?? '').localeCompare(a.semestre ?? ''))
  const mantidos: AvaCursoResumo[] = []
  for (const c of ord) {
    const t = normTitulo(c.titulo)
    const igual = mantidos.some(m => m.periodo === c.periodo && m.semestre !== c.semestre && contem(normTitulo(m.titulo), t))
    if (!igual) mantidos.push(c)
  }
  return mantidos
}
