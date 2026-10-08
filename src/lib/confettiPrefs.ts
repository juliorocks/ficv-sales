// Preferência PESSOAL (por navegador, não sincroniza entre dispositivos — é só um gostinho de
// UI, não precisa de banco) de ligar/desligar o confete de nova matrícula. Padrão: ligado.
const KEY = 'ficv_confetti_matricula'

export function isConfettiEnabled(): boolean {
    try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setConfettiEnabled(v: boolean) {
    try { localStorage.setItem(KEY, v ? 'on' : 'off') } catch { /* sem storage */ }
}
