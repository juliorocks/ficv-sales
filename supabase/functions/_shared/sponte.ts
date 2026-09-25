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
    return decodeSponte(new Uint8Array(await r.arrayBuffer()));
}

// O Sponte não é consistente na codificação: a mesma consulta volta em UTF-8 pra um
// aluno, em Latin-1 pra outro ("Introdu��o" quando lido como UTF-8) e às vezes com
// UTF-8 duplamente codificado ("NÃ£o"). Lê os bytes 1:1 (Latin-1) e remonta toda
// sequência que for UTF-8 válida — funciona nos três casos e em respostas mistas.
const UTF8_SEQ = /[\xC2-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF4][\x80-\xBF]{3}/g;
const utf8 = new TextDecoder("utf-8");
const cp1252 = new TextDecoder("windows-1252");
function fixUtf8Runs(str: string): string {
    return str.replace(UTF8_SEQ, (m) => {
        const out = utf8.decode(Uint8Array.from([...m].map((c) => c.charCodeAt(0))));
        return out.includes("\uFFFD") ? m : out;
    });
}
export function decodeSponte(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    for (let k = 0; k < 2; k++) { const n = fixUtf8Runs(s); if (n === s) break; s = n; } // 2ª passada = dupla codificação
    // o que sobrou em 0x80–0x9F é pontuação do Windows-1252 (aspas curvas, travessão…)
    return s.replace(/[\x80-\x9F]/g, (c) => cp1252.decode(Uint8Array.of(c.charCodeAt(0))));
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

/** Nível pelo nome do curso: Pós/Especialização/MBA → pos; Bacharelado/Licenciatura/Tecnólogo/Graduação → graduacao. */
export function nivelDoCurso(nome?: string | null): "pos" | "graduacao" | null {
    const n = String(nome ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/\bpos\b|pos-|especializa|mba/.test(n)) return "pos";
    if (/bacharel|licencia|tecnolog|gradua/.test(n)) return "graduacao";
    return null;
}

/** Nível do aluno pelas matrículas do Sponte (prefere a vigente/mais recente). */
export async function sponteNivelAluno(alunoId: number): Promise<"pos" | "graduacao" | null> {
    const xml = await sponteCall("GetMatriculas", { sParametrosBusca: `AlunoID=${alunoId}` });
    const ms = records(xml, "wsMatricula").filter((r) => r.ContratoID && r.ContratoID !== "0")
        .sort((a, b) => (/vigente|ativ|cursando/i.test(b.Situacao ?? "") ? 1 : 0) - (/vigente|ativ|cursando/i.test(a.Situacao ?? "") ? 1 : 0)
            || String(brDate(b.DataMatricula)).localeCompare(String(brDate(a.DataMatricula))));
    for (const m of ms) { const n = nivelDoCurso(m.NomeCurso); if (n) return n; }
    return null;
}
