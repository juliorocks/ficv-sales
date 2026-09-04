import { User } from "@/types/database"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface AssignedUserProps {
    userId?: string | null
    users: User[]
}

export function AssignedUser({ userId, users }: AssignedUserProps) {
    if (!userId) {
        return null
    }

    const user = users.find(u => u.id === userId)

    if (!user) {
        return null
    }

    const nome = user.full_name || 'Sem nome'

    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger>
                    <Avatar className="h-6 w-6">
                        <AvatarImage src={user.avatar_url || undefined} alt={nome} />
                        <AvatarFallback>{nome.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Responsável: {nome}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
