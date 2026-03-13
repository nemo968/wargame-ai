"""
hex_mesh.py - Malla lógica de mapa hexagonal

Coordenadas dobles (dc_col, dc_row):
  - dc_col = col_idx  (A=0, B=1, ..., I=8, ...)
  - Para columnas IMPARES (B,D,F,H...): dc_row = 2 * row
  - Para columnas PARES  (A,C,E,G,I...): dc_row = 2 * row - 1   (row >= 1)

Esta representación permite rotaciones exactas con aritmética entera.

Rotaciones (90°/270° cambian flat-top → pointy-top):
  - 90° CW:  (dc_c, dc_r) → (dc_r_max - dc_r, dc_c - dc_c_min)
  - 180°:    (dc_c, dc_r) → (dc_c_max - dc_c, dc_r_max - dc_r)
  - 270° CW: (dc_c, dc_r) → (dc_r - dc_r_min, dc_c_max - dc_c)
"""

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple
import csv
import copy

Coord = Tuple[int, int]        # (col_idx, row)
DoubleCoord = Tuple[int, int]  # (dc_col, dc_row)


@dataclass
class HexData:
    terrain: str
    elevation: int
    upper_level: bool
    fortification: str
    sides: Dict[str, bool]  # direction -> tiene_seto
    orig_map: int = 0        # número de mapa de origen (0 = sin asignar)
    orig_coord: str = ''     # coordenada original antes de rotación ("A5", "I9", ...)

    def copy(self) -> 'HexData':
        return HexData(
            terrain=self.terrain,
            elevation=self.elevation,
            upper_level=self.upper_level,
            fortification=self.fortification,
            sides=dict(self.sides),
            orig_map=self.orig_map,
            orig_coord=self.orig_coord,
        )


class HexMesh:
    """Malla lógica de un mapa hexagonal (flat-top o pointy-top)."""

    FLAT_TOP_SIDES   = ['N', 'NE', 'SE', 'S', 'SW', 'NW']
    POINTY_TOP_SIDES = ['NE', 'E', 'SE', 'SW', 'W', 'NW']

    # Remapeo de lados al rotar (flat-top → pointy-top para 90°/270°)
    _SIDE_MAP_90CW = {
        'N': 'E', 'NE': 'SE', 'SE': 'SW',
        'S': 'W', 'SW': 'NW', 'NW': 'NE',
    }
    _SIDE_MAP_180 = {
        'N': 'S', 'NE': 'SW', 'SE': 'NW',
        'S': 'N', 'SW': 'NE', 'NW': 'SE',
    }
    _SIDE_MAP_270CW = {
        'N': 'W', 'NE': 'NW', 'SE': 'NE',
        'S': 'E', 'SW': 'SE', 'NW': 'SW',
    }
    # Rotación pointy-top → flat-top (inversa: 90° CW de pointy-top)
    _SIDE_MAP_90CW_PT = {
        'NE': 'N', 'E': 'NE', 'SE': 'SE',
        'SW': 'S', 'W': 'SW', 'NW': 'NW',
    }
    _SIDE_MAP_270CW_PT = {
        'NE': 'SE', 'E': 'S', 'SE': 'SW',
        'SW': 'NW', 'W': 'N', 'NW': 'NE',
    }
    _SIDE_MAP_180_PT = {
        'NE': 'SW', 'E': 'W', 'SE': 'NW',
        'SW': 'NE', 'W': 'E', 'NW': 'SE',
    }

    def __init__(self, hex_type: str = 'flat-top'):
        self.hexes: Dict[Coord, HexData] = {}
        self.hex_type = hex_type   # 'flat-top' o 'pointy-top'
        self.name = ''

    # ------------------------------------------------------------------
    # Conversión de coordenadas
    # ------------------------------------------------------------------

    @staticmethod
    def col_letter_to_idx(letter: str) -> int:
        """'A'→0, 'B'→1, ..., 'Z'→25, 'AA'→26, ..."""
        result = 0
        for ch in letter.upper():
            result = result * 26 + (ord(ch) - ord('A') + 1)
        return result - 1

    @staticmethod
    def col_idx_to_letter(idx: int) -> str:
        """0→'A', 1→'B', ..., 25→'Z', 26→'AA', ..."""
        letters = ''
        n = idx + 1
        while n > 0:
            n, rem = divmod(n - 1, 26)
            letters = chr(ord('A') + rem) + letters
        return letters

    @staticmethod
    def coord_to_double(col_idx: int, row: int) -> DoubleCoord:
        """(col_idx, row) → (dc_col, dc_row)."""
        if col_idx % 2 == 0:  # columna par (A,C,E,G,I,...)
            return (col_idx, 2 * row - 1)
        else:                  # columna impar (B,D,F,H,...)
            return (col_idx, 2 * row)

    @staticmethod
    def double_to_coord(dc_col: int, dc_row: int) -> Optional[Coord]:
        """(dc_col, dc_row) → (col_idx, row), o None si no es válido."""
        col_idx = dc_col
        if col_idx % 2 == 0:
            if dc_row % 2 == 0:
                return None   # par col necesita dc_row impar
            row = (dc_row + 1) // 2
        else:
            if dc_row % 2 != 0:
                return None   # impar col necesita dc_row par
            row = dc_row // 2
        if row < 0:
            return None
        return (col_idx, row)

    # ------------------------------------------------------------------
    # Carga y exportación CSV
    # ------------------------------------------------------------------

    def load_csv(self, filepath: str, name: str = '') -> 'HexMesh':
        """Carga la malla desde un CSV. Devuelve self para encadenamiento.

        Detecta automáticamente la orientación (flat-top / pointy-top)
        comprobando si el CSV incluye 'Lado_N' (flat-top) o 'Lado_E' (pointy-top).
        Soporta coordenadas de columna multi-letra (AA, AB, …) para mapas ensamblados.
        """
        self.name = name or filepath
        with open(filepath, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            # Detectar orientación ANTES de iterar (fieldnames lee la cabecera)
            fieldnames = reader.fieldnames or []
            if 'Lado_N' in fieldnames:
                sides_to_read = self.FLAT_TOP_SIDES
                self.hex_type = 'flat-top'
            else:
                sides_to_read = self.POINTY_TOP_SIDES
                self.hex_type = 'pointy-top'

            for row_data in reader:
                coord_str = row_data.get('Coordenada', '').strip()
                if not coord_str:
                    continue
                # Separar parte alfabética (columna) de parte numérica (fila).
                # Soporta formato clásico "A1" y ensamblado "5A3" (prefijo de mapa).
                i = 0
                while i < len(coord_str) and coord_str[i].isdigit():
                    i += 1   # saltar prefijo numérico del mapa (si existe)
                j = i
                while j < len(coord_str) and coord_str[j].isalpha():
                    j += 1
                col_letter = coord_str[i:j]
                row_num    = int(coord_str[j:])
                col_idx    = self.col_letter_to_idx(col_letter)

                sides = {}
                for side in sides_to_read:
                    val = row_data.get(f'Lado_{side}', 'NO').strip().upper()
                    sides[side] = (val == 'SI')

                self.hexes[(col_idx, row_num)] = HexData(
                    terrain=row_data['Terreno'].strip(),
                    elevation=int(row_data.get('Elevacion', 0) or 0),
                    upper_level=(row_data.get('Upper_Level', 'NO').strip().upper() == 'SI'),
                    fortification=row_data.get('Fortificacion', 'NINGUNA').strip(),
                    sides=sides,
                )
        return self

    def export_csv(self, filepath: str):
        """Exporta la malla a CSV con coordenadas globales."""
        sides_order = (self.FLAT_TOP_SIDES if self.hex_type == 'flat-top'
                       else self.POINTY_TOP_SIDES)
        fieldnames = (['Coordenada', 'Terreno', 'Elevacion', 'Upper_Level', 'Fortificacion']
                      + [f'Lado_{s}' for s in sides_order])
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for (col_idx, row), hx in sorted(self.hexes.items()):
                coord_str = self.col_idx_to_letter(col_idx) + str(row)
                row_out = {
                    'Coordenada': coord_str,
                    'Terreno': hx.terrain,
                    'Elevacion': hx.elevation,
                    'Upper_Level': 'SI' if hx.upper_level else 'NO',
                    'Fortificacion': hx.fortification,
                }
                for side in sides_order:
                    row_out[f'Lado_{side}'] = 'SI' if hx.sides.get(side, False) else 'NO'
                writer.writerow(row_out)

    # ------------------------------------------------------------------
    # Utilidades de bounds
    # ------------------------------------------------------------------

    def get_dc_bounds(self):
        """Devuelve (dc_c_min, dc_c_max, dc_r_min, dc_r_max)."""
        if not self.hexes:
            return (0, 0, 0, 0)
        dcs = [self.coord_to_double(c, r) for (c, r) in self.hexes]
        dc_cols = [d[0] for d in dcs]
        dc_rows = [d[1] for d in dcs]
        return (min(dc_cols), max(dc_cols), min(dc_rows), max(dc_rows))

    def get_coord_bounds(self):
        """Devuelve (col_min, col_max, row_min, row_max) en coordenadas normales."""
        if not self.hexes:
            return (0, 0, 0, 0)
        cols = [c for (c, r) in self.hexes]
        rows = [r for (c, r) in self.hexes]
        return (min(cols), max(cols), min(rows), max(rows))

    # ------------------------------------------------------------------
    # Rotación
    # ------------------------------------------------------------------

    def rotate(self, angle: int) -> 'HexMesh':
        """
        Rota la malla angle grados en sentido horario (90, 180 o 270).
        - 180°: flat-top → flat-top
        - 90°/270°: flat-top → pointy-top (y viceversa)
        Devuelve una nueva HexMesh con coordenadas y lados actualizados.
        """
        if angle not in (90, 180, 270):
            raise ValueError(f"Ángulo no soportado: {angle}. Usa 90, 180 o 270.")

        dc_c_min, dc_c_max, dc_r_min, dc_r_max = self.get_dc_bounds()

        # Nuevo tipo de hexágono
        if angle == 180:
            new_type = self.hex_type
        else:
            new_type = 'pointy-top' if self.hex_type == 'flat-top' else 'flat-top'

        # Mapa de lados según ángulo y tipo de origen
        if self.hex_type == 'flat-top':
            side_maps = {90: self._SIDE_MAP_90CW, 180: self._SIDE_MAP_180,
                         270: self._SIDE_MAP_270CW}
        else:  # pointy-top
            side_maps = {90: self._SIDE_MAP_90CW_PT, 180: self._SIDE_MAP_180_PT,
                         270: self._SIDE_MAP_270CW_PT}
        side_map = side_maps[angle]

        new_mesh = HexMesh(new_type)
        new_mesh.name = f"{self.name} (rot{angle}°)"

        for (col_idx, row), hx in self.hexes.items():
            dc_c, dc_r = self.coord_to_double(col_idx, row)

            # Transformación en coordenadas dobles
            if angle == 90:
                new_dc_c = dc_r_max - dc_r
                new_dc_r = dc_c - dc_c_min
            elif angle == 180:
                new_dc_c = dc_c_max - dc_c + dc_c_min
                new_dc_r = dc_r_max - dc_r + dc_r_min
            else:  # 270
                new_dc_c = dc_r - dc_r_min
                new_dc_r = dc_c_max - dc_c

            new_coord = self.double_to_coord(new_dc_c, new_dc_r)
            if new_coord is None:
                continue  # no debería ocurrir con entrada válida

            new_sides = {side_map[k]: v for k, v in hx.sides.items()
                         if k in side_map}
            rotated_hx = hx.copy()
            rotated_hx.sides = new_sides
            new_mesh.hexes[new_coord] = rotated_hx

        return new_mesh

    # ------------------------------------------------------------------
    # Utilidades
    # ------------------------------------------------------------------

    def __repr__(self):
        col_min, col_max, row_min, row_max = self.get_coord_bounds()
        col_l = self.col_idx_to_letter(col_min)
        col_r = self.col_idx_to_letter(col_max)
        return (f"HexMesh('{self.name}', {self.hex_type}, "
                f"cols={col_l}-{col_r}, rows={row_min}-{row_max}, "
                f"hexs={len(self.hexes)})")
