import { useState, useEffect } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const abbreviateTime = (timeString: string): string => {
    const parts = timeString.replace('cerca de ', '').split(' ');
    if (parts.length < 2) return timeString;

    const value = parts.find(p => !isNaN(parseInt(p))) || '1';
    const unit = parts[parts.length - 1];

    if (unit.startsWith('segundo')) return `${value}s`;
    if (unit.startsWith('minuto')) return `${value}m`;
    if (unit.startsWith('hora')) return `${value}h`;
    if (unit.startsWith('dia')) return `${value}d`;
    if (unit.startsWith('mês') || unit.startsWith('mese')) return `${value}M`;
    if (unit.startsWith('ano')) return `${value}a`;

    return timeString; // Fallback
};

export function useTimeInStage(stageEntryDate?: string | null) {
    const [timeInStage, setTimeInStage] = useState('');

    useEffect(() => {
        if (!stageEntryDate) {
            setTimeInStage('');
            return;
        }

        const calculateTime = () => {
            try {
                const date = new Date(stageEntryDate);
                const timeString = formatDistanceToNowStrict(date, { locale: ptBR, addSuffix: false });
                setTimeInStage(abbreviateTime(timeString));
            } catch (error) {
                console.error("Invalid date for time in stage:", stageEntryDate);
                setTimeInStage('Data inválida');
            }
        };

        calculateTime();
        const interval = setInterval(calculateTime, 60000); // Atualiza a cada minuto

        return () => clearInterval(interval);
    }, [stageEntryDate]);

    return timeInStage;
}
