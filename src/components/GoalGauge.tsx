import React, { useEffect, useState, useCallback } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// ─── Compact Arc Gauge used in the dashboard header ───────────────────────────
interface GaugeProps {
    percent: number;
    label: string;
    achieved: number;
    target: number;
    color: string;
    size?: number;
}

export const ArcGauge: React.FC<GaugeProps> = ({ percent, label, achieved, target, color, size = 160 }) => {
    const [anim, setAnim] = useState(0);
    // Allow over 100% — cap needle at 110% visually so it doesn't go wild
    const displayPercent = Math.max(0, percent);
    const needlePercent = Math.min(110, displayPercent); // visual cap for needle travel
    const clamped = Math.min(100, displayPercent);       // arc fill still maxes at 100%

    useEffect(() => {
        const t = setTimeout(() => setAnim(needlePercent), 350);
        return () => clearTimeout(t);
    }, [needlePercent]);

    const cx = size / 2, cy = size / 2 + 8, R = size * 0.38;
    const START = -210, END = 30, TOTAL = END - START; // 240°
    const toRad = (d: number) => (d * Math.PI) / 180;
    const pt = (ang: number) => ({ x: cx + R * Math.cos(toRad(ang)), y: cy + R * Math.sin(toRad(ang)) });
    const arc = (a: number, b: number) => {
        const s = pt(a), e = pt(b);
        return `M ${s.x} ${s.y} A ${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
    };

    const needleAng = START + (anim / 110) * TOTAL; // needle uses 110% scale
    const arcFillAng = START + (clamped / 100) * TOTAL; // arc fill uses 100% scale
    const nLen = R - size * 0.1;
    const np = pt(needleAng);

    const gaugeColor = displayPercent >= 100 ? '#00D4AA' : displayPercent >= 70 ? '#5551FF' : displayPercent >= 40 ? '#FFB347' : '#FF6B4A';
    const remaining = Math.max(0, target - achieved);

    return (
        <div className="flex flex-col items-center">
            <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
                <path d={arc(START, END)} fill="none" stroke="var(--border)" strokeWidth={size * 0.055} strokeLinecap="round" />
                <path
                    d={arc(START, arcFillAng)}
                    fill="none" stroke={gaugeColor} strokeWidth={size * 0.055} strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 5px ${gaugeColor}88)`, transition: 'all 1.3s cubic-bezier(0.34,1.56,0.64,1)' }}
                />
                <line
                    x1={cx} y1={cy} x2={np.x} y2={np.y}
                    stroke={gaugeColor} strokeWidth={2} strokeLinecap="round"
                    style={{ transition: 'all 1.3s cubic-bezier(0.34,1.56,0.64,1)', filter: `drop-shadow(0 0 3px ${gaugeColor})` }}
                />
                <circle cx={cx} cy={cy} r={size * 0.035} fill={gaugeColor} style={{ filter: `drop-shadow(0 0 4px ${gaugeColor})` }} />
                <text x={cx} y={cy - size * 0.14} textAnchor="middle" fill="var(--text-main)" fontSize={size * 0.14} fontWeight="bold" fontFamily="Inter,sans-serif">
                    {Math.round(displayPercent)}%
                </text>
                <text x={cx} y={cy - size * 0.01} textAnchor="middle" fill="var(--text-muted)" fontSize={size * 0.07} fontFamily="Inter,sans-serif">
                    {formatCurrency(achieved)}
                </text>
            </svg>
            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest leading-tight text-center mt-1">{label}</p>
            {displayPercent >= 100 ? (
                <span className="text-[10px] text-[#00D4AA] font-bold flex items-center gap-1 mt-1"><Check size={9} /> Meta atingida! {displayPercent > 100 ? `(+${Math.round(displayPercent - 100)}%)` : ''}</span>
            ) : (
                <span className="text-[10px] text-[var(--text-muted)] mt-1">faltam <strong className="text-[var(--text-main)]">{formatCurrency(remaining)}</strong></span>
            )}
        </div>
    );
};

// ─── Hook: load financial goals for a given year ───────────────────────────────
export interface MonthGoal {
    month: number;
    monthly_target: number;
    monthly_achieved: number;
}

export const useFinancialGoals = (year: number) => {
    const [goals, setGoals] = useState<MonthGoal[]>([]);
    const [loading, setLoading] = useState(true);

    const fetch = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('financial_goals')
            .select('month, monthly_target, monthly_achieved')
            .eq('year', year)
            .order('month');

        const map: Record<number, MonthGoal> = {};
        (data ?? []).forEach((r: any) => { map[r.month] = r; });

        // Fill all 12 months, defaulting to 0
        const filled = Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            monthly_target: map[i + 1]?.monthly_target ?? 0,
            monthly_achieved: map[i + 1]?.monthly_achieved ?? 0,
        }));
        setGoals(filled);
        setLoading(false);
    }, [year]);

    useEffect(() => { fetch(); }, [fetch]);

    return { goals, loading, refresh: fetch };
};

// ─── GoalsPage: full page to enter monthly financial goals ────────────────────
interface GoalsPageProps { isAdmin: boolean; }

export const GoalsPage: React.FC<GoalsPageProps> = ({ isAdmin }) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentSemester = currentMonth <= 6 ? 1 : 2;

    const [year, setYear] = useState(currentYear);
    const { goals, loading, refresh } = useFinancialGoals(year);
    const [edited, setEdited] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Local editable state
    const getVal = (month: number, field: 'monthly_target' | 'monthly_achieved') => {
        const key = `${month}_${field}`;
        if (edited[key] !== undefined) return edited[key];
        const g = goals.find(g => g.month === month);
        return g ? String(g[field] === 0 ? '' : g[field]) : '';
    };

    const setVal = (month: number, field: 'monthly_target' | 'monthly_achieved', val: string) => {
        setEdited(prev => ({ ...prev, [`${month}_${field}`]: val }));
    };

    const saveAll = async () => {
        setSaving(true);
        const rows = Array.from({ length: 12 }, (_, i) => {
            const m = i + 1;
            const tgt = parseFloat(getVal(m, 'monthly_target').replace(',', '.') || '0') || 0;
            const ach = parseFloat(getVal(m, 'monthly_achieved').replace(',', '.') || '0') || 0;
            return { year, month: m, monthly_target: tgt, monthly_achieved: ach };
        });

        await supabase.from('financial_goals').upsert(rows, { onConflict: 'year,month' });
        await refresh();
        setEdited({});
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    // Semester summaries
    const semRows = (sem: 1 | 2) => goals.filter(g => (sem === 1 ? g.month <= 6 : g.month > 6));
    const semTarget = (sem: 1 | 2) => semRows(sem).reduce((a, g) => a + g.monthly_target, 0);
    const semAchieved = (sem: 1 | 2) => semRows(sem).reduce((a, g) => a + g.monthly_achieved, 0);

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-[var(--text-main)] tracking-tight">Metas Financeiras</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-1">Preencha as metas mensais e os valores atingidos.</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={year}
                        onChange={e => setYear(Number(e.target.value))}
                        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary"
                    >
                        {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    {isAdmin && (
                        <button
                            onClick={saveAll}
                            disabled={saving}
                            className="btn-primary flex items-center gap-2"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
                            {saved ? 'Salvo!' : 'Salvar Tudo'}
                        </button>
                    )}
                </div>
            </div>

            {/* Semester gauges summary */}
            <div className="grid grid-cols-2 gap-6">
                {[1, 2].map(sem => (
                    <div key={sem} className="glass-card p-6 flex flex-col items-center">
                        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                            {sem}º Semestre {year} {sem === currentSemester && year === currentYear ? '· Atual' : ''}
                        </p>
                        <ArcGauge
                            percent={semTarget(sem as 1 | 2) > 0 ? (semAchieved(sem as 1 | 2) / semTarget(sem as 1 | 2)) * 100 : 0}
                            label={`Meta: ${formatCurrency(semTarget(sem as 1 | 2))}`}
                            achieved={semAchieved(sem as 1 | 2)}
                            target={semTarget(sem as 1 | 2)}
                            color="#5551FF"
                            size={200}
                        />
                    </div>
                ))}
            </div>

            {/* Monthly table — split by semester */}
            {[1, 2].map(sem => {
                const months = Array.from({ length: 6 }, (_, i) => (sem - 1) * 6 + i + 1);
                const stgt = months.reduce((a, m) => a + (parseFloat(getVal(m, 'monthly_target').replace(',', '.') || '0') || 0), 0);
                const sach = months.reduce((a, m) => a + (parseFloat(getVal(m, 'monthly_achieved').replace(',', '.') || '0') || 0), 0);

                return (
                    <div key={sem} className="glass-card overflow-hidden">
                        <div className="px-8 py-5 border-b border-[var(--border)] flex items-center justify-between">
                            <h3 className="font-bold text-[var(--text-main)]">{sem}º Semestre</h3>
                            <div className="flex gap-6 text-[11px]">
                                <span className="text-[var(--text-muted)]">Meta total: <strong className="text-[var(--text-main)]">{formatCurrency(stgt)}</strong></span>
                                <span className={`font-bold ${sach >= stgt && stgt > 0 ? 'text-[#00D4AA]' : 'text-[#FFB347]'}`}>
                                    Atingido: {formatCurrency(sach)} ({stgt > 0 ? Math.round((sach / stgt) * 100) : 0}%)
                                </span>
                            </div>
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[var(--border)]">
                                    <th className="text-left px-8 py-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Mês</th>
                                    <th className="text-right px-8 py-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Meta do Mês (R$)</th>
                                    <th className="text-right px-8 py-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Atingido (R$)</th>
                                    <th className="text-right px-8 py-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">%</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]/50">
                                {months.map(m => {
                                    const tgt = parseFloat(getVal(m, 'monthly_target').replace(',', '.') || '0') || 0;
                                    const ach = parseFloat(getVal(m, 'monthly_achieved').replace(',', '.') || '0') || 0;
                                    const pct = tgt > 0 ? Math.round((ach / tgt) * 100) : null;
                                    const isCurrentMonth = m === currentMonth && year === currentYear;

                                    return (
                                        <tr key={m} className={`hover:bg-white/[0.02] transition-colors ${isCurrentMonth ? 'bg-primary/5' : ''}`}>
                                            <td className="px-8 py-4">
                                                <span className={`text-sm font-bold ${isCurrentMonth ? 'text-primary' : 'text-[var(--text-main)]'}`}>
                                                    {MONTH_NAMES[m - 1]} {year}
                                                    {isCurrentMonth && <span className="ml-2 text-[9px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold tracking-widest uppercase">Atual</span>}
                                                </span>
                                            </td>
                                            <td className="px-8 py-4">
                                                {isAdmin ? (
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={getVal(m, 'monthly_target')}
                                                        onChange={e => setVal(m, 'monthly_target', e.target.value)}
                                                        placeholder="0"
                                                        className="w-full text-right bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary transition-colors"
                                                    />
                                                ) : (
                                                    <span className="text-sm text-right block text-[var(--text-main)]">{tgt ? formatCurrency(tgt) : '—'}</span>
                                                )}
                                            </td>
                                            <td className="px-8 py-4">
                                                {isAdmin ? (
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={getVal(m, 'monthly_achieved')}
                                                        onChange={e => setVal(m, 'monthly_achieved', e.target.value)}
                                                        placeholder="0"
                                                        className="w-full text-right bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:border-primary transition-colors"
                                                    />
                                                ) : (
                                                    <span className="text-sm text-right block text-[var(--text-main)]">{ach ? formatCurrency(ach) : '—'}</span>
                                                )}
                                            </td>
                                            <td className="px-8 py-4 text-right">
                                                {pct !== null ? (
                                                    <span className={`text-sm font-bold ${pct >= 100 ? 'text-[#00D4AA]' : pct >= 70 ? 'text-[#5551FF]' : 'text-[#FFB347]'}`}>
                                                        {pct}%
                                                    </span>
                                                ) : <span className="text-[var(--text-muted)] text-sm">—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
};
