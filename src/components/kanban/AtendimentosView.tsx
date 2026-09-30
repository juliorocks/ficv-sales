/**
 * AtendimentosView — visão alternativa do Funil de Leads, estilo caixa de entrada do
 * WhatsApp: conversas à esquerda (última mensagem, quem está esperando resposta),
 * chat do lead à direita (o mesmo WideChatHistory do card: VivaConnect/WideChat,
 * 📖 Base, → Secretaria, Finalizar, Transferir). Dados: RPC inbox_leads (respeita a RLS
 * e os mesmos filtros de Atendente/Departamento do quadro).
 *
 * Abas = as MESMAS etapas do Kanban (pedido do usuário 30/09, "mesma nomenclatura pra
 * facilitar") — lidas de `stages` dinamicamente, igual o KanbanBoard já faz, em vez de
 * hardcoded: se uma etapa for renomeada/reordenada/criada, esta tela acompanha sozinha.
 *
 * Contagem por etapa = leads_stage_counts, a MESMA function que alimenta o selo do Kanban
 * (pedido explícito do usuário 30/09: "tem que ser iguais, sempre" — sendo a mesma query,
 * os dois números ficam estruturalmente impossíveis de divergir). A lista também traz TODO
 * lead da etapa agora, com ou sem conversa (antes só entrava quem tinha mensagem nos
 * últimos 60 dias — por isso os números batiam diferente do Kanban).
 */
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formatDistanceToNowStrict } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Check, ChevronDown, GraduationCap, Loader2, MessageSquare, PencilLine, Search } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { WideChatHistory } from "./WideChatHistory"
import { ContactDetailsPanel } from "./ContactDetailsPanel"
import { KanbanSort } from "./KanbanSort"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// mesmo shape do KanbanColumn.tsx/KanbanSort.tsx (não exportado de lá, copiado igual)
type SortOption = { key: string; label: string; direction: "asc" | "desc" }

interface Stage { id: number; name: string; order: number }
interface Course { id: number; name: string }
interface Row {
    lead_id: number; nome: string; telefone: string | null; email: string | null; stage_id: number; stage_name: string
    assigned_to_id: string | null; atendente: string | null; perfil: string | null; widechat_contact_id: string | null
    last_at: string; last_message: string | null; last_origin: string | null; last_type: string | null; last_provider: string | null
    pending_count: number
    curso_interesse: number | null; valor_oportunidade: number | null; temperatura: string | null
    stage_entry_date: string | null; data_entrada: string; updated_at: string
}

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
// lead sem NENHUMA mensagem ainda (agora entra na lista também — pedido do usuário 30/09,
// "puxar todos os leads, igual no kanban") não tem last_message/last_origin nenhum
const preview = (r: Row) => {
    if (!r.last_message && !r.last_type) return "Sem mensagens ainda"
    const t = r.last_type && r.last_type !== "text" && r.last_type !== "template"
        ? ({ images: "📷 Imagem", sounds: "🎤 Áudio", videos: "🎬 Vídeo", files: "📎 Arquivo" } as Record<string, string>)[r.last_type] ?? `[${r.last_type}]`
        : (r.last_message ?? "")
    return `${r.last_origin === "channel" ? "" : r.last_origin === "auto" ? "🤖 " : "Você: "}${t.replace(/\s+/g, " ")}`
}
const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { locale: ptBR }).replace(/ (minutos?|horas?|dias?|segundos?|meses|mês)/, (m) => ({ " minuto": "min", " minutos": "min", " hora": "h", " horas": "h", " dia": "d", " dias": "d", " segundo": "s", " segundos": "s", " mês": "m", " meses": "m" } as Record<string, string>)[m] ?? m)

export function AtendimentosView({ assigneeFilter = "all", teamAgentIds }: { assigneeFilter?: string; teamAgentIds?: string[] }) {
    const { data: stages = [] } = useQuery<Stage[]>({
        queryKey: ["stages"],
        queryFn: async () => {
            const { data, error } = await supabase.from("stages").select("id, name, order").order("order")
            if (error) throw error
            return data ?? []
        },
        staleTime: 5 * 60_000,
    })
    const [tab, setTab] = useState<number | null>(null)
    // 1ª etapa carregada vira a aba inicial — de preferência "Entrada" (fila de trabalho do
    // dia a dia), senão a primeira na ordem do Kanban. Só define uma vez.
    useEffect(() => {
        if (tab != null || !stages.length) return
        setTab((stages.find((s) => /entrada/i.test(s.name)) ?? stages[0]).id)
    }, [stages, tab])

    const [search, setSearch] = useState("")
    const [q, setQ] = useState("")
    const [selected, setSelected] = useState<number | null>(null)
    // painel "Detalhes do contato" à direita (lembrado no navegador)
    const [details, setDetails] = useState<boolean>(() => { try { return localStorage.getItem("ficv_inbox_details") === "1" } catch { return false } })
    const toggleDetails = (v: boolean) => { setDetails(v); try { localStorage.setItem("ficv_inbox_details", v ? "1" : "0") } catch { /* sem storage */ } }
    useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])

    const agents = teamAgentIds?.filter((id) => id !== "__unassigned__")
    // buscando: procura em todas as conversas (ignora filtros de atendente/departamento)
    const semFiltro = !!q
    const filtros = {
        p_search: q || null,
        p_assignee: !semFiltro && assigneeFilter !== "all" && assigneeFilter !== "unassigned" ? assigneeFilter : null,
        p_agents: !semFiltro && teamAgentIds ? agents : null,
        p_no_owner: !!teamAgentIds?.includes("__unassigned__"),
    }
    const { data: rows = [], isLoading, isFetching } = useQuery<Row[]>({
        queryKey: ["inbox-leads", tab, filtros],
        queryFn: async () => {
            const { data, error } = await supabase.rpc("inbox_leads", { p_stage_id: tab, ...filtros, p_limit: 200 })
            if (error) throw error
            return (data ?? []) as Row[]
        },
        enabled: tab != null,
        refetchInterval: 15000,
    })
    // total por etapa, pro selo numérico em CADA aba — MESMA function que alimenta o selo do
    // Kanban (leads_stage_counts), não uma versão própria: garante que os dois números nunca
    // divergem, por construção (pedido explícito do usuário 30/09, "tem que ser sempre iguais").
    // Não leva p_search — o Kanban também não recalcula o selo durante busca de texto.
    const { data: counts = {} } = useQuery<Record<number, number>>({
        queryKey: ["leads-stage-counts", filtros.p_assignee, filtros.p_agents, filtros.p_no_owner],
        queryFn: async () => {
            const { data, error } = await supabase.rpc("leads_stage_counts", {
                p_assignee: filtros.p_assignee, p_agents: filtros.p_agents, p_no_owner: filtros.p_no_owner,
            })
            if (error) throw error
            return Object.fromEntries(((data ?? []) as { stage_id: number; total: number }[]).map((r) => [r.stage_id, r.total]))
        },
        refetchInterval: 15000,
    })
    const baseList = useMemo(() => !semFiltro && assigneeFilter === "unassigned" ? rows.filter((r) => !r.assigned_to_id) : rows, [rows, assigneeFilter, semFiltro])

    const { data: courses = [] } = useQuery<Course[]>({
        queryKey: ["courses_min"],
        queryFn: async () => {
            const { data, error } = await supabase.from("courses").select("id, name").order("name")
            if (error) throw error
            return data ?? []
        },
        staleTime: 5 * 60_000,
    })

    // Mesmos filtros/ordenação de cada coluna do Kanban (pedido do usuário 30/09), aplicados
    // na lista única desta tela — reaproveita o componente KanbanSort tal como está lá.
    const stageName = stages.find((s) => s.id === tab)?.name ?? ""
    const isEntradaStage = /entrada/i.test(stageName)
    const [courseFilter, setCourseFilter] = useState<number | null>(null)
    const [unattendedOnly, setUnattendedOnly] = useState(false)
    const [unattendedFirst, setUnattendedFirst] = useState(true)
    const [waitingReplyOnly, setWaitingReplyOnly] = useState(false)
    const [waitingReplyFirst, setWaitingReplyFirst] = useState(true)
    const [sortBy, setSortBy] = useState<SortOption>({ key: "updated_at", label: "Última Atividade", direction: "desc" })

    const listCourses = useMemo(() => {
        const ids = new Set(baseList.map((r) => r.curso_interesse).filter((x): x is number => x != null))
        return courses.filter((c) => ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
    }, [baseList, courses])

    const isPriorityRow = (r: Row) => (isEntradaStage ? !r.assigned_to_id : r.pending_count > 0)
    const priorityOnly = isEntradaStage ? unattendedOnly : waitingReplyOnly
    const priorityFirst = isEntradaStage ? unattendedFirst : waitingReplyFirst

    const list = useMemo(() => {
        let r = baseList
        if (courseFilter != null) r = r.filter((x) => x.curso_interesse === courseFilter)
        if (priorityOnly) r = r.filter(isPriorityRow)
        const tempOrder: Record<string, number> = { quente: 3, morno: 2, frio: 1 }
        return [...r].sort((a, b) => {
            if (priorityFirst) {
                const ap = isPriorityRow(a), bp = isPriorityRow(b)
                if (ap !== bp) return ap ? -1 : 1
            }
            const key = sortBy.key
            let av: any, bv: any
            if (key === "temperatura") { av = tempOrder[a.temperatura || ""] || 0; bv = tempOrder[b.temperatura || ""] || 0 }
            else if (key === "stage_entry_date" || key === "data_entrada" || key === "updated_at") {
                const k = key as "stage_entry_date" | "data_entrada" | "updated_at"
                av = a[k] ? new Date(a[k] as string).getTime() : 0; bv = b[k] ? new Date(b[k] as string).getTime() : 0
            } else if (key === "nome_completo") { av = a.nome; bv = b.nome }
            else if (key === "valor_oportunidade") { av = a.valor_oportunidade; bv = b.valor_oportunidade }
            else { av = null; bv = null }
            if (av == null) av = sortBy.direction === "asc" ? Infinity : -Infinity
            if (bv == null) bv = sortBy.direction === "asc" ? Infinity : -Infinity
            if (typeof av === "string" && typeof bv === "string") return sortBy.direction === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
            if (av < bv) return sortBy.direction === "asc" ? -1 : 1
            if (av > bv) return sortBy.direction === "asc" ? 1 : -1
            return 0
        })
    }, [baseList, courseFilter, priorityOnly, priorityFirst, sortBy, isEntradaStage])

    const current = list.find((r) => r.lead_id === selected) ?? null

    return (
        <div className="flex h-[calc(100vh-190px)] min-h-[520px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
            {/* ── conversas ─────────────────────────────────────── */}
            <aside className="w-[340px] shrink-0 border-r border-[var(--border)] flex flex-col">
                <div className="p-3 space-y-2 border-b border-[var(--border)]">
                    {/* abas = etapas do Kanban (mesma nomenclatura, pedido do usuário 30/09) —
                        largura por conteúdo + rolagem horizontal, "Em Contato"/"Matriculado" não
                        cabem 5 em largura igual como os 3 rótulos curtos de antes */}
                    <div className="flex gap-1 rounded-lg bg-[var(--bg-main)] p-0.5 text-xs overflow-x-auto custom-scrollbar">
                        {stages.map((s) => (
                            <button key={s.id} onClick={() => setTab(s.id)}
                                className={`relative flex shrink-0 items-center justify-center gap-1 px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors ${tab === s.id ? "bg-[var(--bg-card)] text-[var(--text-main)] font-semibold shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>
                                {s.name}
                                {!!counts[s.id] && <span className="ml-0.5 rounded-full bg-primary/15 text-primary text-[10px] px-1.5">{counts[s.id]}</span>}
                            </button>
                        ))}
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou telefone"
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] pl-8 pr-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-primary" />
                        {isFetching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />}
                    </div>
                    {/* mesmos filtros de cada coluna do Kanban (pedido do usuário 30/09) —
                        curso + ordenar/filtrar (Não atendidos/Esperando Resposta conforme a aba) */}
                    <div className="flex gap-1.5">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="flex-1 justify-between h-8 text-xs font-normal min-w-0">
                                    <span className="flex items-center gap-1.5 truncate">
                                        <GraduationCap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{courseFilter == null ? "Todos os cursos" : (courses.find((c) => c.id === courseFilter)?.name ?? "Curso")}</span>
                                    </span>
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
                                <DropdownMenuItem onClick={() => setCourseFilter(null)} className="flex justify-between">
                                    <span>Todos os cursos</span>
                                    {courseFilter == null && <Check className="h-4 w-4 ml-2 shrink-0" />}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {listCourses.map((c) => (
                                    <DropdownMenuItem key={c.id} onClick={() => setCourseFilter(c.id)} className="flex justify-between">
                                        <span className="truncate">{c.name}</span>
                                        {courseFilter === c.id && <Check className="h-4 w-4 ml-2 shrink-0" />}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <KanbanSort
                            sortBy={sortBy} onSortChange={setSortBy}
                            mode={isEntradaStage ? "unattended" : "waitingReply"}
                            priorityOnly={priorityOnly}
                            onPriorityOnlyChange={isEntradaStage ? setUnattendedOnly : setWaitingReplyOnly}
                            priorityFirst={priorityFirst}
                            onPriorityFirstChange={isEntradaStage ? setUnattendedFirst : setWaitingReplyFirst}
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /></div>}
                    {!isLoading && list.length === 0 && <p className="text-center text-sm text-[var(--text-muted)] py-10">Nenhuma conversa aqui.</p>}
                    {list.map((r) => {
                        const on = r.lead_id === selected
                        return (
                            <button key={r.lead_id} onClick={() => setSelected(r.lead_id)}
                                className={`w-full text-left flex gap-3 px-3 py-3 border-b border-[var(--border)]/60 transition-colors ${on ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-[var(--bg-card-hover)] border-l-4 border-l-transparent"}`}>
                                <div className="relative shrink-0">
                                    <div className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">{initials(r.nome)}</div>
                                    {/* lead sem mensagem nenhuma ainda (agora entra na lista, pedido 30/09) não tem
                                        provider — ponto cinza em vez de "adivinhar" um canal que não existe */}
                                    {r.last_provider && (
                                        <span title={r.last_provider === "vivaconnect" ? "VivaConnect" : "WideChat"}
                                            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--bg-card)] ${r.last_provider === "vivaconnect" ? "bg-violet-500" : "bg-green-500"}`} />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className={`truncate text-sm ${r.pending_count ? "font-bold text-[var(--text-main)]" : "font-medium text-[var(--text-main)]"}`}>{r.nome}</p>
                                        <span className={`shrink-0 text-[11px] ${r.pending_count ? "text-orange-500 font-semibold" : "text-[var(--text-muted)]"}`}>{ago(r.last_at)}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="truncate text-xs text-[var(--text-muted)]">{preview(r)}</p>
                                        {r.pending_count > 0 && <span className="shrink-0 rounded-full bg-orange-500 text-white text-[10px] font-bold px-1.5 min-w-[18px] text-center">{r.pending_count}</span>}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border)]">{r.stage_name}</span>
                                        {r.perfil === "aluno" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">Aluno</span>}
                                        <span className="text-[10px] text-[var(--text-muted)] truncate">{r.atendente ?? "sem atendente"}</span>
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </aside>

            {/* ── chat ──────────────────────────────────────────── */}
            <section className="flex-1 min-w-0 flex flex-col">
                {!current ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
                        <MessageSquare className="h-10 w-10 opacity-40" />
                        <p className="text-sm">Escolha uma conversa à esquerda.</p>
                    </div>
                ) : (
                    <>
                        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)]">
                            <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">{initials(current.nome)}</div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-[var(--text-main)] truncate">{current.nome}</p>
                                <p className="text-xs text-[var(--text-muted)] truncate">
                                    #{current.lead_id} · {current.telefone ?? "sem telefone"} · {current.stage_name} · {current.atendente ?? "sem atendente"}
                                </p>
                            </div>
                            <button onClick={() => toggleDetails(!details)} className={`flex items-center gap-1.5 text-xs ${details ? "text-primary" : "text-[var(--text-muted)] hover:text-primary"}`} title="Detalhes do contato">
                                <PencilLine className="h-4 w-4" /> Detalhes
                            </button>
                        </header>
                        <div className="flex-1 overflow-y-auto p-3">
                            <WideChatHistory key={current.lead_id} widechatContactId={current.widechat_contact_id ?? ""} leadId={current.lead_id}
                                telefone={current.telefone} leadName={current.nome} scrollClassName="h-[calc(100vh-420px)] min-h-[300px]" />
                        </div>
                    </>
                )}
            </section>

            {current && details && <ContactDetailsPanel key={current.lead_id} leadId={current.lead_id} onClose={() => toggleDetails(false)} />}
        </div>
    )
}
