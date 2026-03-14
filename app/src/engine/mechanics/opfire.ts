/**
 * opfire.ts — Lógica de Op Fire y Final Op Fire
 *
 * Regla 9.0 — Op Fire:
 * - El jugador NO activo puede disparar a unidades enemigas en movimiento.
 * - La unidad que dispara NO puede estar ya marcada como Used.
 * - Se dispara al hex en el que acaba de entrar la unidad en movimiento.
 * - Usa Prof FP con los modificadores habituales.
 * - Si la unidad atacante estaba marcada como Op Fire → su contador se vuelve Used.
 *
 * Regla 10.0 — Final Op Fire:
 * - Similar a Op Fire pero realizado por unidades YA USADAS.
 * - Solo contra unidades que entran al hex ADYACENTE.
 * - Modificador adicional de -2 al FP.
 * - Gasto de CP permite hacerlo a distancia > 1 pero dentro del rango normal.
 */

import type { UnitInstance, HexData } from '../../types'
import type { InfantryStats } from '../../types'
import { hexDistance } from './los'
import { resolveFireAttack, type FireAttackParams, type FireMode } from './fire'
import type { FireResult } from '../../types'

// ─── Elegibilidad para Op Fire ────────────────────────────────────────────────

/**
 * Comprueba si una unidad puede realizar Op Fire contra un objetivo en movimiento.
 *
 * @param firer          Unidad que intenta disparar
 * @param firerHex       Hex del firer
 * @param targetHex      Hex al que acaba de entrar el objetivo
 * @param firerStats     Estadísticas del firer
 * @param targetIsMoving Siempre true en este contexto (es el punto de llamada)
 */
export interface OpFireEligibility {
  canFire:  boolean
  isFinal:  boolean    // true si es Final Op Fire (unidad usada)
  reason?:  string
}

export function checkOpFireEligibility(
  firer:       UnitInstance,
  firerHex:    HexData,
  targetHex:   HexData,
  firerStats:  InfantryStats,
): OpFireEligibility {
  // Los Decoys no pueden disparar
  if (firer.unitTypeId.includes('DECOY') || firer.unitTypeId.includes('Decoy')) {
    return { canFire: false, isFinal: false, reason: 'Los Decoys no pueden disparar' }
  }

  // Una unidad que ya disparó este turno no puede volver a disparar (ni Op Fire ni Final Op Fire)
  if (firer.hasFiredThisTurn) {
    return { canFire: false, isFinal: false, reason: 'La unidad ya ha disparado este turno' }
  }

  const dist = hexDistance(firerHex.col, firerHex.row, targetHex.col, targetHex.row)
  const maxRange = firerStats.rangeMax ?? 0
  const effectiveMaxRange = (firerStats.rangeMax ?? 0) * 2  // Hasta 2× el rango para long range

  if (dist > effectiveMaxRange) {
    return { canFire: false, isFinal: false, reason: 'Fuera de rango' }
  }

  // Op Fire normal: unidad NO usada
  if (!firer.isUsed) {
    return { canFire: true, isFinal: false }
  }

  // Final Op Fire: unidad usada, solo hex adyacente (o con CP > rango normal)
  if (firer.isUsed && dist === 1) {
    return { canFire: true, isFinal: true }
  }

  // Con CP: Final Op Fire a distancia > 1 pero dentro del rango normal
  if (firer.isUsed && dist <= maxRange && dist > 1) {
    return { canFire: true, isFinal: true }  // Requiere CP, verificar en el llamador
  }

  return { canFire: false, isFinal: false, reason: 'Unidad ya usada y fuera de rango para Final Op Fire' }
}

// ─── Resolución de Op Fire ────────────────────────────────────────────────────

export interface OpFireParams {
  firer:              UnitInstance
  firerHex:           HexData
  firerStats:         InfantryStats
  target:             UnitInstance
  targetHex:          HexData
  targetStats:        InfantryStats
  targetIsMoving:     boolean
  targetHasFlank:     boolean
  targetIsConcealed:  boolean
  attackerIsOpFire:   boolean     // Si la ficha del firer tenía contador Op Fire
  spendCP:            boolean
  isFinalOpFire:      boolean
  attackerHigher:     boolean
  attackerLower:      boolean
  hindrances?:        number
}

/**
 * Resuelve un ataque de Op Fire o Final Op Fire.
 * La unidad atacante debe pasar su propio MC antes de que este resultado importe.
 */
export function resolveOpFire(p: OpFireParams): FireResult {
  const dist = hexDistance(p.firerHex.col, p.firerHex.row, p.targetHex.col, p.targetHex.row)

  const mode: FireMode = p.isFinalOpFire ? 'finalopfire' : 'opfire'

  const params: FireAttackParams = {
    attackerStats:    p.firerStats,
    mode,
    attackerIsOpFire: p.attackerIsOpFire,
    spendCP:          p.spendCP,
    changeFacing:     false,
    attackerHex:      p.firerHex,
    targetHex:        p.targetHex,
    targetStats:      p.targetStats,
    targetIsReduced:  p.target.isReduced,
    targetIsMoving:   p.targetIsMoving,
    targetHasFlank:   p.targetHasFlank,
    rangeHexes:       dist,
    targetIsConcealed: p.targetIsConcealed,
    attackerHigher:   p.attackerHigher,
    attackerLower:    p.attackerLower,
    hindrances:       p.hindrances ?? 0,
  }

  return resolveFireAttack(params)
}

// ─── WTs y Japanese: restricción de cambio de facing (10.1) ──────────────────

/**
 * Devuelve true si la unidad NO puede cambiar su facing para Final Op Fire.
 * (WTs y unidades japonesas — regla 10.1).
 */
export function cantChangeFacingForFinalOpFire(category: string): boolean {
  return category === 'wt_mg' || category === 'wt_mortar'
}

// ─── Texto de log ─────────────────────────────────────────────────────────────

export function opFireLogMessage(
  firer:    UnitInstance,
  targetId: string,
  result:   FireResult,
  isFinal:  boolean,
): string {
  const type    = isFinal ? 'FINAL OP FIRE' : 'OP FIRE'
  const outcome = result.eliminated ? 'ELIMINADA'
    : result.reduced ? 'REDUCIDA'
    : result.suppressed ? 'SUPRIMIDA'
    : 'SIN EFECTO'
  return `[${type}] ${firer.unitTypeId} → ${targetId}: tirada ${result.roll} vs FP ${result.adjustedFP} → ${outcome}`
}
