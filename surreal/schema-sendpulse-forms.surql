-- ============================================================================
-- sendpulse_forms — mapa addressbook do SendPulse -> curso/fonte
-- Usado por supabase/functions/sync-sendpulse-forms (polling a cada 3 min).
-- Aplicar: node surreal/apply-sendpulse-forms.js
-- ============================================================================

DEFINE TABLE sendpulse_forms SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD book_id       ON sendpulse_forms TYPE int;          -- id da addressbook no SendPulse
DEFINE FIELD form_name     ON sendpulse_forms TYPE string;        -- só referência humana (pode mudar no SendPulse)
DEFINE FIELD course_id     ON sendpulse_forms TYPE option<int>;   -- id do curso (courses)
DEFINE FIELD source_id     ON sendpulse_forms TYPE option<int>;   -- id da fonte (lead_sources): 1=Site, 3=Meta Ads
DEFINE FIELD ativo         ON sendpulse_forms TYPE bool DEFAULT true;
DEFINE FIELD last_add_date ON sendpulse_forms TYPE option<string>; -- watermark: add_date (string SendPulse) do último inscrito já importado
DEFINE FIELD updated_at    ON sendpulse_forms TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sendpulse_forms_book ON sendpulse_forms FIELDS book_id UNIQUE;

-- Índice de email em leads — necessário para o dedup do poller rodar rápido
-- (sem ele, WHERE email = X faz full scan de 800k linhas). CONCURRENTLY = build
-- em background, não trava a instância.
DEFINE INDEX idx_leads_email ON leads FIELDS email CONCURRENTLY;

-- ── Seed dos 23 formulários (courses: 4=Direito 5=Teo Presencial 8=Teo EAD
--    9=Educ Cristã Clássica 10=Teo Bíblica NT 11=Liderança Cristã 12=Formação
--    Política 13=Missiologia Urbana 14=Teo Sistemática 15=Gestão Escolar
--    16=Psicopedagogia 17=Psicoteologia 19=História do Cristianismo) ──────────
INSERT INTO sendpulse_forms [
  { id: 599948, book_id: 599948, form_name: "[O] POS PT",          course_id: 17, source_id: 1 },
  { id: 599945, book_id: 599945, form_name: "[A] POS PT",          course_id: 17, source_id: 3 },
  { id: 599954, book_id: 599954, form_name: "[O] POS ECC",         course_id: 9,  source_id: 1 },
  { id: 599944, book_id: 599944, form_name: "[A] POS ECC",         course_id: 9,  source_id: 3 },
  { id: 599953, book_id: 599953, form_name: "[O] POS TNT",         course_id: 10, source_id: 1 },
  { id: 599941, book_id: 599941, form_name: "[A] POS TNT",         course_id: 10, source_id: 3 },
  { id: 599950, book_id: 599950, form_name: "[O] POS TS",          course_id: 14, source_id: 1 },
  { id: 599943, book_id: 599943, form_name: "[A] POS TS",          course_id: 14, source_id: 3 },
  { id: 587426, book_id: 587426, form_name: "[O] POS HC",          course_id: 19, source_id: 1 },
  { id: 599955, book_id: 599955, form_name: "[O] POS LC",          course_id: 11, source_id: 1 },
  { id: 599940, book_id: 599940, form_name: "[A] POS LC",          course_id: 11, source_id: 3 },
  { id: 599949, book_id: 599949, form_name: "[O] POS GE",          course_id: 15, source_id: 1 },
  { id: 599942, book_id: 599942, form_name: "[A] POS GE",          course_id: 15, source_id: 3 },
  { id: 599951, book_id: 599951, form_name: "[O] POS MU",          course_id: 13, source_id: 1 },
  { id: 599939, book_id: 599939, form_name: "[O] POS PP",          course_id: 16, source_id: 1 },
  { id: 599938, book_id: 599938, form_name: "[A] POS PP",          course_id: 16, source_id: 3 },
  { id: 599952, book_id: 599952, form_name: "[O] POS FP",          course_id: 12, source_id: 1 },
  { id: 599937, book_id: 599937, form_name: "[A] POS FP",          course_id: 12, source_id: 3 },
  { id: 599959, book_id: 599959, form_name: "[O] TEO PRES 2026.1", course_id: 5,  source_id: 1 },
  { id: 599958, book_id: 599958, form_name: "[O] DIR 2026.1",      course_id: 4,  source_id: 1 },
  { id: 599956, book_id: 599956, form_name: "[A] DIR 2026.1",      course_id: 4,  source_id: 3 },
  { id: 599960, book_id: 599960, form_name: "[O] TEO EAD 2026.1",  course_id: 8,  source_id: 1 },
  { id: 599957, book_id: 599957, form_name: "[A] TEO EAD 2026.1",  course_id: 8,  source_id: 3 }
] ON DUPLICATE KEY UPDATE
  form_name = $input.form_name, course_id = $input.course_id,
  source_id = $input.source_id, updated_at = time::now();
