// Gestão > VivaConnect > Quem atende cada canal — restringe QUAIS canais (números)
// cada agente pode ver/enviar no Kanban. Sem nenhum canal marcado pra um agente = sem
// restrição (vê/manda em qualquer canal, comportamento de hoje); marcando o 1º canal,
// ele passa a só ver leads desses canais (leads sem canal do VivaConnect, de outra
// origem, continuam aparecendo pra todo mundo — essa tela não mexe neles). Admin
// sempre vê tudo, mesmo com canais marcados aqui (não faz sentido restringir quem já
// vê o funil inteiro pelas outras telas de Gestão).
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Users } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { showError } from "@/utils/toast"

type Ch = { id: number; name: string; purpose: string; phone: string | null }
type Agent = { id: string; full_name: string; role: string }

export function VivaConnectAgentChannels({ channels }: { channels: Ch[] }) {
    const qc = useQueryClient()
    const [busy, setBusy] = useState<string | null>(null)

    const { data: agents } = useQuery({
        queryKey: ["vivaconnect_agents_list"],
        queryFn: async () => {
            const { data, error } = await supabase.from("profiles").select("id, full_name, role").in("role", ["admin", "agent"]).order("full_name")
            if (error) throw error
            return (data ?? []).filter((a) => a.full_name) as Agent[]
        },
    })

    const { data: grants, refetch } = useQuery({
        queryKey: ["vivaconnect_agent_channels"],
        queryFn: async () => {
            const { data, error } = await supabase.from("vivaconnect_agent_channels").select("profile_id, channel_id")
            if (error) throw error
            return (data ?? []) as { profile_id: string; channel_id: number }[]
        },
    })

    const cols = channels.filter((c) => c.purpose !== "grupo")
    const has = (profileId: string, channelId: number) => !!grants?.some((g) => g.profile_id === profileId && g.channel_id === channelId)
    const restricted = (profileId: string) => !!grants?.some((g) => g.profile_id === profileId)

    const toggle = async (profileId: string, channelId: number, on: boolean) => {
        const key = `${profileId}-${channelId}`
        setBusy(key)
        const { error } = on
            ? await supabase.from("vivaconnect_agent_channels").insert({ profile_id: profileId, channel_id: channelId })
            : await supabase.from("vivaconnect_agent_channels").delete().eq("profile_id", profileId).eq("channel_id", channelId)
        setBusy(null)
        if (error) return showError(`Não foi possível atualizar: ${error.message}`)
        qc.invalidateQueries({ queryKey: ["vivaconnect_agent_channels"] })
        refetch()
    }

    if (!cols.length) return null

    return (
        <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
            <CardHeader>
                <CardTitle className="text-xl font-bold flex items-center gap-2"><Users size={20} className="text-primary" /> Quem atende cada canal</CardTitle>
                <CardDescription className="text-sm">
                    Marque os canais de cada agente. <b>Sem nenhum marcado</b>, o agente continua vendo/enviando em qualquer canal — a restrição só passa a valer a partir do 1º canal marcado.
                    Leads que não vieram de um número do VivaConnect não são afetados. Admin sempre vê tudo.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-sm border-separate border-spacing-y-1">
                        <thead>
                            <tr>
                                <th className="text-left text-xs font-bold uppercase tracking-widest text-muted-foreground pb-2 pr-4">Agente</th>
                                {cols.map((c) => (
                                    <th key={c.id} className="text-center text-xs font-bold text-muted-foreground pb-2 px-3 whitespace-nowrap">
                                        {c.name}<br /><span className="font-normal font-mono text-[10px]">{c.phone ?? "sem número"}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(agents ?? []).map((a) => (
                                <tr key={a.id} className="rounded-xl">
                                    <td className="pr-4 py-1">
                                        <span className="font-medium text-[var(--text-main)]">{a.full_name}</span>
                                        {a.role === "admin" && <span className="ml-1.5 text-[10px] text-muted-foreground">(admin — sempre vê tudo)</span>}
                                        {a.role !== "admin" && !restricted(a.id) && <span className="ml-1.5 text-[10px] text-muted-foreground">(sem restrição)</span>}
                                    </td>
                                    {cols.map((c) => {
                                        const key = `${a.id}-${c.id}`
                                        return (
                                            <td key={c.id} className="text-center py-1">
                                                {busy === key
                                                    ? <Loader2 className="animate-spin mx-auto" size={14} />
                                                    : <input type="checkbox" checked={has(a.id, c.id)} disabled={a.role === "admin"}
                                                        onChange={(e) => toggle(a.id, c.id, e.target.checked)}
                                                        className="w-4 h-4 accent-[var(--primary)] disabled:opacity-30" />}
                                            </td>
                                        )
                                    })}
                                </tr>
                            ))}
                            {!agents?.length && (
                                <tr><td colSpan={cols.length + 1} className="text-sm text-muted-foreground py-3">Nenhum agente cadastrado.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    )
}
