/**
 * SecretariaBoard — quadro de chamados que aparece no Funil de Leads quando o
 * Departamento "Secretaria" está selecionado: a Secretaria atende por chamados
 * (Portal do Aluno), não pelo funil de vendas. Mesmo TicketKanban da área de Tickets.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Ticket } from '../../types/database'
import { TicketKanban } from './TicketKanban'
import { TicketDetail } from './TicketDetail'

export function SecretariaBoard() {
  const [selected, setSelected] = useState<Ticket | null>(null)
  const { data: tickets = [] } = useQuery<Ticket[]>({
    queryKey: ['tickets', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tickets')
        .select('*, atendente:profiles!tickets_atendente_id_fkey(full_name), curso:courses(name, type)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    refetchInterval: 30000,
  })
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--text-muted)]">A Secretaria atende por <b>chamados</b> do Portal do Aluno — arraste pra mudar o status.</p>
      <TicketKanban tickets={tickets} onOpen={setSelected} />
      {selected && <TicketDetail ticket={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
