// Som de notificação (08/10, pedido do usuário): toca quando um lead novo entra no Kanban
// e/ou quando chega resposta nova de cliente em lead já atribuído ao agente logado.
// 3 níveis por agente/navegador: desligado, só leads novos, leads + mensagens.
// Gerado na hora via Web Audio API (um "ding" de dois tons) — sem asset pra baixar.
export type SoundScope = "off" | "new_leads" | "all"
const SCOPE_KEY = "ficv_lead_sound_scope"

export function getSoundScope(): SoundScope {
    try {
        const v = localStorage.getItem(SCOPE_KEY)
        if (v === "off" || v === "new_leads" || v === "all") return v
    } catch { /* sem storage */ }
    return "new_leads" // padrão: comportamento original (só lead novo)
}

export function setSoundScope(scope: SoundScope) {
    try { localStorage.setItem(SCOPE_KEY, scope) } catch { /* sem storage */ }
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

function chime() {
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

/** Toca ao entrar lead novo no Kanban — toca nos níveis "new_leads" e "all". */
export function playNewLeadSound() {
    if (getSoundScope() === "off") return
    chime()
}

/** Toca quando chega mensagem nova de cliente em lead do agente logado — só no nível "all". */
export function playReplySound() {
    if (getSoundScope() !== "all") return
    chime()
}
