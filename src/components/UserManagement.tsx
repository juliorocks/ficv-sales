import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    Users,
    Shield,
    UserPlus,
    Mail,
    Trash2,
    ShieldCheck,
    ShieldAlert,
    Loader2,
    Search,
    UserCheck,
    Lock
} from 'lucide-react';
import { motion } from 'framer-motion';

interface Profile {
    id: string;
    full_name: string;
    email?: string;
    role: 'admin' | 'agent';
    created_at: string;
}

export const UserManagement: React.FC = () => {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isAddingUser, setIsAddingUser] = useState(false);
    const [formLoading, setFormLoading] = useState(false);
    const [newUser, setNewUser] = useState({
        email: '',
        password: '',
        full_name: '',
        role: 'agent' as 'admin' | 'agent'
    });

    useEffect(() => {
        fetchProfiles();
    }, []);

    const fetchProfiles = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('full_name');

        if (!error && data) {
            setProfiles(data);
        }
        setLoading(false);
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormLoading(true);

        // NOTE: In a production environment with standard Supabase setup, 
        // a regular client cannot create other users.
        // This UI expects a backend function or service role integration.
        // For now, we simulate the request or guide the user.

        alert("Para criar usuários via interface, registre o e-mail no console do Supabase ou adicione uma Edge Function. O sistema está preparado para gerenciar os perfis assim que criados.");

        setFormLoading(false);
        setIsAddingUser(false);
    };

    const toggleRole = async (userId: string, currentRole: string) => {
        const newRole = currentRole === 'admin' ? 'agent' : 'admin';
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);

        if (!error) {
            setProfiles(prev => prev.map(p => p.id === userId ? { ...p, role: newRole } : p));
        }
    };

    const filteredProfiles = profiles.filter(p =>
        p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-fade-in py-6">
            <header className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter mb-1 uppercase">Gestão de Usuários</h2>
                    <p className="text-[var(--text-muted)] text-sm font-medium">Controle de acessos, funções e permissões do sistema FICV.</p>
                </div>
                <button
                    onClick={() => setIsAddingUser(true)}
                    className="btn-primary flex items-center gap-2"
                >
                    <UserPlus size={18} />
                    Convidar Usuário
                </button>
            </header>

            <div className="grid grid-cols-1 gap-6">
                <div className="glass-card p-6">
                    <div className="flex items-center gap-4 mb-8 bg-[var(--bg-card-hover)] p-3 rounded-2xl border border-[var(--border)] max-w-md">
                        <Search size={18} className="text-[var(--text-muted)] ml-2" />
                        <input
                            type="text"
                            placeholder="Buscar por nome ou e-mail..."
                            className="bg-transparent border-none outline-none text-sm text-[var(--text-main)] w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-[var(--text-muted)] text-[10px] font-bold uppercase tracking-[0.2em] border-b border-[var(--border)]">
                                    <th className="pb-4 px-4 font-bold">Usuário</th>
                                    <th className="pb-4 px-4 font-bold text-center">Nível de Acesso</th>
                                    <th className="pb-4 px-4 font-bold text-center">Data Cadastro</th>
                                    <th className="pb-4 px-4 font-bold text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="py-20 text-center">
                                            <Loader2 size={32} className="animate-spin text-primary mx-auto opacity-50" />
                                        </td>
                                    </tr>
                                ) : filteredProfiles.map((p) => (
                                    <tr key={p.id} className="group hover:bg-[var(--bg-card-hover)] transition-all">
                                        <td className="py-4 px-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm transition-transform group-hover:scale-110 ${p.role === 'admin' ? 'bg-primary/20 text-primary border border-primary/20' : 'bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border)]'}`}>
                                                    {p.full_name?.charAt(0) || 'U'}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-[var(--text-main)] group-hover:text-primary transition-colors">{p.full_name || 'Usuário Sem Nome'}</p>
                                                    <p className="text-[10px] text-[var(--text-muted)]">{p.email || 'E-mail não visível'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <button
                                                onClick={() => toggleRole(p.id, p.role)}
                                                className={`mx-auto flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${p.role === 'admin' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-[var(--border)] border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                                            >
                                                {p.role === 'admin' ? <ShieldCheck size={12} /> : <Shield size={12} />}
                                                {p.role === 'admin' ? 'Administrador' : 'Agente'}
                                            </button>
                                        </td>
                                        <td className="py-4 px-4 text-center text-[10px] text-[var(--text-muted)] font-mono">
                                            {p.created_at ? new Date(p.created_at).toLocaleDateString() : '--/--/----'}
                                        </td>
                                        <td className="py-4 px-4 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button className="p-2 text-[var(--text-muted)] hover:text-red-400 transition-colors">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal de Convite */}
            {isAddingUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="w-full max-w-md glass-card p-8 shadow-2xl overflow-hidden relative"
                    >
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent" />

                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                                <UserPlus size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[var(--text-main)]">Novo Usuário</h3>
                                <p className="text-xs text-[var(--text-muted)] font-medium">Cadastre um novo membro da equipe FICV.</p>
                            </div>
                        </div>

                        <form onSubmit={handleCreateUser} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Nome Completo</label>
                                <input
                                    className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--text-main)] focus:border-primary outline-none transition-all placeholder:opacity-30"
                                    placeholder="Ex: João Silva"
                                    value={newUser.full_name}
                                    onChange={e => setNewUser({ ...newUser, full_name: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">E-mail Corporativo</label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] opacity-50" size={16} />
                                    <input
                                        type="email"
                                        className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl py-4 pl-12 pr-4 text-sm text-[var(--text-main)] focus:border-primary outline-none transition-all placeholder:opacity-30 font-medium"
                                        placeholder="email@ficv.com.br"
                                        value={newUser.email}
                                        onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Definir Senha Temporária</label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] opacity-50" size={16} />
                                    <input
                                        type="password"
                                        className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl py-4 pl-12 pr-4 text-sm text-[var(--text-main)] focus:border-primary outline-none transition-all placeholder:opacity-30 font-medium"
                                        placeholder="No mínimo 6 caracteres"
                                        value={newUser.password}
                                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                        required
                                        minLength={6}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Nível de Acesso</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setNewUser({ ...newUser, role: 'agent' })}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${newUser.role === 'agent' ? 'bg-primary/20 border-primary/50 text-white' : 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:border-primary/30'}`}
                                    >
                                        <Shield size={14} /> Agente
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setNewUser({ ...newUser, role: 'admin' })}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${newUser.role === 'admin' ? 'bg-primary/20 border-primary/50 text-white' : 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:border-primary/30'}`}
                                    >
                                        <ShieldCheck size={14} /> Admin
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsAddingUser(false)}
                                    className="flex-1 py-4 text-[var(--text-muted)] hover:text-[var(--text-main)] font-bold text-sm transition-all"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={formLoading}
                                    className="flex-[2] btn-primary py-4 flex items-center justify-center gap-2"
                                >
                                    {formLoading ? <Loader2 size={18} className="animate-spin" /> : <UserCheck size={18} />}
                                    Finalizar Convite
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}
        </div>
    );
};
