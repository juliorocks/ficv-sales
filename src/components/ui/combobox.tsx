import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";

// Select com campo de busca (Popover + cmdk), pra listas que podem crescer muito
// (ex.: agentes). API parecida com o Select do Radix, mas com grupos + filtro.
export interface ComboboxOption {
    value: string;
    label: string;
}

export interface ComboboxGroup {
    heading?: string;
    options: ComboboxOption[];
}

interface ComboboxProps {
    value: string;
    onValueChange: (value: string) => void;
    groups: ComboboxGroup[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    className?: string;
    title?: string;
    /** deixa usar um valor que não está em nenhum grupo (ex.: a lista veio de uma API
     * externa e pode não cobrir tudo) — aparece como uma opção extra "Usar '<texto>'"
     * quando o que foi digitado não bate com nenhuma opção existente. */
    allowCustomValue?: boolean;
}

export function Combobox({
    value, onValueChange, groups, placeholder = "Selecionar…",
    searchPlaceholder = "Buscar…", emptyText = "Nada encontrado.", className, title,
    allowCustomValue = false,
}: ComboboxProps) {
    const [open, setOpen] = React.useState(false);
    // busca CONTROLADA (não deixada pro cmdk sozinho): reseta pra vazia toda vez que o
    // popover abre, pra sempre mostrar a lista INTEIRA de novo — sem isso (ex.: um
    // <datalist> nativo, ou o cmdk com o valor atual pré-preenchido) reabrir já filtrava
    // só pelo texto que já estava selecionado, escondendo quase tudo (achado ao vivo 29/09).
    const [search, setSearch] = React.useState("");
    const allOptions = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
    const selected = allOptions.find((o) => o.value === value);
    const normalizedSearch = search.trim();
    const hasExactMatch = allOptions.some((o) => o.value.toLowerCase() === normalizedSearch.toLowerCase());

    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setSearch(""); }}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={title}
                    className={cn(
                        "flex h-8 items-center justify-between gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-main)] px-2.5 text-xs text-[var(--text-main)] hover:border-[var(--primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40",
                        className,
                    )}
                >
                    <span className={cn("truncate", !selected && !value && "text-[var(--text-muted)]")}>
                        {selected?.label ?? value ?? placeholder}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0 bg-[var(--bg-card)] border-[var(--border)]" align="start">
                <Command className="bg-transparent" shouldFilter={!allowCustomValue}>
                    <CommandInput placeholder={searchPlaceholder} className="h-9 text-xs" value={search} onValueChange={setSearch} />
                    <CommandList>
                        <CommandEmpty className="py-4 text-center text-xs text-[var(--text-muted)]">{emptyText}</CommandEmpty>
                        {allowCustomValue && normalizedSearch && !hasExactMatch && (
                            <CommandGroup>
                                <CommandItem
                                    value={`__custom__${normalizedSearch}`}
                                    onSelect={() => { onValueChange(normalizedSearch); setOpen(false); }}
                                    className="cursor-pointer text-xs italic text-[var(--text-main)] data-[selected=true]:bg-[var(--bg-card-hover)]"
                                >
                                    Usar "{normalizedSearch}"
                                </CommandItem>
                            </CommandGroup>
                        )}
                        {groups.map((g, i) => {
                            // allowCustomValue desliga o filtro embutido do cmdk (shouldFilter=false,
                            // porque o item extra acima não pode ser filtrado por ele) — filtra na mão.
                            const opts = allowCustomValue && normalizedSearch
                                ? g.options.filter((o) => o.label.toLowerCase().includes(normalizedSearch.toLowerCase()))
                                : g.options;
                            if (!opts.length) return null;
                            return (
                                <CommandGroup key={g.heading ?? i} heading={g.heading} className="[&_[cmdk-group-heading]]:text-[var(--text-muted)]">
                                    {opts.map((o) => (
                                        <CommandItem
                                            key={o.value}
                                            value={o.label}
                                            onSelect={() => { onValueChange(o.value); setOpen(false); }}
                                            className="cursor-pointer text-xs text-[var(--text-main)] data-[selected=true]:bg-[var(--bg-card-hover)]"
                                        >
                                            <Check className={cn("mr-2 h-3.5 w-3.5", value === o.value ? "opacity-100" : "opacity-0")} />
                                            {o.label}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            );
                        })}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
