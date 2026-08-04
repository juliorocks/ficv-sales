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

// ─── Meta Ads ────────────────────────────────────────────────────────────────
const GRAPH_API_VERSION = 'v21.0';
const ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') ?? '';
const AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') ?? '';

const LEAD_ACTION_PRIORITY = [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.total_messaging_connection',
    'onsite_conversion.lead_grouped',
    'lead',
    'offsite_conversion.fb_pixel_lead',
];

function computeLeadsCount(actions: any[] | undefined): number {
    if (!Array.isArray(actions)) return 0;
    for (const type of LEAD_ACTION_PRIORITY) {
        const match = actions.find((a: any) => a.action_type === type);
        if (match) return parseInt(match.value) || 0;
    }
    return 0;
}

async function metaGet(path: string, params: Record<string, string>): Promise<any[]> {
    if (!ACCESS_TOKEN || !AD_ACCOUNT_ID) throw new Error('META_ACCESS_TOKEN / META_AD_ACCOUNT_ID não configurados');
    let url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}?` +
        new URLSearchParams({ ...params, access_token: ACCESS_TOKEN, limit: '500' }).toString();
    const out: any[] = [];
    let guard = 0;
    while (url && guard < 50) {
        guard++;
        const res = await fetch(url);
        const json = await res.json() as any;
        if (json.error) throw new Error(`Meta API error: ${json.error.message}`);
        if (Array.isArray(json.data)) out.push(...json.data);
        url = json.paging?.next ?? null;
    }
    return out;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Sync campaigns + balance → SurrealDB ────────────────────────────────────
async function syncCampaigns(token: string): Promise<{ synced: number; balance?: number; error?: string }> {
    try {
        const rows = await metaGet(`${AD_ACCOUNT_ID}/campaigns`, {
            fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining',
        });

        const parseCents = (v: any) => (v !== undefined && v !== null && v !== '') ? parseFloat(v) / 100 : null;
        const now = new Date().toISOString();

        const mapped = rows.map((r: any) => ({
            campaign_id:      r.id,
            name:             r.name,
            objective:        r.objective ?? null,
            status:           r.effective_status ?? r.status ?? null,
            daily_budget:     parseCents(r.daily_budget),
            lifetime_budget:  parseCents(r.lifetime_budget),
            budget_remaining: parseCents(r.budget_remaining),
            updated_at:       now,
        }));

        if (mapped.length) {
            let sql = '';
            for (const r of mapped) {
                sql += `UPSERT meta_campaigns:\`${r.campaign_id}\` CONTENT {${Object.entries(r).map(([k, v]) => `${k}: ${sv(v)}`).join(', ')}} RETURN NONE;\n`;
            }
            await surrealExec(token, sql);
        }

        // Saldo da conta Meta — direto da API
        let balance: number | undefined;
        try {
            const accRes = await fetch(
                `https://graph.facebook.com/${GRAPH_API_VERSION}/${AD_ACCOUNT_ID}?fields=balance,currency,funding_source_details&access_token=${ACCESS_TOKEN}`
            );
            const acc = await accRes.json() as any;
            console.log('Meta account raw:', JSON.stringify(acc));

            let prepaidBalance: number | null = null;
            const fsd = acc.funding_source_details;

            if (fsd?.display_string) {
                const m = fsd.display_string.match(/\((R\$|BRL\s*)?([\d.]+),([\d]{2})\s*BRL\)/i)
                       ?? fsd.display_string.match(/\(([\d.]+),([\d]{2})/);
                if (m) {
                    const intPart = (m[2] ?? m[1]).replace(/\./g, '');
                    const decPart = m[3] ?? m[2];
                    prepaidBalance = parseFloat(`${intPart}.${decPart}`);
                    console.log('balance from display_string:', fsd.display_string, '→', prepaidBalance);
                }
            }
            if (prepaidBalance === null && acc.balance !== undefined) {
                prepaidBalance = parseFloat(acc.balance) / 100;
                console.log('balance from account.balance:', acc.balance);
            }

            if (prepaidBalance !== null) {
                await surrealExec(token,
                    `UPDATE meta_account_stats:\`1\` MERGE {balance: ${prepaidBalance}, currency: ${sv(acc.currency ?? 'BRL')}, updated_at: d"${now}"} RETURN NONE;`
                );
                balance = prepaidBalance;
            }
        } catch (e: any) {
            console.error('balance sync error:', e.message);
        }

        return { synced: mapped.length, balance };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync insights → SurrealDB ────────────────────────────────────────────────
async function syncInsights(token: string, startDate: string, endDate: string): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await metaGet(`${AD_ACCOUNT_ID}/insights`, {
            level: 'campaign',
            time_increment: '1',
            time_range: JSON.stringify({ since: startDate, until: endDate }),
            fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,reach,frequency,actions',
        });

        const now = new Date().toISOString();
        const mapped = rows
            .filter((r: any) => r.campaign_id)
            .map((r: any) => ({
                campaign_id:   r.campaign_id,
                campaign_name: r.campaign_name ?? null,
                date:          r.date_start,
                spend:         parseFloat(r.spend) || 0,
                impressions:   parseInt(r.impressions) || 0,
                clicks:        parseInt(r.clicks) || 0,
                reach:         parseInt(r.reach) || 0,
                frequency:     parseFloat(r.frequency) || 0,
                ctr:           parseFloat(r.ctr) || 0,
                cpm:           parseFloat(r.cpm) || 0,
                leads_count:   computeLeadsCount(r.actions),
                actions_raw:   r.actions ?? null,
                synced_at:     now,
            }));

        if (!mapped.length) return { synced: 0 };

        // DELETE + batch INSERTs num único request SQL
        let sql = `DELETE meta_campaign_insights_daily WHERE date >= "${startDate}" AND date <= "${endDate}";\n`;
        for (let i = 0; i < mapped.length; i += 100) {
            const batch = mapped.slice(i, i + 100);
            const lits = batch.map((r: any) => `{${Object.entries(r).map(([k, v]) => `${k}: ${sv(v)}`).join(', ')}}`).join(',\n');
            sql += `INSERT INTO meta_campaign_insights_daily [${lits}] RETURN NONE;\n`;
        }
        await surrealExec(token, sql);

        return { synced: mapped.length };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync demographics → SurrealDB ───────────────────────────────────────────
async function syncDemographics(token: string, startDate: string, endDate: string): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await metaGet(`${AD_ACCOUNT_ID}/insights`, {
            level: 'account',
            breakdowns: 'age,gender',
            time_increment: '1',
            time_range: JSON.stringify({ since: startDate, until: endDate }),
            fields: 'spend,impressions,clicks,actions',
        });

        const now = new Date().toISOString();
        const mapped = rows.map((r: any) => ({
            date:        r.date_start,
            age_range:   r.age ?? 'unknown',
            gender:      r.gender ?? 'unknown',
            spend:       parseFloat(r.spend) || 0,
            impressions: parseInt(r.impressions) || 0,
            clicks:      parseInt(r.clicks) || 0,
            leads_count: computeLeadsCount(r.actions),
            synced_at:   now,
        }));

        if (!mapped.length) return { synced: 0 };

        let sql = `DELETE meta_demographics_daily WHERE date >= "${startDate}" AND date <= "${endDate}";\n`;
        for (let i = 0; i < mapped.length; i += 100) {
            const batch = mapped.slice(i, i + 100);
            const lits = batch.map((r: any) => `{${Object.entries(r).map(([k, v]) => `${k}: ${sv(v)}`).join(', ')}}`).join(',\n');
            sql += `INSERT INTO meta_demographics_daily [${lits}] RETURN NONE;\n`;
        }
        await surrealExec(token, sql);

        return { synced: mapped.length };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const url = new URL(req.url);

        const now = new Date();
        const defaultEnd = now.toISOString().split('T')[0];
        const defaultStartDate = new Date(now);
        defaultStartDate.setDate(defaultStartDate.getDate() - 30);
        const defaultStart = defaultStartDate.toISOString().split('T')[0];

        const startDate = body.start_date ?? url.searchParams.get('start_date') ?? defaultStart;
        const endDate   = body.end_date   ?? url.searchParams.get('end_date')   ?? defaultEnd;
        const mode      = body.mode       ?? url.searchParams.get('mode')       ?? 'full';

        const token = await surrealAuth();

        // campaigns, insights e demographics em paralelo — sem dupla escrita Supabase
        const [campaigns, insights, demographics] = await Promise.all([
            (mode === 'campaigns' || mode === 'full') ? syncCampaigns(token) : Promise.resolve({ synced: 0 }),
            (mode === 'insights'  || mode === 'full') ? syncInsights(token, startDate, endDate) : Promise.resolve({ synced: 0 }),
            (mode === 'demographics' || mode === 'full') ? syncDemographics(token, startDate, endDate) : Promise.resolve({ synced: 0 }),
        ]);

        console.log(`OK campaigns=${campaigns.synced} insights=${insights.synced} demographics=${demographics.synced} balance=${(campaigns as any).balance}`);

        return new Response(JSON.stringify({
            ok: true, mode, startDate, endDate,
            campaigns, insights, demographics,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        console.error('sync-meta-ads error:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
