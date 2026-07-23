import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    GraduationCap, RefreshCw, TrendingUp, DollarSign,
    Users, CheckCircle, XCircle, Filter, Calendar, Loader2, AlertCircle, ChevronDown
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid
} from 'recharts';
import { supabase } from '../lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { periodToDates, AutoWidthSelect, PERIOD_OPTIONS } from '@/utils/dashboardFilters';

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

// ─── Matrículas por agente (RPC no banco — cruza com messages_logs) ──────────
interface MatriculaDetalhe {
    agentName: string;
    aluno: string;
    curso: string;
    dataMatricula: string;
}

interface MatriculasPorAgenteResult {
    porAgente: { agentName: string; matriculas: number }[];
    detalhes: MatriculaDetalhe[];
    semAtribuicao: number;
    jaExistente: number;
}

const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
    s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

const CHART_COLORS = ['#5551FF', '#8B8BFF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA', '#34D399', '#F472B6'];

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { isAdmin: boolean; }

export const SponteDashboard: React.FC<Props> = ({ isAdmin }) => {
    const [matriculas, setMatriculas] = useState<SponteMatricula[]>([]);
    const [parcelas, setParcelas] = useState<SponteParcela[]>([]);
    const [parcelasPendentes, setParcelasPendentes] = useState<SponteParcela[]>([]);
    // Matrículas por agente — vem de uma função no banco (matriculas_por_agente),
    // recalculada sempre que os filtros da página mudam.
    const [agentAttribution, setAgentAttribution] = useState<MatriculasPorAgenteResult>({ porAgente: [], detalhes: [], semAtribuicao: 0, jaExistente: 0 });
    const [porAgenteLoading, setPorAgenteLoading] = useState(true);
    const [selectedAgentDrillDown, setSelectedAgentDrillDown] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState<string | null>(null);

    // Filters
    const [period, setPeriod] = useState('year');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [selectedCursos, setSelectedCursos] = useState<string[]>([]);
    const [selectedTurma, setSelectedTurma] = useState('all');
    const [selectedSituacao, setSelectedSituacao] = useState('all');
    const [search, setSearch] = useState('');
    const [cursoDropdownOpen, setCursoDropdownOpen] = useState(false);
    const cursoDropdownRef = useRef<HTMLDivElement>(null);

    const { start: dateStart, end: dateEnd } = periodToDates(period, customStart, customEnd);

    const hasActiveFilters = selectedCursos.length > 0 || selectedTurma !== 'all' || selectedSituacao !== 'all' || !!search;

    const clearFilters = () => {
        setSelectedCursos([]);
        setSelectedTurma('all');
        setSelectedSituacao('all');
        setSearch('');
    };

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (cursoDropdownRef.current && !cursoDropdownRef.current.contains(e.target as Node))
                setCursoDropdownOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ─── Load data from Supabase ───────────────────────────────────────────────
    // Matriculas: load the full year so counts match Sponte (students who enrolled
    // before the selected month still appear in their turma/curso). Financial data
    // (parcelas) keeps the period filter — only those two need date precision.
    const selectedYear = dateStart ? new Date(dateStart + 'T00:00:00').getFullYear() : new Date().getFullYear();
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd   = `${selectedYear}-12-31`;

    const loadData = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        try {
            // Paginate ALL matriculas for the year (no period restriction)
            const allMatriculas: SponteMatricula[] = [];
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase
                    .from('sponte_matriculas')
                    .select('*')
                    .gte('data_matricula', yearStart)
                    .lte('data_matricula', yearEnd)
                    .order('data_matricula', { ascending: false })
                    .range(from, from + 999);
                if (error) throw error;
                if (data?.length) allMatriculas.push(...data);
                if (!data || data.length < 1000) break;
            }

            // Paginate paid parcelas
            const allParcelas: SponteParcela[] = [];
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase
                    .from('sponte_parcelas')
                    .select('*')
                    .eq('situacao_parcela', 'Quitada')
                    .gte('data_pagamento', dateStart)
                    .lte('data_pagamento', dateEnd)
                    .range(from, from + 999);
                if (error) throw error;
                if (data?.length) allParcelas.push(...data);
                if (!data || data.length < 1000) break;
            }

            // Paginate pending parcelas
            const allPendentes: SponteParcela[] = [];
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase
                    .from('sponte_parcelas')
                    .select('*')
                    .eq('situacao_parcela', 'Pendente')
                    .gte('vencimento', dateStart)
                    .lte('vencimento', dateEnd)
                    .range(from, from + 999);
                if (error) throw error;
                if (data?.length) allPendentes.push(...data);
                if (!data || data.length < 1000) break;
            }

            const syncRes = await supabase
                .from('sponte_matriculas')
                .select('synced_at')
                .order('synced_at', { ascending: false })
                .limit(1)
                .single();

            setMatriculas(allMatriculas);
            setParcelas(allParcelas);
            setParcelasPendentes(allPendentes);
            if (syncRes.data) setLastSync(syncRes.data.synced_at);
        } catch (e) {
            console.error('loadData error:', e);
        } finally {
            if (!opts?.silent) setLoading(false);
        }
    }, [yearStart, yearEnd, dateStart, dateEnd]);

    useEffect(() => { loadData(); }, [loadData]);

    // Atualiza em segundo plano (sem loading spinner) pra refletir os syncs
    // automáticos do cron sem precisar dar refresh na página.
    useEffect(() => {
        const id = setInterval(() => { loadData({ silent: true }); }, 3 * 60 * 1000);
        return () => clearInterval(id);
    }, [loadData]);

    // ─── Matrículas por agente — calculado no banco (função matriculas_por_agente),
    // respeitando os mesmos filtros de período/curso/turma/situação da página.
    useEffect(() => {
        const loadPorAgente = async () => {
            setPorAgenteLoading(true);
            try {
                const { data, error } = await supabase.rpc('matriculas_por_agente', {
                    p_data_inicio: dateStart,
                    p_data_fim: dateEnd,
                    p_cursos: selectedCursos.length > 0 ? selectedCursos : null,
                    p_turma: selectedTurma,
                    p_situacao: selectedSituacao,
                });
                if (error) throw error;
                setAgentAttribution({
                    porAgente: data?.porAgente ?? [],
                    detalhes: data?.detalhes ?? [],
                    semAtribuicao: data?.semAtribuicao ?? 0,
                    jaExistente: data?.jaExistente ?? 0,
                });
                setSelectedAgentDrillDown(null);
            } catch (e) {
                console.error('loadPorAgente error:', e);
            } finally {
                setPorAgenteLoading(false);
            }
        };
        loadPorAgente();
    }, [dateStart, dateEnd, selectedCursos, selectedTurma, selectedSituacao]);

    // ─── Drill-down: matrículas do agente selecionado, agrupadas por curso ────
    const drillDownByCurso = useMemo(() => {
        if (!selectedAgentDrillDown) return [];
        const grupos = new Map<string, MatriculaDetalhe[]>();
        agentAttribution.detalhes
            .filter(d => d.agentName === selectedAgentDrillDown)
            .forEach(d => {
                const cursoKey = d.curso?.split('(')[0]?.trim() || 'Sem curso';
                if (!grupos.has(cursoKey)) grupos.set(cursoKey, []);
                grupos.get(cursoKey)!.push(d);
            });
        return Array.from(grupos.entries())
            .map(([curso, alunos]) => ({ curso, alunos: alunos.sort((a, b) => a.aluno.localeCompare(b.aluno)) }))
            .sort((a, b) => b.alunos.length - a.alunos.length);
    }, [agentAttribution.detalhes, selectedAgentDrillDown]);

    // ─── Trigger sync via Edge Function ───────────────────────────────────────
    const handleSync = async () => {
        setSyncing(true);
        try {
            const { data, error } = await supabase.functions.invoke('sync-sponte', {
                body: {
                    mode: 'full',
                    start_date: dateStart,
                    end_date: dateEnd,
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
                .filter(m => selectedCursos.length === 0 || selectedCursos.includes(m.nome_curso))
                .map(m => m.nome_turma).filter(Boolean)
        )).sort(),
        [matriculas, selectedCursos]
    );
    const situacoes = useMemo(() =>
        Array.from(new Set(matriculas.map(m => m.situacao).filter(Boolean))).sort(),
        [matriculas]
    );

    // ─── Filtered data ─────────────────────────────────────────────────────────
    const filtered = useMemo(() => matriculas.filter(m => {
        if (selectedCursos.length > 0 && !selectedCursos.includes(m.nome_curso)) return false;
        if (selectedTurma !== 'all' && m.nome_turma !== selectedTurma) return false;
        if (selectedSituacao !== 'all' && m.situacao !== selectedSituacao) return false;
        if (search) {
            const q = search.toLowerCase();
            return (m.aluno?.toLowerCase().includes(q) ||
                m.nome_curso?.toLowerCase().includes(q) ||
                m.numero_contrato?.toLowerCase().includes(q));
        }
        return true;
    }), [matriculas, selectedCursos, selectedTurma, selectedSituacao, search]);

    // ─── Stats ────────────────────────────────────────────────────────────────
    // Filter parcelas by the aluno_ids of the filtered matriculas so turma/curso filters apply
    const filteredAlunoIds = useMemo(() =>
        new Set(filtered.map(m => m.aluno_id)), [filtered]
    );
    const filteredParcelas = useMemo(() => {
        const hasExtraFilter = selectedCursos.length > 0 || selectedTurma !== 'all' || selectedSituacao !== 'all' || !!search;
        return hasExtraFilter
            ? parcelas.filter(p => p.aluno_id !== null && filteredAlunoIds.has(p.aluno_id))
            : parcelas;
    }, [parcelas, filteredAlunoIds, selectedCursos, selectedTurma, selectedSituacao, search]);

    const totalPago = useMemo(() =>
        filteredParcelas.reduce((s, p) => s + (p.valor_pago || 0), 0), [filteredParcelas]
    );

    const filteredParcelasPendentes = useMemo(() => {
        const hasExtraFilter = selectedCursos.length > 0 || selectedTurma !== 'all' || selectedSituacao !== 'all' || !!search;
        return hasExtraFilter
            ? parcelasPendentes.filter(p => p.aluno_id !== null && filteredAlunoIds.has(p.aluno_id))
            : parcelasPendentes;
    }, [parcelasPendentes, filteredAlunoIds, selectedCursos, selectedTurma, selectedSituacao, search]);

    const totalAReceber = useMemo(() =>
        filteredParcelasPendentes.reduce((s, p) => s + (p.valor_parcela || 0), 0), [filteredParcelasPendentes]
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
        const counts: Record<string, { label: string; value: number }> = {};
        filtered.forEach(m => {
            if (!m.data_matricula) return;
            const d = new Date(m.data_matricula + 'T12:00:00');
            const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!counts[sortKey]) {
                counts[sortKey] = {
                    label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
                    value: 0,
                };
            }
            counts[sortKey].value += 1;
        });
        return Object.entries(counts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, { label, value }]) => ({ name: label, value }));
    }, [filtered]);

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

                {/* Course — multi-select with checkboxes */}
                <div className="flex flex-col gap-1" ref={cursoDropdownRef}>
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Curso</span>
                    <div className="relative">
                        <button
                            onClick={() => setCursoDropdownOpen(o => !o)}
                            className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary min-w-[220px] w-full text-left"
                        >
                            <span className="flex-1 truncate">
                                {selectedCursos.length === 0
                                    ? 'Todos os cursos'
                                    : selectedCursos.length === 1
                                        ? selectedCursos[0]
                                        : `${selectedCursos.length} cursos selecionados`}
                            </span>
                            <ChevronDown size={12} className={`shrink-0 text-[var(--text-muted)] transition-transform ${cursoDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {cursoDropdownOpen && (
                            <div className="absolute top-full mt-1 left-0 z-[200] bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto max-h-72"
                                style={{ minWidth: '100%', width: 'max-content', maxWidth: '520px' }}>
                                <label className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors">
                                    <input
                                        type="checkbox"
                                        className="w-3.5 h-3.5 accent-primary cursor-pointer"
                                        checked={selectedCursos.length === 0}
                                        onChange={() => { setSelectedCursos([]); setSelectedTurma('all'); }}
                                    />
                                    <span className="text-xs font-bold text-[var(--text-main)] whitespace-nowrap">Todos os cursos</span>
                                </label>
                                <div className="h-px bg-[var(--border)] mx-2" />
                                {cursos.map(c => (
                                    <label key={c} className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors">
                                        <input
                                            type="checkbox"
                                            className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0"
                                            checked={selectedCursos.includes(c)}
                                            onChange={() => {
                                                setSelectedCursos(prev =>
                                                    prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
                                                );
                                                setSelectedTurma('all');
                                            }}
                                        />
                                        <span className={`text-xs whitespace-nowrap ${selectedCursos.includes(c) ? 'text-primary font-bold' : 'text-[var(--text-main)]'}`}>{c}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Class */}
                <AutoWidthSelect
                    label="Turma"
                    value={selectedTurma}
                    options={turmas.map(t => ({ value: t, label: t }))}
                    onChange={setSelectedTurma}
                    placeholder="Todas as turmas"
                />

                {/* Status */}
                <AutoWidthSelect
                    label="Situação"
                    value={selectedSituacao}
                    options={situacoes.map(s => ({ value: s, label: s }))}
                    onChange={setSelectedSituacao}
                    placeholder="Todas as situações"
                />

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

                {/* Clear filters */}
                {hasActiveFilters && (
                    <div className="flex flex-col gap-1 justify-end">
                        <span className="text-[9px] font-bold text-transparent uppercase tracking-widest select-none">.</span>
                        <button
                            onClick={clearFilters}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border)] hover:border-primary/50 transition-all whitespace-nowrap"
                        >
                            <XCircle size={12} />
                            Limpar filtros
                        </button>
                    </div>
                )}
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
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <StatCard
                            icon={GraduationCap}
                            title="Total Matrículas"
                            value={filtered.length.toLocaleString()}
                            sub={`em ${selectedYear}`}
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
                        <StatCard
                            icon={Calendar}
                            title="Valor a Receber"
                            value={fmt(totalAReceber)}
                            sub={`${filteredParcelasPendentes.length} parcela${filteredParcelasPendentes.length !== 1 ? 's' : ''} pendente${filteredParcelasPendentes.length !== 1 ? 's' : ''}`}
                            color="#FFB347"
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

                    {/* By agent — cruzamento leads x matrículas */}
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4 gap-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">
                                Matrículas por Agente
                            </h3>
                            <span className="text-[10px] text-[var(--text-muted)] text-right">
                                Conta 1x por aluno+curso; ignora atendimento com mais de 30 dias ou quem já estava matriculado antes
                            </span>
                        </div>
                        {porAgenteLoading ? (
                            <div className="h-64 flex items-center justify-center">
                                <Loader2 size={24} className="animate-spin text-primary" />
                            </div>
                        ) : agentAttribution.porAgente.length === 0 ? (
                            <p className="text-center py-12 text-[var(--text-muted)] text-sm">
                                Nenhuma matrícula pôde ser atribuída a um agente neste período.
                            </p>
                        ) : (
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={agentAttribution.porAgente} layout="vertical" margin={{ left: 8, right: 24 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                                        <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                        <YAxis type="category" dataKey="agentName" width={140} tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                            itemStyle={{ color: 'var(--text-main)' }}
                                            formatter={(v: any) => [`${v} matrícula${v !== 1 ? 's' : ''}`, 'Clique pra ver detalhes']}
                                        />
                                        <Bar
                                            dataKey="matriculas"
                                            radius={[0, 6, 6, 0]}
                                            cursor="pointer"
                                            onClick={(d: any) => setSelectedAgentDrillDown(prev => prev === d.agentName ? null : d.agentName)}
                                        >
                                            {agentAttribution.porAgente.map((a, i) => (
                                                <Cell
                                                    key={i}
                                                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                                                    opacity={selectedAgentDrillDown && selectedAgentDrillDown !== a.agentName ? 0.35 : 1}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                        {!porAgenteLoading && (agentAttribution.semAtribuicao > 0 || agentAttribution.jaExistente > 0) && (
                            <p className="text-[10px] text-[var(--text-muted)] mt-3">
                                {agentAttribution.semAtribuicao > 0 && `${agentAttribution.semAtribuicao} matrícula${agentAttribution.semAtribuicao !== 1 ? 's' : ''} sem lead correspondente ou sem agente responsável. `}
                                {agentAttribution.jaExistente > 0 && `${agentAttribution.jaExistente} desconsiderada${agentAttribution.jaExistente !== 1 ? 's' : ''} por já constar matriculado(a) antes do atendimento.`}
                            </p>
                        )}

                        {/* Drill-down: matrículas do agente selecionado, por curso */}
                        {selectedAgentDrillDown && (
                            <div className="mt-6 pt-6 border-t border-[var(--border)]">
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className="text-xs font-bold text-[var(--text-main)]">
                                        {selectedAgentDrillDown} — {drillDownByCurso.reduce((s, g) => s + g.alunos.length, 0)} matrícula{drillDownByCurso.reduce((s, g) => s + g.alunos.length, 0) !== 1 ? 's' : ''}
                                    </h4>
                                    <button
                                        onClick={() => setSelectedAgentDrillDown(null)}
                                        className="text-[10px] text-[var(--text-muted)] hover:text-primary transition-colors"
                                    >
                                        Fechar
                                    </button>
                                </div>
                                <div className="space-y-4">
                                    {drillDownByCurso.map(grupo => (
                                        <div key={grupo.curso}>
                                            <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2">
                                                {grupo.curso} <span className="text-[var(--text-muted)]">({grupo.alunos.length})</span>
                                            </p>
                                            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                                                {grupo.alunos.map((a, i) => (
                                                    <li key={i} className="text-xs text-[var(--text-main)] flex justify-between gap-2">
                                                        <span className="truncate">{a.aluno}</span>
                                                        <span className="text-[var(--text-muted)] shrink-0">{fmtDate(a.dataMatricula)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
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
