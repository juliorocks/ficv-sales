#!/usr/bin/env node
// Sync Sponte CRM → SurrealDB
// Uso: node scripts/sync-sponte.mjs [full|matriculas|parcelas] [start_date] [end_date]

const SPONTE_URL = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx';
const SPONTE_NS  = 'http://api.sponteeducacional.net.br/';
const CODIGO_CLIENTE = 489166;
const TOKEN = 'qBLjek3dpFxF';

const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS   = 'ficv';
const SURREAL_DB   = 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER ?? 'ficv_admin';
const SURREAL_PASS = process.env.SURREAL_PASS ?? 'Ficv@Surreal2026!';

const mode      = process.argv[2] ?? 'full';
const now       = new Date();
const year      = now.getFullYear();
const startDate = process.argv[3] ?? `${year}-01-01`;
const endDate   = process.argv[4] ?? `${year}-12-31`;

// ─── SurrealDB ────────────────────────────────────────────────────────────────

async function surrealAuth() {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, db: SURREAL_DB, user: SURREAL_USER, pass: SURREAL_PASS }),
    });
    if (!res.ok) throw new Error(`SurrealDB auth failed: ${res.status}`);
    return (await res.json()).token;
}

async function surrealSQL(token, sql) {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain', 'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`SurrealDB SQL error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
}

function sv(v) {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'number') return String(v);
    return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function sid(table, id) { return `${table}:\`${String(id)}\``; }

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
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `"${SPONTE_NS}${method}"` },
        body: soapEnvelope(method, params),
    });
    if (!res.ok) throw new Error(`Sponte HTTP ${res.status}`);
    return new TextDecoder('utf-8').decode(await res.arrayBuffer());
}

function extractAll(xml, tag) {
    const re = new RegExp(`<${tag}>(.*?)<\/${tag}>`, 'gs');
    const out = []; let m;
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
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function parseBrNumber(s) {
    if (!s) return 0;
    return parseFloat(s.replace(/\./g,'').replace(',','.')) || 0;
}

// ─── Sync matrículas ──────────────────────────────────────────────────────────

async function syncMatriculas(token) {
    console.log(`  Buscando matrículas ${startDate} → ${endDate}...`);
    const xml = await soapCall('GetMatriculas',
        `<sParametrosBusca>DataMatricula=${startDate.replace(/-/g,'/')} e ${endDate.replace(/-/g,'/')}</sParametrosBusca>`);

    const rows = extractAll(xml, 'wsMatricula')
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
            synced_at:              new Date().toISOString(),
        }))
        .filter(r => r.contrato_id > 0);

    console.log(`  ${rows.length} matrículas encontradas. Removendo período antigo...`);
    await surrealSQL(token, `DELETE sponte_matriculas WHERE data_matricula >= "${startDate}" AND data_matricula <= "${endDate}";`);

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
        process.stdout.write(`\r  ${synced}/${rows.length} inseridos...`);
    }
    console.log(`\n  ✓ ${synced} matrículas sincronizadas`);
    return synced;
}

// ─── Sync parcelas ────────────────────────────────────────────────────────────

async function syncParcelas(token) {
    console.log(`  Buscando parcelas ${startDate} → ${endDate}...`);

    const chunks = [];
    const cursor = new Date(startDate + 'T12:00:00');
    const last   = new Date(endDate   + 'T12:00:00');
    while (cursor <= last) {
        const cs = cursor.toISOString().split('T')[0];
        cursor.setMonth(cursor.getMonth() + 6);
        cursor.setDate(0);
        const ce = cursor < last ? cursor.toISOString().split('T')[0] : endDate;
        chunks.push({ start: cs, end: ce });
        cursor.setDate(cursor.getDate() + 1);
    }

    let totalSynced = 0;
    const allRows = [];

    for (const chunk of chunks) {
        const xml = await soapCall('GetParcelas',
            `<sParametrosBusca>DataPagamento=${chunk.start.replace(/-/g,'/')} e ${chunk.end.replace(/-/g,'/')}</sParametrosBusca>`
        ).catch(e => { console.error(`  chunk ${chunk.start}→${chunk.end}: ${e.message}`); return ''; });
        if (!xml) continue;

        const rows = extractAll(xml, 'wsParcela')
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
        process.stdout.write(`\r  ${totalSynced} parcelas processadas...`);
    }
    console.log(`\n  ✓ ${totalSynced} parcelas sincronizadas`);

    // Recalcula financial_goals
    console.log('  Recalculando metas financeiras...');
    const cur = new Date(startDate + 'T12:00:00');
    const endMonth = new Date(endDate + 'T12:00:00');
    while (cur <= endMonth) {
        const ym = cur.toISOString().slice(0, 7);
        const [y, m] = ym.split('-').map(Number);
        const pad = String(m).padStart(2, '0');
        const lastDay = new Date(y, m, 0).getDate();
        const achieved = allRows
            .filter(r => r.situacao_parcela === 'Quitada' && r.categoria?.toLowerCase().includes('matr') &&
                r.data_pagamento >= `${y}-${pad}-01` && r.data_pagamento <= `${y}-${pad}-${lastDay}`)
            .reduce((s, r) => s + (r.valor_pago || 0), 0);
        await surrealSQL(token,
            `UPSERT ${sid('financial_goals', `${y}_${m}`)} MERGE {year:${y},month:${m},monthly_achieved:${achieved}};`);
        cur.setMonth(cur.getMonth() + 1);
    }
    console.log('  ✓ Metas atualizadas');
    return totalSynced;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n🔄 Sync Sponte → SurrealDB | modo=${mode} | ${startDate} → ${endDate}`);
const token = await surrealAuth();
console.log('✓ SurrealDB autenticado');

if (mode === 'matriculas' || mode === 'full') await syncMatriculas(token);
if (mode === 'parcelas'   || mode === 'full') await syncParcelas(token);

console.log('\n✅ Sync concluído!');
