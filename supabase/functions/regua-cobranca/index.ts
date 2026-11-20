// regua-cobranca — avisos de mensalidade a vencer/vencida por e-mail.
//   rodar    {}                      (cron diário, service) → envia se modo = 'ligado'; em 'teste' só simula
//   simular  {}                      (admin)                → quantos receberiam hoje, por etapa
//   amostra  { etapa_id, email? }    (admin)                → manda 1 e-mail de exemplo (para o e-mail do admin ou o informado)
// Nunca escreve valores na mensagem (dependem de bolsa/desconto): o valor certo está no Portal.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { identify, isAdmin, jsonRes } from "../_shared/ai.ts";
import { emailLayout, escHtml, portalUrl, sendEmail } from "../_shared/email.ts";

const hojeBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const br = (iso: string) => iso.split("-").reverse().join("/");
const primeiroNome = (s: string) => {
    const n = String(s ?? "").trim().split(/\s+/)[0] ?? "";
    return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "aluno(a)";
};

function preencher(t: string, v: Record<string, string>) {
    return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

function montar(etapa: any, nome: string, parcelas: { vencimento: string; atraso: number }[], link: string) {
    const ordenadas = [...parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const p = ordenadas[0];
    const vars = { nome: primeiroNome(nome), dias: String(Math.abs(p.atraso)), vencimento: br(p.vencimento) };
    const extra = ordenadas.length > 1 ? `\n\nVocê tem ${ordenadas.length} parcelas nessa situação; veja todas no Portal.` : "";
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
        const m = montar(etapa, "Maria da Silva", [{ vencimento: d, atraso: etapa.dias }], link);
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

    if (action === "simular" || cfg?.modo !== "ligado" || !cfg?.email_ativo) {
        return jsonRes({ modo: cfg?.modo ?? "teste", enviou: false, alunos: porAluno.size, emails_a_enviar: emails, limite_dia: cfg?.limite_email_dia, por_etapa: resumo });
    }

    // teto diário (a mesma chave do Resend serve aos chamados): o que passar fica para a próxima rodada
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: jaEnviados } = await db.from("regua_cobranca_envios").select("id", { count: "exact", head: true })
        .eq("canal", "email").eq("status", "enviado").gte("created_at", desde);
    let orcamento = (cfg.limite_email_dia ?? 60) - Math.ceil((jaEnviados ?? 0));
    let enviados = 0, falhas = 0, adiados = 0;
    // mais atrasados primeiro: são os que mais importam
    const ordem = [...porAluno.values()].sort((a, b) => Math.max(...b.map((x) => x.dias)) - Math.max(...a.map((x) => x.dias)));
    for (const grupo of ordem) {
        const email = grupo[0].email as string | null;
        if (!email) continue;
        if (orcamento <= 0) { adiados++; continue; }
        const topo = grupo.reduce((a, b) => (b.dias > a.dias ? b : a));
        const m = montar(porId.get(topo.etapa_id), grupo[0].nome, grupo.map((g) => ({ vencimento: g.vencimento, atraso: g.atraso })), link);
        const r = await sendEmail(email, m.assunto, m.html);
        orcamento--;
        const status = r.ok ? "enviado" : "falhou";
        if (r.ok) enviados++; else falhas++;
        await db.from("regua_cobranca_envios").upsert(grupo.map((g) => ({
            aluno_id: g.aluno_id, conta_receber_id: g.conta_receber_id, numero_parcela: g.numero_parcela,
            etapa_id: g.etapa_id, canal: "email", status, destino: email, erro: r.ok ? null : (r.error ?? "").slice(0, 300),
        })), { onConflict: "conta_receber_id,numero_parcela,etapa_id,canal" });
    }
    return jsonRes({ modo: "ligado", enviou: true, enviados, falhas, adiados, sem_email: lista.filter((c) => !c.email).length });
});
