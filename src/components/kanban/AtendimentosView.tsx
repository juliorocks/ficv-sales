/**
 * AtendimentosView — visão alternativa do Funil de Leads, estilo caixa de entrada do
 * WhatsApp: conversas à esquerda (última mensagem, quem está esperando resposta),
 * chat do lead à direita (o mesmo WideChatHistory do card: VivaConnect/WideChat,
 * 📖 Base, → Secretaria, Finalizar, Transferir). Dados: RPC inbox_leads (respeita a RLS
 * e os mesmos filtros de Atendente/Departamento do quadro).
 */
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formatDistanceToNowStrict } from "date-fns"
import { ptBR } from "date-fns/locale"
import { CheckCircle2, Clock, Loader2, MessageSquare, PencilLine, Search } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { WideChatHistory } from "./WideChatHistory"
import { LeadDialogById } from "./LeadDialogById"

type Tab = "abertos" | "pendentes" | "finalizados"
interface Row {
    lead_id: number; nome: string; telefone: string | null; email: string | null; stage_id: number; stage_name: string
    assigned_to_id: string | null; atendente: string | null; perfil: string | null; widechat_contact_id: string | null
    last_at: string; last_message: string | null; last_origin: string; last_type: string; last_provider: string | null
    pending_count: number
}

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
const preview = (r: Row) => {
    const t = r.last_type && r.last_type !== "text" && r.last_type !== "template"
        ? ({ images: "📷 Imagem", sounds: "🎤 Áudio", videos: "🎬 Vídeo", files: "📎 Arquivo" } as Record<string, string>)[r.last_type] ?? `[${r.last_type}]`
        : (r.last_message ?? "")
    return `${r.last_origin === "channel" ? "" : r.last_origin === "auto" ? "🤖 " : "Você: "}${t.replace(/\s+/g, " ")}`
}
const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { locale: ptBR }).replace(/ (minutos?|horas?|dias?|segundos?|meses|mês)/, (m) => ({ " minuto": "min", " minutos": "min", " hora": "h", " horas": "h", " dia": "d", " dias": "d", " segundo": "s", " segundos": "s", " mês": "m", " meses": "m" } as Record<string, string>)[m] ?? m)

export function AtendimentosView({ assigneeFilter = "all", teamAgentIds }: { assigneeFilter?: string; teamAgentIds?: string[] }) {
    const [tab, setTab] = useState<Tab>("abertos")
    const [search, setSearch] = useState("")
    const [q, setQ] = useState("")
    const [selected, setSelected] = useState<number | null>(null)
    const [editId, setEditId] = useState<number | null>(null)
    useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])

    const agents = teamAgentIds?.filter((id) => id !== "__unassigned__")
    const params = {
        p_tab: tab, p_search: q || null,
        p_assignee: assigneeFilter !== "all" && assigneeFilter !== "unassigned" ? assigneeFilter : null,
        p_agents: teamAgentIds ? agents : null,
        p_no_owner: !!teamAgentIds?.includes("__unassigned__"),
        p_limit: 200,
    }
    const { data: rows = [], isLoading, isFetching } = useQuery<Row[]>({
        queryKey: ["inbox-leads", params],
        queryFn: async () => {
            const { data, error } = await supabase.rpc("inbox_leads", params)
            if (error) throw error
            return (data ?? []) as Row[]
        },
        refetchInterval: 15000,
    })
    // contagem de pendentes pro selo da aba (independente da aba aberta)
    const { data: pendentes = 0 } = useQuery<number>({
        queryKey: ["inbox-leads-pending", params.p_assignee, params.p_agents, params.p_no_owner],
        queryFn: async () => {
            const { data } = await supabase.rpc("inbox_leads", { ...params, p_tab: "pendentes", p_search: null })
            return (data ?? []).length
        },
        refetchInterval: 15000,
    })
    const list = useMemo(() => assigneeFilter === "unassigned" ? rows.filter((r) => !r.assigned_to_id) : rows, [rows, assigneeFilter])
    const current = list.find((r) => r.lead_id === selected) ?? null

    return (
        <div className="flex h-[calc(100vh-190px)] min-h-[520px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
            {/* ── conversas ─────────────────────────────────────── */}
            <aside className="w-[340px] shrink-0 border-r border-[var(--border)] flex flex-col">
                <div className="p-3 space-y-2 border-b border-[var(--border)]">
                    <div className="flex rounded-lg bg-[var(--bg-main)] p-0.5 text-xs">
                        {([["abertos", "Abertos", MessageSquare], ["pendentes", "Pendentes", Clock], ["finalizados", "Finalizados", CheckCircle2]] as const).map(([v, l, I]) => (
                            <button key={v} onClick={() => setTab(v)}
                                className={`relative flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-colors ${tab === v ? "bg-[var(--bg-card)] text-[var(--text-main)] font-semibold shadow-sm" : "text-[var(--text-muted)]"}`}>
                                <I className="h-3.5 w-3.5" /> {l}
                                {v === "pendentes" && pendentes > 0 && <span className="ml-0.5 rounded-full bg-orange-500 text-white text-[10px] px-1.5">{pendentes}</span>}
                            </button>
                        ))}
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou telefone"
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] pl-8 pr-3 py-2 text-sm text-[var(--text-main)] outline-none focus:border-primary" />
                        {isFetching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />}
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
                                    <span title={r.last_provider === "vivaconnect" ? "VivaConnect" : "WideChat"}
                                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--bg-card)] ${r.last_provider === "vivaconnect" ? "bg-violet-500" : "bg-green-500"}`} />
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
                            <button onClick={() => setEditId(current.lead_id)} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-primary" title="Abrir detalhes do lead">
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

            {editId != null && <LeadDialogById leadId={editId} onClose={() => setEditId(null)} initialTab="details" />}
        </div>
    )
}
