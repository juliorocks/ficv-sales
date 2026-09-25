// aluno-auth — acesso ao Portal do Aluno (/aluno). Público (verify_jwt = false).
//
//   first_access { cpf, password } → 1º acesso com CPF/CPF (senha padrão do Sponte):
//        confere no Sponte que o CPF é de aluno e cria a conta (e-mail interno
//        <cpf>@aluno.ficv.br, senha = CPF, must_change_password = true). O portal
//        obriga a trocar a senha logo em seguida.
//   forgot { cpf }                  → manda link de redefinição pro e-mail do aluno (Resend)
//
// Respostas genéricas pra não confirmar quais CPFs existem; limite de 10 tentativas
// por CPF a cada 15 min.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { cpfDigits, sponteAlunoByCpf } from "../_shared/sponte.ts";
import { emailLayout, escHtml, PORTAL_URL, sendEmail } from "../_shared/email.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const fmtCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + "*".repeat(Math.min(b.length, 6)) + c);
const GENERIC = "CPF ou senha incorretos.";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    try {
        const body = await req.json().catch(() => ({}));
        const cpf = cpfDigits(body.cpf);
        if (cpf.length !== 11) return j({ error: "CPF inválido." }, 400);

        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { count } = await db.from("aluno_auth_attempts").select("id", { count: "exact", head: true })
            .eq("cpf", cpf).gte("created_at", since);
        if ((count ?? 0) >= 10) return j({ error: "Muitas tentativas. Aguarde 15 minutos e tente de novo." }, 429);
        const log = (action: string, ok: boolean) => db.from("aluno_auth_attempts").insert({ cpf, action, ok });

        const { data: existing } = await db.from("alunos").select("id, email, nome")
            .in("cpf", [cpf, fmtCpf(cpf)]).limit(1).maybeSingle();

        if (body.action === "first_access") {
            // senha padrão = CPF; conta que já existe entra pelo login normal
            if (cpfDigits(body.password) !== cpf || String(body.password ?? "").replace(/[\d.\-\s]/g, "") !== "" || existing) {
                await log("first_access", false);
                return j({ error: GENERIC }, 401);
            }
            const s = await sponteAlunoByCpf(cpf);
            if (!s) {
                await log("first_access", false);
                return j({ error: "Não encontramos esse CPF entre os alunos da FICV. Procure a secretaria." }, 404);
            }
            const { data: created, error: cErr } = await db.auth.admin.createUser({
                email: `${cpf}@aluno.ficv.br`, password: cpf, email_confirm: true,
                user_metadata: { nome: s.nome, sponte_aluno_id: s.aluno_id },
            });
            if (cErr || !created.user) {
                await log("first_access", false);
                return j({ error: GENERIC }, 401);
            }
            const { error: iErr } = await db.from("alunos").insert({
                id: created.user.id, cpf: fmtCpf(cpf), nome: s.nome, email: s.email ?? "", telefone: s.celular,
                ra: s.ra, sponte_aluno_id: s.aluno_id, must_change_password: true,
            });
            if (iErr) {
                await db.auth.admin.deleteUser(created.user.id);
                return j({ error: "Não foi possível criar seu acesso agora. Tente de novo em instantes." }, 500);
            }
            await log("first_access", true);
            return j({ ok: true });
        }

        if (body.action === "forgot") {
            await log("forgot", !!existing);
            if (!existing) {
                return j({ ok: true, message: "Se for seu primeiro acesso, entre com o CPF como senha. Senão, procure a secretaria." });
            }
            if (!existing.email) return j({ error: "Não há e-mail cadastrado para esse CPF. Procure a secretaria para atualizar." }, 400);
            const { data: link, error: lErr } = await db.auth.admin.generateLink({
                type: "recovery", email: `${cpf}@aluno.ficv.br`, options: { redirectTo: PORTAL_URL },
            });
            if (lErr || !link?.properties?.action_link) return j({ error: "Não foi possível gerar o link agora." }, 500);
            const sent = await sendEmail(existing.email, "Redefinição de senha — Portal do Aluno FICV", emailLayout(
                "Redefinir sua senha",
                `<p>Olá, ${escHtml(String(existing.nome ?? "").split(" ")[0])}!</p>
                 <p>Recebemos um pedido para redefinir a senha do seu Portal do Aluno. Clique no botão abaixo (o link vale por 1 hora).</p>
                 <p style="color:#8A8A9A;font-size:12px">Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>`,
                { label: "Criar nova senha", url: link.properties.action_link },
            ));
            if (!sent.ok) return j({ error: "Não foi possível enviar o e-mail agora. Procure a secretaria." }, 502);
            return j({ ok: true, message: `Enviamos um link para ${maskEmail(existing.email)}.` });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("aluno-auth:", e);
        return j({ error: "Serviço indisponível no momento. Tente de novo em instantes." }, 500);
    }
});
