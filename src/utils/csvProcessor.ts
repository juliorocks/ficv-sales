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


// Patterns that identify system/platform messages (not real client messages)
const SYSTEM_MESSAGE_PATTERNS = [
    'sessão irá expirar',
    'sessão expirou',
    'sua sessão',
    'atendimento encerrado',
    'atendimento finalizado',
    'atendimento transferido',
    'em fila de espera',
    'aguarde na fila',
    'aguardando atendimento',
    '[sistema]',
    '[bot]',
];

function isSystemMessageText(text: string): boolean {
    const lower = (text || '').toLowerCase().trim();
    if (!lower) return true;
    return SYSTEM_MESSAGE_PATTERNS.some(p => lower.includes(p));
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
    const contactName = messages.find(m => m.Contato)?.Contato || 'Desconhecido';
    const contactId = messages.find(m => m.Identificador)?.Identificador || '';
    const fullContact = contactId ? `${contactName} (${contactId})` : contactName;
    const date = parseBrazilianDate(messages[0]?.['Data da mensagem']);

    // Find the human agent: the Widechat bot handles the conversation first, then
    // transfers to a human. The human agent is the LAST distinct non-client Agente
    // to appear — because the bot always shows up first in the handoff flow.
    const seenAgents: string[] = [];
    messages.forEach(m => {
        if (m.Agente && m.Agente !== 'Cliente' && !seenAgents.includes(m.Agente)) {
            seenAgents.push(m.Agente);
        }
    });
    const agentName = seenAgents[seenAgents.length - 1] || 'Desconhecido';

    // Entry point: first message where the human agent appears.
    // Everything before this is the Widechat bot flow and must not be scored.
    const agentEntryIndex = messages.findIndex(m => m.Agente === agentName);
    const relevantMessages = agentEntryIndex >= 0 ? messages.slice(agentEntryIndex) : messages;
    const agentMessages = relevantMessages.filter(m => m.Agente === agentName);

    // Build full transcript for display — shows full conversation including pre-agent bot flow
    const transcript = messages.map((m, index) => {
        const isAgent = m.Agente === agentName;
        const isLastAgentMsg = isAgent && !messages.slice(index + 1).some(next => next.Agente === agentName);
        return {
            role: isAgent ? 'agent' as const : 'client' as const,
            text: m.Mensagem,
            time: m['Data da mensagem'],
            feedback: undefined as string | undefined,
            _isLastAgent: isLastAgentMsg,
        };
    });

    // Pre-flight: count real client messages AFTER the agent entered
    // (client messages to the bot before handoff don't count)
    const realClientMessages = relevantMessages.filter(m =>
        m.Agente === 'Cliente' && !isSystemMessageText(m.Mensagem)
    );

    // Auto-invalidate without calling AI: client never responded after agent joined
    if (realClientMessages.length === 0) {
        console.log(`[Protocol ${protocol}] Auto-invalidated: client sent 0 messages after agent entered.`);
        return {
            protocol,
            agent: agentName,
            contact: fullContact,
            finalScore: 0,
            empathyScore: 0,
            clarityScore: 0,
            depthScore: 0,
            commercialScore: 0,
            agilityScore: 0,
            isCommercial: true,
            overallConclusion: 'Invalidado automaticamente: o cliente não enviou nenhuma mensagem após o agente entrar no atendimento.',
            closingAttempt: false,
            improvements: [],
            messageCount: agentMessages.length,
            date,
            status: 'invalidated',
            transcript: transcript.map(({ _isLastAgent: _, ...m }) => m),
        };
    }

    // Prepare AI messages: only from agent entry point, no system noise
    const aiMessages = relevantMessages
        .filter(m => !isSystemMessageText(m.Mensagem))
        .map(m => ({
            role: m.Agente === agentName ? 'agent' : 'client',
            text: m.Mensagem
        }));

    // Trigger AI Deep Analysis
    const aiResult = await analyzeConversationWithAI(aiMessages);

    // Invalidate if AI determines this conversation has no evaluable value
    if (aiResult?.shouldInvalidate) {
        const reason = aiResult.invalidateReason || 'Atendimento sem interação real avaliável.';
        console.log(`[Protocol ${protocol}] AI-invalidated: ${reason}`);
        return {
            protocol,
            agent: agentName,
            contact: fullContact,
            finalScore: 0,
            empathyScore: 0,
            clarityScore: 0,
            depthScore: 0,
            commercialScore: 0,
            agilityScore: 0,
            isCommercial: false,
            overallConclusion: `Invalidado automaticamente: ${reason}`,
            closingAttempt: false,
            improvements: [],
            messageCount: agentMessages.length,
            date,
            status: 'invalidated',
            transcript: transcript.map(({ _isLastAgent: _, ...m }) => m),
        };
    }

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

    // Calculate Scores from relevantMessages only (post agent entry — no bot flow)
    const empathyScore = aiResult ? aiResult.globalScores.empathy : Math.max(0, Math.min(10, relevantMessages.filter(m => EMPATHY_KEYWORDS.some(k => m.Mensagem.toLowerCase().includes(k))).length * 2 + 5));
    const commercialScore = aiResult ? aiResult.globalScores.commercial : Math.max(0, Math.min(10, relevantMessages.filter(m => CLOSING_KEYWORDS.some(k => m.Mensagem.toLowerCase().includes(k))).length * 4 + 2));
    const clarityScore = aiResult ? aiResult.globalScores.clarity : Math.max(0, Math.min(10, relevantMessages.filter(m => m.Mensagem.length > 60).length * 2 + 5));
    const depthScore = aiResult ? aiResult.globalScores.depth : Math.max(0, Math.min(10, relevantMessages.filter(m => m.Mensagem.includes('?') && m.Agente !== 'Cliente').length * 2 + 3));
    const agilityScore = aiResult ? aiResult.globalScores.agility : (relevantMessages.length > 5 ? 9 : 7);

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

    // Apply feedback to transcript (removes temporary _isLastAgent field)
    const finalTranscript = transcript.map(({ _isLastAgent, ...m }, index) => ({
        ...m,
        feedback: m.role === 'agent'
            ? getMessageFeedback(m.text, index, _isLastAgent)
            : undefined,
    }));

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
        closingAttempt: relevantMessages.some(m => CLOSING_KEYWORDS.some(k => m.Mensagem.toLowerCase().includes(k))),
        improvements,
        messageCount: agentMessages.length,
        date,
        status: 'approved',
        transcript: finalTranscript,
    };

};
