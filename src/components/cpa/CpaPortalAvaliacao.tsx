// Avaliação CPA dentro do Portal do Aluno. O cartão aparece no painel só quando há formulário com
// o Portal ligado (portal_ativo, ligado pela equipe no painel da CPA). Sem nada ligado, não renderiza
// nada e nem chama o Sponte.
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Check, Loader2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { extractFnErrorMessage } from "@/utils/functionsError"
import { Button } from "@/components/ui/button"
import { CpaFormFlow, Bloco, Formulario, Pergunta, RespostaEnvio } from "./CpaFormPage"

type Pendencias = {
    geral: { formulario_id: number; titulo: string; nivel: string; respondida: boolean } | null
    disciplinas: { formulario_id: number; contexto: string; disciplina: string; turma: string; respondida: boolean }[]
}
type Alvo = { formulario_id: number; contexto: string; titulo: string }

async function portal<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke("cpa-portal", { body })
    if (error) throw new Error(await extractFnErrorMessage(error, "Não foi possível carregar a avaliação."))
    return data as T
}

export function CpaPortalCard() {
    const qc = useQueryClient()
    const [alvo, setAlvo] = useState<Alvo | null>(null)
    const { data } = useQuery({
        queryKey: ["cpa-portal-pendencias"],
        queryFn: () => portal<Pendencias>({ action: "pendencias" }),
        staleTime: 5 * 60_000,
        retry: false,
    })

    const itens = [
        ...(data?.geral ? [{ formulario_id: data.geral.formulario_id, contexto: "", titulo: `Avaliação institucional (${data.geral.nivel === "pos" ? "pós" : "graduação"})`, detalhe: "Sua opinião sobre a FICV", respondida: data.geral.respondida }] : []),
        ...(data?.disciplinas ?? []).map((d) => ({ formulario_id: d.formulario_id, contexto: d.contexto, titulo: d.disciplina, detalhe: d.turma, respondida: d.respondida })),
    ]
    if (!itens.length) return null

    const pendentes = itens.filter((i) => !i.respondida).length

    return (
        <section className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <ClipboardCheck className="h-4 w-4 text-primary" /> Avaliações
                </h2>
                <span className="text-xs text-muted-foreground">{pendentes ? `${pendentes} pendente(s)` : "Tudo respondido"}</span>
            </div>
            <ul className="space-y-2">
                {itens.map((i) => (
                    <li key={`${i.formulario_id}|${i.contexto}`}>
                        <button
                            type="button" disabled={i.respondida}
                            onClick={() => setAlvo({ formulario_id: i.formulario_id, contexto: i.contexto, titulo: i.titulo })}
                            className="flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--bg-card-hover)] px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--bg-card)] disabled:opacity-60"
                        >
                            <span className="min-w-0">
                                <span className="block truncate font-medium">{i.titulo}</span>
                                <span className="block truncate text-xs text-muted-foreground">{i.detalhe}</span>
                            </span>
                            {i.respondida
                                ? <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" /> Respondida</span>
                                : <span className="shrink-0 text-xs font-medium text-primary">Responder</span>}
                        </button>
                    </li>
                ))}
            </ul>
            {alvo && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
                    <button type="button" aria-label="Fechar" onClick={() => { setAlvo(null); qc.invalidateQueries({ queryKey: ["cpa-portal-pendencias"] }) }}
                        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                        <X className="h-4 w-4" />
                    </button>
                    <CpaPortalAvaliacao key={`${alvo.formulario_id}|${alvo.contexto}`} formulario_id={alvo.formulario_id} contexto={alvo.contexto} />
                </div>
            )}
        </section>
    )
}

function CpaPortalAvaliacao({ formulario_id, contexto }: { formulario_id: number; contexto: string }) {
    const { data, error, isLoading } = useQuery({
        queryKey: ["cpa-portal-form", formulario_id, contexto],
        queryFn: () => portal<{ formulario: Formulario; blocos: Bloco[]; perguntas: Pergunta[] }>({ action: "form", formulario_id, contexto }),
        retry: false,
    })
    if (isLoading) return <div className="flex h-dvh items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    if (error || !data) return <div className="flex h-dvh items-center justify-center p-6 text-center text-sm text-muted-foreground">{(error as Error)?.message ?? "Avaliação indisponível."}</div>

    return (
        <CpaFormFlow
            formulario={data.formulario} blocos={data.blocos} perguntas={data.perguntas}
            storageKey={`cpa_portal_${formulario_id}_${contexto}`}
            enviar={async (valores): Promise<RespostaEnvio> => {
                const { data: d, error: e } = await supabase.functions.invoke("cpa-portal", {
                    body: { action: "submit", formulario_id, contexto, respostas: valores },
                })
                if (e) return { error: await extractFnErrorMessage(e, "Não foi possível enviar.") }
                return d as RespostaEnvio
            }}
        />
    )
}
