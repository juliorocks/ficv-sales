import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
if (!API_KEY) console.warn("[AI Specialist] VITE_GEMINI_API_KEY is missing!");
const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

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
    overallConclusion: string;
    improvements: string[];
}

const SYSTEM_PROMPT = (kbContext: string) => `Você é o Auditor Master de Qualidade da FICV, especializado em auditoria de alta precisão.
DIRETRIZES DA BASE DE CONHECIMENTO (CONTEXTO):
${kbContext || 'Padrões FICV de atendimento humanizado e resolução.'}

---
CLASSIFICAÇÃO OBRIGATÓRIA (isCommercial):
- MARQUE "isCommercial": false se: O cliente já é aluno, tem dúvidas de direito, dúvidas sobre aulas, matrícula, processos acadêmicos, institucional ou suporte técnico. 
- MARQUE "isCommercial": true somente se: O objetivo central da conversa for a venda de um NOVO curso ou produto para um lead.
- REGRA DE OURO: No Suporte Técnico/Direito (isCommercial: false), o pilar CONVENCIONAL-COMERCIAL deve ser anulado (dê nota 5 neutra). A nota final será a média apenas de Empatia, Clareza, Profundidade e Agilidade.

---
REGRAS DE PONTUAÇÃO (Rigidez Auditora):
1. SE Suporte (isCommercial: false): Resolveu o problema? Deu a resposta técnica correta? Nota 9-10. Foi robótico ou não resolveu? Nota < 5.
2. SE Vendas (isCommercial: true): Houve tentativa real de fechamento? Se sim, nota alta. Se ignorou o cliente, nota baixa.

---
FORMATO DE RETORNO (JSON OBRIGATÓRIO):
{
  "messagesFeedback": [ { "index": number, "score": "excelente"|"bom"|"melhorar", "feedback": "texto", "suggestion": "texto" } ],
  "globalScores": { "empathy": 0-10, "clarity": 0-10, "depth": 0-10, "commercial": 0-10, "agility": 0-10 },
  "isCommercial": boolean,
  "overallConclusion": "Explique detalhadamente por que este atendimento foi excelente em suporte ou falho em vendas.",
  "improvements": ["Ação 1"]
}
`;

export async function analyzeConversationWithAI(messages: { role: string, text: string }[]): Promise<AIConversationAnalysis | null> {
    if (!genAI) {
        console.warn("VITE_GEMINI_API_KEY não configurada. Usando heurísticas locais.");
        return null;
    }

    try {
        // Fetch Knowledge Base context
        const { data: kbData } = await (await import('../lib/supabase')).supabase
            .from('knowledge_base')
            .select('title, content');

        const kbContext = kbData?.map(doc => `[${doc.title}]: ${doc.content}`).join('\n\n') || '';
        console.log(`[AI Specialist] KB Context Loaded: ${kbData?.length || 0} documents.`);

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `${SYSTEM_PROMPT(kbContext)}\n\nAnalise a seguinte conversa:\n${messages.map((m, i) => `${i}. [${m.role.toUpperCase()}]: ${m.text}`).join('\n')}`;

        console.log('[AI Specialist] Sending prompt to Gemini with conversation length:', messages.length);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log('[AI Specialist] Raw response:', text);

        // Extract JSON from markdown if Gemini wraps it
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        return JSON.parse(text);
    } catch (error) {
        console.error("Erro na análise da IA:", error);
        return null;
    }
}

export async function generateRefinedScript(originalContent: string, objective: string): Promise<string> {
    if (!genAI) throw new Error("API Key não configurada");

    const objectivePrompts: Record<string, string> = {
        persuasive: "Torne este script de atendimento mais persuasivo, usando gatilhos mentais de escassez e autoridade.",
        short: "Torne este script mais curto e direto ao ponto, ideal para mensagens rápidas sem perder a essência.",
        formal: "Torne este script mais formal e polido, focando em profissionalismo extremo.",
        direct: "Torne este script altamente direto, removendo enrolação e focando na chamada para ação.",
        cold: "Adapte este script para um lead frio (que ainda não conhece bem a marca), focando em gerar curiosidade e segurança.",
        hot: "Adapte este script para um lead quente (pronto para comprar), focando em quebra de objeções finais e fechamento imediato."
    };

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Você é um especialista em Copywriting de Vendas para Educação (FICV).
Objetivo: ${objectivePrompts[objective] || objectivePrompts.persuasive}

SCRIPT ORIGINAL:
---
${originalContent}
---

Instruções:
1. Retorne APENAS o texto do script refinado.
2. Mantenha os espaços para preenchimento como [Nome do Cliente] ou {{nome}}.
3. Use um tom de voz humanizado mas focado em conversão.
4. Mantenha a formatação clara.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
}
