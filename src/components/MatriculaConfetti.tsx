/**
 * MatriculaConfetti — comemora ao vivo quando a sincronização automática do Sponte confirma
 * uma matrícula nova (sync_leads_matriculado_from_sponte, cron). Escuta INSERT em lead_history
 * especificamente com to_stage_id = Matriculado — essa tabela só recebe linha de rotinas
 * automáticas (nunca de edição manual no Kanban), então só dispara pro caso real pedido pelo
 * usuário 08/10: "a cada atualização de verificação de nova matrícula no Sponte".
 * Fica montado uma vez em FullApp (como o Toaster), pra pegar em qualquer tela.
 */
import { useEffect, useState } from 'react'
import confetti from 'canvas-confetti'
import { GraduationCap, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isConfettiEnabled } from '../lib/confettiPrefs'

interface Celebracao { nome: string; curso: string | null }

function burst() {
    confetti({ particleCount: 120, spread: 80, startVelocity: 45, origin: { x: 0.2, y: 0.7 }, zIndex: 9999 })
    confetti({ particleCount: 120, spread: 80, startVelocity: 45, origin: { x: 0.8, y: 0.7 }, zIndex: 9999 })
    setTimeout(() => confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 }, zIndex: 9999 }), 180)
}

export function MatriculaConfetti() {
    const [fila, setFila] = useState<Celebracao[]>([])

    useEffect(() => {
        let cancelled = false
        let channel: ReturnType<typeof supabase.channel> | null = null

        ;(async () => {
            const { data: stage } = await supabase.from('stages').select('id').ilike('name', '%matricul%').order('order', { ascending: true }).limit(1).maybeSingle()
            if (cancelled || !stage?.id) return

            channel = supabase
                .channel('matricula-confetti')
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'lead_history', filter: `to_stage_id=eq.${stage.id}` },
                    async (payload) => {
                        if (!isConfettiEnabled()) return
                        const leadId = (payload.new as any)?.lead_id
                        if (!leadId) return
                        const { data: lead } = await supabase.from('leads').select('nome_completo, curso_interesse_nome').eq('id', leadId).maybeSingle()
                        if (cancelled) return
                        burst()
                        const item: Celebracao = { nome: lead?.nome_completo?.trim() || 'Novo aluno', curso: lead?.curso_interesse_nome ?? null }
                        setFila((f) => [...f, item])
                        setTimeout(() => setFila((f) => f.filter((x) => x !== item)), 7000)
                    },
                )
                .subscribe()
        })()

        return () => {
            cancelled = true
            if (channel) supabase.removeChannel(channel)
        }
    }, [])

    if (fila.length === 0) return null
    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] flex flex-col items-center gap-2 pointer-events-none px-4 w-full sm:w-auto">
            {fila.map((c, i) => (
                <div key={i} className="pointer-events-auto glass-card border border-[var(--border)] shadow-lg shadow-black/20 rounded-2xl px-4 py-3 flex items-center gap-3 max-w-sm sm:max-w-md animate-in fade-in slide-in-from-top-2">
                    <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 text-lg">🎉</div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[var(--text-main)] leading-snug">Nova matrícula confirmada!</p>
                        <p className="text-xs text-[var(--text-muted)] leading-snug flex items-center gap-1 mt-0.5">
                            <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate"><b className="text-[var(--text-main)]">{c.nome}</b>{c.curso ? ` — ${c.curso}` : ''}</span>
                        </p>
                    </div>
                    <button
                        onClick={() => setFila((f) => f.filter((x) => x !== c))}
                        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                        aria-label="Fechar"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
    )
}
