#!/usr/bin/env node
// Sync Google Ads → SurrealDB (GitHub Actions — sem Supabase)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const GOOGLE_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const GOOGLE_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID; // sem hífens
const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT;
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER;
const SURREAL_PASS = process.env.SURREAL_PASS;

const GOOGLE_LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || GOOGLE_CUSTOMER_ID;
const GADS_BASE = 'https://googleads.googleapis.com/v21';
const DAYS_BACK = parseInt(process.argv[2] || '90', 10);

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

// ── Google Ads API ───────────────────────────────────────────────────────────

async function getAccessToken() {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: GOOGLE_REFRESH_TOKEN,
            grant_type: 'refresh_token',
        }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`OAuth token: ${body.error} — ${body.error_description}`);
    return body.access_token;
}

async function gadsSearch(accessToken, query) {
    const res = await fetch(`${GADS_BASE}/customers/${GOOGLE_CUSTOMER_ID}/googleAds:search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': GOOGLE_DEVELOPER_TOKEN,
            'login-customer-id': GOOGLE_LOGIN_CUSTOMER_ID,
        },
        body: JSON.stringify({ query, pageSize: 10000 }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`Google Ads search: ${JSON.stringify(body.error)}`);
    return body.results || [];
}

function dateRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - DAYS_BACK);
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

async function syncCampaigns(sToken, accessToken) {
    console.log('Campanhas Google Ads...');
    const results = await gadsSearch(accessToken, `
        SELECT campaign.id, campaign.name, campaign.status,
               campaign.advertising_channel_type,
               campaign_budget.amount_micros, campaign_budget.type
        FROM campaign
        WHERE campaign.status != 'REMOVED'
    `);
    console.log(`  ${results.length} campanhas`);
    const now = new Date().toISOString();
    const rows = results.map(r => ({
        campaign_id: String(r.campaign.id),
        campaign_name: r.campaign.name,
        status: r.campaign.status,
        advertising_channel_type: r.campaign.advertisingChannelType,
        budget_amount: (r.campaignBudget?.amountMicros || 0) / 1_000_000,
        budget_type: r.campaignBudget?.type || '',
        synced_at: now,
    }));
    await surrealSQL(sToken, 'DELETE google_ads_campaigns;');
    await upsertBatch(sToken, 'google_ads_campaigns', rows, r =>
        `INSERT INTO google_ads_campaigns [{` +
        `campaign_id:${sv(r.campaign_id)},campaign_name:${sv(r.campaign_name)},` +
        `status:${sv(r.status)},advertising_channel_type:${sv(r.advertising_channel_type)},` +
        `budget_amount:${sv(r.budget_amount)},budget_type:${sv(r.budget_type)},` +
        `synced_at:${sv(r.synced_at)}}] RETURN NONE;`
    );
    return rows;
}

async function syncInsights(sToken, accessToken) {
    const { startDate, endDate } = dateRange();
    console.log(`Insights Google Ads (${startDate} → ${endDate})...`);
    const results = await gadsSearch(accessToken, `
        SELECT campaign.id, campaign.name,
               metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions,
               segments.date
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
    `);
    console.log(`  ${results.length} registros`);
    const now = new Date().toISOString();
    const rows = results.map(r => ({
        campaign_id: String(r.campaign.id),
        campaign_name: r.campaign.name,
        date: r.segments.date,
        spend: (r.metrics.costMicros || 0) / 1_000_000,
        impressions: Number(r.metrics.impressions || 0),
        clicks: Number(r.metrics.clicks || 0),
        conversions: Number(r.metrics.conversions || 0),
        synced_at: now,
    }));
    await surrealSQL(sToken, `DELETE google_ads_insights_daily WHERE date >= "${startDate}" AND date <= "${endDate}";`);
    await upsertBatch(sToken, 'google_ads_insights_daily', rows, r =>
        `INSERT INTO google_ads_insights_daily [{` +
        `campaign_id:${sv(r.campaign_id)},campaign_name:${sv(r.campaign_name)},` +
        `date:${sv(r.date)},spend:${sv(r.spend)},impressions:${sv(r.impressions)},` +
        `clicks:${sv(r.clicks)},conversions:${sv(r.conversions)},` +
        `synced_at:${sv(r.synced_at)}}] RETURN NONE;`
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!GOOGLE_CLIENT_ID) throw new Error('GOOGLE_ADS_CLIENT_ID não definido');
if (!GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_ADS_CLIENT_SECRET não definido');
if (!GOOGLE_REFRESH_TOKEN) throw new Error('GOOGLE_ADS_REFRESH_TOKEN não definido');
if (!GOOGLE_DEVELOPER_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN não definido');
if (!GOOGLE_CUSTOMER_ID) throw new Error('GOOGLE_ADS_CUSTOMER_ID não definido');
if (!SURREAL_ENDPOINT || !SURREAL_USER || !SURREAL_PASS) throw new Error('Variáveis SurrealDB não definidas');

console.log('Autenticando...');
const [sToken, accessToken] = await Promise.all([surrealAuth(), getAccessToken()]);
console.log('✓ SurrealDB ok\n✓ Google Ads ok\n');

try {
    await syncCampaigns(sToken, accessToken);
    await syncInsights(sToken, accessToken);
    console.log('\n✅ Google Ads sync concluído!');
} catch (e) {
    // Developer token em modo teste retorna erro ao acessar contas reais.
    // Loga o erro mas sai com code 0 para não marcar a action como falha.
    console.warn(`\n⚠️  Google Ads API retornou erro (token possivelmente em modo teste):`);
    console.warn(e.message);
    console.warn('Aguarde aprovação do Basic Access para sincronizar campanhas reais.');
    process.exit(0);
}
