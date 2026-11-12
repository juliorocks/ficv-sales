// sponte-baixa — aviso de baixa feita por sistema externo (Super Live → QuitarParcelas no Sponte).
// Sem JWT: autentica pelo cabeçalho x-baixa-key (segredo SUPERLIVE_BAIXA_KEY, Vault ou env).
//   POST { baixas: [{ conta_receber_id, numero_parcela?, valor?, pago_em?, pedido_codigo? }] }  (ou uma só, sem o array)
// Grava em sponte_baixas_externas; o gatilho do banco marca a parcela como Quitada no espelho.
import { pg } from "../_shared/db.ts";
import { getSecret } from "../_shared/secrets.ts";

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function igual(a: string, b: string) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

Deno.serve(async (req) => {
    if (req.method !== "POST") return j({ error: "Método não permitido" }, 405);
    const chave = await getSecret("SUPERLIVE_BAIXA_KEY");
    const enviada = req.headers.get("x-baixa-key") ?? "";
    if (!chave || !igual(chave, enviada)) return j({ error: "Não autorizado" }, 401);

    const corpo = await req.json().catch(() => ({}));
    const lista: any[] = Array.isArray(corpo.baixas) ? corpo.baixas : [corpo];
    if (lista.length === 0 || lista.length > 500) return j({ error: "Informe de 1 a 500 baixas" }, 400);

    const linhas = [];
    for (const b of lista) {
        const conta = Number(b.conta_receber_id);
        if (!Number.isInteger(conta) || conta <= 0) return j({ error: `conta_receber_id inválido: ${b.conta_receber_id}` }, 400);
        const valor = b.valor == null || b.valor === "" ? null : Number(b.valor);
        if (valor !== null && !(valor >= 0)) return j({ error: `valor inválido na conta ${conta}` }, 400);
        const pagoEm = b.pago_em ? String(b.pago_em).slice(0, 10) : null;
        if (pagoEm && !/^\d{4}-\d{2}-\d{2}$/.test(pagoEm)) return j({ error: `pago_em inválido na conta ${conta}` }, 400);
        linhas.push({
            conta_receber_id: conta, numero_parcela: String(b.numero_parcela ?? "1").slice(0, 10), valor, pago_em: pagoEm,
            pedido_codigo: b.pedido_codigo ? String(b.pedido_codigo).slice(0, 60) : null, origem: "superlive",
        });
    }

    const db = pg();
    const { error } = await db.from("sponte_baixas_externas").upsert(linhas, { onConflict: "conta_receber_id,numero_parcela" });
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true, gravadas: linhas.length });
});
