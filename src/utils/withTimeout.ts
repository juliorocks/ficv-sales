/**
 * Corre uma promise contra um timeout. Usado nas mutations do Supabase: quando o
 * access token está expirado, o supabase-js às vezes SEGURA a request esperando um
 * refresh que não volta — o botão fica "Salvando..." pra sempre. Melhor falhar em
 * ~15s com uma mensagem clara do que travar a tela.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms = 15000, label = "A operação"): Promise<T> {
    return Promise.race([
        Promise.resolve(promise),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} demorou demais. Verifique a conexão e recarregue a página.`)), ms),
        ),
    ])
}
