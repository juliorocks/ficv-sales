import { useState } from "react"
import { Calendar } from "lucide-react"

export interface KanbanDateRange {
    start: string
    end: string
}

interface KanbanDateFilterProps {
    value: KanbanDateRange
    onChange: (value: KanbanDateRange) => void
    isDarkMode: boolean
}

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function monthRange(year: number, monthIndex0: number): KanbanDateRange {
    const start = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, monthIndex0 + 1, 0).getDate()
    const end = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return { start, end }
}

/**
 * Filtro de período do Kanban — filtra os leads por `data_entrada` (quando entraram
 * no funil). Independente do filtro de Data da tela Visão Geral (esse filtra
 * análises de atendimento por outra data e nunca teve relação com leads/Kanban).
 */
export function KanbanDateFilter({ value, onChange, isDarkMode }: KanbanDateFilterProps) {
    const [isOpen, setIsOpen] = useState(false)
    const now = new Date()
    const curYear = now.getFullYear()
    const curMonth = now.getMonth()

    const label = (() => {
        if (!value.start) return 'Período'
        const s = new Date(value.start + 'T00:00:00')
        const e = value.end ? new Date(value.end + 'T00:00:00') : null
        if (e) {
            const lastOfMonth = new Date(s.getFullYear(), s.getMonth() + 1, 0)
            if (s.getDate() === 1 && e.getDate() === lastOfMonth.getDate() && e.getMonth() === s.getMonth()) {
                return s.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '')
            }
        }
        return `Desde ${s.toLocaleDateString('pt-BR')}`
    })()

    const applyPreset = (preset: string) => {
        const start = new Date()
        const end = new Date()
        switch (preset) {
            case 'today':
                start.setHours(0, 0, 0, 0)
                break
            case 'week':
                start.setDate(now.getDate() - now.getDay())
                start.setHours(0, 0, 0, 0)
                break
            case 'month':
                start.setDate(1)
                start.setHours(0, 0, 0, 0)
                break
            case 'year':
                start.setMonth(0, 1)
                start.setHours(0, 0, 0, 0)
                break
            default:
                onChange({ start: '', end: '' })
                setIsOpen(false)
                return
        }
        onChange({ start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] })
        setIsOpen(false)
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen) }}
                className="btn-pill flex items-center gap-2"
            >
                <Calendar size={14} className="text-primary" />
                <span className="text-xs">{label}</span>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[99]" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full mt-2 left-0 w-72 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl z-[100] overflow-hidden animate-fade-in">
                        <div className="p-2 border-b border-[var(--border)] grid grid-cols-3 gap-1">
                            {['today', 'week', 'month', 'year'].map(p => (
                                <button
                                    key={p}
                                    onClick={() => applyPreset(p)}
                                    className="p-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 rounded-lg transition-all text-center"
                                >
                                    {p === 'today' ? 'Hoje' : p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
                                </button>
                            ))}
                            <button
                                onClick={() => applyPreset('clear')}
                                className="p-2 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-400/10 rounded-lg transition-all text-center"
                            >
                                Limpar
                            </button>
                        </div>

                        <div className="px-3 pt-3 pb-1">
                            <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{curYear}</p>
                        </div>
                        <div className="px-2 pb-3 grid grid-cols-6 gap-1">
                            {MONTH_NAMES.map((name, i) => {
                                const { start: firstDay, end: lastDay } = monthRange(curYear, i)
                                const isActive = value.start === firstDay
                                const isCurrent = i === curMonth
                                const isFuture = i > curMonth
                                return (
                                    <button
                                        key={i}
                                        disabled={isFuture}
                                        onClick={() => { onChange({ start: firstDay, end: lastDay }); setIsOpen(false) }}
                                        className={`py-1.5 text-[10px] font-bold rounded-lg transition-all text-center
                                        ${isActive ? 'bg-primary text-white shadow-lg shadow-primary/30' :
                                                isCurrent ? 'border border-primary/40 text-primary hover:bg-primary/10' :
                                                    isFuture ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed' :
                                                        'text-[var(--text-muted)] hover:text-primary hover:bg-primary/5'}`}
                                    >
                                        {name}
                                    </button>
                                )
                            })}
                        </div>

                        <div className="p-3 border-t border-[var(--border)] space-y-2">
                            <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Personalizado</p>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[9px] text-[var(--text-muted)] pl-1">Início</span>
                                    <input
                                        type="date"
                                        className={`bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg p-1.5 text-xs focus:outline-none focus:border-primary text-[var(--text-main)] ${isDarkMode ? '[color-scheme:dark]' : '[color-scheme:light]'}`}
                                        value={value.start}
                                        onChange={(e) => onChange({ ...value, start: e.target.value })}
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-[9px] text-[var(--text-muted)] pl-1">Fim</span>
                                    <input
                                        type="date"
                                        className={`bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg p-1.5 text-xs focus:outline-none focus:border-primary text-[var(--text-main)] ${isDarkMode ? '[color-scheme:dark]' : '[color-scheme:light]'}`}
                                        value={value.end}
                                        onChange={(e) => onChange({ ...value, end: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
