import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    GraduationCap, RefreshCw, TrendingUp, DollarSign,
    Users, CheckCircle, XCircle, Filter, Calendar, Loader2, AlertCircle
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid
} from 'recharts';
import { supabase } from '../lib/supabase';
import { showSuccess, showError } from '@/utils/toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SponteMatricula {
    contrato_id: number;
    aluno_id: number;
    aluno: string;
    turma_id: number;
    nome_turma: string;
    nome_curso: string;
    situacao_id: number;
    situacao: string;
    data_matricula: string;
    data_inicio: string;
    data_termino: string;
    contratante: string;
    numero_contrato: string;
    financeiro_lancado: string;
}

interface SponteParcela {
    conta_receber_id: number;
    aluno_id: number;
    situacao_parcela: string;
    data_pagamento: string;
    vencimento: string;
    valor_parcela: number;
    valor_pago: number;
    forma_cobranca: string;
    categoria: string;
}

const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
    s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

const CHART_COLORS = ['#5551FF', '#8B8BFF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA', '#34D399', '#F472B6'];

// ─── Period helpers ───────────────────────────────────────────────────────────
function periodToDates(period: string, customStart: string, customEnd: string): { start: string; end: string } {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    switch (period) {
        case 'today': {
            const d = now.toISOString().split('T')[0];
            return { start: d, end: d };
        }
        case 'week': {
            const start = new Date(now);
            start.setDate(now.getDate() - now.getDay());
            return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
        }
        case 'month': {
            const start = new Date(y, m, 1);
            const end = new Date(y, m + 1, 0);
            return {
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0]
            };
        }
        case 'semester': {
            const sem = m < 6 ? 0 : 6;
            return {
                start: new Date(y, sem, 1).toISOString().split('T')[0],
                end: new Date(y, sem + 6, 0).toISOString().split('T')[0]
            };
        }
        case 'year':
            return { start: `${y}-01-01`, end: `${y}-12-31` };
        case 'custom':
            return { start: customStart, end: customEnd };
        default:
            return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { isAdmin: boolean; }

export const SponteDashboard: React.FC<Props> = ({ isAdmin }) => {
    const [matriculas, setMatriculas] = useState<SponteMatricula[]>([]);
    const [parcelas, setParcelas] = useState<SponteParcela[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState<string | null>(null);

    // Filters
    const [period, setPeriod] = useState('year');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [selectedCurso, setSelectedCurso] = useState('all');
    const [selectedTurma, setSelectedTurma] = useState('all');
    const [selectedSituacao, setSelectedSituacao] = useState('all');
    const [search, setSearch] = useState('');

    const { start: dateStart, end: dateEnd } = periodToDates(period, customStart, customEnd);

    // ─── Load data from Supabase ───────────────────────────────────────────────
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [matRes, parcRes, syncRes] = await Promise.all([
                supabase
                    .from('sponte_matriculas')
                    .select('*')
                    .gte('data_matricula', dateStart)
                    .lte('data_matricula', dateEnd)
                    .order('data_matricula', { ascending: false }),
                supabase
                    .from('sponte_parcelas')
                    .select('*')
                    .eq('situacao_parcela', 'Quitada')
                    .gte('data_pagamento', dateStart)
                    .lte('data_pagamento', dateEnd),
                supabase
                    .from('sponte_matriculas')
                    .select('synced_at')
                    .order('synced_at', { ascending: false })
                    .limit(1)
                    .single()
            ]);

            if (matRes.data) setMatriculas(matRes.data);
            if (parcRes.data) setParcelas(parcRes.data);
            if (syncRes.data) setLastSync(syncRes.data.synced_at);
        } catch (e) {
            console.error('loadData error:', e);
        } finally {
            setLoading(false);
        }
    }, [dateStart, dateEnd]);

    useEffect(() => { loadData(); }, [loadData]);

    // ─── Trigger sync via Edge Function ───────────────────────────────────────
    const handleSync = async () => {
        setSyncing(true);
        try {
            const { data, error } = await supabase.functions.invoke('sync-sponte', {
                body: {
                    mode: 'full',
                    start_date: dateStart,
                    end_date: dateEnd,
                    year: new Date(dateStart).getFullYear(),
                    month: new Date(dateStart).getMonth() + 1,
                },
            });
            if (error) throw error;
            showSuccess(`Sincronizado: ${data?.matriculas?.synced ?? 0} matrículas, ${data?.parcelas?.synced ?? 0} parcelas`);
            await loadData();
        } catch (e: any) {
            showError('Erro na sincronização: ' + e.message);
        } finally {
            setSyncing(false);
        }
    };

    // ─── Filter options ────────────────────────────────────────────────────────
    const cursos = useMemo(() =>
        Array.from(new Set(matriculas.map(m => m.nome_curso).filter(Boolean))).sort(),
        [matriculas]
    );
    const turmas = useMemo(() =>
        Array.from(new Set(
            matriculas
                .filter(m => selectedCurso === 'all' || m.nome_curso === selectedCurso)
                .map(m => m.nome_turma).filter(Boolean)
        )).sort(),
        [matriculas, selectedCurso]
    );

    // ─── Filtered data ─────────────────────────────────────────────────────────
    const filtered = useMemo(() => matriculas.filter(m => {
        if (selectedCurso !== 'all' && m.nome_curso !== selectedCurso) return false;
        if (selectedTurma !== 'all' && m.nome_turma !== selectedTurma) return false;
        if (selectedSituacao !== 'all' && m.situacao !== selectedSituacao) return false;
        if (search) {
            const q = search.toLowerCase();
            return (m.aluno?.toLowerCase().includes(q) ||
                m.nome_curso?.toLowerCase().includes(q) ||
                m.numero_contrato?.toLowerCase().includes(q));
        }
        return true;
    }), [matriculas, selectedCurso, selectedTurma, selectedSituacao, search]);

    // ─── Stats ────────────────────────────────────────────────────────────────
    const totalPago = useMemo(() =>
        parcelas.reduce((s, p) => s + (p.valor_pago || 0), 0), [parcelas]
    );
    const vigentes = useMemo(() =>
        filtered.filter(m => m.situacao_id === 1).length, [filtered]
    );
    const encerrados = useMemo(() =>
        filtered.filter(m => m.situacao_id !== 1).length, [filtered]
    );

    // ─── Chart: matrículas por curso ──────────────────────────────────────────
    const chartByCurso = useMemo(() => {
        const counts: Record<string, number> = {};
        filtered.forEach(m => {
            const key = m.nome_curso?.split('(')[0]?.trim() || 'Sem curso';
            counts[key] = (counts[key] || 0) + 1;
        });
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, value]) => ({ name: name.length > 30 ? name.slice(0, 28) + '…' : name, value }));
    }, [filtered]);

    // ─── Chart: matrículas por mês ────────────────────────────────────────────
    const chartByMonth = useMemo(() => {
        const counts: Record<string, number> = {};
        filtered.forEach(m => {
            if (!m.data_matricula) return;
            const d = new Date(m.data_matricula + 'T12:00:00');
            const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            counts[key] = (counts[key] || 0) + 1;
        });
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [filtered]);

    const PERIOD_OPTIONS = [
        { value: 'today', label: 'Hoje' },
        { value: 'week', label: 'Semana' },
        { value: 'month', label: 'Mês' },
        { value: 'semester', label: 'Semestre' },
        { value: 'year', label: 'Ano' },
        { value: 'custom', label: 'Personalizado' },
    ];

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 text-primary mb-2">
                        <GraduationCap size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Integração Sponte CRM</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Matrículas</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-1">
                        Dados sincronizados do sistema Sponte.
                        {lastSync && (
                            <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                                Última sync: {new Date(lastSync).toLocaleString('pt-BR')}
                            </span>
                        )}
                    </p>
                </div>
                {isAdmin && (
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="btn-primary flex items-center gap-2"
                    >
                        {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        {syncing ? 'Sincronizando…' : 'Sincronizar Sponte'}
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="glass-card p-4 flex flex-wrap gap-3 items-end">
                {/* Period */}
                <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Período</span>
                    <div className="flex gap-1">
                        {PERIOD_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setPeriod(opt.value)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all
                                    ${period === opt.value
                                        ? 'bg-primary text-white shadow-lg shadow-primary/30'
                                        : 'bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Custom dates */}
                {period === 'custom' && (
                    <div className="flex gap-2 items-end">
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Início</span>
                            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                                className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Fim</span>
                            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                                className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary" />
                        </div>
                    </div>
                )}

                {/* Course */}
                <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Curso</span>
                    <select
                        value={selectedCurso}
                        onChange={e => { setSelectedCurso(e.target.value); setSelectedTurma('all'); }}
                        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary min-w-[180px]"
                    >
                        <option value="all">Todos os cursos</option>
                        {cursos.map(c => <option key={c} value={c}>{c.length > 40 ? c.slice(0, 38) + '…' : c}</option>)}
                    </select>
                </div>

                {/* Class */}
                <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Turma</span>
                    <select
                        value={selectedTurma}
                        onChange={e => setSelectedTurma(e.target.value)}
                        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary min-w-[160px]"
                    >
                        <option value="all">Todas as turmas</option>
                        {turmas.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>

                {/* Status */}
                <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Situação</span>
                    <select
                        value={selectedSituacao}
                        onChange={e => setSelectedSituacao(e.target.value)}
                        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary"
                    >
                        <option value="all">Todas</option>
                        <option value="Vigente">Vigente</option>
                        <option value="Encerrado">Encerrado</option>
                        <option value="Cancelado">Cancelado</option>
                    </select>
                </div>

                {/* Search */}
                <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Busca</span>
                    <input
                        type="text"
                        placeholder="Aluno, curso, contrato…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary"
                    />
                </div>
            </div>

            {/* Empty state when no data */}
            {!loading && matriculas.length === 0 && (
                <div className="glass-card p-12 flex flex-col items-center gap-4 text-center">
                    <AlertCircle size={32} className="text-[var(--text-muted)]" />
                    <div>
                        <p className="font-bold text-[var(--text-main)]">Nenhum dado sincronizado ainda</p>
                        <p className="text-[var(--text-muted)] text-sm mt-1">
                            Clique em <strong>Sincronizar Sponte</strong> para importar as matrículas do CRM.
                        </p>
                    </div>
                </div>
            )}

            {/* Stats cards */}
            {matriculas.length > 0 && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard
                            icon={GraduationCap}
                            title="Total Matrículas"
                            value={filtered.length.toLocaleString()}
                            sub={`no período selecionado`}
                            color="#5551FF"
                        />
                        <StatCard
                            icon={CheckCircle}
                            title="Vigentes"
                            value={vigentes.toLocaleString()}
                            sub={filtered.length > 0 ? `${((vigentes / filtered.length) * 100).toFixed(0)}% do total` : ''}
                            color="#00D4AA"
                        />
                        <StatCard
                            icon={XCircle}
                            title="Encerradas/Canceladas"
                            value={encerrados.toLocaleString()}
                            sub={filtered.length > 0 ? `${((encerrados / filtered.length) * 100).toFixed(0)}% do total` : ''}
                            color="#FFB347"
                        />
                        <StatCard
                            icon={DollarSign}
                            title="Valor Pago (período)"
                            value={fmt(totalPago)}
                            sub="parcelas quitadas"
                            color="#00D4AA"
                        />
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* By course */}
                        <div className="glass-card p-6">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                                Matrículas por Curso
                            </h3>
                            {loading ? (
                                <div className="h-64 flex items-center justify-center">
                                    <Loader2 size={24} className="animate-spin text-primary" />
                                </div>
                            ) : (
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={chartByCurso} layout="vertical" margin={{ left: 8, right: 24 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                                            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                            <YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                                            <Tooltip
                                                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                                itemStyle={{ color: 'var(--text-main)' }}
                                                formatter={(v: any) => [`${v} matrículas`, '']}
                                            />
                                            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                                {chartByCurso.map((_, i) => (
                                                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        {/* By month */}
                        <div className="glass-card p-6">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                                Matrículas por Mês
                            </h3>
                            {loading ? (
                                <div className="h-64 flex items-center justify-center">
                                    <Loader2 size={24} className="animate-spin text-primary" />
                                </div>
                            ) : (
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={chartByMonth} margin={{ left: 0, right: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                            <Tooltip
                                                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                                formatter={(v: any) => [`${v} matrículas`, '']}
                                            />
                                            <Bar dataKey="value" fill="#5551FF" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">
                                Listagem de Matrículas
                            </h3>
                            <span className="text-[10px] text-[var(--text-muted)]">
                                {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
                            </span>
                        </div>

                        {loading ? (
                            <div className="py-12 flex justify-center">
                                <Loader2 size={24} className="animate-spin text-primary" />
                            </div>
                        ) : filtered.length === 0 ? (
                            <p className="text-center py-8 text-[var(--text-muted)] text-sm">
                                Nenhuma matrícula encontrada com os filtros aplicados.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                                            {['Aluno', 'Curso', 'Turma', 'Data Matrícula', 'Situação', 'Contrato', 'Financeiro'].map(h => (
                                                <th key={h} className="pb-3 px-2 font-bold uppercase tracking-wider text-[9px] whitespace-nowrap">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.slice(0, 200).map(m => (
                                            <tr key={m.contrato_id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-card-hover)] transition-colors">
                                                <td className="py-2.5 px-2 font-medium text-[var(--text-main)] whitespace-nowrap max-w-[180px] truncate">
                                                    {m.aluno || '—'}
                                                </td>
                                                <td className="py-2.5 px-2 text-[var(--text-muted)] max-w-[200px] truncate">
                                                    {m.nome_curso?.split('(')[0]?.trim() || '—'}
                                                </td>
                                                <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap">
                                                    {m.nome_turma || '—'}
                                                </td>
                                                <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap">
                                                    {fmtDate(m.data_matricula)}
                                                </td>
                                                <td className="py-2.5 px-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider
                                                        ${m.situacao_id === 1
                                                            ? 'bg-[#00D4AA]/10 text-[#00D4AA]'
                                                            : 'bg-[var(--bg-card-hover)] text-[var(--text-muted)]'}`}>
                                                        {m.situacao || '—'}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap font-mono text-[10px]">
                                                    {m.numero_contrato || '—'}
                                                </td>
                                                <td className="py-2.5 px-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider
                                                        ${m.financeiro_lancado === 'SIM'
                                                            ? 'bg-[#5551FF]/10 text-[#5551FF]'
                                                            : 'bg-[var(--bg-card-hover)] text-[var(--text-muted)]'}`}>
                                                        {m.financeiro_lancado || '—'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filtered.length > 200 && (
                                    <p className="text-center text-[10px] text-[var(--text-muted)] mt-3">
                                        Mostrando 200 de {filtered.length} registros. Use os filtros para refinar.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// ─── Stat card ────────────────────────────────────────────────────────────────
const StatCard: React.FC<{ icon: any; title: string; value: string; sub: string; color: string }> = ({
    icon: Icon, title, value, sub, color
}) => (
    <div className="glass-card p-5 relative overflow-hidden">
        <div className="flex justify-between items-start mb-4">
            <div className="p-2 rounded-lg" style={{ background: `${color}15` }}>
                <Icon size={16} style={{ color }} />
            </div>
        </div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">{title}</p>
        <p className="text-xl font-bold text-[var(--text-main)]">{value}</p>
        {sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
);
