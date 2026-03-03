import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Edit3, Check, X, Loader2, FileText, Link, Camera, User, Target, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export interface AgentProfileData {
    id: string;
    name: string;
    photo_url: string | null;
    score_target: number;
    email: string | null;
    phone: string | null;
    notes: string | null;
    active: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useAgentProfiles = () => {
    const [profiles, setProfiles] = useState<AgentProfileData[]>([]);
    const [loading, setLoading] = useState(true);

    const fetch = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase.from('agent_profiles').select('*').order('name');
        setProfiles(data ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { fetch(); }, [fetch]);
    return { profiles, loading, refresh: fetch };
};

// ─── Agent Avatar (reusable) ──────────────────────────────────────────────────
export const AgentAvatar: React.FC<{
    name: string;
    photoUrl?: string | null;
    size?: number;
    className?: string;
}> = ({ name, photoUrl, size = 40, className = '' }) => {
    const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const colors = ['#5551FF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA', '#38BDF8'];
    const colorIdx = name.charCodeAt(0) % colors.length;

    return (
        <div
            className={`rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 border-2 border-[var(--border)] ${className}`}
            style={{ width: size, height: size }}
        >
            {photoUrl ? (
                <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
            ) : (
                <div
                    className="w-full h-full flex items-center justify-center text-white font-bold"
                    style={{ background: colors[colorIdx], fontSize: size * 0.35 }}
                >
                    {initials}
                </div>
            )}
        </div>
    );
};

// ─── Agent Card Editor ────────────────────────────────────────────────────────
const AgentCard: React.FC<{
    agent: AgentProfileData;
    agentStats: { score: number; total: number } | undefined;
    isAdmin: boolean;
    onRefresh: () => void;
    onGenerateReport: (agent: AgentProfileData) => void;
}> = ({ agent, agentStats, isAdmin, onRefresh, onGenerateReport }) => {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({
        photo_url: agent.photo_url ?? '',
        score_target: String(agent.score_target),
        email: agent.email ?? '',
        phone: agent.phone ?? '',
        notes: agent.notes ?? '',
    });

    useEffect(() => {
        setForm({
            photo_url: agent.photo_url ?? '',
            score_target: String(agent.score_target),
            email: agent.email ?? '',
            phone: agent.phone ?? '',
            notes: agent.notes ?? '',
        });
    }, [agent]);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const save = async () => {
        setSaving(true);
        await supabase.from('agent_profiles').update({
            photo_url: form.photo_url || null,
            score_target: parseFloat(form.score_target) || 8.0,
            email: form.email || null,
            phone: form.phone || null,
            notes: form.notes || null,
        }).eq('id', agent.id);
        setSaving(false);
        setEditing(false);
        onRefresh();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        const ext = file.name.split('.').pop();
        const path = `agents/${agent.id}.${ext}`;
        const { error } = await supabase.storage.from('agent-photos').upload(path, file, { upsert: true });
        if (!error) {
            const { data: urlData } = supabase.storage.from('agent-photos').getPublicUrl(path);
            setForm(f => ({ ...f, photo_url: urlData.publicUrl }));
        }
        setUploading(false);
    };

    const score = agentStats?.score ?? 0;
    const target = agent.score_target;
    const pct = Math.min(100, (score / 10) * 100);
    const onTarget = score >= target;

    return (
        <div className={`glass-card p-6 transition-all ${onTarget ? 'border-[#00D4AA]/20' : ''}`}>
            <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="relative">
                    <AgentAvatar name={agent.name} photoUrl={form.photo_url || agent.photo_url} size={64} />
                    {editing && isAdmin && (
                        <label className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors">
                            {uploading ? <Loader2 size={10} className="animate-spin text-white" /> : <Camera size={10} className="text-white" />}
                            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                        </label>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="font-bold text-[var(--text-main)] truncate">{agent.name}</h3>
                        {isAdmin && (
                            editing ? (
                                <div className="flex gap-1">
                                    <button onClick={save} disabled={saving} className="w-7 h-7 rounded-lg bg-[#00D4AA]/20 text-[#00D4AA] flex items-center justify-center hover:bg-[#00D4AA]/30 transition-colors">
                                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                    </button>
                                    <button onClick={() => setEditing(false)} className="w-7 h-7 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--border)] transition-colors">
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <button onClick={() => setEditing(true)} className="w-7 h-7 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--border)] transition-colors">
                                    <Edit3 size={12} />
                                </button>
                            )
                        )}
                    </div>

                    {/* Score bar */}
                    <div className="mb-3">
                        <div className="flex justify-between text-[10px] mb-1">
                            <span className="text-[var(--text-muted)]">Score IA</span>
                            <span className={`font-bold ${onTarget ? 'text-[#00D4AA]' : 'text-[#FFB347]'}`}>
                                {score.toFixed(1)} / meta {target.toFixed(1)}
                            </span>
                        </div>
                        <div className="h-2 bg-[var(--bg-card-hover)] rounded-full overflow-hidden border border-[var(--border)]">
                            <div
                                className="h-full rounded-full transition-all duration-1000"
                                style={{
                                    width: `${pct}%`,
                                    background: onTarget ? '#00D4AA' : score >= target * 0.7 ? '#5551FF' : '#FFB347'
                                }}
                            />
                        </div>
                        {/* Target marker */}
                        <div className="relative h-0">
                            <div
                                className="absolute top-0 w-0.5 h-3 bg-white/40"
                                style={{ left: `${(target / 10) * 100}%`, transform: 'translateX(-50%) translateY(-10px)' }}
                            />
                        </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex gap-4 text-[10px] text-[var(--text-muted)] mb-3">
                        <span>{agentStats?.total ?? 0} atendimentos</span>
                        {agent.email && <span className="truncate">{agent.email}</span>}
                    </div>

                    {editing && isAdmin ? (
                        <div className="space-y-2 mt-3 border-t border-[var(--border)] pt-3">
                            <input
                                placeholder="URL da foto (ou use o botão acima)"
                                value={form.photo_url}
                                onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))}
                                className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                                <input placeholder="Telefone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-[var(--text-muted)]">Meta Score:</label>
                                <input type="number" min={0} max={10} step={0.1} value={form.score_target} onChange={e => setForm(f => ({ ...f, score_target: e.target.value }))} className="w-20 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                            </div>
                            <textarea placeholder="Notas internas..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary resize-none" />
                        </div>
                    ) : (
                        agent.notes && <p className="text-[10px] text-[var(--text-muted)] truncate">{agent.notes}</p>
                    )}
                </div>
            </div>

            {/* Report button */}
            <button
                onClick={() => onGenerateReport(agent)}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 border border-[var(--border)] rounded-xl text-[11px] font-bold text-[var(--text-muted)] hover:border-primary/50 hover:text-primary transition-all group"
            >
                <FileText size={12} className="group-hover:scale-110 transition-transform" />
                Gerar Relatório Mensal
                <ChevronRight size={12} />
            </button>
        </div>
    );
};

// ─── Report Generator Modal ───────────────────────────────────────────────────
const ReportModal: React.FC<{
    agent: AgentProfileData;
    onClose: () => void;
}> = ({ agent, onClose }) => {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [generating, setGenerating] = useState(false);
    const [link, setLink] = useState('');

    const generate = async () => {
        setGenerating(true);
        const { data, error } = await supabase
            .from('agent_reports')
            .upsert({ agent_name: agent.name, year, month, status: 'published' }, { onConflict: 'agent_name,year,month' })
            .select('share_token')
            .single();
        if (!error && data) {
            const url = `${window.location.origin}/relatorio/${data.share_token}`;
            setLink(url);
        }
        setGenerating(false);
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-md glass-card p-8 m-4">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="font-bold text-[var(--text-main)]">Gerar Relatório</h3>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">{agent.name}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--border)] transition-colors">
                        <X size={14} />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-2">Mês</label>
                        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary">
                            {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-2">Ano</label>
                        <select value={year} onChange={e => setYear(Number(e.target.value))} className="w-full bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary">
                            {[now.getFullYear() - 1, now.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>

                {link ? (
                    <div className="space-y-3">
                        <p className="text-[11px] text-[#00D4AA] font-bold">✓ Relatório gerado com sucesso!</p>
                        <div className="flex gap-2">
                            <input readOnly value={link} className="flex-1 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-muted)] focus:outline-none" />
                            <button onClick={() => navigator.clipboard.writeText(link)} className="btn-primary flex items-center gap-1 text-xs">
                                <Link size={12} /> Copiar
                            </button>
                        </div>
                        <button
                            onClick={() => window.open(link, '_blank')}
                            className="w-full py-2.5 border border-primary/30 text-primary rounded-xl text-xs font-bold hover:bg-primary/10 transition-colors"
                        >
                            Visualizar Relatório →
                        </button>
                    </div>
                ) : (
                    <button onClick={generate} disabled={generating} className="btn-primary w-full flex items-center justify-center gap-2">
                        {generating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                        {generating ? 'Gerando...' : `Gerar Relatório de ${MONTH_NAMES[month - 1]}`}
                    </button>
                )}
            </div>
        </div>
    );
};

// ─── Main AgentAdmin Page ─────────────────────────────────────────────────────
interface AgentAdminProps {
    isAdmin: boolean;
    analysisData: any[];
    selectedAgents?: string[];
}

export const AgentAdmin: React.FC<AgentAdminProps> = ({ isAdmin, analysisData, selectedAgents }) => {
    const { profiles, loading, refresh } = useAgentProfiles();
    const [reportTarget, setReportTarget] = useState<AgentProfileData | null>(null);
    const [addingName, setAddingName] = useState('');
    const [addingOpen, setAddingOpen] = useState(false);
    const [adding, setAdding] = useState(false);

    const displayedProfiles = React.useMemo(() => {
        const showAll = !selectedAgents || selectedAgents.length === 0 || selectedAgents.includes('all');
        if (showAll) return profiles;
        return profiles.filter(p => selectedAgents.includes(p.name));
    }, [profiles, selectedAgents]);

    // Compute per-agent stats from analysisData
    const agentStats = React.useMemo(() => {
        const map: Record<string, { score: number; total: number }> = {};
        analysisData.forEach(d => {
            if (!map[d.agent]) map[d.agent] = { score: 0, total: 0 };
            map[d.agent].score += d.finalScore;
            map[d.agent].total++;
        });
        Object.keys(map).forEach(k => { map[k].score = map[k].score / map[k].total; });
        return map;
    }, [analysisData]);

    // Auto-sync agent names from analysisData into agent_profiles
    useEffect(() => {
        if (analysisData.length === 0) return;

        const syncNames = async () => {
            const names = [...new Set(analysisData.map(d => d.agent).filter(Boolean))];

            // Filter names that are not already in profiles to avoid redundant upserts
            const existingNames = new Set(profiles.map(p => p.name));
            const newNames = names.filter(name => !existingNames.has(name));

            if (newNames.length > 0) {
                for (const name of newNames) {
                    await supabase.from('agent_profiles').upsert({ name }, { onConflict: 'name', ignoreDuplicates: true });
                }
                refresh();
            }
        };

        syncNames();
    }, [analysisData.length, profiles.length]);


    const addAgent = async () => {
        if (!addingName.trim()) return;
        setAdding(true);
        await supabase.from('agent_profiles').insert({ name: addingName.trim() });
        setAddingName('');
        setAddingOpen(false);
        setAdding(false);
        refresh();
    };

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-[var(--text-main)] tracking-tight">Agentes</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-1">Gerencie perfis, fotos e relatórios das agentes.</p>
                </div>
                {isAdmin && (
                    addingOpen ? (
                        <div className="flex gap-2">
                            <input
                                autoFocus
                                placeholder="Nome da agente"
                                value={addingName}
                                onChange={e => setAddingName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addAgent()}
                                className="bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary"
                            />
                            <button onClick={addAgent} disabled={adding} className="btn-primary flex items-center gap-1 text-sm">
                                {adding ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            </button>
                            <button onClick={() => setAddingOpen(false)} className="w-9 h-9 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-muted)] flex items-center justify-center">
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => setAddingOpen(true)} className="btn-primary flex items-center gap-2 text-sm">
                            <Plus size={14} /> Nova Agente
                        </button>
                    )
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-primary" /></div>
            ) : (
                <>
                    {/* Summary strip */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="glass-card p-4 text-center">
                            <p className="text-2xl font-black text-[var(--text-main)]">{displayedProfiles.filter(p => p.active).length}</p>
                            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">Agentes ativas</p>
                        </div>
                        <div className="glass-card p-4 text-center">
                            <p className="text-2xl font-black text-[#00D4AA]">
                                {displayedProfiles.filter(p => (agentStats[p.name]?.score ?? 0) >= p.score_target).length}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">Acima da meta</p>
                        </div>
                        <div className="glass-card p-4 text-center">
                            <p className="text-2xl font-black text-[#FFB347]">
                                {displayedProfiles.filter(p => (agentStats[p.name]?.score ?? 0) < p.score_target && (agentStats[p.name]?.total ?? 0) > 0).length}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">Abaixo da meta</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {displayedProfiles.map(agent => (
                            <AgentCard
                                key={agent.id}
                                agent={agent}
                                agentStats={agentStats[agent.name]}
                                isAdmin={isAdmin}
                                onRefresh={refresh}
                                onGenerateReport={setReportTarget}
                            />
                        ))}
                    </div>
                </>
            )}

            {reportTarget && (
                <ReportModal agent={reportTarget} onClose={() => setReportTarget(null)} />
            )}
        </div>
    );
};
