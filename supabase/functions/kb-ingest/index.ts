// kb-ingest — indexa documentos da base de conhecimento pra IA.
//
// body: { document_id: uuid }        → (re)indexa um documento
//       { all_pending: true }        → indexa todos com index_status pending/error
//       { all: true }                → reindexa tudo (ex: trocou o modelo de embedding)
//
// O texto já vem extraído em knowledge_base.content (PDF/planilha/DOCX são lidos no
// navegador). Aqui só: chunk → embedding OpenAI → grava knowledge_chunks.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { chunkText, corsHeaders, embed, identify, isAdmin, jsonRes, toVector } from "../_shared/ai.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const caller = await identify(req, db);
    if (!isAdmin(caller)) return jsonRes({ error: "Apenas administradores podem indexar a base." }, 403);

    const body = await req.json().catch(() => ({}));
    const { data: settings } = await db.from("ai_agent_settings").select("embedding_model").eq("id", 1).single();
    const model = settings?.embedding_model ?? "text-embedding-3-small";

    let q = db.from("knowledge_base").select("id, title, category, content").order("created_at");
    if (body.document_id) q = q.eq("id", body.document_id);
    else if (body.all_pending) q = q.in("index_status", ["pending", "error"]);
    else if (!body.all) return jsonRes({ error: "Informe document_id, all_pending ou all." }, 400);

    const { data: docs, error } = await q;
    if (error) return jsonRes({ error: error.message }, 500);

    const results: { id: string; title: string; ok: boolean; chunks?: number; error?: string }[] = [];
    for (const doc of docs ?? []) {
        await db.from("knowledge_base").update({ index_status: "processing", index_error: null }).eq("id", doc.id);
        try {
            // título/categoria no começo de cada trecho: o embedding "sabe" de qual curso/doc é
            const header = `${doc.title ?? ""}${doc.category ? ` (${doc.category})` : ""}`.trim();
            const chunks = chunkText(doc.content ?? "").map((c) => header ? `${header}\n\n${c}` : c);
            const vectors = chunks.length ? await embed(chunks, model) : [];

            const { error: delErr } = await db.from("knowledge_chunks").delete().eq("document_id", doc.id);
            if (delErr) throw new Error(delErr.message);
            if (chunks.length) {
                const rows = chunks.map((content, i) => ({
                    document_id: doc.id, chunk_index: i, content, embedding: toVector(vectors[i]),
                }));
                const { error: insErr } = await db.from("knowledge_chunks").insert(rows);
                if (insErr) throw new Error(insErr.message);
            }
            await db.from("knowledge_base").update({
                index_status: "ready", chunk_count: chunks.length, indexed_at: new Date().toISOString(),
            }).eq("id", doc.id);
            results.push({ id: doc.id, title: doc.title, ok: true, chunks: chunks.length });
        } catch (e) {
            const msg = (e as Error).message;
            await db.from("knowledge_base").update({ index_status: "error", index_error: msg }).eq("id", doc.id);
            results.push({ id: doc.id, title: doc.title, ok: false, error: msg });
        }
    }

    return jsonRes({
        indexed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
    });
});
