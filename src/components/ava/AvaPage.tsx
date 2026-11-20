/**
 * AvaPage — rota /ava (AVA em teste; não aparece em nenhum menu).
 * Exige o login do Portal do Aluno E estar em `ava_liberados` (checado pela edge function `ava-api`).
 */
import { useEffect, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { Loader2, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AlunoAuth } from '../tickets/AlunoAuth'
import { PortalShell, type PortalTab } from '../portal/PortalShell'
import { avaCall, AVA_BG } from './avaApi'
import { AvaCarregando } from './AvaCarregando'
import { AvaHome } from './AvaHome'
import { AvaCursoPage } from './AvaCursoPage'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

function Tela({ children }: { children: React.ReactNode }) {
  return <div className="ava-tema min-h-dvh flex items-center justify-center px-6 text-center" style={{ background: AVA_BG, color: 'var(--ava-text)' }}>{children}</div>
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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const irPara = (t: PortalTab) => { if (t === 'estudos') navigate('/ava'); else navigate(`/aluno?aba=${t}`) }
  const atualizar = async () => { setRefreshing(true); await qc.invalidateQueries().catch(() => {}); setTimeout(() => setRefreshing(false), 400) }
  const acesso = useQuery({ queryKey: ['ava-acesso', userId], queryFn: () => avaCall<{ liberado: boolean }>('acesso') })
  const nome = useQuery({
    queryKey: ['ava-nome', userId],
    queryFn: async () => (await supabase.from('alunos').select('nome').eq('id', userId).single()).data?.nome as string | undefined,
  })

  if (acesso.isLoading) return <Tela><AvaCarregando passos={['Verificando o seu acesso…', 'Abrindo o seu ambiente de estudos…']} compacto /></Tela>
  if (acesso.isError) return <Tela><p className="text-sm text-[var(--ava-muted)]">Não foi possível abrir o AVA agora. Tente de novo em instantes.</p></Tela>
  if (!acesso.data?.liberado) {
    return (
      <Tela>
        <div className="max-w-sm">
          <Lock className="w-9 h-9 mx-auto mb-4 text-[#C9A84C]" />
          <h1 className="text-xl font-semibold mb-2">Ambiente em teste</h1>
          <p className="text-sm text-[var(--ava-muted)] leading-relaxed">O novo ambiente de estudos da FICV ainda não está liberado para a sua conta. Continue acessando suas aulas pelo ambiente atual.</p>
        </div>
      </Tela>
    )
  }
  const primeiroNome = (nome.data ?? '').split(' ')[0]
  return (
    <PortalShell tab="estudos" onTab={irPara} mostrarEstudos onRefresh={atualizar} refreshing={refreshing} onLogout={() => supabase.auth.signOut()}>
    <div className="ava-tema pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-0">
    <Routes>
      <Route index element={<AvaHome nome={primeiroNome} />} />
      <Route path="c/:programa" element={<AvaHome nome={primeiroNome} />} />
      <Route path="curso/:cursoId" element={<AvaCursoPage />} />
      <Route path="curso/:cursoId/aula/:aulaId" element={<AvaCursoPage />} />
      <Route path="*" element={<AvaHome nome={primeiroNome} />} />
    </Routes>
    </div>
    </PortalShell>
  )
}
