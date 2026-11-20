// Preenche ava_cursos.professor com o(s) professor(es) titular(es) (editingteacher) de cada curso do Moodle.
// Sem professor no Moodle (pós), usa o que a equipe preencheu à mão na CPA (cpa_docentes). Idempotente.
// Uso: node scripts/ava-professores.mjs
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '').trim()]
}))
const REF = 'jsswkmybkgoxpncnxgdd'
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
  const d = await r.json(); if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 300)); return d
}
const lit = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'"
const [{ u, t }] = await sql("select integ_get_secret('MOODLE_URL') u, integ_get_secret('MOODLE_TOKEN') t")
let base = u.replace(/\/+$/, ''); if (!/webservice/.test(base)) base += '/webservice/rest/server.php'
async function moodle(fn, p = {}) {
  const qs = new URLSearchParams({ wstoken: t, wsfunction: fn, moodlewsrestformat: 'json' }); for (const [k, v] of Object.entries(p)) qs.set(k, String(v))
  return (await fetch(base, { method: 'POST', body: qs })).json()
}
const nome = s => s.replace(/^\s*prof(?:essor)?[a-zªº.]*\s+/i, '').trim().toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, m => m.toLowerCase())

const cursos = await sql('select id, moodle_id from ava_cursos order by id')
const manual = Object.fromEntries((await sql("select moodle_course_id m, docente from cpa_docentes where docente is not null and moodle_course_id is not null")).map(r => [r.m, r.docente]))
let com = 0, sem = 0
for (const c of cursos) {
  let nomes = []
  try {
    const us = await moodle('core_enrol_get_enrolled_users', { courseid: c.moodle_id })
    nomes = [...new Set((Array.isArray(us) ? us : []).filter(x => (x.roles ?? []).some(r => r.shortname === 'editingteacher')).map(x => nome(String(x.fullname))))]
  } catch { /* segue para o fallback */ }
  if (nomes.length > 4) nomes = [] // TCC: banca inteira, não é "o professor"
  const prof = nomes.length ? nomes.join(' / ') : (manual[c.moodle_id] ? String(manual[c.moodle_id]).split(' / ').map(nome).join(' / ') : null)
  await sql(`update ava_cursos set professor = ${lit(prof)} where id = ${c.id}`)
  prof ? com++ : sem++
}
console.log(`professor preenchido em ${com} de ${cursos.length} cursos (${sem} sem professor)`)
