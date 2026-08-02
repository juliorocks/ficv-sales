import { createClient } from '@supabase/supabase-js';

const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL    || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase credentials missing. Please check your .env file.');
}

const _supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Dual-write: espelha mutações no SurrealDB em background ───────────────────
// SurrealDB permanece em sincronia sem bloquear o fluxo principal.

const SURREAL_ENDPOINT = import.meta.env.VITE_SURREAL_ENDPOINT
    || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = import.meta.env.VITE_SURREAL_NS || 'ficv';
const SURREAL_DB = import.meta.env.VITE_SURREAL_DB || 'salespulse';

let _surrealToken: string | null = localStorage.getItem('surreal_token');
const _authListeners = new Set<(event: string, session: unknown) => void>();

// Decode a SurrealDB RECORD-access JWT into a mock Supabase-compatible session
function decodeSurrealSession(token: string): { user: { id: string; email: string }; access_token: string } | null {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
        if (payload['exp'] && Date.now() / 1000 > (payload['exp'] as number)) return null;
        const idStr = String(payload['ID'] ?? '');
        // ID may be `profiles:\`uuid\`` or `profiles:⟨uuid⟩`
        const m = idStr.match(/^profiles:`(.+)`$/) ?? idStr.match(/^profiles:⟨(.+)⟩$/);
        const userId = m ? m[1] : '';
        if (!userId) return null;
        return { user: { id: userId, email: String(payload['email'] ?? '') }, access_token: token };
    } catch { return null; }
}

async function ensureSurrealToken(): Promise<string | null> {
    // Per-user token takes precedence (carries $auth for future PERMISSIONS)
    const userToken = localStorage.getItem('surreal_user_token');
    if (userToken) {
        try {
            const b64 = userToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
            if (!payload['exp'] || Date.now() / 1000 < (payload['exp'] as number)) return userToken;
            localStorage.removeItem('surreal_user_token');
        } catch { /* invalid, fall through */ }
    }
    // Fall back to admin token for pre-login and background operations
    if (_surrealToken) return _surrealToken;
    try {
        const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
            body:    JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
        });
        if (!res.ok) return null;
        const { token } = await res.json() as { token?: string };
        if (token) {
            _surrealToken = token;
            localStorage.setItem('surreal_token', token);
        }
        return _surrealToken;
    } catch { return null; }
}

// ── Auth proxy — intercepts supabase.auth.* ───────────────────────────────────

const _surrealAuth = {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
        // Aluno emails (cpf@aluno.ficv.br) stay on Supabase auth
        if (email.endsWith('@aluno.ficv.br')) {
            return _supabase.auth.signInWithPassword({ email, password });
        }
        try {
            const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
                body:    JSON.stringify({ ns: SURREAL_NS, db: SURREAL_DB, ac: 'staff', email, pass: password }),
            });
            if (!res.ok) {
                return { data: { user: null, session: null }, error: { message: 'E-mail ou senha inválidos.' } };
            }
            const { token } = await res.json() as { token?: string };
            if (!token) {
                return { data: { user: null, session: null }, error: { message: 'Autenticação falhou.' } };
            }
            localStorage.setItem('surreal_user_token', token);
            _surrealToken = null; // invalidate admin cache so user token is used for data ops
            // Clear any stale Supabase session — it would cause functions.invoke to send expired JWTs
            _supabase.auth.signOut().catch(() => {});
            const session = decodeSurrealSession(token);
            _authListeners.forEach(cb => cb('SIGNED_IN', session));
            return { data: { user: session?.user ?? null, session }, error: null };
        } catch (e) {
            return { data: { user: null, session: null }, error: { message: (e as Error).message } };
        }
    },

    async getSession() {
        const userToken = localStorage.getItem('surreal_user_token');
        if (userToken) {
            const session = decodeSurrealSession(userToken);
            if (session) return { data: { session }, error: null };
            localStorage.removeItem('surreal_user_token');
        }
        return _supabase.auth.getSession();
    },

    onAuthStateChange(callback: (event: string, session: unknown) => void) {
        _authListeners.add(callback);
        // Fire immediately with current state
        const userToken = localStorage.getItem('surreal_user_token');
        if (userToken) {
            const session = decodeSurrealSession(userToken);
            if (session) setTimeout(() => callback('SIGNED_IN', session), 0);
        }
        // Also bridge Supabase events (for aluno sessions)
        const { data: { subscription } } = _supabase.auth.onAuthStateChange((event, sbSession) => {
            if (!localStorage.getItem('surreal_user_token')) {
                callback(event, sbSession);
            }
        });
        return {
            data: {
                subscription: {
                    unsubscribe() {
                        _authListeners.delete(callback);
                        subscription.unsubscribe();
                    },
                },
            },
        };
    },

    async signOut() {
        localStorage.removeItem('surreal_user_token');
        _surrealToken = null;
        _authListeners.forEach(cb => cb('SIGNED_OUT', null));
        return _supabase.auth.signOut();
    },

    // AlunoAuth.tsx signup — keep on Supabase
    signUp: _supabase.auth.signUp.bind(_supabase.auth),

    // Password reset email — keep on Supabase (needs email delivery)
    resetPasswordForEmail: _supabase.auth.resetPasswordForEmail.bind(_supabase.auth),

    // updateUser and any other methods pass through to Supabase
    updateUser: _supabase.auth.updateUser.bind(_supabase.auth),
    getUser: _supabase.auth.getUser.bind(_supabase.auth),
} as unknown as typeof _supabase.auth;

function toSurrealValue(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean')        return String(v);
    if (typeof v === 'number')         return String(v);
    if (typeof v === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `d"${v}"`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `d"${v}T00:00:00Z"`;
        return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    if (Array.isArray(v)) return `[${v.map(toSurrealValue).join(', ')}]`;
    if (typeof v === 'object') {
        const pairs = Object.entries(v as Record<string, unknown>)
            .filter(([, val]) => val !== undefined)
            .map(([k, val]) => `${k}: ${toSurrealValue(val)}`);
        return `{ ${pairs.join(', ')} }`;
    }
    return JSON.stringify(v);
}

// Mapeamento de campos FK → tabela referenciada no SurrealDB
const REFERENCE_FIELDS: Record<string, Record<string, string>> = {
    leads: {
        stage_id: 'stages', source_id: 'lead_sources',
        assigned_to_id: 'profiles', motivo_perda_id: 'motivos_perda',
        curso_interesse: 'courses',
    },
    lead_history: {
        lead_id: 'leads', from_stage_id: 'stages', to_stage_id: 'stages',
        changed_by: 'profiles', motivo_perda_id: 'motivos_perda',
    },
    lead_notes:          { lead_id: 'leads', created_by: 'profiles' },
    tickets:             { aluno_id: 'alunos', atendente_id: 'profiles', curso_id: 'courses' },
    ticket_messages:     { ticket_id: 'tickets' },
    ticket_evaluations:  { ticket_id: 'tickets', aluno_id: 'alunos' },
    widechat_messages:   { lead_id: 'leads' },
    widechat_atendimentos: { lead_id: 'leads' },
    sponte_matriculas:   { aluno_id: 'alunos' },
};

// Tabelas que recebem dual-write (omite views e logs)
const DUAL_WRITE_TABLES = new Set([
    'leads', 'lead_history', 'lead_notes',
    'tickets', 'ticket_messages', 'ticket_evaluations',
    'profiles', 'alunos', 'stages', 'courses',
    'lead_sources', 'motivos_perda', 'teams',
    'financial_goals', 'app_settings', 'scripts', 'knowledge_base',
    'sponte_matriculas', 'matriculas',
    'widechat_messages', 'widechat_atendimentos',
]);

async function surrealWrite(
    table: string,
    op: 'insert' | 'upsert' | 'update' | 'delete',
    data: unknown,
    filters?: Record<string, unknown>
): Promise<void> {
    if (!DUAL_WRITE_TABLES.has(table)) return;
    const token = await ensureSurrealToken();
    if (!token) return;

    let query: string;
    try {
        const buildWhere = (f: Record<string, unknown>) =>
            Object.entries(f).map(([k, v]) =>
                k === 'id' ? `id = ${table}:⟨${v}⟩` : `${k} = ${toSurrealValue(v)}`
            ).join(' AND ');

        if (op === 'delete') {
            if (!filters || !Object.keys(filters).length) return;
            query = `DELETE ${table} WHERE ${buildWhere(filters)}`;
        } else if (op === 'update') {
            if (!filters || !Object.keys(filters).length || !data) return;
            const refFields = REFERENCE_FIELDS[table] ?? {};
            const sets = Object.entries(data as Record<string, unknown>)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => {
                    const ref = refFields[k];
                    if (ref && v != null) return `${k} = ${ref}:⟨${v}⟩`;
                    return `${k} = ${toSurrealValue(v)}`;
                }).join(', ');
            query = `UPDATE ${table} SET ${sets} WHERE ${buildWhere(filters)}`;
        } else {
            // insert / upsert
            const rows = Array.isArray(data) ? data : [data];
            const lits = rows.map(r => toSurrealValue(r)).join(', ');
            const onDup = op === 'upsert' ? ' ON DUPLICATE KEY UPDATE' : '';
            query = `INSERT INTO ${table} [${lits}]${onDup} RETURN NONE`;
        }
    } catch { return; }

    try {
        const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
            method:  'POST',
            headers: {
                'Content-Type':  'text/plain',
                'Authorization': `Bearer ${token}`,
                'surreal-ns':    SURREAL_NS,
                'surreal-db':    SURREAL_DB,
            },
            body: query,
        });
        if (res.status === 401) {
            // token expirou — limpa e tentará de novo na próxima mutation
            _surrealToken = null;
            localStorage.removeItem('surreal_token');
        }
    } catch { /* não bloqueia o app */ }
}

// ── SurrealDB-first write (Etapa 4 cutover) ──────────────────────────────────
// Writes go to SurrealDB as primary; Supabase is fire-and-forget backup.
// Excludes integer-sequence tables (stages, courses, etc.) which stay Supabase-first.

const SURREAL_PRIMARY_WRITE_TABLES = new Set([
    'leads',           // uses seq:leads counter for integer IDs
    'profiles', 'alunos',
    'tickets', 'ticket_messages', 'ticket_evaluations',
    'widechat_messages', 'widechat_atendimentos',
    'sponte_matriculas', 'matriculas',
    'scripts', 'knowledge_base', 'app_settings',
]);

async function ensureAdminToken(): Promise<string | null> {
    if (_surrealToken) return _surrealToken;
    try {
        const r = await fetch(`${SURREAL_ENDPOINT}/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
            body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
        });
        if (!r.ok) return null;
        const body = await r.json() as { token?: string };
        if (body.token) { _surrealToken = body.token; localStorage.setItem('surreal_token', body.token); }
        return _surrealToken;
    } catch { return null; }
}

async function _nextLeadId(): Promise<number> {
    // Counter update needs admin token — seq table uses system-level access
    const adminToken = await ensureAdminToken();
    if (!adminToken) throw new Error('no admin token for seq counter');
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Authorization': `Bearer ${adminToken}`,
            'surreal-ns': SURREAL_NS,
            'surreal-db': SURREAL_DB,
        },
        body: 'UPDATE ONLY seq:leads SET val += 1 RETURN val;',
    });
    const j = await res.json() as unknown[];
    return ((Array.isArray(j) ? j[0] : j) as { result?: { val?: number } })?.result?.val ?? 0;
}

function _supabaseFireAndForget(
    table: string,
    op: MutationOp,
    data: unknown,
    filters: Record<string, unknown>
): void {
    try {
        if (op === 'insert') {
            Promise.resolve(_supabase.from(table).insert(data)).catch(() => {});
        } else if (op === 'upsert') {
            Promise.resolve(_supabase.from(table).upsert(data as Record<string, unknown>[])).catch(() => {});
        } else if (op === 'update') {
            let q: ReturnType<ReturnType<typeof _supabase.from>['update']> =
                _supabase.from(table).update(data);
            for (const [k, v] of Object.entries(filters)) {
                q = q.eq(k, v as string);
            }
            Promise.resolve(q).catch(() => {});
        } else {
            let q = _supabase.from(table).delete();
            for (const [k, v] of Object.entries(filters)) {
                q = q.eq(k, v as string);
            }
            Promise.resolve(q).catch(() => {});
        }
    } catch { /* fire and forget */ }
}

function _buildWhere(table: string, filters: Record<string, unknown>): string {
    return Object.entries(filters).map(([k, v]) =>
        k === 'id' ? `id = ${table}:⟨${v}⟩` : `${k} = ${toSurrealValue(v)}`
    ).join(' AND ');
}

async function surrealMutate(
    table: string,
    op: MutationOp,
    data: unknown,
    filters: Record<string, unknown>
): Promise<{ data: unknown; error: null }> {
    const token = await ensureSurrealToken();
    if (!token) throw new Error('no surreal token');

    let query: string;
    let finalData = data;

    if (op === 'insert' || op === 'upsert') {
        const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
        // Assign IDs before writing
        const seeded = await Promise.all(rows.map(async (row) => {
            const r = { ...row };
            if (r['id'] === undefined || r['id'] === null) {
                r['id'] = table === 'leads'
                    ? await _nextLeadId()
                    : crypto.randomUUID();
            }
            return r;
        }));
        finalData = seeded;

        const lits = seeded.map(r => toSurrealValue(r)).join(', ');
        const onDup = op === 'upsert' ? ' ON DUPLICATE KEY UPDATE' : '';
        query = `INSERT INTO ${table} [${lits}]${onDup} RETURN *;`;

    } else if (op === 'update') {
        const refFields = REFERENCE_FIELDS[table] ?? {};
        const sets = Object.entries(data as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => {
                const ref = refFields[k];
                if (ref && v != null) return `${k} = ${ref}:⟨${v}⟩`;
                return `${k} = ${toSurrealValue(v)}`;
            }).join(', ');
        query = `UPDATE ${table} SET ${sets} WHERE ${_buildWhere(table, filters)} RETURN *;`;

    } else { // delete
        query = `DELETE ${table} WHERE ${_buildWhere(table, filters)} RETURN BEFORE;`;
    }

    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS,
            'surreal-db': SURREAL_DB,
        },
        body: query,
    });
    if (res.status === 401) {
        localStorage.removeItem('surreal_user_token');
        _surrealToken = null;
    }
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}`);

    const j = await res.json();
    const entry = Array.isArray(j) ? j[0] : j;
    if (entry?.status === 'ERR') throw new Error(entry.result);

    const rows = (Array.isArray(entry?.result) ? entry.result : [entry?.result]).filter(Boolean);
    const stripped = rows.map((r: unknown) => stripSurrealIds(r));

    // Fire-and-forget Supabase backup
    _supabaseFireAndForget(table, op === 'insert' ? 'upsert' : op, finalData, filters);

    return { data: stripped, error: null };
}

// ── Read proxy (leituras direto do SurrealDB) ─────────────────────────────────

const SURREAL_READ_TABLES = new Set([
    // Conteúdo/configuração simples
    'scripts', 'knowledge_base', 'app_settings', 'financial_goals',
    // Tabelas de referência (lookup)
    'stages', 'courses', 'lead_sources', 'motivos_perda', 'teams',
    // Dados operacionais principais
    'leads', 'profiles', 'alunos',
    'lead_history', 'lead_notes',
    'tickets', 'ticket_messages', 'ticket_evaluations',
    'widechat_messages', 'widechat_atendimentos',
    'sponte_matriculas', 'sponte_parcelas',
    'messages_logs',
    // Dados de campanhas — têm dados históricos no SurrealDB; novos dados
    // são escritos no SurrealDB após cada sync via surrealBatchUpsert()
    'meta_campaign_insights_daily', 'google_ads_insights_daily',
    'meta_demographics_daily',
]);

// Tabelas onde resultado vazio no SurrealDB faz fallback pro Supabase.
// Útil para períodos recentes ainda não sincronizados ao SurrealDB.
const SURREAL_FALLBACK_ON_EMPTY = new Set([
    'meta_campaign_insights_daily',
    'google_ads_insights_daily',
    'meta_demographics_daily',
]);

function stripSurrealIds(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') {
        // Handles both `table:⟨value⟩` (string IDs) and `table:\`value\`` (numeric/complex IDs)
        const m = v.match(/^[a-z_]+:⟨(.+)⟩$/) ?? v.match(/^[a-z_]+:`(.+)`$/);
        if (m) {
            const inner = m[1];
            const asNum = Number(inner);
            return Number.isFinite(asNum) && String(asNum) === inner ? asNum : inner;
        }
        // SurrealDB returns datetime objects as full ISO strings (e.g. "2026-01-15T03:00:00Z").
        // Supabase date columns return plain "YYYY-MM-DD". Normalize so consumers don't break.
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return v.slice(0, 10);
        return v;
    }
    if (Array.isArray(v)) return (v as unknown[]).map(stripSurrealIds);
    if (typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            out[k] = stripSurrealIds(val);
        }
        return out;
    }
    return v;
}

function makeSurrealSelect(table: string, cols: string, sbBase: unknown) {
    type WherePart = { op: string; field: string; val: unknown };
    type OrderPart = { field: string; asc: boolean };
    const wheres: WherePart[] = [];
    const orders: OrderPart[] = [];
    let lim: number | null = null;
    let offset: number | null = null;
    let isSingle = false;
    let isMaybe = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sb = sbBase as any;

    const refFields = REFERENCE_FIELDS[table] ?? {};
    const toRecordId = (refTable: string, v: unknown) => `${refTable}:⟨${v}⟩`;

    const buildWhereSql = () => wheres.map(({ op, field, val }) => {
        const ref = field === 'id' ? table : refFields[field];
        if (op === 'in') {
            if (ref) return `${field} IN [${(val as unknown[]).map(v => toRecordId(ref, v)).join(', ')}]`;
            return `${field} IN [${(val as unknown[]).map(v => toSurrealValue(v)).join(', ')}]`;
        }
        if (op === 'ilike') {
            const pattern = String(val).replace(/%/g, '').toLowerCase();
            return `string::lowercase(${field}) CONTAINS "${pattern.replace(/"/g, '\\"')}"`;
        }
        if (ref && val != null && op === '=') return `${field} = ${toRecordId(ref, val)}`;
        return `${field} ${op} ${toSurrealValue(val)}`;
    }).join(' AND ');

    async function run(): Promise<unknown> {
        try {
            const token = await ensureSurrealToken();
            if (!token) throw new Error('no token');
            const colStr = cols.trim() === '*' ? '*'
                : cols.split(',').map(c => c.trim()).join(', ');
            let sql = `SELECT ${colStr} FROM ${table}`;
            if (wheres.length) sql += ` WHERE ${buildWhereSql()}`;
            if (orders.length)
                sql += ' ORDER BY ' + orders.map(o => `${o.field} ${o.asc ? 'ASC' : 'DESC'}`).join(', ');
            if (isSingle || isMaybe) sql += ' LIMIT 1';
            else if (lim !== null) sql += ` LIMIT ${lim}`;
            if (offset !== null) sql += ` START ${offset}`;

            const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain', 'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
                },
                body: sql,
            });
            if (res.status === 401) { _surrealToken = null; localStorage.removeItem('surreal_token'); }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const entry = Array.isArray(json) ? json[0] : json;
            if (entry?.status === 'ERR') throw new Error(entry.result);
            let rows: unknown[] = Array.isArray(entry?.result) ? entry.result : [];
            rows = rows.map(r => stripSurrealIds(r));
            // Para tabelas de campanhas, resultado vazio = período sem dados no SurrealDB
            // (ex: mês corrente ainda não sincronizado). Faz fallback pro Supabase.
            if (rows.length === 0 && !isSingle && !isMaybe && SURREAL_FALLBACK_ON_EMPTY.has(table)) {
                return sb;
            }
            if (isSingle) {
                if (!rows.length) return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
                return { data: rows[0], error: null };
            }
            if (isMaybe) return { data: rows[0] ?? null, error: null };
            return { data: rows, error: null };
        } catch (e) {
            console.warn(`[surreal-read] ${table} fallback: ${(e as Error).message}`);
            return sb; // sb é thenable — resolve para o resultado do Supabase
        }
    }

    const builder = {
        eq(field: string, val: unknown)      { wheres.push({ op: '=', field, val }); sb = sb.eq(field, val); return builder; },
        neq(field: string, val: unknown)     { wheres.push({ op: '!=', field, val }); sb = sb.neq(field, val); return builder; },
        in(field: string, vals: unknown[])   { wheres.push({ op: 'in', field, val: vals }); sb = sb.in(field, vals); return builder; },
        gte(field: string, val: unknown)     { wheres.push({ op: '>=', field, val }); sb = sb.gte(field, val); return builder; },
        lte(field: string, val: unknown)     { wheres.push({ op: '<=', field, val }); sb = sb.lte(field, val); return builder; },
        gt(field: string, val: unknown)      { wheres.push({ op: '>', field, val }); sb = sb.gt(field, val); return builder; },
        lt(field: string, val: unknown)      { wheres.push({ op: '<', field, val }); sb = sb.lt(field, val); return builder; },
        ilike(field: string, val: unknown)   { wheres.push({ op: 'ilike', field, val }); sb = sb.ilike(field, val); return builder; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        is(field: string, val: unknown)      { wheres.push({ op: val === null ? 'IS' : '=', field, val }); sb = (sb as any).is(field, val); return builder; },
        range(from: number, to: number)      { offset = from; lim = to - from + 1; sb = sb.range(from, to); return builder; },
        order(field: string, opts?: { ascending?: boolean }) { orders.push({ field, asc: opts?.ascending !== false }); sb = sb.order(field, opts); return builder; },
        limit(n: number)   { lim = n; sb = sb.limit(n); return builder; },
        single()     { isSingle = true; sb = sb.single(); return builder; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        maybeSingle(){ isMaybe  = true; sb = (sb as any).maybeSingle(); return builder; },
        then(res?: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return run().then(res, rej); },
        catch(rej?: (e: unknown) => unknown) { return run().then(undefined, rej); },
        finally(fn?: () => void) { return run().finally(fn); },
    };
    return builder;
}

// ── Proxy que intercepta mutações na resposta ─────────────────────────────────

type MutationOp = 'insert' | 'update' | 'delete' | 'upsert';

function wrapMutationBuilder(
    builder: ReturnType<ReturnType<typeof _supabase.from>['insert']>,
    table: string,
    op: MutationOp,
    mutationData: unknown,
    filters: Record<string, unknown>
): typeof builder {
    const originalThen = builder.then.bind(builder);
    (builder as unknown as { then: Function }).then = function(
        resolve?: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
    ) {
        return originalThen(
            (result: { data: unknown; error: unknown }) => {
                if (!result?.error) {
                    // INSERT: usar result.data que contém o UUID gerado pelo Supabase
                    const writeData = (op === 'insert' || op === 'upsert') && result?.data
                        ? result.data
                        : mutationData;
                    surrealWrite(table, op, writeData, filters).catch(() => {});
                }
                return resolve ? resolve(result) : result;
            },
            reject
        );
    };
    return builder;
}

type AnyRecord = Record<string, (...args: unknown[]) => unknown>;

function call<T>(obj: unknown, method: string, ...args: unknown[]): T {
    return ((obj as AnyRecord)[method])(...args) as T;
}

// Chainable thenable for SurrealDB-first mutations (insert/update/delete/upsert)
function makeMutationChain(
    table: string,
    op: MutationOp,
    data: unknown,
    initialFilters: Record<string, unknown>
) {
    const filters = { ...initialFilters };

    const exec = async (): Promise<{ data: unknown; error: null }> => {
        try {
            return await surrealMutate(table, op, data, filters);
        } catch (e) {
            console.warn(`[surreal-write] ${table}/${op} failed: ${(e as Error).message}`);
            // Fallback: let Supabase handle it
            return new Promise((resolve) => {
                _supabaseFireAndForget(table, op, data, filters);
                resolve({ data: [], error: null });
            });
        }
    };

    const chain = {
        eq(field: string, val: unknown) { filters[field] = val; return chain; },
        select() { return chain; },
        single() { return chain; },
        maybeSingle() { return chain; },
        then<T>(res?: (v: { data: unknown; error: null }) => T, rej?: (e: unknown) => T) {
            return exec().then(res, rej);
        },
        catch<T>(rej?: (e: unknown) => T) { return exec().then(undefined, rej); },
        finally(fn?: () => void) { return exec().finally(fn); },
    };
    return chain;
}

function makeFromProxy(table: string): ReturnType<typeof _supabase.from> {
    const base = _supabase.from(table);
    let _filters: Record<string, unknown> = {};

    const wrap = (inner: ReturnType<typeof _supabase.from>): ReturnType<typeof _supabase.from> => {
        return new Proxy(inner, {
            get(target, prop: string) {
                const val = (target as unknown as AnyRecord)[prop];

                if (prop === 'select') {
                    return (cols = '*', opts?: { count?: string; head?: boolean }) => {
                        const sbResult = call<unknown>(target, 'select', cols, opts);
                        // Se tabela não está no read set, tem join syntax ou tem count: usa Supabase
                        if (!SURREAL_READ_TABLES.has(table) || opts?.count || /\w\s*\(/.test(cols)) {
                            return sbResult;
                        }
                        return makeSurrealSelect(table, cols as string, sbResult);
                    };
                }

                if (prop === 'eq') {
                    return (field: string, value: unknown) => {
                        _filters[field] = value;
                        return wrap(call<ReturnType<typeof _supabase.from>>(target, 'eq', field, value));
                    };
                }

                if (prop === 'insert') {
                    return (data: unknown) => {
                        if (SURREAL_PRIMARY_WRITE_TABLES.has(table)) {
                            return makeMutationChain(table, 'insert', data, {});
                        }
                        const b = call<Parameters<typeof wrapMutationBuilder>[0]>(target, 'insert', data);
                        return wrapMutationBuilder(b, table, 'insert', data, {});
                    };
                }
                if (prop === 'upsert') {
                    return (data: unknown, opts?: unknown) => {
                        if (SURREAL_PRIMARY_WRITE_TABLES.has(table)) {
                            return makeMutationChain(table, 'upsert', data, {});
                        }
                        const b = call<Parameters<typeof wrapMutationBuilder>[0]>(target, 'upsert', data, opts);
                        return wrapMutationBuilder(b, table, 'upsert', data, {});
                    };
                }
                if (prop === 'update') {
                    return (data: unknown) => {
                        if (SURREAL_PRIMARY_WRITE_TABLES.has(table)) {
                            return makeMutationChain(table, 'update', data, { ..._filters });
                        }
                        const b = call<ReturnType<typeof _supabase.from>>(target, 'update', data);
                        return new Proxy(b, {
                            get(bt, bp: string) {
                                if (bp === 'eq') {
                                    return (field: string, value: unknown) => {
                                        _filters[field] = value;
                                        const nb = call<Parameters<typeof wrapMutationBuilder>[0]>(bt, 'eq', field, value);
                                        return wrapMutationBuilder(nb, table, 'update', data, { ..._filters });
                                    };
                                }
                                const bv = (bt as unknown as AnyRecord)[bp];
                                return typeof bv === 'function' ? bv.bind(bt) : bv;
                            }
                        });
                    };
                }
                if (prop === 'delete') {
                    return () => {
                        if (SURREAL_PRIMARY_WRITE_TABLES.has(table)) {
                            return makeMutationChain(table, 'delete', null, { ..._filters });
                        }
                        const b = call<ReturnType<typeof _supabase.from>>(target, 'delete');
                        return new Proxy(b, {
                            get(bt, bp: string) {
                                if (bp === 'eq') {
                                    return (field: string, value: unknown) => {
                                        _filters[field] = value;
                                        const nb = call<Parameters<typeof wrapMutationBuilder>[0]>(bt, 'eq', field, value);
                                        return wrapMutationBuilder(nb, table, 'delete', null, { ..._filters });
                                    };
                                }
                                const bv = (bt as unknown as AnyRecord)[bp];
                                return typeof bv === 'function' ? bv.bind(bt) : bv;
                            }
                        });
                    };
                }

                return typeof val === 'function' ? val.bind(target) : val;
            }
        });
    };

    return wrap(base);
}

// Proxy final do supabase
// Proxy for functions.invoke — bypasses Supabase session handling so a stale/expired
// Supabase JWT in localStorage doesn't cause a non-2xx on Edge Function calls.
const _functionsProxy = {
    invoke(fnName: string, opts?: { body?: unknown; headers?: Record<string, string>; method?: string }) {
        const url = `${supabaseUrl}/functions/v1/${fnName}`;
        return fetch(url, {
            method: opts?.method ?? 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'apikey': supabaseAnonKey,
                'Content-Type': 'application/json',
                ...(opts?.headers ?? {}),
            },
            body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        }).then(async res => {
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                return { data: null, error: new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`) };
            }
            return { data: json, error: null };
        });
    },
};

export const supabase = new Proxy(_supabase, {
    get(target, prop: string) {
        if (prop === 'from') {
            return (table: string) => makeFromProxy(table);
        }
        if (prop === 'auth') {
            return _surrealAuth;
        }
        if (prop === 'functions') {
            return _functionsProxy;
        }
        const val = (target as unknown as AnyRecord)[prop];
        return typeof val === 'function' ? val.bind(target) : val;
    }
}) as typeof _supabase;

// Raw Supabase client — bypassa o proxy (usar apenas para leitura pós-sync)
export const supabaseRaw = _supabase as typeof _supabase;

// Upsert em lote no SurrealDB — deleta rows do período e reinsere com dados frescos.
// Usa token admin para bypass de PERMISSIONS (operação privilegiada pós-sync).
export async function surrealBatchUpsert(
    table: string,
    rows: Record<string, unknown>[],
    opts?: { dateField?: string; dateFrom?: string; dateTo?: string }
): Promise<void> {
    try {
        if (!rows.length) return;
        const token = await ensureAdminToken();
        if (!token) return;
        let sql = '';
        if (opts?.dateField && opts.dateFrom && opts.dateTo) {
            sql += `DELETE ${table} WHERE ${opts.dateField} >= d"${opts.dateFrom}T00:00:00Z" AND ${opts.dateField} <= d"${opts.dateTo}T23:59:59Z";\n`;
        }
        const lits = rows.map(r => toSurrealValue(r)).join(',\n');
        sql += `INSERT INTO ${table} [\n${lits}\n] RETURN NONE;`;
        await fetch(`${SURREAL_ENDPOINT}/sql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain', 'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
            },
            body: sql,
        });
    } catch { /* silent — não bloqueia a UI */ }
}
