/**
 * AlunoPainelDrawer — painel com a visão do Portal do Aluno (Início/Financeiro/
 * Notas) pro atendente consultar sem sair da tela de Chamados. Pedido do
 * usuário 02/10, ajustado 03/10: painel INLINE ao lado do chamado (não um
 * overlay por cima) — um overlay/portal separado fazia o clique nas abas
 * fechar o chamado inteiro (o Dialog do Radix tratava o portal como clique
 * "fora" do modal).
 */
import { useState } from 'react'
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

  return (
    <AlunoPainelProvider alunoId={alunoId}>
      <div className="w-full max-w-md shrink-0 border-l border-[var(--border)] bg-[var(--bg-card)] flex flex-col overflow-hidden">
        {tab === 'declaracao' ? (
          <div className="flex-1 overflow-y-auto">
            <AlunoDeclaracao onVoltar={() => setTab('inicio')} />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] font-bold shrink-0">
                  {alunoNome.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2 truncate">
                    <User className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    {alunoNome}
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                    <GraduationCap className="w-3 h-3 shrink-0" /> Painel do Aluno
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-3 border-b border-[var(--border)] shrink-0">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => { setNotasFoco(null); setTab(t.id) }}
                  className={`relative px-3 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-[var(--primary)] text-[var(--text-main)] font-semibold' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
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
    </AlunoPainelProvider>
  )
}
