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

// Troca de senha no 1º acesso (senha = CPF): por enquanto OPCIONAL (decisão do usuário
// 25/09) — o portal só mostra um aviso. Pra voltar a obrigar, troque pra true.
// alunos.must_change_password continua marcando quem ainda usa o CPF como senha.
const FORCE_PASSWORD_CHANGE = false

function TicketPortalWrapper({ session, recovery, onRecovered }: { session: Session; recovery: boolean; onRecovered: () => void }) {
  const [aluno, setAluno] = useState<{ nome: string; email: string; cpf: string; must_change_password: boolean; app_instalado_em: string | null } | null>(null)
  const [wantsNewPassword, setWantsNewPassword] = useState(false)

  useEffect(() => {
    supabase
      .from('alunos')
      .select('nome, email, cpf, must_change_password, app_instalado_em')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setAluno(data))
    // Aberto pelo app instalado (tela inicial) → registra, pra o convite "Instale o app" não aparecer
    // mais nem no navegador (no iPhone o Safari não tem como saber que o app foi instalado).
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
    const now = new Date().toISOString()
    supabase.from('alunos').update({ last_login_at: now, ...(standalone ? { app_instalado_em: now } : {}) }).eq('id', session.user.id).then(() => {})
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

  if (recovery || (aluno.must_change_password && (FORCE_PASSWORD_CHANGE || wantsNewPassword))) {
    return (
      <SetPassword
        userId={session.user.id}
        cpf={aluno.cpf}
        reason={recovery ? 'recovery' : 'first'}
        onCancel={!recovery && !FORCE_PASSWORD_CHANGE ? () => setWantsNewPassword(false) : undefined}
        onDone={() => {
          if (window.location.hash) history.replaceState(null, '', window.location.pathname)
          onRecovered()
          setWantsNewPassword(false)
          setAluno({ ...aluno, must_change_password: false })
        }}
      />
    )
  }

  return (
    <>
    {aluno.must_change_password && (
      <div className="hidden sm:flex bg-[#1A1710] border-b border-[#C9A84C]/30 px-4 py-2 items-center justify-center gap-3 text-xs text-[#E0BF6A]">
        <span>Você está usando o CPF como senha. Recomendamos criar uma senha só sua.</span>
        <button onClick={() => setWantsNewPassword(true)} className="font-semibold underline underline-offset-2 hover:text-white">Criar minha senha</button>
      </div>
    )}
    <TicketPortal
      alunoId={session.user.id}
      alunoNome={aluno.nome}
      alunoEmail={aluno.email}
      appInstalado={!!aluno.app_instalado_em}
      onLogout={handleLogout}
    />
    </>
  )
}
