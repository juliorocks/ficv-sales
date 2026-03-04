import React, { useState, useEffect, useMemo } from 'react';
import {
    LayoutDashboard,
    Users,
    Settings,
    Tv,
    LogOut,
    TrendingUp,
    Clock,
    MessageSquare,
    Award,
    Filter,
    Calendar,
    History,
    FileUp,
    FileText,
    Trash2,
    RefreshCcw,
    BookOpen,
    ChevronRight,
    Loader2,
    Target,
    ArrowLeft,
    Sun,
    Moon
} from 'lucide-react';
import { recalculateAllScores } from './services/reprocessor';
import { CSVUploader } from './components/CSVUploader';
import { GoalDashboard } from './components/GoalDashboard';
import { AgentProfile } from './components/AgentProfile';
import { Login } from './components/Login';
import { AnalysisDetail } from './components/AnalysisDetail';
import { KnowledgeBase } from './components/KnowledgeBase';
import { Scripts } from './components/Scripts';
import { ArcGauge, GoalsPage, useFinancialGoals } from './components/GoalGauge';
import { AgentAdmin, useAgentProfiles, AgentAvatar } from './components/AgentAdmin';
import { HistoryLog } from './components/HistoryLog';
import { UserManagement } from './components/UserManagement';
import { ConversationAnalysis } from './utils/csvProcessor';
import { supabase } from './lib/supabase';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    LineChart, Line, CartesianGrid,
    PieChart, Pie, Legend
} from 'recharts';
import confetti from 'canvas-confetti';

interface Profile {
    id: string;
    full_name: string;
    role: 'admin' | 'agent';
    avatar_url: string;
    score: number;
}

// Temporary component for navigation items
const NavItem = React.memo(({ icon: Icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`sidebar-item ${active ? 'sidebar-item-active' : ''}`}
    >
        <Icon size={18} />
        <span className="font-medium text-[13px]">{label}</span>
    </button>
));
NavItem.displayName = 'NavItem';


// Stat card component
const StatCard = React.memo(({ title, value, subtext, icon: Icon, trend }: { title: string, value: string, subtext?: string, icon: any, trend?: string }) => (
    <div className="glass-card p-6 relative overflow-hidden active:scale-[0.98] cursor-pointer">
        <div className="flex justify-between items-start mb-6">
            <div className="p-2.5 bg-[var(--bg-card-hover)] rounded-lg border border-[var(--border)]">
                <Icon size={18} className="text-primary" />
            </div>
            <div className="pill-indicator">
                <div className="w-1 h-1 rounded-full bg-success-text" />
                <span>{trend || 'Período selecionado'}</span>
            </div>
        </div>
        <div>
            <p className="text-[var(--text-muted)] text-[11px] font-medium uppercase tracking-wider mb-2">{title}</p>
            <h3 className="text-2xl font-bold text-[var(--text-main)] mb-1">{value}</h3>
            {subtext && <p className="text-[var(--text-muted)] text-[10px]">{subtext}</p>}
        </div>
    </div>
));
StatCard.displayName = 'StatCard';


function App({ session, isDarkMode, setIsDarkMode }: { session: any, isDarkMode: boolean, setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>> }) {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [analysisData, setAnalysisData] = useState<ConversationAnalysis[]>([]);
    const [isTvMode, setIsTvMode] = useState(false);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    // Filter states
    const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [isAgentFilterOpen, setIsAgentFilterOpen] = useState(false);
    const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
    const [uploadLogs, setUploadLogs] = useState<any[]>([]);
    const [selectedAnalysis, setSelectedAnalysis] = useState<ConversationAnalysis | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshProgress, setRefreshProgress] = useState({ current: 0, total: 0 });

    useEffect(() => {
        if (!session?.user?.id) return;
        fetchProfile(session.user.id);
    }, [session?.user?.id]);

    const fetchData = async (currentProfile?: any) => {
        let allLogs: any[] = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;

        const activeProfile = currentProfile || profile;

        // Determine if we need to filter by agent profile name
        let targetAgentName: string | null = null;
        if (activeProfile && activeProfile.role === 'agent') {
            targetAgentName = activeProfile.full_name;
        }

        while (hasMore) {
            let query = supabase
                .from('messages_logs')
                .select('id, protocol, contact, agent_name, agent_id, timestamp, empathy_score, clarity_score, depth_score, commercial_score, agility_score, final_score, message_count, closing_attempt, status, is_commercial, overall_conclusion, improvements')
                .order('timestamp', { ascending: false });

            // Apply filter only if agent (and we have their profile name)
            if (targetAgentName) {
                query = query.eq('agent_name', targetAgentName);
            }

            const { data, error } = await query.range(from, from + limit - 1);

            if (error) {
                console.error("Fetch error:", error);
                hasMore = false;
                break;
            }

            if (!data || data.length === 0) {
                hasMore = false;
                break;
            }

            allLogs = [...allLogs, ...data];
            if (data.length < limit) hasMore = false;
            from += limit;
        }

        console.log(`Finished fetching ${allLogs.length} logs.`);

        if (allLogs.length > 0) {
            const mappedData = allLogs.map(d => {
                let transcript = [];
                try {
                    transcript = d.message_content ? (typeof d.message_content === 'string' ? JSON.parse(d.message_content) : d.message_content) : [];
                } catch (e) {
                    console.error('Error parsing transcript:', e);
                }

                return {
                    protocol: d.protocol || '',
                    agent: d.agent_name || d.agent || 'Desconhecido',
                    contact: d.contact || 'Desconhecido',
                    finalScore: d.final_score || 0,
                    empathyScore: d.empathy_score || 0,
                    clarityScore: d.clarity_score || 0,
                    depthScore: d.depth_score || 0,
                    commercialScore: d.commercial_score || 0,
                    agilityScore: d.agility_score || 0,
                    closingAttempt: d.closing_attempt || false,
                    isCommercial: d.is_commercial !== null ? d.is_commercial : true,
                    overallConclusion: d.overall_conclusion || '',
                    improvements: d.improvements || [],
                    messageCount: d.message_count || 0,
                    date: d.timestamp || '',
                    status: d.status || 'approved',
                    transcript: transcript
                } as ConversationAnalysis;
            });
            console.log(`Successfully mapped ${mappedData.length} logs.`);
            setAnalysisData(mappedData);
        } else {
            console.warn("No logs fetched from messages_logs.");
            setAnalysisData([]);
        }

        fetchUploadLogs();
    };

    const updateAnalysisStatus = async (protocol: string, status: 'approved' | 'invalidated') => {
        const { error } = await supabase
            .from('messages_logs')
            .update({ status })
            .eq('protocol', protocol);

        if (!error) {
            setAnalysisData(prev => prev.map(d => d.protocol === protocol ? { ...d, status } : d));
            if (selectedAnalysis?.protocol === protocol) {
                setSelectedAnalysis(prev => prev ? { ...prev, status } : null);
            }
        }
    };

    const updateAnalysisScores = async (protocol: string, newScores: any) => {
        const { error } = await supabase
            .from('messages_logs')
            .update({
                empathy_score: newScores.empathy,
                clarity_score: newScores.clarity,
                depth_score: newScores.depth,
                commercial_score: newScores.commercial,
                agility_score: newScores.agility,
                final_score: newScores.finalScore,
                is_commercial: newScores.isCommercial
            })
            .eq('protocol', protocol);

        if (error) {
            console.error('Error saving scores:', error);
            alert('Erro ao salvar no banco de dados: ' + error.message);
            return;
        }

        const updatedItem = {
            empathyScore: newScores.empathy,
            clarityScore: newScores.clarity,
            depthScore: newScores.depth,
            commercialScore: newScores.commercial,
            agilityScore: newScores.agility,
            finalScore: newScores.finalScore,
            isCommercial: newScores.isCommercial // Keep in local state
        };

        setAnalysisData(prev => prev.map(d => d.protocol === protocol ? { ...d, ...updatedItem } : d));

        if (selectedAnalysis?.protocol === protocol) {
            setSelectedAnalysis(prev => prev ? { ...prev, ...updatedItem } : null);
        }
    };



    const handleNext = () => {
        if (!selectedAnalysis) return;
        const currentIndex = filteredData.findIndex(d => d.protocol === selectedAnalysis.protocol);
        if (currentIndex < filteredData.length - 1) {
            setSelectedAnalysis(filteredData[currentIndex + 1]);
        }
    };

    const handlePrevious = () => {
        if (!selectedAnalysis) return;
        const currentIndex = filteredData.findIndex(d => d.protocol === selectedAnalysis.protocol);
        if (currentIndex > 0) {
            setSelectedAnalysis(filteredData[currentIndex - 1]);
        }
    };


    const fetchUploadLogs = async () => {
        const { data, error } = await supabase
            .from('upload_logs')
            .select('*, profiles(full_name)')
            .order('created_at', { ascending: false })
            .limit(10);

        if (!error && data) setUploadLogs(data);
    };

    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (!error && data) {
                setProfile(data);
                fetchData(data); // Pass parameter to avoid stale state in React
            }
        } catch (err) {
            console.error('Profile fetch error:', err);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleLogout = () => {
        supabase.auth.signOut();
    };

    const handleDeleteLog = async (logId: string) => {
        if (!confirm('Tem certeza que deseja apagar esta importação? Isso removerá permanentemente os registros e as análises associadas a este arquivo.')) return;

        try {
            const { error } = await supabase
                .from('upload_logs')
                .delete()
                .eq('id', logId);

            if (error) throw error;

            // Refresh data
            fetchData();
        } catch (err) {
            console.error('Error deleting log:', err);
            alert('Falha ao apagar o registro.');
        }
    };


    // TV Mode Auto-cycling
    useEffect(() => {
        if (!isTvMode) return;

        const interval = setInterval(() => {
            setActiveTab(prev => prev === 'dashboard' ? 'agents' : 'dashboard');
        }, 30000); // 30 seconds

        return () => clearInterval(interval);
    }, [isTvMode]);

    const mockAgentData = [
        { name: 'Thayanne', value: 9.4, sales: 42, rank: '🥇' },
        { name: 'Karina', value: 8.2, sales: 38, rank: '🥈' },
        { name: 'João', value: 7.9, sales: 31, rank: '🥉' }
    ];

    // Date Presets Logic
    const setDatePreset = (preset: string) => {
        const now = new Date();
        const start = new Date();
        let end = new Date();

        switch (preset) {
            case 'today':
                start.setHours(0, 0, 0, 0);
                break;
            case 'week':
                start.setDate(now.getDate() - now.getDay());
                start.setHours(0, 0, 0, 0);
                break;
            case 'month':
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                break;
            case 'semester':
                const month = now.getMonth();
                start.setMonth(month < 6 ? 0 : 6);
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                break;
            case 'year':
                start.setMonth(0);
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                break;
            default:
                setDateRange({ start: '', end: '' });
                return;
        }
        setDateRange({
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
        });
    };

    // Filter results
    const filteredData = useMemo(() => {
        return analysisData.filter(d => {
            const matchesAgent = selectedAgents.length === 0 || selectedAgents.includes('all') || selectedAgents.includes(d.agent);

            let matchesDate = true;
            if (dateRange.start || dateRange.end) {
                const itemDate = new Date(d.date).getTime();
                if (dateRange.start) {
                    const startDate = new Date(dateRange.start).getTime();
                    if (itemDate < startDate) matchesDate = false;
                }
                if (dateRange.end) {
                    // End date should include the whole day
                    const endDate = new Date(dateRange.end);
                    endDate.setHours(23, 59, 59, 999);
                    if (itemDate > endDate.getTime()) matchesDate = false;
                }
            }

            return matchesAgent && matchesDate;
        });
    }, [analysisData, selectedAgents, dateRange]);

    // Valid data for scores (exclude invalidated)
    const validData = useMemo(() => filteredData.filter(d => d.status === 'approved'), [filteredData]);


    const agentsList = useMemo(() => Array.from(new Set(analysisData.map(d => d.agent))), [analysisData]);

    // Real data calculations
    const agentStats = useMemo(() => {
        return validData.reduce((acc: any, curr) => {
            if (!acc[curr.agent]) {
                acc[curr.agent] = { name: curr.agent, totalScore: 0, count: 0, sales: 0 };
            }
            acc[curr.agent].totalScore += curr.finalScore;
            acc[curr.agent].count += 1;
            if (curr.closingAttempt) acc[curr.agent].sales += 1;
            return acc;
        }, {});
    }, [validData]);


    const realAgentData = useMemo(() => {
        return Object.values(agentStats)
            .map((agent: any) => ({
                name: agent.name,
                value: Number((agent.totalScore / agent.count).toFixed(1)),
                sales: agent.sales,
                count: agent.count
            }))
            .sort((a: any, b: any) => b.value - a.value);
    }, [agentStats]);

    const leaderboardData = useMemo(() => {
        return realAgentData.slice(0, 3).map((agent: any, idx) => ({
            ...agent,
            rank: idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'
        }));
    }, [realAgentData]);

    const totalSales = useMemo(() => validData.filter(d => d.closingAttempt).length, [validData]);


    const avgScore = useMemo(() => {
        return validData.length > 0
            ? (validData.reduce((sum: number, d: ConversationAnalysis) => sum + d.finalScore, 0) / validData.length).toFixed(1)
            : '0.0';
    }, [validData]);




    // Close dropdowns on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!(event.target as Element).closest('.filter-container')) {
                setIsAgentFilterOpen(false);
                setIsDateFilterOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const displayAgentData = leaderboardData.length > 0
        ? leaderboardData
        : (analysisData.length === 0 ? mockAgentData : []);
    const conversionChartData = realAgentData.length > 0
        ? realAgentData
        : (analysisData.length === 0 ? mockAgentData : []);

    // Build complete daily calendar for selected period (shows ALL days, not just ones with data)
    const dailyData = useMemo(() => {
        const toKey = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const counts: Record<string, number> = {};
        validData.forEach(d => {
            const k = toKey(new Date(d.date));
            counts[k] = (counts[k] || 0) + 1;
        });


        const start = dateRange.start ? new Date(dateRange.start + 'T00:00:00') : (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d; })();
        const end = dateRange.end ? new Date(dateRange.end + 'T23:59:59') : new Date();
        const days: { name: string; value: number }[] = [];
        const cursor = new Date(start);
        while (cursor <= end) {
            const key = toKey(cursor);
            days.push({ name: cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: counts[key] || 0 });
            cursor.setDate(cursor.getDate() + 1);
        }
        return days;
    }, [filteredData, dateRange]);

    // Agent volume for Pie Chart
    const agentVolumeData = useMemo(() => {
        const vol: Record<string, number> = {};
        validData.forEach(d => { vol[d.agent] = (vol[d.agent] || 0) + 1; });
        return Object.entries(vol).map(([name, value]) => ({ name, value })).sort((a: any, b: any) => b.value - a.value).slice(0, 6);
    }, [validData]);


    // Monthly evolution per agent — sorted chronologically (Jan → Dec)
    const monthlyEvolution = useMemo(() => {
        // Use sortable key: { '202601': { label: 'jan. de 26', agents: {...} } }
        const byMonth: Record<string, { label: string; agents: Record<string, { total: number; count: number }> }> = {};

        validData.forEach(d => {
            const dt = new Date(d.date);
            const sortKey = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}`; // e.g. '202601'
            const label = dt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });  // 'jan. de 26'
            if (!byMonth[sortKey]) byMonth[sortKey] = { label, agents: {} };
            if (!byMonth[sortKey].agents[d.agent]) byMonth[sortKey].agents[d.agent] = { total: 0, count: 0 };
            byMonth[sortKey].agents[d.agent].total += d.finalScore;
            byMonth[sortKey].agents[d.agent].count += 1;
        });

        const allAgents = Array.from(new Set(validData.map(d => d.agent))).slice(0, 5);


        // Sort keys chronologically (ascending) then build rows
        const data = Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, { label, agents }]) => {
                const row: any = { month: label };
                allAgents.forEach(agent => {
                    row[agent] = agents[agent] ? Number((agents[agent].total / agents[agent].count).toFixed(1)) : null;
                });
                return row;
            });

        return { data, agents: allAgents };
    }, [filteredData]);
    // Agent profiles for photo mapping in the bar chart
    const { profiles: agentProfilesList } = useAgentProfiles();

    // Derive selected period from active date filter (follows the filter, not today)
    const selectedFilterDate = dateRange.start ? new Date(dateRange.start + 'T00:00:00') : new Date();
    const selectedYear = selectedFilterDate.getFullYear();
    const selectedMonth = selectedFilterDate.getMonth() + 1; // 1-indexed
    const selectedSemester = selectedMonth <= 6 ? 1 : 2;

    const { goals: financialGoals } = useFinancialGoals(selectedYear);

    const PIE_COLORS = ['#5551FF', '#8B8BFF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA'];

    // Get all months in the selected range for average calculation
    const periodMonths = useMemo(() => {
        if (!dateRange.start || !dateRange.end) return [selectedMonth];
        const s = new Date(dateRange.start + 'T12:00:00');
        const e = new Date(dateRange.end + 'T12:00:00');
        const months = [];
        const curr = new Date(s);
        curr.setDate(1);
        while (curr <= e) {
            months.push(curr.getMonth() + 1);
            curr.setMonth(curr.getMonth() + 1);
            if (curr.getFullYear() !== selectedYear) break;
        }
        return months.length > 0 ? months : [selectedMonth];
    }, [dateRange, selectedMonth, selectedYear]);

    const activeGoals = financialGoals.filter(g => periodMonths.includes(g.month));
    const isMultiMonth = periodMonths.length > 1;

    // Financial goals — tied to the selected filter period
    const semMonths = financialGoals.filter(g => (selectedSemester === 1 ? g.month <= 6 : g.month > 6));
    const monthTarget = activeGoals.reduce((a, g) => a + g.monthly_target, 0) / (periodMonths.length || 1);
    const monthAchieved = activeGoals.reduce((a, g) => a + g.monthly_achieved, 0) / (periodMonths.length || 1);
    const semTarget = semMonths.reduce((a, g) => a + g.monthly_target, 0);
    const semAchieved = semMonths.reduce((a, g) => a + g.monthly_achieved, 0);

    const LINE_COLORS = ['#5551FF', '#00D4AA', '#FFB347', '#FF6B9D', '#A78BFA'];

    const globalRadarData = useMemo(() => {
        const radarScores = { empathy: 0, clarity: 0, depth: 0, commercial: 0, agility: 0, count: validData.length || 1 };
        validData.forEach(d => {
            radarScores.empathy += d.empathyScore;
            radarScores.clarity += d.clarityScore;
            radarScores.depth += d.depthScore;
            radarScores.commercial += d.commercialScore;
            radarScores.agility += d.agilityScore;
        });


        return [
            { subject: 'Empatia', A: Number((radarScores.empathy / radarScores.count).toFixed(1)) },
            { subject: 'Clareza', A: Number((radarScores.clarity / radarScores.count).toFixed(1)) },
            { subject: 'Profundidade', A: Number((radarScores.depth / radarScores.count).toFixed(1)) },
            { subject: 'Comercial', A: Number((radarScores.commercial / radarScores.count).toFixed(1)) },
            { subject: 'Agilidade', A: Number((radarScores.agility / radarScores.count).toFixed(1)) }
        ];
    }, [filteredData]);


    return (
        <div className={`flex min-h-screen bg-transparent ${isTvMode ? 'overflow-hidden' : ''}`}>
            {/* TV Mode Exit Button - always visible when in TV mode */}
            {isTvMode && (
                <button
                    onClick={() => setIsTvMode(false)}
                    className="fixed top-4 right-4 z-[9999] flex items-center gap-2 bg-[var(--bg-card)]/80 border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--text-main)] hover:border-primary hover:text-primary transition-all backdrop-blur-md shadow-2xl"
                >
                    <ArrowLeft size={16} /> Voltar ao Menu
                </button>
            )}
            {/* Sidebar */}
            {!isTvMode && (
                <aside className="w-[240px] flex flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border)] fixed h-screen z-50">
                    <div className="px-4 pt-6 pb-8 flex items-center">
                        <img
                            src="https://siteficv.vercel.app/images/test-logo.png"
                            alt="FICV"
                            className="h-16 w-auto object-contain"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    </div>

                    <div className="px-4 py-2 flex-1">
                        <p className="text-[10px] text-[var(--text-muted)] font-bold tracking-widest uppercase mb-4 px-2">Menu Principal</p>
                        <nav className="space-y-1">
                            <NavItem icon={LayoutDashboard} label="Visão Geral" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
                            {(profile?.role === 'admin') && <NavItem icon={Users} label="Agentes" active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />}
                            {(profile?.role === 'agent') && <NavItem icon={Award} label="Meu Desempenho" active={activeTab === 'performance'} onClick={() => setActiveTab('performance')} />}
                            {(profile?.role === 'admin') && <NavItem icon={Target} label="Metas" active={activeTab === 'goals'} onClick={() => setActiveTab('goals')} />}
                            {(profile?.role === 'admin') && <NavItem icon={FileUp} label="Uploads" active={activeTab === 'uploads'} onClick={() => setActiveTab('uploads')} />}
                            <NavItem icon={BookOpen} label="Base de Conhecimento" active={activeTab === 'knowledge'} onClick={() => setActiveTab('knowledge')} />
                            <NavItem icon={MessageSquare} label="Scripts" active={activeTab === 'scripts'} onClick={() => setActiveTab('scripts')} />
                            {(profile?.role === 'admin') && <NavItem icon={Tv} label="Dashboard Live" active={isTvMode} onClick={() => setIsTvMode(!isTvMode)} />}
                        </nav>

                        {profile?.role === 'admin' && (
                            <>
                                <p className="text-[10px] text-[var(--text-muted)] font-bold tracking-widest uppercase mt-8 mb-4 px-2">Gestão</p>
                                <nav className="space-y-1">
                                    <NavItem icon={Users} label="Usuários" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
                                    <NavItem icon={Settings} label="Configurações" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
                                    <NavItem icon={History} label="Relatórios (Admin)" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
                                </nav>
                            </>
                        )}
                    </div>

                    <div className="p-4 border-t border-[var(--border)]">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-2 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary text-xs">
                                    {profile?.full_name?.charAt(0) || 'U'}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="text-[11px] font-bold truncate text-[var(--text-main)]">{profile?.full_name || 'Usuário'}</p>
                                    <p className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-wide">{profile?.role || 'Agente'}</p>
                                </div>
                                <button onClick={handleLogout} className="text-[var(--text-muted)] hover:text-primary transition-all">
                                    <LogOut size={16} />
                                </button>
                            </div>

                            <button
                                onClick={() => setIsDarkMode(!isDarkMode)}
                                className="sidebar-item group w-full flex items-center justify-center gap-2 border border-dashed border-[var(--border)] py-2 rounded-xl transition-all hover:bg-primary/5 active:scale-95"
                            >
                                {isDarkMode ? (
                                    <>
                                        <Sun size={14} className="text-amber-400 group-hover:scale-110 transition-transform" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">Modo Claro</span>
                                    </>
                                ) : (
                                    <>
                                        <Moon size={14} className="text-primary group-hover:scale-110 transition-transform" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">Modo Escuro</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </aside>
            )
            }

            {/* Main Content */}
            <main className={`flex-1 min-h-screen bg-[var(--bg-main)] p-8 transition-all overflow-x-hidden ${isTvMode ? 'ml-0' : 'ml-[240px]'}`}>
                {(activeTab === 'dashboard' || activeTab === 'agents' || activeTab === 'history') && (
                    <header className="flex justify-between items-start mb-10 relative">
                        <div>
                            <div className="flex items-center gap-2 text-primary mb-2">
                                <TrendingUp size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Dashboard em tempo real</span>
                            </div>
                            <h2 className="text-3xl font-bold tracking-tight mb-2 text-[var(--text-main)]">Visão Geral</h2>
                            <p className="text-[var(--text-muted)] text-sm">Acompanhe a performance completa da conta com insights gerados.</p>
                        </div>

                        {!isTvMode && (
                            <div className="flex gap-3 items-center mt-2 filter-container relative">
                                {/* Agent Multiselect */}
                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsAgentFilterOpen(!isAgentFilterOpen);
                                            setIsDateFilterOpen(false);
                                        }}
                                        className="btn-pill flex items-center gap-2"
                                    >
                                        <Filter size={14} className="text-primary" />
                                        <span className="text-xs">
                                            {selectedAgents.length === 0 || selectedAgents.includes('all') ? 'Todos Agentes' : `${selectedAgents.length} selecionados`}
                                        </span>
                                    </button>

                                    {isAgentFilterOpen && (
                                        <div className="absolute top-full mt-2 left-0 w-48 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl z-[100] p-2 animate-fade-in">
                                            <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                <label className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group">
                                                    <input
                                                        type="checkbox"
                                                        className="w-4 h-4 rounded border-[var(--border)] accent-primary cursor-pointer"
                                                        checked={selectedAgents.length === 0 || selectedAgents.includes('all')}
                                                        onChange={() => setSelectedAgents([])}
                                                    />
                                                    <span className="text-xs group-hover:text-primary transition-colors text-[var(--text-main)]">Todos os Agentes</span>
                                                </label>
                                                <div className="h-px bg-[var(--border)] my-1" />
                                                {agentsList.map(agent => (
                                                    <label key={agent} className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group">
                                                        <input
                                                            type="checkbox"
                                                            className="w-4 h-4 rounded border-[var(--border)] accent-primary cursor-pointer"
                                                            checked={selectedAgents.includes(agent)}
                                                            onChange={() => {
                                                                const newAgents = selectedAgents.includes(agent)
                                                                    ? selectedAgents.filter(a => a !== agent)
                                                                    : [...selectedAgents.filter(a => a !== 'all'), agent];
                                                                setSelectedAgents(newAgents);
                                                            }}
                                                        />
                                                        <span className="text-xs group-hover:text-primary transition-colors text-[var(--text-main)]">{agent}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Date Presets Dropdown */}
                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsDateFilterOpen(!isDateFilterOpen);
                                            setIsAgentFilterOpen(false);
                                        }}
                                        className="btn-pill flex items-center gap-2"
                                    >
                                        <Calendar size={14} className="text-primary" />
                                        <span className="text-xs">
                                            {(() => {
                                                if (!dateRange.start) return 'Período';
                                                const s = new Date(dateRange.start + 'T00:00:00');
                                                const e = dateRange.end ? new Date(dateRange.end + 'T00:00:00') : null;
                                                if (e) {
                                                    const lastOfMonth = new Date(s.getFullYear(), s.getMonth() + 1, 0);
                                                    if (s.getDate() === 1 && e.getDate() === lastOfMonth.getDate() && e.getMonth() === s.getMonth()) {
                                                        return s.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '');
                                                    }
                                                }
                                                return `Desde ${s.toLocaleDateString('pt-BR')}`;
                                            })()}
                                        </span>
                                    </button>

                                    {isDateFilterOpen && (
                                        <div className="absolute top-full mt-2 right-0 w-72 bg-[#0D1117] border border-[#30363D] rounded-xl shadow-2xl z-[100] overflow-hidden animate-fade-in">
                                            {/* Quick presets */}
                                            <div className="p-2 border-b border-[#30363D] grid grid-cols-3 gap-1">
                                                {['today', 'week', 'month', 'semester', 'year'].map(p => (
                                                    <button
                                                        key={p}
                                                        onClick={() => { setDatePreset(p); setIsDateFilterOpen(false); }}
                                                        className="p-2 text-[10px] font-bold uppercase tracking-wider text-[#8B949E] hover:text-white hover:bg-white/5 rounded-lg transition-all text-center"
                                                    >
                                                        {p === 'today' ? 'Hoje' : p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : p === 'semester' ? 'Semestre' : 'Ano'}
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => { setDateRange({ start: '', end: '' }); setIsDateFilterOpen(false); }}
                                                    className="p-2 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-400/10 rounded-lg transition-all text-center"
                                                >
                                                    Limpar
                                                </button>
                                            </div>

                                            {/* Month shortcuts */}
                                            {(() => {
                                                const now = new Date();
                                                const curYear = now.getFullYear();
                                                const curMonth = now.getMonth(); // 0-indexed
                                                const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                                                const activeMonthStart = dateRange.start ? dateRange.start : '';

                                                return (
                                                    <>
                                                        <div className="px-3 pt-3 pb-1">
                                                            <p className="text-[9px] font-bold text-[#8B949E] uppercase tracking-widest">{curYear}</p>
                                                        </div>
                                                        <div className="px-2 pb-2 grid grid-cols-6 gap-1">
                                                            {monthNames.map((name, i) => {
                                                                const firstDay = `${curYear}-${String(i + 1).padStart(2, '0')}-01`;
                                                                const lastDayDate = new Date(curYear, i + 1, 0);
                                                                const lastDay = `${curYear}-${String(i + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
                                                                const isActive = activeMonthStart === firstDay;
                                                                const isCurrent = i === curMonth;
                                                                const isFuture = i > curMonth;

                                                                return (
                                                                    <button
                                                                        key={i}
                                                                        disabled={isFuture}
                                                                        onClick={() => {
                                                                            setDateRange({ start: firstDay, end: lastDay });
                                                                            setIsDateFilterOpen(false);
                                                                        }}
                                                                        className={`py-1.5 text-[10px] font-bold rounded-lg transition-all text-center
                                                                        ${isActive ? 'bg-primary text-white shadow-lg shadow-primary/30' :
                                                                                isCurrent ? 'border border-primary/40 text-primary hover:bg-primary/10' :
                                                                                    isFuture ? 'text-[#30363D] cursor-not-allowed' :
                                                                                        'text-[#8B949E] hover:text-white hover:bg-white/5'}`}
                                                                    >
                                                                        {name}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>

                                                        {/* Previous year shortcut */}
                                                        <div className="px-3 pt-1 pb-1 border-t border-[var(--border)]/50">
                                                            <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{curYear - 1}</p>
                                                        </div>
                                                        <div className="px-2 pb-3 grid grid-cols-6 gap-1">
                                                            {monthNames.map((name, i) => {
                                                                const prevYear = curYear - 1;
                                                                const firstDay = `${prevYear}-${String(i + 1).padStart(2, '0')}-01`;
                                                                const lastDayDate = new Date(prevYear, i + 1, 0);
                                                                const lastDay = `${prevYear}-${String(i + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
                                                                const isActive = activeMonthStart === firstDay;
                                                                return (
                                                                    <button
                                                                        key={i}
                                                                        onClick={() => {
                                                                            setDateRange({ start: firstDay, end: lastDay });
                                                                            setIsDateFilterOpen(false);
                                                                        }}
                                                                        className={`py-1.5 text-[10px] font-bold rounded-lg transition-all text-center
                                                                        ${isActive ? 'bg-primary text-white shadow-lg shadow-primary/30' :
                                                                                'text-[#8B949E] hover:text-white hover:bg-white/5'}`}
                                                                    >
                                                                        {name}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </>
                                                );
                                            })()}

                                            {/* Manual date range */}
                                            <div className="p-3 border-t border-[#30363D] space-y-2">
                                                <p className="text-[9px] font-bold text-[#8B949E] uppercase tracking-widest">Personalizado</p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] text-[var(--text-muted)] pl-1">Início</span>
                                                        <input
                                                            type="date"
                                                            className={`bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg p-1.5 text-xs focus:outline-none focus:border-primary text-[var(--text-main)] ${isDarkMode ? '[color-scheme:dark]' : '[color-scheme:light]'}`}
                                                            value={dateRange.start}
                                                            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] text-[var(--text-muted)] pl-1">Fim</span>
                                                        <input
                                                            type="date"
                                                            className={`bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg p-1.5 text-xs focus:outline-none focus:border-primary text-[var(--text-main)] ${isDarkMode ? '[color-scheme:dark]' : '[color-scheme:light]'}`}
                                                            value={dateRange.end}
                                                            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                            </div>
                        )}
                    </header>
                )}

                {/* Dashboard View */}
                {activeTab === 'dashboard' && (
                    <div className="space-y-8 animate-fade-in">
                        {/* Stat cards (3) + 2 compact Goal Gauges */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 items-stretch">
                            <StatCard icon={MessageSquare} title="Total Atendimentos" value={filteredData.length > 0 ? filteredData.length.toLocaleString() : "0"} subtext="Baseado em dados reais" />
                            <StatCard icon={Award} title="Score Qualidade" value={avgScore} subtext="Média dos protoc." />
                            <StatCard icon={Target} title="Média de Conversão" value={filteredData.length > 0 ? `${((totalSales / filteredData.length) * 100).toFixed(1)}%` : "0%"} subtext="Objetivo: 15%" />

                            {/* 2 compact gauges */}
                            <div className="glass-card p-4 flex flex-col items-center justify-center">
                                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">{isMultiMonth ? 'Média Mensal' : 'Meta Mensal'}</p>
                                <ArcGauge
                                    percent={monthTarget > 0 ? (monthAchieved / monthTarget) * 100 : 0}
                                    label={monthTarget > 0 ? `${isMultiMonth ? 'Média' : 'Meta'}: ${monthTarget.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}` : 'Sem meta definida'}
                                    achieved={monthAchieved}
                                    target={monthTarget}
                                    color="#5551FF"
                                    size={130}
                                />
                            </div>
                            <div className="glass-card p-4 flex flex-col items-center justify-center">
                                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">Meta Semestral</p>
                                <ArcGauge
                                    percent={semTarget > 0 ? (semAchieved / semTarget) * 100 : 0}
                                    label={semTarget > 0 ? `Meta: ${semTarget.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}` : 'Sem meta definida'}
                                    achieved={semAchieved}
                                    target={semTarget}
                                    color="#00D4AA"
                                    size={130}
                                />
                            </div>
                        </div>

                        {/* Row 2: Performance do Período + Radar */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="glass-card p-8 flex flex-col">
                                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-6">Performance do Período</h3>
                                <div className="flex-1 min-h-[380px] relative">
                                    {/* Custom bar chart with agent photos */}
                                    {(() => {
                                        const chartData = conversionChartData.slice(0, 10);
                                        const agentPhotoMap: Record<string, string | null | undefined> = {};
                                        agentProfilesList.forEach((p: any) => { agentPhotoMap[p.name] = p.photo_url; });
                                        const maxVal = Math.max(...chartData.map((d: any) => d.value), 10);
                                        const TARGET = 8;
                                        const COLORS = LINE_COLORS;

                                        return (
                                            <div className="h-full flex flex-col">
                                                <div className="flex-1 flex items-end gap-2 px-2 pb-8 relative">
                                                    {/* Target line */}
                                                    <div
                                                        className="absolute left-2 right-2 border-t-2 border-dashed border-white/20"
                                                        style={{ bottom: `${32 + (TARGET / maxVal) * (100 - 8)}%` }}
                                                    >
                                                        <span className="absolute right-0 -top-5 text-[9px] font-bold text-white/40 uppercase tracking-widest">Meta {TARGET}</span>
                                                    </div>

                                                    {chartData.map((d: any, i: number) => {
                                                        const heightPct = Math.max(4, (d.value / maxVal) * 82);
                                                        const color = COLORS[i % COLORS.length];
                                                        const onTarget = d.value >= TARGET;
                                                        const shortName = d.name?.split(' ')[0] ?? '';
                                                        return (
                                                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                                {/* Photo above bar */}
                                                                <AgentAvatar
                                                                    name={d.name}
                                                                    photoUrl={agentPhotoMap[d.name]}
                                                                    size={32}
                                                                    className={`ring-2 ${onTarget ? 'ring-[#00D4AA]' : 'ring-[#FFB347]'}`}
                                                                />
                                                                {/* Bar */}
                                                                <div
                                                                    className="w-full rounded-t-lg relative flex items-center justify-center transition-all duration-700"
                                                                    style={{
                                                                        height: `${heightPct}%`,
                                                                        background: onTarget
                                                                            ? `linear-gradient(to top, ${color}99, ${color})`
                                                                            : `linear-gradient(to top, ${color}66, ${color}99)`,
                                                                        minHeight: 32
                                                                    }}
                                                                >
                                                                    <span className="text-[var(--text-main)] font-black text-xs drop-shadow">{d.value.toFixed(1)}</span>
                                                                </div>
                                                                {/* Name */}
                                                                <span className="text-[9px] text-[var(--text-muted)] truncate w-full text-center">{shortName}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="glass-card p-6 flex flex-col">
                                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Performance Qualitativa Geral</h3>
                                <div className="h-[440px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart data={globalRadarData} outerRadius="88%" cx="50%" cy="50%">
                                            <PolarGrid stroke="var(--border)" strokeOpacity={0.6} />
                                            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }} />
                                            <PolarRadiusAxis domain={[0, 10]} axisLine={false} tick={false} />
                                            <Radar name="Score Médio" dataKey="A" stroke="#5551FF" fill="#5551FF" fillOpacity={0.3} strokeWidth={2.5} />
                                            <Tooltip
                                                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px' }}
                                                itemStyle={{ color: 'var(--text-main)' }}
                                                labelStyle={{ color: 'var(--text-main)', fontWeight: 'bold' }}
                                                formatter={(v: any) => [v, 'Score']}
                                            />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Row 3: Daily Volume + Evolução Mensal (trocado) */}
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                            <div className="lg:col-span-3 glass-card p-8">
                                <h3 className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-6">Tendência de Volume Diário</h3>
                                <div className="h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={dailyData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                            <XAxis
                                                dataKey="name"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#8B949E', fontSize: 9 }}
                                                interval={dailyData.length > 60 ? Math.floor(dailyData.length / 20) : dailyData.length > 30 ? 1 : 0}
                                            />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8B949E', fontSize: 10 }} />
                                            <Tooltip contentStyle={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: '12px' }} />
                                            <Line type="monotone" dataKey="value" stroke="#5551FF" strokeWidth={2} dot={dailyData.length < 40} activeDot={{ r: 5 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                            {/* Evolução Mensal agora em Row 3 */}
                            <div className="lg:col-span-2 glass-card p-8">
                                <h3 className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-4">Evolução Mensal por Agente</h3>
                                <div className="h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={monthlyEvolution.data}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#8B949E', fontSize: 10 }} />
                                            <YAxis domain={[0, 10]} axisLine={false} tickLine={false} tick={{ fill: '#8B949E', fontSize: 10 }} />
                                            <Tooltip contentStyle={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: '12px' }} />
                                            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
                                            {monthlyEvolution.agents.map((agent, i) => (
                                                <Line key={agent} type="monotone" dataKey={agent} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Row 5: Pie Chart + Recent Analysis */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1 glass-card p-8">
                                <h3 className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-6">Distribuição por Agente</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={agentVolumeData}
                                                dataKey="value"
                                                nameKey="name"
                                                cx="50%"
                                                cy="50%"
                                                innerRadius="50%"
                                                outerRadius="75%"
                                                paddingAngle={3}
                                                label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                                                labelLine={false}
                                            >
                                                {agentVolumeData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: '12px' }}
                                                itemStyle={{ color: '#fff' }}
                                                labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                                                formatter={(v: any) => [`${v} atend.`, '']}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="lg:col-span-2 glass-card p-8">
                                <div className="flex justify-between items-center mb-8">
                                    <h3 className="text-xs font-bold text-[#8B949E] uppercase tracking-widest">Últimas Análises Detalhadas</h3>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setActiveTab('history')}
                                            className="text-[10px] font-bold text-primary hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1"
                                        >
                                            Ver Tudo <ChevronRight size={12} />
                                        </button>
                                        <div className="pill-indicator">
                                            <span>{filteredData.length} registros</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-3 overflow-y-auto max-h-[350px] pr-2 custom-scrollbar">
                                    {filteredData.length > 0 ? filteredData.slice(0, 15).map((item, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => {
                                                const liveItem = analysisData.find(d => d.protocol === item.protocol);
                                                setSelectedAnalysis(liveItem || item);
                                            }}
                                            className="w-full flex justify-between items-center p-4 bg-[#161B22]/40 rounded-xl border border-[#30363D] hover:border-primary/50 hover:bg-[#161B22]/60 transition-all group"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-all">
                                                    <MessageSquare size={16} className="text-primary" />
                                                </div>
                                                <div className="text-left">
                                                    <p className="font-bold text-sm text-white group-hover:text-primary transition-colors">{item.contact}</p>
                                                    <p className="text-[10px] text-[#8B949E] font-medium">{item.agent} • {new Date(item.date).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className={`text-sm font-black ${item.status === 'invalidated' ? 'text-[#30363D] line-through' : item.finalScore > 7 ? 'text-success-text' : 'text-warning'}`}>
                                                    {item.status === 'invalidated' ? '---' : item.finalScore}
                                                </span>
                                                <p className="text-[9px] text-[#8B949E] uppercase font-bold tracking-widest">Score IA</p>
                                            </div>

                                        </button>
                                    )) : (
                                        <div className="text-center py-10">
                                            <p className="text-[#8B949E] text-xs">Nenhum dado processado por enquanto.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* Agent Admin View (Admin) */}
                {activeTab === 'agents' && profile?.role === 'admin' && (
                    <div className="animate-fade-in">
                        <AgentAdmin isAdmin={profile?.role === 'admin'} analysisData={filteredData} />
                    </div>
                )}

                {/* Agent Performance View (Agent) */}
                {activeTab === 'performance' && profile?.role === 'agent' && (
                    <div className="animate-fade-in max-w-6xl mx-auto py-6">
                        <AgentProfile name={profile.full_name} data={analysisData} />
                    </div>
                )}

                {/* Goals/Metas Tab */}
                {activeTab === 'goals' && (
                    <div className="animate-fade-in">
                        <GoalsPage isAdmin={profile?.role === 'admin'} />
                    </div>
                )}

                {/* Uploads Tab */}
                {activeTab === 'uploads' && (
                    <div className="space-y-8 animate-fade-in max-w-5xl mx-auto py-10">
                        <div className="text-center mb-10">
                            <h2 className="text-3xl font-black text-white tracking-tighter mb-2">Sincronização de Dados</h2>
                            <p className="text-[#8B949E] text-sm">Gerencie seus arquivos CSV do Widechat e acompanhe o histórico de importações.</p>
                        </div>

                        {/* Reprocess button — moved from header */}
                        {profile?.role === 'admin' && (
                            <div className="glass-card p-6 flex items-center justify-between">
                                <div>
                                    <p className="font-bold text-white text-sm">Reprocessar Scores com IA</p>
                                    <p className="text-[#8B949E] text-xs mt-1">Recalcula todas as análises com os critérios mais recentes.</p>
                                </div>
                                <button
                                    onClick={async () => {
                                        setIsRefreshing(true);
                                        setRefreshProgress({ current: 0, total: 0 });
                                        await recalculateAllScores(async (curr, tot) => {
                                            setRefreshProgress({ current: curr, total: tot });
                                            if (curr % 20 === 0 || curr === tot) await fetchData();
                                        });
                                        await fetchData();
                                        setIsRefreshing(false);
                                        setRefreshProgress({ current: 0, total: 0 });
                                        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                                    }}
                                    disabled={isRefreshing}
                                    className="btn-primary flex items-center gap-2 flex-shrink-0"
                                >
                                    {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                                    {isRefreshing ? `Reprocessando (${refreshProgress.current}/${refreshProgress.total})...` : 'Atualizar Tudo'}
                                </button>
                            </div>
                        )}

                        <div className="glass-card p-10">
                            <CSVUploader
                                onDataLoaded={(data) => {
                                    setAnalysisData(data);
                                    fetchUploadLogs();
                                    setActiveTab('dashboard'); // Redirect to dash after upload
                                }}
                                uploaderId={profile?.id}
                            />
                        </div>

                        {profile?.role === 'admin' && (
                            <div className="glass-card p-8">
                                <div className="flex items-center gap-3 mb-10">
                                    <div className="p-2 bg-primary/10 rounded-lg">
                                        <History size={20} className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white tracking-tight">Histórico de Importações</h3>
                                        <p className="text-[10px] text-[#8B949E] uppercase tracking-widest font-bold">Registro de envios por administrador</p>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="text-[#8B949E] border-b border-[#30363D]">
                                                <th className="pb-6 font-bold uppercase text-[10px] tracking-widest px-4">Arquivo</th>
                                                <th className="pb-6 font-bold uppercase text-[10px] tracking-widest px-4">Responsável</th>
                                                <th className="pb-6 font-bold uppercase text-[10px] tracking-widest px-4 text-center">Volume</th>
                                                <th className="pb-6 font-bold uppercase text-[10px] tracking-widest px-4 text-center">Sincronizado em</th>
                                                <th className="pb-6 font-bold uppercase text-[10px] tracking-widest px-4 text-right">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#30363D]">
                                            {uploadLogs.length > 0 ? uploadLogs.map((log, i) => (
                                                <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                                    <td className="py-6 px-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded bg-[#161B22] border border-[#30363D] flex items-center justify-center text-[#8B949E] group-hover:text-primary transition-colors">
                                                                <FileText size={14} />
                                                            </div>
                                                            <span className="font-bold text-xs text-[#C9D1D9] group-hover:text-white transition-colors">{log.filename}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-6 px-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-primary/20 text-[9px] font-bold flex items-center justify-center text-primary uppercase border border-primary/20">
                                                                {log.profiles?.full_name?.charAt(0)}
                                                            </div>
                                                            <span className="text-xs text-[#8B949E] font-medium">{log.profiles?.full_name || 'Desconhecido'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-6 px-4 text-center text-xs text-[#8B949E] font-mono">{log.record_count} registros</td>
                                                    <td className="py-6 px-4 text-center text-xs text-[#8B949E] font-mono whitespace-nowrap">
                                                        {new Date(log.created_at).toLocaleString('pt-BR')}
                                                    </td>
                                                    <td className="py-6 px-4 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    setActiveTab('uploads');
                                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                                }}
                                                                className="p-2 rounded-lg bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-primary hover:border-primary/50 transition-all"
                                                                title="Atualizar arquivo"
                                                            >
                                                                <RefreshCcw size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteLog(log.id)}
                                                                className="p-2 rounded-lg bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-danger hover:border-danger/50 transition-all"
                                                                title="Apagar importação"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={4} className="py-20 text-center">
                                                        <div className="flex flex-col items-center gap-4 opacity-30">
                                                            <History size={48} />
                                                            <p className="text-xs font-bold uppercase tracking-widest">Nenhum histórico encontrado</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {/* Knowledge Base View */}
                {activeTab === 'knowledge' && (
                    <div className="animate-fade-in">
                        <KnowledgeBase profile={profile} />
                    </div>
                )}

                {/* Scripts Tab */}
                {activeTab === 'scripts' && (
                    <div className="animate-fade-in">
                        <Scripts isAdmin={profile?.role === 'admin'} />
                    </div>
                )}

                {/* History/Reports View */}
                {activeTab === 'history' && (
                    <div className="animate-fade-in">
                        <HistoryLog
                            data={analysisData}
                            onSelect={(analysis) => setSelectedAnalysis(analysis)}
                            onRefresh={fetchData}
                        />
                    </div>
                )}

                {/* User management tab */}
                {activeTab === 'users' && profile?.role === 'admin' && (
                    <div className="animate-fade-in">
                        <UserManagement />
                    </div>
                )}

                {/* Placeholder for other views */}

            </main>
            {
                selectedAnalysis && (
                    <AnalysisDetail
                        analysis={analysisData.find(d => d.protocol === selectedAnalysis.protocol) || selectedAnalysis}
                        onClose={() => setSelectedAnalysis(null)}
                        onNext={handleNext}
                        onPrevious={handlePrevious}
                        onStatusUpdate={updateAnalysisStatus}
                        onScoreUpdate={updateAnalysisScores}
                        hasNext={filteredData.findIndex(d => d.protocol === selectedAnalysis.protocol) < filteredData.length - 1}
                        hasPrevious={filteredData.findIndex(d => d.protocol === selectedAnalysis.protocol) > 0}
                    />

                )

            }
        </div >
    );
}

const FullApp = () => {
    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const saved = localStorage.getItem('theme');
        return saved ? saved === 'dark' : true;
    });

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [isDarkMode]);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-main)] flex flex-col items-center justify-center gap-8">
            <div className="relative">
                <div className="w-20 h-20 border-2 border-primary/20 rounded-full animate-ping absolute inset-0" />
                <div className="w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-[0_0_30px_rgba(85,81,255,0.2)]" />
            </div>
            <div className="text-center group">
                <h2 className="text-[var(--text-main)] text-xl font-bold tracking-[0.2em] mb-3 group-hover:scale-105 transition-transform">SALESPULSE</h2>
                <div className="flex items-center gap-2 justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
                </div>
                <p className="text-[var(--text-muted)] text-[10px] font-bold tracking-[0.4em] mt-4 uppercase">Initializing AI Engine</p>
            </div>
        </div>
    );

    if (!session) return <Login />;

    return <App session={session} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />;
};

export default FullApp;
