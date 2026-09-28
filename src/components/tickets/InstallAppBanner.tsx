/**
 * InstallAppBanner — convite pra "Adicionar à Tela de Início" no Portal do Aluno.
 * Android/Chrome/Edge: usa o beforeinstallprompt (instala com 1 toque).
 * iPhone/iPad (Safari): não existe prompt — mostra o passo a passo (Compartilhar → Adicionar à Tela de Início).
 * O convite (banner) some quando já está rodando como app; "Agora não" esconde por 14 dias.
 * InstallAppButton é o atalho FIXO no cabeçalho: continua lá depois de instalar/dispensar o banner
 * (some só dentro do próprio app instalado) e, sem prompt do navegador, abre o passo a passo.
 */
import { useEffect, useState } from 'react'
import { Download, EllipsisVertical, Share, SquarePlus, X } from 'lucide-react'

const DISMISS_KEY = 'ficv_aluno_install_dismissed'
const DISMISS_DAYS = 14

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return Date.now() - t < DISMISS_DAYS * 86400_000
  } catch { return false }
}

// O navegador dispara beforeinstallprompt uma vez só, cedo. Guardado aqui (fora do componente)
// pra o banner e o botão do cabeçalho enxergarem o mesmo evento, estejam ou não montados.
let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e as BeforeInstallPromptEvent; notify() })
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify() })
}

function useInstallApp() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  /** 'installed' | 'dismissed' = o prompt do navegador rodou; 'help' = não há prompt → mostrar o passo a passo */
  const install = async (): Promise<'installed' | 'dismissed' | 'help'> => {
    const d = deferredPrompt
    if (!d) return 'help'
    await d.prompt()
    const { outcome } = await d.userChoice
    deferredPrompt = null // o Chrome só libera o prompt de novo depois
    notify()
    return outcome === 'accepted' ? 'installed' : 'dismissed'
  }
  return { canPrompt: !!deferredPrompt, ios: isIOS(), install }
}

function InstallHelp({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const ios = isIOS()
  const step = 'flex items-center gap-3'
  const ico = 'w-8 h-8 rounded-lg bg-[#2A2D36] flex items-center justify-center shrink-0'
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-[#13161D] border border-[#2A2D36] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <p className="text-base font-semibold text-[#F0EDE8] mb-4">Instalar o app FICV</p>
        <ol className="space-y-4 text-sm text-[#C8C5BE]">
          {ios ? (
            <>
              <li className={step}>
                <span className={ico}><Share className="w-4 h-4 text-[#4A9EFF]" /></span>
                <span>No Safari, toque em <b className="text-[#F0EDE8]">Compartilhar</b> (barra de baixo)</span>
              </li>
              <li className={step}>
                <span className={ico}><SquarePlus className="w-4 h-4 text-[#F0EDE8]" /></span>
                <span>Escolha <b className="text-[#F0EDE8]">Adicionar à Tela de Início</b></span>
              </li>
            </>
          ) : (
            <>
              <li className={step}>
                <span className={ico}><EllipsisVertical className="w-4 h-4 text-[#F0EDE8]" /></span>
                <span>No Chrome ou Edge, abra o <b className="text-[#F0EDE8]">menu</b> do navegador (três pontinhos)</span>
              </li>
              <li className={step}>
                <span className={ico}><SquarePlus className="w-4 h-4 text-[#F0EDE8]" /></span>
                <span>Escolha <b className="text-[#F0EDE8]">Instalar app</b> ou <b className="text-[#F0EDE8]">Adicionar à tela inicial</b></span>
              </li>
            </>
          )}
          <li className={step}>
            <img src="/pwa/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
            <span>Confirme — o ícone da FICV aparece na sua tela</span>
          </li>
        </ol>
        <p className="mt-4 text-xs text-[#8A8A9A]">Já instalou? Abra o app FICV pela tela inicial do aparelho.</p>
        <button onClick={onDone ?? onClose} className="mt-5 w-full rounded-xl bg-[#C9A84C] py-3 text-sm font-semibold text-[#13161D]">Entendi</button>
      </div>
    </div>
  )
}

/** Atalho fixo no cabeçalho do portal: aparece sempre que estiver no navegador (não dentro do app instalado). */
export function InstallAppButton() {
  const { install } = useInstallApp()
  const [help, setHelp] = useState(false)
  if (isStandalone()) return null
  return (
    <>
      <button onClick={async () => { if ((await install()) === 'help') setHelp(true) }} aria-label="Instalar app" title="Instalar app"
        className="flex items-center gap-1.5 text-xs text-[#8A8A9A] hover:text-[#F0EDE8] transition-colors">
        <Download className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> <span className="hidden sm:inline">Instalar app</span>
      </button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  )
}

export function InstallAppBanner() {
  const { canPrompt, ios, install } = useInstallApp()
  const [hidden, setHidden] = useState(() => isStandalone() || dismissedRecently())
  const [help, setHelp] = useState(false)

  useEffect(() => {
    const onInstalled = () => setHidden(true)
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  // Só aparece quando dá pra instalar de fato (prompt disponível) ou no iOS (instrução manual)
  if (hidden || (!canPrompt && !ios)) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* sem storage */ }
    setHidden(true)
  }
  const onInstall = async () => {
    const r = await install()
    if (r === 'installed') setHidden(true)
    else if (r === 'help') setHelp(true)
  }

  return (
    <>
      <div className="mx-4 mt-4 sm:mx-auto sm:max-w-3xl rounded-2xl border border-[#C9A84C]/30 bg-[#1A1710] p-3 flex items-center gap-3">
        <img src="/pwa/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#F0EDE8]">Instale o app FICV</p>
          <p className="text-xs text-[#8A8A9A]">Acesse direto da tela inicial do seu celular.</p>
        </div>
        <button onClick={onInstall} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-3 py-2 text-xs font-semibold text-[#13161D]">
          <Download className="w-3.5 h-3.5" /> Instalar
        </button>
        <button onClick={dismiss} aria-label="Agora não" className="shrink-0 p-1 text-[#8A8A9A] hover:text-[#F0EDE8]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {help && <InstallHelp onClose={() => setHelp(false)} onDone={() => { setHelp(false); dismiss() }} />}
    </>
  )
}
