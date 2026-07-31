#!/usr/bin/env node
/**
 * sync-supabase-to-surreal.js
 * Migração inicial: lê dados do Supabase e insere no SurrealDB Cloud via REST API.
 * Usa fetch nativo (Node.js 18+) — sem dependências extras.
 *
 * Uso:
 *   SURREAL_TOKEN=<jwt> SUPABASE_SERVICE_KEY=<key> node surreal/sync-supabase-to-surreal.js
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────────────
const SURREAL_ENDPOINT = process.env.SURREAL_ENDPOINT
  || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS    = process.env.SURREAL_NS || 'ficv';
const SURREAL_DB    = process.env.SURREAL_DB || 'salespulse';
const SURREAL_TOKEN = process.env.SURREAL_TOKEN; // JWT do dashboard

const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://znypfroagfwohqeyxyqv.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY; // service role key

const BATCH = 500;

// ── SurrealDB REST client ─────────────────────────────────────────────────────
// /sql aceita plain text SurrealQL (sem vars). Para INSERTs com dados,
// serializa os dados diretamente no SQL usando JSON embutido.

const SURREAL_HEADERS = () => ({
  'Content-Type':  'text/plain',
  'Accept':        'application/json',
  'Authorization': `Bearer ${SURREAL_TOKEN}`,
  'surreal-ns':    SURREAL_NS,
  'surreal-db':    SURREAL_DB,
});

async function surrealSQL(sql) {
  if (!SURREAL_TOKEN) throw new Error('SURREAL_TOKEN não definido');
  const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
    method: 'POST',
    headers: SURREAL_HEADERS(),
    body: sql,
  });
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

// Serializa valor JS para literal SurrealQL inline
function toSurrealLiteral(v) {
  if (v === null || v === undefined) return 'NONE';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // record ID: deixa como está (table:id)
    if (/^[a-z_]+:[^\s,;]+$/.test(v)) return v;
    // datetime ISO — converte para d"..."
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `d"${v}"`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `d"${v}T00:00:00Z"`;
    // string normal
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
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
    // Serializa cada row como objeto literal SurrealQL
    const literals = chunk.map(r => toSurrealLiteral(r)).join(',\n  ');
    const sql = `INSERT INTO ${table} [\n  ${literals}\n] RETURN NONE`;
    try {
      await surrealSQL(sql);
      inserted += chunk.length;
    } catch (e) {
      warn(`Erro ao inserir em ${table} (chunk ${i}): ${e.message.slice(0, 200)}`);
    }
    await sleep(30);
  }
  return inserted;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const log  = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function paginate(supabase, table, columns = '*', orderBy = 'id') {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) {
      warn(`Supabase ${table}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return rows;
}

function sid(table, id) {
  // Gera record ID compatível com SurrealDB: table:id
  if (id == null) return null;
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${table}:⟨${safe}⟩`; // usando ⟨⟩ para IDs arbitrários
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
    id: sid('profiles', r.id), email: r.email,
    full_name: r.full_name || r.name || '',
    role: r.role || 'agent', avatar_url: r.avatar_url || null,
    active: r.active !== false, created_at: r.created_at, updated_at: r.updated_at,
    password: null, // senha não migra — usuário reseta pelo novo auth
  }),
  alunos: (r) => ({
    id: sid('alunos', r.id), cpf: r.cpf, nome: r.nome,
    email: r.email, password: null,
    created_at: r.created_at, updated_at: r.updated_at,
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
    attachments: r.attachments || null,
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
  financial_goals: (r) => ({
    id: sid('financial_goals', r.id),
    month: r.month, goal_value: Number(r.goal_value) || 0, created_at: r.created_at,
  }),
  partners: (r) => ({
    id: sid('partners', r.id), name: r.name, slug: r.slug, type: r.type,
    target_url: r.target_url, social_media_url: r.social_media_url,
    coupon: r.coupon, active: r.active !== false,
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
    id: sid('sponte_matriculas', r.id || `${r.aluno}_${r.data_matricula}`),
    aluno: r.aluno, cpf: r.cpf || null, celular: r.celular || null,
    nome_curso: r.nome_curso, nome_turma: r.nome_turma || null,
    situacao: r.situacao || null, data_matricula: r.data_matricula, synced_at: r.synced_at,
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
    origin: r.origin, sender_name: r.sender_name || null,
    content: r.content || null,
    session_id: r.session_id || null, contact_id: r.contact_id || null,
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
    contact: r.contact, agent_name: r.agent_name,
    timestamp: r.timestamp, created_at: r.timestamp,
  }),
};

// ── Plano de migração (ordem: sem FK primeiro) ────────────────────────────────

const PLAN = [
  { table: 'stages',                        columns: 'id,name,order,title_color,bg_color',             orderBy: 'id' },
  { table: 'courses',                       columns: 'id,name,type,default_value',                      orderBy: 'id' },
  { table: 'lead_sources',                  columns: 'id,name,icon,color',                             orderBy: 'id' },
  { table: 'motivos_perda',                 columns: 'id,motivo',                                      orderBy: 'id' },
  { table: 'teams',                         columns: 'id,name,description,color,icon,active,created_at,updated_at', orderBy: 'id' },
  { table: 'profiles',                      columns: 'id,email,full_name,role,avatar_url,created_at,updated_at',    orderBy: 'created_at' },
  { table: 'alunos',                        columns: 'id,cpf,nome,email,created_at,updated_at',        orderBy: 'created_at' },
  { table: 'leads',                         columns: '*',                                               orderBy: 'id' },
  { table: 'lead_history',                  columns: 'id,lead_id,from_stage_id,to_stage_id,changed_at,changed_by,motivo_perda_id', orderBy: 'id' },
  { table: 'lead_notes',                    columns: 'id,lead_id,note,created_at,created_by',          orderBy: 'id' },
  { table: 'financial_goals',               columns: 'id,month,goal_value,created_at',                 orderBy: 'id' },
  { table: 'partners',                      columns: '*',                                               orderBy: 'created_at' },
  { table: 'tickets',                       columns: '*',                                               orderBy: 'id' },
  { table: 'ticket_messages',               columns: 'id,ticket_id,autor_id,autor_nome,autor_role,conteudo,interno,created_at', orderBy: 'id' },
  { table: 'ticket_evaluations',            columns: '*',                                               orderBy: 'id' },
  { table: 'meta_campaigns',                columns: '*',                                               orderBy: 'campaign_id' },
  { table: 'meta_campaign_insights_daily',  columns: '*',                                               orderBy: 'date' },
  { table: 'meta_demographics_daily',       columns: '*',                                               orderBy: 'date' },
  { table: 'google_ads_campaigns',          columns: '*',                                               orderBy: 'campaign_id' },
  { table: 'google_ads_insights_daily',     columns: '*',                                               orderBy: 'date' },
  { table: 'sponte_matriculas',             columns: '*',                                               orderBy: 'data_matricula' },
  { table: 'sponte_parcelas',               columns: '*',                                               orderBy: 'id' },
  { table: 'matriculas',                    columns: '*',                                               orderBy: 'created_at' },
  { table: 'widechat_messages',             columns: 'id,lead_id,origin,sender_name,content,session_id,contact_id,created_at', orderBy: 'created_at' },
  { table: 'widechat_atendimentos',         columns: '*',                                               orderBy: 'aceito_em' },
  { table: 'messages_logs',                 columns: 'id,contact,agent_name,timestamp',                orderBy: 'timestamp' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function testSurrealConnection() {
  log('Testando conexão SurrealDB...');
  const res = await surrealSQL('RETURN 42');
  log(`  ✓ Conectado — resultado: ${JSON.stringify(res[0]?.result)}`);
}

async function main() {
  if (!SUPABASE_KEY) {
    console.error('\x1b[31mERRO:\x1b[0m Defina SUPABASE_SERVICE_KEY no ambiente');
    process.exit(1);
  }
  if (!SURREAL_TOKEN) {
    console.error('\x1b[31mERRO:\x1b[0m Defina SURREAL_TOKEN no ambiente (JWT do dashboard SurrealDB Cloud)');
    process.exit(1);
  }

  await testSurrealConnection();

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  log('Supabase client inicializado');

  const results = [];

  // Argumento opcional: migrar só uma tabela (para testes)
  const onlyTable = process.argv[2];
  const plan = onlyTable ? PLAN.filter(p => p.table === onlyTable) : PLAN;

  for (const { table, columns, orderBy } of plan) {
    const transform = T[table];
    if (!transform) {
      warn(`Sem transformer para '${table}' — pulando`);
      continue;
    }

    try {
      log(`\n── ${table}`);
      const rows = await paginate(supabase, table, columns, orderBy);
      log(`   Supabase: ${rows.length} registros`);

      const transformed = rows.map(transform);
      const inserted = await surrealInsert(table, transformed);
      log(`   SurrealDB: \x1b[32m${inserted}\x1b[0m inseridos`);
      results.push({ table, total: rows.length, inserted, ok: true });
    } catch (err) {
      warn(`Falha em ${table}: ${err.message}`);
      results.push({ table, ok: false, error: err.message });
    }
  }

  // Relatório final
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
