/**
 * AlunoPortalPage — wrapper da rota /aluno (Portal do Aluno; /atendimento redireciona)
 * Gerencia sessão do aluno independente do auth interno (admin/agent)
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { AlunoAuth, SetPassword } from './AlunoAuth'
import { TicketPortal } from './TicketPortal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import type { Session } from '@supabase/supabase-js'
import { Loader2 } from 'lucide-react'

const portalQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 0, retry: 1 } },
})

export function AlunoPortalPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = carregando
  // veio do link "esqueci a senha" (e-mail) → cria senha nova antes de entrar
  const [recovery, setRecovery] = useState(() => window.location.hash.includes('type=recovery'))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--primary)]" />
      </div>
    )
  }

  // Verifica se é um aluno (email termina em @aluno.ficv.br)
  // Impede que admins/agents logados acessem o portal
  const isAlunoSession = session?.user?.email?.endsWith('@aluno.ficv.br') ?? false

  return (
    <QueryClientProvider client={portalQueryClient}>
      <Toaster richColors position="top-right" />
      {(!session || !isAlunoSession)
        ? <AlunoAuth onAuth={() => {}} />
        : <TicketPortalWrapper session={session} recovery={recovery} onRecovered={() => setRecovery(false)} />
      }
    </QueryClientProvider>
  )
}

function TicketPortalWrapper({ session, recovery, onRecovered }: { session: Session; recovery: boolean; onRecovered: () => void }) {
  const [aluno, setAluno] = useState<{ nome: string; email: string; cpf: string; must_change_password: boolean } | null>(null)

  useEffect(() => {
    supabase
      .from('alunos')
      .select('nome, email, cpf, must_change_password')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setAluno(data))
    supabase.from('alunos').update({ last_login_at: new Date().toISOString() }).eq('id', session.user.id).then(() => {})
  }, [session.user.id])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (!aluno) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--primary)]" />
      </div>
    )
  }

  if (recovery || aluno.must_change_password) {
    return (
      <SetPassword
        userId={session.user.id}
        cpf={aluno.cpf}
        reason={recovery ? 'recovery' : 'first'}
        onDone={() => {
          if (window.location.hash) history.replaceState(null, '', window.location.pathname)
          onRecovered()
          setAluno({ ...aluno, must_change_password: false })
        }}
      />
    )
  }

  return (
    <TicketPortal
      alunoId={session.user.id}
      alunoNome={aluno.nome}
      alunoEmail={aluno.email}
      onLogout={handleLogout}
    />
  )
}
