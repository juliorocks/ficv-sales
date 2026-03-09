import { cn } from "@/lib/utils"

interface LeadTemperatureProps {
    temperatura?: 'frio' | 'morno' | 'quente' | null
}

export function LeadTemperature({ temperatura }: LeadTemperatureProps) {
    const baseBarClass = "h-1.5 w-5 rounded-full"
    const inactiveClass = "bg-gray-200 dark:bg-gray-700"

    return (
        <div className="flex items-center gap-1" title={`Temperatura: ${temperatura || 'Não definida'}`}>
            <div
                className={cn(
                    baseBarClass,
                    temperatura ? "bg-blue-400" : inactiveClass
                )}
            />
            <div
                className={cn(
                    baseBarClass,
                    temperatura === 'morno' || temperatura === 'quente'
                        ? "bg-orange-400"
                        : inactiveClass
                )}
            />
            <div
                className={cn(
                    baseBarClass,
                    temperatura === 'quente' ? "bg-red-600" : inactiveClass
                )}
            />
        </div>
    )
}
