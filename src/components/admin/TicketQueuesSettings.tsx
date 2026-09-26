// Gestão > Filas de Atendimento — cada fila = nível (graduação/pós/todos) × assuntos
// (categorias do chamado) × pessoas. Chamado novo cai na fila pelo gatilho
// ticket_set_queue(); a "padrão" recebe o que não casar com nenhuma. Quem é
// Secretaria/Tutor só enxerga os chamados das filas de que é membro.
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Inbox, Loader2, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { showError, showSuccess } from "@/utils/toast"

type Nivel = "todos" | "graduacao" | "pos"
interface Queue { id: number; nome: string; nivel: Nivel; categorias: string[]; padrao: boolean; ativo: boolean; ordem: number }

const CATS = [
    { v: "secretaria", l: "📋 Secretaria" }, { v: "academico", l: "📚 Acadêmico" }, { v: "financeiro", l: "💳 Financeiro" },
    { v: "certificado", l: "🎓 Certificado" }, { v: "suporte_tecnico", l: "🔧 Suporte técnico" },
    { v: "tutoria", l: "🧑‍🏫 Tutoria" }, { v: "biblioteca", l: "📖 Biblioteca" },
    { v: "cancelamento", l: "❌ Cancelamento" }, { v: "outros", l: "💬 Outros" },
]
const NIVEIS: { v: Nivel; l: string }[] = [{ v: "todos", l: "Todos os níveis" }, { v: "graduacao", l: "Graduação" }, { v: "pos", l: "Pós-graduação" }]
const ROLE_LABEL: Record<string, string> = { admin: "Admin", agent: "Comercial", secretaria: "Secretaria", tutor: "Tutor", coordenador: "Coordenador" }

export function TicketQueuesSettings() {
    const qc = useQueryClient()
    const [draft, setDraft] = useState<Queue[]>([])
    const [members, setMembers] = useState<Record<number, string[]>>({})
    const [saving, setSaving] = useState<number | null>(null)

    const { data, isLoading } = useQuery({
        queryKey: ["ticket-queues-admin"],
        queryFn: async () => {
            const [q, m] = await Promise.all([
                supabase.from("ticket_queues").select("*").order("ordem"),
                supabase.from("ticket_queue_members").select("queue_id, profile_id"),
            ])
            if (q.error) throw q.error
            return { queues: q.data as Queue[], members: m.data ?? [] }
        },
    })
    const { data: people = [] } = useQuery<{ id: string; full_name: string; role: string }[]>({
        queryKey: ["ticket-people"],
        queryFn: async () => ((await supabase.from("profiles").select("id, full_name, role")
            .in("role", ["secretaria", "tutor", "atendente", "biblioteca", "coordenador", "admin", "agent"]).order("full_name")).data ?? []).filter((p: any) => p.full_name),
    })

    useEffect(() => {
        if (!data) return
        setDraft(data.queues)
        const m: Record<number, string[]> = {}
        for (const r of data.members) (m[r.queue_id] ??= []).push(r.profile_id)
        setMembers(m)
    }, [data])

    const set = (id: number, patch: Partial<Queue>) => setDraft((d) => d.map((q) => (q.id === id ? { ...q, ...patch } : q)))

    const save = async (q: Queue) => {
        if (!q.nome.trim()) return showError("Dê um nome pra fila.")
        setSaving(q.id)
        const { data: ok, error } = await supabase.from("ticket_queues").update({
            nome: q.nome.trim(), nivel: q.nivel, categorias: q.categorias, padrao: q.padrao, ativo: q.ativo,
        }).eq("id", q.id).select("id")
        if (!error && ok?.length && q.padrao) await supabase.from("ticket_queues").update({ padrao: false }).neq("id", q.id)
        let mErr = null
        if (!error) {
            const want = members[q.id] ?? []
            await supabase.from("ticket_queue_members").delete().eq("queue_id", q.id)
            if (want.length) mErr = (await supabase.from("ticket_queue_members").insert(want.map((profile_id) => ({ queue_id: q.id, profile_id })))).error
        }
        setSaving(null)
        if (error || !ok?.length || mErr) return showError(`Não foi possível salvar: ${(error ?? mErr)?.message ?? "sessão expirada, recarregue."}`)
        qc.invalidateQueries({ queryKey: ["ticket-queues-admin"] })
        qc.invalidateQueries({ queryKey: ["ticket-queues"] })
        showSuccess(`Fila "${q.nome}" salva.`)
    }

    const add = async () => {
        const { error } = await supabase.from("ticket_queues").insert({ nome: "Nova fila", nivel: "todos", categorias: [], ordem: draft.length + 1 })
        if (error) return showError(error.message)
        qc.invalidateQueries({ queryKey: ["ticket-queues-admin"] })
    }
    const remove = async (q: Queue) => {
        if (q.padrao) return showError("Não dá pra apagar a fila padrão — marque outra como padrão antes.")
        if (!confirm(`Apagar a fila "${q.nome}"? Os chamados dela voltam a ser distribuídos pela regra.`)) return
        const { error } = await supabase.from("ticket_queues").delete().eq("id", q.id)
        if (error) return showError(error.message)
        qc.invalidateQueries({ queryKey: ["ticket-queues-admin"] })
    }

    if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2 text-[var(--text-main)]"><Inbox size={22} className="text-primary" /> Filas de Atendimento</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Chamado novo cai na fila que atende aquele <b>assunto</b> e o <b>nível</b> do aluno (Graduação/Pós, pelo Sponte).
                        Secretaria e Tutores só veem os chamados das filas de que participam; Coordenadores veem todas.
                    </p>
                </div>
                <Button onClick={add} size="sm"><Plus size={14} className="mr-1" /> Fila</Button>
            </div>

            {draft.map((q) => (
                <Card key={q.id} className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                            <Input value={q.nome} onChange={(e) => set(q.id, { nome: e.target.value })} className="font-bold text-base bg-muted/20 max-w-sm" />
                            <select value={q.nivel} onChange={(e) => set(q.id, { nivel: e.target.value as Nivel })}
                                className="h-10 rounded-md border border-[var(--border)] bg-muted/20 px-3 text-sm">
                                {NIVEIS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
                            </select>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Recebe os chamados que não casam com nenhuma fila">
                                <input type="checkbox" checked={q.padrao} onChange={(e) => set(q.id, { padrao: e.target.checked })} className="accent-[var(--primary)]" /> padrão
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                <input type="checkbox" checked={q.ativo} onChange={(e) => set(q.id, { ativo: e.target.checked })} className="accent-[var(--primary)]" /> ativa
                            </label>
                            <Button size="icon" variant="ghost" className="ml-auto" onClick={() => remove(q)} title="Apagar fila"><Trash2 size={14} /></Button>
                        </div>
                        <CardDescription className="text-xs">
                            {q.nivel === "todos" ? "Qualquer nível" : `Só alunos de ${q.nivel === "pos" ? "Pós-graduação" : "Graduação"}`} ·
                            {" "}{q.categorias.length ? `${q.categorias.length} assunto(s)` : "nenhum assunto"}{q.padrao ? " · recebe o que sobrar" : ""}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Assuntos</p>
                            <div className="flex flex-wrap gap-2">
                                {CATS.map((c) => {
                                    const on = q.categorias.includes(c.v)
                                    return (
                                        <button key={c.v} onClick={() => set(q.id, { categorias: on ? q.categorias.filter((x) => x !== c.v) : [...q.categorias, c.v] })}
                                            className={`px-3 py-1.5 rounded-full text-xs border ${on ? "bg-primary text-white border-primary" : "border-[var(--border)] text-muted-foreground"}`}>
                                            {c.l}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Quem atende esta fila</p>
                            <div className="flex flex-wrap gap-2">
                                {people.map((p) => {
                                    const on = (members[q.id] ?? []).includes(p.id)
                                    return (
                                        <button key={p.id} onClick={() => setMembers((m) => ({ ...m, [q.id]: on ? (m[q.id] ?? []).filter((x) => x !== p.id) : [...(m[q.id] ?? []), p.id] }))}
                                            className={`px-3 py-1.5 rounded-full text-xs border ${on ? "bg-primary/15 text-primary border-primary/40 font-semibold" : "border-[var(--border)] text-muted-foreground"}`}>
                                            {p.full_name} <span className="opacity-60">· {ROLE_LABEL[p.role] ?? p.role}</span>
                                        </button>
                                    )
                                })}
                                {!people.length && <p className="text-xs text-muted-foreground">Cadastre as pessoas em Gestão &gt; Usuários com a função Secretaria, Tutor ou Coordenador.</p>}
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button size="sm" onClick={() => save(q)} disabled={saving === q.id}>
                                {saving === q.id ? <Loader2 className="animate-spin" size={14} /> : "Salvar fila"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
