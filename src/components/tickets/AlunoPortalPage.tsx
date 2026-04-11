/**
 * AlunoPortalPage — wrapper da rota /atendimento
 * Gerencia sessão do aluno independente do auth interno (admin/agent)
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { AlunoAuth } from './AlunoAuth'
import { TicketPortal } from './TicketPortal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import type { Session } from '@supabase/supabase-js'
import { Loader2 } from 'lucide-react'

const portalQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 2, retry: 1 } },
})

export function AlunoPortalPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = carregando

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
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
        : <TicketPortalWrapper session={session} />
      }
    </QueryClientProvider>
  )
}

function TicketPortalWrapper({ session }: { session: Session }) {
  const [aluno, setAluno] = useState<{ nome: string; email: string; cpf: string } | null>(null)

  useEffect(() => {
    supabase
      .from('alunos')
      .select('nome, email, cpf')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setAluno(data))
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

  return (
    <TicketPortal
      alunoId={session.user.id}
      alunoNome={aluno.nome}
      alunoEmail={aluno.email}
      onLogout={handleLogout}
    />
  )
}
