// Gestão > VivaConnect > Hub do Grupo Cidade Viva — o número oficial antigo (83 3041-7471)
// é de todo o grupo. Contato NOVO passa pela triagem (supabase/functions/_shared/hub.ts):
// Faculdade fica neste número; outra empresa recebe o número novo (e o canal dela, se
// cadastrado, já chama a pessoa); sem assunto claro, a IA pergunta de forma natural — nunca
// um menu numerado (29/09, pedido do usuário: "parece robótico").
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, FlaskConical, Loader2, Plus, Shuffle, Trash2, Upload } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { showError, showSuccess } from "@/utils/toast"

interface Dest {
    id: number; nome: string; emoji: string; assuntos: string; is_self: boolean; numero: string | null
    channel_id: number | null; avisar_destino: boolean; mensagem_redirect: string; mensagem_destino: string
    ativo: boolean; ordem: number; logo_url: string | null; mensagem_sem_numero: string
    zpro_queue_id: number | null; mensagem_fila: string
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
/** Logo da empresa (ou o emoji, se não tiver logo) */
function Logo({ d, size = 28 }: { d: Pick<Dest, "logo_url" | "emoji" | "nome">; size?: number }) {
    return d.logo_url
        ? <img src={d.logo_url} alt={d.nome} style={{ width: size, height: size }} className="rounded-md object-cover shrink-0 bg-white/5" />
        : <span style={{ width: size, height: size, fontSize: size * 0.7 }} className="flex items-center justify-center shrink-0">{d.emoji}</span>
}
const fmt = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })

export function VivaConnectHub({ channels }: { channels: Ch[] }) {
    const qc = useQueryClient()
    const [draft, setDraft] = useState<Dest[]>([])
    const [open, setOpen] = useState<number | null>(null)
    const [saving, setSaving] = useState<number | "ask" | null>(null)
    const [ask, setAsk] = useState<{ hub_ask_instructions: string; hub_max_questions: number } | null>(null)
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
        queryFn: async () => (await supabase.from("vivaconnect_settings").select("hub_ask_instructions, hub_max_questions").eq("id", 1).single()).data,
    })
    useEffect(() => { if (settings) setAsk({ hub_ask_instructions: (settings as any).hub_ask_instructions ?? "", hub_max_questions: (settings as any).hub_max_questions }) }, [settings])

    const { data: routings } = useQuery({
        queryKey: ["hub_routings"],
        queryFn: async () => {
            const { data } = await supabase.from("vivaconnect_hub_routings").select("*").order("updated_at", { ascending: false }).limit(60)
            return (data ?? []) as Routing[]
        },
        refetchInterval: 20000,
    })

    const { data: iaLigada } = useQuery({
        queryKey: ["ai_agent_enabled"],
        queryFn: async () => !!(await supabase.from("ai_agent_settings").select("enabled").eq("id", 1).single()).data?.enabled,
    })
    const hubChannels = channels.filter((c) => c.hub_enabled)
    const grupoChannels = channels.filter((c) => c.purpose === "grupo")
    const set = (id: number, patch: Partial<Dest>) => setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    const destOf = (id: number | null) => draft.find((x) => x.id === id) ?? null
    const [uploading, setUploading] = useState<number | null>(null)
    const uploadLogo = async (d: Dest, file: File | undefined) => {
        if (!file) return
        if (!file.type.startsWith("image/")) return showError("Escolha uma imagem (PNG ou JPG).")
        if (file.size > 2 * 1024 * 1024) return showError("Imagem muito grande (máx. 2 MB).")
        setUploading(d.id)
        const ext = (file.name.split(".").pop() || "png").toLowerCase()
        const path = `hub-logos/${d.id}-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from("agent-photos").upload(path, file, { upsert: true, contentType: file.type })
        if (error) { setUploading(null); return showError(`Não foi possível enviar: ${error.message}`) }
        const url = supabase.storage.from("agent-photos").getPublicUrl(path).data.publicUrl
        const { data, error: e2 } = await supabase.from("vivaconnect_hub_destinations").update({ logo_url: url, updated_at: new Date().toISOString() }).eq("id", d.id).select("id")
        setUploading(null)
        if (e2 || !data?.length) return showError(`Não foi possível salvar o logo: ${e2?.message ?? "sessão expirada."}`)
        set(d.id, { logo_url: url })
        qc.invalidateQueries({ queryKey: ["hub_destinations"] })
        showSuccess(`Logo de ${d.nome} atualizado.`)
    }

    const saveDest = async (d: Dest) => {
        if (!d.nome.trim()) return showError("Dê um nome.")
        if (!d.is_self && d.numero && digits(d.numero).length < 10) return showError(`${d.nome}: número novo incompleto (inclua o DDD) — ou deixe em branco.`)
        if (!d.is_self && d.zpro_queue_id !== null && !d.zpro_queue_id) return showError(`${d.nome}: preencha o ID da fila no Z-PRO (Configurações > Filas de lá).`)
        setSaving(d.id)
        const { data, error } = await supabase.from("vivaconnect_hub_destinations").update({
            nome: d.nome.trim(), emoji: d.emoji.trim() || "🏢", assuntos: d.assuntos, numero: digits(d.numero) || null,
            channel_id: d.channel_id, avisar_destino: d.avisar_destino, mensagem_redirect: d.mensagem_redirect,
            mensagem_destino: d.mensagem_destino, mensagem_sem_numero: d.mensagem_sem_numero, ativo: d.ativo, ordem: Number(d.ordem) || 0,
            zpro_queue_id: d.zpro_queue_id, mensagem_fila: d.mensagem_fila, updated_at: new Date().toISOString(),
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
    const saveAsk = async () => {
        if (!ask) return
        setSaving("ask")
        const { data, error } = await supabase.from("vivaconnect_settings").update({
            hub_ask_instructions: ask.hub_ask_instructions.trim() || null, hub_max_questions: Math.max(1, Number(ask.hub_max_questions) || 2),
        }).eq("id", 1).select("id")
        setSaving(null)
        if (error || !data?.length) return showError(`Não foi possível salvar: ${error?.message ?? "sessão expirada."}`)
        qc.invalidateQueries({ queryKey: ["hub_settings"] })
        showSuccess("Instruções salvas.")
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
                    (e o canal da empresa, se cadastrado, já chama a pessoa) <i>ou</i>, pra empresa sem número próprio, é movida direto pra fila
                    dela dentro do painel do Z-PRO (a equipe de lá assume por lá mesmo, sem a gente entrar na conversa); sem assunto claro, a
                    <b> IA pergunta naturalmente</b> (sem menu numerado). Alunos e leads que já conhecemos não passam pela triagem.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className={`rounded-xl p-3 text-sm ${hubChannels.length ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                    {hubChannels.length
                        ? <>Hub ligado em: <b>{hubChannels.map((c) => `${c.name} (${c.phone ?? "sem número"})`).join(", ")}</b></>
                        : <>Hub ainda <b>desligado</b>: cadastre o número oficial (83 3041-7471) acima como <b>Oficial</b>, tipo <b>Híbrido</b>, e marque <b>🔀 Hub do Grupo</b> no cartão dele.</>}
                </div>

                {iaLigada === false && (
                    <div className="rounded-xl p-3 text-sm bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        A <b>IA de Atendimento</b> está desligada (Gestão &gt; IA de Atendimento). A triagem do Hub funciona, mas quem for da Faculdade
                        só vira lead e espera um agente — ligue a IA pra ela já ir atendendo.
                    </div>
                )}

                {/* ── Destinos ── */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className={fieldLabel}>Empresas do grupo (destinos)</p>
                        <Button size="sm" variant="outline" onClick={addDest}><Plus size={14} className="mr-1" /> Empresa</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Toda empresa <b>ativa</b> entra na triagem. Com número novo, a pessoa recebe o número; <b>sem número ainda</b>, recebe a mensagem de “sem número” (e nunca vira lead da Faculdade). Os <b>assuntos</b> são o que a IA lê pra decidir — seja específico.</p>
                    {draft.map((d) => {
                        const aberto = open === d.id
                        const emFila = d.zpro_queue_id !== null
                        const pronto = d.is_self || emFila || digits(d.numero).length >= 10
                        return (
                            <div key={d.id} className="rounded-xl border border-[var(--border)]">
                                <button onClick={() => setOpen(aberto ? null : d.id)} className="w-full flex items-center gap-3 p-3 text-left">
                                    {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <Logo d={d} />
                                    <span className="font-semibold text-sm text-[var(--text-main)] flex-1">{d.nome}{d.is_self && <span className="ml-2 text-[11px] font-normal text-muted-foreground">fica neste número</span>}</span>
                                    <span className="text-xs text-muted-foreground font-mono">{d.is_self ? "" : emFila ? `fila Z-PRO #${d.zpro_queue_id}` : d.numero ? digits(d.numero) : "sem número"}</span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${d.ativo ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                                        {d.ativo ? (pronto ? "na triagem" : "na triagem · sem número") : "desligada"}
                                    </span>
                                </button>
                                {aberto && (
                                    <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)] pt-3">
                                        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_220px] gap-3">
                                            <div className="space-y-1"><p className={fieldLabel}>Logo</p>
                                                <label className="flex items-center gap-2 cursor-pointer h-10" title="Trocar o logo (PNG/JPG quadrado)">
                                                    <Logo d={d} size={40} />
                                                    <span className="text-xs text-primary flex items-center gap-1">
                                                        {uploading === d.id ? <Loader2 className="animate-spin" size={12} /> : <Upload size={12} />} trocar
                                                    </span>
                                                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                                                        onChange={(e) => { uploadLogo(d, e.target.files?.[0]); e.target.value = "" }} />
                                                </label></div>
                                            <div className="space-y-1"><p className={fieldLabel}>Nome</p><Input value={d.nome} onChange={(e) => set(d.id, { nome: e.target.value })} className="bg-muted/20" /></div>
                                            {!d.is_self && !emFila && <div className="space-y-1"><p className={fieldLabel}>Número novo (WhatsApp)</p>
                                                <Input value={d.numero ?? ""} onChange={(e) => set(d.id, { numero: e.target.value })} placeholder="83 99999-0000" className="bg-muted/20 font-mono" /></div>}
                                            {!d.is_self && emFila && <div className="space-y-1"><p className={fieldLabel}>Fila no Z-PRO (ID)</p>
                                                <Input type="number" value={d.zpro_queue_id ?? ""} onChange={(e) => set(d.id, { zpro_queue_id: e.target.value ? Number(e.target.value) : null })} className="bg-muted/20 font-mono" /></div>}
                                        </div>
                                        <div className="space-y-1"><p className={fieldLabel}>Assuntos (a IA lê isto pra decidir)</p>
                                            <textarea className={textareaCls} value={d.assuntos} onChange={(e) => set(d.id, { assuntos: e.target.value })} /></div>
                                        {!d.is_self && (
                                            <div className="flex items-center gap-3 text-sm rounded-xl border border-[var(--border)] p-3">
                                                <span className="text-muted-foreground shrink-0">Como encaminhar</span>
                                                <div className="flex gap-2">
                                                    <button type="button" onClick={() => set(d.id, { zpro_queue_id: null })}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!emFila ? "bg-primary text-white border-primary" : "border-[var(--border)] text-muted-foreground"}`}>
                                                        Número novo (WhatsApp próprio)
                                                    </button>
                                                    <button type="button" onClick={() => set(d.id, { zpro_queue_id: d.zpro_queue_id ?? 0 })}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${emFila ? "bg-primary text-white border-primary" : "border-[var(--border)] text-muted-foreground"}`}>
                                                        Fila no Z-PRO (mesmo número oficial)
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {!d.is_self && !emFila && (
                                            <>
                                                <div className="space-y-1"><p className={fieldLabel}>Mensagem enquanto a empresa não tem número novo</p>
                                                    <textarea className={textareaCls} value={d.mensagem_sem_numero} onChange={(e) => set(d.id, { mensagem_sem_numero: e.target.value })} />
                                                    <p className="text-[11px] text-muted-foreground">Usada {pronto ? "se o número for apagado" : <b>agora</b>}. Variáveis: {"{primeiro_nome}"}, {"{nome_virgula}"}, {"{empresa}"}. Dica: inclua o site ou o Instagram da empresa.</p></div>
                                                <div className="space-y-1"><p className={fieldLabel}>Mensagem com o número novo</p>
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
                                        {!d.is_self && emFila && (
                                            <div className="space-y-1"><p className={fieldLabel}>Mensagem ao encaminhar pra fila</p>
                                                <textarea className={textareaCls} value={d.mensagem_fila} onChange={(e) => set(d.id, { mensagem_fila: e.target.value })} />
                                                <p className="text-[11px] text-muted-foreground">
                                                    Enviada na hora, pelo mesmo número — a pessoa não troca de WhatsApp. O ticket é movido pra essa fila dentro do painel do Z-PRO
                                                    (Configurações &gt; Filas de lá tem o ID certo) e a equipe assume por lá, direto — a gente não entra mais nessa conversa.
                                                    Variáveis: {"{primeiro_nome}"}, {"{nome_virgula}"}, {"{empresa}"}.
                                                </p></div>
                                        )}
                                        <div className="flex items-center gap-4">
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="checkbox" checked={d.ativo} onChange={(e) => set(d.id, { ativo: e.target.checked })} className="accent-[var(--primary)]" /> ativa na triagem
                                            </label>
                                            <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">ordem na triagem</span>
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

                {/* ── Pergunta natural (quando não dá pra saber o assunto) ── */}
                {ask && (
                    <div className="space-y-1">
                        <p className={fieldLabel}>Instruções extras pra IA perguntar (opcional)</p>
                        <textarea className={`${textareaCls} min-h-[80px]`} placeholder="Ex.: seja bem informal, use 'vc'... (a IA já escreve a pergunta sozinha; isto só ajusta o tom/estilo, se quiser)"
                            value={ask.hub_ask_instructions} onChange={(e) => setAsk({ ...ask, hub_ask_instructions: e.target.value })} />
                        <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-[11px] text-muted-foreground flex-1">Não é mais um texto fixo — a IA conversa naturalmente até descobrir a empresa (sem menu numerado). Isto aqui é só uma dica de tom, se quiser.</p>
                            <span className="text-xs text-muted-foreground">Perguntas antes de seguir pra Faculdade</span>
                            <Input type="number" min={1} value={ask.hub_max_questions} onChange={(e) => setAsk({ ...ask, hub_max_questions: Number(e.target.value) })} className="bg-muted/20 w-16 h-8" />
                            <Button size="sm" onClick={saveAsk} disabled={saving === "ask"}>{saving === "ask" ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}</Button>
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
                                → {p.acao === "encaminhar" ? `Encaminha para ${p.destino}` : p.acao === "encaminhar_fila" ? `Move pra fila do Z-PRO de ${p.destino} (mesmo número)` : p.acao === "faculdade" ? `Fica na Faculdade (vira lead${p.metodo === "fallback" ? ", sem assunto claro" : ""})` : p.acao === "perguntar" ? "Pergunta (natural, sem menu)" : "Não responde"}
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
                            {porDestino.map(({ d, n }) => <span key={d.id} className="px-2.5 py-1 rounded-full bg-muted/40 flex items-center gap-1.5"><Logo d={d} size={16} /> {d.nome}: <b>{n}</b></span>)}
                            {semResposta > 0 && <span className="px-2.5 py-1 rounded-full bg-muted/40">❔ aguardando resposta: <b>{semResposta}</b></span>}
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
                                    {(() => {
                                        const d = r.status === "encaminhado" ? destOf(r.destination_id) : r.status === "faculdade" ? draft.find((x) => x.is_self) ?? null : null
                                        return d ? <span className="inline-flex items-center gap-1.5"><Logo d={d} size={16} /> {d.is_self ? "Faculdade" : d.nome}</span> : "❔ pergunta enviada"
                                    })()}
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
