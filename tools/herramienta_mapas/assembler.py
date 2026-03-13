"""
assembler.py - Ensamblaje y unión de mapas hexagonales

Soporta uniones ortogonales (horizontal y vertical) entre mapas.
Al unir dos mapas:
  - Unión horizontal: la columna I del mapa izquierdo y la columna A del
    mapa derecho se fusionan en una sola columna de semihexágonos completos.
  - Unión vertical: la fila inferior del mapa superior (B9,D9,F9,H9) y la
    fila superior del mapa inferior (B0,D0,F0,H0) se fusionan.

El ensamblador acepta un layout de cuadrícula:
    assembler.add_map(mesh, grid_row=0, grid_col=0, rotation=0)
    assembler.add_map(mesh, grid_row=0, grid_col=1, rotation=180)
    resultado = assembler.assemble()
"""

from typing import Dict, List, Optional, Tuple
from .hex_mesh import HexMesh, HexData, Coord

GridPos = Tuple[int, int]  # (grid_row, grid_col)


class MapAssembler:
    """
    Ensambla múltiples HexMesh en un mapa global único.

    Uso:
        asm = MapAssembler()
        asm.add_map(mesh1, grid_row=0, grid_col=0)
        asm.add_map(mesh2, grid_row=0, grid_col=1, rotation=180)
        asm.add_map(mesh3, grid_row=1, grid_col=0)
        resultado = asm.assemble()
    """

    def __init__(self):
        # Cada entrada: (grid_pos, mesh, rotation_angle)
        self._entries: List[Tuple[GridPos, HexMesh, int]] = []

    def add_map(self, mesh: HexMesh, grid_row: int = 0, grid_col: int = 0,
                rotation: int = 0, map_id: int = 0) -> 'MapAssembler':
        """
        Añade un mapa al layout.
        grid_row, grid_col: posición en la cuadrícula de mapas (0-based).
        rotation: 0, 90, 180 o 270 grados en sentido horario.
        map_id: número de mapa (prefijo en la coordenada de salida, p.ej. 5 → "5A3").
        """
        self._entries.append(((grid_row, grid_col), mesh, rotation, map_id))
        return self

    def assemble(self) -> HexMesh:
        """
        Calcula el mapa global uniendo todos los mapas añadidos.
        Devuelve una nueva HexMesh con coordenadas globales.
        """
        if not self._entries:
            return HexMesh()

        # 1. Estampar orig_map/orig_coord en copia limpia ANTES de rotar
        rotated: Dict[GridPos, HexMesh] = {}
        for (gpos, mesh, angle, map_id) in self._entries:
            marked = HexMesh(mesh.hex_type)
            marked.name = mesh.name
            for (col_idx, row), hx in mesh.hexes.items():
                new_hx = hx.copy()
                new_hx.orig_map = map_id
                new_hx.orig_coord = HexMesh.col_idx_to_letter(col_idx) + str(row)
                marked.hexes[(col_idx, row)] = new_hx
            rotated[gpos] = marked.rotate(angle) if angle != 0 else marked

        # 2. Ordenar posiciones de cuadrícula
        grid_rows = sorted(set(gpos[0] for gpos in rotated))
        grid_cols = sorted(set(gpos[1] for gpos in rotated))

        # 3. Unir columnas de la cuadrícula → una fila de mapas por cada grid_row
        row_meshes: Dict[int, HexMesh] = {}
        for gr in grid_rows:
            cols_in_row = [gc for gc in grid_cols if (gr, gc) in rotated]
            if not cols_in_row:
                continue
            row_mesh = rotated[(gr, cols_in_row[0])]
            for gc in cols_in_row[1:]:
                right = rotated[(gr, gc)]
                row_mesh = self._join_horizontal(row_mesh, right)
            row_meshes[gr] = row_mesh

        # 4. Unir filas entre sí verticalmente
        result = row_meshes[grid_rows[0]]
        for gr in grid_rows[1:]:
            result = self._join_vertical(result, row_meshes[gr])

        result.name = 'Mapa ensamblado'
        return result

    # ------------------------------------------------------------------
    # Unión horizontal (izquierda + derecha)
    # ------------------------------------------------------------------

    def _join_horizontal(self, left: HexMesh, right: HexMesh) -> HexMesh:
        """
        Une dos mapas horizontalmente.
        La columna derecha de `left` (col_max, semi-hexes) se fusiona con
        la columna izquierda de `right` (col_min, semi-hexes).
        El mapa resultante mantiene el tipo de hexágono del mapa izquierdo.
        """
        new_mesh = HexMesh(left.hex_type)
        new_mesh.name = f"{left.name}+{right.name}"

        l_col_min, l_col_max, _, _ = left.get_coord_bounds()
        r_col_min, r_col_max, _, _ = right.get_coord_bounds()

        # Offset para las columnas del mapa derecho en el sistema global:
        # la columna r_col_min del mapa derecho se fusiona con l_col_max del izquierdo
        # → las columnas r_col_min+1 .. r_col_max del derecho pasan a ser
        #    l_col_max+1 .. l_col_max+(r_col_max-r_col_min) en el global.
        col_offset = l_col_max - r_col_min  # para non-merged cols: idx_global = idx_right + col_offset

        # Volcar hexes del mapa izquierdo (sin la columna de borde si hay fusión)
        for (col_idx, row), hx in left.hexes.items():
            if col_idx == l_col_max:
                continue  # tratada en fusión
            new_mesh.hexes[(col_idx, row)] = hx.copy()

        # Fusionar la columna de borde
        for row in self._shared_rows_h(left, right, l_col_max, r_col_min):
            left_hx = left.hexes.get((l_col_max, row))
            right_hx = right.hexes.get((r_col_min, row))
            merged = self._merge_hex_h(left_hx, right_hx, left.hex_type)
            new_mesh.hexes[(l_col_max, row)] = merged

        # Volcar hexes del mapa derecho (excepto columna izquierda ya fusionada)
        for (col_idx, row), hx in right.hexes.items():
            if col_idx == r_col_min:
                continue  # ya fusionada
            new_col = col_idx + col_offset
            new_mesh.hexes[(new_col, row)] = hx.copy()

        return new_mesh

    def _shared_rows_h(self, left: HexMesh, right: HexMesh,
                        l_col: int, r_col: int) -> List[int]:
        """Filas que tienen hexes en ambas columnas de borde."""
        left_rows = {r for (c, r) in left.hexes if c == l_col}
        right_rows = {r for (c, r) in right.hexes if c == r_col}
        return sorted(left_rows | right_rows)

    def _merge_hex_h(self, left_hx: Optional[HexData],
                     right_hx: Optional[HexData],
                     hex_type: str) -> HexData:
        """
        Fusiona dos semihexágonos en uno completo.
        - Los lados interiores (NE, SE del izquierdo; NW, SW del derecho) son de cada mapa.
        - Los lados exteriores (NW,SW de izq + borde; NE,SE de der + borde) se combinan.
        """
        if left_hx is None and right_hx is not None:
            return right_hx.copy()
        if right_hx is None and left_hx is not None:
            return left_hx.copy()
        if left_hx is None and right_hx is None:
            return HexData('TERRENO ABIERTO', 0, False, 'NINGUNA',
                           {s: False for s in HexMesh.FLAT_TOP_SIDES})

        # Terreno y atributos del semihex izquierdo (por convención)
        base = left_hx.copy()

        # Lados: combinar por OR (si alguno tiene seto, el hex fusionado lo tiene)
        all_sides = set(left_hx.sides) | set(right_hx.sides)
        base.sides = {s: (left_hx.sides.get(s, False) or right_hx.sides.get(s, False))
                      for s in all_sides}
        return base

    # ------------------------------------------------------------------
    # Unión vertical (arriba + abajo)
    # ------------------------------------------------------------------

    def _join_vertical(self, top: HexMesh, bottom: HexMesh) -> HexMesh:
        """
        Une dos mapas verticalmente.
        La fila inferior de `top` (B9,D9,F9,H9 tipo) se fusiona con
        la fila superior de `bottom` (B0,D0,F0,H0 tipo).
        """
        new_mesh = HexMesh(top.hex_type)
        new_mesh.name = f"{top.name}+{bottom.name}"

        _, _, t_row_min, t_row_max = top.get_coord_bounds()
        _, _, b_row_min, b_row_max = bottom.get_coord_bounds()

        # Offset de filas para el mapa inferior:
        # La fila b_row_min del mapa inferior se fusiona con t_row_max del superior
        # Hexes de columnas pares: no tienen fila 0 en mapas individuales → se desplazan
        # Hexes de columnas impares: fila 0 es la fusionada → row_offset = t_row_max
        row_offset = t_row_max - b_row_min  # índice global = row_bottom + row_offset

        # Volcar hexes del mapa superior (sin la fila inferior si hay fusión)
        for (col_idx, row), hx in top.hexes.items():
            if row == t_row_max and col_idx % 2 == 1:
                continue  # fila de fusión (solo columnas impares tienen fila t_row_max)
            new_mesh.hexes[(col_idx, row)] = hx.copy()

        # Fusionar la fila de borde (solo columnas impares, que son las que tienen row=0/9)
        for col_idx in self._shared_odd_cols(top, bottom):
            top_hx = top.hexes.get((col_idx, t_row_max))
            bot_hx = bottom.hexes.get((col_idx, b_row_min))
            merged = self._merge_hex_v(top_hx, bot_hx, top.hex_type)
            new_mesh.hexes[(col_idx, t_row_max)] = merged

        # Volcar hexes del mapa inferior (excepto fila superior ya fusionada)
        for (col_idx, row), hx in bottom.hexes.items():
            if row == b_row_min and col_idx % 2 == 1:
                continue  # ya fusionada
            new_row = row + row_offset
            new_mesh.hexes[(col_idx, new_row)] = hx.copy()

        return new_mesh

    def _shared_odd_cols(self, top: HexMesh, bottom: HexMesh) -> List[int]:
        """Columnas impares presentes en ambos mapas (las que tienen fila de borde)."""
        top_odd = {c for (c, r) in top.hexes if c % 2 == 1}
        bot_odd = {c for (c, r) in bottom.hexes if c % 2 == 1}
        return sorted(top_odd & bot_odd)

    def _merge_hex_v(self, top_hx: Optional[HexData],
                     bot_hx: Optional[HexData],
                     hex_type: str) -> HexData:
        """Fusiona dos semihexágonos verticales en uno completo."""
        if top_hx is None and bot_hx is not None:
            return bot_hx.copy()
        if bot_hx is None and top_hx is not None:
            return top_hx.copy()
        if top_hx is None and bot_hx is None:
            return HexData('TERRENO ABIERTO', 0, False, 'NINGUNA',
                           {s: False for s in HexMesh.FLAT_TOP_SIDES})

        base = top_hx.copy()
        all_sides = set(top_hx.sides) | set(bot_hx.sides)
        base.sides = {s: (top_hx.sides.get(s, False) or bot_hx.sides.get(s, False))
                      for s in all_sides}
        return base
