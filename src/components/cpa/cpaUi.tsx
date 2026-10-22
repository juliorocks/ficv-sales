// Peças visuais da Avaliação CPA, no padrão do CRM: cartões sem borda (glass-card), botões em pílula
// (btn-primary / btn-pill), campos com fundo --bg-card-hover e rótulos pequenos em maiúsculas.
import React from "react"
import { User } from "lucide-react"

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" | "primary"; size?: "sm" | "lg" }

export function Btn({ variant = "default", size, className = "", ...rest }: BtnProps) {
    const base = variant === "outline" || variant === "ghost" ? "btn-pill" : "btn-primary"
    const tamanho = size === "lg" ? "h-12 text-sm" : size === "sm" ? "px-4 py-2" : ""
    const ghost = variant === "ghost" ? "!bg-transparent !border-0 !shadow-none" : ""
    return <button type="button" {...rest} className={`${base} ${tamanho} ${ghost} disabled:opacity-50 disabled:pointer-events-none ${className}`} />
}

export const CAMPO = "w-full rounded-lg bg-[var(--bg-card-hover)] px-3 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"

export function Inp(props: React.InputHTMLAttributes<HTMLInputElement>) {
    return <input {...props} className={`${CAMPO} ${props.className ?? ""}`} />
}

export const Cartao = ({ className = "", children }: { className?: string; children: React.ReactNode }) => (
    <div className={`glass-card p-6 ${className}`}>{children}</div>
)

export const Rotulo = ({ children }: { children: React.ReactNode }) => (
    <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{children}</p>
)

// Estilo de gráfico alinhado ao CRM: sem borda, fundo do cartão, texto muted
export const TT = { contentStyle: { background: "var(--bg-card)", border: "none", borderRadius: 12, boxShadow: "var(--card-shadow)", color: "var(--text-main)", fontSize: 12 } }
export const TICK = { fontSize: 11, fill: "#8B949E" }
export const COR_GRAFICO = "#5551FF"

// Foto do professor (enviada pela equipe) ou avatar padrão quando não há foto.
export function AvatarDocente({ src, nome, tamanho = 64 }: { src?: string | null; nome?: string | null; tamanho?: number }) {
    const medida = { width: tamanho, height: tamanho }
    if (src) return <img src={src} alt={nome ?? "Professor(a)"} style={medida} className="shrink-0 rounded-full object-cover shadow-[var(--card-shadow)]" />
    return (
        <div style={medida} className="flex shrink-0 items-center justify-center rounded-full bg-[var(--bg-card-hover)] text-[var(--text-muted)] shadow-[var(--card-shadow)]">
            <User style={{ width: tamanho * 0.5, height: tamanho * 0.5 }} />
        </div>
    )
}
