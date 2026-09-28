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
}

export function Combobox({
    value, onValueChange, groups, placeholder = "Selecionar…",
    searchPlaceholder = "Buscar…", emptyText = "Nada encontrado.", className, title,
}: ComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const selected = groups.flatMap((g) => g.options).find((o) => o.value === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={title}
                    className={cn(
                        "flex h-8 items-center justify-between gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-main)] px-2.5 text-xs text-[var(--text-main)] hover:border-[var(--primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40",
                        className,
                    )}
                >
                    <span className={cn("truncate", !selected && "text-[var(--text-muted)]")}>
                        {selected?.label ?? placeholder}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0 bg-[var(--bg-card)] border-[var(--border)]" align="start">
                <Command className="bg-transparent">
                    <CommandInput placeholder={searchPlaceholder} className="h-9 text-xs" />
                    <CommandList>
                        <CommandEmpty className="py-4 text-center text-xs text-[var(--text-muted)]">{emptyText}</CommandEmpty>
                        {groups.map((g, i) => (
                            <CommandGroup key={g.heading ?? i} heading={g.heading} className="[&_[cmdk-group-heading]]:text-[var(--text-muted)]">
                                {g.options.map((o) => (
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
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
