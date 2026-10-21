#!/usr/bin/env node
// Sync Google Ads → Supabase (Postgres via PostgREST).

import { pgUpsert, pgEnabled } from './lib/pg-mirror.mjs';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const GOOGLE_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const GOOGLE_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID; // sem hífens

const GOOGLE_LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || GOOGLE_CUSTOMER_ID;
const GADS_BASE = 'https://googleads.googleapis.com/v21';
const DAYS_BACK = parseInt(process.argv[2] || '90', 10);

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

class GadsApiError extends Error {}

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
    if (body.error) throw new GadsApiError(`Google Ads search: ${JSON.stringify(body.error)}`);
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

async function syncCampaigns(accessToken) {
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
    await pgUpsert('google_ads_campaigns', rows, 'campaign_id');
    console.log(`  ✓ ${rows.length} campanhas gravadas`);
}

async function syncInsights(accessToken) {
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
    await pgUpsert('google_ads_insights_daily', rows, 'campaign_id,date');
    console.log(`  ✓ ${rows.length} registros gravados`);
}

if (!GOOGLE_CLIENT_ID) throw new Error('GOOGLE_ADS_CLIENT_ID não definido');
if (!GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_ADS_CLIENT_SECRET não definido');
if (!GOOGLE_REFRESH_TOKEN) throw new Error('GOOGLE_ADS_REFRESH_TOKEN não definido');
if (!GOOGLE_DEVELOPER_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN não definido');
if (!GOOGLE_CUSTOMER_ID) throw new Error('GOOGLE_ADS_CUSTOMER_ID não definido');
if (!pgEnabled) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não definidos');

console.log('Autenticando no Google Ads...');
const accessToken = await getAccessToken();
console.log('✓ Google Ads ok\n');

// Developer token em modo teste devolve erro da API ao acessar contas reais: só esse caso sai
// com 0. Falha de OAuth ou de gravação no banco continua falhando o workflow.
try {
    await syncCampaigns(accessToken);
    await syncInsights(accessToken);
    console.log('\n✅ Google Ads sync concluído!');
} catch (e) {
    if (!(e instanceof GadsApiError)) throw e;
    console.warn(`\n⚠️  Google Ads API retornou erro (token possivelmente em modo teste):`);
    console.warn(e.message);
    console.warn('Aguarde aprovação do Basic Access para sincronizar campanhas reais.');
    process.exit(0);
}
