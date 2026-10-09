// Hub do Grupo Cidade Viva — o número oficial antigo (83 3041-7471) recebe gente de
// todas as empresas do grupo. Aqui fica a decisão: pra qual empresa vai cada contato.
// Usado pelo vivaconnect-webhook (de verdade) e pelo vivaconnect-api action=hub_simulate.
//
// 29/09: não existe mais menu numerado. Uma ÚNICA chamada de IA por mensagem do contato
// classifica (destino/confiança) E, se ainda não der pra saber, escreve a próxima pergunta
// em linguagem natural — igual uma pessoa perguntando no WhatsApp, nunca uma lista "1, 2, 3,
// 4". A IA vê a conversa inteira (as próprias perguntas dela incluídas), então uma resposta
// tipo "a primeira" ou "essa mesma" também é entendida pelo contexto.
import { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import { chatJSON } from "./ai.ts";
import { fillTemplate, firstName, onlyDigits } from "./vivaconnect.ts";

export type HubDest = {
    id: number; nome: string; emoji: string; assuntos: string; is_self: boolean; numero: string | null;
    channel_id: number | null; avisar_destino: boolean; mensagem_redirect: string; mensagem_destino: string;
    ativo: boolean; ordem: number; mensagem_sem_numero?: string | null;
    // 09/10: 2º modo de encaminhamento — destino SEM número próprio, que atende direto por
    // uma fila do próprio Z-PRO (mesmo número oficial). Preenchido = usa este modo em vez
    // do redirecionamento por número (numero/mensagem_redirect/canal da empresa ficam sem
    // efeito pra esse destino).
    zpro_queue_id: number | null; mensagem_fila: string;
};
export const temNumero = (d: HubDest) => onlyDigits(d.numero).length >= 10;
export const temFila = (d: HubDest) => d.zpro_queue_id != null;
export type HubMsg = { de: "contato" | "hub"; texto: string; em: string };
export type Classificacao = { destino: HubDest | null; confianca: number; motivo: string; metodo: "ia"; resposta: string | null };

/**
 * Empresas na triagem = todas as ATIVAS, com ou sem número novo (28/09: a IA sempre
 * classifica — "quero ser membro" nunca pode virar lead da Faculdade só porque a Igreja
 * ainda não tem número; sem número, a pessoa recebe mensagem_sem_numero).
 */
export async function loadDestinations(db: SupabaseClient): Promise<HubDest[]> {
    const { data } = await db.from("vivaconnect_hub_destinations").select("*").eq("ativo", true).order("ordem").order("id");
    return (data ?? []) as HubDest[];
}

const SEM_NUMERO_PADRAO = "Olá{nome_virgula}! 💙 Este WhatsApp agora é exclusivo da *Faculdade Internacional Cidade Viva*.\nO atendimento da *{empresa}* está mudando de número — por favor, procure a {empresa} pelos canais oficiais (site e Instagram). Obrigado pela compreensão!";

/** "(83) 99999-0000" a partir de 5583999990000 */
export function formatNumero(raw: string | null): string {
    let d = onlyDigits(raw);
    if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return raw ?? "";
}
export const waLink = (raw: string | null) => {
    let d = onlyDigits(raw);
    if (d.length === 10 || d.length === 11) d = "55" + d;
    return `https://wa.me/${d}`;
};

function vars(nome: string | null | undefined, extra: Record<string, string> = {}) {
    const p = firstName(nome ?? "");
    return { primeiro_nome: p || "", nome_virgula: p ? `, ${p}` : "", ...extra };
}

export function redirectText(d: HubDest, nome: string | null | undefined): string {
    if (!temNumero(d)) return fillTemplate(d.mensagem_sem_numero || SEM_NUMERO_PADRAO, vars(nome, { empresa: d.nome }));
    return fillTemplate(d.mensagem_redirect, vars(nome, { empresa: d.nome, numero: formatNumero(d.numero), link: waLink(d.numero) }));
}
export function filaText(d: HubDest, nome: string | null | undefined): string {
    return fillTemplate(d.mensagem_fila, vars(nome, { empresa: d.nome }));
}
export function forwardText(d: HubDest, nome: string | null | undefined, mensagem: string): string {
    const m = mensagem.length > 300 ? `${mensagem.slice(0, 300)}…` : mensagem;
    return fillTemplate(d.mensagem_destino, vars(nome, { empresa: d.nome, mensagem: m }));
}

/** Pergunta de reserva SEM IA — só entra se a OpenAI falhar (nunca deixa a pessoa sem resposta). */
function perguntaReserva(dests: HubDest[], nome: string | null | undefined): string {
    const nomes = dests.map((d) => d.nome);
    const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}` : (nomes[0] ?? "a gente");
    return fillTemplate(`Oi{nome_virgula}! 👋 Me conta rapidinho: você quer falar com a ${lista}?`, vars(nome));
}

/**
 * IA classifica o destino pela conversa inteira (contato + as próprias perguntas do hub) e,
 * se ainda não der pra saber, já escreve a próxima pergunta natural — sem menu numerado.
 */
export async function classify(db: SupabaseClient, dests: HubDest[], historico: HubMsg[], nome: string | null, settings: any): Promise<Classificacao> {
    const { data: s } = await db.from("ai_agent_settings").select("chat_model").eq("id", 1).maybeSingle();
    const lista = dests.map((d) => `- id ${d.id}: ${d.nome}${d.is_self ? " (este número — é a Faculdade)" : ""} — ${d.assuntos}`).join("\n");
    const system = [
        "Você é a recepção, por WhatsApp, do número institucional do GRUPO CIDADE VIVA — não é uma empresa específica, é o número que atende TODAS as empresas do grupo juntas (a pessoa que escreve não sabe disso; pra ela é só 'o WhatsApp da Cidade Viva').",
        "Sua ÚNICA tarefa é descobrir, numa conversa curta e natural, com QUAL empresa do grupo a pessoa quer falar — e então o sistema encaminha. Você NUNCA lista opções numeradas ou com emoji de número, e nunca parece um menu/robô: escreve como uma pessoa de verdade digitando no celular, frases curtas, tom caloroso. Pode citar 2 a 4 empresas numa frase corrida quando fizer sentido, mas sempre em prosa.",
        "Se já der pra saber a empresa pelo que foi dito (agora ou antes na conversa), retorne o id com confiança alta e 'resposta' = null (quem confirma pro contato é outra mensagem do sistema, você não precisa escrever nada agora).",
        "Se for só cumprimento ('oi', 'boa tarde'...) ou não der pra saber o assunto ainda, destino=null e escreva em 'resposta' UMA pergunta curta pra descobrir — adapte ao que a pessoa já disse (não repita uma pergunta que você já fez do mesmo jeito). Pra um simples 'oi' de primeira mensagem, pergunte com quem ela quer falar, citando as empresas em prosa.",
        "Não chute: na dúvida real entre duas, destino=null e pergunte pra desempatar citando as duas. Ex.: 'matrícula' sozinho é ambíguo (faculdade ou escola) → pergunte se é matrícula dela mesma ou de um filho; 'vestibular de teologia' → faculdade, sem perguntar; 'quero ser membro' → igreja, sem perguntar.",
        "Regras fixas: 'membro', 'membresia', 'batismo', 'culto', 'célula', 'pastor', 'oração' → IGREJA (a faculdade tem ALUNOS, nunca membros). Educação infantil, fundamental, ensino médio, filho/criança na escola → ESCOLA. Vestibular, graduação, pós, curso superior, EAD da faculdade, diploma → FACULDADE.",
        "Se o assunto não bater com nenhuma da lista abaixo, destino=null e pergunte — nunca invente uma empresa que não está na lista.",
        "Nunca responda aqui a pergunta de preço, horário, matrícula etc. — sua única função é direcionar; quem responde o conteúdo é a equipe de cada empresa depois.",
        settings?.hub_ask_instructions ? `Instruções extras de tom/estilo definidas pela gestão: ${settings.hub_ask_instructions}` : "",
        `EMPRESAS DO GRUPO:\n${lista}`,
        'Responda em JSON: {"destino": <id numérico ou null>, "confianca": 0 a 1, "motivo": "frase curta pra registro interno", "resposta": "pergunta natural em português — só quando destino=null, senão null"}',
    ].filter(Boolean).join("\n\n");
    const msgs = historico.slice(-8).map((h) => ({ role: h.de === "contato" ? "user" as const : "assistant" as const, content: h.texto }));
    try {
        const { json } = await chatJSON(s?.chat_model ?? "gpt-4.1-mini", 0.5, [
            { role: "system", content: system },
            ...msgs,
        ]);
        const id = json.destino == null ? null : Number(json.destino);
        const conf = Math.max(0, Math.min(1, Number(json.confianca) || 0));
        const d = id != null ? dests.find((x) => x.id === id) ?? null : null;
        const resposta = typeof json.resposta === "string" ? json.resposta.trim().slice(0, 500) : "";
        return {
            destino: d && conf >= 0.6 ? d : null, confianca: conf,
            motivo: String(json.motivo ?? "").slice(0, 300), metodo: "ia",
            resposta: resposta || null,
        };
    } catch (e) {
        // sem OpenAI / erro → pergunta de reserva (nunca trava o atendimento)
        return { destino: null, confianca: 0, motivo: `IA indisponível: ${(e as Error).message}`.slice(0, 300), metodo: "ia", resposta: null };
    }
}

export type HubPlano =
    | { acao: "faculdade"; destino: HubDest; metodo: string; confianca: number; motivo: string }
    | { acao: "encaminhar"; destino: HubDest; metodo: string; confianca: number; motivo: string; redirect: string; forward: string | null }
    | { acao: "encaminhar_fila"; destino: HubDest; metodo: string; confianca: number; motivo: string; aviso: string }
    | { acao: "perguntar"; texto: string; motivo: string }
    | { acao: "ignorar"; motivo: string };

/**
 * Decide o que fazer com a fala atual do contato, dado o estado da sessão.
 * Não grava nada — quem executa é o webhook (ou o simulador só mostra).
 */
export async function planejar(
    db: SupabaseClient,
    opts: { settings: any; dests: HubDest[]; sessao: { status: string; menus: number; destination_id: number | null; redirected_at: string | null; messages: HubMsg[] } | null; texto: string; nome: string | null },
): Promise<HubPlano> {
    const { settings, dests, sessao, texto, nome } = opts;
    const self = dests.find((d) => d.is_self);
    if (!self) return { acao: "ignorar", motivo: "Faculdade (is_self) não cadastrada/ativa no hub" };
    const outras = dests.filter((d) => !d.is_self);
    // nenhuma outra empresa ATIVA → tudo é Faculdade (hub sem efeito)
    if (!outras.length) return { acao: "faculdade", destino: self, metodo: "unico", confianca: 1, motivo: "nenhuma outra empresa ativa no hub" };

    // conversa inteira (contato + perguntas do próprio hub) — dá contexto pra IA entender
    // respostas curtas tipo "a primeira" ou "essa mesma"
    const historico: HubMsg[] = [...(sessao?.messages ?? []), { de: "contato", texto, em: new Date().toISOString() }];
    const falasContato = historico.filter((m) => m.de === "contato").map((m) => m.texto);

    const c = await classify(db, dests, historico, nome, settings);
    if (c.destino) {
        // já encaminhado pra essa mesma empresa há pouco → não repete a mensagem
        if (sessao?.status === "encaminhado" && sessao.destination_id === c.destino.id && sessao.redirected_at
            && Date.now() - new Date(sessao.redirected_at).getTime() < 12 * 3600_000) {
            return { acao: "ignorar", motivo: `já encaminhado para ${c.destino.nome} há menos de 12h` };
        }
        return plano(c.destino, c.metodo, c.confianca, c.motivo, self, nome, falasContato);
    }
    if ((sessao?.menus ?? 0) >= (settings.hub_max_questions ?? settings.hub_max_menus ?? 2)) {
        return { acao: "faculdade", destino: self, metodo: "fallback", confianca: 0, motivo: `sem assunto claro depois de ${sessao?.menus} pergunta(s) — segue no atendimento da Faculdade (equipe vê no Kanban)` };
    }
    if (sessao?.status === "encaminhado") return { acao: "ignorar", motivo: "já encaminhado; nova mensagem sem assunto claro" };
    return { acao: "perguntar", texto: c.resposta || perguntaReserva(dests, nome), motivo: c.motivo || "sem assunto claro" };
}

/** Pré-filtro barato (regex) pra saber se vale rodar a triagem completa (classify(), que
 *  chama a OpenAI) — evita gastar uma chamada a mais em toda mensagem normal da Faculdade.
 *  Mesmas famílias de palavra que o classify() já usa pra reconhecer Igreja/Escola/etc.
 *  01/10: achado ao vivo — "quero saber sobre as matriculas do fundamental, na escola" não
 *  batia em NADA aqui (exigia "ensino fundamental" junto, nunca só "fundamental"/"escola"
 *  soltos, e a parte de matrícula só cobria "dele/dela/do meu filho/da minha filha") — o lead
 *  ficou preso na IA da Faculdade com contexto antigo em vez de ir pra classificação do Hub.
 *  Testando as OUTRAS empresas depois desse achado: Igreja já funcionava (tinha membro/culto/
 *  pastor/oração/dízimo/oferta), mas faltava "igreja" sozinho, "ministério" e "retiro"; Fundação
 *  não tinha NENHUMA palavra sua na lista (doação/projeto social/voluntariado) — qualquer
 *  pergunta sobre doação pra Fundação caía direto na Vivi da Faculdade, igual o caso da Escola.
 *  Palavras soltas (escola, fundamental, igreja, doação…) têm risco baixo de disparar à toa:
 *  isso só decide se vale chamar o classify() (que ainda decide de verdade, com o contexto todo,
 *  e já protege contra redirecionar a própria Faculdade pra ela mesma) — não redireciona sozinho. */
export function mentionsOtherCompany(text: string): boolean {
    return /\bmembro\b|\bmembresia\b|\bbatismo\b|\bculto\b|\bc[eé]lula\b|\bpastor|\bora[çc][ãa]o\b|\bdiz[íi]mo|\boferta\b|\bigreja\b|minist[eé]rio|\bretiro\b|\bescola\b|\binfantil\b|\bfundamental\b|ensino m[eé]dio|\brematr[íi]cula\b|\buniforme\b|material escolar|reuni[ãa]o de pais|\bmeu filho\b|\bminha filha\b|matr[íi]cula (dele|dela|do meu filho|da minha filha|do fundamental|da infantil|no fundamental|na infantil|no m[eé]dio|na m[eé]dio|escolar)|funda[çc][ãa]o|doa[çc][ãa]o|doa[çc][õo]es|projeto(s)? social|projetos sociais|a[çc][ãa]o social|voluntari|parceria(s)? social/i.test(text);
}

/**
 * Verifica se a mensagem é de OUTRA empresa do grupo (não a Faculdade) — usado pelo
 * ai-agent quando o lead JÁ é da Faculdade mas pergunta algo de Igreja/Escola/Fundação/etc
 * (29/09, achado ao vivo: a IA da Faculdade tentava responder sozinha um assunto de Igreja,
 * chutava a empresa errada — "Fundação" em vez de "Igreja" — e ainda fazia handoff pra um
 * consultor da Faculdade sem sentido nenhum). Só chamar quando o canal tem Hub ligado E a
 * mensagem bate no pré-filtro acima — não gasta chamada extra em toda mensagem normal.
 */
export async function checkOtherCompany(
    db: SupabaseClient, settings: any, historico: HubMsg[], nome: string | null,
): Promise<{ destino: HubDest; redirect: string } | null> {
    const dests = await loadDestinations(db);
    const self = dests.find((d) => d.is_self);
    if (!self || !dests.some((d) => !d.is_self)) return null;
    const c = await classify(db, dests, historico, nome, settings);
    if (!c.destino || c.destino.id === self.id || c.destino.id === undefined) return null;
    return { destino: c.destino, redirect: redirectText(c.destino, nome) };
}

function plano(d: HubDest, metodo: string, confianca: number, motivo: string, self: HubDest, nome: string | null, falas: string[]): HubPlano {
    if (d.id === self.id) return { acao: "faculdade", destino: d, metodo, confianca, motivo };
    if (temFila(d)) return { acao: "encaminhar_fila", destino: d, metodo, confianca, motivo, aviso: filaText(d, nome) };
    const ultima = falas.filter((f) => !/^\W*\d\W*$/.test(f.trim())).slice(-2).join(" / ") || falas[falas.length - 1] || "";
    return {
        acao: "encaminhar", destino: d, metodo, confianca, motivo,
        redirect: redirectText(d, nome),
        forward: d.channel_id && d.avisar_destino ? forwardText(d, nome, ultima) : null,
    };
}
