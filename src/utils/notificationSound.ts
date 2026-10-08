// Som de notificação (08/10, pedido do usuário): toca quando um lead novo entra no Kanban,
// com opção de silenciar por agente. Gerado na hora via Web Audio API (um "ding" de dois tons)
// em vez de carregar um arquivo de áudio — sem asset pra baixar, sem licença pra se preocupar.
const MUTE_KEY = "ficv_lead_sound_muted"

export function isLeadSoundMuted(): boolean {
    try { return localStorage.getItem(MUTE_KEY) === "1" } catch { return false }
}

export function setLeadSoundMuted(muted: boolean) {
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0") } catch { /* sem storage */ }
}

// Um único AudioContext reaproveitado — criar um novo a cada toque esbarra no limite de
// contextos do navegador se a aba ficar aberta o dia todo recebendo leads.
let ctx: AudioContext | null = null
function getCtx(): AudioContext | null {
    try {
        if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        if (ctx.state === "suspended") ctx.resume().catch(() => { })
        return ctx
    } catch { return null }
}

/** Toca o "ding" de lead novo, a menos que o agente tenha silenciado. */
export function playLeadSound() {
    if (isLeadSoundMuted()) return
    const audioCtx = getCtx()
    if (!audioCtx) return
    try {
        const now = audioCtx.currentTime
        // dois tons subindo (tipo "novo email" de app de verdade), curto e discreto
        const tones: [number, number, number][] = [[880, now, 0.14], [1318.5, now + 0.1, 0.18]]
        for (const [freq, start, dur] of tones) {
            const osc = audioCtx.createOscillator()
            const gain = audioCtx.createGain()
            osc.type = "sine"
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0, start)
            gain.gain.linearRampToValueAtTime(0.18, start + 0.015)
            gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
            osc.connect(gain).connect(audioCtx.destination)
            osc.start(start)
            osc.stop(start + dur + 0.02)
        }
    } catch { /* autoplay bloqueado antes de qualquer interação — tudo bem, só não toca */ }
}
