/**
 * unitTypes.ts — Base de datos de tipos de unidad con sus estadísticas.
 *
 * Fuente: SE_Units.csv (Band of Brothers: Screaming Eagles v2.3)
 *
 * Columnas del CSV:
 *   Potencia de fuego    → normalFP  (también fpVsVehicle para vehículos/cañones)
 *   Potencia eficiente   → profFP    (también fpVsInfantry para vehículos/cañones)
 *   Potencia en melee    → meleeFP   (solo WTs; null = usa normalFP en melee)
 *   Alcance              → rangeMax  (">1" = mortero, min 2; "X-Y" = min X, max Y)
 *   SATW                 → satw
 *   Baja reducción       → casualtyReduce (full strength) / casualtyElim (reduced, único número)
 *   Baja de elimin.      → casualtyElim   (solo full strength)
 *   Moral alta/media/baja → moraleFresh / moraleSup / moraleFull
 *   Blindaje frontal/lat → armorFront / armorSide
 *   Mov. vehículos       → movement
 *   Eficacia             → proficiency
 *
 * Para unidades Reducidas (fila "(Reducida)"):
 *   - casualtyReduce = null  (ya no puede ser "reducida" más)
 *   - casualtyElim   = valor de la columna "Baja reducción" de esa fila
 */

import type { UnitType, InfantryStats, VehicleStats, GunStats, Faction, UnitCategory } from '../../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inf(
  normalFP: number, profFP: number, meleeFP: number | null,
  rangeMin: number, rangeMax: number | null,
  satw: number | null,
  casualtyReduce: number | null, casualtyElim: number,
  moraleFresh: number, moraleSup: number, moraleFull: number,
  isMortar = false,
  satwFP: number | null = null,
  satwRange: number | null = null,
): InfantryStats {
  return { normalFP, profFP, meleeFP, rangeMin, rangeMax, satw, satwFP, satwRange, casualtyReduce, casualtyElim, moraleFresh, moraleSup, moraleFull, isMortar }
}

function veh(
  fpVsVehicle: number, fpVsInfantry: number,
  armorFront: number, armorSide: number,
  movement: number, proficiency: number,
): VehicleStats {
  return { fpVsVehicle, fpVsInfantry, armorFront, armorSide, movement, proficiency }
}

function gun(
  fpVsVehicle: number, fpVsInfantry: number,
  casualtyReduce: number | null, casualtyElim: number,
  moraleFresh: number, moraleSup: number, moraleFull: number,
  proficiency: number,
): GunStats {
  return { fpVsVehicle, fpVsInfantry, casualtyReduce, casualtyElim, moraleFresh, moraleSup, moraleFull, proficiency }
}

function unit(
  id: string, name: string, faction: Faction, category: UnitCategory, count: number,
  stats: InfantryStats | VehicleStats | GunStats,
  reduced: InfantryStats | null = null,
): UnitType {
  return { id, name, faction, category, count, stats, reduced }
}

// ─── AMERICAN INFANTRY ────────────────────────────────────────────────────────

const PARATROOPER_SQUAD = unit(
  'Paratrooper Squad', 'Paratrooper Squad', 'American', 'squad', 16,
  inf(6, 5, null, 1, 5,  null, 4, 8,  10, 6, 2),
  inf(6, 5, null, 1, 4,  null, null, 5,  9, 6, 2),  // Reducida: casualtyElim=5
)

const PARATROOPER_BAZOOKA = unit(
  'Paratrooper w/ Bazooka', 'Paratrooper w/ Bazooka', 'American', 'squad', 5,
  inf(6, 5, null, 1, 5,  2,    4, 8,  10, 6, 2, false, 11, 4),
  inf(6, 5, null, 1, 4,  2,    null, 5,  9, 6, 2, false, 11, 4),
)

const PARATROOPER_MG = unit(
  'Paratrooper MG', 'Paratrooper MG', 'American', 'wt_mg', 3,
  inf(8, 7, 2,    1, 14, null, 4, 8,  10, 6, 2),
  inf(7, 5, 1,    1, 12, null, null, 4,  9, 6, 2),
)

// Mortar: ">1" = rangeMin 2; rangeMax estimado en 10 (60mm mortar típico en BoB)
const PARATROOPER_MORTAR = unit(
  'Paratrooper Mortar', 'Paratrooper Mortar', 'American', 'wt_mortar', 3,
  inf(8, 6, 2,    2, 10, null, 4, 8,  10, 6, 2, true),
  inf(6, 3, 1,    2, 10, null, null, 4,  9, 6, 2, true),
)

// Decoy: tiene las mismas stats que Paratrooper Squad (los identifica como Squads al enemigo)
const PARATROOPER_DECOY = unit(
  'Paratrooper DECOY', 'Paratrooper DECOY', 'American', 'decoy', 9,
  inf(6, 5, null, 1, 5,  null, 4, 8,  10, 6, 2),
  inf(6, 5, null, 1, 4,  null, null, 5,  9, 6, 2),
)

// ─── AMERICAN VEHICLES & GUNS ─────────────────────────────────────────────────

const M4A1 = unit(
  'M4A1', 'M4A1 Sherman', 'American', 'vehicle', 3,
  veh(10, 10, 7, 4, 12, 8),
)

const M4A3_76 = unit(
  'M4A3 (76)', 'M4A3 Sherman (76mm)', 'American', 'vehicle', 6,
  veh(13, 10, 7, 4, 14, 8),
)

const M4A3_105 = unit(
  'M4A3 (105)', 'M4A3 Sherman (105mm)', 'American', 'vehicle', 2,
  veh(9, 12, 7, 4, 14, 7),
)

const M18 = unit(
  'M18 Tank Destroyer', 'M18 Hellcat TD', 'American', 'vehicle', 4,
  veh(13, 9, 2, 1, 22, 9),
)

const M36 = unit(
  'M36 Tank Destroyer', 'M36 Jackson TD', 'American', 'vehicle', 2,
  veh(16, 9, 6, 2, 14, 9),
)

const GUN_57MM = unit(
  '57mm AT Gun', '57mm AT Gun', 'American', 'gun', 4,
  gun(10, 4, 6, 3, 10, 6, 2, 8),
)

// ─── GERMAN INFANTRY ──────────────────────────────────────────────────────────

const GERMAN_1ST_LINE = unit(
  '1st Line', '1st Line', 'German', 'squad', 20,
  inf(5, 3, null, 1, 6,  3,    4, 7,  10, 5, 1),
  inf(4, 2, null, 1, 5,  3,    null, 4,  8, 5, 1),
)

const GERMAN_1ST_MG = unit(
  '1st Line MG WT', '1st Line MG WT', 'German', 'wt_mg', 3,
  inf(8, 7, 2,    1, 14, null, 4, 7,  10, 6, 2),
  inf(7, 5, 1,    1, 12, null, null, 4,  9, 6, 2),
)

// Mortar WT: "2-12" → rangeMin=2, rangeMax=12
const GERMAN_MORTAR_WT = unit(
  'Mortar WT', 'Mortar WT', 'German', 'wt_mortar', 1,
  inf(6, 4, 2,    2, 12, null, 4, 7,  10, 6, 2, true),
  inf(5, 2, 1,    2, 12, null, null, 4,  9, 6, 2, true),
)

const GERMAN_2ND_LINE = unit(
  '2nd Line', '2nd Line', 'German', 'squad', 10,
  inf(4, 1, null, 1, 6,  4,    3, 7,  10, 5, 1),
  inf(4, 1, null, 1, 5,  4,    null, 3,  8, 5, 1),
)

const GERMAN_2ND_MG = unit(
  '2nd Line MG WT', '2nd Line MG WT', 'German', 'wt_mg', 3,
  inf(7, 5, 2,    1, 12, null, 4, 7,  10, 6, 2),
  inf(7, 5, 1,    1, 10, null, null, 4,  9, 6, 2),
)

// Decoy: mismas stats que 1st Line (las imita)
const GERMAN_1ST_DECOY = unit(
  '1st Line DECOY', '1st Line DECOY', 'German', 'decoy', 8,
  inf(5, 3, null, 1, 6,  3,    4, 7,  10, 5, 1),
  inf(4, 2, null, 1, 5,  3,    null, 4,  8, 5, 1),
)

// ─── GERMAN VEHICLES & GUNS ───────────────────────────────────────────────────

const PZIIIIN = unit(
  'PzIIIN', 'Panzer III N', 'German', 'vehicle', 2,
  veh(7, 10, 4, 2, 12, 8),
)

const MARDER_IIIH = unit(
  'Marder IIIH', 'Marder III H', 'German', 'vehicle', 2,
  veh(13, 9, 2, 1, 13, 9),
)

const PZIVH = unit(
  'PzIVH', 'Panzer IV H', 'German', 'vehicle', 5,
  veh(13, 10, 6, 3, 12, 8),
)

const PZVG = unit(
  'PzVG', 'Panzer V Panther G', 'German', 'vehicle', 3,
  veh(16, 10, 12, 4, 14, 8),
)

const PZVIE = unit(
  'PzVIE', 'Panzer VI Tiger E', 'German', 'vehicle', 4,
  veh(15, 11, 9, 6, 11, 9),
)

const STUGIIIG = unit(
  'Stug IIIG', 'Stug III G', 'German', 'vehicle', 4,
  veh(13, 8, 6, 3, 12, 7),
)

const M4A1_CAPTURED = unit(
  'M4A1 (captured)', 'M4A1 (captured)', 'German', 'vehicle', 1,
  veh(10, 10, 7, 4, 12, 6),
)

const M4A3_76_CAPTURED = unit(
  'M4A3(76) (captured)', 'M4A3(76) (captured)', 'German', 'vehicle', 1,
  veh(13, 10, 7, 4, 14, 6),
)

const GUN_20MM = unit(
  '20mm', '20mm AA Gun', 'German', 'gun', 2,
  gun(5, 9, 6, 3, 10, 6, 2, 9),
)

const GUN_88MM = unit(
  '88mm AA', '88mm AA Gun', 'German', 'gun', 3,
  gun(15, 10, 5, 2, 10, 6, 2, 9),
)

const STUKA = unit(
  'Stuka JU87G', 'Stuka JU87G', 'German', 'aircraft', 2,
  // Los aviones tienen una estructura diferente — usamos VehicleStats
  veh(8, 1, 0, 0, 0, 6),
)

// ─── RUSSIAN VEHICLES & GUNS ──────────────────────────────────────────────────

const T34M43 = unit(
  'T34M43', 'T-34 M43', 'Russian', 'vehicle', 2,
  veh(9, 9, 8, 4, 15, 6),
)

const SU76M = unit(
  'SU76M', 'SU-76M', 'Russian', 'vehicle', 2,
  veh(9, 8, 2, 1, 15, 6),
)

const SU122 = unit(
  'SU122', 'SU-122', 'Russian', 'vehicle', 2,
  veh(9, 11, 7, 4, 15, 5),
)

const CHURCHILL_IV = unit(
  'Churchill IV', 'Churchill IV', 'Russian', 'vehicle', 4,
  veh(10, 7, 7, 6, 8, 7),
)

// ─── TABLA DE TODOS LOS TIPOS ────────────────────────────────────────────────

export const UNIT_TYPES: UnitType[] = [
  // American Infantry
  PARATROOPER_SQUAD,
  PARATROOPER_BAZOOKA,
  PARATROOPER_MG,
  PARATROOPER_MORTAR,
  PARATROOPER_DECOY,
  // American Vehicles & Guns
  M4A1, M4A3_76, M4A3_105, M18, M36, GUN_57MM,
  // German Infantry
  GERMAN_1ST_LINE,
  GERMAN_1ST_MG,
  GERMAN_MORTAR_WT,
  GERMAN_2ND_LINE,
  GERMAN_2ND_MG,
  GERMAN_1ST_DECOY,
  // German Vehicles & Guns
  PZIIIIN, MARDER_IIIH, PZIVH, PZVG, PZVIE, STUGIIIG,
  M4A1_CAPTURED, M4A3_76_CAPTURED,
  GUN_20MM, GUN_88MM, STUKA,
  // Russian Vehicles & Guns
  T34M43, SU76M, SU122, CHURCHILL_IV,
]

// ─── Lookups ──────────────────────────────────────────────────────────────────

const UNIT_TYPE_MAP = new Map<string, UnitType>(
  UNIT_TYPES.map(t => [t.id, t])
)

/**
 * Devuelve el UnitType para un unitTypeId (= campo "type" del CSV de escenario).
 */
export function getUnitType(unitTypeId: string): UnitType | undefined {
  return UNIT_TYPE_MAP.get(unitTypeId)
}

/**
 * Devuelve las InfantryStats activas de una unidad según su estado.
 * Devuelve null si la unidad no es de infantería o no existe.
 */
export function getActiveInfantryStats(
  unitTypeId: string,
  isReduced:  boolean,
): InfantryStats | null {
  const ut = UNIT_TYPE_MAP.get(unitTypeId)
  if (!ut) return null
  // Solo aplica a unidades de infantería/WT/decoy
  const infantryCategories: UnitCategory[] = ['squad', 'wt_mg', 'wt_mortar', 'decoy']
  if (!infantryCategories.includes(ut.category)) return null
  if (isReduced && ut.reduced) return ut.reduced
  return ut.stats as InfantryStats
}

/**
 * Devuelve las VehicleStats de una unidad.
 * Devuelve null si no es un vehículo.
 */
export function getVehicleStats(unitTypeId: string): VehicleStats | null {
  const ut = UNIT_TYPE_MAP.get(unitTypeId)
  if (!ut || ut.category !== 'vehicle') return null
  return ut.stats as VehicleStats
}

/**
 * Devuelve las GunStats de una unidad.
 * Devuelve null si no es un cañón.
 */
export function getGunStats(unitTypeId: string): GunStats | null {
  const ut = UNIT_TYPE_MAP.get(unitTypeId)
  if (!ut || ut.category !== 'gun') return null
  return ut.stats as GunStats
}

/**
 * Devuelve true si el tipo de unidad es un Decoy.
 */
export function isDecoy(unitTypeId: string): boolean {
  return UNIT_TYPE_MAP.get(unitTypeId)?.category === 'decoy'
}

/**
 * Devuelve true si el tipo de unidad es un WT (Weapon Team).
 */
export function isWeaponTeam(unitTypeId: string): boolean {
  const cat = UNIT_TYPE_MAP.get(unitTypeId)?.category
  return cat === 'wt_mg' || cat === 'wt_mortar'
}

/**
 * Devuelve el número de MPs de la unidad según su categoría y estadísticas.
 * Squad = 5 MPs, WT = 4 MPs (Regla 2.0).
 * Vehículo = stats.movement; Cañón = 0 (no se mueven, solo giran).
 */
export function getBaseMP(unitTypeId: string): number {
  const ut = UNIT_TYPE_MAP.get(unitTypeId)
  if (!ut) return 5
  if (ut.category === 'vehicle') return (ut.stats as VehicleStats).movement
  if (ut.category === 'gun') return 0
  if (ut.category === 'wt_mg' || ut.category === 'wt_mortar') return 4
  return 5
}
