// ticket-transfer — Comercial transfere a conversa do WhatsApp pra Secretaria:
// o lead vira um CHAMADO do Portal do Aluno, com o histórico do WhatsApp junto.
//
//   { lead_id, cpf?, email?, titulo, categoria?, resumo? }   (staff)
//
// - com CPF de aluno do Sponte → garante a conta do portal (senha inicial = CPF)
// - sem CPF (ou fora do Sponte) → chamado só por e-mail (precisa de e-mail)
// - mensagem visível pro aluno: quem transferiu + resumo; nota interna com o
//   histórico do WhatsApp em texto (a conversa completa aparece no chamado via lead_id)
// - o e-mail "transferido pra Secretaria" sai pelo gatilho (origem = 'transferencia')
// Quem chama (o chat do lead) depois manda a mensagem de despedida no WhatsApp e
// finaliza a conversa por lá — pelo mesmo canal (WideChat ou VivaConnect) do lead.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isStaff, jsonRes } from "../_shared/ai.ts";
import { mirror, sv } from "../_shared/db.ts";
import { ensureAlunoAccount } from "../_shared/aluno.ts";
import { cpfDigits } from "../_shared/sponte.ts";

const CATS = ["financeiro", "academico", "secretaria", "suporte_tecnico", "certificado", "cancelamento", "outros"];
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isStaff(caller) || caller?.kind !== "user") return jsonRes({ error: "Não autorizado." }, 401);

    try {
        const body = await req.json().catch(() => ({}));
        const leadId = Number(body.lead_id);
        const titulo = String(body.titulo ?? "").trim();
        const categoria = CATS.includes(body.categoria) ? body.categoria : "secretaria";
        const resumo = String(body.resumo ?? "").trim();
        if (!leadId || !titulo) return jsonRes({ error: "lead_id e título são obrigatórios." }, 400);

        const { data: lead } = await db.from("leads").select("id, nome_completo, email, telefone").eq("id", leadId).maybeSingle();
        if (!lead) return jsonRes({ error: "Lead não encontrado." }, 404);

        // já existe chamado aberto desse lead? não duplica
        const { data: open } = await db.from("tickets").select("id, protocolo").eq("lead_id", leadId)
            .not("status", "in", "(resolvido,fechado)").limit(1).maybeSingle();
        if (open) return jsonRes({ error: `Esse lead já tem o chamado ${open.protocolo} aberto.`, ticket_id: open.id, protocolo: open.protocolo }, 409);

        let aluno: any = null;
        if (cpfDigits(body.cpf).length === 11) {
            const r = await ensureAlunoAccount(db, body.cpf);
            if (r.error) return jsonRes({ error: r.error }, 400);
            aluno = r.aluno;
        }
        const email = String(aluno?.email || body.email || lead.email || "").trim().toLowerCase();
        if (!aluno && !email.includes("@")) return jsonRes({ error: "Informe o CPF do aluno (Sponte) ou um e-mail para o chamado." }, 400);
        if (aluno && !aluno.email && email.includes("@")) await db.from("alunos").update({ email }).eq("id", aluno.id);

        const { data: me } = await db.from("profiles").select("full_name, role").eq("id", caller.id).maybeSingle();
        const agente = me?.full_name ?? "Equipe FICV";

        const { data: ticket, error: tErr } = await db.from("tickets").insert({
            titulo, categoria, prioridade: "media", status: "aberto",
            aluno_id: aluno?.id ?? null, aluno_nome: aluno?.nome ?? lead.nome_completo ?? "Aluno", aluno_email: email,
            lead_id: leadId, origem: "transferencia", transferido_por: caller.id,
        }).select("id, protocolo, created_at").single();
        if (tErr) return jsonRes({ error: `Não foi possível criar o chamado: ${tErr.message}` }, 500);

        // histórico do WhatsApp em texto (nota interna — fica no chamado mesmo se o lead mudar)
        const { data: hist } = await db.from("widechat_messages").select("origin, sender_name, message, type, created_at")
            .eq("lead_id", leadId).order("created_at", { ascending: false }).limit(60);
        const linhas = (hist ?? []).reverse().map((m) => {
            const quem = m.origin === "channel" ? (lead.nome_completo ?? "Aluno") : m.origin === "auto" ? "Bot/IA" : (m.sender_name || "Atendente");
            const txt = m.message || (m.type && m.type !== "text" ? `[${m.type}]` : "");
            return `[${hora(m.created_at)}] ${quem}: ${txt}`;
        });

        await db.from("ticket_messages").insert([
            {
                ticket_id: ticket.id, autor_id: caller.id, autor_nome: agente, autor_role: me?.role ?? "agent", interno: false,
                conteudo: `Olá! Seu atendimento foi transferido para a ${categoria === "secretaria" ? "Secretaria" : "equipe responsável"} por ${agente}.` +
                    (resumo ? `\n\n${resumo}` : "") +
                    `\n\nA partir de agora, todas as tratativas acontecem por aqui (Portal do Aluno) ou respondendo o e-mail do chamado.`,
            },
            {
                ticket_id: ticket.id, autor_id: caller.id, autor_nome: agente, autor_role: me?.role ?? "agent", interno: true,
                conteudo: `📱 Transferido do WhatsApp (lead #${leadId}${lead.telefone ? ` · ${lead.telefone}` : ""}).` +
                    (linhas.length ? `\n\nÚltimas ${linhas.length} mensagens:\n${linhas.join("\n")}` : "\n\nSem mensagens registradas."),
            },
        ]);
        // o e-mail "transferido" já leva essa mensagem — não manda também o aviso de "resposta"
        await db.from("ticket_email_outbox").delete().eq("ticket_id", ticket.id).eq("kind", "reply").eq("status", "pending");

        const now = new Date().toISOString();
        const note = `📨 Transferido para a Secretaria por ${agente} — chamado ${ticket.protocolo}${aluno ? " (Portal do Aluno)" : " (por e-mail)"}.`;
        await db.from("lead_notes").insert({ lead_id: leadId, note, created_at: now });
        await mirror(`INSERT INTO lead_notes [{ lead_id: leads:⟨${leadId}⟩, note: ${sv(note)}, created_at: d${sv(now)} }] RETURN NONE;`);

        return jsonRes({
            ok: true, ticket_id: ticket.id, protocolo: ticket.protocolo, portal: !!aluno, email,
            // texto sugerido pra despedida no WhatsApp (o chat envia pelo canal do lead)
            whatsapp_msg: `Seu atendimento foi transferido para a Secretaria da FICV. 📋 Protocolo: *${ticket.protocolo}*.\n` +
                (aluno
                    ? `A partir de agora, acompanhe e responda pelo Portal do Aluno: https://ficv-sales.vercel.app/aluno (login e senha: seu CPF) ou pelo e-mail ${email}.`
                    : `A partir de agora, as tratativas continuam pelo e-mail ${email} — é só responder a mensagem que enviamos.`),
        });
    } catch (e) {
        console.error("ticket-transfer:", e);
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
