/**
 * fire.ts — Resolución de ataques de fuego directo de infantería.
 *
 * Regla 6.0 y 6.2:
 * - FP Normal:    disparos estándar.
 * - FP Prof:      Op Fire, Final Op Fire, Assault Fire.
 * - Roll d10 contra FP ajustado:
 *     ≤ FP                       → Suppressed
 *     roll + casualtyReduce ≤ FP → Reduced + Fully Suppressed
 *     roll + casualtyElim   ≤ FP → Eliminated
 *     roll = 10              → Always No Effect
 *     roll = 1 (rango normal) → al menos Suppression; si adj. al menos Reduced.
 */

import type { UnitInstance, HexData, FireResult } from '../../types'
import type { InfantryStats } from '../../types'
import { rollD10 } from './dice'
import {
  terrainFireModifier,
  isOpenGround,
  movingInOpenGroundModifier,
  isBeneficialTerrain,
} from './terrain'

// ─── Tipos de fuego ───────────────────────────────────────────────────────────

export type FireMode =
  | 'normal'      // Disparo estándar (usa normalFP)
  | 'assault'     // Assault Fire (usa profFP, sin MC previo)
  | 'opfire'      // Opportunity Fire (usa profFP, unidad no usada)
  | 'finalopfire' // Final Op Fire (usa profFP, unidad usada, -2 adicional)

// ─── Parámetros de ataque ────────────────────────────────────────────────────

export interface FireAttackParams {
  /** Estadísticas activas del atacante (ya teniendo en cuenta si está reducido). */
  attackerStats:   InfantryStats
  /** Modo de fuego. */
  mode:            FireMode
  /** True si la unidad atacante está marcada como Op Fire. */
  attackerIsOpFire: boolean
  /** True si el jugador gasta 1 CP en este ataque. */
  spendCP:         boolean
  /** True si el atacante cambia su facing para disparar. */
  changeFacing:    boolean
  /** Hex en el que está el atacante. */
  attackerHex:     HexData
  /** Hex objetivo del ataque. */
  targetHex:       HexData
  /** Estadísticas de la unidad objetivo (para calcular bajas). */
  targetStats:     InfantryStats
  /** Si la unidad objetivo está actualmente Reduced. */
  targetIsReduced: boolean
  /** Si la unidad objetivo está en movimiento (para Moving in Open Ground). */
  targetIsMoving:  boolean
  /** Si la unidad objetivo tiene un Flank con respecto al atacante. */
  targetHasFlank:  boolean
  /** Distancia en hexes entre atacante y objetivo. */
  rangeHexes:      number
  /** Si la unidad objetivo está Concealed. */
  targetIsConcealed: boolean
  /** Si el atacante está a mayor elevación que el objetivo. */
  attackerHigher:  boolean
  /** Si el atacante está a menor elevación que el objetivo. */
  attackerLower:   boolean
  /** Hexes de humo en la LOS (-1 FP por hindrance). */
  hindrances?:     number
}

// ─── Cálculo del FP ajustado ─────────────────────────────────────────────────

interface FPBreakdown {
  baseFP:     number
  profModifiers: { label: string; value: number }[]
  terrainMod: number
  otherMods:  { label: string; value: number }[]
  adjustedFP: number
}

export function computeAdjustedFP(p: FireAttackParams): FPBreakdown {
  const stats = p.attackerStats
  const useProf = p.mode !== 'normal'

  // ── 1. FP base ──────────────────────────────────────────────────────────────
  // El Prof FP se usa para Op Fire, Final Op Fire y Assault Fire.
  // Si el rango supera el rango máximo → FP se divide a la mitad (rounded down).
  let baseFP = useProf ? stats.profFP : stats.normalFP

  // Fuego a largo alcance (>rangeMax y ≤ 2×rangeMax): FP ÷ 2 (rounded down).
  // Excepción: Morteros, SATW, GD Squads (no aplica aquí).
  const maxRange = stats.rangeMax ?? Infinity
  if (p.rangeHexes > maxRange && p.rangeHexes <= maxRange * 2) {
    baseFP = Math.floor(baseFP / 2)
  }

  // ── 2. Modificadores al Prof FP (acumulativos, no pueden subir profFP > normalFP) ──
  // Estos modificadores se aplican ANTES que los de PAC, y tienen el límite de normalFP.
  // Regla 9.0: solo aplican a Op Fire y Final Op Fire.
  // Regla 5.2: Assault Fire solo acepta el bonus de CP (+1, sin superar normalFP).
  const profModifiers: { label: string; value: number }[] = []

  if (useProf) {
    const isOpFireMode = p.mode === 'opfire' || p.mode === 'finalopfire'

    if (isOpFireMode && p.rangeHexes === 1) {
      profModifiers.push({ label: 'Adyacente (pre-cap)', value: +1 })
    }
    if (isOpFireMode && p.attackerIsOpFire) {
      profModifiers.push({ label: 'Op Fire marcado', value: +1 })
    }
    // CP bonus aplica a todos los modos Prof (Assault, Op Fire, Final Op Fire) — Regla 3.0/5.2/9.0
    if (p.spendCP) {
      profModifiers.push({ label: 'CP gastado', value: +1 })
    }
    if (isOpFireMode && p.changeFacing) {
      profModifiers.push({ label: 'Cambio facing', value: -1 })
    }

    // Aplicar modificadores de Prof FP con límite: no puede superar el normalFP
    const profSum = profModifiers.reduce((s, m) => s + m.value, 0)
    const cappedProfFP = Math.min(baseFP + profSum, stats.normalFP)
    baseFP = Math.max(0, cappedProfFP)
  }

  // ── 3. Modificadores de PAC (pueden superar normalFP) ──────────────────────
  const otherMods: { label: string; value: number }[] = []

  // Terreno del hex objetivo
  const targetHex = p.targetHex
  const hasSeto   = Object.values(targetHex.sides).some(Boolean)
  const terrainMod = terrainFireModifier(
    targetHex.terrain,
    targetHex.fortification,
    targetHex.elevation,
    targetHex.upperLevel,
  )
  // El seto en los lados del hex objetivo da -2 adicional
  const setoMod = hasSeto ? -2 : 0

  // Adyacente: +3 al FP (independiente de Prof FP mods)
  if (p.rangeHexes === 1) {
    otherMods.push({ label: 'Adyacente', value: +3 })
  }

  // Moviendo en Open Ground
  if (p.targetIsMoving && isOpenGround(targetHex.terrain, targetHex.fortification)) {
    otherMods.push({ label: 'Mov. en terreno abierto', value: movingInOpenGroundModifier(p.rangeHexes) })
  }

  // Flanco del objetivo
  if (p.targetHasFlank) {
    otherMods.push({ label: 'Flanco', value: +1 })
  }

  // Oculto (Concealed): -1 FP
  if (p.targetIsConcealed) {
    otherMods.push({ label: 'Oculto', value: -1 })
  }

  // Elevación relativa — PAC: target at lower elevation → FP +1; target at higher → FP -1
  if (p.attackerHigher) {
    otherMods.push({ label: 'Objetivo más bajo', value: +1 })   // target lower → easier to hit
  } else if (p.attackerLower) {
    otherMods.push({ label: 'Objetivo más alto', value: -1 })   // target higher → harder to hit
  }

  // Smoke hindrance: -1 FP por hex de humo en la LOS
  const h = p.hindrances ?? 0
  if (h > 0) {
    otherMods.push({ label: `Humo (${h}×)`, value: -h })
  }

  // Final Op Fire: -2 al FP
  if (p.mode === 'finalopfire') {
    otherMods.push({ label: 'Final Op Fire', value: -2 })
  }

  const otherSum = otherMods.reduce((s, m) => s + m.value, 0)
  const adjustedFP = baseFP + terrainMod + setoMod + otherSum

  return {
    baseFP,
    profModifiers,
    terrainMod: terrainMod + setoMod,
    otherMods,
    adjustedFP,
  }
}

// ─── Resolución del disparo ───────────────────────────────────────────────────

/**
 * Resuelve un ataque de fuego de infantería.
 * Devuelve el FireResult con roll, FP ajustado y resultados sobre el OBJETIVO.
 *
 * @param p Parámetros del ataque
 * @returns FireResult
 */
export function resolveFireAttack(p: FireAttackParams): FireResult {
  const { adjustedFP, profModifiers, terrainMod, otherMods, baseFP } = computeAdjustedFP(p)

  // Construir lista de modificadores para el log
  const modifiers: { label: string; value: number }[] = [
    ...profModifiers,
    ...(terrainMod !== 0 ? [{ label: 'Terreno', value: terrainMod }] : []),
    ...otherMods,
  ]

  // ── Tirada de dado ──────────────────────────────────────────────────────────
  const roll = rollD10()

  // Roll 10 → siempre No Effect (regla 6.1)
  if (roll === 10) {
    return { roll, adjustedFP, suppressed: false, reduced: false, eliminated: false, modifiers }
  }

  const targetStats  = p.targetStats
  const targetIsRed  = p.targetIsReduced

  // ── Regla especial: roll = 1 (regla 6.1) ───────────────────────────────────
  // Roll de 1 dentro del rango normal → siempre al menos Suppression.
  // Si es adyacente → al menos Reduced.
  const isNaturalOne   = roll === 1
  const withinNormRng  = p.rangeHexes <= (p.attackerStats.rangeMax ?? Infinity)
  const isAdjacent     = p.rangeHexes === 1

  let suppressed  = false
  let reduced     = false
  let eliminated  = false

  // ── Comprobación de Suppression ─────────────────────────────────────────────
  if (roll <= adjustedFP) {
    suppressed = true
  } else if (isNaturalOne && withinNormRng) {
    suppressed = true  // Regla del 1
  }

  if (!suppressed) {
    return { roll, adjustedFP, suppressed: false, reduced: false, eliminated: false, modifiers }
  }

  // ── Comprobación de Reduced ─────────────────────────────────────────────────
  // Para una unidad Full Strength: usar casualtyReduce como primer número
  // Para una unidad Reduced: usar casualtyElim como único número (no se "reduce" más)
  const casualtyReduce = targetIsRed ? null : (targetStats.casualtyReduce ?? null)
  const casualtyElim   = targetStats.casualtyElim

  if (!targetIsRed && casualtyReduce !== null) {
    if (roll + casualtyReduce <= adjustedFP) {
      reduced = true
    } else if (isNaturalOne && isAdjacent) {
      reduced = true  // Regla del 1 adyacente → al menos Reduced
    }
  }

  // ── Comprobación de Eliminated ──────────────────────────────────────────────
  if (targetIsRed) {
    // Unidad Reduced: un solo número de Casualty = eliminación
    if (roll + casualtyElim <= adjustedFP) {
      eliminated = true
    } else if (isNaturalOne && isAdjacent) {
      eliminated = true
    }
  } else if (casualtyElim && roll + casualtyElim <= adjustedFP) {
    eliminated = true
  }

  void baseFP  // usado en computeAdjustedFP, ya parte del resultado

  return {
    roll,
    adjustedFP,
    suppressed,
    reduced:    reduced && !eliminated,
    eliminated,
    modifiers,
  }
}

// ─── Comprobación de beneficialTerrain ───────────────────────────────────────

/** Comprueba si una unidad en un hex está en Beneficial Terrain (para Op Fire, concealment, etc.). */
export function inBeneficialTerrain(hex: HexData): boolean {
  const hasSeto = Object.values(hex.sides).some(Boolean)
  return isBeneficialTerrain(hex.terrain, hex.fortification, hasSeto)
}

// ─── Texto de log para un disparo ────────────────────────────────────────────

export function fireLogMessage(
  attacker: UnitInstance,
  targetHex: string,
  result: FireResult,
): string {
  const outcome = result.eliminated ? 'ELIMINADA'
    : result.reduced ? 'REDUCIDA + SUPRIMIDA'
    : result.suppressed ? 'SUPRIMIDA'
    : 'SIN EFECTO'
  return `${attacker.unitTypeId} dispara a ${targetHex}: tirada ${result.roll} vs FP ${result.adjustedFP} → ${outcome}`
}
