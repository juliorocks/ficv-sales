import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPONTE_URL = "https://api.sponteeducacional.net.br/WSAPIEdu.asmx";
const SPONTE_NS  = "http://api.sponteeducacional.net.br/";
const CODIGO_CLIENTE = 489166;
const TOKEN = "qBLjek3dpFxF";

// ─── SurrealDB ────────────────────────────────────────────────────────────────
const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT')
    ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

async function getSurrealToken(): Promise<string> {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error(`SurrealDB signin failed: ${res.status}`);
    const { token } = await res.json() as { token?: string };
    if (!token) throw new Error('SurrealDB: no token in signin response');
    return token;
}

function toSurreal(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
        return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return JSON.stringify(v);
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
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}`);
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : json;
    if (entry?.status === 'ERR') throw new Error(entry.result);
    return Array.isArray(entry?.result) ? entry.result : [];
}

async function surrealBatchUpsert(
    token: string,
    table: string,
    rows: Record<string, unknown>[],
    batchSize = 100
): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const lits = batch.map(r => {
            const pairs = Object.entries(r)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => `${k}: ${toSurreal(v)}`).join(', ');
            return `{ ${pairs} }`;
        }).join(', ');
        await surrealSQL(token, `INSERT INTO ${table} [${lits}] ON DUPLICATE KEY UPDATE RETURN NONE;`);
        inserted += batch.length;
    }
    return inserted;
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

async function fetchCelular(aluno_id: number): Promise<string | null> {
    try {
        const xml = await soapCall("GetAlunos", `<sParametrosBusca>AlunoID=${aluno_id}</sParametrosBusca>`);
        const celular = extractFirst(xml, 'Celular');
        return celular || null;
    } catch {
        return null;
    }
}

// ─── Sync enrollments ─────────────────────────────────────────────────────────
async function syncMatriculas(
    token: string,
    startDate: string,
    endDate: string
): Promise<{ synced: number; phones: number; error?: string }> {
    const start = startDate.replace(/-/g, '/');
    const end   = endDate.replace(/-/g, '/');

    let xml: string;
    try {
        xml = await soapCall("GetMatriculas",
            `<sParametrosBusca>DataMatricula=${start} e ${end}</sParametrosBusca>`);
    } catch (e: any) {
        return { synced: 0, phones: 0, error: e.message };
    }

    const records = extractAll(xml, 'wsMatricula');
    if (records.length === 0) return { synced: 0, phones: 0 };

    const rows = records
        .filter(r => extractFirst(r, 'ContratoID') !== '0')
        .map(r => {
            const contrato_id = parseInt(extractFirst(r, 'ContratoID')) || 0;
            return {
                id: contrato_id, // SurrealDB record ID = contrato_id
                contrato_id,
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
            };
        })
        .filter(r => r.contrato_id > 0);

    if (rows.length === 0) return { synced: 0, phones: 0 };

    const synced = await surrealBatchUpsert(token, 'sponte_matriculas', rows);

    // Enrich with celular for alunos that don't have it yet
    const uniqueAlunoIds = [...new Set(rows.map(r => r.aluno_id).filter(id => id > 0))];
    let phones = 0;

    for (let i = 0; i < uniqueAlunoIds.length; i += 200) {
        const chunk = uniqueAlunoIds.slice(i, i + 200);
        const inList = chunk.join(', ');
        const existing = await surrealSQL(token,
            `SELECT aluno_id FROM sponte_matriculas WHERE aluno_id IN [${inList}] AND celular != NONE AND celular != "" LIMIT ${chunk.length};`
        ) as Array<{ aluno_id: number }>;
        const alreadyHavePhone = new Set(existing.map(r => r.aluno_id));
        const needPhone = chunk.filter(id => !alreadyHavePhone.has(id));

        for (const aluno_id of needPhone) {
            const celular = await fetchCelular(aluno_id);
            if (celular) {
                await surrealSQL(token,
                    `UPDATE sponte_matriculas SET celular = ${toSurreal(celular)} WHERE aluno_id = ${aluno_id};`
                );
                phones++;
            }
        }
    }

    return { synced, phones };
}

// ─── Sync parcelas + financial_goals ─────────────────────────────────────────
async function syncParcelas(
    token: string,
    startDate: string,
    endDate: string
): Promise<{ synced: number; byMonth: Record<string, number>; error?: string }> {

    const chunks: { start: string; end: string }[] = [];
    const cursor = new Date(startDate + 'T12:00:00');
    const last   = new Date(endDate   + 'T12:00:00');
    while (cursor <= last) {
        const chunkStart = cursor.toISOString().split('T')[0];
        cursor.setMonth(cursor.getMonth() + 6);
        cursor.setDate(0);
        const chunkEnd = cursor < last ? cursor.toISOString().split('T')[0] : endDate;
        chunks.push({ start: chunkStart, end: chunkEnd });
        cursor.setDate(cursor.getDate() + 1);
    }

    let totalSynced = 0;
    const allMonthKeys = new Set<string>();

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
            .map(r => {
                const conta_receber_id = parseInt(extractFirst(r, 'ContaReceberID')) || 0;
                const numero_parcela   = extractFirst(r, 'NumeroParcela') || '0';
                const data_pagamento   = parseBrDate(extractFirst(r, 'DataPagamento'));
                if (data_pagamento) {
                    allMonthKeys.add(data_pagamento.slice(0, 7));
                }
                return {
                    id: `${conta_receber_id}_${numero_parcela.replace(/[^0-9a-z]/gi, '')}`,
                    conta_receber_id,
                    numero_parcela,
                    aluno_id:         parseInt(extractFirst(r, 'AlunoID')) || null,
                    situacao_parcela: extractFirst(r, 'SituacaoParcela') || null,
                    data_pagamento,
                    vencimento:       parseBrDate(extractFirst(r, 'Vencimento')),
                    valor_parcela:    parseBrNumber(extractFirst(r, 'ValorParcela')),
                    valor_pago:       parseBrNumber(extractFirst(r, 'ValorPago')),
                    forma_cobranca:   extractFirst(r, 'FormaCobranca') || null,
                    categoria:        extractFirst(r, 'Categoria') || null,
                    categoria_id:     parseInt(extractFirst(r, 'CategoriaID')) || null,
                    sacado:           extractFirst(r, 'Sacado') || null,
                    conta_creditar:   extractFirst(r, 'ContaCreditar') || null,
                    synced_at:        new Date().toISOString(),
                };
            })
            .filter(r => r.conta_receber_id > 0);

        totalSynced += await surrealBatchUpsert(token, 'sponte_parcelas', rows);
    }

    // Recalculate financial_goals per month using SurrealDB
    const byMonth: Record<string, number> = {};
    for (const ym of allMonthKeys) {
        const [y, m] = ym.split('-');
        const lastDay = new Date(Number(y), Number(m), 0).getDate();
        const pad = m.padStart(2, '0');
        const rows = await surrealSQL(token,
            `SELECT valor_pago FROM sponte_parcelas WHERE situacao_parcela = "Quitada" AND string::contains(string::lowercase(categoria), "matr") AND data_pagamento >= "${y}-${pad}-01" AND data_pagamento <= "${y}-${pad}-${lastDay}";`
        ) as Array<{ valor_pago: number }>;

        const achieved = rows.reduce((s, r) => s + (r.valor_pago || 0), 0);
        byMonth[ym] = achieved;

        await surrealSQL(token,
            `UPDATE financial_goals SET monthly_achieved = ${achieved} WHERE year = ${y} AND month = ${Number(m)};`
        );
    }

    return { synced: totalSynced, byMonth };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const token = await getSurrealToken();
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const url  = new URL(req.url);

        const now  = new Date();
        const year = now.getFullYear();
        const mode = body.mode ?? url.searchParams.get('mode') ?? 'full';
        const startDate = body.start_date ?? url.searchParams.get('start_date') ?? `${year}-01-01`;
        const endDate   = body.end_date   ?? url.searchParams.get('end_date')   ?? `${year}-12-31`;

        const result: Record<string, unknown> = { mode, startDate, endDate };

        if (mode === 'backfill_phones') {
            const rows = await surrealSQL(token,
                `SELECT aluno_id FROM sponte_matriculas WHERE (celular = NONE OR celular = "") AND aluno_id > 0;`
            ) as Array<{ aluno_id: number }>;
            const uniqueIds = [...new Set(rows.map(r => r.aluno_id))];
            let filled = 0, skipped = 0;
            for (const aluno_id of uniqueIds) {
                const celular = await fetchCelular(aluno_id);
                if (celular) {
                    await surrealSQL(token,
                        `UPDATE sponte_matriculas SET celular = ${toSurreal(celular)} WHERE aluno_id = ${aluno_id};`
                    );
                    filled++;
                } else { skipped++; }
            }
            result.backfill = { total: uniqueIds.length, filled, skipped };
            console.log(`Phone backfill: ${filled}/${uniqueIds.length} filled, ${skipped} skipped`);
        }

        if (mode === 'recalc_goals') {
            const byMonth: Record<string, number> = {};
            const cur = new Date(startDate + 'T12:00:00');
            const end = new Date(endDate + 'T12:00:00');
            while (cur <= end) {
                const ym = cur.toISOString().slice(0, 7);
                const [y, m] = ym.split('-');
                const lastDay = new Date(Number(y), Number(m), 0).getDate();
                const pad = m.padStart(2, '0');
                const rows = await surrealSQL(token,
                    `SELECT valor_pago FROM sponte_parcelas WHERE situacao_parcela = "Quitada" AND string::contains(string::lowercase(categoria), "matr") AND data_pagamento >= "${y}-${pad}-01" AND data_pagamento <= "${y}-${pad}-${lastDay}";`
                ) as Array<{ valor_pago: number }>;
                const achieved = rows.reduce((s, r) => s + (r.valor_pago || 0), 0);
                byMonth[ym] = achieved;
                await surrealSQL(token,
                    `UPDATE financial_goals SET monthly_achieved = ${achieved} WHERE year = ${y} AND month = ${Number(m)};`
                );
                cur.setMonth(cur.getMonth() + 1);
            }
            result.goals = { byMonth };
            console.log('Goals recalculated:', byMonth);
        }

        if (mode === 'matriculas' || mode === 'full') {
            const r = await syncMatriculas(token, startDate, endDate);
            result.matriculas = r;
            console.log(`Matriculas synced: ${r.synced}, phones: ${r.phones}`, r.error ?? '');
        }

        if (mode === 'parcelas' || mode === 'full') {
            const r = await syncParcelas(token, startDate, endDate);
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
