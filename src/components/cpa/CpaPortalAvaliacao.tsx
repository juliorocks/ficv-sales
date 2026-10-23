// Avaliação CPA dentro do Portal do Aluno. O cartão aparece no painel só quando há formulário com
// o Portal ligado (portal_ativo, ligado pela equipe no painel da CPA). Sem nada ligado, não renderiza
// nada e nem chama o Sponte.
// O aluno responde tudo de uma vez: a avaliação geral e cada disciplina pendente, em sequência, cada
// uma separada por uma tela de título. Cada parte é gravada à parte (uma resposta por formulário/disciplina).
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Check, Loader2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { extractFnErrorMessage } from "@/utils/functionsError"
import { AvatarDocente, Btn } from "./cpaUi"
import { CpaFormFlow, Bloco, Formulario, Pergunta, Resultado, RespostaEnvio } from "./CpaFormPage"

type Pendencias = {
    geral: { formulario_id: number; titulo: string; nivel: string; respondida: boolean } | null
    disciplinas: { formulario_id: number; contexto: string; disciplina: string; turma: string; docente: string | null; docente_foto: string | null; respondida: boolean }[]
}
type Item = { formulario_id: number; contexto: string; titulo: string; detalhe: string; foto?: string | null; respondida: boolean }

const TINTA = "#13161D"

async function portal<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke("cpa-portal", { body })
    if (error) throw new Error(await extractFnErrorMessage(error, "Não foi possível carregar a avaliação."))
    return data as T
}

export function CpaPortalCard() {
    const qc = useQueryClient()
    const [fila, setFila] = useState<Item[] | null>(null)
    const { data } = useQuery({
        queryKey: ["cpa-portal-pendencias"],
        queryFn: () => portal<Pendencias>({ action: "pendencias" }),
        staleTime: 5 * 60_000,
        retry: false,
    })

    const itens: Item[] = [
        ...(data?.geral ? [{ formulario_id: data.geral.formulario_id, contexto: "", titulo: `Avaliação institucional (${data.geral.nivel === "pos" ? "pós" : "graduação"})`, detalhe: "Sua opinião sobre a FICV", respondida: data.geral.respondida }] : []),
        ...(data?.disciplinas ?? []).map((d) => ({ formulario_id: d.formulario_id, contexto: d.contexto, titulo: d.disciplina, detalhe: d.docente ? `${d.turma} · Prof. ${d.docente}` : d.turma, foto: d.docente_foto, respondida: d.respondida })),
    ]
    const pendentes = itens.filter((i) => !i.respondida)

    // o link único /avaliacao abre a fila direto, depois do login
    const veioDoLink = window.location.pathname.replace(/\/+$/, "") === "/avaliacao"
    const [abriuSozinho, setAbriuSozinho] = useState(false)
    useEffect(() => {
        if (veioDoLink && !abriuSozinho && data && pendentes.length) { setFila(pendentes); setAbriuSozinho(true) }
    }, [veioDoLink, abriuSozinho, data, pendentes.length]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!itens.length) {
        return veioDoLink && data ? (
            <section className="glass-card p-6 text-center text-sm text-[var(--text-muted)]">Não há avaliações abertas para você no momento.</section>
        ) : null
    }


    function fechar() {
        setFila(null)
        qc.invalidateQueries({ queryKey: ["cpa-portal-pendencias"] })
    }

    return (
        <section className="glass-card space-y-4 p-6">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <ClipboardCheck className="h-4 w-4 text-primary" /> Avaliações
                </h2>
                <span className="text-xs text-[var(--text-muted)]">{pendentes.length ? `${pendentes.length} pendente(s)` : "Tudo respondido"}</span>
            </div>
            {pendentes.length > 0 && (
                <Btn size="lg" className="h-12 w-full text-sm" style={{ background: TINTA }} onClick={() => setFila(pendentes)}>
                    Responder {pendentes.length > 1 ? `todas (${pendentes.length})` : "agora"}
                </Btn>
            )}
            <ul className="space-y-2">
                {itens.map((i) => (
                    <li key={`${i.formulario_id}|${i.contexto}`}>
                        <div className="flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--bg-card-hover)] px-4 py-3 text-sm">
                            {i.foto !== undefined && <AvatarDocente src={i.foto} nome={i.detalhe} tamanho={36} />}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{i.titulo}</span>
                                <span className="block truncate text-xs text-[var(--text-muted)]">{i.detalhe}</span>
                            </span>
                            {i.respondida
                                ? <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" /> Respondida</span>
                                : <button type="button" onClick={() => setFila([i])} className="shrink-0 text-xs font-semibold text-primary">Responder</button>}
                        </div>
                    </li>
                ))}
            </ul>
            {fila && (
                <div className="fixed inset-x-0 top-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 overflow-y-auto bg-background sm:bottom-0">
                    <button type="button" aria-label="Fechar" onClick={fechar}
                        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                        <X className="h-4 w-4" />
                    </button>
                    <CpaFila itens={fila} onFechar={fechar} />
                </div>
            )}
        </section>
    )
}

// Sequência de avaliações: título de cada parte, a avaliação, e no fim a lista de comprovantes.
function CpaFila({ itens, onFechar }: { itens: Item[]; onFechar: () => void }) {
    const [i, setI] = useState(0)
    const [transicao, setTransicao] = useState(true)
    const [comprovantes, setComprovantes] = useState<Resultado[]>([])

    if (i >= itens.length) return <Conclusao comprovantes={comprovantes} onFechar={onFechar} />

    const atual = itens[i]
    if (transicao) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#A07E2A]">Parte {i + 1} de {itens.length}</p>
                <h2 className="mt-3 text-2xl font-bold">{atual.titulo}</h2>
                {atual.foto !== undefined && <div className="mt-6"><AvatarDocente src={atual.foto} nome={atual.detalhe} tamanho={88} /></div>}
                <p className="mt-3 text-sm text-[var(--text-muted)]">{atual.detalhe}</p>
                <Btn size="lg" className="mt-8 h-12 w-full max-w-sm text-sm" style={{ background: TINTA }} onClick={() => setTransicao(false)}>Começar</Btn>
            </div>
        )
    }

    return (
        <CpaPortalAvaliacao
            key={`${atual.formulario_id}|${atual.contexto}`}
            formulario_id={atual.formulario_id}
            contexto={atual.contexto}
            aoConcluir={(r) => {
                setComprovantes((c) => [...c, r])
                setI(i + 1)
                setTransicao(true)
            }}
        />
    )
}

function Conclusao({ comprovantes, onFechar }: { comprovantes: Resultado[]; onFechar: () => void }) {
    return (
        <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center space-y-5 px-6 py-8 text-center">
            <h2 className="text-2xl font-bold">Obrigado por participar!</h2>
            <p className="text-sm text-[var(--text-muted)]">Suas respostas foram registradas de forma anônima.</p>
            <div className="w-full space-y-2 text-left">
                {comprovantes.map((r, k) => (
                    <div key={k} className="glass-card p-4">
                        <p className="text-sm font-semibold">{r.disciplina ?? r.formulario ?? "Avaliação"}</p>
                        <p className="break-all font-mono text-[10px] text-[var(--text-muted)]">{r.comprovante}</p>
                    </div>
                ))}
            </div>
            <Btn size="lg" className="h-12 w-full text-sm" style={{ background: TINTA }} onClick={onFechar}>Voltar ao painel</Btn>
        </div>
    )
}

function CpaPortalAvaliacao({ formulario_id, contexto, aoConcluir }: { formulario_id: number; contexto: string; aoConcluir: (r: Resultado) => void }) {
    const { data, error, isLoading } = useQuery({
        queryKey: ["cpa-portal-form", formulario_id, contexto],
        queryFn: () => portal<{ formulario: Formulario; blocos: Bloco[]; perguntas: Pergunta[] }>({ action: "form", formulario_id, contexto }),
        retry: false,
    })
    if (isLoading) return <div className="flex h-dvh items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    if (error || !data) return <div className="flex h-dvh items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">{(error as Error)?.message ?? "Avaliação indisponível."}</div>

    return (
        <CpaFormFlow
            formulario={data.formulario} blocos={data.blocos} perguntas={data.perguntas}
            storageKey={`cpa_portal_${formulario_id}_${contexto}`}
            aoConcluir={aoConcluir}
            pularIntro
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
