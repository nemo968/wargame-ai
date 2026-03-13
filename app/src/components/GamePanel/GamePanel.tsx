import React, { useState } from 'react'
import type { UnitInstance, LogEntry, GamePhase, ActiveSide, HexData, Scenario, Faction } from '../../types'
import { getActiveInfantryStats, movementAllowance, getUnitType } from '../../engine/mechanics'

interface GamePanelProps {
  scenario:       Scenario | null
  hexControl:     Record<string, Faction>
  selectedUnit:   UnitInstance | null
  selectedHex:    HexData | null
  unitTypeName:   string
  remainingMPs:   number | null
  actionMsg:      string | null
  log:            LogEntry[]
  phase:          GamePhase
  activeSide:     ActiveSide
  canUndo:        boolean
  canUndoFire:    boolean
  commandPoints:  { allied: number; axis: number }
  spendCP:        boolean
  onUseOpFire:    (id: string) => void
  onMarkUsed:     (id: string) => void
  onUndo:         () => void
  onUndoFire:     () => void
  onSpendCPToggle: () => void
  onFireSmoke:    (id: string) => void
  onRoutUnit:     (id: string) => void
  onResolveMelee: (hexId: string, spendCPAllied: boolean, spendCPAxis: boolean) => void
  activatingUnit?: string | null
  onSpendCPForMovement?: (id: string) => void
  // Setup interactivo
  offBoardUnits?:    UnitInstance[]
  onSelectUnit?:     (id: string | null) => void
  onCompleteSetup?:  () => void
}

type Tab = 'info' | 'log' | 'scenario'

export default function GamePanel({
  scenario, hexControl,
  selectedUnit, selectedHex, unitTypeName,
  remainingMPs, actionMsg,
  log, phase, activeSide,
  canUndo, canUndoFire,
  commandPoints, spendCP,
  onUseOpFire, onMarkUsed, onUndo, onUndoFire,
  onSpendCPToggle, onFireSmoke, onRoutUnit, onResolveMelee,
  activatingUnit,
  onSpendCPForMovement,
  offBoardUnits = [],
  onSelectUnit,
  onCompleteSetup,
}: GamePanelProps) {
  const [tab, setTab] = useState<Tab>('info')

  return (
    <div className="flex flex-col h-full bg-panel border-l border-border-military text-parchment font-mono text-sm">

      {/* Tabs */}
      <div className="flex border-b border-border-military">
        {(['info', 'log', 'scenario'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs tracking-widest uppercase transition-colors ${
              tab === t
                ? 'bg-panel-dark text-brass border-b-2 border-brass'
                : 'text-text-dim hover:text-parchment'
            }`}
          >
            {t === 'info' ? 'INFO' : t === 'log' ? 'REGISTRO' : 'ESCENARIO'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* ── TAB INFO ─────────────────────────────────────────────────── */}
        {tab === 'info' && (
          <>
            {actionMsg && (
              <div className="text-xs bg-panel-dark border border-brass rounded px-2 py-1 text-amber">
                {actionMsg}
              </div>
            )}

            {/* ── SETUP PANEL ───────────────────────────────────────────── */}
            {phase === 'setup' ? (
              <SetupPanel
                offBoardUnits={offBoardUnits}
                selectedUnitId={selectedUnit?.instanceId ?? null}
                activeSide={activeSide}
                onSelectUnit={onSelectUnit}
                onCompleteSetup={onCompleteSetup}
              />
            ) : selectedUnit ? (
              <UnitInfo unit={selectedUnit} typeName={unitTypeName}
                remainingMPs={remainingMPs}
                canUndo={canUndo} canUndoFire={canUndoFire}
                commandPoints={commandPoints} spendCP={spendCP}
                onUseOpFire={onUseOpFire} onMarkUsed={onMarkUsed} onUndo={onUndo} onUndoFire={onUndoFire}
                onSpendCPToggle={onSpendCPToggle} onFireSmoke={onFireSmoke} onRoutUnit={onRoutUnit}
                phase={phase} activeSide={activeSide}
                activatingUnit={activatingUnit ?? null}
                onSpendCPForMovement={onSpendCPForMovement}
              />
            ) : selectedHex && phase === 'melee' ? (
              <MeleePanel
                hex={selectedHex} activeSide={activeSide} commandPoints={commandPoints}
                onResolveMelee={onResolveMelee}
              />
            ) : selectedHex ? (
              <HexInfo hex={selectedHex} />
            ) : (
              <div className="text-text-dim text-center py-8 text-xs tracking-wider">
                SELECCIONA UNA UNIDAD O HEXÁGONO
              </div>
            )}
          </>
        )}

        {/* ── TAB LOG ──────────────────────────────────────────────────── */}
        {tab === 'log' && (
          <div className="space-y-1">
            {log.length === 0 && (
              <div className="text-text-dim text-center py-8 text-xs">Sin entradas</div>
            )}
            {[...log].reverse().map((entry, i) => (
              <div key={i}
                className={`text-xs border-l-2 pl-2 py-0.5 ${
                  entry.type === 'combat'  ? 'border-fire text-parchment' :
                  entry.type === 'morale'  ? 'border-amber text-amber' :
                  entry.type === 'phase'   ? 'border-brass text-brass' :
                  'border-border-military text-text-dim'
                }`}
              >
                <span className="text-text-dim mr-1">T{entry.turn}</span>
                {entry.message}
              </div>
            ))}
          </div>
        )}

        {/* ── TAB ESCENARIO ─────────────────────────────────────────────── */}
        {tab === 'scenario' && scenario && (
          <div className="space-y-3">
            <div>
              <div className="text-brass text-xs tracking-widest mb-1">OBJETIVO</div>
              <div className="text-xs text-parchment leading-relaxed bg-panel-dark p-2 rounded border border-border-military">
                {scenario.victory}
              </div>
            </div>

            {/* ── Sección fin de partida ───────────────────────────────── */}
            {phase === 'end' && (() => {
              // Agrupar hexes controlados por facción
              const byFaction: Record<string, string[]> = {}
              for (const [hexId, faction] of Object.entries(hexControl)) {
                ;(byFaction[faction] ??= []).push(hexId)
              }
              const alliedFaction = scenario.allied.faction
              const axisFaction   = scenario.axis.faction
              return (
                <div className="border border-brass rounded p-3 bg-panel-dark">
                  <div className="text-brass text-xs tracking-widest mb-2 text-center animate-pulse">
                    ★ FIN DE PARTIDA ★
                  </div>
                  <div className="text-xs text-parchment mb-3 leading-relaxed">
                    Verifica las condiciones de victoria y declara al ganador.
                  </div>
                  <div className="text-brass text-xs tracking-widest mb-1">HEXES CONTROLADOS</div>
                  {([alliedFaction, axisFaction] as Faction[]).map(faction => {
                    const hexIds = byFaction[faction] ?? []
                    return (
                      <div key={faction} className="text-xs mb-1">
                        <span className={faction === alliedFaction ? 'text-allied font-bold' : 'text-axis font-bold'}>
                          {faction}
                        </span>
                        <span className="text-text-dim">
                          {hexIds.length > 0 ? `: ${hexIds.join(', ')}` : ': ninguno'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="TURNOS"    value={`${scenario.turns}`} />
              <Stat label="MUEVE 1°"  value={scenario.movesFirst} />
              <Stat label="ALIADOS"   value={`${scenario.allied.opsRangeMin}-${scenario.allied.opsRangeMax} ops`} />
              <Stat label="EJE"       value={`${scenario.axis.opsRangeMin}-${scenario.axis.opsRangeMax} ops`} />
            </div>
            <div>
              <div className="text-brass text-xs tracking-widest mb-1">DESPLIEGUE ALIADOS</div>
              <div className="text-xs text-text-dim leading-relaxed">{scenario.allied.setupDesc}</div>
            </div>
            <div>
              <div className="text-brass text-xs tracking-widest mb-1">DESPLIEGUE EJE</div>
              <div className="text-xs text-text-dim leading-relaxed">{scenario.axis.setupDesc}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel-dark p-2 rounded border border-border-military">
      <div className="text-text-dim text-xs">{label}</div>
      <div className="text-parchment font-bold">{value}</div>
    </div>
  )
}

function HexInfo({ hex }: { hex: HexData }) {
  const hasHedge = Object.values(hex.sides).some(Boolean)
  const hedgeSides = Object.entries(hex.sides)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ')

  return (
    <div className="space-y-2">
      <div className="text-brass text-xs tracking-widest">HEXÁGONO</div>
      <div className="text-lg font-bold">{hex.origCoord}</div>
      <div className="text-xs text-text-dim">Tablero {hex.origMap}</div>
      <div className="space-y-1 text-xs">
        <Stat label="TERRENO"    value={hex.terrain} />
        <Stat label="ELEVACIÓN"  value={String(hex.elevation)} />
        {hex.fortification !== 'NINGUNA' && (
          <Stat label="FORTIF." value={hex.fortification} />
        )}
        {hasHedge && (
          <Stat label="SETOS" value={hedgeSides} />
        )}
      </div>
    </div>
  )
}

function UnitInfo({ unit, typeName, remainingMPs, canUndo, canUndoFire, commandPoints, spendCP, onUseOpFire, onMarkUsed, onUndo, onUndoFire, onSpendCPToggle, onFireSmoke, onRoutUnit, phase, activeSide, activatingUnit, onSpendCPForMovement }: {
  unit:            UnitInstance
  typeName:        string
  remainingMPs:    number | null
  canUndo:         boolean
  canUndoFire:     boolean
  commandPoints:   { allied: number; axis: number }
  spendCP:         boolean
  onUseOpFire:     (id: string) => void
  onMarkUsed:      (id: string) => void
  onUndo:          () => void
  onUndoFire:      () => void
  onSpendCPToggle: () => void
  onFireSmoke:     (id: string) => void
  onRoutUnit:      (id: string) => void
  phase:           GamePhase
  activeSide:      ActiveSide
  activatingUnit:  string | null
  onSpendCPForMovement?: (id: string) => void
}) {
  const supLabel = ['FRESCA', 'SUPRIMIDA', 'TOT. SUPRIMIDA'][unit.suppression]
  const supColor = ['text-green-400', 'text-amber', 'text-fire'][unit.suppression]
  const isMyTurn = phase === 'operations'
  const isRout   = phase === 'rout'

  // Auto-determine fire mode based on movement state
  const hasMoved = remainingMPs !== null
  const unitCat  = getUnitType(unit.unitTypeId)?.category
  const canAssaultFire = unitCat === 'squad'
  const fireLabel = hasMoved
    ? (canAssaultFire ? 'ASALTO (FP*)' : 'NO PUEDE DISPARAR')
    : 'NORMAL (FP)'
  const fireLabelColor = hasMoved
    ? (canAssaultFire ? 'text-amber' : 'text-fire')
    : 'text-green-400'

  // Engine stats
  const stats    = getActiveInfantryStats(unit.unitTypeId, unit.isReduced)
  const totalMPs = movementAllowance(unit.unitTypeId)
  const mpsLeft  = remainingMPs ?? totalMPs
  const isMortar = stats?.isMortar ?? false
  const myCPs    = commandPoints[activeSide]
  const isInfantry = unitCat === 'squad' || unitCat === 'wt_mg' || unitCat === 'wt_mortar'
  const canFollowMe = isMyTurn && !unit.isUsed && isInfantry && myCPs > 0 && activatingUnit === unit.instanceId

  return (
    <div className="space-y-2">
      <div className="text-brass text-xs tracking-widest">UNIDAD</div>
      <div className="text-sm font-bold leading-tight">{typeName}</div>
      <div className="text-xs text-text-dim capitalize">{unit.faction}</div>

      <div className="grid grid-cols-2 gap-1 text-xs">
        <Stat label="ESTADO"    value={unit.isReduced ? 'REDUCIDA' : 'COMPLETA'} />
        <Stat label="MORAL"     value={supLabel} />
        <Stat label="POSICIÓN"  value={unit.position ?? 'Reserva'} />
        <Stat label="MPs"       value={`${Number.isInteger(mpsLeft) ? mpsLeft : mpsLeft.toFixed(2)} / ${totalMPs}`} />
      </div>

      {/* Stats del engine */}
      {stats && (
        <div className="space-y-1">
          <div className="text-brass text-xs tracking-widest">ESTADÍSTICAS</div>
          <div className="grid grid-cols-3 gap-1 text-xs">
            <Stat label="FP"     value={`${stats.normalFP}`} />
            <Stat label="FP*"    value={`${stats.profFP}`} />
            <Stat label="ALCANCE" value={stats.rangeMax ? `${stats.rangeMin}-${stats.rangeMax}` : `${stats.rangeMin}+`} />
            <Stat label="MOR↑"   value={`${stats.moraleFresh}`} />
            <Stat label="MOR~"   value={`${stats.moraleSup}`} />
            <Stat label="MOR↓"   value={`${stats.moraleFull}`} />
          </div>
        </div>
      )}

      {/* Badges de estado */}
      <div className="flex flex-wrap gap-1">
        {unit.isConcealed && <Badge color="bg-green-800" label="OCULTA" />}
        {unit.isOpFire    && <Badge color="bg-fire"     label="OP FIRE" />}
        {unit.isUsed      && <Badge color="bg-gray-700" label="USADA" />}
        {unit.hasFlank    && <Badge color="bg-amber"    label="FLANCO" />}
        {unit.isReduced   && <Badge color="bg-fire/50"  label="REDUCIDA" />}
        <span className={`text-xs ${supColor}`}>{supLabel}</span>
      </div>

      {/* Hint de interacción */}
      {isMyTurn && !unit.isUsed && !unit.isOpFire && (
        <div className="text-xs text-text-dim bg-panel-dark rounded px-2 py-1 border border-border-military">
          Clic en hex → mover · Clic en enemigo → disparar
          {' '}<span className={`font-bold ${fireLabelColor}`}>{fireLabel}</span>
        </div>
      )}

      {/* Botón deshacer disparo — visible aunque la unidad esté usada */}
      {isMyTurn && canUndoFire && (
        <button
          className="w-full text-xs py-1 rounded border border-fire text-fire bg-transparent hover:bg-fire/10 font-bold tracking-widest transition-colors"
          onClick={onUndoFire}
        >
          ↩ DESHACER DISPARO
        </button>
      )}

      {/* Botón CP toggle — en operaciones, unidad no usada */}
      {isMyTurn && !unit.isUsed && myCPs > 0 && (
        <button
          className={`w-full text-xs py-1 rounded border font-bold tracking-widest transition-colors ${
            spendCP
              ? 'bg-amber text-app-bg border-amber'
              : 'bg-transparent border-amber text-amber hover:bg-amber/10'
          }`}
          onClick={onSpendCPToggle}
        >
          {spendCP ? '★ CP ACTIVADO (+1 FP)' : '☆ GASTAR CP (+1 FP)'}
        </button>
      )}

      {/* Botón Follow Me (+1 MP) — infantería en movimiento activo, con CPs */}
      {canFollowMe && onSpendCPForMovement && (
        <button
          className="w-full text-xs py-1 rounded border border-amber text-amber bg-transparent hover:bg-amber/10 font-bold tracking-widest transition-colors"
          onClick={() => onSpendCPForMovement(unit.instanceId)}
        >
          ★ FOLLOW ME +1 MP (CP)
        </button>
      )}

      {/* Botón disparar humo — solo morteros, no usados */}
      {isMyTurn && isMortar && !unit.isUsed && (
        <button
          className="btn-military w-full text-xs py-1"
          onClick={() => onFireSmoke(unit.instanceId)}
        >
          DISPARAR HUMO
        </button>
      )}

      {/* Acciones */}
      {isMyTurn && !unit.isUsed && (
        <div className="space-y-1 pt-1">
          <div className="text-brass text-xs tracking-widest mb-1">ACCIONES</div>

          {!unit.isOpFire && (
            <button
              className="btn-military w-full text-xs py-1"
              onClick={() => onUseOpFire(unit.instanceId)}
            >
              MARCAR OP FIRE
            </button>
          )}
          {canUndo && (
            <button
              className="w-full text-xs py-1 rounded border border-amber text-amber bg-transparent hover:bg-amber/10 font-bold tracking-widest transition-colors"
              onClick={onUndo}
            >
              ↩ DESHACER MOVIMIENTO
            </button>
          )}
          <button
            className="btn-military w-full text-xs py-1 opacity-70"
            onClick={() => onMarkUsed(unit.instanceId)}
          >
            FIN ACTIVACIÓN
          </button>
        </div>
      )}

      {/* Fase Rout: botón resolver */}
      {isRout && (
        <div className="space-y-1 pt-1">
          <div className="text-brass text-xs tracking-widest mb-1">FASE ROUT</div>
          <button
            className="btn-military w-full text-xs py-1"
            onClick={() => onRoutUnit(unit.instanceId)}
          >
            RESOLVER ROUT
          </button>
        </div>
      )}
    </div>
  )
}

function MeleePanel({ hex, activeSide, commandPoints, onResolveMelee }: {
  hex:            HexData
  activeSide:     ActiveSide
  commandPoints:  { allied: number; axis: number }
  onResolveMelee: (hexId: string, spendCPAllied: boolean, spendCPAxis: boolean) => void
}) {
  const [spendA, setSpendA] = useState(false)
  const [spendX, setSpendX] = useState(false)
  void activeSide

  return (
    <div className="space-y-2">
      <div className="text-brass text-xs tracking-widest">FASE MELÉ — {hex.origCoord}</div>
      <div className="text-xs text-text-dim">Selecciona opciones y resuelve el melé en este hex.</div>
      {commandPoints.allied > 0 && (
        <button
          className={`w-full text-xs py-1 rounded border font-bold tracking-widest transition-colors ${
            spendA ? 'bg-allied text-app-bg border-allied' : 'bg-transparent border-allied text-allied hover:bg-allied/10'
          }`}
          onClick={() => setSpendA(p => !p)}
        >
          {spendA ? '★' : '☆'} ALIADOS GASTAN CP
        </button>
      )}
      {commandPoints.axis > 0 && (
        <button
          className={`w-full text-xs py-1 rounded border font-bold tracking-widest transition-colors ${
            spendX ? 'bg-axis text-app-bg border-axis' : 'bg-transparent border-axis text-axis hover:bg-axis/10'
          }`}
          onClick={() => setSpendX(p => !p)}
        >
          {spendX ? '★' : '☆'} EJE GASTA CP
        </button>
      )}
      <button
        className="btn-military w-full text-xs py-2 font-bold"
        onClick={() => onResolveMelee(hex.id, spendA, spendX)}
      >
        RESOLVER MELÉ
      </button>
    </div>
  )
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span className={`${color} text-parchment text-xs px-2 py-0.5 rounded font-bold tracking-wider`}>
      {label}
    </span>
  )
}

// ─── Setup Panel ─────────────────────────────────────────────────────────────

function SetupPanel({
  offBoardUnits,
  selectedUnitId,
  activeSide,
  onSelectUnit,
  onCompleteSetup,
}: {
  offBoardUnits:    UnitInstance[]
  selectedUnitId:   string | null
  activeSide:       ActiveSide
  onSelectUnit?:    (id: string | null) => void
  onCompleteSetup?: () => void
}) {
  const sideLabel = activeSide === 'allied' ? 'ALIADOS' : 'EJE'

  return (
    <div className="space-y-3">
      <div>
        <div className="text-brass text-xs tracking-widest mb-1">DESPLIEGUE — {sideLabel}</div>
        <div className="text-xs text-text-dim leading-relaxed">
          Selecciona una unidad y haz clic en un hexágono de tu zona (resaltada en verde).
        </div>
      </div>

      {offBoardUnits.length === 0 ? (
        <div className="text-xs text-amber text-center py-2">
          Todas las unidades desplegadas
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-xs text-text-dim tracking-wider mb-1">
            SIN COLOCAR ({offBoardUnits.length})
          </div>
          {offBoardUnits.map(u => {
            const isSelected = u.instanceId === selectedUnitId
            return (
              <button
                key={u.instanceId}
                onClick={() => onSelectUnit?.(isSelected ? null : u.instanceId)}
                className={`w-full text-left text-xs px-2 py-1.5 rounded border transition-colors ${
                  isSelected
                    ? 'bg-brass/30 border-brass text-parchment'
                    : 'bg-panel-dark border-border-military text-text-dim hover:text-parchment hover:border-brass/50'
                }`}
              >
                <span className="font-bold">{u.unitTypeId}</span>
                {u.isReduced && <span className="ml-1 text-fire">[R]</span>}
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={onCompleteSetup}
        className="w-full py-2 bg-brass text-app-bg font-bold tracking-widest text-xs rounded hover:bg-brass/90"
      >
        COMPLETAR DESPLIEGUE ▶
      </button>
    </div>
  )
}
