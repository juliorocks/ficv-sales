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
    unattendedOnly,
    onUnattendedOnlyChange,
    unattendedFirst,
    onUnattendedFirstChange,
}: {
    sortBy: SortOption
    onSortChange: (option: SortOption) => void
    unattendedOnly: boolean
    onUnattendedOnlyChange: (value: boolean) => void
    unattendedFirst: boolean
    onUnattendedFirstChange: (value: boolean) => void
}) {
    const options: Omit<SortOption, 'direction'>[] = [
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
                    variant={unattendedOnly ? "default" : "outline"}
                    size="icon"
                    className="flex-shrink-0"
                    title={unattendedOnly ? "Filtro: só não atendidos" : undefined}
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
                    onClick={() => onUnattendedFirstChange(!unattendedFirst)}
                    className="flex justify-between items-center cursor-pointer"
                >
                    <span>Não atendidos primeiro</span>
                    {unattendedFirst && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => onUnattendedOnlyChange(!unattendedOnly)}
                    className="flex justify-between items-center cursor-pointer"
                >
                    <span>Somente não atendidos</span>
                    {unattendedOnly && <Check className="ml-2 h-4 w-4" />}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
