import { Button } from "@/components/ui/button"
import { ArrowDown, ArrowUp, Check, ListFilter } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

type SortOption = {
    key: string
    label: string
    direction: 'asc' | 'desc'
}

// Rótulos do filtro de prioridade variam por coluna — ver comentário em
// KanbanColumn.tsx sobre por que "sem atendente" só faz sentido na Entrada.
const PRIORITY_LABELS = {
    unattended: { first: 'Não atendidos primeiro', only: 'Somente não atendidos', title: 'Filtro: só não atendidos' },
    waitingReply: { first: 'Esperando Resposta primeiro', only: 'Somente Esperando Resposta', title: 'Filtro: só esperando resposta' },
} as const;

export function KanbanSort({
    sortBy,
    onSortChange,
    mode,
    priorityOnly,
    onPriorityOnlyChange,
    priorityFirst,
    onPriorityFirstChange,
}: {
    sortBy: SortOption
    onSortChange: (option: SortOption) => void
    mode: keyof typeof PRIORITY_LABELS
    priorityOnly: boolean
    onPriorityOnlyChange: (value: boolean) => void
    priorityFirst: boolean
    onPriorityFirstChange: (value: boolean) => void
}) {
    const labels = PRIORITY_LABELS[mode];
    const options: Omit<SortOption, 'direction'>[] = [
        { key: 'updated_at', label: 'Última Atividade' },
        { key: 'stage_entry_date', label: 'Data no Estágio' },
        { key: 'data_entrada', label: 'Data de Entrada' },
        { key: 'nome_completo', label: 'Nome' },
        { key: 'valor_oportunidade', label: 'Valor' },
        { key: 'temperatura', label: 'Temperatura' },
    ]

    const handleSelect = (key: string, label: string) => {
        if (sortBy.key === key) {
            onSortChange({ key, label, direction: sortBy.direction === 'asc' ? 'desc' : 'asc' });
        } else {
            const defaultDirection = key === 'nome_completo' ? 'asc' : 'desc';
            onSortChange({ key, label, direction: defaultDirection });
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant={priorityOnly ? "default" : "outline"}
                    size="icon"
                    className="flex-shrink-0"
                    title={priorityOnly ? labels.title : undefined}
                >
                    <ListFilter className="h-4 w-4" />
                    <span className="sr-only">Ordenar e filtrar</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {options.map((option) => (
                    <DropdownMenuItem
                        key={option.key}
                        onClick={() => handleSelect(option.key, option.label)}
                        className="flex justify-between items-center cursor-pointer"
                    >
                        <span>{option.label}</span>
                        {sortBy.key === option.key && (
                            sortBy.direction === 'asc' ? (
                                <ArrowUp className="ml-2 h-4 w-4 text-muted-foreground" />
                            ) : (
                                <ArrowDown className="ml-2 h-4 w-4 text-muted-foreground" />
                            )
                        )}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Filtrar</DropdownMenuLabel>
                {/* DropdownMenuItem comum + onClick, não DropdownMenuCheckboxItem — o
                    mecanismo checked/onCheckedChange do Radix não estava reagindo ao
                    clique de forma confiável junto com onSelect preventDefault (usado
                    pra manter o menu aberto ao marcar/desmarcar). onClick é o mesmo
                    padrão já usado nos outros itens deste menu (Editar/Excluir), que
                    funcionam. */}
                <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => onPriorityFirstChange(!priorityFirst)}
                    className="flex justify-between items-center cursor-pointer"
                >
                    <span>{labels.first}</span>
                    {priorityFirst && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => onPriorityOnlyChange(!priorityOnly)}
                    className="flex justify-between items-center cursor-pointer"
                >
                    <span>{labels.only}</span>
                    {priorityOnly && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
