#!/usr/bin/env node
// Sync Meta Ads → SurrealDB (GitHub Actions — sem Supabase)

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID; // ex: act_1189439942268233
const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT;
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER;
const SURREAL_PASS = process.env.SURREAL_PASS;

const META_BASE = 'https://graph.facebook.com/v21.0';
const DATE_PRESET = process.argv[2] || 'last_90_days';

// ── SurrealDB ────────────────────────────────────────────────────────────────

async function surrealAuth() {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: SURREAL_USER, pass: SURREAL_PASS }),
    });
    if (!res.ok) throw new Error(`SurrealDB auth: ${res.status} ${await res.text()}`);
    return (await res.json()).token;
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
    if (!res.ok) throw new Error(`SurrealDB SQL ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const errs = data.filter(r => r.status === 'ERR');
    if (errs.length) throw new Error(errs.map(e => e.result).join('; '));
    return data;
}

function sv(v) {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `d"${v}"`;
        return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return JSON.stringify(v);
}

async function upsertBatch(token, table, rows, buildSql) {
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const sql = batch.map(r => buildSql(r)).join('\n');
        await surrealSQL(token, sql);
        process.stdout.write(`\r  ${Math.min(i + 50, rows.length)}/${rows.length}...`);
    }
    console.log(`\r  ✓ ${rows.length} registros                `);
}

// ── Meta Ads API ─────────────────────────────────────────────────────────────

async function metaGet(path, params = {}) {
    const url = new URL(`${META_BASE}/${path}`);
    url.searchParams.set('access_token', META_ACCESS_TOKEN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const rows = [];
    let nextUrl = url.toString();

    while (nextUrl) {
        const res = await fetch(nextUrl);
        const body = await res.json();
        if (body.error) throw new Error(`Meta API ${path}: ${body.error.message}`);
        if (body.data) rows.push(...body.data);
        nextUrl = body.paging?.next || null;
    }
    return rows;
}

async function syncCampaigns(token) {
    console.log('Campanhas Meta...');
    const rows = await metaGet(`${META_AD_ACCOUNT_ID}/campaigns`, {
        fields: 'id,name,objective,status,daily_budget,lifetime_budget,budget_remaining',
        limit: '500',
    });
    console.log(`  ${rows.length} campanhas`);
    const now = new Date().toISOString();
    await upsertBatch(token, 'meta_campaigns', rows, r =>
        `INSERT INTO meta_campaigns (campaign_id, name, objective, status, daily_budget, lifetime_budget, budget_remaining, updated_at) ` +
        `VALUES (${sv(r.id)}, ${sv(r.name)}, ${sv(r.objective || '')}, ${sv(r.status)}, ` +
        `${sv(Number(r.daily_budget || 0) / 100)}, ${sv(Number(r.lifetime_budget || 0) / 100)}, ` +
        `${sv(Number(r.budget_remaining || 0) / 100)}, ${sv(now)}) ` +
        `ON DUPLICATE KEY UPDATE name=${sv(r.name)}, status=${sv(r.status)}, ` +
        `daily_budget=${sv(Number(r.daily_budget || 0) / 100)}, ` +
        `lifetime_budget=${sv(Number(r.lifetime_budget || 0) / 100)}, ` +
        `budget_remaining=${sv(Number(r.budget_remaining || 0) / 100)}, updated_at=${sv(now)};`
    );
    return rows;
}

async function syncInsights(token) {
    console.log(`Insights Meta (${DATE_PRESET})...`);
    const rows = await metaGet(`${META_AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,frequency,ctr,cpm',
        level: 'campaign',
        time_increment: '1',
        date_preset: DATE_PRESET,
        limit: '500',
    });
    console.log(`  ${rows.length} registros`);
    const now = new Date().toISOString();
    await surrealSQL(token, `DELETE meta_campaign_insights_daily WHERE date >= "${rows[0]?.date_start || ''}" AND date <= "${rows[rows.length - 1]?.date_start || ''}";`);
    await upsertBatch(token, 'meta_campaign_insights_daily', rows, r =>
        `INSERT INTO meta_campaign_insights_daily [{` +
        `campaign_id:${sv(r.campaign_id)},campaign_name:${sv(r.campaign_name)},` +
        `date:${sv(r.date_start)},spend:${sv(Number(r.spend || 0))},` +
        `impressions:${sv(Number(r.impressions || 0))},clicks:${sv(Number(r.clicks || 0))},` +
        `reach:${sv(Number(r.reach || 0))},frequency:${sv(Number(r.frequency || 0))},` +
        `ctr:${sv(Number(r.ctr || 0))},cpm:${sv(Number(r.cpm || 0))},` +
        `leads_count:0,synced_at:${sv(now)}}] RETURN NONE;`
    );
    return rows;
}

async function syncDemographics(token) {
    console.log(`Demographics Meta (${DATE_PRESET})...`);
    const rows = await metaGet(`${META_AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,impressions,clicks,spend',
        breakdowns: 'age,gender',
        level: 'campaign',
        time_increment: '1',
        date_preset: DATE_PRESET,
        limit: '500',
    });
    console.log(`  ${rows.length} registros`);
    const now = new Date().toISOString();
    if (rows.length) {
        await surrealSQL(token, `DELETE meta_demographics_daily WHERE date >= "${rows[0]?.date_start || ''}";`);
        await upsertBatch(token, 'meta_demographics_daily', rows, r =>
            `INSERT INTO meta_demographics_daily [{` +
            `date:${sv(r.date_start)},age_range:${sv(r.age)},gender:${sv(r.gender)},` +
            `spend:${sv(Number(r.spend || 0))},impressions:${sv(Number(r.impressions || 0))},` +
            `clicks:${sv(Number(r.clicks || 0))},leads_count:0,synced_at:${sv(now)}}] RETURN NONE;`
        );
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN não definido');
if (!META_AD_ACCOUNT_ID) throw new Error('META_AD_ACCOUNT_ID não definido');
if (!SURREAL_ENDPOINT || !SURREAL_USER || !SURREAL_PASS) throw new Error('Variáveis SurrealDB não definidas');

console.log('Autenticando SurrealDB...');
const token = await surrealAuth();
console.log('✓ SurrealDB ok\n');

await syncCampaigns(token);
await syncInsights(token);
await syncDemographics(token);

console.log('\n✅ Meta Ads sync concluído!');
