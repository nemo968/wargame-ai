/**
 * melee.ts — Resolución del combate cuerpo a cuerpo (Melee Phase)
 *
 * Regla 12.0:
 * - Ocurre cuando unidades enemigas comparten el mismo hex (localización).
 * - Cada Squad/WT/Gun tira 2 dados (d10).
 * - Cada dado ≤ Melee FP → reduce 1 unidad enemiga (elección del propietario).
 * - WTs y Guns → ELIMINADOS (no reducidos) si sufren bajas.
 * - Simultáneo (12.1): ambos bandos resuelven antes de aplicar bajas.
 * - Flank bonus (12.2): +1 Melee FP si el atacante entró por el flanco.
 * - CP (12.0): permite re-tirar AMBOS dados de una unidad (máx 1 CP por bando por Melee).
 * - La Morale NO afecta el Melee.
 */

import type { UnitInstance } from '../../types'
import type { InfantryStats } from '../../types'
import { rollD10 } from './dice'

// ─── Melee FP ────────────────────────────────────────────────────────────────

/**
 * Devuelve el Melee FP de una unidad.
 *
 * Reglas:
 * - Si tiene meleeFP subscript → usa ese.
 * - Guns → Melee FP = 2 (independientemente de sus stats).
 * - WTs en Melee Full = 2 FP, Reduced = 1 FP.
 * - Si no tiene subscript → usa normalFP.
 *
 * @param category   Categoría de la unidad
 * @param stats      Estadísticas activas (ya tiene en cuenta si está Reduced)
 * @param hasFlank   Si tiene contador Flank (+1 Melee FP)
 */
export function getMeleeFP(
  category:  string,
  stats:     InfantryStats,
  hasFlank:  boolean = false,
): number {
  let meleeFP: number

  if (category === 'gun') {
    meleeFP = 2
  } else if (stats.meleeFP !== null && stats.meleeFP !== undefined) {
    meleeFP = stats.meleeFP
  } else {
    // Sin subscript → usa normalFP
    meleeFP = stats.normalFP
  }

  if (hasFlank) meleeFP += 1

  return Math.max(0, meleeFP)
}

// ─── Resultado de Melee ───────────────────────────────────────────────────────

export interface MeleeUnitResult {
  instanceId: string
  rolls:      number[]
  hits:       number    // Cuántos dados <= meleeFP
  meleeFP:    number    // FP usado (incluye bonus de flanco)
}

export interface MeleeGroupResult {
  attackers: MeleeUnitResult[]   // Bandos que atacan
  defenders: MeleeUnitResult[]
  totalHitsOnDefenders: number   // Hits que sufren los defensores
  totalHitsOnAttackers: number   // Hits que sufren los atacantes
}

// ─── Tirada de Melee ─────────────────────────────────────────────────────────

/**
 * Realiza las tiradas de Melee para una unidad.
 * Tira 2 dados; cada dado ≤ Melee FP = 1 hit en el enemigo.
 *
 * @param unit      Instancia de la unidad
 * @param category  Categoría de la unidad
 * @param stats     Estadísticas activas
 * @param hasFlank  Si tiene bonus de flanco
 * @param useCP     Si se gasta CP (re-tira ambos dados, elige el mejor resultado)
 */
export function rollMeleeDice(
  unit:      UnitInstance,
  category:  string,
  stats:     InfantryStats,
  hasFlank:  boolean = false,
  useCP:     boolean = false,
): MeleeUnitResult {
  const meleeFP = getMeleeFP(category, stats, hasFlank)

  let rolls = [rollD10(), rollD10()]
  if (useCP) {
    // CP: re-tira ambos dados y usa el resultado de la re-tirada (no elige el mejor)
    rolls = [rollD10(), rollD10()]
  }

  const hits = rolls.filter(r => r <= meleeFP).length

  return { instanceId: unit.instanceId, rolls, hits, meleeFP }
}

// ─── Resolución del Melee Phase ───────────────────────────────────────────────

export interface MeleeParticipant {
  unit:      UnitInstance
  category:  string
  stats:     InfantryStats
  hasFlank:  boolean
  useCP:     boolean
}

/**
 * Resuelve el combate de Melee en un hex.
 * Los dos bandos tiran simultáneamente (12.1).
 *
 * @param sideA  Unidades del bando A en el hex
 * @param sideB  Unidades del bando B en el hex
 */
export function resolveMelee(
  sideA: MeleeParticipant[],
  sideB: MeleeParticipant[],
): MeleeGroupResult {
  // ── Tiradas simultáneas ──────────────────────────────────────────────────
  const aResults = sideA.map(p =>
    rollMeleeDice(p.unit, p.category, p.stats, p.hasFlank, p.useCP)
  )
  const bResults = sideB.map(p =>
    rollMeleeDice(p.unit, p.category, p.stats, p.hasFlank, p.useCP)
  )

  const totalHitsOnB = aResults.reduce((s, r) => s + r.hits, 0)
  const totalHitsOnA = bResults.reduce((s, r) => s + r.hits, 0)

  return {
    attackers: aResults,
    defenders: bResults,
    totalHitsOnDefenders: totalHitsOnB,
    totalHitsOnAttackers: totalHitsOnA,
  }
}

// ─── Aplicar bajas de Melee ───────────────────────────────────────────────────

export interface MeleeCasualtyResult {
  instanceId: string
  wasReduced: boolean
  wasEliminated: boolean
}

/**
 * Aplica N hits a un grupo de unidades (propietario elige el orden).
 * - Squads: hit = Reduced (luego eliminado si ya estaba Reduced)
 * - WTs y Guns: eliminados directamente si sufren bajas (12.0)
 *
 * Por simplicidad, el motor aplica hits en orden a las unidades disponibles.
 * El jugador humano puede reordenar desde la UI.
 *
 * @param units    Unidades que reciben las bajas
 * @param hits     Número de hits
 */
export function applyMeleeCasualties(
  units:    { unit: UnitInstance; category: string }[],
  hits:     number,
): MeleeCasualtyResult[] {
  const results: MeleeCasualtyResult[] = []
  let remaining = hits

  for (const { unit, category } of units) {
    if (remaining <= 0) break

    const isWT  = category === 'wt_mg' || category === 'wt_mortar'
    const isGun = category === 'gun'

    if (isWT || isGun) {
      // WTs y Guns → eliminados directamente
      results.push({ instanceId: unit.instanceId, wasReduced: false, wasEliminated: true })
      remaining--
    } else {
      // Squads: hit = Reduce; si ya Reduced = Eliminate
      if (unit.isReduced) {
        results.push({ instanceId: unit.instanceId, wasReduced: false, wasEliminated: true })
      } else {
        results.push({ instanceId: unit.instanceId, wasReduced: true, wasEliminated: false })
      }
      remaining--
    }
  }

  return results
}

// ─── Flank bonus ─────────────────────────────────────────────────────────────

/**
 * Comprueba si una unidad entrante en Melee gana el bonus de Flanco (12.2).
 * Se gana si entra por el hex de flanco de TODAS las unidades enemigas.
 * (La implementación completa requiere comprobar el facing de las unidades enemigas;
 *  aquí se delega al hasFlank del UnitInstance.)
 */
export function hasMeleeFlankBonus(unit: UnitInstance): boolean {
  return unit.hasFlank
}

// ─── Texto de log ─────────────────────────────────────────────────────────────

export function meleeLogMessage(result: MeleeGroupResult): string {
  const hitsOnDef = result.totalHitsOnDefenders
  const hitsOnAtt = result.totalHitsOnAttackers
  return `MELÉ: Atacantes → ${hitsOnDef} hits en defensores; Defensores → ${hitsOnAtt} hits en atacantes`
}
