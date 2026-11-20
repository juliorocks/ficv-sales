import { useEffect, useRef } from 'react'

declare global { interface Window { Vimeo?: { Player: new (el: HTMLIFrameElement) => any } } }

let carregando: Promise<void> | null = null
function carregarSdk(): Promise<void> {
  if (window.Vimeo) return Promise.resolve()
  if (!carregando) {
    carregando = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://player.vimeo.com/api/player.js'
      s.onload = () => resolve()
      s.onerror = () => { carregando = null; reject(new Error('Vimeo indisponível')) }
      document.head.appendChild(s)
    })
  }
  return carregando
}

type Props = {
  videoId: string
  hash?: string | null
  inicio?: number
  onProgresso: (posicao: number, duracao: number, fim: boolean) => void
  onFim?: () => void
}

/** Player do Vimeo (os mesmos vídeos do Moodle) com retomada de onde parou e progresso a cada ~15 s.
 *  Remontar com `key={videoId}` ao trocar de aula. */
export function VimeoPlayer({ videoId, hash, inicio = 0, onProgresso, onFim }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const cb = useRef({ onProgresso, onFim })
  cb.current = { onProgresso, onFim }

  useEffect(() => {
    let vivo = true
    let player: any
    let ultimo = 0, pos = 0, dur = 0
    carregarSdk().then(() => {
      if (!vivo || !ref.current || !window.Vimeo) return
      player = new window.Vimeo.Player(ref.current)
      player.on('loaded', () => { if (inicio > 5) player.setCurrentTime(inicio).catch(() => {}) })
      player.on('timeupdate', (d: { seconds: number; duration: number }) => {
        pos = d.seconds; dur = d.duration
        if (pos - ultimo >= 15 || pos < ultimo) { ultimo = pos; cb.current.onProgresso(pos, dur, false) }
      })
      player.on('pause', () => { if (dur) { ultimo = pos; cb.current.onProgresso(pos, dur, false) } })
      player.on('ended', () => { cb.current.onProgresso(dur, dur, true); cb.current.onFim?.() })
    }).catch(() => {})
    const sair = () => { if (dur && pos) cb.current.onProgresso(pos, dur, false) }
    window.addEventListener('pagehide', sair)
    return () => { vivo = false; window.removeEventListener('pagehide', sair); sair(); try { player?.destroy() } catch { /* já destruído */ } }
  }, [videoId, hash, inicio])

  const src = `https://player.vimeo.com/video/${videoId}?${hash ? `h=${hash}&` : ''}title=0&byline=0&portrait=0&dnt=1&playsinline=1`
  return (
    <iframe
      ref={ref}
      src={src}
      title="Aula"
      className="absolute inset-0 w-full h-full"
      allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
      allowFullScreen
    />
  )
}
