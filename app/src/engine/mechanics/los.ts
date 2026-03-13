/**
 * los.ts — Cálculo de Línea de Visión (LOS)
 *
 * Regla 14.0: La LOS se determina trazando un hilo entre los puntos centrales
 * de los hexágonos. Se bloquea si hay terreno BLOQUEANTE (Buildings, Hedgerows,
 * Woods) en hexes intermedios que sea de igual o mayor elevación que ambas
 * unidades (firer y target).
 */

import type { HexData } from '../../types'
import { isLOSBlockingTerrain } from './terrain'

// ─── Conversión de coordenadas ────────────────────────────────────────────────

/** Convierte coordenadas offset flat-top (odd-q) a coordenadas cúbicas. */
function toCube(col: number, row: number): [number, number, number] {
  const q = col
  const r = row - (col - (col & 1)) / 2
  return [q, r, -q - r]
}

/** Convierte coordenadas cúbicas a coordenadas offset flat-top (odd-q). */
function fromCube(q: number, r: number): [number, number] {
  const col = q
  const row = r + (col - (col & 1)) / 2
  return [col, row]
}

/** Redondea coordenadas cúbicas fraccionarias al hex más cercano. */
function cubeRound(q: number, r: number, s: number): [number, number, number] {
  let rq = Math.round(q)
  let rr = Math.round(r)
  let rs = Math.round(s)

  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)

  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds)        rr = -rq - rs
  else                     rs = -rq - rr

  return [rq, rr, rs]
}

/** Interpola linealmente entre dos puntos cúbicos. */
function cubeLerp(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
  ]
}

const EPS = 1e-6

/** Devuelve el HexData en las coordenadas cúbicas dadas, o undefined si no existe. */
function hexAtCube(
  q: number, r: number, s: number,
  hexMap: Map<string, HexData>,
): HexData | undefined {
  const [rq, rr, rs] = cubeRound(q, r, s)
  void rs
  const [col, row] = fromCube(rq, rr)
  return hexMap.get(`${col},${row}`)
}

/** Distancia en hexes entre dos posiciones (coordenadas offset). */
export function hexDistance(
  col1: number, row1: number,
  col2: number, row2: number,
): number {
  const [q1, r1, s1] = toCube(col1, row1)
  const [q2, r2, s2] = toCube(col2, row2)
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2))
}

// ─── Hexes en línea ───────────────────────────────────────────────────────────

/**
 * Devuelve los hexes INTERMEDIOS (sin incluir from ni to) que forman
 * la línea recta entre dos hexes, usando interpolación de coordenadas cúbicas.
 *
 * Para manejar el "caso espina" (la línea pasa exactamente por el borde entre
 * dos hexes) se prueban dos nudges opuestos y se devuelve la unión de ambos
 * conjuntos. Esto sirve para visualización; la lógica de bloqueo usa ambos
 * nudges por separado (ver computeLOS).
 */
export function hexesBetween(
  from: HexData,
  to:   HexData,
  hexMap: Map<string, HexData>,
): HexData[] {
  const c1 = toCube(from.col, from.row)
  const c2 = toCube(to.col, to.row)
  const dist = Math.max(Math.abs(c1[0] - c2[0]), Math.abs(c1[1] - c2[1]), Math.abs(c1[2] - c2[2]))

  if (dist <= 1) return []

  const seen = new Set<string>()
  const result: HexData[] = []

  for (let i = 1; i < dist; i++) {
    const t = i / dist
    const [q, r, s] = cubeLerp(c1, c2, t)
    // Probar ambas direcciones de nudge para capturar todos los hexes del camino
    for (const e of [EPS, -EPS]) {
      const hex = hexAtCube(q + e, r + e, s - 2 * e, hexMap)
      if (hex && !seen.has(hex.id)) {
        seen.add(hex.id)
        result.push(hex)
      }
    }
  }

  return result
}

// ─── Resultado de LOS ─────────────────────────────────────────────────────────

export interface LOSResult {
  /** true si la LOS está BLOQUEADA (no se puede disparar) */
  blocked:   boolean
  /** Número de hexes que producen Hindrance (entorpecimiento) */
  hindrance: number
  /** Hexes intermedios que participan en el cálculo */
  path:      HexData[]
}

// ─── Cálculo principal de LOS ────────────────────────────────────────────────

/**
 * Construye un mapa rápido de HexData indexado por "col,row"
 * a partir del array de hexes del escenario.
 */
export function buildHexMap(hexes: HexData[]): Map<string, HexData> {
  return new Map(hexes.map(h => [`${h.col},${h.row}`, h]))
}

/** Devuelve true si un hex bloquea la LOS dado el umbral de elevación. */
function isBlockingHex(hex: HexData, minElevation: number): boolean {
  if (hex.elevation < minElevation) return false
  if (isLOSBlockingTerrain(hex.terrain)) return true
  // Seto en cualquier lado del hex (simplificación: tratamos la presencia de
  // setos en el hex como bloqueante potencial)
  return Object.values(hex.sides).some(Boolean)
}

/**
 * Calcula la LOS entre dos hexes.
 *
 * @param from       Hex desde el que se traza la LOS (posición del firer)
 * @param to         Hex destino (posición del target)
 * @param hexMap     Mapa preconstruido col,row → HexData
 * @returns LOSResult con blocked, hindrance y path
 *
 * Reglas aplicadas:
 * - Los objetos en los hexes de origen y destino NO afectan la LOS (14.0).
 * - Roads, ríos, puentes NO bloquean la LOS (14.0).
 * - Terrain bloqueante (Bosque, Edif. Piedra, Edif. Madera) en un hex intermedio
 *   bloquea la LOS si ese hex es de igual o mayor elevación que la mínima
 *   elevación entre firer y target.
 * - Los setos (hedgerows) en lados de hexes intermedios también pueden bloquear.
 *
 * Manejo del "caso espina": cuando la línea pasa exactamente por el borde entre
 * dos hexes, se prueba con dos nudges opuestos. Solo se bloquea si AMBOS nudges
 * coinciden en que la posición es bloqueante (o ambos hexes del borde bloquean).
 * Esto evita falsos bloqueos cuando la LOS roza el borde de un hex bloqueante.
 */
export function computeLOS(
  from:       HexData,
  to:         HexData,
  hexMap:     Map<string, HexData>,
  smokeHexes?: Record<string, 'fresh' | 'dispersed'>,
): LOSResult {
  const c1 = toCube(from.col, from.row)
  const c2 = toCube(to.col, to.row)
  const dist = Math.max(Math.abs(c1[0] - c2[0]), Math.abs(c1[1] - c2[1]), Math.abs(c1[2] - c2[2]))

  // Calcular path para visualización (unión de ambos nudges)
  const path = hexesBetween(from, to, hexMap)

  if (dist <= 1) return { blocked: false, hindrance: 0, path }

  const minElevation = Math.min(from.elevation, to.elevation)
  let hindranceCount = 0
  const seenForSmoke = new Set<string>()

  for (let i = 1; i < dist; i++) {
    const t = i / dist
    const [q, r, s] = cubeLerp(c1, c2, t)

    const hexA = hexAtCube(q + EPS, r + EPS, s - 2 * EPS, hexMap)
    const hexB = hexAtCube(q - EPS, r - EPS, s + 2 * EPS, hexMap)

    if (!hexA && !hexB) continue

    if (!hexA || !hexB || hexA.id === hexB.id) {
      // La línea pasa por el interior de un único hex
      const hex = hexA ?? hexB!
      if (isBlockingHex(hex, minElevation)) {
        return { blocked: true, hindrance: hindranceCount, path }
      }
      // Smoke hindrance
      if (smokeHexes && hex.id in smokeHexes && !seenForSmoke.has(hex.id)) {
        seenForSmoke.add(hex.id)
        hindranceCount++
      }
    } else {
      // "Caso espina": la línea pasa por el borde entre hexA y hexB.
      // Solo bloquea si AMBOS lados son bloqueantes.
      if (isBlockingHex(hexA, minElevation) && isBlockingHex(hexB, minElevation)) {
        return { blocked: true, hindrance: hindranceCount, path }
      }
      // Smoke: contar cada hex espina solo una vez
      for (const hex of [hexA, hexB]) {
        if (smokeHexes && hex.id in smokeHexes && !seenForSmoke.has(hex.id)) {
          seenForSmoke.add(hex.id)
          hindranceCount++
        }
      }
    }
  }

  return { blocked: false, hindrance: hindranceCount, path }
}

/**
 * Versión simplificada para comprobar rápidamente si hay LOS.
 */
export function hasLOS(
  from:   HexData,
  to:     HexData,
  hexMap: Map<string, HexData>,
): boolean {
  return !computeLOS(from, to, hexMap).blocked
}
