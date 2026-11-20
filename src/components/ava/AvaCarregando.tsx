import { useEffect, useState } from 'react'

const PASSOS_PADRAO = [
  'Abrindo o seu ambiente de estudos…',
  'Buscando as suas disciplinas…',
  'Conferindo o seu progresso…',
  'Organizando as aulas por semestre…',
  'Quase pronto, só mais um instante…',
]

/** Tela de espera do AVA: símbolo pulsando, mensagem que muda e barra que avança (nunca "trava" parada). */
export function AvaCarregando({ passos = PASSOS_PADRAO, compacto = false }: { passos?: string[]; compacto?: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(n => Math.min(n + 1, passos.length - 1)), 2200)
    return () => clearInterval(t)
  }, [passos.length])
  return (
    <div className={`ava-tema flex flex-col items-center justify-center text-center px-6 ${compacto ? 'py-24' : 'min-h-[60dvh]'}`} role="status" aria-live="polite">
      <div className="relative">
        <span className="absolute inset-0 rounded-full blur-2xl opacity-40 ficv-pulso" style={{ background: '#C9A84C' }} />
        <img src="/ficv-simbolo.png" alt="" className="relative h-16 w-16 object-contain ficv-pulso" />
      </div>
      <p key={i} className="mt-6 text-sm font-medium animate-fade-in" style={{ color: 'var(--ava-text)' }}>{passos[i]}</p>
      <div className="mt-4 h-1 w-44 overflow-hidden rounded-full" style={{ background: 'var(--ava-line)' }}>
        <div className="h-full w-1/3 rounded-full ava-barra" style={{ background: '#C9A84C' }} />
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--ava-muted)' }}>Carregando os seus dados, isso leva só alguns segundos.</p>
    </div>
  )
}
