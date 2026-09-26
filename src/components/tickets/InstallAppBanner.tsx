/**
 * InstallAppBanner — convite pra "Adicionar à Tela de Início" no Portal do Aluno.
 * Android/Chrome/Edge: usa o beforeinstallprompt (instala com 1 toque).
 * iPhone/iPad (Safari): não existe prompt — mostra o passo a passo (Compartilhar → Adicionar à Tela de Início).
 * Some quando já está rodando como app; "Agora não" esconde por 14 dias.
 */
import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'

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

export function InstallAppBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(() => isStandalone() || dismissedRecently())
  const [iosHelp, setIosHelp] = useState(false)
  const ios = isIOS()

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent) }
    const onInstalled = () => setHidden(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [])

  // Só aparece quando dá pra instalar de fato (prompt disponível) ou no iOS (instrução manual)
  if (hidden || (!deferred && !ios)) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* sem storage */ }
    setHidden(true)
  }
  const install = async () => {
    if (deferred) {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      setDeferred(null)
      if (outcome === 'accepted') setHidden(true)
    } else setIosHelp(true)
  }

  return (
    <>
      <div className="mx-4 mt-4 sm:mx-auto sm:max-w-3xl rounded-2xl border border-[#C9A84C]/30 bg-[#1A1710] p-3 flex items-center gap-3">
        <img src="/pwa/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#F0EDE8]">Instale o app FICV</p>
          <p className="text-xs text-[#8A8A9A]">Acesse direto da tela inicial do seu celular.</p>
        </div>
        <button onClick={install} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-3 py-2 text-xs font-semibold text-[#13161D]">
          <Download className="w-3.5 h-3.5" /> Instalar
        </button>
        <button onClick={dismiss} aria-label="Agora não" className="shrink-0 p-1 text-[#8A8A9A] hover:text-[#F0EDE8]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {iosHelp && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setIosHelp(false)}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-[#13161D] border border-[#2A2D36] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-[#F0EDE8] mb-4">Adicionar à Tela de Início</p>
            <ol className="space-y-4 text-sm text-[#C8C5BE]">
              <li className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-[#2A2D36] flex items-center justify-center shrink-0"><Share className="w-4 h-4 text-[#4A9EFF]" /></span>
                <span>No Safari, toque em <b className="text-[#F0EDE8]">Compartilhar</b> (barra de baixo)</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-[#2A2D36] flex items-center justify-center shrink-0"><SquarePlus className="w-4 h-4 text-[#F0EDE8]" /></span>
                <span>Escolha <b className="text-[#F0EDE8]">Adicionar à Tela de Início</b></span>
              </li>
              <li className="flex items-center gap-3">
                <img src="/pwa/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
                <span>Toque em <b className="text-[#F0EDE8]">Adicionar</b> — o ícone da FICV aparece na sua tela</span>
              </li>
            </ol>
            <button onClick={() => { setIosHelp(false); dismiss() }} className="mt-6 w-full rounded-xl bg-[#C9A84C] py-3 text-sm font-semibold text-[#13161D]">Entendi</button>
          </div>
        </div>
      )}
    </>
  )
}
