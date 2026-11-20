import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Plus, Sparkles, Trash2, Loader2 } from 'lucide-react'
import { avaCall, fmtTempo, haQuanto, type AvaAnotacao, type AvaAula, type AvaAviso, type AvaPergunta } from './avaApi'

const GOLD = '#C9A84C'
const campo = 'w-full rounded-lg bg-[var(--ava-surface)] border border-[var(--ava-line)] px-3 py-2.5 text-sm text-[var(--ava-text)] placeholder:text-[var(--ava-muted)] outline-none focus:border-[#C9A84C]/70'

const Vazio = ({ children }: { children: React.ReactNode }) => <p className="py-10 text-center text-sm text-[var(--ava-muted)]">{children}</p>
const Carregando = () => <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: GOLD }} /></div>

// ── Anotações ────────────────────────────────────────────────
export function AbaAnotacoes({ cursoId, aulas, aulaAtual, playerRef, irPara }: {
  cursoId: number; aulas: AvaAula[]; aulaAtual: AvaAula; playerRef: React.MutableRefObject<any>; irPara: (aula: AvaAula, seg: number) => void
}) {
  const qc = useQueryClient()
  const chave = ['ava-anotacoes', cursoId]
  const q = useQuery({ queryKey: chave, queryFn: () => avaCall<{ anotacoes: AvaAnotacao[] }>('anotacoes_listar', { curso_id: cursoId }) })
  const [texto, setTexto] = useState('')
  const [seg, setSeg] = useState(0)
  const [soAula, setSoAula] = useState(false)
  const salvar = useMutation({
    mutationFn: () => avaCall('anotacao_salvar', { aula_id: aulaAtual.id, segundos: seg, texto }),
    onSuccess: () => { setTexto(''); qc.invalidateQueries({ queryKey: chave }) },
  })
  const excluir = useMutation({ mutationFn: (id: number) => avaCall('anotacao_excluir', { id }), onSuccess: () => qc.invalidateQueries({ queryKey: chave }) })

  const capturar = async () => { try { setSeg(Math.floor(await playerRef.current?.getCurrentTime() ?? 0)) } catch { /* sem player */ } }
  const lista = (q.data?.anotacoes ?? []).filter(a => !soAula || a.aula_id === aulaAtual.id)

  async function ver(a: AvaAnotacao) {
    const aula = aulas.find(x => x.id === a.aula_id); if (!aula) return
    if (aula.id === aulaAtual.id && playerRef.current) { try { await playerRef.current.setCurrentTime(a.segundos); await playerRef.current.play() } catch { /* */ } window.scrollTo({ top: 0, behavior: 'smooth' }) }
    else irPara(aula, a.segundos)
  }

  return (
    <div className="py-4 space-y-3">
      <div className="rounded-lg border border-[var(--ava-line)] p-2.5 space-y-2">
        <textarea value={texto} onFocus={capturar} onChange={e => setTexto(e.target.value)} rows={2} maxLength={2000}
          placeholder={`Criar uma nova anotação em ${fmtTempo(seg)}`} className={campo} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--ava-muted)] truncate">Aula: {aulaAtual.titulo}</span>
          <button onClick={() => salvar.mutate()} disabled={!texto.trim() || salvar.isPending}
            className="h-9 px-3.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40" style={{ background: GOLD, color: '#111' }}><Plus className="w-4 h-4" /> Salvar</button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--ava-soft)]"><input type="checkbox" checked={soAula} onChange={e => setSoAula(e.target.checked)} /> Só desta aula</label>
      {q.isLoading ? <Carregando /> : lista.length === 0 ? <Vazio>Você ainda não tem anotações. Escreva acima durante a aula; o minuto do vídeo é guardado junto.</Vazio> : lista.map(a => {
        const aula = aulas.find(x => x.id === a.aula_id)
        return (
          <div key={a.id} className="rounded-lg bg-[var(--ava-surface)] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <button onClick={() => ver(a)} className="text-xs font-semibold rounded px-2 py-0.5" style={{ background: 'rgba(201,168,76,.18)', color: 'var(--ava-gold)' }}>{fmtTempo(a.segundos)}</button>
              <span className="text-[11px] text-[var(--ava-muted)] truncate flex-1">{aula?.titulo}</span>
              <button onClick={() => excluir.mutate(a.id)} aria-label="Excluir anotação" className="p-1 text-[var(--ava-muted)] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <p className="text-sm text-[var(--ava-soft)] whitespace-pre-line">{a.texto}</p>
          </div>
        )
      })}
    </div>
  )
}

// ── Perguntas e respostas ───────────────────────────────────
const ROTULO = { professor: 'Professor(a)', equipe: 'Equipe FICV', aluno: '' } as const

export function AbaPerguntas({ cursoId, aulas, aulaAtual, onAssistente }: { cursoId: number; aulas: AvaAula[]; aulaAtual: AvaAula; onAssistente: (t: string) => void }) {
  const qc = useQueryClient()
  const chave = ['ava-perguntas', cursoId]
  const q = useQuery({ queryKey: chave, queryFn: () => avaCall<{ perguntas: AvaPergunta[] }>('perguntas_listar', { curso_id: cursoId }) })
  const [novo, setNovo] = useState(false)
  const [titulo, setTitulo] = useState(''); const [texto, setTexto] = useState('')
  const [soAula, setSoAula] = useState(false)
  const [aberta, setAberta] = useState<number | null>(null)
  const [resp, setResp] = useState('')
  const criar = useMutation({
    mutationFn: () => avaCall('pergunta_criar', { curso_id: cursoId, aula_id: aulaAtual.id, titulo, texto }),
    onSuccess: () => { setTitulo(''); setTexto(''); setNovo(false); qc.invalidateQueries({ queryKey: chave }) },
  })
  const responder = useMutation({
    mutationFn: (pergunta_id: number) => avaCall('resposta_criar', { pergunta_id, texto: resp }),
    onSuccess: () => { setResp(''); qc.invalidateQueries({ queryKey: chave }) },
  })
  const lista = (q.data?.perguntas ?? []).filter(p => !soAula || p.aula_id === aulaAtual.id)

  return (
    <div className="py-4 space-y-3">
      <div className="rounded-xl p-3.5 flex items-center gap-3" style={{ background: 'rgba(201,168,76,.1)', border: '1px solid rgba(201,168,76,.3)' }}>
        <Sparkles className="w-5 h-5 shrink-0" style={{ color: GOLD }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Receba uma resposta instantânea</p>
          <p className="text-xs text-[var(--ava-soft)]">O Tutor Virtual responde na hora; para o professor, publique abaixo.</p>
        </div>
      </div>
      {!novo ? (
        <button onClick={() => setNovo(true)} className="h-10 px-4 rounded-lg text-sm font-semibold flex items-center gap-1.5" style={{ background: GOLD, color: '#111' }}><MessageCircle className="w-4 h-4" /> Fazer uma pergunta</button>
      ) : (
        <div className="rounded-lg border border-[var(--ava-line)] p-3 space-y-2">
          <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={160} placeholder="Título da pergunta" className={campo} />
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={4} maxLength={4000} placeholder="Descreva a sua dúvida" className={campo} />
          <p className="text-[11px] text-[var(--ava-muted)]">Será ligada à aula: {aulaAtual.titulo}</p>
          {criar.isError && <p className="text-xs text-red-400">{(criar.error as Error).message}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => criar.mutate()} disabled={titulo.trim().length < 3 || !texto.trim() || criar.isPending} className="h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ background: GOLD, color: '#111' }}>Publicar</button>
            <button onClick={() => onAssistente(`${titulo}\n${texto}`.trim())} disabled={!titulo.trim() && !texto.trim()} className="h-9 px-3.5 rounded-lg border border-[var(--ava-line)] text-sm disabled:opacity-40 flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Perguntar ao Tutor Virtual</button>
            <button onClick={() => setNovo(false)} className="h-9 px-3 text-sm text-[var(--ava-muted)]">Cancelar</button>
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-[var(--ava-soft)]"><input type="checkbox" checked={soAula} onChange={e => setSoAula(e.target.checked)} /> Só desta aula</label>
      {q.isLoading ? <Carregando /> : lista.length === 0 ? <Vazio>Nenhuma pergunta ainda. Seja o primeiro a perguntar.</Vazio> : lista.map(p => (
        <div key={p.id} className="rounded-lg bg-[var(--ava-surface)]">
          <button onClick={() => { setAberta(aberta === p.id ? null : p.id); setResp('') }} className="w-full text-left p-3">
            <p className="text-sm font-semibold leading-snug">{p.titulo}</p>
            <p className="text-xs text-[var(--ava-muted)] mt-1">{p.autor_nome} · {aulas.find(a => a.id === p.aula_id)?.titulo ?? 'Geral'} · {haQuanto(p.criado_em)} · {p.respostas.length} {p.respostas.length === 1 ? 'resposta' : 'respostas'}</p>
          </button>
          {aberta === p.id && (
            <div className="px-3 pb-3 space-y-2.5">
              <p className="text-sm text-[var(--ava-soft)] whitespace-pre-line">{p.texto}</p>
              {p.respostas.map(r => (
                <div key={r.id} className="rounded-lg p-2.5 text-sm" style={{ background: r.autor_tipo === 'aluno' ? 'rgba(255,255,255,.05)' : 'rgba(201,168,76,.12)' }}>
                  <p className="text-xs mb-1"><span className="font-semibold text-[var(--ava-text)]">{r.autor_nome}</span>{ROTULO[r.autor_tipo] && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: GOLD, color: '#111' }}>{ROTULO[r.autor_tipo]}</span>} <span className="text-[var(--ava-muted)]">· {haQuanto(r.criado_em)}</span></p>
                  <p className="text-[var(--ava-soft)] whitespace-pre-line">{r.texto}</p>
                </div>
              ))}
              <div className="flex gap-2">
                <input value={resp} onChange={e => setResp(e.target.value)} placeholder="Escreva uma resposta" maxLength={4000} className={campo} />
                <button onClick={() => responder.mutate(p.id)} disabled={!resp.trim() || responder.isPending} className="h-10 px-3.5 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ background: GOLD, color: '#111' }}>Enviar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Avisos ──────────────────────────────────────────────────
export function AbaAvisos({ cursoId }: { cursoId: number }) {
  const q = useQuery({ queryKey: ['ava-avisos', cursoId], queryFn: () => avaCall<{ avisos: AvaAviso[] }>('avisos_listar', { curso_id: cursoId }) })
  if (q.isLoading) return <Carregando />
  const lista = q.data?.avisos ?? []
  if (!lista.length) return <Vazio>Nenhum aviso para esta disciplina.</Vazio>
  return (
    <div className="py-4 space-y-3">
      {lista.map(a => (
        <div key={a.id} className="rounded-lg bg-[var(--ava-surface)] p-3.5">
          <p className="text-xs text-[var(--ava-muted)]">{a.autor_nome ?? 'FICV'} publicou um aviso · {haQuanto(a.criado_em)}</p>
          <p className="text-sm font-semibold mt-1" style={{ color: 'var(--ava-gold)' }}>{a.titulo}</p>
          <p className="text-sm text-[var(--ava-soft)] mt-1.5 whitespace-pre-line">{a.texto}</p>
        </div>
      ))}
    </div>
  )
}
