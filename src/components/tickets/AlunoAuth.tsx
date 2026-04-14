/**
 * AlunoAuth — login / cadastro / recuperação de senha do aluno
 * Rota pública: /atendimento
 * Visual: identidade FICV (fundo escuro, dourado #C9A84C)
 */
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCPF, validateCPF } from '../../utils/cpf'
import { Loader2, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'

// Cores FICV
const GOLD = '#C9A84C'
const GOLD_LIGHT = '#E0BF6A'
const BG = '#0A0C10'
const CARD = '#13161D'
const BORDER = '#2A2D36'
const TEXT = '#F0EDE8'
const MUTED = '#8A8A9A'

type Mode = 'login' | 'register' | 'forgot'

// ── Subcomponentes de campo ──────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ color: MUTED }} className="text-xs font-medium mb-1.5 block tracking-wide uppercase">
      {children}
    </label>
  )
}

function Field({
  type = 'text', value, onChange, placeholder, autoComplete, suffix
}: {
  type?: string; value: string; onChange: (v: string) => void
  placeholder?: string; autoComplete?: string; suffix?: React.ReactNode
}) {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          background: '#0D0F14',
          border: `1px solid ${BORDER}`,
          color: TEXT,
          borderRadius: 8,
          padding: suffix ? '10px 40px 10px 14px' : '10px 14px',
          width: '100%',
          fontSize: 14,
          outline: 'none',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = GOLD }}
        onBlur={e => { e.currentTarget.style.borderColor = BORDER }}
      />
      {suffix && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>
      )}
    </div>
  )
}

function GoldButton({ children, onClick, type = 'button', loading = false }: {
  children: React.ReactNode; onClick?: () => void
  type?: 'button' | 'submit'; loading?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading}
      style={{
        background: loading ? '#7A6020' : `linear-gradient(135deg, ${GOLD}, ${GOLD_LIGHT})`,
        color: '#0A0C10',
        border: 'none',
        borderRadius: 8,
        padding: '12px 20px',
        width: '100%',
        fontWeight: 700,
        fontSize: 14,
        cursor: loading ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition: 'opacity 0.15s',
        letterSpacing: '0.02em',
      }}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

// ── Main ─────────────────────────────────────────────────────

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

  function reset() { setError(null); setSuccess(null) }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); reset()
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    if (!password) { setError('Informe a senha.'); return }
    setLoading(true)
    try {
      const fakeEmail = `${cpf.replace(/\D/g, '')}@aluno.ficv.br`
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: fakeEmail, password })
      if (authErr) { setError('CPF ou senha incorretos.'); return }
      onAuth()
    } finally { setLoading(false) }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); reset()
    if (!nome.trim()) { setError('Informe seu nome completo.'); return }
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    if (!email.trim() || !email.includes('@')) { setError('Informe um e-mail válido.'); return }
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    setLoading(true)
    try {
      const fakeEmail = `${cpf.replace(/\D/g, '')}@aluno.ficv.br`
      const { data: existing } = await supabase.from('alunos').select('id').eq('cpf', cpf).maybeSingle()
      if (existing) { setError('CPF já cadastrado. Faça login.'); return }
      const { data: authData, error: authErr } = await supabase.auth.signUp({ email: fakeEmail, password })
      if (authErr || !authData.user) { setError(authErr?.message ?? 'Erro ao criar conta.'); return }

      // Insere na tabela alunos
      const { error: dbErr } = await supabase.from('alunos').insert({
        id: authData.user.id, cpf, nome: nome.trim(), email: email.trim().toLowerCase(),
      })
      if (dbErr) { setError('Erro ao salvar dados. Tente novamente.'); return }

      // Se confirmação de email está ativa, signUp não cria sessão automaticamente
      // Fazemos login explícito logo após o cadastro
      if (!authData.session) {
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email: fakeEmail, password })
        if (loginErr) {
          setSuccess('Conta criada! Faça login para continuar.')
          setMode('login')
          return
        }
      }

      onAuth()
    } finally { setLoading(false) }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault(); reset()
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    if (!email.trim() || !email.includes('@')) { setError('Informe o e-mail cadastrado.'); return }
    setLoading(true)
    try {
      const { data: aluno } = await supabase.from('alunos').select('id')
        .eq('cpf', cpf).eq('email', email.trim().toLowerCase()).maybeSingle()
      if (!aluno) { setError('CPF e e-mail não correspondem a nenhuma conta.'); return }
      const fakeEmail = `${cpf.replace(/\D/g, '')}@aluno.ficv.br`
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(fakeEmail, {
        redirectTo: `${window.location.origin}/atendimento`,
      })
      if (resetErr) { setError('Erro ao enviar e-mail. Tente novamente.'); return }
      setSuccess(`Link enviado para ${email}. Verifique sua caixa de entrada.`)
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="https://siteficv.vercel.app/images/test-logo.png"
            alt="FICV"
            style={{ height: 80, width: 'auto', margin: '0 auto 16px', display: 'block', objectFit: 'contain' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Central de Atendimento
          </h1>
          <p style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>
            Abra o seu chamado
          </p>
        </div>

        {/* Card */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28 }}>

          {/* Tabs — não aparece em forgot */}
          {mode !== 'forgot' && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#0D0F14', borderRadius: 10, padding: 4 }}>
              {(['login', 'register'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); reset() }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                    background: mode === m ? GOLD : 'transparent',
                    color: mode === m ? '#0A0C10' : MUTED,
                    fontWeight: mode === m ? 700 : 500,
                    fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {m === 'login' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>
          )}

          {/* LOGIN */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <Label>CPF</Label>
                <Field
                  value={cpf}
                  onChange={v => setCpf(formatCPF(v))}
                  placeholder="000.000.000-00"
                  autoComplete="username"
                />
              </div>
              <div>
                <Label>Senha</Label>
                <Field
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  suffix={
                    <button type="button" onClick={() => setShowPw(v => !v)} style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
              </div>

              {error && (
                <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
                  <p style={{ color: '#F87171', fontSize: 13, margin: 0 }}>{error}</p>
                </div>
              )}

              <GoldButton type="submit" loading={loading}>Entrar</GoldButton>

              <button type="button" onClick={() => { setMode('forgot'); reset() }}
                style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12, cursor: 'pointer', textAlign: 'center', marginTop: -4 }}>
                Esqueci minha senha
              </button>
            </form>
          )}

          {/* REGISTER */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Label>Nome completo</Label>
                <Field value={nome} onChange={setNome} placeholder="Seu nome completo" />
              </div>
              <div>
                <Label>CPF</Label>
                <Field value={cpf} onChange={v => setCpf(formatCPF(v))} placeholder="000.000.000-00" />
              </div>
              <div>
                <Label>E-mail</Label>
                <Field type="email" value={email} onChange={setEmail} placeholder="seu@email.com" autoComplete="email" />
                <p style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>Usado para receber atualizações dos seus tickets</p>
              </div>
              <div>
                <Label>Senha</Label>
                <Field
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                  suffix={
                    <button type="button" onClick={() => setShowPw(v => !v)} style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
              </div>

              {error && (
                <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
                  <p style={{ color: '#F87171', fontSize: 13, margin: 0 }}>{error}</p>
                </div>
              )}

              <GoldButton type="submit" loading={loading}>Criar conta</GoldButton>
            </form>
          )}

          {/* FORGOT */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 style={{ color: TEXT, fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Recuperar senha</h2>
                <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>
                  Informe seu CPF e e-mail cadastrado. Enviaremos um link de redefinição.
                </p>
              </div>
              <div>
                <Label>CPF</Label>
                <Field value={cpf} onChange={v => setCpf(formatCPF(v))} placeholder="000.000.000-00" />
              </div>
              <div>
                <Label>E-mail cadastrado</Label>
                <Field type="email" value={email} onChange={setEmail} placeholder="seu@email.com" />
              </div>

              {error && (
                <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
                  <p style={{ color: '#F87171', fontSize: 13, margin: 0 }}>{error}</p>
                </div>
              )}
              {success && (
                <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: '#4ADE80' }} />
                  <p style={{ color: '#4ADE80', fontSize: 13, margin: 0 }}>{success}</p>
                </div>
              )}

              <GoldButton type="submit" loading={loading}>Enviar link de redefinição</GoldButton>

              <button type="button" onClick={() => { setMode('login'); reset() }}
                style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                Voltar ao login
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', color: MUTED, fontSize: 11, marginTop: 20 }}>
          © {new Date().getFullYear()} FICV — Faculdade Internacional Cidade Viva
        </p>
      </div>
    </div>
  )
}
