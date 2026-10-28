// Avaliação CPA dentro do Portal do Aluno. O cartão aparece no painel só quando há formulário com
// o Portal ligado (portal_ativo, ligado pela equipe no painel da CPA). Sem nada ligado, não renderiza
// nada e nem chama o Sponte.
// O aluno responde tudo de uma vez: a avaliação geral e cada disciplina pendente, em sequência, cada
// uma separada por uma tela de título. Cada parte é gravada à parte (uma resposta por formulário/disciplina).
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Check, ChevronDown, Loader2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { extractFnErrorMessage } from "@/utils/functionsError"
import { AvatarDocente, Btn } from "./cpaUi"
import { CpaFormFlow, Bloco, Formulario, Pergunta, Resultado, RespostaEnvio } from "./CpaFormPage"

type Pendencias = {
    oficial?: boolean
    geral: { formulario_id: number; titulo: string; nivel: string; respondida: boolean } | null
    disciplinas: { formulario_id: number; contexto: string; disciplina: string; turma: string; docente: string | null; docente_foto: string | null; respondida: boolean }[]
}
type Item = { formulario_id: number; contexto: string; titulo: string; detalhe: string; foto?: string | null; respondida: boolean }

const TINTA = "#13161D"

// o popup abre sozinho uma vez a cada carregamento da página (atualizou, abre de novo), enquanto houver
// avaliação oficial pendente; sem opção de "não mostrar mais"
let abriuNestaPagina = false

function textoAvaliacao(geral: boolean, disciplinas: number): string {
    const disc = `${disciplinas} ${disciplinas === 1 ? "disciplina" : "disciplinas"} deste semestre`
    if (geral && disciplinas) return `Você vai avaliar a instituição e ${disc}, tudo em sequência.`
    if (disciplinas) return `Você vai avaliar ${disc}, em sequência.`
    return "Você vai avaliar a instituição."
}

async function portal<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke("cpa-portal", { body })
    if (error) throw new Error(await extractFnErrorMessage(error, "Não foi possível carregar a avaliação."))
    return data as T
}

export function CpaPortalCard() {
    const qc = useQueryClient()
    const [fila, setFila] = useState<Item[] | null>(null)
    const [minhas, setMinhas] = useState(false)
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
        if (!data || !pendentes.length || abriuSozinho) return
        if (veioDoLink) { setFila(pendentes); setAbriuSozinho(true) }
        else if (data.oficial && !abriuNestaPagina) { abriuNestaPagina = true; setFila(pendentes); setAbriuSozinho(true) }
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

    const jaRespondeu = itens.some((i) => i.respondida)
    const minhasBotao = jaRespondeu && (
        <button type="button" onClick={() => setMinhas(true)}
            className="glass-card flex w-full items-center gap-3 p-4 text-left text-sm font-semibold">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Minhas avaliações da CPA
            <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">ver o que respondi</span>
        </button>
    )

    // respondeu tudo: nem banner nem popup (a fila aberta se mantém até o aluno ver os comprovantes)
    if (!pendentes.length && !fila) {
        return (
            <>
                {veioDoLink && <section className="glass-card p-6 text-center text-sm text-[var(--text-muted)]">Você já respondeu todas as avaliações. Obrigado!</section>}
                {minhasBotao}
                {minhas && <MinhasAvaliacoes onFechar={() => setMinhas(false)} />}
            </>
        )
    }

    const disciplinasPendentes = pendentes.filter((i) => i.contexto !== "").length
    const geralPendente = pendentes.some((i) => i.contexto === "")

    return (
        <>
            {minhasBotao}
            {minhas && <MinhasAvaliacoes onFechar={() => setMinhas(false)} />}
            {fila && createPortal(
                <div className="fixed inset-x-0 top-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 overflow-hidden bg-background sm:bottom-0">
                    <button type="button" aria-label="Fechar" onClick={fechar}
                        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                        <X className="h-4 w-4" />
                    </button>
                    <CpaFila itens={fila} onFechar={fechar} />
                </div>,
                document.body,
            )}
        </>
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
            <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 text-center">
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
        <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center space-y-5 overflow-y-auto px-6 py-8 text-center">
            <h2 className="text-2xl font-bold">Obrigado por participar!</h2>
            <p className="text-sm text-[var(--text-muted)]">Suas respostas foram registradas.</p>
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
    if (isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    if (error || !data) return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">{(error as Error)?.message ?? "Avaliação indisponível."}</div>

    return (
        <CpaFormFlow
            formulario={data.formulario} blocos={data.blocos} perguntas={data.perguntas}
            storageKey={`cpa_portal_${formulario_id}_${contexto}`}
            aoConcluir={aoConcluir}
            pularIntro
            embutido
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

type MinhaAvaliacao = {
    formulario_id: number; titulo: string; tipo: string; teste: boolean; protocolo: number | null; comprovante: string; respondido_em: string
    disciplina: string | null; turma: string | null; docente: string | null
    respostas: { pergunta: string; tipo: string; valor: string | number; escala_max: number | null }[]
}

// O aluno revê o que respondeu (a participação guarda aluno e resposta).
function MinhasAvaliacoes({ onFechar }: { onFechar: () => void }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ["cpa-portal-minhas"],
        queryFn: () => portal<{ avaliacoes: MinhaAvaliacao[] }>({ action: "minhas" }),
        retry: false,
    })
    const [aberta, setAberta] = useState<number | null>(null)
    const lista = data?.avaliacoes ?? []
    return createPortal(
        <div className="fixed inset-x-0 top-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 overflow-y-auto bg-background sm:bottom-0">
            <button type="button" aria-label="Fechar" onClick={onFechar} className="fixed right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <X className="h-4 w-4" />
            </button>
            <div className="mx-auto max-w-2xl space-y-3 px-5 py-8">
                <h2 className="text-2xl font-bold">Minhas avaliações</h2>
                <p className="text-sm text-[var(--text-muted)]">O que você respondeu na avaliação da CPA.</p>
                {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
                {error && <p className="text-sm text-[var(--text-muted)]">{(error as Error).message}</p>}
                {!isLoading && !error && !lista.length && <p className="glass-card p-5 text-sm text-[var(--text-muted)]">Nenhuma avaliação sua encontrada ainda.</p>}
                {lista.map((a, k) => (
                    <div key={k} className="glass-card overflow-hidden">
                        <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setAberta(aberta === k ? null : k)}>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{a.disciplina ?? "Avaliação institucional"}{a.teste ? " (teste)" : ""}</p>
                                <p className="truncate text-xs text-[var(--text-muted)]">
                                    {[a.turma, a.docente ? `Prof. ${a.docente}` : null, new Date(a.respondido_em).toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")}
                                </p>
                            </div>
                            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${aberta === k ? "rotate-180" : ""}`} />
                        </button>
                        {aberta === k && (
                            <div className="space-y-3 border-t border-[var(--border)] p-4">
                                {a.respostas.map((r, i) => (
                                    <div key={i} className="text-sm">
                                        <p className="text-[var(--text-muted)]">{r.pergunta}</p>
                                        <p className="font-semibold">{r.tipo === "escala" ? `${r.valor}${r.escala_max !== null ? ` de ${r.escala_max}` : ""}` : String(r.valor)}</p>
                                    </div>
                                ))}
                                <p className="break-all border-t border-[var(--border)] pt-3 font-mono text-[10px] text-[var(--text-muted)]">
                                    {a.protocolo ? `Protocolo ${a.protocolo} · ` : ""}Comprovante {a.comprovante}
                                </p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>,
        document.body,
    )
}
