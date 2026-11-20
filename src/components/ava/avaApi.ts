import { supabase } from '../../lib/supabase'
import { extractFnErrorMessage } from '../../utils/functionsError'
import { withTimeout } from '../../utils/withTimeout'

export type AvaCursoResumo = {
  id: number; moodle_id: number; titulo: string; nome: string; curso_area: string | null; periodo: string | null
  semestre: string | null; professor: string | null; capa_url: string | null
  total_aulas: number; concluidas: number; ultimo_acesso: string | null
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
