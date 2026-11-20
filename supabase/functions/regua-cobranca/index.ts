// regua-cobranca — avisos de mensalidade a vencer/vencida por e-mail.
//   rodar    {}                      (cron diário, service) → envia se modo = 'ligado'; em 'teste' só simula
//   WhatsApp: template UTILITY (só manda abrir o Portal, {{1}} = primeiro nome) no canal oficial; etapa sem `whatsapp_template` não envia
//   simular  {}                      (admin)                → quantos receberiam hoje, por etapa
//   amostra  { etapa_id, email? }    (admin)                → manda 1 e-mail de exemplo (para o e-mail do admin ou o informado)
// Lista número e vencimento das parcelas, nunca valores na mensagem (dependem de bolsa/desconto): o valor certo está no Portal.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { identify, isAdmin, jsonRes } from "../_shared/ai.ts";
import { emailLayout, escHtml, portalUrl, sendEmail } from "../_shared/email.ts";
import { TICKET_TEMPLATE_CHANNEL_ID, toZproNumber } from "../_shared/vivaconnect.ts";

const hojeBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const br = (iso: string) => iso.split("-").reverse().join("/");
const primeiroNome = (s: string) => {
    const n = String(s ?? "").trim().split(/\s+/)[0] ?? "";
    return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "aluno(a)";
};

// Fila do dia quando não cabe tudo no teto: quem ainda vai vencer ou vence hoje primeiro (evita virar inadimplente),
// depois o atraso mais recente (responde melhor); o resto segue nos dias seguintes.
function ordenar(grupos: any[][]) {
    const topo = (g: any[]) => Math.max(...g.map((x) => x.dias));
    return grupos.sort((a, b) => {
        const pa = topo(a) <= 0 ? 0 : 1, pb = topo(b) <= 0 ? 0 : 1;
        return pa - pb || topo(a) - topo(b);
    });
}

function preencher(t: string, v: Record<string, string>) {
    return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

function montar(etapa: any, nome: string, parcelas: { vencimento: string; atraso: number; numero?: number }[], link: string) {
    const ordenadas = [...parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const p = ordenadas[0];
    const vars = { nome: primeiroNome(nome), dias: String(Math.abs(p.atraso)), vencimento: br(p.vencimento) };
    const situacao = (a: number) => (a < 0 ? `vence em ${-a} dia${a === -1 ? "" : "s"}` : a === 0 ? "vence hoje" : `venceu há ${a} dia${a === 1 ? "" : "s"}`);
    const extra = ordenadas.length > 1
        ? `\n\nParcelas em aberto:\n` + ordenadas.map((x) => `• ${x.numero ? `Parcela ${x.numero}: ` : ""}vencimento ${br(x.vencimento)} (${situacao(x.atraso)})`).join("\n")
        : "";
    const corpo = escHtml(preencher(etapa.texto, vars) + extra).replace(/\n/g, "<br>");
    return {
        assunto: preencher(etapa.assunto, vars),
        html: emailLayout(preencher(etapa.assunto, vars), corpo, { label: "Abrir o Portal do Aluno", url: link }),
    };
}

Deno.serve(async (req) => {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = await identify(req, db);
    if (!isAdmin(caller)) return jsonRes({ error: "Só admin ou cron." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "rodar");
    const link = await portalUrl();

    const { data: cfg } = await db.from("regua_cobranca_config").select("*").eq("id", 1).maybeSingle();
    const { data: etapas } = await db.from("regua_cobranca_etapas").select("*");
    const porId = new Map((etapas ?? []).map((e: any) => [e.id, e]));

    if (action === "amostra") {
        const etapa = porId.get(Number(body.etapa_id));
        if (!etapa) return jsonRes({ error: "Etapa não encontrada." }, 404);
        let to = String(body.email ?? "").trim();
        if (!to && caller?.kind === "user") to = (await db.auth.admin.getUserById(caller.id)).data.user?.email ?? "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return jsonRes({ error: "Informe um e-mail válido." }, 400);
        const d = new Date(Date.now() - etapa.dias * 86400_000).toISOString().slice(0, 10);
        const m = montar(etapa, "Maria da Silva", [{ vencimento: d, atraso: etapa.dias, numero: 3 }, { vencimento: new Date(Date.parse(d) - 30 * 86400_000).toISOString().slice(0, 10), atraso: etapa.dias + 30, numero: 2 }], link);
        const r = await sendEmail(to, `[AMOSTRA] ${m.assunto}`, m.html);
        return jsonRes({ ok: r.ok, error: r.error, para: to });
    }

    const { data: cands, error } = await db.rpc("regua_cobranca_candidatos", { p_hoje: hojeBR(), p_canal: "email" });
    if (error) return jsonRes({ error: error.message }, 500);
    const lista = (cands ?? []) as any[];
    const resumo: Record<string, { parcelas: number; alunos: number; sem_email: number }> = {};
    for (const e of etapas ?? []) resumo[e.nome] = { parcelas: 0, alunos: 0, sem_email: 0 };
    const porAluno = new Map<number, any[]>();
    for (const c of lista) {
        resumo[porId.get(c.etapa_id).nome].parcelas++;
        if (!c.email) resumo[porId.get(c.etapa_id).nome].sem_email++;
        (porAluno.get(c.aluno_id) ?? porAluno.set(c.aluno_id, []).get(c.aluno_id)!).push(c);
    }
    const emails = [...porAluno.values()].filter((l) => l[0].email).length;
    const { data: waC } = await db.rpc("regua_cobranca_candidatos", { p_hoje: hojeBR(), p_canal: "whatsapp" });
    const waAlunos = new Set(((waC ?? []) as any[]).filter((c) => toZproNumber(c.celular) && /^55\d{2}9\d{8}$/.test(toZproNumber(c.celular)!)).map((c) => c.aluno_id)).size;

    if (action === "simular" || cfg?.modo !== "ligado" || !cfg?.email_ativo) {
        return jsonRes({ modo: cfg?.modo ?? "teste", enviou: false, alunos: porAluno.size, emails_a_enviar: emails, whatsapp_a_enviar: waAlunos, whatsapp_ativo: !!cfg?.whatsapp_ativo, limite_dia: cfg?.limite_email_dia, por_etapa: resumo });
    }

    // teto diário (a mesma chave do Resend serve aos chamados): o que passar fica para a próxima rodada
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: jaEnviados } = await db.from("regua_cobranca_envios").select("id", { count: "exact", head: true })
        .eq("canal", "email").eq("status", "enviado").gte("created_at", desde);
    let orcamento = (cfg.limite_email_dia ?? 60) - Math.ceil((jaEnviados ?? 0));
    let enviados = 0, falhas = 0, adiados = 0;
        const ordem = ordenar([...porAluno.values()]);
    for (const grupo of ordem) {
        const email = grupo[0].email as string | null;
        if (!email) continue;
        if (orcamento <= 0) { adiados++; continue; }
        const topo = grupo.reduce((a, b) => (b.dias > a.dias ? b : a));
        const m = montar(porId.get(topo.etapa_id), grupo[0].nome, grupo.map((g) => ({ vencimento: g.vencimento, atraso: g.atraso, numero: g.numero_parcela })), link);
        const r = await sendEmail(email, m.assunto, m.html);
        orcamento--;
        const status = r.ok ? "enviado" : "falhou";
        if (r.ok) enviados++; else falhas++;
        await db.from("regua_cobranca_envios").upsert(grupo.map((g) => ({
            aluno_id: g.aluno_id, conta_receber_id: g.conta_receber_id, numero_parcela: g.numero_parcela,
            etapa_id: g.etapa_id, canal: "email", status, destino: email, erro: r.ok ? null : (r.error ?? "").slice(0, 300),
        })), { onConflict: "conta_receber_id,numero_parcela,etapa_id,canal" });
    }
    const wa = cfg.whatsapp_ativo ? await rodarWhatsApp(db, cfg, porId) : null;
    return jsonRes({ modo: "ligado", enviou: true, enviados, falhas, adiados, sem_email: lista.filter((c) => !c.email).length, whatsapp: wa });
});

// WhatsApp: celular BR de verdade (13 dígitos, 9 depois do DDD: o fixo/institucional já gerou loop de bot, ver ticket-emails),
// um aviso por aluno, mais atrasados primeiro, teto diário próprio. Enfileira em vivaconnect_outbox (kind 'cobranca').
async function rodarWhatsApp(db: any, cfg: any, porId: Map<number, any>) {
    const { data: ch } = await db.from("vivaconnect_channels").select("id, active").eq("id", TICKET_TEMPLATE_CHANNEL_ID).maybeSingle();
    if (!ch?.active) return { enviou: false, motivo: "canal oficial inativo" };
    const { data: st } = await db.from("vivaconnect_settings").select("enabled").eq("id", 1).maybeSingle();
    if (!st?.enabled) return { enviou: false, motivo: "VivaConnect desligado" };
    const { data: cands } = await db.rpc("regua_cobranca_candidatos", { p_hoje: hojeBR(), p_canal: "whatsapp" });
    const porAluno = new Map<number, any[]>();
    for (const c of (cands ?? []) as any[]) (porAluno.get(c.aluno_id) ?? porAluno.set(c.aluno_id, []).get(c.aluno_id)!).push(c);
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: ja } = await db.from("regua_cobranca_envios").select("id", { count: "exact", head: true })
        .eq("canal", "whatsapp").eq("status", "enviado").gte("created_at", desde);
    let orcamento = (cfg.limite_whatsapp_dia ?? 150) - (ja ?? 0);
    let enfileirados = 0, sem_celular = 0, adiados = 0;
    const ordem = ordenar([...porAluno.values()]);
    for (const grupo of ordem) {
        const number = toZproNumber(grupo[0].celular);
        if (!number || !/^55\d{2}9\d{8}$/.test(number)) { sem_celular++; continue; }
        if (orcamento <= 0) { adiados++; continue; }
        const topo = grupo.reduce((a, b) => (b.dias > a.dias ? b : a));
        const etapa = porId.get(topo.etapa_id);
        const nome = primeiroNome(grupo[0].nome);
        await db.from("vivaconnect_outbox").insert({
            lead_id: null, channel_id: TICKET_TEMPLATE_CHANNEL_ID, kind: "cobranca", number,
            body: `Template: ${etapa.whatsapp_template} (${nome})`,
            hsm_template_name: etapa.whatsapp_template, hsm_language: "pt_BR",
            hsm_components: [{ type: "body", parameters: [{ type: "text", text: nome }] }],
        });
        orcamento--; enfileirados++;
        await db.from("regua_cobranca_envios").upsert(grupo.map((g) => ({
            aluno_id: g.aluno_id, conta_receber_id: g.conta_receber_id, numero_parcela: g.numero_parcela,
            etapa_id: g.etapa_id, canal: "whatsapp", status: "enviado", destino: number,
        })), { onConflict: "conta_receber_id,numero_parcela,etapa_id,canal" });
    }
    if (enfileirados) {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vivaconnect-api`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ action: "process_outbox" }), signal: AbortSignal.timeout(15000),
        }).catch(() => {});
    }
    return { enviou: true, enfileirados, sem_celular, adiados };
}
