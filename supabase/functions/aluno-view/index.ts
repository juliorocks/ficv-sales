// aluno-view — admin mostra o Portal do Aluno como o aluno vê, SÓ LEITURA, com link que expira.
//   create { aluno_id }        (admin, JWT) → token de 15 min (guardado só como hash)
//   overview { token }         → mesmo dado do painel do aluno (Início/Financeiro/Notas)
//   boletim  { token, turmas } → boletim das turmas pedidas
// Sem sessão de login de verdade: não dá pra trocar senha, pagar nem mandar mensagem.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { boletimFor, overviewFor } from "../_shared/alunoPortalCore.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const VALIDADE_MIN = 15;

const sha256 = async (s: string) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const novoToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    try {
        const body = await req.json().catch(() => ({}));

        if (body.action === "create") {
            const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
            const { data: { user } } = await db.auth.getUser(jwt);
            if (!user) return j({ error: "Sessão inválida." }, 401);
            const { data: caller } = await db.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
            if (caller?.role !== "admin") return j({ error: "Só admin pode ver o portal do aluno." }, 403);
            const alunoId = String(body.aluno_id ?? "");
            if (!alunoId) return j({ error: "aluno_id obrigatório." }, 400);
            const { data: aluno } = await db.from("alunos").select("id").eq("id", alunoId).maybeSingle();
            if (!aluno) return j({ error: "Aluno não encontrado." }, 404);
            const token = novoToken();
            const expires = new Date(Date.now() + VALIDADE_MIN * 60_000).toISOString();
            const { error } = await db.from("aluno_view_links").insert({
                token_hash: await sha256(token), aluno_id: alunoId, created_by: caller.id, expires_at: expires,
            });
            if (error) return j({ error: error.message }, 500);
            return j({ token, expires_at: expires });
        }

        if (body.action === "overview" || body.action === "boletim") {
            const token = String(body.token ?? "");
            if (!token) return j({ error: "Link inválido." }, 404);
            const hash = await sha256(token);
            const { data: link } = await db.from("aluno_view_links").select("aluno_id, created_by, expires_at").eq("token_hash", hash).maybeSingle();
            if (!link) return j({ error: "Link inválido." }, 404);
            if (new Date(link.expires_at).getTime() < Date.now()) return j({ error: "Este link expirou. Gere um novo na tela de usuários." }, 410);
            const { data: aluno } = await db.from("alunos")
                .select("id, nome, cpf, email, telefone, ra, sponte_aluno_id, nivel").eq("id", link.aluno_id).maybeSingle();
            if (!aluno?.sponte_aluno_id) return j({ error: "Aluno sem matrícula vinculada ao Sponte." }, 404);
            await db.from("aluno_view_log").insert({ token_hash: hash, aluno_id: aluno.id, created_by: link.created_by, acao: body.action });
            if (body.action === "boletim") {
                const r = await boletimFor(aluno.sponte_aluno_id, aluno.email ?? null, body);
                return j(r.body, r.status);
            }
            return j(await overviewFor(db, aluno as any));
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("aluno-view:", e);
        return j({ error: "Não foi possível carregar agora." }, 502);
    }
});
