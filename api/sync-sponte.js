// Vercel serverless function — substitui a Supabase Edge Function sync-sponte
// Busca dados no Sponte CRM (SOAP) e grava direto no SurrealDB.

export const config = { maxDuration: 300 };

const SPONTE_URL = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx';
const SPONTE_NS  = 'http://api.sponteeducacional.net.br/';
const CODIGO_CLIENTE = 489166;
const TOKEN = 'qBLjek3dpFxF';

const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT
    ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS   = process.env.SURREAL_NS   ?? 'ficv';
const SURREAL_DB   = process.env.SURREAL_DB   ?? 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER ?? 'ficv_admin';
const SURREAL_PASS = process.env.SURREAL_PASS ?? 'Ficv@Surreal2026!';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Content-Type': 'application/json',
};

// ─── SurrealDB ────────────────────────────────────────────────────────────────

async function surrealAuth() {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, db: SURREAL_DB, user: SURREAL_USER, pass: SURREAL_PASS }),
    });
    if (!res.ok) throw new Error(`SurrealDB auth failed: ${res.status}`);
    const json = await res.json();
    return json.token ?? json;
}

async function surrealSQL(token, sql) {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS,
            'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`SurrealDB SQL error ${res.status}: ${txt}`);
    }
    return res.json();
}

// Serializa valor para SurrealQL inline
function sv(v) {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function sid(table, id) {
    return `${table}:\`${String(id)}\``;
}

// ─── SOAP ─────────────────────────────────────────────────────────────────────

function soapEnvelope(method, params) {
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

async function soapCall(method, params) {
    const res = await fetch(SPONTE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': `"${SPONTE_NS}${method}"`,
        },
        body: soapEnvelope(method, params),
    });
    if (!res.ok) throw new Error(`Sponte HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
}

function extractAll(xml, tag) {
    const re = new RegExp(`<${tag}>(.*?)<\/${tag}>`, 'gs');
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null) out.push(m[1]);
    return out;
}

function extractFirst(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`, 's'));
    return m ? m[1] : '';
}

function parseBrDate(s) {
    if (!s) return null;
    const [d, mo, y] = s.split('/');
    if (!d || !mo || !y) return null;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseBrNumber(s) {
    if (!s) return 0;
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Celular ──────────────────────────────────────────────────────────────────

async function fetchCelular(alunoId) {
    try {
        const xml = await soapCall('GetAlunos', `<sParametrosBusca>AlunoID=${alunoId}</sParametrosBusca>`);
        return extractFirst(xml, 'Celular') || null;
    } catch { return null; }
}

// ─── Sync matrículas → SurrealDB ─────────────────────────────────────────────

async function syncMatriculas(token, startDate, endDate) {
    const start = startDate.replace(/-/g, '/');
    const end   = endDate.replace(/-/g, '/');
    const now   = new Date().toISOString();

    let xml;
    try {
        xml = await soapCall('GetMatriculas', `<sParametrosBusca>DataMatricula=${start} e ${end}</sParametrosBusca>`);
    } catch (e) {
        return { synced: 0, error: e.message };
    }

    const records = extractAll(xml, 'wsMatricula');
    const rows = records
        .filter(r => extractFirst(r, 'ContratoID') !== '0')
        .map(r => ({
            contrato_id:            parseInt(extractFirst(r, 'ContratoID')) || 0,
            aluno_id:               parseInt(extractFirst(r, 'AlunoID')) || 0,
            aluno:                  extractFirst(r, 'Aluno') || null,
            turma_id:               parseInt(extractFirst(r, 'TurmaID')) || null,
            nome_turma:             extractFirst(r, 'NomeTurma') || null,
            nome_curso:             extractFirst(r, 'NomeCurso') || null,
            curso_id:               extractFirst(r, 'CursoID') || null,
            situacao_id:            parseInt(extractFirst(r, 'SituacaoID')) || null,
            situacao:               extractFirst(r, 'Situacao') || null,
            data_matricula:         parseBrDate(extractFirst(r, 'DataMatricula')),
            data_inicio:            parseBrDate(extractFirst(r, 'DataInicio')),
            data_termino:           parseBrDate(extractFirst(r, 'DataTermino')),
            data_encerramento:      parseBrDate(extractFirst(r, 'DataEncerramento')),
            contratante:            extractFirst(r, 'Contratante') || null,
            numero_contrato:        extractFirst(r, 'NumeroContrato') || null,
            financeiro_lancado:     extractFirst(r, 'FinanceiroLancado') || null,
            nome_matriz_curricular: extractFirst(r, 'NomeMatrizCurricular') || null,
            tipo_contrato_id:       parseInt(extractFirst(r, 'TipoContratoID')) || null,
            synced_at:              now,
        }))
        .filter(r => r.contrato_id > 0);

    if (!rows.length) return { synced: 0 };

    // Limpa registros antigos do período antes de reinserir
    await surrealSQL(token, `DELETE sponte_matriculas WHERE data_matricula >= "${startDate}" AND data_matricula <= "${endDate}";`);

    // Upsert em lotes de 100
    let synced = 0;
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const stmts = batch.map(r =>
            `UPSERT ${sid('sponte_matriculas', r.contrato_id)} CONTENT {` +
            `contrato_id:${sv(r.contrato_id)},aluno_id:${sv(r.aluno_id)},aluno:${sv(r.aluno)},` +
            `turma_id:${sv(r.turma_id)},nome_turma:${sv(r.nome_turma)},nome_curso:${sv(r.nome_curso)},` +
            `curso_id:${sv(r.curso_id)},situacao_id:${sv(r.situacao_id)},situacao:${sv(r.situacao)},` +
            `data_matricula:${sv(r.data_matricula)},data_inicio:${sv(r.data_inicio)},` +
            `data_termino:${sv(r.data_termino)},data_encerramento:${sv(r.data_encerramento)},` +
            `contratante:${sv(r.contratante)},numero_contrato:${sv(r.numero_contrato)},` +
            `financeiro_lancado:${sv(r.financeiro_lancado)},` +
            `nome_matriz_curricular:${sv(r.nome_matriz_curricular)},` +
            `tipo_contrato_id:${sv(r.tipo_contrato_id)},celular:NONE,synced_at:${sv(r.synced_at)}};`
        ).join('\n');
        await surrealSQL(token, stmts);
        synced += batch.length;
    }

    // Enriquece celular apenas para aluno_ids sem celular
    const uniqueIds = [...new Set(rows.map(r => r.aluno_id).filter(id => id > 0))];
    const checkRes = await surrealSQL(token,
        `SELECT aluno_id FROM sponte_matriculas WHERE aluno_id IN [${uniqueIds.join(',')}] AND celular != NONE LIMIT ${uniqueIds.length + 100};`
    );
    const alreadyHavePhone = new Set(
        (checkRes?.[0]?.result ?? []).map(r => r.aluno_id)
    );
    const needPhone = uniqueIds.filter(id => !alreadyHavePhone.has(id));

    let phones = 0;
    for (const alunoId of needPhone) {
        const celular = await fetchCelular(alunoId);
        if (celular) {
            await surrealSQL(token,
                `UPDATE sponte_matriculas SET celular=${sv(celular)} WHERE aluno_id = ${alunoId};`
            );
            phones++;
        }
    }

    return { synced, phones };
}

// ─── Sync parcelas → SurrealDB + atualiza financial_goals ────────────────────

async function syncParcelas(token, startDate, endDate) {
    const now = new Date().toISOString();

    // Divide em chunks de 6 meses (limite Sponte)
    const chunks = [];
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
    const allRows = [];

    for (const chunk of chunks) {
        const start = chunk.start.replace(/-/g, '/');
        const end   = chunk.end.replace(/-/g, '/');

        let xml;
        try {
            xml = await soapCall('GetParcelas', `<sParametrosBusca>DataPagamento=${start} e ${end}</sParametrosBusca>`);
        } catch (e) {
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
                synced_at:        now,
            }))
            .filter(r => r.conta_receber_id > 0);

        // Upsert em lotes
        for (let i = 0; i < rows.length; i += 100) {
            const batch = rows.slice(i, i + 100);
            const stmts = batch.map(r => {
                const recId = sid('sponte_parcelas', `${r.conta_receber_id}_${r.numero_parcela}`);
                return `UPSERT ${recId} CONTENT {` +
                    `conta_receber_id:${sv(r.conta_receber_id)},numero_parcela:${sv(r.numero_parcela)},` +
                    `aluno_id:${sv(r.aluno_id)},situacao_parcela:${sv(r.situacao_parcela)},` +
                    `data_pagamento:${sv(r.data_pagamento)},vencimento:${sv(r.vencimento)},` +
                    `valor_parcela:${sv(r.valor_parcela)},valor_pago:${sv(r.valor_pago)},` +
                    `forma_cobranca:${sv(r.forma_cobranca)},categoria:${sv(r.categoria)},` +
                    `categoria_id:${sv(r.categoria_id)},sacado:${sv(r.sacado)},` +
                    `conta_creditar:${sv(r.conta_creditar)},synced_at:${sv(r.synced_at)}};`;
            }).join('\n');
            await surrealSQL(token, stmts);
            totalSynced += batch.length;
        }
        allRows.push(...rows);
    }

    // Recalcula financial_goals por mês
    const byMonth = {};
    const cur = new Date(startDate + 'T12:00:00');
    const endMonth = new Date(endDate + 'T12:00:00');
    while (cur <= endMonth) {
        const ym = cur.toISOString().slice(0, 7);
        const [y, m] = ym.split('-').map(Number);
        const pad = String(m).padStart(2, '0');
        const lastDay = new Date(y, m, 0).getDate();

        const agg = allRows.filter(r =>
            r.situacao_parcela === 'Quitada' &&
            r.categoria?.toLowerCase().includes('matr') &&
            r.data_pagamento >= `${y}-${pad}-01` &&
            r.data_pagamento <= `${y}-${pad}-${lastDay}`
        );
        const achieved = agg.reduce((s, r) => s + (r.valor_pago || 0), 0);
        byMonth[ym] = achieved;

        const goalId = sid('financial_goals', `${y}_${m}`);
        await surrealSQL(token,
            `UPSERT ${goalId} MERGE {year:${y},month:${m},monthly_achieved:${achieved}};`
        );
        cur.setMonth(cur.getMonth() + 1);
    }

    return { synced: totalSynced, byMonth };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(200).end();
    }

    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

    try {
        const body = req.body ?? {};
        const now  = new Date();
        const year = now.getFullYear();
        const mode      = body.mode       ?? req.query.mode       ?? 'full';
        const startDate = body.start_date ?? req.query.start_date ?? `${year}-01-01`;
        const endDate   = body.end_date   ?? req.query.end_date   ?? `${year}-12-31`;

        const token = await surrealAuth();
        const result = { mode, startDate, endDate };

        if (mode === 'matriculas' || mode === 'full') {
            result.matriculas = await syncMatriculas(token, startDate, endDate);
        }

        if (mode === 'parcelas' || mode === 'full') {
            result.parcelas = await syncParcelas(token, startDate, endDate);
        }

        return res.status(200).json({ ok: true, ...result });
    } catch (err) {
        console.error('sync-sponte error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}
