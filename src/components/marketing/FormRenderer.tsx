import { MarketingFormDesign, MarketingFormField } from "@/types/database"

const FIELD_SIZE_PADDING: Record<string, string> = { sm: "6px 10px", md: "10px 14px", lg: "14px 18px" }

interface FormRendererProps {
    fields: MarketingFormField[]
    design: MarketingFormDesign
    values: Record<string, string | boolean>
    onChange: (fieldId: string, value: string | boolean) => void
    errors?: Record<string, string>
    lgpdEnabled?: boolean
    lgpdText?: string | null
    lgpdChecked?: boolean
    onLgpdChange?: (checked: boolean) => void
    submitLabel?: string
    submitting?: boolean
    onSubmit?: (e: React.FormEvent) => void
    children?: React.ReactNode
}

export function FormRenderer({
    fields, design, values, onChange, errors = {},
    lgpdEnabled, lgpdText, lgpdChecked, onLgpdChange,
    submitLabel = "Enviar", submitting, onSubmit, children,
}: FormRendererProps) {
    // Cor de texto sempre explícita: este componente é embedado tanto no preview do
    // builder (que pode estar em tema escuro) quanto num iframe em site externo — nunca
    // pode herdar a cor de texto do app, senão fica ilegível contra o fundo do formulário.
    const textColor = design.text_color || "#111827"
    const fieldStyle: React.CSSProperties = {
        width: "100%",
        padding: FIELD_SIZE_PADDING[design.field_size ?? "md"],
        borderRadius: (design.border_radius ?? 8) - 2,
        border: `1px solid ${design.border_color || "#ddd"}`,
        background: design.field_background_color || "#fff",
        color: textColor,
        fontFamily: design.font || "inherit",
        fontSize: 14,
        boxSizing: "border-box",
    }
    const optionsOf = (f: MarketingFormField) => (f.options ?? []).filter((opt) => opt.trim() !== "")

    return (
        <form
            onSubmit={onSubmit}
            style={{
                background: design.background_color || "#fff",
                color: textColor,
                border: design.border_color ? `1px solid ${design.border_color}` : undefined,
                borderRadius: design.border_radius ?? 8,
                padding: 24,
                fontFamily: design.font || "inherit",
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}
        >
            {fields.map((f) => {
                if (f.type === "spacer") return <div key={f.id} style={{ height: f.height ?? 16 }} />
                if (f.type === "static_text") return <p key={f.id} style={{ margin: 0, color: textColor, fontFamily: design.font }}>{f.content}</p>

                const label = (
                    <label style={{ fontSize: 13, fontWeight: 600, color: textColor, display: f.type === "checkbox" ? "none" : "block", marginBottom: 4 }}>
                        {f.label}{f.required ? " *" : ""}
                    </label>
                )
                const error = errors[f.id]

                return (
                    <div key={f.id}>
                        {label}
                        {(f.type === "text" || f.type === "phone" || f.type === "email") && (
                            <input
                                type={f.type === "email" ? "email" : "text"}
                                placeholder={f.placeholder}
                                value={String(values[f.id] ?? "")}
                                onChange={(e) => onChange(f.id, e.target.value)}
                                style={fieldStyle}
                            />
                        )}
                        {f.type === "select" && (
                            <select
                                value={String(values[f.id] ?? "")}
                                onChange={(e) => onChange(f.id, e.target.value)}
                                style={fieldStyle}
                            >
                                <option value="">{f.placeholder || "Selecione..."}</option>
                                {optionsOf(f).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        )}
                        {f.type === "radio" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {optionsOf(f).map((opt) => (
                                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 400, color: textColor }}>
                                        <input type="radio" name={f.id} value={opt} checked={values[f.id] === opt}
                                            onChange={() => onChange(f.id, opt)} />
                                        {opt}
                                    </label>
                                ))}
                            </div>
                        )}
                        {f.type === "checkbox" && (
                            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, fontWeight: 400, color: textColor }}>
                                <input type="checkbox" checked={!!values[f.id]} onChange={(e) => onChange(f.id, e.target.checked)}
                                    style={{ marginTop: 2 }} />
                                <span>{f.label}{f.required ? " *" : ""}</span>
                            </label>
                        )}
                        {error && <p style={{ color: "#dc2626", fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
                    </div>
                )
            })}

            {lgpdEnabled && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, fontWeight: 400, color: textColor }}>
                    <input type="checkbox" checked={!!lgpdChecked} onChange={(e) => onLgpdChange?.(e.target.checked)}
                        style={{ marginTop: 2 }} />
                    <span>{lgpdText}</span>
                </label>
            )}

            {children}

            <button
                type="submit"
                disabled={submitting}
                style={{
                    background: design.button_color || "#C9A84C",
                    color: design.button_text_color || "#111",
                    border: "none",
                    borderRadius: (design.border_radius ?? 8) - 2,
                    padding: "12px 16px",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: submitting ? "default" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                }}
            >
                {submitting ? "Enviando..." : submitLabel}
            </button>
        </form>
    )
}
