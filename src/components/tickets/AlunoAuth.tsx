/**
 * AlunoAuth — login / esqueci a senha / criar senha do Portal do Aluno
 * Rota pública: /aluno
 * Login = CPF. 1º acesso = CPF como senha (padrão do Sponte): a edge function
 * aluno-auth confere no Sponte e cria a conta; em seguida o portal obriga a
 * criar uma senha nova (SetPassword).
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

type Mode = 'login' | 'forgot'

// ── Subcomponentes de campo ──────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ color: MUTED }} className="text-xs font-medium mb-1.5 block tracking-wide uppercase">
      {children}
    </label>
  )
}

function Field({
  type = 'text', value, onChange, placeholder, autoComplete, suffix, inputMode
}: {
  type?: string; value: string; onChange: (v: string) => void
  placeholder?: string; autoComplete?: string; suffix?: React.ReactNode
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  return (
    <div className="relative">
      <input
        type={type}
        inputMode={inputMode}
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

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="https://siteficv.vercel.app/images/test-logo.png"
            alt="FICV"
            style={{ height: 80, width: 'auto', margin: '0 auto 16px', display: 'block', objectFit: 'contain' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
          <p style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>{subtitle}</p>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28 }}>{children}</div>
      </div>
    </div>
  )
}

function Msg({ kind, text }: { kind: 'error' | 'success'; text: string }) {
  const c = kind === 'error'
    ? { bg: 'rgba(220,38,38,0.1)', bd: 'rgba(220,38,38,0.3)', fg: '#F87171', Icon: AlertCircle }
    : { bg: 'rgba(34,197,94,0.1)', bd: 'rgba(34,197,94,0.3)', fg: '#4ADE80', Icon: CheckCircle2 }
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <c.Icon className="w-4 h-4 shrink-0" style={{ color: c.fg }} />
      <p style={{ color: c.fg, fontSize: 13, margin: 0 }}>{text}</p>
    </div>
  )
}

async function callAuth(body: Record<string, unknown>): Promise<{ ok?: boolean; message?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('aluno-auth', { body })
  if (error) {
    const ctx = await (error as any).context?.json?.().catch(() => null)
    return { error: ctx?.error ?? 'Serviço indisponível no momento.' }
  }
  return data
}

export function AlunoAuth({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [cpf, setCpf] = useState('')
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
      const digits = cpf.replace(/\D/g, '')
      const email = `${digits}@aluno.ficv.br`
      // senha = CPF vale com ou sem pontuação ("711.003.301-51" = "71100330151"):
      // a conta é criada com a senha só em números
      const usingCpf = /^[\d.\-\s]+$/.test(password) && password.replace(/\D/g, '') === digits
      let { error: authErr } = await supabase.auth.signInWithPassword({ email, password: usingCpf ? digits : password })
      // 1º acesso: senha = CPF (padrão do Sponte) → cria o acesso a partir do Sponte e entra
      if (authErr && usingCpf) {
        const r = await callAuth({ action: 'first_access', cpf: digits, password: digits })
        if (r.error) { setError(r.error); return }
        ;({ error: authErr } = await supabase.auth.signInWithPassword({ email, password: digits }))
      }
      if (authErr) { setError('CPF ou senha incorretos.'); return }
      onAuth()
    } finally { setLoading(false) }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault(); reset()
    if (!validateCPF(cpf)) { setError('CPF inválido.'); return }
    setLoading(true)
    try {
      const r = await callAuth({ action: 'forgot', cpf: cpf.replace(/\D/g, '') })
      if (r.error) setError(r.error)
      else setSuccess(r.message ?? 'Verifique seu e-mail.')
    } finally { setLoading(false) }
  }

  const cpfField = (
    <div>
      <Label>CPF</Label>
      <Field value={cpf} onChange={v => setCpf(formatCPF(v))} placeholder="000.000.000-00" inputMode="numeric" autoComplete="username" />
    </div>
  )

  return (
    <Shell title="Portal do Aluno" subtitle="Seus dados, financeiro, notas e atendimento">
      {mode === 'login' ? (
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cpfField}
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
            <p style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>
              <b style={{ color: GOLD }}>Primeiro acesso?</b> Use o seu CPF (só números) como senha.
            </p>
          </div>
          {error && <Msg kind="error" text={error} />}
          <GoldButton type="submit" loading={loading}>Entrar</GoldButton>
          <button type="button" onClick={() => { setMode('forgot'); reset() }}
            style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            Esqueci minha senha
          </button>
        </form>
      ) : (
        <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>
            Informe seu CPF. Enviaremos um link para o e-mail cadastrado na secretaria.
          </p>
          {cpfField}
          {error && <Msg kind="error" text={error} />}
          {success && <Msg kind="success" text={success} />}
          <GoldButton type="submit" loading={loading}>Enviar link</GoldButton>
          <button type="button" onClick={() => { setMode('login'); reset() }}
            style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            Voltar para o login
          </button>
        </form>
      )}
    </Shell>
  )
}

/** Criar senha nova — obrigatório no 1º acesso (senha = CPF) e no link de "esqueci a senha". */
export function SetPassword({ userId, cpf, reason, onDone, onCancel }: { userId: string; cpf: string; reason: 'first' | 'recovery'; onDone: () => void; onCancel?: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (pw.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); return }
    if (pw.replace(/\D/g, '') === cpf.replace(/\D/g, '')) { setError('A nova senha não pode ser o seu CPF.'); return }
    if (pw !== pw2) { setError('As senhas não conferem.'); return }
    setLoading(true)
    try {
      const { error: uErr } = await supabase.auth.updateUser({ password: pw })
      if (uErr) { setError(uErr.message.includes('different') ? 'Escolha uma senha diferente da atual.' : 'Não foi possível salvar. Tente de novo.'); return }
      await supabase.from('alunos').update({ must_change_password: false }).eq('id', userId)
      onDone()
    } finally { setLoading(false) }
  }

  return (
    <Shell title="Crie sua senha" subtitle={reason === 'first' ? 'Troque a senha padrão (CPF) por uma senha só sua.' : 'Escolha sua nova senha de acesso.'}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Label>Nova senha</Label>
          <Field type={show ? 'text' : 'password'} value={pw} onChange={setPw} placeholder="Mínimo 8 caracteres" autoComplete="new-password"
            suffix={<button type="button" onClick={() => setShow(v => !v)} style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>} />
        </div>
        <div>
          <Label>Repita a senha</Label>
          <Field type={show ? 'text' : 'password'} value={pw2} onChange={setPw2} placeholder="••••••••" autoComplete="new-password" />
        </div>
        {error && <Msg kind="error" text={error} />}
        <GoldButton type="submit" loading={loading}>Salvar e entrar</GoldButton>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            Agora não
          </button>
        )}
      </form>
    </Shell>
  )
}
