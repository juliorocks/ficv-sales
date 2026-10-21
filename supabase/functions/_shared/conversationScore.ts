// Avaliação de um atendimento (agente humano × cliente) — porte da lógica do CSV
// (src/utils/csvProcessor.ts) para o backend, sobre widechat_messages.
// Sem dependências: o mesmo arquivo roda no Deno e é testável em Node.

export type Msg = {
    origin: string | null;
    sender_name: string | null;
    message: string | null;
    created_at: string;
    interno?: boolean | null;
};

export type AiResult = {
    globalScores: { empathy: number; clarity: number; depth: number; commercial: number; agility: number };
    isCommercial: boolean;
    shouldInvalidate: boolean;
    invalidateReason?: string;
    overallConclusion: string;
    improvements: string[];
};

export type Evaluation = {
    status: "approved" | "invalidated";
    method: "ia" | "heuristica" | "auto_invalidada";
    agent: string;
    messageCount: number;
    empathy: number;
    clarity: number;
    depth: number;
    commercial: number;
    agility: number;
    finalScore: number;
    isCommercial: boolean;
    hasEmpathy: boolean;
    closingAttempt: boolean;
    overallConclusion: string;
    improvements: string[];
    aiMessages: { role: "agent" | "client"; text: string }[];
};

const SYSTEM_MESSAGE_PATTERNS = [
    "sessão irá expirar", "sessão expirou", "sua sessão", "atendimento encerrado",
    "atendimento finalizado", "atendimento transferido", "em fila de espera",
    "aguarde na fila", "aguardando atendimento", "[sistema]", "[bot]",
];
const EMPATHY_KEYWORDS = ["bom dia", "boa tarde", "obrigado", "obrigada", "fico feliz", "posso ajudar"];
const CLOSING_CONFIRMATION_KEYWORDS = [
    "finalizei", "finalizado minha", "consegui fazer", "deu certo",
    "ja fiz a matricula", "ja fiz minha matricula", "matricula paga", "ja paguei",
    "segue comprovante", "segue o comprovante", "comprovante de pagamento",
];
const CLOSING_ATTEMPT_KEYWORDS = [
    "matricul", "inscri", "garantir sua vaga", "garanta sua vaga", "garantir a vaga",
    "vamos prosseguir", "vamos dar continuidade", "podemos prosseguir",
    "fazer o pagamento", "efetuar o pagamento", "link de pagamento", "link para pagamento",
    "boleto", "contrato", "comprovante", "fechar com a gente", "fechamento",
];

const normalize = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hasKeyword = (text: string, keywords: string[]) => {
    const n = normalize(text);
    return keywords.some((k) => n.includes(normalize(k)));
};
const isSystemText = (text: string) => {
    const t = (text || "").toLowerCase().trim();
    return !t || SYSTEM_MESSAGE_PATTERNS.some((p) => t.includes(p));
};
const clamp = (x: number) => Math.max(0, Math.min(10, x));
const round1 = (x: number) => Number(x.toFixed(1));

export function evaluateAtendimento(msgs: Msg[], ai: AiResult | null): Evaluation {
    const sorted = [...msgs].filter((m) => !m.interno).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const isAgent = (m: Msg) => m.origin === "agent";
    const isClient = (m: Msg) => m.origin === "channel";

    const agents: string[] = [];
    for (const m of sorted) if (isAgent(m) && m.sender_name && !agents.includes(m.sender_name)) agents.push(m.sender_name);
    const agent = agents[agents.length - 1] || "Desconhecido";

    // Entrada do agente humano: tudo antes é fluxo do bot e não entra na nota.
    const entry = sorted.findIndex(isAgent);
    const relevant = entry >= 0 ? sorted.slice(entry) : sorted;
    const agentMsgs = relevant.filter(isAgent);
    const realClient = relevant.filter((m) => isClient(m) && (m.message ?? "").trim() && !isSystemText(m.message ?? ""));
    const aiMessages = relevant
        .filter((m) => !isSystemText(m.message ?? ""))
        .map((m) => ({ role: (isAgent(m) ? "agent" : "client") as "agent" | "client", text: m.message ?? "" }));

    const invalid = (method: Evaluation["method"], reason: string, isCommercial: boolean): Evaluation => ({
        status: "invalidated", method, agent, messageCount: agentMsgs.length,
        empathy: 0, clarity: 0, depth: 0, commercial: 0, agility: 0, finalScore: 0,
        isCommercial, hasEmpathy: false, closingAttempt: false,
        overallConclusion: `Invalidado automaticamente: ${reason}`, improvements: [], aiMessages,
    });

    if (agentMsgs.length === 0) return invalid("auto_invalidada", "nenhuma mensagem do agente humano neste atendimento.", true);
    if (realClient.length === 0) {
        return invalid("auto_invalidada", "o cliente não enviou nenhuma mensagem após o agente entrar no atendimento.", true);
    }
    if (ai?.shouldInvalidate) {
        return invalid("ia", ai.invalidateReason || "Atendimento sem interação real avaliável.", false);
    }

    const hasEmpathy = relevant.some((m) => hasKeyword(m.message ?? "", EMPATHY_KEYWORDS));
    const closingAttempt = relevant.some((m) => hasKeyword(m.message ?? "", CLOSING_ATTEMPT_KEYWORDS));

    let empathy: number, clarity: number, depth: number, commercial: number, agility: number;
    let isCommercial: boolean;
    let overallConclusion: string;
    let improvements: string[];
    let method: Evaluation["method"];

    if (ai) {
        ({ empathy, clarity, depth, commercial, agility } = {
            empathy: ai.globalScores.empathy, clarity: ai.globalScores.clarity, depth: ai.globalScores.depth,
            commercial: ai.globalScores.commercial, agility: ai.globalScores.agility,
        });
        isCommercial = ai.isCommercial;
        overallConclusion = ai.overallConclusion;
        improvements = ai.improvements ?? [];
        method = "ia";
    } else {
        const confirmationHits = relevant.filter((m) => !isAgent(m) && hasKeyword(m.message ?? "", CLOSING_CONFIRMATION_KEYWORDS)).length;
        const attemptHits = relevant.filter((m) => hasKeyword(m.message ?? "", CLOSING_ATTEMPT_KEYWORDS)).length;
        empathy = clamp(relevant.filter((m) => hasKeyword(m.message ?? "", EMPATHY_KEYWORDS)).length * 2 + 5);
        commercial = clamp(5 + Math.min(attemptHits, 2) * 1 + confirmationHits * 4);
        clarity = clamp(relevant.filter((m) => (m.message ?? "").length > 60).length * 2 + 5);
        depth = clamp(relevant.filter((m) => (m.message ?? "").includes("?") && isAgent(m)).length * 2 + 3);
        agility = relevant.length > 5 ? 9 : 7;
        isCommercial = true;
        overallConclusion = "";
        improvements = [];
        if (empathy < 7) improvements.push("Focar mais na conexão e escuta ativa antes da oferta.");
        if (commercial < 8) improvements.push("Ser mais assertivo na condução para o fechamento.");
        method = "heuristica";
    }

    const finalScore = isCommercial
        ? round1((empathy + clarity + depth + commercial + agility) / 5)
        : round1((empathy + clarity + depth + agility) / 4);

    return {
        status: "approved", method, agent, messageCount: agentMsgs.length,
        empathy, clarity, depth, commercial, agility, finalScore, isCommercial,
        hasEmpathy, closingAttempt,
        overallConclusion: overallConclusion || (finalScore >= 8 ? "Excelente" : "Regular"),
        improvements, aiMessages,
    };
}
