// ava-gestao — gestão do AVA pela EQUIPE (JWT de profiles).
//   admin / coordenador : todas as disciplinas, conteúdo, publicação, avisos, dúvidas; admin também o acesso (liberados) e vínculos
//   professor           : só as disciplinas vinculadas (ava_curso_professores): conteúdo, avisos e dúvidas delas
//   tutor               : só responde dúvidas (todas as disciplinas)
//
//   eu | cursos_listar | curso_ler | curso_salvar | professores_candidatos | curso_professores_salvar
//   secao_salvar | secao_excluir | aula_salvar | aula_excluir | reordenar
//   duvidas_listar | resposta_criar | pergunta_resolver
//   avisos_listar | aviso_salvar | aviso_excluir
//   liberados_listar | aluno_buscar | liberado_salvar | liberado_remover   (só admin)
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, jsonRes } from "../_shared/ai.ts";

const j = jsonRes;

function vimeoDe(entrada: string): { id: string; hash: string | null } | null {
    const t = entrada.trim();
    if (/^\d{6,}$/.test(t)) return { id: t, hash: null };
    const m = t.match(/vimeo\.com\/(?:video\/)?(\d+)(?:[/?]h=|\/)?([0-9a-f]{8,})?/i) ?? t.match(/player\.vimeo\.com\/video\/(\d+)(?:\?h=([0-9a-f]+))?/i);
    return m ? { id: m[1], hash: m[2] ?? null } : null;
}
async function oembed(id: string, hash: string | null) {
    try {
        const url = `https://player.vimeo.com/video/${id}` + (hash ? `?h=${hash}` : "");
        const r = await fetch("https://vimeo.com/api/oembed.json?url=" + encodeURIComponent(url));
        if (!r.ok) return null;
        const d = await r.json();
        return { titulo: String(d.title ?? ""), thumb: d.thumbnail_url as string | null, dur: Number(d.duration) || null };
    } catch { return null; }
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (caller?.kind !== "user") return j({ error: "Não autorizado." }, 401);
    const papel = caller.role;
    const GESTORES = ["admin", "coordenador"];
    const ehGestor = GESTORES.includes(papel);
    const ehProfessor = papel === "professor";
    const ehTutor = papel === "tutor";
    if (!ehGestor && !ehProfessor && !ehTutor) return j({ error: "Sem acesso à gestão do AVA." }, 403);
    const { data: perfil } = await db.from("profiles").select("full_name").eq("id", caller.id).maybeSingle();
    const meuNome = perfil?.full_name ?? "Equipe FICV";

    /** disciplinas que posso gerenciar: null = todas */
    async function meusCursos(): Promise<number[] | null> {
        if (ehGestor) return null;
        if (ehTutor) return [];
        const { data } = await db.from("ava_curso_professores").select("curso_id").eq("user_id", caller.id);
        return (data ?? []).map((r) => r.curso_id);
    }
    const mine = await meusCursos();
    const podeGerir = (cursoId: number) => mine === null || mine.includes(cursoId);
    /** dúvidas: tutor enxerga todas, professor só as dele */
    const podeResponder = (cursoId: number) => ehTutor || podeGerir(cursoId);

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "eu";
        const exigeGestor = () => (ehGestor ? null : j({ error: "Só admin ou coordenação." }, 403));
        const exigeAdmin = () => (papel === "admin" ? null : j({ error: "Só o admin." }, 403));

        if (action === "eu") return j({ papel, nome: meuNome, gestor: ehGestor, admin: papel === "admin", professor: ehProfessor, tutor: ehTutor });

        // ── disciplinas ────────────────────────────────────────
        if (action === "cursos_listar") {
            if (ehTutor) return j({ cursos: [] });
            let q = db.from("ava_cursos").select("id, titulo, curso_area, periodo, semestre, professor, publicado, atualizado_em").order("semestre", { ascending: false }).order("periodo").order("titulo").limit(500);
            if (mine) q = q.in("id", mine.length ? mine : [-1]);
            const { data: cursos } = await q;
            const ids = (cursos ?? []).map((c) => c.id);
            if (!ids.length) return j({ cursos: [] });
            const [{ data: aulas }, { data: perg }, { data: resp }] = await Promise.all([
                db.from("ava_aulas").select("curso_id, tipo, oculto").in("curso_id", ids).limit(30000),
                db.from("ava_perguntas").select("id, curso_id, resolvida").in("curso_id", ids).limit(20000),
                db.from("ava_respostas").select("pergunta_id, autor_tipo").in("autor_tipo", ["professor", "equipe"]).limit(20000),
            ]);
            const respondidas = new Set((resp ?? []).map((r) => r.pergunta_id));
            const cont: Record<number, { videos: number; itens: number; abertas: number }> = {};
            for (const a of aulas ?? []) { const c = (cont[a.curso_id] ??= { videos: 0, itens: 0, abertas: 0 }); c.itens++; if (a.tipo === "video" && !a.oculto) c.videos++; }
            for (const p of perg ?? []) { const c = (cont[p.curso_id] ??= { videos: 0, itens: 0, abertas: 0 }); if (!p.resolvida && !respondidas.has(p.id)) c.abertas++; }
            return j({ cursos: (cursos ?? []).map((c) => ({ ...c, ...(cont[c.id] ?? { videos: 0, itens: 0, abertas: 0 }) })) });
        }

        if (action === "curso_ler") {
            const id = Number(body.curso_id);
            if (!podeGerir(id)) return j({ error: "Sem acesso a esta disciplina." }, 403);
            const [{ data: curso }, { data: secoes }, { data: aulas }, { data: profs }] = await Promise.all([
                db.from("ava_cursos").select("id, moodle_id, nome, titulo, curso_area, periodo, semestre, professor, descricao, publicado").eq("id", id).maybeSingle(),
                db.from("ava_secoes").select("id, nome, ordem, oculto").eq("curso_id", id).order("ordem"),
                db.from("ava_aulas").select("id, secao_id, tipo, titulo, video_id, video_hash, thumb_url, duracao_seg, url, descricao, ordem, oculto").eq("curso_id", id).order("ordem"),
                db.from("ava_curso_professores").select("user_id").eq("curso_id", id),
            ]);
            if (!curso) return j({ error: "Disciplina não encontrada." }, 404);
            return j({ curso, secoes: secoes ?? [], aulas: aulas ?? [], professores: (profs ?? []).map((p) => p.user_id) });
        }

        if (action === "curso_salvar") {
            const id = Number(body.curso_id);
            if (!podeGerir(id)) return j({ error: "Sem acesso a esta disciplina." }, 403);
            const patch: Record<string, unknown> = { editado: true, atualizado_em: new Date().toISOString() };
            if (typeof body.titulo === "string" && body.titulo.trim()) patch.titulo = body.titulo.trim().slice(0, 200);
            if (typeof body.descricao === "string") patch.descricao = body.descricao.slice(0, 4000) || null;
            if (typeof body.professor === "string") patch.professor = body.professor.trim().slice(0, 200) || null;
            if (typeof body.publicado === "boolean") { const e = exigeGestor(); if (e) return e; patch.publicado = body.publicado; }
            const { data, error } = await db.from("ava_cursos").update(patch).eq("id", id).select("id");
            if (error) throw error;
            if (!data?.length) return j({ error: "Disciplina não encontrada." }, 404);
            return j({ ok: true });
        }

        if (action === "professores_candidatos") {
            const e = exigeGestor(); if (e) return e;
            const { data } = await db.from("profiles").select("id, full_name, role").in("role", ["professor", "coordenador", "tutor", "admin"]).order("full_name");
            return j({ pessoas: data ?? [] });
        }
        if (action === "curso_professores_salvar") {
            const e = exigeGestor(); if (e) return e;
            const id = Number(body.curso_id);
            const ids: string[] = Array.isArray(body.user_ids) ? body.user_ids.map(String) : [];
            await db.from("ava_curso_professores").delete().eq("curso_id", id);
            if (ids.length) { const { error } = await db.from("ava_curso_professores").insert(ids.map((u) => ({ curso_id: id, user_id: u }))); if (error) throw error; }
            return j({ ok: true });
        }

        // ── seções e aulas ─────────────────────────────────────
        if (action === "secao_salvar") {
            const cursoId = Number(body.curso_id);
            if (!podeGerir(cursoId)) return j({ error: "Sem acesso a esta disciplina." }, 403);
            const nome = String(body.nome ?? "").trim().slice(0, 160);
            if (!nome) return j({ error: "Dê um nome ao módulo." }, 400);
            if (body.id) {
                const patch: Record<string, unknown> = { nome, editado: true };
                if (typeof body.oculto === "boolean") patch.oculto = body.oculto;
                const { data, error } = await db.from("ava_secoes").update(patch).eq("id", Number(body.id)).eq("curso_id", cursoId).select("id");
                if (error) throw error;
                if (!data?.length) return j({ error: "Módulo não encontrado." }, 404);
                return j({ ok: true });
            }
            const { data: ult } = await db.from("ava_secoes").select("ordem").eq("curso_id", cursoId).order("ordem", { ascending: false }).limit(1);
            const { data, error } = await db.from("ava_secoes").insert({ curso_id: cursoId, nome, ordem: (ult?.[0]?.ordem ?? 0) + 1, editado: true }).select("id").single();
            if (error) throw error;
            return j({ ok: true, id: data.id });
        }
        if (action === "secao_excluir") {
            const { data: sec } = await db.from("ava_secoes").select("id, curso_id").eq("id", Number(body.id)).maybeSingle();
            if (!sec || !podeGerir(sec.curso_id)) return j({ error: "Sem acesso." }, 403);
            const { error } = await db.from("ava_secoes").delete().eq("id", sec.id);
            if (error) throw error;
            return j({ ok: true });
        }

        if (action === "aula_salvar") {
            const cursoId = Number(body.curso_id);
            if (!podeGerir(cursoId)) return j({ error: "Sem acesso a esta disciplina." }, 403);
            const tipo = String(body.tipo ?? "video");
            if (!["video", "material", "link", "texto", "quiz"].includes(tipo)) return j({ error: "Tipo de item inválido." }, 400);
            let titulo = String(body.titulo ?? "").trim().slice(0, 200);
            const campos: Record<string, unknown> = { tipo, editado: true };
            if (tipo === "video") {
                const v = vimeoDe(String(body.video_url ?? body.video_id ?? ""));
                if (!v && !body.id) return j({ error: "Cole o link do Vimeo (ex.: https://vimeo.com/123456789 ou o endereço do player)." }, 400);
                if (v) {
                    const meta = await oembed(v.id, v.hash);
                    Object.assign(campos, { video_id: v.id, video_hash: v.hash, thumb_url: meta?.thumb ?? null, duracao_seg: meta?.dur ?? null });
                    if (!titulo) titulo = meta?.titulo || "Videoaula";
                }
            } else if (tipo === "texto") {
                campos.descricao = String(body.descricao ?? "").slice(0, 8000);
            } else {
                const url = String(body.url ?? "").trim();
                if (url && !/^https?:\/\//i.test(url)) return j({ error: "O endereço deve começar com https://" }, 400);
                campos.url = url || null;
            }
            if (!titulo) return j({ error: "Dê um título ao item." }, 400);
            campos.titulo = titulo;
            if (typeof body.oculto === "boolean") campos.oculto = body.oculto;

            if (body.id) {
                if (body.secao_id) campos.secao_id = Number(body.secao_id);
                const { data, error } = await db.from("ava_aulas").update(campos).eq("id", Number(body.id)).eq("curso_id", cursoId).select("id");
                if (error) throw error;
                if (!data?.length) return j({ error: "Item não encontrado." }, 404);
                return j({ ok: true });
            }
            const secaoId = Number(body.secao_id);
            const { data: sec } = await db.from("ava_secoes").select("id").eq("id", secaoId).eq("curso_id", cursoId).maybeSingle();
            if (!sec) return j({ error: "Escolha o módulo." }, 400);
            const { data: ult } = await db.from("ava_aulas").select("ordem").eq("curso_id", cursoId).order("ordem", { ascending: false }).limit(1);
            const { data, error } = await db.from("ava_aulas").insert({ ...campos, curso_id: cursoId, secao_id: secaoId, moodle_id: null, sub: 0, ordem: (ult?.[0]?.ordem ?? 0) + 1 }).select("id").single();
            if (error) throw error;
            return j({ ok: true, id: data.id });
        }
        if (action === "aula_excluir") {
            const { data: aula } = await db.from("ava_aulas").select("id, curso_id").eq("id", Number(body.id)).maybeSingle();
            if (!aula || !podeGerir(aula.curso_id)) return j({ error: "Sem acesso." }, 403);
            const { error } = await db.from("ava_aulas").delete().eq("id", aula.id);
            if (error) throw error;
            return j({ ok: true });
        }

        // reordena reaproveitando as posições já usadas pelos mesmos itens (a ordem global se mantém coerente)
        if (action === "reordenar") {
            const tipo = body.tipo === "secao" ? "ava_secoes" : "ava_aulas";
            const ids: number[] = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
            if (ids.length < 2) return j({ ok: true });
            const { data: linhas } = await db.from(tipo).select("id, curso_id, ordem").in("id", ids);
            if (!linhas?.length || linhas.some((l) => !podeGerir(l.curso_id))) return j({ error: "Sem acesso." }, 403);
            const posicoes = linhas.map((l) => l.ordem).sort((a, b) => a - b);
            for (let i = 0; i < ids.length; i++) {
                await db.from(tipo).update({ ordem: posicoes[i] ?? posicoes[posicoes.length - 1] + i, editado: true }).eq("id", ids[i]);
            }
            return j({ ok: true });
        }

        // ── dúvidas ────────────────────────────────────────────
        if (action === "duvidas_listar") {
            let q = db.from("ava_perguntas").select("id, curso_id, aula_id, autor_nome, titulo, texto, resolvida, criado_em").order("criado_em", { ascending: false }).limit(200);
            if (!ehGestor && !ehTutor) q = q.in("curso_id", mine && mine.length ? mine : [-1]);
            if (body.curso_id) q = q.eq("curso_id", Number(body.curso_id));
            const { data: perguntas } = await q;
            const ids = (perguntas ?? []).map((p) => p.id);
            const cursoIds = [...new Set((perguntas ?? []).map((p) => p.curso_id))];
            const [{ data: resp }, { data: cursos }] = await Promise.all([
                ids.length ? db.from("ava_respostas").select("id, pergunta_id, autor_tipo, autor_nome, texto, criado_em").in("pergunta_id", ids).order("criado_em") : Promise.resolve({ data: [] as any[] }),
                cursoIds.length ? db.from("ava_cursos").select("id, titulo").in("id", cursoIds) : Promise.resolve({ data: [] as any[] }),
            ]);
            const titulos = Object.fromEntries((cursos ?? []).map((c: any) => [c.id, c.titulo]));
            const lista = (perguntas ?? []).map((p) => {
                const respostas = (resp ?? []).filter((r: any) => r.pergunta_id === p.id);
                return { ...p, curso_titulo: titulos[p.curso_id] ?? "", respostas, respondida: respostas.some((r: any) => r.autor_tipo !== "aluno") };
            });
            return j({ perguntas: body.filtro === "todas" ? lista : lista.filter((p) => !p.resolvida && !p.respondida) });
        }
        if (action === "resposta_criar") {
            const { data: p } = await db.from("ava_perguntas").select("id, curso_id").eq("id", Number(body.pergunta_id)).maybeSingle();
            if (!p || !podeResponder(p.curso_id)) return j({ error: "Sem acesso a esta pergunta." }, 403);
            const texto = String(body.texto ?? "").trim().slice(0, 4000);
            if (!texto) return j({ error: "Escreva a resposta." }, 400);
            const { error } = await db.from("ava_respostas").insert({ pergunta_id: p.id, autor_tipo: ehProfessor ? "professor" : "equipe", autor_id: caller.id, autor_nome: meuNome, texto });
            if (error) throw error;
            if (body.resolver) await db.from("ava_perguntas").update({ resolvida: true }).eq("id", p.id);
            return j({ ok: true });
        }
        if (action === "pergunta_resolver") {
            const { data: p } = await db.from("ava_perguntas").select("id, curso_id").eq("id", Number(body.id)).maybeSingle();
            if (!p || !podeResponder(p.curso_id)) return j({ error: "Sem acesso." }, 403);
            await db.from("ava_perguntas").update({ resolvida: body.resolvida !== false }).eq("id", p.id);
            return j({ ok: true });
        }

        // ── avisos ─────────────────────────────────────────────
        if (action === "avisos_listar") {
            let q = db.from("ava_avisos").select("id, curso_id, titulo, texto, autor_nome, publicado, criado_em").order("criado_em", { ascending: false }).limit(200);
            if (!ehGestor) q = q.in("curso_id", mine && mine.length ? mine : [-1]);
            const { data } = await q;
            return j({ avisos: data ?? [] });
        }
        if (action === "aviso_salvar") {
            const cursoId = body.curso_id ? Number(body.curso_id) : null;
            if (cursoId === null ? !ehGestor : !podeGerir(cursoId)) return j({ error: cursoId === null ? "Aviso para todas as disciplinas é só da coordenação." : "Sem acesso a esta disciplina." }, 403);
            const titulo = String(body.titulo ?? "").trim().slice(0, 160), texto = String(body.texto ?? "").trim().slice(0, 6000);
            if (!titulo || !texto) return j({ error: "Preencha o título e o texto." }, 400);
            if (body.id) {
                const { data: atual } = await db.from("ava_avisos").select("id, curso_id").eq("id", Number(body.id)).maybeSingle();
                if (!atual || (atual.curso_id === null ? !ehGestor : !podeGerir(atual.curso_id))) return j({ error: "Sem acesso." }, 403);
                const { error } = await db.from("ava_avisos").update({ curso_id: cursoId, titulo, texto, publicado: body.publicado !== false }).eq("id", atual.id);
                if (error) throw error;
                return j({ ok: true });
            }
            const { error } = await db.from("ava_avisos").insert({ curso_id: cursoId, titulo, texto, autor_nome: meuNome, publicado: body.publicado !== false });
            if (error) throw error;
            return j({ ok: true });
        }
        if (action === "aviso_excluir") {
            const { data: atual } = await db.from("ava_avisos").select("id, curso_id").eq("id", Number(body.id)).maybeSingle();
            if (!atual || (atual.curso_id === null ? !ehGestor : !podeGerir(atual.curso_id))) return j({ error: "Sem acesso." }, 403);
            await db.from("ava_avisos").delete().eq("id", atual.id);
            return j({ ok: true });
        }

        // ── acesso ao AVA em teste (só admin) ──────────────────
        if (action === "liberados_listar") {
            const e = exigeAdmin(); if (e) return e;
            const { data: lib } = await db.from("ava_liberados").select("aluno_id, obs, criado_em").order("criado_em", { ascending: false });
            const ids = (lib ?? []).map((l) => l.aluno_id);
            const { data: als } = ids.length ? await db.from("alunos").select("id, nome, email").in("id", ids) : { data: [] as any[] };
            const porId = Object.fromEntries((als ?? []).map((a: any) => [a.id, a]));
            return j({ liberados: (lib ?? []).map((l) => ({ ...l, nome: porId[l.aluno_id]?.nome ?? "(aluno removido)", email: porId[l.aluno_id]?.email ?? "" })) });
        }
        if (action === "aluno_buscar") {
            const e = exigeAdmin(); if (e) return e;
            const q = String(body.q ?? "").trim();
            if (q.length < 3) return j({ alunos: [] });
            const digitos = q.replace(/\D/g, "");
            const filtro = digitos.length >= 6 ? `cpf.eq.${digitos},nome.ilike.%${q.replace(/[%,]/g, "")}%` : `nome.ilike.%${q.replace(/[%,]/g, "")}%`;
            const { data } = await db.from("alunos").select("id, nome, email, nivel").or(filtro).limit(10);
            return j({ alunos: data ?? [] });
        }
        if (action === "liberado_salvar") {
            const e = exigeAdmin(); if (e) return e;
            const { error } = await db.from("ava_liberados").upsert({ aluno_id: String(body.aluno_id), obs: String(body.obs ?? "").slice(0, 200) || null });
            if (error) throw error;
            return j({ ok: true });
        }
        if (action === "liberado_remover") {
            const e = exigeAdmin(); if (e) return e;
            await db.from("ava_liberados").delete().eq("aluno_id", String(body.aluno_id));
            return j({ ok: true });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("ava-gestao:", e);
        return j({ error: "Não foi possível concluir agora. Tente de novo." }, 500);
    }
});
