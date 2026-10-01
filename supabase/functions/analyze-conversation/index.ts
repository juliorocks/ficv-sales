// analyze-conversation — auditoria de qualidade de atendimento via OpenAI.
// Chamada pelo CSVUploader (um protocolo por vez) no lugar do antigo
// aiSpecialist.ts (Gemini, client-side — chave nunca foi configurada, sempre
// caiu no fallback heurístico). Roda no backend pra não expor a chave paga da
// OpenAI no bundle do navegador.
//
// Importante: NÃO injeta a Base de Conhecimento inteira no prompt (16
// documentos, ~300 mil tokens — isso explodiria o custo por chamada). A tarefa
// é julgar comunicação (empatia/clareza/técnica comercial), não conteúdo de
// curso — os "padrões de atendimento" do prompt bastam.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isStaff, jsonRes } from "../_shared/ai.ts";
import { getSecret } from "../_shared/secrets.ts";

const SYSTEM_PROMPT = `Você é o Auditor Master de Qualidade da FICV, especializado em auditoria de alta precisão.
PADRÕES FICV: atendimento humanizado, resolutivo e, em conversas comerciais, voltado a conduzir o cliente até o fechamento — inclusive contornando objeções com alternativas reais (prazo, parcelamento, acompanhamento futuro), não só repetindo a regra.

---
PASSO 1 — INVALIDAÇÃO (shouldInvalidate):
Antes de avaliar, decida se este atendimento MERECE ser avaliado.

INVALIDE (shouldInvalidate: true) quando:
- A conversa é uma TRANSFERÊNCIA pura: o agente apenas passou o contato para outra fila/setor sem nenhuma troca substantiva
- Houve menos de 2 trocas reais entre agente e cliente (uma pergunta e uma resposta no mínimo)
- A conversa é de bot/automação sem participação humana real do agente
- O atendimento terminou antes de qualquer interação significativa

NÃO INVALIDE (shouldInvalidate: false) quando:
- Houve pelo menos 1 pergunta do cliente E 1 resposta real do agente
- O agente fez atendimento real, mesmo que curto
- É um atendimento de suporte legítimo (aluno com dúvida + agente respondeu)

Quando shouldInvalidate for true, preencha "invalidateReason" com o motivo em 1 frase.
Quando shouldInvalidate for true, ainda preencha os demais campos com valores neutros (scores 5, isCommercial: false).

---
PASSO 2 — CLASSIFICAÇÃO OBRIGATÓRIA (isCommercial):
- MARQUE "isCommercial": false se: O cliente já é aluno, tem dúvidas de direito, dúvidas sobre aulas, matrícula, processos acadêmicos, institucional ou suporte técnico.
- MARQUE "isCommercial": true somente se: O objetivo central da conversa for a venda de um NOVO curso ou produto para um lead.
- REGRA DE OURO: No Suporte Técnico/Direito (isCommercial: false), o pilar CONVENCIONAL-COMERCIAL deve ser anulado (dê nota 5 neutra). A nota final será a média apenas de Empatia, Clareza, Profundidade e Agilidade.

---
PASSO 3 — REGRAS DE PONTUAÇÃO (Rigidez Auditora):
1. SE Suporte (isCommercial: false): Resolveu o problema? Deu a resposta técnica correta? Nota 9-10. Foi robótico ou não resolveu? Nota < 5.
2. SE Vendas (isCommercial: true): avalie a TÉCNICA de fechamento nesta conversa — não presuma que fechou só porque mencionou matrícula/boleto/contrato.
   - O cliente CONFIRMOU ter concluído (pagou, enviou comprovante, "finalizei")? Nota 9-10.
   - O agente tentou fechar E contornou objeções com alternativas reais quando o cliente hesitou (prazo, parcelamento, convite pra retomar depois)? Nota 7-8.
   - O agente só repetiu a mesma informação/regra sem propor alternativa quando o cliente objetou, ou não tentou conduzir ao fechamento? Nota 3-5.
   - Ignorou o cliente ou foi claramente ineficaz? Nota < 3.

---
FORMATO DE RETORNO (JSON OBRIGATÓRIO):
{
  "messagesFeedback": [ { "index": number, "score": "excelente"|"bom"|"melhorar", "feedback": "texto", "suggestion": "texto" } ],
  "globalScores": { "empathy": 0-10, "clarity": 0-10, "depth": 0-10, "commercial": 0-10, "agility": 0-10 },
  "isCommercial": boolean,
  "shouldInvalidate": boolean,
  "invalidateReason": "string ou null",
  "overallConclusion": "Explique detalhadamente por que este atendimento foi excelente/mediano/falho, citando o que aconteceu na conversa.",
  "improvements": ["Ação 1"]
}`;

type AIMessageFeedback = { index: number; score: "excelente" | "bom" | "melhorar"; feedback: string; suggestion?: string };
type AIConversationAnalysis = {
    messagesFeedback: AIMessageFeedback[];
    globalScores: { empathy: number; clarity: number; depth: number; commercial: number; agility: number };
    isCommercial: boolean;
    shouldInvalidate: boolean;
    invalidateReason?: string | null;
    overallConclusion: string;
    improvements: string[];
};

const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        messagesFeedback: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    index: { type: "integer" },
                    score: { type: "string", enum: ["excelente", "bom", "melhorar"] },
                    feedback: { type: "string" },
                    suggestion: { type: "string" },
                },
                required: ["index", "score", "feedback", "suggestion"],
                additionalProperties: false,
            },
        },
        globalScores: {
            type: "object",
            properties: {
                empathy: { type: "number" }, clarity: { type: "number" }, depth: { type: "number" },
                commercial: { type: "number" }, agility: { type: "number" },
            },
            required: ["empathy", "clarity", "depth", "commercial", "agility"],
            additionalProperties: false,
        },
        isCommercial: { type: "boolean" },
        shouldInvalidate: { type: "boolean" },
        invalidateReason: { type: ["string", "null"] },
        overallConclusion: { type: "string" },
        improvements: { type: "array", items: { type: "string" } },
    },
    required: ["messagesFeedback", "globalScores", "isCommercial", "shouldInvalidate", "invalidateReason", "overallConclusion", "improvements"],
    additionalProperties: false,
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isStaff(caller)) return jsonRes({ error: "Só staff." }, 403);

    try {
        const { messages } = await req.json();
        if (!Array.isArray(messages) || !messages.length) return jsonRes({ error: "messages obrigatório" }, 400);

        const apiKey = await getSecret("OPENAI_API_KEY");
        if (!apiKey) return jsonRes({ error: "OPENAI_API_KEY não configurada (Gestão > Integrações)." }, 400);

        const userPrompt = `Analise a seguinte conversa:\n${messages.map((m: { role: string; text: string }, i: number) => `${i}. [${m.role.toUpperCase()}]: ${m.text}`).join("\n")}`;

        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-5-mini",
                reasoning_effort: "low",
                messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
                response_format: { type: "json_schema", json_schema: { name: "conversation_analysis", strict: true, schema: RESPONSE_SCHEMA } },
            }),
            signal: AbortSignal.timeout(60000),
        });
        const data = await r.json();
        if (!r.ok) return jsonRes({ error: `OpenAI HTTP ${r.status}: ${data?.error?.message ?? "sem detalhe"}` }, 502);

        const content = data?.choices?.[0]?.message?.content;
        if (!content) return jsonRes({ error: "Resposta vazia da OpenAI." }, 502);

        const parsed: AIConversationAnalysis = JSON.parse(content);
        return jsonRes({ result: parsed, usage: data.usage });
    } catch (e) {
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
