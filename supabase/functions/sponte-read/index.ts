import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-surreal-token',
};

const SURREAL_ENDPOINT = 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

async function getAdminToken(): Promise<string> {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error('Falha ao autenticar no SurrealDB');
    const { token } = await res.json() as { token?: string };
    if (!token) throw new Error('SurrealDB: no token');
    return token;
}

async function surrealSQL(token: string, sql: string): Promise<unknown[]> {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain', 'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : json;
    if (entry?.status === 'ERR') throw new Error(entry.result);
    return Array.isArray(entry?.result) ? entry.result : [];
}

async function surrealMultiSQL(token: string, sql: string): Promise<unknown[][]> {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain', 'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json() as { status: string; result: unknown[] }[];
    return json.map(entry => Array.isArray(entry?.result) ? entry.result : []);
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { yearStart, yearEnd, dateStart, dateEnd } = await req.json() as {
            yearStart: string; yearEnd: string; dateStart: string; dateEnd: string;
        };

        if (!yearStart || !yearEnd || !dateStart || !dateEnd) {
            throw new Error('yearStart, yearEnd, dateStart e dateEnd são obrigatórios');
        }

        // 30 dias antes do yearStart para cobrir atribuição de agente
        const logsFromDate = new Date(yearStart + 'T00:00:00');
        logsFromDate.setDate(logsFromDate.getDate() - 30);
        const logsFrom = logsFromDate.toISOString().slice(0, 10);

        const token = await getAdminToken();

        // Executa as 4 queries em paralelo
        const [matriculasRows, parcelasRows, pendentesRows, logsRows] = await Promise.all([
            surrealSQL(token,
                `SELECT contrato_id, aluno_id, aluno, turma_id, nome_turma, nome_curso,
                        situacao_id, situacao, data_matricula, data_inicio, data_termino,
                        contratante, numero_contrato, financeiro_lancado, celular, synced_at
                 FROM sponte_matriculas
                 WHERE data_matricula >= "${yearStart}" AND data_matricula <= "${yearEnd}"
                 ORDER BY data_matricula DESC
                 LIMIT 10000;`
            ),
            surrealSQL(token,
                `SELECT conta_receber_id, aluno_id, situacao_parcela, data_pagamento,
                        vencimento, valor_parcela, valor_pago, forma_cobranca, categoria
                 FROM sponte_parcelas
                 WHERE situacao_parcela = "Quitada"
                   AND string::lowercase(categoria) CONTAINS "matr"
                   AND data_pagamento >= "${dateStart}"
                   AND data_pagamento <= "${dateEnd}"
                 LIMIT 10000;`
            ),
            surrealSQL(token,
                `SELECT conta_receber_id, aluno_id, situacao_parcela, data_pagamento,
                        vencimento, valor_parcela, valor_pago, forma_cobranca, categoria
                 FROM sponte_parcelas
                 WHERE situacao_parcela = "Pendente"
                   AND string::lowercase(categoria) CONTAINS "matr"
                   AND vencimento >= "${dateStart}"
                   AND vencimento <= "${dateEnd}"
                 LIMIT 10000;`
            ),
            surrealSQL(token,
                `SELECT agent_name, contact, timestamp
                 FROM messages_logs
                 WHERE timestamp >= "${logsFrom}"
                 LIMIT 20000;`
            ),
        ]);

        // Pega synced_at mais recente das matrículas
        const lastSync = (matriculasRows as any[]).reduce((acc: string | null, r: any) => {
            if (!r.synced_at) return acc;
            return !acc || r.synced_at > acc ? r.synced_at : acc;
        }, null);

        return new Response(JSON.stringify({
            success: true,
            matriculas: matriculasRows,
            parcelas: parcelasRows,
            pendentes: pendentesRows,
            messagesLogs: logsRows,
            lastSync,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: any) {
        console.error('Erro em sponte-read:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
