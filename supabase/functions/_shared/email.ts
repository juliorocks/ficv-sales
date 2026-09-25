// E-mail transacional via Resend. Chave e remetente em Gestão > Integrações
// (RESEND_API_KEY, RESEND_FROM — ex.: "FICV <atendimento@ficv.edu.br>", domínio
// verificado na Resend).
import { getSecret } from "./secrets.ts";

export async function sendEmail(to: string, subject: string, html: string, replyTo?: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
    const key = await getSecret("RESEND_API_KEY");
    const from = await getSecret("RESEND_FROM");
    if (!key || !from) return { ok: false, error: "Resend não configurada (Gestão > Integrações)." };
    const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => null);
    return r.ok ? { ok: true, id: d?.id } : { ok: false, error: `Resend HTTP ${r.status}: ${d?.message ?? "sem detalhe"}` };
}

const escHtml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export { escHtml };

/** Layout FICV (escuro + dourado, igual ao portal). `body` já é HTML. */
export function emailLayout(title: string, body: string, cta?: { label: string; url: string }, canReply = false) {
    return `<!doctype html><html><body style="margin:0;background:#0A0C10;font-family:Arial,Helvetica,sans-serif;color:#F0EDE8">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0C10;padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#13161D;border:1px solid #2A2D36;border-radius:12px">
<tr><td style="padding:24px 28px 8px;border-bottom:1px solid #2A2D36">
  <div style="font-size:12px;letter-spacing:2px;color:#C9A84C;font-weight:bold">FICV · PORTAL DO ALUNO</div>
  <div style="font-size:20px;font-weight:bold;margin:8px 0 12px;color:#F0EDE8">${escHtml(title)}</div>
</td></tr>
<tr><td style="padding:20px 28px;font-size:14px;line-height:1.6;color:#D8D4CC">${body}
${cta ? `<div style="margin:24px 0 8px"><a href="${cta.url}" style="background:#C9A84C;color:#0A0C10;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;display:inline-block">${escHtml(cta.label)}</a></div>` : ""}
</td></tr>
<tr><td style="padding:14px 28px 22px;font-size:11px;color:#8A8A9A;border-top:1px solid #2A2D36">
  Faculdade Internacional Cidade Viva · ${canReply ? "Você pode responder este e-mail — sua resposta entra direto no chamado." : "Este é um e-mail automático — para responder, use o Portal do Aluno."}
</td></tr></table></td></tr></table></body></html>`;
}

export const PORTAL_URL = "https://ficv-sales.vercel.app/aluno";

// ── resposta por e-mail (Resend inbound) ───────────────────────────────────
// Cada chamado tem um endereço de resposta próprio, assinado:
//   chamado-<id>-<assinatura>@<RESEND_INBOUND_DOMAIN>
// A assinatura (HMAC com app_internal.inbound_key) impede responder em chamado alheio
// trocando o número. Sem RESEND_INBOUND_DOMAIN configurado → sem reply-to (só portal).
async function hmac(key: string, msg: string) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
    return [...sig.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function inboundKey(db: any): Promise<string | null> {
    return (await db.from("app_internal").select("value").eq("key", "inbound_key").maybeSingle()).data?.value ?? null;
}
export async function ticketReplyAddress(db: any, ticketId: number): Promise<string | null> {
    const domain = (await getSecret("RESEND_INBOUND_DOMAIN")).trim().replace(/^@/, "");
    const key = await inboundKey(db);
    if (!domain || !key) return null;
    return `chamado-${ticketId}-${await hmac(key, `ticket:${ticketId}`)}@${domain}`;
}
/** Confere um endereço chamado-<id>-<sig>@… e devolve o id do chamado (ou null). */
export async function parseTicketReplyAddress(db: any, address: string): Promise<number | null> {
    const m = String(address).toLowerCase().match(/chamado-(\d+)-([0-9a-f]{12})@/);
    if (!m) return null;
    const key = await inboundKey(db);
    return key && (await hmac(key, `ticket:${m[1]}`)) === m[2] ? Number(m[1]) : null;
}
