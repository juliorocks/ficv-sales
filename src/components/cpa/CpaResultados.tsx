// Resultados da Avaliação CPA (uma parte: geral ou disciplinas). Lê de cima para baixo, do geral ao específico:
// indicadores → blocos → perguntas → curso × bloco → disciplinas e professores → evolução e comentários.
// Drilldown: clicar numa pergunta abre o detalhe; num curso, numa disciplina ou num professor refiltra o painel.
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChevronDown, ChevronRight, X } from "lucide-react"
import { Inp } from "./cpaUi"
import {
    Bandas, BarraDivergente, BarraSequencial, LegendaFaixas, Medidor, Paleta, corCelula, escalaDivergente, faixaDe, fmt1, fmtInt,
    pctDe, rotulosFaixas, totalBandas, useDica, usePaleta,
} from "./cpaViz"

export type Item = {
    id: number; bloco_id: number; ordem: number; texto: string; tipo: "escala" | "escolha" | "texto"; n: number
    media?: number | null; neutra?: boolean; ordinal?: boolean; bandas?: Bandas; min?: number; max?: number
    distribuicao?: { valor: number; n: number }[]; opcoes?: { valor: string; n: number }[]
    por_curso?: { curso: string; n: number; media: number | null }[]
}
type BlocoR = { id: number; ordem: number; titulo: string; n: number; media: number | null; bandas: Bandas }
type CursoR = { curso: string; n: number; media: number | null; bandas: Bandas; por_bloco: Record<string, number | null> }
type DiscR = { contexto: string; periodo: string; disciplina: string; disciplina_nome?: string; periodo_nome?: string; docente: string | null; docentes?: string[]; n: number; media: number | null; bandas: Bandas }
type DocR = { docente: string; n: number; disciplinas: number; media: number | null; bandas: Bandas }
export type StatsCpa = {
    formulario: { id: number; titulo: string; nivel: string; tipo: string }
    totais: { respondentes: number; alunos: number | null; populacao_ativa: number | null; percentual: number | null; testes: number; media_geral: number | null; bandas: Bandas }
    indicacao: { n: number; nps: number; bandas: Bandas } | null
    por_dia: { dia: string; n: number }[]
    por_curso: CursoR[]
    por_disciplina: DiscR[]
    por_docente: DocR[]
    blocos: BlocoR[]
    perguntas: Item[]
    comentarios: { seq: number | null; teste: boolean; curso: string | null; respondido_em: string; texto: string; pergunta: string }[]
}

type Props = {
    titulo: string
    tipo: "geral" | "disciplina"
    stats?: StatsCpa
    atualizando?: boolean
    rankingBase?: StatsCpa // disciplinas sem o filtro de disciplina, para o ranking não encolher no drilldown
    contextoAtivo?: { contexto: string; rotulo: string } | null
    onFiltrarCurso: (curso: string) => void
    onFiltrarContexto: (contexto: string, rotulo: string) => void
    onLimparContexto: () => void
}

const nomeDisc = (d: DiscR) => d.disciplina_nome ?? d.disciplina.replace(/-/g, " ")
const nomePeriodo = (d: DiscR) => d.periodo_nome ?? d.periodo.replace(/-/g, " ")

export function Resultados({ titulo, tipo, stats, atualizando, rankingBase, contextoAtivo, onFiltrarCurso, onFiltrarContexto, onLimparContexto }: Props) {
    const p = usePaleta()
    const dica = useDica()
    const [aberta, setAberta] = useState<Item | null>(null)
    const [ordem, setOrdem] = useState<"form" | "piores" | "melhores">("form")
    const [abertos, setAbertos] = useState<Set<number>>(new Set())

    const t = stats?.totais
    const itens = stats?.perguntas ?? []
    const avaliativas = itens.filter((i) => i.tipo === "escala" || i.ordinal)
    const blocos = (stats?.blocos ?? []).filter((b) => avaliativas.some((i) => i.bloco_id === b.id))
    const refEscala = avaliativas.find((i) => i.tipo === "escala")
    const rotulos = rotulosFaixas(refEscala?.min ?? 0, refEscala?.max ?? 10)
    const kPerguntas = useMemo(() => escalaDivergente(avaliativas.filter((i) => !i.neutra).map((i) => i.bandas)), [stats]) // eslint-disable-line react-hooks/exhaustive-deps
    const kBlocos = useMemo(() => escalaDivergente(blocos.map((b) => b.bandas)), [stats]) // eslint-disable-line react-hooks/exhaustive-deps

    // começa com o bloco mais fraco aberto: é onde a atenção precisa ir
    useEffect(() => {
        const comMedia = blocos.filter((b) => b.media !== null)
        if (!comMedia.length) return
        setAbertos(new Set([comMedia.reduce((a, b) => (b.media! < a.media! ? b : a)).id]))
    }, [stats?.formulario?.id, contextoAtivo?.contexto, t?.respondentes]) // eslint-disable-line react-hooks/exhaustive-deps

    const abrirBloco = (id: number) => {
        setAbertos(new Set([id]))
        setTimeout(() => document.getElementById(`cpa-bloco-${stats?.formulario.id}-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    }

    const vazio = !!t && t.respondentes === 0

    return (
        <section className="space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
                <h3 className="text-xl font-bold tracking-tight text-[var(--text-main)]">{titulo}</h3>
                {t && !vazio && <p className="text-xs text-[var(--text-muted)]">{tipo === "geral" ? `${fmtInt(t.respondentes)} respondentes` : t.alunos !== null ? `${fmtInt(t.alunos)} ${t.alunos === 1 ? "aluno" : "alunos"}` : `${fmtInt(t.respondentes)} avaliações`}{t.testes ? ` · ${t.testes} de teste` : ""}</p>}
            </div>

            {contextoAtivo && (
                <div className="flex flex-wrap items-center gap-2">
                    <Chip rotulo="Disciplina" valor={contextoAtivo.rotulo} onRemover={onLimparContexto} />
                </div>
            )}

            <div className={`space-y-5 transition-opacity ${atualizando ? "opacity-60" : ""}`}>
                {!stats && <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">Carregando resultados…</div>}
                {vazio && (
                    <div className="glass-card p-10 text-center">
                        <p className="font-semibold text-[var(--text-main)]">Ainda não há respostas neste recorte</p>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">Mude a origem (oficiais, teste ou todas), as datas ou o curso nos filtros acima.</p>
                    </div>
                )}

                {stats && t && !vazio && (
                    <>
                        <Indicadores stats={stats} tipo={tipo} p={p} dica={dica} />

                        {blocos.length > 0 && (
                            <div>
                                <Rotulo>Por bloco</Rotulo>
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {blocos.map((b) => (
                                        <button key={b.id} type="button" onClick={() => abrirBloco(b.id)}
                                            {...dica.alvo({ titulo: b.titulo, linhas: linhasBandas(b.bandas, p, rotulos) })}
                                            className="glass-card p-4 text-left outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary">
                                            <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-[var(--text-main)]">{b.titulo}</p>
                                            <p className="mt-2 flex items-baseline gap-1.5">
                                                <span className="text-3xl font-bold tabular-nums text-[var(--text-main)]">{fmt1(b.media)}</span>
                                                <span className="text-xs text-[var(--text-muted)]">/10 · {fmtInt(b.n)} notas</span>
                                            </p>
                                            <div className="mt-3"><BarraDivergente bandas={b.bandas} escala={kBlocos} alvo={dica.alvo} p={p} rotulos={rotulos} altura={14} /></div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {avaliativas.length > 0 && (
                            <div className="glass-card space-y-4 p-4 md:p-6">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="space-y-2">
                                        <Rotulo>Pergunta por pergunta</Rotulo>
                                        <LegendaFaixas p={p} rotulos={rotulos} />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                        {([["form", "Ordem do formulário"], ["piores", "Piores primeiro"], ["melhores", "Melhores primeiro"]] as const).map(([k, nome]) => (
                                            <Pilula key={k} ativo={ordem === k} onClick={() => setOrdem(k)}>{nome}</Pilula>
                                        ))}
                                        <Pilula ativo={false} onClick={() => setAbertos(abertos.size === blocos.length ? new Set() : new Set(blocos.map((b) => b.id)))}>
                                            {abertos.size === blocos.length ? "Recolher tudo" : "Expandir tudo"}
                                        </Pilula>
                                    </div>
                                </div>

                                {blocos.map((b) => {
                                    const aberto = abertos.has(b.id)
                                    const doBloco = avaliativas.filter((i) => i.bloco_id === b.id).sort((x, y) =>
                                        ordem === "form" ? x.ordem - y.ordem
                                            : ordem === "piores" ? (x.media ?? 99) / (x.max ?? 10) - (y.media ?? 99) / (y.max ?? 10)
                                                : (y.media ?? -1) / (y.max ?? 10) - (x.media ?? -1) / (x.max ?? 10))
                                    return (
                                        <div key={b.id} id={`cpa-bloco-${stats.formulario.id}-${b.id}`} className="scroll-mt-4 rounded-2xl bg-[var(--bg-card-hover)]/60">
                                            <button type="button" onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })}
                                                aria-expanded={aberto} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                                {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />}
                                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-main)]">{b.titulo}</span>
                                                <span className="hidden w-40 shrink-0 sm:block"><BarraDivergente bandas={b.bandas} escala={kBlocos} alvo={dica.alvo} p={p} rotulos={rotulos} altura={12} /></span>
                                                <span className="w-12 shrink-0 text-right text-base font-bold tabular-nums text-[var(--text-main)]">{fmt1(b.media)}</span>
                                            </button>
                                            {aberto && (
                                                <div className="space-y-0.5 px-1 pb-2">
                                                    {doBloco.map((i) => (
                                                        <LinhaPergunta key={i.id} item={i} escala={kPerguntas} p={p} dica={dica} rotulos={rotulos} onAbrir={() => setAberta(i)} />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {blocos.length > 0 && stats.por_curso.length > 0 && <MapaCalor stats={stats} blocos={blocos} p={p} dica={dica} onFiltrarCurso={onFiltrarCurso} />}

                        {tipo === "disciplina" && <RankingDisciplinas base={rankingBase ?? stats} ativo={contextoAtivo?.contexto ?? null} p={p} dica={dica} rotulos={rotulos} onFiltrarContexto={onFiltrarContexto} />}

                        <div className="grid gap-4 xl:grid-cols-2">
                            <Evolucao dias={stats.por_dia} p={p} />
                            <Comentarios lista={stats.comentarios} />
                        </div>

                        <TabelaDados itens={itens} />
                    </>
                )}
            </div>

            {dica.elemento}
            {aberta && stats && (
                <Gaveta item={aberta} bloco={stats.blocos.find((b) => b.id === aberta.bloco_id)?.titulo ?? ""} p={p} onFechar={() => setAberta(null)}
                    onFiltrarCurso={(c) => { setAberta(null); onFiltrarCurso(c) }} />
            )}
        </section>
    )
}

function Rotulo({ children }: { children: React.ReactNode }) {
    return <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{children}</p>
}

function Pilula({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={ativo}
            className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${ativo ? "bg-primary text-white" : "bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>
            {children}
        </button>
    )
}

export function Chip({ rotulo, valor, onRemover }: { rotulo: string; valor: string; onRemover: () => void }) {
    return (
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs text-[var(--text-main)]">
            <span className="text-[var(--text-muted)]">{rotulo}:</span> <b className="max-w-[260px] truncate">{valor}</b>
            <button type="button" aria-label={`Remover filtro ${rotulo}`} onClick={onRemover} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/20"><X className="h-3 w-3" /></button>
        </span>
    )
}

function linhasBandas(b: Bandas, p: Paleta, rotulos: { c: string; n: string; f: string }) {
    const t = totalBandas(b)
    return [
        { valor: `${pctDe(b.f, t)}%`, chave: `favoráveis (${rotulos.f}) · ${b.f}`, cor: p.fav },
        { valor: `${pctDe(b.n, t)}%`, chave: `neutras${rotulos.n ? ` (${rotulos.n})` : ""} · ${b.n}`, cor: p.neu },
        { valor: `${pctDe(b.c, t)}%`, chave: `críticas (${rotulos.c}) · ${b.c}`, cor: p.crit },
    ]
}

// ── indicadores do topo: uma nota de destaque, como avaliaram, participação e NPS (ou ponto de atenção) ──
function Indicadores({ stats, tipo, p, dica }: { stats: StatsCpa; tipo: "geral" | "disciplina"; p: Paleta; dica: ReturnType<typeof useDica> }) {
    const t = stats.totais
    const total = totalBandas(t.bandas)
    const rot = { c: "", n: "", f: "" }
    const k = escalaDivergente([t.bandas])
    const nps = stats.indicacao
    const zona = nps ? (nps.nps >= 75 ? "Excelente" : nps.nps >= 50 ? "Muito bom" : nps.nps >= 0 ? "Razoável" : "Crítico") : ""
    const pior = tipo === "geral"
        ? stats.blocos.filter((b) => b.media !== null && b.n > 0).sort((a, b) => a.media! - b.media!)[0]
        : stats.por_disciplina.filter((d) => d.media !== null && d.n >= 3).sort((a, b) => a.media! - b.media!)[0]
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="glass-card p-5">
                <Rotulo>Nota média</Rotulo>
                <p className="flex items-baseline gap-2"><span className="text-5xl font-bold tracking-tight text-[var(--text-main)]">{fmt1(t.media_geral)}</span><span className="text-sm text-[var(--text-muted)]">de 10</span></p>
                <p className="mt-3 text-xs text-[var(--text-muted)]">{fmtInt(total)} notas avaliadas</p>
            </div>
            <div className="glass-card p-5">
                <Rotulo>Como avaliaram</Rotulo>
                <p className="mb-3 text-3xl font-bold tabular-nums text-[var(--text-main)]">{pctDe(t.bandas.f, total)}%<span className="ml-2 text-sm font-normal text-[var(--text-muted)]">favoráveis</span></p>
                <BarraDivergente bandas={t.bandas} escala={k} alvo={dica.alvo} p={p} rotulos={rot} altura={18} />
                <p className="mt-2 text-xs text-[var(--text-muted)]">{pctDe(t.bandas.n, total)}% neutras · {pctDe(t.bandas.c, total)}% críticas</p>
            </div>
            <div className="glass-card p-5">
                <Rotulo>{tipo === "geral" ? "Participação" : t.alunos !== null ? "Alunos que avaliaram" : "Avaliações de disciplina"}</Rotulo>
                <p className="text-3xl font-bold tabular-nums text-[var(--text-main)]">{fmtInt(tipo === "geral" ? t.respondentes : t.alunos ?? t.respondentes)}</p>
                {tipo === "geral" ? (
                    <>
                        <div className="my-3"><Medidor valor={t.respondentes} de={t.populacao_ativa ?? 0} p={p} /></div>
                        <p className="text-xs text-[var(--text-muted)]">{t.percentual !== null ? `${fmt1(t.percentual)}% de ${fmtInt(t.populacao_ativa)} alunos ativos` : "sem base de alunos ativos"}</p>
                    </>
                ) : (
                    <p className="mt-3 text-xs text-[var(--text-muted)]">{t.alunos !== null ? `${fmtInt(t.respondentes)} avaliações · ` : ""}{stats.por_disciplina.length} disciplinas · {stats.por_docente.length} professores</p>
                )}
            </div>
            {nps ? (
                <div className="glass-card p-5" {...dica.alvo({ titulo: "Índice de indicação", linhas: [{ valor: `${pctDe(nps.bandas.f, nps.n)}%`, chave: "favoráveis", cor: p.fav }, { valor: `${pctDe(nps.bandas.c, nps.n)}%`, chave: "críticas", cor: p.crit }] })}>
                    <Rotulo>Índice de indicação (NPS)</Rotulo>
                    <p className="text-3xl font-bold tabular-nums text-[var(--text-main)]">{nps.nps > 0 ? "+" : ""}{nps.nps}<span className="ml-2 text-sm font-normal text-[var(--text-muted)]">{zona}</span></p>
                    <p className="mt-3 text-xs text-[var(--text-muted)]">favoráveis menos críticas, na pergunta "indicaria" ({nps.n} respostas)</p>
                </div>
            ) : (
                <div className="glass-card p-5">
                    <Rotulo>Ponto de atenção</Rotulo>
                    {pior ? (
                        <>
                            <p className="line-clamp-2 text-sm font-semibold text-[var(--text-main)]">{"titulo" in pior ? pior.titulo : nomeDisc(pior)}</p>
                            <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--text-main)]">{fmt1(pior.media)}<span className="ml-1 text-sm font-normal text-[var(--text-muted)]">/10</span></p>
                        </>
                    ) : <p className="text-sm text-[var(--text-muted)]">Sem dados suficientes.</p>}
                </div>
            )}
        </div>
    )
}

// ── uma linha por pergunta: texto, barra de faixas e média ─────────────────────────────────────────
function LinhaPergunta({ item, escala, p, dica, rotulos, onAbrir }: { item: Item; escala: number; p: Paleta; dica: ReturnType<typeof useDica>; rotulos: { c: string; n: string; f: string }; onAbrir: () => void }) {
    const foco = item.neutra
        ? { titulo: `${item.ordem}. ${item.texto}`, linhas: [{ valor: fmt1(item.media), chave: `média · ${item.n} resp.` }] }
        : { titulo: `${item.ordem}. ${item.texto}`, linhas: linhasBandas(item.bandas ?? { c: 0, n: 0, f: 0 }, p, rotulos) }
    const escalaTxt = item.max && item.max !== 10 ? ` /${item.max}` : ""
    return (
        <button type="button" onClick={onAbrir} {...dica.alvo(foco)}
            className="grid w-full gap-x-4 gap-y-2 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-[var(--bg-card)] focus-visible:ring-2 focus-visible:ring-primary md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_84px] md:items-center">
            <span className="flex gap-2">
                <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[var(--text-muted)]">{item.ordem}</span>
                <span className="text-sm text-[var(--text-main)]">
                    <span className="line-clamp-2">{item.texto}</span>
                    {item.neutra && <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">quanto mais escuro, mais difícil</span>}
                </span>
            </span>
            {item.neutra
                ? <BarraSequencial opcoes={item.opcoes ?? []} alvo={dica.alvo} p={p} />
                : <BarraDivergente bandas={item.bandas} escala={escala} alvo={dica.alvo} p={p} rotulos={rotulos} />}
            <span className="flex items-baseline justify-between gap-2 md:block md:text-right">
                <span className="text-lg font-bold tabular-nums text-[var(--text-main)]">{fmt1(item.media)}<span className="text-[11px] font-normal text-[var(--text-muted)]">{escalaTxt}</span></span>
                <span className="block text-[11px] text-[var(--text-muted)]">{fmtInt(item.n)} resp.</span>
            </span>
        </button>
    )
}

// ── mapa de calor curso × bloco ──────────────────────────────────────────────────────────────────
function MapaCalor({ stats, blocos, p, dica, onFiltrarCurso }: { stats: StatsCpa; blocos: BlocoR[]; p: Paleta; dica: ReturnType<typeof useDica>; onFiltrarCurso: (c: string) => void }) {
    const cursos = stats.por_curso.filter((c) => c.curso !== "(sem curso)" || stats.por_curso.length === 1)
    if (!cursos.length) return null
    const celula = (media: number | null, titulo: string, curso: string, n: number, clicavel: boolean) => {
      const cor = corCelula(media, p)
      return (
        <button type="button" disabled={!clicavel} onClick={() => clicavel && onFiltrarCurso(curso)}
          {...dica.alvo({ titulo, linhas: [{ valor: fmt1(media), chave: `média · ${n} respostas` }] })}
          className="w-full rounded-lg px-2 py-2.5 text-center text-sm font-semibold tabular-nums outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
          style={{ background: cor.bg, color: cor.fg }}>
          {fmt1(media)}
        </button>
      )
    }
    return (
        <div className="glass-card p-4 md:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Rotulo>Curso × bloco (clique no curso para filtrar)</Rotulo>
                <span className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    5 ou menos
                    <span className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${corCelula(5, p).bg}, ${corCelula(10, p).bg})` }} />
                    10
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-separate border-spacing-1 text-sm">
                    <thead>
                        <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="px-2 py-1">Curso</th>
                            <th className="px-2 py-1 text-right">Resp.</th>
                            {blocos.map((b) => <th key={b.id} className="max-w-[120px] truncate px-2 py-1 text-center" title={b.titulo}>{b.titulo}</th>)}
                            <th className="px-2 py-1 text-center">Geral</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cursos.map((c) => (
                            <tr key={c.curso}>
                                <td className="max-w-[240px] truncate px-2 text-[var(--text-main)]" title={c.curso}>{c.curso}</td>
                                <td className="px-2 text-right tabular-nums text-[var(--text-muted)]">{fmtInt(c.n)}</td>
                                {blocos.map((b) => <td key={b.id}>{celula(c.por_bloco[String(b.id)] ?? null, `${c.curso} · ${b.titulo}`, c.curso, c.n, c.curso !== "(sem curso)")}</td>)}
                                <td>{celula(c.media, `${c.curso} · geral`, c.curso, c.n, c.curso !== "(sem curso)")}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ── disciplinas e professores: ranking com drilldown (professor → disciplinas → perguntas) ─────────────
function RankingDisciplinas({ base, ativo, p, dica, rotulos, onFiltrarContexto }: {
    base: StatsCpa; ativo: string | null; p: Paleta; dica: ReturnType<typeof useDica>; rotulos: { c: string; n: string; f: string }
    onFiltrarContexto: (contexto: string, rotulo: string) => void
}) {
    const [modo, setModo] = useState<"disciplinas" | "professores">("disciplinas")
    const [por, setPor] = useState<"melhores" | "piores" | "respostas">("melhores")
    const [aberto, setAberto] = useState<string | null>(null)
    const discs = base.por_disciplina
    const docs = base.por_docente
    if (!discs.length) return (
        <div className="glass-card p-6"><Rotulo>Disciplinas e professores</Rotulo><p className="text-sm text-[var(--text-muted)]">Nenhuma avaliação de disciplina neste recorte.</p></div>
    )
    const ordenar = <T extends { media: number | null; n: number }>(l: T[]) => [...l].sort((a, b) =>
        por === "respostas" ? b.n - a.n : por === "piores" ? (a.media ?? 99) - (b.media ?? 99) : (b.media ?? -1) - (a.media ?? -1))
    const lista = modo === "disciplinas" ? ordenar(discs) : ordenar(docs)
    const k = escalaDivergente((lista as { bandas: Bandas }[]).map((x) => x.bandas))
    const poucas = (n: number) => n < 5

    const linha = (chave: string, titulo: string, sub: string, bandas: Bandas, media: number | null, n: number, onClick: () => void, destaque = false, recuo = false) => (
        <button key={chave} type="button" onClick={onClick} {...dica.alvo({ titulo, linhas: linhasBandas(bandas, p, rotulos) })}
            className={`grid w-full gap-x-4 gap-y-2 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-[var(--bg-card)] focus-visible:ring-2 focus-visible:ring-primary md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_84px] md:items-center ${destaque ? "bg-primary/10" : ""} ${recuo ? "md:pl-10" : ""}`}>
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--text-main)]">{titulo}</span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">{sub}</span>
            </span>
            <BarraDivergente bandas={bandas} escala={k} alvo={dica.alvo} p={p} rotulos={rotulos} />
            <span className="flex items-baseline justify-between gap-2 md:block md:text-right">
                <span className="text-lg font-bold tabular-nums text-[var(--text-main)]">{fmt1(media)}</span>
                <span className="block text-[11px] text-[var(--text-muted)]">{fmtInt(n)} resp.{poucas(n) ? " · poucas" : ""}</span>
            </span>
        </button>
    )

    return (
        <div className="glass-card space-y-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-2">
                    <Rotulo>Disciplinas e professores (clique para ver as perguntas)</Rotulo>
                    <LegendaFaixas p={p} rotulos={rotulos} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Pilula ativo={modo === "disciplinas"} onClick={() => setModo("disciplinas")}>Disciplinas</Pilula>
                    <Pilula ativo={modo === "professores"} onClick={() => setModo("professores")}>Professores</Pilula>
                    <span className="mx-1 h-4 w-px bg-[var(--border)]" />
                    {([["melhores", "Melhores"], ["piores", "Piores"], ["respostas", "Mais respostas"]] as const).map(([kk, nome]) => (
                        <Pilula key={kk} ativo={por === kk} onClick={() => setPor(kk)}>{nome}</Pilula>
                    ))}
                </div>
            </div>
            <div className="max-h-[520px] space-y-0.5 overflow-y-auto pr-1">
                {modo === "disciplinas" && (lista as DiscR[]).map((d) =>
                    linha(d.contexto, nomeDisc(d), `${d.docente ? `Prof. ${d.docente}` : "professor não identificado"} · ${nomePeriodo(d)}`, d.bandas, d.media, d.n,
                        () => onFiltrarContexto(d.contexto, `${nomeDisc(d)}${d.docente ? ` · Prof. ${d.docente}` : ""}`), ativo === d.contexto))}
                {modo === "professores" && (lista as DocR[]).map((d) => (
                    <div key={d.docente}>
                        {linha(d.docente, d.docente, `${d.disciplinas} ${d.disciplinas === 1 ? "disciplina" : "disciplinas"}`, d.bandas, d.media, d.n, () => setAberto(aberto === d.docente ? null : d.docente))}
                        {aberto === d.docente && discs.filter((x) => (x.docentes ?? [x.docente]).includes(d.docente)).map((x) =>
                            linha(`${d.docente}|${x.contexto}`, nomeDisc(x), nomePeriodo(x), x.bandas, x.media, x.n,
                                () => onFiltrarContexto(x.contexto, `${nomeDisc(x)} · Prof. ${d.docente}`), ativo === x.contexto, true))}
                    </div>
                ))}
                {modo === "professores" && lista.length === 0 && <p className="py-4 text-sm text-[var(--text-muted)]">Nenhum professor identificado nas avaliações. Preencha os professores abaixo.</p>}
            </div>
        </div>
    )
}

// ── evolução: respostas por dia ──────────────────────────────────────────────────────────────────────
function Evolucao({ dias, p }: { dias: { dia: string; n: number }[]; p: Paleta }) {
    const total = dias.reduce((s, d) => s + d.n, 0)
    return (
        <div className="glass-card p-4 md:p-6">
            <Rotulo>Respostas por dia</Rotulo>
            {dias.length === 0 ? <p className="py-10 text-center text-sm text-[var(--text-muted)]">Sem respostas.</p> : (
                <>
                    <p className="mb-2 text-xs text-[var(--text-muted)]">{fmtInt(total)} no total · pico de {Math.max(...dias.map((d) => d.n))} em um dia</p>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={dias.map((d) => ({ ...d, rotulo: d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7) }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid stroke={p.grade} vertical={false} />
                            <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: p.tick }} axisLine={false} tickLine={false} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: p.tick }} axisLine={false} tickLine={false} />
                            <Tooltip cursor={{ fill: p.grade }} content={<DicaGrafico unidade="respostas" />} />
                            <Bar dataKey="n" isAnimationActive={false} fill={p.serie} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        </BarChart>
                    </ResponsiveContainer>
                </>
            )}
        </div>
    )
}

// dica dos gráficos do Recharts, no mesmo formato da dica das barras (valor em destaque, nome ao lado)
function DicaGrafico({ active, payload, label, unidade }: { active?: boolean; payload?: { value: number; payload: { rotulo?: string } }[]; label?: string; unidade: string }) {
    if (!active || !payload?.length) return null
    return (
        <div className="rounded-xl bg-[var(--bg-card)] px-3 py-2 text-xs shadow-[0_8px_30px_rgba(15,23,42,0.18)] ring-1 ring-black/5">
            <p className="mb-0.5 text-[var(--text-muted)]">{label ?? payload[0].payload.rotulo}</p>
            <p><span className="text-sm font-semibold text-[var(--text-main)]">{fmtInt(payload[0].value)}</span> <span className="text-[var(--text-muted)]">{unidade}</span></p>
        </div>
    )
}

function Comentarios({ lista }: { lista: StatsCpa["comentarios"] }) {
    const [busca, setBusca] = useState("")
    const q = busca.trim().toLowerCase()
    const filtrados = q ? lista.filter((c) => c.texto.toLowerCase().includes(q)) : lista
    return (
        <div className="glass-card p-4 md:p-6">
            <Rotulo>Comentários ({filtrados.length})</Rotulo>
            <Inp placeholder="Buscar nos comentários" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-3" />
            <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {filtrados.map((c, i) => (
                    <div key={`${c.seq}-${c.respondido_em}-${i}`} className="rounded-xl bg-[var(--bg-card-hover)] p-3 text-sm">
                        <p className="mb-1 text-[11px] text-[var(--text-muted)]">
                            {c.teste ? "teste" : `protocolo ${c.seq}`} · {new Date(c.respondido_em).toLocaleDateString("pt-BR")}{c.curso ? ` · ${c.curso}` : ""}
                        </p>
                        <p className="whitespace-pre-wrap text-[var(--text-main)]">{c.texto}</p>
                    </div>
                ))}
                {filtrados.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nenhum comentário.</p>}
            </div>
        </div>
    )
}

// alternativa em tabela: tudo o que os gráficos mostram, também em texto
function TabelaDados({ itens }: { itens: Item[] }) {
    return (
        <details className="glass-card p-4 md:p-6">
            <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Tabela de dados por pergunta</summary>
            <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                        <tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Pergunta</th><th className="py-2 pr-3 text-right">n</th><th className="py-2 pr-3 text-right">Média</th><th className="py-2">Distribuição</th></tr>
                    </thead>
                    <tbody>
                        {itens.map((i) => (
                            <tr key={i.id} className="align-top">
                                <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">{i.ordem}</td>
                                <td className="py-2 pr-3">{i.texto}</td>
                                <td className="py-2 pr-3 text-right tabular-nums">{i.n}</td>
                                <td className="py-2 pr-3 text-right tabular-nums">{i.media !== undefined ? fmt1(i.media) : ""}</td>
                                <td className="py-2 text-xs text-[var(--text-muted)]">
                                    {i.distribuicao?.map((d) => `${d.valor}: ${d.n}`).join(" · ")}
                                    {!i.distribuicao && i.opcoes?.map((o) => `${o.valor}: ${o.n}`).join(" · ")}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    )
}

// ── gaveta de detalhe da pergunta: histograma por nota e média por curso ────────────────────────────
function Gaveta({ item, bloco, p, onFechar, onFiltrarCurso }: { item: Item; bloco: string; p: Paleta; onFechar: () => void; onFiltrarCurso: (c: string) => void }) {
    useEffect(() => {
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar() }
        window.addEventListener("keydown", tecla)
        return () => window.removeEventListener("keydown", tecla)
    }, [onFechar])

    const ordinal = !!item.ordinal
    const max = ordinal ? 10 : item.max ?? 10
    const dados = ordinal
        ? (item.opcoes ?? []).map((o, idx) => ({ rotulo: o.valor, n: o.n, cor: item.neutra ? p.serie : { c: p.crit, n: p.neu, f: p.fav }[faixaDe((idx + 1) * 2, 10)] }))
        : (item.distribuicao ?? []).map((d) => ({ rotulo: String(d.valor), n: d.n, cor: item.neutra ? p.serie : { c: p.crit, n: p.neu, f: p.fav }[faixaDe(d.valor, max)] }))
    const total = totalBandas(item.bandas)
    const rot = rotulosFaixas(item.min ?? 0, max)
    const cursos = (item.por_curso ?? []).filter((c) => c.media !== null)

    return createPortal(
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onFechar}>
            <aside role="dialog" aria-label={`Pergunta ${item.ordem}`} className="h-full w-full max-w-xl overflow-y-auto bg-[var(--bg-card)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Pergunta {item.ordem} · {bloco}</p>
                        <h3 className="mt-1 text-lg font-bold leading-snug text-[var(--text-main)]">{item.texto}</h3>
                    </div>
                    <button type="button" aria-label="Fechar" onClick={onFechar} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--bg-card-hover)]"><X className="h-4 w-4" /></button>
                </div>

                <div className="mb-6 flex flex-wrap items-end gap-x-8 gap-y-3">
                    <p><span className="text-5xl font-bold tracking-tight text-[var(--text-main)]">{fmt1(item.media)}</span><span className="ml-2 text-sm text-[var(--text-muted)]">{ordinal ? "de 10" : `de ${max}`}</span></p>
                    <p className="text-sm text-[var(--text-muted)]">{fmtInt(item.n)} respostas</p>
                    {!item.neutra && total > 0 && (
                        <p className="text-sm text-[var(--text-main)]">
                            <b>{pctDe(item.bandas!.f, total)}%</b> favoráveis <span className="text-[var(--text-muted)]">({rot.f})</span> · <b>{pctDe(item.bandas!.c, total)}%</b> críticas
                        </p>
                    )}
                </div>

                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{ordinal ? "Respostas por opção" : "Respostas por nota"}</p>
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dados} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid stroke={p.grade} vertical={false} />
                        <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: p.tick }} axisLine={false} tickLine={false} interval={0} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: p.tick }} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: p.grade }} content={<DicaGrafico unidade="respostas" />} />
                        <Bar dataKey="n" radius={[4, 4, 0, 0]} maxBarSize={36}>
                            {dados.map((d, i) => <Cell key={i} fill={d.cor} />)}
                            <LabelList dataKey="n" position="top" formatter={(v: number) => (v ? v : "")} style={{ fontSize: 11, fill: p.tick }} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
                {!item.neutra && <div className="mt-3"><LegendaFaixas p={p} rotulos={rot} /></div>}

                {cursos.length > 1 && (
                    <div className="mt-8">
                        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Média por curso (clique para filtrar)</p>
                        <div className="space-y-1">
                            {cursos.map((c) => (
                                <button key={c.curso} type="button" onClick={() => onFiltrarCurso(c.curso)}
                                    className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_64px] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-card-hover)]">
                                    <span className="truncate text-sm text-[var(--text-main)]" title={c.curso}>{c.curso}</span>
                                    <span className="h-3 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${p.serie} 14%, ${p.superficie})` }}>
                                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((c.media ?? 0) / max) * 100)}%`, background: p.serie }} />
                                    </span>
                                    <span className="text-right text-sm font-semibold tabular-nums text-[var(--text-main)]">{fmt1(c.media)}<span className="ml-1 text-[11px] font-normal text-[var(--text-muted)]">({c.n})</span></span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </aside>
        </div>,
        document.body,
    )
}
