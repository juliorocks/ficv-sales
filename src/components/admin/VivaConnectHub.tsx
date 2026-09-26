// Gestão > VivaConnect > Hub do Grupo Cidade Viva — o número oficial antigo (83 3041-7471)
// é de todo o grupo. Contato NOVO passa pela triagem (supabase/functions/_shared/hub.ts):
// Faculdade fica neste número; outra empresa recebe o número novo (e o canal dela, se
// cadastrado, já chama a pessoa); sem assunto claro → menu numerado.
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, FlaskConical, Loader2, Plus, Shuffle, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { showError, showSuccess } from "@/utils/toast"

interface Dest {
    id: number; nome: string; emoji: string; assuntos: string; is_self: boolean; numero: string | null
    channel_id: number | null; avisar_destino: boolean; mensagem_redirect: string; mensagem_destino: string
    ativo: boolean; ordem: number
}
interface Routing {
    id: number; number: string; contact_name: string | null; status: "perguntando" | "faculdade" | "encaminhado"
    destination_id: number | null; metodo: string | null; motivo: string | null; menus: number
    messages: { de: string; texto: string }[]; lead_id: number | null; created_at: string; updated_at: string
}
type Ch = { id: number; name: string; purpose: string; phone: string | null; hub_enabled: boolean }

const fieldLabel = "text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
const textareaCls = "w-full min-h-[80px] rounded-xl border border-[var(--border)] bg-muted/20 p-3 text-sm leading-relaxed text-[var(--text-main)] outline-none focus:border-primary custom-scrollbar"
const digits = (v: string | null) => String(v ?? "").replace(/\D/g, "")
const fmt = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })

export function VivaConnectHub({ channels }: { channels: Ch[] }) {
    const qc = useQueryClient()
    const [draft, setDraft] = useState<Dest[]>([])
    const [open, setOpen] = useState<number | null>(null)
    const [saving, setSaving] = useState<number | "menu" | null>(null)
    const [menu, setMenu] = useState<{ hub_menu_template: string; hub_max_menus: number } | null>(null)
    const [sim, setSim] = useState({ nome: "Maria", texto: "oi\nquero saber como me tornar membro" })
    const [simOut, setSimOut] = useState<any>(null)
    const [simBusy, setSimBusy] = useState(false)

    const { data: dests } = useQuery({
        queryKey: ["hub_destinations"],
        queryFn: async () => {
            const { data, error } = await supabase.from("vivaconnect_hub_destinations").select("*").order("ordem").order("id")
            if (error) throw error
            return data as Dest[]
        },
    })
    useEffect(() => { if (dests) setDraft(dests) }, [dests])

    const { data: settings } = useQuery({
        queryKey: ["hub_settings"],
        queryFn: async () => (await supabase.from("vivaconnect_settings").select("hub_menu_template, hub_max_menus").eq("id", 1).single()).data,
    })
    useEffect(() => { if (settings) setMenu(settings as any) }, [settings])

    const { data: routings } = useQuery({
        queryKey: ["hub_routings"],
        queryFn: async () => {
            const { data } = await supabase.from("vivaconnect_hub_routings").select("*").order("updated_at", { ascending: false }).limit(60)
            return (data ?? []) as Routing[]
        },
        refetchInterval: 20000,
    })

    const hubChannels = channels.filter((c) => c.hub_enabled)
    const grupoChannels = channels.filter((c) => c.purpose === "grupo")
    const set = (id: number, patch: Partial<Dest>) => setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    const destName = (id: number | null) => { const d = draft.find((x) => x.id === id); return d ? `${d.emoji} ${d.nome}` : "—" }

    const saveDest = async (d: Dest) => {
        if (!d.nome.trim()) return showError("Dê um nome.")
        if (d.ativo && !d.is_self && digits(d.numero).length < 10) return showError(`${d.nome}: informe o número novo (com DDD) antes de ativar.`)
        setSaving(d.id)
        const { data, error } = await supabase.from("vivaconnect_hub_destinations").update({
            nome: d.nome.trim(), emoji: d.emoji.trim() || "🏢", assuntos: d.assuntos, numero: digits(d.numero) || null,
            channel_id: d.channel_id, avisar_destino: d.avisar_destino, mensagem_redirect: d.mensagem_redirect,
            mensagem_destino: d.mensagem_destino, ativo: d.ativo, ordem: Number(d.ordem) || 0, updated_at: new Date().toISOString(),
        }).eq("id", d.id).select("id")
        setSaving(null)
        if (error || !data?.length) return showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada, recarregue."}`)
        qc.invalidateQueries({ queryKey: ["hub_destinations"] })
        showSuccess(`${d.nome} salvo.`)
    }
    const addDest = async () => {
        const { error } = await supabase.from("vivaconnect_hub_destinations").insert({ nome: "Nova empresa", ativo: false, ordem: draft.length + 1 })
        if (error) return showError(error.message)
        qc.invalidateQueries({ queryKey: ["hub_destinations"] })
    }
    const removeDest = async (d: Dest) => {
        if (!confirm(`Remover "${d.nome}" do hub?`)) return
        const { error } = await supabase.from("vivaconnect_hub_destinations").delete().eq("id", d.id)
        if (error) return showError(error.message)
        qc.invalidateQueries({ queryKey: ["hub_destinations"] })
    }
    const saveMenu = async () => {
        if (!menu) return
        setSaving("menu")
        const { data, error } = await supabase.from("vivaconnect_settings").update({
            hub_menu_template: menu.hub_menu_template, hub_max_menus: Math.max(1, Number(menu.hub_max_menus) || 2),
        }).eq("id", 1).select("id")
        setSaving(null)
        if (error || !data?.length) return showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada."}`)
        qc.invalidateQueries({ queryKey: ["hub_settings"] })
        showSuccess("Menu salvo.")
    }
    const simulate = async () => {
        setSimBusy(true); setSimOut(null)
        const { data, error } = await supabase.functions.invoke("vivaconnect-api", {
            body: { action: "hub_simulate", nome: sim.nome, mensagens: sim.texto.split("\n").map((l) => l.trim()).filter(Boolean) },
        })
        setSimBusy(false)
        if (error || data?.error) {
            const ctx = await (error as any)?.context?.json?.().catch(() => null)
            return showError(data?.error ?? ctx?.error ?? "Falha no simulador.")
        }
        setSimOut(data)
    }

    // contagem dos últimos 30 dias por destino
    const since = Date.now() - 30 * 86400_000
    const recentes = (routings ?? []).filter((r) => new Date(r.created_at).getTime() >= since)
    const porDestino = draft.map((d) => ({ d, n: recentes.filter((r) => r.destination_id === d.id).length })).filter((x) => x.n > 0)
    const semResposta = recentes.filter((r) => r.status === "perguntando").length

    return (
        <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
            <CardHeader>
                <CardTitle className="text-xl font-bold flex items-center gap-2"><Shuffle size={20} className="text-primary" /> Hub do Grupo Cidade Viva</CardTitle>
                <CardDescription className="text-sm">
                    O número oficial antigo é de todo o grupo. Quem escrever nele pela 1ª vez passa por uma triagem: a IA entende o assunto e
                    — se for da <b>Faculdade</b>, segue aqui (Híbrido, sem custo Meta); se for de <b>outra empresa</b>, recebe o número novo dela
                    (e o canal da empresa, se cadastrado, já chama a pessoa); sem assunto claro, recebe um <b>menu</b>. Alunos e leads que já
                    conhecemos não passam pela triagem.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className={`rounded-xl p-3 text-sm ${hubChannels.length ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                    {hubChannels.length
                        ? <>Hub ligado em: <b>{hubChannels.map((c) => `${c.name} (${c.phone ?? "sem número"})`).join(", ")}</b></>
                        : <>Hub ainda <b>desligado</b>: cadastre o número oficial (83 3041-7471) acima como <b>Oficial</b>, tipo <b>Híbrido</b>, e marque <b>🔀 Hub do Grupo</b> no cartão dele.</>}
                </div>

                {/* ── Destinos ── */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className={fieldLabel}>Empresas do grupo (destinos)</p>
                        <Button size="sm" variant="outline" onClick={addDest}><Plus size={14} className="mr-1" /> Empresa</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Empresa só entra na triagem <b>ativa e com número novo</b>. Os <b>assuntos</b> são o que a IA lê pra decidir — seja específico.</p>
                    {draft.map((d) => {
                        const aberto = open === d.id
                        const pronto = d.is_self || digits(d.numero).length >= 10
                        return (
                            <div key={d.id} className="rounded-xl border border-[var(--border)]">
                                <button onClick={() => setOpen(aberto ? null : d.id)} className="w-full flex items-center gap-3 p-3 text-left">
                                    {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <span className="text-lg">{d.emoji}</span>
                                    <span className="font-semibold text-sm text-[var(--text-main)] flex-1">{d.nome}{d.is_self && <span className="ml-2 text-[11px] font-normal text-muted-foreground">fica neste número</span>}</span>
                                    <span className="text-xs text-muted-foreground font-mono">{d.is_self ? "" : d.numero ? digits(d.numero) : "sem número"}</span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${d.ativo && pronto ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                                        {d.ativo && pronto ? "na triagem" : !pronto ? "falta número" : "desligada"}
                                    </span>
                                </button>
                                {aberto && (
                                    <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)] pt-3">
                                        <div className="grid grid-cols-1 md:grid-cols-[70px_1fr_220px] gap-3">
                                            <div className="space-y-1"><p className={fieldLabel}>Emoji</p><Input value={d.emoji} onChange={(e) => set(d.id, { emoji: e.target.value })} className="bg-muted/20 text-center" /></div>
                                            <div className="space-y-1"><p className={fieldLabel}>Nome</p><Input value={d.nome} onChange={(e) => set(d.id, { nome: e.target.value })} className="bg-muted/20" /></div>
                                            {!d.is_self && <div className="space-y-1"><p className={fieldLabel}>Número novo (WhatsApp)</p>
                                                <Input value={d.numero ?? ""} onChange={(e) => set(d.id, { numero: e.target.value })} placeholder="83 99999-0000" className="bg-muted/20 font-mono" /></div>}
                                        </div>
                                        <div className="space-y-1"><p className={fieldLabel}>Assuntos (a IA lê isto pra decidir)</p>
                                            <textarea className={textareaCls} value={d.assuntos} onChange={(e) => set(d.id, { assuntos: e.target.value })} /></div>
                                        {!d.is_self && (
                                            <>
                                                <div className="space-y-1"><p className={fieldLabel}>Mensagem enviada pelo número antigo</p>
                                                    <textarea className={textareaCls} value={d.mensagem_redirect} onChange={(e) => set(d.id, { mensagem_redirect: e.target.value })} />
                                                    <p className="text-[11px] text-muted-foreground">Variáveis: {"{primeiro_nome}"}, {"{nome_virgula}"} (vira ", Maria"), {"{empresa}"}, {"{numero}"}, {"{link}"} (wa.me do número novo).</p></div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                                                    <div className="space-y-1"><p className={fieldLabel}>Canal da empresa no VivaConnect (opcional)</p>
                                                        <select value={d.channel_id ?? ""} onChange={(e) => set(d.id, { channel_id: e.target.value ? Number(e.target.value) : null })}
                                                            className="w-full h-10 rounded-md border border-[var(--border)] bg-muted/20 px-3 text-sm">
                                                            <option value="">— nenhum (só informa o número novo) —</option>
                                                            {grupoChannels.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone ?? "sem número"}</option>)}
                                                        </select></div>
                                                    <label className="flex items-center gap-2 text-sm cursor-pointer h-10">
                                                        <input type="checkbox" checked={d.avisar_destino} disabled={!d.channel_id} onChange={(e) => set(d.id, { avisar_destino: e.target.checked })} className="accent-[var(--primary)]" />
                                                        O canal da empresa já chama a pessoa
                                                    </label>
                                                </div>
                                                {!grupoChannels.length && <p className="text-[11px] text-muted-foreground">Pra o canal da empresa chamar a pessoa, cadastre o número dela acima com o uso <b>“Outra empresa do grupo”</b>.</p>}
                                                {d.channel_id && d.avisar_destino && (
                                                    <div className="space-y-1"><p className={fieldLabel}>Mensagem do canal da empresa pra pessoa</p>
                                                        <textarea className={textareaCls} value={d.mensagem_destino} onChange={(e) => set(d.id, { mensagem_destino: e.target.value })} />
                                                        <p className="text-[11px] text-muted-foreground">Variáveis: {"{primeiro_nome}"}, {"{nome_virgula}"}, {"{empresa}"}, {"{mensagem}"} (o que a pessoa escreveu no número antigo).</p></div>
                                                )}
                                            </>
                                        )}
                                        <div className="flex items-center gap-4">
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="checkbox" checked={d.ativo} onChange={(e) => set(d.id, { ativo: e.target.checked })} className="accent-[var(--primary)]" /> ativa na triagem
                                            </label>
                                            <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">ordem no menu</span>
                                                <Input type="number" value={d.ordem} onChange={(e) => set(d.id, { ordem: Number(e.target.value) })} className="bg-muted/20 w-20 h-8" /></div>
                                            {!d.is_self && <Button size="icon" variant="ghost" className="ml-auto" onClick={() => removeDest(d)} title="Remover"><Trash2 size={14} /></Button>}
                                            <Button size="sm" onClick={() => saveDest(d)} disabled={saving === d.id} className={d.is_self ? "ml-auto" : ""}>
                                                {saving === d.id ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* ── Menu ── */}
                {menu && (
                    <div className="space-y-1">
                        <p className={fieldLabel}>Menu (quando não dá pra saber o assunto)</p>
                        <textarea className={`${textareaCls} min-h-[120px]`} value={menu.hub_menu_template} onChange={(e) => setMenu({ ...menu, hub_menu_template: e.target.value })} />
                        <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-[11px] text-muted-foreground flex-1">Variáveis: {"{nome_virgula}"}, {"{primeiro_nome}"}, {"{opcoes}"} (lista numerada das empresas ativas). A pessoa responde com o número.</p>
                            <span className="text-xs text-muted-foreground">Menus antes de seguir pra Faculdade</span>
                            <Input type="number" min={1} value={menu.hub_max_menus} onChange={(e) => setMenu({ ...menu, hub_max_menus: Number(e.target.value) })} className="bg-muted/20 w-16 h-8" />
                            <Button size="sm" onClick={saveMenu} disabled={saving === "menu"}>{saving === "menu" ? <Loader2 className="animate-spin" size={14} /> : "Salvar menu"}</Button>
                        </div>
                    </div>
                )}

                {/* ── Simulador ── */}
                <div className="rounded-xl border border-dashed border-[var(--border)] p-4 space-y-3">
                    <p className="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2"><FlaskConical size={16} /> Simulador — testa a triagem sem enviar nada</p>
                    <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 items-start">
                        <Input value={sim.nome} onChange={(e) => setSim({ ...sim, nome: e.target.value })} placeholder="Nome" className="bg-muted/20" />
                        <textarea className={`${textareaCls} min-h-[70px]`} value={sim.texto} onChange={(e) => setSim({ ...sim, texto: e.target.value })} placeholder="Uma mensagem por linha (ex.: oi ↵ 2)" />
                        <Button onClick={simulate} disabled={simBusy}>{simBusy ? <Loader2 className="animate-spin" size={14} /> : "Simular"}</Button>
                    </div>
                    {simOut?.passos?.map((p: any, i: number) => (
                        <div key={i} className="rounded-lg bg-muted/30 p-3 text-sm space-y-1">
                            <p><span className="text-muted-foreground">Pessoa:</span> “{p.fala}”</p>
                            <p className="font-semibold text-[var(--text-main)]">
                                → {p.acao === "encaminhar" ? `Encaminha para ${p.destino}` : p.acao === "faculdade" ? `Fica na Faculdade (vira lead${p.metodo === "fallback" ? ", sem assunto claro" : ""})` : p.acao === "menu" ? "Envia o menu" : "Não responde"}
                                {p.confianca != null && <span className="font-normal text-xs text-muted-foreground"> · {p.metodo} · confiança {Math.round(p.confianca * 100)}%</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">{p.motivo}</p>
                            {p.envia && <pre className="whitespace-pre-wrap text-xs bg-[var(--bg-card)] rounded p-2 border border-[var(--border)]">{p.envia}</pre>}
                            {p.avisa_empresa && <pre className="whitespace-pre-wrap text-xs bg-[var(--bg-card)] rounded p-2 border border-[var(--border)]"><b>Canal da empresa → pessoa:</b>{"\n"}{p.avisa_empresa}</pre>}
                        </div>
                    ))}
                    {simOut && <p className="text-[11px] text-muted-foreground">Na triagem agora: {simOut.destinos_ativos?.join(" · ")}</p>}
                </div>

                {/* ── Últimos direcionamentos ── */}
                <div className="space-y-2">
                    <p className={fieldLabel}>Últimos direcionamentos</p>
                    {porDestino.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {porDestino.map(({ d, n }) => <span key={d.id} className="px-2.5 py-1 rounded-full bg-muted/40">{d.emoji} {d.nome}: <b>{n}</b></span>)}
                            {semResposta > 0 && <span className="px-2.5 py-1 rounded-full bg-muted/40">❔ aguardando resposta do menu: <b>{semResposta}</b></span>}
                            <span className="text-muted-foreground self-center">últimos 30 dias</span>
                        </div>
                    )}
                    {!routings?.length && <p className="text-xs text-muted-foreground">Nenhum contato passou pelo hub ainda.</p>}
                    <div className="max-h-[360px] overflow-y-auto custom-scrollbar divide-y divide-[var(--border)]">
                        {routings?.map((r) => (
                            <div key={r.id} className="py-2 text-xs flex items-start gap-3">
                                <span className="text-muted-foreground w-28 shrink-0">{fmt(r.updated_at)}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[var(--text-main)]"><b>{r.contact_name ?? r.number}</b> <span className="text-muted-foreground font-mono">{r.number}</span></p>
                                    <p className="text-muted-foreground truncate">“{r.messages.filter((m) => m.de === "contato").map((m) => m.texto).join(" / ")}”</p>
                                </div>
                                <span className="shrink-0 text-right">
                                    {r.status === "encaminhado" ? destName(r.destination_id) : r.status === "faculdade" ? "🎓 Faculdade" : "❔ menu enviado"}
                                    <span className="block text-[10px] text-muted-foreground">{r.metodo ?? ""}{r.lead_id ? ` · lead #${r.lead_id}` : ""}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
