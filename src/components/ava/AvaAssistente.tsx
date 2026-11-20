import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { avaCall, type MsgChat } from './avaApi'

const GOLD = '#C9A84C'

export function AvaAssistente({ cursoId, aulaId, professor, chat, setChat, semente, onSemente }: {
  cursoId: number; aulaId: number; professor: string | null
  chat: MsgChat[]; setChat: React.Dispatch<React.SetStateAction<MsgChat[]>>
  semente: string | null; onSemente: () => void
}) {
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(false)
  const fim = useRef<HTMLDivElement>(null)
  const chatRef = useRef(chat); chatRef.current = chat

  async function enviar(t: string) {
    const pergunta = t.trim()
    if (!pergunta || carregando) return
    const historico: MsgChat[] = [...chatRef.current, { role: 'user', content: pergunta }]
    setChat(historico); setTexto(''); setCarregando(true)
    try {
      const r = await avaCall<{ resposta: string }>('assistente', { curso_id: cursoId, aula_id: aulaId, mensagens: historico })
      setChat(c => [...c, { role: 'assistant', content: r.resposta }])
    } catch (e) {
      setChat(c => [...c, { role: 'assistant', content: (e as Error).message || 'Não consegui responder agora. Tente de novo em instantes.' }])
    } finally { setCarregando(false) }
  }

  useEffect(() => { if (semente) { onSemente(); enviar(semente) } }, [semente]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [chat.length, carregando])

  const sugestoes = [
    ...(professor ? ['Fale sobre o professor desta disciplina'] : []),
    'Dê uma visão geral desta aula',
    'Como funcionam as avaliações (AV1 e AV2)?',
    'O que vou estudar nesta disciplina?',
  ]

  return (
    <div className="flex flex-col h-full min-h-[60dvh] lg:min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {chat.length === 0 && (
          <>
            <h3 className="text-base font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: GOLD }} /> Dúvidas sobre esta disciplina?</h3>
            <p className="text-xs text-[#8A8A9A] leading-relaxed">Sou o Tutor Virtual da FICV, um assistente de IA. Posso errar: confira as informações importantes. Não tenho a transcrição dos vídeos; para dúvidas do conteúdo, use também "Perguntas e respostas".</p>
            <div className="space-y-2 pt-1">
              {sugestoes.map(s => (
                <button key={s} onClick={() => enviar(s)} className="w-full text-left text-sm rounded-lg border border-white/15 px-3.5 py-3 text-[#e5e5ea] hover:border-[#C9A84C]/60 active:bg-white/5">{s}</button>
              ))}
            </div>
          </>
        )}
        {chat.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line"
              style={m.role === 'user' ? { background: GOLD, color: '#111', borderBottomRightRadius: 6 } : { background: 'rgba(255,255,255,.07)', color: '#e5e5ea', borderBottomLeftRadius: 6 }}>{m.content}</div>
          </div>
        ))}
        {carregando && <div className="flex justify-start"><div className="rounded-2xl px-3.5 py-2.5 bg-white/7" style={{ background: 'rgba(255,255,255,.07)' }}><Loader2 className="w-4 h-4 animate-spin text-[#8A8A9A]" /></div></div>}
        <div ref={fim} />
      </div>
      <form onSubmit={e => { e.preventDefault(); enviar(texto) }} className="p-3 border-t border-white/10 flex items-end gap-2">
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={1} maxLength={1500} placeholder="Fazer uma pergunta"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(texto) } }}
          className="flex-1 resize-none max-h-32 rounded-lg bg-white/5 border border-white/15 px-3 py-2.5 text-sm text-white placeholder:text-[#6b6b78] outline-none focus:border-[#C9A84C]/70" />
        <button type="submit" disabled={!texto.trim() || carregando} aria-label="Enviar"
          className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center disabled:opacity-40" style={{ background: GOLD, color: '#111' }}><ArrowUp className="w-5 h-5" /></button>
      </form>
    </div>
  )
}
