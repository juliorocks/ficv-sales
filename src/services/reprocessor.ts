import { analyzeConversationWithAI, AIConversationAnalysis } from './aiSpecialist';
import { supabase } from '../lib/supabase';

/**
 * FAST RECALCULATOR: Recalculates the final score using EXISTING scores from the DB.
 * Does NOT call the AI. Instant and reliable.
 * Applies support/commercial classification based on contact name heuristics.
 */
export async function recalculateScore(protocol: string): Promise<number | null> {
    const { data, error } = await supabase
        .from('messages_logs')
        .select('contact, empathy_score, clarity_score, depth_score, commercial_score, agility_score, final_score')
        .eq('protocol', protocol)
        .single();

    if (error || !data) {
        console.error(`[Recalculator] ❌ Protocol not found: ${protocol}`, error);
        return null;
    }

    const e = Number(data.empathy_score) || 0;
    const cl = Number(data.clarity_score) || 0;
    const d = Number(data.depth_score) || 0;
    const c = Number(data.commercial_score) || 0;
    const a = Number(data.agility_score) || 0;

    // Support detection from contact name (fast, no AI needed)
    const contactLower = (data.contact || '').toLowerCase();
    const SUPPORT_KEYWORDS = ['direito', 'dúvida', 'suporte', 'aluna', 'aluno', 'acesso', 'técnic'];
    const isSupport = SUPPORT_KEYWORDS.some(k => contactLower.includes(k));

    let finalScore: number;
    if (isSupport) {
        // Neutralize commercial pillar for support interactions
        finalScore = Number(((e + cl + d + a) / 4).toFixed(1));
        console.log(`[Recalculator] 🛡️ SUPORTE detected for ${data.contact}: e=${e} cl=${cl} d=${d} a=${a} → score=${finalScore}`);
    } else {
        finalScore = Number(((e + cl + d + c + a) / 5).toFixed(1));
    }

    // Only update if score actually changed
    if (finalScore === data.final_score) {
        console.log(`[Recalculator] ℹ️ Score unchanged for ${protocol}: ${finalScore}`);
        return finalScore;
    }

    const { error: updateError } = await supabase
        .from('messages_logs')
        .update({ final_score: finalScore })
        .eq('protocol', protocol);

    if (updateError) {
        console.error(`[Recalculator] ❌ Update failed for ${protocol}:`, updateError);
        return null;
    }

    console.log(`[Recalculator] ✅ ${data.contact}: ${data.final_score} → ${finalScore}`);
    return finalScore;
}

/**
 * Recalculates scores for ALL records in the DB. Fast - no AI calls.
 */
export async function recalculateAllScores(
    onProgress?: (current: number, total: number) => Promise<void> | void
): Promise<{ updated: number; skipped: number }> {
    let allRecords: any[] = [];
    let from = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('messages_logs')
            .select('protocol')
            .range(from, from + limit - 1);

        if (error || !data || data.length === 0) {
            hasMore = false;
        } else {
            allRecords = [...allRecords, ...data];
            if (data.length < limit) hasMore = false;
            from += limit;
        }
    }

    const total = allRecords.length;
    let updated = 0;
    let skipped = 0;

    // Process in batches of 20 (fast since no AI calls)
    const batchSize = 20;
    for (let i = 0; i < total; i += batchSize) {
        const batch = allRecords.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(r => recalculateScore(r.protocol)));
        results.forEach(r => r !== null ? updated++ : skipped++);
        if (onProgress) await onProgress(Math.min(i + batchSize, total), total);
    }

    return { updated, skipped };
}

/**
 * Full AI reanalysis for a single protocol. Used for deep re-evaluation.
 */
export async function reprocessAnalysis(protocol: string): Promise<AIConversationAnalysis | null> {
    console.log(`[Reprocessor] 🔄 Starting AI analysis for: ${protocol}`);

    const { data: logEntry, error } = await supabase
        .from('messages_logs')
        .select('*')
        .eq('protocol', protocol)
        .single();

    if (error || !logEntry) {
        console.error(`[Reprocessor] ❌ Protocol not found:`, error);
        return null;
    }

    let transcript = [];
    try {
        transcript = JSON.parse(logEntry.message_content || '[]');
    } catch (e) {
        console.error(`[Reprocessor] ❌ JSON parse error for ${protocol}`);
        return null;
    }

    if (!transcript || transcript.length === 0) {
        console.warn(`[Reprocessor] ⚠️ Empty transcript for ${protocol}, skipping AI call`);
        // Fall back to score recalculation
        await recalculateScore(protocol);
        return null;
    }

    const aiMessages = transcript.map((m: any) => ({ role: m.role, text: m.text }));
    const aiResult = await analyzeConversationWithAI(aiMessages);

    if (!aiResult) {
        console.error(`[Reprocessor] ❌ AI returned null for ${protocol}. Falling back to recalculation.`);
        await recalculateScore(protocol);
        return null;
    }

    const contactLower = (logEntry.contact || '').toLowerCase();
    const SUPPORT_KEYWORDS = ['direito', 'dúvida', 'suporte', 'aluna', 'aluno', 'acesso', 'técnic'];
    const isSupport = aiResult.isCommercial === false ||
        SUPPORT_KEYWORDS.some(k => contactLower.includes(k));

    const e = Number(aiResult.globalScores.empathy) || 0;
    const cl = Number(aiResult.globalScores.clarity) || 0;
    const d = Number(aiResult.globalScores.depth) || 0;
    const c = Number(aiResult.globalScores.commercial) || 5;
    const a = Number(aiResult.globalScores.agility) || 0;

    const finalScore = isSupport
        ? Number(((e + cl + d + a) / 4).toFixed(1))
        : Number(((e + cl + d + c + a) / 5).toFixed(1));

    await supabase
        .from('messages_logs')
        .update({
            final_score: finalScore,
            empathy_score: e,
            clarity_score: cl,
            depth_score: d,
            commercial_score: c,
            agility_score: a,
            overall_conclusion: aiResult.overallConclusion,
        })
        .eq('protocol', protocol);

    console.log(`[Reprocessor] ✅ ${logEntry.contact} → ${finalScore}`);
    return aiResult;
}

/**
 * Full AI reanalysis for ALL protocols.
 */
export async function reprocessAllAnalyses(
    onProgress?: (current: number, total: number) => Promise<void> | void
) {
    let allProtocols: { protocol: any }[] = [];
    let from = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('messages_logs')
            .select('protocol')
            .range(from, from + limit - 1);

        if (error || !data || data.length === 0) {
            hasMore = false;
        } else {
            allProtocols = [...allProtocols, ...data];
            if (data.length < limit) hasMore = false;
            from += limit;
        }
    }

    const total = allProtocols.length;
    const batchSize = 5;

    for (let i = 0; i < total; i += batchSize) {
        const batch = allProtocols.slice(i, i + batchSize);
        await Promise.all(batch.map(p => reprocessAnalysis(p.protocol)));
        if (onProgress) await onProgress(Math.min(i + batchSize, total), total);
    }
}
