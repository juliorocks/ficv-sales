import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronDown } from 'lucide-react';

export interface Team {
    id: string;
    name: string;
    icon: string;
    color: string;
}

interface TeamFilterProps {
    selectedTeamId: string | null;
    onTeamChange: (teamId: string | null) => void;
    label?: string;
}

export const TeamFilter: React.FC<TeamFilterProps> = ({
    selectedTeamId,
    onTeamChange,
    label = 'Equipe'
}) => {
    const [teams, setTeams] = useState<Team[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTeams = async () => {
            setLoading(true);
            const { data } = await supabase
                .from('teams')
                .select('id, name, icon, color')
                .eq('active', true)
                .order('name');
            setTeams(data ?? []);
            setLoading(false);
        };
        fetchTeams();
    }, []);

    const selectedTeam = teams.find(t => t.id === selectedTeamId);

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] hover:border-primary/50 transition-all"
            >
                {selectedTeam ? (
                    <>
                        <span>{selectedTeam.icon}</span>
                        <span className="font-medium">{selectedTeam.name}</span>
                    </>
                ) : (
                    <>
                        <span>👥</span>
                        <span className="font-medium">{label}</span>
                    </>
                )}
                <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
                    <button
                        onClick={() => {
                            onTeamChange(null);
                            setIsOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                            selectedTeamId === null
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]'
                        }`}
                    >
                        👥 Todas as equipes
                    </button>

                    <div className="border-t border-[var(--border)]" />

                    {teams.map(team => (
                        <button
                            key={team.id}
                            onClick={() => {
                                onTeamChange(team.id);
                                setIsOpen(false);
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center gap-2 ${
                                selectedTeamId === team.id
                                    ? 'bg-primary/10 text-primary font-medium'
                                    : 'text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]'
                            }`}
                        >
                            <span>{team.icon}</span>
                            <span>{team.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// Hook para usar filtro de equipe
export const useTeamFilter = () => {
    const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);

    return {
        selectedTeamId,
        setSelectedTeamId,
    };
};
