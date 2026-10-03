/**
 * AlunoPainelDrawer — painel lateral com a visão do Portal do Aluno (Início/
 * Financeiro/Notas) pro atendente consultar sem sair da tela de Chamados.
 * Pedido do usuário 02/10: "abrir à direita um painel com a visão do painel
 * do aluno". Mesmo padrão visual de AlunoHistorico.tsx (overlay + drawer fixo).
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, User, GraduationCap } from 'lucide-react'
import { AlunoPainelProvider, AlunoInicio, AlunoFinanceiro, AlunoNotas, AlunoDeclaracao, type NotasFoco } from './AlunoPainel'

interface Props {
  alunoId: string
  alunoNome: string
  /** Financeiro é dado mais sensível — só secretaria/coordenação/admin/agent (pedido 02/10). */
  canSeeFinanceiro: boolean
  onClose: () => void
}

type Tab = 'inicio' | 'financeiro' | 'notas' | 'declaracao'
const TABS: { id: Tab; label: string }[] = [
  { id: 'inicio', label: 'Início' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'notas', label: 'Notas' },
]

export function AlunoPainelDrawer({ alunoId, alunoNome, canSeeFinanceiro, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('inicio')
  const [notasFoco, setNotasFoco] = useState<NotasFoco | null>(null)
  const tabs = canSeeFinanceiro ? TABS : TABS.filter((t) => t.id !== 'financeiro')

  // Portal direto pro body: o TicketDetail que abre isso é um Dialog do Radix já aberto, que
  // trata irmãos fora do próprio portal como "fundo inerte" (foco/clique presos dentro dele).
  // Sem o portal, o drawer renderiza mas fica sem resposta a clique — achado ao vivo 03/10.
  return createPortal(
    <AlunoPainelProvider alunoId={alunoId}>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm pointer-events-auto" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-[var(--bg-card)] border-l border-[var(--border)] z-[70] flex flex-col shadow-2xl pointer-events-auto">
        {tab === 'declaracao' ? (
          <div className="flex-1 overflow-y-auto">
            <AlunoDeclaracao onVoltar={() => setTab('inicio')} />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-6 py-5 border-b border-[var(--border)] flex items-start justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] font-bold text-lg shrink-0">
                  {alunoNome.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--text-main)] flex items-center gap-2 truncate">
                    <User className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                    {alunoNome}
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                    <GraduationCap className="w-3 h-3 shrink-0" /> Painel do Aluno
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors mt-0.5 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-4 border-b border-[var(--border)] shrink-0">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => { setNotasFoco(null); setTab(t.id) }}
                  className={`relative px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-[var(--primary)] text-[var(--text-main)] font-semibold' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {tab === 'inicio' && (
                <AlunoInicio
                  onGo={(t, foco) => {
                    if (t === 'chamados') return // já está num chamado — nada a fazer aqui
                    if (t === 'financeiro' && !canSeeFinanceiro) return
                    setNotasFoco(t === 'notas' ? foco ?? null : null)
                    setTab(t)
                  }}
                  onDeclaracao={() => setTab('declaracao')}
                />
              )}
              {tab === 'financeiro' && canSeeFinanceiro && <AlunoFinanceiro />}
              {tab === 'notas' && <AlunoNotas foco={notasFoco} />}
            </div>
          </>
        )}
      </div>
    </AlunoPainelProvider>,
    document.body,
  )
}
