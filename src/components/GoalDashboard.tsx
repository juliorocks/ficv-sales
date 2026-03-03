import React from 'react';
import { motion } from 'framer-motion';

interface Goal {
    label: string;
    target: number;
    current: number;
    color: string;
}

const goals: Goal[] = [
    { label: 'Matrículas Mensais', target: 200, current: 142, color: 'var(--primary)' },
    { label: 'Atendimentos Qualificados', target: 1000, current: 850, color: 'var(--text-muted)' },
    { label: 'Taxa de Conversão meta', target: 15, current: 11.2, color: '#238636' },
];

export const GoalDashboard: React.FC = () => {
    return (
        <div className="space-y-6">
            {goals.map((goal, idx) => {
                const percent = Math.min(100, (goal.current / goal.target) * 100);
                return (
                    <div key={idx} className="space-y-2">
                        <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider">
                            <span className="text-[var(--text-muted)]">{goal.label}</span>
                            <span className="text-[var(--text-main)]">{goal.current} / {goal.target} {goal.label.includes('Taxa') ? '%' : ''}</span>
                        </div>
                        <div className="h-2 w-full bg-[var(--bg-card-hover)] rounded-full overflow-hidden border border-[var(--border)]">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${percent}%` }}
                                transition={{ duration: 1, delay: idx * 0.2 }}
                                className="h-full rounded-full"
                                style={{
                                    background: goal.color,
                                    boxShadow: goal.color === 'var(--primary)' ? `0 0 10px rgba(85, 81, 255, 0.3)` : 'none'
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
