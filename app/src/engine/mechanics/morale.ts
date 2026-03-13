/**
 * morale.ts — Chequeos de Moral (MC) y gestión de Supresión
 *
 * Regla 7.0 y 7.1:
 * - Tirar d10 ≤ Morale actual → pasa el MC.
 * - Si Morale = 10, el MC es automáticamente exitoso.
 * - Unidades sin suprimir usan moraleFresh.
 * - Unidades Suppressed (amarillo) usan moraleSup.
 * - Unidades Fully Suppressed (rojo) usan moraleFull.
 */

import type { UnitInstance, SuppressionLevel } from '../../types'
import type { InfantryStats } from '../../types'
import { rollD10 } from './dice'

// ─── Morale actual según supresión ───────────────────────────────────────────

/**
 * Devuelve el valor de Morale actual de una unidad según su nivel de supresión.
 */
export function getCurrentMorale(
  suppression: SuppressionLevel,
  stats: InfantryStats,
): number {
  switch (suppression) {
    case 0: return stats.moraleFresh
    case 1: return stats.moraleSup
    case 2: return stats.moraleFull
  }
}

// ─── Resultado de un MC ───────────────────────────────────────────────────────

export interface MCResult {
  roll:   number
  morale: number
  passed: boolean
  /** Margen de fallo (0 si pasó). Usado para calcular Rout Casualties (11.1). */
  failMargin: number
}

/**
 * Resuelve un Morale Check.
 * Si morale = 10, pasa automáticamente (sin tirar) a menos que sea un withdrawal check.
 *
 * @param morale         Valor de Morale actual de la unidad.
 * @param forceRoll      Si true, tira incluso con Morale 10 (withdrawal de hex enemigo, 5.1).
 * @param modifier       Modificador al Morale ANTES del check (p.ej. +4 por Declared Retreat).
 */
export function rollMoraleCheck(
  morale:    number,
  forceRoll: boolean = false,
  modifier:  number  = 0,
): MCResult {
  const effectiveMorale = morale + modifier

  // Morale 10+ → auto-pass excepto withdrawal
  if (effectiveMorale >= 10 && !forceRoll) {
    return { roll: 0, morale: effectiveMorale, passed: true, failMargin: 0 }
  }

  const roll = rollD10()
  const passed = roll <= effectiveMorale
  const failMargin = passed ? 0 : roll - effectiveMorale

  return { roll, morale: effectiveMorale, passed, failMargin }
}

// ─── Supresión ───────────────────────────────────────────────────────────────

/**
 * Aplica un resultado de Suppression a la unidad.
 * Fresh (0) → Suppressed (1)
 * Suppressed (1) → Fully Suppressed (2)
 * Fully Suppressed (2) → sin cambio adicional.
 */
export function applySuppression(current: SuppressionLevel): SuppressionLevel {
  return Math.min(current + 1, 2) as SuppressionLevel
}

/**
 * Recupera un paso de Supresión durante la Recovery Phase.
 * FullySuppressed (2) → Suppressed (1)
 * Suppressed (1) → Fresh (0)
 * Fresh (0) → sin cambio.
 */
export function recoverSuppression(current: SuppressionLevel): SuppressionLevel {
  return Math.max(current - 1, 0) as SuppressionLevel
}

/**
 * Devuelve el nivel de Morale de withdrawal (5.1):
 * La unidad intenta salir de un hex enemigo con -3 a su Morale.
 */
export function withdrawalMorale(stats: InfantryStats, suppression: SuppressionLevel): number {
  return getCurrentMorale(suppression, stats) - 3
}

// ─── Rout Casualties (11.1) ──────────────────────────────────────────────────

/**
 * Calcula si una unidad sufre bajas al fallar un MC de Rout (11.1).
 *
 * Si el margen de fallo >= casualtyThreshold, la unidad también es Reduced.
 *
 * @param failMargin      Cuánto se ha fallado el MC (0 si pasó)
 * @param stats           Estadísticas de la unidad
 * @param inMeleeOrAdj    Si está en Melee o adyacente a enemigo (usa primer número)
 */
export function routCasualtyCheck(
  failMargin:   number,
  stats:        InfantryStats,
  isReduced:    boolean,
  inMeleeOrAdj: boolean,
): boolean {
  if (failMargin === 0) return false
  if (isReduced) {
    // Unidad Reduced: solo un número de Casualty
    return failMargin >= stats.casualtyElim
  }
  // Unidad Full Strength: usa primer número si en Melee/adyacente, segundo número si no
  const threshold = inMeleeOrAdj
    ? (stats.casualtyReduce ?? stats.casualtyElim)
    : stats.casualtyElim
  return failMargin >= threshold
}

// ─── Utilidad de display ─────────────────────────────────────────────────────

/** Etiqueta legible del nivel de supresión. */
export function suppressionLabel(s: SuppressionLevel): string {
  return ['FRESCA', 'SUPRIMIDA', 'TOT. SUPRIMIDA'][s]
}

/** Genera texto de log para un MC. */
export function mcLogMessage(unit: UnitInstance, result: MCResult): string {
  const status = result.passed ? 'PASA' : 'FALLA'
  if (result.roll === 0) return `${unit.unitTypeId} MC automático (Moral 10)`
  return `${unit.unitTypeId} MC: tirada ${result.roll} vs Moral ${result.morale} → ${status}`
}
