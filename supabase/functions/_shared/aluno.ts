// Conta do Portal do Aluno a partir do Sponte (usada no 1º acesso e na transferência
// Comercial → Secretaria). E-mail interno <cpf>@aluno.ficv.br; senha inicial = CPF
// (padrão do Sponte) e must_change_password = true.
import { cpfDigits, sponteAlunoByCpf, sponteAlunoById, sponteNivelAluno } from "./sponte.ts";

export const fmtCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export async function findAlunoByCpf(db: any, cpf: string) {
    const d = cpfDigits(cpf);
    return (await db.from("alunos").select("id, nome, email, cpf, sponte_aluno_id, nivel").in("cpf", [d, fmtCpf(d)]).limit(1).maybeSingle()).data;
}

const normNome = (s: string) => (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim().replace(/\s+/g, " ");

/** Achado ao vivo 08/10: pelo menos 4 contas criadas com o Nome TROCADO — o CPF/AlunoID/RA que
 *  o GetAlunos devolveu sempre bateu certo (confirmado contra `sponte_matriculas`), só o campo
 *  Nome vinha errado (erro de digitação da secretaria em outro cadastro do Sponte, não bug
 *  nosso). Confere o Nome que acabou de vir do Sponte contra o histórico de matrícula já
 *  sincronizado localmente pro MESMO AlunoID antes de criar a conta — sem matrícula local pra
 *  esse AlunoID (aluno recém-matriculado, ainda não sincronizado), não tem com o que comparar,
 *  deixa passar (não dá pra fazer melhor que confiar no Sponte nesse caso). */
async function nomeDivergeDoHistorico(db: any, alunoId: number, nome: string): Promise<boolean> {
    const { data } = await db.from("sponte_matriculas").select("aluno").eq("aluno_id", alunoId).limit(50);
    const historicos = [...new Set((data || []).map((r: any) => normNome(r.aluno)))].filter(Boolean);
    if (historicos.length === 0) return false;
    return !historicos.some((h) => mesmoNome(h, nome));
}

// "Bruna Martins" (matrícula) e "Bruna Aparecida Martins Silva" (cadastro) são a mesma pessoa: aceita
// quando as palavras de um nome estão todas no outro. Nome de outra pessoa continua divergindo.
const LIGACAO = new Set(["de", "da", "do", "das", "dos", "e"]);
function mesmoNome(a: string, b: string): boolean {
    const ta = normNome(a).split(" ").filter((t) => t && !LIGACAO.has(t));
    const tb = normNome(b).split(" ").filter((t) => t && !LIGACAO.has(t));
    if (!ta.length || !tb.length) return false;
    const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    return menor.every((t) => maior.includes(t));
}

/** Garante a conta do aluno. Devolve { aluno } ou { error }. Não mexe em conta existente. */
export async function ensureAlunoAccount(db: any, cpf: string): Promise<{ aluno?: any; created?: boolean; error?: string }> {
    const d = cpfDigits(cpf);
    if (d.length !== 11) return { error: "CPF inválido." };
    const existing = await findAlunoByCpf(db, d);
    if (existing) {
        if (existing.sponte_aluno_id && !existing.nivel) {
            const nivel = await sponteNivelAluno(existing.sponte_aluno_id).catch(() => null);
            if (nivel) { await db.from("alunos").update({ nivel }).eq("id", existing.id); existing.nivel = nivel; }
        }
        return { aluno: existing, created: false };
    }
    const s = await sponteAlunoByCpf(d);
    if (!s) return { error: "CPF não encontrado entre os alunos no Sponte." };
    if (await nomeDivergeDoHistorico(db, s.aluno_id, s.nome)) {
        return { error: "Divergência de cadastro no Sponte — contate a secretaria para liberar seu acesso." };
    }
    const { data: created, error: cErr } = await db.auth.admin.createUser({
        email: `${d}@aluno.ficv.br`, password: d, email_confirm: true,
        user_metadata: { nome: s.nome, sponte_aluno_id: s.aluno_id },
    });
    if (cErr || !created?.user) return { error: `Não foi possível criar o acesso: ${cErr?.message ?? "erro"}` };
    const row = {
        id: created.user.id, cpf: fmtCpf(d), nome: s.nome, email: s.email ?? "", telefone: s.celular,
        ra: s.ra, sponte_aluno_id: s.aluno_id, must_change_password: true,
        nivel: await sponteNivelAluno(s.aluno_id).catch(() => null),
    };
    const { error: iErr } = await db.from("alunos").insert(row);
    if (iErr) { await db.auth.admin.deleteUser(created.user.id); return { error: "Não foi possível salvar o aluno." }; }
    return { aluno: row, created: true };
}

/** Mesma garantia de conta, mas a partir do AlunoID do Sponte (busca por nome/turma, 02/10 —
 *  "abrir chamado pra um aluno específico ou pra turma inteira") — quando já tem conta, nem
 *  chama o Sponte de novo; quando não tem, busca o CPF pelo AlunoID e delega pro mesmo fluxo
 *  de criação de sempre (ensureAlunoAccount), pra nunca duplicar a lógica sensível de conta. */
export async function ensureAlunoAccountById(db: any, sponteAlunoId: number): Promise<{ aluno?: any; created?: boolean; error?: string }> {
    const { data: existing } = await db.from("alunos").select("id, nome, email, cpf, sponte_aluno_id, nivel")
        .eq("sponte_aluno_id", sponteAlunoId).maybeSingle();
    if (existing) return { aluno: existing, created: false };
    const s = await sponteAlunoById(sponteAlunoId);
    if (!s?.cpf) return { error: "CPF não encontrado no Sponte pra esse aluno." };
    return ensureAlunoAccount(db, s.cpf);
}
