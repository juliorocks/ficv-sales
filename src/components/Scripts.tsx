import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
    MessageSquare,
    Search,
    Copy,
    Plus,
    Edit2,
    Trash2,
    ChevronRight,
    Sparkles,
    Check,
    X,
    Filter,
    Loader2,
    BookOpen,
    ArrowRight,
    Award,
    TrendingUp,
    FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateRefinedScript } from '../services/aiSpecialist';

interface Script {
    id: string;
    titulo: string;
    categoria: string;
    curso: string;
    etapa_funil: string;
    conteudo: string;
    ativo: boolean;
    created_at: string;
}

interface ScriptsProps {
    isAdmin: boolean;
}

const CATEGORIES = [
    'Atendimento inicial',
    'Direito',
    'Teologia Presencial',
    'Teologia EAD',
    'Pós-graduações',
    'Investimento',
    'Objeções',
    'Fechamento',
    'Follow-up',
    'Templates Meta'
];

export const Scripts: React.FC<ScriptsProps> = ({ isAdmin }) => {
    const [scripts, setScripts] = useState<Script[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedScript, setSelectedScript] = useState<Script | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isIARining, setIsIARining] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [aiTargetContent, setAiTargetContent] = useState<string>('');

    // Form state for creating/editing
    const [formState, setFormState] = useState({
        titulo: '',
        categoria: CATEGORIES[0],
        curso: '',
        etapa_funil: '',
        conteudo: ''
    });

    useEffect(() => {
        fetchScripts();
    }, []);

    const fetchScripts = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('scripts')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setScripts(data);
            if (data.length > 0) {
                if (!selectedScript) {
                    setSelectedScript(data[0]);
                } else {
                    // Update current selection with fresh data
                    const updated = data.find(s => s.id === selectedScript.id);
                    if (updated) setSelectedScript(updated);
                }
            }
        }
        setLoading(false);
    };

    const handleCopy = (text: string, id: string) => {
        // Remove markdown separators and trim
        let cleanedText = text.replace(/---/g, '').trim();

        // Logical extraction: Remove the first line if it looks like a title (e.g., contains 🎯 or is a numbered title)
        const lines = cleanedText.split('\n');
        if (lines.length > 1 && (lines[0].includes('🎯') || /^\d+\./.test(lines[0]))) {
            cleanedText = lines.slice(1).join('\n').trim();
        }

        navigator.clipboard.writeText(cleanedText);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const filteredScripts = useMemo(() => {
        return scripts.filter(s => {
            const matchesSearch = s.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                s.conteudo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                s.categoria.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        });
    }, [scripts, searchTerm]);

    const groupedScripts = useMemo(() => {
        const groups: Record<string, Script[]> = {};
        filteredScripts.forEach(s => {
            if (!groups[s.categoria]) groups[s.categoria] = [];
            groups[s.categoria].push(s);
        });
        return groups;
    }, [filteredScripts]);

    const handleSave = async () => {
        const payload = {
            titulo: formState.titulo,
            categoria: formState.categoria,
            curso: formState.curso,
            etapa_funil: formState.etapa_funil,
            conteudo: formState.conteudo,
            ativo: true
        };

        if (selectedScript && isEditing) {
            const { error } = await supabase
                .from('scripts')
                .update(payload)
                .eq('id', selectedScript.id);
            if (!error) {
                setIsEditing(false);
                fetchScripts();
            }
        } else {
            const { error } = await supabase
                .from('scripts')
                .insert([payload]);
            if (!error) {
                setIsEditing(false);
                fetchScripts();
            }
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este script?')) return;
        const { error } = await supabase.from('scripts').delete().eq('id', id);
        if (!error) {
            setSelectedScript(null);
            fetchScripts();
        }
    };

    // Split content by "---" to support individual section copying
    const scriptSections = useMemo(() => {
        if (!selectedScript) return [];
        return selectedScript.conteudo.split('---').map(s => s.trim()).filter(s => s.length > 0);
    }, [selectedScript]);

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] animate-fade-in relative overflow-hidden">
            <header className="flex justify-between items-end mb-8 px-2">
                <div>
                    <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter mb-1">Scripts de Atendimento</h2>
                    <p className="text-[var(--text-muted)] text-sm font-medium">Copie seções individualmente ou use IA para ajustar cada parte.</p>
                </div>
                {isAdmin && (
                    <button
                        onClick={() => {
                            setFormState({ titulo: '', categoria: CATEGORIES[0], curso: '', etapa_funil: '', conteudo: '' });
                            setIsEditing(true);
                            setSelectedScript(null);
                        }}
                        className="btn-primary flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Novo Script
                    </button>
                )}
            </header>

            <div className="flex gap-6 h-full overflow-hidden border-t border-[var(--border)] pt-6">
                {/* Sidebar - Navegação GitBook-style */}
                <div className="w-[300px] flex flex-col gap-6 h-full border-r border-[var(--border)] pr-6">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar scripts..."
                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--text-main)] focus:border-primary outline-none transition-all shadow-inner"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                        {loading ? (
                            <div className="flex justify-center py-20 opacity-20">
                                <Loader2 className="animate-spin text-primary" size={24} />
                            </div>
                        ) : (
                            Object.entries(groupedScripts).map(([category, catScripts]) => (
                                <div key={category} className="space-y-1">
                                    <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em] px-3 mb-2">{category}</h4>
                                    {catScripts.map(script => (
                                        <button
                                            key={script.id}
                                            onClick={() => {
                                                setSelectedScript(script);
                                                setIsEditing(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all group relative ${selectedScript?.id === script.id ? 'bg-primary/10 text-primary font-bold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]'}`}
                                        >
                                            <FileText size={16} className={selectedScript?.id === script.id ? 'text-primary' : 'text-[var(--border)] group-hover:text-[var(--text-muted)]'} />
                                            <span className="truncate">{script.titulo}</span>
                                            {selectedScript?.id === script.id && (
                                                <motion.div layoutId="active-script" className="absolute left-0 w-1 h-4 bg-primary rounded-full" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Main Content - Seções Copiáveis */}
                <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
                    {selectedScript && !isEditing ? (
                        <div className="flex-1 flex flex-col overflow-hidden max-w-4xl mx-auto w-full">
                            <div className="mb-8 flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
                                            {selectedScript.categoria}
                                        </span>
                                        {selectedScript.curso && (
                                            <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">
                                                • {selectedScript.curso}
                                            </span>
                                        )}
                                    </div>
                                    <h1 className="text-4xl font-black text-[var(--text-main)] tracking-tight">{selectedScript.titulo}</h1>
                                </div>
                                <div className="flex gap-2">
                                    {isAdmin && (
                                        <>
                                            <button
                                                onClick={() => {
                                                    setFormState({
                                                        titulo: selectedScript.titulo,
                                                        categoria: selectedScript.categoria,
                                                        curso: selectedScript.curso || '',
                                                        etapa_funil: selectedScript.etapa_funil || '',
                                                        conteudo: selectedScript.conteudo
                                                    });
                                                    setIsEditing(true);
                                                }}
                                                className="p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-primary transition-all shadow-sm"
                                                title="Editar"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(selectedScript.id)}
                                                className="p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400 hover:border-red-400/50 transition-all shadow-sm"
                                                title="Excluir"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 space-y-4 pb-10">
                                {scriptSections.map((section, idx) => {
                                    const sectionId = `section-${idx}`;
                                    return (
                                        <div
                                            key={idx}
                                            className="group relative bg-[var(--bg-card)]/50 hover:bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-2xl p-6 transition-all"
                                        >
                                            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={() => {
                                                        setAiTargetContent(section);
                                                        setIsIARining(true);
                                                    }}
                                                    className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary hover:text-white transition-all shadow-lg"
                                                    title="Otimizar seção com IA"
                                                >
                                                    <Sparkles size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleCopy(section, sectionId)}
                                                    className={`p-2 rounded-lg transition-all shadow-lg ${copiedId === sectionId ? 'bg-success text-white' : 'bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-primary'}`}
                                                    title="Copiar seção"
                                                >
                                                    {copiedId === sectionId ? <Check size={16} /> : <Copy size={16} />}
                                                </button>
                                            </div>
                                            <div className="prose prose-invert max-w-none">
                                                <div className="text-base leading-relaxed text-[var(--text-main)] whitespace-pre-wrap font-medium pr-12">
                                                    {section.split('\n').map((line, lIdx) => {
                                                        const isTitle = line.includes('🎯') || /^\d+\./.test(line);
                                                        if (isTitle) {
                                                            return (
                                                                <div key={lIdx} className="text-xs font-bold text-primary uppercase tracking-[0.2em] mb-4 opacity-80">
                                                                    {line}
                                                                </div>
                                                            );
                                                        }
                                                        return <div key={lIdx} className="opacity-90">{line}</div>;
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : isEditing ? (
                        <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-2">
                                    {selectedScript ? 'Editar Script' : 'Novo Script'}
                                </h3>
                                <button onClick={() => setIsEditing(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar pr-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Título do Script</label>
                                        <input
                                            type="text"
                                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-[var(--text-main)] focus:border-primary outline-none transition-all font-bold"
                                            value={formState.titulo}
                                            onChange={e => setFormState({ ...formState, titulo: e.target.value })}
                                            placeholder="Ex: Abordagem Inicial Direito"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Categoria</label>
                                        <select
                                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-[var(--text-main)] focus:border-primary outline-none transition-all font-bold appearance-none cursor-pointer"
                                            value={formState.categoria}
                                            onChange={e => setFormState({ ...formState, categoria: e.target.value })}
                                        >
                                            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="space-y-1.5 flex-1 flex flex-col min-h-[300px]">
                                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Conteúdo (Use --- para separar seções copiáveis)</label>
                                    <textarea
                                        className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 text-[var(--text-main)] focus:border-primary outline-none transition-all text-base leading-relaxed custom-scrollbar resize-none"
                                        value={formState.conteudo}
                                        onChange={e => setFormState({ ...formState, conteudo: e.target.value })}
                                        placeholder="🎯 1. Abertura&#10;Olá! Tudo bem?&#10;---&#10;🎯 2. Diagnóstico&#10;..."
                                    />
                                </div>
                                <div className="flex justify-end gap-3 pt-4">
                                    <button onClick={() => setIsEditing(false)} className="px-6 py-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all text-sm font-bold">Cancelar</button>
                                    <button
                                        onClick={handleSave}
                                        className="btn-primary min-w-[200px]"
                                    >
                                        Salvar Script
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center opacity-20 text-center p-12">
                            <MessageSquare size={80} className="mb-6" />
                            <h3 className="text-2xl font-bold mb-2">Selecione um script</h3>
                            <p className="max-w-xs">Navegue na biblioteca ao lado para visualizar os scripts.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal de IA Refine */}
            <IARefineModal
                isOpen={isIARining}
                onClose={() => {
                    setIsIARining(false);
                    setAiTargetContent('');
                }}
                originalContent={aiTargetContent}
                onApply={(newContent) => {
                    navigator.clipboard.writeText(newContent);
                    alert('Seção otimizada copiada!');
                    setIsIARining(false);
                }}
            />
        </div>
    );
};

interface IARefineModalProps {
    isOpen: boolean;
    onClose: () => void;
    originalContent: string;
    onApply: (content: string) => void;
}

const IARefineModal: React.FC<IARefineModalProps> = ({ isOpen, onClose, originalContent, onApply }) => {
    const [refining, setRefining] = useState(false);
    const [result, setResult] = useState('');
    const [objective, setObjective] = useState('persuasive');

    const objectives = [
        { id: 'persuasive', label: 'Mais Persuasivo', icon: Sparkles },
        { id: 'short', label: 'Mais Curto', icon: X },
        { id: 'formal', label: 'Mais Formal', icon: Award },
        { id: 'direct', label: 'Mais Direto', icon: ArrowRight },
        { id: 'cold', label: 'Lead Frio', icon: BookOpen },
        { id: 'hot', label: 'Lead Quente', icon: TrendingUp },
    ];

    const handleRefine = async () => {
        setRefining(true);
        try {
            const newContent = await generateRefinedScript(originalContent, objective);
            setResult(newContent);
        } catch (err: any) {
            console.error(err);
            alert('Falha na conexão com o Especialista de IA: ' + (err.message || 'Erro desconhecido'));
        } finally {
            setRefining(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/90 backdrop-blur-md"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="glass-card w-full max-w-4xl h-[80vh] relative z-10 flex flex-col overflow-hidden border-primary/50 shadow-[0_0_50px_rgba(85,81,255,0.2)]"
                    >
                        <div className="p-6 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-card)]/50">
                            <h3 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-2">
                                <Sparkles className="text-primary animate-pulse" size={20} />
                                Otimizar Seção com IA
                            </h3>
                            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 flex overflow-hidden">
                            <div className="w-[280px] p-4 border-r border-[var(--border)] flex flex-col gap-2">
                                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2 px-2">Escolha o objetivo:</p>
                                {objectives.map(obj => (
                                    <button
                                        key={obj.id}
                                        onClick={() => setObjective(obj.id)}
                                        className={`flex items-center gap-3 p-3 rounded-xl transition-all border ${objective === obj.id ? 'bg-primary/20 border-primary text-primary font-bold' : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'}`}
                                    >
                                        <obj.icon size={18} />
                                        <span className="text-xs">{obj.label}</span>
                                    </button>
                                ))}
                                <div className="mt-auto p-4 bg-primary/5 rounded-2xl border border-primary/10">
                                    <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">A IA analisará esta seção específica para gerar uma variação otimizada.</p>
                                </div>
                                <button
                                    onClick={handleRefine}
                                    disabled={refining}
                                    className="btn-primary w-full py-3 mt-4 flex items-center justify-center gap-2"
                                >
                                    {refining ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                                    Gerar Otimização
                                </button>
                            </div>

                            <div className="flex-1 flex flex-col bg-[var(--bg-main)]">
                                {result ? (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-card)]/50">
                                            <span className="text-[10px] font-bold text-success uppercase tracking-widest flex items-center gap-2">
                                                <Check size={14} /> Sugestão da IA Pronta
                                            </span>
                                            <button
                                                onClick={() => setResult('')}
                                                className="text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
                                            >
                                                Ver Original
                                            </button>
                                        </div>
                                        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar font-medium leading-relaxed text-[var(--text-main)] whitespace-pre-wrap">
                                            {result}
                                        </div>
                                        <div className="p-6 border-t border-[var(--border)] bg-[var(--bg-card)]/30">
                                            <button
                                                onClick={() => onApply(result)}
                                                className="btn-primary w-full py-4 text-lg font-black uppercase tracking-tighter shadow-[0_0_20px_rgba(85,81,255,0.4)]"
                                            >
                                                Copiar Seção Otimizada
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-40">
                                        {refining ? (
                                            <div className="space-y-4">
                                                <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
                                                <p className="font-bold text-xl text-[var(--text-main)]">Pensando nesta seção...</p>
                                                <p className="text-sm">Ajustando gatilhos específicos.</p>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="bg-[var(--bg-card)]/50 p-6 rounded-2xl border border-[var(--border)] max-w-md w-full mb-6">
                                                    <p className="text-xs text-[var(--text-muted)] mb-2 uppercase font-bold tracking-widest">Seção Original:</p>
                                                    <p className="text-sm text-[var(--text-main)] opacity-70 line-clamp-4 italic">"{originalContent}"</p>
                                                </div>
                                                <Sparkles size={48} className="mb-4 text-primary opacity-50" />
                                                <h4 className="text-xl font-bold text-[var(--text-main)] mb-2">Pronto para Otimizar</h4>
                                                <p className="text-sm max-w-sm">Escolha um objetivo para refinar apenas este bloco de texto.</p>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
