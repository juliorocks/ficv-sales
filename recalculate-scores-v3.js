#!/usr/bin/env node
/**
 * Recalculate Quality Audit Scores - VERSION 3
 * Simplified and more realistic invalidation rules
 *
 * Usage: node recalculate-scores-v3.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Scoring keywords
const EMPATHY_KEYWORDS = ['bom dia', 'boa tarde', 'obrigado', 'obrigada', 'fico feliz', 'posso ajudar', 'entendo', 'problema'];
const CLOSING_KEYWORDS = ['matrícula', 'inscrição', 'link de inscrição', 'se inscrever', 'fazer sua matrícula'];
const SYSTEM_MESSAGE_PATTERNS = [
    'sessão irá expirar', 'sessão expirou', 'sua sessão',
    'atendimento encerrado', 'atendimento finalizado', 'atendimento transferido',
    'em fila de espera', 'aguarde na fila', '[sistema]', '[bot]',
];

function isSystemMessage(text) {
    const lower = (text || '').toLowerCase().trim();
    if (!lower) return true;
    return SYSTEM_MESSAGE_PATTERNS.some(p => lower.includes(p));
}

function analyzeConversation(messages) {
    // Filter out obvious system messages
    const realMessages = messages.filter(m => !isSystemMessage(m.text));

    if (realMessages.length === 0) {
        return {
            empathy: 0, clarity: 0, depth: 0, commercial: 0, agility: 0,
            final: 0, conclusion: 'Sem mensagens reais', status: 'invalidated'
        };
    }

    // Separate by role (being flexible about role assignment)
    const agentMessages = realMessages.filter(m =>
        m.role?.toLowerCase().includes('agent') ||
        m.text?.includes('*') // Agent messages often have asterisks
    );

    const clientMessages = realMessages.filter(m =>
        m.role?.toLowerCase().includes('client') &&
        !m.text?.includes('*')
    );

    // Invalidate if NO real client messages
    if (clientMessages.length === 0) {
        return {
            empathy: 0, clarity: 0, depth: 0, commercial: 0, agility: 0,
            final: 0, conclusion: 'Cliente não respondeu', status: 'invalidated'
        };
    }

    // If very few agent messages, invalidate
    if (agentMessages.length < 1) {
        return {
            empathy: 0, clarity: 0, depth: 0, commercial: 0, agility: 0,
            final: 0, conclusion: 'Agente não participou', status: 'invalidated'
        };
    }

    // CALCULATE SCORES
    let empathyScore = 5;
    let empathyCount = 0;
    agentMessages.forEach(msg => {
        const lower = msg.text?.toLowerCase() || '';
        if (EMPATHY_KEYWORDS.some(k => lower.includes(k))) empathyCount++;
    });
    empathyScore = Math.min(10, 5 + empathyCount * 1.5);

    let clarityScore = 5;
    const longMessages = agentMessages.filter(m => (m.text || '').length > 60).length;
    clarityScore = Math.min(10, 5 + longMessages * 1.2);

    let depthScore = 3;
    const questionsCount = agentMessages.filter(m => m.text?.includes('?')).length;
    depthScore = Math.min(10, 3 + questionsCount * 2);

    let commercialScore = 2;
    let closingCount = 0;
    agentMessages.forEach(msg => {
        const lower = msg.text?.toLowerCase() || '';
        if (CLOSING_KEYWORDS.some(k => lower.includes(k))) closingCount++;
    });
    commercialScore = Math.min(10, 2 + closingCount * 3);

    let agilityScore = 7;
    if (realMessages.length > 8) agilityScore = 9;
    else if (realMessages.length > 4) agilityScore = 8;

    const scores = [empathyScore, clarityScore, depthScore, commercialScore, agilityScore];
    const finalScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

    let conclusion = 'Avaliação concluída';
    if (finalScore >= 8.5) conclusion = 'Excelente desempenho';
    else if (finalScore >= 7) conclusion = 'Bom desempenho';
    else if (finalScore >= 5) conclusion = 'Regular';
    else conclusion = 'Insuficiente';

    return {
        empathy: Math.round(empathyScore * 10) / 10,
        clarity: Math.round(clarityScore * 10) / 10,
        depth: Math.round(depthScore * 10) / 10,
        commercial: Math.round(commercialScore * 10) / 10,
        agility: Math.round(agilityScore * 10) / 10,
        final: finalScore,
        conclusion,
        status: 'approved'
    };
}

async function recalculateForAgent(agentName) {
    console.log(`\n📊 Recalculando scores para ${agentName}...`);

    try {
        let allLogs = [];
        let from = 0;
        const limit = 500;
        let hasMore = true;

        while (hasMore) {
            const { data: logs, error } = await supabase
                .from('messages_logs')
                .select('id, protocol, agent_name, contact, message_content, timestamp')
                .eq('agent_name', agentName)
                .order('timestamp', { ascending: false })
                .range(from, from + limit - 1);

            if (error || !logs || logs.length === 0) {
                hasMore = false;
            } else {
                allLogs = [...allLogs, ...logs];
                if (logs.length < limit) hasMore = false;
                from += limit;
            }
        }

        if (allLogs.length === 0) {
            console.log(`⚠️  ${agentName}: nenhum atendimento`);
            return { agent: agentName, total: 0, updated: 0, invalidated: 0 };
        }

        console.log(`✓ ${allLogs.length} atendimentos encontrados`);

        let updated = 0;
        let invalidated = 0;

        for (let i = 0; i < allLogs.length; i++) {
            const log = allLogs[i];
            try {
                let transcript = [];
                try {
                    transcript = JSON.parse(log.message_content || '[]');
                } catch {
                    continue;
                }

                const analysis = analyzeConversation(transcript);

                await supabase.from('messages_logs').update({
                    empathy_score: analysis.empathy,
                    clarity_score: analysis.clarity,
                    depth_score: analysis.depth,
                    commercial_score: analysis.commercial,
                    agility_score: analysis.agility,
                    final_score: analysis.final,
                    overall_conclusion: analysis.conclusion,
                    status: analysis.status
                }).eq('id', log.id);

                if (analysis.status === 'invalidated') invalidated++;
                updated++;

                if ((i + 1) % 100 === 0) {
                    process.stdout.write(`\r  ${agentName}: ${i + 1}/${allLogs.length} | Invalidados: ${invalidated}`);
                }
            } catch (err) {
                //
            }
        }

        console.log(`\n✅ ${agentName}: ${updated} atualizados | ${invalidated} invalidados`);
        return { agent: agentName, total: allLogs.length, updated, invalidated };
    } catch (error) {
        console.error(`❌ Erro para ${agentName}:`, error.message);
        return { agent: agentName, total: 0, updated: 0, invalidated: 0 };
    }
}

async function main() {
    console.log('🚀 Recalculando scores (V3 - Versão realista)...\n');

    const results = [];
    for (const agent of ['Karina Pimentel', 'Izabelly Souza', 'Thayanne Sales']) {
        const result = await recalculateForAgent(agent);
        results.push(result);
    }

    console.log('\n' + '='.repeat(70));
    console.log('📈 RESUMO FINAL');
    console.log('='.repeat(70));

    let totalAll = 0, totalUpdated = 0, totalInvalidated = 0;

    results.forEach(r => {
        console.log(`${r.agent.padEnd(20)} | Total: ${String(r.total).padStart(4)} | Atualizados: ${String(r.updated).padStart(4)} | Invalidados: ${String(r.invalidated).padStart(4)}`);
        totalAll += r.total;
        totalUpdated += r.updated;
        totalInvalidated += r.invalidated;
    });

    console.log('-'.repeat(70));
    console.log(`${'TOTAL'.padEnd(20)} | Total: ${String(totalAll).padStart(4)} | Atualizados: ${String(totalUpdated).padStart(4)} | Invalidados: ${String(totalInvalidated).padStart(4)}`);
    console.log('='.repeat(70));
    console.log('✅ Concluído!\n');
}

main().catch(err => {
    console.error('❌ Erro:', err);
    process.exit(1);
});
