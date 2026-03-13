/**
 * movement.ts — Validación y costes de movimiento de infantería.
 *
 * Regla 5.0:
 * - Squad = 5 MPs, WT = 4 MPs.
 * - Movimiento hex a hex adyacente. Los MPs no se guardan entre turnos.
 * - Cada tipo de terreno tiene un coste en MPs.
 * - Cruzar un lado con seto (hedgerow) cuesta +1 MP adicional.
 * - La unidad debe pasar un MC antes de moverse (excepto Morale = 10, auto-pass).
 * - Una unidad puede entrar en un hex con enemigos si tiene MPs suficientes → para al entrar.
 */

import type { UnitInstance, HexData, HexSide, HexOrientation } from '../../types'
import type { InfantryStats } from '../../types'
import { terrainMoveCost, HEDGEROW_CROSS_COST } from './terrain'
import { hexDistance } from './los'
import { getBaseMP, getUnitType } from './unitTypes'
import { directionBetweenHexes } from './vehicleFire'

export { directionBetweenHexes }

// ─── Allowance de movimiento ─────────────────────────────────────────────────

/**
 * Devuelve el allowance de MPs de una unidad.
 * Squad = 5 MPs, WT = 4 MPs (regla 2.0).
 * Se puede incrementar en +1 por gasto de CP (regla 5.4).
 */
export function movementAllowance(
  unitTypeId: string,
  cpBonus: boolean = false,
): number {
  return getBaseMP(unitTypeId) + (cpBonus ? 1 : 0)
}

// ─── Coste de entrar a un hex ────────────────────────────────────────────────

/**
 * Lado del hexágono que se cruza al moverse de `from` a `to` en flat-top.
 * Devuelve el lado del hex de DESTINO que se cruza (para comprobar setos).
 */
function crossedSideAtDestination(
  from: HexData,
  to:   HexData,
): HexSide | null {
  // Diferencia de col/row para determinar dirección
  const dc = to.col - from.col
  const dr = to.row - from.row
  const isOdd = from.col % 2 === 1

  // Mapping para flat-top según pares/impares de columna de origen
  if (isOdd) {
    if (dc ===  0 && dr === -1) return 'N'
    if (dc ===  0 && dr ===  1) return 'S'
    if (dc ===  1 && dr ===  0) return 'NE'
    if (dc ===  1 && dr ===  1) return 'SE'
    if (dc === -1 && dr ===  0) return 'NW'
    if (dc === -1 && dr ===  1) return 'SW'
  } else {
    if (dc ===  0 && dr === -1) return 'N'
    if (dc ===  0 && dr ===  1) return 'S'
    if (dc ===  1 && dr === -1) return 'NE'
    if (dc ===  1 && dr ===  0) return 'SE'
    if (dc === -1 && dr === -1) return 'NW'
    if (dc === -1 && dr ===  0) return 'SW'
  }
  return null
}

/**
 * Calcula el coste total en MPs de mover de `from` a `to`.
 * Incluye el coste del terreno del hex de destino y el posible coste
 * adicional por cruzar un lado con seto.
 *
 * @param from         Hex de origen
 * @param to           Hex de destino
 * @param orientation  Orientación del mapa (para calcular el lado cruzado)
 * @param unitCategory Categoría de la unidad ('squad', 'wt', 'vehicle', 'gun')
 */
export function hexEntryCost(
  from: HexData,
  to:   HexData,
  _orientation: HexOrientation = 'flat-top',
  unitCategory: string = 'squad',
): number {
  void _orientation
  // Coste base del terreno de destino
  const baseCost = terrainMoveCost(to.terrain, to.fortification, unitCategory)
  if (baseCost === Infinity) return Infinity

  // Coste adicional por elevación (PAC: Higher Elevation)
  // Infantería: +1 MP al subir. Vehículo: +2 en carretera, +4 sin carretera.
  let elevationCost = 0
  const elevDiff = (to.elevation ?? 0) - (from.elevation ?? 0)
  if (elevDiff > 0) {
    const isVehicle = unitCategory === 'vehicle'
    if (isVehicle) {
      const onRoad = to.terrain === 'CARRETERA' || to.terrain === 'PUENTE'
      elevationCost = onRoad ? 2 : 4
    } else {
      elevationCost = 1
    }
  }

  // Coste adicional por cruzar seto en el lado compartido
  // El seto se define en el hex que LO TIENE; comprobamos tanto el origen como el destino.
  const side = crossedSideAtDestination(from, to)
  const oppositeSide = side ? oppositeSideOf(side) : null

  const fromHasSeto = side ? (from.sides[side] === true) : false
  const toHasSeto   = oppositeSide ? (to.sides[oppositeSide] === true) : false

  const setoCost = (fromHasSeto || toHasSeto) ? HEDGEROW_CROSS_COST : 0

  return baseCost + elevationCost + setoCost
}

/** Devuelve el lado opuesto en un hex flat-top. */
function oppositeSideOf(side: HexSide): HexSide {
  const map: Record<string, HexSide> = {
    N: 'S', S: 'N', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW',
    E: 'W', W: 'E',
  }
  return map[side] ?? side
}

// ─── Validación de movimiento ─────────────────────────────────────────────────

export interface MovementValidation {
  canMove:    boolean
  cost:       number
  reason?:    string
}

/**
 * Comprueba si una unidad puede moverse de `from` a `to` con los MPs restantes.
 *
 * @param unit         Instancia de la unidad
 * @param stats        Estadísticas activas de la unidad
 * @param from         Hex de origen
 * @param to           Hex de destino
 * @param remainingMPs MPs que le quedan a la unidad en este turno
 * @param orientation  Orientación del mapa
 */
export function validateMove(
  unit:         UnitInstance,
  _stats:       InfantryStats,
  from:         HexData,
  to:           HexData,
  remainingMPs: number,
  orientation:  HexOrientation = 'flat-top',
): MovementValidation {
  // Los hexes deben ser adyacentes (distancia = 1)
  const dist = hexDistance(from.col, from.row, to.col, to.row)
  if (dist !== 1) {
    return { canMove: false, cost: 0, reason: 'El hex no es adyacente' }
  }

  // Coste de entrada (con categoría para coste de carretera correcto)
  const unitCategory = getUnitType(unit.unitTypeId)?.category ?? 'squad'
  const cost = hexEntryCost(from, to, orientation, unitCategory)
  if (cost === Infinity) {
    return { canMove: false, cost: Infinity, reason: 'No se puede entrar al hex (Río/Canal sin puente)' }
  }

  // Comprobar si tiene MPs suficientes
  if (remainingMPs < cost) {
    return { canMove: false, cost, reason: `MPs insuficientes (necesita ${cost}, tiene ${remainingMPs})` }
  }

  void unit

  return { canMove: true, cost }
}

// ─── Apilamiento ─────────────────────────────────────────────────────────────

/**
 * Comprueba si un hex tiene espacio para recibir una unidad más del bando `faction`.
 * Regla 2.0: máximo 2 Squads/WTs por bando por localización.
 * Regla 20.10: máximo 1 vehículo/cañón no montado por hex.
 *
 * @param toHexId      ID del hex de destino
 * @param faction      Facción de la unidad que se mueve
 * @param allUnits     Todas las unidades del juego
 * @param unitTypeId   ID del tipo de unidad que intenta entrar (para comprobar vehículo/cañón)
 * @param maxStack     Límite de apilamiento de infantería (por defecto 2)
 */
export function canStackInHex(
  toHexId:     string,
  faction:     string,
  allUnits:    Record<string, UnitInstance>,
  unitTypeId?: string,
  maxStack     = 2,
): boolean {
  const inHex = Object.values(allUnits).filter(
    u => u.position === toHexId && u.faction === faction
  )

  // Regla 20.10: no puede haber dos vehículos/cañones del mismo bando en el mismo hex
  const movingCategory = unitTypeId ? (getUnitType(unitTypeId)?.category ?? 'squad') : 'squad'
  const isVehicleOrGun = movingCategory === 'vehicle' || movingCategory === 'gun'
  if (isVehicleOrGun) {
    const vehicleAlreadyInHex = inHex.some(u => {
      const cat = getUnitType(u.unitTypeId)?.category
      return cat === 'vehicle' || cat === 'gun'
    })
    if (vehicleAlreadyInHex) return false
  }

  return inHex.length < maxStack
}

// ─── Comprobación de Assault Fire ────────────────────────────────────────────

/**
 * Devuelve true si una unidad de tipo Squad puede realizar Assault Fire
 * tras entrar a un hex (regla 5.2).
 * Solo Squads (no WTs) pueden hacer Assault Fire.
 */
export function canAssaultFire(category: string): boolean {
  return category === 'squad'
}

// ─── Movimiento en terreno abierto ───────────────────────────────────────────

/**
 * Devuelve true si una unidad que se mueve por `hex` está "Moving in Open Ground"
 * a efectos del modificador de fuego enemigo.
 *
 * Reglas:
 * - Terreno abierto, carretera o puente sin fortification → Moving in Open Ground.
 * - Entrar o salir de una fortification (trinchera/bunker) también se considera
 *   Moving in Open Ground (PAC, sección Fortifications).
 */
export function isMovingInOpenGround(hex: HexData, isEntering: boolean = false): boolean {
  const hasFort = hex.fortification !== 'NINGUNA' && hex.fortification !== undefined && hex.fortification !== ''
  // Entrar/salir de fortification = Moving in Open Ground (excepto moverse entre trincheras)
  if (hasFort && isEntering) return true
  switch (hex.terrain) {
    case 'TERRENO ABIERTO':
    case 'CARRETERA':
    case 'PUENTE':
      return !hasFort
    default:
      return false
  }
}
