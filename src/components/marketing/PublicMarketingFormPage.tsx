import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { FormRenderer } from "./FormRenderer"
import { MarketingFormDesign, MarketingFormField } from "@/types/database"

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-form-submit`

type PublicForm = {
    id: number; slug: string; name: string
    fields: MarketingFormField[]; design: MarketingFormDesign
    lgpd_enabled: boolean; lgpd_text: string | null
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]

export function PublicMarketingFormPage() {
    const { slug } = useParams<{ slug: string }>()
    const [searchParams] = useSearchParams()
    const [form, setForm] = useState<PublicForm | null>(null)
    const [notFound, setNotFound] = useState(false)
    const [values, setValues] = useState<Record<string, string | boolean>>({})
    const [lgpdChecked, setLgpdChecked] = useState(false)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState<{ message?: string } | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const honeypotRef = useRef<HTMLInputElement>(null)

    const parentUrl = searchParams.get("parent_url") || ""
    const referrerHint = document.referrer || parentUrl

    useEffect(() => {
        if (!slug) return
        fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", slug }) })
            .then((r) => r.json())
            .then((d) => { if (d.ok) setForm(d.form); else setNotFound(true) })
            .catch(() => setNotFound(true))
        fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", slug }) }).catch(() => {})
    }, [slug])

    useEffect(() => {
        if (!containerRef.current) return
        const el = containerRef.current
        const post = () => window.parent.postMessage({ type: "ficv-form-resize", height: el.scrollHeight }, "*")
        const ro = new ResizeObserver(post)
        ro.observe(el)
        post()
        return () => ro.disconnect()
    }, [form, result])

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!form || !slug) return
        const newErrors: Record<string, string> = {}
        for (const f of form.fields) {
            if (f.required && !values[f.id]) newErrors[f.id] = "Campo obrigatório"
        }
        if (form.lgpd_enabled && !lgpdChecked) newErrors.__lgpd = "Obrigatório"
        setErrors(newErrors)
        if (Object.keys(newErrors).length) return

        setSubmitting(true)
        const utm: Record<string, string> = {}
        for (const k of UTM_KEYS) { const v = searchParams.get(k); if (v) utm[k] = v }

        try {
            const res = await fetch(FN_URL, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slug, values, utm, honeypot: honeypotRef.current?.value ?? "",
                    referrer_hint: referrerHint,
                }),
            })
            const data = await res.json()
            if (data.ok) {
                if (data.redirect_url) window.parent.postMessage({ type: "ficv-form-redirect", url: data.redirect_url }, "*")
                else setResult({ message: data.message ?? "Recebido!" })
            } else {
                setResult({ message: data.error ?? "Não foi possível enviar. Tente novamente." })
            }
        } catch {
            setResult({ message: "Não foi possível enviar. Tente novamente." })
        } finally {
            setSubmitting(false)
        }
    }

    if (notFound) return <div ref={containerRef} style={{ padding: 24, fontFamily: "sans-serif", color: "#888" }}>Formulário não encontrado.</div>
    if (!form) return <div ref={containerRef} style={{ padding: 24 }} />

    if (result) {
        return (
            <div ref={containerRef} style={{ padding: 24, fontFamily: form.design.font || "sans-serif", textAlign: "center" }}>
                <p>{result.message}</p>
            </div>
        )
    }

    return (
        <div ref={containerRef}>
            <FormRenderer
                fields={form.fields}
                design={form.design}
                values={values}
                onChange={(fid, v) => setValues((s) => ({ ...s, [fid]: v }))}
                errors={errors}
                lgpdEnabled={form.lgpd_enabled}
                lgpdText={form.lgpd_text}
                lgpdChecked={lgpdChecked}
                onLgpdChange={setLgpdChecked}
                submitting={submitting}
                onSubmit={onSubmit}
            >
                <input ref={honeypotRef} type="text" name="website" autoComplete="off" tabIndex={-1}
                    style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
            </FormRenderer>
        </div>
    )
}
