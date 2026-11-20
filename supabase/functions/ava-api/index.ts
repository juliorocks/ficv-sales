// ava-api — API do AVA (ambiente de estudo do Portal do Aluno), fase de teste.
// Só enxerga o aluno do JWT. Acesso fechado: precisa estar em ava_liberados (obs com "todos" = vê todos os
// cursos importados, útil pra testar sem estar inscrito no Moodle). Fora do teste, quem está inscrito no
// Moodle vê os próprios cursos.
//
//   acesso                                     → { liberado }
//   meus_cursos                                → cursos do aluno + % de progresso
//   curso     { curso_id }                     → seções, aulas e progresso do curso
//   progresso { aula_id, posicao_seg, concluida?, duracao_seg? } → salva onde o aluno parou
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { moodleCourses, moodleUserId } from "../_shared/alunoMoodle.ts";

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

    const { data: lib } = await db.from("ava_liberados").select("obs").eq("aluno_id", user.id).maybeSingle();
    if (!lib) return j({ liberado: false });
    const verTodos = /todos/i.test(lib.obs ?? "");

    const { data: aluno } = await db.from("alunos").select("email").eq("id", user.id).maybeSingle();

    /** ids (ava_cursos.moodle_id) em que o aluno está inscrito; null = todos */
    async function inscritos(): Promise<Set<number> | null> {
        if (verTodos) return null;
        const uid = await moodleUserId(aluno?.email ?? null);
        if (!uid) return new Set();
        return new Set((await moodleCourses(uid)).map((c) => c.id));
    }

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "acesso";

        if (action === "acesso") return j({ liberado: true });

        if (action === "meus_cursos") {
            const ins = await inscritos();
            let q = db.from("ava_cursos").select("id, moodle_id, titulo, curso_area, periodo, semestre, professor, capa_url, nome");
            if (ins) q = q.in("moodle_id", [...ins]);
            const { data: cursos } = await q.order("semestre", { ascending: false }).order("periodo").order("titulo").limit(200);
            const ids = (cursos ?? []).map((c) => c.id);
            if (!ids.length) return j({ cursos: [] });
            const [{ data: aulas }, { data: prog }] = await Promise.all([
                db.from("ava_aulas").select("id, curso_id, thumb_url, tipo").in("curso_id", ids).eq("tipo", "video").limit(20000),
                db.from("ava_progresso").select("aula_id, curso_id, concluida, atualizado_em").eq("aluno_id", user.id).in("curso_id", ids),
            ]);
            const total: Record<number, number> = {}, thumb: Record<number, string> = {};
            for (const a of aulas ?? []) { total[a.curso_id] = (total[a.curso_id] ?? 0) + 1; if (a.thumb_url && !thumb[a.curso_id]) thumb[a.curso_id] = a.thumb_url; }
            const feitas: Record<number, number> = {}, ultimo: Record<number, string> = {};
            for (const p of prog ?? []) {
                if (p.concluida) feitas[p.curso_id] = (feitas[p.curso_id] ?? 0) + 1;
                if (!ultimo[p.curso_id] || p.atualizado_em > ultimo[p.curso_id]) ultimo[p.curso_id] = p.atualizado_em;
            }
            return j({
                cursos: (cursos ?? []).filter((c) => total[c.id]).map((c) => ({
                    ...c, capa_url: c.capa_url ?? thumb[c.id] ?? null, total_aulas: total[c.id] ?? 0,
                    concluidas: feitas[c.id] ?? 0, ultimo_acesso: ultimo[c.id] ?? null,
                })),
            });
        }

        if (action === "curso") {
            const cursoId = Number(body.curso_id);
            const { data: curso } = await db.from("ava_cursos").select("id, moodle_id, titulo, nome, curso_area, periodo, semestre, professor, descricao, capa_url").eq("id", cursoId).maybeSingle();
            if (!curso) return j({ error: "Curso não encontrado." }, 404);
            const ins = await inscritos();
            if (ins && !ins.has(curso.moodle_id)) return j({ error: "Você não está inscrito nesta disciplina." }, 403);
            const [{ data: secoes }, { data: aulas }, { data: prog }] = await Promise.all([
                db.from("ava_secoes").select("id, nome, ordem").eq("curso_id", cursoId).order("ordem"),
                db.from("ava_aulas").select("id, secao_id, tipo, titulo, video_id, video_hash, thumb_url, duracao_seg, url, descricao, ordem").eq("curso_id", cursoId).order("ordem"),
                db.from("ava_progresso").select("aula_id, posicao_seg, concluida").eq("aluno_id", user.id).eq("curso_id", cursoId),
            ]);
            return j({ curso, secoes: secoes ?? [], aulas: aulas ?? [], progresso: prog ?? [] });
        }

        if (action === "progresso") {
            const aulaId = Number(body.aula_id);
            const { data: aula } = await db.from("ava_aulas").select("id, curso_id, duracao_seg").eq("id", aulaId).maybeSingle();
            if (!aula) return j({ error: "Aula não encontrada." }, 404);
            const pos = Math.max(0, Math.floor(Number(body.posicao_seg) || 0));
            const dur = Number(body.duracao_seg) || aula.duracao_seg || 0;
            const { data: atual } = await db.from("ava_progresso").select("concluida, concluida_em").eq("aluno_id", user.id).eq("aula_id", aulaId).maybeSingle();
            // concluída: o aluno marcou, ou assistiu ≥ 90% (nunca volta atrás sozinha)
            const concluida = body.concluida === false ? false : (!!atual?.concluida || body.concluida === true || (dur > 0 && pos >= dur * 0.9));
            const { error } = await db.from("ava_progresso").upsert({
                aluno_id: user.id, aula_id: aulaId, curso_id: aula.curso_id, posicao_seg: pos, concluida,
                concluida_em: concluida ? (atual?.concluida_em ?? new Date().toISOString()) : null,
                atualizado_em: new Date().toISOString(),
            });
            if (error) throw error;
            return j({ ok: true, concluida });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("ava-api:", e);
        return j({ error: "Não foi possível carregar agora. Tente de novo em instantes." }, 502);
    }
});
