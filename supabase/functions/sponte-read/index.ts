import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { pg } from "../_shared/db.ts";

// sponte-read — agrega dados do Sponte + messages_logs para o SponteDashboard.
// Migrado de SurrealDB para Postgres (Supabase). Mesma forma de resposta.

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: s });

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
        const { yearStart, yearEnd, dateStart, dateEnd } = await req.json();
        if (!yearStart || !yearEnd || !dateStart || !dateEnd)
            throw new Error('yearStart, yearEnd, dateStart e dateEnd são obrigatórios');

        const logsFrom = (() => {
            const d = new Date(yearStart + 'T00:00:00'); d.setDate(d.getDate() - 30);
            return d.toISOString().slice(0, 10);
        })();

        const db = pg();
        const [matriculas, parcelas, pendentes, logs] = await Promise.all([
            db.from('sponte_matriculas')
                .select('contrato_id, aluno_id, aluno, turma_id, nome_turma, nome_curso, situacao_id, situacao, data_matricula, data_inicio, data_termino, contratante, numero_contrato, financeiro_lancado, celular, synced_at')
                .gte('data_matricula', yearStart).lte('data_matricula', yearEnd)
                .order('data_matricula', { ascending: false }).limit(10000),
            db.from('sponte_parcelas')
                .select('conta_receber_id, aluno_id, situacao_parcela, data_pagamento, vencimento, valor_parcela, valor_pago, forma_cobranca, categoria')
                .eq('situacao_parcela', 'Quitada').ilike('categoria', '%matr%')
                .gte('data_pagamento', dateStart).lte('data_pagamento', dateEnd).limit(10000),
            db.from('sponte_parcelas')
                .select('conta_receber_id, aluno_id, situacao_parcela, data_pagamento, vencimento, valor_parcela, valor_pago, forma_cobranca, categoria')
                .eq('situacao_parcela', 'Pendente').ilike('categoria', '%matr%')
                .gte('vencimento', dateStart).lte('vencimento', dateEnd).limit(10000),
            db.from('messages_logs')
                .select('agent_name, contact, timestamp')
                .gte('timestamp', logsFrom).limit(20000),
        ]);

        for (const r of [matriculas, parcelas, pendentes, logs])
            if (r.error) throw new Error(r.error.message);

        const lastSync = (matriculas.data ?? []).reduce((acc: string | null, r: any) =>
            r.synced_at && (!acc || r.synced_at > acc) ? r.synced_at : acc, null);

        return j({
            success: true,
            matriculas: matriculas.data ?? [],
            parcelas: parcelas.data ?? [],
            pendentes: pendentes.data ?? [],
            messagesLogs: logs.data ?? [],
            lastSync,
        });
    } catch (error) {
        console.error('Erro em sponte-read:', error);
        return j({ error: (error as Error).message }, 400);
    }
});
