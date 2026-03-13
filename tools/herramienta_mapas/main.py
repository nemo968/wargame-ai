"""
main.py - Herramienta de montaje de mapas hexagonales

Uso básico:
    python -m herramienta_mapas.main

Ejemplos programáticos al final del archivo.
"""

import sys
import os
import argparse
import matplotlib.pyplot as plt

# Añadir el directorio padre al path para importar el paquete
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from herramienta_mapas.hex_mesh import HexMesh
from herramienta_mapas.assembler import MapAssembler
from herramienta_mapas import visualizer as viz

MALLAS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           'Mallas')


def load_map(map_id: int) -> HexMesh:
    """Carga el mapa Map{map_id}.csv desde la carpeta Mallas."""
    filepath = os.path.join(MALLAS_DIR, f'Map{map_id}.csv')
    m = HexMesh()
    m.load_csv(filepath, name=f'Map{map_id}')
    return m


def demo_single_map(map_id: int = 1):
    """Muestra un mapa individual."""
    m = load_map(map_id)
    print(m)
    fig = viz.show_single(m, title=f'Map{map_id} (original)')
    plt.show()


def demo_rotation(map_id: int = 1, angle: int = 90):
    """Muestra un mapa y su versión rotada."""
    original = load_map(map_id)
    rotated = original.rotate(angle)
    print(f"Original: {original}")
    print(f"Rotado {angle}°: {rotated}")

    fig, axes = plt.subplots(1, 2, figsize=(14, 7))
    fig.suptitle(f'Rotación {angle}° – Map{map_id}', fontsize=13,
                 fontweight='bold')
    viz.draw_mesh(original, ax=axes[0],
                  title=f'Map{map_id} original ({original.hex_type})',
                  show_terrain_legend=True)
    viz.draw_mesh(rotated, ax=axes[1],
                  title=f'Map{map_id} rotado {angle}° ({rotated.hex_type})',
                  show_terrain_legend=False)
    plt.tight_layout()
    plt.show()


def demo_join_horizontal(map_id1: int = 1, rot1: int = 0,
                          map_id2: int = 2, rot2: int = 0):
    """Une dos mapas horizontalmente y visualiza el resultado."""
    m1 = load_map(map_id1)
    m2 = load_map(map_id2)

    asm = MapAssembler()
    asm.add_map(m1, grid_row=0, grid_col=0, rotation=rot1)
    asm.add_map(m2, grid_row=0, grid_col=1, rotation=rot2)
    joined = asm.assemble()

    label1 = f'Map{map_id1}' + (f' rot{rot1}°' if rot1 else '')
    label2 = f'Map{map_id2}' + (f' rot{rot2}°' if rot2 else '')
    print(f"Unión horizontal: {label1} + {label2}")
    print(f"Resultado: {joined}")

    fig = viz.draw_assembly(
        [(m1.rotate(rot1) if rot1 else m1, label1),
         (m2.rotate(rot2) if rot2 else m2, label2)],
        joined,
        title=f'Unión horizontal: {label1} | {label2}'
    )
    plt.show()


def demo_grid_2x2(ids=((1, 2), (3, 4)), rotations=((0, 180), (90, 270))):
    """
    Ensambla un grid 2×2 de mapas con rotaciones independientes.
    ids[fila][col], rotations[fila][col]
    """
    asm = MapAssembler()
    meshes_labels = []
    for gr in range(2):
        for gc in range(2):
            mid = ids[gr][gc]
            rot = rotations[gr][gc]
            m = load_map(mid)
            asm.add_map(m, grid_row=gr, grid_col=gc, rotation=rot)
            label = f'Map{mid}' + (f' rot{rot}°' if rot else '')
            meshes_labels.append((m.rotate(rot) if rot else m, label))

    joined = asm.assemble()
    print(f"Grid 2x2 ensamblado: {joined}")

    fig = viz.draw_assembly(meshes_labels, joined,
                            title='Montaje 2×2')
    plt.show()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        description='Herramienta de montaje de mapas hexagonales')
    sub = parser.add_subparsers(dest='command')

    # Comando: show
    p_show = sub.add_parser('show', help='Muestra un mapa individual')
    p_show.add_argument('map', type=int, help='ID del mapa (1-10)')
    p_show.add_argument('--rot', type=int, default=0, choices=[0,90,180,270],
                        help='Rotación en grados (default: 0)')

    # Comando: join
    p_join = sub.add_parser('join',
        help='Une mapas en una cuadrícula. '
             'Formato: --maps ID:ROT ID:ROT ... --layout ROWSxCOLS')
    p_join.add_argument('--maps', nargs='+', required=True,
        metavar='ID[:ROT]',
        help='Mapas a unir, ej: 1 2:180 3:90 (en orden fila por fila)')
    p_join.add_argument('--layout', default='1xN',
        help='Dimensiones del grid, ej: 2x2, 1x3 (default: 1xN)')
    p_join.add_argument('--output', default=None,
        help='Fichero CSV de salida para el mapa ensamblado')

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command == 'show':
        m = load_map(args.map)
        if args.rot:
            m = m.rotate(args.rot)
        print(m)
        viz.show_single(m)
        plt.show()

    elif args.command == 'join':
        # Parsear mapas
        entries = []
        for token in args.maps:
            parts = token.split(':')
            mid = int(parts[0])
            rot = int(parts[1]) if len(parts) > 1 else 0
            entries.append((mid, rot))

        # Parsear layout
        layout_parts = args.layout.lower().split('x')
        n_rows = int(layout_parts[0])
        n_cols = int(layout_parts[1]) if len(layout_parts) > 1 else len(entries)

        asm = MapAssembler()
        meshes_labels = []
        for i, (mid, rot) in enumerate(entries):
            gr = i // n_cols
            gc = i % n_cols
            m = load_map(mid)
            asm.add_map(m, grid_row=gr, grid_col=gc, rotation=rot)
            label = f'Map{mid}' + (f' rot{rot}°' if rot else '')
            meshes_labels.append((m.rotate(rot) if rot else m, label))

        joined = asm.assemble()
        print(joined)

        if args.output:
            joined.export_csv(args.output)
            print(f"CSV exportado: {args.output}")

        fig = viz.draw_assembly(meshes_labels, joined,
                                title='Montaje de mapas')
        plt.show()

    else:
        # Sin argumentos: ejecutar demo interactivo
        print("=== Demo: Map1 original ===")
        demo_single_map(1)

        print("\n=== Demo: Map1 rotado 180° ===")
        demo_rotation(1, 180)

        print("\n=== Demo: Map1 + Map2 horizontales ===")
        demo_join_horizontal(1, 0, 2, 0)


if __name__ == '__main__':
    main()
