// marketing-form-submit — endpoint público consumido pela página /f/:slug (embedada
// via iframe nas LPs externas). Sem verify_jwt (config.toml) — service_role interno.
//
//   action:"get"    { slug }                      -> config pública do form (sem segredos)
//   action:"view"   { slug }                       -> fire-and-forget, incrementa view_count
//   action:"submit" { slug, values, utm?, honeypot?, referrer_hint? }  (default quando `action` ausente)
//                                                   -> cria/atualiza lead + log de submissão
//
// Sempre grava o payload bruto em marketing_form_submissions ANTES de processar
// (mesmo padrão do vivaconnect-webhook) — é dali que se depura submissão malformada.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { mirror, sv } from "../_shared/db.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const normEmail = (v: unknown) => String(v ?? "").toLowerCase().trim();
const validPhone = (p: string) => p.length >= 8 && !/^0+$/.test(p);
function normPhone(v: unknown): string {
    let tel = onlyDigits(v);
    if ((tel.length === 10 || tel.length === 11) && !tel.startsWith("55")) tel = "55" + tel;
    return tel;
}
function clientIp(req: Request): string {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return req.headers.get("cf-connecting-ip") ?? "";
}
function hostnameOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
// {{campo}} de propósito (não o {campo} de _shared/vivaconnect.ts) — é a sintaxe
// que o time já conhece do SendPulse. Sempre encodeURIComponent por valor: o
// resultado entra numa URL (wa.me).
function fillPlaceholders(template: string, vars: Record<string, string>): string {
    return String(template ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) => encodeURIComponent(vars[key] ?? ""));
}

type MarketingFormField = {
    id: string;
    type: "text" | "phone" | "email" | "select" | "checkbox" | "radio" | "static_text" | "spacer";
    label?: string;
    required?: boolean;
    role?: "name" | "whatsapp" | "email" | null;
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } });

    const raw = await req.text();
    let body: any;
    try { body = JSON.parse(raw); } catch { body = { _raw: raw }; }
    const action = body.action ?? "submit";
    const slug = String(body.slug ?? "").trim();
    if (!slug) return j({ ok: false, error: "slug obrigatório" }, 400);

    const { data: form } = await db.from("marketing_forms").select("*").eq("slug", slug).maybeSingle();

    // ── action: get (config pública, sem segredos) ─────────────────────────
    if (action === "get") {
        if (!form || !form.ativo) return j({ ok: false, error: "form not found" }, 404);
        return j({
            ok: true,
            form: {
                id: form.id, slug: form.slug, name: form.name,
                fields: form.fields, design: form.design,
                lgpd_enabled: form.lgpd_enabled, lgpd_text: form.lgpd_text,
            },
        });
    }

    // ── action: view (fire-and-forget) ──────────────────────────────────────
    if (action === "view") {
        if (form) await db.from("marketing_forms").update({ view_count: (form.view_count ?? 0) + 1 }).eq("id", form.id);
        return j({ ok: true });
    }

    if (action !== "submit") return j({ ok: false, error: `ação desconhecida: ${action}` }, 400);

    // ── action: submit ──────────────────────────────────────────────────────
    const ip = clientIp(req);
    const referrer = String(body.referrer_hint ?? req.headers.get("referer") ?? "");
    const values: Record<string, unknown> = body.values ?? {};

    // 1. log do payload bruto ANTES de processar, mesmo se o form nem existir.
    const { data: log } = await db.from("marketing_form_submissions").insert({
        form_id: form?.id ?? null, payload: values, utm: body.utm ?? null,
        ip, user_agent: req.headers.get("user-agent") ?? "", referrer, outcome: "pending",
    }).select("id").single();
    const finish = async (outcome: string, extra: Record<string, unknown> = {}) => {
        if (log?.id) await db.from("marketing_form_submissions").update({ outcome, ...extra }).eq("id", log.id);
    };

    if (!form || !form.ativo) {
        await finish("rejected", { reject_reason: "form_not_found" });
        return j({ ok: false, error: "form not found" }, 404);
    }

    // 2. honeypot — bot "ganha" 200 falso, não realimenta (não descobre que foi barrado)
    if (String(body.honeypot ?? "").trim()) {
        await finish("rejected", { reject_reason: "honeypot" });
        return j({ ok: true });
    }

    // 3. allowlist de domínio — soft-check (referrer_hint vem do client, é spoofável;
    // é paridade de feature com o "Sites para hospedar" do SendPulse, não barreira de
    // segurança real — a barreira real é o rate-limit abaixo). Vazio = não bloqueia
    // (permite testar o form antes de configurar domínios).
    if (form.allowed_domains?.length) {
        const host = hostnameOf(referrer);
        const okDomain = !host || form.allowed_domains.some((d: string) => host === d || host.endsWith(`.${d}`));
        if (!okDomain) {
            await finish("rejected", { reject_reason: "domain_not_allowed" });
            return j({ ok: false, error: "domínio não autorizado" }, 403);
        }
    }

    // 4. rate limit — barreira real anti-abuso
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await db.from("marketing_form_submissions").select("id", { count: "exact", head: true })
        .eq("form_id", form.id).eq("ip", ip).gt("created_at", since);
    if ((count ?? 0) >= 5) {
        await finish("rejected", { reject_reason: "rate_limited" });
        return j({ ok: false, error: "muitas tentativas, aguarde um instante" }, 429);
    }

    // 5. validação de obrigatórios
    const fields: MarketingFormField[] = form.fields ?? [];
    for (const f of fields) {
        if (f.required && !String(values[f.id] ?? "").trim()) {
            await finish("rejected", { reject_reason: `validation:${f.id}` });
            return j({ ok: false, error: `campo obrigatório: ${f.label || f.id}` }, 400);
        }
    }

    // 6. extração normalizada via `role` (evita adivinhar campo por label/regex,
    // diferente do sync-sendpulse-forms)
    const nameField = fields.find((f) => f.role === "name");
    const phoneField = fields.find((f) => f.role === "whatsapp");
    const emailField = fields.find((f) => f.role === "email");
    const nome = String((nameField && values[nameField.id]) ?? "").trim() || "Novo Lead (Formulário)";
    const telefone = phoneField ? normPhone(values[phoneField.id]) : "";
    const email = emailField ? normEmail(values[emailField.id]) : "";
    const preferredContact = telefone ? "whatsapp" : null;
    const extraObs = fields
        .filter((f) => !f.role && f.type !== "static_text" && f.type !== "spacer" && values[f.id] != null && values[f.id] !== "")
        .map((f) => `${f.label || f.id}: ${values[f.id]}`).join("\n");
    const obs = [`Formulário: ${form.name}`, extraObs].filter(Boolean).join("\n");

    const { data: course } = form.course_id
        ? await db.from("courses").select("name, default_value").eq("id", form.course_id).maybeSingle()
        : { data: null };
    const cursoNome = course?.name ?? null;
    const valor = Number(course?.default_value) || 0;
    const nowIso = new Date().toISOString();

    // 7. dedup/reentrada — mesma lógica do sync-sendpulse-forms, portada aqui
    // (duplicada de propósito nesta primeira fase, ver plano — extrair para
    // _shared/ só depois de validado em produção).
    let hit: { id: number; email: string | null; curso: number | null; cc: number; stage: number | null } | null = null;
    if (email) {
        const { data } = await db.from("leads").select("id, email, curso_interesse, contact_count, stage_id").eq("email", email).maybeSingle();
        if (data) hit = { id: data.id, email: data.email, curso: data.curso_interesse, cc: data.contact_count ?? 0, stage: data.stage_id };
    }
    if (!hit && validPhone(telefone)) {
        const { data } = await db.from("leads").select("id, email, curso_interesse, contact_count, stage_id").eq("telefone", telefone).maybeSingle();
        if (data) hit = { id: data.id, email: data.email, curso: data.curso_interesse, cc: data.contact_count ?? 0, stage: data.stage_id };
    }

    let leadId: number;
    if (hit) {
        const nota = `📋 Novo formulário: ${form.name}` + (cursoNome ? ` — interesse em ${cursoNome}` : "");
        const isStaleReentry = hit.stage === 1;
        const courseChanging = isStaleReentry && form.course_id != null && hit.curso != null && hit.curso !== form.course_id;
        await db.from("leads").update({
            contact_count: (hit.cc ?? 0) + 1,
            updated_at: nowIso,
            ...(isStaleReentry ? { data_entrada: nowIso, stage_entry_date: nowIso } : {}),
            ...(form.course_id != null && (isStaleReentry || hit.curso == null) ? { curso_interesse: form.course_id, curso_interesse_nome: cursoNome } : {}),
            ...(!hit.email && email ? { email } : {}),
        }).eq("id", hit.id);
        await db.from("lead_notes").insert({ lead_id: hit.id, note: nota, created_at: nowIso });
        await mirror(
            `UPDATE leads:⟨${hit.id}⟩ SET contact_count = (contact_count ?? 0) + 1, updated_at = time::now()` +
            (isStaleReentry ? `, data_entrada = d${sv(nowIso)}, stage_entry_date = d${sv(nowIso)}` : "") +
            (form.course_id != null && (isStaleReentry || hit.curso == null) ? `, curso_interesse = courses:⟨${form.course_id}⟩` : "") +
            (!hit.email && email ? `, email = ${sv(email)}` : "") + `;\n` +
            `INSERT INTO lead_notes [{ lead_id: leads:⟨${hit.id}⟩, note: ${sv(nota)}, created_at: d${sv(nowIso)} }] RETURN NONE;`
        );
        leadId = hit.id;
    } else {
        const newLead = {
            nome_completo: nome, email: email || null, telefone: telefone || "00000000000",
            stage_id: 1, source_id: form.source_id, curso_interesse: form.course_id, curso_interesse_nome: cursoNome,
            fonte_lead: form.name, observacoes: obs, valor_oportunidade: valor, temperatura: "frio", contact_count: 1,
            data_entrada: nowIso, stage_entry_date: nowIso, preferred_contact: preferredContact,
        };
        const { data: created, error } = await db.from("leads").insert(newLead).select("id").single();
        if (error) {
            await finish("rejected", { reject_reason: `lead_insert_error:${error.message.slice(0, 200)}` });
            return j({ ok: false, error: "falha ao registrar" }, 500);
        }
        leadId = created.id;
        await mirror(
            `UPDATE seq:leads SET val = math::max([val, ${leadId}]);\n` +
            `INSERT INTO leads [{ id:"${leadId}", nome_completo:${sv(nome)}, email:${sv(newLead.email)}, ` +
            `telefone:${sv(newLead.telefone)}, stage_id:stages:⟨1⟩, source_id:lead_sources:⟨${form.source_id}⟩, ` +
            `curso_interesse:${form.course_id != null ? `courses:⟨${form.course_id}⟩` : "NONE"}, valor_oportunidade:${valor}, ` +
            `fonte_lead:${sv(form.name)}, observacoes:${sv(obs)}, temperatura:"frio", contact_count:1, ` +
            `data_entrada:d${sv(nowIso)}, stage_entry_date:d${sv(nowIso)} }] RETURN NONE;`
        );
    }

    await finish(hit ? "updated" : "created", { lead_id: leadId });

    // 8. ação pós-envio
    const vars = { nome, telefone, email, curso: cursoNome ?? "" };
    const post = form.post_submit ?? { type: "message", message: "Recebido!" };
    if (post.type === "redirect") return j({ ok: true, redirect_url: fillPlaceholders(post.url, vars) });
    if (post.type === "whatsapp") {
        const url = `https://wa.me/${onlyDigits(post.whatsapp_number)}?text=${fillPlaceholders(post.message_template ?? "", vars)}`;
        return j({ ok: true, redirect_url: url });
    }
    return j({ ok: true, message: post.message ?? "Recebemos seus dados!" });
});
