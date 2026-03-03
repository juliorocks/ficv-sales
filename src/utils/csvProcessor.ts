import Papa from 'papaparse';
import { analyzeConversationWithAI } from '../services/aiSpecialist';

export interface WhatsAppMessage {
    Contato: string;
    Identificador: string;
    Protocolo: string;
    Canal: string;
    'Início do atendimento': string;
    'Data da mensagem': string;
    Origem: string;
    Agente: string;
    Plataforma: string;
    Mensagem: string;
    'ID Mensagem': string;
    'ID Contexto': string;
    'Status do atendimento': string;
}

export interface ConversationAnalysis {
    protocol: string;
    agent: string;
    contact: string;
    empathyScore: number;
    clarityScore: number;
    depthScore: number;
    commercialScore: number;
    agilityScore: number;
    finalScore: number;
    closingAttempt: boolean;
    isCommercial: boolean;
    overallConclusion: string;
    improvements: string[];
    messageCount: number;
    date: string;
    status: 'approved' | 'invalidated';
    transcript: { role: 'agent' | 'client'; text: string; time: string; feedback?: string }[];
}


const EMPATHY_KEYWORDS = ['bom dia', 'boa tarde', 'obrigado', 'obrigada', 'fico feliz', 'posso ajudar'];
const CLOSING_KEYWORDS = [
    'posso enviar o link para matrícula',
    'deseja se inscrever',
    'quer fazer sua matrícula',
    'posso enviar o link de inscrição',
    'enviar o link',
    'fazer a inscrição'
];

const parseBrazilianDate = (dateStr: string): string => {
    if (!dateStr) return new Date().toISOString();

    const [datePart, timePart] = dateStr.split(' ');
    if (!datePart) return new Date().toISOString();

    const [day, month, year] = datePart.split('/');
    if (!day || !month || !year) return dateStr;

    return `${year}-${month}-${day}T${timePart || '00:00:00'}`;
};

export const processCSV = (file: File): Promise<ConversationAnalysis[]> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const data = results.data as WhatsAppMessage[];
                const groups = groupByProtocol(data);

                // Process each protocol asynchronously (with AI Specialist)
                const analysisPromises = Object.entries(groups).map(([protocol, messages]) =>
                    analyzeProtocol(protocol, messages)
                );

                const analysis = await Promise.all(analysisPromises);
                resolve(analysis);
            },
            error: (error) => reject(error),
        });
    });
};

const groupByProtocol = (data: WhatsAppMessage[]) => {
    return data.reduce((acc, msg) => {
        if (!acc[msg.Protocolo]) acc[msg.Protocolo] = [];
        acc[msg.Protocolo].push(msg);
        return acc;
    }, {} as Record<string, WhatsAppMessage[]>);
};

const analyzeProtocol = async (protocol: string, messages: WhatsAppMessage[]): Promise<ConversationAnalysis> => {
    const agentMessages = messages.filter(m => m.Agente && m.Agente !== 'Cliente');
    const agentName = agentMessages[0]?.Agente || 'Desconhecido';

    // Prepare messages for AI analysis Specialist
    const aiMessages = messages.map(m => ({
        role: m.Agente === agentName ? 'agent' : 'client',
        text: m.Mensagem
    }));

    // Trigger AI Deep Analysis
    const aiResult = await analyzeConversationWithAI(aiMessages);

    const getMessageFeedback = (text: string, index: number, isLast: boolean) => {
        // 1. Priority: Use AI Analysis if available
        if (aiResult) {
            const feedback = aiResult.messagesFeedback.find(f => f.index === index);
            if (feedback) return feedback.feedback + (feedback.suggestion ? ` Sugestão: ${feedback.suggestion}` : '');
        }

        const lowerText = text.toLowerCase();

        // 2. Fallback: Refined Smart Heuristics
        const isGreeting = lowerText.length < 25 &&
            (lowerText.includes('bom dia') || lowerText.includes('boa tarde') ||
                lowerText.includes('boa noite') || lowerText.includes('tudo bem') ||
                lowerText.includes('olá'));

        if (isGreeting) {
            return '🤝 Humanização & Rapport: Ótimo início. Lembre-se de primeiro entender o momento do cliente antes de qualquer script.';
        }

        const isLongScript = text.length > 200 || lowerText.includes('http') || lowerText.includes('www');

        if (isLongScript && !lowerText.includes('?')) {
            return '🚩 Script Engessado: Você enviou um bloco grande de informações sem antes entender a dúvida real do cliente. Isso quebra o rapport.';
        }

        const hasClosing = CLOSING_KEYWORDS.some(k => lowerText.includes(k)) ||
            lowerText.includes('matrícula') ||
            lowerText.includes('inscrição');

        if (hasClosing) return '🎯 Direcionamento: Excelente tentativa de conduzir o cliente ao fechamento.';

        if (lowerText.includes('?')) {
            if (lowerText.includes('ajudar') || lowerText.includes('algum curso')) {
                return '⚠️ Pergunta Genérica: Evite perguntas que podem ser respondidas com "não". Tente: "Qual sua maior motivação para estudar hoje?"';
            }
            return '💡 Condução: Boa pergunta de engajamento para manter a conversa ativa.';
        }

        if (isLast && !hasClosing) {
            return '🚩 Fechamento Ausente: O contato está terminando. Sempre faça um convite para o próximo passo.';
        }

        return '✨ Atendimento Humanizado: Linguagem clara. Continue estimulando o desejo do cliente.';
    };

    // Calculate Scores (AI Scores override heuristics)
    // Calculate Scores (AI Scores override heuristics completely)
    const empathyScore = aiResult ? aiResult.globalScores.empathy : Math.max(0, Math.min(10, messages.filter(m => EMPATHY_KEYWORDS.some(k => m.Mensagem.toLowerCase().includes(k))).length * 2 + 5));
    const commercialScore = aiResult ? aiResult.globalScores.commercial : Math.max(0, Math.min(10, messages.filter(m => CLOSING_KEYWORDS.some(k => m.Mensagem.toLowerCase().includes(k))).length * 4 + 2));
    const clarityScore = aiResult ? aiResult.globalScores.clarity : Math.max(0, Math.min(10, messages.filter(m => m.Mensagem.length > 60).length * 2 + 5));
    const depthScore = aiResult ? aiResult.globalScores.depth : Math.max(0, Math.min(10, messages.filter(m => m.Mensagem.includes('?') && m.Agente !== 'Cliente').length * 2 + 3));
    const agilityScore = aiResult ? aiResult.globalScores.agility : (messages.length > 5 ? 9 : 7);

    const scores = [empathyScore, clarityScore, depthScore, commercialScore, agilityScore];

    // Calculate Final Score: Ignore commercial if it's a support/student ticket (isCommercial === false)
    let finalScore: number;
    const isComm = aiResult?.isCommercial ?? true;
    console.log(`[Protocol ${protocol}] Classification: ${isComm ? 'COMMERCIAL' : 'SUPPORT/INFO'}`);

    if (isComm === false) {
        const nonCommercialScores = [empathyScore, clarityScore, depthScore, agilityScore];
        finalScore = Number((nonCommercialScores.reduce((a, b) => a + b, 0) / nonCommercialScores.length).toFixed(1));
    } else {
        finalScore = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
    }

    const improvements = aiResult?.improvements ?? [];
    if (improvements.length === 0) {
        if (empathyScore < 7) improvements.push('Focar mais na conexão e escuta ativa antes da oferta.');
        if (commercialScore < 8) improvements.push('Ser mais assertivo na condução para o fechamento.');
    }

    const contactName = messages.find(m => m.Contato)?.Contato || 'Desconhecido';
    const contactId = messages.find(m => m.Identificador)?.Identificador || '';
    const fullContact = contactId ? `${contactName} (${contactId})` : contactName;

    const transcript = messages.map((m, index) => {
        const isAgent = m.Agente === agentName;
        const isLastAgentMsg = isAgent && !messages.slice(index + 1).some(next => next.Agente === agentName);

        return {
            role: isAgent ? 'agent' as const : 'client' as const,
            text: m.Mensagem,
            time: m['Data da mensagem'],
            feedback: isAgent ? getMessageFeedback(m.Mensagem, index, isLastAgentMsg) : undefined
        };
    });

    return {
        protocol,
        agent: agentName,
        contact: fullContact,
        finalScore,
        empathyScore,
        clarityScore,
        depthScore,
        commercialScore,
        agilityScore,
        isCommercial: aiResult?.isCommercial ?? true,
        overallConclusion: aiResult?.overallConclusion ?? (finalScore >= 8 ? 'Excelente' : 'Regular'),
        closingAttempt: messages.some(m => CLOSING_KEYWORDS.some(k => m.Mensagem.toLowerCase().includes(k))),
        improvements,
        messageCount: agentMessages.length,
        date: parseBrazilianDate(messages[0]?.['Data da mensagem']),
        status: 'approved',
        transcript
    };

};
