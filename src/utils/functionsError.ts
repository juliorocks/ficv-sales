// supabase.functions.invoke() devolve, pra qualquer status != 2xx, um FunctionsHttpError
// genérico ("Edge Function returned a non-2xx status code") — o corpo de verdade (ex.: "Lead
// sem número do VivaConnect", "Falha ao logar no WideChat"...) fica escondido dentro de
// `error.context` (a Response crua), que precisa ser lido à parte. Sem isso, toda tela que só
// faz `showError(e.message)` mostra essa frase genérica pra QUALQUER erro de function —
// achado ao vivo 08/10 (botão "Finalizar"): duas causas bem diferentes (lead sem canal,
// integração WideChat fora do ar) mostravam exatamente a mesma mensagem inútil.
export async function extractFnErrorMessage(error: unknown, fallback = "Erro desconhecido"): Promise<string> {
    const ctx = (error as { context?: Response })?.context
    if (ctx && typeof ctx.json === "function") {
        try {
            const body = await ctx.clone().json()
            const msg = body?.error ?? body?.message
            if (typeof msg === "string" && msg.trim()) return msg
        } catch { /* corpo não é JSON — segue pro fallback */ }
    }
    return (error as { message?: string })?.message || fallback
}
