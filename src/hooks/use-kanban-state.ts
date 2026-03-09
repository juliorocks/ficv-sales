import { useState } from "react"

export function useKanbanState() {
    const [searchParams, setSearchParams] = useState({
        name: '',
        email: '',
        stageId: undefined as number | undefined,
        courseId: undefined as number | undefined
    })

    const [sortBy, setSortBy] = useState({
        key: 'data_entrada',
        label: 'Data de Entrada',
        direction: 'desc' as 'asc' | 'desc'
    })

    const [currentPage, setCurrentPage] = useState(1)

    return {
        searchParams,
        setSearchParams,
        sortBy,
        setSortBy,
        currentPage,
        setCurrentPage,
        resetPagination: () => setCurrentPage(1)
    }
}
