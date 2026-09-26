// Gestão > Tutor Virtual — IA que responde PRIMEIRO os chamados do Portal do Aluno.
// Usa a Base de Conhecimento marcada como "Alunos" (ou "Ambos") e consulta o Sponte do
// próprio aluno (matrículas, financeiro, link de pagamento, notas). Passa pra fila humana
// pelas regras abaixo; quando alguém da equipe responde, sai daquele chamado.
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BookOpen, GraduationCap, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showError, showSuccess } from "@/utils/toast"

interface TutorSettings {
    enabled: boolean; nome: string; system_prompt: string; handoff_instructions: string
    chat_model: string; temperature: number; max_turns: number
    horario_atendimento: string; handoff_message: string
}
const fieldLabel = "text-xs font-bold uppercase tracking-widest text-muted-foreground"
const textareaCls = "w-full min-h-[150px] rounded-xl border border-[var(--border)] bg-muted/20 p-3 text-sm leading-relaxed text-[var(--text-main)] outline-none focus:border-primary custom-scrollbar"

export function TutorVirtualSettings() {
    const qc = useQueryClient()
    const [form, setForm] = useState<TutorSettings | null>(null)
    const [saving, setSaving] = useState(false)

    const { data } = useQuery({
        queryKey: ["tutor_settings"],
        queryFn: async () => {
            const { data, error } = await supabase.from("tutor_settings").select("*").eq("id", 1).single()
            if (error) throw error
            return data as TutorSettings
        },
    })
    useEffect(() => { if (data) setForm(data) }, [data])

    const { data: kb } = useQuery({
        queryKey: ["kb_alunos_stats"],
        queryFn: async () => {
            const { data } = await supabase.from("knowledge_base").select("index_status, ai_enabled, chunk_count, publico")
            const docs = (data ?? []).filter((d: any) => d.ai_enabled !== false && ["alunos", "ambos"].includes(d.publico))
            return { total: docs.length, ready: docs.filter((d: any) => d.index_status === "ready").length }
        },
    })

    const { data: stats } = useQuery({
        queryKey: ["tutor_stats"],
        queryFn: async () => {
            const since = new Date(Date.now() - 30 * 86400_000).toISOString()
            const { data } = await supabase.from("tickets").select("ai_status, ai_turns, status").gte("created_at", since).eq("origem", "portal")
            const rows = data ?? []
            const atendidos = rows.filter((r: any) => r.ai_turns > 0)
            return {
                total: rows.length, atendidos: atendidos.length,
                resolvidosSemHumano: atendidos.filter((r: any) => r.ai_status === "active" && ["resolvido", "fechado", "aguardando_aluno"].includes(r.status)).length,
                passados: atendidos.filter((r: any) => r.ai_status === "handed_off").length,
            }
        },
    })

    const set = <K extends keyof TutorSettings>(k: K, v: TutorSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

    const save = async () => {
        if (!form) return
        setSaving(true)
        const { data: { user } } = await supabase.auth.getUser()
        const { data: ok, error } = await supabase.from("tutor_settings").update({
            enabled: form.enabled, nome: form.nome.trim() || "Tutor Virtual", system_prompt: form.system_prompt,
            handoff_instructions: form.handoff_instructions, chat_model: form.chat_model.trim(),
            temperature: Number(form.temperature), max_turns: Number(form.max_turns),
            horario_atendimento: form.horario_atendimento.trim(), handoff_message: form.handoff_message,
            updated_at: new Date().toISOString(), updated_by: user?.id ?? null,
        }).eq("id", 1).select("id")
        setSaving(false)
        if (error || !ok?.length) return showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada, recarregue."}`)
        qc.invalidateQueries({ queryKey: ["tutor_settings"] })
        showSuccess("Tutor Virtual salvo.")
    }

    if (!form) return <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
                <CardHeader>
                    <CardTitle className="text-2xl font-bold flex items-center gap-2"><GraduationCap size={22} className="text-primary" /> Tutor Virtual</CardTitle>
                    <CardDescription className="text-sm">
                        Responde primeiro todo chamado aberto no Portal do Aluno, com a Base de Conhecimento dos <b>Alunos</b> e os dados do aluno no Sponte
                        (matrículas, financeiro, link de pagamento, notas). Passa pra fila humana quando não resolver — e sai do chamado quando alguém da equipe responde.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-4">
                        <div>
                            <p className="text-sm font-bold text-[var(--text-main)]">Responder chamados automaticamente</p>
                            <p className="text-xs text-muted-foreground">Desligado = chamados vão direto pra fila humana.</p>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold">
                            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
                            {form.enabled ? "Ligado" : "Desligado"}
                        </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                        <div className="rounded-xl bg-muted/30 p-3">
                            <p className="text-lg font-bold flex items-center justify-center gap-1.5"><BookOpen size={16} /> {kb?.ready ?? 0}/{kb?.total ?? 0}</p>
                            <p className="text-[10px] uppercase text-muted-foreground">docs "Alunos" indexados</p>
                        </div>
                        <div className="rounded-xl bg-muted/30 p-3">
                            <p className="text-lg font-bold">{stats?.atendidos ?? 0}<span className="text-sm text-muted-foreground">/{stats?.total ?? 0}</span></p>
                            <p className="text-[10px] uppercase text-muted-foreground">chamados atendidos (30d)</p>
                        </div>
                        <div className="rounded-xl bg-muted/30 p-3">
                            <p className="text-lg font-bold">{stats?.passados ?? 0}</p>
                            <p className="text-[10px] uppercase text-muted-foreground">passados pra equipe (30d)</p>
                        </div>
                    </div>
                    {(kb?.total ?? 0) === 0 && (
                        <p className="text-xs text-amber-500 rounded-lg bg-amber-500/10 p-3">
                            Nenhum documento marcado para <b>Alunos</b> ainda. Em Base de Conhecimento, suba os documentos da Secretaria (regulamentos, prazos, procedimentos)
                            com o filtro "🎓 Alunos" selecionado — ou mude o Público de um documento existente.
                        </p>
                    )}

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2"><Label className={fieldLabel}>Nome</Label>
                            <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} className="bg-muted/20" /></div>
                        <div className="space-y-2"><Label className={fieldLabel}>Modelo (OpenAI)</Label>
                            <Input value={form.chat_model} onChange={(e) => set("chat_model", e.target.value)} className="bg-muted/20 font-mono text-sm" /></div>
                        <div className="space-y-2"><Label className={fieldLabel}>Máx. respostas</Label>
                            <Input type="number" min={1} value={form.max_turns} onChange={(e) => set("max_turns", Number(e.target.value))} className="bg-muted/20" /></div>
                    </div>
                    <div className="space-y-2"><Label className={fieldLabel}>Persona e instruções</Label>
                        <textarea className={textareaCls} value={form.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} /></div>
                    <div className="space-y-2"><Label className={fieldLabel}>Quando passar para a equipe</Label>
                        <textarea className={`${textareaCls} min-h-[130px]`} value={form.handoff_instructions} onChange={(e) => set("handoff_instructions", e.target.value)} /></div>
                    <div className="space-y-2"><Label className={fieldLabel}>Horário de atendimento da equipe</Label>
                        <Input value={form.horario_atendimento} onChange={(e) => set("horario_atendimento", e.target.value)} className="bg-muted/20" /></div>
                    <div className="space-y-2"><Label className={fieldLabel}>Mensagem ao passar para a equipe</Label>
                        <textarea className={`${textareaCls} min-h-[140px]`} value={form.handoff_message} onChange={(e) => set("handoff_message", e.target.value)} />
                        <p className="text-[11px] text-muted-foreground">
                            Enviada sempre que o chamado vai pra equipe (a IA não improvisa). Variáveis: {"{primeiro_nome}"}, {"{fila}"}, {"{horario}"}, {"{email}"}, {"{protocolo}"},
                            {" {resposta_email}"} (vira "e pode responder direto por lá…" só quando a resposta por e-mail estiver ativa).
                        </p>
                    </div>
                    <Button onClick={save} disabled={saving} className="w-full">{saving ? <Loader2 className="animate-spin" size={16} /> : "Salvar"}</Button>
                </CardContent>
            </Card>
        </div>
    )
}
