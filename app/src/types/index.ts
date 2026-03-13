// ─── Hex Grid ────────────────────────────────────────────────────────────────

export type HexOrientation = 'flat-top' | 'pointy-top'

export type HexSideFlat   = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW'
export type HexSidePointy = 'NE' | 'E' | 'SE' | 'SW' | 'W' | 'NW'
export type HexSide       = HexSideFlat | HexSidePointy

export type TerrainType =
  | 'TERRENO ABIERTO'
  | 'BOSQUE'
  | 'CARRETERA'
  | 'EDIF. PIEDRA'
  | 'EDIF. MADERA'
  | 'RIO / CANAL'
  | 'PUENTE'
  | 'SETO'           // no centro, solo lados

export interface HexData {
  id: string                        // "5E5", "8H3", etc. (mapId + coord)
  terrain: TerrainType
  elevation: number
  upperLevel: boolean
  fortification: string             // 'NINGUNA' | 'TRINCHERA' | 'BUNKER'
  sides: Partial<Record<HexSide, boolean>>  // true = seto en ese lado
  col: number                       // grid col index (global, para render)
  row: number                       // grid row index (global, para render)
  origMap: number                   // tablero de origen (1-10)
  origCoord: string                 // coordenada original ("E5", "H3", etc.)
}

// ─── Unidades ────────────────────────────────────────────────────────────────

export type Faction = 'American' | 'German' | 'Russian' | 'Neutral'

export type UnitCategory =
  | 'squad'
  | 'wt_mg'
  | 'wt_mortar'
  | 'vehicle'
  | 'gun'
  | 'aircraft'
  | 'decoy'

export type SuppressionLevel = 0 | 1 | 2  // 0=Fresh 1=Suppressed 2=FullSuppressed

export interface InfantryStats {
  normalFP:    number
  profFP:      number
  meleeFP:     number | null
  rangeMin:    number
  rangeMax:    number | null
  satw:        number | null
  satwFP:      number | null  // FP del SATW contra vehículos (null = no tiene SATW)
  satwRange:   number | null  // rango del SATW en hexes
  casualtyReduce: number | null
  casualtyElim:   number
  moraleFresh: number
  moraleSup:   number
  moraleFull:  number
  isMortar:    boolean
}

export interface VehicleStats {
  fpVsVehicle:  number
  fpVsInfantry: number
  armorFront:   number
  armorSide:    number
  movement:     number
  proficiency:  number
}

export interface GunStats {
  fpVsVehicle:  number
  fpVsInfantry: number
  casualtyReduce: number | null
  casualtyElim:   number
  moraleFresh:  number
  moraleSup:    number
  moraleFull:   number
  proficiency:  number
}

export type UnitStats = InfantryStats | VehicleStats | GunStats

export interface UnitType {
  id:       string         // unique key
  name:     string
  faction:  Faction
  category: UnitCategory
  count:    number         // fichas físicas en el juego
  stats:    UnitStats
  reduced:  InfantryStats | null
}

export interface UnitInstance {
  instanceId:  string      // único por partida
  unitTypeId:  string      // ref a UnitType.id
  isReduced:   boolean
  suppression: SuppressionLevel
  isUsed:      boolean
  isOpFire:    boolean
  isConcealed: boolean
  hasFlank:    boolean
  position:    string | null  // hexId o null (off-board)
  faction:     Faction
  facing:          HexSideFlat | null  // dirección del arco frontal (vehículos/cañones)
  hasMoveCounter:  boolean             // vehículo movió este turno → atacantes necesitan Prof Check -1
}

// ─── Escenario ───────────────────────────────────────────────────────────────

export type GamePhase = 'setup' | 'operations' | 'rout' | 'melee' | 'recovery' | 'end'
export type ActiveSide = 'allied' | 'axis'

export interface SideConfig {
  faction:      Faction
  opsRangeMin:  number
  opsRangeMax:  number
  commandPoints: number
  routEdge:     string        // 'N' | 'S' | 'E' | 'W' | 'NE' etc.
  setupDesc:    string
  altSetupDesc: string
  setupMaps:    number[]      // tableros válidos para el despliegue inicial (vacío = usar splitCol)
}

export interface ScenarioUnitEntry {
  type:       string      // nombre del tipo (match con UnitType.name)
  category:   UnitCategory
  isReduced:  boolean
  maxInGame:  number
  inScenario: number
  entryTurn:  number      // turno en que están disponibles (1 = inicio)
}

export interface NeutralUnitEntry {
  type:       string      // 'Foxhole', 'Artillería 80mm', etc.
  inScenario: number
  entryTurn:  number
}

export interface Scenario {
  num:          string     // '00', '01', etc.
  title:        string
  turns:        number
  north:        string     // dirección del norte geográfico (N, NE, E, SE, S, SW, W, NW)
  setupFirst:   Faction
  movesFirst:   Faction
  description:  string
  victory:      string
  allied:       SideConfig
  axis:         SideConfig
  alliedUnits:  ScenarioUnitEntry[]
  axisUnits:    ScenarioUnitEntry[]
  neutralUnits: NeutralUnitEntry[]
  hexes:        HexData[]
  orientation:  HexOrientation
}

// ─── Estado de partida ───────────────────────────────────────────────────────

export interface MoveUndo {
  instanceId: string
  fromHex:    string
  prevMPs:    number | null   // null = first move (not yet in unitMPs)
  prevOps:    number
}

export interface FireUndo {
  attackerId:  string
  prevAttacker: Pick<UnitInstance, 'isUsed' | 'isOpFire'>
  targetId:    string
  prevTarget:  UnitInstance        // snapshot completo (para restaurar si fue eliminada)
  targetWasEliminated: boolean
  prevOps:     number
  prevMoveUndo: MoveUndo | null   // estado del undo de movimiento previo (Assault Fire)
}

export interface PendingOpFire {
  movingUnitId:   string    // unidad que acaba de entrar al hex
  enteredHexId:   string    // hex al que entró
  eligibleFirers: string[]  // instanceIds no-activos elegibles para Op Fire/Final Op Fire
}

export interface GameState {
  scenario:       Scenario | null
  currentTurn:    number
  maxTurns:       number
  phase:          GamePhase
  activeSide:     ActiveSide
  playerFaction:  Faction | null    // bando que controla el jugador humano
  commandPoints:  Record<ActiveSide, number>
  opsUsed:        number            // unidades activadas este turno (lado activo)
  units:          Record<string, UnitInstance>   // instanceId → UnitInstance
  unitMPs:        Record<string, number>         // MPs restantes por unidad (movimiento activo)
  hexControl:     Record<string, Faction>        // hexId → faction que controla
  selectedUnit:   string | null     // instanceId
  selectedHex:    string | null     // hexId
  log:            LogEntry[]
  isAIThinking:   boolean
  activatingUnit: string | null     // instanceId de la unidad en activación activa
  lastMoveUndo:   MoveUndo | null   // estado para deshacer el último movimiento
  lastFireUndo:   FireUndo | null   // estado para deshacer el último disparo
  smokeHexes:     Record<string, 'fresh' | 'dispersed'>  // hexId → estado del humo
  pendingOpFire:           PendingOpFire | null  // oportunidad de Op Fire tras movimiento enemigo
  movingUnitMCFailed:      boolean               // unidad en movimiento falló MC tras recibir Op Fire
  setupSplitCol:           number                // col límite aliado: Allied zone = col <= setupSplitCol
  axisSetupSplitCol:       number                // col límite eje: Axis zone = col > axisSetupSplitCol
  // ── Second Player Action (Señal de Mando) ──────────────────────────────────
  secondPlayerActionPending: boolean             // 2do jugador decidiendo si usar acción bonus (CP)
  secondPlayerActionActive:  boolean             // 2do jugador realizando su acción bonus
  firstMoverSide:            ActiveSide | null   // bando que mueve primero en este turno
}

export interface LogEntry {
  turn:    number
  phase:   GamePhase
  side:    ActiveSide
  message: string
  type:    'action' | 'combat' | 'morale' | 'phase' | 'info'
}

// ─── Combate ─────────────────────────────────────────────────────────────────

export interface FireResult {
  roll:        number
  adjustedFP:  number
  suppressed:  boolean
  reduced:     boolean
  eliminated:  boolean
  modifiers:   { label: string; value: number }[]
}

export interface MeleeResult {
  attackerRolls: number[]
  defenderRolls: number[]
  attackerHits:  number
  defenderHits:  number
}
