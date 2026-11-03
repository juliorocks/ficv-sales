import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../utils/withTimeout'

type IaStatus = { falhando: boolean; falhas?: number; ultima?: string; sem_credito?: boolean; erro?: string }

export function IaStatusAlert() {
    const { data } = useQuery<IaStatus>({
        queryKey: ['ia-status'],
        queryFn: async () => {
            const { data, error } = await withTimeout(supabase.rpc('ia_status'), 10000, 'Status da IA')
            if (error) throw error
            return data as IaStatus
        },
        refetchInterval: 60_000,
        staleTime: 30_000,
    })
    if (!data?.falhando) return null
    const hora = data.ultima ? new Date(data.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
    return (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-[var(--text-main)]">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
            <div>
                <p className="font-bold">A IA (OpenAI) está falhando{hora ? ` — último erro às ${hora}` : ''}</p>
                <p className="text-[var(--text-muted)]">
                    {data.sem_credito
                        ? 'A conta da OpenAI está sem crédito. '
                        : 'A OpenAI recusou as chamadas. '}
                    Vivi, Tutor, busca da Base de Conhecimento e triagem do Hub podem não responder. Contatos de Igreja, Escola e Fundação podem cair como lead da Faculdade: use "Transferir" na conversa para encaminhar à fila certa.
                    {' '}Confira em platform.openai.com/settings/organization/billing (a chave usada é a de Gestão &gt; Integrações).
                </p>
            </div>
        </div>
    )
}
