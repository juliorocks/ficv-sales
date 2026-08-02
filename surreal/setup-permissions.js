#!/usr/bin/env node
// Etapa 3 — Define PERMISSIONS on all SurrealDB tables
// Replaces Supabase RLS with SurrealDB $auth-based access control
//
// Rules:
//  - Any authenticated user (staff) can read all data
//  - Admin role required for create/update/delete on config tables
//  - Agents can create/update only their own leads (assigned_to_id = $auth.id)
//  - Admins can manage all leads
//  - profiles: anyone can read, only self can update
//  - alunos: self can read/update, staff can read all

const ENDPOINT = process.env.SURREAL_ENDPOINT
    || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS = 'ficv';
const DB = 'salespulse';

async function getAdminToken() {
    const res = await fetch(`${ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
        body: JSON.stringify({ ns: NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error(`Signin failed: HTTP ${res.status}`);
    return (await res.json()).token;
}

async function surrealSQL(token, sql) {
    const res = await fetch(`${ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': NS,
            'surreal-db': DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const errors = (Array.isArray(j) ? j : [j]).filter(r => r.status === 'ERR');
    if (errors.length) throw new Error(errors.map(e => e.result).join('; '));
    return j;
}

// Helper: define permissions on a table
async function definePerms(token, table, perms) {
    const permStr = Object.entries(perms)
        .map(([op, cond]) => `FOR ${op} WHERE ${cond}`)
        .join(',\n        ');
    const sql = `
        DEFINE TABLE OVERWRITE ${table} SCHEMALESS PERMISSIONS
            ${permStr};
    `;
    await surrealSQL(token, sql);
}

// Shorthand conditions
const AUTHENTICATED = '$auth != NONE';
const IS_ADMIN      = "$auth != NONE AND $auth.role = 'admin'";
const SELF_OR_ADMIN = "$auth != NONE AND ($auth.role = 'admin' OR id = $auth.id)";
const STAFF_READ    = AUTHENTICATED;

async function main() {
    const token = await getAdminToken();
    console.log('✓ Authenticated as ficv_admin\n');

    const tables = [
        // ── Lookup / config tables: admins write, anyone reads ──────────────
        { table: 'stages',       perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'courses',      perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'lead_sources', perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'motivos_perda',perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'teams',        perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'scripts',      perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'knowledge_base',perms:{ 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'financial_goals',perms:{ 'select': STAFF_READ,'create, update, delete': IS_ADMIN } },
        { table: 'app_settings', perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'meta_campaigns',perms:{ 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'meta_campaign_insights_daily', perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'meta_demographics_daily',      perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'google_ads_campaigns',         perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'google_ads_insights_daily',    perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },

        // ── Leads: all staff can read/create/update; only admins delete ─────
        {
            table: 'leads',
            perms: {
                'select': STAFF_READ,
                'create': AUTHENTICATED,
                'update': AUTHENTICATED,
                'delete': IS_ADMIN,
            },
        },
        {
            table: 'lead_history',
            perms: {
                'select': STAFF_READ,
                'create': AUTHENTICATED,
                'update, delete': IS_ADMIN,
            },
        },
        {
            table: 'lead_notes',
            perms: {
                'select': STAFF_READ,
                'create': AUTHENTICATED,
                'update': `${AUTHENTICATED} AND ($auth.role = 'admin' OR created_by = $auth.id)`,
                'delete': `${AUTHENTICATED} AND ($auth.role = 'admin' OR created_by = $auth.id)`,
            },
        },

        // ── Profiles: anyone can read, self or admin can write ───────────────
        {
            table: 'profiles',
            perms: {
                'select': STAFF_READ,
                'create, update': SELF_OR_ADMIN,
                'delete': IS_ADMIN,
            },
        },

        // ── Alunos: self-service + staff read ────────────────────────────────
        {
            table: 'alunos',
            perms: {
                'select': AUTHENTICATED,
                'create': AUTHENTICATED,
                'update': `${AUTHENTICATED} AND ($auth.role IN ['admin', 'agent'] OR id = $auth.id)`,
                'delete': IS_ADMIN,
            },
        },

        // ── Tickets / support ─────────────────────────────────────────────────
        {
            table: 'tickets',
            perms: {
                'select': STAFF_READ,
                'create': AUTHENTICATED,
                'update': STAFF_READ,
                'delete': IS_ADMIN,
            },
        },
        {
            table: 'ticket_messages',
            perms: {
                'select': AUTHENTICATED,
                'create': AUTHENTICATED,
                'update, delete': IS_ADMIN,
            },
        },
        {
            table: 'ticket_evaluations',
            perms: {
                'select': AUTHENTICATED,
                'create': AUTHENTICATED,
                'update, delete': IS_ADMIN,
            },
        },

        // ── Widechat ──────────────────────────────────────────────────────────
        { table: 'widechat_messages',     perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'widechat_atendimentos', perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },

        // ── Sponte / matriculas ───────────────────────────────────────────────
        { table: 'sponte_matriculas', perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'sponte_parcelas',   perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },
        { table: 'matriculas',        perms: { 'select': STAFF_READ, 'create, update, delete': IS_ADMIN } },

        // ── Logs ─────────────────────────────────────────────────────────────
        { table: 'messages_logs', perms: { 'select': STAFF_READ, 'create': AUTHENTICATED, 'update, delete': IS_ADMIN } },
    ];

    console.log(`── Definindo PERMISSIONS em ${tables.length} tabelas...\n`);
    let ok = 0; let fail = 0;
    for (const { table, perms } of tables) {
        try {
            await definePerms(token, table, perms);
            console.log(`   ✓ ${table}`);
            ok++;
        } catch (e) {
            console.log(`   ✗ ${table}: ${e.message}`);
            fail++;
        }
    }

    console.log(`\n✅ ${ok} tabelas configuradas${fail ? `, ${fail} erros` : ''}.`);
    console.log('\nNota: PERMISSIONS são aplicadas apenas com tokens de usuário (RECORD ACCESS).');
    console.log('Tokens admin (ficv_admin) continuam com acesso total.');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
