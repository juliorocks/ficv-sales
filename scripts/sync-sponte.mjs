#!/usr/bin/env node
// Sync Sponte CRM → Supabase (Postgres via PostgREST)
// Uso: node scripts/sync-sponte.mjs [full|matriculas|parcelas|abertas] [start_date] [end_date]

import { pgUpsert, pgEnabled } from './lib/pg-mirror.mjs';


const SPONTE_URL = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx';
const SPONTE_NS  = 'http://api.sponteeducacional.net.br/';
const CODIGO_CLIENTE = 489166;
// Token do Sponte: Gestão > Integrações (Supabase Vault). SPONTE_TOKEN no ambiente tem prioridade.
async function loadSponteToken() {
    if (process.env.SPONTE_TOKEN) return process.env.SPONTE_TOKEN;
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Defina SPONTE_TOKEN ou SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${url}/rest/v1/rpc/integ_get_secret`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: 'SPONTE_TOKEN' }),
    });
    const t = await r.json();
    if (!r.ok || !t) throw new Error(`Token do Sponte não encontrado no cofre (HTTP ${r.status})`);
    return t;
}
const TOKEN = await loadSponteToken();

const mode      = process.argv[2] ?? 'full';
const now       = new Date();
const year      = now.getFullYear();
const startDate = process.argv[3] || `${year}-01-01`;
const endDate   = process.argv[4] || `${year}-12-31`;

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

async function syncMatriculas() {
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

    console.log(`  ${rows.length} matrículas encontradas. Upserting...`);

    await pgUpsert('sponte_matriculas', rows, 'contrato_id');
    const synced = rows.length;
    console.log(`\n  ✓ ${synced} matrículas sincronizadas`);
    return synced;
}

function parseParcelas(xml) {
    return extractAll(xml, 'wsParcela')
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
}

// ─── Sync parcelas ────────────────────────────────────────────────────────────

async function syncParcelas() {
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

    for (const chunk of chunks) {
        const xml = await soapCall('GetParcelas',
            `<sParametrosBusca>DataPagamento=${chunk.start.replace(/-/g,'/')} e ${chunk.end.replace(/-/g,'/')}</sParametrosBusca>`
        ).catch(e => { console.error(`  chunk ${chunk.start}→${chunk.end}: ${e.message}`); return ''; });
        if (!xml) continue;

        const rows = parseParcelas(xml);

        await pgUpsert('sponte_parcelas', rows, 'conta_receber_id,numero_parcela');
        totalSynced += rows.length;
        process.stdout.write(`\r  ${totalSynced} parcelas processadas...`);
    }
    console.log(`\n  ✓ ${totalSynced} parcelas sincronizadas`);

    // Não recalcula financial_goals.monthly_achieved aqui: o cron horário só busca os últimos 3 dias,
    // e somar só essas parcelas sobrescrevia o total do mês (setembro ficou em 1.669 em vez de 13.483).
    // O atingido é calculado ao vivo de sponte_parcelas no frontend (GoalGauge.tsx).
    return totalSynced;
}


// Inadimplência: o sync acima busca por data de pagamento (só traz parcela paga). Aqui a busca é por
// vencimento, que traz também Pendente e Cancelada; do início do ano até 45 dias à frente.
async function syncAbertas() {
    const fim = new Date(now.getTime() + 45 * 86400000).toISOString().split('T')[0];
    const ini = process.env.ABERTAS_DESDE || `${year}-01-01`;
    console.log(`  Buscando parcelas por vencimento ${ini} → ${fim}...`);
    const cursor = new Date(ini + 'T12:00:00');
    const last   = new Date(fim + 'T12:00:00');
    let total = 0;
    while (cursor <= last) {
        const cs = cursor.toISOString().split('T')[0];
        cursor.setMonth(cursor.getMonth() + 1);
        cursor.setDate(0);
        const ce = cursor < last ? cursor.toISOString().split('T')[0] : fim;
        const xml = await soapCall('GetParcelas',
            `<sParametrosBusca>DataVencimento=${cs.replace(/-/g,'/')} e ${ce.replace(/-/g,'/')}</sParametrosBusca>`
        ).catch(e => { console.error(`  vencimento ${cs}→${ce}: ${e.message}`); return ''; });
        cursor.setDate(cursor.getDate() + 1);
        if (!xml) continue;
        const rows = parseParcelas(xml);
        await pgUpsert('sponte_parcelas', rows, 'conta_receber_id,numero_parcela');
        total += rows.length;
        process.stdout.write(`\r  ${total} parcelas por vencimento...`);
    }
    console.log(`\n  ✓ ${total} parcelas por vencimento sincronizadas`);
}

// INPC (série 188 do Banco Central) para atualizar parcelas em atraso no dashboard de inadimplência
async function syncInpc() {
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.188/dados?formato=json&dataInicial=01/01/${year - 1}`);
    if (!r.ok) { console.error(`  INPC: HTTP ${r.status}`); return; }
    const rows = (await r.json()).map(x => ({ mes: x.data.split('/').reverse().join('-'), variacao: parseFloat(x.valor) })).filter(x => !Number.isNaN(x.variacao));
    await pgUpsert('indice_inpc', rows, 'mes');
    console.log(`  ✓ ${rows.length} meses de INPC`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!pgEnabled) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não definidos');
console.log(`\n🔄 Sync Sponte → Supabase | modo=${mode} | ${startDate} → ${endDate}`);

if (mode === 'matriculas' || mode === 'full') await syncMatriculas();
if (mode === 'parcelas'   || mode === 'full') await syncParcelas();
if (mode === 'abertas'    || mode === 'full') { await syncAbertas(); await syncInpc(); }

console.log('\n✅ Sync concluído!');
