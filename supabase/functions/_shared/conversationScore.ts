// Avaliação de um atendimento (agente humano × cliente) sobre widechat_messages.
// Método padrão = heurística calibrada (ver FEATURE_COEF); a IA só entra quando alguém pede
// para comparar (modo "compare" do evaluate-conversations) e fica em messages_logs.nota_ia.
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

export type Opts = { converted?: boolean };

// Mensagens que o sistema manda no NOME do agente (reativação de conversa, follow-up automático):
// não são trabalho do agente, não contam nem como entrada dele no atendimento.
const AUTO_AGENT_PATTERNS = [
    /vamos (continuar|contnuar|dar continuidade)[^.?!]{0,40}atendimento/i,
    /dando continuidade ao seu atendimento/i,
    /basta responder (esta mensagem|com um \*?sim)/i,
    /ficou alguma d[úu]vida do atendimento anterior/i,
];
const SYSTEM_MESSAGE_PATTERNS = [
    "sessão irá expirar", "sessão expirou", "sua sessão", "atendimento encerrado",
    "atendimento finalizado", "atendimento transferido", "em fila de espera",
    "aguarde na fila", "aguardando atendimento", "[sistema]", "[bot]",
];
const COURTESY = /bom dia|boa tarde|boa noite|obrigad|gra[çc]a e paz|deus aben[çc]oe|fico feliz|que alegria|prazer|[àa] disposi[çc][ãa]o|posso (te )?ajudar|como posso|conte conosco|abra[çc]o|🙏|😊|💙|😀|🤩|👋/i;
const INFO = /r\$\s?\d|mensalidade|parcela|investimento|dura[çc][ãa]o|carga hor[áa]ria|disciplina|grade|matriz curricular|in[íi]cio|come[çc]a|aulas?|https?:\/\/|bit\.ly|portal|valor/i;
const OFFER = /desconto|condi[çc][ãa]o (exclusiva|especial|excepcional)|promo[çc][ãa]o|\d+ ?% |black|bolsa|vagas?/i;
const CTA = /matr[íi]cul|inscri|garantir (a|sua) vaga|garanta sua vaga|vamos prosseguir|vamos dar continuidade|podemos prosseguir|fazer o pagamento|efetuar o pagamento|link (de|para) pagamento|boleto|contrato|fechar com a gente|vestibular|pr[óo]ximo passo/i;
const CLIENT_CONFIRM = /finalizei|finalizado minha|consegui fazer|deu certo|j[áa] fiz a matr[íi]cula|j[áa] fiz minha matr[íi]cula|matr[íi]cula paga|j[áa] paguei|segue (o )?comprovante|comprovante de pagamento|j[áa] me inscrevi|j[áa] me matriculei/i;

const normalize = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isSystemText = (text: string) => {
    const t = (text || "").toLowerCase().trim();
    return !t || SYSTEM_MESSAGE_PATTERNS.some((p) => t.includes(p));
};
const isAutoAgentText = (text: string) => AUTO_AGENT_PATTERNS.some((r) => r.test(text || ""));
const clamp = (x: number) => Math.max(0, Math.min(10, x));
const round1 = (x: number) => Number(x.toFixed(1));

// Minutos de expediente (seg–sex, 08:00–17:30, Brasília UTC-3) entre dois instantes: a espera fora do
// horário (noite, fim de semana) não é demora do agente.
export function businessMinutes(startMs: number, endMs: number): number {
    if (endMs <= startMs) return 0;
    const OFFSET = 3 * 3600_000, DAY = 86400_000;
    let total = 0;
    let day = Math.floor((startMs - OFFSET) / DAY);
    const lastDay = Math.floor((endMs - OFFSET) / DAY);
    for (let d = day; d <= lastDay && d - day < 31; d++) {
        const dow = new Date(d * DAY).getUTCDay(); // 0 dom … 6 sáb (dia local)
        if (dow === 0 || dow === 6) continue;
        const open = d * DAY + OFFSET + 8 * 3600_000;
        const close = d * DAY + OFFSET + 17.5 * 3600_000;
        const a = Math.max(startMs, open), b = Math.min(endMs, close);
        if (b > a) total += (b - a) / 60000;
    }
    return total;
}

// Atendimento sem nada comercial (suporte/assunto de aluno, transferência para Secretaria/Tutor/Financeiro, aviso
// administrativo): não entra na nota do Comercial. Conservador: qualquer sinal de curso, valor de curso, turma,
// início de aula, rematrícula ou matrícula mantém o atendimento avaliado.
const NC_TRANSFER = /(transfer\w*|encaminh\w*|passar|passo)\b[^.\n]{0,45}\b(secretaria|secret[áa]ri[oa]|tutor\w*|financeiro|suporte|setor|equipe|atendente)\b|transferiu o atendimento para a equipe|seu atendimento foi transferido/i;
const NC_TOPIC = /secretaria|\btutor|tutoria|financeiro|suporte|portal do aluno|web ?aluno|segunda via|2[ªa] via|declara[çc][ãa]o|hist[óo]rico escolar|\bnotas?\b|moodle|\bsenha\b|n[ãa]o consegu\w+ acessar|acesso (ao|a)\b|diploma|certificado|est[áa]gio|\btcc\b|trancamento|cancelamento|\bsou (aluno|aluna|ex-aluno)|\bj[áa] sou (aluno|aluna)|prezado aluno|ambiente virtual|\bsponte\b|carteirinha|aproveitamento de estudos|ementa|boleto/i;
const NC_COMMERCIAL = /rematr[íi]cula|renova[çc][ãa]o de matr[íi]cula|\bturma|in[íi]cio das aulas|aulas? (come[çc]|inici)|come[çc]a (dia|em|no|na)|\bvagas?\b|matr[íi]cula (nova|de calouro)|teologia|direito|psicologia|missiologia|lideran[çc]a crist[ãa]|forma[çc][ãa]o pol[íi]tica|gest[ãa]o escolar|psicopedagogia|psicoteologia|hist[óo]ria do cristianismo|educa[çc][ãa]o crist[ãa]|gradua[çc][ãa]o|p[óo]s-?gradua|bacharelado|vestibular|inscri[çc][ãa]o|me matricular|quero (me )?matricular|informa[çc][õo]es (sobre|do|da|de) (o |a )?(curso|gradua|p[óo]s)|\bgrade\b|disciplinas|carga hor[áa]ria|dura[çc][ãa]o|desconto|\bbolsa|condi[çc][ãa]o (exclusiva|especial|excepcional)|mensalidade|investimento|interesse (no|em|pelo|pela) (curso|gradua|p[óo]s)|preenchi meus dados/i;

export function motivoNaoComercial(msgs: Msg[]): string | null {
    const sorted = [...msgs].filter((m) => !m.interno).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const humanAgent = (m: Msg) => m.origin === "agent" && !isAutoAgentText(m.message ?? "");
    const entry = sorted.findIndex(humanAgent);
    if (entry < 0) return "sem fala de agente humano";
    const rel = sorted.slice(entry);
    const talk = rel.filter((m) => (m.origin === "agent" && !isAutoAgentText(m.message ?? "")) || m.origin === "channel");
    const all = talk.map((m) => m.message ?? "").join("\n");
    const withBot = rel.map((m) => m.message ?? "").join("\n");
    if (NC_COMMERCIAL.test(all)) return null;
    const transfer = NC_TRANSFER.test(withBot);
    const topic = NC_TOPIC.test(all);
    if (transfer) return "transferência para outro setor (Secretaria, Tutor, Financeiro ou Suporte), sem assunto comercial";
    if (topic) return "assunto de aluno/suporte/administrativo, sem assunto comercial";
    return null;
}

export type Features = {
    nAgent: number; nClient: number; nMedia: number; nQuestions: number; nLong: number;
    nInfo: number; nOffer: number; nCta: number; nCourtesy: number; nDup: number;
    avgLen: number; greetEarly: number; usedName: number; confirm: number;
    medianDelay: number; slowShare: number; ghostQuestion: number; converted: number;
    templatesIgnored: number;
};

type Prepared = {
    sorted: Msg[]; relevant: Msg[]; agentMsgs: Msg[]; realClient: Msg[]; agent: string; templates: number;
};

function prepare(msgs: Msg[]): Prepared {
    const sorted = [...msgs].filter((m) => !m.interno).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const isAgent = (m: Msg) => m.origin === "agent";
    const isTemplate = (m: Msg) => isAgent(m) && isAutoAgentText(m.message ?? "");
    const humanAgent = (m: Msg) => isAgent(m) && !isTemplate(m);

    const names: string[] = [];
    for (const m of sorted) if (humanAgent(m) && m.sender_name && !names.includes(m.sender_name)) names.push(m.sender_name);
    const agent = names[names.length - 1] || "Desconhecido";

    const entry = sorted.findIndex(humanAgent);
    const relevant = entry >= 0 ? sorted.slice(entry) : sorted;
    const agentMsgs = relevant.filter(humanAgent);
    const realClient = relevant.filter((m) => m.origin === "channel" && (m.message ?? "").trim() && !isSystemText(m.message ?? ""));
    return { sorted, relevant, agentMsgs, realClient, agent, templates: sorted.filter(isTemplate).length };
}

export function extractFeatures(msgs: Msg[], opts: Opts = {}): Features {
    const { relevant, agentMsgs, realClient, templates } = prepare(msgs);
    const texts = agentMsgs.map((m) => (m.message ?? "").trim());
    const withText = texts.filter(Boolean);
    const seen = new Set<string>();
    let nDup = 0;
    for (const t of withText) { const k = normalize(t); if (seen.has(k)) nDup++; else seen.add(k); }

    // demora: primeira fala do cliente de cada "rajada" até a próxima resposta humana do agente
    const delays: number[] = [];
    let waitingSince: number | null = null;
    for (const m of relevant) {
        const t = Date.parse(m.created_at);
        if (m.origin === "channel" && (m.message ?? "").trim() && !isSystemText(m.message ?? "")) {
            if (waitingSince == null) waitingSince = t;
        } else if (m.origin === "agent" && !isAutoAgentText(m.message ?? "")) {
            if (waitingSince != null) { delays.push(businessMinutes(waitingSince, t)); waitingSince = null; }
        }
    }
    const sortedDelays = [...delays].sort((a, b) => a - b);
    const medianDelay = sortedDelays.length ? sortedDelays[Math.floor(sortedDelays.length / 2)] : 0;
    const slowShare = delays.length ? delays.filter((d) => d > 60).length / delays.length : 0;

    const lastClient = [...realClient].pop();
    const lastClientIdx = lastClient ? relevant.lastIndexOf(lastClient) : -1;
    const answeredAfter = lastClientIdx >= 0 && relevant.slice(lastClientIdx + 1).some((m) => m.origin === "agent" && !isAutoAgentText(m.message ?? ""));
    const ghostQuestion = lastClient && (lastClient.message ?? "").includes("?") && !answeredAfter ? 1 : 0;

    const early = texts.slice(0, 2).join(" ");
    const clientNames = new Set<string>();
    for (const m of relevant) if (m.origin === "channel" && m.sender_name) clientNames.add(normalize(m.sender_name.split(/\s+/)[0] ?? ""));
    const usedName = [...clientNames].some((n) => n.length >= 3 && normalize(early).includes(n)) ? 1 : 0;

    return {
        nAgent: agentMsgs.length,
        nClient: realClient.length,
        nMedia: texts.filter((t) => !t).length,
        nQuestions: withText.filter((t) => t.includes("?")).length,
        nLong: withText.filter((t) => t.length >= 60).length,
        nInfo: withText.filter((t) => INFO.test(t)).length,
        nOffer: withText.filter((t) => OFFER.test(t)).length,
        nCta: withText.filter((t) => CTA.test(t)).length,
        nCourtesy: withText.filter((t) => COURTESY.test(t)).length,
        nDup,
        avgLen: withText.length ? withText.reduce((s, t) => s + t.length, 0) / withText.length : 0,
        greetEarly: COURTESY.test(early) ? 1 : 0,
        usedName,
        confirm: realClient.filter((m) => CLIENT_CONFIRM.test(m.message ?? "")).length,
        medianDelay, slowShare, ghostQuestion,
        converted: opts.converted ? 1 : 0,
        templatesIgnored: templates,
    };
}

// Calibração (17/11/2026), 384 atendimentos reais de 17/09–17/11 lidos pela IA como referência:
//  - profundidade, comercial e clareza: pesos ajustados por regressão contra a nota da IA (r ≈ 0,63 / 0,67 / 0,43),
//    mantendo só pesos positivos e com teto por variável, para volume de mensagem sozinho não render nota alta;
//  - agilidade e empatia NÃO foram ajustadas à IA: ela não vê horário das mensagens (agilidade dela é palpite),
//    então agilidade usa a demora real em horário de expediente e empatia usa regras de cortesia.
const cap = (x: number, m: number) => Math.min(x, m);

export function scorePillars(f: Features): { empathy: number; clarity: number; depth: number; commercial: number; agility: number } {
    const empathy = 5.5 + 1.5 * f.greetEarly + 1 * f.usedName + 0.5 * cap(f.nCourtesy, 3) - 0.5 * cap(f.nDup, 3);
    const clarity = 6.5 + 0.42 * (cap(f.avgLen, 300) / 100) + 0.08 * cap(f.nAgent, 8) - 0.7 * cap(f.nDup, 3) - (f.ghostQuestion ? 1 : 0);
    const depth = 4.1 + 0.4 * cap(f.nInfo, 4) + 0.35 * cap(f.nLong, 4) + 0.15 * cap(f.nQuestions, 3) + 0.06 * cap(f.nAgent, 8);
    const commercial = 4.55 + 0.25 * cap(f.nInfo, 4) + 0.2 * cap(f.nOffer, 2) + 0.41 * cap(f.nCta, 3) + 0.04 * cap(f.nAgent, 8)
        + (f.confirm > 0 ? 1.5 : 0) + (f.converted ? 2.5 : 0);
    const d = f.medianDelay;
    const base = d <= 5 ? 10 : d <= 15 ? 9 : d <= 30 ? 8 : d <= 60 ? 7 : d <= 120 ? 6 : d <= 240 ? 5 : 4;
    const agility = base - (f.slowShare > 0.5 ? 0.5 : 0) - (f.ghostQuestion ? 1 : 0);
    return { empathy: clamp(empathy), clarity: clamp(clarity), depth: clamp(depth), commercial: clamp(commercial), agility: clamp(agility) };
}

export function evaluateAtendimento(msgs: Msg[], ai: AiResult | null, opts: Opts = {}): Evaluation {
    const { relevant, agentMsgs, realClient, agent } = prepare(msgs);
    // Para a IA: mídia do agente (áudio/imagem/arquivo) chega como marcador, não como mensagem vazia.
    const aiMessages = relevant
        .filter((m) => !isAutoAgentText(m.message ?? "") && (m.origin === "agent" || !isSystemText(m.message ?? "")))
        .map((m) => ({
            role: (m.origin === "agent" ? "agent" : "client") as "agent" | "client",
            text: m.origin === "agent" && !(m.message ?? "").trim() ? "[o agente enviou um áudio, imagem ou arquivo]" : (m.message ?? ""),
        }));

    const invalid = (method: Evaluation["method"], reason: string, isCommercial: boolean): Evaluation => ({
        status: "invalidated", method, agent, messageCount: agentMsgs.length,
        empathy: 0, clarity: 0, depth: 0, commercial: 0, agility: 0, finalScore: 0,
        isCommercial, hasEmpathy: false, closingAttempt: false,
        overallConclusion: `Invalidado automaticamente: ${reason}`, improvements: [], aiMessages,
    });

    if (agentMsgs.length === 0) return invalid("auto_invalidada", "nenhuma mensagem do agente humano neste atendimento (só mensagens automáticas ou do robô).", true);
    if (realClient.length === 0) {
        return invalid("auto_invalidada", "o cliente não enviou nenhuma mensagem após o agente entrar no atendimento.", true);
    }
    const naoComercial = motivoNaoComercial(msgs);
    if (naoComercial) return invalid("auto_invalidada", `${naoComercial}.`, false);
    if (ai?.shouldInvalidate) return invalid("ia", ai.invalidateReason || "Atendimento sem interação real avaliável.", false);

    const f = extractFeatures(msgs, opts);
    const hasEmpathy = f.nCourtesy > 0;
    const closingAttempt = f.nCta > 0;

    let empathy: number, clarity: number, depth: number, commercial: number, agility: number;
    let isCommercial: boolean;
    let overallConclusion: string;
    let improvements: string[];
    let method: Evaluation["method"];

    if (ai) {
        ({ empathy, clarity, depth, commercial, agility } = ai.globalScores);
        isCommercial = ai.isCommercial;
        overallConclusion = ai.overallConclusion;
        improvements = ai.improvements ?? [];
        method = "ia";
    } else {
        ({ empathy, clarity, depth, commercial, agility } = scorePillars(f));
        isCommercial = true;
        improvements = [];
        if (empathy < 7) improvements.push("Cumprimentar pelo nome e mostrar interesse pela situação do cliente antes de passar informação.");
        if (agility < 7) improvements.push("Responder mais rápido dentro do expediente (a demora passou de 1 hora em parte das respostas).");
        if (depth < 6) improvements.push("Fazer perguntas para entender o que o cliente precisa e apresentar o curso, valores e prazos.");
        if (commercial < 6) improvements.push("Conduzir para a matrícula: apresentar condição, link e próximo passo.");
        if (f.ghostQuestion) improvements.push("A última pergunta do cliente ficou sem resposta.");
        if (f.nDup > 0) improvements.push("Evitar mensagens repetidas.");
        overallConclusion = "";
        method = "heuristica";
    }

    const finalScore = isCommercial
        ? round1((empathy + clarity + depth + commercial + agility) / 5)
        : round1((empathy + clarity + depth + agility) / 4);

    return {
        status: "approved", method, agent, messageCount: agentMsgs.length,
        empathy: round1(empathy), clarity: round1(clarity), depth: round1(depth), commercial: round1(commercial), agility: round1(agility),
        finalScore, isCommercial, hasEmpathy, closingAttempt,
        overallConclusion: overallConclusion || (finalScore >= 8 ? "Excelente" : finalScore >= 6.5 ? "Bom" : "Regular"),
        improvements, aiMessages,
    };
}
