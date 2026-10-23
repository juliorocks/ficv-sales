// Gestão > Banners do Portal: artes de destaque que aparecem no topo do Início do Portal do Aluno.
// Cada banner tem arte para celular e/ou desktop, link opcional, janela de exibição e ordem.
// Escrita só do admin (RLS); o aluno lê os ativos dentro da janela. As artes ficam no bucket público portal-banners.
import { useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Images, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { withTimeout } from "@/utils/withTimeout"
import { showError, showSuccess } from "@/utils/toast"
import { Btn, Inp } from "../cpa/cpaUi"

const BUCKET = "portal-banners"
const MAX_BYTES = 3 * 1024 * 1024
const TIPOS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

type Banner = {
    id: string; titulo: string; imagem_mobile: string | null; imagem_desktop: string | null; link_url: string | null
    ordem: number; ativo: boolean; inicio_em: string | null; fim_em: string | null; created_at: string
}
type Rascunho = {
    id?: string; titulo: string; link_url: string; ativo: boolean; inicio: string; fim: string
    imagem_mobile: string | null; imagem_desktop: string | null
    novoMobile: File | null; novoDesktop: File | null
}

const publica = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
const paraInput = (iso: string | null) => {
    if (!iso) return ""
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const paraIso = (v: string) => (v ? new Date(v).toISOString() : null)

function situacao(b: Banner): { rotulo: string; classe: string } {
    const agora = Date.now()
    if (!b.ativo) return { rotulo: "Pausado", classe: "bg-[var(--bg-card-hover)] text-[var(--text-muted)]" }
    if (b.inicio_em && new Date(b.inicio_em).getTime() > agora) return { rotulo: "Agendado", classe: "bg-amber-100 text-amber-900" }
    if (b.fim_em && new Date(b.fim_em).getTime() <= agora) return { rotulo: "Encerrado", classe: "bg-red-100 text-red-900" }
    return { rotulo: "No ar", classe: "bg-emerald-100 text-emerald-900" }
}

export function PortalBannersAdmin() {
    const qc = useQueryClient()
    const [edicao, setEdicao] = useState<Rascunho | null>(null)
    const { data: banners = [], isLoading, error } = useQuery({
        queryKey: ["portal-banners-admin"],
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.from("portal_banners").select("*").order("ordem").order("created_at", { ascending: false }), 12000, "A lista de banners")
            if (error) throw error
            return (data ?? []) as Banner[]
        },
    })
    const atualizar = () => {
        qc.invalidateQueries({ queryKey: ["portal-banners-admin"] })
        qc.invalidateQueries({ queryKey: ["portal-banners"] })
    }

    // token em refresh faz UPDATE filtrar 0 linhas sem erro: sessão antes e .select() depois pra conferir
    async function sessao() {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error("Sua sessão expirou. Entre de novo.")
        return session
    }

    const salvar = useMutation({
        mutationFn: async (r: Rascunho) => {
            const session = await sessao()
            if (!r.titulo.trim()) throw new Error("Dê um título ao banner (só para você identificar).")
            if (r.link_url.trim() && !/^(https:\/\/|\/)/.test(r.link_url.trim())) throw new Error("O link deve começar com https:// ou com /.")
            if (r.inicio && r.fim && new Date(r.fim) <= new Date(r.inicio)) throw new Error("O fim precisa ser depois do início.")
            const id = r.id ?? crypto.randomUUID()
            const enviar = async (arquivo: File, papel: "mobile" | "desktop") => {
                const path = `${id}/${papel}-${Date.now()}.${TIPOS[arquivo.type]}`
                const { error } = await withTimeout(supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: arquivo.type }), 40000, "O envio da arte")
                if (error) throw error
                return path
            }
            const antigos: string[] = []
            let mobile = r.imagem_mobile
            let desktop = r.imagem_desktop
            if (r.novoMobile) { if (mobile) antigos.push(mobile); mobile = await enviar(r.novoMobile, "mobile") }
            if (r.novoDesktop) { if (desktop) antigos.push(desktop); desktop = await enviar(r.novoDesktop, "desktop") }
            if (!mobile && !desktop) throw new Error("Envie pelo menos uma arte (celular ou desktop).")
            const reg = {
                titulo: r.titulo.trim(), link_url: r.link_url.trim() || null, ativo: r.ativo,
                inicio_em: paraIso(r.inicio), fim_em: paraIso(r.fim), imagem_mobile: mobile, imagem_desktop: desktop,
            }
            const resp = r.id
                ? await withTimeout(supabase.from("portal_banners").update(reg).eq("id", id).select("id"), 15000, "O salvamento")
                : await withTimeout(supabase.from("portal_banners").insert({ ...reg, id, ordem: (banners.at(-1)?.ordem ?? 0) + 1, created_by: session.user.id }).select("id"), 15000, "O salvamento")
            if (resp.error) throw resp.error
            if (!resp.data?.length) throw new Error("Nada foi salvo (sessão expirada?). Recarregue a página e tente de novo.")
            if (antigos.length) await supabase.storage.from(BUCKET).remove(antigos) // limpeza: se falhar, só sobra um arquivo solto
        },
        onSuccess: () => { setEdicao(null); atualizar(); showSuccess("Banner salvo") },
        onError: (e: Error) => showError(e.message),
    })

    const excluir = useMutation({
        mutationFn: async (b: Banner) => {
            await sessao()
            const { data, error } = await withTimeout(supabase.from("portal_banners").delete().eq("id", b.id).select("id"), 15000, "A exclusão")
            if (error) throw error
            if (!data?.length) throw new Error("Nada foi excluído (sessão expirada?). Recarregue a página.")
            const arquivos = [b.imagem_mobile, b.imagem_desktop].filter((x): x is string => !!x)
            if (arquivos.length) await supabase.storage.from(BUCKET).remove(arquivos)
        },
        onSuccess: () => { atualizar(); showSuccess("Banner excluído") },
        onError: (e: Error) => showError(e.message),
    })

    const alternar = useMutation({
        mutationFn: async (b: Banner) => {
            await sessao()
            const { data, error } = await withTimeout(supabase.from("portal_banners").update({ ativo: !b.ativo }).eq("id", b.id).select("id"), 15000, "A alteração")
            if (error) throw error
            if (!data?.length) throw new Error("Nada foi alterado (sessão expirada?). Recarregue a página.")
        },
        onSuccess: atualizar,
        onError: (e: Error) => showError(e.message),
    })

    // troca a ordem com o vizinho
    const mover = useMutation({
        mutationFn: async ({ i, d }: { i: number; d: -1 | 1 }) => {
            await sessao()
            const a = banners[i]
            const b = banners[i + d]
            if (!a || !b) return
            // se dois banners têm a mesma ordem, a troca não mudaria nada: separa pelo índice
            const [oa, ob] = a.ordem === b.ordem ? [i + d, i] : [b.ordem, a.ordem]
            for (const [id, ordem] of [[a.id, oa], [b.id, ob]] as const) {
                const { error } = await supabase.from("portal_banners").update({ ordem }).eq("id", id)
                if (error) throw error
            }
        },
        onSuccess: atualizar,
        onError: (e: Error) => showError(e.message),
    })

    return (
        <div className="space-y-6 p-4 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-primary">
                        <Images size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Portal do Aluno</span>
                    </div>
                    <h2 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-main)]">Banners de destaque</h2>
                    <p className="max-w-2xl text-sm text-[var(--text-muted)]">
                        Aparecem no topo do Início do Portal, logo abaixo da saudação. Suba uma arte para o celular e outra para o desktop.
                        Com mais de um banner no ar, eles se alternam sozinhos. A Avaliação da CPA aparece sempre antes, quando estiver ativa.
                    </p>
                </div>
                <Btn onClick={() => setEdicao({ titulo: "", link_url: "", ativo: true, inicio: "", fim: "", imagem_mobile: null, imagem_desktop: null, novoMobile: null, novoDesktop: null })}>
                    <Plus className="mr-2 h-4 w-4" /> Novo banner
                </Btn>
            </div>

            {isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
            {!isLoading && !error && banners.length === 0 && (
                <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">Nenhum banner ainda. Clique em "Novo banner" para subir a primeira arte.</div>
            )}

            <div className="space-y-3">
                {banners.map((b, i) => {
                    const st = situacao(b)
                    return (
                        <div key={b.id} className="glass-card flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                            <div className="flex shrink-0 items-end gap-3">
                                <Miniatura rotulo="Celular" path={b.imagem_mobile} largura={96} proporcao="2/1" />
                                <Miniatura rotulo="Desktop" path={b.imagem_desktop} largura={200} proporcao="4/1" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate font-semibold">{b.titulo}</p>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.classe}`}>{st.rotulo}</span>
                                </div>
                                <p className="truncate text-xs text-[var(--text-muted)]">{b.link_url ?? "Sem link"}</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {b.inicio_em ? `De ${new Date(b.inicio_em).toLocaleString("pt-BR")}` : "Sem data de início"}
                                    {" · "}
                                    {b.fim_em ? `até ${new Date(b.fim_em).toLocaleString("pt-BR")}` : "sem data de fim"}
                                </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1">
                                <IconeBtn titulo="Subir" disabled={i === 0 || mover.isPending} onClick={() => mover.mutate({ i, d: -1 })}><ArrowUp className="h-4 w-4" /></IconeBtn>
                                <IconeBtn titulo="Descer" disabled={i === banners.length - 1 || mover.isPending} onClick={() => mover.mutate({ i, d: 1 })}><ArrowDown className="h-4 w-4" /></IconeBtn>
                                <Btn size="sm" variant="outline" disabled={alternar.isPending} onClick={() => alternar.mutate(b)}>{b.ativo ? "Pausar" : "Ativar"}</Btn>
                                <IconeBtn titulo="Editar" onClick={() => setEdicao({
                                    id: b.id, titulo: b.titulo, link_url: b.link_url ?? "", ativo: b.ativo, inicio: paraInput(b.inicio_em), fim: paraInput(b.fim_em),
                                    imagem_mobile: b.imagem_mobile, imagem_desktop: b.imagem_desktop, novoMobile: null, novoDesktop: null,
                                })}><Pencil className="h-4 w-4" /></IconeBtn>
                                <IconeBtn titulo="Excluir" disabled={excluir.isPending} onClick={() => { if (confirm(`Excluir o banner "${b.titulo}"?`)) excluir.mutate(b) }}><Trash2 className="h-4 w-4" /></IconeBtn>
                            </div>
                        </div>
                    )
                })}
            </div>

            {edicao && <FormBanner valor={edicao} salvando={salvar.isPending} onSalvar={(r) => salvar.mutate(r)} onFechar={() => setEdicao(null)} />}
        </div>
    )
}

function Miniatura({ rotulo, path, largura, proporcao }: { rotulo: string; path: string | null; largura: number; proporcao: string }) {
    return (
        <div className="space-y-1">
            <div style={{ width: largura, aspectRatio: proporcao }} className="overflow-hidden rounded-lg bg-[var(--bg-card-hover)]">
                {path ? <img src={publica(path)} alt={rotulo} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-[var(--text-muted)]">sem arte</div>}
            </div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</p>
        </div>
    )
}

function IconeBtn({ titulo, onClick, disabled, children }: { titulo: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={titulo} title={titulo} onClick={onClick} disabled={disabled}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] disabled:opacity-40">
            {children}
        </button>
    )
}

function FormBanner({ valor, salvando, onSalvar, onFechar }: { valor: Rascunho; salvando: boolean; onSalvar: (r: Rascunho) => void; onFechar: () => void }) {
    const [r, setR] = useState(valor)
    const [aviso, setAviso] = useState<string | null>(null)
    const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }))

    function escolher(papel: "mobile" | "desktop", arquivo: File | undefined) {
        if (!arquivo) return
        if (!TIPOS[arquivo.type]) return setAviso("Use PNG, JPG ou WebP.")
        if (arquivo.size > MAX_BYTES) return setAviso("A arte passa de 3 MB. Reduza o arquivo.")
        setAviso(null)
        set(papel === "mobile" ? "novoMobile" : "novoDesktop", arquivo)
    }
    const previa = (nova: File | null, atual: string | null) => (nova ? URL.createObjectURL(nova) : atual ? publica(atual) : null)

    // no body: dentro do bloco com animação (transform) o "fixed" ficava preso ao tamanho do bloco e o janelão saía cortado
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onFechar}>
            <form className="glass-card mt-8 w-full max-w-2xl space-y-5 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => { e.preventDefault(); onSalvar(r) }}>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">{r.id ? "Editar banner" : "Novo banner"}</h3>
                    <button type="button" aria-label="Fechar" onClick={onFechar}><X className="h-4 w-4" /></button>
                </div>

                <label className="block space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Título (só para você identificar; não aparece para o aluno)</span>
                    <Inp value={r.titulo} onChange={(e) => set("titulo", e.target.value)} maxLength={120} required />
                </label>
                <label className="block space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Link ao clicar (opcional): https://… ou um caminho como /aluno</span>
                    <Inp value={r.link_url} onChange={(e) => set("link_url", e.target.value)} placeholder="https://" />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                    <CampoArte rotulo="Arte do celular" dica="Recomendado 1080 × 540 px (2:1)" proporcao="2/1" url={previa(r.novoMobile, r.imagem_mobile)} onEscolher={(f) => escolher("mobile", f)} />
                    <CampoArte rotulo="Arte do desktop" dica="Recomendado 1600 × 400 px (4:1)" proporcao="4/1" url={previa(r.novoDesktop, r.imagem_desktop)} onEscolher={(f) => escolher("desktop", f)} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">PNG, JPG ou WebP até 3 MB. Se subir só uma arte, ela vale para os dois tamanhos. Deixe o texto importante longe das bordas: a imagem é cortada para caber.</p>
                {aviso && <p role="alert" className="text-sm text-destructive">{aviso}</p>}

                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1">
                        <span className="text-xs text-[var(--text-muted)]">Começa em (opcional)</span>
                        <Inp type="datetime-local" value={r.inicio} onChange={(e) => set("inicio", e.target.value)} />
                    </label>
                    <label className="block space-y-1">
                        <span className="text-xs text-[var(--text-muted)]">Termina em (opcional)</span>
                        <Inp type="datetime-local" value={r.fim} onChange={(e) => set("fim", e.target.value)} />
                    </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={r.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Ativo (aparece para os alunos dentro das datas acima)
                </label>

                <div className="flex justify-end gap-2">
                    <Btn variant="outline" onClick={onFechar}>Cancelar</Btn>
                    <Btn type="submit" disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar banner</Btn>
                </div>
            </form>
        </div>,
        document.body,
    )
}

function CampoArte({ rotulo, dica, proporcao, url, onEscolher }: { rotulo: string; dica: string; proporcao: string; url: string | null; onEscolher: (f: File | undefined) => void }) {
    return (
        <div className="space-y-2">
            <p className="text-xs text-[var(--text-muted)]">{rotulo}</p>
            <div style={{ aspectRatio: proporcao }} className="overflow-hidden rounded-xl bg-[var(--bg-card-hover)]">
                {url ? <img src={url} alt={rotulo} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">sem arte</div>}
            </div>
            <label className="inline-block cursor-pointer text-xs font-semibold text-primary">
                {url ? "Trocar arte" : "Enviar arte"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { onEscolher(e.target.files?.[0]); e.target.value = "" }} />
            </label>
            <p className="text-[11px] text-[var(--text-muted)]">{dica}</p>
        </div>
    )
}
