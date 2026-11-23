import { useState } from "react"
import { InadimplenciaDashboard } from "../InadimplenciaDashboard"
import { ReguaCobrancaPanel } from "./ReguaCobrancaPanel"

const ABAS = [["painel", "Painel"], ["regua", "Régua de cobrança"]] as const

export function InadimplenciaTabs() {
    const [aba, setAba] = useState<(typeof ABAS)[number][0]>("painel")
    return (
        <div className="space-y-4">
            <div className="flex gap-2 border-b border-[var(--border)]">
                {ABAS.map(([k, nome]) => (
                    <button key={k} type="button" onClick={() => setAba(k)}
                        className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === k ? "border-primary text-primary" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>
                        {nome}
                    </button>
                ))}
            </div>
            {aba === "painel" ? <InadimplenciaDashboard /> : <ReguaCobrancaPanel />}
        </div>
    )
}
