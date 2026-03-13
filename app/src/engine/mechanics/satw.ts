/**
 * satw.ts — Special Anti-Tank Weapons (Regla 33.0).
 *
 * Flujo:
 *  1. SATW Check: MC modificado. Si falla → unidad marcada como Used.
 *  2. Si pasa: SATW Attack vs vehículo.
 *     - FP = satwFP (de InfantryStats) ± modificadores de posición/ángulo.
 *     - NO se resta el blindaje del objetivo (SATW lo ignora).
 *     - Roll ≤ adjustedFP → destruido. Roll 10 = sin efecto.
 *
 * Modificadores del SATW Check (PAC):
 *  - satwNumber (de InfantryStats.satw): modificador negativo al Moral
 *  - -1 por cada hex de rango (o -1 cada 5 hexes para ATR — no modelado aún)
 *  - -2 si Op Fire
 *  - +1 si el tirador estaba marcado Op Fire
 *  - -1 si Assault Fire
 *  - -1 smoke no disperso
 *  - -1 por hindrance
 *  - -2 si dispara desde edificio o pillbox (backblast)
 */

import type { FireResult } from '../../types'
import { rollD10 } from './dice'

// ─── SATW Check ───────────────────────────────────────────────────────────────

export interface SATWCheckParams {
  /** Morale actual de la unidad (según supresión). */
  unitMorale:           number
  /** Número SATW de la unidad (de InfantryStats.satw): modificador negativo. */
  satwNumber:           number
  /** Distancia al objetivo en hexes. */
  rangeHexes:           number
  /** True si se usa como Op Fire (sin estar marcado Op Fire). */
  isOpFire:             boolean
  /** True si el tirador estaba marcado con Op Fire counter. */
  firerIsOpFireMarked:  boolean
  /** True si Assault Fire. */
  isAssaultFire:        boolean
  /** True si hay humo no disperso en la LOS. */
  nonDispersedSmoke:    boolean
  /** Número de hindrances en la LOS. */
  hindrances:           number
  /** True si el tirador está en edificio o pillbox (backblast). */
  fromBuildingOrPillbox: boolean
}

export interface SATWCheckResult {
  roll:      number
  morale:    number   // morale efectivo tras aplicar modificadores
  passed:    boolean
  modifiers: { label: string; value: number }[]
}

/**
 * Resuelve el SATW Check (un MC modificado).
 * roll ≤ morale efectivo → pasa.
 */
export function resolveSATWCheck(p: SATWCheckParams): SATWCheckResult {
  const mods: { label: string; value: number }[] = []

  // Número SATW (modificador negativo al morale)
  mods.push({ label: `SATW número (${p.satwNumber})`, value: -p.satwNumber })

  // Rango: -1 por hex
  if (p.rangeHexes > 0) mods.push({ label: `Rango ${p.rangeHexes}`, value: -p.rangeHexes })

  // Op Fire / Assault Fire (solo uno aplica)
  if (p.isOpFire)        mods.push({ label: 'Op Fire', value: -2 })
  if (p.isAssaultFire)   mods.push({ label: 'Assault Fire', value: -1 })

  // Marcado Op Fire → +1
  if (p.firerIsOpFireMarked) mods.push({ label: 'Marcado Op Fire', value: +1 })

  // Smoke y hindrances
  if (p.nonDispersedSmoke)   mods.push({ label: 'Humo', value: -1 })
  for (let i = 0; i < p.hindrances; i++) mods.push({ label: 'Hindrance', value: -1 })

  // Backblast desde edificio/pillbox
  if (p.fromBuildingOrPillbox) mods.push({ label: 'Backblast (edificio)', value: -2 })

  const sumMods = mods.reduce((s, m) => s + m.value, 0)
  const morale  = p.unitMorale + sumMods

  const roll   = rollD10()
  const passed = roll <= morale

  return { roll, morale, passed, modifiers: mods }
}

// ─── Ataque SATW vs vehículo ─────────────────────────────────────────────────

export interface SATWAttackParams {
  /** FP del SATW (de InfantryStats.satwFP). */
  satwFP:           number
  /** True si el vehículo objetivo es Open Topped → +2 FP. */
  targetIsOpenTopped: boolean
  /** True si el atacante dispara desde la trasera del objetivo → +1 FP. */
  isRearAttack:     boolean
  /** True si el objetivo está a menor elevación → +1 FP. */
  targetLower:      boolean
  /** True si el objetivo está a mayor elevación → -1 FP. */
  targetHigher:     boolean
  /** True si rango > 20 hexes → -1 FP. */
  overRange20:      boolean
  /** True si rango > 30 hexes → -1 FP adicional. */
  overRange30:      boolean
}

export interface SATWAttackResult {
  roll:        number
  adjustedFP:  number
  destroyed:   boolean
  modifiers:   { label: string; value: number }[]
}

/**
 * Resuelve el ataque del SATW tras pasar el SATW Check.
 * Los mismos modificadores que VGunVsVehicle aplican al satwFP.
 * NOTA: NO se resta el blindaje (SATW ignora el armor del objetivo).
 * Roll 10 = sin efecto.
 */
export function resolveSATWAttack(p: SATWAttackParams): SATWAttackResult {
  const mods: { label: string; value: number }[] = []

  if (p.targetIsOpenTopped) mods.push({ label: 'Vehículo abierto', value: +2 })
  if (p.isRearAttack)       mods.push({ label: 'Trasera',           value: +1 })
  if (p.targetLower)        mods.push({ label: 'Objetivo más bajo', value: +1 })
  if (p.targetHigher)       mods.push({ label: 'Objetivo más alto', value: -1 })
  if (p.overRange30)        mods.push({ label: 'Rango > 30',        value: -1 })
  if (p.overRange20)        mods.push({ label: 'Rango > 20',        value: -1 })

  const adjustedFP = p.satwFP + mods.reduce((s, m) => s + m.value, 0)
  const roll       = rollD10()
  const destroyed  = roll !== 10 && roll <= adjustedFP

  return { roll, adjustedFP, destroyed, modifiers: mods }
}

// ─── Resultado combinado del ataque SATW ─────────────────────────────────────

/**
 * Resultado completo de un ataque SATW (para el log y para el store).
 */
export interface SATWResult {
  checkResult:  SATWCheckResult
  attackResult: SATWAttackResult | null   // null si el SATW Check falló
  /** Texto de log para el resultado. */
  logMessage:   string
}

// ─── Fuego de SATW contra infantería/cañones ─────────────────────────────────
// PAC: cuando SATW dispara a infantería/cañones, usa el FP normal de la unidad
// con los modificadores estándar de infantería. Solo la función resolveFireAttack
// normal aplica en ese caso; este módulo solo cubre ataques contra vehículos.

/**
 * Devuelve un FireResult sintético marcando que el SATW Check falló (sin efecto).
 * Se usa para generar un resultado consistente cuando el check falla.
 */
export function satwCheckFailedResult(): FireResult {
  return {
    roll:       0,
    adjustedFP: 0,
    suppressed: false,
    reduced:    false,
    eliminated: false,
    modifiers:  [],
  }
}
