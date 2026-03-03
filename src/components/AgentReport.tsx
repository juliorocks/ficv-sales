import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';
import { supabase } from '../lib/supabase';
import { AgentAvatar } from './AgentAdmin';
import { Award, TrendingUp, MessageSquare, Target, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ─── Score Badge ──────────────────────────────────────────────────────────────
const ScoreBadge: React.FC<{ score: number; target: number }> = ({ score, target }) => {
    const pct = Math.min(100, (score / 10) * 100);
    const color = score >= target ? '#00D4AA' : score >= target * 0.85 ? '#5551FF' : '#FFB347';
    return (
        <div className="relative w-36 h-36">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="10" />
                <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke={color} strokeWidth="10"
                    strokeDasharray={`${2 * Math.PI * 50}`}
                    strokeDashoffset={`${2 * Math.PI * 50 * (1 - pct / 100)}`}
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: 'stroke-dashoffset 1.5s ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-[var(--text-main)]">{score.toFixed(1)}</span>
                <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">score IA</span>
            </div>
        </div>
    );
};

// ─── Stat Mini Card ───────────────────────────────────────────────────────────
const MiniStat: React.FC<{ label: string; value: string | number; sub?: string; color?: string }> = ({ label, value, sub, color = 'text-[var(--text-main)]' }) => (
    <div className="glass-card p-5 text-center">
        <p className={`text-2xl font-black ${color}`}>{value}</p>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mt-1">{label}</p>
        {sub && <p className="text-[10px] text-[var(--text-muted)] mt-1">{sub}</p>}
    </div>
);

// ─── Section wrapper ──────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
    <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-primary/10 rounded-lg">{icon}</div>
            <h2 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-widest">{title}</h2>
        </div>
        {children}
    </div>
);

// ─── Main Report Page ─────────────────────────────────────────────────────────
export const AgentReportPage: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reportMeta, setReportMeta] = useState<any>(null);
    const [agentProfile, setAgentProfile] = useState<any>(null);
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        const isDark = localStorage.getItem('darkMode') === 'true';
        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, []);

    useEffect(() => {
        if (!token) { setError('Token inválido.'); setLoading(false); return; }
        loadReport();
    }, [token]);

    const loadReport = async () => {
        // 1. Load report meta
        const { data: rep } = await supabase.from('agent_reports').select('*').eq('share_token', token).single();
        if (!rep) { setError('Relatório não encontrado.'); setLoading(false); return; }
        setReportMeta(rep);

        // 2. Load agent profile
        const { data: prof } = await supabase.from('agent_profiles').select('*').eq('name', rep.agent_name).single();
        setAgentProfile(prof);

        // 3. Load agent conversation data for that month/year (approved only)
        const startDate = `${rep.year}-${String(rep.month).padStart(2, '0')}-01T00:00:00`;
        const lastDay = new Date(rep.year, rep.month, 0).getDate();
        const endDate = `${rep.year}-${String(rep.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59`;

        const { data: convs } = await supabase
            .from('messages_logs')
            .select('*')
            .eq('agent_name', rep.agent_name)
            .neq('status', 'invalidated')
            .gte('timestamp', startDate)
            .lte('timestamp', endDate)
            .order('timestamp');

        setData(convs ?? []);
        setLoading(false);
    };

    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
            <div className="text-center">
                <Loader2 size={40} className="animate-spin text-primary mx-auto mb-4" />
                <p className="text-[var(--text-muted)]">Carregando relatório...</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
            <div className="text-center glass-card p-12">
                <AlertTriangle size={40} className="text-[#FFB347] mx-auto mb-4" />
                <p className="text-[var(--text-main)] font-bold">{error}</p>
            </div>
        </div>
    );

    // Computed stats
    const totalConvs = data.length;
    const avgScore = totalConvs > 0 ? data.reduce((a, d) => a + (d.final_score ?? 0), 0) / totalConvs : 0;
    const target = agentProfile?.score_target ?? 8.0;
    const onTarget = avgScore >= target;

    const radarData = [
        { subject: 'Empatia', A: totalConvs > 0 ? data.reduce((a, d) => a + (d.empathy_score ?? 0), 0) / totalConvs : 0 },
        { subject: 'Clareza', A: totalConvs > 0 ? data.reduce((a, d) => a + (d.clarity_score ?? 0), 0) / totalConvs : 0 },
        { subject: 'Profundidade', A: totalConvs > 0 ? data.reduce((a, d) => a + (d.depth_score ?? 0), 0) / totalConvs : 0 },
        { subject: 'Comercial', A: totalConvs > 0 ? data.reduce((a, d) => a + (d.commercial_score ?? 0), 0) / totalConvs : 0 },
        { subject: 'Agilidade', A: totalConvs > 0 ? data.reduce((a, d) => a + (d.agility_score ?? 0), 0) / totalConvs : 0 },
    ];

    // Daily evolution
    const dailyMap: Record<string, { score: number; count: number }> = {};
    data.forEach(d => {
        const day = d.timestamp?.slice(0, 10) ?? '';
        if (!dailyMap[day]) dailyMap[day] = { score: 0, count: 0 };
        dailyMap[day].score += d.final_score ?? 0;
        dailyMap[day].count++;
    });
    const dailyData = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
        date: new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        score: parseFloat((v.score / v.count).toFixed(1)),
        total: v.count,
    }));

    // Top analyses
    const topConvs = [...data].sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0)).slice(0, 5);
    const lowConvs = [...data].sort((a, b) => (a.final_score ?? 0) - (b.final_score ?? 0)).slice(0, 3);

    // Perspective text
    const perspective = avgScore >= target
        ? `Excelente desempenho em ${MONTH_NAMES[reportMeta.month - 1]}! Você superou a meta de ${target.toFixed(1)} com um score de ${avgScore.toFixed(1)}. Continue com as práticas que estão funcionando e busque novas oportunidades de crescimento.`
        : `Em ${MONTH_NAMES[reportMeta.month - 1]} seu score ficou em ${avgScore.toFixed(1)}, ${(target - avgScore).toFixed(1)} ponto abaixo da meta de ${target.toFixed(1)}. Analise os atendimentos com score mais baixo para identificar oportunidades de melhoria, especialmente nas dimensões com menor pontuação no radar.`;

    return (
        <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
            {/* Header */}
            <div className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-[#00D4AA]/5" />
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
                <div className="relative max-w-5xl mx-auto px-8 py-12">
                    <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
                        <AgentAvatar name={reportMeta.agent_name} photoUrl={agentProfile?.photo_url} size={120} className="ring-4 ring-primary/20 shadow-2xl shadow-primary/20" />
                        <div className="flex-1 text-center md:text-left">
                            <p className="text-[11px] font-bold text-primary uppercase tracking-widest mb-2">Relatório de Performance</p>
                            <h1 className="text-4xl font-black tracking-tight mb-1">{reportMeta.agent_name}</h1>
                            <p className="text-[var(--text-muted)] text-lg">{MONTH_NAMES[reportMeta.month - 1]} de {reportMeta.year}</p>
                            <div className={`inline-flex items-center gap-2 mt-4 px-4 py-1.5 rounded-full text-sm font-bold ${onTarget ? 'bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/20' : 'bg-[#FFB347]/10 text-[#FFB347] border border-[#FFB347]/20'}`}>
                                {onTarget ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                                {onTarget ? 'Meta atingida!' : `Faltam ${(target - avgScore).toFixed(1)} pts para a meta`}
                            </div>
                        </div>
                        <ScoreBadge score={avgScore} target={target} />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-5xl mx-auto px-8 pb-16 space-y-8">
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <MiniStat label="Atendimentos" value={totalConvs} />
                    <MiniStat label="Score Médio" value={avgScore.toFixed(1)} color={onTarget ? 'text-[#00D4AA]' : 'text-[#FFB347]'} />
                    <MiniStat label="Meta Score" value={target.toFixed(1)} color="text-primary" />
                    <MiniStat label="Resultado" value={onTarget ? `+${(avgScore - target).toFixed(1)}` : `${(avgScore - target).toFixed(1)}`} color={onTarget ? 'text-[#00D4AA]' : 'text-[#FFB347]'} sub={onTarget ? 'Acima da meta' : 'Abaixo da meta'} />
                </div>

                {/* Radar */}
                <Section title="Perfil Qualitativo" icon={<Target size={16} className="text-primary" />}>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart data={radarData} outerRadius="80%" cx="50%" cy="50%">
                                <PolarGrid stroke="var(--border)" strokeOpacity={0.6} />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }} />
                                <PolarRadiusAxis domain={[0, 10]} axisLine={false} tick={false} />
                                <Radar name="Score" dataKey="A" stroke="#5551FF" fill="#5551FF" fillOpacity={0.3} strokeWidth={2.5} />
                                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }} formatter={(v: any) => [Number(v).toFixed(1), 'Score']} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-5 gap-2 mt-4">
                        {radarData.map(d => (
                            <div key={d.subject} className="text-center">
                                <p className={`text-lg font-black ${d.A >= 7 ? 'text-[#00D4AA]' : d.A >= 5 ? 'text-[#5551FF]' : 'text-[#FFB347]'}`}>{d.A.toFixed(1)}</p>
                                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-widest">{d.subject}</p>
                            </div>
                        ))}
                    </div>
                </Section>

                {/* Daily Evolution */}
                {dailyData.length > 0 && (
                    <Section title="Evolução Diária" icon={<TrendingUp size={16} className="text-primary" />}>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={dailyData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.2} vertical={false} />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                    <YAxis domain={[0, 10]} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }} />
                                    {/* Goal line */}
                                    <Line type="monotone" dataKey={() => target} stroke="#ffffff15" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                                    <Line type="monotone" dataKey="score" stroke="#5551FF" strokeWidth={2.5} dot={{ r: 4, fill: '#5551FF' }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] mt-3 text-center">Linha tracejada = meta ({target.toFixed(1)})</p>
                    </Section>
                )}

                {/* Score distribution */}
                {dailyData.length > 0 && (
                    <Section title="Volume de Atendimentos por Dia" icon={<MessageSquare size={16} className="text-primary" />}>
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dailyData}>
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }} />
                                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                                        {dailyData.map((_, i) => <Cell key={i} fill={`hsl(${230 + i * 5}, 70%, 65%)`} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Section>
                )}

                {/* Top performances */}
                {topConvs.length > 0 && (
                    <Section title="Melhores Atendimentos do Mês" icon={<Award size={16} className="text-primary" />}>
                        <div className="space-y-3">
                            {topConvs.map((c, i) => (
                                <div key={i} className="flex items-center gap-4 p-4 bg-[var(--bg-card-hover)]/60 rounded-xl border border-[var(--border)]">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${i === 0 ? 'bg-[#FFD700]/20 text-[#FFD700]' : 'bg-[var(--bg-card)]/50 text-[var(--text-muted)]'}`}>
                                        #{i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-[var(--text-main)] truncate">{c.contact}</p>
                                        <p className="text-[10px] text-[var(--text-muted)]">{c.timestamp ? new Date(c.timestamp).toLocaleDateString('pt-BR') : ''}</p>
                                    </div>
                                    <span className="text-xl font-black text-[#00D4AA]">{(c.final_score ?? 0).toFixed(1)}</span>
                                </div>
                            ))}
                        </div>
                    </Section>
                )}

                {/* Perspective / AI insights */}
                <Section title="Perspectivas e Próximos Passos" icon={<TrendingUp size={16} className="text-primary" />}>
                    <div className={`p-6 rounded-xl border ${onTarget ? 'bg-[#00D4AA]/5 border-[#00D4AA]/20' : 'bg-[#FFB347]/5 border-[#FFB347]/20'}`}>
                        <p className="text-sm text-[var(--text-main)] leading-relaxed opacity-90">{perspective}</p>
                    </div>
                    {lowConvs.length > 0 && (
                        <div className="mt-4">
                            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">Atendimentos que merecem atenção</p>
                            <div className="space-y-2">
                                {lowConvs.map((c, i) => (
                                    <div key={i} className="flex items-center gap-3 p-3 bg-[var(--bg-card-hover)]/60 rounded-xl border border-[var(--border)]">
                                        <AlertTriangle size={14} className="text-[#FFB347] flex-shrink-0" />
                                        <span className="text-sm text-[var(--text-main)] flex-1 truncate">{c.contact}</span>
                                        <span className="text-sm font-bold text-[#FFB347]">{(c.final_score ?? 0).toFixed(1)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Section>

                {/* Footer */}
                <div className="text-center py-8 border-t border-[var(--border)]">
                    <p className="text-[var(--text-muted)] text-xs">Relatório gerado automaticamente pelo sistema FICV Analytics</p>
                    <p className="text-[var(--text-muted)] text-xs mt-1">{MONTH_NAMES[reportMeta.month - 1]} {reportMeta.year} • Uso interno</p>
                </div>
            </div>
        </div>
    );
};
