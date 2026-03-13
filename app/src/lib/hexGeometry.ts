/**
 * hexGeometry.ts
 * Cálculo de posiciones píxel y adyacencia para hexágonos flat-top y pointy-top.
 *
 * Sistema de coordenadas del juego:
 *   col_idx: A=0, B=1, C=2, ..., I=8  (columnas, W→E)
 *   row:     0-9                        (filas, N→S)
 *
 *   Columnas pares (A,C,E,G,I → col_idx 0,2,4,6,8): filas 1-9
 *   Columnas impares (B,D,F,H → col_idx 1,3,5,7):   filas 0-9 (desplazadas abajo ½ hex)
 *
 * Para escenarios con tablero rotado 90° → orientación pointy-top.
 * En ese caso Col/Row ya vienen transformados en el CSV.
 */

import type { HexSide, HexOrientation } from '../types'

export const HEX_SIZE = 40  // radio (circunradio), ajustable

// ─── Pixel center para flat-top ──────────────────────────────────────────────
// x = col * 1.5 * R
// y = row * √3 * R  +  (col impar ? √3/2 * R : 0)

export function hexCenter(col: number, row: number, size = HEX_SIZE): [number, number] {
  const x = col * 1.5 * size
  const y = row * Math.SQRT2 * size * 0.866 + (col % 2 === 1 ? 0.866 * size : 0)
  return [x, y]
}

// ─── Pixel center para flat-top usando Col/Row del CSV ───────────────────────
// El CSV ya provee Col y Row como enteros del grid ensamblado.
// Para flat-top: mismo cálculo que arriba con Col como col_idx.

export function hexCenterFromGrid(
  col: number,
  row: number,
  orientation: HexOrientation,
  size = HEX_SIZE
): [number, number] {
  const R = size
  const H = R * Math.sqrt(3)  // altura del hex

  if (orientation === 'flat-top') {
    // col par (A,C,E,G,I) → sin desplazamiento vertical
    // col impar (B,D,F,H) → desplazado ½ H hacia abajo
    const x = col * 1.5 * R + R
    const y = row * H + (col % 2 === 1 ? H / 2 : 0) + H / 2
    return [x, y]
  } else {
    // pointy-top (tablero rotado 90° en el ensamblador)
    // Las coords Col/Row mantienen la convención de stagger flat-top:
    //   col_idx par  → rows desde 1 (sin row 0)
    //   col_idx impar → rows desde 0
    // Pero el espaciado para teselar hexágonos pointy-top es diferente:
    //   Vecino E (col+2, misma row): distancia √3R  → Δx = H = √3R
    //   Vecino diagonal NE/SE:       distancia √3R  → Δx = H/2, Δy = 1.5R
    // Fórmula: x = (col+1) * H/2,  y = row*3R + (col impar ? 1.5R : 0) + R
    const x = (col + 1) * (H / 2)
    const y = row * 3 * R + (col % 2 === 1 ? 1.5 * R : 0) + R
    return [x, y]
  }
}

// ─── Vértices del hexágono ────────────────────────────────────────────────────

export function hexVertices(cx: number, cy: number, size = HEX_SIZE, orientation: HexOrientation = 'flat-top'): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const angleDeg = orientation === 'flat-top' ? 60 * i : 60 * i + 30
    const angleRad = (Math.PI / 180) * angleDeg
    pts.push([cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)])
  }
  return pts
}

export function hexVertexString(cx: number, cy: number, size = HEX_SIZE, orientation: HexOrientation = 'flat-top'): string {
  return hexVertices(cx, cy, size, orientation)
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ')
}

// ─── Lados de un hexágono (pares de vértices) ─────────────────────────────────
// flat-top: vértices 0-5 en sentido horario desde el ángulo 0 (derecha)
// Lado N  = vértice 5 → 0  (arriba)
// Lado NE = vértice 0 → 1
// Lado SE = vértice 1 → 2
// Lado S  = vértice 2 → 3
// Lado SW = vértice 3 → 4
// Lado NW = vértice 4 → 5

// flat-top: vértices 0-5 en sentido horario desde 0° (E-mid)
//   0(0°,E-mid), 1(60°,SE-low), 2(120°,SW-low), 3(180°,W-mid), 4(240°,NW-high), 5(300°,NE-high)
// Lado N  = vértice 4 → 5  (borde superior)
// Lado NE = vértice 5 → 0  (borde superior-derecho)
// Lado SE = vértice 0 → 1  (borde inferior-derecho)
// Lado S  = vértice 1 → 2  (borde inferior)
// Lado SW = vértice 2 → 3  (borde inferior-izquierdo)
// Lado NW = vértice 3 → 4  (borde superior-izquierdo)

const FLAT_TOP_SIDE_INDICES: Record<string, [number, number]> = {
  N:  [4, 5],
  NE: [5, 0],
  SE: [0, 1],
  S:  [1, 2],
  SW: [2, 3],
  NW: [3, 4],
}

// pointy-top: vértices 0-5 desde 30° (E-low)
//   0(30°,E-low), 1(90°,S-tip), 2(150°,W-low), 3(210°,W-high), 4(270°,N-tip), 5(330°,E-high)
// Lado NE = vértice 4 → 5  (borde superior-derecho)
// Lado E  = vértice 5 → 0  (borde derecho)
// Lado SE = vértice 0 → 1  (borde inferior-derecho)
// Lado SW = vértice 1 → 2  (borde inferior-izquierdo)
// Lado W  = vértice 2 → 3  (borde izquierdo)
// Lado NW = vértice 3 → 4  (borde superior-izquierdo)

const POINTY_TOP_SIDE_INDICES: Record<string, [number, number]> = {
  NE: [4, 5],
  E:  [5, 0],
  SE: [0, 1],
  SW: [1, 2],
  W:  [2, 3],
  NW: [3, 4],
}

export function hexSidePoints(
  cx: number, cy: number,
  side: HexSide,
  size = HEX_SIZE,
  orientation: HexOrientation = 'flat-top'
): [[number, number], [number, number]] | null {
  const verts = hexVertices(cx, cy, size, orientation)
  const map = orientation === 'flat-top' ? FLAT_TOP_SIDE_INDICES : POINTY_TOP_SIDE_INDICES
  const pair = map[side]
  if (!pair) return null
  return [verts[pair[0]], verts[pair[1]]]
}

// ─── Adyacencia ──────────────────────────────────────────────────────────────
// Devuelve el vecino en la dirección dada para flat-top.
// col_idx par = A,C,E,G,I (col "even-letter" → odd index in letters, starts at row 1)
// col_idx impar = B,D,F,H (col "odd-letter" → even index, starts at row 0, shifted down)

export function flatTopNeighbor(col: number, row: number, side: string): [number, number] | null {
  const isOdd = col % 2 === 1  // impar → columna B,D,F,H (desplazada hacia abajo)

  const neighbors: Record<string, [number, number]> = isOdd
    ? {  // col impar (B,D,F,H)
        N:  [col,     row - 1],
        S:  [col,     row + 1],
        NE: [col + 1, row],
        SE: [col + 1, row + 1],
        NW: [col - 1, row],
        SW: [col - 1, row + 1],
      }
    : {  // col par (A,C,E,G,I)
        N:  [col,     row - 1],
        S:  [col,     row + 1],
        NE: [col + 1, row - 1],
        SE: [col + 1, row],
        NW: [col - 1, row - 1],
        SW: [col - 1, row],
      }

  return neighbors[side] ?? null
}

// ─── Distancia entre hexes (coordenadas de cubo) ─────────────────────────────

function toCube(col: number, row: number): [number, number, number] {
  // Convertir offset flat-top (odd-q) a cubo
  const q = col
  const r = row - (col - (col & 1)) / 2
  return [q, r, -q - r]
}

export function hexDistance(c1: number, r1: number, c2: number, r2: number): number {
  const [q1, r1c, s1] = toCube(c1, r1)
  const [q2, r2c, s2] = toCube(c2, r2)
  return Math.max(Math.abs(q1 - q2), Math.abs(r1c - r2c), Math.abs(s1 - s2))
}

// ─── Bounding box del mapa ────────────────────────────────────────────────────

export function mapBounds(
  hexes: { col: number; row: number }[],
  size = HEX_SIZE,
  orientation: HexOrientation = 'flat-top'
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const R = size
  const H = R * Math.sqrt(3)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const { col, row } of hexes) {
    const [cx, cy] = hexCenterFromGrid(col, row, orientation, size)
    const halfW = orientation === 'flat-top' ? R : H / 2
    const halfH = orientation === 'flat-top' ? H / 2 : R
    minX = Math.min(minX, cx - halfW)
    minY = Math.min(minY, cy - halfH)
    maxX = Math.max(maxX, cx + halfW)
    maxY = Math.max(maxY, cy + halfH)
  }

  return {
    minX, minY, maxX, maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
