// Importa cursos, seções e aulas do Moodle para as tabelas ava_* (idempotente: pode rodar de novo).
// Uso: node scripts/ava-import-moodle.mjs [regex-do-nome-do-curso] [--limite=N]
// Padrão: cursos EAD de 2026. Vídeos: iframes do Vimeo dentro de rótulos (mesmos IDs do Moodle).
// Lê MOODLE_URL/MOODLE_TOKEN do Vault via RPC integ_get_secret; nunca imprime segredo.
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '').trim()]
}))
const REF = 'jsswkmybkgoxpncnxgdd'
const filtro = new RegExp(process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) ?? 'EAD - 2026\\.', 'i')
const limite = Number((process.argv.find(a => a.startsWith('--limite=')) ?? '').split('=')[1]) || Infinity

async function tentar(fn, n = 5) {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 1500 * i)) }
  }
}
async function sql(q) { return tentar(() => sql1(q)) }
async function sql1(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }),
  })
  const d = await r.json()
  if (!Array.isArray(d)) throw new Error('SQL: ' + JSON.stringify(d).slice(0, 300))
  return d
}
const lit = v => v == null ? 'null' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"

const [{ u, t }] = await sql("select integ_get_secret('MOODLE_URL') u, integ_get_secret('MOODLE_TOKEN') t")
let base = u.replace(/\/+$/, ''); if (!/webservice/.test(base)) base += '/webservice/rest/server.php'
async function moodle(fn, p = {}) {
  const qs = new URLSearchParams({ wstoken: t, wsfunction: fn, moodlewsrestformat: 'json' })
  for (const [k, v] of Object.entries(p)) qs.set(k, String(v))
  return tentar(async () => (await fetch(base, { method: 'POST', body: qs })).json())
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
const texto = html => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
const oembedCache = new Map()
async function oembed(id, hash) {
  if (oembedCache.has(id)) return oembedCache.get(id)
  let out = null
  try {
    const url = `https://player.vimeo.com/video/${id}` + (hash ? `?h=${hash}` : '')
    const r = await fetch('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(url))
    if (r.ok) { const d = await r.json(); out = { titulo: d.title, thumb: d.thumbnail_url, dur: d.duration } }
  } catch { /* segue sem metadados */ }
  oembedCache.set(id, out); return out
}

function partirCurso(full) {
  const partes = full.split(/\s+-\s+/).map(s => s.trim())
  const per = partes.find(p => /^(P\d+|MODULAR|CICLO\b.*)$/i.test(p)) ?? null
  const sem = partes.find(p => /^20\d\d\.\d$/.test(p)) ?? null
  const area = (partes[0] ?? '').replace(/\bEAD\b/i, '').trim() || null
  const iPer = per ? partes.indexOf(per) : -1
  const resto = iPer >= 0 ? partes.slice(iPer + 1) : partes.slice(-1)
  const disc = (resto.join(' - ').replace(/\s*-?\s*PROF[ªA.]?.*$/i, '').trim()) || full
  return { per, sem, area, disc }
}
const cap = s => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E|Em|Na|No|A|O)\b/g, m => m.toLowerCase())

const todos = await moodle('core_course_get_courses')
const soNovos = process.argv.includes('--novos')
const jaTem = soNovos ? new Set((await sql('select moodle_id from ava_cursos where exists (select 1 from ava_aulas a where a.curso_id = ava_cursos.id)')).map(r => Number(r.moodle_id))) : new Set()
const idsArg = (process.argv.find(a => a.startsWith('--ids=')) ?? '').split('=')[1]
const soIds = idsArg ? new Set(idsArg.split(',').map(Number)) : null
const cursos = todos.filter(c => (soIds ? soIds.has(c.id) : filtro.test(c.fullname)) && c.visible !== 0 && !jaTem.has(c.id)).slice(0, limite)
console.log(`${cursos.length} cursos a importar (filtro ${filtro})`)

let nAulas = 0, nVideos = 0
for (const c of cursos) {
  try {
  const { per, sem, area, disc } = partirCurso(c.fullname)
  const prof = (c.fullname.match(/PROF[ªA.]*\s*(.+)$/i) ?? [])[1] ?? null
  const [{ id: cursoId }] = await sql(`
    insert into ava_cursos (moodle_id, nome, titulo, curso_area, periodo, semestre, professor, descricao, atualizado_em)
    values (${c.id}, ${lit(c.fullname)}, ${lit(cap(disc))}, ${lit(area)}, ${lit(per)}, ${lit(sem)}, ${lit(prof)}, ${lit(texto(c.summary ?? '').slice(0, 1500) || null)}, now())
    on conflict (moodle_id) do update set nome=excluded.nome, titulo=excluded.titulo, curso_area=excluded.curso_area, periodo=excluded.periodo,
      semestre=excluded.semestre, professor=coalesce(excluded.professor, ava_cursos.professor), atualizado_em=now()
    where ava_cursos.editado = false
    returning id`)
  const conteudo = await moodle('core_course_get_contents', { courseid: c.id })
  if (!Array.isArray(conteudo)) { console.log('  falhou', c.id, JSON.stringify(conteudo).slice(0, 120)); continue }
  let ordem = 0, ordemSecao = 0
  for (const s of conteudo) {
    if (s.visible === 0) continue
    const mods = (s.modules ?? []).filter(m => m.visible !== 0 && m.uservisible !== false)
    const aulas = []
    for (const m of mods) {
      if (m.modname === 'label') {
        const html = m.description ?? ''
        const videos = [...html.matchAll(/player\.vimeo\.com\/video\/(\d+)(?:\?h=([0-9a-f]+))?/gi)]
        const vistos = new Set()
        let sub = 0
        for (const v of videos) {
          if (vistos.has(v[1])) continue; vistos.add(v[1])
          const meta = await oembed(v[1], v[2])
          aulas.push({ moodle: m.id, sub: sub++, tipo: 'video', titulo: meta?.titulo ?? `Aula ${aulas.filter(a => a.tipo === 'video').length + 1}`, video_id: v[1], video_hash: v[2] ?? null, thumb: meta?.thumb ?? null, dur: meta?.dur ?? null })
          nVideos++
        }
        const txt = texto(html.replace(/<iframe[\s\S]*?<\/iframe>/gi, ' '))
        if (txt.length > 25) aulas.push({ moodle: m.id, sub: 99, tipo: 'texto', titulo: txt.split('\n')[0].slice(0, 90), descricao: txt.slice(0, 4000) })
      } else if (m.modname === 'resource') {
        aulas.push({ moodle: m.id, sub: 0, tipo: 'material', titulo: m.name, url: m.url ?? null })
      } else if (m.modname === 'url') {
        aulas.push({ moodle: m.id, sub: 0, tipo: 'link', titulo: m.name, url: (m.contents?.[0]?.fileurl) ?? m.url ?? null })
      } else if (m.modname === 'quiz') {
        aulas.push({ moodle: m.id, sub: 0, tipo: 'quiz', titulo: m.name, url: m.url ?? null })
      }
    }
    if (!aulas.length) continue
    const [{ id: secaoId }] = await sql(`
      insert into ava_secoes (curso_id, moodle_id, nome, ordem) values (${cursoId}, ${s.id}, ${lit((s.name ?? '').trim() || 'Conteúdo')}, ${ordemSecao++})
      on conflict (curso_id, moodle_id) do update set nome=excluded.nome, ordem=excluded.ordem where ava_secoes.editado = false returning id`)
    const valores = aulas.map(a => `(${cursoId}, ${secaoId}, ${a.moodle}, ${a.sub}, ${lit(a.tipo)}, ${lit(a.titulo)}, ${lit(a.video_id)}, ${lit(a.video_hash)}, ${lit(a.thumb)}, ${a.dur ?? 'null'}, ${lit(a.url)}, ${lit(a.descricao)}, ${ordem++})`)
    await sql(`insert into ava_aulas (curso_id, secao_id, moodle_id, sub, tipo, titulo, video_id, video_hash, thumb_url, duracao_seg, url, descricao, ordem) values ${valores.join(',')}
      on conflict (curso_id, moodle_id, sub) do update set secao_id=excluded.secao_id, tipo=excluded.tipo, titulo=excluded.titulo, video_id=excluded.video_id,
      video_hash=excluded.video_hash, thumb_url=excluded.thumb_url, duracao_seg=excluded.duracao_seg, url=excluded.url, descricao=excluded.descricao, ordem=excluded.ordem
      where ava_aulas.editado = false`)
    nAulas += aulas.length
  }
  console.log(`  ${c.fullname.slice(0, 70)} → ${nAulas} aulas acumuladas`)
  } catch (e) { console.log('  ERRO', c.id, String(e).slice(0, 100)) }
}
console.log(`Pronto: ${nAulas} itens, ${nVideos} vídeos.`)
