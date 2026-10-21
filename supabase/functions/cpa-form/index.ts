// cpa-form — endpoint PÚBLICO da Avaliação CPA (página /avaliacao/:token). Sem verify_jwt.
//   get    { token }             -> formulário, blocos e perguntas (só se status teste/aberto)
//   submit { token, respostas }  -> valida tudo no servidor e grava pela cpa_registrar_resposta
// Respostas são anônimas: nada que identifique o respondente é gravado.
import { pg } from "../_shared/db.ts";
import { validarRespostas } from "../_shared/cpa.ts";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db = pg();
    try {
        const body = await req.json().catch(() => ({}));
        const token = String(body.token ?? "").trim();
        if (!/^[a-f0-9]{32}$/.test(token)) return j({ error: "Link inválido." }, 404);

        const { data: f } = await db.from("cpa_formularios")
            .select("id, nivel, titulo, ano, status, intro")
            .eq("token", token).maybeSingle();
        if (!f || f.status === "encerrado") return j({ error: "Esta avaliação não está disponível." }, 404);

        if (body.action === "get" || !body.action) {
            const [{ data: blocos }, { data: perguntas }] = await Promise.all([
                db.from("cpa_blocos").select("id, ordem, titulo, incentivo").eq("formulario_id", f.id).order("ordem"),
                db.from("cpa_perguntas")
                    .select("id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max, opcoes, obrigatoria, chave")
                    .eq("formulario_id", f.id).order("ordem"),
            ]);
            return j({
                formulario: { id: f.id, nivel: f.nivel, titulo: f.titulo, ano: f.ano, intro: f.intro, teste: f.status === "teste" },
                blocos: blocos ?? [],
                perguntas: perguntas ?? [],
            });
        }

        if (body.action === "submit") {
            const { data: perguntas, error: errP } = await db.from("cpa_perguntas")
                .select("id, texto, tipo, escala_min, escala_max, opcoes, obrigatoria, chave")
                .eq("formulario_id", f.id);
            if (errP) throw errP;

            const entrada = body.respostas && typeof body.respostas === "object" ? body.respostas : {};
            const v = validarRespostas(perguntas ?? [], entrada);
            if (!v.ok) return j({ error: v.erro, pergunta_id: v.pergunta_id }, 400);

            const perguntaCurso = (perguntas ?? []).find((p) => p.chave === "curso");
            const curso = perguntaCurso ? (v.limpas[perguntaCurso.id] as string | undefined) ?? null : null;

            const { data, error } = await db.rpc("cpa_registrar_resposta", {
                p_formulario: f.id,
                p_respostas: v.limpas,
                p_curso: curso,
                p_contexto: "",
            });
            if (error) {
                if (String(error.message).includes("formulario_fechado")) return j({ error: "Esta avaliação já foi encerrada." }, 409);
                throw error;
            }
            const linha = Array.isArray(data) ? data[0] : data;
            return j({
                ok: true,
                teste: linha.out_teste,
                protocolo: linha.out_seq,
                comprovante: linha.out_hash,
            });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("cpa-form:", e);
        return j({ error: "Não foi possível processar agora. Tente novamente." }, 500);
    }
});
