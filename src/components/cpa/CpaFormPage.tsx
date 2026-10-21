// Avaliação CPA — formulário (um passo por tela, estilo Typeform, pensado pro celular).
// Dois usos: o link público (/avaliacao/:token, CpaFormPage) e a avaliação dentro do Portal do Aluno
// (CpaPortalAvaliacao). Os dois passam pelo mesmo núcleo, CpaFormFlow, que recebe os dados prontos e
// a função de envio. Pausas entre blocos com a frase de incentivo do banco; rascunho no aparelho.
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronLeft, Copy, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cpa-form`

export type Pergunta = {
    id: number; bloco_id: number; ordem: number; texto: string
    tipo: "escala" | "escolha" | "texto"
    escala_min: number | null; escala_max: number | null
    rotulo_min: string | null; rotulo_max: string | null
    opcoes: string[]; obrigatoria: boolean; chave: string | null
}
export type Bloco = { id: number; ordem: number; titulo: string; incentivo: string | null }
export type Formulario = { id: number; nivel: string; titulo: string; ano: number; intro: string | null; teste: boolean; curso?: string }
export type Resultado = { ok: true; teste: boolean; protocolo: number | null; comprovante: string }
export type RespostaEnvio = Resultado | { error: string; pergunta_id?: number }

type Passo =
    | { tipo: "intro" }
    | { tipo: "pergunta"; pergunta: Pergunta; indice: number }
    | { tipo: "pausa"; texto: string }

function montarPassos(blocos: Bloco[], perguntas: Pergunta[]): Passo[] {
    const passos: Passo[] = [{ tipo: "intro" }]
    let indice = 0
    blocos.forEach((b, i) => {
        perguntas.filter((p) => p.bloco_id === b.id).forEach((p) => {
            indice++
            passos.push({ tipo: "pergunta", pergunta: p, indice })
        })
        if (b.incentivo && i < blocos.length - 1) passos.push({ tipo: "pausa", texto: b.incentivo })
    })
    return passos
}

// frase de ânimo conforme o avanço (fração de perguntas já respondidas)
function frasePorProgresso(frac: number): string {
    if (frac < 0.25) return "Ótimo começo!"
    if (frac < 0.5) return "Você está indo bem!"
    if (frac < 0.75) return "Metade do caminho, continue assim!"
    if (frac < 1) return "Estamos quase lá!"
    return "Última pergunta!"
}

// Usado pelo link público: carrega pelo token e envia pelo token.
export function CpaFormPage() {
    const { token = "" } = useParams<{ token: string }>()
    const [dados, setDados] = useState<{ formulario: Formulario; blocos: Bloco[]; perguntas: Pergunta[] } | null>(null)
    const [indisponivel, setIndisponivel] = useState<string | null>(null)

    useEffect(() => {
        fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", token }) })
            .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
            .then(({ ok, d }) => (ok ? setDados(d) : setIndisponivel(d.error ?? "Esta avaliação não está disponível.")))
            .catch(() => setIndisponivel("Não foi possível carregar a avaliação. Verifique sua conexão."))
    }, [token])

    if (indisponivel) return <Tela><Aviso texto={indisponivel} /></Tela>
    if (!dados) return <Tela><Loader2 className="h-8 w-8 animate-spin text-primary" /></Tela>

    return (
        <CpaFormFlow
            formulario={dados.formulario} blocos={dados.blocos} perguntas={dados.perguntas}
            storageKey={`cpa_rascunho_${token}`}
            enviar={async (valores) => {
                const r = await fetch(FN_URL, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "submit", token, respostas: valores }),
                })
                return r.json()
            }}
        />
    )
}

export function CpaFormFlow({ formulario, blocos, perguntas, storageKey, enviar: enviarRemoto }: {
    formulario: Formulario
    blocos: Bloco[]
    perguntas: Pergunta[]
    storageKey: string
    enviar: (valores: Record<string, number | string>) => Promise<RespostaEnvio>
}) {
    const [pos, setPos] = useState(0)
    const [respostas, setRespostas] = useState<Record<string, number | string>>({})
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)
    const [resultado, setResultado] = useState<Resultado | null>(null)
    const [copiado, setCopiado] = useState(false)

    // restaura o rascunho uma vez (no aparelho; nada vai pro servidor até enviar)
    useEffect(() => {
        try {
            const salvo = JSON.parse(localStorage.getItem(storageKey) ?? "null")
            if (salvo?.respostas) setRespostas(salvo.respostas)
            if (typeof salvo?.pos === "number") setPos(salvo.pos)
        } catch { /* sem localStorage: segue sem rascunho */ }
    }, [storageKey])

    const passos = useMemo(() => montarPassos(blocos, perguntas), [blocos, perguntas])
    const total = perguntas.length
    const passo = passos[pos]

    useEffect(() => {
        if (resultado) return
        try { localStorage.setItem(storageKey, JSON.stringify({ respostas, pos })) } catch { /* ignora */ }
    }, [respostas, pos, storageKey, resultado])

    async function enviar(valores: Record<string, number | string>) {
        setEnviando(true)
        setErro(null)
        try {
            const d = await enviarRemoto(valores)
            if ("error" in d) {
                setErro(d.error)
                if (d.pergunta_id) {
                    const idx = passos.findIndex((x) => x.tipo === "pergunta" && x.pergunta.id === d.pergunta_id)
                    if (idx >= 0) setPos(idx)
                }
                return
            }
            setResultado(d)
            try { localStorage.removeItem(storageKey) } catch { /* ignora */ }
        } catch {
            setErro("Sem conexão. Suas respostas continuam salvas neste aparelho: tente enviar de novo.")
        } finally {
            setEnviando(false)
        }
    }

    // avança; depois da última pergunta, envia
    function avancar(de: number, valores = respostas) {
        if (de + 1 >= passos.length) return enviar(valores)
        setPos(de + 1)
    }

    function responder(p: Pergunta, valor: number | string) {
        const novas = { ...respostas, [p.id]: valor }
        setRespostas(novas)
        if (p.tipo !== "texto") setTimeout(() => avancar(pos, novas), 260)
    }

    if (resultado) {
        return (
            <Tela>
                <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md text-center space-y-5">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-8 w-8" />
                    </div>
                    <h1 className="text-2xl font-bold">Obrigado por participar!</h1>
                    <p className="text-sm text-muted-foreground">
                        {resultado.teste
                            ? "Resposta de teste registrada. Ela não entra nos relatórios oficiais."
                            : "Sua avaliação foi registrada de forma anônima."}
                    </p>
                    <div className="rounded-xl border bg-card p-4 text-left space-y-2">
                        {!resultado.teste && resultado.protocolo !== null && (
                            <p className="text-xs text-muted-foreground">Protocolo nº <span className="font-mono font-semibold text-foreground">{resultado.protocolo}</span></p>
                        )}
                        <p className="text-xs text-muted-foreground">Código de comprovante</p>
                        <p className="break-all font-mono text-[11px] leading-relaxed">{resultado.comprovante}</p>
                        <Button
                            variant="outline" size="sm" className="w-full"
                            onClick={() => { navigator.clipboard?.writeText(resultado.comprovante); setCopiado(true) }}
                        >
                            {copiado ? <><Check className="mr-2 h-4 w-4" /> Copiado</> : <><Copy className="mr-2 h-4 w-4" /> Copiar código</>}
                        </Button>
                    </div>
                </motion.div>
            </Tela>
        )
    }

    const respondidas = perguntas.filter((p) => respostas[p.id] !== undefined && respostas[p.id] !== "").length
    const fracao = total ? Math.min(1, (passo?.tipo === "pergunta" ? passo.indice : total) / total) : 0
    const ultimoPasso = pos === passos.length - 1

    return (
        <div className="min-h-dvh bg-gradient-to-b from-primary/10 via-background to-background text-foreground">
            <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-5">
                <header className="flex items-center gap-3">
                    {pos > 0 && passo?.tipo !== "intro" ? (
                        <button
                            type="button" aria-label="Voltar" onClick={() => setPos(pos - 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                    ) : <div className="h-9 w-9" />}
                    <div className="flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <motion.div
                                className="h-full rounded-full bg-primary"
                                initial={false}
                                animate={{ width: `${Math.round(fracao * 100)}%` }}
                                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                            />
                        </div>
                    </div>
                    <span className="min-w-[3rem] text-right text-xs font-medium text-muted-foreground">
                        {passo?.tipo === "pergunta" ? `${passo.indice}/${total}` : ""}
                    </span>
                </header>

                {formulario.teste && (
                    <p className="mt-3 rounded-md bg-amber-100 px-3 py-1.5 text-center text-xs text-amber-900">
                        Modo teste: estas respostas não entram nos relatórios oficiais.
                    </p>
                )}

                <div className="flex flex-1 flex-col justify-center py-6">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={pos}
                            initial={{ opacity: 0, x: 28 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -28 }}
                            transition={{ duration: 0.22 }}
                        >
                            {passo?.tipo === "intro" && (
                                <div className="space-y-6">
                                    <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                                        <Sparkles className="h-3.5 w-3.5" /> {formulario.titulo} {formulario.ano}
                                    </div>
                                    <h1 className="text-2xl font-bold leading-tight">Sua opinião faz a diferença</h1>
                                    <p className="text-base text-muted-foreground">{formulario.intro}</p>
                                    {formulario.curso && <p className="text-sm font-medium">{formulario.curso}</p>}
                                    <p className="text-sm text-muted-foreground">
                                        São {total} perguntas. Toque na nota que melhor representa a sua experiência.
                                    </p>
                                    <Button size="lg" className="h-12 w-full text-base" onClick={() => setPos(1)}>Começar</Button>
                                </div>
                            )}

                            {passo?.tipo === "pausa" && (
                                <div className="space-y-6 text-center">
                                    <Sparkles className="mx-auto h-10 w-10 text-primary" />
                                    <p className="text-xl font-semibold">{passo.texto}</p>
                                    <Button size="lg" className="h-12 w-full text-base" onClick={() => setPos(pos + 1)}>Continuar</Button>
                                </div>
                            )}

                            {passo?.tipo === "pergunta" && (
                                <PerguntaView
                                    pergunta={passo.pergunta}
                                    valor={respostas[passo.pergunta.id]}
                                    ultima={ultimoPasso}
                                    enviando={enviando}
                                    onResponder={(v) => responder(passo.pergunta, v)}
                                    onContinuar={(v) => {
                                        const novas = { ...respostas, [passo.pergunta.id]: v }
                                        setRespostas(novas)
                                        avancar(pos, novas)
                                    }}
                                    frase={frasePorProgresso(respondidas / Math.max(total, 1))}
                                />
                            )}

                            {erro && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </div>
    )
}

function PerguntaView({ pergunta: p, valor, ultima, enviando, onResponder, onContinuar, frase }: {
    pergunta: Pergunta
    valor: number | string | undefined
    ultima: boolean
    enviando: boolean
    onResponder: (v: number | string) => void
    onContinuar: (valor: string) => void
    frase: string
}) {
    const [texto, setTexto] = useState(typeof valor === "string" ? valor : "")

    return (
        <div className="space-y-6">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">{frase}</p>
            <h2 className="text-xl font-semibold leading-snug">{p.texto}</h2>

            {p.tipo === "escala" && (
                <div className="space-y-3">
                    <div className="grid grid-cols-6 gap-2">
                        {Array.from({ length: (p.escala_max ?? 10) - (p.escala_min ?? 0) + 1 }, (_, i) => (p.escala_min ?? 0) + i).map((n) => {
                            const marcado = valor === n
                            return (
                                <button
                                    key={n} type="button" onClick={() => onResponder(n)} disabled={enviando}
                                    className={`h-12 rounded-xl border text-base font-semibold transition-all active:scale-95 ${
                                        marcado ? "scale-105 border-primary bg-primary text-primary-foreground shadow-md" : "bg-card hover:border-primary/60"
                                    }`}
                                >
                                    {n}
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{p.rotulo_min}</span><span>{p.rotulo_max}</span>
                    </div>
                </div>
            )}

            {p.tipo === "escolha" && (
                <div className="space-y-2">
                    {p.opcoes.map((op) => (
                        <button
                            key={op} type="button" onClick={() => onResponder(op)} disabled={enviando}
                            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-all active:scale-[0.99] ${
                                valor === op ? "border-primary bg-primary/10 font-semibold" : "bg-card hover:border-primary/60"
                            }`}
                        >
                            {op}
                            {valor === op && <Check className="h-4 w-4 text-primary" />}
                        </button>
                    ))}
                </div>
            )}

            {p.tipo === "texto" && (
                <div className="space-y-3">
                    <textarea
                        value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} maxLength={2000}
                        placeholder="Escreva aqui (opcional)"
                        className="w-full rounded-xl border bg-card p-3 text-sm outline-none focus:border-primary"
                    />
                    <Button
                        size="lg" className="h-12 w-full text-base" disabled={enviando}
                        onClick={() => onContinuar(texto.trim())}
                    >
                        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : ultima ? "Enviar respostas" : "Continuar"}
                    </Button>
                </div>
            )}
        </div>
    )
}

function Aviso({ texto }: { texto: string }) {
    return (
        <div className="max-w-sm space-y-2 text-center">
            <p className="text-lg font-semibold">Avaliação indisponível</p>
            <p className="text-sm text-muted-foreground">{texto}</p>
        </div>
    )
}

function Tela({ children }: { children: React.ReactNode }) {
    return <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">{children}</div>
}
