/**
 * aiEngine.ts — Motor de IA para Band of Brothers: Screaming Eagles
 *
 * Arquitectura: IA determinista basada en heurísticas de puntuación.
 *   - Lee el estado del store vía useGameStore.getState() (estado siempre fresco)
 *   - Ejecuta acciones llamando directamente a las acciones del store
 *   - Las funciones son async para permitir delays visuales entre acciones
 *   - Respeta el ocultamiento (isConcealed): nunca ataca a unidades ocultas
 */

import { useGameStore } from '../../store/gameStore'
import {
  buildHexMap, computeLOS, hexDistance,
  movementAllowance, hexEntryCost, canStackInHex,
  getUnitType, getActiveInfantryStats,
  terrainFireModifier,
  checkOpFireEligibility,
  getRoutCondition,
} from '../mechanics'
import type { UnitInstance, HexData, ActiveSide, Faction, Scenario } from '../../types'

// ─── Utilidades ───────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// ─── Identificación del bando IA ──────────────────────────────────────────────

export function isAISide(
  activeSide:    ActiveSide,
  playerFaction: Faction,
  scenario:      Scenario,
): boolean {
  const activeFaction = activeSide === 'allied'
    ? scenario.allied.faction
    : scenario.axis.faction
  return activeFaction !== playerFaction
}

function getAISide(playerFaction: Faction, scenario: Scenario): ActiveSide {
  return scenario.allied.faction === playerFaction ? 'axis' : 'allied'
}

function getAIFaction(playerFaction: Faction, scenario: Scenario): Faction {
  return scenario.allied.faction === playerFaction
    ? scenario.axis.faction
    : scenario.allied.faction
}

// ─── Análisis de objetivos ────────────────────────────────────────────────────

interface ObjectiveData {
  targetHexes:  HexData[]
  exitEdge:     string | null
  aiIsAttacker: boolean
}

function parseObjectiveHexes(victory: string, hexes: HexData[]): HexData[] {
  const found: HexData[] = []
  for (const match of victory.matchAll(/\b(\d*)([A-I])(\d+)\b/g)) {
    const mapNum    = match[1] ? parseInt(match[1]) : null
    const coordStr  = `${match[2]}${match[3]}`
    const hex = hexes.find(h =>
      h.origCoord === coordStr &&
      (mapNum === null || h.origMap === mapNum)
    )
    if (hex && !found.includes(hex)) found.push(hex)
  }
  return found
}

function getObjectiveData(scenario: Scenario, aiFaction: Faction): ObjectiveData {
  const v = scenario.victory.toLowerCase()

  const exitEdge =
    (v.includes('east edge')  || v.includes('east side'))  ? 'E' :
    (v.includes('west edge')  || v.includes('west side'))  ? 'W' :
    (v.includes('north edge') || v.includes('north side')) ? 'N' :
    (v.includes('south edge') || v.includes('south side')) ? 'S' :
    null

  const targetHexes = parseObjectiveHexes(scenario.victory, scenario.hexes)

  const aiIsAttacker =
    scenario.movesFirst === aiFaction ||
    (exitEdge !== null)

  return { targetHexes, exitEdge, aiIsAttacker }
}

// ─── Distancia al objetivo más cercano ───────────────────────────────────────

function distToClosestObjective(
  hex:        HexData,
  objectives: ObjectiveData,
  scenario:   Scenario,
): number {
  if (objectives.targetHexes.length > 0) {
    return Math.min(...objectives.targetHexes.map(o =>
      hexDistance(hex.col, hex.row, o.col, o.row)
    ))
  }
  // Sin objetivos explícitos: avanzar hacia el centro del mapa
  const cols = scenario.hexes.map(h => h.col)
  const midCol = Math.round((Math.min(...cols) + Math.max(...cols)) / 2)
  return Math.abs(hex.col - midCol)
}

// ─── Puntuación de despliegue ─────────────────────────────────────────────────

function scoreSetupHex(
  hex:      HexData,
  category: string,
  allUnits: Record<string, UnitInstance>,
  aiFaction: Faction,
): number {
  if (hex.terrain === 'RIO / CANAL') return -100

  const terrainScore =
    hex.terrain === 'EDIF. PIEDRA' ? 5 :
    hex.terrain === 'EDIF. MADERA' ? 4 :
    hex.terrain === 'BOSQUE'       ? 3 :
    hex.terrain === 'SETO'         ? 2 :
    hex.terrain === 'CARRETERA'    ? 1 : 0

  const elevScore = hex.elevation * 2

  // Penalizar stacking
  const inHex = Object.values(allUnits).filter(
    u => u.position === hex.id && u.faction === aiFaction
  )
  const stackPenalty = inHex.length * 6

  let unitBonus = 0
  switch (category) {
    case 'wt_mg':
    case 'wt_mortar':
      unitBonus = terrainScore > 0 ? 3 : 0
      break
    case 'vehicle':
    case 'gun':
      unitBonus = terrainScore > 0 ? 2 : 0
      break
    case 'decoy':
      // Decoys en terreno abierto para mayor visibilidad (engaño)
      unitBonus = hex.terrain === 'TERRENO ABIERTO' ? 4 : 0
      break
    default:
      unitBonus = terrainScore > 0 ? 1 : 0
  }

  return terrainScore + elevScore + unitBonus - stackPenalty
}

// ─── Puntuación de disparo ────────────────────────────────────────────────────

function scoreFireAction(
  attacker:    UnitInstance,
  target:      UnitInstance,
  attackerHex: HexData,
  targetHex:   HexData,
  objectives:  ObjectiveData,
  hexMap:      Map<string, HexData>,
  smokeHexes:  Record<string, 'fresh' | 'dispersed'>,
): number {
  // Nunca disparar a unidades ocultas (fog of war)
  if (target.isConcealed) return 0

  const stats = getActiveInfantryStats(attacker.unitTypeId, attacker.isReduced)
  if (!stats) return 0

  const range = hexDistance(attackerHex.col, attackerHex.row, targetHex.col, targetHex.row)
  const maxRange = stats.rangeMax ?? 1
  if (range > maxRange * 2) return 0

  const los = computeLOS(attackerHex, targetHex, hexMap, smokeHexes)
  if (los.blocked) return 0

  // FP ajustado aproximado (sin el detalle completo del engine, suficiente para scoring)
  const terrainMod = terrainFireModifier(
    targetHex.terrain, targetHex.fortification,
    targetHex.elevation, targetHex.upperLevel,
  )
  const base = attacker.suppression === 0 ? stats.normalFP : stats.profFP
  const adjustedFP = clamp(base + terrainMod, 0, 14)

  // Probabilidades estimadas
  const pSuppress = clamp(adjustedFP / 10, 0, 0.95)
  const pReduce   = stats.casualtyReduce !== null
    ? clamp((adjustedFP - stats.casualtyReduce) / 10, 0, 0.90) : 0
  const pElim     = clamp((adjustedFP - stats.casualtyElim) / 10, 0, 0.85)
  const expectedDamage = pSuppress * 1 + pReduce * 2 + pElim * 5

  // Bonificaciones
  const isOnObjective  = objectives.targetHexes.some(o => o.id === targetHex.id)
  const isAlreadySup   = target.suppression > 0
  let bonus = 1.0
  if (isOnObjective) bonus *= 2.0
  if (isAlreadySup)  bonus *= 1.4  // Rematar unidad ya suprimida

  // Coste de oportunidad (vehiculos/cañones cuestan 3 ops)
  const cat     = getUnitType(attacker.unitTypeId)?.category ?? 'squad'
  const opsCost = (cat === 'vehicle' || cat === 'gun') ? 3 : 1

  return (expectedDamage * bonus) / opsCost
}

// ─── Puntuación de movimiento ─────────────────────────────────────────────────

function scoreMoveHex(
  unit:       UnitInstance,
  fromHex:    HexData,
  toHex:      HexData,
  objectives: ObjectiveData,
  scenario:   Scenario,
  hexMap:     Map<string, HexData>,
  allUnits:   Record<string, UnitInstance>,
  smokeHexes: Record<string, 'fresh' | 'dispersed'>,
): number {
  if (toHex.terrain === 'RIO / CANAL') return -100

  // Avance hacia objetivos
  const distFrom = distToClosestObjective(fromHex, objectives, scenario)
  const distTo   = distToClosestObjective(toHex,   objectives, scenario)
  const advancement = (distFrom - distTo) * 3.0

  // Calidad del terreno destino
  const terrainBonus =
    toHex.terrain === 'EDIF. PIEDRA' ? 3.0 :
    toHex.terrain === 'EDIF. MADERA' ? 2.5 :
    toHex.terrain === 'BOSQUE'       ? 2.0 :
    toHex.terrain === 'SETO'         ? 1.5 :
    toHex.terrain === 'CARRETERA'    ? 0.5 : 0.0

  // Peligro: unidades enemigas no ocultas con LOS al hex de destino
  const enemies = Object.values(allUnits).filter(
    u => u.faction !== unit.faction && u.position !== null && !u.isConcealed
  )
  let dangerLevel = 0
  for (const enemy of enemies) {
    const eHex = scenario.hexes.find(h => h.id === enemy.position)
    if (!eHex) continue
    const los = computeLOS(eHex, toHex, hexMap, smokeHexes)
    if (!los.blocked && enemy.suppression === 0) {
      const eStat = getActiveInfantryStats(enemy.unitTypeId, enemy.isReduced)
      const eFP   = eStat?.normalFP ?? 4
      const dist  = hexDistance(eHex.col, eHex.row, toHex.col, toHex.row)
      dangerLevel += eFP / (dist + 1)
    }
  }
  // Una unidad suprimida es más vulnerable en terreno abierto
  const dangerPenalty = dangerLevel * (unit.suppression > 0 ? 2.0 : 1.0)

  // Bono por borde de salida
  let exitBonus = 0
  if (objectives.exitEdge) {
    const allCols = scenario.hexes.map(h => h.col)
    const allRows = scenario.hexes.map(h => h.row)
    const isEdge =
      (objectives.exitEdge === 'E' && toHex.col === Math.max(...allCols)) ||
      (objectives.exitEdge === 'W' && toHex.col === Math.min(...allCols)) ||
      (objectives.exitEdge === 'N' && toHex.row === Math.min(...allRows)) ||
      (objectives.exitEdge === 'S' && toHex.row === Math.max(...allRows))
    if (isEdge) exitBonus = 15
  }

  return advancement + terrainBonus - dangerPenalty + exitBonus
}

// ─── Hexes alcanzables (BFS) ──────────────────────────────────────────────────

function getReachableHexes(
  unit:      UnitInstance,
  unitHex:   HexData,
  maxMPs:    number,
  scenario:  Scenario,
  allUnits:  Record<string, UnitInstance>,
): { hex: HexData; mpCost: number }[] {
  const cat    = getUnitType(unit.unitTypeId)?.category ?? 'squad'
  const result: { hex: HexData; mpCost: number }[] = []
  const visited = new Map<string, number>()   // hexId → MPsUsed mínimos
  const queue: { hex: HexData; mpsUsed: number }[] = [{ hex: unitHex, mpsUsed: 0 }]
  visited.set(unitHex.id, 0)

  while (queue.length > 0) {
    const { hex, mpsUsed } = queue.shift()!

    for (const neighbor of scenario.hexes) {
      if (hexDistance(hex.col, hex.row, neighbor.col, neighbor.row) !== 1) continue
      if (neighbor.terrain === 'RIO / CANAL') continue

      const cost      = hexEntryCost(hex, neighbor, scenario.orientation, cat)
      const totalCost = mpsUsed + cost
      if (totalCost > maxMPs || cost === Infinity) continue
      if (visited.has(neighbor.id) && visited.get(neighbor.id)! <= totalCost) continue

      if (!canStackInHex(neighbor.id, unit.faction, allUnits, unit.unitTypeId)) continue

      const enemyInHex = Object.values(allUnits).some(
        u => u.faction !== unit.faction && u.position === neighbor.id
      )

      visited.set(neighbor.id, totalCost)
      result.push({ hex: neighbor, mpCost: totalCost })

      // No expandir BFS desde hexes con enemigos (Close Assault: se para allí)
      if (!enemyInHex) {
        queue.push({ hex: neighbor, mpsUsed: totalCost })
      }
    }
  }

  return result
}

// ─── Acción con puntuación ────────────────────────────────────────────────────

interface ScoredAction {
  type:          'fire' | 'move' | 'opfire_mark'
  score:         number
  unitId:        string
  targetUnitId?: string
  targetHexId?:  string
}

// ─── Selección de la mejor acción ────────────────────────────────────────────

function getBestAction(
  aiSide:     ActiveSide,
  objectives: ObjectiveData,
  hexMap:     Map<string, HexData>,
): ScoredAction | null {
  const state = useGameStore.getState()
  const { scenario, units, unitMPs, smokeHexes } = state
  if (!scenario) return null

  const aiFaction = aiSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
  const actions: ScoredAction[] = []

  const { currentTurn } = state
  const availableUnits = Object.values(units).filter(u =>
    u.faction === aiFaction && !u.isUsed && !u.isOpFire &&
    (u.position !== null || (u.entryTurn !== undefined && u.entryTurn <= currentTurn))
  )

  const visibleEnemies = Object.values(units).filter(
    u => u.faction !== aiFaction && u.position !== null && !u.isConcealed
  )

  for (const unit of availableUnits) {
    const cat = getUnitType(unit.unitTypeId)?.category ?? 'squad'
    if (cat === 'decoy') continue  // Los decoys no actúan

    // Off-board units: find best entry hex in setup zone
    if (unit.position === null) {
      const { setupSplitCol, axisSetupSplitCol } = state
      const isAllied = aiSide === 'allied'
      const isPointyTop = scenario.orientation === 'pointy-top'
      const sideConfig = isAllied ? scenario.allied : scenario.axis
      const entryHexes = scenario.hexes.filter(h => {
        if ((sideConfig.setupMaps ?? []).length > 0) return sideConfig.setupMaps.includes(h.origMap)
        return isPointyTop
          ? (isAllied ? h.row > setupSplitCol : h.row <= axisSetupSplitCol)
          : (isAllied ? h.col <= setupSplitCol : h.col > axisSetupSplitCol)
      }).filter(h => canStackInHex(h.id, unit.faction, units, unit.unitTypeId))
      if (entryHexes.length > 0) {
        const bestEntry = entryHexes.reduce((best, h) => {
          const d = distToClosestObjective(h, objectives, scenario)
          return d < distToClosestObjective(best, objectives, scenario) ? h : best
        })
        actions.push({ type: 'move', score: 3, unitId: unit.instanceId, targetHexId: bestEntry.id })
      }
      continue
    }

    const unitHex = scenario.hexes.find(h => h.id === unit.position)
    if (!unitHex) continue

    // ── Opciones de fuego ──────────────────────────────────────────────────
    for (const target of visibleEnemies) {
      const targetHex = scenario.hexes.find(h => h.id === target.position)
      if (!targetHex) continue
      const score = scoreFireAction(
        unit, target, unitHex, targetHex, objectives, hexMap, smokeHexes
      )
      if (score > 0) {
        actions.push({ type: 'fire', score, unitId: unit.instanceId, targetUnitId: target.instanceId })
      }
    }

    // ── Opciones de movimiento (no para WTs ni cañones defensores) ─────────
    const canAdvance = cat === 'squad' || cat === 'vehicle'
    const isDefWt    = (cat === 'wt_mg' || cat === 'wt_mortar' || cat === 'gun') && !objectives.aiIsAttacker

    if (canAdvance) {
      const remaining = unitMPs[unit.instanceId] ?? movementAllowance(unit.unitTypeId)
      const reachable = getReachableHexes(unit, unitHex, remaining, scenario, units)

      // Elegir el mejor destino (no el hex actual)
      let bestMoveScore = -Infinity
      let bestHexId: string | null = null

      for (const { hex } of reachable) {
        if (hex.id === unit.position) continue
        const score = scoreMoveHex(
          unit, unitHex, hex, objectives, scenario, hexMap, units, smokeHexes
        )
        if (score > bestMoveScore) {
          bestMoveScore = score
          bestHexId = hex.id
        }
      }

      if (bestHexId && bestMoveScore > 0) {
        actions.push({ type: 'move', score: bestMoveScore, unitId: unit.instanceId, targetHexId: bestHexId })
      }
    }

    // ── Marcar Op Fire (WTs y unidades defensoras con LOS al enemigo) ───────
    if (!unit.isOpFire && (isDefWt || !objectives.aiIsAttacker)) {
      const hasVisibleEnemyInLOS = visibleEnemies.some(enemy => {
        const eHex = scenario.hexes.find(h => h.id === enemy.position)
        if (!eHex) return false
        return !computeLOS(unitHex, eHex, hexMap, smokeHexes).blocked
      })
      if (hasVisibleEnemyInLOS) {
        const opScore = isDefWt ? 5 : 2.5
        actions.push({ type: 'opfire_mark', score: opScore, unitId: unit.instanceId })
      }
    }
  }

  if (actions.length === 0) return null
  return actions.reduce((best, a) => a.score > best.score ? a : best)
}

// ─── Esperar resolución de Op Fire ───────────────────────────────────────────

async function waitForOpFireResolution(): Promise<void> {
  let maxWait = 50  // máx ~10 segundos
  while (useGameStore.getState().pendingOpFire !== null && maxWait-- > 0) {
    await delay(200)
  }
  await delay(150)
}

// ─── Mover unidad paso a paso hacia un objetivo ───────────────────────────────

async function moveUnitToward(
  unitId:    string,
  targetId:  string,
  scenario:  Scenario,
  aiSide:    ActiveSide,
): Promise<void> {
  const gs = useGameStore.getState
  let maxSteps = 12

  while (maxSteps-- > 0) {
    const state = gs()
    const unit  = state.units[unitId]
    if (!unit || unit.isUsed)                          break
    if (unit.position === targetId)                    break
    if (state.activeSide !== aiSide)                   break
    if (state.phase !== 'operations')                  break
    if (state.movingUnitMCFailed)                      break

    // Esperar si hay Op Fire pendiente (del jugador humano u otro)
    if (state.pendingOpFire) {
      await waitForOpFireResolution()
      if (gs().movingUnitMCFailed) break
      continue
    }

    const unitHex = scenario.hexes.find(h => h.id === unit.position)
    const tgtHex  = scenario.hexes.find(h => h.id === targetId)
    if (!unitHex || !tgtHex) break

    // Elegir el vecino adyacente más cercano al objetivo
    const cat = getUnitType(unit.unitTypeId)?.category ?? 'squad'
    const neighbors = scenario.hexes
      .filter(h => hexDistance(unitHex.col, unitHex.row, h.col, h.row) === 1)
      .filter(h => h.terrain !== 'RIO / CANAL')
      .filter(h => canStackInHex(h.id, unit.faction, state.units, unit.unitTypeId))
      .filter(h => {
        const cost = hexEntryCost(unitHex, h, scenario.orientation, cat)
        const remaining = state.unitMPs[unitId] ?? movementAllowance(unit.unitTypeId)
        return cost !== Infinity && cost <= remaining
      })
      .sort((a, b) =>
        hexDistance(a.col, a.row, tgtHex.col, tgtHex.row) -
        hexDistance(b.col, b.row, tgtHex.col, tgtHex.row)
      )

    if (neighbors.length === 0) break

    const nextHex = neighbors[0]
    const result  = gs().tryMoveUnit(unitId, nextHex.id)

    if (!result.ok) break

    await delay(350)

    if (result.opFirePending) {
      await waitForOpFireResolution()
      if (gs().movingUnitMCFailed) break
    }
  }

  // Finalizar activación
  const unit = gs().units[unitId]
  if (unit && !unit.isUsed) {
    gs().endUnitActivation(unitId)
  }
}

// ─── Ejecutar una acción ──────────────────────────────────────────────────────

async function executeAction(
  action:   ScoredAction,
  aiSide:   ActiveSide,
  scenario: Scenario,
): Promise<void> {
  const gs = useGameStore.getState

  switch (action.type) {
    case 'fire': {
      const cps     = gs().commandPoints[aiSide]
      const spendCP = cps > 1 && action.score > 7.0
      const result  = gs().tryFireUnit(action.unitId, action.targetUnitId!, spendCP)
      if (result.ok) {
        const unit = gs().units[action.unitId]
        if (unit && !unit.isUsed) gs().endUnitActivation(action.unitId)
      }
      break
    }
    case 'move': {
      await moveUnitToward(action.unitId, action.targetHexId!, scenario, aiSide)
      break
    }
    case 'opfire_mark': {
      gs().markUnitOpFire(action.unitId)
      break
    }
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export async function runAISetup(aiSide: ActiveSide): Promise<void> {
  const gs = useGameStore.getState
  gs().setAIThinking(true)

  try {
    const state     = gs()
    const { scenario, setupSplitCol, axisSetupSplitCol } = state
    if (!scenario) return

    const aiFaction  = aiSide === 'allied' ? scenario.allied.faction : scenario.axis.faction

    // Unidades IA sin colocar
    const toPlace = Object.values(state.units).filter(
      u => u.faction === aiFaction && u.position === null
    )

    // Prioridad de colocación: WTs > vehículos/cañones > squads > decoys
    const priority = (u: UnitInstance): number => {
      const cat = getUnitType(u.unitTypeId)?.category ?? 'squad'
      if (cat === 'wt_mg' || cat === 'wt_mortar') return 0
      if (cat === 'vehicle' || cat === 'gun')      return 1
      if (cat === 'squad')                         return 2
      return 3
    }
    toPlace.sort((a, b) => priority(a) - priority(b))

    // Hexes válidos para la zona de la IA
    // Usa setupMaps (Zona_despliegue) si está definido, igual que placeUnitInSetup
    const aiSideConfig = aiSide === 'allied' ? scenario.allied : scenario.axis
    const aiSetupMaps  = aiSideConfig.setupMaps ?? []
    const validHexes = scenario.hexes.filter(h => {
      if (h.terrain === 'RIO / CANAL') return false
      if (aiSetupMaps.length > 0) return aiSetupMaps.includes(h.origMap)
      if (scenario.orientation === 'flat-top') {
        return aiSide === 'allied' ? h.col <= setupSplitCol : h.col > axisSetupSplitCol
      } else {
        return aiSide === 'allied'
          ? h.row > setupSplitCol
          : h.row <= axisSetupSplitCol
      }
    })

    for (const unit of toPlace) {
      const cat = getUnitType(unit.unitTypeId)?.category ?? 'squad'

      // Puntuar hexes y elegir el mejor disponible
      const scored = validHexes
        .map(h => ({ hex: h, score: scoreSetupHex(h, cat, gs().units, aiFaction) }))
        .filter(({ hex }) => {
          // Validar stacking manualmente (igual que lo hace el store)
          const inHex = Object.values(gs().units).filter(
            u => u.position === hex.id && u.faction === aiFaction
          )
          if (cat === 'vehicle' || cat === 'gun') {
            return !inHex.some(u => {
              const c = getUnitType(u.unitTypeId)?.category
              return c === 'vehicle' || c === 'gun'
            })
          } else {
            const infCount = inHex.filter(u => {
              const c = getUnitType(u.unitTypeId)?.category
              return c !== 'vehicle' && c !== 'gun'
            }).length
            return infCount < 2
          }
        })
        .sort((a, b) => b.score - a.score)

      if (scored.length > 0) {
        const res = gs().placeUnitInSetup(unit.instanceId, scored[0].hex.id)
        if (res.ok) await delay(100)
      }
    }

    await delay(250)
    gs().completeSetup()

  } finally {
    gs().setAIThinking(false)
  }
}

// ─── Operations ───────────────────────────────────────────────────────────────

export async function runAIOperations(aiSide: ActiveSide): Promise<void> {
  const gs = useGameStore.getState
  gs().setAIThinking(true)

  try {
    const scenario = gs().scenario
    if (!scenario) return

    const aiFaction  = aiSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
    const sideConfig = aiSide === 'allied' ? scenario.allied : scenario.axis
    const objectives = getObjectiveData(scenario, aiFaction)
    const hexMap     = buildHexMap(scenario.hexes)

    let maxIterations = 40

    while (maxIterations-- > 0) {
      const state = gs()
      if (state.phase !== 'operations')           break
      if (state.activeSide !== aiSide)             break
      if (state.opsUsed >= sideConfig.opsRangeMax) break

      // Esperar si hay Op Fire pendiente
      if (state.pendingOpFire) {
        await waitForOpFireResolution()
        continue
      }

      const action = getBestAction(aiSide, objectives, hexMap)

      if (!action || action.score < 0.3) {
        // Sin acciones beneficiosas — terminar si ya alcanzamos el mínimo
        const opsUsed = gs().opsUsed
        if (opsUsed >= sideConfig.opsRangeMin) {
          gs().endSideOperations()
          break
        }
        // Aún no llegamos al mínimo: gastar ops marcando la primera unidad disponible
        const aiFactionVal = aiFaction
        const unused = Object.values(gs().units).filter(
          u => u.faction === aiFactionVal && !u.isUsed && u.position !== null
        )
        if (unused.length > 0) {
          gs().endUnitActivation(unused[0].instanceId)
          await delay(200)
        } else {
          gs().endSideOperations()
          break
        }
        continue
      }

      await executeAction(action, aiSide, scenario)
      await delay(400)
    }

  } finally {
    gs().setAIThinking(false)
  }
}

// ─── Op Fire (respuesta a movimiento del humano) ──────────────────────────────

export async function runAIOpFire(): Promise<void> {
  const gs = useGameStore.getState

  await delay(400)  // Pequeña pausa para que el jugador vea qué está pasando

  const state = gs()
  const { pendingOpFire, scenario, units, smokeHexes } = state
  if (!pendingOpFire || !scenario) return

  const { eligibleFirers, movingUnitId } = pendingOpFire
  const movingUnit = units[movingUnitId]
  if (!movingUnit) { gs().passOpFire(); return }

  const movingHex = scenario.hexes.find(h => h.id === pendingOpFire.enteredHexId)
  if (!movingHex) { gs().passOpFire(); return }

  const hexMap = buildHexMap(scenario.hexes)

  // Puntuar cada firer elegible
  interface ScoredFirer { firerId: string; score: number }
  const scored: ScoredFirer[] = eligibleFirers
    .map(firerId => {
      const firer    = units[firerId]
      if (!firer || !firer.position) return { firerId, score: 0 }

      const firerHex = scenario.hexes.find(h => h.id === firer.position)
      if (!firerHex) return { firerId, score: 0 }

      const firerStats = getActiveInfantryStats(firer.unitTypeId, firer.isReduced)
      if (!firerStats) return { firerId, score: 0 }

      const eligibility = checkOpFireEligibility(firer, firerHex, movingHex, firerStats)
      if (!eligibility.canFire) return { firerId, score: 0 }

      const los = computeLOS(firerHex, movingHex, hexMap, smokeHexes)
      if (los.blocked) return { firerId, score: 0 }

      const terrainMod = terrainFireModifier(
        movingHex.terrain, movingHex.fortification,
        movingHex.elevation, movingHex.upperLevel,
      )
      const base       = firer.suppression === 0 ? firerStats.normalFP : firerStats.profFP
      const adjustedFP = clamp(base + terrainMod, 0, 14)

      const pSuppress = clamp(adjustedFP / 10, 0, 0.95)
      const pElim     = clamp((adjustedFP - firerStats.casualtyElim) / 10, 0, 0.85)
      const expected  = pSuppress * 1.5 + pElim * 5

      // Penalizar si el firer está suprimido (obtiene FP reducido)
      const suppressPenalty = firer.suppression > 0 ? 0.5 : 1.0

      return { firerId, score: expected * suppressPenalty }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0 && scored[0].score > 1.5) {
    const result = gs().tryOpFireUnit(scored[0].firerId, movingUnitId)
    if (!result.ok) gs().passOpFire()
  } else {
    gs().passOpFire()
  }
}

// ─── Rout ─────────────────────────────────────────────────────────────────────

export async function runAIRout(playerFaction: Faction, scenario: Scenario): Promise<void> {
  const gs = useGameStore.getState
  gs().setAIThinking(true)

  try {
    const aiFaction = getAIFaction(playerFaction, scenario)

    const aiUnitsOnBoard = Object.values(gs().units).filter(
      u => u.faction === aiFaction && u.position !== null
    )

    for (const unit of aiUnitsOnBoard) {
      const cat = getUnitType(unit.unitTypeId)?.category ?? 'squad'
      if (cat === 'vehicle' || cat === 'decoy') continue  // Vehículos/decoys no hacen rout

      const freshState = gs()
      const freshUnit  = freshState.units[unit.instanceId]
      if (!freshUnit?.position) continue

      const unitHex = scenario.hexes.find(h => h.id === freshUnit.position)
      if (!unitHex) continue

      const cond = getRoutCondition(freshUnit, unitHex, freshState.units, scenario.hexes, scenario)
      if (cond.mustRout) {
        await delay(300)
        gs().tryRoutUnit(unit.instanceId)
      }
    }
  } finally {
    gs().setAIThinking(false)
  }
}

// ─── Melee ────────────────────────────────────────────────────────────────────

export async function runAIMelee(): Promise<void> {
  const gs = useGameStore.getState
  gs().setAIThinking(true)

  try {
    const { scenario, units } = gs()
    if (!scenario) return

    // Buscar hexes con unidades de ambos bandos (melee)
    const hexIds = new Set(
      Object.values(units).filter(u => u.position).map(u => u.position!)
    )
    const meleeHexes: string[] = []
    for (const hexId of hexIds) {
      const inHex    = Object.values(units).filter(u => u.position === hexId)
      const factions = new Set(inHex.map(u => u.faction))
      if (factions.size >= 2) meleeHexes.push(hexId)
    }

    for (const hexId of meleeHexes) {
      await delay(400)
      gs().tryResolveMelee(hexId)
    }
  } finally {
    gs().setAIThinking(false)
  }
}

// ─── Segunda acción de jugador (Second Player Action) ─────────────────────────

export async function runAISecondPlayerAction(
  aiSide:        ActiveSide,
  playerFaction: Faction,
  scenario:      Scenario,
): Promise<void> {
  const gs = useGameStore.getState
  const state = gs()

  if (!state.secondPlayerActionPending) return

  // La IA gasta el CP si tiene y puede sacar beneficio
  const aiFaction  = getAIFaction(playerFaction, scenario)
  const aiSideKey  = getAISide(playerFaction, scenario)
  const cps        = state.commandPoints[aiSideKey]
  const objectives = getObjectiveData(scenario, aiFaction)

  // Usar el CP si somos defensores con unidades sin cubrir, o si hay un objetivo crítico
  const shouldUse = cps > 0 && (
    objectives.aiIsAttacker === false ||
    objectives.targetHexes.length > 0
  )

  await delay(500)
  if (shouldUse && state.activeSide === aiSide) {
    gs().useSecondPlayerActionCP()
  } else {
    gs().passSecondPlayerAction()
  }
}
