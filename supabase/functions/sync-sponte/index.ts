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

// ─── SurrealDB helpers (espelha financial_goals no SurrealDB) ─────────────────
const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT')
    ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

async function getSurrealAdminToken(): Promise<string | null> {
    try {
        const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
            body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
        });
        if (!res.ok) return null;
        return (await res.json()).token ?? null;
    } catch { return null; }
}

async function surrealUpdateGoals(
    token: string,
    updates: { year: number; month: number; achieved: number }[]
): Promise<void> {
    if (!updates.length) return;
    const sql = updates.map(({ year, month, achieved }) =>
        `UPDATE financial_goals SET monthly_achieved = ${achieved} WHERE year = ${year} AND month = ${month};`
    ).join('\n');
    try {
        await fetch(`${SURREAL_ENDPOINT}/sql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain', 'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
            },
            body: sql,
        });
    } catch { /* fire-and-forget */ }
}

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
    // Force UTF-8 decode regardless of Content-Type charset header
    const buf = await res.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
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

// ─── Fetch phone for a single aluno from Sponte GetAlunos ────────────────────
async function fetchCelular(aluno_id: number): Promise<string | null> {
    try {
        const xml = await soapCall("GetAlunos", `<sParametrosBusca>AlunoID=${aluno_id}</sParametrosBusca>`);
        const celular = extractFirst(xml, 'Celular');
        return celular || null;
    } catch {
        return null;
    }
}

// ─── Sync enrollments (GetMatriculas) ─────────────────────────────────────────
async function syncMatriculas(
    supabase: ReturnType<typeof createClient>,
    startDate: string,
    endDate: string
): Promise<{ synced: number; phones: number; error?: string }> {
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

    if (rows.length === 0) return { synced: 0, phones: 0 };

    // Upsert in batches of 200
    let synced = 0;
    for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const { error } = await supabase
            .from('sponte_matriculas')
            .upsert(batch, { onConflict: 'contrato_id' });
        if (error) {
            console.error('upsert matriculas error:', error);
            return { synced, phones: 0, error: error.message };
        }
        synced += batch.length;
    }

    // Enrich with Celular: only for aluno_ids that don't have it yet
    const uniqueAlunoIds = [...new Set(rows.map(r => r.aluno_id).filter(id => id > 0))];
    const { data: existing } = await supabase
        .from('sponte_matriculas')
        .select('aluno_id')
        .in('aluno_id', uniqueAlunoIds)
        .not('celular', 'is', null)
        .neq('celular', '');
    const alreadyHavePhone = new Set((existing ?? []).map((r: any) => r.aluno_id));
    const needPhone = uniqueAlunoIds.filter(id => !alreadyHavePhone.has(id));

    let phones = 0;
    for (const aluno_id of needPhone) {
        const celular = await fetchCelular(aluno_id);
        if (celular) {
            await supabase
                .from('sponte_matriculas')
                .update({ celular })
                .eq('aluno_id', aluno_id);
            phones++;
        }
    }

    return { synced, phones };
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

    // Enumerate every month in [startDate, endDate] so months with data already in
    // sponte_parcelas (from a prior sync) also get their financial_goals recalculated.
    const allMonthKeys = new Set<string>();
    const cur = new Date(startDate + 'T12:00:00');
    const endMonth = new Date(endDate + 'T12:00:00');
    while (cur <= endMonth) {
        allMonthKeys.add(cur.toISOString().slice(0, 7));
        cur.setMonth(cur.getMonth() + 1);
    }

    const byMonth: Record<string, number> = {};
    const surrealUpdates: { year: number; month: number; achieved: number }[] = [];

    for (const ym of allMonthKeys) {
        const [y, m] = ym.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const pad = String(m).padStart(2, '0');

        const { data: agg } = await supabase
            .from('sponte_parcelas')
            .select('valor_pago')
            .eq('situacao_parcela', 'Quitada')
            .ilike('categoria', '%matr%')
            .gte('data_pagamento', `${y}-${pad}-01`)
            .lte('data_pagamento', `${y}-${pad}-${lastDay}`);

        const achieved = (agg ?? []).reduce((s: number, r: any) => s + (r.valor_pago || 0), 0);
        byMonth[ym] = achieved;
        surrealUpdates.push({ year: y, month: m, achieved });

        await supabase
            .from('financial_goals')
            .upsert(
                { year: y, month: m, monthly_achieved: achieved },
                { onConflict: 'year,month', ignoreDuplicates: false }
            );
    }

    // Espelha no SurrealDB (fire-and-forget — não bloqueia a resposta)
    getSurrealAdminToken().then(tok => tok && surrealUpdateGoals(tok, surrealUpdates));

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

        if (mode === 'backfill_phones') {
            // Fill celular for all sponte_matriculas rows that still lack it
            const { data: rows } = await supabase
                .from('sponte_matriculas')
                .select('aluno_id')
                .or('celular.is.null,celular.eq.')
                .gt('aluno_id', 0);
            const uniqueIds = [...new Set((rows ?? []).map((r: any) => r.aluno_id as number))];
            let filled = 0, skipped = 0;
            for (const aluno_id of uniqueIds) {
                const celular = await fetchCelular(aluno_id);
                if (celular) {
                    await supabase.from('sponte_matriculas').update({ celular }).eq('aluno_id', aluno_id);
                    filled++;
                } else {
                    skipped++;
                }
            }
            result.backfill = { total: uniqueIds.length, filled, skipped };
            console.log(`Phone backfill: ${filled}/${uniqueIds.length} filled, ${skipped} skipped`);
        }

        if (mode === 'recalc_goals') {
            // Recalculate monthly_achieved from existing sponte_parcelas without calling Sponte API
            const byMonth: Record<string, number> = {};
            const recalcUpdates: { year: number; month: number; achieved: number }[] = [];
            const cur2 = new Date(startDate + 'T12:00:00');
            const end2 = new Date(endDate + 'T12:00:00');
            while (cur2 <= end2) {
                const ym = cur2.toISOString().slice(0, 7);
                const [y2, m2] = ym.split('-').map(Number);
                const lastDay = new Date(y2, m2, 0).getDate();
                const pad = String(m2).padStart(2, '0');
                const { data: agg } = await supabase
                    .from('sponte_parcelas')
                    .select('valor_pago')
                    .eq('situacao_parcela', 'Quitada')
                    .ilike('categoria', '%matr%')
                    .gte('data_pagamento', `${y2}-${pad}-01`)
                    .lte('data_pagamento', `${y2}-${pad}-${lastDay}`);
                const achieved = (agg ?? []).reduce((s: number, r: any) => s + (r.valor_pago || 0), 0);
                byMonth[ym] = achieved;
                recalcUpdates.push({ year: y2, month: m2, achieved });
                await supabase.from('financial_goals').upsert(
                    { year: y2, month: m2, monthly_achieved: achieved },
                    { onConflict: 'year,month', ignoreDuplicates: false }
                );
                cur2.setMonth(cur2.getMonth() + 1);
            }
            // Espelha no SurrealDB
            const surrealTok = await getSurrealAdminToken();
            if (surrealTok) await surrealUpdateGoals(surrealTok, recalcUpdates);
            result.goals = { byMonth };
            console.log('Goals recalculated from sponte_parcelas:', byMonth);
        }

        if (mode === 'matriculas' || mode === 'full') {
            const r = await syncMatriculas(supabase, startDate, endDate);
            result.matriculas = r;
            console.log(`Matriculas synced: ${r.synced}, phones: ${r.phones}`, r.error ?? '');
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
