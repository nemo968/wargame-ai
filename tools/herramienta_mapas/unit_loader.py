"""
unit_loader.py — Carga unidades desde SE_Units.csv.

Estructura del CSV:
  - Separador: ';'
  - Primera línea: título ("Tabla 1") — se ignora automáticamente
  - Segunda línea: cabecera de columnas
  - Líneas de sección: solo tienen valor en "Tipo de unidad" y el resto vacío
    (p. ej. "American Infantry", "German Veh. & Guns")
  - Líneas de datos: unidades con sus atributos
  - Unidades reducidas: nombre con sufijo "(Reducida)"

Algoritmo:
  1. Encontrar la fila de cabecera (contiene "Tipo de unidad")
  2. Recorrer filas detectando secciones y datos
  3. Acumular pares (cara completa, cara reducida) por nombre base
  4. Construir UnitType con InfantryStats/VehicleStats/GunStats/AircraftStats
"""

from __future__ import annotations

import csv
import io
from typing import Dict, List, Optional, Tuple

from .unit_data import (
    Faction, UnitCategory,
    InfantryStats, VehicleStats, GunStats, AircraftStats,
    UnitType,
)

# ── Mapeo de cabeceras de sección ─────────────────────────────────────────
# Clave en minúsculas → (Faction, categoría base)
_SECTION_MAP: Dict[str, Tuple[Faction, UnitCategory]] = {
    'american infantry':    (Faction.AMERICAN, UnitCategory.SQUAD),
    'american veh & guns':  (Faction.AMERICAN, UnitCategory.VEHICLE),
    'german infantry':      (Faction.GERMAN,   UnitCategory.SQUAD),
    'german veh. & guns':   (Faction.GERMAN,   UnitCategory.VEHICLE),
    'russian veh & guns':   (Faction.RUSSIAN,  UnitCategory.VEHICLE),
    'neutral counters':     (Faction.NEUTRAL,  UnitCategory.VEHICLE),
}

# Columnas del CSV (tal como aparecen en la cabecera)
_COL_NAME     = 'Tipo de unidad'
_COL_COUNT    = 'Número de fichas'
_COL_FP       = 'Potencia de fuego'
_COL_PROF_FP  = 'Potencia eficiente'
_COL_MELEE    = 'Potencia en melee'
_COL_RANGE    = 'Alcance'
_COL_SATW     = 'SATW'
_COL_CAS_RED  = 'Baja reducción'
_COL_CAS_ELIM = 'Baja de elimin.'
_COL_MOR_HI   = 'Moral    alta'
_COL_MOR_MID  = 'Moral   media'
_COL_MOR_LO   = 'Moral   baja'
_COL_ARM_F    = 'Blindaje frontal'
_COL_ARM_S    = 'Blindaje lat/trasero'
_COL_MOV      = 'Mov. vehículos'
_COL_PROF     = 'Eficacia'


# ══════════════════════════════════════════════════════════════════════════════
# Helpers de parseo
# ══════════════════════════════════════════════════════════════════════════════

def _int(val: str, default: int = 0) -> int:
    try:
        return int((val or '').strip())
    except ValueError:
        return default


def _opt_int(val: str) -> Optional[int]:
    try:
        return int((val or '').strip())
    except ValueError:
        return None


def _parse_range(val: str) -> Tuple[int, Optional[int]]:
    """
    Convierte el campo Alcance a (range_min, range_max):

      "5"    → (1, 5)     fuego directo, alcance máximo 5
      ">1"   → (2, None)  mortero sin máximo en CSV
      "2-12" → (2, 12)    mortero con rango explícito 2–12
      ""     → (1, None)  sin dato (vehículos, cañones)
    """
    v = (val or '').strip()
    if not v:
        return (1, None)
    if v.startswith('>'):
        return (_int(v[1:]) + 1, None)
    if '-' in v:
        lo, hi = v.split('-', 1)
        return (_int(lo), _int(hi))
    return (1, _int(v))


# ══════════════════════════════════════════════════════════════════════════════
# Detección de categoría
# ══════════════════════════════════════════════════════════════════════════════

def _detect_category(name: str, row: Dict[str, str],
                     base_cat: UnitCategory) -> UnitCategory:
    """
    Determina la categoría exacta de la unidad a partir de:
      - su nombre (detecta DECOY, MG, MORTAR, STUKA)
      - el contenido del campo Moral alta:
          · no vacío → tiene dotación con moral → es GUN (no vehículo)
          · vacío    → vehículo puro
    """
    n = name.upper()

    if 'DECOY' in n:
        return UnitCategory.DECOY

    if base_cat == UnitCategory.SQUAD:
        # Sección de infantería
        if 'MG' in n or 'MACHINE GUN' in n:
            return UnitCategory.WT_MG
        if 'MORTAR' in n:
            return UnitCategory.WT_MORTAR
        return UnitCategory.SQUAD

    # Sección de vehículos: distinguir vehículo / cañón / aeronave
    if 'STUKA' in n or 'JU87' in n:
        return UnitCategory.AIRCRAFT

    # Si tiene Moral alta rellena → es cañón (dotación con moral propia)
    if row.get(_COL_MOR_HI, '').strip():
        return UnitCategory.GUN

    return UnitCategory.VEHICLE


# ══════════════════════════════════════════════════════════════════════════════
# Constructores de stats
# ══════════════════════════════════════════════════════════════════════════════

def _build_infantry(row: Dict[str, str], is_reduced: bool) -> InfantryStats:
    rmin, rmax = _parse_range(row.get(_COL_RANGE, ''))
    if is_reduced:
        # Cara reducida: solo queda un umbral (eliminación).
        # El CSV lo almacena en la columna "Baja reducción"; "Baja de elimin." va vacía.
        cas_reduce = None
        cas_elim   = _int(row.get(_COL_CAS_RED, ''))
    else:
        cas_reduce = _opt_int(row.get(_COL_CAS_RED,  ''))
        cas_elim   = _int(row.get(_COL_CAS_ELIM, ''))
    return InfantryStats(
        normal_fp    = _int(row.get(_COL_FP,      '')),
        prof_fp      = _int(row.get(_COL_PROF_FP, '')),
        melee_fp     = _opt_int(row.get(_COL_MELEE, '')),
        range_min    = rmin,
        range_max    = rmax,
        satw         = _opt_int(row.get(_COL_SATW,    '')),
        cas_reduce   = cas_reduce,
        cas_elim     = cas_elim,
        morale_fresh = _int(row.get(_COL_MOR_HI,  '')),
        morale_sup   = _int(row.get(_COL_MOR_MID, '')),
        morale_full  = _int(row.get(_COL_MOR_LO,  '')),
        is_mortar    = (rmin > 1),
    )


def _build_vehicle(row: Dict[str, str]) -> VehicleStats:
    return VehicleStats(
        fp_vs_vehicle  = _int(row.get(_COL_FP,      '')),
        fp_vs_infantry = _int(row.get(_COL_PROF_FP, '')),
        armor_front    = _int(row.get(_COL_ARM_F,   '')),
        armor_side     = _int(row.get(_COL_ARM_S,   '')),
        movement       = _int(row.get(_COL_MOV,     '')),
        proficiency    = _int(row.get(_COL_PROF,    '')),
    )


def _build_gun(row: Dict[str, str]) -> GunStats:
    return GunStats(
        fp_vs_vehicle  = _int(row.get(_COL_FP,       '')),
        fp_vs_infantry = _int(row.get(_COL_PROF_FP,  '')),
        cas_reduce     = _opt_int(row.get(_COL_CAS_RED,  '')),
        cas_elim       = _int(row.get(_COL_CAS_ELIM, '')),
        morale_fresh   = _int(row.get(_COL_MOR_HI,   '')),
        morale_sup     = _int(row.get(_COL_MOR_MID,  '')),
        morale_full    = _int(row.get(_COL_MOR_LO,   '')),
        proficiency    = _int(row.get(_COL_PROF,      '')),
    )


def _build_aircraft(row: Dict[str, str]) -> AircraftStats:
    return AircraftStats(
        fp_vs_vehicle  = _int(row.get(_COL_FP,      '')),
        fp_vs_infantry = _int(row.get(_COL_PROF_FP, '')),
        proficiency    = _int(row.get(_COL_PROF,     '')),
    )


# ══════════════════════════════════════════════════════════════════════════════
# Cargador principal
# ══════════════════════════════════════════════════════════════════════════════

def load_units(filepath: str) -> List[UnitType]:
    """
    Lee SE_Units.csv y devuelve una lista de UnitType.

    Cada UnitType contiene:
      - stats: cara de fuerza completa
      - reduced: cara reducida (InfantryStats) o None si no aplica

    Unidades con datos incompletos (p. ej. T34/85 sin stats) se omiten
    con un aviso por consola.
    """
    # Leer todas las líneas para saltar el posible título inicial
    with open(filepath, newline='', encoding='utf-8') as f:
        raw = f.read()

    # Encontrar la línea de cabecera (la primera que contiene _COL_NAME)
    lines = raw.splitlines(keepends=True)
    header_idx = next(
        (i for i, ln in enumerate(lines) if _COL_NAME in ln),
        0)
    content = ''.join(lines[header_idx:])

    # Parsear el CSV desde la cabecera
    reader = csv.DictReader(io.StringIO(content), delimiter=';')

    # Estado del recorrido
    faction  = Faction.NEUTRAL
    base_cat = UnitCategory.VEHICLE

    # Acumulador: nombre_base → [row_full, row_red, faction, category]
    pending: Dict[str, list] = {}
    order:   List[str]       = []

    for row in reader:
        name = (row.get(_COL_NAME) or '').strip()
        if not name:
            continue

        # ── Detectar cabecera de sección ──────────────────────────
        # Una sección tiene todos los campos vacíos excepto el nombre
        other_vals = [v for k, v in row.items()
                      if k != _COL_NAME and v and v.strip()]
        if not other_vals:
            key = name.lower()
            if key in _SECTION_MAP:
                faction, base_cat = _SECTION_MAP[key]
            # Si no está en el mapa (ej. "Tabla 1") simplemente se ignora
            continue

        # ── Fila de datos ─────────────────────────────────────────
        is_red   = '(reducida)' in name.lower()
        base     = name.replace('(Reducida)', '').replace('(reducida)', '').strip()
        category = _detect_category(base, row, base_cat)

        if base not in pending:
            pending[base] = [None, None, faction, category]
            order.append(base)

        if is_red:
            pending[base][1] = row
        else:
            pending[base][0] = row

    # ── Construir UnitType ────────────────────────────────────────
    result: List[UnitType] = []

    for base_name in order:
        row_full, row_red, fact, cat = pending[base_name]

        if row_full is None:
            print(f'[unit_loader] AVISO: "{base_name}" sin datos completos — omitida.')
            continue

        count = _int(row_full.get(_COL_COUNT, ''))

        if cat in (UnitCategory.SQUAD, UnitCategory.WT_MG,
                   UnitCategory.WT_MORTAR, UnitCategory.DECOY):
            full_stats = _build_infantry(row_full, is_reduced=False)
            red_stats  = (_build_infantry(row_red, is_reduced=True)
                          if row_red else None)
            result.append(UnitType(
                name=base_name, faction=fact, category=cat,
                count=count, stats=full_stats, reduced=red_stats))

        elif cat == UnitCategory.VEHICLE:
            result.append(UnitType(
                name=base_name, faction=fact, category=cat,
                count=count, stats=_build_vehicle(row_full)))

        elif cat == UnitCategory.GUN:
            result.append(UnitType(
                name=base_name, faction=fact, category=cat,
                count=count, stats=_build_gun(row_full)))

        elif cat == UnitCategory.AIRCRAFT:
            result.append(UnitType(
                name=base_name, faction=fact, category=cat,
                count=count, stats=_build_aircraft(row_full)))

    return result


# ══════════════════════════════════════════════════════════════════════════════
# Utilidades de consulta
# ══════════════════════════════════════════════════════════════════════════════

def by_faction(units: List[UnitType], faction: Faction) -> List[UnitType]:
    """Filtra unidades por bando."""
    return [u for u in units if u.faction == faction]


def by_category(units: List[UnitType],
                category: UnitCategory) -> List[UnitType]:
    """Filtra unidades por categoría."""
    return [u for u in units if u.category == category]


def build_index(units: List[UnitType]) -> Dict[str, UnitType]:
    """Devuelve un dict nombre → UnitType para búsqueda rápida."""
    return {u.name: u for u in units}
