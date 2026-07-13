import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

// ─── Period helpers ───────────────────────────────────────────────────────────
export function periodToDates(period: string, customStart: string, customEnd: string): { start: string; end: string } {
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

// ─── Custom dropdown that auto-sizes to fit longest option ───────────────────
export interface SelectOption { value: string; label: string; }

export const AutoWidthSelect: React.FC<{
    label: string;
    value: string;
    options: SelectOption[];
    onChange: (v: string) => void;
    placeholder?: string;
}> = ({ label, value, options, onChange, placeholder = 'Todos' }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.value === value);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className="flex flex-col gap-1" ref={ref}>
            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{label}</span>
            <div className="relative">
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-primary min-w-[220px] w-full text-left"
                >
                    <span className="flex-1 truncate">{selected ? selected.label : placeholder}</span>
                    <ChevronDown size={12} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                    <div className="absolute top-full mt-1 left-0 z-[200] bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto max-h-72"
                        style={{ minWidth: '100%', width: 'max-content', maxWidth: '520px' }}>
                        <button
                            onClick={() => { onChange('all'); setOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-xs hover:bg-[var(--bg-card-hover)] transition-colors whitespace-nowrap
                                ${value === 'all' ? 'text-primary font-bold' : 'text-[var(--text-main)]'}`}
                        >
                            {placeholder}
                        </button>
                        <div className="h-px bg-[var(--border)] mx-2" />
                        {options.map(o => (
                            <button
                                key={o.value}
                                onClick={() => { onChange(o.value); setOpen(false); }}
                                className={`w-full text-left px-4 py-2 text-xs hover:bg-[var(--bg-card-hover)] transition-colors whitespace-nowrap
                                    ${value === o.value ? 'text-primary font-bold bg-primary/5' : 'text-[var(--text-main)]'}`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export const PERIOD_OPTIONS = [
    { value: 'today', label: 'Hoje' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mês' },
    { value: 'semester', label: 'Semestre' },
    { value: 'year', label: 'Ano' },
    { value: 'custom', label: 'Personalizado' },
];
