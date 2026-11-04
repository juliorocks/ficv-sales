// Gestão > Painel do Projeto (só admin): andamento do desenvolvimento do Super Portal Cidade Viva.
// Dados nas tabelas projeto_* (RLS is_admin). O admin edita tarefas, marcos e registro aqui mesmo;
// concluir uma tarefa grava a data e uma linha no registro.
import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { withTimeout } from "@/utils/withTimeout"
import { showError, showSuccess } from "@/utils/toast"
import { Btn, CAMPO, Inp } from "../cpa/cpaUi"

type Status = "planejado" | "andamento" | "concluido" | "bloqueado"
type Config = { nome: string; inicio: string; fim: string; duracao_meses: number }
type Frente = { id: string; sistema: string; nome: string; descricao: string | null; inicio: string | null; fim: string | null; ordem: number }
type Tarefa = {
    id: number; frente_id: string; titulo: string; status: Status; progresso: number; inicio: string | null; fim: string | null
    concluido_em: string | null; prioridade: "normal" | "alta"; previo: boolean; ordem: number
}
type Marco = { id: number; titulo: string; data: string | null; feito: boolean; ordem: number }
type Registro = { id: number; data: string; texto: string }
type Dados = { config: Config; frentes: Frente[]; tarefas: Tarefa[]; marcos: Marco[]; registro: Registro[] }

const SISTEMAS = [
    { id: "projeto", nome: "Projeto e infraestrutura" },
    { id: "ficv", nome: "FICV (Faculdade)" },
    { id: "escola", nome: "Escola Cidade Viva Academy" },
    { id: "gerencial", nome: "Gerencial (sistema pai)" },
]
const STATUS: Record<Status, { nome: string; cor: string; texto: string }> = {
    planejado: { nome: "Planejado", cor: "var(--text-muted)", texto: "var(--text-muted)" },
    andamento: { nome: "Em andamento", cor: "var(--primary)", texto: "var(--primary)" },
    concluido: { nome: "Concluído", cor: "var(--success)", texto: "var(--success-text)" },
    bloqueado: { nome: "Bloqueado", cor: "var(--danger)", texto: "var(--danger)" },
}
const GRADE = "color-mix(in srgb, var(--text-muted) 22%, transparent)"
const suave = (cor: string, p = 16) => `color-mix(in srgb, ${cor} ${p}%, transparent)`

const D = (s: string | null): Date | null => {
    if (!s) return null
    const [y, m, d] = s.split("-").map(Number)
    return new Date(y, m - 1, d)
}
const paraIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const dm = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
const dmy = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
const pct = (n: number) => Math.round(n * 100)
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

const hojeData = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()) }

const prog = (t: Tarefa) => (t.status === "concluido" ? 1 : t.status === "andamento" ? Math.max(0, Math.min(100, t.progresso)) / 100 : 0)
const atrasada = (t: Tarefa, hoje: Date) => t.status !== "concluido" && !!t.fim && D(t.fim)! < hoje

function stats(ts: Tarefa[]) {
    const n = ts.length
    let done = 0, and = 0, block = 0, soma = 0, somaPrevio = 0
    for (const t of ts) {
        soma += prog(t)
        if (t.previo) somaPrevio += prog(t)
        if (t.status === "concluido") done++
        else if (t.status === "andamento") and++
        else if (t.status === "bloqueado") block++
    }
    const status: Status = n === 0 ? "planejado" : done === n ? "concluido" : block > 0 ? "bloqueado" : and > 0 || done > 0 ? "andamento" : "planejado"
    return { n, done, and, block, pct: n ? soma / n : 0, previoPct: n ? somaPrevio / n : 0, status }
}

function janela(f: Frente, ts: Tarefa[]): { a: Date; b: Date } | null {
    let a = D(f.inicio), b = D(f.fim)
    if (!a || !b) {
        for (const t of ts) {
            const ta = D(t.inicio), tb = D(t.fim ?? t.inicio)
            if (ta && (!a || ta < a)) a = ta
            if (tb && (!b || tb > b)) b = tb
        }
    }
    return a && b ? { a, b } : null
}

const prazoTexto = (t: Tarefa) => {
    const a = D(t.inicio), b = D(t.fim)
    if (a && b) return a.getTime() === b.getTime() ? dm(a) : `${dm(a)} a ${dm(b)}`
    if (b) return `até ${dm(b)}`
    return "data a definir"
}

async function sessao() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error("Sua sessão expirou. Entre de novo.")
}
async function conferir<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, rotulo: string) {
    const { data, error } = await withTimeout(consulta, 15000, rotulo)
    if (error) throw new Error(error.message)
    // token em refresh faz UPDATE filtrar 0 linhas sem erro
    if (!data?.length) throw new Error("Nada foi salvo. Recarregue a página e tente de novo.")
}

export function ProjetoPainel() {
    const qc = useQueryClient()
    const [filtro, setFiltro] = useState("todos")
    const [tarefaEdit, setTarefaEdit] = useState<Partial<Tarefa> | null>(null)
    const [frenteEdit, setFrenteEdit] = useState<Frente | null>(null)

    const { data, isLoading, error } = useQuery({
        queryKey: ["projeto-painel"],
        queryFn: async (): Promise<Dados> => {
            const ler = async <T,>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, nome: string) => {
                const { data, error } = await withTimeout(p, 15000, nome)
                if (error) throw new Error(error.message)
                return data as T
            }
            const [config, frentes, tarefas, marcos, registro] = await Promise.all([
                ler<Config>(supabase.from("projeto_config").select("nome, inicio, fim, duracao_meses").single(), "O painel"),
                ler<Frente[]>(supabase.from("projeto_frentes").select("*").order("ordem"), "As frentes"),
                ler<Tarefa[]>(supabase.from("projeto_tarefas").select("*").order("ordem").order("id"), "As tarefas"),
                ler<Marco[]>(supabase.from("projeto_marcos").select("*").order("ordem"), "Os marcos"),
                ler<Registro[]>(supabase.from("projeto_registro").select("*").order("data", { ascending: false }).order("id", { ascending: false }).limit(30), "O registro"),
            ])
            return { config, frentes, tarefas, marcos, registro }
        },
    })
    const atualizar = () => qc.invalidateQueries({ queryKey: ["projeto-painel"] })
    const falha = (e: unknown) => showError(e instanceof Error ? e.message : "Não foi possível salvar.")

    const salvarTarefa = useMutation({
        mutationFn: async (t: Partial<Tarefa>) => {
            await sessao()
            if (!t.titulo?.trim()) throw new Error("Escreva o título da tarefa.")
            if (t.inicio && t.fim && t.fim < t.inicio) throw new Error("O fim precisa ser depois do início.")
            const status = t.status ?? "planejado"
            const payload = {
                frente_id: t.frente_id, titulo: t.titulo.trim(), status,
                progresso: status === "concluido" ? 100 : status === "planejado" ? 0 : Math.max(0, Math.min(100, Number(t.progresso) || 0)),
                inicio: t.inicio || null, fim: t.fim || null,
                concluido_em: status === "concluido" ? t.concluido_em || paraIso(hojeData()) : null,
                prioridade: t.prioridade ?? "normal", previo: !!t.previo, updated_at: new Date().toISOString(),
            }
            if (t.id) await conferir(supabase.from("projeto_tarefas").update(payload).eq("id", t.id).select("id"), "O salvamento")
            else {
                const ordem = (data?.tarefas.filter((x) => x.frente_id === t.frente_id).reduce((m, x) => Math.max(m, x.ordem), 0) ?? 0) + 1
                await conferir(supabase.from("projeto_tarefas").insert({ ...payload, ordem }).select("id"), "O salvamento")
            }
        },
        onSuccess: () => { setTarefaEdit(null); atualizar(); showSuccess("Tarefa salva.") },
        onError: falha,
    })

    const mudarStatus = useMutation({
        mutationFn: async ({ t, status }: { t: Tarefa; status: Status }) => {
            await sessao()
            const hoje = paraIso(hojeData())
            const payload = {
                status,
                progresso: status === "concluido" ? 100 : status === "planejado" ? 0 : t.progresso,
                concluido_em: status === "concluido" ? hoje : null,
                inicio: status === "andamento" && !t.inicio ? hoje : t.inicio,
                updated_at: new Date().toISOString(),
            }
            await conferir(supabase.from("projeto_tarefas").update(payload).eq("id", t.id).select("id"), "A mudança de status")
            if (status === "concluido") await supabase.from("projeto_registro").insert({ data: hoje, texto: `Concluído: ${t.titulo}` })
        },
        onSuccess: atualizar,
        onError: falha,
    })

    const excluirTarefa = useMutation({
        mutationFn: async (id: number) => { await sessao(); await conferir(supabase.from("projeto_tarefas").delete().eq("id", id).select("id"), "A exclusão") },
        onSuccess: () => { setTarefaEdit(null); atualizar() },
        onError: falha,
    })

    const salvarFrente = useMutation({
        mutationFn: async (f: Frente) => {
            await sessao()
            if (f.inicio && f.fim && f.fim < f.inicio) throw new Error("O fim precisa ser depois do início.")
            await conferir(supabase.from("projeto_frentes").update({ nome: f.nome.trim(), descricao: f.descricao?.trim() || null, inicio: f.inicio || null, fim: f.fim || null }).eq("id", f.id).select("id"), "O salvamento")
        },
        onSuccess: () => { setFrenteEdit(null); atualizar(); showSuccess("Frente salva.") },
        onError: falha,
    })

    const alterarMarco = useMutation({
        mutationFn: async ({ m, campos }: { m: Marco; campos: Partial<Pick<Marco, "feito" | "data">> }) => {
            await sessao()
            await conferir(supabase.from("projeto_marcos").update(campos).eq("id", m.id).select("id"), "A mudança do marco")
            if (campos.feito) await supabase.from("projeto_registro").insert({ data: paraIso(hojeData()), texto: `Marco concluído: ${m.titulo}` })
        },
        onSuccess: atualizar,
        onError: falha,
    })

    const [nota, setNota] = useState("")
    const registrar = useMutation({
        mutationFn: async (texto: string) => {
            await sessao()
            await conferir(supabase.from("projeto_registro").insert({ data: paraIso(hojeData()), texto: texto.trim() }).select("id"), "O registro")
        },
        onSuccess: () => { setNota(""); atualizar() },
        onError: falha,
    })

    const hoje = useMemo(hojeData, [])
    const calc = useMemo(() => {
        if (!data) return null
        const frentes = data.frentes.filter((f) => SISTEMAS.some((s) => s.id === f.sistema))
        const porFrente: Record<string, Tarefa[]> = {}
        frentes.forEach((f) => { porFrente[f.id] = [] })
        const tarefas = data.tarefas.filter((t) => porFrente[t.frente_id])
        tarefas.forEach((t) => porFrente[t.frente_id].push(t))
        return { frentes, porFrente, tarefas, geral: stats(tarefas) }
    }, [data])

    if (isLoading) return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
    if (error || !data || !calc) return <p className="p-6 text-sm text-destructive">{(error as Error | null)?.message ?? "Não foi possível carregar o painel."}</p>

    const { config, marcos, registro } = data
    const { frentes, porFrente, tarefas, geral } = calc
    const P = D(config.inicio)!, E = D(config.fim)!
    const tempo = hoje >= E ? 1 : hoje > P ? (hoje.getTime() - P.getTime()) / (E.getTime() - P.getTime()) : 0
    const mes = hoje < P ? 0 : Math.min(config.duracao_meses, (hoje.getFullYear() - P.getFullYear()) * 12 + hoje.getMonth() - P.getMonth() + 1)
    const atraso = tarefas.filter((t) => atrasada(t, hoje)).length
    const atencao = geral.block + atraso
    const previos = tarefas.filter((t) => t.previo).length
    const nomeFrente: Record<string, string> = {}
    frentes.forEach((f) => { nomeFrente[f.id] = f.nome })
    const emAndamento = tarefas.filter((t) => t.status === "andamento" || t.status === "bloqueado")
    const proximos = tarefas.filter((t) => t.status === "planejado" && t.prioridade === "alta").slice(0, 5)
    const marcosOrd = [...marcos].sort((a, b) => (a.data && b.data ? a.data.localeCompare(b.data) : a.data ? -1 : b.data ? 1 : a.ordem - b.ordem))
    const frentesCompletas = frentes.filter((f) => stats(porFrente[f.id]).status === "concluido").length

    return (
        <div className="mx-auto max-w-6xl space-y-9 pb-16">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 pb-5" style={{ borderColor: "var(--warning)" }}>
                <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: "var(--warning)" }}>Painel do projeto</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight text-[var(--text-main)]">{config.nome}</h2>
                    <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
                        Sistema da Fundação, da FICV e da Escola Cidade Viva Academy, em {config.duracao_meses} meses. O que já existia entra como concluído.
                    </p>
                </div>
                <div className="flex flex-col text-sm text-[var(--text-muted)] sm:text-right">
                    <b className="text-lg text-[var(--text-main)]">{mes === 0 ? `Início em ${dmy(P)}` : `Mês ${mes} de ${config.duracao_meses}`}</b>
                    <span>{dmy(P)} até {dmy(E)}</span>
                </div>
            </header>

            <section className="space-y-4">
                <div className="glass-card space-y-5 p-5">
                    <Barra rotulo="Prazo do projeto" valor={pct(tempo)} sub={`Tempo decorrido dos ${config.duracao_meses} meses`}
                        segmentos={[{ largura: pct(tempo), cor: "var(--warning)" }]} />
                    <Barra rotulo="Entregas" valor={pct(geral.pct)}
                        sub={`${geral.done} de ${geral.n} tarefas concluídas, sendo ${previos} que já existiam antes do contrato. Cada tarefa pesa o mesmo.`}
                        segmentos={[
                            { largura: pct(geral.previoPct), cor: suave("var(--success)", 45) },
                            { largura: pct(geral.pct) - pct(geral.previoPct), cor: "var(--success)" },
                        ]} />
                    <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
                        <Legenda cor={suave("var(--success)", 45)} texto="Já existia antes do contrato" />
                        <Legenda cor="var(--success)" texto="Entregue durante o contrato" />
                    </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi n={`${geral.done} de ${geral.n}`} l="Tarefas concluídas" s={`${frentesCompletas} de ${frentes.length} frentes completas`} />
                    <Kpi n={String(geral.and)} l="Em andamento" s={geral.and ? "trabalhando agora" : "nada em execução neste momento"} />
                    <Kpi n={String(geral.n - geral.done - geral.and - geral.block)} l="A fazer" s="ainda não começaram" />
                    <Kpi n={String(atencao)} l="Precisam de atenção" alerta={atencao > 0}
                        s={atencao ? `${plural(geral.block, "bloqueada", "bloqueadas")} e ${plural(atraso, "atrasada", "atrasadas")}` : "nenhuma bloqueada ou atrasada"} />
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="text-xl font-bold text-[var(--text-main)]">Agora</h3>
                <div className="grid gap-3 md:grid-cols-2">
                    <div className="glass-card p-5">
                        <p className="mb-3 text-sm font-semibold">Em andamento</p>
                        {emAndamento.length
                            ? <ul className="space-y-3">{emAndamento.map((t) => <ItemLista key={t.id} t={t} frente={nomeFrente[t.frente_id]} hoje={hoje} progresso />)}</ul>
                            : <p className="text-sm text-[var(--text-muted)]">Nada em andamento neste momento. Os próximos passos estão ao lado.</p>}
                    </div>
                    <div className="glass-card p-5">
                        <p className="mb-3 text-sm font-semibold">Próximos passos</p>
                        {proximos.length
                            ? <ul className="space-y-3">{proximos.map((t) => <ItemLista key={t.id} t={t} frente={nomeFrente[t.frente_id]} hoje={hoje} />)}</ul>
                            : <p className="text-sm text-[var(--text-muted)]">Nenhum passo prioritário marcado. Marque tarefas com prioridade alta para elas aparecerem aqui.</p>}
                    </div>
                </div>
            </section>

            <Cronograma config={config} frentes={frentes} porFrente={porFrente} marcos={marcos} hoje={hoje} />

            <section className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xl font-bold text-[var(--text-main)]">Frentes de trabalho</h3>
                    <span className="text-xs text-[var(--text-muted)]">{plural(frentes.length, "frente", "frentes")} em {SISTEMAS.length} sistemas</span>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por sistema">
                    {[{ id: "todos", nome: "Todos" }, ...SISTEMAS].map((s) => (
                        <button key={s.id} type="button" aria-pressed={filtro === s.id} onClick={() => setFiltro(s.id)}
                            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${filtro === s.id ? "bg-[var(--text-main)] text-[var(--bg-main)]" : "bg-[var(--bg-card)] text-[var(--text-main)] shadow-[var(--card-shadow)]"}`}>
                            {s.nome}
                        </button>
                    ))}
                </div>
                {SISTEMAS.filter((s) => filtro === "todos" || filtro === s.id).map((s) => {
                    const fs = frentes.filter((f) => f.sistema === s.id)
                    if (!fs.length) return null
                    const ts = fs.flatMap((f) => porFrente[f.id])
                    const ss = stats(ts)
                    return (
                        <div key={s.id} className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h4 className="text-base font-bold">{s.nome}</h4>
                                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                    <div className="h-2 w-36 overflow-hidden rounded-full bg-[var(--bg-card-hover)]"><i className="block h-full rounded-full" style={{ width: `${pct(ss.pct)}%`, background: "var(--success)" }} /></div>
                                    {pct(ss.pct)}%
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {fs.map((f) => (
                                    <FrenteCard key={f.id} f={f} ts={porFrente[f.id]} hoje={hoje}
                                        onEditarFrente={() => setFrenteEdit(f)}
                                        onNova={() => setTarefaEdit({ frente_id: f.id, status: "planejado", prioridade: "normal", previo: false, progresso: 0 })}
                                        onEditar={(t) => setTarefaEdit(t)}
                                        onStatus={(t, status) => mudarStatus.mutate({ t, status })}
                                        ocupado={mudarStatus.isPending} />
                                ))}
                            </div>
                        </div>
                    )
                })}
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
                <div className="glass-card p-5">
                    <p className="mb-2 text-sm font-semibold">Marcos do projeto</p>
                    <ul>
                        {marcosOrd.map((m) => (
                            <li key={m.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--bg-card-hover)] py-2.5 last:border-0">
                                <input type="date" aria-label={`Data de ${m.titulo}`} className={`${CAMPO} !w-auto !py-1`} value={m.data ?? ""}
                                    onChange={(e) => alterarMarco.mutate({ m, campos: { data: e.target.value || null } })} />
                                <span className="min-w-0 flex-1 text-sm">{m.titulo}</span>
                                <button type="button" onClick={() => alterarMarco.mutate({ m, campos: { feito: !m.feito } })} disabled={alterarMarco.isPending}
                                    className="rounded-full px-3 py-0.5 text-xs font-semibold"
                                    style={m.feito ? { color: STATUS.concluido.texto, background: suave(STATUS.concluido.cor) } : { color: STATUS.planejado.texto, background: suave(STATUS.planejado.cor) }}>
                                    {m.feito ? "Concluído" : "Marcar como concluído"}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="glass-card space-y-3 p-5">
                    <p className="text-sm font-semibold">Últimas atualizações</p>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (nota.trim()) registrar.mutate(nota) }}>
                        <Inp value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Registrar uma atualização" aria-label="Nova atualização" />
                        <Btn type="submit" size="sm" disabled={registrar.isPending || !nota.trim()}>Registrar</Btn>
                    </form>
                    <ul className="space-y-2.5">
                        {registro.slice(0, 12).map((r) => (
                            <li key={r.id} className="grid grid-cols-[88px_1fr] gap-3 text-sm">
                                <span className="text-[13px] text-[var(--text-muted)]">{dmy(D(r.data)!)}</span>
                                <span>{r.texto}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            {tarefaEdit && (
                <FormTarefa valor={tarefaEdit} frentes={frentes} salvando={salvarTarefa.isPending}
                    onSalvar={(t) => salvarTarefa.mutate(t)} onExcluir={tarefaEdit.id ? () => { if (confirm(`Excluir a tarefa "${tarefaEdit.titulo}"?`)) excluirTarefa.mutate(tarefaEdit.id!) } : undefined}
                    onFechar={() => setTarefaEdit(null)} />
            )}
            {frenteEdit && <FormFrente valor={frenteEdit} salvando={salvarFrente.isPending} onSalvar={(f) => salvarFrente.mutate(f)} onFechar={() => setFrenteEdit(null)} />}
        </div>
    )
}

function Barra({ rotulo, valor, sub, segmentos }: { rotulo: string; valor: number; sub: string; segmentos: { largura: number; cor: string }[] }) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{rotulo}</span>
                <span className="text-2xl font-bold leading-none tabular-nums">{valor}%</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-[var(--bg-card-hover)]">
                {segmentos.map((s, i) => <i key={i} className="block h-full" style={{ width: `${Math.max(0, s.largura)}%`, background: s.cor }} />)}
            </div>
            <p className="text-[13px] text-[var(--text-muted)]">{sub}</p>
        </div>
    )
}

const Legenda = ({ cor, texto }: { cor: string; texto: string }) => (
    <span className="flex items-center gap-1.5"><i className="block h-2.5 w-2.5 rounded-full" style={{ background: cor }} />{texto}</span>
)

function Kpi({ n, l, s, alerta }: { n: string; l: string; s: string; alerta?: boolean }) {
    return (
        <div className="glass-card flex flex-col gap-1 p-5">
            <span className="text-3xl font-bold leading-tight tabular-nums" style={alerta ? { color: "var(--danger)" } : undefined}>{n}</span>
            <span className="font-semibold">{l}</span>
            <span className="text-[13px] text-[var(--text-muted)]">{s}</span>
        </div>
    )
}

function Ponto({ status }: { status: Status }) {
    const s = STATUS[status]
    const base = "mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none"
    if (status === "concluido") return <span aria-hidden className={`${base} text-white`} style={{ background: s.cor }}>✓</span>
    if (status === "bloqueado") return <span aria-hidden className={`${base} text-white`} style={{ background: s.cor }}>!</span>
    if (status === "andamento") return <span aria-hidden className={base} style={{ border: `2px solid ${s.cor}`, background: `conic-gradient(${s.cor} 0 50%, transparent 50% 100%)` }} />
    return <span aria-hidden className={base} style={{ border: `2px solid ${s.cor}` }} />
}

const Pilula = ({ status }: { status: Status }) => (
    <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: STATUS[status].texto, background: suave(STATUS[status].cor) }}>{STATUS[status].nome}</span>
)

function ItemLista({ t, frente, hoje, progresso }: { t: Tarefa; frente: string; hoje: Date; progresso?: boolean }) {
    return (
        <li className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5">
            <Ponto status={t.status} />
            <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-sm">{t.titulo}</p>
                <p className="text-xs text-[var(--text-muted)]">{frente} · {prazoTexto(t)}{progresso && t.status === "andamento" ? ` · ${t.progresso}%` : ""}</p>
                {atrasada(t, hoje) && <p className="text-xs font-semibold" style={{ color: "var(--danger)" }}>Atrasada</p>}
            </div>
            {t.prioridade === "alta" && <span className="rounded-full border px-2 text-[11px] font-bold" style={{ color: "var(--warning)", borderColor: "var(--warning)" }}>Alta</span>}
        </li>
    )
}

function FrenteCard({ f, ts, hoje, onEditarFrente, onNova, onEditar, onStatus, ocupado }: {
    f: Frente; ts: Tarefa[]; hoje: Date; onEditarFrente: () => void; onNova: () => void
    onEditar: (t: Tarefa) => void; onStatus: (t: Tarefa, s: Status) => void; ocupado: boolean
}) {
    const s = stats(ts)
    return (
        <div className="glass-card flex min-w-0 flex-col gap-2.5 p-5">
            <div className="flex items-start justify-between gap-2">
                <h5 className="text-base font-bold leading-snug">{f.nome}</h5>
                <div className="flex items-center gap-1">
                    <Pilula status={s.status} />
                    <button type="button" aria-label={`Editar ${f.nome}`} title="Editar frente" onClick={onEditarFrente} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]"><Pencil className="h-3.5 w-3.5" /></button>
                </div>
            </div>
            {f.descricao && <p className="text-[13.5px] text-[var(--text-muted)]">{f.descricao}</p>}
            <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--bg-card-hover)]">
                <i className="block h-full" style={{ width: `${pct(s.previoPct)}%`, background: suave("var(--success)", 45) }} />
                <i className="block h-full" style={{ width: `${Math.max(0, pct(s.pct) - pct(s.previoPct))}%`, background: "var(--success)" }} />
            </div>
            <div className="flex justify-between text-[13px] text-[var(--text-muted)]"><span>{s.done} de {s.n} concluídas</span><span>{pct(s.pct)}%</span></div>
            <details>
                <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: "var(--primary)" }}>Ver tarefas</summary>
                <ul className="space-y-2.5 pt-3">
                    {ts.map((t) => (
                        <li key={t.id} className="grid grid-cols-[auto_1fr] items-start gap-2 text-[13.5px]">
                            <Ponto status={t.status} />
                            <div className="min-w-0 space-y-1">
                                <p className="[overflow-wrap:anywhere]">{t.titulo}{t.previo && <span className="ml-1.5 rounded-full bg-[var(--bg-card-hover)] px-2 py-px text-[11px] text-[var(--text-muted)]">já existia</span>}</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {prazoTexto(t)}{t.status === "andamento" ? ` · ${t.progresso}%` : ""}{t.concluido_em ? ` · concluída em ${dmy(D(t.concluido_em)!)}` : ""}
                                </p>
                                {atrasada(t, hoje) && <p className="text-xs font-semibold" style={{ color: "var(--danger)" }}>Atrasada</p>}
                                <div className="flex items-center gap-1">
                                    <select aria-label={`Status de ${t.titulo}`} value={t.status} disabled={ocupado} onChange={(e) => onStatus(t, e.target.value as Status)}
                                        className={`${CAMPO} !w-auto !py-1 !text-xs`}>
                                        {(Object.keys(STATUS) as Status[]).map((k) => <option key={k} value={k}>{STATUS[k].nome}</option>)}
                                    </select>
                                    <button type="button" aria-label="Editar tarefa" title="Editar tarefa" onClick={() => onEditar(t)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]"><Pencil className="h-3.5 w-3.5" /></button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
                <button type="button" onClick={onNova} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"><Plus className="h-3.5 w-3.5" /> Nova tarefa</button>
            </details>
        </div>
    )
}

function Cronograma({ config, frentes, porFrente, marcos, hoje }: { config: Config; frentes: Frente[]; porFrente: Record<string, Tarefa[]>; marcos: Marco[]; hoje: Date }) {
    const P = D(config.inicio)!, E = D(config.fim)!
    const N = (E.getFullYear() - P.getFullYear()) * 12 + E.getMonth() - P.getMonth() + 1
    const pos = (d: Date) => {
        const m = (d.getFullYear() - P.getFullYear()) * 12 + d.getMonth() - P.getMonth()
        const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
        return Math.max(0, Math.min(100, ((m + (d.getDate() - 1) / dim) / N) * 100))
    }
    const meses = Array.from({ length: N }, (_, i) => new Date(P.getFullYear(), P.getMonth() + i, 1))
    const porData: Record<string, Marco[]> = {}
    marcos.forEach((m) => { if (m.data) (porData[m.data] ??= []).push(m) })
    let algumaData = false
    const linhaGrade = { backgroundImage: `linear-gradient(to right, ${GRADE} 1px, transparent 1px)`, backgroundSize: `calc(100% / ${N}) 100%` }
    const lab = "210px"

    const grupos = SISTEMAS.map((s) => {
        const fs = frentes.filter((f) => f.sistema === s.id)
        if (!fs.length) return null
        return (
            <div key={s.id}>
                <p className="pb-0.5 pt-3 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--warning)" }}>{s.nome}</p>
                {fs.map((f) => {
                    const ts = porFrente[f.id], st = stats(ts), w = janela(f, ts)
                    if (w) algumaData = true
                    const todoPrevio = ts.length > 0 && ts.every((t) => t.previo && t.status === "concluido")
                    const esq = w ? pos(w.a) : 0
                    const larg = w ? Math.max(pos(new Date(w.b.getFullYear(), w.b.getMonth(), w.b.getDate() + 1)) - esq, 0.9) : 0
                    return (
                        <div key={f.id} className="grid min-h-8 items-center" style={{ gridTemplateColumns: `${lab} 1fr` }}>
                            <div className="truncate pr-3 text-[13px]" title={f.nome}>{f.nome}</div>
                            <div className="relative h-8" style={{ ...linhaGrade, borderRight: `1px solid ${GRADE}` }}>
                                {w ? (
                                    <div className="absolute top-2 h-4 overflow-hidden rounded-full" title={`${f.nome} · ${dm(w.a)} a ${dm(w.b)} · ${pct(st.pct)}%`}
                                        style={{ left: `${esq}%`, width: `${larg}%`, minWidth: 8, background: suave(STATUS[st.status].cor, 18), border: `1px solid ${STATUS[st.status].cor}` }}>
                                        <i className="block h-full" style={{ width: `${pct(st.pct)}%`, background: STATUS[st.status].cor, opacity: 0.85 }} />
                                    </div>
                                ) : (
                                    <span className="absolute left-[1.5%] top-1.5 rounded-full px-2.5 py-px text-xs text-[var(--text-muted)]"
                                        style={{ border: `1px dashed ${GRADE}`, background: "var(--bg-card)" }}>{todoPrevio ? "já existente" : "a definir"}</span>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    })

    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl font-bold text-[var(--text-main)]">Cronograma</h3>
                <span className="text-xs text-[var(--text-muted)]">{dmy(P)} a {dmy(E)}</span>
            </div>
            <div className="glass-card overflow-x-auto">
                <div className="relative min-w-[900px] px-4 pb-4 pt-3">
                    <div className="grid items-end" style={{ gridTemplateColumns: `${lab} 1fr` }}>
                        <div />
                        <div className="grid h-8" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
                            {meses.map((d, i) => (
                                <span key={i} className="pt-0.5 text-center text-[11.5px] leading-tight text-[var(--text-muted)]">
                                    {d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                                    {(i === 0 || d.getMonth() === 0) && <small className="block text-[10px] opacity-80">{d.getFullYear()}</small>}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="grid min-h-8 items-center" style={{ gridTemplateColumns: `${lab} 1fr` }}>
                        <div className="text-[13px]">Marcos</div>
                        <div className="relative h-8" style={{ ...linhaGrade, borderRight: `1px solid ${GRADE}` }}>
                            {Object.entries(porData).map(([k, ms]) => {
                                const feito = ms.every((m) => m.feito)
                                return <span key={k} title={`${dmy(D(k)!)}: ${ms.map((m) => m.titulo).join("; ")}`} className="absolute top-[9px] -ml-[7px] h-3.5 w-3.5 rotate-45"
                                    style={{ left: `${pos(D(k)!)}%`, background: feito ? "var(--success)" : "var(--warning)", border: `2px solid ${feito ? "var(--success)" : "var(--warning)"}` }} />
                            })}
                        </div>
                    </div>
                    {grupos}
                    {hoje >= P && hoje <= E && (
                        <div className="pointer-events-none absolute bottom-4 top-3 z-[2] w-0" style={{ left: `calc(16px + ${lab} + (100% - 32px - ${lab}) * ${pos(hoje) / 100})`, borderLeft: "2px solid var(--warning)" }}>
                            <span className="absolute left-1 top-0 -translate-y-full rounded bg-[var(--bg-card)] px-1 text-[11px] font-bold" style={{ color: "var(--warning)" }}>hoje</span>
                        </div>
                    )}
                </div>
            </div>
            {!algumaData && <p className="text-[13px] text-[var(--text-muted)]">O calendário de cada módulo será definido junto com a equipe de implementação. As barras aparecem aqui quando as frentes ganharem datas.</p>}
        </section>
    )
}

// no body: dentro do bloco com animação (transform) o "fixed" ficava preso ao tamanho do bloco e o janelão saía cortado
function Janela({ titulo, onFechar, onSubmit, children }: { titulo: string; onFechar: () => void; onSubmit: () => void; children: React.ReactNode }) {
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onFechar}>
            <form className="glass-card mt-8 w-full max-w-xl space-y-4 p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">{titulo}</h3>
                    <button type="button" aria-label="Fechar" onClick={onFechar}><X className="h-4 w-4" /></button>
                </div>
                {children}
            </form>
        </div>,
        document.body,
    )
}

const Campo = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
    <label className="block space-y-1"><span className="text-xs text-[var(--text-muted)]">{rotulo}</span>{children}</label>
)

function FormTarefa({ valor, frentes, salvando, onSalvar, onExcluir, onFechar }: {
    valor: Partial<Tarefa>; frentes: Frente[]; salvando: boolean; onSalvar: (t: Partial<Tarefa>) => void; onExcluir?: () => void; onFechar: () => void
}) {
    const [t, setT] = useState<Partial<Tarefa>>(valor)
    const set = <K extends keyof Tarefa>(k: K, v: Tarefa[K] | null) => setT((x) => ({ ...x, [k]: v }))
    return (
        <Janela titulo={t.id ? "Editar tarefa" : "Nova tarefa"} onFechar={onFechar} onSubmit={() => onSalvar(t)}>
            <Campo rotulo="Título"><Inp value={t.titulo ?? ""} onChange={(e) => set("titulo", e.target.value)} maxLength={200} required /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Frente">
                    <select className={CAMPO} value={t.frente_id} onChange={(e) => set("frente_id", e.target.value)}>
                        {frentes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                </Campo>
                <Campo rotulo="Status">
                    <select className={CAMPO} value={t.status} onChange={(e) => set("status", e.target.value as Status)}>
                        {(Object.keys(STATUS) as Status[]).map((k) => <option key={k} value={k}>{STATUS[k].nome}</option>)}
                    </select>
                </Campo>
                <Campo rotulo="Início"><Inp type="date" value={t.inicio ?? ""} onChange={(e) => set("inicio", e.target.value || null)} /></Campo>
                <Campo rotulo="Fim previsto"><Inp type="date" value={t.fim ?? ""} onChange={(e) => set("fim", e.target.value || null)} /></Campo>
                {t.status === "andamento" && (
                    <Campo rotulo="Progresso (%)"><Inp type="number" min={0} max={100} value={t.progresso ?? 0} onChange={(e) => set("progresso", Number(e.target.value))} /></Campo>
                )}
                {t.status === "concluido" && (
                    <Campo rotulo="Concluída em"><Inp type="date" value={t.concluido_em ?? ""} onChange={(e) => set("concluido_em", e.target.value || null)} /></Campo>
                )}
                <Campo rotulo="Prioridade">
                    <select className={CAMPO} value={t.prioridade} onChange={(e) => set("prioridade", e.target.value as Tarefa["prioridade"])}>
                        <option value="normal">Normal</option>
                        <option value="alta">Alta (aparece em Próximos passos)</option>
                    </select>
                </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!t.previo} onChange={(e) => set("previo", e.target.checked)} /> Já existia antes do contrato</label>
            <div className="flex items-center justify-between gap-2 pt-2">
                {onExcluir ? <Btn variant="outline" size="sm" onClick={onExcluir}><Trash2 className="mr-1.5 h-4 w-4" /> Excluir</Btn> : <span />}
                <div className="flex gap-2">
                    <Btn variant="outline" onClick={onFechar}>Cancelar</Btn>
                    <Btn type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Btn>
                </div>
            </div>
        </Janela>
    )
}

function FormFrente({ valor, salvando, onSalvar, onFechar }: { valor: Frente; salvando: boolean; onSalvar: (f: Frente) => void; onFechar: () => void }) {
    const [f, setF] = useState(valor)
    return (
        <Janela titulo="Editar frente" onFechar={onFechar} onSubmit={() => onSalvar(f)}>
            <Campo rotulo="Nome"><Inp value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={120} required /></Campo>
            <Campo rotulo="Descrição"><Inp value={f.descricao ?? ""} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={240} /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Início planejado"><Inp type="date" value={f.inicio ?? ""} onChange={(e) => setF({ ...f, inicio: e.target.value || null })} /></Campo>
                <Campo rotulo="Fim planejado"><Inp type="date" value={f.fim ?? ""} onChange={(e) => setF({ ...f, fim: e.target.value || null })} /></Campo>
            </div>
            <p className="text-xs text-[var(--text-muted)]">As datas da frente desenham a barra do cronograma. Sem datas aqui, a barra usa as datas das tarefas.</p>
            <div className="flex justify-end gap-2 pt-2">
                <Btn variant="outline" onClick={onFechar}>Cancelar</Btn>
                <Btn type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Btn>
            </div>
        </Janela>
    )
}
