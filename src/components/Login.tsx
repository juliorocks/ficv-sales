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
                    <div className="p-4 rounded-3xl bg-white border border-[var(--border)] mb-8 shadow-xl">
                        <img
                            src="https://siteficv.vercel.app/images/test-logo.png"
                            alt="FICV"
                            className="h-12 w-auto object-contain"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    </div>
                    <h1 className="text-3xl font-black font-display text-[var(--text-main)] tracking-tight">SalesPulse</h1>
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
                        className="btn-primary w-full py-4 flex items-center justify-center gap-2 text-lg"
                    >
                        {loading ? (
                            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
