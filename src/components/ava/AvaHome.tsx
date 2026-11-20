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

function Capa({ c, className = '' }: { c: AvaCursoResumo; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: GRADIENTES[c.id % GRADIENTES.length] }}>
      {c.capa_url && <img src={c.capa_url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
    </div>
  )
}

const pct = (c: AvaCursoResumo) => (c.total_aulas ? Math.round((c.concluidas / c.total_aulas) * 100) : 0)

export function AvaHome({ nome }: { nome: string }) {
  const q = useQuery({ queryKey: ['ava-cursos'], queryFn: () => avaCall<{ cursos: AvaCursoResumo[] }>('meus_cursos') })
  const [filtro, setFiltro] = useState<string>('todos')
  const cursos = q.data?.cursos ?? []

  const semestres = useMemo(() => [...new Set(cursos.map(c => c.semestre).filter(Boolean) as string[])].sort().reverse(), [cursos])
  const visiveis = filtro === 'todos' ? cursos : cursos.filter(c => c.semestre === filtro)
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
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-base font-semibold">Minhas disciplinas</h3>
              </div>
              {semestres.length > 1 && (
                <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-3 [scrollbar-width:none]">
                  {['todos', ...semestres].map(s => (
                    <button key={s} onClick={() => setFiltro(s)}
                      className="shrink-0 text-xs rounded-full px-3.5 py-1.5 border transition-colors"
                      style={filtro === s ? { background: GOLD, color: '#111', borderColor: GOLD } : { borderColor: 'rgba(255,255,255,.15)', color: '#cfcfd6' }}>
                      {s === 'todos' ? 'Todas' : s}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {visiveis.map(c => <CartaoCurso key={c.id} c={c} />)}
              </div>
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
        <p className="text-[10px] uppercase tracking-wider text-[#8A8A9A] truncate">{[c.curso_area, c.periodo, c.semestre].filter(Boolean).join(' · ')}</p>
        <h4 className="text-sm font-medium leading-snug mt-1 line-clamp-2 min-h-[2.5rem]">{c.titulo}</h4>
        <p className="text-[11px] text-[#8A8A9A] mt-1.5">{c.total_aulas} aulas{p > 0 ? ` · ${p}%` : ''}</p>
      </div>
    </Link>
  )
}
