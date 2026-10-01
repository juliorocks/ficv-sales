// Auditoria de qualidade de atendimento — chama a Edge Function
// analyze-conversation (OpenAI, chave no Vault via Gestão > Integrações).
// Antes chamava o Gemini direto do navegador (chave nunca configurada, sempre
// caía no fallback heurístico de csvProcessor.ts); agora roda no backend, sem
// expor a chave paga no bundle.
import { supabase } from '../lib/supabase';

export interface AIMessageFeedback {
    index: number;
    score: 'excelente' | 'bom' | 'melhorar';
    feedback: string;
    suggestion?: string;
}

export interface AIConversationAnalysis {
    messagesFeedback: AIMessageFeedback[];
    globalScores: {
        empathy: number;
        clarity: number;
        depth: number;
        commercial: number;
        agility: number;
    };
    isCommercial: boolean;
    shouldInvalidate: boolean;
    invalidateReason?: string;
    overallConclusion: string;
    improvements: string[];
}

export async function analyzeConversationWithAI(messages: { role: string, text: string }[]): Promise<AIConversationAnalysis | null> {
    try {
        const { data, error } = await supabase.functions.invoke('analyze-conversation', { body: { messages } });
        if (error) {
            console.error('[AI Specialist] analyze-conversation falhou, usando heurísticas locais:', error.message);
            return null;
        }
        if (!data?.result) {
            console.error('[AI Specialist] resposta inesperada da Edge Function:', data);
            return null;
        }
        return data.result as AIConversationAnalysis;
    } catch (error) {
        console.error('Erro na análise da IA:', error);
        return null;
    }
}
