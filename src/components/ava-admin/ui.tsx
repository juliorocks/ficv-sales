import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Janela por cima da tela (portal no body: o wrapper animado do app prende `fixed`). */
export function Modal({ titulo, onClose, children, largura = 'max-w-lg' }: { titulo: string; onClose: () => void; children: React.ReactNode; largura?: string }) {
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`w-full ${largura} max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[var(--bg-card)] text-[var(--text-main)] shadow-2xl`}>
        <div className="sticky top-0 flex items-center justify-between gap-3 px-5 py-4 bg-[var(--bg-card)] border-b border-[var(--border)]">
          <h3 className="text-base font-semibold">{titulo}</h3>
          <button onClick={onClose} aria-label="Fechar" className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export const Rot = ({ children }: { children: React.ReactNode }) => <label className="mb-1 mt-3 block text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{children}</label>
export const haQuanto = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 90) return 'agora'
  if (d < 3600) return `${Math.floor(d / 60)} min`
  if (d < 86400) return `${Math.floor(d / 3600)} h`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d`
  return new Date(iso).toLocaleDateString('pt-BR')
}
