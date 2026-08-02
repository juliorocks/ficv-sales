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
    type WherePart = { isIn: boolean; field: string; val: unknown };
    type OrderPart = { field: string; asc: boolean };
    const wheres: WherePart[] = [];
    const orders: OrderPart[] = [];
    let lim: number | null = null;
    let isSingle = false;
    let isMaybe = false;
    let sb = sbBase as Record<string, (...a: unknown[]) => unknown>;

    const refFields = REFERENCE_FIELDS[table] ?? {};
    const toRecordId = (refTable: string, v: unknown) => `${refTable}:⟨${v}⟩`;

    const buildWhereSql = () => wheres.map(({ isIn, field, val }) => {
        const ref = field === 'id' ? table : refFields[field];
        if (!isIn) {
            if (ref && val != null) return `${field} = ${toRecordId(ref, val)}`;
            return `${field} = ${toSurrealValue(val)}`;
        }
        if (ref) {
            return `${field} IN [${(val as unknown[]).map(v => toRecordId(ref, v)).join(', ')}]`;
        }
        return `${field} IN [${(val as unknown[]).map(v => toSurrealValue(v)).join(', ')}]`;
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
        eq(field: string, val: unknown)      { wheres.push({ isIn: false, field, val }); sb = sb.eq(field, val) as typeof sb; return builder; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        in(field: string, vals: unknown[])   { wheres.push({ isIn: true, field, val: vals }); sb = (sb as any).in(field, vals); return builder; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        order(field: string, opts?: { ascending?: boolean }) { orders.push({ field, asc: opts?.ascending !== false }); sb = (sb as any).order(field, opts); return builder; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        limit(n: number)   { lim = n; sb = (sb as any).limit(n); return builder; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        single()     { isSingle = true; sb = (sb as any).single(); return builder; },
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
                        const b = call<Parameters<typeof wrapMutationBuilder>[0]>(target, 'insert', data);
                        return wrapMutationBuilder(b, table, 'insert', data, {});
                    };
                }
                if (prop === 'upsert') {
                    return (data: unknown, opts?: unknown) => {
                        const b = call<Parameters<typeof wrapMutationBuilder>[0]>(target, 'upsert', data, opts);
                        return wrapMutationBuilder(b, table, 'upsert', data, {});
                    };
                }
                if (prop === 'update') {
                    return (data: unknown) => {
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
export const supabase = new Proxy(_supabase, {
    get(target, prop: string) {
        if (prop === 'from') {
            return (table: string) => makeFromProxy(table);
        }
        if (prop === 'auth') {
            return _surrealAuth;
        }
        const val = (target as unknown as AnyRecord)[prop];
        return typeof val === 'function' ? val.bind(target) : val;
    }
}) as typeof _supabase;
