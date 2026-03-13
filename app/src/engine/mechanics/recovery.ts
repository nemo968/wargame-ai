/**
 * recovery.ts — Recovery Phase
 *
 * Regla 13.0:
 * - Todas las unidades con counters de Supresión (excepto las en Melee)
 *   recuperan UN paso de Supresión (rojo→amarillo, amarillo→sin counter).
 * - Se eliminan todos los counters: Used, Op Fire, CP, Flank, Sustained Fire, Illumination.
 * - Los counters Move y Unconfirmed Kill NO se eliminan.
 * - Si es el último turno → fin de partida.
 */

import type { UnitInstance, ActiveSide, Scenario } from '../../types'
import { recoverSuppression } from './morale'

// ─── Resultado de la Recovery Phase ──────────────────────────────────────────

export interface RecoveryResult {
  /** Unidades con su estado actualizado tras la Recovery. */
  updatedUnits:    Record<string, UnitInstance>
  /** CPs restaurados para cada bando. */
  restoredCPs:     Record<ActiveSide, number>
  /** Si el juego ha terminado (último turno). */
  gameOver:        boolean
  /** Nuevo número de turno (si no ha terminado). */
  nextTurn:        number
}

/**
 * Comprueba si dos unidades están en Melee (en el mismo hex con enemigos).
 * Una unidad en Melee no recupera Supresión durante la Recovery Phase.
 *
 * @param unit     Unidad a comprobar
 * @param allUnits Todas las unidades
 */
function isUnitInMelee(unit: UnitInstance, allUnits: Record<string, UnitInstance>): boolean {
  if (!unit.position) return false
  return Object.values(allUnits).some(
    other =>
      other.instanceId !== unit.instanceId &&
      other.faction    !== unit.faction    &&
      other.position   === unit.position
  )
}

/**
 * Aplica la Recovery Phase completa.
 *
 * @param units        Estado actual de todas las unidades
 * @param scenario     Escenario actual (para CPs y condición de fin)
 * @param currentTurn  Turno actual (antes de avanzar)
 */
export function applyRecovery(
  units:        Record<string, UnitInstance>,
  scenario:     Scenario,
  currentTurn:  number,
): RecoveryResult {
  const updatedUnits: Record<string, UnitInstance> = {}

  for (const [id, unit] of Object.entries(units)) {
    const inMelee = isUnitInMelee(unit, units)

    updatedUnits[id] = {
      ...unit,
      // Recuperar supresión (excepto si en Melee)
      suppression: inMelee ? unit.suppression : recoverSuppression(unit.suppression),
      // Limpiar counters tácticos
      isUsed:    false,
      isOpFire:  false,
      hasFlank:  false,
      // isConcealed se mantiene (la ocultación no se pierde en Recovery)
      // position, isReduced, faction no cambian
    }
  }

  // Restaurar CPs para ambos bandos
  const restoredCPs: Record<ActiveSide, number> = {
    allied: scenario.allied.commandPoints,
    axis:   scenario.axis.commandPoints,
  }

  // Comprobar fin de partida
  const gameOver = currentTurn >= scenario.turns
  const nextTurn = gameOver ? currentTurn : currentTurn + 1

  return { updatedUnits, restoredCPs, gameOver, nextTurn }
}

// ─── Texto de log ─────────────────────────────────────────────────────────────

export function recoveryLogMessage(result: RecoveryResult): string {
  if (result.gameOver) return 'FIN DE PARTIDA — Último turno completado.'
  return `Recovery Phase completada. Turno ${result.nextTurn} comienza.`
}
