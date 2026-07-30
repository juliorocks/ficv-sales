import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEVELOPER_TOKEN    = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') ?? '';
const CLIENT_ID          = Deno.env.get('GOOGLE_ADS_CLIENT_ID') ?? '';
const CLIENT_SECRET      = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') ?? '';
const REFRESH_TOKEN      = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') ?? '';
const CUSTOMER_ID        = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID') ?? '';       // e.g. 6546476778
const LOGIN_CUSTOMER_ID  = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ?? ''; // manager account

const API_VERSION = 'v25';
const BASE_URL    = `https://googleads.googleapis.com/${API_VERSION}`;

// ─── OAuth2: get access token from refresh token ──────────────────────────────
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
    const json = await res.json();
    if (!json.access_token) throw new Error(`OAuth error: ${JSON.stringify(json)}`);
    return json.access_token;
}

// ─── Google Ads API: GAQL query ───────────────────────────────────────────────
async function gaqlQueryFor(accessToken: string, customerId: string, query: string): Promise<any[]> {
    const url = `${BASE_URL}/customers/${customerId}/googleAds:searchStream`;
    const headers: Record<string, string> = {
        'Authorization':    `Bearer ${accessToken}`,
        'developer-token':  DEVELOPER_TOKEN,
        'Content-Type':     'application/json',
    };
    if (LOGIN_CUSTOMER_ID) headers['login-customer-id'] = LOGIN_CUSTOMER_ID;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
    const text = await res.text();
    if (!res.ok) return []; // silently skip inaccessible customers

    const results: any[] = [];
    try {
        const parsed = JSON.parse(text);
        const batches = Array.isArray(parsed) ? parsed : [parsed];
        for (const batch of batches) { if (batch.results) results.push(...batch.results); }
    } catch (_) {
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === '[' || trimmed === ']') continue;
            try { const b = JSON.parse(trimmed.replace(/^,/, '')); if (b.results) results.push(...b.results); } catch (__) {}
        }
    }
    return results;
}

async function gaqlQuery(accessToken: string, query: string): Promise<any[]> {
    const url = `${BASE_URL}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
    const headers: Record<string, string> = {
        'Authorization':    `Bearer ${accessToken}`,
        'developer-token':  DEVELOPER_TOKEN,
        'Content-Type':     'application/json',
    };
    if (LOGIN_CUSTOMER_ID) headers['login-customer-id'] = LOGIN_CUSTOMER_ID;

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${text}`);

    // searchStream returns a JSON array of batch objects (each with a "results" array)
    const results: any[] = [];
    try {
        const parsed = JSON.parse(text);
        const batches = Array.isArray(parsed) ? parsed : [parsed];
        for (const batch of batches) {
            if (batch.results) results.push(...batch.results);
        }
    } catch (_) {
        // fallback: try NDJSON (older API versions)
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === '[' || trimmed === ']') continue;
            try {
                const batch = JSON.parse(trimmed.replace(/^,/, ''));
                if (batch.results) results.push(...batch.results);
            } catch (__) { /* skip malformed lines */ }
        }
    }
    return results;
}

// ─── Sync account balance via account_budget ──────────────────────────────────
// Funciona para contas com Account Budgets configurados (spending limit SPECIFIED).
// Para contas pré-pagas manuais sem account_budget, o saldo é atualizado manualmente no dashboard.
async function syncAccountBalance(
    supabase: ReturnType<typeof createClient>,
    accessToken: string
): Promise<{ balance: number | null }> {
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
        await supabase.from('meta_account_stats').upsert(
            { id: 1, google_balance: balance, updated_at: new Date().toISOString() },
            { onConflict: 'id' }
        );
        return { balance };
    } catch (e: any) {
        console.error('syncAccountBalance error:', e.message);
        return { balance: null };
    }
}

// ─── Sync campaigns ───────────────────────────────────────────────────────────
async function syncCampaigns(
    supabase: ReturnType<typeof createClient>,
    accessToken: string
): Promise<{ synced: number }> {
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

    if (rows.length === 0) return { synced: 0 };

    const records = rows.map(r => ({
        campaign_id:              String(r.campaign.id),
        campaign_name:            r.campaign.name ?? null,
        status:                   r.campaign.status ?? null,
        advertising_channel_type: r.campaign.advertisingChannelType ?? null,
        budget_amount:            r.campaignBudget?.amountMicros != null
                                      ? Number(r.campaignBudget.amountMicros) / 1_000_000
                                      : null,
        budget_type:              r.campaignBudget?.type ?? null,
        synced_at:                new Date().toISOString(),
    }));

    let synced = 0;
    for (let i = 0; i < records.length; i += 200) {
        const { error } = await supabase
            .from('google_ads_campaigns')
            .upsert(records.slice(i, i + 200), { onConflict: 'campaign_id' });
        if (error) throw new Error('upsert campaigns: ' + error.message);
        synced += records.slice(i, i + 200).length;
    }
    return { synced };
}

// ─── Sync daily insights ──────────────────────────────────────────────────────
async function syncInsights(
    supabase: ReturnType<typeof createClient>,
    accessToken: string,
    startDate: string,
    endDate: string
): Promise<{ synced: number }> {
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

    if (rows.length === 0) return { synced: 0 };

    const records = rows.map(r => ({
        campaign_id:   String(r.campaign.id),
        campaign_name: r.campaign.name ?? null,
        date:          r.segments.date,
        spend:         Number(((r.metrics.costMicros ?? 0) / 1_000_000).toFixed(2)),
        impressions:   Number(r.metrics.impressions ?? 0),
        clicks:        Number(r.metrics.clicks ?? 0),
        conversions:   Number((r.metrics.conversions ?? 0).toFixed(2)),
        synced_at:     new Date().toISOString(),
    }));

    let synced = 0;
    for (let i = 0; i < records.length; i += 200) {
        const { error } = await supabase
            .from('google_ads_insights_daily')
            .upsert(records.slice(i, i + 200), { onConflict: 'campaign_id,date' });
        if (error) throw new Error('upsert insights: ' + error.message);
        synced += records.slice(i, i + 200).length;
    }
    return { synced };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    try {
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const now  = new Date();
        const year = now.getFullYear();
        const startDate = body.start_date ?? `${year}-01-01`;
        const endDate   = body.end_date   ?? now.toISOString().split('T')[0];

        const accessToken = await getAccessToken();

        const [campaigns, insights, accountBalance] = await Promise.all([
            syncCampaigns(supabase, accessToken),
            syncInsights(supabase, accessToken, startDate, endDate),
            syncAccountBalance(supabase, accessToken),
        ]);

        return new Response(JSON.stringify({ ok: true, startDate, endDate, campaigns, insights, accountBalance }), {
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
