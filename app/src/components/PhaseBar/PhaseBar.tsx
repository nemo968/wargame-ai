import React from 'react'
import type { GamePhase, ActiveSide } from '../../types'

interface PhaseBarProps {
  currentTurn:      number
  maxTurns:         number
  phase:            GamePhase
  activeSide:       ActiveSide
  opsUsed:          number
  opsMin:           number
  opsMax:           number
  commandPoints:    Record<ActiveSide, number>
  isAIThinking:     boolean
  routActiveSide:   ActiveSide | null
  onNextPhase:      () => void
  onEndTurn:        () => void
  onEndSideOps:     () => void
  onEndSideRout:    () => void
  onSave:           () => void
  onLoad:           () => void
}

const PHASES: { key: GamePhase; label: string; short: string }[] = [
  { key: 'operations', label: 'OPERACIONES',  short: 'OPS' },
  { key: 'rout',       label: 'HUIDA',        short: 'HUI' },
  { key: 'melee',      label: 'MELÉ',         short: 'MEL' },
  { key: 'recovery',   label: 'RECUPERACIÓN', short: 'REC' },
]

export default function PhaseBar({
  currentTurn, maxTurns, phase, activeSide,
  opsUsed, opsMin, opsMax,
  commandPoints, isAIThinking,
  routActiveSide,
  onNextPhase, onEndSideOps, onEndSideRout, onSave, onLoad,
}: PhaseBarProps) {
  const sideLabel = activeSide === 'allied' ? 'ALIADOS' : 'EJE'
  const sideColor = activeSide === 'allied' ? '#4a7c59' : '#6b7355'
  const canEndOps = opsUsed >= opsMin

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-border-military text-parchment font-mono text-sm">

      {/* Turno */}
      <div className="flex items-center gap-1 min-w-[100px]">
        <span className="text-brass text-xs uppercase tracking-widest">TURNO</span>
        <span className="text-lg font-bold text-parchment">{currentTurn}</span>
        <span className="text-text-dim">/{maxTurns}</span>
      </div>

      {/* Fases */}
      <div className="flex gap-1">
        {PHASES.map(p => {
          const isActive  = phase === p.key
          const isPast    = PHASES.findIndex(x => x.key === phase) > PHASES.findIndex(x => x.key === p.key)
          return (
            <div
              key={p.key}
              className={`px-3 py-1 rounded text-xs font-bold tracking-wider border transition-all ${
                isActive
                  ? 'bg-brass text-app-bg border-brass'
                  : isPast
                  ? 'bg-transparent text-text-dim border-border-military opacity-50'
                  : 'bg-transparent text-text-dim border-border-military opacity-30'
              }`}
            >
              {p.short}
            </div>
          )
        })}
      </div>

      {/* Bando activo */}
      <div className="flex items-center gap-2 min-w-[100px]">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sideColor }} />
        <span className="font-bold tracking-wider" style={{ color: sideColor }}>
          {sideLabel}
        </span>
      </div>

      {/* Ops range */}
      {phase === 'operations' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-text-dim text-xs">OPS</span>
            <div className="flex gap-1">
              {Array.from({ length: opsMax }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-sm border text-xs flex items-center justify-center ${
                    i < opsUsed
                      ? 'bg-brass border-brass text-app-bg'
                      : i < opsMin
                      ? 'border-amber text-amber'
                      : 'border-border-military text-text-dim'
                  }`}
                >
                  {i < opsUsed ? '✓' : ''}
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onEndSideOps}
            disabled={!canEndOps || isAIThinking}
            className={`px-3 py-1 text-xs font-bold tracking-widest rounded border transition-all ${
              canEndOps
                ? 'bg-brass text-app-bg border-brass hover:bg-brass/80'
                : 'border-border-military text-text-dim opacity-40 cursor-not-allowed'
            }`}
          >
            FIN OPS ▶
          </button>
        </div>
      )}

      {/* Command Points */}
      <div className="flex gap-4">
        {(['allied', 'axis'] as ActiveSide[]).map(side => (
          <div key={side} className="flex items-center gap-1">
            <span className="text-text-dim text-xs">{side === 'allied' ? 'ALI' : 'EJE'}</span>
            <div className="flex gap-0.5">
              {Array.from({ length: Math.max(commandPoints[side], 0) }).map((_, i) => (
                <div key={i}
                  className={`w-3 h-3 rounded-full border ${
                    side === activeSide
                      ? 'border-brass bg-brass'
                      : 'border-border-military bg-transparent'
                  }`}
                />
              ))}
              {commandPoints[side] === 0 && (
                <span className="text-text-dim text-xs">–</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Botones Guardar / Cargar */}
      {phase !== 'setup' && (
        <div className="flex gap-1">
          <button
            onClick={onSave}
            className="px-2 py-1 text-xs font-bold tracking-widest rounded border border-border-military text-text-dim hover:border-brass hover:text-brass transition-colors"
            title="Guardar partida"
          >
            GUARDAR
          </button>
          <button
            onClick={onLoad}
            className="px-2 py-1 text-xs font-bold tracking-widest rounded border border-border-military text-text-dim hover:border-amber hover:text-amber transition-colors"
            title="Cargar partida guardada"
          >
            CARGAR
          </button>
        </div>
      )}

      {/* AI indicator */}
      {isAIThinking && (
        <div className="flex items-center gap-2 text-amber animate-pulse">
          <div className="w-2 h-2 rounded-full bg-amber" />
          <span className="text-xs tracking-wider">IA PENSANDO…</span>
        </div>
      )}

      {/* Rout Phase: muestra bando activo y botón FIN ROUT */}
      {phase === 'rout' && !isAIThinking && (
        <div className="flex items-center gap-3">
          {routActiveSide && (
            <span className="text-xs text-amber font-bold tracking-wider">
              ROUT: {routActiveSide === 'allied' ? 'ALIADOS' : 'EJE'}
            </span>
          )}
          <button
            onClick={onEndSideRout}
            className="px-3 py-1 text-xs font-bold tracking-widest rounded border bg-brass text-app-bg border-brass hover:bg-brass/80"
          >
            FIN ROUT ▶
          </button>
        </div>
      )}

      {/* Botón siguiente fase (no durante Operations ni Rout, lo gestionan FIN OPS / FIN ROUT) */}
      {phase !== 'setup' && phase !== 'end' && phase !== 'operations' && phase !== 'rout' && !isAIThinking && (
        <button
          onClick={onNextPhase}
          className="btn-military px-4 py-1 text-xs tracking-widest"
        >
          {phase === 'recovery' ? 'SIGUIENTE TURNO ▶' : 'SIGUIENTE FASE ▶'}
        </button>
      )}

      {phase === 'end' && (
        <div className="text-brass font-bold tracking-widest animate-pulse">
          ★ FIN DE PARTIDA ★
        </div>
      )}
    </div>
  )
}
