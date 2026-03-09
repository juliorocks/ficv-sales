import { useSupabaseSearch } from "@/hooks/use-supabase-search"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"

export function CourseSearch({
    value,
    onChange
}: {
    value?: number
    onChange: (value?: number) => void
}) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")
    const { data: courses, setSearchTerm } = useSupabaseSearch("courses", ["name"], search)

    useEffect(() => {
        setSearchTerm(search)
    }, [search, setSearchTerm])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                    type="button"
                >
                    {value
                        ? courses?.find((course: any) => course.id === value)?.name || "Curso selecionado"
                        : "Selecione um curso..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Buscar curso..."
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList>
                        <CommandEmpty>Nenhum curso encontrado.</CommandEmpty>
                        <CommandGroup>
                            {courses?.map((course: any) => (
                                <CommandItem
                                    key={course.id}
                                    value={course.id.toString()}
                                    onSelect={() => {
                                        onChange(course.id === value ? undefined : course.id)
                                        setOpen(false)
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === course.id ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    {course.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
