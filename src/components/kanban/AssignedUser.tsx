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

    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger>
                    <Avatar className="h-6 w-6">
                        <AvatarImage src={user.avatar_url || undefined} alt={user.full_name} />
                        <AvatarFallback>{user.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Responsável: {user.full_name}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
