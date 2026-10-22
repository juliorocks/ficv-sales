// Avaliação CPA — painel da equipe (admin e agente). Indicadores, filtros, comentários,
// exportação com SHA-256 e verificação da cadeia de integridade (base da comprovação ao MEC).
// Gráficos: uma série por gráfico, cor única, eixo único; a tabela ao lado é a alternativa textual.
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { supabase } from "@/lib/supabase"
import { Btn, Cartao, Inp, Rotulo, TICK, TT, COR_GRAFICO } from "./cpaUi"
import { ClipboardCheck, Download, Loader2, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import { chamar } from "./cpaApi"
import { CpaEditor } from "./CpaEditor"

const COR_SERIE = COR_GRAFICO

type Filtros = { origem: "oficial" | "teste" | "todas"; curso: string; de: string; ate: string }
type FormResumo = {
    id: number; nivel: string; tipo: string; titulo: string; ano: number; status: "teste" | "aberto" | "encerrado"
    token: string; portal_ativo: boolean; populacao_ativa: number | null; oficiais: number; testes: number
}
type Pergunta = { id: number; bloco_id: number; ordem: number; texto: string; tipo: string; escala_min?: number; escala_max?: number; opcoes?: string[] }

export function CpaAdmin() {
    const qc = useQueryClient()
    const [formId, setFormId] = useState<number | null>(null)
    const [filtros, setFiltros] = useState<Filtros>({ origem: "oficial", curso: "", de: "", ate: "" })
    const [busca, setBusca] = useState("")
    const [verificacao, setVerificacao] = useState<null | { integra: boolean; total: number; primeiro_erro: { seq: number; motivo: string } | null; cabeca: string | null }>(null)

    const [aba, setAba] = useState<"painel" | "perguntas">("painel")
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

    const opcoesCurso = useMemo(() => {
        const doForm = (detalhe?.perguntas ?? []).find((p) => p.tipo === "escolha")?.opcoes ?? []
        const vistos = (stats?.por_curso ?? []).map((c: { curso: string }) => c.curso).filter((c: string) => c !== "(sem curso)")
        return [...new Set([...doForm, ...vistos])]
    }, [detalhe, stats])

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

    const sincronizarDocentes = useMutation({
        mutationFn: async () => {
            let offset = 0
            let gravados = 0
            for (;;) {
                const r = await chamar<{ gravados: number; proximo: number | null }>("sync_docentes", { offset })
                gravados += r.gravados
                if (r.proximo === null) return gravados
                offset = r.proximo
            }
        },
        onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["cpa-stats"] }); showSuccess(`${n} disciplinas com professor titular`) },
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
                    <div className="mb-2 flex items-center gap-2 text-primary">
                        <ClipboardCheck size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Uso interno · não aparece no Portal do Aluno</span>
                    </div>
                    <h2 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-main)]">Avaliação Institucional (CPA)</h2>
                    <p className="text-sm text-[var(--text-muted)]">Formulários, respostas, indicadores e comprovação.</p>
                </div>
                <div className="flex gap-2">
                    {forms.map((f) => (
                        <Btn key={f.id} size="sm" variant={f.id === atual?.id ? "default" : "outline"} onClick={() => setFormId(f.id)}>
                            {f.nivel === "graduacao" ? "Graduação" : "Pós"} {f.ano}
                        </Btn>
                    ))}
                </div>
            </div>

            {atual && (
                <>
                    <div className="flex gap-2 pb-2">
                        <Btn size="sm" variant={aba === "painel" ? "default" : "ghost"} onClick={() => setAba("painel")}>Painel e respostas</Btn>
                        <Btn size="sm" variant={aba === "perguntas" ? "default" : "ghost"} onClick={() => setAba("perguntas")}>Perguntas</Btn>
                    </div>

                    {aba === "perguntas" && <CpaEditor formId={atual.id} admin={admin} />}

                    {aba === "painel" && (
                    <>
                    <section className="grid gap-4 glass-card p-6 md:grid-cols-2">
                        <div className="space-y-2 text-sm">
                            <p><span className="text-[var(--text-muted)]">Status:</span> <b>{rotuloStatus(atual.status)}</b></p>
                            <p className="break-all text-xs text-muted-foreground">Link de aplicação: <span className="font-mono text-foreground">{link}</span></p>
                            <Btn size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); showSuccess("Link copiado") }}>Copiar link</Btn>
                        </div>
                        {admin && (
                            <div className="space-y-2 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[var(--text-muted)]">Portal do aluno:</span>
                                    <Btn size="sm" variant={atual.portal_ativo ? "default" : "outline"} disabled={alterar.isPending}
                                        onClick={() => { if (!atual.portal_ativo || confirm("Desligar a avaliação no Portal do Aluno?")) alterar.mutate({ portal_ativo: !atual.portal_ativo }) }}>
                                        {atual.portal_ativo ? "Ligado" : "Desligado"}
                                    </Btn>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(["teste", "aberto", "encerrado"] as const).map((s) => (
                                        <Btn key={s} size="sm" variant={atual.status === s ? "default" : "outline"} disabled={alterar.isPending} onClick={() => alterar.mutate({ status: s })}>
                                            {rotuloStatus(s)}
                                        </Btn>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground">Base: {atual.populacao_ativa ?? "–"} alunos com matrícula vigente no Sponte.</p>
                                <Btn size="sm" variant="ghost" className="text-destructive" disabled={apagarTestes.isPending || atual.testes === 0}
                                    onClick={() => { if (confirm(`Apagar ${atual.testes} respostas de teste? As oficiais não são afetadas.`)) apagarTestes.mutate() }}>
                                    Apagar respostas de teste ({atual.testes})
                                </Btn>
                            </div>
                        )}
                    </section>

                    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Kpi rotulo="Respondentes (oficiais)" valor={t?.respondentes ?? "–"} sub={t?.percentual != null ? `${t.percentual}% de ${t.populacao_ativa} alunos ativos` : "Sem base de alunos ativos"} />
                        <Kpi rotulo="Média geral" valor={t?.media_geral ?? "–"} sub="média de todas as notas de escala" />
                        <Kpi rotulo="Notas altas" valor={t?.pct_notas_altas != null ? `${t.pct_notas_altas}%` : "–"} sub="top 10% da escala" />
                        <Kpi rotulo="Notas baixas" valor={t?.pct_notas_baixas != null ? `${t.pct_notas_baixas}%` : "–"} sub="metade inferior da escala" />
                    </section>

                    <section className="grid gap-3 glass-card p-6 md:grid-cols-5">
                        <Campo rotulo="Origem">
                            <select className="h-9 w-full rounded-lg bg-[var(--bg-card-hover)] px-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" value={filtros.origem}
                                onChange={(e) => setFiltros({ ...filtros, origem: e.target.value as Filtros["origem"] })}>
                                <option value="oficial">Oficiais</option>
                                <option value="teste">Teste</option>
                                <option value="todas">Todas</option>
                            </select>
                        </Campo>
                        {atual.nivel === "pos" && (
                            <Campo rotulo="Curso">
                                <select className="h-9 w-full rounded-lg bg-[var(--bg-card-hover)] px-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" value={filtros.curso}
                                    onChange={(e) => setFiltros({ ...filtros, curso: e.target.value })}>
                                    <option value="">Todos</option>
                                    {opcoesCurso.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </Campo>
                        )}
                        <Campo rotulo="De"><Inp type="date" value={filtros.de} onChange={(e) => setFiltros({ ...filtros, de: e.target.value })} /></Campo>
                        <Campo rotulo="Até"><Inp type="date" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} /></Campo>
                        <div className="flex items-end gap-2">
                            <Btn size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
                            </Btn>
                        </div>
                    </section>

                    <section className="flex flex-wrap items-center gap-3 glass-card p-6">
                        <Btn onClick={() => exportar.mutate()} disabled={exportar.isPending}>
                            {exportar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Exportar CSV + verificação
                        </Btn>
                        {admin && (
                            <Btn variant="outline" onClick={() => sincronizarDocentes.mutate()} disabled={sincronizarDocentes.isPending}>
                                {sincronizarDocentes.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Atualizar professores (Moodle)
                            </Btn>
                        )}
                        <Btn variant="outline" onClick={() => verificar.mutate()} disabled={verificar.isPending}>
                            <ShieldCheck className="mr-2 h-4 w-4" /> Verificar integridade
                        </Btn>
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
                                    <CartesianGrid stroke="rgba(139,148,158,0.18)" vertical={false} />
                                    <XAxis dataKey="dia" tick={TICK} />
                                    <YAxis allowDecimals={false} tick={TICK} />
                                    <Tooltip {...TT} />
                                    <Line type="monotone" dataKey="n" name="Respostas" stroke={COR_SERIE} strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </Painel>
                        <Painel titulo="Média por bloco (0 a escala máxima)">
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={stats?.blocos ?? []} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                                    <CartesianGrid stroke="rgba(139,148,158,0.18)" horizontal={false} />
                                    <XAxis type="number" domain={[0, t?.escala_max ?? 10]} tick={TICK} />
                                    <YAxis type="category" dataKey="titulo" width={150} tick={TICK} />
                                    <Tooltip {...TT} />
                                    <Bar dataKey="media" name="Média" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Painel>
                    </section>

                    <section className="grid gap-4 lg:grid-cols-2">
                        <Painel titulo="Média por pergunta de escala">
                            <ResponsiveContainer width="100%" height={Math.max(220, escala.length * 22)}>
                                <BarChart data={escala} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                                    <XAxis type="number" domain={[0, 10]} tick={TICK} />
                                    <YAxis type="category" dataKey="ordem" width={36} tick={TICK} tickFormatter={(v) => `P${v}`} />
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
                                        <XAxis type="number" allowDecimals={false} tick={TICK} />
                                        <YAxis type="category" dataKey="curso" width={220} tick={TICK} />
                                        <Tooltip {...TT} />
                                        <Bar dataKey="n" name="Respostas" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </Painel>
                    </section>

                    <Painel titulo="Por disciplina (professor titular pelo Moodle)">
                        {(stats?.por_disciplina ?? []).length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma avaliação de disciplina no filtro atual.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-sm">
                                    <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                                        <tr><th className="py-2 pr-3">Disciplina</th><th className="py-2 pr-3">Período</th><th className="py-2 pr-3">Professor</th><th className="py-2 pr-3 text-right">Respostas</th><th className="py-2 text-right">Média</th></tr>
                                    </thead>
                                    <tbody>
                                        {stats.por_disciplina.map((d: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                                            <tr key={d.contexto}>
                                                <td className="py-2 pr-3">{d.disciplina.replace(/-/g, " ")}</td>
                                                <td className="py-2 pr-3 text-xs text-muted-foreground">{d.periodo}</td>
                                                <td className="py-2 pr-3">{d.docente ?? <span className="text-[var(--text-muted)]">não identificado</span>}</td>
                                                <td className="py-2 pr-3 text-right tabular-nums">{d.n}</td>
                                                <td className="py-2 text-right tabular-nums">{d.media ?? "–"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Painel>

                    <Painel titulo="Tabela por pergunta (alternativa textual aos gráficos)">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-sm">
                                <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                                    <tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Pergunta</th><th className="py-2 pr-3 text-right">n</th><th className="py-2 pr-3 text-right">Média</th><th className="py-2">Distribuição</th></tr>
                                </thead>
                                <tbody>
                                    {(stats?.perguntas ?? []).map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                                        <tr key={p.id} className="align-top">
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
                        <Inp placeholder="Buscar nos comentários" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-3" />
                        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                            {comentariosFiltrados.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                                <div key={`${c.seq}-${c.respondido_em}-${c.texto.slice(0, 12)}`} className="rounded-xl bg-[var(--bg-card-hover)] p-4 text-sm">
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

function Kpi({ rotulo, valor, sub }: { rotulo: string; valor: string | number; sub: string }) {
    return (
        <Cartao>
            <p className="mb-6 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</p>
            <h3 className="mb-1 text-2xl font-bold tabular-nums text-[var(--text-main)]">{valor}</h3>
            <p className="text-[10px] text-[var(--text-muted)]">{sub}</p>
        </Cartao>
    )
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <div className="glass-card p-6">
            <Rotulo>{titulo}</Rotulo>
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
