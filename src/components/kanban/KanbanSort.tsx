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

export function KanbanSort({
    sortBy,
    onSortChange,
    waitingReplyOnly,
    onWaitingReplyOnlyChange,
    waitingReplyFirst,
    onWaitingReplyFirstChange,
}: {
    sortBy: SortOption
    onSortChange: (option: SortOption) => void
    waitingReplyOnly: boolean
    onWaitingReplyOnlyChange: (value: boolean) => void
    waitingReplyFirst: boolean
    onWaitingReplyFirstChange: (value: boolean) => void
}) {
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
                    variant={waitingReplyOnly ? "default" : "outline"}
                    size="icon"
                    className="flex-shrink-0"
                    title={waitingReplyOnly ? "Filtro: só esperando resposta" : undefined}
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
                    onClick={() => onWaitingReplyFirstChange(!waitingReplyFirst)}
                    className="flex justify-between items-center cursor-pointer"
                >
                    <span>Esperando Resposta primeiro</span>
                    {waitingReplyFirst && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => onWaitingReplyOnlyChange(!waitingReplyOnly)}
                    className="flex justify-between items-center cursor-pointer"
                >
                    <span>Somente Esperando Resposta</span>
                    {waitingReplyOnly && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
