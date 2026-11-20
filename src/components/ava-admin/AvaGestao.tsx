/**
 * Gestão do AVA (menu "AVA"): disciplinas e conteúdo, dúvidas dos alunos, avisos e acesso ao ambiente em teste.
 * Admin e coordenação veem tudo; professor só as disciplinas vinculadas; tutor só as dúvidas.
 * Tudo passa pela edge function ava-gestao (que confere o papel).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, GraduationCap, Loader2, Megaphone, MessageCircleQuestion, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { showError, showSuccess } from '@/utils/toast'
import { Btn, CAMPO, Inp } from '../cpa/cpaUi'
import { gestaoCall, type AvisoAdmin, type CursoLinha, type Duvida, type Eu } from './gestaoApi'
import { DisciplinaEditor } from './DisciplinaEditor'
import { Modal, Rot, haQuanto } from './ui'

type Aba = 'disciplinas' | 'duvidas' | 'avisos' | 'acesso'

export function AvaGestao() {
  const eu = useQuery({ queryKey: ['ava-gestao-eu'], queryFn: () => gestaoCall<Eu>('eu') })
  const [aba, setAba] = useState<Aba | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  if (eu.isLoading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
  if (eu.isError || !eu.data) return <p className="p-8 text-sm text-[var(--danger)]">{(eu.error as Error)?.message ?? 'Sem acesso.'}</p>
  const e = eu.data
  const abas: [Aba, string, typeof BookOpen][] = [
    ...(!e.tutor ? [['disciplinas', 'Disciplinas', BookOpen] as [Aba, string, typeof BookOpen]] : []),
    ['duvidas', 'Dúvidas dos alunos', MessageCircleQuestion],
    ...(!e.tutor ? [['avisos', 'Avisos', Megaphone] as [Aba, string, typeof BookOpen]] : []),
    ...(e.admin ? [['acesso', 'Acesso (teste)', ShieldCheck] as [Aba, string, typeof BookOpen]] : []),
  ]
  const atual = aba ?? abas[0][0]

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-primary"><GraduationCap size={14} /><span className="text-[10px] font-bold uppercase tracking-widest">Ambiente de Estudos (AVA)</span></div>
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Gestão do AVA</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          {e.professor ? 'Gerencie o conteúdo das suas disciplinas, publique avisos e responda as dúvidas dos alunos.' : e.tutor ? 'Responda as dúvidas dos alunos nas disciplinas.' : 'Disciplinas, conteúdo, dúvidas, avisos e quem tem acesso ao novo ambiente de estudos.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {abas.map(([k, t, I]) => (
          <button key={k} onClick={() => { setAba(k); setAberta(null) }} className="px-4 py-2.5 -mb-px border-b-2 text-sm font-medium flex items-center gap-2"
            style={atual === k ? { borderColor: 'var(--primary)', color: 'var(--text-main)' } : { borderColor: 'transparent', color: 'var(--text-muted)' }}><I size={15} />{t}</button>
        ))}
      </div>
      {atual === 'disciplinas' && (aberta ? <DisciplinaEditor cursoId={aberta} eu={e} onVoltar={() => setAberta(null)} /> : <Disciplinas onAbrir={setAberta} />)}
      {atual === 'duvidas' && <Duvidas />}
      {atual === 'avisos' && <Avisos eu={e} />}
      {atual === 'acesso' && e.admin && <Acesso />}
    </div>
  )
}

// ── Disciplinas ──────────────────────────────────────────────
function Disciplinas({ onAbrir }: { onAbrir: (id: number) => void }) {
  const q = useQuery({ queryKey: ['ava-gestao-cursos'], queryFn: () => gestaoCall<{ cursos: CursoLinha[] }>('cursos_listar') })
  const [busca, setBusca] = useState('')
  const [semestre, setSemestre] = useState('todos')
  const [situacao, setSituacao] = useState<'todas' | 'publicada' | 'rascunho' | 'duvidas'>('todas')
  const cursos = q.data?.cursos ?? []
  const semestres = useMemo(() => [...new Set(cursos.map(c => c.semestre).filter(Boolean) as string[])].sort().reverse(), [cursos])
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const lista = cursos.filter(c =>
    (!busca || norm(`${c.titulo} ${c.professor ?? ''} ${c.curso_area ?? ''}`).includes(norm(busca))) &&
    (semestre === 'todos' || c.semestre === semestre) &&
    (situacao === 'todas' || (situacao === 'publicada' ? c.publicado : situacao === 'rascunho' ? !c.publicado : c.abertas > 0)))
  if (q.isLoading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
  if (!cursos.length) return <p className="py-16 text-center text-sm text-[var(--text-muted)]">Nenhuma disciplina disponível para você. Peça à coordenação para vincular suas disciplinas.</p>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /><Inp placeholder="Buscar disciplina ou professor" value={busca} onChange={e => setBusca(e.target.value)} className="!pl-9" /></div>
        <select value={semestre} onChange={e => setSemestre(e.target.value)} className={`${CAMPO} !w-auto`}><option value="todos">Todos os semestres</option>{semestres.map(s => <option key={s}>{s}</option>)}</select>
        <select value={situacao} onChange={e => setSituacao(e.target.value as typeof situacao)} className={`${CAMPO} !w-auto`}><option value="todas">Todas</option><option value="publicada">Publicadas</option><option value="rascunho">Rascunhos</option><option value="duvidas">Com dúvidas abertas</option></select>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{lista.length} {lista.length === 1 ? 'disciplina' : 'disciplinas'}</p>
      <div className="glass-card divide-y divide-[var(--border)] overflow-hidden">
        {lista.map(c => (
          <button key={c.id} onClick={() => onAbrir(c.id)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-card-hover)]">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{c.titulo}</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{[c.curso_area, c.periodo, c.semestre].filter(Boolean).join(' · ')}{c.professor ? ` · Prof. ${c.professor}` : ' · sem professor'}</p>
            </div>
            <span className="text-xs text-[var(--text-muted)] hidden sm:block">{c.videos} vídeos</span>
            {c.abertas > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">{c.abertas} {c.abertas === 1 ? 'dúvida' : 'dúvidas'}</span>}
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={c.publicado ? { background: 'rgba(35,134,54,.15)', color: 'var(--success-text)' } : { background: 'rgba(180,83,9,.15)', color: 'var(--warning)' }}>{c.publicado ? 'Publicada' : 'Rascunho'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Dúvidas ──────────────────────────────────────────────────
function Duvidas() {
  const qc = useQueryClient()
  const [filtro, setFiltro] = useState<'abertas' | 'todas'>('abertas')
  const q = useQuery({ queryKey: ['ava-gestao-duvidas', filtro], queryFn: () => gestaoCall<{ perguntas: Duvida[] }>('duvidas_listar', { filtro }) })
  const [aberta, setAberta] = useState<number | null>(null)
  const [texto, setTexto] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ava-gestao-duvidas'] }); qc.invalidateQueries({ queryKey: ['ava-gestao-cursos'] }) }
  const responder = useMutation({
    mutationFn: ({ id, resolver }: { id: number; resolver: boolean }) => gestaoCall('resposta_criar', { pergunta_id: id, texto, resolver }),
    onSuccess: () => { setTexto(''); showSuccess('Resposta enviada.'); refresh() }, onError: (e) => showError((e as Error).message),
  })
  const resolver = useMutation({ mutationFn: ({ id, v }: { id: number; v: boolean }) => gestaoCall('pergunta_resolver', { id, resolvida: v }), onSuccess: refresh, onError: (e) => showError((e as Error).message) })
  const lista = q.data?.perguntas ?? []
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{(['abertas', 'todas'] as const).map(f => <button key={f} onClick={() => setFiltro(f)} className="text-xs rounded-full px-3.5 py-1.5 border" style={filtro === f ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>{f === 'abertas' ? 'Aguardando resposta' : 'Todas'}</button>)}</div>
      {q.isLoading ? <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-primary" /></div> : lista.length === 0 ? <p className="py-12 text-center text-sm text-[var(--text-muted)]">{filtro === 'abertas' ? 'Nenhuma dúvida aguardando resposta. 🎉' : 'Nenhuma dúvida ainda.'}</p> : lista.map(p => (
        <div key={p.id} className="glass-card overflow-hidden">
          <button onClick={() => { setAberta(aberta === p.id ? null : p.id); setTexto('') }} className="w-full text-left p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0"><p className="font-semibold">{p.titulo}</p><p className="text-xs text-[var(--text-muted)] mt-0.5">{p.autor_nome} · {p.curso_titulo} · {haQuanto(p.criado_em)}</p></div>
              {p.resolvida ? <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(35,134,54,.15)', color: 'var(--success-text)' }}>Resolvida</span> : p.respondida ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">Respondida</span> : <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(180,83,9,.15)', color: 'var(--warning)' }}>Aguardando</span>}
            </div>
          </button>
          {aberta === p.id && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)] pt-3">
              <p className="text-sm whitespace-pre-line">{p.texto}</p>
              {p.respostas.map(r => <div key={r.id} className="rounded-lg p-3 text-sm bg-[var(--bg-card-hover)]"><p className="text-xs text-[var(--text-muted)] mb-1"><b className="text-[var(--text-main)]">{r.autor_nome}</b> {r.autor_tipo !== 'aluno' && <span className="uppercase text-primary">· {r.autor_tipo}</span>} · {haQuanto(r.criado_em)}</p><p className="whitespace-pre-line">{r.texto}</p></div>)}
              <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Escreva a resposta" className={CAMPO} />
              <div className="flex flex-wrap gap-2 justify-end">
                {!p.resolvida && p.respostas.length > 0 && <Btn variant="outline" size="sm" onClick={() => resolver.mutate({ id: p.id, v: true })}>Marcar como resolvida</Btn>}
                {p.resolvida && <Btn variant="outline" size="sm" onClick={() => resolver.mutate({ id: p.id, v: false })}>Reabrir</Btn>}
                <Btn variant="outline" size="sm" disabled={!texto.trim() || responder.isPending} onClick={() => responder.mutate({ id: p.id, resolver: false })}>Responder</Btn>
                <Btn size="sm" disabled={!texto.trim() || responder.isPending} onClick={() => responder.mutate({ id: p.id, resolver: true })}>Responder e resolver</Btn>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Avisos ───────────────────────────────────────────────────
function Avisos({ eu }: { eu: Eu }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ava-gestao-avisos'], queryFn: () => gestaoCall<{ avisos: AvisoAdmin[] }>('avisos_listar') })
  const cursos = useQuery({ queryKey: ['ava-gestao-cursos'], queryFn: () => gestaoCall<{ cursos: CursoLinha[] }>('cursos_listar') })
  const [edit, setEdit] = useState<Partial<AvisoAdmin> | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['ava-gestao-avisos'] })
  const salvar = useMutation({
    mutationFn: (a: Partial<AvisoAdmin>) => gestaoCall('aviso_salvar', { id: a.id, curso_id: a.curso_id ?? null, titulo: a.titulo, texto: a.texto, publicado: a.publicado !== false }),
    onSuccess: () => { setEdit(null); showSuccess('Aviso salvo.'); refresh() }, onError: (e) => showError((e as Error).message),
  })
  const excluir = useMutation({ mutationFn: (id: number) => gestaoCall('aviso_excluir', { id }), onSuccess: refresh, onError: (e) => showError((e as Error).message) })
  const nomeCurso = (id: number | null) => (id === null ? 'Todas as disciplinas' : cursos.data?.cursos.find(c => c.id === id)?.titulo ?? `Disciplina ${id}`)
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Btn onClick={() => setEdit({ titulo: '', texto: '', curso_id: eu.gestor ? null : cursos.data?.cursos[0]?.id ?? null, publicado: true })}><Plus size={15} className="mr-1.5" /> Novo aviso</Btn></div>
      {q.isLoading ? <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-primary" /></div> : (q.data?.avisos ?? []).length === 0 ? <p className="py-12 text-center text-sm text-[var(--text-muted)]">Nenhum aviso publicado.</p> : (q.data?.avisos ?? []).map(a => (
        <div key={a.id} className="glass-card p-4 flex gap-3 items-start" style={!a.publicado ? { opacity: 0.6 } : undefined}>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{a.titulo}{!a.publicado && <span className="ml-2 text-[10px] uppercase text-[var(--warning)]">oculto</span>}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{nomeCurso(a.curso_id)} · {a.autor_nome ?? 'FICV'} · {haQuanto(a.criado_em)}</p>
            <p className="text-sm mt-2 whitespace-pre-line">{a.texto}</p>
          </div>
          <Btn variant="outline" size="sm" onClick={() => setEdit(a)}>Editar</Btn>
          <button aria-label="Excluir aviso" className="p-2 text-[var(--text-muted)] hover:text-[var(--danger)]" onClick={() => { if (confirm('Excluir este aviso?')) excluir.mutate(a.id) }}><Trash2 size={15} /></button>
        </div>
      ))}
      {edit && (
        <Modal titulo={edit.id ? 'Editar aviso' : 'Novo aviso'} onClose={() => setEdit(null)}>
          <Rot>Para</Rot>
          <select value={edit.curso_id ?? ''} onChange={e => setEdit({ ...edit, curso_id: e.target.value ? Number(e.target.value) : null })} className={CAMPO}>
            {eu.gestor && <option value="">Todas as disciplinas</option>}
            {(cursos.data?.cursos ?? []).map(c => <option key={c.id} value={c.id}>{c.titulo}{c.semestre ? ` (${c.semestre}${c.periodo ? ` · ${c.periodo}` : ''})` : ''}</option>)}
          </select>
          <Rot>Título</Rot><Inp value={edit.titulo ?? ''} onChange={e => setEdit({ ...edit, titulo: e.target.value })} maxLength={160} />
          <Rot>Texto</Rot><textarea value={edit.texto ?? ''} onChange={e => setEdit({ ...edit, texto: e.target.value })} rows={6} className={CAMPO} />
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.publicado !== false} onChange={e => setEdit({ ...edit, publicado: e.target.checked })} /> Visível para os alunos</label>
          <div className="mt-5 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setEdit(null)}>Cancelar</Btn><Btn disabled={salvar.isPending || !edit.titulo?.trim() || !edit.texto?.trim()} onClick={() => salvar.mutate(edit)}>Publicar</Btn></div>
        </Modal>
      )}
    </div>
  )
}

// ── Acesso ao AVA em teste ───────────────────────────────────
function Acesso() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ava-gestao-liberados'], queryFn: () => gestaoCall<{ liberados: { aluno_id: string; nome: string; email: string; obs: string | null }[] }>('liberados_listar') })
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<{ id: string; nome: string; email: string; nivel: string | null }[]>([])
  const [buscando, setBuscando] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['ava-gestao-liberados'] })
  const liberar = useMutation({ mutationFn: ({ id, todos }: { id: string; todos: boolean }) => gestaoCall('liberado_salvar', { aluno_id: id, obs: todos ? 'todos' : '' }), onSuccess: () => { showSuccess('Acesso liberado.'); setAchados([]); setBusca(''); refresh() }, onError: (e) => showError((e as Error).message) })
  const remover = useMutation({ mutationFn: (id: string) => gestaoCall('liberado_remover', { aluno_id: id }), onSuccess: refresh, onError: (e) => showError((e as Error).message) })
  async function procurar() {
    setBuscando(true)
    try { setAchados((await gestaoCall<{ alunos: typeof achados }>('aluno_buscar', { q: busca })).alunos) } catch (e) { showError((e as Error).message) } finally { setBuscando(false) }
  }
  return (
    <div className="space-y-5 max-w-3xl">
      <p className="text-sm text-[var(--text-muted)]">Enquanto o AVA está em teste, só entra quem está nesta lista (e conhece o endereço <b>/ava</b>). "Ver todas as disciplinas" mostra tudo que foi importado, mesmo sem inscrição no Moodle e inclusive rascunhos; sem isso, o aluno vê só as disciplinas publicadas em que está inscrito.</p>
      <div className="glass-card p-4 space-y-3">
        <div className="flex gap-2"><Inp placeholder="Nome ou CPF do aluno (mín. 3 letras)" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') procurar() }} /><Btn disabled={busca.trim().length < 3 || buscando} onClick={procurar}>{buscando ? '…' : 'Buscar'}</Btn></div>
        {achados.map(a => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm py-1">
            <span className="flex-1 min-w-0 truncate">{a.nome} <span className="text-[var(--text-muted)]">· {a.email}</span></span>
            <Btn variant="outline" size="sm" onClick={() => liberar.mutate({ id: a.id, todos: false })}>Liberar</Btn>
            <Btn size="sm" onClick={() => liberar.mutate({ id: a.id, todos: true })}>Liberar vendo tudo</Btn>
          </div>
        ))}
      </div>
      <div className="glass-card divide-y divide-[var(--border)] overflow-hidden">
        {q.isLoading ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-primary" /></div> : (q.data?.liberados ?? []).length === 0 ? <p className="p-6 text-sm text-[var(--text-muted)] text-center">Ninguém liberado ainda.</p> : (q.data?.liberados ?? []).map(l => (
          <div key={l.aluno_id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="flex-1 min-w-0"><p className="font-medium truncate">{l.nome}</p><p className="text-xs text-[var(--text-muted)] truncate">{l.email}</p></div>
            {/todos/i.test(l.obs ?? '') && <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">vê todas as disciplinas</span>}
            <button aria-label="Remover acesso" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)]" onClick={() => { if (confirm(`Remover o acesso de ${l.nome}?`)) remover.mutate(l.aluno_id) }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
