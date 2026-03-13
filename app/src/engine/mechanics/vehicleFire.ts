/**
 * vehicleFire.ts — Fuego de vehículos y cañones (Reglas 20.4–20.7).
 *
 * Flujo:
 *  1. Prof Check (si aplica) → si falla, la unidad queda marcada como Used.
 *  2. Si pasa (o no era necesario):
 *     a. Vs infantería/cañones: resolveVGunVsInfantry() → FireResult estándar
 *     b. Vs vehículos: resolveVGunVsVehicle() → { roll, attackNumber, destroyed }
 *
 * Arco de fuego y ángulo de blindaje:
 *  - isInFrontArc() — si el objetivo está en el arco frontal (2 hexes)
 *  - armorForAngle() — armorFront vs armorSide según posición del atacante
 *  - isRearAttack()  — +1 FP si el atacante está en el arco trasero
 */

import type { HexData, HexSideFlat, UnitInstance, FireResult } from '../../types'
import type { InfantryStats, GunStats } from '../../types'
import { rollD10 } from './dice'
import { getVehicleStats } from './unitTypes'
import { vgunFireModifier, isOpenGround, movingInOpenGroundModifier } from './terrain'
import { hexDistance } from './los'

// ─── Arco de fuego y ángulo de blindaje ──────────────────────────────────────

/**
 * Mapa de arco frontal (flat-top).
 * facing → los dos hexes vecinos que forman el arco frontal.
 * Convención: facing 'X' apunta al hexspine entre X y el vecino CCW de X.
 */
const FRONT_ARC: Record<HexSideFlat, readonly HexSideFlat[]> = {
  N:  ['NW', 'N']  as const,
  NE: ['N',  'NE'] as const,
  SE: ['NE', 'SE'] as const,
  S:  ['SE', 'S']  as const,
  SW: ['S',  'SW'] as const,
  NW: ['SW', 'NW'] as const,
}

const OPPOSITE_FACING: Record<HexSideFlat, HexSideFlat> = {
  N: 'S', NE: 'SW', SE: 'NW', S: 'N', SW: 'NE', NW: 'SE',
}

/**
 * Facing opuesto (hacia atrás) de cada dirección.
 * Exportado para uso en cálculo de coste de rotación (Regla 12.0).
 */
export const REAR_FACING: Record<HexSideFlat, HexSideFlat> = OPPOSITE_FACING

/** Orden de facings en sentido horario. */
const FACING_ORDER: HexSideFlat[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW']

/**
 * Calcula el número mínimo de pasos de 60° (CW o CCW) para rotar
 * de `from` a `to`. 0 si ya están en la misma dirección.
 */
export function rotationSteps(from: HexSideFlat, to: HexSideFlat): number {
  const a = FACING_ORDER.indexOf(from)
  const b = FACING_ORDER.indexOf(to)
  if (a === -1 || b === -1) return 0
  const diff = Math.abs(a - b)
  return Math.min(diff, 6 - diff)
}

/**
 * Devuelve la dirección (HexSideFlat) desde `from` hacia `to` en un mapa flat-top.
 * Devuelve null si los hexes no son adyacentes.
 */
export function directionBetweenHexes(from: HexData, to: HexData): HexSideFlat | null {
  const dc = to.col - from.col
  const dr = to.row - from.row
  const isOdd = from.col % 2 === 1

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
 * Devuelve true si `fromHex` está en el arco frontal de una unidad en `defenderHex`
 * con el facing dado. El arco frontal son los 2 hexes vecinos del hexspine.
 */
export function isInFrontArc(
  facing: HexSideFlat,
  defenderHex: HexData,
  fromHex: HexData,
): boolean {
  const dir = directionBetweenHexes(defenderHex, fromHex)
  if (!dir) return false   // hexes no adyacentes → no en arco frontal
  const arc = FRONT_ARC[facing]
  return (arc as readonly string[]).includes(dir)
}

/**
 * Devuelve true si `attackerHex` está en el arco TRASERO del defensor.
 * El arco trasero es el arco frontal del facing opuesto.
 */
export function isRearAttack(
  target: UnitInstance,
  attackerHex: HexData,
  defenderHex: HexData,
): boolean {
  if (!target.facing) return false
  const oppFacing = OPPOSITE_FACING[target.facing]
  return isInFrontArc(oppFacing, defenderHex, attackerHex)
}

/**
 * Devuelve el blindaje a usar según el ángulo de ataque:
 * - armorFront si el atacante está en el arco frontal del defensor
 * - armorSide en caso contrario (flancos y trasera usan armorSide)
 */
export function armorForAngle(
  target: UnitInstance,
  attackerHex: HexData,
  defenderHex: HexData,
): number {
  const vStats = getVehicleStats(target.unitTypeId)
  if (!vStats) return 0
  if (!target.facing) return vStats.armorFront   // sin facing → usar frontal por defecto
  if (isInFrontArc(target.facing, defenderHex, attackerHex)) return vStats.armorFront
  return vStats.armorSide
}

// ─── Prof Check ───────────────────────────────────────────────────────────────

export interface ProfCheckParams {
  /** Valor base de Proficiency del tirador. */
  proficiency:         number
  /** Distancia al objetivo en hexes. */
  rangeHexes:          number
  /** True si se dispara como Op Fire (pero el tirador NO estaba marcado como Op Fire). */
  opFireMode:          boolean
  /** True si se dispara como Final Op Fire. */
  finalOpFireMode:     boolean
  /** True si el tirador estaba marcado como Op Fire cuando disparó → +1. */
  firerIsOpFireMarked: boolean
  /** True si el tirador giró dentro de su hex para disparar → -1. */
  firerTurnedInHex:    boolean
  /** True si el tirador se movió a un nuevo hex antes de disparar → -4. */
  firerMovedToNewHex:  boolean
  /** True si el objetivo tiene un Move counter → -1 al prof. */
  targetHasMoveCounter: boolean
  /** True si el objetivo está a mayor elevación que el tirador → -1. */
  targetHigher:        boolean
  /** Número de hindrances en la LOS → -1 por hindrance. */
  hindrances:          number
}

export interface ProfCheckResult {
  /** Tirada de dado (d10). */
  roll:      number
  /** Proficiency + suma de modificadores (valor necesario para pasar). */
  needed:    number
  /** True si roll ≤ needed (y roll ≠ 10). */
  passed:    boolean
  /** Desglose de modificadores aplicados. */
  modifiers: { label: string; value: number }[]
  /** True si el Prof Check no era necesario (rango ≤5 sin otras razones). */
  skipped:   boolean
}

/**
 * Determina si se necesita un Prof Check y lo resuelve.
 *
 * Según la PAC, el Prof Check es necesario si:
 *  - Rango > 5 hexes
 *  - Op Fire, Final Op Fire, o disparar tras moverse
 *  - El tirador giró en su hex
 *  - El objetivo está a mayor elevación
 *  - Hay hindrances en la LOS
 */
export function resolveProfCheck(p: ProfCheckParams): ProfCheckResult {
  const mods: { label: string; value: number }[] = []

  // ── Modificadores de rango (solo el mejor, según PAC "USE ONE") ──────────────
  let rangeMod = 0
  if (p.rangeHexes > 30)      rangeMod = -3
  else if (p.rangeHexes > 20) rangeMod = -2
  else if (p.rangeHexes > 10) rangeMod = -1
  else if (p.rangeHexes > 5)  rangeMod = 0
  if (p.rangeHexes > 5) mods.push({ label: `Rango ${p.rangeHexes}`, value: rangeMod })

  // ── Modificadores de modo de fuego (solo el peor, según PAC "USE ONE") ───────
  let fireMod = 0
  if (p.finalOpFireMode) {
    fireMod = -3
    mods.push({ label: 'Final Op Fire', value: -3 })
  } else if (p.opFireMode) {
    fireMod = -2
    mods.push({ label: 'Op Fire', value: -2 })
  }
  void fireMod

  // +1 si el tirador estaba marcado Op Fire
  if (p.firerIsOpFireMarked) mods.push({ label: 'Marcado Op Fire', value: +1 })

  // ── Movimiento ───────────────────────────────────────────────────────────────
  // "USE ONE": solo el peor de girar/moverse
  if (p.firerMovedToNewHex) {
    mods.push({ label: 'Movió a nuevo hex', value: -4 })
  } else if (p.firerTurnedInHex) {
    mods.push({ label: 'Giró en hex', value: -1 })
  }

  // ── Otros modificadores ──────────────────────────────────────────────────────
  if (p.targetHasMoveCounter) mods.push({ label: 'Move counter (objetivo)', value: -1 })
  if (p.targetHigher)         mods.push({ label: 'Objetivo más alto',        value: -1 })
  for (let i = 0; i < p.hindrances; i++) mods.push({ label: 'Hindrance',    value: -1 })

  const needed = p.proficiency + mods.reduce((s, m) => s + m.value, 0)

  // Sin razones para un Prof Check → se salta
  const needsCheck = p.rangeHexes > 5 || p.opFireMode || p.finalOpFireMode ||
    p.firerTurnedInHex || p.firerMovedToNewHex || p.targetHigher || p.hindrances > 0
  if (!needsCheck) {
    return { roll: 0, needed, passed: true, modifiers: mods, skipped: true }
  }

  const roll = rollD10()
  const passed = roll !== 10 && roll <= needed

  return { roll, needed, passed, modifiers: mods, skipped: false }
}

// ─── Fuego vs infantería / cañones ───────────────────────────────────────────

export interface VGunVsInfParams {
  /** FP del tirador contra infantería (fpVsInfantry). */
  attackerFP:        number
  /** Distancia en hexes. */
  rangeHexes:        number
  /** Hex del objetivo. */
  targetHex:         HexData
  /** Si el objetivo está reducido. */
  targetIsReduced:   boolean
  /** Stats del objetivo (para calcular bajas). */
  targetStats:       InfantryStats | GunStats
  /** Si el objetivo está en movimiento. */
  targetIsMoving:    boolean
  /** Si el objetivo está Concealed. */
  targetIsConcealed: boolean
  /** Si el atacante está a mayor elevación. */
  attackerHigher:    boolean
  /** Si el atacante está a menor elevación. */
  attackerLower:     boolean
  /** Si hay flank sobre el objetivo. */
  targetHasFlank:    boolean
  /** Hexes de humo en la LOS (-1 FP por hindrance). */
  hindrances?:       number
}

/**
 * Resuelve un ataque de vehículo/cañón contra infantería o cañón.
 * Mecánica similar a resolveFireAttack pero con columna V/GUN FP de la PAC.
 *
 * Diferencias respecto a fuego de infantería:
 * - Usar vgunFireModifier() para terreno
 * - "Adjacent" = +1 (no +3)
 * - No hay Prof FP modifiers (ya pasaron el Prof Check)
 */
export function resolveVGunVsInfantry(p: VGunVsInfParams): FireResult {
  const mods: { label: string; value: number }[] = []

  let fp = p.attackerFP

  // Terreno del objetivo (columna V/GUN FP)
  const hasSeto   = Object.values(p.targetHex.sides).some(Boolean)
  const terrainMod = vgunFireModifier(p.targetHex.terrain, p.targetHex.fortification, hasSeto)
  if (terrainMod !== 0) mods.push({ label: 'Terreno', value: terrainMod })

  // Adyacente: +1 (PAC V/GUN column)
  if (p.rangeHexes === 1) mods.push({ label: 'Adyacente', value: +1 })

  // Objetivo moviéndose en terreno abierto
  if (p.targetIsMoving && isOpenGround(p.targetHex.terrain, p.targetHex.fortification)) {
    const miogMod = movingInOpenGroundModifier(p.rangeHexes)
    if (miogMod !== 0) mods.push({ label: 'Mov. en terreno abierto', value: miogMod })
  }

  // Oculto
  if (p.targetIsConcealed) mods.push({ label: 'Oculto', value: -1 })

  // Elevación
  if (p.attackerHigher) mods.push({ label: 'Objetivo más bajo', value: +1 })
  else if (p.attackerLower) mods.push({ label: 'Objetivo más alto', value: -1 })

  // Flanco
  if (p.targetHasFlank) mods.push({ label: 'Flanco', value: +1 })

  // Smoke hindrance
  const h = p.hindrances ?? 0
  if (h > 0) mods.push({ label: `Humo (${h}×)`, value: -h })

  fp = fp + terrainMod + mods.filter(m => m.label !== 'Terreno').reduce((s, m) => s + m.value, 0)

  const roll = rollD10()

  if (roll === 10) {
    return { roll, adjustedFP: fp, suppressed: false, reduced: false, eliminated: false, modifiers: mods }
  }

  // Para GunStats, usamos casualtyReduce y casualtyElim directamente
  const targetStats = p.targetStats
  const casualtyReduce = p.targetIsReduced ? null : (targetStats.casualtyReduce ?? null)
  const casualtyElim   = targetStats.casualtyElim

  let suppressed = false
  let reduced    = false
  let eliminated = false

  if (roll <= fp) {
    suppressed = true
  } else if (roll === 1 && p.rangeHexes <= ((p.targetStats as InfantryStats).rangeMax ?? Infinity)) {
    suppressed = true
  }

  if (!suppressed) {
    return { roll, adjustedFP: fp, suppressed: false, reduced: false, eliminated: false, modifiers: mods }
  }

  // Comprobación de bajas
  if (!p.targetIsReduced && casualtyReduce !== null && roll + casualtyReduce <= fp) {
    reduced = true
  } else if (!p.targetIsReduced && roll === 1 && p.rangeHexes === 1) {
    reduced = true
  }

  if (p.targetIsReduced) {
    if (roll + casualtyElim <= fp || (roll === 1 && p.rangeHexes === 1)) eliminated = true
  } else if (roll + casualtyElim <= fp) {
    eliminated = true
  }

  return {
    roll,
    adjustedFP:  fp,
    suppressed,
    reduced:     reduced && !eliminated,
    eliminated,
    modifiers:   mods,
  }
}

// ─── Fuego vs vehículos ───────────────────────────────────────────────────────

export interface VGunVsVehicleParams {
  /** FP del tirador contra vehículos (fpVsVehicle). */
  attackerFP:      number
  /** Blindaje del objetivo (front o side según ángulo). */
  targetArmor:     number
  /** Distancia en hexes. */
  rangeHexes:      number
  /** True si el atacante ataca por la trasera → +1 FP. */
  isRearAttack:    boolean
  /** True si el objetivo está a mayor elevación → -1 FP. */
  targetHigher:    boolean
  /** True si el objetivo está a menor elevación → +1 FP. */
  targetLower:     boolean
  /** True si rango > 20 hexes → -1 FP adicional. */
  overRange20:     boolean
  /** True si rango > 30 hexes → -1 FP adicional. */
  overRange30:     boolean
}

export interface VGunVsVehicleResult {
  roll:         number
  attackNumber: number   // attackerFP - targetArmor + modifiers
  destroyed:    boolean
  modifiers:    { label: string; value: number }[]
}

/**
 * Resuelve un ataque de vehículo/cañón contra un vehículo.
 * PAC: attackNumber = FP − Armor + modifiers; roll ≤ attackNumber → destroy.
 * Roll 10 = siempre sin efecto.
 */
export function resolveVGunVsVehicle(p: VGunVsVehicleParams): VGunVsVehicleResult {
  const mods: { label: string; value: number }[] = []

  if (p.isRearAttack)  mods.push({ label: 'Trasera',           value: +1 })
  if (p.targetLower)   mods.push({ label: 'Objetivo más bajo', value: +1 })
  if (p.targetHigher)  mods.push({ label: 'Objetivo más alto', value: -1 })
  if (p.overRange30)   mods.push({ label: 'Rango > 30',        value: -1 })
  if (p.overRange20)   mods.push({ label: 'Rango > 20',        value: -1 })

  const sumMods    = mods.reduce((s, m) => s + m.value, 0)
  const attackNumber = p.attackerFP - p.targetArmor + sumMods

  const roll      = rollD10()
  const destroyed = roll !== 10 && roll <= attackNumber

  return { roll, attackNumber, destroyed, modifiers: mods }
}

// ─── Flank tracking ───────────────────────────────────────────────────────────

/**
 * Calcula qué unidades tienen el flanco expuesto.
 * Solo aplica a unidades con `facing` (vehículos/cañones).
 * Una unidad tiene flanco expuesto si hay al menos un enemigo adyacente
 * que NO está en su arco frontal.
 */
export function computeFlankStates(
  units: Record<string, UnitInstance>,
  hexes: HexData[]
): Record<string, boolean> {
  const hexMap = new Map(hexes.map(h => [h.id, h]))
  const result: Record<string, boolean> = {}
  for (const [id, unit] of Object.entries(units)) {
    if (!unit.position || !unit.facing) { result[id] = false; continue }
    const unitHex = hexMap.get(unit.position)
    if (!unitHex) { result[id] = false; continue }
    const adjHexIds = new Set(
      hexes.filter(h => hexDistance(h.col, h.row, unitHex.col, unitHex.row) === 1).map(h => h.id)
    )
    const enemiesAdj = Object.values(units).filter(u =>
      u.position && adjHexIds.has(u.position) && u.faction !== unit.faction
    )
    result[id] = enemiesAdj.some(enemy => {
      const enemyHex = hexMap.get(enemy.position!)
      if (!enemyHex) return false
      return !isInFrontArc(unit.facing!, unitHex, enemyHex)
    })
  }
  return result
}
