// ticket-emails — envia os e-mails dos chamados pro aluno (Resend). Cron 1/min.
//
// Regras de tempo (a fila é preenchida pelos gatilhos em tickets/ticket_messages):
//   created     → na hora em que o aluno abre o chamado
//   transferred → equipe transferiu a conversa do WhatsApp pra Secretaria (ticket-transfer)
//   reply    → 5 min depois da 1ª resposta pública do atendimento (respostas seguidas
//              viram um e-mail só) e nunca menos de 15 min depois do aviso anterior;
//              não envia se o aluno já respondeu depois (ele está acompanhando)
//   resolved → 5 min depois de marcado resolvido (se continuar resolvido)
//   reminder → chamado "aguardando você" parado há 48h, 1 lembrete por resposta do atendimento
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { identify, jsonRes } from "../_shared/ai.ts";
import { emailLayout, escHtml, portalUrl, sendEmail, ticketReplyAddress } from "../_shared/email.ts";
import { toZproNumber } from "../_shared/vivaconnect.ts";

// Mesmo aviso do e-mail, também por WhatsApp não oficial (canal pool/Baileys, sem custo Meta)
// — pedido do usuário 02/10: "muita gente não fica abrindo e-mail". Best-effort: nunca lança
// (falha aqui não pode derrubar o envio do e-mail, que é o canal garantido).
async function sendTicketWhatsApp(db: any, telefone: string | null | undefined, text: string): Promise<void> {
    try {
        const number = toZproNumber(telefone);
        if (!number || !text) return;
        const { data: settings } = await db.from("vivaconnect_settings").select("enabled").eq("id", 1).maybeSingle();
        if (!settings?.enabled) return;
        const { data: channelId } = await db.rpc("vivaconnect_pick_pool_channel");
        if (!channelId) return;

        // mesma janela de horário comercial do follow-up automático da IA (ai_agent_settings,
        // achado ao vivo 01/10 nesta mesma sessão: "não é legal mandar de madrugada") — fora
        // da janela, agenda pro próximo horário de abertura em vez de mandar na hora.
        const { data: ai } = await db.from("ai_agent_settings").select("followup_window_start, followup_window_end").eq("id", 1).maybeSingle();
        const start = ai?.followup_window_start ?? 8, end = ai?.followup_window_end ?? 20;
        const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date()));
        const dentroDaJanela = hour >= start && hour < end;
        const scheduledAt = dentroDaJanela
            ? new Date()
            : new Date(Date.now() + (hour < start ? start - hour : 24 - hour + start) * 3600_000);

        await db.from("vivaconnect_outbox").insert({
            lead_id: null, channel_id: channelId, kind: "ticket_notice", number, body: text,
            scheduled_at: scheduledAt.toISOString(),
        });
        // dispara o worker agora só se já está na janela (senão fica agendado; o cron do
        // VivaConnect, de 1 em 1 min, pega sozinho quando chegar a hora)
        if (dentroDaJanela) {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vivaconnect-api`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                body: JSON.stringify({ action: "process_outbox" }),
                signal: AbortSignal.timeout(15000),
            }).catch(() => {});
        }
    } catch (e) {
        console.error("ticket-emails: WhatsApp (ignorado):", (e as Error).message);
    }
}

const CAT: Record<string, string> = {
    financeiro: "Financeiro", academico: "Acadêmico", secretaria: "Secretaria", suporte_tecnico: "Suporte Técnico",
    certificado: "Certificado", cancelamento: "Cancelamento", biblioteca: "Biblioteca", outros: "Outros",
};
const first = (s: unknown) => String(s ?? "").trim().split(/\s+/)[0] || "aluno(a)";
const para = (t: string) => escHtml(t).replace(/\n/g, "<br>");
const quote = (who: string, when: string, text: string) =>
    `<div style="border-left:3px solid #C9A84C;background:#0D0F14;padding:10px 14px;margin:10px 0;border-radius:4px">
       <div style="font-size:11px;color:#8A8A9A;margin-bottom:4px">${escHtml(who)} · ${escHtml(when)}</div>${para(text.slice(0, 2000))}</div>`;
const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

Deno.serve(async (req) => {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (caller?.kind !== "service") return jsonRes({ error: "Só o cron." }, 403);

    // lembretes: "aguardando você" há 48h sem lembrete desde a última resposta do atendimento
    const { data: waiting } = await db.from("tickets").select("id, updated_at")
        .eq("status", "aguardando_aluno").lt("updated_at", new Date(Date.now() - 48 * 3600_000).toISOString()).limit(50);
    for (const t of waiting ?? []) {
        const { data: lastStaff } = await db.from("ticket_messages").select("created_at").eq("ticket_id", t.id)
            .neq("autor_role", "aluno").eq("interno", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const { data: rem } = await db.from("ticket_email_outbox").select("id").eq("ticket_id", t.id).eq("kind", "reminder")
            .gte("created_at", lastStaff?.created_at ?? "1970-01-01").limit(1).maybeSingle();
        if (!rem) await db.from("ticket_email_outbox").insert({ ticket_id: t.id, kind: "reminder" }).then(() => {}, () => {});
    }

    const { data: due } = await db.from("ticket_email_outbox").select("*")
        .eq("status", "pending").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(30);
    const out = { sent: 0, skipped: 0, failed: 0 };
    const PORTAL_URL = await portalUrl();

    for (const row of due ?? []) {
        const finish = async (status: "sent" | "skipped" | "failed", extra: Record<string, unknown> = {}) => {
            await db.from("ticket_email_outbox").update({ status, ...extra }).eq("id", row.id);
            out[status === "sent" ? "sent" : status === "skipped" ? "skipped" : "failed"]++;
        };
        if (Date.now() - new Date(row.created_at).getTime() > 24 * 3600_000) { await finish("skipped", { error: "expirado (>24h na fila)" }); continue; }
        const { data: t } = await db.from("tickets").select("id, protocolo, titulo, categoria, status, aluno_id, aluno_nome, aluno_email, created_at, encerrado_pelo_aluno")
            .eq("id", row.ticket_id).maybeSingle();
        if (!t) { await finish("skipped", { error: "chamado não existe mais" }); continue; }
        const { data: al } = t.aluno_id ? await db.from("alunos").select("nome, email, telefone, must_change_password").eq("id", t.aluno_id).maybeSingle() : { data: null };
        const replyTo = await ticketReplyAddress(db, t.id); // null se RESEND_INBOUND_DOMAIN não configurado
        const L = (title: string, body: string, cta?: { label: string; url: string }) => emailLayout(title, body, cta, !!replyTo);
        const to = (al?.email || t.aluno_email || "").trim();
        // sem e-mail válido não pula a linha inteira (o WhatsApp abaixo ainda pode mandar pra
        // quem só tem telefone — achado ao vivo 02/10, pedido do usuário: "muita gente não
        // fica abrindo e-mail") — só marca que a PARTE do e-mail não dá, perto do envio.
        const hasEmail = to.includes("@") && !to.endsWith("@aluno.ficv.br");
        const nome = first(al?.nome ?? t.aluno_nome);
        const tag = `#${t.protocolo}`;
        let subject = "", html = "", waText = "";

        if (row.kind === "transferred") {
            const { data: m } = await db.from("ticket_messages").select("autor_nome, conteudo, created_at").eq("ticket_id", t.id)
                .neq("autor_role", "aluno").eq("interno", false).order("created_at").limit(1).maybeSingle();
            const aberto = new Date(t.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
            subject = `Seu atendimento agora é com a Secretaria — chamado ${tag}`;
            html = L("Chamado aberto na Secretaria", `<p>Olá, ${escHtml(nome)}!</p>
                <p>Sua conversa pelo WhatsApp foi transferida para a <b>Secretaria</b> e virou o chamado
                <b style="color:#C9A84C">${escHtml(t.protocolo)}</b> — ${escHtml(t.titulo)}.</p>
                <p>📅 Chamado aberto em <b>${escHtml(aberto)}</b> — o prazo de atendimento conta a partir daqui.</p>
                ${m ? quote(m.autor_nome || "Equipe FICV", fmt(m.created_at), m.conteudo) : ""}
                <p><b>A partir de agora, todas as tratativas acontecem pelo Portal do Aluno${replyTo ? " ou respondendo este e-mail" : ""}.</b>
                O WhatsApp não será mais usado para este assunto.</p>
                ${t.aluno_id ? `<p style="font-size:13px;color:#8A8A9A">Acesso ao portal: login = seu CPF${al?.must_change_password ? " · senha inicial = seu CPF (só números)" : ""}.</p>` : ""}`,
                t.aluno_id ? { label: "Abrir o Portal do Aluno", url: PORTAL_URL } : undefined);
            waText = `Oi, ${nome}! Sua conversa virou o chamado *${t.protocolo}* — ${t.titulo}, agora com a Secretaria.\n\nA partir de agora as respostas acontecem pelo Portal do Aluno: ${PORTAL_URL}`;
        } else if (row.kind === "created") {
            const { data: m } = await db.from("ticket_messages").select("conteudo").eq("ticket_id", t.id).eq("autor_role", "aluno")
                .order("created_at").limit(1).maybeSingle();
            subject = `Recebemos seu chamado ${tag} — ${t.titulo}`;
            html = L("Recebemos seu chamado", `<p>Olá, ${escHtml(nome)}!</p>
                <p>Seu chamado foi aberto e já está com a nossa equipe (${escHtml(CAT[t.categoria] ?? t.categoria)}).
                Guarde o protocolo: <b style="color:#C9A84C">${escHtml(t.protocolo)}</b>.</p>
                ${m?.conteudo ? quote("Você escreveu", fmt(t.created_at), m.conteudo) : ""}
                <p>Você recebe um e-mail aqui assim que respondermos.</p>`, { label: "Acompanhar no Portal", url: PORTAL_URL });
            waText = `Oi, ${nome}! Recebemos seu chamado *${t.protocolo}* — ${t.titulo}. Guarde esse protocolo.\n\nVocê recebe uma mensagem aqui assim que respondermos. Acompanhe pelo Portal: ${PORTAL_URL}`;
        } else if (row.kind === "reply") {
            const { data: prev } = await db.from("ticket_email_outbox").select("sent_at").eq("ticket_id", t.id).eq("kind", "reply")
                .eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
            const { data: msgs } = await db.from("ticket_messages").select("autor_nome, autor_role, conteudo, created_at, interno")
                .eq("ticket_id", t.id).gt("created_at", prev?.sent_at ?? "1970-01-01").order("created_at");
            const staff = (msgs ?? []).filter((m) => m.autor_role !== "aluno" && !m.interno);
            const lastStaff = staff[staff.length - 1];
            const lastAluno = (msgs ?? []).filter((m) => m.autor_role === "aluno").pop();
            if (!lastStaff) { await finish("skipped", { error: "sem resposta nova" }); continue; }
            if (lastAluno && lastAluno.created_at > lastStaff.created_at) { await finish("skipped", { error: "aluno já respondeu" }); continue; }
            subject = `Nova resposta no seu chamado ${tag} — ${t.titulo}`;
            html = L("Respondemos seu chamado", `<p>Olá, ${escHtml(nome)}!</p>
                <p>Tem resposta nova no chamado <b style="color:#C9A84C">${escHtml(t.protocolo)}</b> — ${escHtml(t.titulo)}:</p>
                ${staff.map((m) => quote(m.autor_nome || "Equipe FICV", fmt(m.created_at), m.conteudo)).join("")}
                ${t.status === "aguardando_aluno" ? "<p><b>Precisamos da sua resposta</b> para continuar o atendimento.</p>" : ""}`,
                { label: "Responder no Portal", url: PORTAL_URL });
            const lastStaffText = String(lastStaff.conteudo ?? "");
            const preview = lastStaffText.length > 220 ? `${lastStaffText.slice(0, 220)}…` : lastStaffText;
            waText = `Oi, ${nome}! Tem resposta nova no seu chamado *${t.protocolo}* — ${t.titulo}:\n\n"${preview}"\n\nResponda pelo Portal: ${PORTAL_URL}`;
        } else if (row.kind === "resolved") {
            if (t.status !== "resolvido") { await finish("skipped", { error: `status mudou para ${t.status}` }); continue; }
            if ((t as any).encerrado_pelo_aluno) { await finish("skipped", { error: "o próprio aluno encerrou" }); continue; }
            subject = `Chamado ${tag} resolvido — ${t.titulo}`;
            html = L("Chamado resolvido", `<p>Olá, ${escHtml(nome)}!</p>
                <p>Marcamos o chamado <b style="color:#C9A84C">${escHtml(t.protocolo)}</b> — ${escHtml(t.titulo)} como <b>resolvido</b>.</p>
                <p>Se ainda precisar de algo, é só responder por lá que ele volta pra equipe. E, se puder, avalie o atendimento — leva 10 segundos. 💛</p>`,
                { label: "Avaliar atendimento", url: PORTAL_URL });
            waText = `Oi, ${nome}! Marcamos seu chamado *${t.protocolo}* — ${t.titulo} como resolvido.\n\nSe ainda precisar de algo, é só responder por lá que ele volta pra equipe. 💛`;
        } else if (row.kind === "reminder") {
            if (t.status !== "aguardando_aluno") { await finish("skipped", { error: `status mudou para ${t.status}` }); continue; }
            subject = `Estamos aguardando sua resposta — chamado ${tag}`;
            html = L("Aguardando sua resposta", `<p>Olá, ${escHtml(nome)}!</p>
                <p>O chamado <b style="color:#C9A84C">${escHtml(t.protocolo)}</b> — ${escHtml(t.titulo)} está esperando uma resposta sua há 2 dias.
                Assim que você responder, a equipe continua o atendimento.</p>`, { label: "Responder no Portal", url: PORTAL_URL });
            waText = `Oi, ${nome}! Seu chamado *${t.protocolo}* — ${t.titulo} está esperando sua resposta há 2 dias.\n\nResponda pelo Portal quando puder: ${PORTAL_URL}`;
        }

        // WhatsApp é independente do e-mail (best-effort, nunca lança) — roda mesmo se o
        // aluno não tiver e-mail válido, que é justamente quem mais precisa desse canal.
        await sendTicketWhatsApp(db, al?.telefone, waText);

        if (!hasEmail) { await finish("skipped", { error: "aluno sem e-mail válido" }); continue; }
        const r = await sendEmail(to, subject, html, replyTo);
        if (r.ok) await finish("sent", { sent_at: new Date().toISOString(), to_email: to, error: null });
        else if (/não configurada/.test(r.error ?? "")) { out.failed++; break; } // sem chave: deixa na fila pra quando configurar
        else await finish("failed", { to_email: to, error: r.error });
    }
    return jsonRes(out);
});
