/** Formata string numérica para 000.000.000-00 */
export function formatCPF(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/** Valida CPF com dígitos verificadores */
export function validateCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1+$/.test(digits)) return false // todos iguais (111.111.111-11 etc.)

  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += parseInt(digits[i]) * (len + 1 - i)
    const rem = (sum * 10) % 11
    return rem === 10 || rem === 11 ? 0 : rem
  }

  return calc(9) === parseInt(digits[9]) && calc(10) === parseInt(digits[10])
}

/** Retorna CPF sem formatação */
export function stripCPF(cpf: string): string {
  return cpf.replace(/\D/g, '')
}
