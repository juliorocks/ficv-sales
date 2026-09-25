// kb-ask — consulta à Base de Conhecimento pelos ATENDENTES (chat do lead, chamado,
// tela da Base). A IA só redige: devolve uma resposta pronta pra copiar/inserir e as
// fontes; quem decide enviar é o atendente.
//
//   { pergunta?, conversa?: [{de:'cliente'|'atendente', texto}], publico?: 'vendas'|'alunos'|'todos',
//     contexto?: { nome?, curso? } }
//   sem pergunta + conversa → "sugerir resposta" pra última fala do cliente
//   → { resposta, encontrado, fontes: [{ titulo, trecho, similaridade }] }
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { chatJSON, corsHeaders, identify, jsonRes, searchKnowledge } from "../_shared/ai.ts";

const TEAM = ["admin", "agent", "secretaria", "tutor", "coordenador"];
const hoje = () => new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!(caller?.kind === "service" || (caller?.kind === "user" && TEAM.includes(caller.role)))) return jsonRes({ error: "Não autorizado." }, 401);

    try {
        const body = await req.json().catch(() => ({}));
        const publico = ["vendas", "alunos", "todos"].includes(body.publico) ? body.publico : "todos";
        const conversa: { de: string; texto: string }[] = (body.conversa ?? []).filter((m: any) => m?.texto).slice(-12);
        const pergunta = String(body.pergunta ?? "").trim();
        const ultimasDoCliente = conversa.filter((m) => m.de === "cliente").slice(-3).map((m) => m.texto).join("\n");
        const consulta = pergunta || ultimasDoCliente;
        if (!consulta) return jsonRes({ error: "Escreva a pergunta (ou abra numa conversa pra sugerir resposta)." }, 400);

        const { data: s } = await db.from("ai_agent_settings").select("chat_model, embedding_model, match_count").eq("id", 1).single();
        const trechos = await searchKnowledge(db, consulta, {
            publico, embeddingModel: s?.embedding_model ?? "text-embedding-3-small", count: Math.max(6, s?.match_count ?? 6),
            focus: pergunta || conversa.filter((m) => m.de === "cliente").slice(-1)[0]?.texto,
        }) as any[];
        const kb = trechos.length ? trechos.map((h, i) => `[${i + 1}] (${h.title}) ${h.content}`).join("\n\n---\n\n") : "(nada encontrado na base)";

        const ctx = body.contexto ?? {};
        const system = [
            `Você ajuda um ATENDENTE da FICV (Faculdade Internacional Cidade Viva) a responder um ${publico === "alunos" ? "aluno" : "cliente/lead"}. Hoje é ${hoje()}.`,
            `Use SOMENTE a base de conhecimento abaixo como fonte de fatos. Nunca invente valores, datas, prazos ou condições.`,
            `Escreva a "resposta" já pronta pra o atendente enviar${publico === "alunos" ? "" : " pelo WhatsApp"}: cordial, curta (até 2 parágrafos), em português do Brasil, sem markdown de títulos (negrito com *texto* é ok).`,
            ctx.nome ? `Nome do ${publico === "alunos" ? "aluno" : "cliente"}: ${ctx.nome}.` : "",
            ctx.curso ? `Curso de interesse/matriculado: ${ctx.curso}.` : "",
            `Se a pergunta é sobre um curso específico, use SÓ informações desse curso — nunca responda com dados de outro curso de nome parecido (ex.: Psicoteologia ≠ Psicopedagogia). A informação de um curso pode estar num documento geral (ex.: "Orientações Gerais"), não só no PPC dele.`,
            `Se a base citar uma data que JÁ PASSOU (início de turma, prazo, promoção), não a apresente como futura; prefira a data mais recente que houver na base (documentos gerais costumam estar mais atualizados que PPCs).`,
            `Se a base não responder, "encontrado" = false e "resposta" = uma frase curta dizendo ao atendente o que não foi encontrado (não escreva pro cliente nesse caso).`,
            `Responda em JSON: {"resposta": "...", "encontrado": true|false, "fontes_usadas": [números dos trechos usados]}`,
            `BASE DE CONHECIMENTO:\n\n${kb}`,
        ].filter(Boolean).join("\n\n");

        const msgs = [
            { role: "system", content: system },
            ...(conversa.length ? [{ role: "user", content: `Conversa até agora:\n${conversa.map((m) => `${m.de === "cliente" ? "Cliente" : "Atendente"}: ${m.texto}`).join("\n")}` }] : []),
            { role: "user", content: pergunta ? `Pergunta do atendente: ${pergunta}` : "Sugira a próxima resposta do atendente para a última mensagem do cliente." },
        ];
        const { json } = await chatJSON(s?.chat_model ?? "gpt-4.1-mini", 0.3, msgs);
        const usadas: number[] = Array.isArray(json.fontes_usadas) ? json.fontes_usadas.map(Number) : [];
        const fontes = (usadas.length ? usadas.map((n) => trechos[n - 1]).filter(Boolean) : trechos.slice(0, 3))
            .map((h: any) => ({ titulo: h.title, trecho: String(h.content).slice(0, 280), similaridade: Math.round(h.similarity * 100) }));
        return jsonRes({ resposta: String(json.resposta ?? "").trim(), encontrado: json.encontrado !== false && trechos.length > 0, fontes });
    } catch (e) {
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
