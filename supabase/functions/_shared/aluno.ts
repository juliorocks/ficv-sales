// Conta do Portal do Aluno a partir do Sponte (usada no 1º acesso e na transferência
// Comercial → Secretaria). E-mail interno <cpf>@aluno.ficv.br; senha inicial = CPF
// (padrão do Sponte) e must_change_password = true.
import { cpfDigits, sponteAlunoByCpf, sponteAlunoById, sponteNivelAluno } from "./sponte.ts";

export const fmtCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export async function findAlunoByCpf(db: any, cpf: string) {
    const d = cpfDigits(cpf);
    return (await db.from("alunos").select("id, nome, email, cpf, sponte_aluno_id, nivel").in("cpf", [d, fmtCpf(d)]).limit(1).maybeSingle()).data;
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
