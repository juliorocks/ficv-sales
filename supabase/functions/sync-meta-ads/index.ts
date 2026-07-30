import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GRAPH_API_VERSION = 'v21.0';
const ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') ?? '';
const AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID') ?? ''; // format: act_XXXXXXXXXXXX

// Priority order for picking the "lead-like" action out of Meta's actions[] array.
// We take the first one present (highest priority) instead of summing across
// types, since different action_types often represent overlapping conversions.
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
        const match = actions.find(a => a.action_type === type);
        if (match) return parseInt(match.value) || 0;
    }
    return 0;
}

// ─── Graph API helper with pagination ─────────────────────────────────────────
async function metaGet(path: string, params: Record<string, string>): Promise<any[]> {
    if (!ACCESS_TOKEN || !AD_ACCOUNT_ID) {
        throw new Error('META_ACCESS_TOKEN / META_AD_ACCOUNT_ID não configurados (supabase secrets).');
    }

    let url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}?` +
        new URLSearchParams({ ...params, access_token: ACCESS_TOKEN, limit: '500' }).toString();

    const out: any[] = [];
    let guard = 0;
    while (url && guard < 50) {
        guard++;
        const res = await fetch(url);
        const json = await res.json();
        if (json.error) throw new Error(`Meta API error: ${json.error.message}`);
        if (Array.isArray(json.data)) out.push(...json.data);
        url = json.paging?.next ?? null;
    }
    return out;
}

// ─── Sync campaign metadata ───────────────────────────────────────────────────
async function syncCampaigns(supabase: ReturnType<typeof createClient>): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await metaGet(`${AD_ACCOUNT_ID}/campaigns`, {
            fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining',
        });

        const parseCents = (v: any) => (v !== undefined && v !== null && v !== '') ? parseFloat(v) / 100 : null;

        const mapped = rows.map(r => ({
            campaign_id:      r.id,
            name:             r.name,
            objective:        r.objective ?? null,
            status:           r.effective_status ?? r.status ?? null,
            daily_budget:     parseCents(r.daily_budget),
            lifetime_budget:  parseCents(r.lifetime_budget),
            budget_remaining: parseCents(r.budget_remaining),
            updated_at:       new Date().toISOString(),
        }));

        if (mapped.length === 0) return { synced: 0 };

        const { error } = await supabase.from('meta_campaigns').upsert(mapped, { onConflict: 'campaign_id' });
        if (error) return { synced: 0, error: error.message };
        return { synced: mapped.length };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync daily campaign-level insights ───────────────────────────────────────
async function syncInsights(
    supabase: ReturnType<typeof createClient>,
    startDate: string,
    endDate: string
): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await metaGet(`${AD_ACCOUNT_ID}/insights`, {
            level: 'campaign',
            time_increment: '1',
            time_range: JSON.stringify({ since: startDate, until: endDate }),
            fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,reach,frequency,actions',
        });

        const mapped = rows
            .filter(r => r.campaign_id)
            .map(r => ({
                campaign_id: r.campaign_id,
                campaign_name: r.campaign_name ?? null,
                date: r.date_start,
                spend: parseFloat(r.spend) || 0,
                impressions: parseInt(r.impressions) || 0,
                clicks: parseInt(r.clicks) || 0,
                reach: parseInt(r.reach) || 0,
                frequency: parseFloat(r.frequency) || 0,
                ctr: parseFloat(r.ctr) || 0,
                cpm: parseFloat(r.cpm) || 0,
                leads_count: computeLeadsCount(r.actions),
                actions_raw: r.actions ?? null,
                synced_at: new Date().toISOString(),
            }));

        let synced = 0;
        for (let i = 0; i < mapped.length; i += 200) {
            const batch = mapped.slice(i, i + 200);
            const { error } = await supabase
                .from('meta_campaign_insights_daily')
                .upsert(batch, { onConflict: 'campaign_id,date' });
            if (error) return { synced, error: error.message };
            synced += batch.length;
        }
        return { synced };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync account-level demographics (age + gender) ───────────────────────────
async function syncDemographics(
    supabase: ReturnType<typeof createClient>,
    startDate: string,
    endDate: string
): Promise<{ synced: number; error?: string }> {
    try {
        const rows = await metaGet(`${AD_ACCOUNT_ID}/insights`, {
            level: 'account',
            breakdowns: 'age,gender',
            time_increment: '1',
            time_range: JSON.stringify({ since: startDate, until: endDate }),
            fields: 'spend,impressions,clicks,actions',
        });

        const mapped = rows.map(r => ({
            date: r.date_start,
            age_range: r.age ?? 'unknown',
            gender: r.gender ?? 'unknown',
            spend: parseFloat(r.spend) || 0,
            impressions: parseInt(r.impressions) || 0,
            clicks: parseInt(r.clicks) || 0,
            leads_count: computeLeadsCount(r.actions),
            synced_at: new Date().toISOString(),
        }));

        let synced = 0;
        for (let i = 0; i < mapped.length; i += 200) {
            const batch = mapped.slice(i, i + 200);
            const { error } = await supabase
                .from('meta_demographics_daily')
                .upsert(batch, { onConflict: 'date,age_range,gender' });
            if (error) return { synced, error: error.message };
            synced += batch.length;
        }
        return { synced };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    try {
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const url = new URL(req.url);

        const mode = body.mode ?? url.searchParams.get('mode') ?? 'full';

        // Default range: last 30 days
        const now = new Date();
        const defaultEnd = now.toISOString().split('T')[0];
        const defaultStartDate = new Date(now);
        defaultStartDate.setDate(defaultStartDate.getDate() - 30);
        const defaultStart = defaultStartDate.toISOString().split('T')[0];

        const startDate = body.start_date ?? url.searchParams.get('start_date') ?? defaultStart;
        const endDate = body.end_date ?? url.searchParams.get('end_date') ?? defaultEnd;

        const result: Record<string, any> = { mode, startDate, endDate };

        if (mode === 'campaigns' || mode === 'full') {
            const r = await syncCampaigns(supabase);
            result.campaigns = r;
            console.log(`Campaigns synced: ${r.synced}`, r.error ?? '');

            // Saldo da conta (fundos disponíveis pré-pagos)
            try {
                const accRes = await fetch(
                    `https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}?fields=balance,currency&access_token=${ACCESS_TOKEN}`
                );
                const acc = await accRes.json();
                if (acc.balance !== undefined) {
                    await supabase.from('meta_account_stats').upsert({
                        id: 1,
                        balance: parseFloat(acc.balance) / 100,
                        currency: acc.currency ?? 'BRL',
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'id' });
                    result.account_balance = parseFloat(acc.balance) / 100;
                }
            } catch (e: any) {
                console.error('account balance error:', e.message);
            }
        }

        if (mode === 'insights' || mode === 'full') {
            const r = await syncInsights(supabase, startDate, endDate);
            result.insights = r;
            console.log(`Insights synced: ${r.synced}`, r.error ?? '');
        }

        if (mode === 'demographics' || mode === 'full') {
            const r = await syncDemographics(supabase, startDate, endDate);
            result.demographics = r;
            console.log(`Demographics synced: ${r.synced}`, r.error ?? '');
        }

        return new Response(JSON.stringify({ ok: true, ...result }), {
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
