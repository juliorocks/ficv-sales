// Editor do formulário da CPA: blocos e perguntas (criar, editar, excluir, reordenar).
// Reordenar é com as setas (↑ ↓) dentro do bloco, e dos blocos entre si. Perguntas que já têm
// resposta não mudam tipo, escala, opções nem somem: o servidor recusa, e a tela também trava.
import { useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { Btn } from "./cpaUi"
import { Inp } from "./cpaUi"
import { showError, showSuccess } from "@/utils/toast"
import { chamar, BlocoAdmin, PerguntaAdmin } from "./cpaApi"

type Estrutura = { blocos: BlocoAdmin[]; perguntas: PerguntaAdmin[]; respondidas: string[] }
type Edicao = { tipo: "bloco"; bloco: Partial<BlocoAdmin> } | { tipo: "pergunta"; pergunta: Partial<PerguntaAdmin> & { bloco_id?: number } }

export function CpaEditor({ formId, admin }: { formId: number; admin: boolean }) {
    const qc = useQueryClient()
    const [edicao, setEdicao] = useState<Edicao | null>(null)
    const [abertosEstado, setAbertosEstado] = useState<Set<number> | null>(null)
    const { data, isLoading, error } = useQuery({
        queryKey: ["cpa-estrutura", formId],
        queryFn: () => chamar<Estrutura>("estrutura", { formulario_id: formId }),
    })

    const invalidar = () => {
        qc.invalidateQueries({ queryKey: ["cpa-estrutura", formId] })
        qc.invalidateQueries({ queryKey: ["cpa-form", formId] })
    }
    const erro = (e: Error) => showError(e.message)

    const salvar = useMutation({
        mutationFn: (e: Edicao) => e.tipo === "bloco"
            ? chamar("bloco_salvar", { formulario_id: formId, bloco: e.bloco })
            : chamar("pergunta_salvar", { formulario_id: formId, pergunta: e.pergunta }),
        onSuccess: () => { setEdicao(null); invalidar(); showSuccess("Salvo") },
        onError: erro,
    })
    const excluir = useMutation({
        mutationFn: (x: { tipo: "bloco" | "pergunta"; id: number }) => chamar(x.tipo === "bloco" ? "bloco_excluir" : "pergunta_excluir",
            x.tipo === "bloco" ? { formulario_id: formId, bloco_id: x.id } : { formulario_id: formId, pergunta_id: x.id }),
        onSuccess: () => { invalidar(); showSuccess("Excluído") },
        onError: erro,
    })
    const reordenar = useMutation({
        mutationFn: (itens: { kind: "bloco" | "pergunta"; id: number; ordem: number; bloco_id?: number }[]) =>
            chamar("reordenar", { formulario_id: formId, itens }),
        onSuccess: invalidar,
        onError: erro,
    })

    if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
    if (error || !data) return <p className="p-6 text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar."}</p>

    const respondidas = new Set(data.respondidas)
    const blocos = [...data.blocos].sort((a, b) => a.ordem - b.ordem)
    const abertos = abertosEstado ?? new Set(blocos.slice(0, 1).map((b) => b.id))
    const setAbertos = (v: Set<number> | ((s: Set<number>) => Set<number>)) => setAbertosEstado(typeof v === "function" ? v(abertos) : v)
    const perguntasDo = (blocoId: number) => data.perguntas.filter((p) => p.bloco_id === blocoId).sort((a, b) => a.ordem - b.ordem)

    function moverBloco(i: number, d: -1 | 1) {
        const j = i + d
        if (j < 0 || j >= blocos.length) return
        const a = blocos[i], b = blocos[j]
        reordenar.mutate([{ kind: "bloco", id: a.id, ordem: b.ordem }, { kind: "bloco", id: b.id, ordem: a.ordem }])
    }
    function moverPergunta(blocoId: number, i: number, d: -1 | 1) {
        const lista = perguntasDo(blocoId)
        const j = i + d
        if (j < 0 || j >= lista.length) return
        const a = lista[i], b = lista[j]
        reordenar.mutate([
            { kind: "pergunta", id: a.id, ordem: b.ordem, bloco_id: blocoId },
            { kind: "pergunta", id: b.id, ordem: a.ordem, bloco_id: blocoId },
        ])
    }

    const todosAbertos = abertos.size === blocos.length

    return (
        <div className="glass-card space-y-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Estrutura da avaliação</p>
                    <p className="text-xs text-[var(--text-muted)]">
                        {data.perguntas.length} perguntas em {blocos.length} blocos. Mudanças valem na hora para quem acessar o link ou o Portal.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Pilula onClick={() => setAbertos(todosAbertos ? new Set() : new Set(blocos.map((b) => b.id)))}>{todosAbertos ? "Recolher tudo" : "Expandir tudo"}</Pilula>
                    {admin && (
                        <>
                            <Pilula onClick={() => setEdicao({ tipo: "bloco", bloco: { titulo: "", incentivo: "" } })}><Plus className="mr-1 inline h-3.5 w-3.5" />Bloco</Pilula>
                            <Pilula destaque onClick={() => setEdicao({ tipo: "pergunta", pergunta: { tipo: "escala", escala_min: 0, escala_max: 10, obrigatoria: true, bloco_id: blocos[0]?.id } })}>
                                <Plus className="mr-1 inline h-3.5 w-3.5" />Pergunta
                            </Pilula>
                        </>
                    )}
                </div>
            </div>

            {respondidas.size > 0 && (
                <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                    {respondidas.size} pergunta(s) já têm resposta oficial. Essas podem ter o texto e os rótulos ajustados, mas não mudam de tipo, escala ou opções e não podem ser excluídas.
                </p>
            )}

            {blocos.map((b, bi) => {
                const ps = perguntasDo(b.id)
                const aberto = abertos.has(b.id)
                return (
                    <section key={b.id} className="rounded-2xl bg-[var(--bg-card-hover)]/60">
                        <div className="flex items-center gap-2 px-2 py-2">
                            <button type="button" aria-expanded={aberto} onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })}
                                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />}
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-[var(--text-main)]">{bi + 1}. {b.titulo}</span>
                                    {b.incentivo && <span className="block truncate text-[11px] text-[var(--text-muted)]">Pausa: “{b.incentivo}”</span>}
                                </span>
                                <span className="shrink-0 text-xs text-[var(--text-muted)]">{ps.length} {ps.length === 1 ? "pergunta" : "perguntas"}</span>
                            </button>
                            {admin && (
                                <div className="flex shrink-0 gap-0.5">
                                    <IconBtn label="Mover bloco para cima" onClick={() => moverBloco(bi, -1)} disabled={bi === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
                                    <IconBtn label="Mover bloco para baixo" onClick={() => moverBloco(bi, 1)} disabled={bi === blocos.length - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
                                    <IconBtn label="Editar bloco" onClick={() => setEdicao({ tipo: "bloco", bloco: b })}><Pencil className="h-4 w-4" /></IconBtn>
                                    <IconBtn label="Excluir bloco" onClick={() => { if (confirm(`Excluir o bloco "${b.titulo}"?`)) excluir.mutate({ tipo: "bloco", id: b.id }) }} disabled={ps.length > 0}><Trash2 className="h-4 w-4" /></IconBtn>
                                </div>
                            )}
                        </div>
                        {aberto && (
                            <div className="space-y-0.5 px-1 pb-2">
                                {ps.map((p, pi) => {
                                    const travada = respondidas.has(String(p.id))
                                    return (
                                        <div key={p.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--bg-card)]">
                                            <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[var(--text-muted)]">{p.ordem}</span>
                                            <div className="min-w-0 flex-1 space-y-1.5">
                                                <p className="text-sm text-[var(--text-main)]">{p.texto}</p>
                                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                                    <Tag>{rotuloTipo(p)}</Tag>
                                                    {!p.obrigatoria && <Tag>opcional</Tag>}
                                                    {p.chave === "curso" && <Tag>curso (filtro)</Tag>}
                                                    {travada && <Tag cor="amber">com respostas</Tag>}
                                                </div>
                                            </div>
                                            {admin && (
                                                <div className="flex shrink-0 gap-0.5">
                                                    <IconBtn label="Mover para cima" onClick={() => moverPergunta(b.id, pi, -1)} disabled={pi === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
                                                    <IconBtn label="Mover para baixo" onClick={() => moverPergunta(b.id, pi, 1)} disabled={pi === ps.length - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
                                                    <IconBtn label="Editar pergunta" onClick={() => setEdicao({ tipo: "pergunta", pergunta: p })}><Pencil className="h-4 w-4" /></IconBtn>
                                                    <IconBtn label="Excluir pergunta" disabled={travada} onClick={() => { if (confirm("Excluir esta pergunta?")) excluir.mutate({ tipo: "pergunta", id: p.id }) }}><Trash2 className="h-4 w-4" /></IconBtn>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                                {ps.length === 0 && <p className="px-3 py-2 text-xs text-[var(--text-muted)]">Bloco sem perguntas.</p>}
                            </div>
                        )}
                    </section>
                )
            })}

            {edicao && (
                <Dialogo titulo={edicao.tipo === "bloco" ? (edicao.bloco.id ? "Editar bloco" : "Novo bloco") : (edicao.pergunta.id ? "Editar pergunta" : "Nova pergunta")} onFechar={() => setEdicao(null)}>
                    {edicao.tipo === "bloco"
                        ? <FormBloco valor={edicao.bloco} salvando={salvar.isPending} onSalvar={(bloco) => salvar.mutate({ tipo: "bloco", bloco })} />
                        : <FormPergunta valor={edicao.pergunta} blocos={blocos} travada={!!edicao.pergunta.id && respondidas.has(String(edicao.pergunta.id))}
                            salvando={salvar.isPending} onSalvar={(pergunta) => salvar.mutate({ tipo: "pergunta", pergunta })} />}
                </Dialogo>
            )}
        </div>
    )
}

function rotuloTipo(p: PerguntaAdmin) {
    if (p.tipo === "escala") return `nota ${p.escala_min} a ${p.escala_max}`
    if (p.tipo === "escolha") return `escolha (${p.opcoes.length} opções)`
    return "texto livre"
}

function FormBloco({ valor, salvando, onSalvar }: { valor: Partial<BlocoAdmin>; salvando: boolean; onSalvar: (b: Partial<BlocoAdmin>) => void }) {
    const [titulo, setTitulo] = useState(valor.titulo ?? "")
    const [incentivo, setIncentivo] = useState(valor.incentivo ?? "")
    return (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSalvar({ id: valor.id, titulo, incentivo }) }}>
            <Campo rotulo="Título do bloco"><Inp value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} required /></Campo>
            <Campo rotulo="Frase de incentivo (aparece na pausa depois do bloco; opcional)">
                <Inp value={incentivo} onChange={(e) => setIncentivo(e.target.value)} maxLength={200} />
            </Campo>
            <Rodape salvando={salvando} />
        </form>
    )
}

function FormPergunta({ valor, blocos, travada, salvando, onSalvar }: {
    valor: Partial<PerguntaAdmin> & { bloco_id?: number }; blocos: BlocoAdmin[]; travada: boolean; salvando: boolean
    onSalvar: (p: Record<string, unknown>) => void
}) {
    const [f, setF] = useState({
        texto: valor.texto ?? "", bloco_id: valor.bloco_id ?? blocos[0]?.id ?? 0,
        tipo: valor.tipo ?? "escala", escala_min: valor.escala_min ?? 0, escala_max: valor.escala_max ?? 10,
        rotulo_min: valor.rotulo_min ?? "", rotulo_max: valor.rotulo_max ?? "",
        opcoes: (valor.opcoes ?? []).join("\n"), obrigatoria: valor.obrigatoria ?? true, chave: valor.chave ?? "",
    })
    const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }))
    return (
        <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault()
            onSalvar({
                id: valor.id, texto: f.texto, bloco_id: Number(f.bloco_id), tipo: f.tipo,
                escala_min: f.escala_min, escala_max: f.escala_max, rotulo_min: f.rotulo_min, rotulo_max: f.rotulo_max,
                opcoes: f.opcoes.split("\n").map((o) => o.trim()).filter(Boolean),
                obrigatoria: f.obrigatoria, chave: f.chave || null,
            })
        }}>
            <Campo rotulo="Texto da pergunta">
                <textarea value={f.texto} onChange={(e) => set("texto", e.target.value)} rows={3} maxLength={500} required
                    className="w-full rounded-lg bg-[var(--bg-card-hover)] p-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Bloco">
                    <select className="h-9 w-full rounded-lg bg-[var(--bg-card-hover)] px-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" value={f.bloco_id} onChange={(e) => set("bloco_id", Number(e.target.value))}>
                        {blocos.map((b) => <option key={b.id} value={b.id}>{b.titulo}</option>)}
                    </select>
                </Campo>
                <Campo rotulo="Tipo">
                    <select className="h-9 w-full rounded-lg bg-[var(--bg-card-hover)] px-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" value={f.tipo} disabled={travada} onChange={(e) => set("tipo", e.target.value)}>
                        <option value="escala">Nota (escala)</option>
                        <option value="escolha">Escolha única</option>
                        <option value="texto">Texto livre</option>
                    </select>
                </Campo>
            </div>
            {f.tipo === "escala" && (
                <div className="grid grid-cols-2 gap-3">
                    <Campo rotulo="Nota mínima"><Inp type="number" value={f.escala_min} disabled={travada} onChange={(e) => set("escala_min", Number(e.target.value))} /></Campo>
                    <Campo rotulo="Nota máxima"><Inp type="number" value={f.escala_max} disabled={travada} onChange={(e) => set("escala_max", Number(e.target.value))} /></Campo>
                    <Campo rotulo="Rótulo da nota mínima"><Inp value={f.rotulo_min} onChange={(e) => set("rotulo_min", e.target.value)} /></Campo>
                    <Campo rotulo="Rótulo da nota máxima"><Inp value={f.rotulo_max} onChange={(e) => set("rotulo_max", e.target.value)} /></Campo>
                </div>
            )}
            {f.tipo === "escolha" && (
                <Campo rotulo="Opções (uma por linha)">
                    <textarea value={f.opcoes} disabled={travada} onChange={(e) => set("opcoes", e.target.value)} rows={5}
                        className="w-full rounded-lg bg-[var(--bg-card-hover)] p-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60" />
                </Campo>
            )}
            <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Papel da pergunta">
                    <select className="h-9 w-full rounded-lg bg-[var(--bg-card-hover)] px-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" value={f.chave} disabled={travada} onChange={(e) => set("chave", e.target.value)}>
                        <option value="">Pergunta comum</option>
                        <option value="curso">Curso (alimenta o filtro de curso)</option>
                    </select>
                </Campo>
                <label className="flex items-end gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={f.obrigatoria} onChange={(e) => set("obrigatoria", e.target.checked)} /> Obrigatória
                </label>
            </div>
            {travada && <p className="text-xs text-amber-800">Esta pergunta já tem respostas oficiais: tipo, escala, opções e papel ficam travados.</p>}
            <Rodape salvando={salvando} />
        </form>
    )
}

function Dialogo({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onFechar}>
            <div className="mt-10 w-full max-w-lg glass-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{titulo}</h2>
                    <button type="button" aria-label="Fechar" onClick={onFechar}><X className="h-4 w-4" /></button>
                </div>
                {children}
            </div>
        </div>,
        document.body,
    )
}

function Rodape({ salvando }: { salvando: boolean }) {
    return (
        <div className="flex justify-end pt-2">
            <Btn type="submit" disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Btn>
        </div>
    )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return <label className="block space-y-1"><span className="text-xs text-muted-foreground">{rotulo}</span>{children}</label>
}

function Pilula({ onClick, destaque, children }: { onClick: () => void; destaque?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick}
            className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${destaque ? "bg-primary text-white" : "bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>
            {children}
        </button>
    )
}

function Tag({ children, cor }: { children: React.ReactNode; cor?: "amber" }) {
    return <span className={`rounded-full px-2 py-0.5 ${cor === "amber" ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : "bg-[var(--bg-card-hover)] text-[var(--text-muted)]"}`}>{children}</span>
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-main)] disabled:opacity-35">
            {children}
        </button>
    )
}
