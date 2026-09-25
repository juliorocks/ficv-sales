// tutor-virtual — IA que responde primeiro os chamados do Portal do Aluno.
//
//   { ticket_id, message_id }   ← gatilho do banco (x-cron-key) quando o aluno escreve
//   { action: "handoff", ticket_id }     ← aluno clicou "Falar com a equipe"
//   { action: "reactivate", ticket_id }  ← equipe devolve o chamado pro tutor
//
// Responde com a base de conhecimento dos ALUNOS (knowledge_base.publico alunos/ambos)
// e consulta o Sponte do próprio aluno por ferramentas (matrículas, financeiro, link de
// pagamento, notas). Passa pra fila humana pela ferramenta passar_para_equipe ou ao
// estourar o limite de respostas. Equipe respondendo → gatilho tira o tutor do chamado.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { chatWithTools, corsHeaders, embed, identify, jsonRes, toVector } from "../_shared/ai.ts";
import { alunoBoletim, alunoOverview, alunoPagamento } from "../_shared/alunoSponte.ts";

const hoje = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const TOOLS = [
    { name: "consultar_matriculas", description: "Matrículas do aluno no sistema acadêmico: curso, turma (turma_id), situação, datas.", parameters: { type: "object", properties: {} } },
    { name: "consultar_financeiro", description: "Parcelas do aluno: em aberto, em atraso e pagas, com vencimento, valor e identificadores (conta_receber_id, numero_parcela).", parameters: { type: "object", properties: {} } },
    {
        name: "link_pagamento", description: "Gera o link de pagamento (Sponte Pay) ou a linha digitável de UMA parcela do aluno.",
        parameters: { type: "object", properties: { conta_receber_id: { type: "integer" }, numero_parcela: { type: "integer" } }, required: ["conta_receber_id", "numero_parcela"] },
    },
    {
        name: "consultar_notas", description: "Notas, médias e faltas por disciplina de uma turma do aluno (use o turma_id de consultar_matriculas).",
        parameters: { type: "object", properties: { turma_id: { type: "integer" } }, required: ["turma_id"] },
    },
    {
        name: "passar_para_equipe", description: "Transfere o chamado para a equipe humana (Secretaria/Tutoria). Use conforme as regras de handoff.",
        parameters: { type: "object", properties: { motivo: { type: "string" }, resumo: { type: "string", description: "Resumo pra equipe: o que o aluno pediu, o que já foi respondido/consultado." } }, required: ["motivo", "resumo"] },
    },
];

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    const body = await req.json().catch(() => ({}));
    const ticketId = Number(body.ticket_id);
    if (!ticketId) return jsonRes({ error: "ticket_id obrigatório." }, 400);

    const { data: t } = await db.from("tickets")
        .select("id, protocolo, titulo, categoria, status, nivel, aluno_id, aluno_nome, ai_status, ai_turns, curso:courses(name)")
        .eq("id", ticketId).maybeSingle();
    if (!t) return jsonRes({ error: "Chamado não encontrado." }, 404);
    const { data: s } = await db.from("tutor_settings").select("*").eq("id", 1).single();

    // ── aluno pede humano / equipe reativa ──────────────────────────────────
    if (body.action === "handoff" || body.action === "reactivate") {
        const isOwner = caller?.kind === "user" && caller.id === t.aluno_id;
        const isTeam = caller?.kind === "service" || (caller?.kind === "user" && ["admin", "agent", "secretaria", "tutor", "coordenador"].includes(caller.role));
        if (body.action === "handoff" && !isOwner && !isTeam) return jsonRes({ error: "Não autorizado." }, 401);
        if (body.action === "reactivate" && !isTeam) return jsonRes({ error: "Não autorizado." }, 401);
        if (body.action === "handoff") {
            await db.from("tickets").update({ ai_status: "handed_off", status: "aberto" }).eq("id", t.id);
            await db.from("ticket_messages").insert({
                ticket_id: t.id, autor_id: null, autor_nome: s?.nome ?? "Tutor Virtual", autor_role: "tutor_virtual", interno: false,
                conteudo: "Certo! Passei seu chamado para a nossa equipe. Assim que alguém responder, você recebe aqui e por e-mail. 😉",
            });
        } else {
            await db.from("tickets").update({ ai_status: "active", ai_turns: 0 }).eq("id", t.id);
        }
        return jsonRes({ ok: true });
    }

    // ── resposta (só o gatilho do banco) ────────────────────────────────────
    if (caller?.kind !== "service") return jsonRes({ error: "Não autorizado." }, 401);
    if (!s?.enabled) return jsonRes({ skipped: "tutor desligado" });
    if (t.ai_status !== "active") return jsonRes({ skipped: `tutor fora do chamado (${t.ai_status})` });

    // aluno mandou várias mensagens seguidas: responde uma vez só, à última
    await new Promise((r) => setTimeout(r, 2500));
    const { data: lastAluno } = await db.from("ticket_messages").select("id").eq("ticket_id", t.id).eq("autor_role", "aluno")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (body.message_id && lastAluno && Number(lastAluno.id) !== Number(body.message_id)) return jsonRes({ skipped: "mensagem mais nova vai ser respondida" });

    const handoff = async (motivo: string, resumo: string, aviso?: string) => {
        if (aviso) {
            await db.from("ticket_messages").insert({ ticket_id: t.id, autor_id: null, autor_nome: s.nome, autor_role: "tutor_virtual", interno: false, conteudo: aviso });
        }
        await db.from("ticket_messages").insert({
            ticket_id: t.id, autor_id: null, autor_nome: s.nome, autor_role: "tutor_virtual", interno: true,
            conteudo: `🤖 ${s.nome} passou para a equipe — ${motivo}${resumo ? `\n\nResumo: ${resumo}` : ""}`,
        });
        await db.from("tickets").update({ ai_status: "handed_off", status: "aberto" }).eq("id", t.id);
    };

    try {
        if ((t.ai_turns ?? 0) >= s.max_turns) {
            await handoff(`limite de ${s.max_turns} respostas automáticas`, "", "Vou passar seu chamado para a nossa equipe continuar com você. Assim que alguém responder, você recebe aqui e por e-mail.");
            return jsonRes({ handoff: true, reason: "max_turns" });
        }

        const { data: msgs } = await db.from("ticket_messages").select("autor_role, autor_nome, conteudo, created_at")
            .eq("ticket_id", t.id).eq("interno", false).order("created_at").limit(40);
        const conversa = (msgs ?? []).map((m) => m.autor_role === "aluno"
            ? { role: "user", content: m.conteudo }
            : { role: "assistant", content: m.autor_role === "tutor_virtual" ? m.conteudo : `[${m.autor_nome} (equipe)]: ${m.conteudo}` });
        if (!conversa.length || conversa[conversa.length - 1].role !== "user") return jsonRes({ skipped: "sem fala nova do aluno" });

        const { data: al } = t.aluno_id ? await db.from("alunos").select("nome, sponte_aluno_id, nivel").eq("id", t.aluno_id).maybeSingle() : { data: null };
        const A = al?.sponte_aluno_id ?? null;

        // base de conhecimento dos alunos
        const { data: ai } = await db.from("ai_agent_settings").select("embedding_model, match_count, min_similarity").eq("id", 1).single();
        const pergunta = [t.titulo, ...conversa.filter((m) => m.role === "user").slice(-3).map((m) => m.content)].join("\n");
        const [qv] = await embed([pergunta], ai?.embedding_model ?? "text-embedding-3-small");
        const { data: hits } = await db.rpc("match_knowledge_chunks", {
            query_embedding: toVector(qv), match_count: ai?.match_count ?? 6, min_similarity: Number(ai?.min_similarity ?? 0.25), p_publico: "alunos",
        });
        const kb = (hits ?? []).length ? (hits as any[]).map((h, i) => `[${i + 1}] (${h.title}) ${h.content}`).join("\n\n---\n\n")
            : "(nenhum trecho relevante na base de conhecimento)";

        let handoffCall: { motivo: string; resumo: string } | null = null;
        const run = async (name: string, args: any) => {
            if (name === "passar_para_equipe") { handoffCall = { motivo: String(args.motivo ?? ""), resumo: String(args.resumo ?? "") }; return { ok: true }; }
            if (!A) return { erro: "Este chamado não está ligado a um aluno do sistema acadêmico — não dá pra consultar dados." };
            if (name === "consultar_matriculas") return (await alunoOverview(A)).matriculas;
            if (name === "consultar_financeiro") {
                const { parcelas } = await alunoOverview(A);
                const hojeISO = new Date().toISOString().slice(0, 10);
                return parcelas.map((p) => ({
                    ...p, valor_fmt: brl(p.valor),
                    status: p.data_pagamento || /quit|pag|baix/i.test(p.situacao ?? "") ? "paga" : p.vencimento && p.vencimento < hojeISO ? "em atraso" : "a vencer",
                }));
            }
            if (name === "link_pagamento") return await alunoPagamento(A, Number(args.conta_receber_id), Number(args.numero_parcela));
            if (name === "consultar_notas") return (await alunoBoletim(A, Number(args.turma_id))) ?? { erro: "Turma não encontrada entre as matrículas do aluno." };
            return { erro: "ferramenta desconhecida" };
        };

        const system = [
            s.system_prompt,
            `Seu nome é ${s.nome}. Agora é ${hoje()} (horário de Brasília).`,
            s.handoff_instructions + `\nPara passar para a equipe, chame a ferramenta passar_para_equipe E escreva uma resposta curta avisando o aluno que a equipe vai continuar por aqui (nesse caso NÃO pergunte se pode ajudar em mais alguma coisa).,
            `Chamado ${t.protocolo} — assunto: ${t.titulo} (categoria: ${t.categoria}${t.nivel ? `, ${t.nivel === "pos" ? "Pós-graduação" : "Graduação"}` : ""}${(t as any).curso?.name ? `, curso: ${(t as any).curso.name}` : ""}).`,
            `Aluno: ${al?.nome ?? t.aluno_nome}${A ? "" : " (sem vínculo com o sistema acadêmico — ferramentas de consulta indisponíveis)"}.`,
            `Formatação: texto simples, sem markdown de títulos; valores em R$; datas no formato dd/mm/aaaa.`,
            `BASE DE CONHECIMENTO (única fonte para regras e procedimentos):\n\n${kb}`,
        ].join("\n\n");

        const { text, toolsUsed } = await chatWithTools(s.chat_model, Number(s.temperature), [{ role: "system", content: system }, ...conversa], TOOLS, run);
        const reply = text || "Vou passar seu chamado para a nossa equipe, que vai continuar com você por aqui.";

        await db.from("ticket_messages").insert({ ticket_id: t.id, autor_id: null, autor_nome: s.nome, autor_role: "tutor_virtual", interno: false, conteudo: reply });
        await db.from("tickets").update({ ai_turns: (t.ai_turns ?? 0) + 1, ...(handoffCall || !text ? {} : { status: "aguardando_aluno" }) }).eq("id", t.id);
        const hc = handoffCall as { motivo: string; resumo: string } | null;
        if (hc || !text) await handoff(hc?.motivo ?? "o tutor não conseguiu responder", hc?.resumo ?? "");

        return jsonRes({ ok: true, handoff: !!(hc || !text), tools: toolsUsed, sources: (hits ?? []).length });
    } catch (e) {
        console.error("tutor-virtual:", e);
        await handoff(`erro no tutor: ${(e as Error).message.slice(0, 200)}`, "", "Vou passar seu chamado para a nossa equipe, que vai continuar com você por aqui.");
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
