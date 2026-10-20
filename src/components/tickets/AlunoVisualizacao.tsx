import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Eye, Home, Wallet, BookOpen } from 'lucide-react'
import { AlunoPainelProvider, AlunoInicio, AlunoFinanceiro, AlunoNotas, VIEW_PREFIX, type NotasFoco } from './AlunoPainel'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 0, retry: 1 } } })

// Página do link temporário que o admin gera em Gestão > Usuários > Alunos do Portal.
// Só leitura: não troca senha, não paga, não manda mensagem. O link expira em 15 min no servidor.
export function AlunoVisualizacao({ token }: { token: string }) {
  const [tab, setTab] = useState<'inicio' | 'financeiro' | 'notas'>('inicio')
  const [foco, setFoco] = useState<NotasFoco | null>(null)
  const tabs = [
    { id: 'inicio', label: 'Início', icon: Home },
    { id: 'financeiro', label: 'Financeiro', icon: Wallet },
    { id: 'notas', label: 'Notas', icon: BookOpen },
  ] as const

  return (
    <QueryClientProvider client={queryClient}>
      <AlunoPainelProvider alunoId={`${VIEW_PREFIX}${token}`} readOnly>
        <div className="min-h-screen bg-[var(--bg-main)] pb-24">
          <div className="sticky top-0 z-30 bg-amber-500/15 border-b border-amber-500/40 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <Eye className="w-4 h-4 shrink-0" />
            <span><b>Visualização do Portal do Aluno — somente leitura.</b> O link expira em 15 minutos.</span>
          </div>
          <main className="max-w-xl mx-auto px-4 py-6">
            {tab === 'inicio' && <AlunoInicio onGo={(t, f) => { setFoco(t === 'notas' ? f ?? null : null); setTab(t === 'chamados' ? 'inicio' : t) }} onDeclaracao={() => {}} />}
            {tab === 'financeiro' && <AlunoFinanceiro />}
            {tab === 'notas' && <AlunoNotas foco={foco} />}
          </main>
          <nav className="fixed bottom-0 inset-x-0 z-30 bg-[var(--bg-card)] border-t border-[var(--border)] flex">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => { setFoco(null); setTab(t.id) }}
                className={`flex-1 py-3 flex flex-col items-center gap-1 text-[11px] ${tab === t.id ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                <t.icon className="w-5 h-5" />{t.label}
              </button>
            ))}
          </nav>
        </div>
      </AlunoPainelProvider>
    </QueryClientProvider>
  )
}

export function AlunoVisualizacaoRoute() {
  const { token = '' } = useParams()
  return <AlunoVisualizacao token={token} />
}
