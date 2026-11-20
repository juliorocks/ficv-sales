import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlignLeft, Check, PanelRightClose, PanelRightOpen, Search, Sparkles, X, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink, FileText, Loader2, Play } from 'lucide-react'
import { avaCall, AVA_BG, fmtDuracao, programaDe, type AvaAula, type AvaCurso, type MsgChat } from './avaApi'
import { AvaAssistente } from './AvaAssistente'
import { AbaAnotacoes, AbaAvisos, AbaPerguntas } from './AvaAbas'
import { VimeoPlayer } from './VimeoPlayer'

const GOLD = '#C9A84C'
type Prog = Record<number, { posicao_seg: number; concluida: boolean }>

function IconeAula({ a, feita, atual }: { a: AvaAula; feita: boolean; atual: boolean }) {
  if (feita) return <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: GOLD }} />
  const cls = `w-4 h-4 shrink-0 ${atual ? 'text-[var(--ava-text)]' : 'text-[var(--ava-muted)]'}`
  if (a.tipo === 'video') return <Play className={cls} />
  if (a.tipo === 'quiz') return <ClipboardCheck className={cls} />
  if (a.tipo === 'link') return <ExternalLink className={cls} />
  if (a.tipo === 'texto') return <AlignLeft className={cls} />
  return <FileText className={cls} />
}

export function AvaCursoPage() {
  const { cursoId, aulaId } = useParams()
  const q = useQuery({ queryKey: ['ava-curso', cursoId], queryFn: () => avaCall<AvaCurso>('curso', { curso_id: Number(cursoId) }) })
  if (q.isLoading) return <div className="min-h-dvh flex items-center justify-center" style={{ background: AVA_BG }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} /></div>
  if (q.isError || !q.data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center text-[var(--ava-text)]" style={{ background: AVA_BG }}>
        <p className="text-sm text-[var(--ava-muted)]">{(q.error as Error)?.message ?? 'Disciplina indisponível.'}</p>
        <Link to="/ava" className="text-sm underline" style={{ color: GOLD }}>Voltar às disciplinas</Link>
      </div>
    )
  }
  return <Sala key={cursoId} dados={q.data} aulaId={aulaId ? Number(aulaId) : null} />
}

function Sala({ dados, aulaId }: { dados: AvaCurso; aulaId: number | null }) {
  const { curso, secoes, aulas } = dados
  const navigate = useNavigate()
  const [prog, setProg] = useState<Prog>(() => Object.fromEntries(dados.progresso.map(p => [p.aula_id, { posicao_seg: p.posicao_seg, concluida: p.concluida }])))
  const progRef = useRef(prog); progRef.current = prog
  type Aba = 'conteudo' | 'assistente' | 'geral' | 'perguntas' | 'anotacoes' | 'avisos'
  const [aba, setAba] = useState<Aba>(() => (window.innerWidth >= 1024 ? 'geral' : 'conteudo'))
  const [lateral, setLateral] = useState<'conteudo' | 'assistente'>('conteudo')
  const [chat, setChat] = useState<MsgChat[]>([])
  const [semente, setSemente] = useState<string | null>(null)
  const playerRef = useRef<any>(null)
  const [sp] = useSearchParams()
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const f = () => setDesktop(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f)
  }, [])
  const [teatro, setTeatro] = useState(() => { try { return localStorage.getItem('ava_teatro') === '1' } catch { return false } })
  const alternarTeatro = () => setTeatro(t => { const n = !t; try { localStorage.setItem('ava_teatro', n ? '1' : '0') } catch { /* sem storage */ } return n })
  const [busca, setBusca] = useState<string | null>(null)
  const recolhida = teatro && desktop
  useEffect(() => { if (recolhida && (aba === 'geral')) return; if (!recolhida && desktop && (aba === 'conteudo' || aba === 'assistente')) setAba('geral') }, [recolhida, desktop, aba])
  const perguntarAoTutor = (t: string) => { setSemente(t); if (recolhida || !window.matchMedia('(min-width: 1024px)').matches) setAba('assistente'); else setLateral('assistente') }

  // sem aula na URL: retoma a última com progresso não concluído, senão a 1ª de vídeo
  const aulaAtual = useMemo(() => {
    const porId = aulas.find(a => a.id === aulaId)
    if (porId) return porId
    const videos = aulas.filter(a => a.tipo === 'video')
    const emAndamento = videos.filter(a => !progRef.current[a.id]?.concluida && (progRef.current[a.id]?.posicao_seg ?? 0) > 5)
    return emAndamento[0] ?? videos.find(a => !progRef.current[a.id]?.concluida) ?? videos[0] ?? aulas[0]
  }, [aulaId, aulas])

  const [abertas, setAbertas] = useState<Set<number>>(() => new Set(aulaAtual ? [aulaAtual.secao_id] : []))
  useEffect(() => { if (aulaAtual) setAbertas(s => (s.has(aulaAtual.secao_id) ? s : new Set(s).add(aulaAtual.secao_id))) }, [aulaAtual])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [aulaAtual?.id])

  const tUrl = Number(sp.get('t')) || 0
  const inicio = useMemo(() => tUrl || (progRef.current[aulaAtual?.id ?? -1]?.posicao_seg ?? 0), [aulaAtual?.id, tUrl])
  const ordenadas = useMemo(() => aulas, [aulas])
  const idx = ordenadas.findIndex(a => a.id === aulaAtual?.id)
  const anterior = idx > 0 ? ordenadas[idx - 1] : null
  const proxima = idx >= 0 && idx < ordenadas.length - 1 ? ordenadas[idx + 1] : null

  const total = aulas.filter(a => a.tipo === 'video').length
  const feitas = aulas.filter(a => a.tipo === 'video' && prog[a.id]?.concluida).length
  const pct = total ? Math.round((feitas / total) * 100) : 0

  const ir = useCallback((a: AvaAula, seg?: number) => navigate(`/ava/curso/${curso.id}/aula/${a.id}${seg ? `?t=${seg}` : ''}`), [navigate, curso.id])

  const salvar = useCallback((aula: AvaAula, pos: number, dur: number, concluida?: boolean) => {
    const fim = concluida ?? (dur > 0 && pos >= dur * 0.9)
    setProg(p => ({ ...p, [aula.id]: { posicao_seg: Math.floor(pos), concluida: concluida === false ? false : (p[aula.id]?.concluida || fim) } }))
    avaCall('progresso', { aula_id: aula.id, posicao_seg: Math.floor(pos), duracao_seg: Math.floor(dur), ...(concluida === undefined ? {} : { concluida }) }).catch(() => {})
  }, [])

  if (!aulaAtual) return <div className="min-h-dvh p-8 text-[var(--ava-muted)]" style={{ background: AVA_BG }}>Esta disciplina ainda não tem conteúdo.</div>

  const voltar = `/ava/c/${programaDe(curso).key}`
  const concluidaAtual = !!prog[aulaAtual.id]?.concluida
  const lista = (
    <Curriculo secoes={secoes} aulas={aulas} prog={prog} atual={aulaAtual.id} abertas={abertas}
      alternar={id => setAbertas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })} ir={ir}
      marcar={a => salvar(a, prog[a.id]?.posicao_seg ?? 0, a.duracao_seg ?? 0, !prog[a.id]?.concluida)} />
  )

  return (
    <div className="min-h-[calc(100dvh-4rem)] lg:min-h-0 text-[var(--ava-text)]" style={{ background: AVA_BG }}>
      <header className="hidden lg:flex h-14 items-center gap-4 px-5 border-b border-[var(--ava-line)]" style={{ background: 'var(--ava-panel)' }}>
        <Link to={voltar} className="flex items-center gap-2 text-sm text-[var(--ava-soft)] hover:text-[var(--ava-text)]"><ChevronLeft className="w-4 h-4" /> Disciplinas</Link>
        <span className="w-px h-5 bg-[var(--ava-surface)]" />
        <div className="flex-1 min-w-0"><h1 className="text-sm font-semibold truncate">{curso.titulo}</h1>{curso.professor && <p className="text-[11px] text-[var(--ava-muted)] truncate">Prof. {curso.professor}</p>}</div>
        <Progresso pct={pct} feitas={feitas} total={total} />
      </header>

      <div className={`relative lg:grid lg:h-[calc(100dvh-10.25rem)] ${recolhida ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_380px]'}`}>
        <div className="lg:overflow-y-auto">
          {/* mídia: fixa no topo no celular */}
          <div className="sticky top-[53px] sm:top-[61px] z-20 lg:static bg-black">
            <div className="lg:hidden flex items-center gap-2 px-2 h-11 border-b border-[var(--ava-line)]" style={{ background: 'var(--ava-panel)' }}>
              <Link to={voltar} aria-label="Voltar" className="p-2 text-[var(--ava-soft)]"><ChevronLeft className="w-5 h-5" /></Link>
              <span className="text-[13px] font-medium truncate flex-1">{curso.titulo}</span>
              <span className="text-[11px] text-[var(--ava-muted)] pr-2">{pct}%</span>
            </div>
            <div className={`relative w-full aspect-video bg-black mx-auto ${recolhida ? 'lg:max-h-[82dvh]' : 'lg:max-h-[72dvh]'}`}>
              {aulaAtual.tipo === 'video' && aulaAtual.video_id
                ? <VimeoPlayer key={`${aulaAtual.id}-${tUrl}`} playerRef={playerRef} videoId={aulaAtual.video_id} hash={aulaAtual.video_hash} inicio={inicio}
                    onProgresso={(pos, dur, fim) => salvar(aulaAtual, pos, dur, fim ? true : undefined)}
                    onFim={() => { if (proxima) setTimeout(() => ir(proxima), 1500) }} />
                : <PainelNaoVideo aula={aulaAtual} />}
            </div>
          </div>

          <div className={`px-4 lg:px-8 py-4 ${recolhida ? 'max-w-6xl' : 'max-w-4xl'}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-[var(--ava-muted)]">{secoes.find(s => s.id === aulaAtual.secao_id)?.nome}</p>
                <h2 className="text-lg font-semibold leading-snug mt-0.5">{aulaAtual.titulo}</h2>
                {curso.professor && <p className="text-[13px] text-[var(--ava-soft)] mt-1">Prof. <span className="text-[var(--ava-gold)]">{curso.professor}</span></p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button onClick={() => anterior && ir(anterior)} disabled={!anterior} aria-label="Aula anterior"
                className="h-10 w-10 rounded-lg border border-[var(--ava-line)] flex items-center justify-center disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => proxima && ir(proxima)} disabled={!proxima}
                className="h-10 px-4 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-30" style={{ background: GOLD, color: '#111' }}>
                Próxima <ChevronRight className="w-4 h-4" /></button>
              <button onClick={() => salvar(aulaAtual, prog[aulaAtual.id]?.posicao_seg ?? 0, aulaAtual.duracao_seg ?? 0, !concluidaAtual)}
                className="h-10 px-3.5 rounded-lg border text-sm flex items-center gap-1.5"
                style={concluidaAtual ? { borderColor: GOLD, color: GOLD } : { borderColor: 'var(--ava-line)', color: 'var(--ava-soft)' }}>
                <Check className="w-4 h-4" /> {concluidaAtual ? 'Concluída' : 'Marcar como concluída'}</button>
            </div>

            <div className="mt-5 border-b border-[var(--ava-line)] flex items-stretch gap-1 text-[15px] overflow-x-auto [scrollbar-width:none] -mx-4 px-4 lg:mx-0 lg:px-0">
              <button onClick={() => { setBusca(b => (b === null ? '' : null)); if (!recolhida && desktop) setLateral('conteudo'); else setAba('conteudo') }} aria-label="Buscar aula"
                className="px-3 shrink-0 text-[var(--ava-soft)] hover:text-[var(--ava-text)]"><Search className="w-[18px] h-[18px]" /></button>
              {([['conteudo', 'Conteúdo', recolhida ? '' : 'lg:hidden'], ['assistente', 'Assistente IA', recolhida ? '' : 'lg:hidden'], ['geral', 'Visão geral', ''], ['perguntas', 'Perguntas e respostas', ''], ['anotacoes', 'Anotações', ''], ['avisos', 'Anúncios', '']] as const).map(([k, t, extra]) => (
                <button key={k} onClick={() => setAba(k)} className={`px-3 pb-3 pt-2.5 -mb-px border-b-[3px] whitespace-nowrap shrink-0 ${extra} ${aba === k ? 'font-bold' : 'font-medium'}`}
                  style={aba === k ? { borderColor: 'var(--ava-text)', color: 'var(--ava-text)' } : { borderColor: 'transparent', color: 'var(--ava-soft)' }}>{t}</button>
              ))}
            </div>
            {busca !== null && (
              <div className="mt-3">
                <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-[var(--ava-line)] bg-[var(--ava-surface)]">
                  <Search className="w-4 h-4 text-[var(--ava-muted)]" />
                  <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar aula pelo título" className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--ava-muted)]" />
                  <button onClick={() => setBusca(null)} aria-label="Fechar busca"><X className="w-4 h-4 text-[var(--ava-muted)]" /></button>
                </div>
                {busca.trim() && (
                  <div className="mt-2 rounded-lg border border-[var(--ava-line)] overflow-hidden">
                    {aulas.filter(a => a.titulo.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 12).map(a => (
                      <button key={a.id} onClick={() => { ir(a); setBusca(null) }} className="w-full text-left px-3 py-2.5 text-[13px] text-[var(--ava-soft)] hover:bg-[var(--ava-surface)] border-b border-[var(--ava-line)] last:border-0">{a.titulo}</button>
                    ))}
                    {!aulas.some(a => a.titulo.toLowerCase().includes(busca.trim().toLowerCase())) && <p className="px-3 py-3 text-[13px] text-[var(--ava-muted)]">Nenhuma aula encontrada.</p>}
                  </div>
                )}
              </div>
            )}
            {aba === 'conteudo' && <div className={`-mx-4 mt-1 ${recolhida ? 'lg:mx-0' : 'lg:hidden'}`}>{lista}</div>}
            {aba === 'assistente' && (!desktop || recolhida) && (
              <div className="-mx-4 lg:mx-0 h-[70dvh]"><AvaAssistente cursoId={curso.id} aulaId={aulaAtual.id} professor={curso.professor} chat={chat} setChat={setChat} semente={semente} onSemente={() => setSemente(null)} /></div>
            )}
            {aba === 'geral' && (
              <div className="py-4 text-sm leading-relaxed text-[var(--ava-soft)] space-y-3">
                <p className="text-base font-semibold text-[var(--ava-text)]">{curso.titulo}</p>
                <p className="text-[var(--ava-muted)]">{[curso.curso_area, curso.periodo, curso.semestre].filter(Boolean).join(' · ')}</p>
                {curso.professor && <p>Professor(a): <span className="text-[var(--ava-text)]">{curso.professor}</span></p>}
                {curso.descricao && <p className="whitespace-pre-line">{curso.descricao}</p>}
                <p className="text-[var(--ava-muted)]">{total} videoaulas · {feitas} concluídas</p>
              </div>
            )}
            {aba === 'perguntas' && <AbaPerguntas cursoId={curso.id} aulas={aulas} aulaAtual={aulaAtual} onAssistente={perguntarAoTutor} />}
            {aba === 'anotacoes' && <AbaAnotacoes cursoId={curso.id} aulas={aulas} aulaAtual={aulaAtual} playerRef={playerRef} irPara={(a, seg) => ir(a, seg)} />}
            {aba === 'avisos' && <AbaAvisos cursoId={curso.id} />}
          </div>
        </div>

        {recolhida && (
          <button onClick={alternarTeatro} aria-label="Mostrar conteúdo da disciplina" title="Mostrar conteúdo da disciplina"
            className="hidden lg:flex absolute right-0 top-24 z-30 h-11 w-9 items-center justify-center rounded-l-lg shadow-lg" style={{ background: GOLD, color: '#111' }}><PanelRightOpen className="w-5 h-5" /></button>
        )}
        <aside className={`${recolhida ? 'hidden' : 'hidden lg:flex'} flex-col border-l border-[var(--ava-line)] overflow-hidden`} style={{ background: 'var(--ava-panel2)' }}>
          <div className="flex border-b border-[var(--ava-line)] text-sm">
            {([['conteudo', 'Conteúdo da disciplina'], ['assistente', 'Assistente IA']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setLateral(k)} className="flex-1 py-3.5 font-semibold flex items-center justify-center gap-1.5 border-b-2 -mb-px"
                style={lateral === k ? { borderColor: GOLD, color: 'var(--ava-text)' } : { borderColor: 'transparent', color: 'var(--ava-muted)' }}>{k === 'assistente' && <Sparkles className="w-4 h-4" style={{ color: GOLD }} />}{t}</button>
            ))}
            <button onClick={alternarTeatro} aria-label="Modo teatro: ampliar o vídeo" title="Modo teatro" className="px-3.5 text-[var(--ava-muted)] hover:text-[var(--ava-text)] border-b-2 border-transparent"><PanelRightClose className="w-[18px] h-[18px]" /></button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {lateral === 'conteudo' ? lista : desktop && <AvaAssistente cursoId={curso.id} aulaId={aulaAtual.id} professor={curso.professor} chat={chat} setChat={setChat} semente={semente} onSemente={() => setSemente(null)} />}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Progresso({ pct, feitas, total }: { pct: number; feitas: number; total: number }) {
  return (
    <div className="flex items-center gap-2.5 text-xs text-[var(--ava-soft)]">
      <div className="w-28 h-1.5 rounded-full bg-[var(--ava-surface)] overflow-hidden"><div className="h-full" style={{ width: `${pct}%`, background: GOLD }} /></div>
      {feitas}/{total} aulas
    </div>
  )
}

function Curriculo({ secoes, aulas, prog, atual, abertas, alternar, ir, marcar }: {
  secoes: AvaCurso['secoes']; aulas: AvaAula[]; prog: Prog; atual: number; abertas: Set<number>; alternar: (id: number) => void; ir: (a: AvaAula) => void; marcar: (a: AvaAula) => void
}) {
  return (
    <div>
      {secoes.map(s => {
        const doS = aulas.filter(a => a.secao_id === s.id)
        if (!doS.length) return null
        const feitas = doS.filter(a => prog[a.id]?.concluida).length
        const seg = doS.reduce((n, a) => n + (a.duracao_seg ?? 0), 0)
        const aberta = abertas.has(s.id)
        return (
          <div key={s.id} className="border-b border-[var(--ava-line)]">
            <button onClick={() => alternar(s.id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left" style={{ background: aberta ? 'rgba(201,168,76,.08)' : 'var(--ava-surface)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: aberta ? 'var(--ava-gold)' : undefined }}>{s.nome}</p>
                <p className="text-[11px] text-[var(--ava-muted)] mt-0.5">{feitas}/{doS.length} concluídas{seg ? ` | ${fmtDuracao(seg)}` : ''}</p>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${aberta ? 'rotate-180' : ''}`} style={{ color: aberta ? 'var(--ava-gold)' : 'var(--ava-muted)' }} />
            </button>
            {aberta && doS.map(a => {
              const ehAtual = a.id === atual
              const feita = !!prog[a.id]?.concluida
              return (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3 active:bg-[var(--ava-surface)] cursor-pointer" onClick={() => ir(a)}
                  style={ehAtual ? { background: 'rgba(201,168,76,.12)' } : undefined}>
                  <button onClick={e => { e.stopPropagation(); marcar(a) }} aria-label={feita ? 'Desmarcar como concluída' : 'Marcar como concluída'}
                    className="mt-0.5 w-[18px] h-[18px] shrink-0 rounded border flex items-center justify-center"
                    style={feita ? { background: GOLD, borderColor: GOLD, color: '#111' } : { borderColor: 'var(--ava-muted)' }}>
                    {feita && <Check className="w-3 h-3" strokeWidth={3} />}
                  </button>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] leading-snug ${ehAtual ? 'text-[var(--ava-text)] font-medium' : 'text-[var(--ava-soft)]'}`}>{a.titulo}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-[var(--ava-muted)] mt-1">
                      <IconeAula a={a} feita={false} atual={false} />
                      {a.tipo === 'video' ? fmtDuracao(a.duracao_seg) || 'Vídeo' : a.tipo === 'quiz' ? 'Avaliação' : a.tipo === 'material' ? 'Material' : a.tipo === 'link' ? 'Link' : 'Leitura'}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function PainelNaoVideo({ aula }: { aula: AvaAula }) {
  const rotulo = aula.tipo === 'quiz' ? 'Fazer avaliação' : aula.tipo === 'material' ? 'Abrir material' : 'Abrir link'
  return (
    <div className="absolute inset-0 overflow-y-auto flex flex-col items-center justify-center text-center px-6 gap-3" style={{ background: 'linear-gradient(135deg,#171b25,#0f1218)' }}>
      {aula.tipo === 'texto'
        ? <p className="text-sm text-[var(--ava-soft)] whitespace-pre-line text-left max-w-xl py-6">{aula.descricao}</p>
        : <>
            <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(201,168,76,.15)', color: GOLD }}>
              {aula.tipo === 'quiz' ? <ClipboardCheck className="w-6 h-6" /> : aula.tipo === 'link' ? <ExternalLink className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
            </span>
            <p className="text-sm font-medium max-w-sm">{aula.titulo}</p>
            {aula.tipo === 'quiz' && <p className="text-xs text-[var(--ava-muted)] max-w-xs">As avaliações ainda são feitas no ambiente atual (Moodle). Em breve aqui.</p>}
            {aula.url && <a href={aula.url} target="_blank" rel="noreferrer" className="h-10 px-5 rounded-lg text-sm font-semibold inline-flex items-center" style={{ background: GOLD, color: '#111' }}>{rotulo}</a>}
          </>}
    </div>
  )
}
