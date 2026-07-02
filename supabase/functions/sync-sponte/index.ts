import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPONTE_URL = "https://api.sponteeducacional.net.br/WSAPIEdu.asmx";
const SPONTE_NS  = "http://api.sponteeducacional.net.br/";
const CODIGO_CLIENTE = 489166;
const TOKEN = "qBLjek3dpFxF";

// ─── SOAP helper ──────────────────────────────────────────────────────────────
function soapEnvelope(method: string, params: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${SPONTE_NS}">
      <nCodigoCliente>${CODIGO_CLIENTE}</nCodigoCliente>
      <sToken>${TOKEN}</sToken>
      ${params}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
}

async function soapCall(method: string, params: string): Promise<string> {
    const res = await fetch(SPONTE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": `"${SPONTE_NS}${method}"`,
        },
        body: soapEnvelope(method, params),
    });
    if (!res.ok) throw new Error(`Sponte HTTP ${res.status}`);
    return res.text();
}

// ─── XML parsing helpers ──────────────────────────────────────────────────────
function extractAll(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
    const out: string[] = [];
    let m;
    while ((m = re.exec(xml)) !== null) out.push(m[1]);
    return out;
}

function extractFirst(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
    return m ? m[1] : '';
}

function parseBrDate(s: string): string | null {
    if (!s) return null;
    const [d, mo, y] = s.split('/');
    if (!d || !mo || !y) return null;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseBrNumber(s: string): number {
    if (!s) return 0;
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Sync enrollments (GetMatriculas) ─────────────────────────────────────────
async function syncMatriculas(
    supabase: ReturnType<typeof createClient>,
    startDate: string,
    endDate: string
): Promise<{ synced: number; error?: string }> {
    // Sponte date format: YYYY/MM/DD
    const start = startDate.replace(/-/g, '/');
    const end   = endDate.replace(/-/g, '/');

    let xml: string;
    try {
        xml = await soapCall("GetMatriculas",
            `<sParametrosBusca>DataMatricula=${start} e ${end}</sParametrosBusca>`);
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }

    const records = extractAll(xml, 'wsMatricula');
    if (records.length === 0) return { synced: 0 };

    const rows = records
        .filter(r => extractFirst(r, 'ContratoID') !== '0')
        .map(r => ({
            contrato_id:           parseInt(extractFirst(r, 'ContratoID')) || 0,
            aluno_id:              parseInt(extractFirst(r, 'AlunoID')) || 0,
            aluno:                 extractFirst(r, 'Aluno') || null,
            turma_id:              parseInt(extractFirst(r, 'TurmaID')) || null,
            nome_turma:            extractFirst(r, 'NomeTurma') || null,
            nome_curso:            extractFirst(r, 'NomeCurso') || null,
            curso_id:              extractFirst(r, 'CursoID') || null,
            situacao_id:           parseInt(extractFirst(r, 'SituacaoID')) || null,
            situacao:              extractFirst(r, 'Situacao') || null,
            data_matricula:        parseBrDate(extractFirst(r, 'DataMatricula')),
            data_inicio:           parseBrDate(extractFirst(r, 'DataInicio')),
            data_termino:          parseBrDate(extractFirst(r, 'DataTermino')),
            data_encerramento:     parseBrDate(extractFirst(r, 'DataEncerramento')),
            contratante:           extractFirst(r, 'Contratante') || null,
            numero_contrato:       extractFirst(r, 'NumeroContrato') || null,
            financeiro_lancado:    extractFirst(r, 'FinanceiroLancado') || null,
            nome_matriz_curricular: extractFirst(r, 'NomeMatrizCurricular') || null,
            tipo_contrato_id:      parseInt(extractFirst(r, 'TipoContratoID')) || null,
            synced_at:             new Date().toISOString(),
        }))
        .filter(r => r.contrato_id > 0);

    if (rows.length === 0) return { synced: 0 };

    // Upsert in batches of 200
    let synced = 0;
    for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const { error } = await supabase
            .from('sponte_matriculas')
            .upsert(batch, { onConflict: 'contrato_id' });
        if (error) {
            console.error('upsert matriculas error:', error);
            return { synced, error: error.message };
        }
        synced += batch.length;
    }
    return { synced };
}

// ─── Sync parcelas for a date range + update financial_goals per month ────────
async function syncParcelas(
    supabase: ReturnType<typeof createClient>,
    startDate: string, // YYYY-MM-DD
    endDate: string    // YYYY-MM-DD
): Promise<{ synced: number; byMonth: Record<string, number>; error?: string }> {

    // Sponte limits queries to ~6 months — split into 6-month chunks
    const chunks: { start: string; end: string }[] = [];
    const cursor = new Date(startDate + 'T12:00:00');
    const last   = new Date(endDate   + 'T12:00:00');
    while (cursor <= last) {
        const chunkStart = cursor.toISOString().split('T')[0];
        cursor.setMonth(cursor.getMonth() + 6);
        cursor.setDate(0); // last day of previous month
        const chunkEnd = cursor < last ? cursor.toISOString().split('T')[0] : endDate;
        chunks.push({ start: chunkStart, end: chunkEnd });
        cursor.setDate(cursor.getDate() + 1); // move to next day
    }

    let totalSynced = 0;
    const allRows: any[] = [];

    for (const chunk of chunks) {
        const start = chunk.start.replace(/-/g, '/');
        const end   = chunk.end.replace(/-/g, '/');

        let xml: string;
        try {
            xml = await soapCall("GetParcelas",
                `<sParametrosBusca>DataPagamento=${start} e ${end}</sParametrosBusca>`);
        } catch (e: any) {
            console.error(`syncParcelas chunk ${start}→${end} error:`, e.message);
            continue;
        }

        const records = extractAll(xml, 'wsParcela');
        const rows = records
            .filter(r => extractFirst(r, 'ContaReceberID') !== '0')
            .map(r => ({
                conta_receber_id: parseInt(extractFirst(r, 'ContaReceberID')) || 0,
                numero_parcela:   extractFirst(r, 'NumeroParcela') || '0',
                aluno_id:         parseInt(extractFirst(r, 'AlunoID')) || null,
                situacao_parcela: extractFirst(r, 'SituacaoParcela') || null,
                data_pagamento:   parseBrDate(extractFirst(r, 'DataPagamento')),
                vencimento:       parseBrDate(extractFirst(r, 'Vencimento')),
                valor_parcela:    parseBrNumber(extractFirst(r, 'ValorParcela')),
                valor_pago:       parseBrNumber(extractFirst(r, 'ValorPago')),
                forma_cobranca:   extractFirst(r, 'FormaCobranca') || null,
                categoria:        extractFirst(r, 'Categoria') || null,
                categoria_id:     parseInt(extractFirst(r, 'CategoriaID')) || null,
                sacado:           extractFirst(r, 'Sacado') || null,
                conta_creditar:   extractFirst(r, 'ContaCreditar') || null,
                synced_at:        new Date().toISOString(),
            }))
            .filter(r => r.conta_receber_id > 0);

        for (let i = 0; i < rows.length; i += 200) {
            const batch = rows.slice(i, i + 200);
            const { error } = await supabase
                .from('sponte_parcelas')
                .upsert(batch, { onConflict: 'conta_receber_id,numero_parcela' });
            if (error) console.error('upsert parcelas error:', error);
            else totalSynced += batch.length;
        }
        allRows.push(...rows);
    }

    // Group quitadas by year-month and update financial_goals for each month
    const monthKeys = new Set<string>();
    allRows.forEach(r => {
        if (r.situacao_parcela === 'Quitada' && r.data_pagamento) {
            monthKeys.add(r.data_pagamento.slice(0, 7)); // YYYY-MM
        }
    });

    const byMonth: Record<string, number> = {};
    for (const ym of monthKeys) {
        const [y, m] = ym.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const pad = String(m).padStart(2, '0');

        const { data: agg } = await supabase
            .from('sponte_parcelas')
            .select('valor_pago')
            .eq('situacao_parcela', 'Quitada')
            .gte('data_pagamento', `${y}-${pad}-01`)
            .lte('data_pagamento', `${y}-${pad}-${lastDay}`);

        const achieved = (agg ?? []).reduce((s: number, r: any) => s + (r.valor_pago || 0), 0);
        byMonth[ym] = achieved;

        await supabase
            .from('financial_goals')
            .upsert(
                { year: y, month: m, monthly_achieved: achieved },
                { onConflict: 'year,month', ignoreDuplicates: false }
            );
    }

    return { synced: totalSynced, byMonth };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    try {
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const url  = new URL(req.url);

        // Params: mode (matriculas | parcelas | full), start_date, end_date
        const now  = new Date();
        const year = now.getFullYear();
        const mode = body.mode ?? url.searchParams.get('mode') ?? 'full';

        // Date range — default = current year
        const startDate = body.start_date ?? url.searchParams.get('start_date') ?? `${year}-01-01`;
        const endDate   = body.end_date   ?? url.searchParams.get('end_date')   ?? `${year}-12-31`;

        const result: Record<string, any> = { mode, startDate, endDate };

        if (mode === 'matriculas' || mode === 'full') {
            const r = await syncMatriculas(supabase, startDate, endDate);
            result.matriculas = r;
            console.log(`Matriculas synced: ${r.synced}`, r.error ?? '');
        }

        if (mode === 'parcelas' || mode === 'full') {
            const r = await syncParcelas(supabase, startDate, endDate);
            result.parcelas = r;
            console.log(`Parcelas synced: ${r.synced}, by month:`, r.byMonth);
        }

        return new Response(JSON.stringify({ ok: true, ...result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        console.error('sync-sponte error:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
