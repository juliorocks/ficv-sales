#!/usr/bin/env node
/**
 * Reprocessa atendimentos de messages_logs com a IA real (Edge Function
 * analyze-conversation, OpenAI gpt-5-mini) em vez da heurística de texto.
 *
 * Uso:
 *   node reanalyze-with-ai.js --from=2026-09-01 --to=2026-09-30 --limit=5        # amostra, não grava
 *   node reanalyze-with-ai.js --from=2026-09-01 --to=2026-09-30 --limit=5 --apply # amostra, grava
 *   node reanalyze-with-ai.js --from=2026-09-01 --to=2026-09-30 --apply          # mês inteiro, grava
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

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
}));
const FROM = args.from;
const TO = args.to;
const LIMIT = args.limit ? Number(args.limit) : null;
const APPLY = !!args.apply;
const CONCURRENCY = 5;
if (!FROM || !TO) {
    console.error('Uso: node reanalyze-with-ai.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--limit=N] [--apply]');
    process.exit(1);
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

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
    for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
            method: 'POST',
            headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(batch),
        });
        if (!r.ok) throw new Error(`upsert ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
}

async function analyzeConversation(messages) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/analyze-conversation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`analyze-conversation: HTTP ${r.status} ${data?.error ?? ''}`);
    return data.result;
}

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    return results;
}

async function main() {
    console.log(`Modo: ${APPLY ? 'APLICANDO no banco' : 'TESTE (chama a IA e mostra o resultado, mas NÃO grava — use --apply pra gravar)'}`);
    console.log(`Janela: ${FROM} a ${TO}${LIMIT ? ` (amostra de ${LIMIT})` : ''}`);

    let logs = await selectAll('messages_logs',
        `is_commercial=eq.true&status=eq.approved&timestamp=gte.${FROM}&timestamp=lte.${TO}T23:59:59` +
        `&select=id,protocol,agent_name,contact,message_content,empathy_score,clarity_score,depth_score,agility_score,commercial_score,final_score,overall_conclusion`);
    if (LIMIT) logs = logs.slice(0, LIMIT);
    console.log(`${logs.length} atendimentos a reprocessar.\n`);

    let done = 0, errors = 0, invalidated = 0;
    const changes = [];

    await mapWithConcurrency(logs, CONCURRENCY, async (log) => {
        try {
            let messages = [];
            try { messages = JSON.parse(log.message_content || '[]').map((m) => ({ role: m.role, text: m.text })); } catch { /* ignora */ }
            if (!messages.length) return;

            const ai = await analyzeConversation(messages);
            done++;
            process.stdout.write(`\r  ${done}/${logs.length} (${errors} erros)`);

            if (ai.shouldInvalidate) {
                invalidated++;
                changes.push({
                    protocol: log.protocol, agent: log.agent_name, invalidated: true,
                    reason: ai.invalidateReason,
                    oldCommercial: log.commercial_score, oldFinal: log.final_score,
                });
                return;
            }

            const g = ai.globalScores;
            const scores = ai.isCommercial ? [g.empathy, g.clarity, g.depth, g.commercial, g.agility] : [g.empathy, g.clarity, g.depth, g.agility];
            const finalScore = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));

            changes.push({
                protocol: log.protocol, agent: log.agent_name, invalidated: false,
                oldCommercial: log.commercial_score, newCommercial: g.commercial,
                oldFinal: log.final_score, newFinal: finalScore,
                isCommercial: ai.isCommercial, conclusion: ai.overallConclusion,
                row: {
                    protocol: log.protocol,
                    empathy_score: g.empathy, clarity_score: g.clarity, depth_score: g.depth,
                    commercial_score: g.commercial, agility_score: g.agility, final_score: finalScore,
                    is_commercial: ai.isCommercial, overall_conclusion: ai.overallConclusion,
                    improvements: ai.improvements, status: 'approved',
                },
            });
        } catch (e) {
            errors++;
            console.error(`\n  [${log.protocol}] ERRO: ${e.message}`);
        }
    });

    console.log('\n');
    console.log(`Concluído: ${done} analisados, ${errors} erros, ${invalidated} invalidados pela IA.`);

    const deltas = changes.filter((c) => !c.invalidated).map((c) => c.newCommercial - c.oldCommercial);
    const avgDelta = deltas.length ? (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2) : 0;
    console.log(`Variação média na nota Comercial: ${avgDelta} (positivo = IA deu nota maior que a heurística)`);

    console.log('\nAmostra (10 primeiros):');
    for (const c of changes.slice(0, 10)) {
        if (c.invalidated) {
            console.log(`  [${c.protocol}] ${c.agent} — IA INVALIDOU: ${c.reason}`);
        } else {
            console.log(`  [${c.protocol}] ${c.agent} — Comercial ${c.oldCommercial} → ${c.newCommercial}, Final ${c.oldFinal} → ${c.newFinal}`);
        }
    }

    if (invalidated) {
        console.log(`\nAtendimentos que a IA marcou pra invalidar:`);
        for (const c of changes.filter((c) => c.invalidated)) console.log(`  [${c.protocol}] ${c.agent} — ${c.reason}`);
    }

    if (!APPLY) {
        console.log('\nTeste concluído, nada foi gravado. Rode com --apply pra gravar essas notas no banco.');
        return;
    }

    const rows = changes.filter((c) => !c.invalidated).map((c) => c.row);
    console.log(`\nGravando ${rows.length} atendimentos reavaliados…`);
    await pgUpsert('messages_logs', rows, 'protocol');

    if (invalidated) {
        const invRows = changes.filter((c) => c.invalidated).map((c) => ({
            protocol: c.protocol, status: 'invalidated',
            overall_conclusion: `Invalidado pela IA: ${c.reason}`,
        }));
        console.log(`Marcando ${invRows.length} como invalidados…`);
        await pgUpsert('messages_logs', invRows, 'protocol');
    }
    console.log('Pronto.');
}

main().catch((e) => { console.error(e); process.exit(1); });
