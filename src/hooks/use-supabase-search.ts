import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useDebounce } from "./use-debounce"
import { useState } from "react"

export function useSupabaseSearch(
    table: string,
    columns: string[],
    initialSearch = ""
) {
    const [searchTerm, setSearchTerm] = useState(initialSearch)
    const debouncedSearchTerm = useDebounce(searchTerm, 300)

    const query = useQuery({
        queryKey: [table, "search", debouncedSearchTerm],
        queryFn: async () => {
            if (!debouncedSearchTerm) return []

            let queryBuilder = supabase.from(table).select("*")

            // Se houver múltiplas colunas, usamos .or() com ilike
            if (columns.length > 1) {
                const orFilter = columns.map(col => `${col}.ilike.%${debouncedSearchTerm}%`).join(',')
                queryBuilder = queryBuilder.or(orFilter)
            } else if (columns.length === 1) {
                queryBuilder = queryBuilder.ilike(columns[0], `%${debouncedSearchTerm}%`)
            }

            const { data, error } = await queryBuilder

            if (error) throw error
            return data || []
        },
        enabled: !!debouncedSearchTerm
    })

    return {
        searchTerm,
        setSearchTerm,
        ...query
    }
}
