import React, { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { ACCEPTED_EXTENSIONS, extractText } from '../lib/extractText';
import {
    BookOpen,
    Plus,
    Trash2,
    Save,
    FileText,
    Loader2,
    Search,
    ChevronRight,
    Edit2,
    X,
    Layout,
    ArrowUp,
    List,
    Upload,
    RefreshCw,
    Bot,
    Download,
    AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface KnowledgeItem {
    id: string;
    title: string;
    content: string;
    type: string;
    category: string;
    file_url?: string;
    file_path?: string | null;
    file_name?: string | null;
    source_type?: 'text' | 'pdf' | 'sheet' | 'doc';
    ai_enabled?: boolean;
    index_status?: 'pending' | 'processing' | 'ready' | 'error';
    index_error?: string | null;
    chunk_count?: number;
    created_at: string;
}

const STATUS_STYLE: Record<string, { label: string; dot: string; text: string }> = {
    ready: { label: 'Indexado', dot: 'bg-emerald-500', text: 'text-emerald-500' },
    pending: { label: 'Pendente', dot: 'bg-amber-500', text: 'text-amber-500' },
    processing: { label: 'Indexando…', dot: 'bg-sky-500 animate-pulse', text: 'text-sky-500' },
    error: { label: 'Erro', dot: 'bg-red-500', text: 'text-red-500' },
};

/** Chama a edge function kb-ingest (chunk + embedding). Devolve msg de erro ou null. */
async function runIngest(body: Record<string, unknown>): Promise<{ error: string | null; data?: any }> {
    const { data, error } = await supabase.functions.invoke('kb-ingest', { body });
    if (error) {
        const ctx = await (error as any).context?.json?.().catch(() => null);
        return { error: ctx?.error ?? error.message };
    }
    if (data?.error) return { error: data.error };
    const failed = (data?.results ?? []).find((r: any) => !r.ok);
    return { error: failed ? failed.error : null, data };
}

interface UserProfile {
    role: 'admin' | 'agent';
}

export const KnowledgeBase: React.FC<{ profile: UserProfile | null }> = ({ profile }) => {
    const [items, setItems] = useState<KnowledgeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState(false);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [indexing, setIndexing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isAdmin = profile?.role === 'admin';

    // Form state
    const [formState, setFormState] = useState({
        title: '',
        content: '',
        category: 'Geral',
        file_url: ''
    });

    const formatText = (text: string) => {
        // Regex to match **text** but also capture the asterisks if needed
        // Since user wants to keep one asterisk for WhatsApp copying but show it pretty:
        // We will render it as: <span class="font-bold text-primary">*Texto*</span>
        // This way when they copy the text, the markdown bold (*) might be picked up depending on how they copy,
        // but for "true" WhatsApp bold they need *text*. 
        // The user said: "onde estiver **texto** significa que é Negrito. Não precisa mostre apenas 1 vez o *, para que quando o agente copiar a informação, vá como negrito no Whatsapp."
        // So: **texto** -> *texto* (visual bold)

        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                const innerText = part.slice(2, -2);
                return (
                    <span key={i} className="font-bold text-primary">
                        *{innerText}*
                    </span>
                );
            }
            return part;
        });
    };

    useEffect(() => {
        fetchKnowledge();
    }, []);

    const fetchKnowledge = async () => {
        const { data, error } = await supabase
            .from('knowledge_base')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setItems(data);
            if (data.length > 0) {
                if (!selectedItem) {
                    setSelectedItem(data[0]);
                } else {
                    // Update current selection with fresh data
                    const updated = data.find(i => i.id === selectedItem.id);
                    if (updated) setSelectedItem(updated);
                }
            }
        }
        setLoading(false);
    };

    const handleSave = async () => {
        if (!formState.title || !formState.content) return;
        setSaving(true);

        const payload = {
            title: formState.title,
            content: formState.content,
            category: formState.category,
            file_url: formState.file_url,
            type: 'document'
        };

        // .select() pra detectar UPDATE que filtrou 0 linhas sem erro (token em refresh)
        const { data: saved, error } = selectedItem && isEditing
            ? await supabase.from('knowledge_base').update(payload).eq('id', selectedItem.id).select('id')
            : await supabase.from('knowledge_base').insert(payload).select('id');

        if (error || !saved?.length) {
            toast.error(`Não foi possível salvar: ${error?.message ?? 'sessão expirada, recarregue a página.'}`);
            setSaving(false);
            return;
        }
        setIsEditing(false);
        setSaving(false);
        await fetchKnowledge();
        // reindexa pra IA já enxergar o conteúdo novo
        const { error: ingErr } = await runIngest({ document_id: saved[0].id });
        if (ingErr) toast.error(`Salvo, mas a indexação para a IA falhou: ${ingErr}`);
        await fetchKnowledge();
    };

    const handleFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        let ok = 0;
        for (const file of Array.from(files)) {
            const tid = toast.loading(`Lendo ${file.name}…`);
            try {
                const { text, sourceType } = await extractText(file);
                const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_');
                const path = `${crypto.randomUUID()}/${safeName}`;
                const { error: upErr } = await supabase.storage.from('knowledge-files').upload(path, file, { contentType: file.type || undefined });
                if (upErr) throw new Error(`upload do arquivo: ${upErr.message}`);

                const { data: rows, error: insErr } = await supabase.from('knowledge_base').insert({
                    title: file.name.replace(/\.[^.]+$/, ''),
                    content: text,
                    category: 'Geral',
                    type: 'document',
                    source_type: sourceType,
                    file_path: path,
                    file_name: file.name,
                }).select('id');
                if (insErr || !rows?.length) {
                    await supabase.storage.from('knowledge-files').remove([path]);
                    throw new Error(insErr?.message ?? 'sessão expirada, recarregue a página.');
                }
                toast.loading(`Indexando ${file.name} para a IA…`, { id: tid });
                const { error: ingErr } = await runIngest({ document_id: rows[0].id });
                if (ingErr) toast.error(`${file.name}: salvo, mas indexação falhou — ${ingErr}`, { id: tid });
                else { toast.success(`${file.name} adicionado à base`, { id: tid }); ok++; }
            } catch (e) {
                toast.error(`${file.name}: ${(e as Error).message}`, { id: tid });
            }
            await fetchKnowledge();
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
        setUploading(false);
        if (ok > 1) toast.success(`${ok} arquivos adicionados.`);
    };

    const handleIndexPending = async () => {
        setIndexing(true);
        const tid = toast.loading('Indexando documentos pendentes…');
        const { error, data } = await runIngest({ all_pending: true });
        if (error) toast.error(`Indexação: ${error}`, { id: tid });
        else toast.success(`${data?.indexed ?? 0} documento(s) indexado(s).`, { id: tid });
        await fetchKnowledge();
        setIndexing(false);
    };

    const handleReindexOne = async (id: string) => {
        setIndexing(true);
        const { error } = await runIngest({ document_id: id });
        if (error) toast.error(`Indexação: ${error}`); else toast.success('Documento reindexado.');
        await fetchKnowledge();
        setIndexing(false);
    };

    const toggleAi = async (item: KnowledgeItem) => {
        const { data, error } = await supabase.from('knowledge_base')
            .update({ ai_enabled: !item.ai_enabled }).eq('id', item.id).select('id');
        if (error || !data?.length) toast.error('Não foi possível alterar. Recarregue a página.');
        await fetchKnowledge();
    };

    const openOriginal = async (item: KnowledgeItem) => {
        if (!item.file_path) return;
        const { data, error } = await supabase.storage.from('knowledge-files').createSignedUrl(item.file_path, 300);
        if (error || !data) { toast.error('Não foi possível abrir o arquivo.'); return; }
        window.open(data.signedUrl, '_blank', 'noopener');
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Deseja excluir este documento da base de conhecimento?')) return;
        const path = items.find(i => i.id === id)?.file_path;
        const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
        if (!error) {
            if (path) await supabase.storage.from('knowledge-files').remove([path]);
            setSelectedItem(null);
            fetchKnowledge();
        }
    };

    const filteredItems = useMemo(() => {
        return items.filter(item =>
            item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.category.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [items, searchTerm]);

    const groupedItems = useMemo(() => {
        const groups: Record<string, KnowledgeItem[]> = {};
        filteredItems.forEach(item => {
            const cat = item.category || 'Geral';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(item);
        });
        return groups;
    }, [filteredItems]);

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] animate-fade-in relative overflow-hidden">
            <header className="flex justify-between items-end mb-8 px-2">
                <div>
                    <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter mb-1">Base de Conhecimento</h2>
                    <p className="text-[var(--text-muted)] text-sm font-medium">Documentação centralizada no estilo GitBook para consulta e treinamento de IA.</p>
                </div>
                {isAdmin && (
                    <div className="flex items-center gap-2">
                        {items.some(i => i.index_status !== 'ready') && (
                            <button
                                onClick={handleIndexPending}
                                disabled={indexing}
                                className="px-4 py-2.5 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)] text-xs font-bold text-[var(--text-main)] hover:border-primary transition-all flex items-center gap-2 disabled:opacity-50"
                                title="Gera os trechos vetorizados que a IA consulta"
                            >
                                <RefreshCw size={14} className={indexing ? 'animate-spin' : ''} />
                                Indexar pendentes ({items.filter(i => i.index_status !== 'ready').length})
                            </button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept={ACCEPTED_EXTENSIONS}
                            className="hidden"
                            onChange={(e) => handleFiles(e.target.files)}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="px-4 py-2.5 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)] text-xs font-bold text-[var(--text-main)] hover:border-primary transition-all flex items-center gap-2 disabled:opacity-50"
                            title="PDF, DOCX, XLSX, CSV, TXT ou MD"
                        >
                            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            Enviar arquivos
                        </button>
                        <button
                            onClick={() => {
                                setFormState({ title: '', content: '', category: 'Geral', file_url: '' });
                                setIsEditing(true);
                                setSelectedItem(null);
                            }}
                            className="btn-primary flex items-center gap-2"
                        >
                            <Plus size={18} />
                            Novo Documento
                        </button>
                    </div>
                )}
            </header>

            <div className="flex gap-6 h-full overflow-hidden border-t border-[var(--border)] pt-6">
                {/* Sidebar - Navegação GitBook */}
                <div className="w-[300px] flex flex-col gap-6 h-full border-r border-[var(--border)] pr-6">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar na base..."
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
                            Object.entries(groupedItems).map(([category, catItems]) => (
                                <div key={category} className="space-y-1">
                                    <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em] px-3 mb-2">{category}</h4>
                                    {catItems.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                setSelectedItem(item);
                                                setIsEditing(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all group relative ${selectedItem?.id === item.id ? 'bg-primary/10 text-primary font-bold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]'}`}
                                        >
                                            <FileText size={16} className={selectedItem?.id === item.id ? 'text-primary' : 'text-[var(--border)] group-hover:text-[var(--text-muted)]'} />
                                            <span className="truncate flex-1 text-left">{item.title}</span>
                                            {isAdmin && (
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.ai_enabled === false ? 'bg-[var(--border)]' : STATUS_STYLE[item.index_status ?? 'pending']?.dot}`}
                                                    title={item.ai_enabled === false ? 'Fora da IA' : `IA: ${STATUS_STYLE[item.index_status ?? 'pending']?.label}`}
                                                />
                                            )}
                                            {selectedItem?.id === item.id && (
                                                <motion.div layoutId="active-doc" className="absolute left-0 w-1 h-4 bg-primary rounded-full" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}

                        {!loading && items.length === 0 && (
                            <div className="text-center py-10 opacity-30">
                                <p className="text-xs uppercase tracking-widest font-bold">Vazio</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <div
                    id="kb-content-area"
                    className="flex-1 overflow-y-auto custom-scrollbar relative scroll-smooth h-full"
                    onScroll={(e) => {
                        const target = e.currentTarget;
                        setShowScrollTop(target.scrollTop > 400);
                    }}
                >
                    {selectedItem && !isEditing ? (
                        <div className="flex-1 max-w-4xl mx-auto w-full pt-10">
                            <div className="mb-8 flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
                                            {selectedItem.category}
                                        </span>
                                        <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">
                                            Criado em {new Date(selectedItem.created_at).toLocaleDateString()}
                                        </span>
                                        {selectedItem.file_url && (
                                            <a
                                                href={selectedItem.file_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/20 transition-all"
                                            >
                                                <FileText size={10} />
                                                PDF Original
                                            </a>
                                        )}
                                    </div>
                                    <h1 className="text-4xl font-black text-[var(--text-main)] tracking-tight">{selectedItem.title}</h1>
                                    {isAdmin && (
                                        <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] font-bold">
                                            <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                                                <Bot size={13} />
                                                IA:
                                                {selectedItem.ai_enabled === false ? (
                                                    <span className="text-[var(--text-muted)]">fora da base da IA</span>
                                                ) : (
                                                    <span className={STATUS_STYLE[selectedItem.index_status ?? 'pending']?.text}>
                                                        {STATUS_STYLE[selectedItem.index_status ?? 'pending']?.label}
                                                        {selectedItem.index_status === 'ready' && ` · ${selectedItem.chunk_count} trechos`}
                                                    </span>
                                                )}
                                            </span>
                                            <label className="flex items-center gap-1.5 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-main)]">
                                                <input type="checkbox" checked={selectedItem.ai_enabled !== false} onChange={() => toggleAi(selectedItem)} className="accent-[var(--primary)]" />
                                                Usar na IA
                                            </label>
                                            <button
                                                onClick={() => handleReindexOne(selectedItem.id)}
                                                disabled={indexing}
                                                className="flex items-center gap-1 text-[var(--text-muted)] hover:text-primary disabled:opacity-50"
                                            >
                                                <RefreshCw size={12} className={indexing ? 'animate-spin' : ''} /> Reindexar
                                            </button>
                                            {selectedItem.file_path && (
                                                <button onClick={() => openOriginal(selectedItem)} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-primary">
                                                    <Download size={12} /> {selectedItem.file_name ?? 'Arquivo original'}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {isAdmin && selectedItem.index_status === 'error' && selectedItem.index_error && (
                                        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-500">
                                            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {selectedItem.index_error}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {selectedItem.file_url && (
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(selectedItem.file_url || '');
                                                alert('Link do PDF copiado!');
                                            }}
                                            className="px-4 py-2.5 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)] text-xs font-bold text-primary hover:bg-primary/5 transition-all shadow-sm flex items-center gap-2"
                                        >
                                            <Save size={14} />
                                            Copiar Link PDF
                                        </button>
                                    )}
                                    {profile?.role === 'admin' && (
                                        <>
                                            <button
                                                onClick={() => {
                                                    setFormState({
                                                        title: selectedItem.title,
                                                        content: selectedItem.content,
                                                        category: selectedItem.category || 'Geral',
                                                        file_url: selectedItem.file_url || ''
                                                    });
                                                    setIsEditing(true);
                                                }}
                                                className="p-2.5 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-primary transition-all shadow-sm"
                                                title="Editar"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(selectedItem.id)}
                                                className="p-2.5 rounded-xl bg-[var(--bg-card-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400 hover:border-red-400/50 transition-all shadow-sm"
                                                title="Excluir"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 max-w-4xl mx-auto w-full pb-20">
                                {/* Auto-generated Table of Contents */}
                                {selectedItem.content.includes('#') && (
                                    <div className="mb-10 p-6 rounded-2xl bg-[var(--bg-card-hover)] border border-[var(--border)] shadow-sm">
                                        <div className="flex items-center gap-2 mb-4 text-primary">
                                            <List size={18} />
                                            <h3 className="text-sm font-bold uppercase tracking-wider">Índice do Documento</h3>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                                            {selectedItem.content.split('\n')
                                                .filter(line => line.startsWith('#'))
                                                .map((line, idx) => {
                                                    const level = line.match(/^#+/)?.[0].length || 1;
                                                    const title = line.replace(/^#+\s*/, '');
                                                    const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
                                                    return (
                                                        <a
                                                            key={idx}
                                                            href={`#${id}`}
                                                            className={`text-sm transition-all hover:text-primary ${level === 1 ? 'font-bold text-[var(--text-main)]' : 'text-[var(--text-muted)] pl-4'}`}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
                                                            }}
                                                        >
                                                            {title}
                                                        </a>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                )}

                                <div className="prose max-w-none">
                                    <div className="text-md leading-relaxed text-[var(--text-main)] whitespace-pre-wrap">
                                        {selectedItem.content.split('\n').map((line, idx) => {
                                            if (line.startsWith('#')) {
                                                const level = line.match(/^#+/)?.[0].length || 1;
                                                const title = line.replace(/^#+\s*/, '');
                                                const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
                                                const HeadingTag = `h${Math.min(level, 4)}` as keyof JSX.IntrinsicElements;
                                                return (
                                                    <HeadingTag
                                                        key={idx}
                                                        id={id}
                                                        className={`font-black tracking-tight mb-4 mt-8 ${level === 1 ? 'text-3xl border-b border-[var(--border)] pb-2' : 'text-xl'}`}
                                                    >
                                                        {formatText(title)}
                                                    </HeadingTag>
                                                );
                                            }
                                            return <p key={idx} className="mb-4">{formatText(line)}</p>;
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Scroll to Top Button */}
                            <AnimatePresence>
                                {showScrollTop && (
                                    <motion.button
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.5 }}
                                        onClick={() => {
                                            document.getElementById('kb-content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}
                                        className="fixed bottom-10 right-10 p-4 rounded-full bg-primary text-white shadow-2xl hover:bg-primary/90 transition-all z-50 flex items-center gap-2 group"
                                    >
                                        <ArrowUp size={20} className="group-hover:-translate-y-1 transition-transform" />
                                        <span className="text-xs font-bold mr-1">Topo</span>
                                    </motion.button>
                                )}
                            </AnimatePresence>
                        </div>
                    ) : isEditing ? (
                        <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-2">
                                    {selectedItem ? 'Editar Documento' : 'Novo Documento'}
                                </h3>
                                <button onClick={() => setIsEditing(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar pr-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Título</label>
                                        <input
                                            type="text"
                                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-[var(--text-main)] focus:border-primary outline-none transition-all font-bold"
                                            value={formState.title}
                                            onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                                            placeholder="Ex: Guia de Abordagem 2024"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Categoria</label>
                                        <input
                                            type="text"
                                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-[var(--text-main)] focus:border-primary outline-none transition-all font-bold"
                                            value={formState.category}
                                            onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                                            placeholder="Ex: Vendas, RH, Processos..."
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Link do PDF Original (Opcional)</label>
                                    <input
                                        type="text"
                                        className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-[var(--text-main)] focus:border-primary outline-none transition-all font-bold"
                                        value={formState.file_url}
                                        onChange={(e) => setFormState({ ...formState, file_url: e.target.value })}
                                        placeholder="https://exemplo.com/arquivo.pdf"
                                    />
                                </div>
                                <div className="space-y-2 flex-1 flex flex-col min-h-[400px]">
                                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">Conteúdo (Texto Corrido)</label>
                                    <textarea
                                        className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 text-[var(--text-main)] focus:border-primary outline-none transition-all text-base leading-relaxed custom-scrollbar resize-none"
                                        value={formState.content}
                                        onChange={(e) => setFormState({ ...formState, content: e.target.value })}
                                        placeholder="Comece a escrever seu guia aqui..."
                                    />
                                </div>
                                <div className="flex justify-end gap-3 pt-4">
                                    <button onClick={() => setIsEditing(false)} className="px-6 py-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all text-sm font-bold">Cancelar</button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="btn-primary min-w-[200px]"
                                    >
                                        {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : 'Salvar na Base'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center opacity-20 text-center p-12">
                            <BookOpen size={80} className="mb-6" />
                            <h3 className="text-2xl font-bold mb-2">Selecione um documento</h3>
                            <p className="max-w-xs">Navegue na biblioteca ao lado para consultar a base de conhecimento.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
