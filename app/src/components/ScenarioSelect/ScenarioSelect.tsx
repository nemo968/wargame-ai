import React, { useEffect, useState } from 'react'
import type { Scenario } from '../../types'
import { loadScenario, loadScenarioIndex } from '../../lib/scenarioParser'

interface ScenarioSelectProps {
  onStart: (scenario: Scenario, playerFaction: 'American' | 'German') => void
  hasSave:    boolean
  onLoadGame: () => void
}

export default function ScenarioSelect({ onStart, hasSave, onLoadGame }: ScenarioSelectProps) {
  const [scenarios, setScenarios]       = useState<{ num: string; title?: string }[]>([])
  const [selected, setSelected]         = useState<Scenario | null>(null)
  const [loading, setLoading]           = useState(false)
  const [playerFaction, setPlayerFaction] = useState<'American' | 'German'>('American')

  useEffect(() => {
    loadScenarioIndex().then(list => {
      setScenarios(list)
      if (list.length > 0) handleSelect(list[0].num)
    })
  }, [])

  const handleSelect = async (num: string) => {
    setLoading(true)
    try {
      const s = await loadScenario(num)
      setSelected(s)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-app-bg text-parchment font-mono flex flex-col overflow-hidden">

      {/* Header */}
      <div className="border-b border-border-military px-8 py-4 flex items-center gap-6 flex-shrink-0">
        <div>
          <div className="text-xs text-text-dim tracking-widest mb-0.5">OPERACIONES TÁCTICAS</div>
          <h1 className="text-xl font-bold tracking-widest text-brass">BAND OF BROTHERS</h1>
          <div className="text-xs text-text-dim tracking-wider">SCREAMING EAGLES — SERIE TÁCTICA HEXAGONAL</div>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-text-dim text-right">
          <div className="text-brass">101st AIRBORNE DIVISION</div>
          <div className="opacity-50">WWII TACTICAL WARGAME</div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Panel izquierdo: selección + bando + inicio ─────────────────── */}
        <div className="w-72 border-r border-border-military flex flex-col flex-shrink-0">

          {/* Continuar partida guardada */}
          {hasSave && (
            <div className="p-4 border-b border-border-military">
              <button
                onClick={onLoadGame}
                className="w-full py-2 bg-amber/20 text-amber font-bold tracking-widest text-xs rounded border border-amber/50 hover:bg-amber/30 transition-colors"
              >
                ★ CONTINUAR PARTIDA
              </button>
            </div>
          )}

          {/* Desplegable de escenario */}
          <div className="p-4 border-b border-border-military space-y-2">
            <div className="text-xs tracking-widest text-brass mb-1">ESCENARIO</div>
            <select
              className="w-full bg-panel-dark border border-border-military rounded px-3 py-2 text-sm text-parchment appearance-none cursor-pointer focus:outline-none focus:border-brass"
              value={selected?.num ?? ''}
              onChange={e => handleSelect(e.target.value)}
              disabled={loading}
            >
              {scenarios.map(s => (
                <option key={s.num} value={s.num}>
                  {s.num} — {s.title ?? `Escenario ${s.num}`}
                </option>
              ))}
            </select>
          </div>

          {/* Selección de bando */}
          <div className="p-4 border-b border-border-military space-y-2">
            <div className="text-xs tracking-widest text-brass mb-1">JUGAR COMO</div>
            {selected ? (
              <div className="flex gap-2">
                {([selected.allied.faction, selected.axis.faction] as ('American' | 'German')[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setPlayerFaction(f)}
                    className={`flex-1 py-2 rounded border text-xs font-bold tracking-wider transition-all ${
                      playerFaction === f
                        ? f === 'American'
                          ? 'bg-allied border-allied text-app-bg'
                          : 'bg-axis border-axis text-parchment'
                        : 'border-border-military text-text-dim hover:text-parchment hover:border-brass/50'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-text-dim">Selecciona un escenario</div>
            )}
          </div>

          {/* Botón iniciar */}
          <div className="p-4">
            <button
              disabled={!selected || loading}
              onClick={() => selected && onStart(selected, playerFaction)}
              className="w-full py-3 bg-brass text-app-bg font-bold tracking-widest text-sm rounded hover:bg-brass/90 transition-colors border border-brass/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ★ INICIAR OPERACIÓN ★
            </button>
          </div>

          {/* Relleno */}
          <div className="flex-1" />
        </div>

        {/* ── Panel derecho: toda la info del escenario ───────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {loading && (
            <div className="flex-1 flex items-center justify-center text-brass animate-pulse tracking-widest">
              CARGANDO ESCENARIO…
            </div>
          )}

          {!loading && !selected && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center opacity-30">
                <div className="text-6xl mb-4">⬡</div>
                <div className="text-xs tracking-widest">SELECCIONA UN ESCENARIO</div>
              </div>
            </div>
          )}

          {!loading && selected && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-4xl space-y-6">

                {/* Título */}
                <div>
                  <div className="text-xs text-text-dim tracking-widest">ESCENARIO {selected.num}</div>
                  <h2 className="text-3xl font-bold text-brass mt-1">{selected.title}</h2>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'TURNOS',   value: selected.turns },
                    { label: 'HEXES',    value: selected.hexes.length },
                    { label: 'MUEVE 1°', value: selected.movesFirst },
                    { label: 'MAPA',     value: selected.orientation === 'flat-top' ? 'NORMAL' : 'GIRADO 90°' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-panel border border-border-military rounded p-3">
                      <div className="text-xs text-text-dim tracking-wider">{label}</div>
                      <div className="text-base font-bold text-parchment mt-1">{value}</div>
                    </div>
                  ))}
                </div>

                {/* Descripción + Victoria en dos columnas */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-brass tracking-widest mb-2">SITUACIÓN TÁCTICA</div>
                    <div className="text-xs text-text-dim leading-relaxed bg-panel border border-border-military rounded p-4 h-full">
                      {selected.description}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-brass tracking-widest mb-2">CONDICIÓN DE VICTORIA</div>
                    <div className="text-sm text-parchment bg-panel border border-brass/30 rounded p-4 h-full">
                      {selected.victory}
                    </div>
                  </div>
                </div>

                {/* Bandos */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'allied', config: selected.allied, units: selected.alliedUnits },
                    { key: 'axis',   config: selected.axis,   units: selected.axisUnits   },
                  ].map(({ key, config, units }) => (
                    <div key={key}
                      className={`bg-panel border rounded p-4 ${key === 'allied' ? 'border-allied/40' : 'border-axis/40'}`}
                    >
                      <div className={`text-sm font-bold tracking-wider mb-3 ${key === 'allied' ? 'text-allied' : 'text-axis'}`}>
                        {config.faction.toUpperCase()}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                        <div className="bg-panel-dark rounded p-2">
                          <div className="text-text-dim">OPS</div>
                          <div className="font-bold">{config.opsRangeMin}–{config.opsRangeMax}</div>
                        </div>
                        <div className="bg-panel-dark rounded p-2">
                          <div className="text-text-dim">CPs</div>
                          <div className="font-bold">{config.commandPoints}</div>
                        </div>
                        <div className="bg-panel-dark rounded p-2">
                          <div className="text-text-dim">HUIDA</div>
                          <div className="font-bold">{config.routEdge}</div>
                        </div>
                      </div>
                      <div className="text-xs text-text-dim leading-relaxed mb-3">
                        {config.setupDesc}
                      </div>
                      <div className="text-xs text-text-dim space-y-0.5 border-t border-border-military/40 pt-2">
                        {units.map((u, i) => (
                          <div key={i} className="flex justify-between">
                            <span>{u.type}</span>
                            <span className="text-parchment font-bold">×{u.inScenario}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
