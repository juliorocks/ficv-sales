import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Megaphone, RefreshCw, DollarSign, MessageSquare, Target, MousePointerClick,
    Eye, Loader2, AlertCircle, ChevronDown, XCircle, GraduationCap, TrendingUp, TrendingDown, Wallet, Pencil, Check
} from 'lucide-react';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
    CartesianGrid, ReferenceLine, PieChart, Pie, Legend, LabelList
} from 'recharts';
import { supabase } from '../lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { periodToDates, PERIOD_OPTIONS } from '@/utils/dashboardFilters';

// ─── Types ────────────────────────────────────────────────────────────────────
type AdSource = 'meta' | 'google' | 'all';

interface MetaInsight {
    campaign_id: string;
    campaign_name: string | null;
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    leads_count: number;
}

interface GoogleInsight {
    campaign_id: string;
    campaign_name: string | null;
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
}

interface MetaDemographic {
    date: string;
    age_range: string | null;
    gender: string | null;
    spend: number;
}

interface MetaCampaignOption {
    campaign_id: string;
    name: string;
    status: string | null;
    source: AdSource;
}

interface BudgetInfo {
    metaBalance: number;
    googleBalance: number | null;
}

const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const fmtInt = (v: number) => v.toLocaleString('pt-BR');
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const CHART_COLORS = ['#5551FF', '#8B8BFF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA', '#34D399', '#F472B6'];
const GENDER_COLORS: Record<string, string> = { Female: '#FF6B9D', Male: '#5551FF', Unknown: '#8B8BFF' };
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown'];

// ─── Small helpers ─────────────────────────────────────────────────────────────
async function paginateAll<T>(
    queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await queryFn(from, from + 999);
        if (error) throw error;
        if (data?.length) out.push(...data);
        if (!data || data.length < 1000) break;
    }
    return out;
}

function enumerateDays(start: string, end: string): string[] {
    const days: string[] = [];
    const cursor = new Date(start + 'T12:00:00');
    const last = new Date(end + 'T12:00:00');
    while (cursor <= last) {
        days.push(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 1);
    }
    return days;
}

function previousPeriod(start: string, end: string): { start: string; end: string } {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    const prevEnd = new Date(s);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    return { start: prevStart.toISOString().split('T')[0], end: prevEnd.toISOString().split('T')[0] };
}

function pctDelta(curr: number, prev: number): number | null {
    if (!prev) return null;
    return ((curr - prev) / prev) * 100;
}

// ─── KPI card with sparkline + delta ──────────────────────────────────────────
const KpiCard: React.FC<{
    icon: any; title: string; value: string; delta: number | null;
    goodDirection: 'up' | 'down' | 'neutral'; series: { label: string; value: number }[]; color: string;
}> = ({ icon: Icon, title, value, delta, goodDirection, series, color }) => {
    const isGood = delta === null || goodDirection === 'neutral'
        ? null
        : goodDirection === 'up' ? delta >= 0 : delta <= 0;

    return (
        <div className="glass-card p-5 relative overflow-hidden">
            <div className="flex justify-between items-start mb-3">
                <div className="p-2 rounded-lg" style={{ background: `${color}15` }}>
                    <Icon size={16} style={{ color }} />
                </div>
            </div>
            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">{title}</p>
            <p className="text-xl font-bold text-[var(--text-main)] mb-1">{value}</p>
            <p className={`text-[10px] font-bold flex items-center gap-1 h-4 ${
                isGood === null ? 'text-[var(--text-muted)]' : isGood ? 'text-[#00D4AA]' : 'text-[#FF6B9D]'}`}>
                {delta !== null && (delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />)}
                {delta !== null ? `${Math.abs(delta).toFixed(1)}% vs período anterior` : ''}
            </p>
            <div className="h-10 mt-1 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// ─── Source toggle button ─────────────────────────────────────────────────────
const SourceTab: React.FC<{ label: string; active: boolean; color: string; onClick: () => void }> = ({ label, active, color, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all border ${
            active ? 'text-white border-transparent shadow-lg' : 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
        }`}
        style={active ? { background: color, boxShadow: `0 4px 14px ${color}40` } : {}}
    >
        {label}
    </button>
);

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { isAdmin: boolean; }

export const CampaignsDashboard: React.FC<Props> = ({ isAdmin }) => {
    const [insights, setInsights] = useState<MetaInsight[]>([]);
    const [prevInsights, setPrevInsights] = useState<MetaInsight[]>([]);
    const [gInsights, setGInsights] = useState<GoogleInsight[]>([]);
    const [prevGInsights, setPrevGInsights] = useState<GoogleInsight[]>([]);
    const [demographics, setDemographics] = useState<MetaDemographic[]>([]);
    const [campaignsList, setCampaignsList] = useState<MetaCampaignOption[]>([]);
    const [matriculasCount, setMatriculasCount] = useState<number | null>(null);
    const [monthly, setMonthly] = useState<{ label: string; spend: number; leads: number; matriculas: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState<'meta' | 'google' | null>(null);
    const [lastSync, setLastSync] = useState<string | null>(null);
    const [budget, setBudget] = useState<BudgetInfo | null>(null);
    const [editingGoogleBalance, setEditingGoogleBalance] = useState(false);
    const [googleBalanceInput, setGoogleBalanceInput] = useState('');

    // Filters
    const [source, setSource] = useState<AdSource>('all');
    const [period, setPeriod] = useState('month');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
    const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false);
    const campaignDropdownRef = useRef<HTMLDivElement>(null);

    const { start: dateStart, end: dateEnd } = periodToDates(period, customStart, customEnd);
    const hasActiveFilters = selectedCampaigns.length > 0;

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (campaignDropdownRef.current && !campaignDropdownRef.current.contains(e.target as Node))
                setCampaignDropdownOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ─── Load campaign list (for filter) — campanhas Meta + Google com atividade
    useEffect(() => {
        const loadCampaigns = async () => {
            const [metaRows, googleRows] = await Promise.all([
                paginateAll<{ campaign_id: string; campaign_name: string | null }>((from, to) =>
                    supabase.from('meta_campaign_insights_daily').select('campaign_id,campaign_name')
                        .gte('date', dateStart).lte('date', dateEnd).range(from, to)
                ),
                paginateAll<{ campaign_id: string; campaign_name: string | null }>((from, to) =>
                    supabase.from('google_ads_insights_daily').select('campaign_id,campaign_name')
                        .gte('date', dateStart).lte('date', dateEnd).range(from, to)
                ),
            ]);
            const options: MetaCampaignOption[] = [];
            const seen = new Set<string>();
            metaRows.forEach(r => {
                const key = `meta_${r.campaign_id}`;
                if (!seen.has(key)) { seen.add(key); options.push({ campaign_id: r.campaign_id, name: r.campaign_name || r.campaign_id, status: null, source: 'meta' }); }
            });
            googleRows.forEach(r => {
                const key = `google_${r.campaign_id}`;
                if (!seen.has(key)) { seen.add(key); options.push({ campaign_id: r.campaign_id, name: r.campaign_name || r.campaign_id, status: null, source: 'google' }); }
            });
            options.sort((a, b) => a.name.localeCompare(b.name));
            setCampaignsList(options);
            setSelectedCampaigns(prev => prev.filter(id => options.some(o => o.campaign_id === id)));
        };
        loadCampaigns();
    }, [dateStart, dateEnd]);

    // ─── Save Google balance manually ─────────────────────────────────────────
    const saveGoogleBalance = useCallback(async () => {
        const val = parseFloat(googleBalanceInput.replace(',', '.'));
        if (isNaN(val) || val < 0) { setEditingGoogleBalance(false); return; }
        const { error } = await supabase
            .from('meta_account_stats')
            .upsert({ id: 1, google_balance: val, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        if (!error) setBudget(prev => prev ? { ...prev, googleBalance: val } : prev);
        setEditingGoogleBalance(false);
    }, [googleBalanceInput]);

    // ─── Load period data ──────────────────────────────────────────────────────
    const loadData = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        try {
            const { start: prevStart, end: prevEnd } = previousPeriod(dateStart, dateEnd);
            const metaCols   = 'campaign_id,campaign_name,date,spend,impressions,clicks,leads_count';
            const googleCols = 'campaign_id,campaign_name,date,spend,impressions,clicks,conversions';

            // Determine which campaign IDs belong to which source for filtering
            const metaCampaignIds   = selectedCampaigns.filter(id => campaignsList.find(c => c.campaign_id === id && c.source === 'meta'));
            const googleCampaignIds = selectedCampaigns.filter(id => campaignsList.find(c => c.campaign_id === id && c.source === 'google'));
            const filterMeta   = selectedCampaigns.length === 0 || metaCampaignIds.length > 0;
            const filterGoogle = selectedCampaigns.length === 0 || googleCampaignIds.length > 0;

            const [metaRows, prevMetaRows, gRows, prevGRows, demoRows, matriculasRes, syncRes] = await Promise.all([
                filterMeta ? paginateAll<MetaInsight>((from, to) => {
                    let q = supabase.from('meta_campaign_insights_daily').select(metaCols)
                        .gte('date', dateStart).lte('date', dateEnd);
                    if (metaCampaignIds.length > 0) q = q.in('campaign_id', metaCampaignIds);
                    return q.range(from, to);
                }) : Promise.resolve([] as MetaInsight[]),
                filterMeta ? paginateAll<MetaInsight>((from, to) => {
                    let q = supabase.from('meta_campaign_insights_daily').select(metaCols)
                        .gte('date', prevStart).lte('date', prevEnd);
                    if (metaCampaignIds.length > 0) q = q.in('campaign_id', metaCampaignIds);
                    return q.range(from, to);
                }) : Promise.resolve([] as MetaInsight[]),
                filterGoogle ? paginateAll<GoogleInsight>((from, to) => {
                    let q = supabase.from('google_ads_insights_daily').select(googleCols)
                        .gte('date', dateStart).lte('date', dateEnd);
                    if (googleCampaignIds.length > 0) q = q.in('campaign_id', googleCampaignIds);
                    return q.range(from, to);
                }) : Promise.resolve([] as GoogleInsight[]),
                filterGoogle ? paginateAll<GoogleInsight>((from, to) => {
                    let q = supabase.from('google_ads_insights_daily').select(googleCols)
                        .gte('date', prevStart).lte('date', prevEnd);
                    if (googleCampaignIds.length > 0) q = q.in('campaign_id', googleCampaignIds);
                    return q.range(from, to);
                }) : Promise.resolve([] as GoogleInsight[]),
                paginateAll<MetaDemographic>((from, to) =>
                    supabase.from('meta_demographics_daily').select('date,age_range,gender,spend')
                        .gte('date', dateStart).lte('date', dateEnd).range(from, to)
                ),
                supabase.from('sponte_matriculas').select('contrato_id', { count: 'exact', head: true })
                    .gte('data_matricula', dateStart).lte('data_matricula', dateEnd),
                supabase.from('meta_campaign_insights_daily').select('synced_at')
                    .order('synced_at', { ascending: false }).limit(1).maybeSingle(),
            ]);

            setInsights(metaRows);
            setPrevInsights(prevMetaRows);
            setGInsights(gRows);
            setPrevGInsights(prevGRows);
            setDemographics(demoRows);
            setMatriculasCount(matriculasRes.count ?? 0);
            if (syncRes.data) setLastSync((syncRes.data as any).synced_at);

            // Budget info
            const statsRes = await supabase
                .from('meta_account_stats')
                .select('balance,google_balance')
                .eq('id', 1)
                .single();
            const metaBalance   = (statsRes.data as any)?.balance        ?? 0;
            const googleBalance = (statsRes.data as any)?.google_balance  ?? null;
            setBudget({ metaBalance, googleBalance });
        } catch (e) {
            console.error('loadData error:', e);
            showError('Erro ao carregar campanhas: ' + (e as Error)?.message);
        } finally {
            if (!opts?.silent) setLoading(false);
        }
    }, [dateStart, dateEnd, selectedCampaigns, campaignsList]);

    useEffect(() => { loadData(); }, [loadData]);

    // ─── Monthly cross-reference (last 6 months, independent of period filter) ─
    const loadMonthly = useCallback(async () => {
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - 5);
        start.setDate(1);
        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];

        try {
            const [insightRows, matriculaRows] = await Promise.all([
                paginateAll<{ date: string; spend: number; leads_count: number }>((from, to) =>
                    supabase.from('meta_campaign_insights_daily').select('date,spend,leads_count')
                        .gte('date', startStr).lte('date', endStr).range(from, to)
                ),
                paginateAll<{ data_matricula: string }>((from, to) =>
                    supabase.from('sponte_matriculas').select('data_matricula')
                        .gte('data_matricula', startStr).lte('data_matricula', endStr).range(from, to)
                ),
            ]);

            const byMonth: Record<string, { label: string; spend: number; leads: number; matriculas: number }> = {};
            insightRows.forEach(r => {
                if (!r.date) return;
                const d = new Date(r.date + 'T12:00:00');
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (!byMonth[key]) byMonth[key] = { label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), spend: 0, leads: 0, matriculas: 0 };
                byMonth[key].spend += Number(r.spend) || 0;
                byMonth[key].leads += Number(r.leads_count) || 0;
            });
            matriculaRows.forEach(r => {
                if (!r.data_matricula) return;
                const d = new Date(r.data_matricula + 'T12:00:00');
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (!byMonth[key]) byMonth[key] = { label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), spend: 0, leads: 0, matriculas: 0 };
                byMonth[key].matriculas += 1;
            });

            setMonthly(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v));
        } catch (e) {
            console.error('loadMonthly error:', e);
        }
    }, []);

    useEffect(() => { loadMonthly(); }, [loadMonthly]);

    // Atualiza em segundo plano (sem loading spinner) pra refletir os syncs
    // automáticos do cron sem precisar dar refresh na página.
    useEffect(() => {
        const id = setInterval(() => {
            loadData({ silent: true });
            loadMonthly();
        }, 3 * 60 * 1000);
        return () => clearInterval(id);
    }, [loadData, loadMonthly]);

    // ─── Sync via Edge Functions ───────────────────────────────────────────────
    // As Edge Functions sincronizam Meta/Google → Supabase → SurrealDB internamente.
    const handleSyncMeta = async () => {
        setSyncing('meta');
        try {
            const { data, error } = await supabase.functions.invoke('sync-meta-ads', {
                body: { start_date: dateStart, end_date: dateEnd },
            });
            if (error) throw error;
            showSuccess(`Meta: ${data?.campaigns?.synced ?? 0} campanhas, ${data?.insights?.synced ?? 0} registros`);
            await Promise.all([loadData(), loadMonthly()]);
        } catch (e: any) {
            showError('Erro Meta Ads: ' + e.message);
        } finally {
            setSyncing(null);
        }
    };

    const handleSyncGoogle = async () => {
        setSyncing('google');
        try {
            const { data, error } = await supabase.functions.invoke('sync-google-ads', {
                body: { start_date: dateStart, end_date: dateEnd },
            });
            if (error) throw error;
            showSuccess(`Google Ads: ${data?.campaigns?.synced ?? 0} campanhas, ${data?.insights?.synced ?? 0} registros`);
            await Promise.all([loadData(), loadMonthly()]);
        } catch (e: any) {
            showError('Erro Google Ads: ' + e.message);
        } finally {
            setSyncing(null);
        }
    };

    // ─── Aggregations ──────────────────────────────────────────────────────────
    // Unified row type for combined analysis
    const activeInsights = useMemo(() => {
        const metaRows = (source === 'google' ? [] : insights).map(r => ({
            campaign_id: r.campaign_id, campaign_name: r.campaign_name,
            date: r.date, spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0, leads: Number(r.leads_count) || 0, source: 'Meta' as const,
        }));
        const googleRows = (source === 'meta' ? [] : gInsights).map(r => ({
            campaign_id: r.campaign_id, campaign_name: r.campaign_name,
            date: r.date, spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0, leads: Number(r.conversions) || 0, source: 'Google' as const,
        }));
        return [...metaRows, ...googleRows];
    }, [insights, gInsights, source]);

    const prevActiveInsights = useMemo(() => {
        const metaRows = (source === 'google' ? [] : prevInsights).map(r => ({
            spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0, leads: Number(r.leads_count) || 0,
        }));
        const googleRows = (source === 'meta' ? [] : prevGInsights).map(r => ({
            spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0, leads: Number(r.conversions) || 0,
        }));
        return [...metaRows, ...googleRows];
    }, [prevInsights, prevGInsights, source]);

    const aggregate = (rows: { spend: number; impressions: number; clicks: number; leads: number }[]) => {
        const spend = rows.reduce((s, r) => s + r.spend, 0);
        const impressions = rows.reduce((s, r) => s + r.impressions, 0);
        const clicks = rows.reduce((s, r) => s + r.clicks, 0);
        const leads = rows.reduce((s, r) => s + r.leads, 0);
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const cpa = leads > 0 ? spend / leads : 0;
        return { spend, impressions, clicks, leads, ctr, cpm, cpa };
    };

    const totals = useMemo(() => aggregate(activeInsights), [activeInsights]);
    const prevTotals = useMemo(() => aggregate(prevActiveInsights), [prevActiveInsights]);

    const dailySeries = useMemo(() => {
        const byDate: Record<string, { spend: number; leads: number; impressions: number; clicks: number }> = {};
        activeInsights.forEach(r => {
            if (!byDate[r.date]) byDate[r.date] = { spend: 0, leads: 0, impressions: 0, clicks: 0 };
            byDate[r.date].spend += r.spend;
            byDate[r.date].leads += r.leads;
            byDate[r.date].impressions += r.impressions;
            byDate[r.date].clicks += r.clicks;
        });
        return enumerateDays(dateStart, dateEnd).map(d => {
            const v = byDate[d] || { spend: 0, leads: 0, impressions: 0, clicks: 0 };
            return {
                date: d,
                label: new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                spend: Number(Number(v.spend).toFixed(2)),
                leads: v.leads,
                ctr: v.impressions > 0 ? Number(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
                cpm: v.impressions > 0 ? Number(((v.spend / v.impressions) * 1000).toFixed(2)) : 0,
            };
        });
    }, [activeInsights, dateStart, dateEnd]);

    const avgSpend = useMemo(() => {
        if (dailySeries.length === 0) return 0;
        return dailySeries.reduce((s, d) => s + d.spend, 0) / dailySeries.length;
    }, [dailySeries]);

    const spendSeries = useMemo(() => dailySeries.map(d => ({ label: d.label, value: d.spend })), [dailySeries]);
    const leadsSeries = useMemo(() => dailySeries.map(d => ({ label: d.label, value: d.leads })), [dailySeries]);
    const ctrSeries = useMemo(() => dailySeries.map(d => ({ label: d.label, value: d.ctr })), [dailySeries]);
    const cpmSeries = useMemo(() => dailySeries.map(d => ({ label: d.label, value: d.cpm })), [dailySeries]);

    const campaignRows = useMemo(() => {
        const byCampaign: Record<string, { name: string; spend: number; leads: number; impressions: number; clicks: number; source: string }> = {};
        activeInsights.forEach(r => {
            const key = `${r.source}_${r.campaign_id}`;
            if (!byCampaign[key]) byCampaign[key] = { name: r.campaign_name || r.campaign_id, spend: 0, leads: 0, impressions: 0, clicks: 0, source: r.source };
            byCampaign[key].spend += r.spend;
            byCampaign[key].leads += r.leads;
            byCampaign[key].impressions += r.impressions;
            byCampaign[key].clicks += r.clicks;
        });
        return Object.values(byCampaign)
            .map(c => ({
                ...c,
                ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
                cpa: c.leads > 0 ? c.spend / c.leads : 0,
            }))
            .sort((a, b) => b.spend - a.spend);
    }, [activeInsights]);

    const genderData = useMemo(() => {
        const byGender: Record<string, number> = {};
        demographics.forEach(r => {
            const raw = (r.gender || 'unknown').toLowerCase();
            const label = raw === 'female' ? 'Female' : raw === 'male' ? 'Male' : 'Unknown';
            byGender[label] = (byGender[label] || 0) + (r.spend || 0);
        });
        return Object.entries(byGender).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
    }, [demographics]);

    const ageData = useMemo(() => {
        const byAge: Record<string, number> = {};
        demographics.forEach(r => {
            const a = r.age_range || 'unknown';
            byAge[a] = (byAge[a] || 0) + (r.spend || 0);
        });
        const maxVal = Math.max(1, ...Object.values(byAge));
        return Object.entries(byAge)
            .sort(([a], [b]) => AGE_ORDER.indexOf(a) - AGE_ORDER.indexOf(b))
            .map(([name, value]) => ({ name, value, pct: (value / maxVal) * 100 }));
    }, [demographics]);

    // ─── ROI (cruzamento com Sponte) ────────────────────────────────────────────
    const custoPorMatricula = matriculasCount && matriculasCount > 0 ? totals.spend / matriculasCount : null;
    const leadsToMatriculaPct = matriculasCount !== null && totals.leads > 0 ? (matriculasCount / totals.leads) * 100 : null;

    const monthlyMax = useMemo(() => Math.max(1, ...monthly.map(m => m.spend)), [monthly]);

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-primary mb-2">
                        <Megaphone size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Tráfego Pago — Meta Ads + Google Ads</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Campanhas</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-1">
                        Investimento, leads e retorno das campanhas, cruzado com matrículas do Sponte.
                        {lastSync && (
                            <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                                Última sync: {new Date(lastSync).toLocaleString('pt-BR')}
                            </span>
                        )}
                    </p>
                </div>
                {isAdmin && (
                    <div className="flex gap-2 shrink-0">
                        <button onClick={handleSyncMeta} disabled={syncing !== null} className="btn-primary flex items-center gap-2 text-sm" style={{ background: '#1877F2' }}>
                            {syncing === 'meta' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            {syncing === 'meta' ? 'Sincronizando…' : 'Sync Meta'}
                        </button>
                        <button onClick={handleSyncGoogle} disabled={syncing !== null} className="btn-primary flex items-center gap-2 text-sm" style={{ background: '#F97316' }}>
                            {syncing === 'google' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            {syncing === 'google' ? 'Sincronizando…' : 'Sync Google'}
                        </button>
                    </div>
                )}
            </div>

            {/* Source toggle + saldo de conta */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <SourceTab label="Todos" active={source === 'all'} color="#5551FF" onClick={() => setSource('all')} />
                    <SourceTab label="Meta Ads" active={source === 'meta'} color="#1877F2" onClick={() => setSource('meta')} />
                    <SourceTab label="Google Ads" active={source === 'google'} color="#F97316" onClick={() => setSource('google')} />
                </div>
                {budget && (
                    <div className="flex items-center gap-2">
                        {budget.metaBalance > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs">
                                <Wallet size={12} style={{ color: '#1877F2' }} />
                                <span className="text-[var(--text-muted)] font-semibold">Meta Ads</span>
                                <span className="font-bold text-[var(--text-main)]">{fmt(budget.metaBalance)}</span>
                            </div>
                        )}
                        {/* Google Ads — valor editável manualmente (API não expõe o saldo pré-pago) */}
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs">
                            <Wallet size={12} style={{ color: '#F97316' }} />
                            <span className="text-[var(--text-muted)] font-semibold">Google Ads</span>
                            {editingGoogleBalance ? (
                                <>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={googleBalanceInput}
                                        onChange={e => setGoogleBalanceInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveGoogleBalance(); if (e.key === 'Escape') setEditingGoogleBalance(false); }}
                                        onBlur={saveGoogleBalance}
                                        className="w-24 bg-transparent border-b border-[var(--border)] outline-none font-bold text-[var(--text-main)] text-right"
                                        placeholder="0,00"
                                    />
                                    <Check size={11} className="cursor-pointer text-green-400" onClick={saveGoogleBalance} />
                                </>
                            ) : (
                                <>
                                    <span className="font-bold text-[var(--text-main)]">
                                        {budget.googleBalance !== null ? fmt(budget.googleBalance) : '—'}
                                    </span>
                                    <Pencil
                                        size={10}
                                        className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-main)]"
                                        onClick={() => {
                                            setGoogleBalanceInput(budget.googleBalance !== null ? String(budget.googleBalance) : '');
                                            setEditingGoogleBalance(true);
                                        }}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Filters */}
            <div className="glass-card p-4 flex flex-wrap gap-3 items-end">
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

                {/* Campaign multi-select */}
                <div className="flex flex-col gap-1" ref={campaignDropdownRef}>
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Campanhas</span>
                    <div className="relative">
                        <button
                            onClick={() => setCampaignDropdownOpen(o => !o)}
                            className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary min-w-[220px] w-full text-left"
                        >
                            <span className="flex-1 truncate">
                                {selectedCampaigns.length === 0
                                    ? 'Todas as campanhas'
                                    : selectedCampaigns.length === 1
                                        ? campaignsList.find(c => c.campaign_id === selectedCampaigns[0])?.name ?? '1 campanha'
                                        : `${selectedCampaigns.length} campanhas selecionadas`}
                            </span>
                            <ChevronDown size={12} className={`shrink-0 text-[var(--text-muted)] transition-transform ${campaignDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {campaignDropdownOpen && (
                            <div className="absolute top-full mt-1 left-0 z-[200] bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto max-h-72"
                                style={{ minWidth: '100%', width: 'max-content', maxWidth: '520px' }}>
                                <label className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors">
                                    <input type="checkbox" className="w-3.5 h-3.5 accent-primary cursor-pointer"
                                        checked={selectedCampaigns.length === 0}
                                        onChange={() => setSelectedCampaigns([])} />
                                    <span className="text-xs font-bold text-[var(--text-main)] whitespace-nowrap">Todas as campanhas</span>
                                </label>
                                <div className="h-px bg-[var(--border)] mx-2" />
                                {campaignsList.map(c => (
                                    <label key={`${c.source}_${c.campaign_id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors">
                                        <input
                                            type="checkbox"
                                            className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0"
                                            checked={selectedCampaigns.includes(c.campaign_id)}
                                            onChange={() => setSelectedCampaigns(prev =>
                                                prev.includes(c.campaign_id) ? prev.filter(x => x !== c.campaign_id) : [...prev, c.campaign_id]
                                            )}
                                        />
                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold text-white shrink-0 ${c.source === 'meta' ? 'bg-[#1877F2]' : 'bg-[#F97316]'}`}>
                                            {c.source === 'meta' ? 'Meta' : 'Google'}
                                        </span>
                                        <span className={`text-xs ${selectedCampaigns.includes(c.campaign_id) ? 'text-primary font-bold' : 'text-[var(--text-main)]'}`}>{c.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {hasActiveFilters && (
                    <div className="flex flex-col gap-1 justify-end">
                        <span className="text-[9px] font-bold text-transparent uppercase tracking-widest select-none">.</span>
                        <button
                            onClick={() => setSelectedCampaigns([])}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border)] hover:border-primary/50 transition-all whitespace-nowrap"
                        >
                            <XCircle size={12} /> Limpar filtros
                        </button>
                    </div>
                )}
            </div>

            {/* Empty state */}
            {!loading && activeInsights.length === 0 && (
                <div className="glass-card p-12 flex flex-col items-center gap-4 text-center">
                    <AlertCircle size={32} className="text-[var(--text-muted)]" />
                    <div>
                        <p className="font-bold text-[var(--text-main)]">Nenhum dado sincronizado ainda</p>
                        <p className="text-[var(--text-muted)] text-sm mt-1">
                            Clique em <strong>Sync Meta</strong> ou <strong>Sync Google</strong> para importar as campanhas.
                        </p>
                    </div>
                </div>
            )}

            {activeInsights.length > 0 && (
                <>
                    {/* KPI cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <KpiCard icon={DollarSign} title="Investimento" value={fmt(totals.spend)}
                            delta={pctDelta(totals.spend, prevTotals.spend)} goodDirection="neutral"
                            series={spendSeries} color="#5551FF" />
                        <KpiCard icon={MessageSquare} title="Conversas / Leads" value={fmtInt(totals.leads)}
                            delta={pctDelta(totals.leads, prevTotals.leads)} goodDirection="up"
                            series={leadsSeries} color="#00D4AA" />
                        <KpiCard icon={Target} title="Custo / Conversão" value={fmt(totals.cpa)}
                            delta={pctDelta(totals.cpa, prevTotals.cpa)} goodDirection="down"
                            series={dailySeries.map(d => ({ label: d.label, value: d.leads > 0 ? d.spend / d.leads : 0 }))} color="#FFB347" />
                        <KpiCard icon={MousePointerClick} title="CTR" value={fmtPct(totals.ctr)}
                            delta={pctDelta(totals.ctr, prevTotals.ctr)} goodDirection="up"
                            series={ctrSeries} color="#FF6B9D" />
                        <KpiCard icon={Eye} title="CPM" value={fmt(totals.cpm)}
                            delta={pctDelta(totals.cpm, prevTotals.cpm)} goodDirection="down"
                            series={cpmSeries} color="#A78BFA" />
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="glass-card p-6">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                                Leads Pagos por Dia
                            </h3>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={dailySeries} margin={{ left: 0, right: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                        <Tooltip
                                            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                            formatter={(v: any) => [`${v} leads`, '']}
                                        />
                                        <Bar dataKey="leads" fill="#00D4AA" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="glass-card p-6">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                                Gasto Diário
                            </h3>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={dailySeries} margin={{ left: 0, right: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                        <Tooltip
                                            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                            formatter={(v: any) => [fmt(v), 'Gasto']}
                                        />
                                        <ReferenceLine y={avgSpend} stroke="var(--text-muted)" strokeDasharray="4 4"
                                            label={{ value: `Média (${fmt(avgSpend)})`, fill: 'var(--text-muted)', fontSize: 10, position: 'insideTopLeft' }} />
                                        <Bar dataKey="spend" fill="#5551FF" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Campaign table */}
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Campanhas</h3>
                            <span className="text-[10px] text-[var(--text-muted)]">{campaignRows.length} campanha{campaignRows.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                                        {['Fonte', 'Campanha', 'Investimento', 'Leads/Conv.', 'CTR', 'CPA'].map(h => (
                                            <th key={h} className="pb-3 px-2 font-bold uppercase tracking-wider text-[9px] whitespace-nowrap">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {campaignRows.map((c, i) => (
                                        <tr key={i} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-card-hover)] transition-colors">
                                            <td className="py-2.5 px-2 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold text-white ${c.source === 'Meta' ? 'bg-[#1877F2]' : 'bg-[#F97316]'}`}>
                                                    {c.source}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-2 font-medium text-[var(--text-main)] max-w-[260px] truncate">{c.name}</td>
                                            <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap">{fmt(c.spend)}</td>
                                            <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap">{fmtInt(c.leads)}</td>
                                            <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap">{fmtPct(c.ctr)}</td>
                                            <td className="py-2.5 px-2 text-[var(--text-muted)] whitespace-nowrap">{c.leads > 0 ? fmt(c.cpa) : '—'}</td>
                                        </tr>
                                    ))}
                                    <tr className="font-bold text-[var(--text-main)] border-t border-[var(--border)]">
                                        <td className="py-3 px-2" colSpan={2}>Total geral</td>
                                        <td className="py-3 px-2 whitespace-nowrap">{fmt(totals.spend)}</td>
                                        <td className="py-3 px-2 whitespace-nowrap">{fmtInt(totals.leads)}</td>
                                        <td className="py-3 px-2 whitespace-nowrap">{fmtPct(totals.ctr)}</td>
                                        <td className="py-3 px-2 whitespace-nowrap">{totals.leads > 0 ? fmt(totals.cpa) : '—'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Demographics */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="glass-card p-6">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Gênero</h3>
                            {genderData.length === 0 ? (
                                <p className="text-center py-16 text-[var(--text-muted)] text-sm">Não há dados demográficos no período.</p>
                            ) : (
                                <div className="h-56">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={genderData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
                                                {genderData.map((g, i) => <Cell key={i} fill={GENDER_COLORS[g.name] ?? CHART_COLORS[i]} />)}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                                formatter={(v: any) => [fmt(v), 'Gasto']}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '11px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        <div className="glass-card p-6">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Idade</h3>
                            {ageData.length === 0 ? (
                                <p className="text-center py-16 text-[var(--text-muted)] text-sm">Não há dados demográficos no período.</p>
                            ) : (
                                <div className="space-y-3">
                                    {ageData.map((a, i) => (
                                        <div key={a.name} className="flex items-center gap-3">
                                            <span className="text-[10px] font-bold text-[var(--text-muted)] w-14 shrink-0">{a.name}</span>
                                            <div className="flex-1 h-2 rounded-full bg-[var(--bg-card-hover)] overflow-hidden">
                                                <div className="h-full rounded-full" style={{ width: `${a.pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                                            </div>
                                            <span className="text-[10px] text-[var(--text-muted)] w-20 text-right shrink-0">{fmt(a.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ROI — cruzamento com matrículas do Sponte */}
                    <div className="glass-card p-6">
                        <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                            Retorno das Campanhas
                        </h3>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <RoiStat icon={DollarSign} title="Investimento" value={fmt(totals.spend)} color="#5551FF" />
                            <RoiStat icon={GraduationCap} title="Matrículas no Período" value={matriculasCount !== null ? fmtInt(matriculasCount) : '—'} color="#00D4AA" />
                            <RoiStat icon={Target} title="Custo por Matrícula" value={custoPorMatricula !== null ? fmt(custoPorMatricula) : '—'} color="#FFB347" />
                            <RoiStat icon={TrendingUp} title="Conversão Leads → Matrícula" value={leadsToMatriculaPct !== null ? fmtPct(leadsToMatriculaPct) : '—'} color="#FF6B9D" />
                        </div>
                    </div>

                    {/* Monthly cross-reference */}
                    <div className="glass-card p-6">
                        <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">
                            Investimento x Leads x Matrículas (Mensal)
                        </h3>
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthly} margin={{ left: 0, right: 8, top: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} domain={[0, monthlyMax * 1.15]} />
                                    <Tooltip
                                        contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                        formatter={(v: any, name: string) => [name === 'spend' ? fmt(v) : fmtInt(v), name === 'spend' ? 'Investimento' : name === 'leads' ? 'Leads' : 'Matrículas']}
                                    />
                                    <Legend
                                        formatter={(value: string) => value === 'spend' ? 'Investimento' : value === 'leads' ? 'Leads' : 'Matrículas'}
                                        wrapperStyle={{ fontSize: '11px' }}
                                    />
                                    <Bar dataKey="spend" fill="#0D1B4C" radius={[4, 4, 0, 0]}>
                                        <LabelList dataKey="spend" position="top" formatter={(v: any) => fmt(v)} fill="var(--text-main)" fontSize={9} />
                                    </Bar>
                                    <Bar dataKey="leads" fill="#7B5CF0" radius={[4, 4, 0, 0]}>
                                        <LabelList dataKey="leads" position="top" fill="var(--text-main)" fontSize={9} />
                                    </Bar>
                                    <Bar dataKey="matriculas" fill="#00D4AA" radius={[4, 4, 0, 0]}>
                                        <LabelList dataKey="matriculas" position="top" fill="var(--text-main)" fontSize={9} />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// ─── ROI stat block ───────────────────────────────────────────────────────────
const RoiStat: React.FC<{ icon: any; title: string; value: string; color: string }> = ({ icon: Icon, title, value, color }) => (
    <div className="p-4 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)]">
        <div className="p-2 rounded-lg inline-flex mb-3" style={{ background: `${color}15` }}>
            <Icon size={16} style={{ color }} />
        </div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">{title}</p>
        <p className="text-lg font-bold text-[var(--text-main)]">{value}</p>
    </div>
);
