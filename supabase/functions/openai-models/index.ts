// openai-models — lista os modelos de CHAT disponíveis na conta OpenAI configurada, pro
// dropdown "Modelo (OpenAI)" em Gestão > IA de Atendimento (pedido do usuário 29/09).
// A conta OpenAI tem dezenas de modelos (áudio, imagem, transcrição, embeddings,
// moderação, completions legado) que não servem pro /chat/completions de texto simples
// que a ai-agent usa — filtra só os de chat de texto.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isAdmin, jsonRes } from "../_shared/ai.ts";
import { getSecret } from "../_shared/secrets.ts";

const CHAT_RX = /^(gpt-(3\.5|4|5)|chatgpt-|o[134])/i;
const EXCLUDE_RX = /realtime|audio|transcribe|tts|image|search|instruct|embedding/i;

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const caller = await identify(req, db);
    if (!isAdmin(caller)) return jsonRes({ error: "Apenas administradores." }, 403);

    try {
        const key = await getSecret("OPENAI_API_KEY");
        if (!key) return jsonRes({ error: "OPENAI_API_KEY não configurada (Gestão > Integrações)." }, 400);

        const r = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) return jsonRes({ error: d?.error?.message ?? `HTTP ${r.status}` }, 502);

        const models = (d?.data ?? [])
            .filter((m: any) => typeof m.id === "string" && CHAT_RX.test(m.id) && !EXCLUDE_RX.test(m.id))
            .map((m: any) => ({ id: m.id as string, created: m.created as number }))
            .sort((a: any, b: any) => b.created - a.created);

        return jsonRes({ models });
    } catch (e) {
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
