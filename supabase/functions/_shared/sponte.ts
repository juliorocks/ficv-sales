// API SOAP do Sponte (WSAPIEdu.asmx) — usada pelo Portal do Aluno.
// Token em Gestão > Integrações (SPONTE_TOKEN); código do cliente FICV = 489166.
import { getSecret } from "./secrets.ts";

const URL_ = "https://api.sponteeducacional.net.br/WSAPIEdu.asmx";
const NS = "http://api.sponteeducacional.net.br/";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sponteCall(method: string, params: Record<string, string | number>): Promise<string> {
    const token = await getSecret("SPONTE_TOKEN");
    if (!token) throw new Error("Token do Sponte não configurado (Gestão > Integrações).");
    const cliente = (await getSecret("SPONTE_CODIGO_CLIENTE")) || "489166";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><${method} xmlns="${NS}"><nCodigoCliente>${esc(cliente)}</nCodigoCliente><sToken>${esc(token)}</sToken>${
        Object.entries(params).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("")
    }</${method}></soap:Body></soap:Envelope>`;
    const r = await fetch(URL_, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": `"${NS}${method}"` },
        body, signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error(`Sponte HTTP ${r.status}`);
    let xml = new TextDecoder("utf-8").decode(await r.arrayBuffer());
    // o Sponte às vezes devolve texto já "duplamente" codificado (NÃ£o) — conserta
    if (/Ã[£§©¡³ºª‡]/.test(xml)) {
        try { xml = new TextDecoder("utf-8").decode(Uint8Array.from([...xml].map((c) => c.charCodeAt(0) & 0xff))); } catch { /* mantém */ }
    }
    return xml;
}

const decodeEntities = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Registros <tag>…</tag> como objetos planos { Campo: valor } (só filhos diretos simples). */
export function records(xml: string, tag: string): Record<string, string>[] {
    const out: Record<string, string>[] = [];
    for (const m of xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))) {
        const rec: Record<string, string> = {};
        for (const f of m[1].matchAll(/<([A-Za-z]+)>([^<]*)<\/\1>/g)) rec[f[1]] = decodeEntities(f[2]).trim();
        out.push(rec);
    }
    return out;
}

export const retorno = (xml: string) => (xml.match(/<RetornoOperacao>([^<]*)</) ?? [])[1] ?? "";
export const cpfDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const brDate = (s?: string) => {
    const [d, m, y] = String(s ?? "").split("/");
    return d && m && y ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
};
export const brNum = (s?: string) => parseFloat(String(s ?? "").replace(/\./g, "").replace(",", ".")) || 0;

/** Aluno do Sponte pelo CPF (aceita com ou sem pontuação). NÃO expõe campos de senha. */
export async function sponteAlunoByCpf(cpf: string) {
    const xml = await sponteCall("GetAlunos", { sParametrosBusca: `CPF=${cpfDigits(cpf)}` });
    const a = records(xml, "wsAluno").find((r) => r.AlunoID && r.AlunoID !== "0" && cpfDigits(r.CPF) === cpfDigits(cpf));
    if (!a) return null;
    return {
        aluno_id: Number(a.AlunoID), nome: a.Nome, email: (a.Email || "").toLowerCase() || null,
        celular: a.Celular || a.Telefone || null, ra: a.RA || a.NumeroMatricula || null,
        situacao: a.Situacao || null, turma_atual: a.TurmaAtual || null, inadimplente: /sim|true|1/i.test(a.Inadimplente || ""),
        data_nascimento: brDate(a.DataNascimento),
    };
}
