// Avaliação CPA — painel da equipe (admin e agente). Indicadores, filtros, comentários,
// exportação com SHA-256 e verificação da cadeia de integridade (base da comprovação ao MEC).
// Gráficos: uma série por gráfico, cor única, eixo único; a tabela ao lado é a alternativa textual.
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { supabase } from "@/lib/supabase"
import { AvatarDocente, Btn, Cartao, Inp, Rotulo, TICK, TT, COR_GRAFICO } from "./cpaUi"
import { ClipboardCheck, Download, Loader2, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import { chamar } from "./cpaApi"
import { CpaEditor } from "./CpaEditor"

const COR_SERIE = COR_GRAFICO

type Filtros = { origem: "oficial" | "teste" | "todas"; curso: string; de: string; ate: string }
type FormResumo = {
    id: number; nivel: string; tipo: string; titulo: string; ano: number; status: "teste" | "aberto" | "encerrado"
    token: string; portal_ativo: boolean; semestre: string | null; alunos_teste?: number[]; populacao_ativa: number | null; oficiais: number; testes: number
}
type Pergunta = { id: number; bloco_id: number; ordem: number; texto: string; tipo: string; escala_min?: number; escala_max?: number; opcoes?: string[] }
type Cadeia = { integra: boolean; total: number; primeiro_erro: { seq: number; motivo: string } | null; cabeca: string | null }

// uma avaliação por nível reúne a geral e a de disciplinas: mesmo link, mesmo status, mesmos resultados
function useStats(form: FormResumo | null, filtros: Filtros) {
    return useQuery({
        queryKey: ["cpa-stats", form?.id, filtros],
        enabled: !!form,
        queryFn: () => chamar<any>("stats", { formulario_id: form!.id, filtros: limparFiltros(filtros) }), // eslint-disable-line @typescript-eslint/no-explicit-any
    })
}

export function CpaAdmin() {
    const qc = useQueryClient()
    const [nivel, setNivel] = useState<"graduacao" | "pos">("graduacao")
    const [filtros, setFiltros] = useState<Filtros>({ origem: "oficial", curso: "", de: "", ate: "" })
    const [verificacao, setVerificacao] = useState<null | { geral: Cadeia | null; disc: Cadeia | null }>(null)
    const [aba, setAba] = useState<"painel" | "perguntas">("painel")

    const { data: lista, isLoading: carregandoForms, error: erroForms } = useQuery({
        queryKey: ["cpa-forms"],
        queryFn: () => chamar<{ forms: FormResumo[]; admin: boolean }>("forms", {}),
    })
    const forms = lista?.forms ?? []
    const admin = !!lista?.admin
    const doNivel = forms.filter((f) => f.nivel === nivel)
    const geral = doNivel.find((f) => f.tipo === "geral") ?? null
    const disc = doNivel.find((f) => f.tipo === "disciplina") ?? null
    const partes = [geral, disc].filter((f): f is FormResumo => !!f)

    const { data: detalhe } = useQuery({
        queryKey: ["cpa-form", geral?.id],
        enabled: !!geral,
        queryFn: () => chamar<{ perguntas: Pergunta[] }>("form", { formulario_id: geral!.id }),
    })
    const { data: statsGeral, isFetching: carregandoG, refetch: refazerG } = useStats(geral, filtros)
    const { data: statsDisc, isFetching: carregandoD, refetch: refazerD } = useStats(disc, filtros)

    const opcoesCurso = useMemo(() => {
        const doForm = (detalhe?.perguntas ?? []).find((p) => p.tipo === "escolha")?.opcoes ?? []
        const vistos = [...(statsGeral?.por_curso ?? []), ...(statsDisc?.por_curso ?? [])].map((c: { curso: string }) => c.curso).filter((c: string) => c !== "(sem curso)")
        return [...new Set([...doForm, ...vistos])]
    }, [detalhe, statsGeral, statsDisc])

    const alterar = useMutation({
        mutationFn: (alt: Record<string, unknown>) => Promise.all(partes.map((f) => chamar<{ nao_encontrados?: string[] }>("update_form", { formulario_id: f.id, ...alt }))),
        onSuccess: (r) => {
            qc.invalidateQueries({ queryKey: ["cpa-forms"] })
            qc.invalidateQueries({ queryKey: ["cpa-testadores"] })
            const nao = r[0]?.nao_encontrados ?? []
            if (nao.length) showError(`CPF sem conta no Portal: ${nao.join(", ")}`)
            else showSuccess("Atualizado")
        },
        onError: (e: Error) => showError(e.message),
    })

    const apagarTestes = useMutation({
        mutationFn: async () => (await Promise.all(partes.map((f) => chamar<{ apagadas: number }>("delete_tests", { formulario_id: f.id })))).reduce((n, r) => n + r.apagadas, 0),
        onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["cpa-forms"] }); qc.invalidateQueries({ queryKey: ["cpa-stats"] }); showSuccess(`${n} respostas de teste apagadas; alunos de teste reiniciados`) },
        onError: (e: Error) => showError(e.message),
    })

    const sincronizarDocentes = useMutation({
        mutationFn: async () => {
            let offset = 0
            let com = 0
            let sem = 0
            for (;;) {
                const r = await chamar<{ com_professor: number; sem_professor: number; proximo: number | null }>("sync_docentes", { offset })
                com += r.com_professor
                sem += r.sem_professor
                if (r.proximo === null) return { com, sem }
                offset = r.proximo
            }
        },
        onSuccess: (r) => {
            qc.invalidateQueries({ queryKey: ["cpa-stats"] })
            qc.invalidateQueries({ queryKey: ["cpa-disc-docentes"] })
            qc.invalidateQueries({ queryKey: ["cpa-docentes"] })
            showSuccess(`${r.com} disciplinas com professor, ${r.sem} sem professor (preencha abaixo)`)
        },
        onError: (e: Error) => showError(e.message),
    })

    const verificar = useMutation({
        mutationFn: async () => ({
            geral: geral ? await chamar<Cadeia>("verify", { formulario_id: geral.id }) : null,
            disc: disc ? await chamar<Cadeia>("verify", { formulario_id: disc.id }) : null,
        }),
        onSuccess: (r) => setVerificacao(r),
        onError: (e: Error) => showError(e.message),
    })

    const exportar = useMutation({
        mutationFn: async () => Promise.all(partes.map(async (f) => ({ f, r: await chamar<any>("export", { formulario_id: f.id, filtros: limparFiltros(filtros) }) }))), // eslint-disable-line @typescript-eslint/no-explicit-any
        onSuccess: (rs) => {
            const base = `cpa_${nivel}_${geral?.ano ?? ""}`
            const sec = (f: FormResumo, r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const c = r.cadeia
                return [
                    `== ${f.tipo === "geral" ? "Avaliação geral" : "Avaliação de disciplinas"} ==`,
                    `Linhas no CSV: ${r.linhas}`,
                    `SHA-256 do CSV: ${r.sha256}`,
                    `Cadeia de integridade das respostas oficiais: ${c.integra ? "ÍNTEGRA" : "ADULTERADA"} (${c.total} respostas)`,
                    c.integra ? `Hash da última resposta oficial: ${c.cabeca ?? "-"}` : `Primeiro erro: protocolo ${c.primeiro_erro?.seq} - ${c.primeiro_erro?.motivo}`,
                ]
            }
            for (const { f, r } of rs) baixar(`${base}_${f.tipo === "geral" ? "geral" : "disciplinas"}_${filtros.origem}.csv`, r.csv, "text/csv;charset=utf-8")
            const primeiro = rs[0].r
            const relatorio = [
                `Avaliação Institucional CPA - ${nivel === "graduacao" ? "Graduação" : "Pós-Graduação"} ${geral?.ano ?? ""}`,
                `Gerado em: ${primeiro.gerado_em}`,
                `Gerado por: ${primeiro.gerado_por}`,
                `Filtros: origem=${filtros.origem}${filtros.curso ? `, curso=${filtros.curso}` : ""}${filtros.de ? `, de=${filtros.de}` : ""}${filtros.ate ? `, até=${filtros.ate}` : ""}`,
                "",
                ...rs.flatMap(({ f, r }) => [...sec(f, r), ""]),
            ].join("\r\n") + "\r\n"
            baixar(`${base}_${filtros.origem}_verificacao.txt`, relatorio, "text/plain;charset=utf-8")
            showSuccess("Relatório exportado (geral, disciplinas e verificação)")
        },
        onError: (e: Error) => showError(e.message),
    })

    if (carregandoForms) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
    if (erroForms) return <p className="p-6 text-sm text-destructive">{(erroForms as Error).message}</p>

    const link = `${window.location.origin}/avaliacao`
    const tg = statsGeral?.totais
    const td = statsDisc?.totais
    const testes = partes.reduce((n, f) => n + f.testes, 0)
    const atualizando = carregandoG || carregandoD
    const veredito = verificacao && [verificacao.geral, verificacao.disc].filter((c): c is Cadeia => !!c)
    const falha = veredito?.find((c) => !c.integra)

    return (
        <div className="space-y-6 p-4 md:p-6">

            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-primary">
                        <ClipboardCheck size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Uso interno · aparece no Portal só quando você ligar</span>
                    </div>
                    <h2 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text-main)]">Avaliação Institucional (CPA)</h2>
                    <p className="text-sm text-[var(--text-muted)]">Uma avaliação por nível: a geral e as disciplinas ativas do aluno, em um link só.</p>
                </div>
                <div className="flex gap-2">
                    {(["graduacao", "pos"] as const).map((n) => (
                        <Btn key={n} size="sm" variant={nivel === n ? "default" : "outline"} onClick={() => setNivel(n)}>
                            {n === "graduacao" ? "Graduação" : "Pós"} {forms.find((f) => f.nivel === n)?.ano}
                        </Btn>
                    ))}
                </div>
            </div>

            {geral && (
                <>
                    <div className="flex gap-2 pb-2">
                        <Btn size="sm" variant={aba === "painel" ? "default" : "ghost"} onClick={() => setAba("painel")}>Painel e respostas</Btn>
                        <Btn size="sm" variant={aba === "perguntas" ? "default" : "ghost"} onClick={() => setAba("perguntas")}>Perguntas</Btn>
                    </div>

                    {aba === "perguntas" && (
                        <div className="space-y-8">
                            <div className="space-y-3">
                                <Rotulo>Avaliação geral</Rotulo>
                                <CpaEditor formId={geral.id} admin={admin} />
                            </div>
                            {disc && (
                                <div className="space-y-3">
                                    <Rotulo>Avaliação de disciplinas (repetida para cada disciplina ativa do aluno)</Rotulo>
                                    <CpaEditor formId={disc.id} admin={admin} />
                                </div>
                            )}
                        </div>
                    )}

                    {aba === "painel" && (
                    <>
                    <section className="grid gap-4 glass-card p-6 md:grid-cols-2">
                        <div className="space-y-2 text-sm">
                            <p><span className="text-[var(--text-muted)]">Status:</span> <b>{rotuloStatus(geral.status)}</b></p>
                            <p className="text-xs text-[var(--text-muted)]">Link único do aluno. Pede o login do Portal e abre a avaliação geral e as disciplinas em sequência. É o mesmo link para teste e para valer.</p>
                            <p className="break-all font-mono text-xs">{link}</p>
                            <Btn size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); showSuccess("Link copiado") }}>Copiar link</Btn>
                            {admin && geral.status === "teste" && !geral.portal_ativo && (
                                <p className="text-xs text-[var(--text-muted)]">Em teste, só os alunos de teste (ao lado) veem a avaliação. Respostas de teste não entram nos relatórios oficiais.</p>
                            )}
                        </div>
                        {admin && (
                            <div className="space-y-3 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[var(--text-muted)]">Portal do aluno:</span>
                                    <Btn size="sm" variant={geral.portal_ativo ? "default" : "outline"} disabled={alterar.isPending}
                                        onClick={() => { if (!geral.portal_ativo || confirm("Desligar a avaliação no Portal do Aluno?")) alterar.mutate({ portal_ativo: !geral.portal_ativo }) }}>
                                        {geral.portal_ativo ? "Ligado para todos" : "Desligado"}
                                    </Btn>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(["teste", "aberto", "encerrado"] as const).map((s) => (
                                        <Btn key={s} size="sm" variant={geral.status === s ? "default" : "outline"} disabled={alterar.isPending} onClick={() => alterar.mutate({ status: s })}>
                                            {rotuloStatus(s)}
                                        </Btn>
                                    ))}
                                </div>
                                <p className="text-xs text-[var(--text-muted)]">Status e Portal valem para a geral e as disciplinas deste nível. Base: {geral.populacao_ativa ?? "–"} alunos com matrícula vigente no Sponte.</p>
                                <SemestreCampo valor={disc?.semestre ?? null} salvando={alterar.isPending} onSalvar={(v) => alterar.mutate({ semestre: v })} />
                                <AlunosTeste geral={geral} salvando={alterar.isPending} onSalvar={(cpfs) => alterar.mutate({ alunos_teste_cpf: cpfs })} />
                                <Btn size="sm" variant="ghost" className="text-destructive" disabled={apagarTestes.isPending || testes === 0}
                                    onClick={() => { if (confirm(`Apagar ${testes} respostas de teste (geral e disciplinas) e reiniciar os alunos de teste? Eles voltam a ver as avaliações como pendentes no Portal. As oficiais não são afetadas.`)) apagarTestes.mutate() }}>
                                    Reiniciar testes: apagar respostas ({testes})
                                </Btn>
                                <p className="text-xs text-[var(--text-muted)]">Os alunos de teste voltam a ver as avaliações como pendentes (recarregar o Portal).</p>
                            </div>
                        )}
                    </section>

                    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Kpi rotulo="Respondentes (avaliação geral)" valor={tg?.respondentes ?? "–"} sub={tg?.percentual != null ? `${tg.percentual}% de ${tg.populacao_ativa} alunos ativos` : "Sem base de alunos ativos"} />
                        <Kpi rotulo="Disciplinas avaliadas" valor={td?.respondentes ?? "–"} sub="uma resposta por aluno e disciplina" />
                        <Kpi rotulo="Média da avaliação geral" valor={tg?.media_geral ?? "–"} sub={tg?.pct_notas_altas != null ? `${tg.pct_notas_altas}% de notas altas` : "sem respostas"} />
                        <Kpi rotulo="Média das disciplinas" valor={td?.media_geral ?? "–"} sub={td?.pct_notas_altas != null ? `${td.pct_notas_altas}% de notas altas` : "sem respostas"} />
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
                        <Campo rotulo="Curso">
                            <select className="h-9 w-full rounded-lg bg-[var(--bg-card-hover)] px-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" value={filtros.curso}
                                onChange={(e) => setFiltros({ ...filtros, curso: e.target.value })}>
                                <option value="">Todos</option>
                                {opcoesCurso.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </Campo>
                        <Campo rotulo="De"><Inp type="date" value={filtros.de} onChange={(e) => setFiltros({ ...filtros, de: e.target.value })} /></Campo>
                        <Campo rotulo="Até"><Inp type="date" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} /></Campo>
                        <div className="flex items-end gap-2">
                            <Btn size="sm" variant="outline" onClick={() => { refazerG(); refazerD() }} disabled={atualizando}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${atualizando ? "animate-spin" : ""}`} /> Atualizar
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
                        {veredito && (
                            <span className={`flex items-center gap-2 text-sm ${falha ? "text-red-700" : "text-emerald-700"}`}>
                                {falha ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                                {falha
                                    ? `ADULTERADA no protocolo ${falha.primeiro_erro?.seq}: ${falha.primeiro_erro?.motivo}.`
                                    : `Íntegra: ${veredito.reduce((n, c) => n + c.total, 0)} respostas oficiais (geral e disciplinas), sem alteração.`}
                            </span>
                        )}
                    </section>

                    <Resultados titulo="Avaliação geral" stats={statsGeral} />
                    {disc && <Resultados titulo="Avaliação de disciplinas" stats={statsDisc} porDisciplina />}

                    <ProfessoresPorDisciplina admin={admin} />

                    <ProfessoresFotos />
                    </>
                    )}
                </>
            )}
        </div>
    )
}

// Resultados de uma parte da avaliação (geral ou disciplinas): gráficos, tabela por pergunta e comentários.
function Resultados({ titulo, stats, porDisciplina }: { titulo: string; stats: any; porDisciplina?: boolean }) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const [busca, setBusca] = useState("")
    const t = stats?.totais
    const escala = (stats?.perguntas ?? []).filter((p: any) => p.tipo === "escala") // eslint-disable-line @typescript-eslint/no-explicit-any
    const comentarios = useMemo(() => {
        const q = busca.trim().toLowerCase()
        const todos = stats?.comentarios ?? []
        return q ? todos.filter((c: any) => c.texto.toLowerCase().includes(q)) : todos // eslint-disable-line @typescript-eslint/no-explicit-any
    }, [stats, busca])
    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
                <h3 className="text-xl font-bold tracking-tight text-[var(--text-main)]">{titulo}</h3>
                <p className="text-xs text-[var(--text-muted)]">
                    {t ? `${t.respondentes} respostas · média ${t.media_geral ?? "–"} · ${t.pct_notas_altas ?? "–"}% notas altas · ${t.pct_notas_baixas ?? "–"}% notas baixas` : "carregando"}
                </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
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
                <Painel titulo="Média por bloco">
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={stats?.blocos ?? []} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                            <CartesianGrid stroke="rgba(139,148,158,0.18)" horizontal={false} />
                            <XAxis type="number" domain={[0, 10]} tick={TICK} />
                            <YAxis type="category" dataKey="titulo" width={150} tick={TICK} />
                            <Tooltip {...TT} />
                            <Bar dataKey="media" name="Média" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Painel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Painel titulo="Média por pergunta de escala">
                    <ResponsiveContainer width="100%" height={Math.max(220, escala.length * 22)}>
                        <BarChart data={escala} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                            <XAxis type="number" domain={[0, 10]} tick={TICK} />
                            <YAxis type="category" dataKey="ordem" width={36} tick={TICK} tickFormatter={(v) => `P${v}`} />
                            <Tooltip {...TT} formatter={(v: number) => [v, "Média"]} labelFormatter={(v) => `P${v}`} />
                            <Bar dataKey="media" name="Média" fill={COR_SERIE} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Painel>
                <Painel titulo="Por curso">
                    {(stats?.por_curso ?? []).length === 0 ? (
                        <p className="py-10 text-center text-sm text-[var(--text-muted)]">Sem respostas no filtro atual.</p>
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
            </div>

            {porDisciplina && (
                <Painel titulo="Por disciplina e professor">
                    {(stats?.por_disciplina ?? []).length === 0 ? (
                        <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nenhuma avaliação de disciplina no filtro atual.</p>
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
                                            <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">{d.periodo}</td>
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
            )}

            <Painel titulo="Tabela por pergunta (alternativa textual aos gráficos)">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                            <tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Pergunta</th><th className="py-2 pr-3 text-right">n</th><th className="py-2 pr-3 text-right">Média</th><th className="py-2">Distribuição</th></tr>
                        </thead>
                        <tbody>
                            {(stats?.perguntas ?? []).map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                                <tr key={p.id} className="align-top">
                                    <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">{p.ordem}</td>
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

            <Painel titulo={`Comentários (${comentarios.length})`}>
                <Inp placeholder="Buscar nos comentários" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-3" />
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {comentarios.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                        <div key={`${c.seq}-${c.respondido_em}-${c.texto.slice(0, 12)}`} className="rounded-xl bg-[var(--bg-card-hover)] p-4 text-sm">
                            <p className="mb-1 text-xs text-[var(--text-muted)]">
                                {c.teste ? "teste" : `protocolo ${c.seq}`} · {new Date(c.respondido_em).toLocaleString("pt-BR")}{c.curso ? ` · ${c.curso}` : ""}
                            </p>
                            <p className="whitespace-pre-wrap">{c.texto}</p>
                        </div>
                    ))}
                    {comentarios.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nenhum comentário.</p>}
                </div>
            </Painel>
        </section>
    )
}

// Alunos de teste: em status Teste, só eles veem a avaliação (pelo Início do Portal ou pelo link), mesmo com o Portal desligado.
function AlunosTeste({ geral, salvando, onSalvar }: { geral: FormResumo; salvando: boolean; onSalvar: (cpfs: string[]) => void }) {
    const [txt, setTxt] = useState("")
    const { data } = useQuery({
        queryKey: ["cpa-testadores", geral.id, (geral.alunos_teste ?? []).join(",")],
        queryFn: () => chamar<{ alunos: { sponte_aluno_id: number; nome: string; ra: string | null }[] }>("testadores", { formulario_id: geral.id }),
    })
    const alunos = data?.alunos ?? []
    const qc = useQueryClient()
    const reiniciar = useMutation({
        mutationFn: (a: { sponte_aluno_id: number; nome: string }) => chamar<{ apagadas: number }>("reset_aluno_teste", { formulario_id: geral.id, aluno_id: a.sponte_aluno_id }),
        onSuccess: (r, a) => { qc.invalidateQueries({ queryKey: ["cpa-stats"] }); showSuccess(`${a.nome}: ${r.apagadas} avaliação(ões) liberada(s) pra responder de novo`) },
        onError: (e: Error) => showError(e.message),
    })
    return (
        <div className="space-y-2">
            <label className="block space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Alunos de teste (CPF, um por linha; a lista salva substitui a atual)</span>
                <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={3} placeholder="000.000.000-00"
                    className="w-full rounded-lg bg-[var(--bg-card-hover)] p-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
                <Btn size="sm" variant="outline" disabled={salvando || !txt.trim()} onClick={() => { onSalvar(txt.split(/[\s,;]+/).filter(Boolean)); setTxt("") }}>Salvar lista</Btn>
                {alunos.length > 0 && <Btn size="sm" variant="ghost" disabled={salvando} onClick={() => onSalvar([])}>Limpar lista</Btn>}
            </div>
            {alunos.length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Na lista:</p>
                    {alunos.map((a) => (
                        <div key={a.sponte_aluno_id} className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                            <span>{a.nome}{a.ra ? ` (RA ${a.ra})` : ""}</span>
                            <Btn size="sm" variant="outline" disabled={reiniciar.isPending}
                                onClick={() => { if (confirm(`Liberar ${a.nome} pra responder as avaliações de teste de novo?`)) reiniciar.mutate(a) }}>
                                Reiniciar este aluno
                            </Btn>
                        </div>
                    ))}
                </div>
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

// Professores identificados pelo Moodle: a equipe envia a foto de cada um (PNG, JPG ou WebP até 1 MB).
function ProfessoresFotos() {
    const qc = useQueryClient()
    const { data } = useQuery({ queryKey: ["cpa-docentes"], queryFn: () => chamar<{ docentes: { nome: string; foto_path: string | null }[]; admin: boolean }>("docentes", {}) })
    const enviar = useMutation({
        mutationFn: async ({ nome, arquivo }: { nome: string; arquivo: File }) => {
            const imagem = await new Promise<string>((ok, falha) => {
                const r = new FileReader()
                r.onload = () => ok(String(r.result))
                r.onerror = () => falha(r.error)
                r.readAsDataURL(arquivo)
            })
            return chamar("docente_foto", { nome, imagem })
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["cpa-docentes"] }); showSuccess("Foto salva") },
        onError: (e: Error) => showError(e.message),
    })
    const lista = data?.docentes ?? []
    if (!lista.length) return null
    return (
        <Painel titulo="Professores e fotos">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {lista.map((d) => (
                    <div key={d.nome} className="flex items-center gap-3 rounded-xl bg-[var(--bg-card-hover)] p-3">
                        <AvatarDocente src={d.foto_path ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/cpa-docentes/${d.foto_path}` : null} nome={d.nome} tamanho={44} />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{d.nome}</p>
                            <label className="cursor-pointer text-xs font-semibold text-primary">
                                {d.foto_path ? "Trocar foto" : "Enviar foto"}
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar.mutate({ nome: d.nome, arquivo: f }); e.target.value = "" }} />
                            </label>
                        </div>
                    </div>
                ))}
            </div>
        </Painel>
    )
}

// Semestre das disciplinas: vazio = automático (julho em diante é .2, antes é .1).
function SemestreCampo({ valor, salvando, onSalvar }: { valor: string | null; salvando: boolean; onSalvar: (v: string | null) => void }) {
    const [txt, setTxt] = useState(valor ?? "")
    const automatico = `${new Date().getFullYear()}.${new Date().getMonth() >= 6 ? 2 : 1}`
    const valido = txt === "" || /^\d{4}\.[12]$/.test(txt)
    return (
        <div className="flex items-end gap-2">
            <label className="block space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Semestre das disciplinas</span>
                <Inp value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={`automático (${automatico})`} className="w-48" />
            </label>
            <Btn size="sm" variant="outline" disabled={!valido || salvando} onClick={() => onSalvar(txt === "" ? null : txt)}>Salvar</Btn>
        </div>
    )
}

// Professor de cada disciplina ativa. Vem do Moodle; onde não há (as pós), a equipe preenche aqui.
// O que for preenchido à mão não é sobrescrito pela atualização do Moodle.
type LinhaDisc = { periodo: string; disciplina: string; periodo_nome: string; disciplina_nome: string; docente: string | null; origem: "moodle" | "manual" }
function ProfessoresPorDisciplina({ admin }: { admin: boolean }) {
    const qc = useQueryClient()
    const [soSem, setSoSem] = useState(true)
    const [busca, setBusca] = useState("")
    const { data } = useQuery({ queryKey: ["cpa-disc-docentes"], queryFn: () => chamar<{ disciplinas: LinhaDisc[] }>("disciplinas_docentes", {}) })
    const definir = useMutation({
        mutationFn: (x: { periodo: string; disciplina: string; docente: string }) => chamar("docente_definir", x),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["cpa-disc-docentes"] })
            qc.invalidateQueries({ queryKey: ["cpa-docentes"] })
            qc.invalidateQueries({ queryKey: ["cpa-stats"] })
            showSuccess("Professor salvo")
        },
        onError: (e: Error) => showError(e.message),
    })
    const todas = data?.disciplinas ?? []
    if (!todas.length) return null
    const semProf = todas.filter((d) => !d.docente).length
    const q = busca.trim().toLowerCase()
    const lista = todas.filter((d) => (!soSem || !d.docente) && (!q || `${d.disciplina_nome} ${d.periodo_nome} ${d.docente ?? ""}`.toLowerCase().includes(q)))
    return (
        <Painel titulo={`Professores por disciplina · ${semProf} de ${todas.length} sem professor`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Btn size="sm" variant={soSem ? "default" : "outline"} onClick={() => setSoSem(!soSem)}>Só sem professor</Btn>
                <Inp value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar disciplina, período ou professor" className="max-w-sm" />
            </div>
            <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
                {lista.slice(0, 100).map((d) => (
                    <div key={`${d.periodo}~${d.disciplina}`} className="grid items-center gap-2 rounded-xl bg-[var(--bg-card-hover)] p-3 md:grid-cols-[1fr_minmax(0,18rem)]">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{d.disciplina_nome}</p>
                            <p className="truncate text-xs text-[var(--text-muted)]">{d.periodo_nome}{d.origem === "manual" ? " · preenchido à mão" : ""}</p>
                        </div>
                        <Inp
                            defaultValue={d.docente ?? ""} disabled={!admin} placeholder="Nome do professor"
                            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (d.docente ?? "")) definir.mutate({ periodo: d.periodo, disciplina: d.disciplina, docente: v }) }}
                        />
                    </div>
                ))}
                {lista.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-muted)]">Nada para mostrar.</p>}
                {lista.length > 100 && <p className="py-2 text-center text-xs text-[var(--text-muted)]">Mostrando 100 de {lista.length}. Use a busca para filtrar.</p>}
            </div>
        </Painel>
    )
}
