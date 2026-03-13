# Band of Brothers: Screaming Eagles — Proyecto Digital

**Última actualización:** 2026-03-12

Adaptación digital del juego de mesa **Band of Brothers: Screaming Eagles v2.3** (wargame táctico WWII, tablero hexagonal). La implementación sigue las reglas del juego de mesa fielmente.

---

## Estructura del repositorio

```
wargame-ai/
├── app/                        # Frontend React + TypeScript (Vite)
│   ├── public/                 # Assets estáticos (CSVs de escenarios, scenarios.json)
│   │   ├── scenarios.json      # Índice de escenarios disponibles
│   │   ├── Scenario 00.csv     # Escenario 00: Capture the Bridge
│   │   ├── Scenario 01.csv     # Escenario 01: Day of Days
│   │   └── Scenario 02.csv     # Escenario 02: So few led by so many
│   └── src/
│       ├── App.tsx             # Componente raíz, orquestación de UI y callbacks
│       ├── types/index.ts      # Todos los tipos compartidos
│       ├── store/gameStore.ts  # Estado global (Zustand), todas las acciones de juego
│       ├── engine/mechanics/   # Funciones puras del motor de juego (sin efectos)
│       │   ├── index.ts        # Re-exporta todo el engine
│       │   ├── fire.ts         # Resolución de disparo (infantería, cañones)
│       │   ├── opfire.ts       # Op Fire / Final Op Fire
│       │   ├── movement.ts     # Validación de movimiento, coste en MPs
│       │   ├── los.ts          # Línea de visión (LOS), buildHexMap
│       │   ├── morale.ts       # Chequeos de moral
│       │   ├── melee.ts        # Combate cuerpo a cuerpo
│       │   ├── rout.ts         # Fase de Rout
│       │   ├── recovery.ts     # Fase de Recovery
│       │   ├── terrain.ts      # Modificadores de terreno
│       │   ├── vehicleFire.ts  # Fuego de vehículos (Prof Check, arco frontal, blindaje)
│       │   ├── satw.ts         # SATW (anti-tank individual)
│       │   ├── unitTypes.ts    # Datos estáticos de tipos de unidad (de SE_Units.csv)
│       │   └── dice.ts         # rollD10
│       ├── components/
│       │   ├── GamePanel/      # Panel lateral (info, log, escenario, setup)
│       │   ├── HexGrid/        # Tablero SVG interactivo
│       │   ├── PhaseBar/       # Barra superior de fase/turno
│       │   ├── PlayerAid/      # Tabla de ayuda rápida
│       │   ├── ScenarioSelect/ # Pantalla de selección de escenario
│       │   └── UnitCounter/    # Counter de unidad (wargame-style)
│       └── lib/
│           ├── hexGeometry.ts  # Geometría de hexágonos (centros, vértices, distancia)
│           └── scenarioParser.ts # Parser de CSVs de escenarios
├── docs/
│   ├── Reglamento.pdf          # Reglas completas del juego (referencia autoritativa)
│   ├── Hoja de ayuda.pdf       # Player Aid Card (tabla de modificadores de terreno)
│   └── SE_Units.csv            # Datos de todas las unidades del juego
├── mallas/                     # CSVs de mallas hexagonales individuales (Map1-10.csv)
├── scenarios/                  # Copia de escenarios (espejo de app/public/)
├── tools/
│   ├── herramienta_mapas/      # Ensamblador de mapas (Python, offline)
│   └── Creador_Escenarios.py   # GUI de creación de escenarios (Tkinter)
└── CLAUDE.md                   # Instrucciones para Claude Code
```

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript |
| Build | Vite + `tsc -b` |
| Estado | Zustand |
| Estilos | Tailwind CSS (tokens personalizados) |
| Herramientas Python | Tkinter, matplotlib, numpy |

**Comandos** (desde `app/`):
```bash
npm run dev      # Servidor de desarrollo (HMR)
npm run build    # Type-check + build producción
npm run lint     # ESLint
npm run preview  # Preview del build
```

No hay tests automatizados. `npm run build` (tsc -b) es la verificación de correctitud principal.

---

## Arquitectura: separación de responsabilidades

```
CSV escenarios → scenarioParser.ts → Scenario type → gameStore → componentes
SE_Units.csv   → unitTypes.ts (manual) → funciones del engine
mallas/*.csv   → herramienta_mapas (Python, offline)
```

- **`engine/mechanics/`** — Funciones puras, sin efectos secundarios. Calculan resultados pero nunca mutan el estado.
- **`store/gameStore.ts`** — Único store Zustand. Todo el estado de partida vive aquí. Los componentes llaman acciones del store; las acciones llaman funciones del engine.
- **`components/`** — Solo presentacional. Reciben estado via `useGameStore()` y despachan acciones. Sin lógica de juego.

---

## Tipos clave (`src/types/index.ts`)

| Tipo | Descripción |
|------|-------------|
| `UnitType` | Definición estática (FP, Casualty, Morale). Buscado por `unitTypeId`. |
| `UnitInstance` | Estado runtime de un counter (`suppression`, `isUsed`, `isOpFire`, `isReduced`, `position`, `isConcealed`, `facing`, etc.). `instanceId` único por partida. |
| `HexData` | Hex parseado del CSV. `id` = `"${origMap}${origCoord}"`. Grid: `col`/`row`. |
| `Scenario` | Escenario completo: `HexData[]`, listas de unidades, configs de bando, orientación. |
| `GameState` | Todo el estado de partida (ver campos abajo). |
| `GamePhase` | `'setup' \| 'operations' \| 'rout' \| 'melee' \| 'recovery' \| 'end'` |
| `ActiveSide` | `'allied' \| 'axis'` |
| `PendingOpFire` | `{ movingUnitId, enteredHexId, eligibleFirers[] }` — oportunidad de Op Fire activa |

**Campos clave de `GameState`:**
- `pendingOpFire` — activo cuando hay oportunidad de Op Fire tras un movimiento
- `movingUnitMCFailed` — la unidad en movimiento falló MC tras Op Fire (bloquea siguiente movimiento)
- `setupSplitCol` — columna límite entre zonas de despliegue (calculado al cargar escenario)

---

## Sistema de coordenadas hexagonal

- Orientación por defecto: **flat-top**. Escenarios rotados 90°/270° usan **pointy-top**.
- `col`/`row` en `HexData` son coordenadas de grid ensamblado (enteros).
- `hexGeometry.ts`: posiciones en píxeles, vértices, adyacencia, `hexDistance`.
- `los.ts`: conversión a coordenadas cúbicas para interpolación LOS.
- Zonas de setup: **allied** → `col ≤ setupSplitCol`; **axis** → `col > setupSplitCol`.

---

## Formato CSV de escenarios

Secciones delimitadas por `[SECTION_NAME]`. Separador de campos: `;`.

Secciones clave: `[ESCENARIO]`, `[ALIADOS]`, `[EJE]`, `[UNIDADES_ALIADOS]`, `[UNIDADES_EJE]`, `[MAPA]`.

El campo `Tipo` en las unidades del CSV debe coincidir exactamente con `UnitType.id` en `unitTypes.ts`.

Añadir un nuevo escenario: crear el CSV en `app/public/` y añadir la entrada en `scenarios.json`.

---

## Reglas del juego (resumen para implementación)

- **Dado**: d10 (1–10; "0" en dado físico = 10).
- **Secuencia de turno**: Operations → Rout → Melee → Recovery.
- **Resolución de fuego**: tirada d10 ≤ FP ajustado → Suprimido; tirada + casualtyReduce ≤ FP → Reducido + TotalSup; tirada + casualtyElim ≤ FP → Eliminado. Tirada 10 = siempre Sin Efecto.
- **Chequeo de moral (MC)**: d10 ≤ moral actual → pasa. Moral 10 = pasa automático (salvo retirada).
- **Niveles de supresión**: `0` = Fresh, `1` = Suppressed, `2` = Fully Suppressed.
- **Prof FP** (Op Fire, Final Op Fire, Assault Fire): se limita a normalFP antes de modificadores de terreno.
- **Vehículos/Cañones**: cuentan como 3 unidades para el Operations Range. Infantería/Decoys = 1.
- **Op Fire (9.0)**: bando no activo dispara tras cada hex entrado; tirador pasa MC antes; si objetivo suprimido → objetivo pasa MC o movimiento termina y queda Usado.
- **Final Op Fire (10.0)**: por unidades Usadas; solo hex adyacente; -2 FP; CP extiende rango.
- **Concealment (15.0)**: se gana en terreno beneficial + fuera de LOS enemiga, o al marcarse Usado/OpFire fuera de LOS. Se pierde al disparar, ser suprimido, tener infantería enemiga adyacente, o estar en terreno abierto con LOS enemiga.
- **Setup (18.0)**: dos fases (cada bando despliega en su zona); máx 2 infantería / 1 vehículo por hex.

Referencias completas: `docs/Reglamento.pdf` (pp. 1–9) y `docs/Hoja de ayuda.pdf`.

---

## Escenarios disponibles

| Num | Título | Turnos |
|-----|--------|--------|
| 00 | Capture the Bridge | 4 |
| 01 | Day of Days | 5 |
| 02 | So few led by so many | 7 |

> El Escenario 02 está disponible y figura en `scenarios.json`.

---

## Tokens de color Tailwind

`app-bg`, `panel`, `panel-dark`, `parchment`, `text-dim`, `brass`, `amber`, `fire`, `allied`, `axis`, `map-bg`, `border-military`. Definidos en `tailwind.config.js`. Usar estos en lugar de colores arbitrarios.
