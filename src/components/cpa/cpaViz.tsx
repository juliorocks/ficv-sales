// Peças de visualização da Avaliação CPA (HTML/SVG, sem biblioteca extra além do Recharts já usado nas séries).
// Formas, por tipo de dado: escala de satisfação = barra divergente empilhada centrada no neutro; grade
// curso × bloco = mapa de calor de um tom; número de manchete = cartão de indicador. Cor por função:
// divergente (azul ↔ vermelho, neutro cinza: seguro para daltonismo) só para favorável/crítico; um tom só
// (o roxo da marca) para magnitude. Toda cor que carrega sentido vem com rótulo e valor em texto.
import { useMemo, useState } from "react"
import { createPortal } from "react-dom"

export type Bandas = { c: number; n: number; f: number }

export function usePaleta() {
    const escuro = typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    return useMemo(() => escuro
        ? { escuro, fav: "#3987e5", crit: "#e66767", neu: "#55544e", neuTxt: "#f0efec", serie: "#8B88FF", grade: "rgba(139,148,158,0.18)", tick: "#8B949E", superficie: "#12161C", seq: "#8B88FF" }
        : { escuro, fav: "#2a78d6", crit: "#e34948", neu: "#cfcdc4", neuTxt: "#3a3935", serie: "#5551FF", grade: "rgba(100,116,139,0.18)", tick: "#64748B", superficie: "#ffffff", seq: "#5551FF" }, [escuro])
}
export type Paleta = ReturnType<typeof usePaleta>

// ── formatação (pt-BR) ──────────────────────────────────────────────────────────────────────
export const fmt1 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("pt-BR"))
export const totalBandas = (b: Bandas | undefined | null) => (b ? b.c + b.n + b.f : 0)
export const pctDe = (parte: number, todo: number) => (todo ? Math.round((parte / todo) * 100) : 0)

// mesma regra do backend (cpa-admin): favorável = top 10% da escala, neutra = de 70% a 90%, crítica = abaixo
export const faixaDe = (v: number, max: number): "c" | "n" | "f" => (v >= max * 0.9 ? "f" : v >= max * 0.7 ? "n" : "c")
// "9–10", "7–8", "0–6" para a escala 0–10; "5", "4", "0–3" para 0–5
export function rotulosFaixas(min: number, max: number) {
    const fav = Math.ceil(max * 0.9)
    const neu = Math.ceil(max * 0.7)
    const faixa = (a: number, b: number) => (a >= b ? `${a}` : `${a}–${b}`)
    return {
        f: faixa(fav, max),
        n: neu >= fav ? "" : faixa(neu, fav - 1),
        c: faixa(min, neu - 1),
    }
}

// ── dica flutuante (uma só por seção; aparece também no foco do teclado) ───────────────────────
export type DicaConteudo = { titulo?: string; linhas: { chave?: string; valor: string; cor?: string }[] }
export function useDica() {
    const [estado, setEstado] = useState<{ x: number; y: number; c: DicaConteudo } | null>(null)
    // sem tabIndex: o elemento que recebe o foco é a linha/botão pai (as barras ficam dentro de botões)
    const alvo = (c: DicaConteudo) => ({
        onPointerMove: (e: React.PointerEvent) => setEstado({ x: e.clientX, y: e.clientY, c }),
        onPointerLeave: () => setEstado(null),
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect()
            setEstado({ x: r.left + r.width / 2, y: r.bottom, c })
        },
        onBlur: () => setEstado(null),
    })
    const elemento = estado && typeof document !== "undefined" ? createPortal(
        <div role="tooltip" className="pointer-events-none fixed z-[80] max-w-[260px] rounded-xl bg-[var(--bg-card)] px-3 py-2 text-xs shadow-[0_8px_30px_rgba(15,23,42,0.18)] ring-1 ring-black/5"
            style={{ left: Math.max(8, Math.min(estado.x + 14, window.innerWidth - 270)), top: Math.min(estado.y + 14, window.innerHeight - 90) }}>
            {estado.c.titulo && <p className="mb-1 font-medium text-[var(--text-muted)]">{estado.c.titulo}</p>}
            {estado.c.linhas.map((l, i) => (
                <p key={i} className="flex items-center gap-2">
                    {l.cor && <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: l.cor }} />}
                    <span className="text-sm font-semibold text-[var(--text-main)]">{l.valor}</span>
                    {l.chave && <span className="text-[var(--text-muted)]">{l.chave}</span>}
                </p>
            ))}
        </div>, document.body) : null
    return { alvo, elemento }
}
export type Alvo = ReturnType<typeof useDica>["alvo"]

// ── barra divergente: críticas à esquerda, favoráveis à direita, neutras no meio ─────────────────
// `escala` (k) é comum a todas as linhas de uma lista, senão duas barras não se comparam.
export function escalaDivergente(lista: (Bandas | undefined | null)[]): number {
    let maior = 0
    for (const b of lista) {
        const t = totalBandas(b)
        if (!b || !t) continue
        maior = Math.max(maior, (b.c + b.n / 2) / t * 100, (b.f + b.n / 2) / t * 100)
    }
    return maior ? 50 / maior : 1
}

export function BarraDivergente({ bandas, escala, alvo, p, rotulos, altura = 20 }: {
    bandas: Bandas | undefined | null; escala: number; alvo: Alvo; p: Paleta
    rotulos: { c: string; n: string; f: string }; altura?: number
}) {
    const t = totalBandas(bandas)
    if (!bandas || !t) return <div style={{ height: altura }} className="rounded-md bg-[var(--bg-card-hover)]" aria-label="sem respostas" />
    const c = (bandas.c / t) * 100
    const n = (bandas.n / t) * 100
    const f = (bandas.f / t) * 100
    const seg = (chave: "c" | "n" | "f", valor: number, esq: number, cor: string, txt: string) => {
        const largura = valor * escala
        if (largura <= 0) return null
        const rotulo = { c: "Críticas", n: "Neutras", f: "Favoráveis" }[chave]
        return (
            <div key={chave} {...alvo({ linhas: [{ valor: `${Math.round(valor)}%`, chave: `${rotulo}${rotulos[chave] ? ` (${rotulos[chave]})` : ""} · ${bandas[chave]} resp.`, cor }] })}
                className="absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-[3px] text-[10px] font-semibold outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary"
                style={{ left: `${esq}%`, width: `${largura}%`, background: cor, color: txt, boxShadow: "0 0 0 1px var(--bg-card)" }}>
                {largura >= 9 ? `${Math.round(valor)}%` : ""}
            </div>
        )
    }
    return (
        <div className="relative" style={{ height: altura }} role="img"
            aria-label={`${Math.round(c)}% críticas, ${Math.round(n)}% neutras, ${Math.round(f)}% favoráveis`}>
            <div className="absolute -bottom-0.5 -top-0.5 left-1/2 w-px bg-[var(--border)]" />
            {seg("c", c, 50 - (c + n / 2) * escala, p.crit, "#fff")}
            {seg("n", n, 50 - (n / 2) * escala, p.neu, p.neuTxt)}
            {seg("f", f, 50 + (n / 2) * escala, p.fav, "#fff")}
        </div>
    )
}

// ── barra de um tom: distribuição de pergunta sem polaridade (ex.: dificuldade) ──────────────────
export function BarraSequencial({ opcoes, alvo, p, altura = 20 }: { opcoes: { valor: string; n: number }[]; alvo: Alvo; p: Paleta; altura?: number }) {
    const total = opcoes.reduce((s, o) => s + o.n, 0)
    if (!total) return <div style={{ height: altura }} className="rounded-md bg-[var(--bg-card-hover)]" />
    return (
        <div className="flex gap-[2px]" style={{ height: altura }} role="img" aria-label={opcoes.map((o) => `${o.valor}: ${o.n}`).join(", ")}>
            {opcoes.map((o, i) => {
                const forca = 18 + (i / Math.max(opcoes.length - 1, 1)) * 72
                const w = (o.n / total) * 100
                return w > 0 ? (
                    <div key={o.valor} {...alvo({ linhas: [{ valor: `${Math.round(w)}%`, chave: `${o.valor} · ${o.n} resp.`, cor: p.seq }] })}
                        className="flex items-center justify-center overflow-hidden rounded-[3px] text-[10px] font-semibold outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary"
                        style={{ width: `${w}%`, background: `color-mix(in srgb, ${p.seq} ${forca}%, ${p.superficie})`, color: forca > 55 ? "#fff" : p.neuTxt }}>
                        {w >= 10 ? `${Math.round(w)}%` : ""}
                    </div>
                ) : null
            })}
        </div>
    )
}

// ── legenda das faixas (mesma ordem da barra: críticas, neutras, favoráveis) ──────────────────────
export function LegendaFaixas({ p, rotulos }: { p: Paleta; rotulos: { c: string; n: string; f: string } }) {
    const item = (cor: string, nome: string, faixa: string) => (
        <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: cor }} />
            <span className="text-[var(--text-main)]">{nome}</span>
            {faixa && <span className="text-[var(--text-muted)]">{faixa}</span>}
        </span>
    )
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {item(p.crit, "Críticas", rotulos.c)}
            {item(p.neu, "Neutras", rotulos.n)}
            {item(p.fav, "Favoráveis", rotulos.f)}
        </div>
    )
}

// ── medidor de um valor contra um limite (participação): trilho = tom claro do mesmo tom ─────────
export function Medidor({ valor, de, p }: { valor: number; de: number; p: Paleta }) {
    const pct = de ? Math.min(100, (valor / de) * 100) : 0
    return (
        <div className="h-2 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${p.serie} 16%, ${p.superficie})` }} role="img" aria-label={`${Math.round(pct)}% de ${de}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(pct, valor ? 1.5 : 0)}%`, background: p.serie }} />
        </div>
    )
}

// ── cor de célula do mapa de calor (um tom, do claro ao escuro) ───────────────────────────────────
export function corCelula(media: number | null | undefined, p: Paleta, minimo = 5): { bg: string; fg: string } {
    if (media === null || media === undefined) return { bg: "transparent", fg: "var(--text-muted)" }
    const t = Math.max(0, Math.min(1, (media - minimo) / (10 - minimo)))
    const forca = 10 + t * 85
    return { bg: `color-mix(in srgb, ${p.seq} ${forca}%, ${p.superficie})`, fg: forca > 52 ? "#fff" : p.neuTxt }
}
