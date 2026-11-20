/**
 * AvaPage — rota /ava (AVA em teste; não aparece em nenhum menu).
 * Exige o login do Portal do Aluno E estar em `ava_liberados` (checado pela edge function `ava-api`).
 */
import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { Loader2, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AlunoAuth } from '../tickets/AlunoAuth'
import { avaCall, AVA_BG } from './avaApi'
import { AvaHome } from './AvaHome'
import { AvaCursoPage } from './AvaCursoPage'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

function Tela({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh flex items-center justify-center px-6 text-center" style={{ background: AVA_BG, color: '#F0EDE8' }}>{children}</div>
}

export function AvaPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Tela><Loader2 className="w-6 h-6 animate-spin text-[#C9A84C]" /></Tela>
  const aluno = session?.user?.email?.endsWith('@aluno.ficv.br')
  return (
    <QueryClientProvider client={queryClient}>
      {!session || !aluno ? <AlunoAuth onAuth={() => {}} /> : <Acesso userId={session.user.id} />}
    </QueryClientProvider>
  )
}

function Acesso({ userId }: { userId: string }) {
  const acesso = useQuery({ queryKey: ['ava-acesso', userId], queryFn: () => avaCall<{ liberado: boolean }>('acesso') })
  const nome = useQuery({
    queryKey: ['ava-nome', userId],
    queryFn: async () => (await supabase.from('alunos').select('nome').eq('id', userId).single()).data?.nome as string | undefined,
  })

  if (acesso.isLoading) return <Tela><Loader2 className="w-6 h-6 animate-spin text-[#C9A84C]" /></Tela>
  if (acesso.isError) return <Tela><p className="text-sm text-[#8A8A9A]">Não foi possível abrir o AVA agora. Tente de novo em instantes.</p></Tela>
  if (!acesso.data?.liberado) {
    return (
      <Tela>
        <div className="max-w-sm">
          <Lock className="w-9 h-9 mx-auto mb-4 text-[#C9A84C]" />
          <h1 className="text-xl font-semibold mb-2">Ambiente em teste</h1>
          <p className="text-sm text-[#8A8A9A] leading-relaxed">O novo ambiente de estudos da FICV ainda não está liberado para a sua conta. Continue acessando suas aulas pelo ambiente atual.</p>
        </div>
      </Tela>
    )
  }
  const primeiroNome = (nome.data ?? '').split(' ')[0]
  return (
    <Routes>
      <Route index element={<AvaHome nome={primeiroNome} />} />
      <Route path="c/:programa" element={<AvaHome nome={primeiroNome} />} />
      <Route path="curso/:cursoId" element={<AvaCursoPage />} />
      <Route path="curso/:cursoId/aula/:aulaId" element={<AvaCursoPage />} />
      <Route path="*" element={<AvaHome nome={primeiroNome} />} />
    </Routes>
  )
}
