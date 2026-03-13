import { create } from 'zustand'
import type { GameState, GamePhase, ActiveSide, Faction, Scenario, UnitInstance, LogEntry, FireResult, SuppressionLevel, MoveUndo, FireUndo, HexData } from '../types'
import {
  validateMove, movementAllowance, canStackInHex,
  resolveFireAttack, getActiveInfantryStats,
  computeLOS, buildHexMap, hexDistance,
  fireLogMessage, getUnitType, getVehicleStats, getGunStats,
  getCurrentMorale, rollMoraleCheck, mcLogMessage,
  rollD10,
  // vehicle fire
  resolveProfCheck, resolveVGunVsInfantry, resolveVGunVsVehicle,
  isInFrontArc, armorForAngle, isRearAttack as isVehicleRearAttack,
  directionBetweenHexes, REAR_FACING, rotationSteps,
  airFireModifier, vgunFireModifier, computeFlankStates,
  // satw
  resolveSATWCheck, resolveSATWAttack,
  // melee
  resolveMelee, applyMeleeCasualties, meleeLogMessage,
  type MeleeParticipant,
  // rout
  getRoutCondition, resolveRoutCheck, findRoutCandidates, routLogMessage, isOnRoutEdge,
  // recovery
  applyRecovery,
} from '../engine/mechanics'
import type { FireMode } from '../engine/mechanics'
import { checkOpFireEligibility, resolveOpFire, opFireLogMessage } from '../engine/mechanics/opfire'

/** Coste en ops de activar una unidad (regla: vehículos y cañones = 3, resto = 1). */
function getOpsCost(unitTypeId: string): number {
  const ut = getUnitType(unitTypeId)
  return (ut?.category === 'vehicle' || ut?.category === 'gun') ? 3 : 1
}

// ─── Constantes de guardado ───────────────────────────────────────────────────

const SAVE_KEY     = 'wargame-ai-save'
const SAVE_VERSION = 1

// ─── Helper de flank tracking ─────────────────────────────────────────────────

function applyFlankStates(
  units: Record<string, UnitInstance>,
  hexes: HexData[]
): Record<string, UnitInstance> {
  const flanks = computeFlankStates(units, hexes)
  const updated = { ...units }
  for (const [id, hasFlank] of Object.entries(flanks)) {
    if (updated[id] && updated[id].hasFlank !== hasFlank) {
      updated[id] = { ...updated[id], hasFlank }
    }
  }
  return updated
}

// ─── Helper de control de hexes ──────────────────────────────────────────────

/** Calcula qué bando controla cada hex ocupado (sin unidades enemigas en el mismo hex). */
function computeHexControl(units: Record<string, UnitInstance>): Record<string, Faction> {
  const occupants: Record<string, Set<Faction>> = {}
  for (const u of Object.values(units)) {
    if (!u.position || u.faction === 'Neutral') continue
    ;(occupants[u.position] ??= new Set()).add(u.faction)
  }
  const control: Record<string, Faction> = {}
  for (const [hexId, factions] of Object.entries(occupants)) {
    if (factions.size === 1) control[hexId] = [...factions][0]
    // Si ambos bandos en el mismo hex → hex contestado, no se registra
  }
  return control
}

// ─── Helpers de concealment ───────────────────────────────────────────────────

/** Terrenos que dan modificador beneficioso al defensor (reducen FP entrante). */
function hasBeneficialTerrain(hex: HexData): boolean {
  return hex.terrain !== 'TERRENO ABIERTO' && hex.terrain !== 'CARRETERA'
}

/** True si ninguna unidad enemiga tiene LOS a la unidad indicada. */
function isOutsideAllEnemyLOS(
  unitId: string,
  units: Record<string, UnitInstance>,
  hexes: HexData[],
  smokeHexes: Record<string, 'fresh' | 'dispersed'>,
): boolean {
  const unit = units[unitId]
  if (!unit?.position) return true
  const unitHex = hexes.find(h => h.id === unit.position)
  if (!unitHex) return true
  const hexMap = buildHexMap(hexes)
  return Object.values(units)
    .filter(u => u.faction !== unit.faction && u.position)
    .every(enemy => {
      const enemyHex = hexes.find(h => h.id === enemy.position)
      if (!enemyHex) return true
      return computeLOS(enemyHex, unitHex, hexMap, smokeHexes).blocked
    })
}

/** True si hay infantería enemiga (no vehículo) en un hex adyacente (distancia 1). */
function hasAdjacentEnemyInfantry(
  unitId: string,
  units: Record<string, UnitInstance>,
  hexes: HexData[],
): boolean {
  const unit = units[unitId]
  if (!unit?.position) return false
  const unitHex = hexes.find(h => h.id === unit.position)
  if (!unitHex) return false
  return Object.values(units).some(u => {
    if (u.faction === unit.faction || !u.position) return false
    const cat = getUnitType(u.unitTypeId)?.category
    if (cat === 'vehicle' || cat === 'aircraft' || cat === 'decoy') return false
    const enemyHex = hexes.find(h => h.id === u.position)
    if (!enemyHex) return false
    return hexDistance(unitHex.col, unitHex.row, enemyHex.col, enemyHex.row) === 1
  })
}

/** Aplica pérdida de concealment si procede tras mover/recibir fuego. */
function evaluateConcealmentLoss(
  unitId: string,
  units: Record<string, UnitInstance>,
  hexes: HexData[],
  smokeHexes: Record<string, 'fresh' | 'dispersed'>,
): boolean {
  const unit = units[unitId]
  if (!unit || !unit.isConcealed || !unit.position) return false
  const hex = hexes.find(h => h.id === unit.position)
  if (!hex) return false
  const inOpenGround = !hasBeneficialTerrain(hex)
  const visibleToEnemy = !isOutsideAllEnemyLOS(unitId, units, hexes, smokeHexes)
  const adjEnemy = hasAdjacentEnemyInfantry(unitId, units, hexes)
  return (inOpenGround && visibleToEnemy) || adjEnemy
}

// ─── Helper Op Fire ───────────────────────────────────────────────────────────

/** Devuelve los instanceIds de unidades del bando NO activo que pueden Op Fire o Final Op Fire. */
function getEligibleOpFirers(
  movingUnitId: string,
  enteredHexId: string,
  units: Record<string, UnitInstance>,
  hexes: HexData[],
  smokeHexes: Record<string, 'fresh' | 'dispersed'>,
  activeFaction: Faction,
): string[] {
  const movingUnit = units[movingUnitId]
  if (!movingUnit) return []
  const targetHex = hexes.find(h => h.id === enteredHexId)
  if (!targetHex) return []
  const hexMap = buildHexMap(hexes)

  return Object.values(units)
    .filter(u => {
      if (u.faction === activeFaction) return false   // mismo bando → no
      if (!u.position) return false
      const cat = getUnitType(u.unitTypeId)?.category
      if (cat === 'aircraft' || cat === 'decoy') return false
      const firerHex = hexes.find(h => h.id === u.position)
      if (!firerHex) return false
      // LOS al hex donde entró la unidad
      const los = computeLOS(firerHex, targetHex, hexMap, smokeHexes)
      if (los.blocked) return false
      // Stats de la unidad que dispara
      const stats = getActiveInfantryStats(u.unitTypeId, u.isReduced)
      if (!stats) return false
      const elig = checkOpFireEligibility(u, firerHex, targetHex, stats)
      return elig.canFire
    })
    .map(u => u.instanceId)
}

export interface CloseAssaultResult {
  roll:        number
  effectiveFP: number
  destroyed:   boolean
}

export interface MoveActionResult {
  ok:            boolean
  cost?:         number
  remainingMPs?: number
  reason?:       string
  opFirePending?: boolean            // true si hay unidades elegibles para Op Fire
  closeAssault?: CloseAssaultResult  // presente si se resolvió Close Assault vs vehículo
  mcFailed?:     boolean             // MC falló al intentar mover
  canRerollMC?:  boolean             // hay CP disponible para repetir el MC
}

export interface FireActionResult {
  ok:      boolean
  result?: FireResult
  reason?: string
  mode?:   import('../engine/mechanics').FireMode
}

export interface OpFireActionResult {
  ok:        boolean
  reason?:   string
  result?:   FireResult
  isFinal?:  boolean
}

interface GameStore extends GameState {
  // ── Carga ──────────────────────────────────────────────────────────────────
  loadScenario: (scenario: Scenario, playerFaction: Faction) => void
  resetGame: () => void

  // ── Selección ─────────────────────────────────────────────────────────────
  selectUnit: (instanceId: string | null) => void
  selectHex:  (hexId: string | null) => void

  // ── Fases ─────────────────────────────────────────────────────────────────
  setPhase:      (phase: GamePhase) => void
  setActiveSide: (side: ActiveSide) => void
  nextPhase:     () => void

  // ── Unidades ──────────────────────────────────────────────────────────────
  updateUnit:  (instanceId: string, patch: Partial<UnitInstance>) => void
  moveUnit:    (instanceId: string, hexId: string | null) => void
  removeUnit:  (instanceId: string) => void

  // ── Acciones de juego con engine ──────────────────────────────────────────
  tryMoveUnit:   (instanceId: string, targetHexId: string, skipInitialMC?: boolean) => MoveActionResult
  tryFireUnit:   (attackerId: string, targetId: string, spendCP?: boolean) => FireActionResult
  tryFireSmoke:  (attackerId: string, targetHexId: string) => { ok: boolean; reason?: string }
  tryRoutUnit:   (instanceId: string) => { ok: boolean; reason?: string; mustRout?: boolean; newHexId?: string; eliminated?: boolean }
  tryResolveMelee: (hexId: string, spendCPAllied?: boolean, spendCPAxis?: boolean) => { ok: boolean; reason?: string; result?: import('../engine/mechanics').MeleeGroupResult }
  endUnitActivation: (instanceId: string) => void  // Marca usada + cobra ops (sin mover/disparar)
  endSideOperations: () => void   // Pasa el control al bando contrario (o termina la fase)
  undoLastMove: () => void        // Deshace el último movimiento de la activación actual
  undoLastFire: () => void        // Deshace el último disparo

  // ── Op Fire ────────────────────────────────────────────────────────────────
  tryOpFireUnit: (firerId: string, targetId: string, spendCP?: boolean) => OpFireActionResult
  passOpFire: () => void

  // ── Setup interactivo ──────────────────────────────────────────────────────
  placeUnitInSetup:    (instanceId: string, hexId: string) => { ok: boolean; reason?: string }
  removeUnitFromSetup: (instanceId: string) => void
  completeSetup:       () => void

  // ── Command Points ─────────────────────────────────────────────────────────
  useCommandPoint:         (side: ActiveSide) => void
  spendCPForMovement:      (instanceId: string) => { ok: boolean; reason?: string }
  confirmMCRerollAndMove:  (instanceId: string, targetHexId: string) => MoveActionResult
  declineMCReroll:         (instanceId: string) => void
  useSecondPlayerActionCP: () => void
  passSecondPlayerAction:  () => void

  // ── Guardado / Carga ──────────────────────────────────────────────────────
  saveGame:  () => void
  loadGame:  () => boolean
  hasSave:   () => boolean
  clearSave: () => void

  // ── Operaciones (interno) ────────────────────────────────────────────────
  incrementOpsUsed: () => void
  resetOpsUsed: () => void

  // ── Log ───────────────────────────────────────────────────────────────────
  addLog: (entry: Omit<LogEntry, 'turn' | 'phase'>) => void

  // ── AI ────────────────────────────────────────────────────────────────────
  setAIThinking: (v: boolean) => void
}

const PHASE_ORDER: GamePhase[] = ['operations', 'rout', 'melee', 'recovery']

const initialState: GameState = {
  scenario:       null,
  currentTurn:    1,
  maxTurns:       1,
  phase:          'setup',
  activeSide:     'allied',
  playerFaction:  null,
  commandPoints:  { allied: 0, axis: 0 },
  opsUsed:        0,
  units:          {},
  unitMPs:        {},
  hexControl:     {},
  selectedUnit:   null,
  selectedHex:    null,
  log:            [],
  isAIThinking:   false,
  activatingUnit: null,
  lastMoveUndo:   null,
  lastFireUndo:   null,
  smokeHexes:     {},
  pendingOpFire:        null,
  movingUnitMCFailed:   false,
  setupSplitCol:        0,
  axisSetupSplitCol:    0,
  secondPlayerActionPending: false,
  secondPlayerActionActive:  false,
  firstMoverSide:            null,
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  loadScenario: (scenario, playerFaction) => {
    // Determinar qué bando es aliado vs eje según la facción del jugador
    const alliedFaction = scenario.allied.faction
    const axisFaction   = scenario.axis.faction

    // Crear instancias de unidades
    const units: Record<string, UnitInstance> = {}

    const makeInstances = (entries: typeof scenario.alliedUnits, faction: Faction, side: ActiveSide) => {
      entries.forEach((entry) => {
        for (let i = 0; i < entry.inScenario; i++) {
          const id = `${side}_${entry.type.replace(/\s+/g, '_')}_${i}`
          units[id] = {
            instanceId:     id,
            unitTypeId:     entry.type,
            isReduced:      entry.isReduced,
            suppression:    0,
            isUsed:         false,
            isOpFire:       false,
            isConcealed:    getUnitType(entry.type)?.category === 'decoy',
            hasFlank:       false,
            position:       null,
            faction,
            facing:         null,
            hasMoveCounter: false,
          }
        }
      })
    }

    makeInstances(scenario.alliedUnits, alliedFaction, 'allied')
    makeInstances(scenario.axisUnits,   axisFaction,   'axis')

    // Calcular límite de zonas de setup
    // Para flat-top: split por col (aliados: col ≤ splitCol; eje: col > splitCol)
    // Para pointy-top: los tableros se unen por la dimensión row → split por row
    //   (eje: row ≤ splitCol; aliados: row > splitCol) — splitCol reutilizado como valor row
    //
    // Si el texto de despliegue indica "enter the West/East edge", la zona se limita
    // a la columna de borde correspondiente (1 columna) en lugar del punto medio.
    const alliedSetup = scenario.allied.setupDesc.toLowerCase()
    const axisSetup   = scenario.axis.setupDesc.toLowerCase()
    const alliedEdge: string | null = /west edge/.test(alliedSetup) ? 'W'
                      : /east edge/.test(alliedSetup) ? 'E'
                      : /north edge/.test(alliedSetup) ? 'N'
                      : /south edge/.test(alliedSetup) ? 'S' : null
    const axisEdge: string | null   = /east edge/.test(axisSetup)   ? 'E'
                      : /west edge/.test(axisSetup)   ? 'W'
                      : /north edge/.test(axisSetup)  ? 'N'
                      : /south edge/.test(axisSetup)  ? 'S' : null

    let setupSplitCol: number
    let axisSetupSplitCol: number
    if (scenario.orientation === 'pointy-top') {
      const rows = scenario.hexes.map(h => h.row)
      const minRow = Math.min(...rows), maxRow = Math.max(...rows)
      // Allied zona: row > splitCol; Axis zona: row ≤ splitCol
      if      (alliedEdge === 'S') setupSplitCol = maxRow - 1
      else if (alliedEdge === 'N') setupSplitCol = minRow
      else if (axisEdge   === 'N') setupSplitCol = minRow
      else if (axisEdge   === 'S') setupSplitCol = maxRow - 1
      else setupSplitCol = Math.round((minRow + maxRow) / 2)
      axisSetupSplitCol = setupSplitCol
    } else {
      const cols = scenario.hexes.map(h => h.col)
      const minCol = Math.min(...cols), maxCol = Math.max(...cols)

      // Allied zona: col ≤ setupSplitCol; Axis zona: col > axisSetupSplitCol
      if (alliedEdge === 'W') {
        setupSplitCol = minCol          // Allied solo en borde W (col mínima)
      } else if (alliedEdge === 'E') {
        setupSplitCol = maxCol - 1
      } else if (axisEdge === 'E') {
        setupSplitCol = maxCol - 1
      } else if (axisEdge === 'W') {
        setupSplitCol = minCol
      } else {
        setupSplitCol = Math.round((minCol + maxCol) / 2)
      }
      axisSetupSplitCol = setupSplitCol  // por defecto igual al aliado

      // Si hay hexes de canal/río, el canal actúa como frontera del EJE únicamente
      // (el borde aliado queda intacto en setupSplitCol)
      const canalCols = scenario.hexes
        .filter(h => h.terrain === 'RIO / CANAL')
        .map(h => h.col)
      if (canalCols.length > 0) {
        if (alliedEdge === 'W' || axisEdge === 'E') {
          // Eje al este del canal
          axisSetupSplitCol = Math.max(...canalCols)
        } else if (alliedEdge === 'E' || axisEdge === 'W') {
          // Eje al oeste del canal
          axisSetupSplitCol = Math.min(...canalCols)
        }
      }
    }

    // El bando que hace setup primero según scenario.setupFirst
    const setupFirstSide: ActiveSide = alliedFaction === scenario.setupFirst ? 'allied' : 'axis'

    set({
      ...initialState,
      scenario,
      maxTurns:      scenario.turns,
      phase:         'setup',
      activeSide:    setupFirstSide,
      playerFaction,
      commandPoints: {
        allied: scenario.allied.commandPoints,
        axis:   scenario.axis.commandPoints,
      },
      units,
      smokeHexes: {},
      setupSplitCol,
      axisSetupSplitCol,
    })
  },

  resetGame: () => set(initialState),

  selectUnit: (instanceId) => set({ selectedUnit: instanceId, selectedHex: null }),
  selectHex:  (hexId)       => set({ selectedHex: hexId, selectedUnit: null }),

  setPhase: (phase) => set({ phase }),

  setActiveSide: (side) => set({ activeSide: side }),

  nextPhase: () => {
    const { phase } = get()

    if (phase === 'setup') {
      set({ phase: 'operations' })
      return
    }

    const idx = PHASE_ORDER.indexOf(phase)
    if (idx === -1) return

    if (phase === 'recovery') {
      const { scenario, units, currentTurn: turn } = get()
      if (!scenario) return

      // Aplicar Recovery (supresión, counters tácticos, CPs) usando el engine
      const recovResult = applyRecovery(units, scenario, turn)

      // Avanzar estado del humo: fresh → dispersed, dispersed → eliminar
      const newSmoke: Record<string, 'fresh' | 'dispersed'> = {}
      for (const [id, state] of Object.entries(get().smokeHexes)) {
        if (state === 'fresh') newSmoke[id] = 'dispersed'
        // 'dispersed' desaparece
      }

      if (recovResult.gameOver) {
        const finalHexControl = computeHexControl(recovResult.updatedUnits)
        set({ phase: 'end', units: recovResult.updatedUnits, smokeHexes: newSmoke, hexControl: finalHexControl })
      } else {
        const firstSide: ActiveSide = scenario.allied.faction === scenario.movesFirst ? 'allied' : 'axis'
        const secondSide: ActiveSide = firstSide === 'allied' ? 'axis' : 'allied'
        const secondHasCPs = recovResult.restoredCPs[secondSide] > 0
        set({
          currentTurn:   recovResult.nextTurn,
          phase:         'operations',
          activeSide:    secondHasCPs ? secondSide : firstSide,
          firstMoverSide: firstSide,
          secondPlayerActionPending: secondHasCPs,
          secondPlayerActionActive: false,
          opsUsed:       0,
          unitMPs:       {},
          activatingUnit: null,
          lastMoveUndo:  null,
          lastFireUndo:  null,
          units:         recovResult.updatedUnits,
          commandPoints: recovResult.restoredCPs,
          smokeHexes:    newSmoke,
        })
      }
    } else {
      set({ phase: PHASE_ORDER[idx + 1], unitMPs: {}, activatingUnit: null, lastMoveUndo: null, lastFireUndo: null })
    }
  },

  updateUnit: (instanceId, patch) =>
    set(state => ({
      units: {
        ...state.units,
        [instanceId]: { ...state.units[instanceId], ...patch }
      }
    })),

  moveUnit: (instanceId, hexId) =>
    set(state => ({
      units: {
        ...state.units,
        [instanceId]: { ...state.units[instanceId], position: hexId }
      }
    })),

  removeUnit: (instanceId) =>
    set(state => {
      const units = { ...state.units }
      delete units[instanceId]
      if (!state.scenario) return { units }
      return { units: applyFlankStates(units, state.scenario.hexes) }
    }),

  tryMoveUnit: (instanceId, targetHexId, skipInitialMC = false) => {
    const { units, scenario, unitMPs, phase, activeSide, activatingUnit, pendingOpFire, movingUnitMCFailed } = get()
    const unit = units[instanceId]
    if (!unit || !scenario) return { ok: false, reason: 'Sin datos' }
    if (phase !== 'operations') return { ok: false, reason: 'Solo en Operations' }
    if (unit.isUsed) return { ok: false, reason: 'Unidad ya usada' }
    if (unit.isOpFire) return { ok: false, reason: 'Unidad en Op Fire' }

    // Si hay pendingOpFire, la unidad en movimiento no puede continuar hasta que se resuelva
    if (pendingOpFire && pendingOpFire.movingUnitId === instanceId) {
      return { ok: false, reason: 'Esperando resolución de Op Fire. Pasa o dispara primero.' }
    }

    // Si la unidad falló el MC tras recibir Op Fire, su movimiento termina
    if (movingUnitMCFailed) {
      set({ movingUnitMCFailed: false })
      return { ok: false, reason: 'Movimiento detenido: la unidad falló el MC tras recibir Op Fire' }
    }

    // Activation lock: block if a different unit is already activating
    if (activatingUnit && activatingUnit !== instanceId) {
      return { ok: false, reason: 'Otra unidad está en activación. Finaliza o deshaz primero.' }
    }

    const activeFaction = activeSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
    if (unit.faction !== activeFaction) return { ok: false, reason: 'No es el turno de este bando' }

    const fromHex = scenario.hexes.find(h => h.id === unit.position)
    const toHex   = scenario.hexes.find(h => h.id === targetHexId)
    if (!fromHex || !toHex) return { ok: false, reason: 'Hex no encontrado' }
    if (fromHex.id === toHex.id) return { ok: false, reason: 'Ya está en ese hex' }

    // MC antes de mover — solo en la primera activación del turno (Regla 5.0)
    const isFirstMove = !(instanceId in unitMPs)
    const stats = getActiveInfantryStats(unit.unitTypeId, unit.isReduced)
    if (!skipInitialMC && isFirstMove && stats) {
      const morale   = getCurrentMorale(unit.suppression, stats)
      const mcResult = rollMoraleCheck(morale)
      get().addLog({ side: activeSide, message: mcLogMessage(unit, mcResult), type: 'combat' })
      if (!mcResult.passed) {
        const opsCost = getOpsCost(unit.unitTypeId)
        const cpAvailable = get().commandPoints[activeSide] > 0
        if (cpAvailable) {
          // Dejar la unidad sin marcar — el jugador puede gastar 1 CP para repetir
          return { ok: false, reason: `Falla MC (tirada ${mcResult.roll} vs Moral ${mcResult.morale})`, mcFailed: true, canRerollMC: true }
        }
        set(state => ({
          units:   { ...state.units, [instanceId]: { ...state.units[instanceId], isUsed: true } },
          opsUsed: state.opsUsed + opsCost,
          activatingUnit: null,
        }))
        const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
        if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
        return { ok: false, reason: `Falla MC (tirada ${mcResult.roll} vs Moral ${mcResult.morale})` }
      }
    }

    // ── Facing y coste de rotación para vehículos/cañones (Regla 12.0) ─────────
    const unitCategory = getUnitType(unit.unitTypeId)?.category ?? 'squad'
    const isVehicleOrGun = unitCategory === 'vehicle' || unitCategory === 'gun'
    let rotationMPCost = 0
    if (isVehicleOrGun && unit.facing) {
      const dir = directionBetweenHexes(fromHex, toHex)
      if (dir) {
        if (dir === REAR_FACING[unit.facing]) {
          return { ok: false, reason: 'Los vehículos no pueden moverse hacia atrás' }
        }
        if (isFirstMove) {
          rotationMPCost = rotationSteps(unit.facing, dir)
        }
      }
    }

    const remaining = unitMPs[instanceId] ?? movementAllowance(unit.unitTypeId)
    const validation = validateMove(unit, stats ?? ({} as never), fromHex, toHex, remaining - rotationMPCost, scenario.orientation)
    if (!validation.canMove) return { ok: false, reason: validation.reason }

    if (!canStackInHex(targetHexId, unit.faction, units, unit.unitTypeId)) {
      return { ok: false, reason: 'Hex lleno (máx. 2 unidades de tu bando; máx. 1 vehículo/cañón)' }
    }

    // ── Close Assault vs vehículo (Regla 20.9) ───────────────────────────────
    // Si el hex destino tiene un vehículo enemigo, la infantería resuelve Close Assault
    // inmediatamente y vuelve al hex anterior.
    const isInfantry   = unitCategory === 'squad' || unitCategory === 'wt_mg' || unitCategory === 'wt_mortar'
    const vehicleInTarget = isInfantry
      ? Object.values(units).find(u =>
          u.position === targetHexId && u.faction !== unit.faction &&
          getUnitType(u.unitTypeId)?.category === 'vehicle'
        )
      : undefined

    if (vehicleInTarget) {
      const vStats      = getVehicleStats(vehicleInTarget.unitTypeId)
      const baseMeleeFP = stats?.meleeFP ?? stats?.normalFP ?? 0
      // -1 FP si el vehículo tiene armor ≥ 1 (no open topped — simplificación SE)
      const effectiveFP = (vStats && vStats.armorFront >= 1) ? baseMeleeFP - 1 : baseMeleeFP
      const roll        = rollD10()
      const destroyed   = roll <= effectiveFP && roll !== 10

      const opsCost = isFirstMove ? getOpsCost(unit.unitTypeId) : 0
      const prevOps = get().opsUsed

      if (destroyed) get().removeUnit(vehicleInTarget.instanceId)

      // La unidad atacante vuelve al hex anterior y queda marcada como Used
      set(state => ({
        units: { ...state.units,
          [instanceId]: { ...state.units[instanceId], isUsed: true },
        },
        opsUsed:        prevOps + opsCost,
        activatingUnit: null,
        lastMoveUndo:   null,
      }))

      const outcome = destroyed ? 'DESTRUIDO' : 'FALLIDO'
      get().addLog({ side: activeSide,
        message: `Close Assault de ${unit.unitTypeId} vs ${vehicleInTarget.unitTypeId}: tirada ${roll} vs FP ${effectiveFP} → ${outcome}`,
        type: 'combat' })

      const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
      if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()

      return { ok: true, cost: validation.cost, remainingMPs: 0,
        closeAssault: { roll, effectiveFP, destroyed } }
    }

    // Si el hex destino tiene unidades enemigas (no vehículo), la unidad para (Regla 5.0)
    const enemyInTarget = Object.values(units).some(
      u => u.position === targetHexId && u.faction !== unit.faction
    )
    const newMPs = enemyInTarget ? 0 : remaining - rotationMPCost - validation.cost

    // Coste de ops: solo se cobra en el primer hex de la activación
    const opsCost  = isFirstMove ? getOpsCost(unit.unitTypeId) : 0
    const prevOps  = get().opsUsed
    const newOps   = prevOps + opsCost

    // ── Auto-facing para vehículos/cañones ───────────────────────────────────
    const newFacing = isVehicleOrGun ? (directionBetweenHexes(fromHex, toHex) ?? unit.facing) : unit.facing

    // Guardar estado de undo (solo el último movimiento)
    const undo: MoveUndo = {
      instanceId,
      fromHex:  fromHex.id,
      prevMPs:  isFirstMove ? null : unitMPs[instanceId],
      prevOps,
    }

    set(state => ({
      units: { ...state.units, [instanceId]: {
        ...state.units[instanceId],
        position:       targetHexId,
        facing:         newFacing,
        hasMoveCounter: isVehicleOrGun ? true : state.units[instanceId].hasMoveCounter,
      }},
      unitMPs:        { ...state.unitMPs, [instanceId]: newMPs },
      opsUsed:        newOps,
      activatingUnit: instanceId,
      lastMoveUndo:   undo,
    }))

    // ── Log coste de rotación ─────────────────────────────────────────────────
    if (rotationMPCost > 0) {
      get().addLog({ side: activeSide,
        message: `${unit.unitTypeId} rota ${rotationMPCost}×60° (-${rotationMPCost} MP)`,
        type: 'info' })
    }

    // ── Concealment: pierde concealment si aplica tras mover ──────────────────
    {
      const freshState = get()
      if (unit.isConcealed && evaluateConcealmentLoss(instanceId, freshState.units, scenario.hexes, freshState.smokeHexes)) {
        get().updateUnit(instanceId, { isConcealed: false })
        get().addLog({ side: activeSide, message: `${unit.unitTypeId} pierde ocultamiento al moverse`, type: 'info' })
      }
    }

    // ── Flank tracking: recalcular tras mover ────────────────────────────────
    set(state => state.scenario ? { units: applyFlankStates(state.units, state.scenario.hexes) } : {})

    // ── Op Fire check: notificar si hay unidades del bando contrario elegibles ─
    {
      const activeFaction = activeSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
      const freshState = get()
      const eligible = getEligibleOpFirers(instanceId, targetHexId, freshState.units, scenario.hexes, freshState.smokeHexes, activeFaction)
      if (eligible.length > 0) {
        set({ pendingOpFire: { movingUnitId: instanceId, enteredHexId: targetHexId, eligibleFirers: eligible } })
        return { ok: true, cost: validation.cost, remainingMPs: newMPs, opFirePending: true }
      }
    }

    return { ok: true, cost: validation.cost, remainingMPs: newMPs }
  },

  tryFireUnit: (attackerId, targetId, spendCPArg = false) => {
    const { units, scenario, phase, activeSide, activatingUnit, unitMPs, commandPoints, addLog, removeUnit, updateUnit } = get()
    const attacker = units[attackerId]
    const target   = units[targetId]
    if (!attacker || !target || !scenario) return { ok: false, reason: 'Sin datos' }
    if (phase !== 'operations') return { ok: false, reason: 'Solo en Operations' }
    if (attacker.isUsed) return { ok: false, reason: 'Unidad ya usada' }
    if (attacker.faction === target.faction) return { ok: false, reason: 'No puedes disparar a aliados' }

    // Activation lock: block if a different unit is already activating
    if (activatingUnit && activatingUnit !== attackerId) {
      return { ok: false, reason: 'Otra unidad está en activación. Finaliza o deshaz primero.' }
    }

    const activeFaction = activeSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
    if (attacker.faction !== activeFaction) return { ok: false, reason: 'No es el turno de este bando' }

    // Snapshots para undo (necesarios en todas las rutas)
    const prevTargetSnapshot: UnitInstance = { ...target }
    const prevAttackerSnapshot = { isUsed: attacker.isUsed, isOpFire: attacker.isOpFire }
    const prevOpsSnapshot = get().opsUsed
    const prevMoveUndoSnapshot = get().lastMoveUndo

    // ── Ruta A0: Aeronave (off-board, sin posición ni LOS) ───────────────────
    const attackerTypeEarly = getUnitType(attacker.unitTypeId)
    if (attackerTypeEarly?.category === 'aircraft') {
      const targetHexAir = scenario.hexes.find(h => h.id === target.position)
      if (!targetHexAir) return { ok: false, reason: 'Objetivo sin posición' }

      const spendCPAir = spendCPArg && commandPoints[activeSide] > 0
      if (spendCPAir) get().useCommandPoint(activeSide)

      const vStatsAir = getVehicleStats(attacker.unitTypeId)
      if (!vStatsAir) return { ok: false, reason: 'Sin estadísticas de aeronave' }

      // Prof Check siempre requerido para aeronaves
      const profAir = resolveProfCheck({
        proficiency:         vStatsAir.proficiency,
        rangeHexes:          0,
        opFireMode:          false,
        finalOpFireMode:     false,
        firerIsOpFireMarked: attacker.isOpFire,
        firerTurnedInHex:    false,
        firerMovedToNewHex:  false,
        targetHasMoveCounter: target.hasMoveCounter,
        targetHigher:        false,
        hindrances:          0,
      })

      if (!profAir.skipped) {
        const profMsgAir = `Prof Check (Aeronave): tirada ${profAir.roll} vs ${profAir.needed} → ${profAir.passed ? 'PASA' : 'FALLA'}`
        addLog({ side: activeSide, message: profMsgAir, type: 'morale' })
        if (!profAir.passed) {
          const opsCostAir = getOpsCost(attacker.unitTypeId)
          updateUnit(attackerId, { isUsed: true, isOpFire: false })
          set({ opsUsed: prevOpsSnapshot + opsCostAir, activatingUnit: null, lastMoveUndo: null })
          const sideConfigAir = activeSide === 'allied' ? scenario.allied : scenario.axis
          if (get().opsUsed >= sideConfigAir.opsRangeMax) get().endSideOperations()
          return { ok: false, reason: `Falla Prof Check aeronave (tirada ${profAir.roll} vs ${profAir.needed})` }
        }
      }

      const targetTypeAir = getUnitType(target.unitTypeId)
      let targetWasEliminatedAir = false
      let logMsgAir: string

      if (targetTypeAir?.category === 'vehicle') {
        // Aeronave vs Vehículo — usa fpVsVehicle; armor frontal (sin ángulo de ataque)
        const targetVStats = getVehicleStats(target.unitTypeId)
        const targetArmor  = targetVStats?.armorFront ?? 0
        const vvAirResult = resolveVGunVsVehicle({
          attackerFP:   vStatsAir.fpVsVehicle,
          targetArmor,
          rangeHexes:   0,
          isRearAttack: false,
          targetHigher: false,
          targetLower:  false,
          overRange20:  false,
          overRange30:  false,
        })
        targetWasEliminatedAir = vvAirResult.destroyed
        if (vvAirResult.destroyed) removeUnit(targetId)
        logMsgAir = `Aeronave vs Vehículo — tirada ${vvAirResult.roll} vs ataque ${vvAirResult.attackNumber} → ${vvAirResult.destroyed ? 'DESTRUIDO' : 'Sin efecto'}`
      } else {
        // Aeronave vs Infantería/Cañón
        const targetStatsAir = getActiveInfantryStats(target.unitTypeId, target.isReduced)
        if (!targetStatsAir) return { ok: false, reason: 'Objetivo sin estadísticas de infantería' }
        // Ajustar FP: resolveVGunVsInfantry aplica vgunFireModifier internamente,
        // necesitamos que el resultado neto sea airFireModifier. Compensamos el delta.
        const hasSeto = Object.values(targetHexAir.sides).some(Boolean)
        const airMod  = airFireModifier(targetHexAir.terrain, targetHexAir.fortification)
        const vgunMod = vgunFireModifier(targetHexAir.terrain, targetHexAir.fortification, hasSeto)
        const viAirResult = resolveVGunVsInfantry({
          attackerFP:        vStatsAir.fpVsInfantry + (airMod - vgunMod),
          rangeHexes:        0,
          targetHex:         targetHexAir,
          targetIsReduced:   target.isReduced,
          targetStats:       targetStatsAir,
          targetIsMoving:    false,
          targetIsConcealed: false,   // aircraft: concealment es ELIMINADO, no da -1 FP
          attackerHigher:    false,
          attackerLower:     false,
          targetHasFlank:    false,
          hindrances:        0,
        })
        // Aircraft always removes concealment (PAC: REMOVE)
        if (target.isConcealed) updateUnit(targetId, { isConcealed: false })
        // ── Señuelo en ataque aéreo (el avión se consume igual) ─────────────
        if (getUnitType(target.unitTypeId)?.category === 'decoy') {
          const wouldSuppressAir = viAirResult.suppressed || viAirResult.reduced || viAirResult.eliminated
          if (wouldSuppressAir) {
            removeUnit(targetId)
            addLog({ side: activeSide, message: `⚠ ¡SEÑUELO REVELADO! ${target.unitTypeId} era un señuelo — eliminado`, type: 'info' })
          }
          updateUnit(attackerId, { isUsed: true, isOpFire: false })
          set({ activatingUnit: null, lastMoveUndo: null })
          set({ opsUsed: prevOpsSnapshot + getOpsCost(attacker.unitTypeId) })
          const sideConfigDecAir = activeSide === 'allied' ? scenario.allied : scenario.axis
          if (get().opsUsed >= sideConfigDecAir.opsRangeMax) get().endSideOperations()
          return { ok: true, mode: 'normal' }
        }
        targetWasEliminatedAir = viAirResult.eliminated || (viAirResult.reduced && target.isReduced)
        if (viAirResult.eliminated || (viAirResult.reduced && target.isReduced)) {
          removeUnit(targetId)
        } else if (viAirResult.reduced) {
          updateUnit(targetId, { isReduced: true, suppression: 2 })
        } else if (viAirResult.suppressed) {
          updateUnit(targetId, { suppression: Math.min(2, target.suppression + 1) as SuppressionLevel })
        }
        logMsgAir = fireLogMessage(attacker, target.position ?? '?', viAirResult)
      }

      updateUnit(attackerId, { isUsed: true, isOpFire: false })
      set({ activatingUnit: null, lastMoveUndo: null })
      const opsCostAir2 = getOpsCost(attacker.unitTypeId)
      const newOpsAir  = prevOpsSnapshot + opsCostAir2
      set({ opsUsed: newOpsAir })
      const fireUndoAir: FireUndo = {
        attackerId,
        prevAttacker:        prevAttackerSnapshot,
        targetId,
        prevTarget:          prevTargetSnapshot,
        targetWasEliminated: targetWasEliminatedAir,
        prevOps:             prevOpsSnapshot,
        prevMoveUndo:        prevMoveUndoSnapshot,
      }
      set({ lastFireUndo: fireUndoAir })
      addLog({ side: activeSide, message: logMsgAir, type: 'combat' })
      const sideConfigAir2 = activeSide === 'allied' ? scenario.allied : scenario.axis
      if (newOpsAir >= sideConfigAir2.opsRangeMax) get().endSideOperations()
      return { ok: true, mode: 'normal' }
    }

    const attackerHex = scenario.hexes.find(h => h.id === attacker.position)
    const targetHex   = scenario.hexes.find(h => h.id === target.position)
    if (!attackerHex || !targetHex) return { ok: false, reason: 'Posición no encontrada' }

    const hexMap = buildHexMap(scenario.hexes)
    const losResult = computeLOS(attackerHex, targetHex, hexMap, get().smokeHexes)
    if (losResult.blocked) return { ok: false, reason: 'Sin LOS al objetivo' }
    const hindrances = losResult.hindrance

    // CP spending: solo si tiene CPs disponibles y lo solicita
    const spendCP = spendCPArg && commandPoints[activeSide] > 0
    if (spendCP) get().useCommandPoint(activeSide)

    const attackerType = getUnitType(attacker.unitTypeId)
    const targetType   = getUnitType(target.unitTypeId)
    if (!attackerType || !targetType) return { ok: false, reason: 'Tipo de unidad desconocido' }

    const range = hexDistance(attackerHex.col, attackerHex.row, targetHex.col, targetHex.row)

    // ── Ruta A: Vehículo o cañón dispara ─────────────────────────────────────
    if (attackerType.category === 'vehicle' || attackerType.category === 'gun') {
      // Validar facing (arco de fuego)
      if (!attacker.facing) return { ok: false, reason: 'Vehículo/cañón sin facing asignado' }
      if (!isInFrontArc(attacker.facing, attackerHex, targetHex)) {
        return { ok: false, reason: 'Objetivo fuera del arco de fuego frontal' }
      }

      // Vehículos/cañones no necesitan MC previo; pasan directo a Prof Check si aplica
      const vStats = getVehicleStats(attacker.unitTypeId)
      const gStats = getGunStats(attacker.unitTypeId)
      const proficiency = vStats?.proficiency ?? gStats?.proficiency ?? 6

      const hasMoved = attackerId in unitMPs
      // firerTurnedInHex: se modela como si el facing cambió durante la activación.
      // Simplificación: si el vehículo tiene hasMoveCounter lo trató como movió, no giró.
      // Para giros in-situ (no implementados aún) se pasaría true.
      const profResult = resolveProfCheck({
        proficiency,
        rangeHexes:            range,
        opFireMode:            false,
        finalOpFireMode:       false,
        firerIsOpFireMarked:   attacker.isOpFire,
        firerTurnedInHex:      false,
        firerMovedToNewHex:    hasMoved,
        targetHasMoveCounter:  target.hasMoveCounter,
        targetHigher:          targetHex.elevation > attackerHex.elevation,
        hindrances:            0,
      })

      if (!profResult.skipped) {
        const profMsg = `Prof Check: tirada ${profResult.roll} vs ${profResult.needed} → ${profResult.passed ? 'PASA' : 'FALLA'}`
        addLog({ side: activeSide, message: profMsg, type: 'morale' })
        if (!profResult.passed) {
          const opsCost = getOpsCost(attacker.unitTypeId)
          updateUnit(attackerId, { isUsed: true, isOpFire: false })
          set({ opsUsed: prevOpsSnapshot + opsCost, activatingUnit: null, lastMoveUndo: null })
          const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
          if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
          return { ok: false, reason: `Falla Prof Check (tirada ${profResult.roll} vs ${profResult.needed})` }
        }
      }

      const isHigher = attackerHex.elevation > targetHex.elevation
      const isLower  = attackerHex.elevation < targetHex.elevation
      const rearAtk  = isVehicleRearAttack(target, attackerHex, targetHex)

      let logMsg: string
      let targetWasEliminated = false

      if (targetType.category === 'vehicle') {
        // V/Gun vs Vehículo
        const fpVsVehicle = vStats?.fpVsVehicle ?? gStats?.fpVsVehicle ?? 0
        const armor       = armorForAngle(target, attackerHex, targetHex)
        const vvResult = resolveVGunVsVehicle({
          attackerFP:   fpVsVehicle,
          targetArmor:  armor,
          rangeHexes:   range,
          isRearAttack: rearAtk,
          targetHigher: targetHex.elevation > attackerHex.elevation,
          targetLower:  targetHex.elevation < attackerHex.elevation,
          overRange20:  range > 20,
          overRange30:  range > 30,
        })
        targetWasEliminated = vvResult.destroyed
        if (vvResult.destroyed) removeUnit(targetId)
        logMsg = `V/Cañón vs Vehículo — tirada ${vvResult.roll} vs ataque ${vvResult.attackNumber} → ${vvResult.destroyed ? 'DESTRUIDO' : 'Sin efecto'}`
      } else {
        // V/Gun vs Infantería / Cañón no-vehículo
        const fpVsInf     = vStats?.fpVsInfantry ?? gStats?.fpVsInfantry ?? 0
        const targetInfStats = getActiveInfantryStats(target.unitTypeId, target.isReduced)
        if (!targetInfStats) return { ok: false, reason: 'Objetivo sin estadísticas de infantería' }
        const viResult = resolveVGunVsInfantry({
          attackerFP:        fpVsInf,
          rangeHexes:        range,
          targetHex,
          targetIsReduced:   target.isReduced,
          targetStats:       targetInfStats,
          targetIsMoving:    false,
          targetIsConcealed: target.isConcealed,
          attackerHigher:    isHigher,
          attackerLower:     isLower,
          targetHasFlank:    target.hasFlank,
          hindrances,
        })
        // ── Señuelo: revelar y eliminar si el resultado suprime ─────────────
        if (getUnitType(target.unitTypeId)?.category === 'decoy') {
          const wouldSuppress = viResult.suppressed || viResult.reduced || viResult.eliminated
          if (wouldSuppress) {
            removeUnit(targetId)
            addLog({ side: activeSide, message: `⚠ ¡SEÑUELO REVELADO! ${target.unitTypeId} era un señuelo — eliminado`, type: 'info' })
          }
          updateUnit(attackerId, { isUsed: true, isOpFire: false })
          set({ activatingUnit: null, lastMoveUndo: null })
          const opsCostDecA = hasMoved ? 0 : getOpsCost(attacker.unitTypeId)
          set({ opsUsed: prevOpsSnapshot + opsCostDecA })
          const sideConfigDecA = activeSide === 'allied' ? scenario.allied : scenario.axis
          if (get().opsUsed >= sideConfigDecA.opsRangeMax) get().endSideOperations()
          return { ok: true, mode: 'normal' }
        }
        targetWasEliminated = viResult.eliminated || (viResult.reduced && target.isReduced)
        if (viResult.eliminated || (viResult.reduced && target.isReduced)) {
          removeUnit(targetId)
        } else if (viResult.reduced) {
          updateUnit(targetId, { isReduced: true, suppression: 2 })
        } else if (viResult.suppressed) {
          updateUnit(targetId, { suppression: Math.min(2, target.suppression + 1) as SuppressionLevel })
        }
        logMsg = fireLogMessage(attacker, target.position ?? '?', viResult)
      }

      updateUnit(attackerId, { isUsed: true, isOpFire: false })
      set({ activatingUnit: null, lastMoveUndo: null })
      const opsCost = hasMoved ? 0 : getOpsCost(attacker.unitTypeId)
      const newOps  = prevOpsSnapshot + opsCost
      set({ opsUsed: newOps })

      const fireUndo: FireUndo = {
        attackerId,
        prevAttacker:        prevAttackerSnapshot,
        targetId,
        prevTarget:          prevTargetSnapshot,
        targetWasEliminated,
        prevOps:             prevOpsSnapshot,
        prevMoveUndo:        prevMoveUndoSnapshot,
      }
      set({ lastFireUndo: fireUndo })
      addLog({ side: activeSide, message: logMsg, type: 'combat' })
      const sideConfigV = activeSide === 'allied' ? scenario.allied : scenario.axis
      if (newOps >= sideConfigV.opsRangeMax) get().endSideOperations()
      return { ok: true, mode: 'normal' }
    }

    // ── Ruta B: SATW (Squad con satwFP vs Vehículo) ───────────────────────────
    const attackerInfStats = getActiveInfantryStats(attacker.unitTypeId, attacker.isReduced)
    if (
      attackerType.category === 'squad' &&
      attackerInfStats?.satwFP !== null && attackerInfStats?.satwFP !== undefined &&
      targetType.category === 'vehicle'
    ) {
      const morale      = getCurrentMorale(attacker.suppression, attackerInfStats)
      const satwCheck   = resolveSATWCheck({
        unitMorale:            morale,
        satwNumber:            attackerInfStats.satw ?? 0,
        rangeHexes:            range,
        isOpFire:              false,
        firerIsOpFireMarked:   attacker.isOpFire,
        isAssaultFire:         attackerId in unitMPs,
        nonDispersedSmoke:     Object.values(get().smokeHexes).some(s => s === 'fresh') && hindrances > 0,
        hindrances,
        fromBuildingOrPillbox: false,
      })

      const checkMsg = `SATW Check: tirada ${satwCheck.roll} vs moral ${satwCheck.morale} → ${satwCheck.passed ? 'PASA' : 'FALLA'}`
      addLog({ side: activeSide, message: checkMsg, type: 'morale' })

      let targetWasEliminated = false
      if (satwCheck.passed) {
        const satwResult = resolveSATWAttack({
          satwFP:               attackerInfStats.satwFP,
          targetIsOpenTopped:   false,
          isRearAttack:         isVehicleRearAttack(target, attackerHex, targetHex),
          targetLower:          targetHex.elevation < attackerHex.elevation,
          targetHigher:         targetHex.elevation > attackerHex.elevation,
          overRange20:          range > 20,
          overRange30:          range > 30,
        })
        targetWasEliminated = satwResult.destroyed
        if (satwResult.destroyed) removeUnit(targetId)
        const atkMsg = `SATW Ataque: tirada ${satwResult.roll} vs FP ajustado ${satwResult.adjustedFP} → ${satwResult.destroyed ? 'DESTRUIDO' : 'Sin efecto'}`
        addLog({ side: activeSide, message: atkMsg, type: 'combat' })
      }

      updateUnit(attackerId, { isUsed: true, isOpFire: false })
      set({ activatingUnit: null, lastMoveUndo: null })
      const hasMoved = attackerId in unitMPs
      const opsCost  = hasMoved ? 0 : getOpsCost(attacker.unitTypeId)
      const newOps   = prevOpsSnapshot + opsCost
      set({ opsUsed: newOps })
      const fireUndo: FireUndo = {
        attackerId,
        prevAttacker:        prevAttackerSnapshot,
        targetId,
        prevTarget:          prevTargetSnapshot,
        targetWasEliminated,
        prevOps:             prevOpsSnapshot,
        prevMoveUndo:        prevMoveUndoSnapshot,
      }
      set({ lastFireUndo: fireUndo })
      const sideConfigS = activeSide === 'allied' ? scenario.allied : scenario.axis
      if (newOps >= sideConfigS.opsRangeMax) get().endSideOperations()
      return { ok: true, mode: 'normal' }
    }

    // ── Ruta C: Infantería vs Infantería/Cañón (ruta original) ───────────────
    const attackerStats = attackerInfStats ?? getActiveInfantryStats(attacker.unitTypeId, attacker.isReduced)
    const targetStats   = getActiveInfantryStats(target.unitTypeId,   target.isReduced)
    if (!attackerStats || !targetStats) return { ok: false, reason: 'Tipo de unidad no soportado para fuego directo de infantería' }

    const maxRange = attackerStats.rangeMax ?? Infinity
    if (range > maxRange * 2) return { ok: false, reason: `Fuera de rango (máx ${maxRange * 2} hexes)` }

    // Auto-determinar modo de fuego según el estado de la unidad (Regla 6.0)
    const hasMoved = attackerId in unitMPs
    let mode: FireMode

    if (hasMoved) {
      // Assault Fire: solo Squads pueden hacerlo (Regla 6.2)
      if (attackerType.category !== 'squad') {
        return { ok: false, reason: 'Solo las escuadras pueden hacer Fuego de Asalto tras mover' }
      }
      mode = 'assault'
    } else {
      // Normal Fire: requiere MC antes de disparar (Regla 5.0)
      mode = 'normal'
      const morale   = getCurrentMorale(attacker.suppression, attackerStats)
      const mcResult = rollMoraleCheck(morale)
      get().addLog({ side: activeSide, message: mcLogMessage(attacker, mcResult), type: 'morale' })
      if (!mcResult.passed) {
        const opsCost = getOpsCost(attacker.unitTypeId)
        set(state => ({
          units:   { ...state.units, [attackerId]: { ...state.units[attackerId], isUsed: true } },
          opsUsed: state.opsUsed + opsCost,
          activatingUnit: null,
        }))
        const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
        if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
        return { ok: false, reason: `Falla MC (tirada ${mcResult.roll} vs Moral ${mcResult.morale})` }
      }
    }

    const result = resolveFireAttack({
      attackerStats,
      mode,
      attackerIsOpFire: attacker.isOpFire,
      spendCP,
      changeFacing:     false,
      attackerHex,
      targetHex,
      targetStats,
      targetIsReduced:  target.isReduced,
      targetIsMoving:   false,
      targetHasFlank:   target.hasFlank,
      rangeHexes:       range,
      targetIsConcealed: target.isConcealed,
      attackerHigher:   attackerHex.elevation > targetHex.elevation,
      attackerLower:    attackerHex.elevation < targetHex.elevation,
      hindrances,
    })

    const targetWasEliminated = result.eliminated || (result.reduced && target.isReduced)

    // ── Señuelo: revelar y eliminar si el resultado suprime ───────────────────
    if (getUnitType(target.unitTypeId)?.category === 'decoy') {
      const wouldSuppress = result.suppressed || result.reduced || result.eliminated
      if (wouldSuppress) {
        removeUnit(targetId)
        addLog({ side: activeSide, message: `⚠ ¡SEÑUELO REVELADO! ${target.unitTypeId} era un señuelo — eliminado`, type: 'info' })
      }
      if (attacker.isConcealed) updateUnit(attackerId, { isConcealed: false })
      updateUnit(attackerId, { isUsed: true, isOpFire: false })
      set({ activatingUnit: null, lastMoveUndo: null })
      const opsCostDec = hasMoved ? 0 : getOpsCost(attacker.unitTypeId)
      set({ opsUsed: prevOpsSnapshot + opsCostDec })
      const sideConfigDec = activeSide === 'allied' ? scenario.allied : scenario.axis
      if (get().opsUsed >= sideConfigDec.opsRangeMax) get().endSideOperations()
      return { ok: true, result, mode }
    }

    // Apply fire result to target
    if (result.eliminated) {
      removeUnit(targetId)
    } else if (result.reduced && target.isReduced) {
      removeUnit(targetId)
    } else if (result.reduced) {
      updateUnit(targetId, { isReduced: true, suppression: 2, isConcealed: false })
    } else if (result.suppressed) {
      updateUnit(targetId, {
        suppression: Math.min(2, target.suppression + 1) as SuppressionLevel,
        isConcealed: false,
      })
    }

    // Atacante pierde concealment al disparar (Regla 15.0)
    if (attacker.isConcealed) updateUnit(attackerId, { isConcealed: false })

    // Mark attacker as used (reset op fire flag), clear activation state
    updateUnit(attackerId, { isUsed: true, isOpFire: false })
    set({ activatingUnit: null, lastMoveUndo: null })

    // Coste de ops: 1 op por activación. Si la unidad ya movió (Assault Fire),
    // el op ya fue cobrado al mover → no cobrar de nuevo.
    const opsCost = hasMoved ? 0 : getOpsCost(attacker.unitTypeId)
    const newOps  = prevOpsSnapshot + opsCost
    set({ opsUsed: newOps })

    // Guardar estado de undo de disparo
    const fireUndo: FireUndo = {
      attackerId,
      prevAttacker:        prevAttackerSnapshot,
      targetId,
      prevTarget:          prevTargetSnapshot,
      targetWasEliminated,
      prevOps:             prevOpsSnapshot,
      prevMoveUndo:        prevMoveUndoSnapshot,
    }
    set({ lastFireUndo: fireUndo })

    // Log the result
    const logMsg = fireLogMessage(attacker, target.position ?? '?', result)
    addLog({ side: activeSide, message: logMsg, type: 'combat' })

    // Auto-paso si se alcanza el máximo
    const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
    if (newOps >= sideConfig.opsRangeMax) get().endSideOperations()

    return { ok: true, result, mode }
  },

  // ── Disparar humo (mortero) ───────────────────────────────────────────────

  tryFireSmoke: (attackerId, targetHexId) => {
    const { units, scenario, phase, activeSide, activatingUnit, addLog, updateUnit } = get()
    const attacker = units[attackerId]
    if (!attacker || !scenario) return { ok: false, reason: 'Sin datos' }
    if (phase !== 'operations') return { ok: false, reason: 'Solo en Operations' }
    if (attacker.isUsed) return { ok: false, reason: 'Unidad ya usada' }
    if (activatingUnit && activatingUnit !== attackerId) return { ok: false, reason: 'Otra unidad en activación' }
    const activeFaction = activeSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
    if (attacker.faction !== activeFaction) return { ok: false, reason: 'No es tu turno' }

    const stats = getActiveInfantryStats(attacker.unitTypeId, attacker.isReduced)
    if (!stats?.isMortar) return { ok: false, reason: 'Solo los morteros pueden disparar humo' }

    const fromHex = scenario.hexes.find(h => h.id === attacker.position)
    const toHex   = scenario.hexes.find(h => h.id === targetHexId)
    if (!fromHex || !toHex) return { ok: false, reason: 'Posición no encontrada' }
    const range = hexDistance(fromHex.col, fromHex.row, toHex.col, toHex.row)
    if (range < (stats.rangeMin ?? 2) || range > (stats.rangeMax ?? 10)) {
      return { ok: false, reason: `Fuera de rango (${stats.rangeMin ?? 2}–${stats.rangeMax ?? 10} hexes)` }
    }

    set(state => ({ smokeHexes: { ...state.smokeHexes, [targetHexId]: 'fresh' } }))
    updateUnit(attackerId, { isUsed: true, isOpFire: false })
    set({ activatingUnit: null, lastMoveUndo: null })
    const opsCost = getOpsCost(attacker.unitTypeId)
    set({ opsUsed: get().opsUsed + opsCost })
    addLog({ side: activeSide, message: `Mortero dispara humo en ${toHex.origCoord}`, type: 'combat' })
    const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
    if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
    return { ok: true }
  },

  // ── Rout Phase ────────────────────────────────────────────────────────────

  tryRoutUnit: (instanceId) => {
    const { units, scenario, phase, addLog, removeUnit, updateUnit } = get()
    const unit = units[instanceId]
    if (!unit || !scenario) return { ok: false, reason: 'Sin datos' }
    if (phase !== 'rout') return { ok: false, reason: 'Solo en Rout Phase' }
    if (!unit.position) return { ok: false, reason: 'Unidad sin posición' }

    const unitHex = scenario.hexes.find(h => h.id === unit.position)
    if (!unitHex) return { ok: false, reason: 'Hex no encontrado' }

    const side: ActiveSide = unit.faction === scenario.allied.faction ? 'allied' : 'axis'
    const condition = getRoutCondition(unit, unitHex, units, scenario.hexes, scenario)
    if (!condition.mustRout) {
      addLog({ side, message: `${unit.unitTypeId} no está sujeta a Rout`, type: 'morale' })
      return { ok: true, mustRout: false }
    }

    const stats = getActiveInfantryStats(unit.unitTypeId, unit.isReduced)
    if (!stats) return { ok: false, reason: 'Sin estadísticas de infantería' }

    const routResult = resolveRoutCheck(unit, stats, condition)
    addLog({ side, message: routLogMessage(unit, routResult), type: 'morale' })

    if (!routResult.mustRout) return { ok: true, mustRout: false }

    // Baja en Rout (11.1)
    if (routResult.casualtyOnRout) {
      if (unit.isReduced) {
        removeUnit(instanceId)
        return { ok: true, mustRout: true, eliminated: true }
      } else {
        updateUnit(instanceId, { isReduced: true, suppression: 2 })
      }
    }

    const routEdge = side === 'allied' ? scenario.allied.routEdge : scenario.axis.routEdge
    const currentUnits = get().units  // refresh after potential updateUnit
    const candidates = findRoutCandidates(currentUnits[instanceId] ?? unit, unitHex, currentUnits, scenario.hexes, routEdge)
    if (candidates.length === 0) {
      removeUnit(instanceId)
      return { ok: true, mustRout: true, eliminated: true }
    }

    const dest = candidates[0]
    get().moveUnit(instanceId, dest.hexId)
    const destHex = scenario.hexes.find(h => h.id === dest.hexId)
    addLog({ side, message: `${unit.unitTypeId} huye a ${destHex?.origCoord ?? dest.hexId}`, type: 'morale' })

    // Si alcanza el borde de huida → sale del mapa
    if (destHex && isOnRoutEdge(destHex, routEdge, scenario.hexes)) {
      removeUnit(instanceId)
      addLog({ side, message: `${unit.unitTypeId} huye del mapa por el borde ${routEdge}`, type: 'morale' })
      return { ok: true, mustRout: true, eliminated: true }
    }

    return { ok: true, mustRout: true, newHexId: dest.hexId }
  },

  // ── Melee Phase ───────────────────────────────────────────────────────────

  tryResolveMelee: (hexId, spendCPAllied = false, spendCPAxis = false) => {
    const { units, scenario, phase, commandPoints, addLog, removeUnit, updateUnit } = get()
    if (!scenario) return { ok: false, reason: 'Sin datos' }
    if (phase !== 'melee') return { ok: false, reason: 'Solo en Melee Phase' }

    const alliedFaction = scenario.allied.faction
    const axisFaction   = scenario.axis.faction
    // Eliminar señuelos del hex antes del melee (se revelan al contacto)
    const allInHex = Object.values(get().units).filter(u => u.position === hexId)
    for (const u of allInHex) {
      if (getUnitType(u.unitTypeId)?.category === 'decoy') {
        removeUnit(u.instanceId)
        addLog({ side: 'allied', message: `⚠ ¡SEÑUELO REVELADO en melee! ${u.unitTypeId} — eliminado`, type: 'info' })
      }
    }
    // Re-fetch tras posibles eliminaciones
    const freshUnits = get().units
    const sideA = Object.values(freshUnits).filter(u => u.position === hexId && u.faction === alliedFaction)
    const sideB = Object.values(freshUnits).filter(u => u.position === hexId && u.faction === axisFaction)
    if (sideA.length === 0 || sideB.length === 0) return { ok: false, reason: 'No hay combate en este hex' }

    const toParticipants = (side: UnitInstance[], useCP: boolean): MeleeParticipant[] =>
      side.flatMap(u => {
        const ut    = getUnitType(u.unitTypeId)
        const stats = getActiveInfantryStats(u.unitTypeId, u.isReduced)
        if (!stats) return []
        return [{ unit: u, category: ut?.category ?? 'squad', stats, hasFlank: u.hasFlank, useCP }]
      })

    const result = resolveMelee(
      toParticipants(sideA, spendCPAllied),
      toParticipants(sideB, spendCPAxis),
    )

    if (spendCPAllied && commandPoints.allied > 0) get().useCommandPoint('allied')
    if (spendCPAxis   && commandPoints.axis   > 0) get().useCommandPoint('axis')

    const applyCasualties = (side: UnitInstance[], hits: number) =>
      applyMeleeCasualties(
        side.map(u => ({ unit: u, category: getUnitType(u.unitTypeId)?.category ?? 'squad' })),
        hits,
      )

    for (const c of applyCasualties(sideA, result.totalHitsOnAttackers)) {
      if (c.wasEliminated) removeUnit(c.instanceId)
      else if (c.wasReduced) updateUnit(c.instanceId, { isReduced: true, suppression: 2 })
    }
    for (const c of applyCasualties(sideB, result.totalHitsOnDefenders)) {
      if (c.wasEliminated) removeUnit(c.instanceId)
      else if (c.wasReduced) updateUnit(c.instanceId, { isReduced: true, suppression: 2 })
    }

    addLog({ side: 'allied', message: meleeLogMessage(result), type: 'combat' })
    return { ok: true, result }
  },

  endUnitActivation: (instanceId) => {
    const { units, scenario, unitMPs, activeSide } = get()
    const unit = units[instanceId]
    if (!unit || !scenario) return

    // Mark as used, clear activation lock and undo state
    get().updateUnit(instanceId, { isUsed: true, isOpFire: false })
    set({ activatingUnit: null, lastMoveUndo: null })

    // Charge ops only if unit was never activated this turn (no moves/fires yet)
    if (!(instanceId in unitMPs)) {
      const opsCost = getOpsCost(unit.unitTypeId)
      set({ opsUsed: get().opsUsed + opsCost })
    }

    // Concealment gain: si marcada como Used fuera del LOS enemigo en Beneficial Terrain (Regla 15.0)
    {
      const freshState = get()
      const hex = scenario.hexes.find(h => h.id === unit.position)
      if (hex && !unit.isConcealed && hasBeneficialTerrain(hex) &&
          isOutsideAllEnemyLOS(instanceId, freshState.units, scenario.hexes, freshState.smokeHexes)) {
        get().updateUnit(instanceId, { isConcealed: true })
      }
    }

    // If this was the Second Player Action, switch back to the first mover
    if (get().secondPlayerActionActive) {
      const { firstMoverSide } = get()
      set({ secondPlayerActionActive: false, activeSide: firstMoverSide ?? activeSide, opsUsed: 0, activatingUnit: null })
      return
    }

    // Always check auto-end after activation completes
    const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
    if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
  },

  endSideOperations: () => {
    const { activeSide, scenario, units, opsUsed } = get()
    if (!scenario) return

    const sideLabel = activeSide === 'allied' ? 'Aliados' : 'Eje'
    get().addLog({
      side: activeSide,
      message: `${sideLabel} finalizan operaciones (${opsUsed} ops)`,
      type: 'phase',
    })

    const nextSide: ActiveSide = activeSide === 'allied' ? 'axis' : 'allied'
    const nextFaction = nextSide === 'allied' ? scenario.allied.faction : scenario.axis.faction

    // Comprobar si quedan unidades sin activar en algún bando
    const nextHasUnits = Object.values(units).some(
      u => u.faction === nextFaction && !u.isUsed && u.position !== null
    )
    const allDone = !Object.values(units).some(u => !u.isUsed && u.position !== null)

    if (allDone || !nextHasUnits) {
      // Si nadie más puede activarse → termina la fase de Operaciones
      get().addLog({ side: activeSide, message: 'Fase de Operaciones concluida', type: 'phase' })
      set({ phase: 'rout', opsUsed: 0, unitMPs: {}, selectedUnit: null, selectedHex: null, activatingUnit: null, lastMoveUndo: null, lastFireUndo: null })
      return
    }

    // Pasar al bando contrario
    set({ activeSide: nextSide, opsUsed: 0, unitMPs: {}, selectedUnit: null, selectedHex: null, activatingUnit: null, lastMoveUndo: null, lastFireUndo: null })
  },

  undoLastMove: () => {
    const { lastMoveUndo, unitMPs } = get()
    if (!lastMoveUndo) return

    const { instanceId, fromHex, prevMPs, prevOps } = lastMoveUndo

    const newUnitMPs = { ...unitMPs }
    if (prevMPs === null) {
      // First move was undone: remove the unit from unitMPs entirely
      delete newUnitMPs[instanceId]
    } else {
      newUnitMPs[instanceId] = prevMPs
    }

    set(state => ({
      units:          { ...state.units, [instanceId]: { ...state.units[instanceId], position: fromHex } },
      unitMPs:        newUnitMPs,
      opsUsed:        prevOps,
      activatingUnit: prevMPs === null ? null : instanceId,
      lastMoveUndo:   null,
    }))
  },

  undoLastFire: () => {
    const { lastFireUndo, unitMPs } = get()
    if (!lastFireUndo) return

    const { attackerId, prevAttacker, targetId, prevTarget, targetWasEliminated, prevOps, prevMoveUndo } = lastFireUndo

    // Restaurar estado del atacante
    set(state => ({
      units: { ...state.units, [attackerId]: { ...state.units[attackerId], ...prevAttacker } }
    }))

    // Restaurar objetivo (re-añadir si fue eliminado, o revertir suppression/reduced)
    if (targetWasEliminated) {
      set(state => ({ units: { ...state.units, [targetId]: prevTarget } }))
    } else {
      set(state => ({
        units: {
          ...state.units,
          [targetId]: { ...state.units[targetId], suppression: prevTarget.suppression, isReduced: prevTarget.isReduced },
        }
      }))
    }

    // Restaurar ops, move-undo y activation lock
    const hadMoved = attackerId in unitMPs
    set({
      opsUsed:       prevOps,
      lastFireUndo:  null,
      lastMoveUndo:  prevMoveUndo,
      activatingUnit: hadMoved ? attackerId : null,
    })
  },

  // ── Op Fire ────────────────────────────────────────────────────────────────

  tryOpFireUnit: (firerId, targetId, spendCPArg = false) => {
    const { units, scenario, pendingOpFire, activeSide, commandPoints } = get()
    if (!pendingOpFire || !scenario) return { ok: false, reason: 'No hay oportunidad de Op Fire activa' }
    if (pendingOpFire.movingUnitId !== targetId) return { ok: false, reason: 'El objetivo no coincide con la unidad en movimiento' }
    if (!pendingOpFire.eligibleFirers.includes(firerId)) return { ok: false, reason: 'Esta unidad no es elegible para Op Fire' }

    const firer  = units[firerId]
    const target = units[targetId]
    if (!firer || !target) return { ok: false, reason: 'Unidades no encontradas' }

    const firerHex  = scenario.hexes.find(h => h.id === firer.position)
    const targetHex = scenario.hexes.find(h => h.id === pendingOpFire.enteredHexId)
    if (!firerHex || !targetHex) return { ok: false, reason: 'Hex no encontrado' }

    const firerStats = getActiveInfantryStats(firer.unitTypeId, firer.isReduced)
    if (!firerStats) return { ok: false, reason: 'Sin estadísticas del firer' }

    const eligResult = checkOpFireEligibility(firer, firerHex, targetHex, firerStats)
    if (!eligResult.canFire) return { ok: false, reason: eligResult.reason ?? 'No elegible' }

    const isFinal = eligResult.isFinal
    const dist = hexDistance(firerHex.col, firerHex.row, targetHex.col, targetHex.row)
    // Final Op Fire con CP a distancia > 1
    const needsCP = isFinal && dist > 1
    const opFireSide: ActiveSide = firer.faction === scenario.allied.faction ? 'allied' : 'axis'
    if (needsCP) {
      if (!spendCPArg || commandPoints[opFireSide] <= 0) {
        return { ok: false, reason: 'Final Op Fire a distancia > 1 requiere CP' }
      }
      get().useCommandPoint(opFireSide)
    }

    // MC check para el firer (Regla 9.0: debe pasar MC para disparar)
    const morale = getCurrentMorale(firer.suppression, firerStats)
    const mcResult = rollMoraleCheck(morale)
    get().addLog({ side: opFireSide, message: mcLogMessage(firer, mcResult), type: 'morale' })
    if (!mcResult.passed) {
      get().updateUnit(firerId, { isUsed: true, isOpFire: false, isConcealed: false })
      // Actualizar elegibles
      const newEligible = pendingOpFire.eligibleFirers.filter(id => id !== firerId)
      if (newEligible.length === 0) {
        set({ pendingOpFire: null })
      } else {
        set({ pendingOpFire: { ...pendingOpFire, eligibleFirers: newEligible } })
      }
      return { ok: false, reason: `Falla MC (tirada ${mcResult.roll} vs Moral ${morale})` }
    }

    const targetStats = getActiveInfantryStats(target.unitTypeId, target.isReduced)
    const hexMap = buildHexMap(scenario.hexes)
    const losResult = computeLOS(firerHex, targetHex, hexMap, get().smokeHexes)
    const hindrances = losResult.hindrance

    const result = resolveOpFire({
      firer,
      firerHex,
      firerStats,
      target,
      targetHex,
      targetStats: targetStats ?? firerStats,
      targetIsMoving:    true,
      targetHasFlank:    target.hasFlank,
      targetIsConcealed: target.isConcealed,
      attackerIsOpFire:  firer.isOpFire,
      spendCP:           spendCPArg && !needsCP && commandPoints[opFireSide] > 0,
      isFinalOpFire:     isFinal,
      attackerHigher:    firerHex.elevation > targetHex.elevation,
      attackerLower:     firerHex.elevation < targetHex.elevation,
      hindrances,
    })

    // Aplicar resultado al target
    if (result.eliminated) {
      get().removeUnit(targetId)
    } else if (result.reduced && target.isReduced) {
      get().removeUnit(targetId)
    } else if (result.reduced) {
      get().updateUnit(targetId, { isReduced: true, suppression: 2, isConcealed: false })
    } else if (result.suppressed) {
      get().updateUnit(targetId, {
        suppression: Math.min(2, target.suppression + 1) as SuppressionLevel,
        isConcealed: false,
      })
      // Si el target fue suprimido mientras movía, debe pasar MC o su movimiento para (Regla 9.0)
      const targetStats2 = getActiveInfantryStats(target.unitTypeId, target.isReduced)
      if (targetStats2) {
        const freshTarget = get().units[targetId]
        if (freshTarget) {
          const mc2 = rollMoraleCheck(getCurrentMorale(freshTarget.suppression, targetStats2))
          get().addLog({ side: activeSide, message: `MC movimiento (Op Fire): tirada ${mc2.roll} vs ${getCurrentMorale(freshTarget.suppression, targetStats2)} → ${mc2.passed ? 'PASA' : 'PARA'}`, type: 'morale' })
          if (!mc2.passed) {
            get().updateUnit(targetId, { isUsed: true })
            set({ movingUnitMCFailed: true })
          }
        }
      }
    }

    // El firer pierde concealment, queda Used
    get().updateUnit(firerId, { isUsed: true, isOpFire: false, isConcealed: false })

    get().addLog({ side: opFireSide, message: opFireLogMessage(firer, targetId, result, isFinal), type: 'combat' })

    // Actualizar elegibles en pendingOpFire (remover el firer que ya disparó)
    const newEligible = pendingOpFire.eligibleFirers.filter(id => id !== firerId)
    if (newEligible.length === 0) {
      set({ pendingOpFire: null })
    } else {
      set({ pendingOpFire: { ...pendingOpFire, eligibleFirers: newEligible } })
    }

    return { ok: true, result, isFinal }
  },

  passOpFire: () => {
    set({ pendingOpFire: null, movingUnitMCFailed: false })
  },

  // ── Setup Interactivo ──────────────────────────────────────────────────────

  placeUnitInSetup: (instanceId, hexId) => {
    const { units, scenario, phase, activeSide, setupSplitCol, axisSetupSplitCol } = get()
    if (phase !== 'setup') return { ok: false, reason: 'Solo durante el Setup' }
    const unit = units[instanceId]
    if (!unit) return { ok: false, reason: 'Unidad no encontrada' }
    if (!scenario) return { ok: false, reason: 'Sin escenario' }

    const activeFaction = activeSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
    if (unit.faction !== activeFaction) return { ok: false, reason: 'No es tu bando' }

    const hex = scenario.hexes.find(h => h.id === hexId)
    if (!hex) return { ok: false, reason: 'Hex no encontrado' }

    // Validar zona de setup
    const isAllied = activeSide === 'allied'
    const isPointyTop = scenario.orientation === 'pointy-top'
    const sideConfig = isAllied ? scenario.allied : scenario.axis
    const validZone = (sideConfig.setupMaps ?? []).length > 0
      ? sideConfig.setupMaps.includes(hex.origMap)
      : isPointyTop
        ? (isAllied ? hex.row > setupSplitCol : hex.row <= axisSetupSplitCol)
        : (isAllied ? hex.col <= setupSplitCol : hex.col > axisSetupSplitCol)
    if (!validZone) return { ok: false, reason: 'Fuera de tu zona de despliegue' }

    // Validar stacking
    if (!canStackInHex(hexId, unit.faction, units, unit.unitTypeId)) {
      return { ok: false, reason: 'Hex lleno (máx. 2 unidades de infantería; 1 vehículo/cañón)' }
    }

    const isDecoyUnit = getUnitType(unit.unitTypeId)?.category === 'decoy'
    get().updateUnit(instanceId, { position: hexId, isConcealed: isDecoyUnit || unit.isConcealed })
    return { ok: true }
  },

  removeUnitFromSetup: (instanceId) => {
    const { phase } = get()
    if (phase !== 'setup') return
    get().updateUnit(instanceId, { position: null })
  },

  completeSetup: () => {
    const { units, scenario, activeSide, phase, setupSplitCol } = get()
    if (phase !== 'setup' || !scenario) return

    // Calcular concealment inicial para todas las unidades colocadas
    const allUnits = get().units
    const hexes = scenario.hexes
    const smokeHexes = get().smokeHexes
    Object.values(allUnits).forEach(u => {
      if (!u.position) return
      const hex = hexes.find(h => h.id === u.position)
      if (!hex) return
      if (hasBeneficialTerrain(hex) && isOutsideAllEnemyLOS(u.instanceId, allUnits, hexes, smokeHexes)) {
        get().updateUnit(u.instanceId, { isConcealed: true })
      }
    })

    // Si el bando activo de setup era 'allied', ahora pone el eje (o viceversa)
    // Cuando ambos bandos han tenido su turno de setup, se avanza a operations
    // Simplificación: si el bando NO activo ya tiene unidades colocadas → ambos han puesto → avanzar
    const otherSide: ActiveSide = activeSide === 'allied' ? 'axis' : 'allied'
    const otherFaction = otherSide === 'allied' ? scenario.allied.faction : scenario.axis.faction
    const otherHasUnits = Object.values(allUnits).some(u => u.faction === otherFaction && u.position !== null)

    if (!otherHasUnits) {
      // El otro bando todavía no ha colocado → pasarle el turno de setup
      set({ activeSide: otherSide })
      get().addLog({ side: activeSide, message: `${activeSide === 'allied' ? 'Aliados' : 'Eje'} han completado su despliegue. Turno del ${otherSide === 'allied' ? 'Aliados' : 'Eje'}.`, type: 'phase' })
    } else {
      // Ambos bandos han colocado → iniciar operaciones
      const firstSide: ActiveSide = scenario.allied.faction === scenario.movesFirst ? 'allied' : 'axis'
      set({
        phase:      'operations',
        activeSide: firstSide,
        opsUsed:    0,
        unitMPs:    {},
      })
      get().addLog({ side: activeSide, message: 'Despliegue completado. ¡Comienza la batalla!', type: 'phase' })
    }

    void setupSplitCol
  },

  useCommandPoint: (side) =>
    set(state => ({
      commandPoints: {
        ...state.commandPoints,
        [side]: Math.max(0, state.commandPoints[side] - 1)
      }
    })),

  incrementOpsUsed: () => set(state => ({ opsUsed: state.opsUsed + 1 })),
  resetOpsUsed:     () => set({ opsUsed: 0 }),

  // ── Señales de Mando: Follow Me (+1 MP) ──────────────────────────────────

  spendCPForMovement: (instanceId) => {
    const { units, scenario, phase, activeSide, activatingUnit, commandPoints } = get()
    const unit = units[instanceId]
    if (!unit || !scenario) return { ok: false, reason: 'Sin datos' }
    if (phase !== 'operations') return { ok: false, reason: 'Solo en Operations' }
    if (activatingUnit !== instanceId) return { ok: false, reason: 'Unidad no en activación' }
    const cat = getUnitType(unit.unitTypeId)?.category
    if (cat !== 'squad' && cat !== 'wt_mg' && cat !== 'wt_mortar') {
      return { ok: false, reason: 'Solo infantería desmontada (regla 3.0)' }
    }
    if (commandPoints[activeSide] <= 0) return { ok: false, reason: 'Sin CPs disponibles' }

    get().useCommandPoint(activeSide)
    const currentMPs = get().unitMPs[instanceId] ?? 0
    set(state => ({ unitMPs: { ...state.unitMPs, [instanceId]: currentMPs + 1 } }))
    get().addLog({ side: activeSide, message: `${unit.unitTypeId} usa CP: +1 MP (Follow Me!)`, type: 'info' })
    return { ok: true }
  },

  // ── Señales de Mando: Re-roll MC ──────────────────────────────────────────

  confirmMCRerollAndMove: (instanceId, targetHexId) => {
    const { units, scenario, activeSide, commandPoints } = get()
    const unit = units[instanceId]
    if (!unit || !scenario) return { ok: false, reason: 'Sin datos' }
    if (commandPoints[activeSide] <= 0) return { ok: false, reason: 'Sin CPs' }

    get().useCommandPoint(activeSide)

    // Re-roll MC
    const stats = getActiveInfantryStats(unit.unitTypeId, unit.isReduced)
    if (!stats) return { ok: false, reason: 'Sin estadísticas' }
    const morale   = getCurrentMorale(unit.suppression, stats)
    const mcResult = rollMoraleCheck(morale, true)
    get().addLog({ side: activeSide, message: `Re-roll MC (CP): tirada ${mcResult.roll} vs Moral ${morale} → ${mcResult.passed ? 'PASA' : 'FALLA'}`, type: 'morale' })

    if (!mcResult.passed) {
      // Doble fallo: marcar Used
      const opsCost = getOpsCost(unit.unitTypeId)
      set(state => ({
        units: { ...state.units, [instanceId]: { ...state.units[instanceId], isUsed: true } },
        opsUsed: state.opsUsed + opsCost,
        activatingUnit: null,
      }))
      const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
      if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
      return { ok: false, reason: 'Re-roll MC también falló' }
    }

    // MC superado: continuar con el movimiento (skip MC)
    return get().tryMoveUnit(instanceId, targetHexId, true)
  },

  declineMCReroll: (instanceId) => {
    const { units, scenario, activeSide } = get()
    const unit = units[instanceId]
    if (!unit || !scenario) return
    const opsCost = getOpsCost(unit.unitTypeId)
    set(state => ({
      units: { ...state.units, [instanceId]: { ...state.units[instanceId], isUsed: true } },
      opsUsed: state.opsUsed + opsCost,
      activatingUnit: null,
    }))
    const sideConfig = activeSide === 'allied' ? scenario.allied : scenario.axis
    if (get().opsUsed >= sideConfig.opsRangeMax) get().endSideOperations()
  },

  // ── Señales de Mando: Second Player Action ─────────────────────────────────

  useSecondPlayerActionCP: () => {
    const { activeSide, commandPoints } = get()
    if (commandPoints[activeSide] <= 0) return
    get().useCommandPoint(activeSide)
    set({ secondPlayerActionPending: false, secondPlayerActionActive: true, opsUsed: 0 })
    get().addLog({ side: activeSide, message: `${activeSide === 'allied' ? 'Aliados' : 'Eje'} usa CP: Acción del 2° Jugador`, type: 'info' })
  },

  passSecondPlayerAction: () => {
    const { firstMoverSide, activeSide } = get()
    set({ secondPlayerActionPending: false, secondPlayerActionActive: false, activeSide: firstMoverSide ?? activeSide, opsUsed: 0 })
  },

  // ── Guardado / Carga ──────────────────────────────────────────────────────

  saveGame: () => {
    const s = get()
    if (!s.scenario || s.phase === 'setup') return
    const data = {
      version: SAVE_VERSION, timestamp: Date.now(),
      scenario: s.scenario, currentTurn: s.currentTurn, maxTurns: s.maxTurns,
      phase: s.phase, activeSide: s.activeSide, playerFaction: s.playerFaction,
      commandPoints: s.commandPoints, opsUsed: s.opsUsed,
      units: s.units, unitMPs: s.unitMPs, hexControl: s.hexControl,
      activatingUnit: s.activatingUnit, lastMoveUndo: s.lastMoveUndo, lastFireUndo: s.lastFireUndo,
      smokeHexes: s.smokeHexes, pendingOpFire: s.pendingOpFire,
      movingUnitMCFailed: s.movingUnitMCFailed, setupSplitCol: s.setupSplitCol, axisSetupSplitCol: s.axisSetupSplitCol,
      secondPlayerActionPending: s.secondPlayerActionPending,
      secondPlayerActionActive: s.secondPlayerActionActive,
      firstMoverSide: s.firstMoverSide, log: s.log,
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  },

  loadGame: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      if (data.version !== SAVE_VERSION) return false
      // Migración: añadir setupMaps si falta (partidas guardadas antes de añadir Zona_despliegue)
      if (data.scenario) {
        data.scenario.allied.setupMaps ??= []
        data.scenario.axis.setupMaps   ??= []
      }
      set({
        ...data,
        selectedUnit: null, selectedHex: null, isAIThinking: false,
      })
      return true
    } catch { return false }
  },

  hasSave:   () => localStorage.getItem(SAVE_KEY) !== null,
  clearSave: () => localStorage.removeItem(SAVE_KEY),

  addLog: (entry) =>
    set(state => ({
      log: [
        ...state.log,
        { ...entry, turn: state.currentTurn, phase: state.phase }
      ].slice(-200)  // máx 200 entradas
    })),

  setAIThinking: (v) => set({ isAIThinking: v }),
}))
