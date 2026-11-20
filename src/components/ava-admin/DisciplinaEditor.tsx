import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, ArrowDown, ArrowUp, ChevronLeft, ClipboardCheck, ExternalLink, Eye, EyeOff, FileText, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { showError, showSuccess } from '@/utils/toast'
import { Btn, CAMPO, Inp } from '../cpa/cpaUi'
import { gestaoCall, type Aula, type CursoCompleto, type Eu, type Secao } from './gestaoApi'
import { Modal, Rot } from './ui'

const ICONE = { video: Play, material: FileText, link: ExternalLink, quiz: ClipboardCheck, texto: AlignLeft, forum: FileText } as const
const TIPOS = [['video', 'Videoaula (Vimeo)'], ['texto', 'Texto / leitura'], ['material', 'Material (PDF, arquivo)'], ['link', 'Link externo'], ['quiz', 'Avaliação (link)']] as const
const dur = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '')

export function DisciplinaEditor({ cursoId, eu, onVoltar }: { cursoId: number; eu: Eu; onVoltar: () => void }) {
  const qc = useQueryClient()
  const chave = ['ava-gestao-curso', cursoId]
  const q = useQuery({ queryKey: chave, queryFn: () => gestaoCall<CursoCompleto>('curso_ler', { curso_id: cursoId }) })
  const [aba, setAba] = useState<'conteudo' | 'dados' | 'responsaveis'>('conteudo')
  const [item, setItem] = useState<{ secao: Secao; aula?: Aula } | null>(null)
  const [novaSecao, setNovaSecao] = useState('')
  const [renomear, setRenomear] = useState<Secao | null>(null)

  const refresh = () => { qc.invalidateQueries({ queryKey: chave }); qc.invalidateQueries({ queryKey: ['ava-gestao-cursos'] }) }
  const acao = useMutation({
    mutationFn: ({ a, p }: { a: string; p: Record<string, unknown> }) => gestaoCall(a, p),
    onSuccess: refresh, onError: (e) => showError((e as Error).message),
  })
  const rodar = (a: string, p: Record<string, unknown>) => acao.mutate({ a, p: { curso_id: cursoId, ...p } })

  if (q.isLoading) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
  if (q.isError || !q.data) return <div className="p-6 text-sm text-[var(--danger)]">{(q.error as Error)?.message ?? 'Disciplina indisponível.'} <button className="underline ml-2" onClick={onVoltar}>Voltar</button></div>
  const { curso, secoes, aulas } = q.data
  const doSecao = (s: Secao) => aulas.filter(a => a.secao_id === s.id)

  const mover = (s: Secao, a: Aula, dir: -1 | 1) => {
    const lista = doSecao(s).map(x => x.id); const i = lista.indexOf(a.id); const j = i + dir
    if (j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    acao.mutate({ a: 'reordenar', p: { tipo: 'aula', ids: lista } })
  }
  const moverSecao = (s: Secao, dir: -1 | 1) => {
    const lista = secoes.map(x => x.id); const i = lista.indexOf(s.id); const j = i + dir
    if (j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    acao.mutate({ a: 'reordenar', p: { tipo: 'secao', ids: lista } })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onVoltar} className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]"><ChevronLeft size={16} /> Disciplinas</button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold truncate">{curso.titulo}</h2>
          <p className="text-xs text-[var(--text-muted)]">{[curso.curso_area, curso.periodo, curso.semestre].filter(Boolean).join(' · ')}{curso.professor ? ` · Prof. ${curso.professor}` : ''}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={curso.publicado ? { background: 'rgba(35,134,54,.15)', color: 'var(--success-text)' } : { background: 'rgba(180,83,9,.15)', color: 'var(--warning)' }}>{curso.publicado ? 'Publicada' : 'Rascunho'}</span>
        {eu.gestor && <Btn variant="outline" size="sm" disabled={acao.isPending} onClick={() => rodar('curso_salvar', { publicado: !curso.publicado })}>{curso.publicado ? 'Despublicar' : 'Publicar'}</Btn>}
        <a href={`/ava/curso/${curso.id}`} target="_blank" rel="noreferrer" className="btn-pill px-4 py-2 text-sm inline-flex items-center gap-1.5"><ExternalLink size={14} /> Ver como aluno</a>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)] text-sm">
        {([['conteudo', 'Conteúdo'], ['dados', 'Dados'], ...(eu.gestor ? [['responsaveis', 'Responsáveis']] : [])] as [typeof aba, string][]).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)} className="px-4 py-2.5 -mb-px border-b-2 font-medium" style={aba === k ? { borderColor: 'var(--primary)', color: 'var(--text-main)' } : { borderColor: 'transparent', color: 'var(--text-muted)' }}>{t}</button>
        ))}
      </div>

      {aba === 'conteudo' && (
        <div className="space-y-4">
          {secoes.map((s, si) => (
            <div key={s.id} className="glass-card overflow-hidden" style={s.oculto ? { opacity: 0.6 } : undefined}>
              <div className="flex items-center gap-1 px-4 py-3 bg-[var(--bg-card-hover)]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{s.nome}{s.oculto && <span className="ml-2 text-[10px] uppercase text-[var(--warning)]">oculto</span>}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{doSecao(s).length} itens</p>
                </div>
                <Icone t="Subir módulo" onClick={() => moverSecao(s, -1)} off={si === 0}><ArrowUp size={15} /></Icone>
                <Icone t="Descer módulo" onClick={() => moverSecao(s, 1)} off={si === secoes.length - 1}><ArrowDown size={15} /></Icone>
                <Icone t="Renomear" onClick={() => setRenomear(s)}><Pencil size={15} /></Icone>
                <Icone t={s.oculto ? 'Mostrar ao aluno' : 'Ocultar do aluno'} onClick={() => rodar('secao_salvar', { id: s.id, nome: s.nome, oculto: !s.oculto })}>{s.oculto ? <EyeOff size={15} /> : <Eye size={15} />}</Icone>
                <Icone t="Excluir módulo" onClick={() => { if (confirm(`Excluir o módulo "${s.nome}" e todos os itens dele? Não dá para desfazer.`)) acao.mutate({ a: 'secao_excluir', p: { id: s.id } }) }}><Trash2 size={15} /></Icone>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {doSecao(s).map((a, ai, arr) => {
                  const I = ICONE[a.tipo] ?? FileText
                  return (
                    <div key={a.id} className="flex items-center gap-1 px-4 py-2.5" style={a.oculto ? { opacity: 0.55 } : undefined}>
                      <I size={15} className="shrink-0 text-[var(--text-muted)] mr-1.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{a.titulo}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{TIPOS.find(t => t[0] === a.tipo)?.[1] ?? a.tipo}{a.duracao_seg ? ` · ${dur(a.duracao_seg)}` : ''}{a.oculto ? ' · oculto' : ''}</p>
                      </div>
                      <Icone t="Subir" onClick={() => mover(s, a, -1)} off={ai === 0}><ArrowUp size={15} /></Icone>
                      <Icone t="Descer" onClick={() => mover(s, a, 1)} off={ai === arr.length - 1}><ArrowDown size={15} /></Icone>
                      <Icone t="Editar" onClick={() => setItem({ secao: s, aula: a })}><Pencil size={15} /></Icone>
                      <Icone t={a.oculto ? 'Mostrar ao aluno' : 'Ocultar do aluno'} onClick={() => rodar('aula_salvar', { id: a.id, tipo: a.tipo, titulo: a.titulo, url: a.url, descricao: a.descricao, oculto: !a.oculto })}>{a.oculto ? <EyeOff size={15} /> : <Eye size={15} />}</Icone>
                      <Icone t="Excluir" onClick={() => { if (confirm(`Excluir "${a.titulo}"? O progresso dos alunos nesta aula também será apagado.`)) acao.mutate({ a: 'aula_excluir', p: { id: a.id } }) }}><Trash2 size={15} /></Icone>
                    </div>
                  )
                })}
                <button onClick={() => setItem({ secao: s })} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-[var(--bg-card-hover)]"><Plus size={15} /> Adicionar item</button>
              </div>
            </div>
          ))}
          <div className="glass-card p-4 flex flex-wrap gap-2 items-center">
            <Inp placeholder="Nome do novo módulo" value={novaSecao} onChange={e => setNovaSecao(e.target.value)} className="max-w-xs" />
            <Btn size="sm" disabled={!novaSecao.trim() || acao.isPending} onClick={() => { rodar('secao_salvar', { nome: novaSecao }); setNovaSecao('') }}><Plus size={14} className="mr-1" /> Novo módulo</Btn>
          </div>
        </div>
      )}

      {aba === 'dados' && <Dados curso={curso} onSalvar={p => rodar('curso_salvar', p)} pendente={acao.isPending} />}
      {aba === 'responsaveis' && eu.gestor && <Responsaveis cursoId={cursoId} atuais={q.data.professores} onSalvo={refresh} />}

      {item && <ItemModal cursoId={cursoId} secao={item.secao} aula={item.aula} onClose={() => setItem(null)} onSalvo={() => { setItem(null); refresh() }} />}
      {renomear && (
        <Modal titulo="Renomear módulo" onClose={() => setRenomear(null)}>
          <RenomearForm nome={renomear.nome} onSalvar={nome => { rodar('secao_salvar', { id: renomear.id, nome, oculto: renomear.oculto }); setRenomear(null) }} />
        </Modal>
      )}
    </div>
  )
}

function Icone({ t, onClick, children, off }: { t: string; onClick: () => void; children: React.ReactNode; off?: boolean }) {
  return <button title={t} aria-label={t} onClick={onClick} disabled={off} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card-hover)] disabled:opacity-25 disabled:pointer-events-none">{children}</button>
}

function RenomearForm({ nome, onSalvar }: { nome: string; onSalvar: (n: string) => void }) {
  const [v, setV] = useState(nome)
  return <div><Inp value={v} onChange={e => setV(e.target.value)} autoFocus /><div className="mt-4 flex justify-end"><Btn disabled={!v.trim()} onClick={() => onSalvar(v.trim())}>Salvar</Btn></div></div>
}

function Dados({ curso, onSalvar, pendente }: { curso: CursoCompleto['curso']; onSalvar: (p: Record<string, unknown>) => void; pendente: boolean }) {
  const [titulo, setTitulo] = useState(curso.titulo)
  const [professor, setProfessor] = useState(curso.professor ?? '')
  const [descricao, setDescricao] = useState(curso.descricao ?? '')
  return (
    <div className="glass-card p-5 max-w-2xl">
      <Rot>Título da disciplina</Rot><Inp value={titulo} onChange={e => setTitulo(e.target.value)} />
      <Rot>Professor(es) exibido(s) ao aluno</Rot><Inp value={professor} onChange={e => setProfessor(e.target.value)} placeholder="Nome do professor" />
      <Rot>Descrição (aba Visão geral)</Rot><textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={6} className={CAMPO} />
      <div className="mt-4 flex justify-end"><Btn disabled={pendente || !titulo.trim()} onClick={() => { onSalvar({ titulo, professor, descricao }); showSuccess('Dados salvos.') }}>Salvar dados</Btn></div>
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">Depois de editado aqui, o que veio do Moodle deixa de ser sobrescrito pelas próximas importações.</p>
    </div>
  )
}

function Responsaveis({ cursoId, atuais, onSalvo }: { cursoId: number; atuais: string[]; onSalvo: () => void }) {
  const pessoas = useQuery({ queryKey: ['ava-gestao-pessoas'], queryFn: () => gestaoCall<{ pessoas: { id: string; full_name: string; role: string }[] }>('professores_candidatos') })
  const [sel, setSel] = useState<Set<string>>(new Set(atuais))
  const salvar = useMutation({
    mutationFn: () => gestaoCall('curso_professores_salvar', { curso_id: cursoId, user_ids: [...sel] }),
    onSuccess: () => { showSuccess('Responsáveis salvos.'); onSalvo() }, onError: (e) => showError((e as Error).message),
  })
  return (
    <div className="glass-card p-5 max-w-2xl">
      <p className="text-sm text-[var(--text-muted)] mb-3">Quem pode editar o conteúdo, publicar avisos e responder dúvidas desta disciplina. Crie o usuário do professor em Gestão &gt; Usuários, com a função <b>Professor</b>.</p>
      {pessoas.isLoading ? <Loader2 className="animate-spin text-primary" /> : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {(pessoas.data?.pessoas ?? []).map(p => (
            <label key={p.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-[var(--bg-card-hover)] text-sm cursor-pointer">
              <input type="checkbox" checked={sel.has(p.id)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n })} />
              <span className="flex-1">{p.full_name}</span><span className="text-[11px] text-[var(--text-muted)] uppercase">{p.role}</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end"><Btn disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar responsáveis</Btn></div>
    </div>
  )
}

function ItemModal({ cursoId, secao, aula, onClose, onSalvo }: { cursoId: number; secao: Secao; aula?: Aula; onClose: () => void; onSalvo: () => void }) {
  const [tipo, setTipo] = useState<string>(aula?.tipo ?? 'video')
  const [titulo, setTitulo] = useState(aula?.titulo ?? '')
  const [video, setVideo] = useState(aula?.video_id ? `https://vimeo.com/${aula.video_id}${aula.video_hash ? `/${aula.video_hash}` : ''}` : '')
  const [url, setUrl] = useState(aula?.url ?? '')
  const [texto, setTexto] = useState(aula?.descricao ?? '')
  const salvar = useMutation({
    mutationFn: () => gestaoCall('aula_salvar', { curso_id: cursoId, secao_id: secao.id, id: aula?.id, tipo, titulo, video_url: tipo === 'video' ? video : undefined, url: ['material', 'link', 'quiz'].includes(tipo) ? url : undefined, descricao: tipo === 'texto' ? texto : undefined }),
    onSuccess: () => { showSuccess('Item salvo.'); onSalvo() }, onError: (e) => showError((e as Error).message),
  })
  return (
    <Modal titulo={`${aula ? 'Editar item' : 'Novo item'} · ${secao.nome}`} onClose={onClose}>
      <Rot>Tipo</Rot>
      <select value={tipo} onChange={e => setTipo(e.target.value)} disabled={!!aula} className={CAMPO}>{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <Rot>Título {tipo === 'video' && <span className="normal-case">(vazio = usa o título do Vimeo)</span>}</Rot>
      <Inp value={titulo} onChange={e => setTitulo(e.target.value)} />
      {tipo === 'video' && (<><Rot>Link do Vimeo</Rot><Inp value={video} onChange={e => setVideo(e.target.value)} placeholder="https://vimeo.com/123456789" /><p className="mt-1 text-[11px] text-[var(--text-muted)]">Duração e capa são buscadas no Vimeo ao salvar.</p></>)}
      {tipo === 'texto' && (<><Rot>Texto</Rot><textarea value={texto} onChange={e => setTexto(e.target.value)} rows={8} className={CAMPO} /></>)}
      {['material', 'link', 'quiz'].includes(tipo) && (<><Rot>Endereço (https://)</Rot><Inp value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." /></>)}
      <div className="mt-5 flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={salvar.isPending || (!titulo.trim() && tipo !== 'video')} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Btn></div>
    </Modal>
  )
}
