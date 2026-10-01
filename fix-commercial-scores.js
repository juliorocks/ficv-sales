#!/usr/bin/env node
/**
 * Recálculo da nota Comercial dos atendimentos já gravados em messages_logs.
 *
 * Bug corrigido: o fallback heurístico (usado sempre que não há chave Gemini —
 * ou seja, em praticamente 100% dos casos até hoje) partia de um baseline
 * punitivo (2) e só subia se achasse uma de 5-6 frases EXATAS tipo "posso
 * enviar o link para matrícula" no texto — nunca batiam com o jeito real que
 * os atendentes escrevem ("vamos prosseguir com a sua matricula?", sem
 * acento). Resultado: 1.655 de 2.411 atendimentos comerciais ficaram com nota
 * Comercial <= 2, inclusive vários que fecharam matrícula de verdade.
 *
 * Esse script:
 *   1. Recalcula a nota Comercial com a heurística corrigida (baseline 5,
 *      palavras-chave mais realistas e sem distinção de acento — mesma lógica
 *      agora usada em src/utils/csvProcessor.ts para uploads novos).
 *   2. Cruza cada atendimento com sponte_matriculas (telefone/nome, janela de
 *      30 dias) — se o lead realmente matriculou depois daquele atendimento,
 *      força Comercial = 9 (sinal de resultado real pesa mais que texto).
 *   3. Recalcula final_score (média dos 5 eixos).
 *
 * Uso:
 *   node fix-commercial-scores.js            # dry-run — só mostra o que mudaria
 *   node fix-commercial-scores.js --apply    # aplica de verdade no banco
 */
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Defina SUPABASE_URL (ou VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
}
const APPLY = process.argv.includes('--apply');

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function selectAll(table, qs) {
    const rows = [];
    let offset = 0;
    const PAGE = 1000;
    for (;;) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
            headers: { ...H, Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' },
        });
        if (!r.ok) throw new Error(`select ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
        const page = await r.json();
        rows.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
    }
    return rows;
}

async function pgUpsert(table, rows, onConflict) {
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(batch),
        });
        if (!r.ok) throw new Error(`upsert ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
}

// ── mesma lógica de src/utils/sponteMatch.ts, portada pra Node puro ──────────
function normalizeName(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function extractContactPhone(contact) {
    const m = (contact || '').match(/\((\d{8,15})\)/);
    if (!m) return null;
    const digits = m[1].replace(/[^0-9]/g, '');
    return digits.length >= 8 ? digits.slice(-11) : null;
}
function normalizeStudentPhone(celular) {
    if (!celular) return null;
    const digits = celular.replace(/[^0-9]/g, '');
    return digits.length >= 8 ? digits.slice(-11) : null;
}
function daysDiff(from, to) {
    return Math.floor((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000);
}
function findMatriculaMatch(contact, protocolDate, matriculas, windowDays = 30) {
    const contactPhone = extractContactPhone(contact);
    const normContact = normalizeName((contact || '').replace(/\s*\([^)]*\)\s*$/, ''));
    const inWindow = (sm) => sm.data_matricula >= protocolDate && daysDiff(protocolDate, sm.data_matricula) <= windowDays;
    if (contactPhone) {
        const byPhone = matriculas.find((sm) => normalizeStudentPhone(sm.celular) === contactPhone && inWindow(sm));
        if (byPhone) return byPhone;
    }
    return matriculas.find((sm) => normalizeName(sm.aluno) === normContact && inWindow(sm)) ?? null;
}

// ── mesma lógica de src/utils/csvProcessor.ts (CLOSING_KEYWORDS/hasKeyword) ──
const CLOSING_KEYWORDS = [
    'matricul', 'inscri',
    'garantir sua vaga', 'garanta sua vaga', 'garantir a vaga',
    'vamos prosseguir', 'vamos dar continuidade', 'podemos prosseguir',
    'fazer o pagamento', 'efetuar o pagamento', 'link de pagamento', 'link para pagamento',
    'boleto', 'contrato', 'comprovante',
    'fechar com a gente', 'fechamento',
];
function normalizeForMatch(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function hasKeyword(text, keywords) {
    const norm = normalizeForMatch(text);
    return keywords.some((k) => norm.includes(normalizeForMatch(k)));
}

async function main() {
    console.log(`Modo: ${APPLY ? 'APLICANDO no banco' : 'DRY-RUN (nada será gravado — use --apply pra gravar)'}`);

    console.log('Buscando atendimentos comerciais aprovados…');
    // overall_conclusion IS NOT NULL exclui registros "placeholder" vindos da migração
    // de dados antigos (nunca passaram pelo pipeline de análise — todos os eixos 0 e
    // conclusão nula, não é o mesmo bug do heurístico de fallback).
    const logs = await selectAll('messages_logs',
        'is_commercial=eq.true&status=eq.approved&overall_conclusion=not.is.null&select=id,protocol,agent_name,contact,message_content,empathy_score,clarity_score,depth_score,agility_score,commercial_score,timestamp');
    console.log(`  ${logs.length} atendimentos.`);

    console.log('Buscando matrículas do Sponte (vigente/pré-matrícula)…');
    const matriculas = await selectAll('sponte_matriculas',
        'situacao_id=in.(1,6)&select=aluno,celular,data_matricula,nome_curso,situacao_id');
    console.log(`  ${matriculas.length} matrículas.`);

    const changes = [];
    let viaSponte = 0, viaKeyword = 0;

    for (const log of logs) {
        let messages = [];
        try { messages = JSON.parse(log.message_content || '[]'); } catch { /* ignora transcript malformado */ }

        const keywordHits = messages.filter((m) => hasKeyword(m.text || '', CLOSING_KEYWORDS)).length;
        let newCommercial = Math.max(0, Math.min(10, 5 + keywordHits * 2));

        const protocolDate = (log.timestamp || '').slice(0, 10);
        const match = protocolDate ? findMatriculaMatch(log.contact, protocolDate, matriculas, 30) : null;
        const matchedSponte = !!match && newCommercial < 9;
        if (matchedSponte) newCommercial = 9;

        if (newCommercial === log.commercial_score) continue;

        const empathy = log.empathy_score ?? 0, clarity = log.clarity_score ?? 0, depth = log.depth_score ?? 0, agility = log.agility_score ?? 0;
        const newFinal = Number(((empathy + clarity + depth + newCommercial + agility) / 5).toFixed(1));

        if (matchedSponte) viaSponte++; else viaKeyword++;
        changes.push({
            protocol: log.protocol, agent: log.agent_name, contact: log.contact,
            oldCommercial: log.commercial_score, newCommercial,
            oldFinal: null, newFinal, matchedAluno: match?.aluno ?? null, matchedCurso: match?.nome_curso ?? null,
        });
    }

    console.log(`\n${changes.length} atendimentos vão mudar de nota Comercial:`);
    console.log(`  - via matrícula confirmada no Sponte: ${viaSponte}`);
    console.log(`  - via palavras-chave de fechamento no texto: ${viaKeyword}`);

    const dist = {};
    for (const c of changes) dist[c.newCommercial] = (dist[c.newCommercial] ?? 0) + 1;
    console.log('\nDistribuição das novas notas Comerciais:');
    for (const k of Object.keys(dist).sort((a, b) => Number(a) - Number(b))) console.log(`  ${k}: ${dist[k]}`);

    const sample = [...changes].sort((a, b) => (b.newCommercial - b.oldCommercial) - (a.newCommercial - a.oldCommercial)).slice(0, 15);
    console.log('\nMaiores correções (amostra):');
    for (const c of sample) {
        console.log(`  [${c.protocol}] ${c.agent} — Comercial ${c.oldCommercial} → ${c.newCommercial}, Final → ${c.newFinal}${c.matchedAluno ? `  (matriculou: ${c.matchedAluno} — ${c.matchedCurso})` : ''}`);
    }

    if (!APPLY) {
        console.log('\nDry-run concluído. Rode com --apply pra gravar essas mudanças no banco.');
        return;
    }

    console.log(`\nGravando ${changes.length} atualizações em lotes de 500…`);
    const rows = changes.map((c) => ({ protocol: c.protocol, commercial_score: c.newCommercial, final_score: c.newFinal }));
    await pgUpsert('messages_logs', rows, 'protocol');

    const matched = changes.filter((c) => c.matchedAluno).map((c) => ({ protocol: c.protocol, closing_attempt: true }));
    if (matched.length) {
        console.log(`Marcando closing_attempt=true pros ${matched.length} com matrícula confirmada…`);
        await pgUpsert('messages_logs', matched, 'protocol');
    }
    console.log('Pronto.');
}

main().catch((e) => { console.error(e); process.exit(1); });
