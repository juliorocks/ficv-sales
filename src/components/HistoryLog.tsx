import React, { useState } from 'react';
import {
    Search,
    Filter,
    Calendar,
    User,
    MessageSquare,
    TrendingUp,
    ChevronRight,
    SearchX,
    ArrowUpDown,
    Hash,
    RefreshCcw,
    Loader2
} from 'lucide-react';
import { recalculateScore } from '../services/reprocessor';
import { ConversationAnalysis } from '../utils/csvProcessor';

interface HistoryLogProps {
    data: ConversationAnalysis[];
    onSelect: (analysis: ConversationAnalysis) => void;
    onRefresh?: () => Promise<void>;
}

export const HistoryLog: React.FC<HistoryLogProps> = ({ data, onSelect, onRefresh }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedAgent, setSelectedAgent] = useState('all');
    const [minScore, setMinScore] = useState(0);
    const [maxScore, setMaxScore] = useState(10);
    const [sortConfig, setSortConfig] = useState<{ key: keyof ConversationAnalysis, direction: 'asc' | 'desc' } | null>(null);
    const [refreshingProtocols, setRefreshingProtocols] = useState<string[]>([]);

    const agents = React.useMemo(() => Array.from(new Set(data.map(d => d.agent))), [data]);

    const handleSort = (key: keyof ConversationAnalysis) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData = React.useMemo(() => {
        return [...data].sort((a, b) => {
            if (!sortConfig) return 0;
            const { key, direction } = sortConfig;
            if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
            if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, sortConfig]);

    const filteredData = React.useMemo(() => {
        return sortedData.filter(item => {
            const matchesSearch =
                item.contact.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.agent.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesAgent = selectedAgent === 'all' || item.agent === selectedAgent;
            const matchesScore = item.finalScore >= minScore && item.finalScore <= maxScore;

            return matchesSearch && matchesAgent && matchesScore;
        });
    }, [sortedData, searchTerm, selectedAgent, minScore, maxScore]);


    return (
        <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto py-6">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter mb-1 uppercase">Relatórios Completos</h2>
                    <p className="text-[var(--text-muted)] text-sm font-medium">Histórico total de {data.length} atendimentos analisados pela IA.</p>
                </div>

                <div className="flex items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] p-1.5 rounded-xl w-full md:w-auto">
                    <div className="flex items-center gap-2 px-3 text-[var(--text-muted)]">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="Buscar por nome, protocolo ou agente..."
                            className="bg-transparent border-none outline-none text-xs text-[var(--text-main)] p-2 min-w-[250px]"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Filters Sidebar */}
                <div className="space-y-6 lg:col-span-1">
                    <div className="glass-card p-6 space-y-8">
                        <div>
                            <div className="flex items-center gap-2 mb-4 text-[var(--text-muted)]">
                                <Filter size={14} className="text-primary" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Filtrar por Agente</span>
                            </div>
                            <select
                                className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none focus:border-primary transition-all [color-scheme:light] dark:[color-scheme:dark]"
                                value={selectedAgent}
                                onChange={(e) => setSelectedAgent(e.target.value)}
                            >
                                <option value="all">Todos os Agentes</option>
                                {agents.map(agent => (
                                    <option key={agent} value={agent}>{agent}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <div className="flex items-center gap-2 mb-4 text-[var(--text-muted)]">
                                <TrendingUp size={14} className="text-primary" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Score Qualidade ({minScore} - {maxScore})</span>
                            </div>
                            <div className="space-y-4">
                                <input
                                    type="range"
                                    min="0"
                                    max="10"
                                    step="0.5"
                                    value={minScore}
                                    onChange={(e) => setMinScore(parseFloat(e.target.value))}
                                    className="w-full h-1.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <div className="flex justify-between text-[10px] font-bold text-[var(--text-muted)]">
                                    <span>Rigoroso (0)</span>
                                    <span>Excelente (10)</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setSearchTerm('');
                                setSelectedAgent('all');
                                setMinScore(0);
                                setMaxScore(10);
                            }}
                            className="w-full py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all border border-dashed border-[var(--border)] rounded-xl hover:border-primary/50"
                        >
                            Limpar Filtros
                        </button>
                    </div>

                    <div className="glass-card p-6 bg-primary/5 border-primary/20">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-primary/20 rounded-lg text-primary">
                                <TrendingUp size={16} />
                            </div>
                            <span className="text-xs font-bold text-[var(--text-main)]">Insights Rápidos</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                            {filteredData.length > 0
                                ? `Mostrando ${filteredData.length} resultados. A média de score para este filtro é ${(filteredData.reduce((a, b) => a + b.finalScore, 0) / filteredData.length).toFixed(1)}.`
                                : 'Ajuste os filtros para ver insights.'}
                        </p>
                    </div>
                </div>

                {/* Main List */}
                <div className="lg:col-span-3 space-y-4">
                    <div className="bg-[var(--bg-card)]/80 backdrop-blur-md rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--bg-card-hover)]/50">
                                    <th className="py-4 px-6 font-bold uppercase text-[9px] tracking-widest cursor-pointer hover:text-[var(--text-main)] group" onClick={() => handleSort('contact')}>
                                        <div className="flex items-center gap-2">
                                            Contato <ArrowUpDown size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </th>
                                    <th className="py-4 px-6 font-bold uppercase text-[9px] tracking-widest cursor-pointer hover:text-[var(--text-main)] group" onClick={() => handleSort('agent')}>
                                        <div className="flex items-center gap-2">
                                            Agente <ArrowUpDown size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </th>
                                    <th className="py-4 px-6 font-bold uppercase text-[9px] tracking-widest text-center cursor-pointer hover:text-[var(--text-main)] group" onClick={() => handleSort('date')}>
                                        <div className="flex items-center gap-2 justify-center">
                                            Data <Calendar size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </th>
                                    <th className="py-4 px-6 font-bold uppercase text-[9px] tracking-widest text-right cursor-pointer hover:text-[var(--text-main)] group" onClick={() => handleSort('finalScore')}>
                                        <div className="flex items-center gap-2 justify-end">
                                            Score IA <ArrowUpDown size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {filteredData.length > 0 ? filteredData.map((item) => (
                                    <tr
                                        key={item.protocol}
                                        onClick={() => {
                                            const liveItem = data.find(d => d.protocol === item.protocol);
                                            onSelect(liveItem || item);
                                        }}
                                        className="hover:bg-primary/[0.03] cursor-pointer transition-all group"
                                    >
                                        <td className="py-5 px-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] group-hover:border-primary/30 group-hover:text-primary transition-all">
                                                    <User size={14} />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-[var(--text-main)] group-hover:text-primary transition-colors">{item.contact}</p>
                                                    <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                                                        <Hash size={10} /> {item.protocol}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-5 px-6">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[8px] font-black text-primary">
                                                    {item.agent.charAt(0)}
                                                </div>
                                                <span className="text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors">{item.agent}</span>
                                            </div>
                                        </td>
                                        <td className="py-5 px-6 text-center">
                                            <span className="text-[10px] font-mono text-[var(--text-muted)]">{new Date(item.date).toLocaleDateString('pt-BR')}</span>
                                        </td>
                                        <td className="py-5 px-6 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        setRefreshingProtocols(prev => [...prev, item.protocol]);
                                                        await recalculateScore(item.protocol);
                                                        if (onRefresh) await onRefresh();
                                                        setRefreshingProtocols(prev => prev.filter(p => p !== item.protocol));
                                                    }}
                                                    className="p-2 rounded-lg bg-[var(--bg-card-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-primary transition-all"
                                                    disabled={refreshingProtocols.includes(item.protocol)}
                                                >
                                                    {refreshingProtocols.includes(item.protocol) ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
                                                </button>
                                                <div className="text-right">
                                                    <span className={`text-sm font-black ${item.status === 'invalidated' ? 'text-[var(--border)] line-through' : item.finalScore >= 8 ? 'text-success-text shadow-[0_0_10px_rgba(46,160,67,0.2)]' : item.finalScore >= 5 ? 'text-warning' : 'text-danger'}`}>
                                                        {item.status === 'invalidated' ? '---' : item.finalScore.toFixed(1)}
                                                    </span>
                                                    <p className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-widest font-mono">Score</p>
                                                </div>
                                                <ChevronRight size={14} className="text-[var(--border)] group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                            </div>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={4} className="py-20 text-center">
                                            <div className="flex flex-col items-center gap-4 opacity-30">
                                                <SearchX size={48} className="text-[var(--text-muted)]" />
                                                <div className="space-y-1">
                                                    <p className="text-xs font-bold uppercase tracking-widest">Nenhum registro encontrado</p>
                                                    <p className="text-[10px] text-[var(--text-muted)]">Tente ajustar seus filtros de busca ou score.</p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-between items-center px-4 py-2">
                        <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">
                            Mostrando {filteredData.length} de {data.length} atendimentos
                        </p>
                        <div className="flex gap-2">
                            {/* Pagination would go here if needed */}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
