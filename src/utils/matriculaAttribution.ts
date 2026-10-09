// Cruza matrícula do Sponte -> atendimento (messages_logs) que de fato a gerou, atribuindo
// ao agente certo. Extraído de SponteDashboard.tsx (09/10) pra ser reusado também na Visão
// Geral (App.tsx) — o cálculo de "Média de Conversão" ali comparava TODAS as matrículas do
// período contra o total de atendimentos, sem checar se a matrícula veio de algum atendimento
// de verdade (uma aluna matriculada direto na secretaria contava como "conversão" igual a
// quem foi fechada por um agente). Esta é a MESMA regra usada pro relatório de matrículas por
// agente e pra corrigir o score Comercial da IA — os três números agora concordam entre si.
import { daysDiff, extractContactPhone, normalizeName, normalizeStudentPhone } from './sponteMatch';

export interface SponteMatricula {
    contrato_id: number;
    aluno_id: number;
    aluno: string;
    turma_id: number;
    nome_turma: string;
    nome_curso: string;
    situacao_id: number;
    situacao: string;
    data_matricula: string;
    data_inicio: string;
    data_termino: string;
    contratante: string;
    numero_contrato: string;
    financeiro_lancado: string;
    celular?: string | null;
}

export interface MessagesLogLite {
    agent_name: string | null;
    contact: string | null;
    timestamp: string;
}

export interface MatriculaDetalhe {
    agentName: string;
    aluno: string;
    curso: string;
    dataMatricula: string;
}

export interface MatriculasPorAgenteResult {
    porAgente: { agentName: string; matriculas: number }[];
    detalhes: MatriculaDetalhe[];
    semAtribuicao: number;
    jaExistente: number;
}

/**
 * Classifica cada matrícula do período em: 'valido' (atribuída ao agente do atendimento que
 * a gerou), 'sem_atribuicao' (matriculou sem nenhum atendimento rastreado — ex.: veio direto
 * na secretaria) ou 'ja_existente' (reabertura/renovação — já tinha matrícula ANTES do
 * atendimento encontrado, então esse atendimento não foi o que converteu).
 *
 * Telefone tem prioridade sobre nome; atendimento tem que ser no mesmo dia da matrícula ou
 * ANTES dela, dentro de 30 dias (atendimento depois da matrícula não pode ter sido a causa).
 */
export function computeMatriculasPorAgente(
    allMatriculas: SponteMatricula[],
    messagesLogs: MessagesLogLite[],
    dateStart: string,
    dateEnd: string,
    selectedCursos: string[],
    selectedTurma: string,
    selectedSituacao: string,
): MatriculasPorAgenteResult {
    const candidatos = allMatriculas
        .filter(sm => {
            if (!sm.aluno || !sm.data_matricula) return false;
            if (sm.data_matricula < dateStart || sm.data_matricula > dateEnd) return false;
            if (selectedCursos.length > 0 && !selectedCursos.includes(sm.nome_curso)) return false;
            if (selectedTurma && selectedTurma !== 'all' && sm.nome_turma !== selectedTurma) return false;
            if (selectedSituacao && selectedSituacao !== 'all' && sm.situacao !== selectedSituacao) return false;
            return true;
        })
        .map(sm => ({
            ...sm,
            normAluno: normalizeName(sm.aluno),
            alunoPhone: normalizeStudentPhone(sm.celular),
        }));

    const earliestMap = new Map<string, string>();
    for (const sm of allMatriculas) {
        if (!sm.aluno || !sm.data_matricula) continue;
        const norm = normalizeName(sm.aluno);
        const existing = earliestMap.get(norm);
        if (!existing || sm.data_matricula < existing) earliestMap.set(norm, sm.data_matricula);
    }

    type Contato = { normContact: string; contactPhone: string | null; agentName: string; primeiroAtendimento: string };
    const contatoMap = new Map<string, Contato>();
    for (const log of messagesLogs) {
        if (!log.agent_name || log.agent_name === 'Desconhecido' || !log.contact) continue;
        const normContact = normalizeName(log.contact.replace(/\s*\([^)]*\)\s*$/, ''));
        const contactPhone = extractContactPhone(log.contact);
        const key = `${normContact}|||${contactPhone ?? ''}|||${log.agent_name}`;
        const existing = contatoMap.get(key);
        if (!existing || log.timestamp < existing.primeiroAtendimento) {
            contatoMap.set(key, { normContact, contactPhone, agentName: log.agent_name, primeiroAtendimento: log.timestamp });
        }
    }
    const contatos = Array.from(contatoMap.values());

    type Classified = {
        aluno: string; nomeCurso: string; dataMatricula: string; normAluno: string;
        agentName: string | null; primeiroAtendimento: string | null; matchType: string | null;
        status: 'valido' | 'sem_atribuicao' | 'ja_existente';
    };
    const classified: Classified[] = [];

    for (const c of candidatos) {
        const earliestData = earliestMap.get(c.normAluno) ?? null;
        let bestMatch: { agentName: string; primeiroAtendimento: string; matchType: string } | null = null;

        const candidates = [
            ...(c.alunoPhone
                ? contatos.filter(ct =>
                    ct.contactPhone !== null && ct.contactPhone === c.alunoPhone &&
                    ct.primeiroAtendimento.slice(0, 10) <= c.data_matricula &&
                    daysDiff(ct.primeiroAtendimento.slice(0, 10), c.data_matricula) <= 30
                ).map(ct => ({ ...ct, priority: 1, matchType: 'phone' }))
                : []),
            ...contatos.filter(ct =>
                ct.normContact === c.normAluno &&
                ct.primeiroAtendimento.slice(0, 10) <= c.data_matricula &&
                daysDiff(ct.primeiroAtendimento.slice(0, 10), c.data_matricula) <= 30
            ).map(ct => ({ ...ct, priority: 2, matchType: 'name' })),
        ].sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.primeiroAtendimento.localeCompare(a.primeiroAtendimento));

        if (candidates.length > 0) {
            const top = candidates[0];
            bestMatch = { agentName: top.agentName, primeiroAtendimento: top.primeiroAtendimento, matchType: top.matchType };
        }

        let status: Classified['status'];
        if (!bestMatch) {
            status = 'sem_atribuicao';
        } else if (earliestData && earliestData < bestMatch.primeiroAtendimento.slice(0, 10)) {
            status = 'ja_existente';
        } else {
            status = 'valido';
        }
        classified.push({
            aluno: c.aluno, nomeCurso: c.nome_curso, dataMatricula: c.data_matricula, normAluno: c.normAluno,
            agentName: bestMatch?.agentName ?? null, primeiroAtendimento: bestMatch?.primeiroAtendimento ?? null,
            matchType: bestMatch?.matchType ?? null, status,
        });
    }

    const validosSorted = classified.filter(c => c.status === 'valido').sort((a, b) => {
        const ag = (a.agentName ?? '').localeCompare(b.agentName ?? '');
        if (ag !== 0) return ag;
        const na = a.normAluno.localeCompare(b.normAluno);
        if (na !== 0) return na;
        const normCursoA = normalizeName(a.nomeCurso?.split('(')[0]?.trim() ?? '');
        const normCursoB = normalizeName(b.nomeCurso?.split('(')[0]?.trim() ?? '');
        const nc = normCursoA.localeCompare(normCursoB);
        if (nc !== 0) return nc;
        return a.dataMatricula.localeCompare(b.dataMatricula);
    });

    const validosMap = new Map<string, Classified>();
    for (const c of validosSorted) {
        const normCurso = normalizeName(c.nomeCurso?.split('(')[0]?.trim() ?? '');
        const key = `${c.agentName}|||${c.normAluno}|||${normCurso}`;
        if (!validosMap.has(key)) validosMap.set(key, c);
    }
    const validos = Array.from(validosMap.values());

    const agentCounts = new Map<string, number>();
    for (const v of validos) { if (v.agentName) agentCounts.set(v.agentName, (agentCounts.get(v.agentName) ?? 0) + 1); }

    return {
        porAgente: Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1]).map(([agentName, matriculas]) => ({ agentName, matriculas })),
        detalhes: validos.map(v => ({ agentName: v.agentName!, aluno: v.aluno, curso: v.nomeCurso, dataMatricula: v.dataMatricula })),
        semAtribuicao: classified.filter(c => c.status === 'sem_atribuicao').length,
        jaExistente: classified.filter(c => c.status === 'ja_existente').length,
    };
}
