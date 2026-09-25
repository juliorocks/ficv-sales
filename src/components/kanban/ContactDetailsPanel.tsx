/**
 * ContactDetailsPanel — "Detalhes do contato" à direita da visão Atendimentos (modelo
 * do inbox do Z-PRO). Abas Perfil · Histórico · Follow-up, reaproveitando os mesmos
 * componentes do card (LeadHistoryFeed, AddLeadNoteForm, LeadFollowupPanel).
 * Etapa e atendente mudam aqui mesmo; o resto em "Editar contato" (ficha completa).
 */
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, GraduationCap, Loader2, Mail, Megaphone, Phone, PencilLine, Thermometer, UserRound, Wallet, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { showError, showSuccess } from "@/utils/toast"
import type { Lead, Stage, User } from "@/types/database"
import { LeadHistoryFeed } from "./LeadHistoryFeed"
import { AddLeadNoteForm } from "./AddLeadNoteForm"
import { LeadFollowupPanel } from "@/components/followups/LeadFollowupPanel"
import { LeadDialogById } from "./LeadDialogById"

const brl = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"

function Row({ icon: I, label, children }: { icon: any; label: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-3 py-2.5 border-b border-[var(--border)]/60 last:border-0">
            <I className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
            <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
                <div className="text-sm text-[var(--text-main)] break-words">{children}</div>
            </div>
        </div>
    )
}

export function ContactDetailsPanel({ leadId, onClose }: { leadId: number; onClose: () => void }) {
    const qc = useQueryClient()
    const [tab, setTab] = useState<"perfil" | "historico" | "followup">("perfil")
    const [editOpen, setEditOpen] = useState(false)
    const [saving, setSaving] = useState<string | null>(null)

    const { data: lead, isLoading } = useQuery<Lead>({
        queryKey: ["lead", leadId],
        queryFn: async () => {
            const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).single()
            if (error) throw error
            return data as Lead
        },
    })
    const { data: stages = [] } = useQuery<Stage[]>({ queryKey: ["stages"], queryFn: async () => (await supabase.from("stages").select("*").order("order")).data ?? [] })
    const { data: users = [] } = useQuery<User[]>({ queryKey: ["users"], queryFn: async () => (await supabase.from("profiles").select("*")).data ?? [] })
    const { data: courses = [] } = useQuery<any[]>({ queryKey: ["courses"], queryFn: async () => (await supabase.from("courses").select("*")).data ?? [] })
    const { data: sources = [] } = useQuery<any[]>({ queryKey: ["lead_sources"], queryFn: async () => (await supabase.from("lead_sources").select("*")).data ?? [] })
    const { data: pendFollowups = 0 } = useQuery<number>({
        queryKey: ["lead-followups-count", leadId],
        queryFn: async () => (await supabase.from("lead_followups").select("id", { count: "exact", head: true }).eq("lead_id", leadId).is("completed_at", null)).count ?? 0,
    })

    const patch = async (field: "stage_id" | "assigned_to_id", value: any, label: string) => {
        setSaving(field)
        await supabase.auth.getSession().catch(() => { })
        const upd: Record<string, unknown> = { [field]: value, updated_at: new Date().toISOString() }
        if (field === "stage_id") upd.stage_entry_date = new Date().toISOString()
        const { data, error } = await supabase.from("leads").update(upd).eq("id", leadId).select("id")
        setSaving(null)
        if (error || !data?.length) { showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada, recarregue a página."}`); return }
        showSuccess(label)
        qc.invalidateQueries({ queryKey: ["lead", leadId] })
        qc.invalidateQueries({ queryKey: ["leads"] })
        qc.invalidateQueries({ queryKey: ["inbox-leads"] })
    }

    const staff = users.filter((u: any) => ["admin", "agent"].includes(u.role) && u.full_name)
    const curso = courses.find((c) => c.id === lead?.curso_interesse)?.name ?? (lead as any)?.curso_interesse_nome
    const fonte = sources.find((s) => s.id === (lead as any)?.source_id)?.name ?? lead?.fonte_lead

    return (
        <aside className="w-[340px] shrink-0 border-l border-[var(--border)] flex flex-col bg-[var(--bg-card)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-semibold text-[var(--text-main)]">Detalhes do contato</p>
                <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]" title="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex border-b border-[var(--border)] text-xs">
                {([["perfil", "Perfil"], ["historico", "Histórico"], ["followup", `Follow-up${pendFollowups ? ` (${pendFollowups})` : ""}`]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setTab(v as any)}
                        className={`flex-1 py-2.5 border-b-2 -mb-px ${tab === v ? "border-primary text-[var(--text-main)] font-semibold" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>{l}</button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                {isLoading || !lead ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /></div> : (
                    <>
                        {tab === "perfil" && (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-[var(--border)] p-4 text-center space-y-2">
                                    <div className="mx-auto h-16 w-16 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xl font-bold">{initials(lead.nome_completo)}</div>
                                    <p className="font-semibold text-[var(--text-main)]">{lead.nome_completo}</p>
                                    <div className="flex justify-center gap-1.5 flex-wrap">
                                        {lead.perfil === "aluno" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">Aluno</span>}
                                        {(lead as any).status_wide === "ok_wide" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">WhatsApp confirmado</span>}
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-main)] text-[var(--text-muted)]">#{lead.id}</span>
                                    </div>
                                    <button onClick={() => setEditOpen(true)} className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text-main)] hover:border-primary">
                                        <PencilLine className="h-3.5 w-3.5" /> Editar contato
                                    </button>
                                </div>

                                <div className="rounded-xl border border-[var(--border)] p-3 space-y-3">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Etapa</p>
                                        <select value={lead.stage_id ?? ""} disabled={saving === "stage_id"}
                                            onChange={(e) => patch("stage_id", Number(e.target.value), `Movido para ${stages.find((s) => s.id === Number(e.target.value))?.name}.`)}
                                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)]">
                                            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Atendente</p>
                                        <select value={lead.assigned_to_id ?? ""} disabled={saving === "assigned_to_id"}
                                            onChange={(e) => patch("assigned_to_id", e.target.value || null, e.target.value ? `Atribuído a ${staff.find((u) => u.id === e.target.value)?.full_name}.` : "Lead sem atendente.")}
                                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)]">
                                            <option value="">— sem atendente —</option>
                                            {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-[var(--border)] px-3">
                                    <Row icon={Phone} label="Telefone">{lead.telefone || "—"}</Row>
                                    <Row icon={Mail} label="E-mail">{lead.email || "—"}</Row>
                                    <Row icon={GraduationCap} label="Curso de interesse">{curso || "—"}</Row>
                                    <Row icon={Megaphone} label="Origem">{fonte || "—"}</Row>
                                    <Row icon={Wallet} label="Valor da oportunidade">{brl(lead.valor_oportunidade)}</Row>
                                    <Row icon={Thermometer} label="Temperatura">{lead.temperatura || "—"}</Row>
                                    <Row icon={CalendarDays} label="Entrou em">
                                        {lead.data_entrada ? new Date(lead.data_entrada).toLocaleDateString("pt-BR") : "—"}
                                        {(lead as any).contact_count > 1 && <span className="text-xs text-[var(--text-muted)]"> · {(lead as any).contact_count} contatos</span>}
                                    </Row>
                                    <Row icon={UserRound} label="Atendente">{users.find((u) => u.id === lead.assigned_to_id)?.full_name ?? "—"}</Row>
                                </div>

                                {lead.observacoes && (
                                    <div className="rounded-xl border border-[var(--border)] p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Observações</p>
                                        <p className="text-xs text-[var(--text-main)] whitespace-pre-wrap">{lead.observacoes}</p>
                                    </div>
                                )}
                            </div>
                        )}
                        {tab === "historico" && (
                            <div className="space-y-4">
                                <AddLeadNoteForm leadId={lead.id} />
                                <LeadHistoryFeed lead={lead} stages={stages} users={users} courses={courses} leadSources={sources} />
                            </div>
                        )}
                        {tab === "followup" && <LeadFollowupPanel lead={lead} users={users} />}
                    </>
                )}
            </div>

            {editOpen && <LeadDialogById leadId={leadId} onClose={() => { setEditOpen(false); qc.invalidateQueries({ queryKey: ["lead", leadId] }) }} initialTab="details" />}
        </aside>
    )
}
