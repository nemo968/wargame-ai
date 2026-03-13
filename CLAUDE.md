# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `app/`:

```bash
npm run dev      # Dev server (Vite HMR)
npm run build    # Type-check (tsc -b) + production build
npm run lint     # ESLint
npm run preview  # Preview the production build
```

There are no automated tests. Type-checking via `tsc -b` is the primary correctness check — always verify a clean build after changes.

## Project Overview

A digital adaptation of **Band of Brothers: Screaming Eagles v2.3** — a WWII hex-based tactical wargame. The implementation follows the board game rules closely; consult `docs/Reglamento.pdf` and `docs/Hoja de ayuda.pdf` (Player Aid Card) whenever implementing or debugging game mechanics.

## Architecture

### Data flow

```
scenarios/*.csv  →  scenarioParser.ts  →  Scenario type  →  gameStore  →  components
docs/SE_Units.csv →  unitTypes.ts (manual)  →  engine functions
mallas/*.csv     →  tools/herramienta_mapas (Python, offline)  →  mallas/*.csv
```

Scenario CSVs are served as static assets from `app/public/`. The `scenarios.json` index must be updated manually when adding new scenarios.

### Separation of concerns: engine vs. store vs. UI

- **`src/engine/mechanics/`** — Pure functions with no side effects. They compute results (fire, movement, morale checks, etc.) but never mutate state. Import from `engine/mechanics/index.ts`.
- **`src/store/gameStore.ts`** — Single Zustand store. All game state lives here. Components call store actions; actions call engine functions and apply results via `updateUnit`, `moveUnit`, `removeUnit`, etc.
- **`src/components/`** — Presentational. Components receive state from `useGameStore()` and dispatch actions. No game logic inside components.

### Key types (`src/types/index.ts`)

- **`UnitType`** — Static definition from `SE_Units.csv` (FP, Casualty, Morale values). Looked up by `unitTypeId`.
- **`UnitInstance`** — Runtime state of one counter on the board (`suppression`, `isUsed`, `isOpFire`, `isReduced`, `position`, etc.). `instanceId` is unique per game; `unitTypeId` is the key into `unitTypes.ts`.
- **`HexData`** — Parsed hex from the scenario CSV. `id` = `"${origMap}${origCoord}"` (e.g. `"5E5"`). Grid position is `col`/`row` (integers). `sides` holds hedgerow presence per side.
- **`Scenario`** — Fully parsed scenario including all `HexData[]`, unit lists, side configs, and orientation.
- **`GamePhase`**: `'setup' | 'operations' | 'rout' | 'melee' | 'recovery' | 'end'`
- **`ActiveSide`**: `'allied' | 'axis'`

### Hex coordinate system

Maps use **flat-top** orientation by default; some rotated scenarios use **pointy-top**. The `col`/`row` integers in `HexData` are the assembled grid coordinates (not the letter-based originals). `hexGeometry.ts` handles pixel positions, vertex strings, adjacency, and `hexDistance`. The `toCube()` conversion in `los.ts` converts offset coords to cube coords for line-of-sight interpolation.

### Unit identity

`UnitInstance.unitTypeId` must exactly match a `UnitType.id` in `unitTypes.ts`. These ids correspond to the `Tipo` column in `SE_Units.csv` and the `Tipo` column in scenario CSVs. If a scenario references a unit type not in `unitTypes.ts`, stats lookups will return `undefined`.

### Scenario CSV format

Sections delimited by `[SECTION_NAME]`. Key sections: `[ESCENARIO]`, `[ALIADOS]`, `[EJE]`, `[UNIDADES_ALIADOS]`, `[UNIDADES_EJE]`, `[MAPA]`. Field separator is `;`. Parsed by `src/lib/scenarioParser.ts`.

### Tailwind theme

Custom color tokens defined in `tailwind.config.js`: `app-bg`, `panel`, `panel-dark`, `parchment`, `text-dim`, `brass`, `amber`, `fire`, `allied`, `axis`, `map-bg`, `border-military`. Use these instead of arbitrary colors.

## Tooling (Python, offline)

### Map assembler (`tools/herramienta_mapas/`)

Assembles individual map CSVs (`mallas/Map1-10.csv`) into combined maps for scenarios. Run from the repo root:

```bash
# CLI
python3 -m tools.herramienta_mapas.main show 1
python3 -m tools.herramienta_mapas.main join --maps 1 2 --layout 1x2 --output resultado.csv

# API
from tools.herramienta_mapas.assembler import MapAssembler
from tools.herramienta_mapas.hex_mesh import HexMesh
```

Supports rotations (90°, 180°, 270°). Rotating 90°/270° changes orientation from flat-top to pointy-top. Requires `matplotlib` and `numpy`.

### Scenario creator (`tools/Creador_Escenarios.py`)

GUI tool (Tkinter + matplotlib) for assembling maps and authoring scenario CSVs. Outputs files in the format consumed by `scenarioParser.ts`. Run with `python3 tools/Creador_Escenarios.py`.

## Game rules summary (for engine work)

- **Die**: d10 (1–10; "0" on physical die = 10).
- **Turn sequence**: Operations → Rout → Melee → Recovery.
- **Fire resolution**: roll d10 ≤ adjusted FP → Suppressed; roll + casualtyReduce ≤ FP → Reduced + FullySuppressed; roll + casualtyElim ≤ FP → Eliminated. Roll 10 = always No Effect.
- **Morale Check**: roll d10 ≤ current Morale → pass. Morale 10 = auto-pass (except withdrawal).
- **Suppression levels** (`SuppressionLevel`): `0` = Fresh (moraleFresh), `1` = Suppressed (moraleSup), `2` = Fully Suppressed (moraleFull).
- **Prof FP** (used for Op Fire, Final Op Fire, Assault Fire) modifiers are capped at normalFP before PAC terrain modifiers are applied; terrain mods can push above normalFP.
- **Vehicles/Guns** count as 3 units against Operations Range. Infantry/Decoys count as 1.
- For reduced units: `casualtyReduce = null` (one threshold only: `casualtyElim` eliminates).
- Full rules: `docs/Reglamento.pdf` pp. 1–9. Terrain/modifier table: `docs/Hoja de ayuda.pdf`.
