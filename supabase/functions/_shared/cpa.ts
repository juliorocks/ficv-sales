// Avaliação CPA — funções compartilhadas entre cpa-form (link público), cpa-portal (Portal do Aluno)
// e cpa-admin (painel). Tudo puro, sem acesso ao banco, para poder testar em Node.

// contexto de disciplina: "<período>~<disciplina>", só [a-z0-9~-] (ver migration cpa_portal)
export const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const contextoDisciplina = (turmaNome: string, disciplina: string) => `${slug(turmaNome)}~${slug(disciplina)}`;

// "Pós Graduação Em Liderança Cristã (Pós Glc 2026)" -> "Pós Graduação Em Liderança Cristã"
export const cursoRotulo = (nomeCurso: string) => nomeCurso.replace(/\s*\(.*\)\s*$/, "").trim();

export const nivelDoCurso = (nomeCurso: string) => (/^p[oó]s/i.test(nomeCurso.trim()) ? "pos" : "graduacao");

// HMAC do aluno + formulário + contexto. Não é reversível sem a chave, então a tabela de
// participação mostra "já respondeu" sem dizer quem é. A chave é o segredo do servidor: não trocar,
// senão quem já respondeu volta a aparecer como pendente.
export async function participacaoHash(chave: string, alunoId: number, formularioId: number, contexto: string): Promise<string> {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${alunoId}|${formularioId}|${contexto}`));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Pergunta = {
    id: number; texto: string; tipo: "escala" | "escolha" | "texto";
    escala_min: number | null; escala_max: number | null; opcoes: string[] | null;
    obrigatoria: boolean; chave: string | null;
};

// Valida e limpa as respostas. `pularCurso`: no Portal o curso vem da matrícula, não do aluno.
export function validarRespostas(perguntas: Pergunta[], entrada: Record<string, unknown>, opts: { pularCurso?: boolean } = {}):
    { ok: true; limpas: Record<string, number | string> } | { ok: false; erro: string; pergunta_id: number } {
    const limpas: Record<string, number | string> = {};
    for (const p of perguntas) {
        if (opts.pularCurso && p.chave === "curso") continue;
        const v = entrada[String(p.id)];
        const vazia = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
        if (vazia) {
            if (p.obrigatoria) return { ok: false, erro: `Responda: ${p.texto}`, pergunta_id: p.id };
            continue;
        }
        if (p.tipo === "escala") {
            const n = Number(v);
            if (!Number.isInteger(n) || n < (p.escala_min ?? 0) || n > (p.escala_max ?? 10)) {
                return { ok: false, erro: "Nota fora da escala.", pergunta_id: p.id };
            }
            limpas[p.id] = n;
        } else if (p.tipo === "escolha") {
            const op = String(v);
            if (!(p.opcoes ?? []).includes(op)) {
                return { ok: false, erro: "Opção inválida.", pergunta_id: p.id };
            }
            limpas[p.id] = op;
        } else {
            limpas[p.id] = String(v).trim().slice(0, 2000);
        }
    }
    return { ok: true, limpas };
}
