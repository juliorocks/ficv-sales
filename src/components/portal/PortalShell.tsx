import { useEffect, useState } from 'react'
import { Bell, BookOpen, GraduationCap, Home, LogOut, Moon, RefreshCw, Sun, Ticket as TicketIcon, Wallet } from 'lucide-react'
import { InstallAppButton } from '../tickets/InstallAppBanner'

export type PortalTab = 'inicio' | 'financeiro' | 'notas' | 'chamados' | 'estudos'

const CHAVE = 'ficv_portal_tema'

/** Tema claro/escuro do Portal (inclui o Ambiente de Estudos). Padrão: claro, como o Portal sempre foi. */
export function usePortalTema() {
  const [escuro, setEscuro] = useState(() => { try { return localStorage.getItem(CHAVE) === 'escuro' } catch { return false } })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro)
    try { localStorage.setItem(CHAVE, escuro ? 'escuro' : 'claro') } catch { /* sem storage */ }
  }, [escuro])
  return { escuro, alternar: () => setEscuro(e => !e) }
}

type Props = {
  tab: PortalTab
  onTab: (t: PortalTab) => void
  aguardando?: number
  mostrarEstudos?: boolean
  onRefresh: () => void
  refreshing?: boolean
  onLogout?: () => void
  children: React.ReactNode
}

/** Cabeçalho, abas (topo no computador, barra de baixo no celular) e tema do Portal do Aluno. */
export function PortalShell({ tab, onTab, aguardando = 0, mostrarEstudos, onRefresh, refreshing, onLogout, children }: Props) {
  const { escuro, alternar } = usePortalTema()
  const tabs = [
    { id: 'inicio', label: 'Início', icon: Home },
    { id: 'financeiro', label: 'Financeiro', icon: Wallet },
    { id: 'notas', label: 'Notas', icon: BookOpen },
    { id: 'chamados', label: 'Chamados', icon: TicketIcon, badge: aguardando },
    ...(mostrarEstudos ? [{ id: 'estudos', label: 'Estudos', icon: GraduationCap, badge: 0 }] : []),
  ] as { id: PortalTab; label: string; icon: typeof Home; badge?: number }[]

  return (
    <div className="min-h-screen bg-[var(--bg-main)] overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-[#2A2D36] bg-[#13161D] px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="https://siteficv.vercel.app/images/test-logo.png" alt="FICV" className="h-8 sm:h-9 w-auto object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <div className="border-l border-[#2A2D36] pl-3">
            <p className="text-xs font-semibold text-[#F0EDE8]">Portal do Aluno</p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-5">
          <button onClick={() => onTab('chamados')} aria-label="Notificações" className="relative text-[#8A8A9A] hover:text-[#F0EDE8] transition-colors">
            <Bell className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            {aguardando > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#C9A84C] text-[9px] font-bold text-[#13161D]">{aguardando}</span>
            )}
          </button>
          <button onClick={alternar} aria-label={escuro ? 'Tema claro' : 'Tema escuro'} title={escuro ? 'Tema claro' : 'Tema escuro'}
            className="text-[#8A8A9A] hover:text-[#F0EDE8] transition-colors">
            {escuro ? <Sun className="w-4 h-4 sm:w-[18px] sm:h-[18px]" /> : <Moon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />}
          </button>
          <InstallAppButton />
          <button onClick={onRefresh} disabled={refreshing} aria-label="Atualizar" className="flex items-center gap-1.5 text-xs text-[#8A8A9A] hover:text-[#F0EDE8] transition-colors">
            <RefreshCw className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Atualizar</span>
          </button>
          {onLogout && (
            <button onClick={onLogout} className="flex items-center gap-1.5 text-xs text-[#8A8A9A] hover:text-red-400 transition-colors">
              <LogOut className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> <span className="hidden sm:inline">Sair</span>
            </button>
          )}
        </div>
      </header>

      <nav className="hidden sm:block border-b border-[#2A2D36] bg-[#13161D] px-6">
        <div className="max-w-3xl mx-auto flex gap-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => onTab(t.id)}
              className={`relative flex items-center gap-1.5 px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-[#C9A84C] text-[#F0EDE8] font-semibold' : 'border-transparent text-[#8A8A9A] hover:text-[#F0EDE8]'}`}>
              <t.icon className="w-4 h-4" /> {t.label}
              {!!t.badge && t.badge > 0 && <span className="ml-0.5 text-[10px] bg-purple-500 text-white rounded-full px-1.5">{t.badge}</span>}
            </button>
          ))}
        </div>
      </nav>

      {children}

      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#2A2D36] bg-[#13161D]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => { onTab(t.id); window.scrollTo({ top: 0 }) }}
              className={`relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] transition-colors ${tab === t.id ? 'text-[#C9A84C] font-semibold' : 'text-[#8A8A9A]'}`}>
              {tab === t.id && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[#C9A84C]" />}
              <span className="relative">
                <t.icon className="w-[22px] h-[22px]" />
                {!!t.badge && t.badge > 0 && <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] text-[10px] leading-[18px] text-center bg-purple-500 text-white rounded-full px-1">{t.badge}</span>}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
