// cpa-admin — painel da Avaliação CPA (staff). Sempre com JWT (verify_jwt padrão).
//   forms                     -> formulários com contagem de oficiais e de teste
//   form        { formulario_id }                 -> formulário + blocos + perguntas
//   stats       { formulario_id, filtros }        -> indicadores do dashboard
//   export      { formulario_id, filtros }        -> CSV + SHA-256 + resultado da verificação da cadeia
//   verify      { formulario_id }                 -> recalcula a cadeia de hash das oficiais
//   update_form { formulario_id, status?, populacao_alvo?, titulo? }   (admin)
//   delete_tests{ formulario_id }                 (admin) apaga só respostas de teste
// filtros: { origem: 'oficial'|'teste'|'todas', curso?: string, de?: 'AAAA-MM-DD', ate?: 'AAAA-MM-DD' }
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const sha256Hex = async (s: string) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// PostgREST devolve no máximo 1000 linhas por chamada: pagina até acabar.
// deno-lint-ignore no-explicit-any
async function todas(montar: () => any): Promise<any[]> {
    const out: unknown[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await montar().order("id").range(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
    }
    return out as never[];
}

// deno-lint-ignore no-explicit-any
type Db = any;
type Filtros = { origem?: string; curso?: string; de?: string; ate?: string };

function aplicarFiltros(q: Db, formId: number, f: Filtros) {
    q = q.eq("formulario_id", formId);
    if (f.origem === "oficial" || !f.origem) q = q.eq("teste", false);
    if (f.origem === "teste") q = q.eq("teste", true);
    if (f.curso) q = q.eq("curso", f.curso);
    if (f.de) q = q.gte("respondido_em", `${f.de}T00:00:00-03:00`);
    if (f.ate) q = q.lte("respondido_em", `${f.ate}T23:59:59-03:00`);
    return q;
}

async function carregarRespostas(db: Db, formId: number, f: Filtros) {
    return await todas(() => aplicarFiltros(
        db.from("cpa_respostas").select("id, seq, teste, respondido_em, respostas, curso, hash, hash_anterior, canonico"),
        formId, f));
}

async function carregarPerguntas(db: Db, formId: number) {
    const [{ data: blocos }, { data: perguntas }] = await Promise.all([
        db.from("cpa_blocos").select("id, ordem, titulo").eq("formulario_id", formId).order("ordem"),
        db.from("cpa_perguntas").select("id, bloco_id, ordem, texto, tipo, escala_min, escala_max, opcoes").eq("formulario_id", formId).order("ordem"),
    ]);
    return { blocos: blocos ?? [], perguntas: perguntas ?? [] };
}

// canonico = seq|timestamp|formulario|oficial|respostas(jsonb). Os 4 primeiros campos não têm '|',
// o JSON pode ter, então o resto é juntado de volta.
const ordenarChaves = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, ordenarChaves((v as Record<string, unknown>)[k])]))
    : v;

// Cadeia: seq contínuo a partir de 1, hash_anterior = hash da linha anterior, e
// hash = sha256(hash_anterior || '|' || canonico). Mesma fórmula de cpa_registrar_resposta.
// Também confere se as colunas (protocolo, data, respostas) ainda batem com o texto que foi hasheado.
async function verificarCadeia(db: Db, formId: number) {
    const linhas = await todas(() => db.from("cpa_respostas")
        .select("id, seq, hash, hash_anterior, canonico, respostas, respondido_em")
        .eq("formulario_id", formId).eq("teste", false));
    let prev = "";
    let esperado = 1;
    for (const r of linhas) {
        const motivo = (m: string) => ({ integra: false, total: linhas.length, primeiro_erro: { seq: r.seq, motivo: m }, cabeca: null });
        if (r.seq !== esperado) return motivo("sequência quebrada");
        if ((r.hash_anterior ?? "") !== prev) return motivo("hash anterior não confere");
        const [seqTxt, ts, , , ...jsonPartes] = String(r.canonico).split("|");
        if (Number(seqTxt) !== r.seq) return motivo("conteúdo não corresponde ao protocolo");
        if (new Date(ts).getTime() !== new Date(r.respondido_em).getTime()) return motivo("data não corresponde ao texto gravado");
        const json = jsonPartes.join("|");
        if (JSON.stringify(ordenarChaves(JSON.parse(json))) !== JSON.stringify(ordenarChaves(r.respostas))) {
            return motivo("respostas alteradas após a gravação");
        }
        const h = await sha256Hex(`${r.hash_anterior ?? ""}|${r.canonico}`);
        if (h !== r.hash) return motivo("conteúdo alterado após a gravação");
        prev = r.hash;
        esperado++;
    }
    return { integra: true, total: linhas.length, primeiro_erro: null, cabeca: linhas.length ? prev : null };
}

const media = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

// "Nota alta" = top 10% da escala (9 em 0–10 ou em 1–10); "nota baixa" = metade inferior.
function estatisticas(form: Db, perguntas: Db[], blocos: Db[], linhas: Db[], todasRespostas: { teste: boolean }[]) {
    const porDia = new Map<string, number>();
    const porCurso = new Map<string, number>();
    const comentarios: Db[] = [];
    let totalNotas = 0;
    const notas: number[] = [];
    let altas = 0;
    let baixas = 0;

    const itens = perguntas.map((p) => {
        const valores = linhas.map((l) => l.respostas[String(p.id)]).filter((v) => v !== undefined && v !== null && v !== "");
        if (p.tipo === "escala") {
            const nums = valores.map(Number);
            const dist = [];
            for (let v = p.escala_min; v <= p.escala_max; v++) dist.push({ valor: v, n: nums.filter((x) => x === v).length });
            notas.push(...nums);
            totalNotas += nums.length;
            altas += nums.filter((v) => v >= p.escala_max * 0.9).length;
            baixas += nums.filter((v) => v <= p.escala_max * 0.5).length;
            return { id: p.id, bloco_id: p.bloco_id, ordem: p.ordem, texto: p.texto, tipo: p.tipo, n: nums.length, media: media(nums), distribuicao: dist, min: p.escala_min, max: p.escala_max };
        }
        if (p.tipo === "escolha") {
            const opcoes = (p.opcoes as string[]).map((op) => ({ valor: op, n: valores.filter((v) => v === op).length }));
            return { id: p.id, bloco_id: p.bloco_id, ordem: p.ordem, texto: p.texto, tipo: p.tipo, n: valores.length, opcoes };
        }
        for (const l of linhas) {
            const t = String(l.respostas[String(p.id)] ?? "").trim();
            if (t) comentarios.push({ seq: l.seq, teste: l.teste, curso: l.curso, respondido_em: l.respondido_em, texto: t, pergunta: p.texto });
        }
        return { id: p.id, bloco_id: p.bloco_id, ordem: p.ordem, texto: p.texto, tipo: p.tipo, n: valores.length };
    });

    for (const l of linhas) {
        const dia = String(l.respondido_em).slice(0, 10);
        porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
        const c = l.curso ?? "(sem curso)";
        porCurso.set(c, (porCurso.get(c) ?? 0) + 1);
    }

    const porBloco = blocos.map((b) => {
        const medias = itens.filter((i) => i.bloco_id === b.id && i.tipo === "escala").map((i) => i.media).filter((m): m is number => m !== null);
        return { ordem: b.ordem, titulo: b.titulo, media: media(medias) };
    });

    const populacao = form.populacao_alvo ?? null;
    const pct = (parte: number, todo: number) => (todo ? Math.round((parte / todo) * 1000) / 10 : null);
    return {
        formulario: { id: form.id, titulo: form.titulo, nivel: form.nivel, status: form.status, populacao_alvo: populacao },
        totais: {
            respondentes: linhas.length,
            percentual: populacao ? pct(linhas.length, populacao) : null,
            testes: todasRespostas.filter((r) => r.teste).length,
            media_geral: media(notas),
            pct_notas_altas: pct(altas, totalNotas),
            pct_notas_baixas: pct(baixas, totalNotas),
        },
        por_dia: [...porDia.entries()].sort().map(([dia, n]) => ({ dia, n })),
        por_curso: [...porCurso.entries()].sort((a, b) => b[1] - a[1]).map(([curso, n]) => ({ curso, n })),
        blocos: porBloco,
        perguntas: itens,
        comentarios: comentarios.sort((a, b) => String(b.respondido_em).localeCompare(String(a.respondido_em))),
    };
}

// CSV com ';' (Excel em português) e BOM UTF-8. Uma linha por resposta, colunas por pergunta.
function csvDe(perguntas: Db[], linhas: Db[]): string {
    const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cab = ["protocolo", "comprovante", "respondido_em", "origem", "curso", ...perguntas.map((p) => `${p.ordem}. ${p.texto}`)];
    const corpo = linhas.map((l) => [
        l.seq, l.hash, l.respondido_em, l.teste ? "teste" : "oficial", l.curso,
        ...perguntas.map((p) => l.respostas[String(p.id)]),
    ].map(esc).join(";"));
    return "﻿" + [cab.map(esc).join(";"), ...corpo].join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const db: Db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    try {
        const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: { user } } = await db.auth.getUser(jwt);
        if (!user) return j({ error: "Sessão inválida." }, 401);
        const { data: caller } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
        const role = caller?.role ?? "";
        if (!["admin", "agent"].includes(role)) return j({ error: "Sem acesso à Avaliação CPA." }, 403);
        const ehAdmin = role === "admin";

        const body = await req.json().catch(() => ({}));
        const acao = String(body.action ?? "");
        const formId = Number(body.formulario_id);
        const filtros: Filtros = body.filtros ?? {};

        if (acao === "forms") {
            const { data: forms, error } = await db.from("cpa_formularios").select("*").order("id");
            if (error) throw error;
            const contagens = await Promise.all((forms ?? []).map(async (f: Db) => {
                const { count: oficiais } = await db.from("cpa_respostas").select("id", { count: "exact", head: true }).eq("formulario_id", f.id).eq("teste", false);
                const { count: testes } = await db.from("cpa_respostas").select("id", { count: "exact", head: true }).eq("formulario_id", f.id).eq("teste", true);
                return { ...f, oficiais: oficiais ?? 0, testes: testes ?? 0 };
            }));
            return j({ forms: contagens, admin: ehAdmin });
        }

        if (!Number.isInteger(formId) || formId <= 0) return j({ error: "formulario_id obrigatório." }, 400);
        const { data: form } = await db.from("cpa_formularios").select("*").eq("id", formId).maybeSingle();
        if (!form) return j({ error: "Formulário não encontrado." }, 404);

        if (acao === "form") {
            const { blocos, perguntas } = await carregarPerguntas(db, formId);
            return j({ form, blocos, perguntas });
        }

        if (acao === "stats") {
            const { blocos, perguntas } = await carregarPerguntas(db, formId);
            const linhas = await carregarRespostas(db, formId, filtros);
            const todasLinhas = await todas(() => db.from("cpa_respostas").select("id, teste").eq("formulario_id", formId));
            return j(estatisticas(form, perguntas, blocos, linhas, todasLinhas));
        }

        if (acao === "export") {
            const { perguntas } = await carregarPerguntas(db, formId);
            const linhas = await carregarRespostas(db, formId, filtros);
            const csv = csvDe(perguntas, linhas);
            const cadeia = await verificarCadeia(db, formId);
            return j({
                csv,
                sha256: await sha256Hex(csv),
                linhas: linhas.length,
                gerado_em: new Date().toISOString(),
                gerado_por: user.email ?? user.id,
                filtros,
                cadeia,
            });
        }

        if (acao === "verify") return j(await verificarCadeia(db, formId));

        if (acao === "update_form") {
            if (!ehAdmin) return j({ error: "Só admin altera o formulário." }, 403);
            const alt: Db = {};
            if (["teste", "aberto", "encerrado"].includes(body.status)) alt.status = body.status;
            if (body.populacao_alvo !== undefined) {
                const n = body.populacao_alvo === null || body.populacao_alvo === "" ? null : Number(body.populacao_alvo);
                if (n !== null && (!Number.isInteger(n) || n < 0)) return j({ error: "População inválida." }, 400);
                alt.populacao_alvo = n;
            }
            if (typeof body.titulo === "string" && body.titulo.trim()) alt.titulo = body.titulo.trim();
            if (!Object.keys(alt).length) return j({ error: "Nada para alterar." }, 400);
            const { data, error } = await db.from("cpa_formularios").update(alt).eq("id", formId).select("*").maybeSingle();
            if (error) throw error;
            return j({ form: data });
        }

        if (acao === "delete_tests") {
            if (!ehAdmin) return j({ error: "Só admin apaga respostas de teste." }, 403);
            const { data, error } = await db.from("cpa_respostas").delete().eq("formulario_id", formId).eq("teste", true).select("id");
            if (error) throw error;
            return j({ apagadas: (data ?? []).length });
        }

        return j({ error: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error("cpa-admin:", e);
        return j({ error: "Erro ao processar a Avaliação CPA." }, 500);
    }
});
