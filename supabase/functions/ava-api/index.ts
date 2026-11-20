// ava-api — API do AVA (ambiente de estudo do Portal do Aluno), fase de teste.
// Só enxerga o aluno do JWT. Acesso fechado: precisa estar em ava_liberados (obs com "todos" = vê todos os
// cursos importados, útil pra testar sem estar inscrito no Moodle). Fora do teste, quem está inscrito no
// Moodle vê os próprios cursos.
//
//   acesso                                     → { liberado }
//   meus_cursos                                → cursos do aluno + % de progresso
//   curso     { curso_id }                     → seções, aulas e progresso do curso
//   progresso { aula_id, posicao_seg, concluida?, duracao_seg? } → salva onde o aluno parou
//   anotacoes_listar { curso_id } / anotacao_salvar { aula_id, segundos, texto } / anotacao_excluir { id }
//   perguntas_listar { curso_id } / pergunta_criar { curso_id, aula_id?, titulo, texto } / resposta_criar { pergunta_id, texto }
//   avisos_listar { curso_id }
//   assistente { curso_id, aula_id?, mensagens: [{role, content}] } → Tutor Virtual + Base de Conhecimento (máx. 40/dia)
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { moodleConclusoes, moodleCourses, moodleUserId } from "../_shared/alunoMoodle.ts";
import { chatJSON, ensureLineBreaks, searchKnowledge } from "../_shared/ai.ts";

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

    const { data: aluno } = await db.from("alunos").select("email, nome").eq("id", user.id).maybeSingle();
    const nomeCurto = (() => { const p = String(aluno?.nome ?? "Aluno").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; })();

    /** ids (ava_cursos.moodle_id) em que o aluno está inscrito; null = todos */
    async function inscritos(real = false): Promise<Set<number> | null> {
        if (verTodos && !real) return null;
        const uid = await moodleUserId(aluno?.email ?? null);
        if (!uid) return new Set();
        return new Set((await moodleCourses(uid)).map((c) => c.id));
    }

    let insCache: Set<number> | null | undefined;
    /** o aluno pode ver esta disciplina? (inscrito no Moodle, ou liberado "todos") */
    async function podeVer(cursoId: number): Promise<{ id: number; titulo: string; professor: string | null; moodle_id: number } | null> {
        const { data: c } = await db.from("ava_cursos").select("id, titulo, professor, moodle_id").eq("id", cursoId).maybeSingle();
        if (!c) return null;
        if (insCache === undefined) insCache = await inscritos();
        return !insCache || insCache.has(c.moodle_id) ? c : null;
    }

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "acesso";

        if (action === "acesso") return j({ liberado: true });

        if (action === "meus_cursos") {
            // inscrição real no Moodle (uma consulta só); quem "vê tudo" só recebe o catálogo inteiro com ?todos (senão a lista pesa)
            const real = await inscritos(true);
            const ins = verTodos && body.todos ? null : real;
            let q = db.from("ava_cursos").select("id, moodle_id, titulo, curso_area, periodo, semestre, professor, capa_url, nome");
            if (ins) q = q.in("moodle_id", [...ins]);
            if (!verTodos) q = q.eq("publicado", true);
            const { data: cursos } = await q.order("semestre", { ascending: false }).order("periodo").order("titulo").limit(400);
            const ids = (cursos ?? []).map((c) => c.id);
            if (!ids.length) return j({ cursos: [] });
            const [{ data: aulas }, { data: prog }] = await Promise.all([
                db.from("ava_aulas").select("id, curso_id, thumb_url, tipo").in("curso_id", ids).eq("tipo", "video").eq("oculto", false).limit(20000),
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
                    concluidas: feitas[c.id] ?? 0, ultimo_acesso: ultimo[c.id] ?? null, inscrito: !!real?.has(c.moodle_id),
                })),
            });
        }

        if (action === "curso") {
            const cursoId = Number(body.curso_id);
            const { data: curso } = await db.from("ava_cursos").select("id, moodle_id, titulo, nome, curso_area, periodo, semestre, professor, descricao, capa_url, publicado").eq("id", cursoId).maybeSingle();
            if (!curso || (!curso.publicado && !verTodos)) return j({ error: "Curso não encontrado." }, 404);
            const ins = await inscritos();
            if (ins && !ins.has(curso.moodle_id)) return j({ error: "Você não está inscrito nesta disciplina." }, 403);
            const [{ data: secoes }, { data: aulas }, { data: prog }] = await Promise.all([
                db.from("ava_secoes").select("id, nome, ordem").eq("curso_id", cursoId).eq("oculto", false).order("ordem"),
                db.from("ava_aulas").select("id, secao_id, tipo, titulo, video_id, video_hash, thumb_url, duracao_seg, url, descricao, ordem").eq("curso_id", cursoId).eq("oculto", false).order("ordem"),
                db.from("ava_progresso").select("aula_id, posicao_seg, concluida").eq("aluno_id", user.id).eq("curso_id", cursoId),
            ]);
            return j({ curso, secoes: secoes ?? [], aulas: aulas ?? [], progresso: prog ?? [] });
        }

        // traz do Moodle o que o aluno já concluiu (rótulos com vídeo e provas); roda em lotes, uma vez por disciplina
        if (action === "sincronizar_moodle") {
            const uid = await moodleUserId(aluno?.email ?? null);
            if (!uid) return j({ restantes: 0, importadas: 0 });
            const meus = new Set((await moodleCourses(uid)).map((c) => c.id));
            const { data: cs } = await db.from("ava_cursos").select("id, moodle_id").in("moodle_id", [...meus]);
            const { data: feitos } = await db.from("ava_moodle_sync").select("curso_id").eq("aluno_id", user.id);
            const ja = new Set((feitos ?? []).map((f: any) => f.curso_id));
            const faltam = (cs ?? []).filter((c: any) => !ja.has(c.id));
            let importadas = 0;
            for (const c of faltam.slice(0, 6)) {
                let n = 0;
                try {
                    const conc = await moodleConclusoes(uid, c.moodle_id);
                    if (conc.size) {
                        const { data: aulas } = await db.from("ava_aulas").select("id, moodle_id").eq("curso_id", c.id).in("moodle_id", [...conc.keys()]);
                        const ids = (aulas ?? []).map((a: any) => a.id);
                        const { data: ex } = ids.length ? await db.from("ava_progresso").select("aula_id, posicao_seg, concluida, concluida_em").eq("aluno_id", user.id).in("aula_id", ids) : { data: [] };
                        const exMap = new Map((ex ?? []).map((e: any) => [e.aula_id, e]));
                        const linhas = (aulas ?? []).filter((a: any) => !exMap.get(a.id)?.concluida).map((a: any) => {
                            const t = conc.get(a.moodle_id) ?? 0;
                            return { aluno_id: user.id, aula_id: a.id, curso_id: c.id, posicao_seg: exMap.get(a.id)?.posicao_seg ?? 0, concluida: true,
                                concluida_em: t ? new Date(t * 1000).toISOString() : new Date().toISOString(), atualizado_em: new Date().toISOString() };
                        });
                        if (linhas.length) { const { error } = await db.from("ava_progresso").upsert(linhas); if (error) throw error; }
                        n = linhas.length;
                    }
                } catch (e) { console.error("sync moodle", c.id, (e as Error).message); continue; }
                await db.from("ava_moodle_sync").upsert({ aluno_id: user.id, curso_id: c.id, importadas: n, sincronizado_em: new Date().toISOString() });
                importadas += n;
            }
            return j({ restantes: Math.max(0, faltam.length - 6), importadas });
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

        if (action === "anotacoes_listar") {
            const c = await podeVer(Number(body.curso_id)); if (!c) return j({ error: "Disciplina indisponível." }, 403);
            const { data } = await db.from("ava_anotacoes").select("id, aula_id, segundos, texto, criado_em").eq("aluno_id", user.id).eq("curso_id", c.id).order("criado_em", { ascending: false }).limit(300);
            return j({ anotacoes: data ?? [] });
        }
        if (action === "anotacao_salvar") {
            const texto = String(body.texto ?? "").trim().slice(0, 2000);
            if (!texto) return j({ error: "Escreva a anotação." }, 400);
            const { data: aula } = await db.from("ava_aulas").select("id, curso_id").eq("id", Number(body.aula_id)).maybeSingle();
            if (!aula || !(await podeVer(aula.curso_id))) return j({ error: "Aula indisponível." }, 403);
            const { data, error } = await db.from("ava_anotacoes").insert({ aluno_id: user.id, curso_id: aula.curso_id, aula_id: aula.id, segundos: Math.max(0, Math.floor(Number(body.segundos) || 0)), texto }).select("id, aula_id, segundos, texto, criado_em").single();
            if (error) throw error;
            return j({ anotacao: data });
        }
        if (action === "anotacao_excluir") {
            await db.from("ava_anotacoes").delete().eq("id", Number(body.id)).eq("aluno_id", user.id);
            return j({ ok: true });
        }

        if (action === "perguntas_listar") {
            const c = await podeVer(Number(body.curso_id)); if (!c) return j({ error: "Disciplina indisponível." }, 403);
            const { data: perguntas } = await db.from("ava_perguntas").select("id, aula_id, aluno_id, autor_nome, titulo, texto, resolvida, criado_em").eq("curso_id", c.id).order("criado_em", { ascending: false }).limit(100);
            const ids = (perguntas ?? []).map((p) => p.id);
            const { data: resp } = ids.length ? await db.from("ava_respostas").select("id, pergunta_id, autor_tipo, autor_nome, texto, criado_em").in("pergunta_id", ids).order("criado_em") : { data: [] };
            return j({ perguntas: (perguntas ?? []).map((p) => ({ ...p, aluno_id: undefined, minha: p.aluno_id === user.id, respostas: (resp ?? []).filter((r) => r.pergunta_id === p.id) })) });
        }
        if (action === "pergunta_criar") {
            const c = await podeVer(Number(body.curso_id)); if (!c) return j({ error: "Disciplina indisponível." }, 403);
            const titulo = String(body.titulo ?? "").trim().slice(0, 160), texto = String(body.texto ?? "").trim().slice(0, 4000);
            if (titulo.length < 3 || !texto) return j({ error: "Preencha o título e a pergunta." }, 400);
            const { count } = await db.from("ava_perguntas").select("id", { count: "exact", head: true }).eq("aluno_id", user.id).gte("criado_em", new Date(Date.now() - 24 * 3600e3).toISOString());
            if ((count ?? 0) >= 10) return j({ error: "Você já fez muitas perguntas hoje. Tente amanhã." }, 429);
            const { error } = await db.from("ava_perguntas").insert({ curso_id: c.id, aula_id: body.aula_id ? Number(body.aula_id) : null, aluno_id: user.id, autor_nome: nomeCurto, titulo, texto });
            if (error) throw error;
            return j({ ok: true });
        }
        if (action === "resposta_criar") {
            const { data: p } = await db.from("ava_perguntas").select("id, curso_id").eq("id", Number(body.pergunta_id)).maybeSingle();
            if (!p || !(await podeVer(p.curso_id))) return j({ error: "Pergunta indisponível." }, 403);
            const texto = String(body.texto ?? "").trim().slice(0, 4000);
            if (!texto) return j({ error: "Escreva a resposta." }, 400);
            const { error } = await db.from("ava_respostas").insert({ pergunta_id: p.id, autor_tipo: "aluno", autor_id: user.id, autor_nome: nomeCurto, texto });
            if (error) throw error;
            return j({ ok: true });
        }

        if (action === "avisos_listar") {
            const c = await podeVer(Number(body.curso_id)); if (!c) return j({ error: "Disciplina indisponível." }, 403);
            const { data } = await db.from("ava_avisos").select("id, curso_id, titulo, texto, autor_nome, criado_em").eq("publicado", true).or(`curso_id.eq.${c.id},curso_id.is.null`).order("criado_em", { ascending: false }).limit(50);
            return j({ avisos: data ?? [] });
        }

        if (action === "assistente") {
            const c = await podeVer(Number(body.curso_id)); if (!c) return j({ error: "Disciplina indisponível." }, 403);
            const msgs = (Array.isArray(body.mensagens) ? body.mensagens : [])
                .filter((m: any) => m?.content && (m.role === "user" || m.role === "assistant")).slice(-10)
                .map((m: any) => ({ role: m.role as string, content: String(m.content).slice(0, 1500) }));
            const ultima = [...msgs].reverse().find((m) => m.role === "user");
            if (!ultima) return j({ error: "Escreva a sua pergunta." }, 400);

            const { count: usos } = await db.from("ava_assistente_log").select("id", { count: "exact", head: true }).eq("aluno_id", user.id).gte("criado_em", new Date(Date.now() - 24 * 3600e3).toISOString());
            if ((usos ?? 0) >= 40) return j({ resposta: "Você usou muitas perguntas hoje. Para continuar, publique sua dúvida na aba Perguntas e respostas ou volte amanhã.", limite: true });

            const [{ data: ts }, { data: ai }, { data: secs }, { data: aulas }] = await Promise.all([
                db.from("tutor_settings").select("nome, system_prompt, chat_model, temperature").eq("id", 1).single(),
                db.from("ai_agent_settings").select("embedding_model, match_count, min_similarity").eq("id", 1).single(),
                db.from("ava_secoes").select("id, nome, ordem").eq("curso_id", c.id).eq("oculto", false).order("ordem"),
                db.from("ava_aulas").select("id, secao_id, tipo, titulo, descricao, ordem").eq("curso_id", c.id).eq("oculto", false).order("ordem").limit(300),
            ]);
            const consulta = msgs.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join("\n");
            const hits = await searchKnowledge(db, `${c.titulo}\n${consulta}`, {
                publico: "alunos", embeddingModel: ai?.embedding_model ?? "text-embedding-3-small", focus: ultima.content,
                count: ai?.match_count ?? 6, minSimilarity: Number(ai?.min_similarity ?? 0.25),
            }) as any[];
            const kb = hits.length ? hits.map((h, i) => `[${i + 1}] (${h.title}) ${h.content}`).join("\n\n---\n\n") : "(nenhum trecho relevante na base de conhecimento)";
            const atual = (aulas ?? []).find((a) => a.id === Number(body.aula_id));
            const indice = (secs ?? []).map((s) => `${s.nome}: ${(aulas ?? []).filter((a) => a.secao_id === s.id).map((a) => a.titulo).join(" | ")}`).join("\n").slice(0, 5000);
            const leituras = (aulas ?? []).filter((a) => a.tipo === "texto" && a.descricao).map((a) => `${a.titulo}: ${a.descricao}`).join("\n").slice(0, 3000);
            const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });

            const system = [
                ts?.system_prompt ?? "",
                `Seu nome é ${ts?.nome ?? "Tutor Virtual"}, assistente de IA da FICV. Hoje é ${hoje}. Você está dentro do AVA (ambiente de estudos), ao lado da videoaula, conversando com o aluno ${nomeCurto}.`,
                `Disciplina atual: ${c.titulo}${c.professor ? ` (professor(a): ${c.professor})` : ""}.${atual ? ` Aula aberta agora: "${atual.titulo}".` : ""}`,
                `IMPORTANTE: você NÃO tem a transcrição nem o conteúdo falado dos vídeos, só os títulos das aulas e os textos abaixo. Nunca invente o que o professor disse numa aula. Para dúvida sobre o conteúdo do vídeo, ajude com o que o título e a base permitem e sugira publicar na aba "Perguntas e respostas" para o professor responder.`,
                `Para assuntos de secretaria, financeiro, notas ou documentos, oriente a abrir um chamado no Portal do Aluno (nunca indique WhatsApp ou telefone). Formatação: texto simples, sem markdown de títulos, parágrafos curtos separados por linha em branco, em português do Brasil. Seja breve (até 3 parágrafos). Não se reapresente se já houver fala sua na conversa.`,
                `Responda em JSON: {"resposta": "..."}`,
                `ESTRUTURA DA DISCIPLINA (módulos: aulas):\n${indice || "(vazia)"}`,
                leituras ? `TEXTOS DA DISCIPLINA:\n${leituras}` : "",
                `BASE DE CONHECIMENTO (única fonte para regras e procedimentos da instituição):\n\n${kb}`,
            ].filter(Boolean).join("\n\n");

            const { json } = await chatJSON(ts?.chat_model ?? "gpt-4.1-mini", Number(ts?.temperature ?? 0.3), [{ role: "system", content: system }, ...msgs]);
            const resposta = ensureLineBreaks(String(json.resposta ?? json.reply ?? "").trim()) || "Não consegui responder agora. Tente reformular ou publique sua dúvida na aba Perguntas e respostas.";
            await db.from("ava_assistente_log").insert({ aluno_id: user.id, curso_id: c.id, aula_id: atual?.id ?? null, pergunta: ultima.content.slice(0, 1500), resposta: resposta.slice(0, 4000), trechos: hits.length });
            return j({ resposta, trechos: hits.length });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("ava-api:", e);
        return j({ error: "Não foi possível carregar agora. Tente de novo em instantes." }, 502);
    }
});
