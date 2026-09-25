/**
 * KbAskPanel — "Consultar a Base" para atendentes (chat do lead no Kanban, chamado do
 * Portal, tela da Base de Conhecimento). Pergunta livre ou "Sugerir resposta" (usa a
 * conversa); a IA só REDIGE — o atendente insere na mensagem ou copia e decide enviar.
 * Backend: edge function kb-ask.
 */
import { useState } from "react"
import { BookOpen, Check, Copy, CornerDownLeft, Loader2, Sparkles } from "lucide-react"
import { supabase } from "@/lib/supabase"

export interface KbConversaMsg { de: "cliente" | "atendente"; texto: string }
interface Result { resposta: string; encontrado: boolean; fontes: { titulo: string; trecho: string; similaridade: number }[] }

export function KbAskPanel({ publico = "todos", conversa, contexto, onInsert }: {
    publico?: "vendas" | "alunos" | "todos"
    conversa?: KbConversaMsg[]
    contexto?: { nome?: string | null; curso?: string | null }
    onInsert?: (texto: string) => void
}) {
    const [pergunta, setPergunta] = useState("")
    const [loading, setLoading] = useState(false)
    const [res, setRes] = useState<Result | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [copiado, setCopiado] = useState(false)
    const temConversa = (conversa ?? []).some((m) => m.de === "cliente")

    const ask = async (sugerir: boolean) => {
        if (!sugerir && !pergunta.trim()) return
        setLoading(true); setErro(null); setRes(null)
        const { data, error } = await supabase.functions.invoke("kb-ask", {
            body: { pergunta: sugerir ? "" : pergunta.trim(), conversa: conversa ?? [], publico, contexto },
        })
        setLoading(false)
        if (error || data?.error) {
            const ctx = error ? await (error as any).context?.json?.().catch(() => null) : null
            setErro(data?.error ?? ctx?.error ?? "Não foi possível consultar agora.")
            return
        }
        setRes(data)
    }
    const copiar = async () => {
        if (!res) return
        await navigator.clipboard.writeText(res.resposta)
        setCopiado(true); setTimeout(() => setCopiado(false), 1500)
    }

    return (
        <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" /> Consultar a Base de Conhecimento
            </div>
            <div className="flex gap-2">
                <input value={pergunta} onChange={(e) => setPergunta(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") ask(false) }}
                    placeholder="Ex: valor da pós em Psicoteologia? duração do curso?"
                    className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-primary" />
                <button onClick={() => ask(false)} disabled={loading || !pergunta.trim()}
                    className="shrink-0 rounded-lg bg-primary px-3 text-white text-xs font-semibold disabled:opacity-50">Buscar</button>
            </div>
            {temConversa && (
                <button onClick={() => ask(true)} disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
                    <Sparkles className="h-3.5 w-3.5" /> Sugerir resposta para a última mensagem
                </button>
            )}

            {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando a base…</div>}
            {erro && <p className="text-xs text-red-500">{erro}</p>}

            {res && (
                <div className="space-y-2">
                    <div className={`rounded-lg border p-3 whitespace-pre-wrap leading-relaxed ${res.encontrado ? "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-main)]" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                        {res.resposta || "Sem resposta."}
                    </div>
                    {res.encontrado && (
                        <div className="flex gap-2">
                            {onInsert && (
                                <button onClick={() => onInsert(res.resposta)}
                                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-white">
                                    <CornerDownLeft className="h-3.5 w-3.5" /> Inserir na mensagem
                                </button>
                            )}
                            <button onClick={copiar}
                                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text-main)]">
                                {copiado ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />} {copiado ? "Copiado" : "Copiar"}
                            </button>
                        </div>
                    )}
                    {res.fontes.length > 0 && (
                        <details className="text-[11px] text-muted-foreground">
                            <summary className="cursor-pointer">Fontes ({res.fontes.length})</summary>
                            <ul className="mt-1 space-y-1.5">
                                {res.fontes.map((f, i) => (
                                    <li key={i} className="rounded border border-[var(--border)] p-2">
                                        <b className="text-[var(--text-main)]">{f.titulo}</b> · {f.similaridade}%
                                        <p className="line-clamp-3 mt-0.5">{f.trecho}</p>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                    <p className="text-[10px] text-muted-foreground">Confira antes de enviar — a resposta vem só da Base de Conhecimento.</p>
                </div>
            )}
        </div>
    )
}
