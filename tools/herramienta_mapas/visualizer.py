"""
visualizer.py - Visualización gráfica de mapas hexagonales con matplotlib

Convención de coordenadas Cartesianas desde coordenadas dobles:
  x = dc_col * 1.5 * HEX_SIZE
  y = dc_row * (√3/2) * HEX_SIZE   (y crece hacia abajo)

Para flat-top, los vértices del hexágono están en ángulos 0°,60°,...,300°.
Para pointy-top, están en ángulos 30°,90°,...,330°.
"""

import math
from typing import Dict, List, Optional, Tuple

import matplotlib
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Polygon
from matplotlib.collections import PatchCollection
import numpy as np

from .hex_mesh import HexMesh, HexData, Coord

# --------------------------------------------------------------------------
# Paleta de colores por tipo de terreno
# --------------------------------------------------------------------------
TERRAIN_COLORS: Dict[str, str] = {
    'TERRENO ABIERTO': '#c8e890',   # verde lima claro – campo abierto
    'CARRETERA':       '#b8b090',   # beige grisáceo – asfalto/camino
    'BOSQUE':          '#70b850',   # verde medio – bosque
    'BOSQUE DENSO':    '#2e7828',   # verde oscuro saturado – bosque denso
    'PANTANO':         '#88c0a8',   # verde-azulado – pantano
    'AGUA':            '#70b8e8',   # azul cielo – agua
    'EDIFICIO':        '#e8d090',   # amarillo pálido – edificio genérico
    'EDIF. PIEDRA':    '#c0b8d8',   # lavanda grisácea – piedra
    'EDIF. MADERA':    '#e8a860',   # naranja cálido – madera
    'COLINA':          '#e8d870',   # amarillo dorado – colina
    'MONTE':           '#a8c060',   # oliva claro – monte
    'ESCOMBROS':       '#c8c0a8',   # gris arena – escombros
    'PARED':           '#909090',   # gris medio – pared
}
DEFAULT_TERRAIN_COLOR = '#d8d0c0'  # beige claro para terrenos desconocidos

HEX_SIZE = 1.0        # radio del hexágono (centro → vértice)
SQRT3 = math.sqrt(3)


def _terrain_color(terrain: str) -> str:
    for key, color in TERRAIN_COLORS.items():
        if key in terrain.upper():
            return color
    return DEFAULT_TERRAIN_COLOR


def _dc_to_xy(dc_col: int, dc_row: int, hex_type: str = 'flat-top') -> Tuple[float, float]:
    """Convierte coordenadas dobles a posición Cartesiana del centro.

    flat-top:   x = dc_col * 1.5,       y = dc_row * (√3/2)
    pointy-top: x = dc_col * (√3/2),    y = dc_row * 1.5
    (los factores están intercambiados entre orientaciones)
    """
    if hex_type == 'flat-top':
        x = dc_col * 1.5 * HEX_SIZE
        y = dc_row * (SQRT3 / 2) * HEX_SIZE
    else:  # pointy-top
        x = dc_col * (SQRT3 / 2) * HEX_SIZE
        y = dc_row * 1.5 * HEX_SIZE
    return x, y


def _hex_vertices(xc: float, yc: float, hex_type: str) -> np.ndarray:
    """Calcula los 6 vértices del hexágono."""
    start_angle = 0 if hex_type == 'flat-top' else 30
    angles = [math.radians(start_angle + 60 * k) for k in range(6)]
    return np.array([(xc + HEX_SIZE * math.cos(a),
                      yc + HEX_SIZE * math.sin(a)) for a in angles])


# Índices de vértices para cada lado (flat-top y pointy-top)
# Con invert_yaxis(), y positiva aparece abajo y y negativa arriba en pantalla.
# Vértices flat-top  (ángulos 0°,60°,120°,180°,240°,300°):
#   0(E-mid), 1(SE-low), 2(SW-low), 3(W-mid), 4(NW-high), 5(NE-high)
# Vértices pointy-top (ángulos 30°,90°,150°,210°,270°,330°):
#   0(E-low), 1(S-tip),  2(W-low),  3(W-high), 4(N-tip),  5(E-high)
SIDE_VERTICES_FLAT = {
    'N':  (4, 5),   # 240° y 300° → borde superior (top on screen)
    'NE': (5, 0),   # 300° y 0°   → borde superior-derecho
    'SE': (0, 1),   # 0°   y 60°  → borde inferior-derecho
    'S':  (1, 2),   # 60°  y 120° → borde inferior (bottom on screen)
    'SW': (2, 3),   # 120° y 180° → borde inferior-izquierdo
    'NW': (3, 4),   # 180° y 240° → borde superior-izquierdo
}
SIDE_VERTICES_POINTY = {
    'NE': (4, 5),   # 270° y 330° → borde superior-derecho
    'E':  (5, 0),   # 330° y 30°  → borde derecho
    'SE': (0, 1),   # 30°  y 90°  → borde inferior-derecho
    'SW': (1, 2),   # 90°  y 150° → borde inferior-izquierdo
    'W':  (2, 3),   # 150° y 210° → borde izquierdo
    'NW': (3, 4),   # 210° y 270° → borde superior-izquierdo
}


def draw_mesh(mesh: HexMesh,
              ax: Optional[plt.Axes] = None,
              title: str = '',
              show_coords: bool = True,
              show_terrain_legend: bool = True,
              figsize: Tuple[float, float] = None) -> plt.Axes:
    """
    Dibuja una HexMesh en ejes matplotlib.

    Parámetros:
        mesh: malla a dibujar
        ax: ejes matplotlib (se crea uno nuevo si es None)
        title: título del gráfico
        show_coords: si mostrar etiquetas de coordenadas
        show_terrain_legend: si mostrar la leyenda de terrenos
        figsize: tamaño de la figura (auto si None)

    Devuelve: el objeto Axes usado.
    """
    if not mesh.hexes:
        print("La malla está vacía.")
        return ax

    # Calcular bounds para dimensionar la figura
    dc_bounds = mesh.get_dc_bounds()
    dc_c_min, dc_c_max, dc_r_min, dc_r_max = dc_bounds

    x_min, y_min = _dc_to_xy(dc_c_min, dc_r_min, mesh.hex_type)
    x_max, y_max = _dc_to_xy(dc_c_max, dc_r_max, mesh.hex_type)
    pad = HEX_SIZE * 1.5

    if ax is None:
        width  = (x_max - x_min + 2 * pad) * 0.55 + 2
        height = (y_max - y_min + 2 * pad) * 0.55 + 1
        if figsize is None:
            figsize = (max(8, min(width, 24)), max(6, min(height, 18)))
        fig, ax = plt.subplots(figsize=figsize)
    else:
        fig = ax.get_figure()

    ax.set_aspect('equal')
    ax.set_facecolor('#e8ead8')   # fondo crema claro – contrasta con los terrenos
    if title:
        ax.set_title(title, fontsize=12, fontweight='bold', pad=10)

    side_vertices = (SIDE_VERTICES_FLAT if mesh.hex_type == 'flat-top'
                     else SIDE_VERTICES_POINTY)

    terrains_used = set()

    for (col_idx, row), hx in mesh.hexes.items():
        dc_c, dc_r = HexMesh.coord_to_double(col_idx, row)
        xc, yc = _dc_to_xy(dc_c, dc_r, mesh.hex_type)
        verts = _hex_vertices(xc, yc, mesh.hex_type)

        # Fondo del hexágono
        color = _terrain_color(hx.terrain)
        terrains_used.add(hx.terrain)
        poly = Polygon(verts, closed=True,
                       facecolor=color, edgecolor='#607060',
                       linewidth=0.6, zorder=1)
        ax.add_patch(poly)

        # Líneas de seto (lados con seto = True)
        for side, has_seto in hx.sides.items():
            if has_seto and side in side_vertices:
                vi, vj = side_vertices[side]
                px = [verts[vi][0], verts[vj][0]]
                py = [verts[vi][1], verts[vj][1]]
                ax.plot(px, py, color='#cc2200', linewidth=2.8, zorder=3,
                        solid_capstyle='round')

        # Etiqueta de coordenada
        if show_coords:
            coord_str = HexMesh.col_idx_to_letter(col_idx) + str(row)
            # Coordenada global: texto oscuro, centrado-superior del hex
            ax.text(xc, yc - HEX_SIZE * 0.10, coord_str,
                    ha='center', va='center',
                    fontsize=6.0, fontweight='bold',
                    color='#1a2010', zorder=4)
            # Abreviatura de terreno: texto oscuro tenue, centrado-inferior
            ax.text(xc, yc + HEX_SIZE * 0.32,
                    hx.terrain[:5].capitalize(),
                    ha='center', va='center',
                    fontsize=4.0, color='#304020', zorder=4)

    # Leyenda de terrenos (fuera del eje, a la derecha)
    if show_terrain_legend and terrains_used:
        legend_patches = []
        for terrain in sorted(terrains_used):
            c = _terrain_color(terrain)
            legend_patches.append(
                mpatches.Patch(facecolor=c, edgecolor='#607060',
                               label=terrain.capitalize()))
        # Leyenda de seto
        legend_patches.append(
            mpatches.Patch(facecolor='none', edgecolor='#cc2200',
                           linewidth=2.5, label='Seto'))
        leg = ax.legend(handles=legend_patches,
                        bbox_to_anchor=(1.02, 1), loc='upper left',
                        borderaxespad=0,
                        fontsize=7, framealpha=0.95, title='TERRENO',
                        title_fontsize=7)
        leg.get_frame().set_facecolor('#f5f5e8')
        leg.get_frame().set_edgecolor('#607060')
        leg.get_title().set_color('#1a2010')
        for text in leg.get_texts():
            text.set_color('#1a2010')

    # Configurar ejes
    ax.set_xlim(x_min - pad, x_max + pad)
    ax.set_ylim(y_min - pad, y_max + pad)
    ax.invert_yaxis()   # fila 0 arriba, como en el tablero físico
    ax.axis('off')

    # Reservar espacio a la derecha para la leyenda externa
    if show_terrain_legend and terrains_used:
        try:
            fig.tight_layout(rect=[0, 0, 0.82, 1])
        except Exception:
            pass

    return ax


def draw_assembly(meshes_with_labels: List[Tuple[HexMesh, str]],
                  assembled: HexMesh,
                  title: str = 'Montaje de mapas') -> plt.Figure:
    """
    Muestra un panel con:
      - Fila superior: los mapas individuales (con sus nombres)
      - Fila inferior: el mapa ensamblado final

    meshes_with_labels: lista de (HexMesh, etiqueta)
    assembled: malla ensamblada resultante
    """
    n = len(meshes_with_labels)
    fig = plt.figure(figsize=(max(14, n * 5), 12))
    fig.patch.set_facecolor('#fafaf5')

    # Subplots superiores: mapas individuales
    for i, (m, label) in enumerate(meshes_with_labels):
        ax = fig.add_subplot(2, max(n, 1), i + 1)
        draw_mesh(m, ax=ax, title=label,
                  show_coords=True, show_terrain_legend=(i == 0))

    # Subplot inferior: mapa ensamblado (ocupa toda la fila)
    ax_main = fig.add_subplot(2, 1, 2)
    draw_mesh(assembled, ax=ax_main, title=title,
              show_coords=True, show_terrain_legend=True)

    plt.tight_layout(pad=1.5)
    return fig


def show_single(mesh: HexMesh, title: str = '') -> plt.Figure:
    """Muestra un único mapa en su propia figura."""
    col_min, col_max, _, _ = mesh.get_coord_bounds()
    auto_title = title or (
        f"{mesh.name}  [{mesh.hex_type}]  "
        f"Cols: {HexMesh.col_idx_to_letter(col_min)}-"
        f"{HexMesh.col_idx_to_letter(col_max)}"
    )
    fig, ax = plt.subplots()
    draw_mesh(mesh, ax=ax, title=auto_title)
    plt.tight_layout()
    return fig
