import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlignLeft, Check, Sparkles, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink, FileText, Loader2, Play } from 'lucide-react'
import { avaCall, AVA_BG, fmtDuracao, programaDe, type AvaAula, type AvaCurso, type MsgChat } from './avaApi'
import { AvaAssistente } from './AvaAssistente'
import { AbaAnotacoes, AbaAvisos, AbaPerguntas } from './AvaAbas'
import { VimeoPlayer } from './VimeoPlayer'

const GOLD = '#C9A84C'
type Prog = Record<number, { posicao_seg: number; concluida: boolean }>

function IconeAula({ a, feita, atual }: { a: AvaAula; feita: boolean; atual: boolean }) {
  if (feita) return <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: GOLD }} />
  const cls = `w-4 h-4 shrink-0 ${atual ? 'text-white' : 'text-[#8A8A9A]'}`
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
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center text-[#F0EDE8]" style={{ background: AVA_BG }}>
        <p className="text-sm text-[#8A8A9A]">{(q.error as Error)?.message ?? 'Disciplina indisponível.'}</p>
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
  const perguntarAoTutor = (t: string) => { setSemente(t); if (window.matchMedia('(min-width: 1024px)').matches) setLateral('assistente'); else setAba('assistente') }

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

  if (!aulaAtual) return <div className="min-h-dvh p-8 text-[#8A8A9A]" style={{ background: AVA_BG }}>Esta disciplina ainda não tem conteúdo.</div>

  const voltar = `/ava/c/${programaDe(curso).key}`
  const concluidaAtual = !!prog[aulaAtual.id]?.concluida
  const lista = (
    <Curriculo secoes={secoes} aulas={aulas} prog={prog} atual={aulaAtual.id} abertas={abertas}
      alternar={id => setAbertas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })} ir={ir}
      marcar={a => salvar(a, prog[a.id]?.posicao_seg ?? 0, a.duracao_seg ?? 0, !prog[a.id]?.concluida)} />
  )

  return (
    <div className="min-h-dvh text-[#F0EDE8]" style={{ background: AVA_BG }}>
      <header className="hidden lg:flex h-14 items-center gap-4 px-5 border-b border-white/10" style={{ background: '#13161D' }}>
        <Link to={voltar} className="flex items-center gap-2 text-sm text-[#cfcfd6] hover:text-white"><ChevronLeft className="w-4 h-4" /> Disciplinas</Link>
        <span className="w-px h-5 bg-white/15" />
        <div className="flex-1 min-w-0"><h1 className="text-sm font-semibold truncate">{curso.titulo}</h1>{curso.professor && <p className="text-[11px] text-[#8A8A9A] truncate">Prof. {curso.professor}</p>}</div>
        <Progresso pct={pct} feitas={feitas} total={total} />
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:h-[calc(100dvh-3.5rem)]">
        <div className="lg:overflow-y-auto">
          {/* mídia: fixa no topo no celular */}
          <div className="sticky top-0 z-20 lg:static bg-black">
            <div className="lg:hidden flex items-center gap-2 px-2 h-11 border-b border-white/10" style={{ background: '#13161D' }}>
              <Link to={voltar} aria-label="Voltar" className="p-2 text-[#cfcfd6]"><ChevronLeft className="w-5 h-5" /></Link>
              <span className="text-[13px] font-medium truncate flex-1">{curso.titulo}</span>
              <span className="text-[11px] text-[#8A8A9A] pr-2">{pct}%</span>
            </div>
            <div className="relative w-full aspect-video lg:max-h-[72dvh] bg-black mx-auto">
              {aulaAtual.tipo === 'video' && aulaAtual.video_id
                ? <VimeoPlayer key={`${aulaAtual.id}-${tUrl}`} playerRef={playerRef} videoId={aulaAtual.video_id} hash={aulaAtual.video_hash} inicio={inicio}
                    onProgresso={(pos, dur, fim) => salvar(aulaAtual, pos, dur, fim ? true : undefined)}
                    onFim={() => { if (proxima) setTimeout(() => ir(proxima), 1500) }} />
                : <PainelNaoVideo aula={aulaAtual} />}
            </div>
          </div>

          <div className="px-4 lg:px-8 py-4 max-w-4xl">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-[#8A8A9A]">{secoes.find(s => s.id === aulaAtual.secao_id)?.nome}</p>
                <h2 className="text-lg font-semibold leading-snug mt-0.5">{aulaAtual.titulo}</h2>
                {curso.professor && <p className="text-[13px] text-[#cfcfd6] mt-1">Prof. <span className="text-[#E0BF6A]">{curso.professor}</span></p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button onClick={() => anterior && ir(anterior)} disabled={!anterior} aria-label="Aula anterior"
                className="h-10 w-10 rounded-lg border border-white/15 flex items-center justify-center disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => proxima && ir(proxima)} disabled={!proxima}
                className="h-10 px-4 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-30" style={{ background: GOLD, color: '#111' }}>
                Próxima <ChevronRight className="w-4 h-4" /></button>
              <button onClick={() => salvar(aulaAtual, prog[aulaAtual.id]?.posicao_seg ?? 0, aulaAtual.duracao_seg ?? 0, !concluidaAtual)}
                className="h-10 px-3.5 rounded-lg border text-sm flex items-center gap-1.5"
                style={concluidaAtual ? { borderColor: GOLD, color: GOLD } : { borderColor: 'rgba(255,255,255,.15)', color: '#cfcfd6' }}>
                <Check className="w-4 h-4" /> {concluidaAtual ? 'Concluída' : 'Marcar como concluída'}</button>
            </div>

            <div className="mt-5 border-b border-white/10 flex gap-5 text-sm overflow-x-auto [scrollbar-width:none] -mx-4 px-4 lg:mx-0 lg:px-0">
              {([['conteudo', 'Conteúdo', 'lg:hidden'], ['assistente', 'Assistente IA', 'lg:hidden'], ['geral', 'Visão geral', ''], ['perguntas', 'Perguntas e respostas', ''], ['anotacoes', 'Anotações', ''], ['avisos', 'Avisos', '']] as const).map(([k, t, extra]) => (
                <button key={k} onClick={() => setAba(k)} className={`pb-2.5 -mb-px border-b-2 whitespace-nowrap shrink-0 ${extra}`}
                  style={aba === k ? { borderColor: GOLD, color: '#fff' } : { borderColor: 'transparent', color: '#8A8A9A' }}>{t}</button>
              ))}
            </div>
            {aba === 'conteudo' && <div className="lg:hidden -mx-4 mt-1">{lista}</div>}
            {aba === 'assistente' && !desktop && (
              <div className="-mx-4 h-[70dvh]"><AvaAssistente cursoId={curso.id} aulaId={aulaAtual.id} professor={curso.professor} chat={chat} setChat={setChat} semente={semente} onSemente={() => setSemente(null)} /></div>
            )}
            {aba === 'geral' && (
              <div className="py-4 text-sm leading-relaxed text-[#cfcfd6] space-y-3">
                <p className="text-base font-semibold text-white">{curso.titulo}</p>
                <p className="text-[#8A8A9A]">{[curso.curso_area, curso.periodo, curso.semestre].filter(Boolean).join(' · ')}</p>
                {curso.professor && <p>Professor(a): <span className="text-white">{curso.professor}</span></p>}
                {curso.descricao && <p className="whitespace-pre-line">{curso.descricao}</p>}
                <p className="text-[#8A8A9A]">{total} videoaulas · {feitas} concluídas</p>
              </div>
            )}
            {aba === 'perguntas' && <AbaPerguntas cursoId={curso.id} aulas={aulas} aulaAtual={aulaAtual} onAssistente={perguntarAoTutor} />}
            {aba === 'anotacoes' && <AbaAnotacoes cursoId={curso.id} aulas={aulas} aulaAtual={aulaAtual} playerRef={playerRef} irPara={(a, seg) => ir(a, seg)} />}
            {aba === 'avisos' && <AbaAvisos cursoId={curso.id} />}
          </div>
        </div>

        <aside className="hidden lg:flex flex-col border-l border-white/10 overflow-hidden" style={{ background: '#101319' }}>
          <div className="flex border-b border-white/10 text-sm">
            {([['conteudo', 'Conteúdo da disciplina'], ['assistente', 'Assistente IA']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setLateral(k)} className="flex-1 py-3.5 font-semibold flex items-center justify-center gap-1.5 border-b-2 -mb-px"
                style={lateral === k ? { borderColor: GOLD, color: '#fff' } : { borderColor: 'transparent', color: '#8A8A9A' }}>{k === 'assistente' && <Sparkles className="w-4 h-4" style={{ color: GOLD }} />}{t}</button>
            ))}
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
    <div className="flex items-center gap-2.5 text-xs text-[#cfcfd6]">
      <div className="w-28 h-1.5 rounded-full bg-white/15 overflow-hidden"><div className="h-full" style={{ width: `${pct}%`, background: GOLD }} /></div>
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
          <div key={s.id} className="border-b border-white/10">
            <button onClick={() => alternar(s.id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left" style={{ background: aberta ? 'rgba(201,168,76,.08)' : 'rgba(255,255,255,.03)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: aberta ? '#E0BF6A' : undefined }}>{s.nome}</p>
                <p className="text-[11px] text-[#8A8A9A] mt-0.5">{feitas}/{doS.length} concluídas{seg ? ` | ${fmtDuracao(seg)}` : ''}</p>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${aberta ? 'rotate-180' : ''}`} style={{ color: aberta ? '#E0BF6A' : '#8A8A9A' }} />
            </button>
            {aberta && doS.map(a => {
              const ehAtual = a.id === atual
              const feita = !!prog[a.id]?.concluida
              return (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3 active:bg-white/5 cursor-pointer" onClick={() => ir(a)}
                  style={ehAtual ? { background: 'rgba(201,168,76,.12)' } : undefined}>
                  <button onClick={e => { e.stopPropagation(); marcar(a) }} aria-label={feita ? 'Desmarcar como concluída' : 'Marcar como concluída'}
                    className="mt-0.5 w-[18px] h-[18px] shrink-0 rounded border flex items-center justify-center"
                    style={feita ? { background: GOLD, borderColor: GOLD, color: '#111' } : { borderColor: 'rgba(255,255,255,.35)' }}>
                    {feita && <Check className="w-3 h-3" strokeWidth={3} />}
                  </button>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] leading-snug ${ehAtual ? 'text-white font-medium' : 'text-[#cfcfd6]'}`}>{a.titulo}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-[#8A8A9A] mt-1">
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
        ? <p className="text-sm text-[#cfcfd6] whitespace-pre-line text-left max-w-xl py-6">{aula.descricao}</p>
        : <>
            <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(201,168,76,.15)', color: GOLD }}>
              {aula.tipo === 'quiz' ? <ClipboardCheck className="w-6 h-6" /> : aula.tipo === 'link' ? <ExternalLink className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
            </span>
            <p className="text-sm font-medium max-w-sm">{aula.titulo}</p>
            {aula.tipo === 'quiz' && <p className="text-xs text-[#8A8A9A] max-w-xs">As avaliações ainda são feitas no ambiente atual (Moodle). Em breve aqui.</p>}
            {aula.url && <a href={aula.url} target="_blank" rel="noreferrer" className="h-10 px-5 rounded-lg text-sm font-semibold inline-flex items-center" style={{ background: GOLD, color: '#111' }}>{rotulo}</a>}
          </>}
    </div>
  )
}
