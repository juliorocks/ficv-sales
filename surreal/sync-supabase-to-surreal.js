#!/usr/bin/env node
/**
 * sync-supabase-to-surreal.js
 * Migração inicial: lê dados direto do PostgreSQL (sem REST API) e insere no SurrealDB.
 *
 * Uso:
 *   SUPABASE_DB_PASSWORD=<senha> node surreal/sync-supabase-to-surreal.js [tabela]
 *
 * Opcionalmente, passe DATABASE_URL completa:
 *   DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-us-east-1.pooler.supabase.com:6543/postgres \
 *   node surreal/sync-supabase-to-surreal.js
 */

import pg from 'pg';
const { Client } = pg;

// ── Config ──────────────────────────────────────────────────────────────────
const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT
  || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS   = process.env.SURREAL_NS  || 'ficv';
const SURREAL_DB   = process.env.SURREAL_DB  || 'salespulse';
const SURREAL_USER = process.env.SURREAL_USER || 'ficv_admin';
const SURREAL_PASS = process.env.SURREAL_PASS || 'Ficv@Surreal2026!';

// Supabase Postgres — tenta conexão direta primeiro, pooler como fallback
const SUPABASE_REF  = 'znypfroagfwohqeyxyqv';
const SUPABASE_PASS = process.env.SUPABASE_DB_PASSWORD || '';

const PG_CONFIGS = process.env.DATABASE_URL
  ? [{ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }]
  : [
      // 1. Conexão direta (melhor — session-level, sem limites de OFFSET)
      {
        host: `db.${SUPABASE_REF}.supabase.co`,
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: SUPABASE_PASS,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000,
      },
      // 2. Pooler session mode — sa-east-1 (São Paulo)
      {
        host: 'aws-0-sa-east-1.pooler.supabase.com',
        port: 5432,
        database: 'postgres',
        user: `postgres.${SUPABASE_REF}`,
        password: SUPABASE_PASS,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      },
      // 3. Pooler transaction mode (porta 6543)
      {
        host: 'aws-0-sa-east-1.pooler.supabase.com',
        port: 6543,
        database: 'postgres',
        user: `postgres.${SUPABASE_REF}`,
        password: SUPABASE_PASS,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      },
    ];

const BATCH = 500;
let _token = null;

// ── SurrealDB REST client ─────────────────────────────────────────────────────

async function surrealSignin() {
  const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
    body: JSON.stringify({ ns: SURREAL_NS, user: SURREAL_USER, pass: SURREAL_PASS }),
  });
  if (!res.ok) throw new Error(`Signin falhou HTTP ${res.status}: ${await res.text()}`);
  const { token } = await res.json();
  if (!token) throw new Error('Signin retornou sem token');
  _token = token;
}

async function surrealSQL(sql, retry = true) {
  const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type':  'text/plain',
      'Accept':        'application/json',
      'Authorization': `Bearer ${_token}`,
      'surreal-ns':    SURREAL_NS,
      'surreal-db':    SURREAL_DB,
    },
    body: sql,
  });
  if (res.status === 401 && retry) {
    // Token expirou — renovar e tentar uma vez
    log('Token expirado, renovando...');
    await surrealSignin();
    return surrealSQL(sql, false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SurrealDB HTTP ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) {
    const errors = data.filter(r => r.status === 'ERR');
    if (errors.length > 0) throw new Error(errors.map(e => e.result).join('; '));
  }
  return data;
}

function toSurrealLiteral(v) {
  if (v === null || v === undefined) return 'NONE';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `d"${v.toISOString()}"`;
  if (typeof v === 'string') {
    // SurrealDB record ID — output bare (unquoted) so it's treated as a record reference
    if (/^[a-z_]+:⟨.+⟩$/.test(v)) return v;
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `d"${v}"`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `d"${v}T00:00:00Z"`;
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')}"`;
  }
  if (Array.isArray(v)) return `[${v.map(toSurrealLiteral).join(',')}]`;
  if (typeof v === 'object') {
    const pairs = Object.entries(v)
      .filter(([, val]) => val !== undefined)
      .map(([k, val]) => `${k}: ${toSurrealLiteral(val)}`);
    return `{${pairs.join(', ')}}`;
  }
  return JSON.stringify(v);
}

async function surrealInsert(table, rows) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const literals = chunk.map(r => toSurrealLiteral(r)).join(',\n  ');
    const sql = `INSERT IGNORE INTO ${table} [\n  ${literals}\n] RETURN NONE`;
    try {
      await surrealSQL(sql);
      inserted += chunk.length;
    } catch (e) {
      warn(`Erro ao inserir em ${table} (chunk ${i}): ${e.message.slice(0, 300)}`);
    }
    await sleep(30);
  }
  return inserted;
}

// ── PostgreSQL client ─────────────────────────────────────────────────────────

async function connectPg() {
  for (const config of PG_CONFIGS) {
    const label = config.connectionString
      ? config.connectionString.replace(/:([^@]+)@/, ':***@')
      : `${config.host}:${config.port}`;
    try {
      const client = new Client(config);
      await client.connect();
      log(`✓ PostgreSQL conectado via ${label}`);
      return client;
    } catch (e) {
      warn(`PG ${label}: ${e.message}`);
    }
  }
  throw new Error('Não foi possível conectar ao PostgreSQL. Verifique SUPABASE_DB_PASSWORD.');
}

async function pgQuery(client, table, columns, orderBy, offset) {
  const cols = columns === '*' ? '*' : columns.split(',').map(c => `"${c.trim()}"`).join(', ');
  const q = `SELECT ${cols} FROM "${table}" ORDER BY "${orderBy}" LIMIT ${BATCH} OFFSET ${offset}`;
  const res = await client.query(q);
  return res.rows;
}

// Streaming: lê e insere uma página de cada vez (sem acumular tudo na memória)
async function streamProcess(client, table, columns, orderBy, transform, initialCursor = null, maxVal = null) {
  let lastVal = initialCursor;
  let total = 0, inserted = 0;
  const cols = columns === '*' ? '*' : columns.split(',').map(c => `"${c.trim()}"`).join(', ');

  while (true) {
    let cursorLit;
    if (lastVal instanceof Date) {
      cursorLit = `'${lastVal.toISOString()}'`;
    } else if (typeof lastVal === 'string') {
      cursorLit = `'${lastVal.replace(/'/g, "''")}'`;
    } else {
      cursorLit = lastVal;
    }
    const whereParts = [];
    if (lastVal !== null) whereParts.push(`"${orderBy}" > ${cursorLit}`);
    if (maxVal !== null) whereParts.push(`"${orderBy}" <= ${maxVal}`);
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const q = `SELECT ${cols} FROM "${table}" ${where} ORDER BY "${orderBy}" LIMIT ${BATCH}`;
    const res = await client.query(q);
    const batch = res.rows;
    if (!batch.length) break;

    total += batch.length;
    const rows = batch.map(transform);
    inserted += await surrealInsert(table, rows);

    lastVal = batch[batch.length - 1][orderBy];
    process.stdout.write(`\r   ${total} lidos / ${inserted} inseridos...`);
    if (batch.length < BATCH) break;
  }
  process.stdout.write('\r');
  return { total, inserted };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const log  = (msg) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sid(table, id) {
  if (id == null) return null;
  return `${table}:⟨${String(id)}⟩`;
}

// ── Transformers ──────────────────────────────────────────────────────────────

const T = {
  stages: (r) => ({
    id: sid('stages', r.id), name: r.name,
    order: r.order || 0, title_color: r.title_color, bg_color: r.bg_color,
  }),
  courses: (r) => ({
    id: sid('courses', r.id), name: r.name, type: r.type,
    default_value: r.default_value != null ? Number(r.default_value) : null,
  }),
  lead_sources: (r) => ({
    id: sid('lead_sources', r.id), name: r.name, icon: r.icon, color: r.color,
  }),
  motivos_perda: (r) => ({ id: sid('motivos_perda', r.id), motivo: r.motivo }),
  teams: (r) => ({
    id: sid('teams', r.id), name: r.name, description: r.description,
    color: r.color || '#6366f1', icon: r.icon || 'users',
    active: r.active !== false, created_at: r.created_at, updated_at: r.updated_at,
  }),
  profiles: (r) => ({
    id: sid('profiles', r.id),
    full_name: r.full_name || '',
    role: r.role || 'agent', avatar_url: r.avatar_url || null,
    score: r.score ? Number(r.score) : 0, updated_at: r.updated_at,
  }),
  alunos: (r) => ({
    id: sid('alunos', r.id), cpf: r.cpf, nome: r.nome,
    email: r.email || null, created_at: r.created_at, updated_at: r.updated_at,
  }),
  leads: (r) => ({
    id: sid('leads', r.id),
    nome_completo: r.nome_completo || '',
    email: r.email || null,
    telefone: r.telefone || '',
    curso_interesse: r.curso_interesse ? sid('courses', r.curso_interesse) : null,
    valor_oportunidade: Number(r.valor_oportunidade) || 0,
    stage_id: sid('stages', r.stage_id),
    data_entrada: r.data_entrada,
    stage_entry_date: r.stage_entry_date || null,
    observacoes: r.observacoes || null,
    source_id: r.source_id ? sid('lead_sources', r.source_id) : null,
    temperatura: r.temperatura || null,
    assigned_to_id: r.assigned_to_id ? sid('profiles', r.assigned_to_id) : null,
    motivo_perda_id: r.motivo_perda_id ? sid('motivos_perda', r.motivo_perda_id) : null,
    contact_count: Number(r.contact_count) || 0,
    widechat_contact_id: r.widechat_contact_id || null,
    widechat_session_id: r.widechat_session_id || null,
    widechat_attendance_id: r.widechat_attendance_id || null,
    fonte_lead: r.fonte_lead || null,
    partner_id: r.partner_id || null,
    created_at: r.created_at, updated_at: r.updated_at,
  }),
  lead_history: (r) => ({
    id: sid('lead_history', r.id),
    lead_id: sid('leads', r.lead_id),
    from_stage_id: r.from_stage_id ? sid('stages', r.from_stage_id) : null,
    to_stage_id: sid('stages', r.to_stage_id),
    changed_at: r.changed_at,
    changed_by: sid('profiles', r.changed_by),
    motivo_perda_id: r.motivo_perda_id ? sid('motivos_perda', r.motivo_perda_id) : null,
  }),
  lead_notes: (r) => ({
    id: sid('lead_notes', r.id),
    lead_id: sid('leads', r.lead_id),
    note: r.note, created_at: r.created_at,
    created_by: sid('profiles', r.created_by),
  }),
  tickets: (r) => ({
    id: sid('tickets', r.id),
    protocolo: r.protocolo, titulo: r.titulo,
    categoria: r.categoria, prioridade: r.prioridade || 'media',
    status: r.status || 'aberto',
    aluno_id: sid('alunos', r.aluno_id),
    aluno_nome: r.aluno_nome, aluno_email: r.aluno_email,
    atendente_id: r.atendente_id ? sid('profiles', r.atendente_id) : null,
    curso_id: r.curso_id ? sid('courses', r.curso_id) : null,
    created_at: r.created_at, updated_at: r.updated_at,
    first_response_at: r.first_response_at || null,
    resolved_at: r.resolved_at || null,
    avaliado: r.avaliado || false,
  }),
  ticket_messages: (r) => ({
    id: sid('ticket_messages', r.id),
    ticket_id: sid('tickets', r.ticket_id),
    autor_id: r.autor_id, autor_nome: r.autor_nome, autor_role: r.autor_role,
    conteudo: r.conteudo, interno: r.interno, created_at: r.created_at,
  }),
  ticket_evaluations: (r) => ({
    id: sid('ticket_evaluations', r.id),
    ticket_id: sid('tickets', r.ticket_id),
    aluno_id: sid('alunos', r.aluno_id),
    csat_nota: r.csat_nota, ces_nota: r.ces_nota,
    fcr_resolvido: r.fcr_resolvido, nps_nota: r.nps_nota,
    comentario: r.comentario, created_at: r.created_at,
  }),
  app_settings: (r) => ({
    id: sid('app_settings', r.id),
    key: r.key, value: r.value,
    created_at: r.created_at, updated_at: r.updated_at,
  }),
  scripts: (r) => ({
    id: sid('scripts', r.id),
    titulo: r.titulo || null, categoria: r.categoria || null,
    curso: r.curso || null, etapa_funil: r.etapa_funil || null,
    conteudo: r.conteudo || null, ativo: r.ativo !== false,
    created_at: r.created_at, updated_at: r.updated_at,
  }),
  knowledge_base: (r) => ({
    id: sid('knowledge_base', r.id),
    title: r.title || null, content: r.content || null,
    type: r.type || null, category: r.category || null,
    created_at: r.created_at, updated_at: r.updated_at,
  }),
  financial_goals: (r) => ({
    id: sid('financial_goals', r.id),
    year: r.year != null ? Number(r.year) : null,
    month: r.month != null ? Number(r.month) : null,
    monthly_target: Number(r.monthly_target) || 0,
    monthly_achieved: Number(r.monthly_achieved) || 0,
    created_at: r.created_at, updated_at: r.updated_at,
  }),
  meta_campaigns: (r) => ({
    id: sid('meta_campaigns', r.campaign_id), campaign_id: r.campaign_id,
    name: r.name, objective: r.objective, status: r.status, updated_at: r.updated_at,
  }),
  meta_campaign_insights_daily: (r) => ({
    id: sid('meta_campaign_insights_daily', r.id), campaign_id: r.campaign_id,
    campaign_name: r.campaign_name, date: r.date,
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0, reach: Number(r.reach) || 0,
    frequency: Number(r.frequency) || 0, ctr: Number(r.ctr) || 0,
    cpm: Number(r.cpm) || 0, leads_count: Number(r.leads_count) || 0,
    actions_raw: r.actions_raw, synced_at: r.synced_at,
  }),
  meta_demographics_daily: (r) => ({
    id: sid('meta_demographics_daily', r.id), date: r.date,
    age_range: r.age_range, gender: r.gender,
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0, leads_count: Number(r.leads_count) || 0,
    synced_at: r.synced_at,
  }),
  google_ads_campaigns: (r) => ({
    id: sid('google_ads_campaigns', r.campaign_id), campaign_id: r.campaign_id,
    campaign_name: r.campaign_name, status: r.status,
    advertising_channel_type: r.advertising_channel_type, synced_at: r.synced_at,
  }),
  google_ads_insights_daily: (r) => ({
    id: sid('google_ads_insights_daily', r.id), campaign_id: r.campaign_id,
    campaign_name: r.campaign_name, date: r.date,
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0, conversions: Number(r.conversions) || 0,
    synced_at: r.synced_at,
  }),
  sponte_matriculas: (r) => ({
    id: sid('sponte_matriculas', r.id || `${r.aluno_id}_${r.data_matricula}`),
    contrato_id: r.contrato_id || null,
    aluno_id: r.aluno_id ? sid('alunos', r.aluno_id) : null,
    aluno: r.aluno || null,
    turma_id: r.turma_id || null,
    nome_turma: r.nome_turma || null,
    nome_curso: r.nome_curso || null,
    curso_id: r.curso_id || null,
    situacao_id: r.situacao_id || null,
    situacao: r.situacao || null,
    data_matricula: r.data_matricula || null,
    data_inicio: r.data_inicio || null,
    data_termino: r.data_termino || null,
    data_encerramento: r.data_encerramento || null,
    contratante: r.contratante || null,
    numero_contrato: r.numero_contrato || null,
    financeiro_lancado: r.financeiro_lancado || null,
    nome_matriz_curricular: r.nome_matriz_curricular || null,
    tipo_contrato_id: r.tipo_contrato_id || null,
    celular: r.celular || null,
    synced_at: r.synced_at || null,
    created_at: r.created_at || null,
  }),
  sponte_parcelas: (r) => ({
    id: sid('sponte_parcelas', r.id),
    aluno: r.aluno, cpf: r.cpf || null, curso: r.curso || null,
    valor: Number(r.valor) || 0, vencimento: r.vencimento || null,
    status: r.status || null, synced_at: r.synced_at,
  }),
  matriculas: (r) => ({
    id: sid('matriculas', r.id), cpf: r.cpf, nome: r.nome,
    email: r.email, telefone: r.telefone, curso: r.curso, turma: r.turma,
    data_matricula: r.data_matricula, created_at: r.created_at, updated_at: r.updated_at,
  }),
  widechat_messages: (r) => ({
    id: sid('widechat_messages', r.id),
    lead_id: r.lead_id ? sid('leads', r.lead_id) : null,
    session_id: r.session_id || null,
    message_id: r.message_id || null,
    type: r.type || null,
    message: r.message || null,
    origin: r.origin || null,
    sender_name: r.sender_name || null,
    raw_data: r.raw_data || null,
    processed_at: r.processed_at || null,
    created_at: r.created_at,
  }),
  widechat_atendimentos: (r) => ({
    id: sid('widechat_atendimentos', r.id),
    lead_id: r.lead_id ? sid('leads', r.lead_id) : null,
    protocol: r.protocol, widechat_agent_id: r.widechat_agent_id,
    session_id: r.session_id, contact_id: r.contact_id,
    aceito_em: r.aceito_em, created_at: r.created_at,
  }),
  messages_logs: (r) => ({
    id: sid('messages_logs', r.id),
    protocol: r.protocol,
    contact: r.contact,
    agent_name: r.agent_name,
    agent_id: r.agent_id,
    timestamp: r.timestamp,
    created_at: r.timestamp,
    message_count: r.message_count,
    closing_attempt: r.closing_attempt,
    status: r.status,
    is_commercial: r.is_commercial,
    overall_conclusion: r.overall_conclusion,
    improvements: r.improvements,
    empathy_score: r.empathy_score,
    clarity_score: r.clarity_score,
    depth_score: r.depth_score,
    commercial_score: r.commercial_score,
    agility_score: r.agility_score,
    final_score: r.final_score,
  }),
};

const PLAN = [
  { table: 'stages',                        columns: 'id,name,order,title_color,bg_color',             orderBy: 'id' },
  { table: 'courses',                       columns: 'id,name,type,default_value',                      orderBy: 'id' },
  { table: 'lead_sources',                  columns: 'id,name,icon,color',                             orderBy: 'id' },
  { table: 'motivos_perda',                 columns: 'id,motivo',                                      orderBy: 'id' },
  { table: 'teams',                         columns: 'id,name,description,color,icon,active,created_at,updated_at', orderBy: 'id' },
  { table: 'profiles',                      columns: 'id,full_name,role,avatar_url,score,updated_at',              orderBy: 'id' },
  { table: 'alunos',                        columns: 'id,cpf,nome,email,created_at,updated_at',        orderBy: 'created_at' },
  { table: 'leads',                         columns: '*',                                               orderBy: 'id' },
  { table: 'lead_history',                  columns: 'id,lead_id,from_stage_id,to_stage_id,changed_at,changed_by,motivo_perda_id', orderBy: 'id' },
  { table: 'lead_notes',                    columns: 'id,lead_id,note,created_at,created_by',          orderBy: 'id' },
  { table: 'app_settings',                  columns: 'id,key,value,created_at,updated_at',                                  orderBy: 'id' },
  { table: 'scripts',                       columns: 'id,titulo,categoria,curso,etapa_funil,conteudo,ativo,created_at,updated_at', orderBy: 'created_at' },
  { table: 'knowledge_base',               columns: 'id,title,content,type,category,created_at,updated_at',                    orderBy: 'created_at' },
  { table: 'financial_goals',               columns: 'id,year,month,monthly_target,monthly_achieved,created_at,updated_at', orderBy: 'id' },
  { table: 'tickets',                       columns: '*',                                               orderBy: 'id' },
  { table: 'ticket_messages',               columns: 'id,ticket_id,autor_id,autor_nome,autor_role,conteudo,interno,created_at', orderBy: 'id' },
  { table: 'ticket_evaluations',            columns: '*',                                               orderBy: 'id' },
  { table: 'meta_campaigns',               columns: '*',                                               orderBy: 'campaign_id' },
  { table: 'meta_campaign_insights_daily', columns: '*',                                               orderBy: 'date' },
  { table: 'meta_demographics_daily',      columns: '*',                                               orderBy: 'date' },
  { table: 'google_ads_campaigns',         columns: '*',                                               orderBy: 'campaign_id' },
  { table: 'google_ads_insights_daily',    columns: '*',                                               orderBy: 'date' },
  { table: 'sponte_matriculas',            columns: '*',                                               orderBy: 'id' },
  { table: 'sponte_parcelas',              columns: '*',                                               orderBy: 'id' },
  { table: 'matriculas',                   columns: '*',                                               orderBy: 'created_at' },
  { table: 'widechat_messages',            columns: 'id,lead_id,session_id,message_id,type,message,origin,sender_name,raw_data,processed_at,created_at', orderBy: 'id' },
  { table: 'widechat_atendimentos',        columns: '*',                                               orderBy: 'aceito_em' },
  { table: 'messages_logs',               columns: '*',                                               orderBy: 'timestamp' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_PASS && !process.env.DATABASE_URL) {
    console.error('\x1b[31mERRO:\x1b[0m Defina SUPABASE_DB_PASSWORD (ou DATABASE_URL) no ambiente.');
    console.error('  Senha disponível em: Supabase Dashboard → Settings → Database → Database password');
    process.exit(1);
  }

  log('Autenticando no SurrealDB...');
  await surrealSignin();
  const r = await surrealSQL('RETURN 42');
  log(`✓ SurrealDB conectado como ${SURREAL_USER}`);

  const pgClient = await connectPg();

  const results = [];
  const onlyTable = process.argv[2];
  // --start-after <value>: skip records with orderBy <= value (for resuming interrupted syncs)
  const startAfterIdx = process.argv.indexOf('--start-after');
  const startAfterVal = startAfterIdx !== -1 ? process.argv[startAfterIdx + 1] : null;
  // --max-id <value>: stop processing when orderBy > value (for gap-fill scans)
  const maxIdIdx = process.argv.indexOf('--max-id');
  const maxIdVal = maxIdIdx !== -1 ? process.argv[maxIdIdx + 1] : null;
  const plan = onlyTable ? PLAN.filter(p => p.table === onlyTable) : PLAN;

  for (const { table, columns, orderBy } of plan) {
    const transform = T[table];
    if (!transform) {
      warn(`Sem transformer para '${table}' — pulando`);
      continue;
    }

    try {
      log(`\n── ${table}`);
      const initialCursor = startAfterVal != null ? (isNaN(startAfterVal) ? startAfterVal : Number(startAfterVal)) : null;
      const maxVal = maxIdVal != null ? (isNaN(maxIdVal) ? maxIdVal : Number(maxIdVal)) : null;
      const { total, inserted } = await streamProcess(pgClient, table, columns, orderBy, transform, initialCursor, maxVal);
      log(`   \x1b[32m${inserted}/${total}\x1b[0m inseridos`);
      results.push({ table, total, inserted, ok: true });
    } catch (err) {
      warn(`Falha em ${table}: ${err.message}`);
      results.push({ table, ok: false, error: err.message });
    }
  }

  await pgClient.end();

  console.log('\n\x1b[1m══════════════ RELATÓRIO ══════════════\x1b[0m');
  let totalOk = 0, totalErr = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  \x1b[32m✓\x1b[0m ${r.table.padEnd(38)} ${r.inserted}/${r.total}`);
      totalOk++;
    } else {
      console.log(`  \x1b[31m✗\x1b[0m ${r.table.padEnd(38)} ERRO: ${r.error}`);
      totalErr++;
    }
  }
  console.log(`\n  Total: ${totalOk} ok, ${totalErr} erros`);
}

main().catch((err) => {
  console.error('\x1b[31mErro fatal:\x1b[0m', err.message);
  process.exit(1);
});
