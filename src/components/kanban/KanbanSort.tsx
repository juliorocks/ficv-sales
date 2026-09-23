import { Button } from "@/components/ui/button"
import { ArrowDown, ArrowUp, ListFilter } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
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
}: {
    sortBy: SortOption
    onSortChange: (option: SortOption) => void
    unattendedOnly: boolean
    onUnattendedOnlyChange: (value: boolean) => void
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
                <Button variant={unattendedOnly ? "default" : "outline"} size="icon" className="flex-shrink-0" title={unattendedOnly ? "Filtro: só não atendidos" : undefined}>
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
                <DropdownMenuCheckboxItem
                    checked={unattendedOnly}
                    onCheckedChange={onUnattendedOnlyChange}
                    onSelect={(e) => e.preventDefault()}
                >
                    Somente não atendidos
                </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
