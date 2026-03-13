"""
unit_data.py — Estructuras de datos para unidades del juego Screaming Eagles.

Jerarquía de tipos (estáticos, cargados desde CSV):

    UnitType
      ├── name, faction, category, count
      ├── stats:   InfantryStats | VehicleStats | GunStats | AircraftStats
      └── reduced: Optional[InfantryStats]   (cara trasera reducida)

Instancias en partida (estado mutable):

    UnitInstance
      ├── unit_type: UnitType          (referencia al tipo)
      ├── is_reduced, suppression, is_used, op_fire, is_concealed
      └── position: Optional[Coord]   (hex donde está colocada)

Notas de diseño:
  - InfantryStats es compartida por Squads, WTs y Decoys.
  - Vehículos y Cañones usan stats diferentes (VehicleStats / GunStats).
  - UnitType es inmutable (frozen=False solo en reduced para facilitar el
    enlazado post-carga); los Stats sí son frozen.
  - UnitInstance es completamente mutable: representa el estado en juego.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Tuple

# Coordenada hex (col_idx, row) — mismo tipo que en hex_mesh.py
Coord = Tuple[int, int]


# ══════════════════════════════════════════════════════════════════════════════
# Enumeraciones
# ══════════════════════════════════════════════════════════════════════════════

class Faction(Enum):
    AMERICAN = "American"
    GERMAN   = "German"
    RUSSIAN  = "Russian"
    NEUTRAL  = "Neutral"


class UnitCategory(Enum):
    SQUAD      = "squad"       # Escuadra de infantería (5 MPs)
    WT_MG      = "wt_mg"       # Weapons Team — Ametralladora (4 MPs)
    WT_MORTAR  = "wt_mortar"   # Weapons Team — Mortero (4 MPs, fuego indirecto)
    VEHICLE    = "vehicle"     # Tanque, cazacarros o transporte blindado
    GUN        = "gun"         # Cañón AT/AA con dotación (no se mueve solo)
    AIRCRAFT   = "aircraft"    # Aeronave (Stuka JU87G)
    DECOY      = "decoy"       # Señuelo (mismas stats que unidad real)


class SuppressionLevel(Enum):
    """Tres estados de supresión posibles para infantería y cañones."""
    FRESH           = 0   # Sin supresión  → usa Moral alta
    SUPPRESSED      = 1   # Suprimido      → usa Moral media
    FULL_SUPPRESSED = 2   # Tot. suprimido → usa Moral baja


# ══════════════════════════════════════════════════════════════════════════════
# Estadísticas estáticas (inmutables, leídas del CSV)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class InfantryStats:
    """
    Stats de Squads, WTs y Decoys — cara delantera (fuerza completa)
    o cara trasera (reducida).

    Campos de fuego:
      normal_fp   — fuego regular (no en movimiento)
      prof_fp     — Op Fire y Assault Fire (tras mover)
      melee_fp    — solo WTs; None → el Squad usa normal_fp en melee

    Rango:
      range_min   — 1 para fuego directo; 2 para morteros (rango mínimo)
      range_max   — None si el CSV solo indica ">1" (sin máximo en ficha)
      is_mortar   — True cuando range_min > 1

    Anti-carro:
      satw        — valor SATW si la unidad lleva bazooka/Panzerfaust; None si no

    Bajas:
      cas_reduce  — umbral para reducción (None si ya es cara reducida)
      cas_elim    — umbral para eliminación

    Moral (tres estados de supresión):
      morale_fresh / morale_sup / morale_full
      Con Moral 10 no se tira dado para activar.
    """
    normal_fp:    int
    prof_fp:      int
    melee_fp:     Optional[int]        # None → Squad usa normal_fp
    range_min:    int                  # 1 = directo, 2 = mortero
    range_max:    Optional[int]        # None si no especificado en CSV
    satw:         Optional[int]        # Valor anti-carro; None si no tiene
    cas_reduce:   Optional[int]        # None si ya es cara reducida
    cas_elim:     int
    morale_fresh: int
    morale_sup:   int
    morale_full:  int
    is_mortar:    bool = False


@dataclass(frozen=True)
class VehicleStats:
    """
    Stats de tanques, cazacarros y transportes blindados.

    Potencias de fuego:
      fp_vs_vehicle   — FP anti-carro (contra vehículos)
      fp_vs_infantry  — FP HE/ametralladora (contra infantería y cañones)

    Blindaje:
      armor_front     — blindaje frontal
      armor_side      — blindaje lateral y trasero (mismo valor)

    Movimiento y habilidad:
      movement        — MPs por turno
      proficiency     — Proficiency Rating (para Op Fire, disparo largo, etc.)
    """
    fp_vs_vehicle:  int
    fp_vs_infantry: int
    armor_front:    int
    armor_side:     int
    movement:       int
    proficiency:    int


@dataclass(frozen=True)
class GunStats:
    """
    Stats de cañones AT/AA (dotación + arma).
    Híbrido: tiene FP doble como vehículo y Bajas/Moral como infantería.
    No tiene blindaje ni movimiento propios.

    fp_vs_vehicle   — FP anti-carro del cañón
    fp_vs_infantry  — FP HE del cañón (contra infantería)
    cas_reduce      — 1.ª baja de la dotación (reducción)
    cas_elim        — 2.ª baja de la dotación (eliminación)
    morale_*        — de la dotación
    proficiency     — Proficiency Rating para disparos difíciles
    """
    fp_vs_vehicle:  int
    fp_vs_infantry: int
    cas_reduce:     Optional[int]
    cas_elim:       int
    morale_fresh:   int
    morale_sup:     int
    morale_full:    int
    proficiency:    int


@dataclass(frozen=True)
class AircraftStats:
    """
    Stats de aeronave (Stuka JU87G).
    Solo FP y eficacia; sin blindaje terrestre ni movimiento de turno.
    """
    fp_vs_vehicle:  int
    fp_vs_infantry: int
    proficiency:    int


# Tipo unión para anotaciones
AnyStats = InfantryStats | VehicleStats | GunStats | AircraftStats


# ══════════════════════════════════════════════════════════════════════════════
# Definición estática de tipo de unidad
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class UnitType:
    """
    Definición completa e inmutable de un tipo de unidad.
    Representa el counter físico del juego (ambas caras si aplica).

    Atributos:
      name      — nombre base (sin sufijo "(Reducida)")
      faction   — bando
      category  — tipo de unidad
      count     — número de fichas físicas incluidas en el juego
      stats     — estadísticas de la cara de Fuerza Completa
      reduced   — estadísticas de la cara Reducida (None si no tiene)
    """
    name:    str
    faction: Faction
    category: UnitCategory
    count:   int
    stats:   AnyStats
    reduced: Optional[InfantryStats] = None   # solo Infantry/WT/Decoy


# ══════════════════════════════════════════════════════════════════════════════
# Estado dinámico de una instancia en partida
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class UnitInstance:
    """
    Instancia de una unidad colocada en el mapa durante la partida.
    Separa el estado mutable del turno de la definición estática del tipo.

    Atributos de estado:
      is_reduced   — True si la ficha está en su cara reducida
      suppression  — nivel de supresión actual (FRESH / SUPPRESSED / FULL)
      is_used      — marcada con contador Used (acción realizada este turno)
      op_fire      — marcada como Op Fire (esperando interrumpir movimiento)
      is_concealed — tiene contador de Concealment
      position     — coordenada hex (col_idx, row) o None si no está en mapa
    """
    unit_type:    UnitType
    is_reduced:   bool             = False
    suppression:  SuppressionLevel = SuppressionLevel.FRESH
    is_used:      bool             = False
    op_fire:      bool             = False
    is_concealed: bool             = False
    position:     Optional[Coord]  = None

    # ── Acceso a stats activas ──────────────────────────────────────

    @property
    def current_stats(self) -> AnyStats:
        """Stats activas: reducida si la ficha está girada, completa si no."""
        if self.is_reduced and self.unit_type.reduced is not None:
            return self.unit_type.reduced
        return self.unit_type.stats

    @property
    def current_morale(self) -> Optional[int]:
        """
        Moral actual según nivel de supresión.
        None para vehículos (no usan moral en el mismo sentido).
        """
        s = self.current_stats
        if isinstance(s, (InfantryStats, GunStats)):
            return (s.morale_fresh, s.morale_sup, s.morale_full)[self.suppression.value]
        return None

    # ── Mecánicas básicas ───────────────────────────────────────────

    def add_suppression(self) -> None:
        """Incrementa un nivel de supresión (máx. FULL_SUPPRESSED)."""
        if self.suppression != SuppressionLevel.FULL_SUPPRESSED:
            self.suppression = SuppressionLevel(self.suppression.value + 1)

    def reduce_suppression(self) -> None:
        """Reduce un nivel de supresión (se llama en Recovery Phase)."""
        if self.suppression != SuppressionLevel.FRESH:
            self.suppression = SuppressionLevel(self.suppression.value - 1)

    def apply_reduction(self) -> bool:
        """
        Aplica una reducción a la unidad.
        Devuelve True si queda eliminada (ya estaba reducida o no tiene cara reducida).
        Si sobrevive: gira la ficha y aplica supresión total (regla 8.0).
        """
        if self.is_reduced or self.unit_type.reduced is None:
            return True   # eliminada
        self.is_reduced  = True
        self.suppression = SuppressionLevel.FULL_SUPPRESSED
        return False

    def reset_for_new_turn(self) -> None:
        """
        Limpia contadores de turno (Recovery Phase).
        No toca supresión (se gestiona con reduce_suppression).
        """
        self.is_used  = False
        self.op_fire  = False

    # ── Utilidades ──────────────────────────────────────────────────

    def __repr__(self) -> str:
        state = []
        if self.is_reduced:   state.append('RED')
        if self.suppression != SuppressionLevel.FRESH:
            state.append(self.suppression.name[:4])
        if self.is_used:      state.append('USED')
        if self.is_concealed: state.append('CONC')
        pos = f'@{self.position}' if self.position else ''
        flags = f'[{",".join(state)}]' if state else ''
        return f'<Unit {self.unit_type.name}{pos}{flags}>'
