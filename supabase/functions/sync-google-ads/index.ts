import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

// ─── SurrealDB ────────────────────────────────────────────────────────────────
const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT') ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';
const SURREAL_USER = Deno.env.get('SURREAL_USER') ?? 'ficv_admin';
const SURREAL_PASS = Deno.env.get('SURREAL_PASS') ?? 'Ficv@Surreal2026!';

async function surrealAuth(): Promise<string> {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: SURREAL_USER, pass: SURREAL_PASS }),
    });
    if (!res.ok) throw new Error(`SurrealDB auth: ${res.status}`);
    return (await (res.json() as Promise<{ token: string }>)).token;
}

async function surrealExec(token: string, sql: string): Promise<void> {
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
        const txt = await res.text();
        throw new Error(`SurrealDB HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json() as any[];
    const errs = data.filter((r: any) => r.status === 'ERR');
    if (errs.length) console.error('SurrealDB ERR:', errs.map((e: any) => e.result).join('; '));
}

function sv(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `d"${v}"`;
        return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    if (Array.isArray(v)) return `[${v.map(sv).join(', ')}]`;
    if (typeof v === 'object') {
        const pairs = Object.entries(v as Record<string, unknown>).map(([k, val]) => `${k}: ${sv(val)}`);
        return `{${pairs.join(', ')}}`;
    }
    return JSON.stringify(v);
}

// ─── Google Ads OAuth2 ────────────────────────────────────────────────────────
const DEVELOPER_TOKEN   = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') ?? '';
const CLIENT_ID         = Deno.env.get('GOOGLE_ADS_CLIENT_ID') ?? '';
const CLIENT_SECRET     = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') ?? '';
const REFRESH_TOKEN     = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') ?? '';
const CUSTOMER_ID       = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID') ?? '';
const LOGIN_CUSTOMER_ID = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ?? '';

const API_VERSION = 'v21';
const BASE_URL    = `https://googleads.googleapis.com/${API_VERSION}`;

async function getAccessToken(): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id:     CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: REFRESH_TOKEN,
            grant_type:    'refresh_token',
        }),
    });
    const json = await res.json() as any;
    if (!json.access_token) throw new Error(`OAuth error: ${JSON.stringify(json)}`);
    return json.access_token;
}

async function gaqlQuery(accessToken: string, query: string): Promise<any[]> {
    const url = `${BASE_URL}/customers/${CUSTOMER_ID}/googleAds:search`;
    const headers: Record<string, string> = {
        'Authorization':   `Bearer ${accessToken}`,
        'developer-token': DEVELOPER_TOKEN,
        'Content-Type':    'application/json',
    };
    if (LOGIN_CUSTOMER_ID) headers['login-customer-id'] = LOGIN_CUSTOMER_ID;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${text.slice(0, 500)}`);

    const results: any[] = [];
    try {
        const parsed = JSON.parse(text) as any;
        const batches = Array.isArray(parsed) ? parsed : [parsed];
        for (const batch of batches) { if (batch.results) results.push(...batch.results); }
    } catch (_) {
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === '[' || trimmed === ']') continue;
            try {
                const b = JSON.parse(trimmed.replace(/^,/, '')) as any;
                if (b.results) results.push(...b.results);
            } catch (__) {}
        }
    }
    return results;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Sync campaigns → SurrealDB ───────────────────────────────────────────────
async function syncCampaigns(token: string, accessToken: string): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await gaqlQuery(accessToken, `
            SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.advertising_channel_type,
                campaign_budget.amount_micros,
                campaign_budget.type
            FROM campaign
            WHERE campaign.status != 'REMOVED'
            ORDER BY campaign.name
        `);

        if (!rows.length) return { synced: 0 };

        const now = new Date().toISOString();
        const records = rows.map((r: any) => ({
            campaign_id:              String(r.campaign.id),
            campaign_name:            r.campaign.name ?? null,
            status:                   r.campaign.status ?? null,
            advertising_channel_type: r.campaign.advertisingChannelType ?? null,
            budget_amount:            r.campaignBudget?.amountMicros != null
                                          ? Number(r.campaignBudget.amountMicros) / 1_000_000
                                          : null,
            budget_type:              r.campaignBudget?.type ?? null,
            synced_at:                now,
        }));

        let sql = '';
        for (const r of records) {
            sql += `UPSERT google_ads_campaigns:\`${r.campaign_id}\` CONTENT {${Object.entries(r).map(([k, v]) => `${k}: ${sv(v)}`).join(', ')}} RETURN NONE;\n`;
        }
        await surrealExec(token, sql);

        return { synced: records.length };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync insights → SurrealDB ────────────────────────────────────────────────
async function syncInsights(token: string, accessToken: string, startDate: string, endDate: string): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await gaqlQuery(accessToken, `
            SELECT
                campaign.id,
                campaign.name,
                segments.date,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions
            FROM campaign
            WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
              AND campaign.status != 'REMOVED'
        `);

        if (!rows.length) return { synced: 0 };

        const now = new Date().toISOString();
        const records = rows.map((r: any) => ({
            campaign_id:   String(r.campaign.id),
            campaign_name: r.campaign.name ?? null,
            date:          r.segments.date,
            spend:         Number(((r.metrics.costMicros ?? 0) / 1_000_000).toFixed(2)),
            impressions:   Number(r.metrics.impressions ?? 0),
            clicks:        Number(r.metrics.clicks ?? 0),
            conversions:   Number((r.metrics.conversions ?? 0).toFixed(2)),
            synced_at:     now,
        }));

        let sql = `DELETE google_ads_insights_daily WHERE date >= "${startDate}" AND date <= "${endDate}";\n`;
        for (let i = 0; i < records.length; i += 100) {
            const batch = records.slice(i, i + 100);
            const lits = batch.map((r: any) => `{${Object.entries(r).map(([k, v]) => `${k}: ${sv(v)}`).join(', ')}}`).join(',\n');
            sql += `INSERT INTO google_ads_insights_daily [${lits}] RETURN NONE;\n`;
        }
        await surrealExec(token, sql);

        return { synced: records.length };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync account balance → SurrealDB ────────────────────────────────────────
async function syncAccountBalance(token: string, accessToken: string): Promise<{ balance: number | null; error?: string }> {
    try {
        const rows = await gaqlQuery(accessToken, `
            SELECT account_budget.status,
                   account_budget.approved_spending_limit_type,
                   account_budget.approved_spending_limit_micros,
                   account_budget.amount_served_in_micros
            FROM account_budget
            WHERE account_budget.status = 'APPROVED'
        `);

        let totalRemaining = 0;
        let hasSpecified = false;
        for (const r of rows) {
            if (r.accountBudget?.approvedSpendingLimitType !== 'SPECIFIED') continue;
            const limit  = Number(r.accountBudget?.approvedSpendingLimitMicros ?? 0);
            const served = Number(r.accountBudget?.amountServedInMicros ?? 0);
            if (limit > 0) { totalRemaining += (limit - served) / 1_000_000; hasSpecified = true; }
        }
        if (!hasSpecified) return { balance: null };

        const balance = Math.max(0, totalRemaining);
        const now = new Date().toISOString();
        await surrealExec(token,
            `UPDATE meta_account_stats:\`1\` MERGE {google_balance: ${balance}, updated_at: d"${now}"} RETURN NONE;`
        );
        return { balance };
    } catch (e: any) {
        console.error('syncAccountBalance error:', e.message);
        return { balance: null, error: e.message };
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const now  = new Date();
        const year = now.getFullYear();
        const startDate = body.start_date ?? `${year}-01-01`;
        const endDate   = body.end_date   ?? now.toISOString().split('T')[0];

        const [accessToken, surrealToken] = await Promise.all([
            getAccessToken(),
            surrealAuth(),
        ]);

        // campaigns, insights e balance em paralelo — direto ao SurrealDB
        const [campaigns, insights, accountBalance] = await Promise.all([
            syncCampaigns(surrealToken, accessToken),
            syncInsights(surrealToken, accessToken, startDate, endDate),
            syncAccountBalance(surrealToken, accessToken),
        ]);

        console.log(`OK campaigns=${campaigns.synced} insights=${insights.synced} balance=${accountBalance.balance}`);

        return new Response(JSON.stringify({
            ok: true, startDate, endDate,
            campaigns, insights, accountBalance,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        console.error('sync-google-ads error:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
