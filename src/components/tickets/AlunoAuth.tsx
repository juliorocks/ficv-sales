/**
 * AlunoAuth — login / cadastro / recuperação de senha do aluno
 * Rota pública: /atendimento
 */
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { formatCPF, validateCPF } from '../../utils/cpf'
import { Loader2, GraduationCap, Eye, EyeOff } from 'lucide-react'

type Mode = 'login' | 'register' | 'forgot'

export function AlunoAuth({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [cpf, setCpf] = useState('')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function reset() {
    setError(null)
    setSuccess(null)
  }

  function handleCpfChange(v: string) {
    setCpf(formatCPF(v))
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    reset()
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    if (!password) { setError('Informe a senha.'); return }
    setLoading(true)
    try {
      // O "email" no Supabase Auth é cpf@aluno.ficv.br (nunca exposto ao usuário)
      const fakeEmail = `${cpf.replace(/\D/g, '')}@aluno.ficv.br`
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password,
      })
      if (authErr) {
        setError('CPF ou senha incorretos.')
        return
      }
      onAuth()
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    reset()
    if (!nome.trim()) { setError('Informe seu nome completo.'); return }
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    if (!email.trim() || !email.includes('@')) { setError('Informe um e-mail válido.'); return }
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    setLoading(true)
    try {
      const fakeEmail = `${cpf.replace(/\D/g, '')}@aluno.ficv.br`

      // Verifica se CPF já existe
      const { data: existing } = await supabase
        .from('alunos')
        .select('id')
        .eq('cpf', cpf)
        .maybeSingle()
      if (existing) { setError('CPF já cadastrado. Faça login.'); return }

      // Cria usuário no Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: fakeEmail,
        password,
      })
      if (authErr || !authData.user) {
        setError(authErr?.message ?? 'Erro ao criar conta.')
        return
      }

      // Insere na tabela alunos
      const { error: dbErr } = await supabase.from('alunos').insert({
        id: authData.user.id,
        cpf,
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
      })
      if (dbErr) {
        setError('Erro ao salvar dados. Tente novamente.')
        return
      }

      onAuth()
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    reset()
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    if (!email.trim() || !email.includes('@')) { setError('Informe o e-mail cadastrado.'); return }
    setLoading(true)
    try {
      // Busca se o CPF+email batem
      const { data: aluno } = await supabase
        .from('alunos')
        .select('id')
        .eq('cpf', cpf)
        .eq('email', email.trim().toLowerCase())
        .maybeSingle()
      if (!aluno) {
        setError('CPF e e-mail não correspondem a nenhuma conta.')
        return
      }
      const fakeEmail = `${cpf.replace(/\D/g, '')}@aluno.ficv.br`
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(fakeEmail, {
        redirectTo: `${window.location.origin}/atendimento`,
      })
      if (resetErr) { setError('Erro ao enviar e-mail. Tente novamente.'); return }
      setSuccess(`Enviamos um link de redefinição para ${email}. Verifique sua caixa de entrada.`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--primary)]/15 mb-4">
            <GraduationCap className="w-7 h-7 text-[var(--primary)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Portal do Aluno</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">FICV — Atendimento e Suporte</p>
        </div>

        <div className="glass-card p-6">
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-[var(--bg-main)] rounded-lg p-1">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); reset() }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  mode === m
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          {/* LOGIN */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">CPF</label>
                <Input
                  value={cpf}
                  onChange={e => handleCpfChange(e.target.value)}
                  placeholder="000.000.000-00"
                  className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Senha</label>
                <div className="relative">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)] pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Entrar
              </Button>

              <button
                type="button"
                onClick={() => { setMode('forgot'); reset() }}
                className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors text-center"
              >
                Esqueci minha senha
              </button>
            </form>
          )}

          {/* REGISTER */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Nome completo</label>
                <Input
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Seu nome completo"
                  className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">CPF</label>
                <Input
                  value={cpf}
                  onChange={e => handleCpfChange(e.target.value)}
                  placeholder="000.000.000-00"
                  className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">E-mail</label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Usado para receber atualizações dos seus tickets</p>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Senha</label>
                <div className="relative">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)] pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Criar conta
              </Button>
            </form>
          )}

          {/* FORGOT */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Informe seu CPF e o e-mail cadastrado. Enviaremos um link para redefinir sua senha.
              </p>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">CPF</label>
                <Input
                  value={cpf}
                  onChange={e => handleCpfChange(e.target.value)}
                  placeholder="000.000.000-00"
                  className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">E-mail cadastrado</label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-main)]"
                />
              </div>

              {error && <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>}
              {success && <p className="text-sm text-green-400 bg-green-400/10 px-3 py-2 rounded-lg">{success}</p>}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Enviar link de redefinição
              </Button>

              <button
                type="button"
                onClick={() => { setMode('login'); reset() }}
                className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors text-center"
              >
                Voltar ao login
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-6">
          FICV — Faculdade Integrada do Ceará e Vale
        </p>
      </div>
    </div>
  )
}
