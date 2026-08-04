#!/usr/bin/env node
// Migra tabelas restantes do Supabase → SurrealDB
// Tabelas: agent_profiles, agent_reports, upload_logs, user_integrations,
//          meta_account_stats, widechat_raw_messages

const SUPABASE_URL = 'https://znypfroagfwohqeyxyqv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXBmcm9hZ2Z3b2hxZXl4eXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIwMDkyOSwiZXhwIjoyMDg3Nzc2OTI5fQ.aU7Qui8SKNzY1g0EwyMZFCp9JTsi_asKgMZeJCInXBQ';

const SURREAL_ENDPOINT = 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';
const SURREAL_USER = 'ficv_admin';
const SURREAL_PASS = 'Ficv@Surreal2026!';

// ── Supabase ─────────────────────────────────────────────────

async function sbFetch(table, select = '*') {
    const base = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    const rows = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
        const res = await fetch(base, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Range': `${from}-${from + PAGE - 1}`,
                'Range-Unit': 'items',
                'Prefer': 'count=none',
            },
        });
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        rows.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
    }
    return rows;
}

// ── SurrealDB ────────────────────────────────────────────────

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
    if (errs.length) throw new Error(errs.map(e => e.result).join('\n'));
    return data;
}

function sv(v) {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T/.test(v) || /^\d{4}-\d{2}-\d{2}\+/.test(v)) return `d"${v}"`;
        return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

function surrealId(table, uuid) {
    return `${table}:⟨${uuid}⟩`;
}

async function upsertBatch(token, table, rows, buildSql, batchSize = 50) {
    let done = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const sql = batch.map(r => buildSql(r)).join('\n');
        try {
            await surrealSQL(token, sql);
        } catch (e) {
            console.error(`  Erro no batch ${i}-${i + batchSize}: ${e.message}`);
        }
        done += batch.length;
        process.stdout.write(`\r  ${done}/${rows.length}...`);
    }
    console.log(`\r  ✓ ${rows.length} registros                `);
}

// ── Migrações por tabela ─────────────────────────────────────

async function migrateAgentProfiles(token) {
    console.log('\n📋 agent_profiles...');
    const rows = await sbFetch('agent_profiles');
    console.log(`  Supabase: ${rows.length} registros`);
    await surrealSQL(token, 'DELETE agent_profiles;');
    await upsertBatch(token, 'agent_profiles', rows, r => {
        const id = surrealId('agent_profiles', r.id);
        return `INSERT INTO agent_profiles {id: ${id}, ` +
            `name: ${sv(r.name)}, photo_url: ${sv(r.photo_url)}, ` +
            `score_target: ${sv(r.score_target ?? 8.0)}, role: ${sv(r.role)}, ` +
            `email: ${sv(r.email)}, phone: ${sv(r.phone)}, notes: ${sv(r.notes)}, ` +
            `active: ${sv(r.active ?? true)}, team_id: ${sv(r.team_id)}, ` +
            `created_at: ${sv(r.created_at)}, updated_at: ${sv(r.updated_at)}} RETURN NONE;`;
    });
}

async function migrateAgentReports(token) {
    console.log('\n📊 agent_reports...');
    const rows = await sbFetch('agent_reports');
    console.log(`  Supabase: ${rows.length} registros`);
    await surrealSQL(token, 'DELETE agent_reports;');
    await upsertBatch(token, 'agent_reports', rows, r => {
        const id = surrealId('agent_reports', r.id);
        return `INSERT INTO agent_reports {id: ${id}, ` +
            `agent_name: ${sv(r.agent_name)}, year: ${sv(r.year)}, month: ${sv(r.month)}, ` +
            `share_token: ${sv(r.share_token)}, status: ${sv(r.status)}, ` +
            `generated_at: ${sv(r.generated_at)}, created_by: ${sv(r.created_by)}, ` +
            `created_at: ${sv(r.created_at ?? new Date().toISOString())}} RETURN NONE;`;
    });
}

async function migrateUploadLogs(token) {
    console.log('\n📁 upload_logs...');
    const rows = await sbFetch('upload_logs');
    console.log(`  Supabase: ${rows.length} registros`);
    await surrealSQL(token, 'DELETE upload_logs;');
    await upsertBatch(token, 'upload_logs', rows, r => {
        const id = surrealId('upload_logs', r.id);
        return `INSERT INTO upload_logs {id: ${id}, ` +
            `filename: ${sv(r.filename)}, uploaded_by: ${sv(r.uploaded_by)}, ` +
            `record_count: ${sv(r.record_count)}, ` +
            `created_at: ${sv(r.created_at ?? new Date().toISOString())}} RETURN NONE;`;
    });
}

async function migrateUserIntegrations(token) {
    console.log('\n🔗 user_integrations...');
    const rows = await sbFetch('user_integrations');
    console.log(`  Supabase: ${rows.length} registros`);
    await surrealSQL(token, 'DELETE user_integrations;');
    await upsertBatch(token, 'user_integrations', rows, r => {
        const id = surrealId('user_integrations', r.id);
        return `INSERT INTO user_integrations {id: ${id}, ` +
            `user_id: ${sv(r.user_id)}, widechat_email: ${sv(r.widechat_email)}, ` +
            `widechat_password: ${sv(r.widechat_password)}, ` +
            `widechat_session_token: ${sv(r.widechat_session_token)}, ` +
            `widechat_token_expires_at: ${sv(r.widechat_token_expires_at)}, ` +
            `created_at: ${sv(r.created_at)}, updated_at: ${sv(r.updated_at)}} RETURN NONE;`;
    });
}

async function migrateMetaAccountStats(token) {
    console.log('\n💰 meta_account_stats...');
    const rows = await sbFetch('meta_account_stats');
    console.log(`  Supabase: ${rows.length} registros`);
    await surrealSQL(token, 'DELETE meta_account_stats;');
    await upsertBatch(token, 'meta_account_stats', rows, r => {
        // id como string ⟨1⟩ para bater com toRecordId() do proxy
        const id = `meta_account_stats:⟨${r.id}⟩`;
        return `INSERT INTO meta_account_stats {id: ${id}, ` +
            `balance: ${sv(r.balance)}, currency: ${sv(r.currency)}, ` +
            `google_balance: ${sv(r.google_balance)}, ` +
            `updated_at: ${sv(r.updated_at ?? new Date().toISOString())}} RETURN NONE;`;
    });
}

async function migrateWidechatRawMessages(token) {
    console.log('\n💬 widechat_raw_messages...');
    const rows = await sbFetch('widechat_raw_messages');
    console.log(`  Supabase: ${rows.length} registros`);
    await surrealSQL(token, 'DELETE widechat_raw_messages;');
    await upsertBatch(token, 'widechat_raw_messages', rows, r => {
        const id = `widechat_raw_messages:${r.id}`;
        const payload = { session_id: r.session_id, origin: r.origin, sender_name: r.sender_name, message: r.message, platform_id: r.platform_id, message_id: r.message_id };
        return `INSERT INTO widechat_raw_messages {id: ${id}, ` +
            `payload: ${sv(payload)}, ` +
            `session_id: ${sv(r.session_id)}, origin: ${sv(r.origin)}, ` +
            `sender_name: ${sv(r.sender_name)}, message: ${sv(r.message)}, ` +
            `platform_id: ${sv(r.platform_id)}, message_id: ${sv(r.message_id)}, ` +
            `received_at: ${sv(r.received_at)}, ` +
            `created_at: ${sv(r.created_at)}} RETURN NONE;`;
    }, 100);
}

// ── Main ─────────────────────────────────────────────────────

console.log('🔐 Autenticando no SurrealDB...');
const token = await surrealAuth();
console.log('✓ Conectado\n');

await migrateAgentProfiles(token);
await migrateAgentReports(token);
await migrateUploadLogs(token);
await migrateUserIntegrations(token);
await migrateMetaAccountStats(token);
await migrateWidechatRawMessages(token);

console.log('\n✅ Migração concluída!');
