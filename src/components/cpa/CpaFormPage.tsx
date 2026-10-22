// Avaliação CPA — formulário (um passo por tela, estilo Typeform, pensado pro celular).
// Dois usos: o link público (/avaliacao/:token, CpaFormPage) e a avaliação dentro do Portal do Aluno
// (CpaPortalAvaliacao). Os dois passam pelo mesmo núcleo, CpaFormFlow, que recebe os dados prontos e
// a função de envio. Pausas entre blocos com a frase de incentivo do banco; rascunho no aparelho.
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronLeft, ClipboardCheck, Copy, Loader2, Sparkles, Target } from "lucide-react"
import Lottie from "lottie-react"
import { Btn } from "./cpaUi"

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cpa-form`

// marca FICV: mesmo logo do Login e do Portal; dourado e preto dos materiais do Portal
const LOGO_FICV = "https://siteficv.vercel.app/images/test-logo.png"
const OURO = "#C9A84C"
const OURO_CLARO = "#E2C878"
const TINTA = "#13161D"

// Ícone animado (Lottie): sorteia um dos arquivos de src/components/cpa/lottie a cada tela.
// Quem sobe novos JSON só põe na pasta; o glob pega sozinho. Carrega só o arquivo sorteado.
const carregadoresLottie = import.meta.glob<object>("./lottie/*.json", { import: "default" })
let ultimaAnimacao: string | null = null // a mesma animação não aparece duas telas seguidas
function IconeLottie({ className, reserva: Reserva, arquivo }: { className: string; reserva: React.ComponentType<{ className?: string }>; arquivo?: string }) {
    const [dados, setDados] = useState<object | null>(null)
    useEffect(() => {
        if (arquivo) {
            let vivo = true
            carregadoresLottie[`./lottie/${arquivo}`]?.().then((d) => { if (vivo) setDados(d) }).catch(() => {})
            return () => { vivo = false }
        }
        const todas = Object.keys(carregadoresLottie)
        const chaves = todas.length > 1 ? todas.filter((k) => k !== ultimaAnimacao) : todas
        if (!chaves.length) return
        let vivo = true
        const sorteada = chaves[Math.floor(Math.random() * chaves.length)]
        ultimaAnimacao = sorteada
        carregadoresLottie[sorteada]().then((d) => { if (vivo) setDados(d) }).catch(() => {})
        return () => { vivo = false }
    }, [arquivo])
    if (!dados) return <div className={className}><Reserva className="h-full w-full text-[#C9A84C]" /></div>
    return <div className={className}><Lottie animationData={dados} loop autoplay /></div>
}

// cor da nota do vermelho (mínimo) ao verde (máximo), passando pelo amarelo
const matizNota = (n: number, min: number, max: number) => (max === min ? 120 : Math.round(((n - min) / (max - min)) * 120))

// prévia em cinza: pergunta anterior some para cima, a próxima some para baixo (sem revelar tudo)
const mascara = (lado: "anterior" | "proxima") => {
    const g = lado === "anterior" ? "linear-gradient(to bottom, transparent, black 70%)" : "linear-gradient(to bottom, black 30%, transparent)"
    return { maskImage: g, WebkitMaskImage: g }
}
function Previa({ texto, lado }: { texto: string; lado: "anterior" | "proxima" }) {
    const trecho = lado === "proxima" ? texto.split(" ").slice(0, 7).join(" ") + "…" : texto
    return (
        <div aria-hidden className="pointer-events-none select-none rounded-2xl bg-[var(--bg-card)] px-5 py-4 text-sm font-medium leading-snug text-neutral-400 grayscale shadow-[var(--card-shadow)]" style={mascara(lado)}>
            {trecho}
        </div>
    )
}

export type Pergunta = {
    id: number; bloco_id: number; ordem: number; texto: string
    tipo: "escala" | "escolha" | "texto"
    escala_min: number | null; escala_max: number | null
    rotulo_min: string | null; rotulo_max: string | null
    opcoes: string[]; obrigatoria: boolean; chave: string | null
}
export type Bloco = { id: number; ordem: number; titulo: string; incentivo: string | null }
export type Formulario = { id: number; nivel: string; titulo: string; ano: number; intro: string | null; teste: boolean; curso?: string; disciplina?: string | null; turma?: string | null; docente?: string | null }
export type Resultado = {
    ok: true; teste: boolean; protocolo: number | null; comprovante: string
    formulario?: string; disciplina?: string | null; turma?: string | null; respondido_em?: string | null
    aluno?: { nome: string | null; ra: string | null }
}
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

export function CpaFormFlow({ formulario, blocos, perguntas, storageKey, enviar: enviarRemoto, aoConcluir, pularIntro }: {
    formulario: Formulario
    blocos: Bloco[]
    perguntas: Pergunta[]
    storageKey: string
    enviar: (valores: Record<string, number | string>) => Promise<RespostaEnvio>
    aoConcluir?: (r: Resultado) => void // na fila do Portal: não mostra o comprovante no meio
    pularIntro?: boolean // na fila a tela de título já apresentou a parte
}) {
    const [pos, setPos] = useState(pularIntro ? 1 : 0)
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
    const anterior = (() => { for (let i = pos - 1; i >= 0; i--) { const q = passos[i]; if (q.tipo === "pergunta") return q.pergunta.texto } return null })()
    const proxima = (() => { for (let i = pos + 1; i < passos.length; i++) { const q = passos[i]; if (q.tipo === "pergunta") return q.pergunta.texto } return null })()

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
            try { localStorage.removeItem(storageKey) } catch { /* ignora */ }
            if (aoConcluir) return aoConcluir(d)
            setResultado(d)
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
            <div className="min-h-dvh bg-gradient-to-b from-[#FBF6E9] via-background to-background text-foreground">
                <div className="w-full bg-[#13161D] py-4">
                    <img src={LOGO_FICV} alt="Faculdade Internacional Cidade Viva" className="mx-auto h-10 w-auto" />
                </div>
                <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto w-full max-w-md space-y-5 px-4 py-8 text-center md:max-w-lg">
                    <IconeLottie className="mx-auto h-40 w-40" reserva={Check} arquivo="Trophy.json" />
                    <h1 className="text-2xl font-bold">Obrigado por participar!</h1>
                    <p className="text-sm text-[var(--text-muted)]">
                        {resultado.teste
                            ? "Resposta de teste registrada. Ela não entra nos relatórios oficiais."
                            : "Sua avaliação foi registrada."}
                    </p>
                    <Comprovante resultado={resultado} />
                    <div className="flex flex-col gap-2">
                        <Btn size="lg" className="h-12 w-full text-sm" style={{ background: TINTA }} onClick={() => window.print()}>Salvar comprovante (PDF)</Btn>
                        <Btn variant="outline" className="h-11 w-full text-sm" onClick={() => { navigator.clipboard?.writeText(resultado.comprovante); setCopiado(true) }}>
                            {copiado ? <><Check className="mr-2 h-4 w-4" /> Código copiado</> : <><Copy className="mr-2 h-4 w-4" /> Copiar código</>}
                        </Btn>
                    </div>
                </motion.div>
            </div>
        )
    }

    const respondidas = perguntas.filter((p) => respostas[p.id] !== undefined && respostas[p.id] !== "").length
    const fracao = total ? Math.min(1, (passo?.tipo === "pergunta" ? passo.indice : total) / total) : 0
    const ultimoPasso = pos === passos.length - 1

    return (
        <div className="min-h-dvh bg-gradient-to-b from-[#FBF6E9] via-background to-background text-foreground">
            <div className="w-full bg-[#13161D] py-4">
                <img src={LOGO_FICV} alt="Faculdade Internacional Cidade Viva" className="mx-auto h-10 w-auto" />
            </div>
            <div className="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-md flex-col px-4 pb-8 pt-5 md:max-w-2xl lg:max-w-3xl">
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
                                className="h-full rounded-full"
                                initial={false}
                                animate={{ width: `${Math.round(fracao * 100)}%` }}
                                style={{ background: `linear-gradient(90deg, ${OURO}, ${OURO_CLARO})` }}
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

                <div className="flex flex-1 flex-col justify-center py-4">
                {passo?.tipo === "pergunta" && anterior && <div className="mb-6"><Previa texto={anterior} lado="anterior" /></div>}
                <div className="flex flex-col py-2">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={pos}
                            initial={{ opacity: 0, y: 36 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -36, transition: { duration: 0.18 } }}
                            transition={{ y: { type: "spring", stiffness: 260, damping: 14 }, opacity: { duration: 0.2 } }}
                        >
                            {passo?.tipo === "intro" && (
                                <div className="space-y-6">
                                    <IconeLottie className="mx-auto h-36 w-36" reserva={ClipboardCheck} />
                                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#FBF0CF", color: "#7A5C12" }}>
                                        <Sparkles className="h-3.5 w-3.5" /> Avaliação Institucional CPA · {formulario.ano}
                                    </div>
                                    <h1 className="bg-gradient-to-r from-[#C9A84C] to-[#E2C878] bg-clip-text text-3xl font-extrabold leading-tight text-transparent">{formulario.titulo}</h1>
                                    <p className="text-lg font-semibold text-[#13161D]">Sua opinião faz a diferença</p>
                                    <p className="text-base text-muted-foreground">{formulario.intro}</p>
                                    {formulario.disciplina && <p className="text-sm font-semibold text-[#A07E2A]">{formulario.disciplina}{formulario.turma ? ` · ${formulario.turma}` : ""}</p>}
                                    {formulario.docente && <p className="text-sm text-[var(--text-muted)]">Professor(a): <span className="font-medium text-[var(--text-main)]">{formulario.docente}</span></p>}
                                    {formulario.curso && <p className="text-sm font-medium">{formulario.curso}</p>}
                                    <p className="text-sm text-muted-foreground">
                                        São {total} perguntas. Toque na nota que melhor representa a sua experiência.
                                    </p>
                                    <Btn size="lg" className="h-12 w-full text-base" style={{ background: TINTA }} onClick={() => setPos(1)}>Começar</Btn>
                                </div>
                            )}

                            {passo?.tipo === "pausa" && (
                                <div className="space-y-6 text-center">
                                    <IconeLottie className="mx-auto h-28 w-28" reserva={Sparkles} />
                                    <p className="text-xl font-semibold">{passo.texto}</p>
                                    <Btn size="lg" className="h-12 w-full text-base" style={{ background: TINTA }} onClick={() => setPos(pos + 1)}>Continuar</Btn>
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
                {passo?.tipo === "pergunta" && proxima && <div className="mt-6"><Previa texto={proxima} lado="proxima" /></div>}
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
        <div className="space-y-6 rounded-3xl bg-[var(--bg-card)] p-6 shadow-[0_12px_40px_-12px_rgba(19,22,29,0.22)]">
            <div className="flex items-center gap-3">
                <IconeLottie className="h-14 w-14 shrink-0" reserva={Target} />
                <p className="text-xs font-semibold uppercase tracking-wide text-[#A07E2A]">{frase}</p>
            </div>
            <h2 className="text-xl font-semibold leading-snug">{p.texto}</h2>

            {p.tipo === "escala" && (
                <div className="space-y-3">
                    <div className="grid grid-cols-6 gap-2">
                        {Array.from({ length: (p.escala_max ?? 10) - (p.escala_min ?? 0) + 1 }, (_, i) => (p.escala_min ?? 0) + i).map((n) => {
                            const marcado = valor === n
                            const matiz = matizNota(n, p.escala_min ?? 0, p.escala_max ?? 10)
                            return (
                                <button
                                    key={n} type="button" onClick={() => onResponder(n)} disabled={enviando}
                                    aria-pressed={marcado}
                                    className={`h-12 rounded-xl text-base font-bold transition-all active:scale-95 ${marcado ? "scale-105 shadow-lg" : "shadow-[var(--card-shadow)]"}`}
                                    style={marcado
                                        ? { background: `hsl(${matiz} 70% 40%)`, color: "#fff" }
                                        : { background: `hsl(${matiz} 75% 93%)`, color: `hsl(${matiz} 65% 28%)` }}
                                >
                                    {n}
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex justify-between text-xs text-[var(--text-muted)]">
                        <span>{p.rotulo_min}</span><span>{p.rotulo_max}</span>
                    </div>
                </div>
            )}

            {p.tipo === "escolha" && (
                <div className="space-y-2">
                    {p.opcoes.map((op, i) => {
                        // até 5 opções ordenadas (ex.: Muito baixo → Muito alto) usam a mesma escala de cor das notas
                        const ordinal = p.opcoes.length <= 5
                        const marcado = valor === op
                        const matiz = matizNota(i, 0, p.opcoes.length - 1)
                        const estilo = !ordinal ? undefined : marcado
                            ? { background: `hsl(${matiz} 70% 40%)`, color: "#fff" }
                            : { background: `hsl(${matiz} 75% 93%)`, color: `hsl(${matiz} 65% 28%)` }
                        return (
                            <button
                                key={op} type="button" onClick={() => onResponder(op)} disabled={enviando}
                                aria-pressed={marcado} style={estilo}
                                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium transition-all active:scale-[0.99] ${
                                    ordinal ? (marcado ? "scale-[1.02] shadow-lg" : "shadow-[var(--card-shadow)]")
                                        : marcado ? "bg-primary/10 font-semibold text-primary shadow-[var(--card-shadow)]" : "bg-[var(--bg-card)] shadow-[var(--card-shadow)] hover:bg-[var(--bg-card-hover)]"
                                }`}
                            >
                                {op}
                                {marcado && <Check className="h-4 w-4" />}
                            </button>
                        )
                    })}
                </div>
            )}

            {p.tipo === "texto" && (
                <div className="space-y-3">
                    <textarea
                        value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} maxLength={2000}
                        placeholder="Escreva aqui (opcional)"
                        className="w-full rounded-xl bg-[var(--bg-card-hover)] p-3 text-sm text-[var(--text-main)] outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <Btn
                        size="lg" className="h-12 w-full text-base" disabled={enviando}
                        onClick={() => onContinuar(texto.trim())}
                    >
                        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : ultima ? "Enviar respostas" : "Continuar"}
                    </Btn>
                </div>
            )}
        </div>
    )
}

// Comprovante: só o aluno vê os próprios dados, na tela e no PDF. A resposta gravada não tem nome.
function Comprovante({ resultado: r }: { resultado: Resultado }) {
    const quando = r.respondido_em ? new Date(r.respondido_em) : new Date()
    const data = quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
    const hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    const linha = (rotulo: string, valor: string | null | undefined) => valor ? (
        <div className="flex justify-between gap-4 py-2 text-sm">
            <span className="text-[var(--text-muted)]">{rotulo}</span><span className="text-right font-medium">{valor}</span>
        </div>
    ) : null
    return (
        <>
            <style>{`@media print {
                body * { visibility: hidden !important; }
                #cpa-comprovante, #cpa-comprovante * { visibility: visible !important; }
                #cpa-comprovante { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
            }`}</style>
            <div id="cpa-comprovante" className="rounded-2xl bg-[var(--bg-card)] p-6 text-left shadow-[var(--card-shadow)]">
                <div className="mb-4 flex items-center justify-between">
                    <img src={LOGO_FICV} alt="FICV" className="h-8 w-auto rounded bg-[#13161D] px-2 py-1" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#A07E2A]">Comprovante</span>
                </div>
                <p className="text-base font-bold">{r.formulario ?? "Avaliação Institucional CPA"}</p>
                {r.disciplina && <p className="text-sm text-[var(--text-muted)]">{r.disciplina}{r.turma ? ` · ${r.turma}` : ""}</p>}
                <div className="mt-4 divide-y divide-[var(--border)]">
                    {linha("Data", data)}
                    {linha("Hora", hora)}
                    {linha("Protocolo", r.teste ? "teste" : r.protocolo !== null ? `nº ${r.protocolo}` : null)}
                    {linha("Aluno", r.aluno?.nome)}
                    {linha("Matrícula", r.aluno?.ra)}
                    {!r.aluno?.nome && linha("Identificação", "Resposta anônima")}
                </div>
                <p className="mt-4 text-[11px] text-[var(--text-muted)]">Código de verificação</p>
                <p className="break-all font-mono text-[11px] leading-relaxed">{r.comprovante}</p>
                <p className="mt-4 text-[11px] text-[var(--text-muted)]">
                    Este código confirma que a resposta foi registrada na cadeia de integridade da CPA. Ele não revela o conteúdo das respostas.
                </p>
            </div>
        </>
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
