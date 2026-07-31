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

async function ensureSurrealToken(): Promise<string | null> {
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
        if (op === 'delete') {
            if (!filters || !Object.keys(filters).length) return;
            const where = Object.entries(filters)
                .map(([k, v]) => `${k} = ${toSurrealValue(v)}`).join(' AND ');
            query = `DELETE ${table} WHERE ${where}`;
        } else if (op === 'update') {
            if (!filters || !Object.keys(filters).length || !data) return;
            const sets = Object.entries(data as Record<string, unknown>)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k} = ${toSurrealValue(v)}`).join(', ');
            const where = Object.entries(filters)
                .map(([k, v]) => `${k} = ${toSurrealValue(v)}`).join(' AND ');
            query = `UPDATE ${table} SET ${sets} WHERE ${where}`;
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
                    // Fire-and-forget ao SurrealDB
                    surrealWrite(table, op, mutationData, filters).catch(() => {});
                }
                return resolve ? resolve(result) : result;
            },
            reject
        );
    };
    return builder;
}

function makeFromProxy(table: string): ReturnType<typeof _supabase.from> {
    const base = _supabase.from(table);
    let _filters: Record<string, unknown> = {};

    const wrap = (inner: ReturnType<typeof _supabase.from>): ReturnType<typeof _supabase.from> => {
        return new Proxy(inner, {
            get(target, prop: string) {
                const val = (target as Record<string, unknown>)[prop];

                // Captura filtros eq para passar ao surrealWrite
                if (prop === 'eq') {
                    return (field: string, value: unknown) => {
                        _filters[field] = value;
                        return wrap((target as Record<string, Function>).eq(field, value) as ReturnType<typeof _supabase.from>);
                    };
                }

                // Intercepta mutações
                if (prop === 'insert') {
                    return (data: unknown) => {
                        const b = (target as Record<string, Function>).insert(data) as ReturnType<typeof _supabase.from>;
                        return wrapMutationBuilder(b as Parameters<typeof wrapMutationBuilder>[0], table, 'insert', data, {});
                    };
                }
                if (prop === 'upsert') {
                    return (data: unknown, opts?: unknown) => {
                        const b = (target as Record<string, Function>).upsert(data, opts) as ReturnType<typeof _supabase.from>;
                        return wrapMutationBuilder(b as Parameters<typeof wrapMutationBuilder>[0], table, 'upsert', data, {});
                    };
                }
                if (prop === 'update') {
                    return (data: unknown) => {
                        const b = (target as Record<string, Function>).update(data) as ReturnType<typeof _supabase.from>;
                        // Ao encadear .eq() após .update(), captura os filtros
                        return new Proxy(b, {
                            get(bt, bp: string) {
                                if (bp === 'eq') {
                                    return (field: string, value: unknown) => {
                                        _filters[field] = value;
                                        const nb = (bt as Record<string, Function>).eq(field, value) as ReturnType<typeof _supabase.from>;
                                        return wrapMutationBuilder(nb as Parameters<typeof wrapMutationBuilder>[0], table, 'update', data, { ..._filters });
                                    };
                                }
                                const bv = (bt as Record<string, unknown>)[bp];
                                return typeof bv === 'function' ? bv.bind(bt) : bv;
                            }
                        });
                    };
                }
                if (prop === 'delete') {
                    return () => {
                        const b = (target as Record<string, Function>).delete() as ReturnType<typeof _supabase.from>;
                        return new Proxy(b, {
                            get(bt, bp: string) {
                                if (bp === 'eq') {
                                    return (field: string, value: unknown) => {
                                        _filters[field] = value;
                                        const nb = (bt as Record<string, Function>).eq(field, value) as ReturnType<typeof _supabase.from>;
                                        return wrapMutationBuilder(nb as Parameters<typeof wrapMutationBuilder>[0], table, 'delete', null, { ..._filters });
                                    };
                                }
                                const bv = (bt as Record<string, unknown>)[bp];
                                return typeof bv === 'function' ? bv.bind(bt) : bv;
                            }
                        });
                    };
                }

                return typeof val === 'function' ? (val as Function).bind(target) : val;
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
        const val = (target as Record<string, unknown>)[prop];
        return typeof val === 'function' ? (val as Function).bind(target) : val;
    }
}) as typeof _supabase;
