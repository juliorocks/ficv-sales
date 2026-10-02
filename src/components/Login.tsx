import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Mail, Lock, LogIn, ShieldCheck } from 'lucide-react';

export const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) setError(error.message);
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center p-4">
            <div className="glass-card p-10 w-full max-w-md animate-fade-in shadow-2xl">
                <div className="flex flex-col items-center mb-10">
                    <img
                        src="https://siteficv.vercel.app/images/test-logo.png"
                        alt="FICV"
                        className="h-16 w-auto object-contain mb-8"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <h1 className="text-3xl font-black font-display text-[var(--text-main)] tracking-tight">Connect FICV</h1>
                    <p className="text-[var(--text-muted)] mt-2 font-medium">Acesse sua conta para continuar</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--text-main)] ml-1">E-mail</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="seu@email.com"
                                className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-primary transition-all text-[var(--text-main)] placeholder:opacity-50"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-[var(--text-main)] ml-1">Senha</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
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
                        // cor da FICV (dourado, mesma dupla usada no Portal do Aluno) + texto escuro —
                        // pedido do usuário 02/10, só este botão (não mexe no .btn-primary global)
                        className="w-full py-4 rounded-full font-bold text-[#13161D] bg-gradient-to-br from-[#E2C878] to-[#C9A84C] hover:brightness-105 active:scale-95 transition-all shadow-[0_10px_15px_-3px_rgba(201,168,76,0.35)] flex items-center justify-center gap-2 text-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <div className="w-6 h-6 border-2 border-[#13161D]/30 border-t-[#13161D] rounded-full animate-spin" />
                        ) : (
                            <>
                                <LogIn size={20} />
                                Entrar no Sistema
                            </>
                        )}
                    </button>
                </form>

                <p className="text-center text-[var(--text-muted)] text-sm mt-8 opacity-70">
                    Acesso restrito a colaboradores autorizados.
                </p>
            </div>
        </div>
    );
};
