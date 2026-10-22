// Chamadas da Avaliação CPA para o painel (cpa-admin). Compartilhado entre CpaAdmin e CpaEditor.
import { supabase } from "@/lib/supabase"
import { extractFnErrorMessage } from "@/utils/functionsError"

export async function chamar<T>(action: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke("cpa-admin", { body: { action, ...body } })
    if (error) throw new Error(await extractFnErrorMessage(error, "Erro na Avaliação CPA"))
    if (data?.error) throw new Error(data.error)
    return data as T
}

export type BlocoAdmin = { id: number; ordem: number; titulo: string; incentivo: string | null }
export type PerguntaAdmin = {
    id: number; bloco_id: number; ordem: number; texto: string; tipo: "escala" | "escolha" | "texto"
    escala_min: number | null; escala_max: number | null; rotulo_min: string | null; rotulo_max: string | null
    opcoes: string[]; obrigatoria: boolean; chave: string | null
}
