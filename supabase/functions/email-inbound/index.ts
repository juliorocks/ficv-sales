// email-inbound — resposta do aluno direto pelo e-mail entra no chamado.
// Webhook da Resend (evento email.received) → cadastrar em Resend > Webhooks:
//   https://<proj>.supabase.co/functions/v1/email-inbound?key=<app_internal.inbound_key>
// O webhook só traz metadados; o corpo vem de GET /emails/receiving/{id}.
// O chamado sai do endereço assinado chamado-<id>-<sig>@<RESEND_INBOUND_DOMAIN>
// (Reply-To dos nossos e-mails) e o remetente precisa ser o e-mail do aluno.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { getSecret } from "../_shared/secrets.ts";
import { parseTicketReplyAddress } from "../_shared/email.ts";

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Tira a parte citada ("Em … escreveu:", "> …", assinatura "-- ") — fica só a resposta nova. */
function onlyNewText(t: string): string {
    const lines = t.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    for (const l of lines) {
        if (/^\s*(Em .{3,120} escreveu:|On .{3,120} wrote:|-{2,}\s*Mensagem original|-{2,}\s*Original Message|De:\s|From:\s|Enviado do meu|Sent from my)/i.test(l)) break;
        if (/^\s*>/.test(l)) break;
        if (/^--\s*$/.test(l)) break;
        out.push(l);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const htmlToText = (h: string) => h.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n").replace(/<blockquote[\s\S]*$/i, "")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

Deno.serve(async (req) => {
    if (req.method !== "POST") return j({ ok: true });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const key = (await db.from("app_internal").select("value").eq("key", "inbound_key").maybeSingle()).data?.value;
    if (!key || new URL(req.url).searchParams.get("key") !== key) return j({ error: "unauthorized" }, 401);

    const ev = await req.json().catch(() => null);
    if (ev?.type !== "email.received" || !ev.data?.email_id) return j({ ignored: "evento não é email.received" });
    const d = ev.data;

    let ticketId: number | null = null;
    for (const addr of [...(d.to ?? []), ...(d.received_for ?? []), ...(d.cc ?? [])]) {
        ticketId = await parseTicketReplyAddress(db, addr);
        if (ticketId) break;
    }
    if (!ticketId) return j({ ignored: "destinatário não é endereço de chamado" });

    const { data: t } = await db.from("tickets").select("id, protocolo, status, aluno_id, aluno_nome, aluno_email").eq("id", ticketId).maybeSingle();
    if (!t) return j({ ignored: "chamado não existe" });
    const { data: al } = t.aluno_id ? await db.from("alunos").select("email, nome").eq("id", t.aluno_id).maybeSingle() : { data: null };
    const from = String(d.from ?? "").toLowerCase().match(/[^\s<]+@[^\s>]+/)?.[0] ?? "";
    const allowed = [t.aluno_email, al?.email].filter(Boolean).map((e) => String(e).toLowerCase());
    if (!allowed.includes(from)) {
        console.warn(`email-inbound: remetente ${from} não é o aluno do chamado ${t.protocolo}`);
        return j({ ignored: "remetente não confere" });
    }

    const apiKey = await getSecret("RESEND_API_KEY");
    const r = await fetch(`https://api.resend.com/emails/receiving/${d.email_id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const full = await r.json().catch(() => null);
    if (!r.ok) return j({ error: `Resend ${r.status}` }, 502);
    const texto = onlyNewText(full?.text || htmlToText(full?.html || ""));
    if (!texto) return j({ ignored: "e-mail sem texto novo" });

    const { error } = await db.from("ticket_messages").insert({
        ticket_id: t.id, autor_id: t.aluno_id, autor_nome: al?.nome ?? t.aluno_nome, autor_role: "aluno", interno: false,
        conteudo: `${texto}\n\n— respondido por e-mail`,
    });
    if (error) return j({ error: error.message }, 500);
    await db.from("tickets").update({
        updated_at: new Date().toISOString(),
        ...(t.status === "aguardando_aluno" || t.status === "resolvido" ? { status: "em_atendimento" } : {}),
    }).eq("id", t.id);
    return j({ ok: true, ticket: t.protocolo });
});
