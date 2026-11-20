import { supabase } from '../../lib/supabase'
import { extractFnErrorMessage } from '../../utils/functionsError'
import { withTimeout } from '../../utils/withTimeout'

export type AvaCursoResumo = {
  id: number; moodle_id: number; titulo: string; nome: string; curso_area: string | null; periodo: string | null
  semestre: string | null; professor: string | null; capa_url: string | null
  total_aulas: number; concluidas: number; ultimo_acesso: string | null; inscrito?: boolean
}
export type AvaSecao = { id: number; nome: string; ordem: number }
export type AvaAula = {
  id: number; secao_id: number; tipo: 'video' | 'material' | 'quiz' | 'link' | 'texto' | 'forum'
  titulo: string; video_id: string | null; video_hash: string | null; thumb_url: string | null
  duracao_seg: number | null; url: string | null; descricao: string | null; ordem: number
}
export type AvaProgresso = { aula_id: number; posicao_seg: number; concluida: boolean }
export type AvaCurso = {
  curso: { id: number; moodle_id: number; titulo: string; nome: string; curso_area: string | null; periodo: string | null; semestre: string | null; professor: string | null; descricao: string | null; capa_url: string | null }
  secoes: AvaSecao[]; aulas: AvaAula[]; progresso: AvaProgresso[]
}

export async function avaCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await withTimeout(supabase.functions.invoke('ava-api', { body: { action, ...payload } }), 20000, 'ava-api')
  if (error) throw new Error(await extractFnErrorMessage(error, 'Não foi possível carregar agora.'))
  return data as T
}

export function fmtDuracao(seg: number | null | undefined): string {
  if (!seg || seg < 1) return ''
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60)
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  return `${Math.max(1, m)} min`
}

export const AVA_BG = '#0B0D12'

const POS_NOMES: Record<string, string> = {
  TNT: 'Teologia Bíblica e Exegética do Novo Testamento', GE: 'Gestão Escolar', LC: 'Liderança Cristã', MU: 'Missiologia Urbana',
  PSIP: 'Psicopedagogia', PSIT: 'Psicoteologia', TS: 'Teologia Sistemática', ECC: 'Educação Cristã Clássica', CP: 'Formação Política', HC: 'História do Cristianismo',
}
const capitaliza = (t: string) => t.toLowerCase().replace(/(^|\s)(\S)/g, (_, x, y) => x + y.toUpperCase())

/** Curso do aluno ao qual a disciplina pertence (graduação = área; pós = programa, ex.: POSECC). */
export function programaDe(c: { nome: string; curso_area: string | null }): { key: string; label: string; nivel: string } {
  const pos = c.nome.match(/\bPOS([A-Z]+)\b/i)
  if (/^P[ÓO]S$/i.test(c.curso_area ?? '') || pos) {
    const sigla = (pos?.[1] ?? 'OUTROS').toUpperCase()
    return { key: `pos-${sigla.toLowerCase()}`, label: POS_NOMES[sigla] ?? `Pós ${sigla}`, nivel: 'Pós-graduação' }
  }
  const area = c.curso_area ?? 'Outros'
  return { key: area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-'), label: capitaliza(area), nivel: 'Graduação EAD' }
}

export type AvaAnotacao = { id: number; aula_id: number; segundos: number; texto: string; criado_em: string }
export type AvaResposta = { id: number; pergunta_id: number; autor_tipo: 'aluno' | 'professor' | 'equipe'; autor_nome: string; texto: string; criado_em: string }
export type AvaPergunta = { id: number; aula_id: number | null; autor_nome: string; titulo: string; texto: string; resolvida: boolean; criado_em: string; minha: boolean; respostas: AvaResposta[] }
export type AvaAviso = { id: number; curso_id: number | null; titulo: string; texto: string; autor_nome: string | null; criado_em: string }
export type MsgChat = { role: 'user' | 'assistant'; content: string }

export const fmtTempo = (seg: number) => { const m = Math.floor(seg / 60), s = Math.floor(seg % 60); return `${m}:${String(s).padStart(2, '0')}` }
export function haQuanto(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 90) return 'agora há pouco'
  if (d < 3600) return `${Math.floor(d / 60)} min atrás`
  if (d < 86400) return `${Math.floor(d / 3600)} h atrás`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} dias atrás`
  return new Date(iso).toLocaleDateString('pt-BR')
}
