import { motion } from "framer-motion"
import { Database, Radio, Search, Users, Activity } from "lucide-react"

export function KanbanSkeleton() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[65vh] w-full rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--bg-card)]/30 backdrop-blur-sm relative overflow-hidden">
            {/* Background glowing gradients */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

            {/* Animation Container */}
            <div className="relative flex items-center justify-center mb-12 mt-10">
                {/* Ping rings */}
                <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: '2.5s' }} />
                <div className="absolute -inset-4 rounded-full border border-primary/20 animate-pulse" style={{ animationDuration: '2s' }} />
                <div className="absolute -inset-12 rounded-full border border-dashed border-[var(--border)] opacity-50" />
                <div className="absolute -inset-20 rounded-full border border-dashed border-[var(--border)] opacity-30" />

                {/* Center Core */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
                    className="relative z-10 p-5 rounded-full bg-[var(--bg-card)] border cursor-wait border-primary/40 shadow-[0_0_30px_rgba(85,81,255,0.3)]"
                >
                    <Database className="w-8 h-8 text-primary" />
                </motion.div>

                {/* Inner Orbit (Users) */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
                    className="absolute w-[140px] h-[140px] rounded-full"
                >
                    <motion.div
                        animate={{ rotate: -360 }}
                        transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
                        className="absolute -top-3 left-1/2 -translate-x-1/2 p-2 bg-[var(--bg-card)] rounded-full border border-success/30 shadow-sm text-success-text"
                    >
                        <Users className="w-4 h-4" />
                    </motion.div>
                </motion.div>

                {/* Middle Orbit (Search/Filters) */}
                <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
                    className="absolute w-[200px] h-[200px] rounded-full"
                >
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
                        className="absolute top-1/2 -right-3 -translate-y-1/2 p-2 bg-[var(--bg-card)] rounded-full border border-warning/30 shadow-sm text-warning"
                    >
                        <Search className="w-4 h-4" />
                    </motion.div>
                </motion.div>

                {/* Outer Orbit (Activity/Webhook) */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
                    className="absolute w-[280px] h-[280px] rounded-full"
                >
                    <motion.div
                        animate={{ rotate: -360 }}
                        transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
                        className="absolute bottom-4 left-4 p-2 bg-[var(--bg-card)] rounded-full border border-purple-500/30 shadow-sm text-purple-500"
                    >
                        <Activity className="w-4 h-4" />
                    </motion.div>
                </motion.div>
            </div>

            {/* Text Loading State */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-center space-y-3 z-10"
            >
                <h3 className="text-2xl font-black bg-gradient-to-r from-primary via-[#8B8BFF] to-primary bg-[length:200%_auto] bg-clip-text text-transparent animate-[pulse_3s_ease-in-out_infinite]">
                    Sincronizando Funil
                </h3>
                <div className="flex items-center justify-center gap-2 text-sm font-semibold text-[var(--text-muted)] bg-[var(--bg-card-hover)] px-4 py-2 rounded-full border border-[var(--border)] shadow-sm">
                    <Radio className="w-4 h-4 animate-pulse text-primary" />
                    <span className="animate-pulse">Buscando leads e atualizando quadros do banco de dados...</span>
                </div>
            </motion.div>

            {/* Faded background columns to give context of what is loading */}
            <div className="absolute bottom-0 left-0 w-full flex justify-center gap-6 px-8 opacity-[0.15] translate-y-24 pointer-events-none" style={{ maskImage: 'linear-gradient(to top, transparent, black 80%)', WebkitMaskImage: 'linear-gradient(to top, transparent, black 80%)' }}>
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-[300px] h-[300px] rounded-t-2xl border-t border-l border-r border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4">
                        <div className="h-6 w-32 bg-[var(--border)] rounded-md"></div>
                        <div className="h-28 w-full bg-[var(--border)] rounded-xl"></div>
                        <div className="h-28 w-full bg-[var(--border)] rounded-xl"></div>
                    </div>
                ))}
            </div>
        </div>
    )
}
