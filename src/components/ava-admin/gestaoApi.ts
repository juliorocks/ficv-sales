import { supabase } from '@/lib/supabase'
import { extractFnErrorMessage } from '@/utils/functionsError'
import { withTimeout } from '@/utils/withTimeout'

export async function gestaoCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sua sessão expirou. Entre de novo.')
  const { data, error } = await withTimeout(supabase.functions.invoke('ava-gestao', { body: { action, ...payload } }), 30000, 'AVA')
  if (error) throw new Error(await extractFnErrorMessage(error, 'Não foi possível concluir agora.'))
  return data as T
}

export type Eu = { papel: string; nome: string; gestor: boolean; admin: boolean; professor: boolean; tutor: boolean }
export type CursoLinha = {
  id: number; titulo: string; curso_area: string | null; periodo: string | null; semestre: string | null; professor: string | null
  publicado: boolean; videos: number; itens: number; abertas: number
}
export type Secao = { id: number; nome: string; ordem: number; oculto: boolean }
export type Aula = {
  id: number; secao_id: number; tipo: 'video' | 'material' | 'quiz' | 'link' | 'texto' | 'forum'; titulo: string; video_id: string | null
  video_hash: string | null; thumb_url: string | null; duracao_seg: number | null; url: string | null; descricao: string | null; ordem: number; oculto: boolean
}
export type CursoCompleto = {
  curso: { id: number; moodle_id: number | null; nome: string; titulo: string; curso_area: string | null; periodo: string | null; semestre: string | null; professor: string | null; descricao: string | null; publicado: boolean }
  secoes: Secao[]; aulas: Aula[]; professores: string[]
}
export type Duvida = {
  id: number; curso_id: number; aula_id: number | null; autor_nome: string; titulo: string; texto: string; resolvida: boolean; criado_em: string
  curso_titulo: string; respondida: boolean
  respostas: { id: number; autor_tipo: string; autor_nome: string; texto: string; criado_em: string }[]
}
export type AvisoAdmin = { id: number; curso_id: number | null; titulo: string; texto: string; autor_nome: string | null; publicado: boolean; criado_em: string }
