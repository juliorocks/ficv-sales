// Avaliação CPA — painel da equipe (admin e agente). Indicadores, filtros, comentários,
// exportação com SHA-256 e verificação da cadeia de integridade (base da comprovação ao MEC).
// Gráficos: uma série por gráfico, cor única, eixo único; a tabela ao lado é a alternativa textual.
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { supabase } from "@/lib/supabase"
import { extractFnErrorMessage } from "@/utils/functionsError"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Download, Loader2, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"

const COR_SERIE = "#2a78d6"

type Filtros = { origem: "oficial" | "teste" | "todas"; curso: string; de: string; ate: string }
type FormResumo = {
    id: number; nivel: string; tipo: string; titulo: string; ano: number; status: "teste" | "aberto" | "encerrado"
    token: string; populacao_alvo: number | null; oficiais: number; testes: number
}
type Pergunta = { id: number; bloco_id: number; ordem: number; texto: string; tipo: string; escala_min?: number; escala_max?: number; opcoes?: string[] }

async function chamar<T>(action: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke("cpa-admin", { body: { action, ...body } })
    if (error) throw new Error(await extractFnErrorMessage(error, "Erro na Avaliação CPA"))
    if (data?.error) throw new Error(data.error)
    return data as T
}

export function CpaAdmin() {
    const qc = useQueryClient()
    const [formId, setFormId] = useState<number | null>(null)
    const [filtros, setFiltros] = useState<Filtros>({ origem: "oficial", curso: "", de: "", ate: "" })
    const [busca, setBusca] = useState("")
    const [verificacao, setVerificacao] = useState<null | { integra: boolean; total: number; primeiro_erro: { seq: number; motivo: string } | null; cabeca: string | null }>(null)

    const { data: lista, isLoading: carregandoForms, error: erroForms } = useQuery({
        queryKey: ["cpa-forms"],
        queryFn: () => chamar<{ forms: FormResumo[]; admin: boolean }>("forms", {}),
    })
    const forms = lista?.forms ?? []
    const admin = !!lista?.admin
    const atual = forms.find((f) => f.id === (formId ?? forms[0]?.id)) ?? null

    const { data: detalhe } = useQuery({
        queryKey: ["cpa-form", atual?.id],
        enabled: !!atual,
        queryFn: () => chamar<{ perguntas: Pergunta[] }>("form", { formulario_id: atual!.id }),
    })

    const { data: stats, isFetching, refetch } = useQuery({
        queryKey: ["cpa-stats", atual?.id, filtros],
        enabled: !!atual,
        queryFn: () => chamar<any>("stats", { formulario_id: atual!.id, filtros: limparFiltros(filtros) }), // eslint-disable-line @typescript-eslint/no-explicit-any
    })

    const opcoesCurso = useMemo(() => (detalhe?.perguntas ?? []).find((p) => p.tipo === "escolha")?.opcoes ?? [], [detalhe])

    const alterar = useMutation({
        mutationFn: (alt: Record<string, unknown>) => chamar("update_form", { formulario_id: atual!.id, ...alt }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["cpa-forms"] }); showSuccess("Formulário atualizado") },
        onError: (e: Error) => showError(e.message),
    })

    const apagarTestes = useMutation({
        mutationFn: () => chamar<{ apagadas: number }>("delete_tests", { formulario_id: atual!.id }),
        onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["cpa-forms"] }); qc.invalidateQueries({ queryKey: ["cpa-stats"] }); showSuccess(`${r.apagadas} respostas de teste apagadas`) },
        onError: (e: Error) => showError(e.message),
    })

    const verificar = useMutation({
        mutationFn: () => chamar<NonNullable<typeof verificacao>>("verify", { formulario_id: atual!.id }),
        onSuccess: (r) => setVerificacao(r),
        onError: (e: Error) => showError(e.message),
    })

    const exportar = useMutation({
        mutationFn: () => chamar<any>("export", { formulario_id: atual!.id, filtros: limparFiltros(filtros) }), // eslint-disable-line @typescript-eslint/no-explicit-any
        onSuccess: (r) => {
            const base = `cpa_${atual!.nivel}_${atual!.ano}_${filtros.origem}`
            baixar(`${base}.csv`, r.csv, "text/csv;charset=utf-8")
            const c = r.cadeia
            const relatorio = [
                `Avaliação Institucional CPA - ${atual!.titulo} ${atual!.ano}`,
                `Gerado em: ${r.gerado_em}`,
                `Gerado por: ${r.gerado_por}`,
                `Filtros: origem=${filtros.origem}${filtros.curso ? `, curso=${filtros.curso}` : ""}${filtros.de ? `, de=${filtros.de}` : ""}${filtros.ate ? `, até=${filtros.ate}` : ""}`,
                `Linhas no CSV: ${r.linhas}`,
                `SHA-256 do CSV: ${r.sha256}`,
                `Cadeia de integridade das respostas oficiais: ${c.integra ? "ÍNTEGRA" : "ADULTERADA"} (${c.total} respostas)`,
                c.integra ? `Hash da última resposta oficial: ${c.cabeca ?? "-"}` : `Primeiro erro: protocolo ${c.primeiro_erro?.seq} - ${c.primeiro_erro?.motivo}`,
            ].join("\r\n") + "\r\n"
            baixar(`${base}_verificacao.txt`, relatorio, "text/plain;charset=utf-8")
            showSuccess("Relatório exportado")
        },
        onError: (e: Error) => showError(e.message),
    })

    const comentariosFiltrados = useMemo(() => {
        const q = busca.trim().toLowerCase()
        const lista2 = stats?.comentarios ?? []
        return q ? lista2.filter((c: any) => c.texto.toLowerCase().includes(q)) : lista2 // eslint-disable-line @typescript-eslint/no-explicit-any
    }, [stats, busca])

    if (carregandoForms) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
    if (erroForms) return <p className="p-6 text-sm text-destructive">{(erroForms as Error).message}</p>

    const link = atual ? `${window.location.origin}/avaliacao/${atual.token}` : ""
    const t = stats?.totais
    const escala = (stats?.perguntas ?? []).filter((p: any) => p.tipo === "escala") // eslint-disable-line @typescript-eslint/no-explicit-any

    return (
        <div className="space-y-6 p-4 md:p-6">

            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold">Avaliação Institucional (CPA)</h1>
                    <p className="text-sm text-muted-foreground">Uso interno. Não aparece no Portal do Aluno.</p>
                </div>
                <div className="flex gap-2">
                    {forms.map((f) => (
                        <Button key={f.id} size="sm" variant={f.id === atual?.id ? "default" : "outline"} onClick={() => setFormId(f.id)}>
                            {f.nivel === "graduacao" ? "Graduação" : "Pós"} {f.ano}
                        </Button>
                    ))}
                </div>
            </div>

            {atual && (
                <>
                    <section className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2">
                        <div className="space-y-2 text-sm">
                            <p><span className="text-muted-foreground">Status:</span> <b>{rotuloStatus(atual.status)}</b></p>
                            <p className="break-all text-xs text-muted-foreground">Link de aplicação: <span className="font-mono text-foreground">{link}</span></p>
                            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); showSuccess("Link copiado") }}>Copiar link</Button>
                        </div>
                        {admin && (
                            <div className="space-y-2 text-sm">
                                <div className="flex flex-wrap gap-2">
                                    {(["teste", "aberto", "encerrado"] as const).map((s) => (
                                        <Button key={s} size="sm" variant={atual.status === s ? "default" : "outline"} disabled={alterar.isPending} onClick={() => alterar.mutate({ status: s })}>
                                            {rotuloStatus(s)}
                                        </Button>
                                    ))}
                                </div>
                                <PopulacaoEditor valor={atual.populacao_alvo} onSalvar={(n) => alterar.mutate({ populacao_alvo: n })} />
                                <Button size="sm" variant="ghost" className="text-destructive" disabled={apagarTestes.isPending || atual.testes === 0}
                                    onClick={() => { if (confirm(`Apagar ${atual.testes} respostas de teste? As oficiais não são afetadas.`)) apagarTestes.mutate() }}>
                                    Apagar respostas de teste ({atual.testes})
                                </Button>
                            </div>
                        )}
                    </section>

                    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Kpi rotulo="Respondentes (oficiais)" valor={t?.respondentes ?? "–"} sub={t?.percentual != null ? `${t.percentual}% de ${atual.populacao_alvo}` : "Defina a população alvo"} />
                        <Kpi rotulo="Média geral" valor={t?.media_geral ?? "–"} sub="média de todas as notas de escala" />
                        <Kpi rotulo="Notas altas" valor={t?.pct_notas_altas != null ? `${t.pct_notas_altas}%` : "–"} sub="top 10% da escala" />
                        <Kpi rotulo="Notas baixas" valor={t?.pct_notas_baixas != null ? `${t.pct_notas_baixas}%` : "–"} sub="metade inferior da escala" />
                    </section>

                    <section className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-5">
                        <Campo rotulo="Origem">
                            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={filtros.origem}
                                onChange={(e) => setFiltros({ ...filtros, origem: e.target.value as Filtros["origem"] })}>
                                <option value="oficial">Oficiais</option>
                                <option value="teste">Teste</option>
                                <option value="todas">Todas</option>
                            </select>
                        </Campo>
                        {atual.nivel === "pos" && (
                            <Campo rotulo="Curso">
                                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={filtros.curso}
                                    onChange={(e) => setFiltros({ ...filtros, curso: e.target.value })}>
                                    <option value="">Todos</option>
                                    {opcoesCurso.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </Campo>
                        )}
                        <Campo rotulo="De"><Input type="date" value={filtros.de} onChange={(e) => setFiltros({ ...filtros, de: e.target.value })} /></Campo>
                        <Campo rotulo="Até"><Input type="date" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} /></Campo>
                        <div className="flex items-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
                            </Button>
                        </div>
                    </section>

                    <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
                        <Button onClick={() => exportar.mutate()} disabled={exportar.isPending}>
                            {exportar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Exportar CSV + verificação
                        </Button>
                        <Button variant="outline" onClick={() => verificar.mutate()} disabled={verificar.isPending}>
                            <ShieldCheck className="mr-2 h-4 w-4" /> Verificar integridade
                        </Button>
                        {verificacao && (
                            <span className={`flex items-center gap-2 text-sm ${verificacao.integra ? "text-emerald-700" : "text-red-700"}`}>
                                {verificacao.integra ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                                {verificacao.integra
                                    ? `Íntegra: ${verificacao.total} respostas oficiais, sem alteração.`
                                    : `ADULTERADA no protocolo ${verificacao.primeiro_erro?.seq}: ${verificacao.primeiro_erro?.motivo}.`}
                            </span>
                        )}
                    </section>

                    <section className="grid gap-4 lg:grid-cols-2">
                        <Painel titulo="Respostas por dia">
                            <ResponsiveContainer width="100%" height={220}>
                                <LineChart data={stats?.por_dia ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                    <CartesianGrid stroke="rgba(128,128,128,0.2)" vertical={false} />
                                    <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                    <Tooltip />
                                    <Line type="monotone" dataKey="n" name="Respostas" stroke={COR_SERIE} strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </Painel>
                        <Painel titulo="Média por bloco (0 a escala máxima)">
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={stats?.blocos ?? []} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                                    <CartesianGrid stroke="rgba(128,128,128,0.2)" horizontal={false} />
                                    <XAxis type="number" domain={[0, t?.escala_max ?? 10]} tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="titulo" width={150} tick={{ fontSize: 11 }} />
                                    <Tooltip />
                                    <Bar dataKey="media" name="Média" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Painel>
                    </section>

                    <section className="grid gap-4 lg:grid-cols-2">
                        <Painel titulo="Média por pergunta de escala">
                            <ResponsiveContainer width="100%" height={Math.max(220, escala.length * 22)}>
                                <BarChart data={escala} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                                    <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="ordem" width={36} tick={{ fontSize: 11 }} tickFormatter={(v) => `P${v}`} />
                                    <Tooltip formatter={(v: number) => [v, "Média"]} labelFormatter={(v) => `P${v}`} />
                                    <Bar dataKey="media" name="Média" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Painel>
                        <Painel titulo="Por curso">
                            {(stats?.por_curso ?? []).length === 0 ? (
                                <p className="py-10 text-center text-sm text-muted-foreground">Sem respostas no filtro atual.</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={Math.max(180, (stats?.por_curso ?? []).length * 30)}>
                                    <BarChart data={stats.por_curso} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 0 }}>
                                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                                        <YAxis type="category" dataKey="curso" width={220} tick={{ fontSize: 11 }} />
                                        <Tooltip />
                                        <Bar dataKey="n" name="Respostas" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </Painel>
                    </section>

                    <Painel titulo="Tabela por pergunta (alternativa textual aos gráficos)">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-sm">
                                <thead className="text-left text-xs text-muted-foreground">
                                    <tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Pergunta</th><th className="py-2 pr-3 text-right">n</th><th className="py-2 pr-3 text-right">Média</th><th className="py-2">Distribuição</th></tr>
                                </thead>
                                <tbody>
                                    {(stats?.perguntas ?? []).map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                                        <tr key={p.id} className="border-t align-top">
                                            <td className="py-2 pr-3 text-xs text-muted-foreground">{p.ordem}</td>
                                            <td className="py-2 pr-3">{p.texto}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums">{p.n}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums">{p.tipo === "escala" ? p.media ?? "–" : ""}</td>
                                            <td className="py-2 text-xs">
                                                {p.tipo === "escala" && p.distribuicao.map((d: any) => `${d.valor}:${d.n}`).join("  ")} {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
                                                {p.tipo === "escolha" && p.opcoes.map((o: any) => `${o.valor}: ${o.n}`).join(" · ")} {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Painel>

                    <Painel titulo={`Comentários (${comentariosFiltrados.length})`}>
                        <Input placeholder="Buscar nos comentários" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-3" />
                        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                            {comentariosFiltrados.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                                <div key={`${c.seq}-${c.respondido_em}-${c.texto.slice(0, 12)}`} className="rounded-lg border p-3 text-sm">
                                    <p className="mb-1 text-xs text-muted-foreground">
                                        {c.teste ? "teste" : `protocolo ${c.seq}`} · {new Date(c.respondido_em).toLocaleString("pt-BR")}{c.curso ? ` · ${c.curso}` : ""}
                                    </p>
                                    <p className="whitespace-pre-wrap">{c.texto}</p>
                                </div>
                            ))}
                            {comentariosFiltrados.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum comentário.</p>}
                        </div>
                    </Painel>
                </>
            )}
        </div>
    )
}

function limparFiltros(f: Filtros) {
    return { origem: f.origem, ...(f.curso ? { curso: f.curso } : {}), ...(f.de ? { de: f.de } : {}), ...(f.ate ? { ate: f.ate } : {}) }
}

function rotuloStatus(s: string) {
    return s === "teste" ? "Teste" : s === "aberto" ? "Aberto (oficial)" : "Encerrado"
}

function baixar(nome: string, conteudo: string, tipo: string) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
    const a = document.createElement("a")
    a.href = url
    a.download = nome
    a.click()
    URL.revokeObjectURL(url)
}

function PopulacaoEditor({ valor, onSalvar }: { valor: number | null; onSalvar: (n: number | null) => void }) {
    const [txt, setTxt] = useState(valor?.toString() ?? "")
    return (
        <div className="flex items-end gap-2">
            <Campo rotulo="Alunos convidados (população)">
                <Input type="number" min={0} value={txt} onChange={(e) => setTxt(e.target.value)} className="w-44" />
            </Campo>
            <Button size="sm" variant="outline" onClick={() => onSalvar(txt === "" ? null : Number(txt))}>Salvar</Button>
        </div>
    )
}

function Kpi({ rotulo, valor, sub }: { rotulo: string; valor: string | number; sub: string }) {
    return (
        <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{rotulo}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
    )
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{titulo}</h2>
            {children}
        </div>
    )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{rotulo}</span>
            {children}
        </label>
    )
}
