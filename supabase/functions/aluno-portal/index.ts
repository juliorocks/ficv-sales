// aluno-portal — dados do Sponte do aluno LOGADO no Portal do Aluno (/aluno).
// Só enxerga o próprio aluno: o AlunoID vem de alunos.sponte_aluno_id do usuário
// do JWT, nunca do corpo da requisição.
//
//   overview                                  → dados, matrículas (+ períodos só-Moodle, ver
//                                                abaixo), parcelas
//   boletim  { turma_id }                     → notas/faltas por disciplina
//   boletim  { turmas: [{turma_id, turma}] }  → o mesmo, de vários períodos de uma vez
//                                                (turma_id negativo = período só-Moodle, ver
//                                                periodosExtrasDoMoodle)
//   foto                                      → foto do aluno (data URL) ou null
//   pagamento { conta_receber_id, numero_parcela } → link Sponte Pay ou linha digitável
//
// overview/boletim reusam _shared/alunoPortalCore.ts (mesma lógica usada por staff-tickets
// pro atendente ver o painel de QUALQUER aluno durante um chamado — garante que os dois
// mostrem exatamente o mesmo dado).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { alunoFoto, alunoPagamento } from "../_shared/alunoSponte.ts";
import { boletimFor, overviewFor } from "../_shared/alunoPortalCore.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user?.email?.endsWith("@aluno.ficv.br")) return j({ error: "Sessão inválida." }, 401);
    const { data: aluno } = await db.from("alunos").select("id, nome, cpf, email, telefone, ra, sponte_aluno_id, nivel").eq("id", user.id).maybeSingle();
    if (!aluno?.sponte_aluno_id) return j({ error: "Sua conta ainda não está ligada ao Sponte. Procure a secretaria." }, 404);
    const A = aluno.sponte_aluno_id;

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "overview";

        if (action === "overview") return j(await overviewFor(db, aluno as any));

        if (action === "boletim") {
            const r = await boletimFor(A, aluno.email ?? null, body);
            return j(r.body, r.status);
        }

        if (action === "foto") return j({ foto: await alunoFoto(A) });

        if (action === "pagamento") {
            const r = await alunoPagamento(A, Number(body.conta_receber_id), Number(body.numero_parcela));
            if (r.notFound) return j({ error: "Parcela não encontrada." }, 404);
            return j(r);
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("aluno-portal:", e);
        return j({ error: (e as Error).message.includes("Token do Sponte") ? "Portal em manutenção (Sponte não configurado)." : "Não foi possível falar com o Sponte agora. Tente de novo em instantes." }, 502);
    }
});
