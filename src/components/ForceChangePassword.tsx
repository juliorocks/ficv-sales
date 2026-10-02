// ForceChangePassword — gate de troca obrigatória de senha pra equipe (CRM/Chamados),
// mesma ideia do SetPassword do Portal do Aluno (AlunoAuth.tsx), só que com o visual do CRM.
// Entra entre "sessão válida" e "renderiza o App" (ver FullApp em App.tsx), quando
// profiles.must_change_password é true — admin criou a conta ou resetou a senha, então quem
// escolheu a senha foi ele, não a pessoa. Pedido do usuário 02/10.
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, LogOut, ShieldCheck } from 'lucide-react';

export const ForceChangePassword: React.FC<{ userId: string; onDone: () => void }> = ({ userId, onDone }) => {
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (pw1.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres.'); return; }
        if (pw1 !== pw2) { setError('As senhas não conferem.'); return; }
        setLoading(true);
        try {
            const { error: uErr } = await supabase.auth.updateUser({ password: pw1 });
            if (uErr) { setError(uErr.message.includes('different') ? 'Escolha uma senha diferente da atual.' : uErr.message); return; }
            const { error: pErr } = await supabase.from('profiles').update({ must_change_password: false }).eq('id', userId);
            if (pErr) { setError('Senha trocada, mas não consegui atualizar o cadastro — recarregue a página.'); return; }
            onDone();
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center p-4">
            <div className="glass-card p-10 w-full max-w-md animate-fade-in shadow-2xl">
                <div className="flex flex-col items-center mb-10">
                    <div className="p-4 rounded-2xl bg-[#C9A84C]/10 text-[#C9A84C] mb-6">
                        <ShieldCheck size={32} />
                    </div>
                    <h1 className="text-2xl font-black font-display text-[var(--text-main)] tracking-tight text-center">Crie sua senha</h1>
                    <p className="text-[var(--text-muted)] mt-2 font-medium text-center">
                        Por segurança, troque a senha temporária por uma só sua antes de continuar.
                    </p>
                </div>

                <form onSubmit={submit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--text-main)] ml-1">Nova senha</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
                            <input
                                type="password"
                                value={pw1}
                                onChange={(e) => setPw1(e.target.value)}
                                placeholder="mín. 6 caracteres"
                                autoComplete="new-password"
                                className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-primary transition-all text-[var(--text-main)] placeholder:opacity-50"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--text-main)] ml-1">Confirmar nova senha</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
                            <input
                                type="password"
                                value={pw2}
                                onChange={(e) => setPw2(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="new-password"
                                className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-primary transition-all text-[var(--text-main)] placeholder:opacity-50"
                                required
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-danger/20 border border-danger/10 text-danger text-sm p-3 rounded-lg text-center animate-shake">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 rounded-full font-bold text-[#13161D] bg-gradient-to-br from-[#E2C878] to-[#C9A84C] hover:brightness-105 active:scale-95 transition-all shadow-[0_10px_15px_-3px_rgba(201,168,76,0.35)] flex items-center justify-center gap-2 text-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <div className="w-6 h-6 border-2 border-[#13161D]/30 border-t-[#13161D] rounded-full animate-spin" />
                        ) : (
                            <>
                                <ShieldCheck size={20} />
                                Salvar e entrar
                            </>
                        )}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={() => supabase.auth.signOut()}
                    className="flex items-center justify-center gap-1.5 w-full text-center text-[var(--text-muted)] text-xs mt-8 opacity-70 hover:opacity-100 transition-opacity"
                >
                    <LogOut size={12} /> Sair
                </button>
            </div>
        </div>
    );
};
