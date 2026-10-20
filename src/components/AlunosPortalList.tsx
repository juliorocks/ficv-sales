import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Search, GraduationCap } from 'lucide-react';

interface AlunoRow {
    id: string;
    nome: string;
    cpf: string | null;
    email: string | null;
    telefone: string | null;
    last_login_at: string | null;
    app_instalado_em: string | null;
    must_change_password: boolean | null;
}

const mascararCpf = (cpf: string | null) => {
    const d = (cpf ?? '').replace(/\D/g, '');
    return d.length === 11 ? `***.***.***-${d.slice(9)}` : '—';
};

const fmtData = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const AlunosPortalList: React.FC = () => {
    const [busca, setBusca] = useState('');
    const termo = busca.trim();

    const { data: alunos = [], isLoading, error } = useQuery<AlunoRow[]>({
        queryKey: ['alunos-portal-list', termo],
        queryFn: async () => {
            let q = supabase
                .from('alunos')
                .select('id, nome, cpf, email, telefone, last_login_at, app_instalado_em, must_change_password')
                .order('nome')
                .limit(200);
            if (termo.length >= 2) {
                const like = `%${termo.replace(/[%_]/g, '')}%`;
                q = q.or(`nome.ilike.${like},email.ilike.${like}`);
            }
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as AlunoRow[];
        },
        staleTime: 60_000,
    });

    return (
        <div className="glass-card p-6 mt-6">
            <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-primary/10 rounded-xl text-primary"><GraduationCap size={20} /></div>
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text-main)]">Alunos do Portal</h3>
                        <p className="text-xs text-[var(--text-muted)]">Contas criadas no Portal do Aluno ({alunos.length} exibidos).</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 bg-[var(--bg-card-hover)] p-2.5 rounded-2xl border border-[var(--border)] w-full max-w-sm">
                    <Search size={16} className="text-[var(--text-muted)] ml-1" />
                    <input
                        type="text"
                        placeholder="Buscar aluno por nome ou e-mail..."
                        className="bg-transparent border-none outline-none text-sm text-[var(--text-main)] w-full"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                    />
                </div>
            </div>

            {error && <p className="text-sm text-red-500">Não foi possível carregar os alunos.</p>}

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="py-3 px-2 font-bold">Aluno</th>
                            <th className="py-3 px-2 font-bold">CPF</th>
                            <th className="py-3 px-2 font-bold">Telefone</th>
                            <th className="py-3 px-2 font-bold">Último acesso</th>
                            <th className="py-3 px-2 font-bold">App</th>
                            <th className="py-3 px-2 font-bold">Senha</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">Carregando…</td></tr>
                        )}
                        {!isLoading && alunos.length === 0 && (
                            <tr><td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">Nenhum aluno encontrado.</td></tr>
                        )}
                        {alunos.map((a) => (
                            <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                                <td className="py-3 px-2">
                                    <p className="font-semibold text-[var(--text-main)]">{a.nome}</p>
                                    <p className="text-[11px] text-[var(--text-muted)]">{a.email ?? '—'}</p>
                                </td>
                                <td className="py-3 px-2 font-mono text-xs text-[var(--text-muted)]">{mascararCpf(a.cpf)}</td>
                                <td className="py-3 px-2 text-xs text-[var(--text-muted)]">{a.telefone ?? '—'}</td>
                                <td className="py-3 px-2 text-xs text-[var(--text-muted)]">{fmtData(a.last_login_at)}</td>
                                <td className="py-3 px-2 text-xs">
                                    {a.app_instalado_em
                                        ? <span className="text-emerald-500 font-semibold">Instalado</span>
                                        : <span className="text-[var(--text-muted)]">Navegador</span>}
                                </td>
                                <td className="py-3 px-2 text-xs">
                                    {a.must_change_password
                                        ? <span className="text-amber-500 font-semibold">Ainda o CPF</span>
                                        : <span className="text-[var(--text-muted)]">Trocada</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
