/**
 * NpsPanel — NPS dos atendimentos (avaliações que o aluno responde ao fechar o chamado).
 * Admin/Coordenador veem tudo; os demais só o próprio (regra no RPC nps_report).
 * NPS = % promotores (9–10) − % detratores (0–6). Tutor Virtual aparece como "atendente"
 * quando nenhuma pessoa da equipe escreveu no chamado.
 */
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, MessageSquareQuote } from "lucide-react"
import { supabase } from "../../lib/supabase"

interface Row {
  avaliacao_id: number; avaliado_em: string; nps: number | null; csat: number | null; ces: number | null; fcr: boolean | null
  comentario: string | null; protocolo: string; titulo: string; fila: string | null; curso: string | null
  atendente: string; atendido_por: "humano" | "tutor"; aluno: string
}
interface Agg { n: number; nps: number | null; prom: number; neu: number; det: number; csat: number | null; ces: number | null; fcr: number | null }

function agg(rows: Row[]): Agg {
  const v = rows.filter(r => r.nps !== null)
  const prom = v.filter(r => r.nps! >= 9).length, det = v.filter(r => r.nps! <= 6).length
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const fcrs = rows.filter(r => r.fcr !== null)
  return {
    n: v.length, prom, det, neu: v.length - prom - det,
    nps: v.length ? Math.round(((prom - det) / v.length) * 100) : null,
    csat: avg(rows.filter(r => r.csat !== null).map(r => r.csat!)),
    ces: avg(rows.filter(r => r.ces !== null).map(r => r.ces!)),
    fcr: fcrs.length ? Math.round((fcrs.filter(r => r.fcr).length / fcrs.length) * 100) : null,
  }
}
const npsTone = (n: number | null) => n === null ? "text-[var(--text-muted)]" : n >= 50 ? "text-green-500" : n >= 0 ? "text-amber-500" : "text-red-500"
const npsLabel = (n: number | null) => n === null ? "sem dados" : n >= 75 ? "excelente" : n >= 50 ? "muito bom" : n >= 0 ? "razoável" : "crítico"
const grupo = (nota: number | null) => nota === null ? null : nota >= 9 ? "promotor" : nota >= 7 ? "neutro" : "detrator"

function Group({ title, rows, keyOf }: { title: string; rows: Row[]; keyOf: (r: Row) => string }) {
  const lines = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) { const k = keyOf(r); m.set(k, [...(m.get(k) ?? []), r]) }
    return [...m.entries()].map(([k, rs]) => ({ k, ...agg(rs) })).sort((a, b) => (b.nps ?? -999) - (a.nps ?? -999))
  }, [rows, keyOf])
  return (
    <div className="glass-card p-4">
      <p className="text-sm font-semibold text-[var(--text-main)] mb-3">{title}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] text-left">
            <th className="font-medium pb-2"></th><th className="font-medium pb-2 text-right">NPS</th>
            <th className="font-medium pb-2 text-right">Respostas</th><th className="font-medium pb-2 text-right">CSAT</th>
            <th className="font-medium pb-2 text-right">Resolveu</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.k} className="border-t border-[var(--border)]">
              <td className="py-2 text-[var(--text-main)]">{l.k === "Tutor Virtual" ? "🤖 Tutor Virtual" : l.k}</td>
              <td className={`py-2 text-right font-bold tabular-nums ${npsTone(l.nps)}`}>{l.nps ?? "—"}</td>
              <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">{l.n}</td>
              <td className="py-2 text-right tabular-nums text-[var(--text-main)]">{l.csat !== null ? l.csat.toFixed(1) : "—"}</td>
              <td className="py-2 text-right tabular-nums text-[var(--text-main)]">{l.fcr !== null ? `${l.fcr}%` : "—"}</td>
            </tr>
          ))}
          {!lines.length && <tr><td colSpan={5} className="py-4 text-center text-xs text-[var(--text-muted)]">Sem avaliações no período.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function NpsPanel({ podeVerTudo }: { podeVerTudo: boolean }) {
  const [dias, setDias] = useState(90)
  const [filtro, setFiltro] = useState<"todos" | "detrator" | "neutro" | "promotor">("todos")
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["nps-report", dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("nps_report", { p_from: new Date(Date.now() - dias * 86400_000).toISOString(), p_to: new Date().toISOString() })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })
  const total = agg(rows)
  // mês a mês (NPS de cada mês com avaliação)
  const meses = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) { const k = r.avaliado_em.slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]) }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, rs]) => ({ k, ...agg(rs) }))
  }, [rows])
  const comentarios = rows.filter(r => r.comentario?.trim() && (filtro === "todos" || grupo(r.nps) === filtro))
  const pct = (x: number) => (total.n ? (x / total.n) * 100 : 0)

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[var(--text-muted)]">
          {podeVerTudo ? "NPS de todos os atendimentos avaliados pelos alunos." : "Seu NPS — avaliações dos chamados em que você foi o responsável."}
        </p>
        <div className="flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--bg-card)] text-xs">
          {[30, 90, 180, 365].map(d => (
            <button key={d} onClick={() => setDias(d)}
              className={`px-3 py-1.5 rounded-md ${dias === d ? "bg-[var(--primary)] text-white font-semibold" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>
              {d === 365 ? "12 meses" : `${d} dias`}
            </button>
          ))}
        </div>
      </div>

      {/* destaque + distribuição */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">NPS</p>
          <p className={`text-5xl font-bold tabular-nums mt-1 ${npsTone(total.nps)}`}>{total.nps ?? "—"}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{npsLabel(total.nps)} · {total.n} resposta(s)</p>
        </div>
        <div className="glass-card p-5 lg:col-span-2 space-y-3">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Distribuição das notas</p>
          <div className="flex h-3 w-full gap-[2px] rounded-full overflow-hidden bg-[var(--bg-main)]" role="img"
            aria-label={`Promotores ${total.prom}, neutros ${total.neu}, detratores ${total.det}`}>
            {total.prom > 0 && <div className="bg-green-500" style={{ width: `${pct(total.prom)}%` }} title={`Promotores (9–10): ${total.prom}`} />}
            {total.neu > 0 && <div className="bg-amber-400" style={{ width: `${pct(total.neu)}%` }} title={`Neutros (7–8): ${total.neu}`} />}
            {total.det > 0 && <div className="bg-red-500" style={{ width: `${pct(total.det)}%` }} title={`Detratores (0–6): ${total.det}`} />}
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" /><span className="text-[var(--text-main)] font-semibold tabular-nums">{total.prom}</span> <span className="text-[var(--text-muted)] text-xs">promotores (9–10) · {Math.round(pct(total.prom))}%</span></div>
            <div><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1.5" /><span className="text-[var(--text-main)] font-semibold tabular-nums">{total.neu}</span> <span className="text-[var(--text-muted)] text-xs">neutros (7–8) · {Math.round(pct(total.neu))}%</span></div>
            <div><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" /><span className="text-[var(--text-main)] font-semibold tabular-nums">{total.det}</span> <span className="text-[var(--text-muted)] text-xs">detratores (0–6) · {Math.round(pct(total.det))}%</span></div>
          </div>
          <div className="flex gap-6 text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
            <span>CSAT <b className="text-[var(--text-main)]">{total.csat !== null ? total.csat.toFixed(1) : "—"}</b>/5</span>
            <span>Esforço (CES) <b className="text-[var(--text-main)]">{total.ces !== null ? total.ces.toFixed(1) : "—"}</b>/7 <span className="opacity-70">(menor = melhor)</span></span>
            <span>Resolvido no atendimento <b className="text-[var(--text-main)]">{total.fcr !== null ? `${total.fcr}%` : "—"}</b></span>
          </div>
        </div>
      </div>

      {/* mês a mês */}
      {meses.length > 1 && (
        <div className="glass-card p-5">
          <p className="text-sm font-semibold text-[var(--text-main)] mb-4">NPS mês a mês</p>
          <div className="flex items-end gap-3 h-40 border-b border-[var(--border)] relative">
            {meses.map(m => {
              const v = m.nps ?? 0
              return (
                <div key={m.k} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${m.k}: NPS ${m.nps ?? "—"} (${m.n} respostas)`}>
                  <span className="text-[11px] tabular-nums text-[var(--text-muted)] opacity-0 group-hover:opacity-100 mb-1">{m.nps ?? "—"}</span>
                  <div className="w-full max-w-[36px] rounded-t bg-[var(--primary)]" style={{ height: `${Math.max(2, (Math.max(v, 0) / 100) * 100)}%` }} />
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 mt-1.5">
            {meses.map(m => <span key={m.k} className="flex-1 text-center text-[11px] text-[var(--text-muted)]">{new Date(`${m.k}-15`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })}</span>)}
          </div>
          {meses.some(m => (m.nps ?? 0) < 0) && <p className="text-[11px] text-[var(--text-muted)] mt-2">Meses com NPS negativo aparecem sem barra — passe o mouse pra ver o valor.</p>}
        </div>
      )}

      <div className={`grid grid-cols-1 ${podeVerTudo ? "lg:grid-cols-2" : ""} gap-4`}>
        {podeVerTudo && <Group title="Por atendente (inclui o Tutor Virtual)" rows={rows} keyOf={r => r.atendente} />}
        <Group title="Por fila" rows={rows} keyOf={r => r.fila ?? "Sem fila"} />
      </div>

      {/* comentários */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2"><MessageSquareQuote className="w-4 h-4" /> O que os alunos disseram</p>
          <div className="flex gap-1 text-xs">
            {([["todos", "Todos"], ["detrator", "Detratores"], ["neutro", "Neutros"], ["promotor", "Promotores"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setFiltro(v)}
                className={`px-2.5 py-1 rounded-full border ${filtro === v ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{l}</button>
            ))}
          </div>
        </div>
        {!comentarios.length && <p className="text-xs text-[var(--text-muted)] py-4 text-center">Nenhum comentário {filtro !== "todos" ? "nesse grupo " : ""}no período.</p>}
        <div className="space-y-2">
          {comentarios.slice(0, 50).map(r => (
            <div key={r.avaliacao_id} className="border-b border-[var(--border)] last:border-0 pb-2">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] flex-wrap">
                <span className={`font-bold tabular-nums ${r.nps === null ? "" : r.nps >= 9 ? "text-green-500" : r.nps >= 7 ? "text-amber-500" : "text-red-500"}`}>NPS {r.nps ?? "—"}</span>
                <span>{r.protocolo}</span><span>·</span><span>{r.fila ?? "sem fila"}</span>
                {podeVerTudo && <><span>·</span><span>{r.atendido_por === "tutor" ? "🤖 Tutor Virtual" : r.atendente}</span></>}
                <span>·</span><span>{new Date(r.avaliado_em).toLocaleDateString("pt-BR")}</span>
              </div>
              <p className="text-sm text-[var(--text-main)] mt-0.5">“{r.comentario}”</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
