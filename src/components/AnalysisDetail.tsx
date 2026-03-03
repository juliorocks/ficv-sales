import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    User,
    Calendar,
    Hash,
    MessageSquare,
    Target,
    Zap,
    Heart,
    Eye,
    Star,
    Award,
    AlertCircle
} from 'lucide-react';
import { ConversationAnalysis } from '../utils/csvProcessor';
import { supabase } from '../lib/supabase';

import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer
} from 'recharts';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Loader2 } from 'lucide-react';



interface AnalysisDetailProps {
    analysis: ConversationAnalysis | null;
    onClose: () => void;
    onNext?: () => void;
    onPrevious?: () => void;
    onStatusUpdate?: (protocol: string, status: 'approved' | 'invalidated') => Promise<void>;
    onScoreUpdate?: (protocol: string, scores: any) => Promise<void>;
    hasNext?: boolean;
    hasPrevious?: boolean;
}



export const AnalysisDetail: React.FC<AnalysisDetailProps> = ({
    analysis: initialAnalysis,
    onClose,
    onNext,
    onPrevious,
    onStatusUpdate,
    onScoreUpdate,
    hasNext,
    hasPrevious
}) => {
    const [scores, setScores] = React.useState({
        empathy: initialAnalysis?.empathyScore || 0,
        clarity: initialAnalysis?.clarityScore || 0,
        depth: initialAnalysis?.depthScore || 0,
        commercial: initialAnalysis?.commercialScore || 0,
        agility: initialAnalysis?.agilityScore || 0,
        isCommercial: initialAnalysis?.isCommercial || false
    });

    const [isSaving, setIsSaving] = React.useState(false);

    React.useEffect(() => {
        if (initialAnalysis) {
            setScores({
                empathy: initialAnalysis.empathyScore,
                clarity: initialAnalysis.clarityScore,
                depth: initialAnalysis.depthScore,
                commercial: initialAnalysis.commercialScore,
                agility: initialAnalysis.agilityScore,
                isCommercial: initialAnalysis.isCommercial
            });
        }
    }, [initialAnalysis]);

    const finalScore = React.useMemo(() => {
        const values = [scores.empathy, scores.clarity, scores.depth, scores.agility];
        if (scores.isCommercial) values.push(scores.commercial);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return Number(avg.toFixed(1));
    }, [scores]);

    const hasChanges = React.useMemo(() => {
        if (!initialAnalysis) return false;
        return scores.empathy !== initialAnalysis.empathyScore ||
            scores.clarity !== initialAnalysis.clarityScore ||
            scores.depth !== initialAnalysis.depthScore ||
            scores.commercial !== initialAnalysis.commercialScore ||
            scores.agility !== initialAnalysis.agilityScore ||
            scores.isCommercial !== initialAnalysis.isCommercial;
    }, [scores, initialAnalysis]);


    const handleScoreChange = (key: string, value: string) => {
        const numValue = Math.min(10, Math.max(0, parseFloat(value) || 0));
        setScores(prev => ({ ...prev, [key]: numValue }));
    };

    const handleSave = async () => {
        if (!initialAnalysis || !onScoreUpdate) return;
        setIsSaving(true);
        try {
            await onScoreUpdate(initialAnalysis.protocol, { ...scores, finalScore });
        } finally {
            setIsSaving(false);
        }
    };


    const [transcript, setTranscript] = React.useState<any[]>(initialAnalysis?.transcript || []);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        if (initialAnalysis && (!initialAnalysis.transcript || initialAnalysis.transcript.length === 0)) {
            const fetchTranscript = async () => {
                setLoading(true);
                try {
                    const { data, error } = await supabase
                        .from('messages_logs')
                        .select('message_content')
                        .eq('protocol', initialAnalysis.protocol)
                        .single();

                    if (!error && data?.message_content) {
                        const parsed = JSON.parse(data.message_content);
                        setTranscript(parsed || []);
                    }
                } catch (e) {
                    console.error('Error fetching transcript:', e);
                } finally {
                    setLoading(false);
                }
            };
            fetchTranscript();
        } else if (initialAnalysis) {
            setTranscript(initialAnalysis.transcript);
        }
    }, [initialAnalysis]);

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' && hasNext && onNext) onNext();
            if (e.key === 'ArrowLeft' && hasPrevious && onPrevious) onPrevious();
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasNext, hasPrevious, onNext, onPrevious, onClose]);

    if (!initialAnalysis) return null;


    const radarData = [
        { subject: 'Empatia', A: scores.empathy, fullMark: 10 },
        { subject: 'Clareza', A: scores.clarity, fullMark: 10 },
        { subject: 'Profundidade', A: scores.depth, fullMark: 10 },
        { subject: 'Comercial', A: initialAnalysis.isCommercial ? scores.commercial : 0, fullMark: 10 },
        { subject: 'Agilidade', A: scores.agility, fullMark: 10 },
    ];


    const StatItem = ({ icon: Icon, label, value, color, onChange, field }: { icon: any, label: string, value: number, color: string, onChange?: (val: string) => void, field: string }) => (
        <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl border border-white/5 group hover:border-primary/30 transition-all">
            <div className={`p-2 rounded-lg bg-${color}/10 text-${color}`}>
                <Icon size={18} />
            </div>
            <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                    <p className="text-[9px] text-[#8B949E] font-bold uppercase tracking-widest">{label}</p>
                    {field === 'commercial' && (
                        <label className="flex items-center gap-1 cursor-pointer">
                            <span className="text-[8px] text-[#8B949E] uppercase font-bold">Venda?</span>
                            <input
                                type="checkbox"
                                checked={scores.isCommercial}
                                onChange={(e) => setScores(prev => ({ ...prev, isCommercial: e.target.checked }))}
                                className="w-3 h-3 rounded border-[#30363D] accent-primary"
                            />
                        </label>
                    )}
                </div>
                <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    disabled={field === 'commercial' && !scores.isCommercial}
                    value={value}
                    onChange={(e) => onChange?.(e.target.value)}
                    className={`w-full bg-transparent text-sm font-bold text-[var(--text-main)] focus:outline-none border-b border-transparent focus:border-primary/50 ${field === 'commercial' && !scores.isCommercial ? 'opacity-30 cursor-not-allowed' : ''}`}
                />
            </div>

        </div>
    );


    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/80 backdrop-blur-md"
                />

                {/* Modal */}
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="relative w-full max-w-5xl bg-[var(--bg-card)] border border-[var(--border)] rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                >
                    {/* Header */}
                    <div className="p-8 border-b border-[var(--border)] flex justify-between items-start bg-gradient-to-r from-primary/5 to-transparent">
                        <div className="flex gap-6 items-center">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-[#5551FFaa] flex items-center justify-center text-2xl font-bold shadow-lg shadow-primary/20 text-white">
                                {initialAnalysis.agent.charAt(0)}
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] bg-primary/20 text-primary font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter shadow-sm border border-primary/10">
                                        Análise Detalhada
                                    </span>
                                    <span className="text-[10px] bg-[var(--bg-card)] text-[var(--text-muted)] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter border border-[var(--border)]">
                                        Protocolo: {initialAnalysis.protocol}
                                    </span>
                                    {initialAnalysis.status === 'invalidated' && (
                                        <span className="text-[10px] bg-danger/20 text-danger font-black px-2 py-0.5 rounded-full uppercase tracking-tighter border border-danger/10">
                                            Invalidado
                                        </span>
                                    )}
                                </div>
                                <h2 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">{initialAnalysis.agent}</h2>
                                <p className="text-[#8B949E] text-xs flex items-center gap-4 mt-1">
                                    <span className="flex items-center gap-1.5"><User size={12} className="text-primary" /> {initialAnalysis.contact}</span>
                                    <span className="flex items-center gap-1.5"><Calendar size={12} /> {new Date(initialAnalysis.date).toLocaleString('pt-BR')}</span>
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {initialAnalysis.status === 'approved' ? (
                                <button
                                    onClick={() => onStatusUpdate?.(initialAnalysis.protocol, 'invalidated')}
                                    className="px-4 py-2 rounded-xl bg-danger/10 border border-danger/20 text-danger text-[10px] font-bold uppercase tracking-widest hover:bg-danger/20 transition-all flex items-center gap-2"
                                >
                                    <XCircle size={14} /> Invalidar
                                </button>
                            ) : (
                                <button
                                    onClick={() => onStatusUpdate?.(initialAnalysis.protocol, 'approved')}
                                    className="px-4 py-2 rounded-xl bg-success/10 border border-success/20 text-success-text text-[10px] font-bold uppercase tracking-widest hover:bg-success/20 transition-all flex items-center gap-2"
                                >
                                    <CheckCircle size={14} /> Aprovar
                                </button>
                            )}

                            <div className="w-px h-8 bg-[var(--border)] mx-2" />

                            <button
                                onClick={onClose}
                                className="p-2.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-primary/50 transition-all shadow-xl"
                            >
                                <X size={20} />
                            </button>
                        </div>


                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                            {/* Left Column: Vision & Stats */}
                            <div className="space-y-8">
                                <div className="glass-card bg-[var(--bg-card-hover)]/30 p-8 flex flex-col items-center">
                                    <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-[0.2em] mb-8 w-full text-center">Score de Performance</h3>
                                    <div className="w-full h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                                                <PolarGrid stroke="var(--border)" />
                                                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold' }} />
                                                <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                                                <Radar
                                                    name="Pontuação"
                                                    dataKey="A"
                                                    stroke="var(--primary)"
                                                    fill="var(--primary)"
                                                    fillOpacity={0.4}
                                                />
                                            </RadarChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="mt-4 flex flex-col items-center">
                                        <div className="text-6xl font-black text-primary drop-shadow-[0_0_20px_rgba(85,81,255,0.4)]">{finalScore}</div>
                                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.3em] mt-2">Média Geral</span>
                                    </div>
                                    {hasChanges && (
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving}
                                            className="mt-6 btn-primary w-full py-3 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 animate-bounce-subtle"
                                        >
                                            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                            {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <StatItem icon={Heart} label="Empatia" value={scores.empathy} color="primary" field="empathy" onChange={(v) => handleScoreChange('empathy', v)} />
                                    <StatItem icon={Eye} label="Clareza" value={scores.clarity} color="primary" field="clarity" onChange={(v) => handleScoreChange('clarity', v)} />
                                    <StatItem icon={Star} label="Profundidade" value={scores.depth} color="primary" field="depth" onChange={(v) => handleScoreChange('depth', v)} />
                                    <StatItem icon={Target} label="Venda" value={scores.commercial} color="primary" field="commercial" onChange={(v) => handleScoreChange('commercial', v)} />
                                    <StatItem icon={Zap} label="Agilidade" value={scores.agility} color="primary" field="agility" onChange={(v) => handleScoreChange('agility', v)} />
                                </div>



                                <div className="p-6 bg-[var(--bg-card-hover)]/30 rounded-2xl border border-[var(--border)]">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Star size={16} className="text-primary" />
                                        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Considerações Finais</h4>
                                    </div>
                                    <p className="text-sm text-[var(--text-main)] leading-relaxed">
                                        "{initialAnalysis.overallConclusion}"
                                    </p>
                                </div>

                            </div>

                            {/* Right Column: Transcript Review */}
                            <div className="flex flex-col h-full bg-[var(--bg-main)] rounded-[24px] border border-[var(--border)] overflow-hidden">
                                <div className="p-4 bg-[var(--bg-card-hover)] border-b border-[var(--border)] flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <MessageSquare size={14} className="text-primary" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest title-gradient">Transcrição do Atendimento</span>
                                    </div>
                                    <span className="text-[9px] font-mono text-[var(--text-muted)] bg-[var(--bg-card)] px-2 py-0.5 rounded border border-[var(--border)]">
                                        {initialAnalysis.messageCount} msgs
                                    </span>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                                    {loading ? (
                                        <div className="h-full flex flex-col items-center justify-center text-center p-8">
                                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                                            <p className="text-[10px] text-[#8B949E] uppercase tracking-widest">Carregando mensagens...</p>
                                        </div>
                                    ) : transcript && transcript.length > 0 ? (
                                        transcript.map((msg, i) => {

                                            const isAgent = msg.role === 'agent';

                                            return (
                                                <div key={i} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
                                                    <div className={`max-w-[85%] p-4 rounded-2xl relative group ${isAgent
                                                        ? 'bg-primary/10 border border-primary/20 text-[var(--text-main)] rounded-tr-none'
                                                        : 'bg-[var(--bg-card-hover)] border border-[var(--border)] text-[var(--text-main)] rounded-tl-none'
                                                        }`}>
                                                        <p className="text-xs leading-relaxed">{msg.text}</p>
                                                        <div className="mt-2 flex items-center justify-between gap-4">
                                                            <span className="text-[8px] text-[#8B949E] font-mono">{msg.time}</span>
                                                            {isAgent && msg.feedback && (
                                                                <div className="flex gap-1 animate-fade-in">
                                                                    <span className={`text-[8px] px-1 rounded font-bold border uppercase ${msg.feedback.includes('🎯') ? 'text-success-text bg-success/10 border-success/20' :
                                                                        msg.feedback.includes('✨') ? 'text-primary bg-primary/10 border-primary/20' :
                                                                            'text-warning bg-warning/10 border-warning/20'
                                                                        }`}>
                                                                        {msg.feedback.includes('🎯') ? 'Excelente' : msg.feedback.includes('✨') ? 'Bom' : 'Melhorar'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Auto-comments on messages */}
                                                        {isAgent && msg.feedback && (
                                                            <div className={`mt-3 pt-3 border-t ${msg.feedback.includes('🎯') ? 'border-success/10' :
                                                                msg.feedback.includes('✨') ? 'border-primary/10' :
                                                                    'border-warning/10'
                                                                }`}>
                                                                <p className={`text-[10px] font-medium p-2 rounded-lg border ${msg.feedback.includes('🎯') ? 'text-success-text bg-success/5 border-success/5' :
                                                                    msg.feedback.includes('✨') ? 'text-primary/80 bg-primary/5 border-primary/5' :
                                                                        'text-warning/80 bg-warning/5 border-warning/5'
                                                                    }`}>
                                                                    {msg.feedback}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-center p-8">
                                            <div className="w-16 h-16 bg-[var(--bg-card)] rounded-full flex items-center justify-center mb-4 border border-[var(--border)]">
                                                <MessageSquare size={24} className="text-[var(--border)]" />
                                            </div>
                                            <h4 className="text-sm font-bold text-[#8B949E] mb-2 uppercase tracking-widest">Transcrição Indisponível</h4>
                                            <p className="text-[10px] text-[#8B949E]/60 leading-relaxed max-w-[200px]">
                                                A transcrição e análise por mensagens estão disponíveis apenas para novos uploads realizados a partir de agora.
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-main)]">
                                    <div className="flex gap-2">
                                        <button className="flex-1 btn-primary py-3 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                                            <Award size={14} /> Recompensar Agente
                                        </button>
                                        <button className="px-6 py-3 bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border)] rounded-xl hover:text-[var(--text-main)] transition-all">
                                            <Star size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Floating Navigation Arrows */}
                <div className="fixed inset-y-0 left-4 md:left-12 flex items-center pointer-events-none">
                    <button
                        onClick={(e) => { e.stopPropagation(); onPrevious?.(); }}
                        disabled={!hasPrevious}
                        className={`p-4 rounded-full bg-[var(--bg-card)]/60 border border-[var(--border)] text-[var(--text-main)] backdrop-blur-md transition-all pointer-events-auto ${hasPrevious ? 'hover:bg-primary/20 hover:border-primary/50 opacity-100 hover:scale-110' : 'opacity-20 scale-90 cursor-default'}`}
                    >
                        <ChevronLeft size={32} />
                    </button>
                </div>

                <div className="fixed inset-y-0 right-4 md:right-12 flex items-center pointer-events-none">
                    <button
                        onClick={(e) => { e.stopPropagation(); onNext?.(); }}
                        disabled={!hasNext}
                        className={`p-4 rounded-full bg-[var(--bg-card)]/60 border border-[var(--border)] text-[var(--text-main)] backdrop-blur-md transition-all pointer-events-auto ${hasNext ? 'hover:bg-primary/20 hover:border-primary/50 opacity-100 hover:scale-110' : 'opacity-20 scale-90 cursor-default'}`}
                    >
                        <ChevronRight size={32} />
                    </button>
                </div>
            </div>
        </AnimatePresence>
    );
};

