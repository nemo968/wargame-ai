/**
 * terrain.ts — Costes de movimiento y modificadores de fuego por terreno.
 *
 * Fuente: Player Aid Card (PAC) v2.3
 */

import type { TerrainType } from '../../types'

// ─── Costes de movimiento (MPs) ───────────────────────────────────────────────

/**
 * Coste en MPs para ENTRAR a un hex según su terreno central.
 * No incluye el coste adicional por cruzar un seto (hedgerow) en un lado.
 *
 * Carretera/Puente (PAC v2.3): 2/3 MP para infantería, 1/2 MP para vehículos.
 */
export function terrainMoveCost(
  terrain: TerrainType,
  fortification: string,
  unitCategory: string = 'squad',
): number {
  const isVehicle = unitCategory === 'vehicle'
  // Las fortificaciones no añaden coste de entrada
  switch (terrain) {
    case 'TERRENO ABIERTO': return 1
    case 'CARRETERA':       return isVehicle ? 0.5 : 2/3   // PAC: 2/3 inf, 1/2 veh
    case 'BOSQUE':          return 2
    case 'EDIF. PIEDRA':    return 2
    case 'EDIF. MADERA':    return 2
    case 'PUENTE':          return isVehicle ? 0.5 : 2/3   // "Bridges function as a road"
    case 'RIO / CANAL':     return Infinity                 // Solo mediante puente
    case 'SETO':            return 1                        // El seto está en los lados
    default:                return 1
  }
  void fortification  // fortifications don't change entry cost
}

/**
 * Coste adicional en MPs por cruzar un lado con seto (hedgerow).
 * Se suma al coste normal del hex de destino.
 */
export const HEDGEROW_CROSS_COST = 1

// ─── Modificadores de fuego de infantería (FP modifier) ──────────────────────
// Valores negativos = reducen el FP (protección); positivos = aumentan el FP.

/**
 * Modificador al FP de fuego directo de infantería según el terreno del hex objetivo.
 * Valores según la PAC v2.3.
 */
export function terrainFireModifier(
  terrain: TerrainType,
  fortification: string,
  elevation: number = 0,
  upperLevel: boolean = false,
): number {
  let mod = 0

  // Modificador base por tipo de terreno del centro del hex
  switch (terrain) {
    case 'TERRENO ABIERTO': mod = 0;  break
    case 'CARRETERA':       mod = 0;  break   // Open Ground a efectos de fuego
    case 'BOSQUE':          mod = -1; break
    case 'EDIF. MADERA':    mod = -1; break
    case 'EDIF. PIEDRA':    mod = -2; break
    case 'PUENTE':          mod = 0;  break
    case 'RIO / CANAL':     mod = 0;  break
    case 'SETO':            mod = 0;  break   // El seto está en los lados (ver hasSeto)
    default:                mod = 0;  break
  }

  // Modificador por fortification (prevalece sobre terreno base si es más negativo)
  switch (fortification) {
    case 'TRINCHERA': mod = Math.min(mod, -2); break   // Foxholes/Trench: -2
    case 'BUNKER':    mod = Math.min(mod, -3); break   // Pillbox: -3
    default: break
  }

  void elevation
  void upperLevel

  return mod
}

// ─── Modificadores de fuego de Vehículo/Cañón (columna V/GUN FP de la PAC) ───

/**
 * Modificador al FP de fuego de vehículo/cañón contra infantería y cañones.
 * Columna "V/Gun FP" de la PAC v2.3.
 * Nota: para fuego contra vehículos no aplican modificadores de terreno.
 */
export function vgunFireModifier(
  terrain: TerrainType,
  fortification: string,
  hasSeto: boolean = false,
): number {
  let mod = 0

  switch (terrain) {
    case 'TERRENO ABIERTO': mod = 0;  break
    case 'CARRETERA':       mod = 0;  break
    case 'BOSQUE':          mod = -1; break
    case 'EDIF. MADERA':    mod = -1; break
    case 'EDIF. PIEDRA':    mod = -2; break
    case 'PUENTE':          mod = 0;  break
    case 'RIO / CANAL':     mod = 0;  break
    case 'SETO':            mod = 0;  break
    default:                mod = 0;  break
  }

  // El seto en los lados da -2 adicional (igual que infantería)
  if (hasSeto) mod = Math.min(mod, -2)

  // Fortifications: más protección contra V/GUN que contra infantería
  switch (fortification) {
    case 'TRINCHERA': mod = Math.min(mod, -4); break   // Foxholes/Trench: -4
    case 'BUNKER':    mod = Math.min(mod, -6); break   // Pillbox/Bunker: -6
    default: break
  }

  return mod
}

/**
 * Modificador al FP cuando los atacantes tienen ELEVACIÓN SUPERIOR al objetivo.
 * PAC: Higher Elevation = -1 FP para el defensor (ó +1 para el atacante).
 * Aquí expresado como modificador aplicado al FP del atacante.
 */
export const ELEVATION_HIGHER_MODIFIER = +1  // FP modifier when attacker is HIGHER (target lower → easier to hit)
export const ELEVATION_LOWER_MODIFIER  = -1  // FP modifier when attacker is LOWER (target higher → harder to hit)

// ─── Modificadores de fuego AIR FP (columna AIR FP de la PAC) ────────────────

/**
 * Modificador al FP de ataques aéreos (aeronaves) contra infantería y cañones.
 * Columna "AIR FP" de la PAC v2.3.
 * Nota: hindrances no afectan a aeronaves; concealment se elimina en vez de dar -1.
 */
export function airFireModifier(terrain: TerrainType, fortification: string): number {
  let mod = 0
  switch (terrain) {
    case 'EDIF. MADERA':    mod = -1; break
    case 'EDIF. PIEDRA':    mod = -2; break
    case 'BOSQUE':          mod = +1; break
    default:                mod =  0; break
  }
  switch (fortification) {
    case 'TRINCHERA': mod = Math.min(mod, -2); break
    case 'BUNKER':    mod = Math.min(mod, -3); break
    default: break
  }
  return mod
}

// ─── Modificadores de fuego ART FP (columna ART FP de la PAC) ────────────────

/**
 * Modificador al FP de ataques de artillería contra infantería y cañones.
 * Columna "ART FP" de la PAC v2.3.
 * Nota: hindrances y concealment aplican con normalidad a artillería.
 */
export function artFireModifier(terrain: TerrainType, fortification: string): number {
  let mod = 0
  switch (terrain) {
    case 'EDIF. MADERA':    mod = -1; break
    case 'EDIF. PIEDRA':    mod = -2; break
    case 'BOSQUE':          mod = +1; break
    default:                mod =  0; break
  }
  switch (fortification) {
    case 'TRINCHERA': mod = Math.min(mod, -4); break
    case 'BUNKER':    mod = Math.min(mod, -6); break
    default: break
  }
  return mod
}

// ─── Terrain beneficial (beneficioso para el defensor) ───────────────────────

/**
 * Devuelve true si el terreno proporciona un "Beneficial Terrain modifier"
 * contra fuego directo (es decir, reduce el FP del atacante).
 * Esto determina si una unidad puede ocultar, y si en Rout Phase
 * necesita buscar ese hex.
 */
export function isBeneficialTerrain(
  terrain: TerrainType,
  fortification: string,
  hasSeto: boolean = false,
): boolean {
  if (hasSeto) return true
  if (fortification === 'TRINCHERA' || fortification === 'BUNKER') return true
  switch (terrain) {
    case 'BOSQUE':
    case 'EDIF. MADERA':
    case 'EDIF. PIEDRA':
      return true
    default:
      return false
  }
}

/**
 * Devuelve true si el terreno se considera "Open Ground" a efectos
 * del modificador por movimiento en terreno abierto (+4 FP al atacante).
 */
export function isOpenGround(terrain: TerrainType, fortification: string): boolean {
  if (fortification === 'TRINCHERA' || fortification === 'BUNKER') return false
  switch (terrain) {
    case 'TERRENO ABIERTO':
    case 'CARRETERA':
    case 'PUENTE':
      return true
    default:
      return false
  }
}

// ─── Terreno que bloquea la LOS ───────────────────────────────────────────────

/**
 * Devuelve true si este tipo de terreno puede BLOQUEAR la línea de visión
 * cuando está en un hex intermedio a la misma elevación o superior.
 * (Buildings, Hedgerows, Woods, Hills — según regla 14.0)
 */
export function isLOSBlockingTerrain(terrain: TerrainType): boolean {
  switch (terrain) {
    case 'BOSQUE':
    case 'EDIF. PIEDRA':
    case 'EDIF. MADERA':
      return true
    default:
      return false
  }
}

/**
 * Devuelve true si el terreno crea Hindrance (entorpecimiento) pero no bloqueo
 * total de LOS. Por ahora solo implementamos bloqueo total.
 */
export function isLOSHinderingTerrain(_terrain: TerrainType): boolean {
  void _terrain
  return false
}

// ─── Modificador por movimiento en terreno abierto ───────────────────────────

/**
 * Calcula el modificador al FP por el objetivo moviéndose en Open Ground.
 * PAC: +4 en rango 1-4, +2 en rango 5-8, +0 en rango >8
 */
export function movingInOpenGroundModifier(rangeInHexes: number): number {
  if (rangeInHexes <= 4) return +4
  if (rangeInHexes <= 8) return +2
  return 0
}
