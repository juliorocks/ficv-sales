// kb-fetch-url — baixa um arquivo por link pra Base de Conhecimento (só admin).
// O navegador não consegue baixar direto do Google Drive (CORS); esta função baixa e
// devolve os bytes, e a tela segue o mesmo caminho do "Enviar arquivos" (extrai o texto
// no navegador, guarda o original e indexa).
//
//   { url }  →  bytes do arquivo (headers X-File-Name / Content-Type) ou { error }
//
// Aceita: Google Drive (arquivo compartilhado como "qualquer pessoa com o link"),
// Google Docs (→ .docx), Planilhas (→ .xlsx), Apresentações (→ .pdf) e link direto https.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, identify, isAdmin, jsonRes } from "../_shared/ai.ts";

const MAX = 25 * 1024 * 1024;
const EXT: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls", "text/csv": "csv", "text/plain": "txt", "text/markdown": "md",
};

function resolve(raw: string): { url: string; kind: string; id?: string } | null {
    let u: URL;
    try { u = new URL(raw.trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get("id") ?? undefined;
    if (u.hostname === "docs.google.com" && id) {
        if (u.pathname.startsWith("/document/")) return { url: `https://docs.google.com/document/d/${id}/export?format=docx`, kind: "Google Docs", id };
        if (u.pathname.startsWith("/spreadsheets/")) return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, kind: "Google Planilhas", id };
        if (u.pathname.startsWith("/presentation/")) return { url: `https://docs.google.com/presentation/d/${id}/export/pdf`, kind: "Google Apresentações", id };
    }
    if (/(^|\.)drive\.google\.com$/.test(u.hostname) && id) {
        return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, kind: "Google Drive", id };
    }
    return { url: u.toString(), kind: "link" };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (!isAdmin(await identify(req, db))) return jsonRes({ error: "Apenas administradores." }, 403);

    const { url } = await req.json().catch(() => ({}));
    const r = resolve(String(url ?? ""));
    if (!r) return jsonRes({ error: "Link inválido." }, 400);

    let res: Response;
    try { res = await fetch(r.url, { redirect: "follow", signal: AbortSignal.timeout(45000) }); }
    catch (e) { return jsonRes({ error: `Não consegui baixar (${(e as Error).message}).` }, 502); }
    if (!res.ok) {
        return jsonRes({ error: res.status === 404 || res.status === 403 || res.status === 401
            ? `${r.kind}: sem acesso ao arquivo. Compartilhe como "Qualquer pessoa com o link" (leitor).`
            : `${r.kind}: erro HTTP ${res.status} ao baixar.` }, 400);
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // Drive devolve a página de login / "sem permissão" em HTML quando o arquivo é privado
    if (type === "text/html") {
        return jsonRes({ error: `${r.kind}: o arquivo não está público. No Drive: Compartilhar → Acesso geral → "Qualquer pessoa com o link".` }, 400);
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX) return jsonRes({ error: `Arquivo grande demais (${Math.round(len / 1048576)} MB; máx. 25 MB).` }, 400);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX) return jsonRes({ error: "Arquivo grande demais (máx. 25 MB)." }, 400);

    // nome: Content-Disposition (filename*=UTF-8''… ou filename="…") ou gerado
    const cd = res.headers.get("content-disposition") ?? "";
    // filename*=UTF-8''… (padrão) ou filename="…" — o Drive manda o UTF-8 cru no header, que o
    // fetch lê como Latin-1 ("ESPECIALIZAÃ\u0087Ã\u0083O"): re-decodifica os bytes como UTF-8
    const latin1ToUtf8 = (v: string) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...v].map((c) => c.charCodeAt(0) & 0xff))); } catch { return v; } };
    let name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? "") || latin1ToUtf8(cd.match(/filename="?([^";]+)"?/i)?.[1] ?? "");
    const ext = EXT[type] ?? (bytes[0] === 0x25 && bytes[1] === 0x50 ? "pdf" : "");
    if (!name) name = `${r.kind === "link" ? (new URL(r.url).pathname.split("/").pop() || "arquivo") : `${r.kind.replace(/\s+/g, "-")}-${(r.id ?? "").slice(0, 8)}`}`;
    if (ext && !name.toLowerCase().endsWith(`.${ext}`)) name = `${name.replace(/\.[^.]{1,5}$/, "")}.${ext}`;

    return new Response(bytes, {
        headers: {
            ...corsHeaders,
            "Access-Control-Expose-Headers": "X-File-Name",
            "Content-Type": EXT[type] ? type : (ext === "pdf" ? "application/pdf" : "application/octet-stream"),
            "X-File-Name": encodeURIComponent(name),
        },
    });
});
