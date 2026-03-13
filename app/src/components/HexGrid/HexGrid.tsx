import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import type { HexData, HexOrientation, UnitInstance, TerrainType } from '../../types'
import {
  hexCenterFromGrid, hexVertexString, hexSidePoints, mapBounds, HEX_SIZE
} from '../../lib/hexGeometry'
import type { HexSide } from '../../types'

// ─── Paleta de terreno ────────────────────────────────────────────────────────

const TERRAIN_COLORS: Record<TerrainType | string, string> = {
  'TERRENO ABIERTO': '#8aaa4a',
  'BOSQUE':          '#3d6b2a',
  'CARRETERA':       '#c8b878',
  'EDIF. PIEDRA':    '#7a5a4a',
  'EDIF. MADERA':    '#9a7a5a',
  'RIO / CANAL':     '#3a6a8a',
  'PUENTE':          '#a08860',
}

const HEX_STROKE = '#1a1a10'

// ─── Colores de facción ───────────────────────────────────────────────────────

const FACTION_BG: Record<string, string> = {
  American: '#c8a86a',   // Beige / khaki americano
  German:   '#6878a0',   // Azul grisáceo alemán (Feldgrau)
  Russian:  '#8b3a3a',   // Rojo oscuro ruso
  Neutral:  '#8a8a7a',
}

const FACTION_BORDER: Record<string, string> = {
  American: '#7a5c20',
  German:   '#3a4a70',
  Russian:  '#5a1a1a',
  Neutral:  '#555',
}

const FACTION_SILHOUETTE: Record<string, string> = {
  American: 'rgba(60,35,5,0.80)',
  German:   'rgba(10,15,35,0.80)',
  Russian:  'rgba(40,5,5,0.80)',
  Neutral:  'rgba(30,30,30,0.70)',
}

const FACTION_TEXT: Record<string, string> = {
  American: 'rgba(55,30,5,0.95)',
  German:   'rgba(8,12,30,0.95)',
  Russian:  'rgba(35,5,5,0.95)',
  Neutral:  '#333',
}

// ─── Props principales ────────────────────────────────────────────────────────

interface HexGridProps {
  hexes:         HexData[]
  orientation:   HexOrientation
  units:         UnitInstance[]
  unitTypes:     Record<string, { name: string; faction: string; category: string }>
  selectedUnit:  string | null
  selectedHex:   string | null
  controlHexes?: Record<string, string>
  onHexClick:         (hexId: string) => void
  onUnitClick:        (instanceId: string, e: React.MouseEvent) => void
  onUnitRightClick?:  (instanceId: string) => void
  hexSize?:           number
  // LOS check overlay
  losMode?:      boolean
  losFrom?:      string | null
  losTo?:        string | null
  losPath?:      string[]
  losBlocked?:   boolean
  // Smoke overlay
  smokeHexes?:   Record<string, 'fresh' | 'dispersed'>
  smokeMode?:    boolean
  // Setup zone highlight
  setupHighlight?: { splitCol: number; side: 'allied' | 'axis' } | null
  // Op Fire target hex
  opFireTargetHex?: string | null
  // Fog of war
  playerFaction?: string | null
}

interface VB { x: number; y: number; w: number; h: number }

// ─── Componente principal ─────────────────────────────────────────────────────

export default function HexGrid({
  hexes,
  orientation,
  units,
  unitTypes,
  selectedUnit,
  selectedHex,
  controlHexes = {},
  onHexClick,
  onUnitClick,
  onUnitRightClick,
  hexSize = HEX_SIZE,
  losMode = false,
  losFrom = null,
  losTo = null,
  losPath = [],
  losBlocked = false,
  smokeHexes = {},
  smokeMode = false,
  setupHighlight = null,
  opFireTargetHex = null,
  playerFaction = null,
}: HexGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const vbRef        = useRef<VB | null>(null)
  const [vb, setVb]  = useState<VB | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef<{ mx: number; my: number; vx: number; vy: number; vw: number; vh: number } | null>(null)

  const unitsByHex = useMemo(() => {
    const map: Record<string, UnitInstance[]> = {}
    units.forEach(u => {
      if (u.position) {
        if (!map[u.position]) map[u.position] = []
        map[u.position].push(u)
      }
    })
    return map
  }, [units])

  const bounds = useMemo(
    () => mapBounds(hexes, hexSize, orientation),
    [hexes, hexSize, orientation]
  )
  const boundsRef = useRef(bounds)
  useEffect(() => { boundsRef.current = bounds }, [bounds])

  const initVb = useMemo<VB>(() => ({
    x: bounds.minX - 40,
    y: bounds.minY - 40,
    w: bounds.width  + 80,
    h: bounds.height + 80,
  }), [bounds])

  const currentVb = vb ?? initVb

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const b  = boundsRef.current
      const iv: VB = { x: b.minX - 40, y: b.minY - 40, w: b.width + 80, h: b.height + 80 }
      const cur = vbRef.current ?? iv
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 1.15 : 0.87
      const newW = Math.max(iv.w * 0.2, Math.min(iv.w * 3, cur.w * factor))
      const newH = cur.h * (newW / cur.w)
      const svgX = cur.x + (mx / rect.width)  * cur.w
      const svgY = cur.y + (my / rect.height) * cur.h
      const newVb: VB = {
        x: svgX - (mx / rect.width)  * newW,
        y: svgY - (my / rect.height) * newH,
        w: newW, h: newH,
      }
      vbRef.current = newVb
      setVb(newVb)
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      const cur = vbRef.current ?? initVb
      setIsPanning(true)
      panStart.current = { mx: e.clientX, my: e.clientY, vx: cur.x, vy: cur.y, vw: cur.w, vh: cur.h }
    }
  }, [initVb])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !panStart.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const dx = (e.clientX - panStart.current.mx) / rect.width  * panStart.current.vw
    const dy = (e.clientY - panStart.current.my) / rect.height * panStart.current.vh
    const newVb: VB = {
      x: panStart.current.vx - dx,
      y: panStart.current.vy - dy,
      w: panStart.current.vw,
      h: panStart.current.vh,
    }
    vbRef.current = newVb
    setVb(newVb)
  }, [isPanning])

  const handleMouseUp = useCallback(() => setIsPanning(false), [])

  const zoomAt = useCallback((factor: number) => {
    const iv = { x: boundsRef.current.minX - 40, y: boundsRef.current.minY - 40, w: boundsRef.current.width + 80, h: boundsRef.current.height + 80 }
    const cur = vbRef.current ?? iv
    const newW = Math.max(iv.w * 0.2, Math.min(iv.w * 3, cur.w * factor))
    const newH = cur.h * (newW / cur.w)
    const cx = cur.x + cur.w / 2
    const cy = cur.y + cur.h / 2
    const newVb: VB = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH }
    vbRef.current = newVb
    setVb(newVb)
  }, [])

  const resetView = useCallback(() => {
    vbRef.current = null
    setVb(null)
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-map-bg select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={e => e.preventDefault()}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${currentVb.x} ${currentVb.y} ${currentVb.w} ${currentVb.h}`}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      >
        <defs>
          <clipPath id="board-clip">
            <rect
              x={bounds.minX - 1}
              y={bounds.minY - 1}
              width={bounds.width  + 2}
              height={bounds.height + 2}
            />
          </clipPath>
        </defs>

        {/* Línea LOS entre los dos hexes seleccionados */}
        {losFrom && losTo && (() => {
          const fromHex = hexes.find(h => h.id === losFrom)
          const toHex   = hexes.find(h => h.id === losTo)
          if (!fromHex || !toHex) return null
          const [x1, y1] = hexCenterFromGrid(fromHex.col, fromHex.row, orientation, hexSize)
          const [x2, y2] = hexCenterFromGrid(toHex.col,   toHex.row,   orientation, hexSize)
          const color = losBlocked ? '#ef4444' : '#22c55e'
          return (
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color}
              strokeWidth={4}
              strokeDasharray="10 6"
              strokeLinecap="round"
              opacity={0.85}
              style={{ pointerEvents: 'none' }}
            />
          )
        })()}

        <g clipPath="url(#board-clip)">
          {hexes.map(hex => (
            <HexCell
              key={hex.id}
              hex={hex}
              orientation={orientation}
              hexSize={hexSize}
              isSelected={hex.id === selectedHex}
              unitsHere={unitsByHex[hex.id] ?? []}
              unitTypes={unitTypes}
              selectedUnit={selectedUnit}
              controlled={controlHexes[hex.id]}
              onHexClick={onHexClick}
              onUnitClick={onUnitClick}
              onUnitRightClick={onUnitRightClick}
              losMode={losMode}
              losRole={
                hex.id === losFrom ? 'from'
                : hex.id === losTo ? (losBlocked ? 'to-blocked' : 'to-clear')
                : losPath.includes(hex.id) ? (losBlocked ? 'path-blocked' : 'path-clear')
                : undefined
              }
              smokeState={smokeHexes[hex.id]}
              smokeMode={smokeMode}
              isSetupZone={setupHighlight
                ? (orientation === 'pointy-top'
                    ? (setupHighlight.side === 'allied'
                        ? hex.row > setupHighlight.splitCol
                        : hex.row <= setupHighlight.splitCol)
                    : (setupHighlight.side === 'allied'
                        ? hex.col <= setupHighlight.splitCol
                        : hex.col > setupHighlight.splitCol))
                : false}
              isOpFireTarget={hex.id === opFireTargetHex}
              playerFaction={playerFaction}
            />
          ))}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex gap-1">
        <button className="btn-military w-8 h-8 text-lg" onClick={() => zoomAt(0.8)}>+</button>
        <button className="btn-military w-8 h-8 text-lg" onClick={() => zoomAt(1.25)}>−</button>
        <button className="btn-military w-8 h-8 text-sm" onClick={resetView}>⌂</button>
      </div>
    </div>
  )
}

// ─── Celda individual ─────────────────────────────────────────────────────────

interface HexCellProps {
  hex:          HexData
  orientation:  HexOrientation
  hexSize:      number
  isSelected:   boolean
  unitsHere:    UnitInstance[]
  unitTypes:    Record<string, { name: string; faction: string; category: string }>
  selectedUnit: string | null
  controlled?:  string
  onHexClick:         (hexId: string) => void
  onUnitClick:        (instanceId: string, e: React.MouseEvent) => void
  onUnitRightClick?:  (instanceId: string) => void
  losMode?:           boolean
  losRole?:           'from' | 'to-clear' | 'to-blocked' | 'path-clear' | 'path-blocked'
  smokeState?:        'fresh' | 'dispersed'
  smokeMode?:         boolean
  isSetupZone?:       boolean
  isOpFireTarget?:    boolean
  playerFaction?:     string | null
}

function HexCell({
  hex, orientation, hexSize, isSelected, unitsHere,
  unitTypes, selectedUnit, controlled,
  onHexClick, onUnitClick, onUnitRightClick,
  losMode = false, losRole,
  smokeState, smokeMode = false,
  isSetupZone = false,
  isOpFireTarget = false,
  playerFaction = null,
}: HexCellProps) {
  const [cx, cy] = hexCenterFromGrid(hex.col, hex.row, orientation, hexSize)
  const pts = hexVertexString(cx, cy, hexSize, orientation)
  const fillColor = TERRAIN_COLORS[hex.terrain] ?? '#888'
  const hasSeto   = Object.values(hex.sides).some(Boolean)

  // Ordenar unidades: selected al final (encima en SVG)
  const sorted = useMemo(() => {
    if (!selectedUnit || !unitsHere.find(u => u.instanceId === selectedUnit)) {
      return [...unitsHere]
    }
    const arr = unitsHere.filter(u => u.instanceId !== selectedUnit)
    const sel = unitsHere.find(u => u.instanceId === selectedUnit)!
    return [...arr, sel]
  }, [unitsHere, selectedUnit])

  // Dimensiones del counter — cuadrado que cabe dentro del hexágono
  // inradius = hexSize * √3/2 ≈ 0.866 * hexSize; dejamos margen para el offset
  const cW = hexSize * 1.05
  const cH = hexSize * 1.05

  // Offset de apilamiento (máx 2 unidades por regla del juego)
  // La unidad de abajo se desplaza a la esquina inferior-derecha para ser visible
  const STACK_OFFSET = 7

  return (
    <g className="hex-cell" onClick={() => onHexClick(hex.id)} style={{ cursor: 'pointer' }}>

      {/* Base del hexágono */}
      <polygon
        points={pts}
        fill={fillColor}
        stroke={isSelected ? '#c8a84b' : HEX_STROKE}
        strokeWidth={isSelected ? 2.5 : 1}
        opacity={0.95}
      />

      {/* LOS overlay */}
      {losRole && (
        <polygon
          points={pts}
          fill={
            losRole === 'from'         ? 'rgba(80,180,255,0.35)'
            : losRole === 'to-clear'   ? 'rgba(80,220,100,0.35)'
            : losRole === 'to-blocked' ? 'rgba(220,60,60,0.40)'
            : losRole === 'path-clear' ? 'rgba(80,220,100,0.18)'
            :                           'rgba(220,60,60,0.22)'
          }
          stroke={
            losRole === 'from'         ? '#50b4ff'
            : losRole === 'to-clear'   ? '#50dc64'
            : losRole === 'to-blocked' ? '#dc3c3c'
            : losRole === 'path-clear' ? '#50dc64'
            :                           '#dc3c3c'
          }
          strokeWidth={losRole.startsWith('to') || losRole === 'from' ? 2.5 : 1}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* Cursor de modo LOS */}
      {losMode && !losRole && (
        <polygon points={pts} fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.20)" strokeWidth={1} style={{ pointerEvents: 'none' }} />
      )}

      {/* Setup zone overlay */}
      {isSetupZone && !losRole && (
        <polygon points={pts}
          fill="rgba(200,220,100,0.15)"
          stroke="rgba(200,220,100,0.55)"
          strokeWidth={1.5}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Op Fire target overlay */}
      {isOpFireTarget && (
        <polygon points={pts}
          fill="rgba(220,60,60,0.25)"
          stroke="rgba(255,100,100,0.85)"
          strokeWidth={2.5}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Smoke overlay */}
      {smokeState && (
        <circle
          cx={cx} cy={cy}
          r={hexSize * 0.42}
          fill={smokeState === 'fresh' ? 'rgba(180,180,180,0.70)' : 'rgba(180,180,180,0.38)'}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* Cursor de modo humo */}
      {smokeMode && !smokeState && (
        <polygon points={pts} fill="rgba(180,180,180,0.08)"
          stroke="rgba(180,180,180,0.35)" strokeWidth={1} style={{ pointerEvents: 'none' }} />
      )}

      {/* Ícono de terreno */}
      <TerrainIcon hex={hex} cx={cx} cy={cy} size={hexSize} />

      {/* Setos en los lados */}
      {hasSeto && Object.entries(hex.sides).map(([side, hasFence]) =>
        hasFence ? (
          <HedgerowSide
            key={side}
            cx={cx} cy={cy}
            side={side as HexSide}
            orientation={orientation}
            hexSize={hexSize}
          />
        ) : null
      )}

      {/* Control del hex */}
      {controlled && (
        <circle cx={cx} cy={cy + hexSize * 0.6} r={3}
          fill={controlled === 'American' ? '#4a7c59' : '#6b7355'}
          opacity={0.7}
        />
      )}

      {/* Etiqueta de coordenada */}
      <text
        x={cx} y={cy - hexSize * 0.62}
        textAnchor="middle"
        fontSize={hexSize * 0.20}
        fill="rgba(232,213,163,0.40)"
        style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
      >
        {hex.origCoord}
      </text>

      {/* Counters apilados — máximo 2 por regla del juego
          stackDepth 0 = unidad encima (renderiza al final → visible en SVG)
          stackDepth 1 = unidad debajo (desplazada para verse en la esquina) */}
      {sorted.map((unit, i) => {
        const stackDepth = sorted.length - 1 - i   // 0 = top, ≥1 = abajo
        if (stackDepth >= 2) return null            // solo 2 visibles

        // Top: sin offset. Bottom: desplazada inferior-derecha
        const ox = stackDepth * STACK_OFFSET
        const oy = stackDepth * STACK_OFFSET

        return (
          <UnitCounter
            key={unit.instanceId}
            unit={unit}
            unitType={unitTypes[unit.unitTypeId]}
            cx={cx + ox}
            cy={cy + oy}
            cW={cW}
            cH={cH}
            isSelected={unit.instanceId === selectedUnit}
            onUnitClick={onUnitClick}
            onUnitRightClick={onUnitRightClick}
            fogOfWar={!!playerFaction && unit.isConcealed && unit.faction !== playerFaction}
          />
        )
      })}
    </g>
  )
}

// ─── Counter de unidad (diseño wargame) ──────────────────────────────────────

// Grados de rotación del indicador de facing (flat-top, 0° = arriba)
const FACING_DEGREES: Record<string, number> = {
  N: 0, NE: 60, SE: 120, S: 180, SW: 240, NW: 300,
}

interface UnitCounterProps {
  unit:               UnitInstance
  unitType:           { name: string; faction: string; category: string } | undefined
  cx:                 number
  cy:                 number
  cW:                 number   // ancho del counter
  cH:                 number   // alto del counter
  isSelected:         boolean
  onUnitClick:        (instanceId: string, e: React.MouseEvent) => void
  onUnitRightClick?:  (instanceId: string) => void
  fogOfWar?:          boolean  // unidad enemiga oculta — no revelar detalles
}

function UnitCounter({ unit, unitType, cx, cy, cW, cH, isSelected, onUnitClick, onUnitRightClick, fogOfWar = false }: UnitCounterProps) {
  const faction  = unit.faction
  const category = unitType?.category ?? 'squad'
  const bg       = FACTION_BG[faction]       ?? '#888'
  const border   = isSelected
    ? '#f5d060'
    : FACTION_BORDER[faction] ?? '#444'
  const silCol   = FACTION_SILHOUETTE[faction] ?? 'rgba(0,0,0,0.7)'
  const textCol  = FACTION_TEXT[faction]       ?? '#222'

  // Zona de silueta: 65% superior; zona de info: 35% inferior
  const silH  = cH * 0.65
  const infoH = cH * 0.35
  const top   = cy - cH / 2
  const left  = cx - cW / 2

  // Escala de la silueta
  const silScale = silH * 0.42

  // Abreviatura del tipo
  const abbr = unitAbbr(unit.unitTypeId, category)

  // Opacidad: las unidades usadas se muestran más tenues
  const opacity = unit.isUsed ? 0.58 : 1.0

  const isVehicleOrGun = category === 'vehicle' || category === 'gun'

  // Fog of war: unidad enemiga oculta — solo mostrar silueta anónima
  if (fogOfWar) {
    return (
      <g
        onClick={(e) => { e.stopPropagation(); onUnitClick(unit.instanceId, e) }}
        style={{ cursor: 'pointer' }}
      >
        <rect x={left} y={top} width={cW} height={cH} fill={bg} stroke={border} strokeWidth={1.5} rx={2} />
        <text
          x={cx} y={cy + cH * 0.08}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={cH * 0.45} fill={silCol} opacity={0.6}
          style={{ pointerEvents: 'none' }}
        >?</text>
      </g>
    )
  }

  return (
    <g
      onClick={(e) => { e.stopPropagation(); onUnitClick(unit.instanceId, e) }}
      onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onUnitRightClick?.(unit.instanceId) }}
      style={{ cursor: 'pointer' }}
      opacity={opacity}
    >
      {/* Sombra de selección */}
      {isSelected && (
        <rect
          x={left - 2} y={top - 2}
          width={cW + 4} height={cH + 4}
          fill="none"
          stroke="#f5d060"
          strokeWidth={2}
          rx={5}
          opacity={0.9}
        />
      )}

      {/* Cuerpo del counter */}
      <rect
        x={left} y={top}
        width={cW} height={cH}
        fill={bg}
        stroke={border}
        strokeWidth={1.2}
        rx={3}
      />

      {/* Línea divisoria entre silueta e info */}
      <line
        x1={left + cW * 0.06} y1={top + silH}
        x2={left + cW * 0.94} y2={top + silH}
        stroke={border}
        strokeWidth={0.6}
        opacity={0.5}
      />

      {/* Silueta (zona superior) */}
      <g
        transform={`translate(${cx}, ${top + silH * 0.52})`}
        fill={silCol}
        style={{ pointerEvents: 'none' }}
      >
        <UnitSilhouette category={category} scale={silScale} />
      </g>

      {/* Abreviatura del tipo (zona inferior, izquierda) */}
      <text
        x={left + cW * 0.12}
        y={top + silH + infoH * 0.72}
        fontSize={cH * 0.20}
        fill={textCol}
        fontFamily="monospace"
        fontWeight="bold"
        style={{ pointerEvents: 'none' }}
      >
        {abbr}
      </text>

      {/* Puntos de estado (zona inferior, derecha) */}
      <StatusDots
        unit={unit}
        rx={left + cW - cW * 0.08}   // borde derecho del área de dots
        y={top + silH + infoH * 0.55}  // centrado vertical en zona info
        dotR={cH * 0.088}
        gap={cH * 0.22}
      />

      {/* Icono oculto (concealed) — esquina superior izquierda */}
      {unit.isConcealed && (
        <text
          x={left + cW * 0.10}
          y={top + silH * 0.28}
          fontSize={cH * 0.22}
          fill={silCol}
          opacity={0.85}
          style={{ pointerEvents: 'none' }}
        >
          ◆
        </text>
      )}

      {/* Indicador de facing (vehículos/cañones) — flecha en borde superior */}
      {isVehicleOrGun && unit.facing && (
        <g
          transform={`translate(${cx}, ${top}) rotate(${FACING_DEGREES[unit.facing] ?? 0}, 0, 0)`}
          style={{ pointerEvents: 'none' }}
        >
          <polygon
            points={`0,${-cH * 0.16} ${cH * 0.10},${cH * 0.06} ${-cH * 0.10},${cH * 0.06}`}
            fill="white"
            stroke={border}
            strokeWidth={0.8}
            opacity={0.92}
          />
        </g>
      )}
    </g>
  )
}

// ─── Puntos de estado ─────────────────────────────────────────────────────────
//
// Dot layout (de derecha a izquierda):
//   [acción]  [reducida-2]  [reducida-1]  [supresión]
//
// • Supresión:  sin punto=fresca · amarillo=suprimida · rojo=tot.suprimida
// • Reducida:   2 puntos rojos adicionales
// • Acción:     blanco=usada · naranja=op fire

interface StatusDotsProps {
  unit:  UnitInstance
  rx:    number   // x del borde derecho de la zona de dots
  y:     number   // y del centro de los dots
  dotR:  number   // radio de cada punto
  gap:   number   // separación entre centros
}

function StatusDots({ unit, rx, y, dotR, gap }: StatusDotsProps) {
  // Slot 0 (rightmost): acción
  // Slot 1: reducida-2
  // Slot 2: reducida-1
  // Slot 3 (leftmost): supresión

  const slotX = (slot: number) => rx - dotR - slot * gap

  const dots: { x: number; fill: string; stroke: string }[] = []

  // Slot 0 — acción (usada o op fire)
  if (unit.isOpFire) {
    dots.push({ x: slotX(0), fill: '#ff8800', stroke: '#a04400' })
  } else if (unit.isUsed) {
    dots.push({ x: slotX(0), fill: '#e8e0d0', stroke: '#888' })
  }

  // Slots 1-2 — reducida (2 puntos rojos)
  if (unit.isReduced) {
    dots.push({ x: slotX(1), fill: '#cc2222', stroke: '#881111' })
    dots.push({ x: slotX(2), fill: '#cc2222', stroke: '#881111' })
  }

  // Slot 3 — supresión
  if (unit.suppression === 2) {
    dots.push({ x: slotX(3), fill: '#cc2222', stroke: '#881111' })
  } else if (unit.suppression === 1) {
    dots.push({ x: slotX(3), fill: '#ffcc00', stroke: '#997700' })
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x} cy={y}
          r={dotR}
          fill={d.fill}
          stroke={d.stroke}
          strokeWidth={0.6}
        />
      ))}
    </g>
  )
}

// ─── Silueta por categoría ────────────────────────────────────────────────────

function UnitSilhouette({ category, scale: s }: { category: string; scale: number }) {
  switch (category) {

    // Soldado de infantería: casco + cuerpo con brazos en guardia
    case 'squad':
      return (
        <g>
          {/* Casco */}
          <path d={`M${-s*0.38},${-s*0.52} Q${-s*0.42},${-s*1.05} 0,${-s*1.08} Q${s*0.42},${-s*1.05} ${s*0.38},${-s*0.52} Z`} />
          {/* Cabeza */}
          <ellipse rx={s*0.28} ry={s*0.26} cy={-s*0.58} />
          {/* Cuerpo */}
          <path d={`M${-s*0.50},${s*0.58} L${-s*0.35},${-s*0.32} L${s*0.35},${-s*0.32} L${s*0.50},${s*0.58} Z`} />
          {/* Rifle diagonal */}
          <line x1={-s*0.20} y1={-s*0.10} x2={s*0.58} y2={-s*0.80}
            stroke="currentColor" strokeWidth={s*0.12} strokeLinecap="round" />
        </g>
      )

    // Ametralladora MG: cuerpo + cañón largo + bípode
    case 'wt_mg':
      return (
        <g>
          {/* Cuerpo MG */}
          <rect x={-s*0.55} y={-s*0.28} width={s*0.80} height={s*0.42} rx={s*0.10} />
          {/* Culata */}
          <rect x={-s*0.82} y={-s*0.18} width={s*0.30} height={s*0.30} rx={s*0.06} />
          {/* Cañón */}
          <rect x={s*0.22} y={-s*0.14} width={s*0.88} height={s*0.20} rx={s*0.08} />
          {/* Boca de fuego */}
          <rect x={s*1.06} y={-s*0.18} width={s*0.12} height={s*0.28} rx={s*0.04} />
          {/* Bípode izquierdo */}
          <line x1={-s*0.10} y1={s*0.14} x2={-s*0.36} y2={s*0.72}
            stroke="currentColor" strokeWidth={s*0.16} strokeLinecap="round" />
          {/* Bípode derecho */}
          <line x1={s*0.16} y1={s*0.14} x2={s*0.40} y2={s*0.72}
            stroke="currentColor" strokeWidth={s*0.16} strokeLinecap="round" />
        </g>
      )

    // Mortero: tubo inclinado 45° + placa base + bípode
    case 'wt_mortar':
      return (
        <g>
          {/* Placa base */}
          <ellipse rx={s*0.60} ry={s*0.16} cy={s*0.62} />
          {/* Tubo */}
          <rect x={-s*0.14} y={-s*0.80} width={s*0.28} height={s*0.95}
            rx={s*0.10} transform={`rotate(-38, 0, ${s*0.10})`} />
          {/* Bípode */}
          <line x1={-s*0.06} y1={s*0.10} x2={-s*0.50} y2={s*0.62}
            stroke="currentColor" strokeWidth={s*0.14} strokeLinecap="round" />
          <line x1={s*0.10} y1={s*0.10} x2={s*0.50} y2={s*0.62}
            stroke="currentColor" strokeWidth={s*0.14} strokeLinecap="round" />
        </g>
      )

    // Decoy: interrogante con círculo
    case 'decoy':
      return (
        <g>
          <circle r={s*0.80} fill="none" stroke="currentColor" strokeWidth={s*0.14} strokeDasharray={`${s*0.25} ${s*0.15}`} />
          <text textAnchor="middle" dy={s*0.38} fontSize={s*1.10} fontWeight="bold" fontFamily="serif">?</text>
        </g>
      )

    // Tanque: casco bajo + orugas + torreta + cañón
    case 'vehicle':
      return (
        <g>
          {/* Oruga izquierda */}
          <rect x={-s*1.05} y={s*0.08} width={s*2.10} height={s*0.50} rx={s*0.22} />
          {/* Casco */}
          <rect x={-s*0.80} y={-s*0.20} width={s*1.60} height={s*0.36} rx={s*0.10} />
          {/* Torreta */}
          <ellipse rx={s*0.44} ry={s*0.35} cy={-s*0.22} />
          {/* Cañón */}
          <rect x={s*0.30} y={-s*0.30} width={s*0.90} height={s*0.18} rx={s*0.07} />
        </g>
      )

    // Cañón: escudo protector + ruedas + cañón elevado
    case 'gun':
      return (
        <g>
          {/* Rueda izquierda */}
          <circle cx={-s*0.44} cy={s*0.50} r={s*0.30} fill="none"
            stroke="currentColor" strokeWidth={s*0.16} />
          {/* Rueda derecha */}
          <circle cx={s*0.30} cy={s*0.50} r={s*0.30} fill="none"
            stroke="currentColor" strokeWidth={s*0.16} />
          {/* Eje */}
          <line x1={-s*0.44} y1={s*0.50} x2={s*0.30} y2={s*0.50}
            stroke="currentColor" strokeWidth={s*0.12} />
          {/* Escudo */}
          <path d={`M${-s*0.62},${s*0.20} L${-s*0.62},${-s*0.52} Q0,${-s*0.68} ${s*0.62},${-s*0.52} L${s*0.62},${s*0.20} Z`} />
          {/* Cañón (elevado ~30°) */}
          <rect x={s*0.22} y={-s*0.52} width={s*1.00} height={s*0.20}
            rx={s*0.08} transform={`rotate(-28, ${s*0.22}, ${-s*0.42})`} />
        </g>
      )

    // Aeronave: fuselaje + alas en delta + cola
    case 'aircraft':
      return (
        <g>
          {/* Fuselaje */}
          <ellipse rx={s*0.18} ry={s*0.80} />
          {/* Alas */}
          <path d={`M0,${-s*0.10} L${-s*1.05},${s*0.50} L${-s*0.50},${s*0.50} L0,${s*0.10} L${s*0.50},${s*0.50} L${s*1.05},${s*0.50} Z`} />
          {/* Cola */}
          <path d={`M0,${s*0.65} L${-s*0.38},${s*0.90} L${s*0.38},${s*0.90} Z`} />
        </g>
      )

    default:
      return (
        <rect x={-s*0.65} y={-s*0.55} width={s*1.30} height={s*1.10} rx={s*0.15} />
      )
  }
}

// ─── Abreviaturas de tipos de unidad ─────────────────────────────────────────

const UNIT_ABBR: Record<string, string> = {
  'Paratrooper Squad':       'PARA',
  'Paratrooper w/ Bazooka':  'BAZ',
  'Paratrooper MG':          'MG',
  'Paratrooper Mortar':      'MRT',
  'Paratrooper DECOY':       '?',
  '1st Line':                '1ª L',
  '1st Line MG WT':          'MG',
  'Mortar WT':               'MRT',
  '2nd Line':                '2ª L',
  '2nd Line MG WT':          'MG',
  '1st Line DECOY':          '?',
  'M4A1':                    'M4A1',
  'M4A3 (76)':               'M4-76',
  'M4A3 (105)':              'M4-105',
  'M18 Tank Destroyer':      'M18',
  'M36 Tank Destroyer':      'M36',
  '57mm AT Gun':             '57mm',
  'PzIIIN':                  'PzIII',
  'Marder IIIH':             'Mrdr',
  'PzIVH':                   'PzIV',
  'PzVG':                    'Pnth',
  'PzVIE':                   'Tigr',
  'Stug IIIG':               'Stug',
  '20mm':                    '20mm',
  '88mm AA':                 '88mm',
  'Stuka JU87G':             'Stka',
}

function unitAbbr(unitTypeId: string, category: string): string {
  if (UNIT_ABBR[unitTypeId]) return UNIT_ABBR[unitTypeId]
  if (category === 'decoy') return '?'
  return unitTypeId.substring(0, 4).toUpperCase()
}

// ─── Ícono de terreno ─────────────────────────────────────────────────────────

function TerrainIcon({ hex, cx, cy, size }: { hex: HexData; cx: number; cy: number; size: number }) {
  const s = size * 0.3
  switch (hex.terrain) {
    case 'BOSQUE':
      return (
        <g style={{ pointerEvents: 'none' }} opacity={0.6}>
          <circle cx={cx - s*0.4} cy={cy + s*0.2} r={s*0.45} fill="#2a5520" />
          <circle cx={cx + s*0.4} cy={cy + s*0.2} r={s*0.45} fill="#2a5520" />
          <circle cx={cx}        cy={cy - s*0.1} r={s*0.55} fill="#2d6128" />
        </g>
      )
    case 'EDIF. PIEDRA':
      return (
        <rect x={cx - s*0.6} y={cy - s*0.5} width={s*1.2} height={s}
          fill="#5a3a2a" stroke="#3a2010" strokeWidth={0.5}
          style={{ pointerEvents: 'none' }} opacity={0.7}
        />
      )
    case 'EDIF. MADERA':
      return (
        <g style={{ pointerEvents: 'none' }} opacity={0.7}>
          <rect x={cx - s*0.55} y={cy - s*0.3} width={s*1.1} height={s*0.8}
            fill="#7a5a3a" stroke="#5a3a20" strokeWidth={0.5} />
          <polygon points={`${cx},${cy - s*0.7} ${cx - s*0.6},${cy - s*0.2} ${cx + s*0.6},${cy - s*0.2}`}
            fill="#6a4a2a" stroke="#4a2a10" strokeWidth={0.5} />
        </g>
      )
    case 'RIO / CANAL':
      return (
        <rect x={cx - size*0.4} y={cy - size*0.15} width={size*0.8} height={size*0.3}
          fill="#2a5a7a" opacity={0.4} style={{ pointerEvents: 'none' }} rx={2} />
      )
    case 'PUENTE':
      return (
        <g style={{ pointerEvents: 'none' }} opacity={0.8}>
          <rect x={cx - size*0.4} y={cy - size*0.08} width={size*0.8} height={size*0.16}
            fill="#a08860" stroke="#806840" strokeWidth={0.5} />
        </g>
      )
    default:
      return null
  }
}

// ─── Seto en un lado ──────────────────────────────────────────────────────────

function HedgerowSide({ cx, cy, side, orientation, hexSize }: {
  cx: number; cy: number; side: HexSide; orientation: HexOrientation; hexSize: number
}) {
  const pts = hexSidePoints(cx, cy, side, hexSize, orientation)
  if (!pts) return null
  const [[x1, y1], [x2, y2]] = pts
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="#2d5a1a"
      strokeWidth={hexSize * 0.15}
      strokeLinecap="round"
      style={{ pointerEvents: 'none' }}
    />
  )
}
