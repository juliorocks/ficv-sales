// Hub do Grupo Cidade Viva — o número oficial antigo (83 3041-7471) recebe gente de
// todas as empresas do grupo. Aqui fica a decisão: pra qual empresa vai cada contato.
// Usado pelo vivaconnect-webhook (de verdade) e pelo vivaconnect-api action=hub_simulate.
import { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import { chatJSON } from "./ai.ts";
import { fillTemplate, firstName, onlyDigits } from "./vivaconnect.ts";

export type HubDest = {
    id: number; nome: string; emoji: string; assuntos: string; is_self: boolean; numero: string | null;
    channel_id: number | null; avisar_destino: boolean; mensagem_redirect: string; mensagem_destino: string;
    ativo: boolean; ordem: number; mensagem_sem_numero?: string | null;
};
export const temNumero = (d: HubDest) => onlyDigits(d.numero).length >= 10;
export type HubMsg = { de: "contato" | "hub"; texto: string; em: string };
export type Classificacao = { destino: HubDest | null; confianca: number; motivo: string; metodo: "ia" | "menu" };

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

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

export function menuText(template: string, dests: HubDest[], nome: string | null | undefined): string {
    const opcoes = dests.map((d, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${d.emoji} ${d.nome}`).join("\n");
    return fillTemplate(template, vars(nome, { opcoes }));
}

export function redirectText(d: HubDest, nome: string | null | undefined): string {
    if (!temNumero(d)) return fillTemplate(d.mensagem_sem_numero || SEM_NUMERO_PADRAO, vars(nome, { empresa: d.nome }));
    return fillTemplate(d.mensagem_redirect, vars(nome, { empresa: d.nome, numero: formatNumero(d.numero), link: waLink(d.numero) }));
}
export function forwardText(d: HubDest, nome: string | null | undefined, mensagem: string): string {
    const m = mensagem.length > 300 ? `${mensagem.slice(0, 300)}…` : mensagem;
    return fillTemplate(d.mensagem_destino, vars(nome, { empresa: d.nome, mensagem: m }));
}

/** Resposta ao menu: "2", "2️⃣", "opção 2", ou o nome da empresa ("igreja"). */
export function parseMenuReply(texto: string, dests: HubDest[]): HubDest | null {
    const t = texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const emojiIdx = NUM_EMOJI.findIndex((e) => texto.includes(e));
    if (emojiIdx >= 0 && dests[emojiIdx]) return dests[emojiIdx];
    const n = t.match(/^\D{0,12}(\d)\D{0,3}$/);
    if (n && dests[Number(n[1]) - 1]) return dests[Number(n[1]) - 1];
    return null;
}

/**
 * IA decide o destino pela(s) mensagem(ns) do contato. Saudação sozinha / sem assunto →
 * destino null (vai pro menu). Confiança baixa também vira menu (melhor perguntar do que errar).
 */
export async function classify(db: SupabaseClient, dests: HubDest[], falas: string[]): Promise<Classificacao> {
    const { data: s } = await db.from("ai_agent_settings").select("chat_model").eq("id", 1).maybeSingle();
    const lista = dests.map((d) => `- id ${d.id}: ${d.nome}${d.is_self ? " (este número)" : ""} — ${d.assuntos}`).join("\n");
    const system = [
        "Você faz a TRIAGEM do WhatsApp antigo do Grupo Cidade Viva (várias instituições usavam o mesmo número).",
        "Leia o que a pessoa escreveu e diga com QUAL instituição ela quer falar, pela lista abaixo.",
        "Se for só cumprimento, agradecimento ou não der pra saber o assunto, destino = null.",
        "Não chute: na dúvida entre duas, destino = null. Ex.: 'matrícula' sozinho é ambíguo (faculdade ou escola) → null; 'matrícula do meu filho no fundamental' → escola; 'vestibular de teologia' → faculdade; 'quero ser membro' → igreja.",
        "Regras fixas: 'membro', 'membresia', 'batismo', 'culto', 'célula', 'pastor', 'oração' → IGREJA (a faculdade tem ALUNOS, nunca membros). Educação infantil, fundamental, ensino médio, filho/criança na escola → ESCOLA. Vestibular, graduação, pós, curso superior, EAD da faculdade, diploma → FACULDADE.",
        "Se o assunto for de uma instituição que NÃO está na lista, destino = null.",
        `INSTITUIÇÕES:\n${lista}`,
        'Responda em JSON: {"destino": <id numérico ou null>, "confianca": 0 a 1, "motivo": "frase curta"}',
    ].join("\n\n");
    try {
        const { json } = await chatJSON(s?.chat_model ?? "gpt-4.1-mini", 0, [
            { role: "system", content: system },
            { role: "user", content: falas.slice(-4).join("\n") },
        ]);
        const id = json.destino == null ? null : Number(json.destino);
        const conf = Math.max(0, Math.min(1, Number(json.confianca) || 0));
        const d = id != null ? dests.find((x) => x.id === id) ?? null : null;
        return { destino: d && conf >= 0.6 ? d : null, confianca: conf, motivo: String(json.motivo ?? "").slice(0, 300), metodo: "ia" };
    } catch (e) {
        // sem OpenAI / erro → menu (nunca trava o atendimento)
        return { destino: null, confianca: 0, motivo: `IA indisponível: ${(e as Error).message}`.slice(0, 300), metodo: "ia" };
    }
}

export type HubPlano =
    | { acao: "faculdade"; destino: HubDest; metodo: string; confianca: number; motivo: string }
    | { acao: "encaminhar"; destino: HubDest; metodo: string; confianca: number; motivo: string; redirect: string; forward: string | null }
    | { acao: "menu"; texto: string; motivo: string }
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

    const falasAnteriores = (sessao?.messages ?? []).filter((m) => m.de === "contato").map((m) => m.texto);

    // respondeu o menu?
    if (sessao?.status === "perguntando" && sessao.menus > 0) {
        const escolhido = parseMenuReply(texto, dests);
        if (escolhido) return plano(escolhido, "menu", 1, `escolheu a opção "${texto.trim()}" no menu`, self, nome, falasAnteriores.concat(texto));
    }

    const c = await classify(db, dests, falasAnteriores.concat(texto));
    if (c.destino) {
        // já encaminhado pra essa mesma empresa há pouco → não repete a mensagem
        if (sessao?.status === "encaminhado" && sessao.destination_id === c.destino.id && sessao.redirected_at
            && Date.now() - new Date(sessao.redirected_at).getTime() < 12 * 3600_000) {
            return { acao: "ignorar", motivo: `já encaminhado para ${c.destino.nome} há menos de 12h` };
        }
        return plano(c.destino, c.metodo, c.confianca, c.motivo, self, nome, falasAnteriores.concat(texto));
    }
    if ((sessao?.menus ?? 0) >= (settings.hub_max_menus ?? 2)) {
        return { acao: "faculdade", destino: self, metodo: "fallback", confianca: 0, motivo: `sem assunto claro depois de ${sessao?.menus} menu(s) — segue no atendimento da Faculdade (equipe vê no Kanban)` };
    }
    if (sessao?.status === "encaminhado") return { acao: "ignorar", motivo: "já encaminhado; nova mensagem sem assunto claro" };
    return { acao: "menu", texto: menuText(settings.hub_menu_template, dests, nome), motivo: c.motivo || "sem assunto claro" };
}

function plano(d: HubDest, metodo: string, confianca: number, motivo: string, self: HubDest, nome: string | null, falas: string[]): HubPlano {
    if (d.id === self.id) return { acao: "faculdade", destino: d, metodo, confianca, motivo };
    const ultima = falas.filter((f) => !/^\W*\d\W*$/.test(f.trim())).slice(-2).join(" / ") || falas[falas.length - 1] || "";
    return {
        acao: "encaminhar", destino: d, metodo, confianca, motivo,
        redirect: redirectText(d, nome),
        forward: d.channel_id && d.avisar_destino ? forwardText(d, nome, ultima) : null,
    };
}
