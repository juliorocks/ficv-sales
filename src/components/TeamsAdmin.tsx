import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit3, Trash2, Check, X, Loader2, Copy, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Membros da equipe (agentes) ───────────────────────────────────────────
interface AgentRef { id: string; name: string; active: boolean }

const TeamMembers: React.FC<{ teamId: string; isAdmin: boolean }> = ({ teamId, isAdmin }) => {
    const [allAgents, setAllAgents] = useState<AgentRef[]>([]);
    const [memberIds, setMemberIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [pick, setPick] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: agents }, { data: members }] = await Promise.all([
            supabase.from('agent_profiles').select('id, name, active').eq('active', true).order('name'),
            supabase.from('agent_team').select('agent_id').eq('team_id', teamId),
        ]);
        setAllAgents(agents ?? []);
        setMemberIds((members ?? []).map((m: any) => m.agent_id));
        setLoading(false);
    }, [teamId]);

    useEffect(() => { load(); }, [load]);

    const members = allAgents.filter(a => memberIds.includes(a.id));
    const available = allAgents.filter(a => !memberIds.includes(a.id));

    const addMember = async () => {
        if (!pick) return;
        await supabase.from('agent_team').insert({ agent_id: pick, team_id: teamId });
        setPick('');
        setAdding(false);
        load();
    };
    const removeMember = async (agentId: string) => {
        await supabase.from('agent_team').delete().eq('agent_id', agentId).eq('team_id', teamId);
        load();
    };

    if (loading) return null;

    return (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-2">
                Agentes ({members.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
                {members.map(a => (
                    <span key={a.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[var(--bg-card-hover)] text-[var(--text-main)]">
                        {a.name}
                        {isAdmin && (
                            <button onClick={() => removeMember(a.id)} className="text-[var(--text-muted)] hover:text-red-400">
                                <X size={11} />
                            </button>
                        )}
                    </span>
                ))}
                {!members.length && <span className="text-[11px] text-[var(--text-muted)]">Nenhum agente nesta equipe.</span>}
            </div>
            {isAdmin && (
                adding ? (
                    <div className="flex gap-2 mt-2">
                        <select
                            autoFocus
                            value={pick}
                            onChange={e => setPick(e.target.value)}
                            className="bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary flex-1"
                        >
                            <option value="">Selecione um agente...</option>
                            {available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <button onClick={addMember} disabled={!pick} className="w-8 h-8 rounded-lg bg-[#00D4AA]/20 text-[#00D4AA] flex items-center justify-center flex-shrink-0"><Check size={14} /></button>
                        <button onClick={() => { setAdding(false); setPick(''); }} className="w-8 h-8 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center flex-shrink-0"><X size={14} /></button>
                    </div>
                ) : (
                    <button
                        onClick={() => setAdding(true)}
                        className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
                        disabled={!available.length}
                    >
                        <UserPlus size={12} /> Adicionar agente
                    </button>
                )
            )}
        </div>
    );
};

export interface Team {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    active: boolean;
    created_at: string;
}

// Hook para carregar equipes
export const useTeams = () => {
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);

    const fetch = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('teams')
            .select('*')
            .order('name');
        setTeams(data ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { fetch(); }, [fetch]);
    return { teams, loading, refresh: fetch };
};

// Componente de card para editar equipe
const TeamCard: React.FC<{
    team: Team;
    onRefresh: () => void;
    onDelete: (id: string) => void;
    isAdmin: boolean;
}> = ({ team, onRefresh, onDelete, isAdmin }) => {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({
        name: team.name,
        description: team.description ?? '',
        icon: team.icon,
        color: team.color,
        active: team.active,
    });
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        await supabase.from('teams').update({
            name: form.name,
            description: form.description || null,
            icon: form.icon,
            color: form.color,
            active: form.active,
        }).eq('id', team.id);
        setSaving(false);
        setEditing(false);
        onRefresh();
    };

    const handleDelete = async () => {
        if (!confirm(`Tem certeza que deseja deletar a equipe "${team.name}"?`)) return;
        await supabase.from('teams').delete().eq('id', team.id);
        onDelete(team.id);
    };

    const EMOJI_PRESETS = ['💼', '📋', '🎓', '💰', '🔧', '👥', '📞', '🎨', '💻', '📊', '🏆', '⭐'];
    const COLOR_PRESETS = ['#5551FF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA', '#38BDF8', '#10B981', '#F59E0B'];

    return (
        <div className="glass-card p-6">
            <div className="flex items-start justify-between mb-4">
                {editing ? (
                    <div className="flex-1">
                        <input
                            placeholder="Nome da equipe"
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-main)] focus:outline-none focus:border-primary mb-2"
                        />
                        <textarea
                            placeholder="Descrição (opcional)"
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            rows={2}
                            className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary resize-none"
                        />
                    </div>
                ) : (
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-[var(--text-main)]">{team.icon} {team.name}</h3>
                        {team.description && (
                            <p className="text-xs text-[var(--text-muted)] mt-1">{team.description}</p>
                        )}
                        <p className="text-[10px] text-[var(--text-muted)] mt-2">
                            {team.active ? '🟢 Ativa' : '🔴 Inativa'}
                        </p>
                    </div>
                )}

                {isAdmin && (
                    <div className="flex gap-1 ml-4 flex-shrink-0">
                        {editing ? (
                            <>
                                <button
                                    onClick={save}
                                    disabled={saving}
                                    className="w-8 h-8 rounded-lg bg-[#00D4AA]/20 text-[#00D4AA] flex items-center justify-center hover:bg-[#00D4AA]/30 transition-colors"
                                >
                                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                </button>
                                <button
                                    onClick={() => setEditing(false)}
                                    className="w-8 h-8 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--border)] transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setEditing(true)}
                                    className="w-8 h-8 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--border)] transition-colors"
                                >
                                    <Edit3 size={14} />
                                </button>
                                <button
                                    onClick={handleDelete}
                                    className="w-8 h-8 rounded-lg bg-[var(--bg-card-hover)] text-red-400/60 flex items-center justify-center hover:bg-red-400/10 hover:text-red-400 transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {editing && (
                <div className="space-y-3 border-t border-[var(--border)] pt-3">
                    {/* Icon selector */}
                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Ícone:</label>
                        <div className="grid grid-cols-6 gap-2 mt-2">
                            {EMOJI_PRESETS.map(emoji => (
                                <button
                                    key={emoji}
                                    onClick={() => setForm(f => ({ ...f, icon: emoji }))}
                                    className={`p-2 rounded-lg text-xl transition-all ${
                                        form.icon === emoji
                                            ? 'bg-primary/20 border border-primary'
                                            : 'bg-[var(--bg-card-hover)] border border-[var(--border)] hover:border-primary/50'
                                    }`}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Color selector */}
                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Cor:</label>
                        <div className="flex gap-2 mt-2 flex-wrap">
                            {COLOR_PRESETS.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setForm(f => ({ ...f, color: c }))}
                                    className={`w-8 h-8 rounded-lg transition-all border-2 ${
                                        form.color === c ? 'border-white scale-110' : 'border-[var(--border)]'
                                    }`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Active toggle */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.active}
                            onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                            className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-xs text-[var(--text-main)]">Equipe ativa</span>
                    </label>
                </div>
            )}

            {/* Badge preview */}
            {!editing && (
                <div className="mt-4">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-2">Prévia:</p>
                    <span
                        className="inline-block px-3 py-1 rounded-full text-sm font-medium"
                        style={{ backgroundColor: team.color + '20', color: team.color }}
                    >
                        {team.icon} {team.name}
                    </span>
                </div>
            )}

            <TeamMembers teamId={team.id} isAdmin={isAdmin} />
        </div>
    );
};

// Main component
interface TeamsAdminProps {
    isAdmin: boolean;
}

export const TeamsAdmin: React.FC<TeamsAdminProps> = ({ isAdmin }) => {
    const { teams, loading, refresh } = useTeams();
    const [addingName, setAddingName] = useState('');
    const [addingOpen, setAddingOpen] = useState(false);
    const [adding, setAdding] = useState(false);

    const addTeam = async () => {
        if (!addingName.trim()) return;
        setAdding(true);
        try {
            const { data, error } = await supabase.from('teams').insert({
                name: addingName.trim(),
                icon: '👥',
                color: '#5551FF',
                active: true,
            }).select();

            if (error) {
                console.error('❌ Erro ao criar equipe:', error);
                alert(`Erro: ${error.message}`);
            } else {
                console.log('✅ Equipe criada:', data);
                setAddingName('');
                setAddingOpen(false);
                await new Promise(r => setTimeout(r, 500)); // pequeno delay
                refresh();
            }
        } catch (err: any) {
            console.error('❌ Erro ao criar equipe:', err);
            alert(`Erro: ${err.message}`);
        }
        setAdding(false);
    };

    const handleDelete = (id: string) => {
        refresh();
    };

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-[var(--text-main)] tracking-tight">Equipes</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-1">Gerencie as equipes e departamentos da FICV.</p>
                </div>
                {isAdmin && (
                    addingOpen ? (
                        <div className="flex gap-2">
                            <input
                                autoFocus
                                placeholder="Nome da equipe"
                                value={addingName}
                                onChange={e => setAddingName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addTeam()}
                                className="bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary"
                            />
                            <button onClick={addTeam} disabled={adding} className="btn-primary flex items-center gap-1 text-sm">
                                {adding ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            </button>
                            <button onClick={() => setAddingOpen(false)} className="w-9 h-9 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center">
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setAddingOpen(true)}
                            className="btn-primary flex items-center gap-2"
                        >
                            <Plus size={16} />
                            Nova Equipe
                        </button>
                    )
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-primary" />
                </div>
            ) : teams.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <p className="text-[var(--text-muted)] mb-4">Nenhuma equipe criada ainda.</p>
                    {isAdmin && (
                        <button
                            onClick={() => setAddingOpen(true)}
                            className="btn-primary flex items-center justify-center gap-2 mx-auto"
                        >
                            <Plus size={14} /> Criar primeira equipe
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {teams.map(team => (
                        <TeamCard
                            key={team.id}
                            team={team}
                            onRefresh={refresh}
                            onDelete={handleDelete}
                            isAdmin={isAdmin}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
