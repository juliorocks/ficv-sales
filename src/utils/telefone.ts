// Mesma regra de validarTelefone em supabase/functions/_shared/vivaconnect.ts: número que a Meta nunca entrega.
const dddBr = (ddd: string) => /^[1-9][1-9]$/.test(ddd)

export function telefoneInvalido(raw: string | null | undefined): string | null {
    let d = (raw ?? '').replace(/\D/g, '')
    if (!d) return null
    if (d.startsWith('00') && d.length >= 12) d = d.replace(/^0+/, '')
    if (!d.startsWith('55') && (d.length === 10 || (d.length === 11 && d[2] === '9'))) d = '55' + d
    if (d.length < 10) return 'Telefone curto demais.'
    if (d.length > 15) return `O número tem ${d.length} dígitos (o máximo é 15).`
    if (d.startsWith('55')) {
        if (d.length !== 12 && d.length !== 13) return `Número brasileiro com ${d.length} dígitos: o certo é DDD + 8 ou 9 dígitos.`
        if (!dddBr(d.slice(2, 4))) return `O DDD ${d.slice(2, 4)} não existe.`
        if (d.length === 13 && d[4] !== '9') return 'Celular de 9 dígitos precisa começar com 9.'
        return null
    }
    if ((d.length === 12 || d.length === 13) && dddBr(d.slice(0, 2)) && d[2] === '9') return `Parece um número brasileiro com dígito a mais (${d.length} dígitos).`
    return null
}
