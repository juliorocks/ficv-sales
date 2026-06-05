#!/usr/bin/env node
/**
 * Recalculate Quality Audit Scores - VERSION 2
 * Advanced invalidation rules:
 * - Only count messages AFTER "Seja bem-vindo à Cidade Viva"
 * - Invalidate if client doesn't respond after welcome message
 * - Invalidate if it's administrative/support only (not commercial)
 *
 * Usage: node recalculate-scores-v2.js "Katina" "Izabelly" "Thayanne"
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Scoring keywords
const EMPATHY_KEYWORDS = ['bom dia', 'boa tarde', 'obrigado', 'obrigada', 'fico feliz', 'posso ajudar', 'entendo', 'problema'];
const CLOSING_KEYWORDS = ['matrícula', 'inscrição', 'link de inscrição', 'se inscrever', 'fazer sua matrícula'];
const SYSTEM_MESSAGE_PATTERNS = [
    'sessão irá expirar', 'sessão expirou', 'sua sessão',
    'atendimento encerrado', 'atendimento finalizado', 'atendimento transferido',
    'em fila de espera', 'aguarde na fila', '[sistema]', '[bot]',
];
const ADMIN_KEYWORDS = ['dúvida', 'secretaria', 'acadêmico', 'boleto', 'comprovante', 'certificado', 'acesso'];

function isSystemMessage(text) {
    const lower = (text || '').toLowerCase().trim();
    if (!lower) return true;
    return SYSTEM_MESSAGE_PATTERNS.some(p => lower.includes(p));
}

function isAdministrativeMessage(text) {
    const lower = (text || '').toLowerCase();
    return ADMIN_KEYWORDS.some(k => lower.includes(k));
}

function isWelcomeMessage(text) {
    const lower = (text || '').toLowerCase();
    return lower.includes('bem-vindo') && lower.includes('cidade viva');
}

function analyzeConversation(messages, contact) {
    // Find the welcome message index
    let welcomeIndex = -1;
    messages.forEach((msg, idx) => {
        if (msg.role === 'agent' && isWelcomeMessage(msg.text)) {
            welcomeIndex = idx;
        }
    });

    // If no welcome message, invalidate
    if (welcomeIndex === -1) {
        return {
            empathy: 0,
            clarity: 0,
            depth: 0,
            commercial: 0,
            agility: 0,
            final: 0,
            isCommercial: false,
            conclusion: 'Invalidado: Mensagem de boas-vindas não encontrada',
            improvements: [],
            status: 'invalidated'
        };
    }

    // Get messages AFTER welcome message
    const relevantMessages = messages.slice(welcomeIndex + 1).filter(m => !isSystemMessage(m.text));

    if (relevantMessages.length === 0) {
        return {
            empathy: 0,
            clarity: 0,
            depth: 0,
            commercial: 0,
            agility: 0,
            final: 0,
            isCommercial: false,
            conclusion: 'Invalidado: Sem mensagens após boas-vindas',
            improvements: [],
            status: 'invalidated'
        };
    }

    // Check if client responded after welcome message
    const clientMessagesAfterWelcome = relevantMessages.filter(m => m.role === 'client');
    if (clientMessagesAfterWelcome.length === 0) {
        return {
            empathy: 0,
            clarity: 0,
            depth: 0,
            commercial: 0,
            agility: 0,
            final: 0,
            isCommercial: false,
            conclusion: 'Invalidado: Cliente não respondeu após boas-vindas',
            improvements: [],
            status: 'invalidated'
        };
    }

    // Detect if it's administrative (support) or commercial
    const firstClientMsg = clientMessagesAfterWelcome[0]?.text || '';
    const isSupport = isAdministrativeMessage(firstClientMsg) || isAdministrativeMessage(contact);

    // If it's only support/administrative, invalidate
    if (isSupport) {
        return {
            empathy: 0,
            clarity: 0,
            depth: 0,
            commercial: 0,
            agility: 0,
            final: 0,
            isCommercial: false,
            conclusion: 'Invalidado: Atendimento administrativo/suporte, não comercial',
            improvements: [],
            status: 'invalidated'
        };
    }

    // Now calculate scores based on relevant messages
    const agentMessages = relevantMessages.filter(m => m.role === 'agent');

    if (agentMessages.length === 0) {
        return {
            empathy: 0,
            clarity: 0,
            depth: 0,
            commercial: 0,
            agility: 0,
            final: 0,
            isCommercial: true,
            conclusion: 'Invalidado: Sem mensagens do agente',
            improvements: [],
            status: 'invalidated'
        };
    }

    // EMPATHY SCORE
    let empathyScore = 5;
    let empathyCount = 0;
    agentMessages.forEach(msg => {
        const lower = msg.text.toLowerCase();
        if (EMPATHY_KEYWORDS.some(k => lower.includes(k))) empathyCount++;
    });
    empathyScore = Math.min(10, 5 + empathyCount * 1.5);
    if (agentMessages.length < 2) empathyScore = Math.min(empathyScore, 5);

    // CLARITY SCORE
    let clarityScore = 5;
    const longMessages = agentMessages.filter(m => m.text.length > 60).length;
    clarityScore = Math.min(10, 5 + longMessages * 1.2);

    // DEPTH SCORE
    let depthScore = 3;
    const questionsCount = agentMessages.filter(m => m.text.includes('?')).length;
    depthScore = Math.min(10, 3 + questionsCount * 2);

    // COMMERCIAL SCORE
    let commercialScore = 2;
    let closingCount = 0;
    agentMessages.forEach(msg => {
        const lower = msg.text.toLowerCase();
        if (CLOSING_KEYWORDS.some(k => lower.includes(k))) closingCount++;
    });
    commercialScore = Math.min(10, 2 + closingCount * 3);
    if (closingCount === 0 && agentMessages.length > 4) commercialScore = Math.min(commercialScore, 4);

    // AGILITY SCORE
    let agilityScore = 7;
    if (relevantMessages.length > 8) agilityScore = 9;
    else if (relevantMessages.length > 4) agilityScore = 8;
    else if (relevantMessages.length < 2) agilityScore = 5;

    // FINAL SCORE
    const scores = [empathyScore, clarityScore, depthScore, commercialScore, agilityScore];
    const finalScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

    // CONCLUSION
    let conclusion = 'Avaliação concluída';
    if (finalScore >= 8.5) conclusion = 'Excelente desempenho comercial';
    else if (finalScore >= 7) conclusion = 'Bom desempenho, com pontos de melhoria';
    else if (finalScore >= 5) conclusion = 'Regular, requer melhorias';
    else conclusion = 'Insuficiente';

    // IMPROVEMENTS
    const improvements = [];
    if (empathyScore < 6) improvements.push('Aumentar empatia e acolhimento');
    if (clarityScore < 6) improvements.push('Melhorar clareza das mensagens');
    if (depthScore < 5) improvements.push('Fazer mais perguntas de qualificação');
    if (commercialScore < 6) improvements.push('Ser mais assertivo no fechamento');
    if (agilityScore < 7) improvements.push('Agilizar respostas');

    return {
        empathy: Math.round(empathyScore * 10) / 10,
        clarity: Math.round(clarityScore * 10) / 10,
        depth: Math.round(depthScore * 10) / 10,
        commercial: Math.round(commercialScore * 10) / 10,
        agility: Math.round(agilityScore * 10) / 10,
        final: finalScore,
        isCommercial: true,
        conclusion,
        improvements: improvements.length > 0 ? improvements : ['Continuar com o excelente desempenho'],
        status: 'approved'
    };
}

async function recalculateForAgent(agentName) {
    console.log(`\n📊 Recalculando scores para ${agentName}...`);

    try {
        // Fetch ALL messages for this agent (no limit)
        let allLogs = [];
        let from = 0;
        const limit = 500;
        let hasMore = true;

        while (hasMore) {
            const { data: logs, error } = await supabase
                .from('messages_logs')
                .select('id, protocol, agent_name, contact, message_content, timestamp, status')
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
            console.log(`⚠️  ${agentName}: nenhum atendimento encontrado`);
            return { agent: agentName, processed: 0, updated: 0, invalidated: 0, errors: 0 };
        }

        console.log(`✓ Encontrados ${allLogs.length} atendimentos para ${agentName}`);

        let processed = 0;
        let updated = 0;
        let invalidated = 0;
        let errors = 0;

        for (const log of allLogs) {
            try {
                // Parse transcript
                let transcript = [];
                try {
                    transcript = JSON.parse(log.message_content || '[]');
                } catch (e) {
                    errors++;
                    processed++;
                    continue;
                }

                if (!Array.isArray(transcript)) {
                    errors++;
                    processed++;
                    continue;
                }

                // Analyze with new rules
                const analysis = analyzeConversation(transcript, log.contact);

                // Update database
                const { error: updateError } = await supabase
                    .from('messages_logs')
                    .update({
                        empathy_score: analysis.empathy,
                        clarity_score: analysis.clarity,
                        depth_score: analysis.depth,
                        commercial_score: analysis.commercial,
                        agility_score: analysis.agility,
                        final_score: analysis.final,
                        is_commercial: analysis.isCommercial,
                        overall_conclusion: analysis.conclusion,
                        improvements: analysis.improvements,
                        status: analysis.status
                    })
                    .eq('id', log.id);

                if (updateError) {
                    errors++;
                } else {
                    if (analysis.status === 'invalidated') {
                        invalidated++;
                    }
                    updated++;
                }

                processed++;
                if (processed % 50 === 0) {
                    process.stdout.write(`\r  ${agentName}: ${processed}/${allLogs.length} | ${updated} atualizados | ${invalidated} invalidados`);
                }
            } catch (err) {
                errors++;
                processed++;
            }
        }

        console.log(`\n✅ ${agentName}: ${processed} processados | ${updated} atualizados | ${invalidated} invalidados | ${errors} erros`);
        return { agent: agentName, processed, updated, invalidated, errors };
    } catch (error) {
        console.error(`❌ Erro geral para ${agentName}:`, error.message);
        return { agent: agentName, processed: 0, updated: 0, invalidated: 0, errors: 1 };
    }
}

async function main() {
    const agents = process.argv.slice(2);

    if (agents.length === 0) {
        agents.push('Karina Pimentel', 'Izabelly Souza', 'Thayanne Sales');
    }

    console.log('🚀 Iniciando recalculation de scores (V2 - Com invalidações avançadas)...');
    console.log(`📋 Agentes: ${agents.join(', ')}\n`);
    console.log('Regras de invalidação:');
    console.log('  - Sem mensagem "Seja bem-vindo à Cidade Viva"');
    console.log('  - Cliente não responde após boas-vindas');
    console.log('  - Atendimento administrativo/suporte (não comercial)\n');

    const results = [];
    for (const agent of agents) {
        const result = await recalculateForAgent(agent);
        results.push(result);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📈 RESUMO FINAL');
    console.log('='.repeat(80));

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalInvalidated = 0;
    let totalErrors = 0;

    console.log(`${'Agente'.padEnd(20)} | ${'Processados'.padStart(12)} | ${'Atualizados'.padStart(12)} | ${'Invalidados'.padStart(12)} | ${'Erros'.padStart(5)}`);
    console.log('-'.repeat(80));

    results.forEach(r => {
        console.log(`${r.agent.padEnd(20)} | ${String(r.processed).padStart(12)} | ${String(r.updated).padStart(12)} | ${String(r.invalidated).padStart(12)} | ${String(r.errors).padStart(5)}`);
        totalProcessed += r.processed;
        totalUpdated += r.updated;
        totalInvalidated += r.invalidated;
        totalErrors += r.errors;
    });

    console.log('-'.repeat(80));
    console.log(`${'TOTAL'.padEnd(20)} | ${String(totalProcessed).padStart(12)} | ${String(totalUpdated).padStart(12)} | ${String(totalInvalidated).padStart(12)} | ${String(totalErrors).padStart(5)}`);
    console.log('='.repeat(80));
    console.log('✅ Recalculação concluída!\n');
}

main().catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
});
