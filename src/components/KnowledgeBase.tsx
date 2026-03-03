import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
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
    Layout
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface KnowledgeItem {
    id: string;
    title: string;
    content: string;
    type: string;
    category: string;
    created_at: string;
}

export const KnowledgeBase: React.FC = () => {
    const [items, setItems] = useState<KnowledgeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState(false);

    // Form state
    const [formState, setFormState] = useState({
        title: '',
        content: '',
        category: 'Geral'
    });

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
            type: 'document'
        };

        let error;
        if (selectedItem && isEditing) {
            const { error: err } = await supabase
                .from('knowledge_base')
                .update(payload)
                .eq('id', selectedItem.id);
            error = err;
        } else {
            const { error: err } = await supabase
                .from('knowledge_base')
                .insert(payload);
            error = err;
        }

        if (!error) {
            setIsEditing(false);
            fetchKnowledge();
        }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Deseja excluir este documento da base de conhecimento?')) return;
        const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
        if (!error) {
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
                <button
                    onClick={() => {
                        setFormState({ title: '', content: '', category: 'Geral' });
                        setIsEditing(true);
                        setSelectedItem(null);
                    }}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} />
                    Novo Documento
                </button>
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
                                            <span className="truncate">{item.title}</span>
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
                <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
                    {selectedItem && !isEditing ? (
                        <div className="flex-1 flex flex-col overflow-hidden max-w-4xl mx-auto w-full">
                            <div className="mb-8 flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
                                            {selectedItem.category}
                                        </span>
                                        <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">
                                            Criado em {new Date(selectedItem.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <h1 className="text-4xl font-black text-[var(--text-main)] tracking-tight">{selectedItem.title}</h1>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            setFormState({
                                                title: selectedItem.title,
                                                content: selectedItem.content,
                                                category: selectedItem.category || 'Geral'
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
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 pb-20">
                                <div className="prose max-w-none">
                                    <div className="text-lg leading-relaxed text-[var(--text-main)] whitespace-pre-wrap font-medium">
                                        {selectedItem.content}
                                    </div>
                                </div>
                            </div>
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
