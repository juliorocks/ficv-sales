import React from 'react';
import { Award, TrendingUp, Target, MessageSquare } from 'lucide-react';
import { ConversationAnalysis } from '../utils/csvProcessor';

interface AgentProfileProps {
    name: string;
    data: ConversationAnalysis[];
}

export const AgentProfile: React.FC<AgentProfileProps> = ({ name, data }) => {
    const agentData = data.filter(d => d.agent === name);
    const avgScore = agentData.length > 0
        ? (agentData.reduce((sum, d) => sum + d.finalScore, 0) / agentData.length).toFixed(1)
        : '0.0';

    const closingAttempts = agentData.filter(d => d.closingAttempt).length;

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex items-center gap-6 glass-card p-8">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-3xl font-bold shadow-lg shadow-primary/20">
                    {name.charAt(0)}
                </div>
                <div>
                    <h2 className="text-4xl font-bold font-display text-[var(--text-main)]">{name}</h2>
                    <div className="flex gap-4 mt-2">
                        <span className="bg-success/20 text-success text-xs font-bold px-3 py-1 rounded-full border border-success/10 uppercase tracking-wider">
                            Score: {avgScore}
                        </span>
                        <span className="bg-primary/20 text-primary text-xs font-bold px-3 py-1 rounded-full border border-primary/10 uppercase tracking-wider">
                            {agentData.length} Atendimentos
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-card p-6">
                    <div className="flex items-center gap-3 mb-4 text-[var(--text-muted)]">
                        <Target size={20} />
                        <span className="text-sm font-medium">Tentativas de Fechamento</span>
                    </div>
                    <p className="text-3xl font-bold font-display text-[var(--text-main)]">{closingAttempts}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">Taxa: {agentData.length > 0 ? ((closingAttempts / agentData.length) * 100).toFixed(1) : 0}%</p>
                </div>

                <div className="glass-card p-6">
                    <div className="flex items-center gap-3 mb-4 text-[var(--text-muted)]">
                        <TrendingUp size={20} />
                        <span className="text-sm font-medium">Evolução de Qualidade</span>
                    </div>
                    <p className="text-3xl font-bold font-display text-[var(--text-main)]">{avgScore}</p>
                    <p className="text-xs text-success mt-1">+0.2 vs semana anterior</p>
                </div>

                <div className="glass-card p-6">
                    <div className="flex items-center gap-3 mb-4 text-[var(--text-muted)]">
                        <Award size={20} />
                        <span className="text-sm font-medium">Badges Conquistadas</span>
                    </div>
                    <div className="flex gap-2">
                        <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center text-warning" title="Mestre da Conversão">
                            <Award size={16} />
                        </div>
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary" title="Comunicação de Ouro">
                            <MessageSquare size={16} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="glass-card p-8">
                <h3 className="text-xl font-bold mb-6 text-[var(--text-main)]">Sugestões de Script (Feedback Automático)</h3>
                <div className="space-y-4">
                    <div className="p-4 bg-[var(--bg-card-hover)] rounded-xl border border-[var(--border)]">
                        <p className="text-sm text-[var(--text-muted)] mb-1">Ponto de Melhoria: Direcionamento</p>
                        <p className="font-medium text-[var(--text-main)]">"Tente usar perguntas mais fechadas no final da conversa para induzir a matrícula."</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-card-hover)] rounded-xl border border-[var(--border)]">
                        <p className="text-sm text-[var(--text-muted)] mb-1">Sugestão de Script</p>
                        <p className="font-medium text-[var(--text-main)]">"Você prefere que eu envie o link da matrícula agora ou deseja mais informações?"</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
