// Relatório de uma página por professor (feedback). Abre numa janela pronta para imprimir ou salvar em PDF.
// Cores fixas (papel é sempre claro) e `print-color-adjust: exact` para as barras saírem coloridas na impressão.
import type { StatsCpa } from "./CpaResultados"
import { rotulosFaixas } from "./cpaViz"

const COR = { fav: "#1a8a4c", crit: "#e34948", neu: "#cfcdc4", marca: "#5551FF", tinta: "#13161D", suave: "#64748B", linha: "#E2E8F0" }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
const n1 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const pct = (parte: number, todo: number) => (todo ? Math.round((parte / todo) * 100) : 0)
const tot = (b: { c: number; n: number; f: number }) => b.c + b.n + b.f

function barra(b: { c: number; n: number; f: number } | undefined) {
    if (!b || !tot(b)) return `<div class="barra vazia"></div>`
    const t = tot(b)
    const seg = (v: number, cor: string) => (v ? `<i style="width:${(v / t) * 100}%;background:${cor}"></i>` : "")
    return `<div class="barra">${seg(b.c, COR.crit)}${seg(b.n, COR.neu)}${seg(b.f, COR.fav)}</div>`
}

function delta(v: number | null | undefined, ref: number | null | undefined) {
    if (v === null || v === undefined || ref === null || ref === undefined) return ""
    const d = Math.round((v - ref) * 10) / 10
    if (d === 0) return `<span class="d">= instituição</span>`
    return `<span class="d ${d > 0 ? "mais" : "menos"}">${d > 0 ? "+" : "−"}${n1(Math.abs(d))} vs. instituição</span>`
}

type Opcoes = { docente: string; nivel: string; stats: StatsCpa; base: StatsCpa; origem: string; de?: string; ate?: string }

export function htmlRelatorioProfessor(o: Opcoes): string {
    const { docente, stats, base } = o
    const t = stats.totais
    const ref = base.totais.media_geral
    const total = tot(t.bandas)
    const refEscala = stats.perguntas.find((i) => i.tipo === "escala")
    const rot = rotulosFaixas(refEscala?.min ?? 0, refEscala?.max ?? 10)
    const baseMedia = new Map(base.perguntas.map((i) => [i.id, i.media]))
    const discs = [...stats.por_disciplina].sort((a, b) => (b.media ?? -1) - (a.media ?? -1))
    const periodos = [...new Set(discs.map((d) => d.periodo_nome ?? d.periodo))].join(" · ")

    const linhasPerguntas = stats.perguntas.filter((i) => (i.tipo === "escala" || i.ordinal) && i.n > 0).map((i) => {
        if (i.neutra) {
            const top = [...(i.opcoes ?? [])].sort((a, b) => b.n - a.n)[0]
            return `<tr><td>${esc(i.texto)}</td><td class="mid">${top ? `mais citado: ${esc(top.valor)} (${pct(top.n, i.n)}%)` : "–"}</td><td class="num">–</td><td class="num ref">–</td></tr>`
        }
        return `<tr><td>${esc(i.texto)}</td><td>${barra(i.bandas)}</td><td class="num"><b>${n1(i.media)}</b></td><td class="num ref">${n1(baseMedia.get(i.id))}</td></tr>`
    }).join("")

    const linhasDiscs = discs.map((d) => `<tr><td>${esc(d.disciplina_nome ?? d.disciplina)}<small>${esc(d.periodo_nome ?? d.periodo)}</small></td><td class="num">${d.n}</td><td>${barra(d.bandas)}</td><td class="num"><b>${n1(d.media)}</b></td></tr>`).join("")

    const comentarios = stats.comentarios.filter((c) => c.texto.trim().length > 8).slice(0, 5)
        .map((c) => `<li>“${esc(c.texto.length > 230 ? c.texto.slice(0, 227) + "…" : c.texto)}”</li>`).join("")

    const filtroTxt = [o.origem === "teste" ? "respostas de teste" : o.origem === "todas" ? "inclui respostas de teste" : "respostas oficiais",
        o.de ? `desde ${o.de.split("-").reverse().join("/")}` : "", o.ate ? `até ${o.ate.split("-").reverse().join("/")}` : ""].filter(Boolean).join(" · ")

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório CPA — ${esc(docente)}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 11px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: ${COR.tinta}; background: #eef0f4; }
.pag { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 12mm; background: #fff; }
.barra-topo { display: flex; justify-content: flex-end; padding: 10px; }
.barra-topo button { font: inherit; padding: 8px 16px; border-radius: 999px; border: 0; background: ${COR.marca}; color: #fff; font-weight: 600; cursor: pointer; }
@media print { body { background: #fff; } .pag { margin: 0; padding: 0; width: auto; min-height: 0; } .barra-topo { display: none; } }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${COR.tinta}; padding-bottom: 8px; }
header .inst { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: ${COR.suave}; font-weight: 700; }
h1 { margin: 2px 0 0; font-size: 20px; } h2 { margin: 14px 0 6px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: ${COR.suave}; }
.sub { color: ${COR.suave}; font-size: 10px; margin-top: 2px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
.kpi { border: 1px solid ${COR.linha}; border-radius: 8px; padding: 8px 10px; }
.kpi .r { font-size: 8.5px; letter-spacing: .08em; text-transform: uppercase; color: ${COR.suave}; font-weight: 700; }
.kpi .v { font-size: 24px; font-weight: 700; line-height: 1.15; } .kpi .v small { font-size: 11px; font-weight: 400; color: ${COR.suave}; }
.d { display: block; font-size: 9px; color: ${COR.suave}; } .d.mais { color: ${COR.fav}; } .d.menos { color: ${COR.crit}; }
table { width: 100%; border-collapse: collapse; } td, th { padding: 4px 6px; border-bottom: 1px solid ${COR.linha}; vertical-align: middle; text-align: left; }
th { font-size: 8.5px; letter-spacing: .06em; text-transform: uppercase; color: ${COR.suave}; font-weight: 700; }
td small { display: block; font-size: 9px; color: ${COR.suave}; } .num { text-align: right; width: 44px; white-space: nowrap; } .ref { color: ${COR.suave}; } .mid { font-size: 9.5px; color: ${COR.suave}; }
.barra { display: flex; height: 10px; border-radius: 3px; overflow: hidden; gap: 1px; min-width: 120px; background: #fff; } .barra i { display: block; height: 100%; } .barra.vazia { background: ${COR.linha}; }
.leg { display: flex; gap: 12px; font-size: 9px; color: ${COR.suave}; margin: 0 0 6px; } .leg b { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
ul { margin: 0; padding-left: 14px; } li { margin-bottom: 4px; font-style: italic; }
footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid ${COR.linha}; font-size: 9px; color: ${COR.suave}; }
</style></head><body>
<div class="barra-topo"><button onclick="window.print()">Imprimir / salvar em PDF</button></div>
<div class="pag">
<header><div><div class="inst">Faculdade Internacional Cidade Viva · CPA</div><h1>${esc(docente)}</h1>
<div class="sub">Avaliação de disciplinas · ${o.nivel === "pos" ? "Pós-graduação" : "Graduação"}${periodos ? ` · ${esc(periodos)}` : ""}</div></div>
<div class="sub" style="text-align:right">Gerado em ${new Date().toLocaleDateString("pt-BR")}<br>${esc(filtroTxt)}</div></header>

<div class="kpis">
<div class="kpi"><div class="r">Nota média</div><div class="v">${n1(t.media_geral)} <small>/ 10</small></div>${delta(t.media_geral, ref)}</div>
<div class="kpi"><div class="r">Favoráveis</div><div class="v">${pct(t.bandas.f, total)}<small>%</small></div><span class="d">${pct(t.bandas.n, total)}% neutras · ${pct(t.bandas.c, total)}% críticas</span></div>
<div class="kpi"><div class="r">Alunos que avaliaram</div><div class="v">${t.alunos ?? t.respondentes}</div><span class="d">${t.respondentes} avaliações</span></div>
<div class="kpi"><div class="r">Disciplinas</div><div class="v">${discs.length}</div><span class="d">média da instituição ${n1(ref)}</span></div>
</div>

<h2>Por disciplina</h2>
<table><tr><th>Disciplina</th><th class="num">Resp.</th><th>Distribuição</th><th class="num">Média</th></tr>${linhasDiscs}</table>

<h2>Por pergunta</h2>
<p class="leg"><span><b style="background:${COR.crit}"></b>Críticas ${rot.c}</span><span><b style="background:${COR.neu}"></b>Neutras ${rot.n}</span><span><b style="background:${COR.fav}"></b>Favoráveis ${rot.f}</span></p>
<table><tr><th>Pergunta</th><th>Distribuição</th><th class="num">Média</th><th class="num">Inst.</th></tr>${linhasPerguntas}</table>

${comentarios ? `<h2>Comentários dos alunos</h2><ul>${comentarios}</ul>` : ""}
<footer>Baseado em ${t.respondentes} avaliações (${t.alunos ?? t.respondentes} alunos). “Inst.” é a média de todas as disciplinas deste nível no mesmo recorte. Comentários sem identificação do aluno. Documento para feedback interno.</footer>
</div></body></html>`

    return html
}

export function abrirRelatorioProfessor(o: Opcoes) {
    const html = htmlRelatorioProfessor(o)
    const w = window.open("", "_blank")
    if (!w) throw new Error("O navegador bloqueou a janela do relatório. Libere pop-ups para este site.")
    w.document.open()
    w.document.write(html)
    w.document.close()
}

