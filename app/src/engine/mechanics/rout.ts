/**
 * rout.ts — Lógica de la Rout Phase
 *
 * Regla 11.0:
 * Las unidades de infantería y Guns que cumplan alguna de estas condiciones
 * al inicio de su parte de la Rout Phase deben tirar un MC:
 *   1. Están en el mismo hex (localización) que una unidad enemiga.
 *   2. Están adyacentes a un enemigo que no está en Melee.
 *   3. No están en Beneficial Terrain Y están dentro de 5 hexes de un enemigo
 *      con LOS no Hindered.
 *
 * Si fallan el MC:
 * - Mueven usando sus MPs normales (no triggea Op Fire).
 * - Deben moverse al menos 1 hex.
 * - No pueden moverse adyacente a un enemigo no en Melee.
 * - No pueden moverse más cerca (en hexes) de un enemigo que tengan en LOS.
 * - Deben intentar llegar a Beneficial Terrain o salir de LOS enemiga.
 * - Si no pueden → hacia el Rout Edge del escenario.
 * - Si alcanzan el Rout Edge con ≥1 MP → Eliminadas.
 */

import type { UnitInstance, HexData, Scenario } from '../../types'
import type { InfantryStats } from '../../types'
import { hexDistance, hasLOS, buildHexMap } from './los'
import { isBeneficialTerrain } from './terrain'
import { movementAllowance, hexEntryCost } from './movement'
import { rollMoraleCheck, routCasualtyCheck, type MCResult } from './morale'

// ─── Determinación de quién debe Rout ────────────────────────────────────────

export interface RoutCondition {
  mustRout:      boolean
  inSameHex:     boolean   // Condición 1
  adjacent:      boolean   // Condición 2
  openAndInLOS:  boolean   // Condición 3
}

/**
 * Determina si una unidad está sujeta a Rout.
 *
 * @param unit        La unidad a comprobar
 * @param unitHex     Hex donde está la unidad
 * @param allUnits    Todas las unidades del juego
 * @param allHexes    Todos los hexes del escenario
 * @param scenario    Escenario actual (para acceder a los bandos)
 */
export function getRoutCondition(
  unit:     UnitInstance,
  unitHex:  HexData,
  allUnits: Record<string, UnitInstance>,
  allHexes: HexData[],
  _scenario: Scenario,
): RoutCondition {
  void _scenario
  // Los Decoys usan las mismas reglas de Rout que unidades normales
  const hexMap = buildHexMap(allHexes)

  const enemies = Object.values(allUnits).filter(
    u => u.faction !== unit.faction && u.position !== null
  )

  // Hex de cada enemigo
  const enemyHexes = enemies
    .map(e => ({ unit: e, hex: allHexes.find(h => h.id === e.position) }))
    .filter((x): x is { unit: UnitInstance; hex: HexData } => x.hex !== undefined)

  // ── Condición 1: mismo hex que un enemigo ─────────────────────────────────
  const inSameHex = enemyHexes.some(({ hex }) => hex.id === unitHex.id)

  // ── Condición 2: adyacente a un enemigo no en Melee ───────────────────────
  // (En Melee = enemigo en el mismo hex que nuestra unidad)
  const adjacent = enemyHexes.some(({ hex }) => {
    const dist = hexDistance(unitHex.col, unitHex.row, hex.col, hex.row)
    const enemyInSameHex = hex.id === unitHex.id
    return dist === 1 && !enemyInSameHex
  })

  // ── Condición 3: no en Beneficial Terrain + dentro de 5 hexes con LOS ────
  const hasSeto = Object.values(unitHex.sides).some(Boolean)
  const inBenTerrain = isBeneficialTerrain(unitHex.terrain, unitHex.fortification, hasSeto)

  let openAndInLOS = false
  if (!inBenTerrain && !inSameHex && !adjacent) {
    openAndInLOS = enemyHexes.some(({ hex }) => {
      const dist = hexDistance(unitHex.col, unitHex.row, hex.col, hex.row)
      if (dist > 5) return false
      return hasLOS(unitHex, hex, hexMap)
    })
  }

  const mustRout = inSameHex || adjacent || openAndInLOS

  return { mustRout, inSameHex, adjacent, openAndInLOS }
}

// ─── Resultado del MC de Rout ─────────────────────────────────────────────────

export interface RoutCheckResult {
  mcResult:         MCResult
  mustRout:         boolean     // Si falló el MC y debe huir
  casualtyOnRout:   boolean     // Si además sufre una baja (11.1)
  condition:        RoutCondition
}

/**
 * Resuelve el MC de Rout de una unidad.
 *
 * @param unit            La unidad
 * @param stats           Estadísticas activas
 * @param condition       Condición de Rout previa (de getRoutCondition)
 */
export function resolveRoutCheck(
  unit:      UnitInstance,
  stats:     InfantryStats,
  condition: RoutCondition,
): RoutCheckResult {
  const { moraleFull: moraleBase, moraleSup, moraleFresh } = stats
  void moraleBase; void moraleSup; void moraleFresh

  // Morale actual según supresión
  const moraleValues = [stats.moraleFresh, stats.moraleSup, stats.moraleFull]
  const currentMorale = moraleValues[unit.suppression]

  const mcResult = rollMoraleCheck(currentMorale, true)  // forceRoll = true en Rout

  if (mcResult.passed) {
    return { mcResult, mustRout: false, casualtyOnRout: false, condition }
  }

  // Determinar si hay Rout Casualties (11.1):
  // Si el margen de fallo >= threshold de Casualty
  const inMeleeOrAdj = condition.inSameHex || condition.adjacent
  const casualtyOnRout = routCasualtyCheck(
    mcResult.failMargin,
    stats,
    unit.isReduced,
    inMeleeOrAdj,
  )

  return { mcResult, mustRout: true, casualtyOnRout, condition }
}

// ─── Helpers de borde de mapa ────────────────────────────────────────────────

function getMapEdgeBounds(allHexes: HexData[]): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity
  for (const h of allHexes) {
    if (h.col < minCol) minCol = h.col
    if (h.col > maxCol) maxCol = h.col
    if (h.row < minRow) minRow = h.row
    if (h.row > maxRow) maxRow = h.row
  }
  return { minCol, maxCol, minRow, maxRow }
}

function distanceToEdge(
  hex: HexData,
  routEdge: string,
  bounds: ReturnType<typeof getMapEdgeBounds>,
): number {
  const { minCol, maxCol, minRow, maxRow } = bounds
  if (routEdge === 'W')  return hex.col - minCol
  if (routEdge === 'E')  return maxCol - hex.col
  if (routEdge === 'N')  return hex.row - minRow
  if (routEdge === 'S')  return maxRow - hex.row
  if (routEdge === 'NW') return Math.min(hex.col - minCol, hex.row - minRow)
  if (routEdge === 'NE') return Math.min(maxCol - hex.col, hex.row - minRow)
  if (routEdge === 'SW') return Math.min(hex.col - minCol, maxRow - hex.row)
  if (routEdge === 'SE') return Math.min(maxCol - hex.col, maxRow - hex.row)
  return 0
}

/**
 * Devuelve true si el hex está en el borde del mapa correspondiente al routEdge del bando.
 */
export function isOnRoutEdge(hex: HexData, routEdge: string, allHexes: HexData[]): boolean {
  const { minCol, maxCol, minRow, maxRow } = getMapEdgeBounds(allHexes)
  if (routEdge === 'W')  return hex.col === minCol
  if (routEdge === 'E')  return hex.col === maxCol
  if (routEdge === 'N')  return hex.row === minRow
  if (routEdge === 'S')  return hex.row === maxRow
  if (routEdge === 'NW') return hex.col === minCol || hex.row === minRow
  if (routEdge === 'NE') return hex.col === maxCol || hex.row === minRow
  if (routEdge === 'SW') return hex.col === minCol || hex.row === maxRow
  if (routEdge === 'SE') return hex.col === maxCol || hex.row === maxRow
  return false
}

// ─── Búsqueda de ruta de huida ────────────────────────────────────────────────

export interface RoutMove {
  hexId: string
  cost:  number
}

/**
 * Encuentra los hexes candidatos adonde la unidad puede Routear.
 *
 * La unidad debe:
 * 1. Moverse al menos 1 hex.
 * 2. No quedar adyacente a un enemigo no en Melee.
 * 3. No moverse más cerca de un enemigo con LOS.
 * 4. Preferir hexes con Beneficial Terrain o fuera de LOS enemiga.
 * 5. Si no hay → moverse hacia el Rout Edge (borde del mapa del bando).
 *
 * Esta implementación devuelve la lista de hexes adyacentes válidos ordenados
 * por preferencia (Beneficial Terrain o fuera de LOS primero).
 * La IA/UI debe elegir el mejor camino.
 *
 * @param unit       Unidad que Routea
 * @param unitHex    Hex actual de la unidad
 * @param allUnits   Todas las unidades
 * @param allHexes   Todos los hexes
 * @param routEdge   Borde de huida del bando (p.ej. 'W', 'E')
 */
export function findRoutCandidates(
  unit:      UnitInstance,
  unitHex:   HexData,
  allUnits:  Record<string, UnitInstance>,
  allHexes:  HexData[],
  routEdge:  string,
): RoutMove[] {
  const hexMap = buildHexMap(allHexes)

  const enemies = Object.values(allUnits).filter(
    u => u.faction !== unit.faction && u.position !== null
  )
  const enemyHexes = enemies
    .map(e => allHexes.find(h => h.id === e.position))
    .filter((h): h is HexData => h !== undefined)

  // Hexes adyacentes al hex actual (los hexes del mapa a distancia 1)
  const adjacent = allHexes.filter(h =>
    hexDistance(unitHex.col, unitHex.row, h.col, h.row) === 1
  )

  const mpAllow   = movementAllowance(unit.unitTypeId)

  const candidates: RoutMove[] = []

  for (const candidate of adjacent) {
    const cost = hexEntryCost(unitHex, candidate, 'flat-top')
    if (cost > mpAllow || cost === Infinity) continue

    // No puede quedar adyacente a un enemigo no en Melee
    const wouldBeAdjacentToEnemy = enemyHexes.some(eh =>
      hexDistance(candidate.col, candidate.row, eh.col, eh.row) === 1 &&
      eh.id !== unitHex.id  // El enemigo no está en Melee (mismo hex) con nosotros
    )
    if (wouldBeAdjacentToEnemy) continue

    // No puede moverse más cerca de un enemigo en LOS
    const wouldMoveCloserToEnemy = enemyHexes.some(eh => {
      const distNow  = hexDistance(unitHex.col, unitHex.row, eh.col, eh.row)
      const distNew  = hexDistance(candidate.col, candidate.row, eh.col, eh.row)
      const los      = hasLOS(unitHex, eh, hexMap)
      return los && distNew < distNow
    })
    if (wouldMoveCloserToEnemy) continue

    candidates.push({ hexId: candidate.id, cost })
  }

  // Ordenar: primero los que dan Beneficial Terrain o sacan de LOS enemiga
  candidates.sort((a, b) => {
    const hexA = allHexes.find(h => h.id === a.hexId)!
    const hexB = allHexes.find(h => h.id === b.hexId)!

    const aHasSeto = Object.values(hexA.sides).some(Boolean)
    const bHasSeto = Object.values(hexB.sides).some(Boolean)
    const aBen = isBeneficialTerrain(hexA.terrain, hexA.fortification, aHasSeto) ? 1 : 0
    const bBen = isBeneficialTerrain(hexB.terrain, hexB.fortification, bHasSeto) ? 1 : 0

    const aOutOfLOS = !enemyHexes.some(eh => hasLOS(hexA, eh, hexMap)) ? 1 : 0
    const bOutOfLOS = !enemyHexes.some(eh => hasLOS(hexB, eh, hexMap)) ? 1 : 0

    const aScore = aBen + aOutOfLOS
    const bScore = bBen + bOutOfLOS

    return bScore - aScore  // Descendente: mejor score primero
  })

  // Fallback: si no hay candidatos normales, moverse hacia el Rout Edge (sin restricciones)
  if (candidates.length === 0) {
    const bounds = getMapEdgeBounds(allHexes)
    for (const candidate of adjacent) {
      const cost = hexEntryCost(unitHex, candidate, 'flat-top')
      if (cost === Infinity) continue
      candidates.push({ hexId: candidate.id, cost })
    }
    // Ordenar por distancia al borde de huida (menor distancia = más cerca del borde = mejor)
    candidates.sort((a, b) => {
      const hexA = allHexes.find(h => h.id === a.hexId)!
      const hexB = allHexes.find(h => h.id === b.hexId)!
      return distanceToEdge(hexA, routEdge, bounds) - distanceToEdge(hexB, routEdge, bounds)
    })
  }

  return candidates
}

// ─── Texto de log ─────────────────────────────────────────────────────────────

export function routLogMessage(unit: UnitInstance, result: RoutCheckResult): string {
  if (!result.condition.mustRout) return `${unit.unitTypeId} no sujeta a Rout.`
  if (result.mcResult.passed) return `${unit.unitTypeId} MC Rout: tirada ${result.mcResult.roll} vs ${result.mcResult.morale} → PASA`
  const casMsg = result.casualtyOnRout ? ' + BAJA' : ''
  return `${unit.unitTypeId} MC Rout: tirada ${result.mcResult.roll} vs ${result.mcResult.morale} → HUYE${casMsg}`
}
