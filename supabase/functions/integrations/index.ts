// integrations — painel de chaves (Gestão > Integrações). Só admin.
//
//   list                      → integrações, campos e de onde vem cada chave
//                               (painel / ambiente / faltando) + último teste.
//                               NUNCA devolve o valor, só os 4 últimos caracteres.
//   set   { key, value }      → grava no Vault
//   clear { key }             → apaga do Vault (volta a valer a do ambiente, se houver)
//   test  { integration }     → testa a conexão com o que está valendo agora
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isAdmin, jsonRes } from "../_shared/ai.ts";
import { forgetSecret, getSecret } from "../_shared/secrets.ts";
import { GITHUB_REPO } from "../_shared/gh-dispatch.ts";
import { loadSettings, zpro, zproErr } from "../_shared/vivaconnect.ts";
import { retorno, sponteCall } from "../_shared/sponte.ts";

type Field = { key: string; label: string; placeholder?: string; optional?: boolean; help?: string };
type Integration = { id: string; name: string; description: string; fields: Field[]; manageTab?: string };

const REGISTRY: Integration[] = [
    {
        id: "openai", name: "OpenAI", description: "IA de atendimento e indexação da Base de Conhecimento.",
        fields: [{ key: "OPENAI_API_KEY", label: "API Key", placeholder: "sk-...", help: "platform.openai.com → API keys" }],
    },
    {
        id: "vivaconnect", name: "VivaConnect (WhatsApp)",
        description: "Cada número tem sua própria API (ID + token) — cadastre e teste na tela VivaConnect.",
        fields: [], manageTab: "vivaconnect",
    },
    {
        id: "sendpulse", name: "SendPulse", description: "Formulários de inscrição → Kanban (a cada 3 min).",
        fields: [
            { key: "SENDPULSE_API_KEY", label: "API Key", optional: true, help: "Se preenchida, é usada no lugar do ID/Secret." },
            { key: "SENDPULSE_CLIENT_ID", label: "Client ID (REST API)", optional: true },
            { key: "SENDPULSE_CLIENT_SECRET", label: "Client Secret (REST API)", optional: true },
        ],
    },
    {
        id: "sponte", name: "Sponte", description: "Portal do Aluno: login pelo CPF, dados, financeiro e notas (API WSAPIEdu).",
        fields: [
            { key: "SPONTE_TOKEN", label: "Token da API", help: "Sponte → Configurações → Integrações/API" },
            { key: "SPONTE_CODIGO_CLIENTE", label: "Código do cliente", optional: true, placeholder: "489166", help: "Vazio = 489166 (FICV)" },
        ],
    },
    {
        id: "resend", name: "Resend (e-mails)", description: "E-mails do Portal do Aluno: confirmação e respostas de chamados, redefinição de senha.",
        fields: [
            { key: "RESEND_API_KEY", label: "API Key", placeholder: "re_...", help: "resend.com → API Keys" },
            { key: "RESEND_FROM", label: "Remetente", placeholder: "FICV <atendimento@ficv.edu.br>", help: "O domínio precisa estar verificado na Resend." },
        ],
    },
    {
        id: "github", name: "GitHub (botões Sincronizar)",
        description: `Dispara os syncs de Meta Ads, Google Ads e Sponte no repositório ${GITHUB_REPO}.`,
        fields: [{ key: "GITHUB_DISPATCH_TOKEN", label: "Token (fine-grained, Actions: read & write)", placeholder: "github_pat_..." }],
    },
];

async function runTest(id: string, db: any): Promise<{ ok: boolean; message: string }> {
    const timeout = AbortSignal.timeout(20000);
    if (id === "openai") {
        const k = await getSecret("OPENAI_API_KEY");
        if (!k) return { ok: false, message: "Chave não configurada." };
        const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${k}` }, signal: timeout });
        const d = await r.json().catch(() => null);
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}: ${d?.error?.message ?? "sem detalhe"}` };
        const ids: string[] = (d?.data ?? []).map((m: any) => m.id);
        const { data: s } = await db.from("ai_agent_settings").select("chat_model, embedding_model").eq("id", 1).maybeSingle();
        const missing = [s?.chat_model, s?.embedding_model].filter((m) => m && !ids.includes(m));
        return missing.length
            ? { ok: false, message: `Chave válida, mas sem acesso ao(s) modelo(s): ${missing.join(", ")}` }
            : { ok: true, message: `Conectado — ${ids.length} modelos disponíveis (inclui ${s?.chat_model} e ${s?.embedding_model}).` };
    }
    if (id === "sendpulse") {
        let auth = "";
        const apiKey = await getSecret("SENDPULSE_API_KEY");
        if (apiKey) auth = `Bearer ${apiKey}`;
        else {
            const [cid, cs] = [await getSecret("SENDPULSE_CLIENT_ID"), await getSecret("SENDPULSE_CLIENT_SECRET")];
            if (!cid || !cs) return { ok: false, message: "Informe a API Key ou o par Client ID + Secret." };
            const r = await fetch("https://api.sendpulse.com/oauth/access_token", {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: timeout,
                body: JSON.stringify({ grant_type: "client_credentials", client_id: cid, client_secret: cs }),
            });
            const d = await r.json().catch(() => null);
            if (!d?.access_token) return { ok: false, message: `Login recusado (HTTP ${r.status}): ${d?.error_description ?? d?.message ?? "sem detalhe"}` };
            auth = `Bearer ${d.access_token}`;
        }
        const r = await fetch("https://api.sendpulse.com/addressbooks?limit=100", { headers: { Authorization: auth }, signal: timeout });
        const d = await r.json().catch(() => null);
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}: ${d?.message ?? "sem detalhe"}` };
        return { ok: true, message: `Conectado (${apiKey ? "API Key" : "Client ID/Secret"}) — ${Array.isArray(d) ? d.length : "?"} listas visíveis.` };
    }
    if (id === "sponte") {
        if (!(await getSecret("SPONTE_TOKEN"))) return { ok: false, message: "Token não configurado." };
        const xml = await sponteCall("GetSituacoesAlunos", {});
        const ret = retorno(xml);
        return /^01\b/.test(ret) ? { ok: true, message: `Conectado — ${ret.replace(/^\d+\s*-\s*/, "")}` } : { ok: false, message: ret || "Resposta inesperada do Sponte." };
    }
    if (id === "resend") {
        const key = await getSecret("RESEND_API_KEY"), from = await getSecret("RESEND_FROM");
        if (!key) return { ok: false, message: "API Key não configurada." };
        const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` }, signal: timeout });
        const d = await r.json().catch(() => null);
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}: ${d?.message ?? "sem detalhe"}` };
        const doms: any[] = d?.data ?? [];
        if (!from) return { ok: false, message: `Chave válida (${doms.length} domínio(s)). Falta o Remetente.` };
        const fromDomain = (from.match(/@([^>\s]+)/) ?? [])[1]?.toLowerCase();
        const dom = doms.find((x) => x.name?.toLowerCase() === fromDomain);
        if (!dom) return { ok: false, message: `O domínio ${fromDomain ?? "?"} não está na Resend (domínios: ${doms.map((x) => x.name).join(", ") || "nenhum"}).` };
        if (dom.status !== "verified") return { ok: false, message: `Domínio ${dom.name} ainda não verificado na Resend (status: ${dom.status}).` };
        return { ok: true, message: `Conectado — enviando como ${from}.` };
    }
    if (id === "github") {
        const t = await getSecret("GITHUB_DISPATCH_TOKEN");
        if (!t) return { ok: false, message: "Token não configurado." };
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows`, {
            headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": "ficv-sales-edge" }, signal: timeout,
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) return { ok: false, message: `HTTP ${r.status}: ${d?.message ?? "sem detalhe"} (o token precisa acessar ${GITHUB_REPO})` };
        const names = (d?.workflows ?? []).map((w: any) => w.path.split("/").pop()).join(", ");
        return { ok: true, message: `Conectado — workflows: ${names || "nenhum"}. (Confirme que o token tem Actions: write pra conseguir disparar.)` };
    }
    if (id === "vivaconnect") {
        const settings = await loadSettings(db);
        const { data: chans } = await db.from("vivaconnect_channels").select("id, name, phone, api_id, api_token").eq("active", true);
        if (!chans?.length) return { ok: false, message: "Nenhum número ativo cadastrado na tela VivaConnect." };
        const res = await Promise.all(chans.map(async (c: any) => {
            const r = await zpro(settings.base_url, c, "/listChannels");
            return { name: c.name, ok: r.ok, msg: r.ok ? "ok" : zproErr(r.status, r.data) };
        }));
        const bad = res.filter((x) => !x.ok);
        return { ok: !bad.length, message: res.map((x) => `${x.name}: ${x.msg}`).join(" · ") };
    }
    return { ok: false, message: "Integração desconhecida." };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isAdmin(caller)) return jsonRes({ error: "Só admin." }, 403);
    const userId = caller?.kind === "user" ? caller.id : null;
    const allKeys = REGISTRY.flatMap((i) => i.fields.map((f) => f.key));

    try {
        const body = await req.json().catch(() => ({}));
        const action = body.action ?? "list";

        if (action === "set" || action === "clear") {
            const key = String(body.key ?? "");
            if (!allKeys.includes(key)) return jsonRes({ error: `Chave desconhecida: ${key}` }, 400);
            const { error } = action === "set"
                ? await db.rpc("integ_set_secret", { p_key: key, p_value: String(body.value ?? ""), p_user: userId })
                : await db.rpc("integ_clear_secret", { p_key: key, p_user: userId });
            if (error) return jsonRes({ error: error.message }, 400);
            forgetSecret(key);
            return jsonRes({ ok: true });
        }

        if (action === "test") {
            const integ = REGISTRY.find((i) => i.id === body.integration);
            if (!integ) return jsonRes({ error: "Integração desconhecida." }, 400);
            integ.fields.forEach((f) => forgetSecret(f.key));
            const t = await runTest(integ.id, db).catch((e) => ({ ok: false, message: (e as Error).message }));
            const now = new Date().toISOString();
            const keys = integ.fields.length ? integ.fields.map((f) => f.key) : [`__${integ.id.toUpperCase()}`];
            for (const key of keys) {
                await db.from("integration_status").upsert(
                    { key, last_test_ok: t.ok, last_test_at: now, last_test_message: t.message.slice(0, 1000) },
                    { onConflict: "key", ignoreDuplicates: false },
                );
            }
            return jsonRes(t);
        }

        if (action === "list") {
            const { data: st } = await db.from("integration_status").select("*");
            const byKey = new Map((st ?? []).map((r: any) => [r.key, r]));
            return jsonRes({
                integrations: REGISTRY.map((i) => {
                    const statusKey = i.fields[0]?.key ?? `__${i.id.toUpperCase()}`;
                    const s: any = byKey.get(statusKey);
                    return {
                        ...i,
                        fields: i.fields.map((f) => {
                            const r: any = byKey.get(f.key);
                            return {
                                ...f,
                                source: r?.configured ? "painel" : Deno.env.get(f.key) ? "ambiente" : "faltando",
                                hint: r?.configured ? r.hint : null,
                                updated_at: r?.configured ? r.updated_at : null,
                            };
                        }),
                        last_test: s?.last_test_at ? { ok: s.last_test_ok, at: s.last_test_at, message: s.last_test_message } : null,
                    };
                }),
            });
        }

        return jsonRes({ error: `Ação desconhecida: ${action}` }, 400);
    } catch (e) {
        return jsonRes({ error: (e as Error).message }, 500);
    }
});
