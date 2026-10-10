// Respostas de um Formulário de Marketing — pedido do usuário 10/10: ver os dados de quem
// preencheu, filtrar por data e exportar em CSV/XLS. As chaves de `payload` são os UUIDs dos
// campos (mesmo formato salvo pelo FormRenderer); aqui cruzamos com `marketing_forms.fields`
// pra mostrar o rótulo certo (Nome/WhatsApp/Email/...) em vez do UUID cru.
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Papa from "papaparse"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { MarketingForm, MarketingFormField } from "@/types/database"

interface Submission {
    id: number
    created_at: string
    outcome: string
    reject_reason: string | null
    payload: Record<string, string>
    utm: Record<string, string> | null
    lead_id: number | null
}

const OUTCOME_LABEL: Record<string, string> = {
    created: "Lead criado",
    updated: "Lead atualizado",
    rejected: "Rejeitado",
    pending: "Pendente",
}

interface Props {
    formId: number
    onBack: () => void
}

export function MarketingFormSubmissions({ formId, onBack }: Props) {
    const [dateStart, setDateStart] = useState("")
    const [dateEnd, setDateEnd] = useState("")

    const { data: form } = useQuery<MarketingForm>({
        queryKey: ["marketing_form", formId],
        queryFn: async () => {
            const { data, error } = await supabase.from("marketing_forms").select("id, name, fields").eq("id", formId).single()
            if (error) throw error
            return data as unknown as MarketingForm
        },
    })

    const { data: submissions, isLoading } = useQuery<Submission[]>({
        queryKey: ["marketing_form_submissions", formId, dateStart, dateEnd],
        queryFn: async () => {
            let q = supabase.from("marketing_form_submissions")
                .select("id, created_at, outcome, reject_reason, payload, utm, lead_id")
                .eq("form_id", formId)
                .order("created_at", { ascending: false })
                .limit(5000)
            if (dateStart) q = q.gte("created_at", `${dateStart}T00:00:00`)
            if (dateEnd) q = q.lte("created_at", `${dateEnd}T23:59:59`)
            const { data, error } = await q
            if (error) throw error
            return (data ?? []) as unknown as Submission[]
        },
    })

    // campos com role (Nome/WhatsApp/Email/Preferência) primeiro, na ordem do formulário,
    // depois os campos extras (sem role) que a pessoa também preencheu — mesmo critério que
    // marketing-form-submit usa pra decidir o que é "campo mapeado" vs "observação solta".
    const columns = useMemo(() => {
        const fields = (form?.fields ?? []) as MarketingFormField[]
        return fields.filter((f) => f.type !== "static_text" && f.type !== "spacer")
    }, [form])

    const rows = useMemo(() => {
        return (submissions ?? []).map((s) => ({
            ...s,
            dataFmt: new Date(s.created_at).toLocaleString("pt-BR"),
            statusFmt: OUTCOME_LABEL[s.outcome] ?? s.outcome,
        }))
    }, [submissions])

    const exportRows = useMemo(() => {
        return rows.map((r) => {
            const row: Record<string, string> = { "Data/Hora": r.dataFmt, "Status": r.statusFmt }
            for (const c of columns) row[c.label || c.id] = r.payload?.[c.id] ?? ""
            if (r.utm?.utm_source) row["UTM Source"] = r.utm.utm_source
            if (r.utm?.utm_medium) row["UTM Medium"] = r.utm.utm_medium
            if (r.utm?.utm_campaign) row["UTM Campaign"] = r.utm.utm_campaign
            return row
        })
    }, [rows, columns])

    const fileBaseName = `respostas-${form?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? formId}`

    const exportCsv = () => {
        const csv = Papa.unparse(exportRows)
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = `${fileBaseName}.csv`; a.click()
        URL.revokeObjectURL(url)
    }

    const exportXlsx = async () => {
        const XLSX = await import("xlsx")
        const ws = XLSX.utils.json_to_sheet(exportRows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Respostas")
        XLSX.writeFile(wb, `${fileBaseName}.xlsx`)
    }

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Respostas — {form?.name ?? "..."}</h1>
                        <p className="text-sm text-muted-foreground">{rows.length} preenchimento{rows.length === 1 ? "" : "s"} no período.</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
                        <Download className="mr-2 h-4 w-4" /> CSV
                    </Button>
                    <Button variant="outline" onClick={exportXlsx} disabled={!rows.length}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" /> XLS
                    </Button>
                </div>
            </div>

            <div className="flex items-end gap-4 bg-card/40 border rounded-xl p-4">
                <div className="space-y-1.5">
                    <Label className="text-xs">De</Label>
                    <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs">Até</Label>
                    <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="h-9" />
                </div>
                {(dateStart || dateEnd) && (
                    <Button variant="ghost" size="sm" onClick={() => { setDateStart(""); setDateEnd("") }}>Limpar</Button>
                )}
            </div>

            <div className="border rounded-xl bg-card/40 overflow-x-auto">
                {isLoading ? (
                    <div className="p-8 text-center text-muted-foreground animate-pulse flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando respostas...
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead className="whitespace-nowrap">Data/Hora</TableHead>
                                {columns.map((c) => <TableHead key={c.id} className="whitespace-nowrap">{c.label || c.id}</TableHead>)}
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length > 0 ? rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.dataFmt}</TableCell>
                                    {columns.map((c) => <TableCell key={c.id}>{r.payload?.[c.id] || "—"}</TableCell>)}
                                    <TableCell>
                                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                            r.outcome === "rejected" ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-500"
                                        }`} title={r.reject_reason ?? undefined}>
                                            {r.statusFmt}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={columns.length + 2} className="h-32 text-center text-muted-foreground">
                                        Nenhuma resposta no período.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    )
}
