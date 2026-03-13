import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from './store/gameStore'
import ScenarioSelect from './components/ScenarioSelect/ScenarioSelect'
import HexGrid from './components/HexGrid/HexGrid'
import PhaseBar from './components/PhaseBar/PhaseBar'
import GamePanel from './components/GamePanel/GamePanel'
import { getUnitType, computeLOS, buildHexMap } from './engine/mechanics'
import {
  isAISide,
  runAISetup,
  runAIOperations,
  runAIOpFire,
  runAIRout,
  runAIMelee,
  runAISecondPlayerAction,
} from './engine/ai/aiEngine'
import type { Scenario } from './types'
export default function App() {
  const {
    scenario, phase, currentTurn, maxTurns,
    activeSide, playerFaction,
    opsUsed, commandPoints, smokeHexes,
    units, unitMPs, hexControl,
    selectedUnit, selectedHex,
    log, isAIThinking,
    activatingUnit, lastMoveUndo, lastFireUndo,
    pendingOpFire, setupSplitCol, setupSplitInverted,
    secondPlayerActionPending, secondPlayerActionActive, firstMoverSide,
    loadScenario, selectUnit, selectHex,
    nextPhase, updateUnit,
    tryMoveUnit, tryFireUnit, tryFireSmoke, tryRoutUnit, tryResolveMelee, addLog,
    endUnitActivation, endSideOperations, undoLastMove, undoLastFire,
    tryOpFireUnit, passOpFire,
    placeUnitInSetup, removeUnitFromSetup, completeSetup,
    spendCPForMovement, confirmMCRerollAndMove, declineMCReroll,
    useSecondPlayerActionCP, passSecondPlayerAction,
    saveGame, loadGame, hasSave,
  } = useGameStore()

  // ── Guardia de re-entrada para la IA ──────────────────────────────────────
  const aiRunningRef = useRef(false)

  // ── Trigger: Setup IA ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'setup' || !scenario || !playerFaction) return
    if (!isAISide(activeSide, playerFaction, scenario))   return
    if (aiRunningRef.current) return
    aiRunningRef.current = true
    runAISetup(activeSide).finally(() => { aiRunningRef.current = false })
  }, [phase, activeSide, scenario, playerFaction])

  // ── Trigger: Operations IA ────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'operations' || !scenario || !playerFaction) return
    if (!isAISide(activeSide, playerFaction, scenario))        return
    if (aiRunningRef.current) return
    aiRunningRef.current = true
    runAIOperations(activeSide).finally(() => { aiRunningRef.current = false })
  }, [phase, activeSide, scenario, playerFaction])

  // ── Trigger: Op Fire IA (el humano mueve, la IA tiene tiradores elegibles) ─
  useEffect(() => {
    if (!pendingOpFire || !scenario || !playerFaction) return
    const aiFaction = playerFaction === scenario.allied.faction
      ? scenario.axis.faction
      : scenario.allied.faction
    const hasAIFirers = pendingOpFire.eligibleFirers.some(
      id => units[id]?.faction === aiFaction
    )
    if (!hasAIFirers) return
    runAIOpFire()
  }, [pendingOpFire, scenario, playerFaction, units])

  // ── Trigger: Rout / Melee / Second Player Action IA ───────────────────────
  useEffect(() => {
    if (!scenario || !playerFaction) return
    if (phase === 'rout') {
      runAIRout(playerFaction, scenario)
    }
    if (phase === 'melee') {
      runAIMelee()
    }
  }, [phase, scenario, playerFaction])

  useEffect(() => {
    if (!scenario || !playerFaction) return
    const aiSide = playerFaction === scenario.allied.faction ? 'axis' : 'allied'
    if (secondPlayerActionPending && activeSide === aiSide) {
      runAISecondPlayerAction(aiSide, playerFaction, scenario)
    }
  }, [secondPlayerActionPending, activeSide, scenario, playerFaction])

  // Feedback message from the last action
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Pending MC re-roll decision
  const [pendingMCReroll, setPendingMCReroll] = useState<{ instanceId: string; targetHexId: string } | null>(null)

  // CP toggle for the next fire action
  const [spendCP, setSpendCP] = useState(false)

  // Smoke targeting mode
  const [smokeMode, setSmokeMode] = useState(false)
  const [smokingUnit, setSmokingUnit] = useState<string | null>(null)

  // LOS check tool
  const [losMode,    setLosMode]    = useState(false)
  const [losFrom,    setLosFrom]    = useState<string | null>(null)
  const [losTo,      setLosTo]      = useState<string | null>(null)
  const [losPath,    setLosPath]    = useState<string[]>([])
  const [losBlocked, setLosBlocked] = useState(false)

  const toggleLosMode = useCallback(() => {
    setLosMode(prev => !prev)
    setLosFrom(null); setLosTo(null); setLosPath([]); setLosBlocked(false)
    setActionMsg(null)
  }, [])

  const handleStart = useCallback((s: Scenario, faction: 'American' | 'German') => {
    loadScenario(s, faction)
  }, [loadScenario])

  const handlePassOpFire = useCallback(() => {
    passOpFire()
    selectUnit(null)
    setActionMsg('Op Fire pasado')
  }, [passOpFire, selectUnit])

  const handleCompleteSetup = useCallback(() => {
    completeSetup()
    selectUnit(null)
    setActionMsg(null)
  }, [completeSetup, selectUnit])

  const handleConfirmMCReroll = useCallback(() => {
    if (!pendingMCReroll) return
    const res = confirmMCRerollAndMove(pendingMCReroll.instanceId, pendingMCReroll.targetHexId)
    setPendingMCReroll(null)
    if (res.ok) {
      const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2)
      setActionMsg(`★ MC repetido · → ${pendingMCReroll.targetHexId} · ${fmt(res.remainingMPs!)} MP`)
    } else {
      setActionMsg(res.reason ?? 'MC fallido de nuevo')
    }
  }, [pendingMCReroll, confirmMCRerollAndMove])

  const handleDeclineMCReroll = useCallback(() => {
    if (!pendingMCReroll) return
    declineMCReroll(pendingMCReroll.instanceId)
    setPendingMCReroll(null)
    setActionMsg('MC fallido — unidad marcada como usada')
  }, [pendingMCReroll, declineMCReroll])

  const handleUseSecondPlayerActionCP = useCallback(() => {
    useSecondPlayerActionCP()
    setActionMsg('★ Acción bonus activa — realiza una activación')
  }, [useSecondPlayerActionCP])

  const handlePassSecondPlayerAction = useCallback(() => {
    passSecondPlayerAction()
    setActionMsg(null)
  }, [passSecondPlayerAction])

  const handleSave = useCallback(() => {
    saveGame()
    setActionMsg('Partida guardada')
  }, [saveGame])

  const handleLoad = useCallback(() => {
    if (phase !== 'end' && !window.confirm('¿Cargar partida guardada? Se perderá el progreso actual.')) return
    const ok = loadGame()
    setActionMsg(ok ? 'Partida cargada' : 'No hay partida guardada')
  }, [phase, loadGame])

  const handleLoadGame = useCallback(() => {
    loadGame()
  }, [loadGame])

  const handleHexClick = useCallback((hexId: string) => {
    // ── Smoke targeting mode ─────────────────────────────────────────────────
    if (smokeMode && smokingUnit) {
      const res = tryFireSmoke(smokingUnit, hexId)
      setSmokeMode(false)
      setSmokingUnit(null)
      setActionMsg(res.ok ? `Humo colocado en ${hexId}` : (res.reason ?? 'No se puede disparar humo aquí'))
      return
    }

    // ── LOS check mode ──────────────────────────────────────────────────────
    if (losMode && scenario) {
      if (!losFrom || losTo) {
        // Primera selección (o reset)
        setLosFrom(hexId); setLosTo(null); setLosPath([]); setLosBlocked(false)
        setActionMsg('LOS: selecciona el hex de destino')
      } else {
        // Segunda selección → compute LOS
        const hexMap = buildHexMap(scenario.hexes)
        const fromHex = scenario.hexes.find(h => h.id === losFrom)
        const toHex   = scenario.hexes.find(h => h.id === hexId)
        if (fromHex && toHex) {
          const result = computeLOS(fromHex, toHex, hexMap)
          setLosTo(hexId)
          setLosPath(result.path.map(h => h.id))
          setLosBlocked(result.blocked)
          setActionMsg(result.blocked ? '⛔ LOS BLOQUEADA' : '✓ LOS DESPEJADA')
        }
      }
      return
    }

    // ── Setup: colocar unidad en hex ─────────────────────────────────────────
    if (phase === 'setup' && selectedUnit && units[selectedUnit]?.position === null) {
      const res = placeUnitInSetup(selectedUnit, hexId)
      if (res.ok) {
        selectUnit(null)
        setActionMsg(`Unidad colocada en ${hexId}`)
      } else {
        setActionMsg(res.reason ?? 'No se puede colocar aquí')
      }
      return
    }

    // ── Movimiento ───────────────────────────────────────────────────────────
    if (selectedUnit && phase === 'operations') {
      const unit = units[selectedUnit]
      const activeFaction = activeSide === 'allied' ? scenario?.allied.faction : scenario?.axis.faction
      if (unit && unit.faction === activeFaction && !unit.isUsed && !unit.isOpFire) {
        const res = tryMoveUnit(selectedUnit, hexId)
        if (res.ok) {
          const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2)
          setActionMsg(`→ ${hexId} · ${fmt(res.remainingMPs!)} MP restantes`)
          addLog({ side: activeSide, message: `${unit.unitTypeId} → ${hexId} (coste ${fmt(res.cost!)} MP, quedan ${fmt(res.remainingMPs!)})`, type: 'action' })
        } else if (res.mcFailed && res.canRerollMC) {
          setPendingMCReroll({ instanceId: selectedUnit, targetHexId: hexId })
          setActionMsg(res.reason ?? 'MC fallido')
        } else {
          setActionMsg(res.reason ?? 'Movimiento no válido')
        }
        return
      }
    }
    setActionMsg(null)
    selectHex(hexId === selectedHex ? null : hexId)
  }, [smokeMode, smokingUnit, tryFireSmoke, losMode, losFrom, losTo, scenario, selectedUnit, phase, units, activeSide, tryMoveUnit, addLog, selectHex, selectedHex, placeUnitInSetup, selectUnit, setPendingMCReroll])

  const handleUnitClick = useCallback((instanceId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    // ── Setup: click on placed unit → return to reserve ────────────────────
    if (phase === 'setup') {
      const unit = units[instanceId]
      const activeFaction = activeSide === 'allied' ? scenario?.allied.faction : scenario?.axis.faction
      if (unit && unit.faction === activeFaction && unit.position !== null) {
        removeUnitFromSetup(instanceId)
        selectUnit(null)
        setActionMsg('Unidad devuelta a reserva')
        return
      }
      // Off-board or enemy: just select/deselect
      setActionMsg(null)
      selectUnit(instanceId === selectedUnit ? null : instanceId)
      return
    }

    // ── Op Fire: clic en la unidad en movimiento con un firer seleccionado ──
    if (pendingOpFire && selectedUnit && pendingOpFire.eligibleFirers.includes(selectedUnit) && instanceId === pendingOpFire.movingUnitId) {
      const res = tryOpFireUnit(selectedUnit, instanceId, spendCP)
      if (res.ok) {
        setSpendCP(false)
        const outcome = res.result?.eliminated ? 'ELIMINADA'
          : res.result?.reduced ? 'REDUCIDA + SUPRIMIDA'
          : res.result?.suppressed ? 'SUPRIMIDA'
          : 'SIN EFECTO'
        const label = res.isFinal ? ' (Op Fire Final)' : ' (Op Fire)'
        setActionMsg(`Tirada ${res.result?.roll} vs FP ${res.result?.adjustedFP}${label} → ${outcome}`)
        selectUnit(null)
      } else {
        setActionMsg(res.reason ?? 'Op Fire no válido')
      }
      return
    }

    // If a friendly unit is selected and user clicks an enemy → fire
    if (selectedUnit && selectedUnit !== instanceId && phase === 'operations') {
      const attacker = units[selectedUnit]
      const target   = units[instanceId]
      if (attacker && target && attacker.faction !== target.faction) {
        const res = tryFireUnit(selectedUnit, instanceId, spendCP)
        if (res.ok && res.result) {
          setSpendCP(false)
          const outcome = res.result.eliminated ? 'ELIMINADA'
            : res.result.reduced ? 'REDUCIDA + SUPRIMIDA'
            : res.result.suppressed ? 'SUPRIMIDA'
            : 'SIN EFECTO'
          const modeLabel = res.mode === 'assault' ? ' [ASALTO FP*]' : ' [NORMAL FP]'
          setActionMsg(`Tirada ${res.result.roll} vs FP ${res.result.adjustedFP}${modeLabel} → ${outcome}`)
          selectUnit(null)
        } else {
          setActionMsg(res.reason ?? 'Disparo no válido')
        }
        return
      }
      // Activation lock: block selecting a different friendly unit while one is activating
      if (activatingUnit && activatingUnit !== instanceId) {
        const lockUnit = units[activatingUnit]
        if (attacker && lockUnit && attacker.faction === lockUnit.faction) {
          setActionMsg('Unidad en activación. Finaliza o deshaz el movimiento primero.')
          return
        }
      }
    }
    // Activation lock when no unit is selected
    if (!selectedUnit && activatingUnit && activatingUnit !== instanceId && phase === 'operations') {
      const clicked  = units[instanceId]
      const actUnit  = units[activatingUnit]
      if (clicked && actUnit && clicked.faction === actUnit.faction) {
        setActionMsg('Unidad en activación. Finaliza o deshaz el movimiento primero.')
        return
      }
    }
    setActionMsg(null)
    selectUnit(instanceId === selectedUnit ? null : instanceId)
  }, [selectedUnit, phase, units, activeSide, activatingUnit, scenario, pendingOpFire, tryFireUnit, tryOpFireUnit, spendCP, selectUnit, removeUnitFromSetup])

  const handleUndo = useCallback(() => {
    undoLastMove()
    setActionMsg('Movimiento deshecho')
  }, [undoLastMove])

  const handleUndoFire = useCallback(() => {
    undoLastFire()
    setActionMsg('Disparo deshecho')
  }, [undoLastFire])

  const handleOpFire = useCallback((id: string) => {
    if (id in unitMPs) {
      setActionMsg('No se puede marcar Op Fire: la unidad ya se ha movido')
      return
    }
    updateUnit(id, { isOpFire: true, isUsed: false })
  }, [unitMPs, updateUnit])

  const handleMarkUsed = useCallback((id: string) => {
    endUnitActivation(id)
  }, [endUnitActivation])

  const handleSpendCPToggle = useCallback(() => {
    setSpendCP(prev => !prev)
  }, [])

  const handleFireSmoke = useCallback((instanceId: string) => {
    setSmokeMode(true)
    setSmokingUnit(instanceId)
    setActionMsg('Selecciona el hex objetivo para el humo')
  }, [])

  const handleRoutUnit = useCallback((instanceId: string) => {
    const res = tryRoutUnit(instanceId)
    if (!res.ok) {
      setActionMsg(res.reason ?? 'Error en Rout')
    } else if (!res.mustRout) {
      setActionMsg('Aguanta: no está sujeta a Rout')
    } else if (res.eliminated) {
      setActionMsg('Eliminada durante Rout')
    } else {
      setActionMsg(`Rout → ${res.newHexId ?? 'eliminada'}`)
    }
  }, [tryRoutUnit])

  const handleResolveMelee = useCallback((hexId: string, spendCPAllied: boolean, spendCPAxis: boolean) => {
    const res = tryResolveMelee(hexId, spendCPAllied, spendCPAxis)
    setActionMsg(res.ok ? 'Melé resuelto' : (res.reason ?? 'Error en melé'))
  }, [tryResolveMelee])

  const handleUnitRightClick = useCallback((instanceId: string) => {
    const unit = units[instanceId]
    if (!unit || unit.isUsed) return
    // Durante Operations, los vehículos/cañones no pueden rotar manualmente:
    // la rotación es parte del movimiento y tiene coste en MPs (Regla 12.0).
    const cat = getUnitType(unit.unitTypeId)?.category
    if ((cat === 'vehicle' || cat === 'gun') && phase === 'operations') return
    const FACING_CW: Record<string, string> = {
      N: 'NE', NE: 'SE', SE: 'S', S: 'SW', SW: 'NW', NW: 'N',
    }
    const current = unit.facing ?? 'N'
    const next = FACING_CW[current] ?? 'N'
    updateUnit(instanceId, { facing: next as import('./types').HexSideFlat })
  }, [units, updateUnit, phase])

  const unitList = useMemo(() => Object.values(units), [units])

  const activeFaction = scenario
    ? (activeSide === 'allied' ? scenario.allied.faction : scenario.axis.faction)
    : null

  const offBoardUnits = useMemo(() => {
    if (phase !== 'setup' || !activeFaction) return []
    return Object.values(units).filter(u => u.faction === activeFaction && u.position === null)
  }, [phase, activeFaction, units])

  const unitTypes = useMemo(() => {
    const map: Record<string, { name: string; faction: string; category: string }> = {}
    unitList.forEach(u => {
      const ut = getUnitType(u.unitTypeId)
      map[u.unitTypeId] = {
        name:     ut?.name ?? u.unitTypeId,
        faction:  u.faction,
        category: ut?.category ?? 'squad',
      }
    })
    return map
  }, [unitList])

  const selectedUnitData   = selectedUnit ? units[selectedUnit] ?? null : null
  const selectedUnitMPs    = selectedUnit ? (unitMPs[selectedUnit] ?? null) : null
  const selectedHexData    = selectedHex
    ? scenario?.hexes.find(h => h.id === selectedHex) ?? null
    : null

  const activeSideConfig = scenario
    ? (activeSide === 'allied' ? scenario.allied : scenario.axis)
    : null

  if (!scenario) {
    return <ScenarioSelect onStart={handleStart} hasSave={hasSave()} onLoadGame={handleLoadGame} />
  }

  return (
    <div className="flex flex-col h-screen bg-app-bg text-parchment font-mono overflow-hidden">
      <PhaseBar
        currentTurn={currentTurn}
        maxTurns={maxTurns}
        phase={phase}
        activeSide={activeSide}
        opsUsed={opsUsed}
        opsMin={activeSideConfig?.opsRangeMin ?? 1}
        opsMax={activeSideConfig?.opsRangeMax ?? 2}
        commandPoints={commandPoints}
        isAIThinking={isAIThinking}
        onNextPhase={nextPhase}
        onEndTurn={nextPhase}
        onEndSideOps={endSideOperations}
        onSave={handleSave}
        onLoad={handleLoad}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden relative">
          <HexGrid
            hexes={scenario.hexes}
            orientation={scenario.orientation}
            units={unitList}
            unitTypes={unitTypes}
            selectedUnit={losMode ? null : selectedUnit}
            selectedHex={losMode ? null : selectedHex}
            controlHexes={hexControl}
            onHexClick={handleHexClick}
            onUnitClick={handleUnitClick}
            onUnitRightClick={handleUnitRightClick}
            losMode={losMode}
            losFrom={losFrom}
            losTo={losTo}
            losPath={losPath}
            losBlocked={losBlocked}
            smokeHexes={smokeHexes}
            smokeMode={smokeMode}
            setupHighlight={phase === 'setup' && scenario ? {
              splitCol: setupSplitCol,
              side: activeSide,
              maps: activeSide === 'allied' ? scenario.allied.setupMaps : scenario.axis.setupMaps,
              inverted: setupSplitInverted,
            } : null}
            opFireTargetHex={pendingOpFire?.enteredHexId ?? null}
            playerFaction={playerFaction}
          />
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <div className="bg-panel/80 border border-border-military rounded px-3 py-1 pointer-events-none">
              <div className="text-xs text-text-dim tracking-widest">
                ESCENARIO {scenario.num} — {scenario.title}
              </div>
            </div>
            <button
              onClick={toggleLosMode}
              className={`px-3 py-1 text-xs font-bold tracking-widest rounded border transition-colors ${
                losMode
                  ? 'bg-amber text-app-bg border-amber'
                  : 'bg-panel/80 border-border-military text-text-dim hover:text-parchment hover:border-brass'
              }`}
            >
              👁 LOS
            </button>
          </div>
          {/* ── Op Fire banner ─────────────────────────────────────────────── */}
          {pendingOpFire && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-panel-dark border-2 border-fire text-parchment rounded px-4 py-2 z-20 text-center"
              style={{ maxWidth: '70%' }}
            >
              <div className="text-xs font-bold tracking-widest text-amber mb-1">
                ⚡ OP FIRE DISPONIBLE ({pendingOpFire.eligibleFirers.length} unidad{pendingOpFire.eligibleFirers.length !== 1 ? 'es' : ''})
              </div>
              <div className="text-xs text-text-dim mb-2">
                Selecciona un tirador y haz clic en la unidad enemiga
              </div>
              <button
                onClick={handlePassOpFire}
                className="px-4 py-1 text-xs font-bold tracking-widest bg-panel border border-border-military rounded hover:border-brass hover:text-brass transition-colors"
              >
                PASAR
              </button>
            </div>
          )}

          {/* ── MC Re-roll banner ───────────────────────────────────────────── */}
          {pendingMCReroll && !pendingOpFire && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-panel-dark border-2 border-amber text-parchment rounded px-4 py-2 z-20 text-center"
              style={{ maxWidth: '70%' }}
            >
              <div className="text-xs font-bold tracking-widest text-amber mb-1">
                ★ MC FALLIDO — ¿Gastar 1 CP para repetir el chequeo?
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={handleConfirmMCReroll}
                  className="px-4 py-1 text-xs font-bold tracking-widest bg-amber text-app-bg rounded hover:bg-amber/80 transition-colors"
                >
                  SÍ (gastar CP)
                </button>
                <button
                  onClick={handleDeclineMCReroll}
                  className="px-4 py-1 text-xs font-bold tracking-widest bg-panel border border-border-military rounded hover:border-brass hover:text-brass transition-colors"
                >
                  NO
                </button>
              </div>
            </div>
          )}

          {/* ── Second Player Action banner ─────────────────────────────────── */}
          {secondPlayerActionPending && !pendingOpFire && !pendingMCReroll && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-panel-dark border-2 border-amber text-parchment rounded px-4 py-2 z-20 text-center"
              style={{ maxWidth: '70%' }}
            >
              <div className="text-xs font-bold tracking-widest text-amber mb-1">
                ★ ACCIÓN DEL 2° JUGADOR
              </div>
              <div className="text-xs text-text-dim mb-2">
                {activeSide === 'allied' ? 'Aliados' : 'Eje'} puede gastar 1 CP para actuar antes que {firstMoverSide === 'allied' ? 'Aliados' : 'Eje'}
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={handleUseSecondPlayerActionCP}
                  className="px-4 py-1 text-xs font-bold tracking-widest bg-amber text-app-bg rounded hover:bg-amber/80 transition-colors"
                >
                  GASTAR CP
                </button>
                <button
                  onClick={handlePassSecondPlayerAction}
                  className="px-4 py-1 text-xs font-bold tracking-widest bg-panel border border-border-military rounded hover:border-brass hover:text-brass transition-colors"
                >
                  PASAR
                </button>
              </div>
            </div>
          )}

          {actionMsg && (
            <div
              className={`absolute bottom-12 left-1/2 -translate-x-1/2 rounded px-4 py-2 text-xs font-bold tracking-wide pointer-events-none border ${
                actionMsg.startsWith('⛔')
                  ? 'bg-fire/90 border-fire text-parchment'
                  : actionMsg.startsWith('✓')
                  ? 'bg-green-900/90 border-green-600 text-green-300'
                  : 'bg-panel-dark/95 border-brass text-parchment'
              }`}
              style={{ maxWidth: '60%', textAlign: 'center' }}
            >
              {actionMsg}
            </div>
          )}
        </div>
        <div className="w-64 flex-shrink-0">
          <GamePanel
            scenario={scenario}
            hexControl={hexControl}
            selectedUnit={selectedUnitData}
            selectedHex={selectedHexData}
            unitTypeName={selectedUnitData?.unitTypeId ?? ''}
            remainingMPs={selectedUnitMPs}
            actionMsg={actionMsg}
            log={log}
            phase={phase}
            activeSide={activeSide}
            canUndo={lastMoveUndo !== null && selectedUnitData?.instanceId === lastMoveUndo?.instanceId}
            canUndoFire={lastFireUndo !== null && selectedUnitData?.instanceId === lastFireUndo?.attackerId}
            commandPoints={commandPoints}
            spendCP={spendCP}
            onUndoFire={handleUndoFire}
            onUseOpFire={handleOpFire}
            onMarkUsed={handleMarkUsed}
            onUndo={handleUndo}
            onSpendCPToggle={handleSpendCPToggle}
            onFireSmoke={handleFireSmoke}
            onRoutUnit={handleRoutUnit}
            onResolveMelee={handleResolveMelee}
            activatingUnit={activatingUnit}
            onSpendCPForMovement={spendCPForMovement}
            offBoardUnits={offBoardUnits}
            onSelectUnit={selectUnit}
            onCompleteSetup={handleCompleteSetup}
          />
        </div>
      </div>
    </div>
  )
}
