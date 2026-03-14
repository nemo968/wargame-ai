/**
 * scenarioParser.ts
 * Parsea los ficheros CSV de escenario al formato interno Scenario.
 * Formato: secciones [NOMBRE] con pares clave;valor o filas de datos.
 */

import type {
  Scenario, SideConfig, ScenarioUnitEntry, NeutralUnitEntry, HexData,
  HexOrientation, HexSide, Faction, UnitCategory, TerrainType
} from '../types'

// ─── Utilidades ──────────────────────────────────────────────────────────────

function parseBool(v: string): boolean {
  return v.trim().toUpperCase() === 'SI' || v.trim().toUpperCase() === 'YES'
}

function splitSides(headers: string[], values: string[]): Partial<Record<HexSide, boolean>> {
  const sideKeys = ['N','NE','SE','S','SW','NW','E','W']
  const result: Partial<Record<HexSide, boolean>> = {}
  headers.forEach((h, i) => {
    const key = h.replace('Lado_', '')
    if (sideKeys.includes(key)) {
      result[key as HexSide] = parseBool(values[i] ?? 'NO')
    }
  })
  return result
}

// ─── Parser principal ────────────────────────────────────────────────────────

export function parseScenarioCSV(raw: string): Scenario {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  const sections: Record<string, string[][]> = {}
  let current = ''

  for (const line of lines) {
    if (line.startsWith('[') && line.endsWith(']')) {
      current = line.slice(1, -1)
      sections[current] = []
    } else if (current) {
      sections[current].push(line.split(';'))
    }
  }

  // ── [ESCENARIO] ──────────────────────────────────────────────────
  const esc = Object.fromEntries(
    (sections['ESCENARIO'] ?? []).map(r => [r[0]?.trim(), r[1]?.trim()])
  )

  // ── [ALIADOS] / [EJE] ────────────────────────────────────────────
  function parseSide(key: string): SideConfig {
    const d = Object.fromEntries(
      (sections[key] ?? []).map(r => [r[0]?.trim(), r[1]?.trim()])
    )
    const [min, max] = (d['Ops_rango'] ?? '1-2').split('-').map(Number)
    const setupMapsRaw = d['Zona_despliegue'] ?? ''
    const setupMaps = setupMapsRaw
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0)

    const setupDescRaw = (d['Despliegue_inicial'] ?? '').replace(/\\n/g, '\n')
    // Si el despliegue empieza por "Turn X:" el bando entra por borde durante operaciones (gratuito)
    const isEdgeEntry = /^\s*turn\s+\d+/i.test(setupDescRaw)

    return {
      faction:       d['Faccion'] as Faction ?? 'American',
      opsRangeMin:   min ?? 1,
      opsRangeMax:   max ?? 2,
      commandPoints: parseInt(d['Puntos_comando'] ?? '1'),
      routEdge:      d['Ruta_huida'] ?? 'W',
      setupDesc:     setupDescRaw,
      altSetupDesc:  (d['Despliegue_alternativo'] ?? '').replace(/\\n/g, '\n'),
      setupMaps,
      isEdgeEntry,
    }
  }

  // ── [UNIDADES_*] ─────────────────────────────────────────────────
  function parseUnits(key: string): ScenarioUnitEntry[] {
    const rows = sections[key] ?? []
    if (rows.length < 2) return []
    const header = rows[0].map(h => h.trim())
    const entryTurnIdx = header.indexOf('Turno_entrada')
    return rows.slice(1).map(r => ({
      type:       r[0]?.trim() ?? '',
      category:   r[1]?.trim() as UnitCategory ?? 'squad',
      isReduced:  parseBool(r[2] ?? 'NO'),
      maxInGame:  parseInt(r[3] ?? '0'),
      inScenario: parseInt(r[4] ?? '0'),
      entryTurn:  entryTurnIdx >= 0 ? parseInt(r[entryTurnIdx] ?? '1') || 1 : 1,
    }))
  }

  function parseNeutrals(): NeutralUnitEntry[] {
    const rows = sections['UNIDADES_NEUTRALES'] ?? []
    if (rows.length < 2) return []
    const header = rows[0].map(h => h.trim())
    const entryTurnIdx = header.indexOf('Turno_entrada')
    return rows.slice(1).map(r => ({
      type:       r[0]?.trim() ?? '',
      inScenario: parseInt(r[1] ?? '0'),
      entryTurn:  entryTurnIdx >= 0 ? parseInt(r[entryTurnIdx] ?? '1') || 1 : 1,
    })).filter(e => e.type)
  }

  // ── [MAPA] ───────────────────────────────────────────────────────
  const mapRows = sections['MAPA'] ?? []
  let hexes: HexData[] = []
  let orientation: HexOrientation = 'flat-top'

  if (mapRows.length > 1) {
    const headers = mapRows[0].map(h => h.trim())
    // Detectar orientación por las columnas de lados
    orientation = headers.includes('Lado_E') || headers.includes('Lado_W')
      ? 'pointy-top'
      : 'flat-top'

    const colIdx  = headers.indexOf('Col')
    const rowIdx  = headers.indexOf('Row')
    const coordIdx = headers.indexOf('Coordenada')
    const terIdx  = headers.indexOf('Terreno')
    const elevIdx = headers.indexOf('Elevacion')
    const ulIdx   = headers.indexOf('Upper_Level')
    const fortIdx = headers.indexOf('Fortificacion')

    hexes = mapRows.slice(1).map(r => {
      const coordRaw = r[coordIdx]?.trim() ?? ''
      // coordRaw es p.ej. "5E5" → origMap=5, origCoord="E5"
      const mapMatch = coordRaw.match(/^(\d+)([A-Z]+\d+)$/)
      const origMap   = mapMatch ? parseInt(mapMatch[1]) : 0
      const origCoord = mapMatch ? mapMatch[2] : coordRaw

      return {
        id:           coordRaw,
        terrain:      (r[terIdx]?.trim() ?? 'TERRENO ABIERTO') as TerrainType,
        elevation:    parseInt(r[elevIdx] ?? '0'),
        upperLevel:   parseBool(r[ulIdx] ?? 'NO'),
        fortification: r[fortIdx]?.trim() ?? 'NINGUNA',
        sides:        splitSides(headers, r),
        col:          parseInt(r[colIdx] ?? '0'),
        row:          parseInt(r[rowIdx] ?? '0'),
        origMap,
        origCoord,
      }
    })
  }

  return {
    num:         esc['num'] ?? '00',
    title:       esc['Titulo'] ?? '',
    turns:       parseInt(esc['Turnos'] ?? '5'),
    north:       esc['Norte'] ?? 'N',
    setupFirst:  esc['Despliega_primero'] as Faction ?? 'German',
    movesFirst:  esc['Mueve_primero'] as Faction ?? 'American',
    description: (esc['Descripcion'] ?? '').replace(/\\n/g, '\n'),
    victory:     esc['Victoria'] ?? '',
    allied:       parseSide('ALIADOS'),
    axis:         parseSide('EJE'),
    alliedUnits:  parseUnits('UNIDADES_ALIADOS'),
    axisUnits:    parseUnits('UNIDADES_EJE'),
    neutralUnits: parseNeutrals(),
    hexes,
    orientation,
  }
}

export async function loadScenario(num: string): Promise<Scenario> {
  const url = `${import.meta.env.BASE_URL}Scenario%20${num}.csv`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No se pudo cargar el escenario ${num}`)
  const text = await res.text()
  const scenario = parseScenarioCSV(text)
  scenario.num = num
  return scenario
}

export async function loadScenarioIndex(): Promise<{ num: string; url: string }[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}scenarios.json`)
  if (!res.ok) return []
  return res.json()
}
