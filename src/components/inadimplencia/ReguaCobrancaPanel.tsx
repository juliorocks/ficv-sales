import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Pause, Play, RefreshCw, Search, Send } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { extractFnErrorMessage } from "@/utils/functionsError"
import { showError, showSuccess } from "@/utils/toast"
import { withTimeout } from "@/utils/withTimeout"

type Config = { modo: "teste" | "ligado"; email_ativo: boolean; whatsapp_ativo: boolean; limite_email_dia: number; limite_whatsapp_dia: number }
type Etapa = { id: number; dias: number; nome: string; assunto: string; texto: string; ativo: boolean; whatsapp_template: string | null }
type Envio = { id: number; aluno_id: number; numero_parcela: string | null; etapa_id: number; canal: string; status: string; destino: string | null; erro: string | null; created_at: string }
type AlunoLinha = { aluno_id: number; nome: string | null; turma: string | null; parcelas: number; atraso_max: number; vigente: boolean | null }

const card = "rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"
const campo = "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]"
const rotuloDias = (d: number) => (d < 0 ? `${-d} dias antes` : d === 0 ? "no vencimento" : `${d} dia${d === 1 ? "" : "s"} depois`)
const quando = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

async function sessaoOk() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error("Sessão expirada. Recarregue a página.")
}

async function chamar(body: Record<string, unknown>) {
    await sessaoOk()
    const { data, error } = await withTimeout(supabase.functions.invoke("regua-cobranca", { body }), 90000, "A régua")
    if (error) throw new Error(await extractFnErrorMessage(error))
    return data as any
}

export function ReguaCobrancaPanel() {
    const { user } = useAuth()
    const admin = user?.role === "admin"
    const qc = useQueryClient()
    const [ocupado, setOcupado] = useState<string | null>(null)
    const [simulacao, setSimulacao] = useState<any>(null)

    const { data: cfg, refetch: refetchCfg } = useQuery({
        queryKey: ["regua-config"],
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.from("regua_cobranca_config").select("*").eq("id", 1).maybeSingle(), 15000, "A configuração")
            if (error) throw new Error(error.message)
            return data as Config
        },
    })
    const { data: etapas = [], refetch: refetchEtapas } = useQuery({
        queryKey: ["regua-etapas"],
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.from("regua_cobranca_etapas").select("*").order("dias"), 15000, "As etapas")
            if (error) throw new Error(error.message)
            return (data ?? []) as Etapa[]
        },
    })
    const [filtroCanal, setFiltroCanal] = useState("")
    const [filtroStatus, setFiltroStatus] = useState("")
    const { data: hist, refetch: refetchHist, isFetching: carregandoHist } = useQuery({
        queryKey: ["regua-envios", filtroCanal, filtroStatus],
        queryFn: async () => {
            let q = supabase.from("regua_cobranca_envios").select("*").order("created_at", { ascending: false }).limit(300)
            if (filtroCanal) q = q.eq("canal", filtroCanal)
            if (filtroStatus) q = q.eq("status", filtroStatus)
            const { data, error } = await withTimeout(q, 20000, "O histórico")
            if (error) throw new Error(error.message)
            const envios = (data ?? []) as Envio[]
            const ids = [...new Set(envios.map((e) => e.aluno_id))]
            const nomes = new Map<number, string>()
            if (ids.length) {
                const { data: al } = await withTimeout(supabase.from("alunos").select("sponte_aluno_id, nome").in("sponte_aluno_id", ids), 20000, "Os nomes")
                for (const a of (al ?? []) as any[]) nomes.set(a.sponte_aluno_id, a.nome)
            }
            return { envios, nomes }
        },
    })
    const { data: relatorio } = useQuery({
        queryKey: ["inadimplencia"],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.rpc("inadimplencia_report"), 30000, "A consulta de inadimplência")
            if (error) throw new Error(error.message)
            return data as { alunos: AlunoLinha[] }
        },
    })

    const etapaPorId = useMemo(() => new Map(etapas.map((e) => [e.id, e])), [etapas])
    const hoje = new Date().toLocaleDateString("sv-SE")
    const resumoHoje = useMemo(() => {
        const r = { whatsapp: 0, email: 0, falhas: 0 }
        for (const e of hist?.envios ?? []) {
            if (e.created_at.slice(0, 10) !== hoje && new Date(e.created_at).toLocaleDateString("sv-SE") !== hoje) continue
            if (e.status === "falhou") r.falhas++
            else if (e.canal === "whatsapp") r.whatsapp++
            else if (e.canal === "email") r.email++
        }
        return r
    }, [hist, hoje])

    async function salvarConfig(patch: Partial<Config>, rotulo: string) {
        setOcupado("cfg")
        try {
            await sessaoOk()
            const { data, error } = await withTimeout(supabase.from("regua_cobranca_config").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1).select(), 15000, "Salvar")
            if (error) throw new Error(error.message)
            if (!data?.length) throw new Error("Nada foi alterado (sem permissão ou sessão expirada).")
            showSuccess(rotulo)
            await refetchCfg()
        } catch (e) { showError((e as Error).message) } finally { setOcupado(null) }
    }

    async function simular() {
        setOcupado("sim")
        try { setSimulacao(await chamar({ action: "simular" })) } catch (e) { showError((e as Error).message) } finally { setOcupado(null) }
    }

    async function rodarAgora() {
        if (!window.confirm("Rodar a régua agora? Os envios do dia saem imediatamente, respeitando os tetos diários.")) return
        setOcupado("rodar")
        try {
            const r = await chamar({ action: "rodar" })
            if (!r.enviou) showError(`Nada enviado: a régua está ${r.modo === "ligado" ? "ligada mas sem envio" : "pausada"}.`)
            else showSuccess(`Rodada concluída: ${r.whatsapp?.enfileirados ?? 0} WhatsApp, ${r.enviados ?? 0} e-mails.`)
            refetchHist()
        } catch (e) { showError((e as Error).message) } finally { setOcupado(null) }
    }

    if (!cfg) return <div className="flex items-center gap-2 p-6 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando a régua…</div>
    const ligada = cfg.modo === "ligado"

    return (
        <div className="space-y-6">
            {/* Estado */}
            <div className={card}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${ligada ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>
                            {ligada ? "Ligada" : "Pausada"}
                        </span>
                        <p className="text-sm text-[var(--text-muted)]">
                            {ligada ? "Roda todo dia às 9h (seg–sáb) pelos canais ativos." : "Nenhum envio automático sai enquanto estiver pausada."}
                        </p>
                    </div>
                    {admin && (
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" disabled={!!ocupado} onClick={simular}>{ocupado === "sim" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}Simular hoje</Button>
                            <Button variant="outline" size="sm" disabled={!!ocupado || !ligada} onClick={rodarAgora}>{ocupado === "rodar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Rodar agora</Button>
                            <Button size="sm" disabled={!!ocupado} onClick={() => salvarConfig({ modo: ligada ? "teste" : "ligado" }, ligada ? "Régua pausada" : "Régua ligada")}>
                                {ligada ? <><Pause className="mr-1 h-4 w-4" />Pausar</> : <><Play className="mr-1 h-4 w-4" />Ligar</>}
                            </Button>
                        </div>
                    )}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {([["whatsapp_ativo", "WhatsApp", "limite_whatsapp_dia"], ["email_ativo", "E-mail", "limite_email_dia"]] as const).map(([chave, nome, lim]) => (
                        <div key={chave} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                            <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-main)]">
                                <input type="checkbox" disabled={!admin || !!ocupado} checked={cfg[chave]} onChange={(e) => salvarConfig({ [chave]: e.target.checked } as Partial<Config>, `${nome} ${e.target.checked ? "ligado" : "desligado"}`)} />
                                {nome}
                            </label>
                            <LimiteDia valor={cfg[lim]} disabled={!admin || !!ocupado} onSalvar={(v) => salvarConfig({ [lim]: v } as Partial<Config>, `Teto de ${nome} salvo`)} />
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                    Hoje: {resumoHoje.whatsapp} WhatsApp · {resumoHoje.email} e-mails · {resumoHoje.falhas} falhas. O e-mail divide o teto do Resend com os chamados.
                </p>

                {simulacao && (
                    <div className="mt-4 rounded-lg bg-[var(--bg-main)] p-3 text-sm text-[var(--text-main)]">
                        <p className="font-medium">Se rodasse agora: {simulacao.whatsapp_a_enviar} alunos no WhatsApp (teto {cfg.limite_whatsapp_dia}/dia) e {simulacao.emails_a_enviar} no e-mail.</p>
                        <ul className="mt-1 grid gap-x-6 text-xs text-[var(--text-muted)] sm:grid-cols-2">
                            {Object.entries(simulacao.por_etapa ?? {}).map(([nome, v]: [string, any]) => <li key={nome}>{nome}: {v.parcelas} parcelas</li>)}
                        </ul>
                    </div>
                )}
            </div>

            {/* Etapas */}
            <div className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--text-main)]">Etapas e mensagens</h2>
                <p className="text-xs text-[var(--text-muted)]">Variáveis do e-mail: {"{nome}"}, {"{dias}"}, {"{vencimento}"}. O WhatsApp usa o template aprovado pela Meta (só leva o primeiro nome); etapa sem template não envia por WhatsApp.</p>
                <div className="grid gap-3 lg:grid-cols-2">
                    {etapas.map((e) => <EtapaCard key={e.id} etapa={e} admin={admin} onSalvo={() => refetchEtapas()} />)}
                </div>
            </div>

            {/* Envio avulso */}
            {admin && <EnvioAvulso alunos={relatorio?.alunos ?? []} etapas={etapas} onEnviado={() => { qc.invalidateQueries({ queryKey: ["regua-envios"] }) }} />}

            {/* Histórico */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-[var(--text-main)]">Histórico de envios</h2>
                    <div className="flex items-center gap-2 text-sm">
                        <select className={`${campo} w-auto`} value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)} aria-label="Canal">
                            <option value="">Todos os canais</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
                        </select>
                        <select className={`${campo} w-auto`} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Situação">
                            <option value="">Todas</option><option value="enviado">Enviados</option><option value="falhou">Falhas</option>
                        </select>
                        <button type="button" onClick={() => refetchHist()} className="rounded-full border border-[var(--border)] p-2 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]" aria-label="Atualizar">
                            <RefreshCw className={`h-4 w-4 ${carregandoHist ? "animate-spin" : ""}`} />
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead className="text-left text-xs text-[var(--text-muted)]">
                            <tr><th className="p-3">Quando</th><th className="p-3">Aluno</th><th className="p-3">Etapa</th><th className="p-3">Canal</th><th className="p-3">Destino</th><th className="p-3">Situação</th>{admin && <th className="p-3" />}</tr>
                        </thead>
                        <tbody>
                            {(hist?.envios ?? []).map((e) => (
                                <tr key={e.id} className="border-t border-[var(--border)] text-[var(--text-main)]">
                                    <td className="p-3 whitespace-nowrap">{quando(e.created_at)}</td>
                                    <td className="p-3">{hist?.nomes.get(e.aluno_id) ?? `#${e.aluno_id}`}{e.numero_parcela ? <span className="text-xs text-[var(--text-muted)]"> · parcela {e.numero_parcela}</span> : null}</td>
                                    <td className="p-3">{etapaPorId.get(e.etapa_id)?.nome ?? e.etapa_id}</td>
                                    <td className="p-3">{e.canal === "whatsapp" ? "WhatsApp" : e.canal === "email" ? "E-mail" : e.canal}</td>
                                    <td className="p-3 text-xs">{e.destino ?? "—"}</td>
                                    <td className="p-3">{e.status === "enviado" ? <span className="text-emerald-600">Enviado</span> : <span className="text-red-500" title={e.erro ?? ""}>Falhou{e.erro ? `: ${e.erro.slice(0, 40)}` : ""}</span>}</td>
                                    {admin && <td className="p-3 text-right"><ReenviarBotao envio={e} onFeito={() => refetchHist()} /></td>}
                                </tr>
                            ))}
                            {!hist?.envios.length && <tr><td className="p-6 text-center text-[var(--text-muted)]" colSpan={7}>Nenhum envio ainda.</td></tr>}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-[var(--text-muted)]">Mostra os 300 mais recentes. "Enviado" no WhatsApp quer dizer que entrou na fila de envio do canal oficial.</p>
            </div>
        </div>
    )
}

function LimiteDia({ valor, disabled, onSalvar }: { valor: number; disabled: boolean; onSalvar: (v: number) => void }) {
    const [v, setV] = useState(String(valor))
    const mudou = Number(v) !== valor && Number.isInteger(Number(v)) && Number(v) >= 0
    return (
        <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            teto/dia
            <Input className="h-8 w-20" type="number" min={0} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} />
            {mudou && !disabled && <Button size="sm" variant="outline" onClick={() => onSalvar(Number(v))}>Salvar</Button>}
        </span>
    )
}

function EtapaCard({ etapa, admin, onSalvo }: { etapa: Etapa; admin: boolean; onSalvo: () => void }) {
    const [f, setF] = useState(etapa)
    const [salvando, setSalvando] = useState(false)
    const mudou = JSON.stringify(f) !== JSON.stringify(etapa)
    async function salvar() {
        setSalvando(true)
        try {
            await sessaoOk()
            const { data, error } = await withTimeout(
                supabase.from("regua_cobranca_etapas").update({ nome: f.nome, assunto: f.assunto, texto: f.texto, ativo: f.ativo, whatsapp_template: f.whatsapp_template?.trim() || null }).eq("id", etapa.id).select(),
                15000, "Salvar")
            if (error) throw new Error(error.message)
            if (!data?.length) throw new Error("Nada foi alterado (sem permissão ou sessão expirada).")
            showSuccess("Etapa salva")
            onSalvo()
        } catch (e) { showError((e as Error).message) } finally { setSalvando(false) }
    }
    return (
        <div className={`${card} space-y-2 ${f.ativo ? "" : "opacity-60"}`}>
            <div className="flex items-center justify-between gap-2">
                <div>
                    <p className="font-semibold text-[var(--text-main)]">{etapa.nome}</p>
                    <p className="text-xs text-[var(--text-muted)]">{rotuloDias(etapa.dias)} do vencimento</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                    <input type="checkbox" disabled={!admin} checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativa
                </label>
            </div>
            <label className="block text-xs text-[var(--text-muted)]">Assunto do e-mail
                <input className={`${campo} mt-1`} disabled={!admin} value={f.assunto} onChange={(e) => setF({ ...f, assunto: e.target.value })} />
            </label>
            <label className="block text-xs text-[var(--text-muted)]">Texto do e-mail
                <textarea className={`${campo} mt-1`} rows={4} disabled={!admin} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
            </label>
            <label className="block text-xs text-[var(--text-muted)]">Template do WhatsApp (nome aprovado na Meta)
                <input className={`${campo} mt-1`} disabled={!admin} placeholder="ex.: ficv_mensalidade_lembrete" value={f.whatsapp_template ?? ""} onChange={(e) => setF({ ...f, whatsapp_template: e.target.value })} />
            </label>
            {admin && mudou && <Button size="sm" disabled={salvando} onClick={salvar}>{salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Salvar etapa</Button>}
        </div>
    )
}

function ReenviarBotao({ envio, onFeito }: { envio: Envio; onFeito: () => void }) {
    const [enviando, setEnviando] = useState(false)
    async function reenviar() {
        if (!window.confirm("Reenviar esta mensagem agora para o aluno?")) return
        setEnviando(true)
        try {
            const r = await chamar({ action: "enviar", alunos: [envio.aluno_id], canal: envio.canal, etapa_id: envio.etapa_id })
            const x = r.resultado?.[0]
            if (x?.ok) showSuccess("Reenviado"); else showError(x?.motivo ?? "Não foi possível reenviar")
            onFeito()
        } catch (e) { showError((e as Error).message) } finally { setEnviando(false) }
    }
    return <button type="button" disabled={enviando} onClick={reenviar} className="text-xs text-primary hover:underline disabled:opacity-50">{enviando ? "Enviando…" : "Reenviar"}</button>
}

function EnvioAvulso({ alunos, etapas, onEnviado }: { alunos: AlunoLinha[]; etapas: Etapa[]; onEnviado: () => void }) {
    const [busca, setBusca] = useState("")
    const [sel, setSel] = useState<Set<number>>(new Set())
    const [canal, setCanal] = useState<"whatsapp" | "email">("whatsapp")
    const [etapaId, setEtapaId] = useState("")
    const [enviando, setEnviando] = useState(false)
    const [resultado, setResultado] = useState<{ aluno_id: number; nome: string; ok: boolean; motivo?: string }[] | null>(null)
    const termo = busca.trim().toLowerCase()
    const achados = useMemo(
        () => (termo.length < 2 ? [] : alunos.filter((a) => (a.nome ?? "").toLowerCase().includes(termo)).slice(0, 12)),
        [alunos, termo],
    )
    const nomeDe = (id: number) => alunos.find((a) => a.aluno_id === id)?.nome ?? `#${id}`
    function alterna(id: number) {
        setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
    }
    async function enviar() {
        if (!sel.size) return
        if (!window.confirm(`Enviar agora por ${canal === "whatsapp" ? "WhatsApp" : "e-mail"} para ${sel.size} aluno(s)? Ignora o teto e o histórico da régua.`)) return
        setEnviando(true)
        try {
            const r = await chamar({ action: "enviar", alunos: [...sel], canal, etapa_id: etapaId ? Number(etapaId) : undefined })
            setResultado(r.resultado)
            const ok = (r.resultado as any[]).filter((x) => x.ok).length
            if (ok) showSuccess(`${ok} enviado(s)`)
            if (ok < sel.size) showError(`${sel.size - ok} não saiu(íram): veja os motivos abaixo`)
            setSel(new Set())
            onEnviado()
        } catch (e) { showError((e as Error).message) } finally { setEnviando(false) }
    }
    return (
        <div className={`${card} space-y-3`}>
            <div>
                <h2 className="text-lg font-semibold text-[var(--text-main)]">Envio avulso</h2>
                <p className="text-xs text-[var(--text-muted)]">Manda agora, por um aluno ou vários, as parcelas pendentes dele. A etapa vem do atraso, ou você escolhe. Ignora o teto diário e não exige matrícula Vigente.</p>
            </div>
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                <input className={`${campo} pl-9`} placeholder="Buscar aluno inadimplente pelo nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            {achados.length > 0 && (
                <ul className="max-h-56 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
                    {achados.map((a) => (
                        <li key={a.aluno_id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]">
                                <input type="checkbox" checked={sel.has(a.aluno_id)} onChange={() => alterna(a.aluno_id)} />
                                <span className="flex-1">{a.nome}</span>
                                <span className="text-xs text-[var(--text-muted)]">{a.turma ?? "sem turma"} · {a.parcelas} parc. · {a.atraso_max} dias{a.vigente ? "" : " · sem matrícula Vigente"}</span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}
            {sel.size > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                    {[...sel].map((id) => (
                        <button key={id} type="button" onClick={() => alterna(id)} className="rounded-full bg-primary/10 px-2.5 py-1 text-primary hover:bg-primary/20">{nomeDe(id)} ×</button>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <select className={`${campo} w-auto`} value={canal} onChange={(e) => setCanal(e.target.value as "whatsapp" | "email")} aria-label="Canal">
                    <option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
                </select>
                <select className={`${campo} w-auto`} value={etapaId} onChange={(e) => setEtapaId(e.target.value)} aria-label="Etapa">
                    <option value="">Etapa automática (pelo atraso)</option>
                    {etapas.filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <Button size="sm" disabled={!sel.size || enviando} onClick={enviar}>
                    {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Enviar agora{sel.size ? ` (${sel.size})` : ""}
                </Button>
            </div>
            {resultado && (
                <ul className="space-y-0.5 text-xs">
                    {resultado.map((r) => (
                        <li key={r.aluno_id} className={r.ok ? "text-emerald-600" : "text-red-500"}>{r.nome || nomeDe(r.aluno_id)}: {r.ok ? "enviado" : r.motivo}</li>
                    ))}
                </ul>
            )}
        </div>
    )
}
