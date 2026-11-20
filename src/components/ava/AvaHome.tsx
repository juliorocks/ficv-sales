import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Play, LogOut, GraduationCap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { avaCall, AVA_BG, type AvaCursoResumo } from './avaApi'

const GOLD = '#C9A84C'

const GRADIENTES = [
  'linear-gradient(135deg,#1f2a44,#3b2f5c)', 'linear-gradient(135deg,#17323a,#2d5a52)',
  'linear-gradient(135deg,#40281f,#6b3f2a)', 'linear-gradient(135deg,#2a1f40,#4a2d6b)',
]

const PALETAS = [
  ['#1f2a44', '#3b2f5c'], ['#17323a', '#2d5a52'], ['#40281f', '#6b3f2a'], ['#2a1f40', '#4a2d6b'], ['#33301a', '#5e5526'], ['#2b2b33', '#4a4a58'],
]

export function grupoDe(c: AvaCursoResumo): string {
  if (c.periodo) return c.periodo
  const m = c.nome.match(/\b(POS[A-Z]+)\s*\/\s*(T\d+)/i)
  return m ? `${m[1].toUpperCase()} · ${m[2].toUpperCase()}` : 'Outras'
}
function rotuloGrupo(g: string) {
  const m = g.match(/^P(\d+)$/i)
  return m ? `${m[1]}º período` : /^modular$/i.test(g) ? 'Modular' : g
}
const ordemGrupo = (g: string) => { const m = g.match(/^P(\d+)$/i); return m ? Number(m[1]) : 100 }
const areaDe = (c: AvaCursoResumo) => (c.curso_area ?? 'Outros').replace(/^PÓS$/i, 'Pós-graduação')
const cap = (t: string) => t.toLowerCase().replace(/(^|\s)(\S)/g, (_, x, y) => x + y.toUpperCase())

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

export function AvaHome({ nome }: { nome: string }) {
  const q = useQuery({ queryKey: ['ava-cursos'], queryFn: () => avaCall<{ cursos: AvaCursoResumo[] }>('meus_cursos') })
  const [filtro, setFiltro] = useState<string>('todos')
  const [area, setArea] = useState<string>('todas')
  const cursos = q.data?.cursos ?? []

  const semestres = useMemo(() => [...new Set(cursos.map(c => c.semestre).filter(Boolean) as string[])].sort().reverse(), [cursos])
  const areas = useMemo(() => [...new Set(cursos.map(areaDe))].sort(), [cursos])
  const visiveis = cursos.filter(c => (filtro === 'todos' || c.semestre === filtro) && (area === 'todas' || areaDe(c) === area))
  // semestre (mais novo primeiro) → curso → período (1º, 2º, ...)
  const grupos = useMemo(() => {
    const porSem = new Map<string, AvaCursoResumo[]>()
    for (const c of visiveis) porSem.set(c.semestre ?? 'sem', [...(porSem.get(c.semestre ?? 'sem') ?? []), c])
    return [...porSem.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([sem, lista]) => {
      const m = new Map<string, AvaCursoResumo[]>()
      for (const c of lista) { const k = `${areaDe(c)}\u0000${grupoDe(c)}`; m.set(k, [...(m.get(k) ?? []), c]) }
      const itens = [...m.entries()].map(([k, l]) => [k.split('\u0000')[1], l] as [string, AvaCursoResumo[]])
        .sort((a, b) => areaDe(a[1][0]).localeCompare(areaDe(b[1][0])) || ordemGrupo(a[0]) - ordemGrupo(b[0]) || a[0].localeCompare(b[0]))
      return [sem, itens] as [string, [string, AvaCursoResumo[]][]]
    })
  }, [visiveis])
  const continuar = useMemo(
    () => [...cursos].filter(c => c.ultimo_acesso && pct(c) < 100).sort((a, b) => (b.ultimo_acesso! > a.ultimo_acesso! ? 1 : -1)),
    [cursos],
  )
  const destaque = continuar[0]

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

        {q.data && cursos.length > 0 && (
          <>
            <h1 className="text-2xl font-semibold mt-6">Olá{nome ? `, ${nome}` : ''}</h1>
            <p className="text-sm text-[#8A8A9A] mt-1">Continue de onde parou.</p>

            {destaque && (
              <Link to={`/ava/curso/${destaque.id}`} className="mt-5 block rounded-2xl overflow-hidden relative group border border-white/10">
                <Capa c={destaque} className="h-52 sm:h-72" />
                <div className="absolute inset-0 p-5 flex flex-col justify-end">
                  <span className="text-[11px] uppercase tracking-widest text-[#E0BF6A]">Continuar assistindo</span>
                  <h2 className="text-xl sm:text-3xl font-semibold leading-tight mt-1 max-w-2xl">{destaque.titulo}</h2>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold rounded-md px-4 py-2 group-hover:bg-[#E0BF6A] transition-colors"><Play className="w-4 h-4 fill-current" /> Retomar</span>
                    <span className="text-xs text-white/80">{pct(destaque)}% concluído</span>
                  </div>
                </div>
              </Link>
            )}

            {continuar.length > 1 && (
              <section className="mt-8">
                <h3 className="text-base font-semibold mb-3">Continuar assistindo</h3>
                <div className="flex gap-3 overflow-x-auto snap-x -mx-4 px-4 pb-2 [scrollbar-width:none]">
                  {continuar.slice(1, 10).map(c => <CartaoCurso key={c.id} c={c} className="snap-start shrink-0 w-[68%] sm:w-64" />)}
                </div>
              </section>
            )}

            <section className="mt-8">
              <h3 className="text-base font-semibold mb-3">Minhas disciplinas</h3>
              <Chips opcoes={['todas', ...areas]} valor={area} onChange={setArea} rotulo={x => (x === 'todas' ? 'Todos os cursos' : cap(x))} />
              <Chips opcoes={['todos', ...semestres]} valor={filtro} onChange={setFiltro} rotulo={x => (x === 'todos' ? 'Todos os semestres' : x)} />
              {grupos.map(([sem, porGrupo]) => (
                <div key={sem} className="mt-6">
                  <h4 className="text-lg font-semibold">{sem === 'sem' ? 'Sem semestre' : `Semestre ${sem}`}</h4>
                  {porGrupo.map(([g, lista]) => (
                    <div key={g} className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#E0BF6A] mb-2.5">{[area === 'todas' && areas.length > 1 ? areaDe(lista[0]) : null, rotuloGrupo(g)].filter(Boolean).join(' · ')} <span className="text-[#8A8A9A] font-normal normal-case tracking-normal">· {lista.length} {lista.length === 1 ? 'disciplina' : 'disciplinas'}</span></p>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                        {lista.map(c => <CartaoCurso key={c.id} c={c} />)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function CartaoCurso({ c, className = '' }: { c: AvaCursoResumo; className?: string }) {
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
        <p className="text-[10px] uppercase tracking-wider text-[#8A8A9A] truncate">{[c.curso_area, rotuloGrupo(grupoDe(c))].filter(Boolean).join(' · ')}</p>
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
