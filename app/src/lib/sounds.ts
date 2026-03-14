/**
 * sounds.ts — Efectos de sonido sintetizados con Web Audio API.
 *
 * No requiere archivos externos: todos los sonidos se generan proceduralmente.
 * El AudioContext se inicializa de forma lazy en el primer uso para cumplir
 * con la política de autoplay de los navegadores (requiere gesto del usuario).
 */

let _ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!_ctx) {
      _ctx = new AudioContext()
    }
    if (_ctx.state === 'suspended') {
      void _ctx.resume()
    }
    return _ctx
  } catch {
    return null
  }
}

/**
 * Genera un burst de ruido blanco filtrado con envolvente de amplitud.
 *
 * @param ctx        AudioContext activo
 * @param start      Tiempo de inicio (ctx.currentTime + offset)
 * @param duration   Duración del burst en segundos
 * @param gainPeak   Nivel de pico de ganancia (0–1)
 * @param filterFreq Frecuencia del filtro en Hz
 * @param filterType Tipo de filtro BiquadFilter
 */
function noiseBurst(
  ctx:        AudioContext,
  start:      number,
  duration:   number,
  gainPeak:   number,
  filterFreq: number,
  filterType: BiquadFilterType,
): void {
  const bufLen = Math.floor(ctx.sampleRate * duration)
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data   = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1

  const src = ctx.createBufferSource()
  src.buffer = buf

  const flt = ctx.createBiquadFilter()
  flt.type           = filterType
  flt.frequency.value = filterFreq

  const g = ctx.createGain()
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(gainPeak, start + duration * 0.07)
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  src.connect(flt)
  flt.connect(g)
  g.connect(ctx.destination)
  src.start(start)
  src.stop(start + duration + 0.01)
}

/**
 * Sonido de tropas moviéndose: 4 golpes sordos rítmicos (pasos de marcha).
 * Ruido blanco filtrado por paso-bajo para dar sensación de pisadas.
 */
export function playMoveSound(): void {
  const ctx = getCtx()
  if (!ctx) return
  for (let i = 0; i < 4; i++) {
    noiseBurst(ctx, ctx.currentTime + i * 0.13, 0.07, 0.22, 380, 'lowpass')
  }
}

/**
 * Sonido de disparo de ametralladora: 6 ráfagas cortas y rápidas.
 * Ruido blanco filtrado por paso-banda para simular el chasquido del disparo.
 */
export function playFireSound(): void {
  const ctx = getCtx()
  if (!ctx) return
  for (let i = 0; i < 6; i++) {
    noiseBurst(ctx, ctx.currentTime + i * 0.08, 0.048, 0.52, 900, 'bandpass')
  }
}
