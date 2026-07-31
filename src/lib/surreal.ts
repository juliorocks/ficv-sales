/**
 * src/lib/surreal.ts
 * Cliente SurrealDB com interface compatível com Supabase.
 * Fase de migração paralela: substitui supabase.ts table por table.
 *
 * Padrão de uso idêntico ao Supabase:
 *   const { data, error } = await surreal.from('leads').select('*').eq('id', 1).single()
 *   const { error } = await surreal.from('leads').insert({ nome_completo: 'João' })
 *   const { error } = await surreal.from('leads').update({ stage_id: 2 }).eq('id', 1)
 *   const { error } = await surreal.from('leads').delete().eq('id', 1)
 */

const ENDPOINT  = import.meta.env.VITE_SURREAL_ENDPOINT
  || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS        = import.meta.env.VITE_SURREAL_NS || 'ficv';
const DB        = import.meta.env.VITE_SURREAL_DB || 'salespulse';

const TOKEN_KEY = 'surreal_token';
const USER_KEY  = 'surreal_user';

// ── Token store ───────────────────────────────────────────────────────────────

let _token: string | null = localStorage.getItem(TOKEN_KEY);
let _authListeners: Array<(event: string, session: SurrealSession | null) => void> = [];

interface SurrealSession {
  access_token: string;
  user: { id: string; email: string; role: string; full_name: string; [key: string]: unknown };
}

function setToken(token: string | null, user: SurrealSession['user'] | null) {
  _token = token;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  const session: SurrealSession | null = token && user ? { access_token: token, user } : null;
  _authListeners.forEach(fn => fn(token ? 'SIGNED_IN' : 'SIGNED_OUT', session));
}

function getStoredUser(): SurrealSession['user'] | null {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function sql(query: string): Promise<unknown[]> {
  if (!_token) throw new Error('SurrealDB: não autenticado');
  const res = await fetch(`${ENDPOINT}/sql`, {
    method:  'POST',
    headers: {
      'Content-Type':  'text/plain',
      'Accept':        'application/json',
      'Authorization': `Bearer ${_token}`,
      'surreal-ns':    NS,
      'surreal-db':    DB,
    },
    body: query,
  });
  if (res.status === 401) {
    setToken(null, null);
    throw new Error('Token expirado — faça login novamente');
  }
  if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}: ${await res.text()}`);
  const results = await res.json() as Array<{ status: string; result: unknown; time: string }>;
  const errors  = results.filter(r => r.status === 'ERR');
  if (errors.length) throw new Error(errors.map(e => e.result).join('; '));
  return results.map(r => r.result);
}

// ── SurrealQL helpers ─────────────────────────────────────────────────────────

function esc(v: unknown): string {
  if (v === null || v === undefined) return 'NONE';
  if (typeof v === 'boolean')        return String(v);
  if (typeof v === 'number')         return String(v);
  if (typeof v === 'string') {
    // Record ID já formatado (ex: "leads:5") — passa direto
    if (/^[a-z_]+:/.test(v)) return v;
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  if (Array.isArray(v)) return `[${v.map(esc).join(', ')}]`;
  if (typeof v === 'object') {
    const pairs = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .map(([k, val]) => `${k}: ${esc(val)}`);
    return `{ ${pairs.join(', ')} }`;
  }
  return JSON.stringify(v);
}

// Converte IDs SurrealDB (table:id) → id puro
function stripRecordId(v: unknown): unknown {
  if (typeof v === 'string' && /^[a-z_]+:/.test(v)) {
    const id = v.split(':')[1].replace(/^⟨|⟩$/g, '');
    const n = Number(id);
    return Number.isNaN(n) ? id : n;
  }
  if (Array.isArray(v))       return v.map(stripRecordId);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, stripRecordId(val)])
    );
  }
  return v;
}

// Converte coluna Supabase join (ex: "*, profiles(full_name)") → colunas SurrealQL simples
function parseSelect(cols: string): string {
  if (!cols || cols === '*') return '*';
  // Remove parênteses de join do Supabase (ex: "profiles(full_name)" → ignora)
  return cols
    .split(',')
    .map(c => c.trim())
    .filter(c => !c.includes('(') && c !== '')
    .join(', ') || '*';
}

// ── Query builder ─────────────────────────────────────────────────────────────

type OrderBy = { field: string; ascending: boolean };
type FilterOp = { field: string; op: string; value: unknown };

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
}

class QueryBuilder<T = Record<string, unknown>> {
  private _table:   string;
  private _select:  string = '*';
  private _filters: FilterOp[] = [];
  private _orders:  OrderBy[]  = [];
  private _limit:   number | null = null;
  private _start:   number | null = null;
  private _single:  boolean = false;
  private _maybe:   boolean = false;
  private _countOnly: boolean = false;

  constructor(table: string) { this._table = table; }

  select(cols: string, opts?: { count?: string; head?: boolean }): this {
    this._select = parseSelect(cols);
    if (opts?.head) this._countOnly = true;
    return this;
  }

  eq(field: string, value: unknown)  { this._filters.push({ field, op: '=',    value }); return this; }
  neq(field: string, value: unknown) { this._filters.push({ field, op: '!=',   value }); return this; }
  gte(field: string, value: unknown) { this._filters.push({ field, op: '>=',   value }); return this; }
  lte(field: string, value: unknown) { this._filters.push({ field, op: '<=',   value }); return this; }
  gt(field: string, value: unknown)  { this._filters.push({ field, op: '>',    value }); return this; }
  lt(field: string, value: unknown)  { this._filters.push({ field, op: '<',    value }); return this; }

  in(field: string, values: unknown[]): this {
    this._filters.push({ field, op: 'IN', value: values });
    return this;
  }

  is(field: string, value: unknown): this {
    this._filters.push({ field, op: value === null ? '= NONE' : '=', value: value === null ? null : value });
    return this;
  }

  ilike(field: string, pattern: string): this {
    // Transforma %value% em CONTAINS via lowercase
    const v = pattern.replace(/%/g, '');
    this._filters.push({ field, op: 'ILIKE', value: v });
    return this;
  }

  or(filterStr: string): this {
    // Formato Supabase: "col1.ilike.%val%,col2.eq.val"
    // Guarda como raw para montar no WHERE
    this._filters.push({ field: '__OR__', op: 'OR', value: filterStr });
    return this;
  }

  order(field: string, opts?: { ascending?: boolean }): this {
    this._orders.push({ field, ascending: opts?.ascending ?? true });
    return this;
  }

  range(from: number, to: number): this {
    this._start = from;
    this._limit = to - from + 1;
    return this;
  }

  limit(n: number): this { this._limit = n; return this; }
  single():      this { this._single = true; return this; }
  maybeSingle(): this { this._maybe  = true; return this; }

  private buildWhere(): string {
    if (!this._filters.length) return '';
    const parts = this._filters.map(f => {
      if (f.op === 'OR') {
        const sub = (f.value as string).split(',').map(clause => {
          const [col, op, val] = clause.split('.');
          if (op === 'ilike') return `string::lowercase(${col}) CONTAINS string::lowercase("${val.replace(/%/g, '')}")`;
          if (op === 'eq')    return `${col} = ${esc(val)}`;
          return `${col} ${op} ${esc(val)}`;
        });
        return `(${sub.join(' OR ')})`;
      }
      if (f.op === 'ILIKE') {
        return `string::lowercase(${f.field}) CONTAINS string::lowercase(${esc(f.value)})`;
      }
      if (f.op === 'IN')          return `${f.field} IN ${esc(f.value)}`;
      if (f.op === '= NONE')      return `${f.field} = NONE`;
      return `${f.field} ${f.op} ${esc(f.value)}`;
    });
    return `WHERE ${parts.join(' AND ')}`;
  }

  private buildQuery(): string {
    const where   = this.buildWhere();
    const orderBy = this._orders.length
      ? `ORDER BY ${this._orders.map(o => `${o.field} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`
      : '';
    const limit = this._limit !== null ? `LIMIT ${this._limit}` : '';
    const start = this._start !== null ? `START ${this._start}` : '';
    return `SELECT ${this._select} FROM ${this._table} ${where} ${orderBy} ${limit} ${start}`.replace(/\s+/g, ' ').trim();
  }

  async then(resolve: (r: QueryResult<T[]>) => void, reject: (e: unknown) => void): Promise<void> {
    try {
      if (this._countOnly) {
        const q = `SELECT count() FROM ${this._table} ${this.buildWhere()} GROUP ALL`;
        const [res] = await sql(q) as unknown[][];
        resolve({ data: null, error: null, count: (res?.[0] as { count?: number })?.count ?? 0 });
        return;
      }
      const [res] = await sql(this.buildQuery()) as unknown[][];
      const rows  = (Array.isArray(res) ? res : [res]).map(r => stripRecordId(r)) as T[];
      if (this._single) {
        if (!rows.length)
          resolve({ data: null, error: { message: 'Row not found' }, count: null });
        else
          resolve({ data: rows[0] as unknown as T[], error: null, count: 1 });
        return;
      }
      if (this._maybe) {
        resolve({ data: (rows[0] ?? null) as unknown as T[], error: null, count: rows.length });
        return;
      }
      resolve({ data: rows, error: null, count: rows.length });
    } catch (e: unknown) {
      reject(e);
    }
  }
}

// ── Mutation builders ─────────────────────────────────────────────────────────

class InsertBuilder<T = Record<string, unknown>> {
  private _table: string;
  private _data:  T | T[];
  private _select = '';

  constructor(table: string, data: T | T[]) {
    this._table = table;
    this._data  = data;
  }

  select(cols: string): this { this._select = cols; return this; }

  async then(resolve: (r: QueryResult<T[]>) => void, reject: (e: unknown) => void): Promise<void> {
    try {
      const rows = Array.isArray(this._data) ? this._data : [this._data];
      const lit  = rows.map(r => esc(r)).join(', ');
      const ret  = this._select ? `RETURN ${parseSelect(this._select)}` : 'RETURN AFTER';
      const [res] = await sql(`INSERT INTO ${this._table} [${lit}] ${ret}`) as unknown[][];
      const data  = (Array.isArray(res) ? res : [res]).map(r => stripRecordId(r)) as T[];
      resolve({ data, error: null });
    } catch (e: unknown) {
      reject(e);
    }
  }
}

class UpdateBuilder<T = Record<string, unknown>> {
  private _table:   string;
  private _data:    Partial<T>;
  private _filters: FilterOp[] = [];

  constructor(table: string, data: Partial<T>) {
    this._table = table;
    this._data  = data;
  }

  eq(field: string, value: unknown):  this { this._filters.push({ field, op: '=',  value }); return this; }
  neq(field: string, value: unknown): this { this._filters.push({ field, op: '!=', value }); return this; }

  async then(resolve: (r: QueryResult<T[]>) => void, reject: (e: unknown) => void): Promise<void> {
    try {
      const sets  = Object.entries(this._data as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} = ${esc(v)}`).join(', ');
      const where = this._filters.length
        ? `WHERE ${this._filters.map(f => `${f.field} ${f.op} ${esc(f.value)}`).join(' AND ')}`
        : '';
      const [res] = await sql(`UPDATE ${this._table} SET ${sets} ${where} RETURN AFTER`) as unknown[][];
      const data  = (Array.isArray(res) ? res : [res]).map(r => stripRecordId(r)) as T[];
      resolve({ data, error: null });
    } catch (e: unknown) {
      reject(e);
    }
  }
}

class DeleteBuilder {
  private _table:   string;
  private _filters: FilterOp[] = [];

  constructor(table: string) { this._table = table; }

  eq(field: string, value: unknown):  this { this._filters.push({ field, op: '=',  value }); return this; }
  neq(field: string, value: unknown): this { this._filters.push({ field, op: '!=', value }); return this; }
  gte(field: string, value: unknown): this { this._filters.push({ field, op: '>=', value }); return this; }
  lte(field: string, value: unknown): this { this._filters.push({ field, op: '<=', value }); return this; }

  async then(resolve: (r: QueryResult<null>) => void, reject: (e: unknown) => void): Promise<void> {
    try {
      const where = this._filters.length
        ? `WHERE ${this._filters.map(f => `${f.field} ${f.op} ${esc(f.value)}`).join(' AND ')}`
        : '';
      await sql(`DELETE ${this._table} ${where}`);
      resolve({ data: null, error: null });
    } catch (e: unknown) {
      reject(e);
    }
  }
}

class UpsertBuilder<T = Record<string, unknown>> {
  private _table:      string;
  private _data:       T | T[];
  private _onConflict: string;

  constructor(table: string, data: T | T[], onConflict: string) {
    this._table      = table;
    this._data       = data;
    this._onConflict = onConflict;
  }

  async then(resolve: (r: QueryResult<T[]>) => void, reject: (e: unknown) => void): Promise<void> {
    try {
      const rows = Array.isArray(this._data) ? this._data : [this._data];
      const lit  = rows.map(r => esc(r)).join(', ');
      // SurrealDB INSERT ignora duplicatas de ID por padrão; ON DUPLICATE KEY UPDATE
      const [res] = await sql(
        `INSERT INTO ${this._table} [${lit}] ON DUPLICATE KEY UPDATE RETURN AFTER`
      ) as unknown[][];
      const data  = (Array.isArray(res) ? res : [res]).map(r => stripRecordId(r)) as T[];
      resolve({ data, error: null });
    } catch (e: unknown) {
      reject(e);
    }
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const res = await fetch(`${ENDPOINT}/signin`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': NS, 'surreal-db': DB },
        body:    JSON.stringify({ ac: 'staff', ns: NS, db: DB, email, password }),
      });
      const body = await res.json() as { token?: string; code?: number; information?: string };
      if (!res.ok || !body.token) {
        return { data: { session: null }, error: { message: body.information || 'Login inválido' } };
      }
      // Busca perfil do usuário
      const [[profile]] = await (async () => {
        _token = body.token;
        return sql(`SELECT * FROM profiles WHERE email = "${email}" LIMIT 1`) as Promise<unknown[][]>;
      })();
      const user: SurrealSession['user'] = {
        ...(profile as Record<string, unknown>),
        id:    stripRecordId((profile as Record<string, unknown>).id) as string,
        email,
        role:  (profile as Record<string, unknown>).role as string,
        full_name: (profile as Record<string, unknown>).full_name as string,
      };
      setToken(body.token, user);
      return { data: { session: { access_token: body.token, user } }, error: null };
    } catch (e: unknown) {
      return { data: { session: null }, error: { message: (e as Error).message } };
    }
  },

  async signOut() {
    setToken(null, null);
    return { error: null };
  },

  async getSession(): Promise<{ data: { session: SurrealSession | null } }> {
    const token = localStorage.getItem(TOKEN_KEY);
    const user  = getStoredUser();
    if (token && user) {
      _token = token;
      return { data: { session: { access_token: token, user } } };
    }
    return { data: { session: null } };
  },

  onAuthStateChange(callback: (event: string, session: SurrealSession | null) => void) {
    _authListeners.push(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            _authListeners = _authListeners.filter(fn => fn !== callback);
          },
        },
      },
    };
  },

  // Portal do aluno
  async signUp({ email, password, options }: {
    email: string; password: string;
    options?: { data?: { cpf?: string; nome?: string } }
  }) {
    try {
      const res = await fetch(`${ENDPOINT}/signup`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': NS, 'surreal-db': DB },
        body:    JSON.stringify({
          ac: 'alunos', ns: NS, db: DB,
          email, password,
          cpf:  options?.data?.cpf  ?? '',
          nome: options?.data?.nome ?? '',
        }),
      });
      const body = await res.json() as { token?: string; information?: string };
      if (!res.ok || !body.token) {
        return { data: { user: null }, error: { message: body.information || 'Cadastro falhou' } };
      }
      return { data: { user: { email } }, error: null };
    } catch (e: unknown) {
      return { data: { user: null }, error: { message: (e as Error).message } };
    }
  },
};

// ── Realtime (stub compatível) ────────────────────────────────────────────────
// SurrealDB tem LIVE SELECT, mas por ora apenas stub para não quebrar o código existente

function channel(_name: string) {
  return {
    on(_event: string, _filter: unknown, _cb: unknown) { return this; },
    subscribe()    { return this; },
    unsubscribe()  { return this; },
  };
}

function removeChannel(_ch: unknown) {}

// ── RPC ───────────────────────────────────────────────────────────────────────

async function rpc<T = unknown>(
  fn: string,
  params: Record<string, unknown> = {}
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const args = Object.entries(params).map(([, v]) => esc(v)).join(', ');
    const [res] = await sql(`RETURN fn::${fn}(${args})`);
    return { data: stripRecordId(res) as T, error: null };
  } catch (e: unknown) {
    return { data: null, error: { message: (e as Error).message } };
  }
}

// ── Main client ───────────────────────────────────────────────────────────────

function from<T = Record<string, unknown>>(table: string) {
  return {
    select(cols = '*', opts?: { count?: string; head?: boolean }) {
      return new QueryBuilder<T>(table).select(cols, opts);
    },
    insert(data: T | T[]) {
      return new InsertBuilder<T>(table, data);
    },
    update(data: Partial<T>) {
      return new UpdateBuilder<T>(table, data);
    },
    delete() {
      return new DeleteBuilder(table);
    },
    upsert(data: T | T[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      return new UpsertBuilder<T>(table, data, opts?.onConflict ?? 'id');
    },
  };
}

export const surreal = { from, auth, rpc, channel, removeChannel };

// Expõe token atual para uso em webhooks e edge functions futuros
export function getSurrealToken(): string | null { return _token; }
