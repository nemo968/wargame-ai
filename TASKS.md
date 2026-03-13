# Tareas — Band of Brothers: Screaming Eagles Digital

**Última actualización:** 2026-03-12

---

## ✅ Completado

### Motor de juego (`engine/mechanics/`)
- [x] **Dado** — `rollD10()` con resultado 1–10
- [x] **Tipos de unidad** — Datos estáticos de `SE_Units.csv` en `unitTypes.ts` (infantería, armas de apoyo, vehículos, cañones)
- [x] **Terreno** — Modificadores de terreno/fortification/LOS según `Hoja de ayuda.pdf`
- [x] **LOS** — `computeLOS()`, `buildHexMap()`, interpolación en coordenadas cúbicas; soporte flat-top y pointy-top
- [x] **Geometría hexagonal** — Centros, vértices, adyacencia, `hexDistance()`, `mapBounds()`
- [x] **Movimiento** — `validateMove()`, `movementAllowance()`, `canStackInHex()` (stacking rules)
- [x] **Fuego de infantería** — `resolveFireAttack()`, `getActiveInfantryStats()`, `fireLogMessage()`
- [x] **Moral** — `getCurrentMorale()`, `rollMoraleCheck()`, `mcLogMessage()`
- [x] **Fuego de vehículos** — `resolveProfCheck()`, `resolveVGunVsInfantry()`, `resolveVGunVsVehicle()`, `armorForAngle()`, `isInFrontArc()`, `directionBetweenHexes()`
- [x] **SATW** — `resolveSATWCheck()`, `resolveSATWAttack()` (anti-tank individual)
- [x] **Op Fire / Final Op Fire** — `checkOpFireEligibility()`, `resolveOpFire()`, `opFireLogMessage()`
- [x] **Melee** — `resolveMelee()`, `applyMeleeCasualties()`, `meleeLogMessage()`
- [x] **Rout** — `getRoutCondition()`, `resolveRoutCheck()`, `findRoutCandidates()`, `routLogMessage()`
- [x] **Recovery** — `applyRecovery()` (elimina supresión al final del turno)

### Store (`store/gameStore.ts`)
- [x] **Carga de escenario** — `loadScenario()`: parsea CSV, instancia unidades, calcula `setupSplitCol`
- [x] **Selección** — `selectUnit()`, `selectHex()`
- [x] **Gestión de fases** — `nextPhase()`, `setPhase()`, secuencia completa Operations→Rout→Melee→Recovery→Operations
- [x] **Movimiento** — `tryMoveUnit()`: valida, aplica coste MP, gestiona undo, detecta Melee, activa Op Fire
- [x] **Fuego** — `tryFireUnit()`: infantería, vehículos, cañones, SATW, aeronaves; modos Normal/Assault; undo de disparo
- [x] **Humo** — `tryFireSmoke()`: morteros colocan humo; `smokeHexes` con estados `fresh`/`dispersed`
- [x] **Activación** — `endUnitActivation()`, `endSideOperations()`, gestión de `opsUsed` y Operations Range
- [x] **Undo** — `undoLastMove()`, `undoLastFire()`
- [x] **Command Points** — `useCommandPoint()` por bando
- [x] **Control de hexes** — `hexControl` actualizado al eliminar unidades
- [x] **Rout** — `tryRoutUnit()` integrado con engine
- [x] **Melee** — `tryResolveMelee()` integrado con engine
- [x] **Op Fire** — `tryOpFireUnit()`, `passOpFire()`, `getEligibleOpFirers()` (wired tras movimiento)
- [x] **Setup interactivo** — `placeUnitInSetup()`, `removeUnitFromSetup()`, `completeSetup()` (dos fases)
- [x] **Concealment dinámico** — helpers `hasBeneficialTerrain()`, `isOutsideAllEnemyLOS()`, `hasAdjacentEnemyInfantry()`; integrado en move/fire/endActivation/completeSetup

### UI (`components/` + `App.tsx`)
- [x] **Tablero hexagonal SVG** — `HexGrid`: render de hexes, terreno, counters, stacking visual, zoom/pan
- [x] **Counters de unidad** — Estilo wargame: silueta, zona de info (FP, supresión, estado), colores por facción
- [x] **Selección y movimiento** — Click en hex mueve unidad seleccionada; feedback de MPs restantes
- [x] **Disparo** — Click en unidad enemiga con amigo seleccionado → `tryFireUnit`; feedback resultado
- [x] **Panel lateral** — `GamePanel`: tabs INFO / REGISTRO / ESCENARIO
- [x] **Info de unidad** — Botones Undo, Mark Used, Op Fire, Smoke, Rout
- [x] **Log de combate** — Historial coloreado por tipo de evento
- [x] **Barra de fase** — `PhaseBar`: turno, fase, ops usadas, CPs, botones de avance
- [x] **Herramienta LOS** — Modo LOS interactivo con overlay en tablero
- [x] **Smoke overlay** — Visualización de hexes con humo (fresh/dispersed)
- [x] **Setup interactivo** — Panel en GamePanel con lista de unidades sin colocar; zona de despliegue resaltada en tablero; click para colocar/devolver
- [x] **Banner Op Fire** — Overlay en mapa cuando `pendingOpFire` activo; botón PASAR; click para disparar
- [x] **Resaltado hex objetivo Op Fire** — Hex de la unidad en movimiento resaltado en rojo

### Herramientas Python
- [x] **Ensamblador de mapas** — `tools/herramienta_mapas/`: ensamblado de mapas, rotaciones, layout NxM
- [x] **Creador de escenarios** — `tools/Creador_Escenarios.py`: GUI para crear/editar CSVs de escenario

### Escenarios
- [x] Escenario 00: *Capture the Bridge* (4 turnos)
- [x] Escenario 01: *Day of Days* (5 turnos)
- [x] Escenario 02: *So few led by so many* (7 turnos) — creado y añadido a `scenarios.json`

---

## 🔲 Pendiente

### Alta prioridad

- [x] **Facing táctico (vehículos/cañones)** — Implementado según regla 12.0.
  - Coste: 1 MP por cada 60° de rotación al inicio del movimiento (`rotationSteps()` en `vehicleFire.ts`)
  - Restricción: vehículo no puede moverse hacia atrás (`REAR_FACING` en `vehicleFire.ts`)
  - Bloqueo de clic-derecho manual durante Operations (para evitar eludir el coste de rotación)
  - Arco de fuego: ya estaba implementado; ahora el facing es efectivamente dinámico

- [x] **Rout Edge** — Implementado fallback en `rout.ts`:
  - Cuando no hay candidatos de huida normales → `findRoutCandidates()` devuelve hexes en dirección al `routEdge`
  - Nueva función `isOnRoutEdge()`: detecta si un hex está en el borde de mapa según dirección
  - En `tryRoutUnit()`: si la unidad llega al borde → eliminada ("huye del mapa")

- [x] **Condiciones de victoria** — Implementado al fin de partida:
  - `computeHexControl()` en store: calcula qué bando controla cada hex al final del juego
  - `nextPhase()` calcula y guarda `hexControl` cuando `gameOver`
  - GamePanel tab ESCENARIO: sección "★ FIN DE PARTIDA ★" con la victoria textual + hexes controlados por bando

### Media prioridad

- [x] **Escenarios adicionales** — Escenarios 00–18 desplegados en `app/public/` y listados en `scenarios.json`.

- [x] **IA básica** — Implementada en `app/src/engine/ai/aiEngine.ts`. IA determinista con heurísticas de puntuación que gestiona: setup automático (prioriza WTs > vehículos > squads > decoys), operaciones (fuego, movimiento, marcado Op Fire), Op Fire reactivo al movimiento humano, fase Rout y Melee. Respeta fog of war (isConcealed), analiza objetivos del escenario desde el texto de victoria, y usa command points de forma táctica.

- [x] **Guardado / carga de partida** — Implementado: `saveGame()`/`loadGame()` con `localStorage` en el store; botones en PhaseBar durante la partida; botón "Continuar" en ScenarioSelect si hay partida guardada.

- [x] **Decoys** — Implementado: ocultos desde el inicio, no pueden disparar, se revelan y eliminan al recibir fuego suficiente para suprimirlos (Normal, Op Fire, Aircraft) o al iniciarse melee en su hex.

### Baja prioridad

- [x] **Artillería off-board / soporte aéreo** — Aeronave (aircraft) implementada en `tryFireUnit`:
  - No requiere posición ni LOS; Prof Check siempre requerido
  - Usa `airFireModifier()` para modificadores de terreno (columna AIR FP de la PAC)
  - Vs vehículo: resolveVGunVsVehicle con armor frontal; Vs infantería/cañón: resolveVGunVsInfantry con delta de modificadores
  - Concealment ELIMINADO en vez de dar -1 FP (regla PAC)
  - `artFireModifier()` también disponible en terrain.ts para uso futuro

- [x] **Señales de mando avanzadas** — Tres nuevas opciones de CP implementadas:
  - **Follow Me (+1 MP)**: botón en GamePanel cuando infantería está en movimiento activo + tiene CPs; `spendCPForMovement()` en store
  - **Re-roll MC**: cuando `tryMoveUnit` falla MC y hay CPs disponibles → banner con [SÍ/NO]; `confirmMCRerollAndMove()`, `declineMCReroll()` en store
  - **Second Player Action**: al inicio de Operations si el 2º jugador tiene CPs → banner con [GASTAR CP/PASAR]; acción única antes del 1er jugador; `useSecondPlayerActionCP()`, `passSecondPlayerAction()` en store

- [x] **Escenario 02 en índice** — Añadido a `scenarios.json`.

---

## 📋 Notas de diseño

- **Política de cambios**: modificar solo lo necesario para la tarea. Sin refactorizaciones preventivas.
- **Verificación**: siempre `npm run build` (desde `app/`) tras cualquier cambio de TypeScript.
- **Reglas autoritativas**: ante duda, `docs/Reglamento.pdf` y `docs/Hoja de ayuda.pdf` mandan sobre cualquier interpretación del código existente.
- **Escenario CSV nuevo**: 1) crear CSV con `Creador_Escenarios.py`, 2) copiar a `app/public/`, 3) añadir entrada en `app/public/scenarios.json`, 4) verificar que los `Tipo` de unidades coincidan con `unitTypes.ts`.
