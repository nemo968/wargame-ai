#!/usr/bin/env python3
"""
Creador_Escenarios.py — Herramienta de creación de escenarios para wargame
                         táctico hexagonal (Screaming Eagles).

Paneles:
  IZQUIERDO : carga de mapas CSV + log
  CENTRAL   : grid de ensamblaje drag-and-drop
  DERECHO   : tres pestañas
                ▸ VISUALIZADOR  — canvas matplotlib + inspector de hex
                ▸ ESCENARIO     — formulario completo del escenario
                ▸ UNIDADES      — selector de unidades por bando

Exportación CSV:
  El fichero de salida integra en secciones:
    [ESCENARIO]  datos generales
    [ALIADOS]    configuración del bando aliado
    [EJE]        configuración del bando eje
    [UNIDADES_ALIADOS] / [UNIDADES_EJE]
    [MAPA]       datos de hexes (formato estándar)
"""

import os, sys, datetime, math, re
from typing import Dict, Optional, Tuple, List

import tkinter as tk
from tkinter import filedialog, messagebox

import matplotlib
matplotlib.use('TkAgg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.figure import Figure

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from herramienta_mapas.hex_mesh import HexMesh, HexData
from herramienta_mapas.assembler import MapAssembler
from herramienta_mapas import visualizer as viz
from herramienta_mapas.visualizer import HEX_SIZE, SQRT3
from herramienta_mapas.unit_data import UnitType, UnitCategory, Faction
from herramienta_mapas.unit_loader import load_units, by_faction, by_category

# ══════════════════════════════════════════════════════════════════════════════
# Paleta de colores militares
# ══════════════════════════════════════════════════════════════════════════════

C = {
    'bg':      '#080f08',
    'panel':   '#0e1a0e',
    'frame':   '#141f14',
    'border':  '#2c5c2c',
    'green':   '#33ff33',
    'dim':     '#1d6b1d',
    'bright':  '#88ff44',
    'amber':   '#ffaa00',
    'red':     '#ff4444',
    'btn':     '#0a1e0a',
    'btn_hi':  '#153015',
    'sel':     '#1c381c',
    'canvas':  '#050d05',
    'asm':     '#060e06',
}

MF   = ('Courier New',  9)
MFB  = ('Courier New',  9, 'bold')
MFL  = ('Courier New', 11, 'bold')
MFXL = ('Courier New', 13, 'bold')
MFSM = ('Courier New',  8)

CELL_W, CELL_H = 125, 82

MAP_FILL = {
    1: '#0f2a0f', 2: '#1a2a0a', 3: '#0a1a2a', 4: '#2a1a0a',
    5: '#1a0a2a', 6: '#0a2a2a', 7: '#2a0a0a', 8: '#0a0a2a',
    9: '#2a2a0a', 10: '#0f1f0f',
}
MAP_BORDER = {
    1: '#1a5a1a', 2: '#3a5a0a', 3: '#1a3a5a', 4: '#5a3a0a',
    5: '#3a1a5a', 6: '#0a5a5a', 7: '#5a1a1a', 8: '#1a1a5a',
    9: '#5a5a0a', 10: '#2a3a2a',
}

ROT_OPTIONS    = ['0°', '90°', '180°', '270°']
COMPASS_DIRS   = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
FACTION_LABELS = ['American', 'German', 'Russian']

CAT_LABELS: Dict[UnitCategory, str] = {
    UnitCategory.SQUAD:     'ESCUADRAS',
    UnitCategory.WT_MG:     'WTs  AMETRALLADORA',
    UnitCategory.WT_MORTAR: 'WTs  MORTERO',
    UnitCategory.VEHICLE:   'VEHÍCULOS',
    UnitCategory.GUN:       'CAÑONES',
    UnitCategory.AIRCRAFT:  'AERONAVES',
    UnitCategory.DECOY:     'SEÑUELOS',
}

# Tipos de unidades neutrales (estáticos, no provienen del CSV de unidades)
NEUTRAL_TYPES = [
    'Foxhole',
    'Artillería 80mm',
    'Artillería 100mm',
    'Artillería 120mm',
    'Artillería 150mm',
]

UNITS_CSV = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'Unidades', 'SE_Units.csv')

# Orden canónico de categorías en el selector de unidades
_CAT_ORDER = [
    UnitCategory.SQUAD, UnitCategory.WT_MG, UnitCategory.WT_MORTAR,
    UnitCategory.VEHICLE, UnitCategory.GUN, UnitCategory.AIRCRAFT,
    UnitCategory.DECOY,
]
_FACTION_OPTIONS = ['TODAS', 'AMERICAN', 'GERMAN', 'RUSSIAN']
_FACTION_MAP     = {
    'AMERICAN': Faction.AMERICAN,
    'GERMAN':   Faction.GERMAN,
    'RUSSIAN':  Faction.RUSSIAN,
}
_CAT_LABEL_LIST = ['TODAS'] + [CAT_LABELS[c] for c in _CAT_ORDER]
_CAT_LABEL_REV  = {v: k for k, v in CAT_LABELS.items()}


# ══════════════════════════════════════════════════════════════════════════════
# Helpers de estilo
# ══════════════════════════════════════════════════════════════════════════════

def ml(parent, text='', color=None, font=None, textvariable=None, bg=None, **kw):
    kw.update(fg=color or C['green'], bg=bg or C['panel'], font=font or MF)
    if textvariable is not None:
        return tk.Label(parent, textvariable=textvariable, **kw)
    return tk.Label(parent, text=text, **kw)


def mb(parent, text, cmd, color=None, w=22, **kw):
    return tk.Button(
        parent, text=text, command=cmd,
        fg=color or C['bright'], bg=C['btn'],
        activeforeground=C['green'], activebackground=C['btn_hi'],
        font=MFB, relief='flat', bd=0, cursor='hand2', width=w,
        highlightbackground=C['border'], highlightthickness=1, **kw)


def style_om(om, fg=None):
    fg = fg or C['green']
    om.config(bg=C['btn'], fg=fg, font=MFSM,
              activebackground=C['btn_hi'], activeforeground=C['bright'],
              relief='flat', bd=0,
              highlightbackground=C['border'], highlightthickness=1)
    om['menu'].config(bg=C['btn'], fg=fg, font=MFSM, activebackground=C['sel'])


def hsep(parent, **kw):
    return tk.Frame(parent, height=1, bg=C['border'], **kw)


def sec_hdr(parent, title, bg=None):
    bg = bg or C['panel']
    f = tk.Frame(parent, bg=bg)
    f.pack(fill='x', padx=6, pady=(8, 3))
    tk.Label(f, text=f'▶ {title}', fg=C['bright'], bg=bg, font=MFB).pack(side='left')


def _entry(parent, var, w=None, fg=None, **kw):
    """Entry con estilo militar."""
    opts = dict(textvariable=var, bg=C['bg'], fg=fg or C['green'],
                font=MFSM, insertbackground=C['green'], relief='flat',
                highlightbackground=C['border'], highlightthickness=1)
    if w:
        opts['width'] = w
    opts.update(kw)
    return tk.Entry(parent, **opts)


def _spinbox(parent, var, lo=0, hi=30, w=4, fg=None):
    return tk.Spinbox(parent, textvariable=var, from_=lo, to=hi, width=w,
                      bg=C['btn'], fg=fg or C['amber'], font=MFSM,
                      buttonbackground=C['btn'],
                      highlightbackground=C['border'], highlightthickness=1)


def _text_box(parent, height=3):
    """Text widget con estilo militar."""
    frm = tk.Frame(parent, bg=C['bg'],
                   highlightbackground=C['border'], highlightthickness=1)
    frm.pack(fill='x', padx=6, pady=2)
    t = tk.Text(frm, height=height, bg=C['bg'], fg=C['green'],
                font=MFSM, relief='flat', bd=0, wrap='word',
                insertbackground=C['green'], selectbackground=C['sel'])
    t.pack(fill='x', padx=4, pady=4)
    return t


def _scrollable(parent, bg=None):
    """Devuelve (inner_frame, canvas) para contenido scrollable."""
    bg = bg or C['panel']
    canvas = tk.Canvas(parent, bg=bg, bd=0, highlightthickness=0)
    vsb = tk.Scrollbar(parent, orient='vertical', command=canvas.yview,
                       bg=C['panel'], troughcolor=C['bg'])
    canvas.configure(yscrollcommand=vsb.set)
    vsb.pack(side='right', fill='y')
    canvas.pack(side='left', fill='both', expand=True)
    inner = tk.Frame(canvas, bg=bg)
    win = canvas.create_window((0, 0), window=inner, anchor='nw')
    inner.bind('<Configure>', lambda e: (
        canvas.configure(scrollregion=canvas.bbox('all')),
        canvas.itemconfig(win, width=canvas.winfo_width())))
    canvas.bind('<Configure>', lambda e: canvas.itemconfig(win, width=e.width))
    canvas.bind('<MouseWheel>',
                lambda e: canvas.yview_scroll(int(-e.delta / 120), 'units'))
    return inner, canvas


# ══════════════════════════════════════════════════════════════════════════════
# MapCard — tarjeta draggable en el panel izquierdo
# ══════════════════════════════════════════════════════════════════════════════

class MapCard:
    def __init__(self, parent, map_id, name, filepath, app):
        self.map_id   = map_id
        self.name     = name
        self.filepath = filepath
        self.app      = app
        self._selected = False

        self.frame = tk.Frame(
            parent, bg=C['frame'],
            highlightbackground=C['border'], highlightthickness=1)

        top = tk.Frame(self.frame, bg=C['frame'])
        top.pack(fill='x', padx=4, pady=(4, 1))

        self._name_lbl = tk.Label(
            top, text=f'▌{name}', fg=C['bright'],
            bg=C['frame'], font=MFB, width=9, anchor='w')
        self._name_lbl.pack(side='left')

        self.rot_var = tk.StringVar(value='0°')
        rom = tk.OptionMenu(top, self.rot_var, *ROT_OPTIONS)
        style_om(rom, C['amber'])
        rom.config(width=3)
        rom.pack(side='right', padx=1)

        bot = tk.Frame(self.frame, bg=C['frame'])
        bot.pack(fill='x', padx=4, pady=(1, 4))

        mb(bot, '[ VER ]',
           lambda mid=map_id, fp=filepath: app._action_preview_map(mid, fp),
           color=C['dim'], w=7).pack(side='left')
        ml(bot, '⠿ drag', color=C['dim'],
           bg=C['frame'], font=MFSM).pack(side='right')

        for w in (self.frame, top, bot, self._name_lbl):
            w.bind('<ButtonPress-1>',   lambda e, c=self: app.on_card_press(e, c))
            w.bind('<B1-Motion>',       lambda e, c=self: app.on_card_drag(e, c))
            w.bind('<ButtonRelease-1>', lambda e, c=self: app.on_card_drop(e, c))

    def get_rotation(self): return int(self.rot_var.get().replace('°', ''))

    def set_selected(self, val):
        self._selected = val
        bord  = C['amber'] if val else C['border']
        color = C['amber'] if val else C['bright']
        self.frame.config(highlightbackground=bord)
        self._name_lbl.config(fg=color)

    def pack(self, **kw): self.frame.pack(**kw)


# ══════════════════════════════════════════════════════════════════════════════
# AssemblyGrid — canvas central de ensamblaje
# ══════════════════════════════════════════════════════════════════════════════

class AssemblyGrid:
    def __init__(self, parent, app):
        self.app  = app
        self.rows = 1
        self.cols = 2
        self._data: Dict[Tuple[int, int], Tuple[int, int]] = {}

        outer = tk.Frame(parent, bg=C['asm'])
        outer.pack(fill='both', expand=True)
        vsb = tk.Scrollbar(outer, orient='vertical',   bg=C['panel'], troughcolor=C['bg'])
        hsb = tk.Scrollbar(outer, orient='horizontal', bg=C['panel'], troughcolor=C['bg'])
        self._canvas = tk.Canvas(
            outer, bg=C['asm'], bd=0, highlightthickness=0,
            yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        vsb.config(command=self._canvas.yview)
        hsb.config(command=self._canvas.xview)
        vsb.pack(side='right',  fill='y')
        hsb.pack(side='bottom', fill='x')
        self._canvas.pack(fill='both', expand=True)
        self._canvas.bind('<Button-1>', self._on_click)
        self._canvas.bind('<Button-2>', self._on_rclick)
        self._canvas.bind('<Button-3>', self._on_rclick)
        self.redraw()

    def redraw(self):
        self._canvas.delete('all')
        w = self.cols * CELL_W + 10
        h = self.rows * CELL_H + 10
        self._canvas.config(scrollregion=(0, 0, w, h))
        for r in range(self.rows):
            for c in range(self.cols):
                self._draw_cell(r, c)

    def _draw_cell(self, r, c):
        x0 = c * CELL_W + 5;  y0 = r * CELL_H + 5
        x1 = x0 + CELL_W - 10; y1 = y0 + CELL_H - 10
        cx = (x0 + x1) // 2;  cy = (y0 + y1) // 2
        tag = f'cell_{r}_{c}'
        self._canvas.delete(tag)
        entry = self._data.get((r, c))
        if entry is None:
            self._canvas.create_rectangle(x0, y0, x1, y1,
                outline=C['dim'], dash=(5, 3), fill=C['asm'], tags=tag)
            self._canvas.create_text(cx, cy - 8, text='[ VACÍO ]',
                fill=C['dim'], font=MFB, tags=tag)
            self._canvas.create_text(cx, cy + 10, text=f'({r}, {c})',
                fill=C['dim'], font=MFSM, tags=tag)
        else:
            mid, rot = entry
            ci   = (mid - 1) % 10 + 1
            fill = MAP_FILL.get(ci,   C['frame'])
            bord = MAP_BORDER.get(ci, C['border'])
            self._canvas.create_rectangle(x0, y0, x1, y1,
                outline=bord, fill=fill, width=2, tags=tag)
            name = self.app._get_map_name(mid)
            self._canvas.create_text(cx, y0 + 17, text=f'▌ {name} ▐',
                fill=C['bright'], font=MFB, tags=tag)
            self._canvas.create_text(cx, y0 + 36, text=f'ROT  {rot}°',
                fill=C['amber'], font=MF, tags=tag)
            self._canvas.create_text(cx, y1 - 10, text=f'[{r}, {c}]',
                fill=bord, font=MFSM, tags=tag)

    def hit_test(self, cx, cy):
        c = cx // CELL_W;  r = cy // CELL_H
        return (r, c) if (0 <= r < self.rows and 0 <= c < self.cols) else None

    def place_map(self, r, c, map_id, rotation):
        self._data[(r, c)] = (map_id, rotation);  self._draw_cell(r, c)

    def clear_cell(self, r, c):
        self._data.pop((r, c), None);  self._draw_cell(r, c)

    def clear_all(self):
        self._data.clear();  self.redraw()

    def get_entries(self):
        return [(r, c, mid, rot) for (r, c), (mid, rot) in self._data.items()]

    def is_empty(self): return not self._data

    def add_row(self):    self.rows += 1;  self.redraw()
    def remove_row(self):
        if self.rows > 1:
            for c in range(self.cols): self._data.pop((self.rows - 1, c), None)
            self.rows -= 1;  self.redraw()
    def add_col(self):    self.cols += 1;  self.redraw()
    def remove_col(self):
        if self.cols > 1:
            for r in range(self.rows): self._data.pop((r, self.cols - 1), None)
            self.cols -= 1;  self.redraw()

    def _on_click(self, event):
        cx = int(self._canvas.canvasx(event.x))
        cy = int(self._canvas.canvasy(event.y))
        cell = self.hit_test(cx, cy)
        if cell: self.app._on_asm_cell_click(*cell)

    def _on_rclick(self, event):
        cx = int(self._canvas.canvasx(event.x))
        cy = int(self._canvas.canvasy(event.y))
        cell = self.hit_test(cx, cy)
        if cell: self.app._show_cell_menu(event.x_root, event.y_root, *cell)

    def screen_bbox(self):
        return (self._canvas.winfo_rootx(), self._canvas.winfo_rooty(),
                self._canvas.winfo_width(), self._canvas.winfo_height())


# ══════════════════════════════════════════════════════════════════════════════
# MilitaryApp — aplicación principal
# ══════════════════════════════════════════════════════════════════════════════

class MilitaryApp:

    def __init__(self, root: tk.Tk):
        self.root = root

        # ── Drag-and-drop ──────────────────────────────────────────
        self._selected_card: Optional[MapCard]  = None
        self._ghost: Optional[tk.Toplevel]      = None
        self._drag_start: Tuple[int, int]       = (0, 0)

        # ── Mapas ─────────────────────────────────────────────────
        self._cards: Dict[int, MapCard] = {}
        self._map_paths: Dict[int, str] = {}
        self._next_map_id = 1

        # ── Visualización ─────────────────────────────────────────
        self._current_mesh: Optional[HexMesh] = None
        self._current_fig:  Optional[Figure]  = None
        self._mpl_canvas   = None
        self._mpl_toolbar  = None
        self._mpl_cid      = None
        self._tb_frame     = None

        # ── Unidades (cargadas desde CSV) ─────────────────────────
        self._all_units: List[UnitType] = []
        # Lista de unidades asignadas por bando: [nombre, is_reducida, fichas, turno_entrada]
        self._selected_units: Dict[str, List] = {'aliados': [], 'eje': []}
        # Unidades neutrales: [nombre, fichas, turno_entrada]
        self._selected_neutrals: List = []
        # UI state del selector
        self._ul_faction_var:    Dict[str, tk.StringVar] = {}
        self._ul_cat_var:        Dict[str, tk.StringVar] = {}
        self._ul_listbox:        Dict[str, tk.Listbox]   = {}
        self._ul_count_var:      Dict[str, tk.IntVar]    = {}
        self._ul_entry_turn_var: Dict[str, tk.IntVar]    = {}
        self._ul_max_lbl:        Dict[str, tk.Label]     = {}
        self._ul_add_red_btn:    Dict[str, tk.Button]    = {}
        self._ul_sel_inner:      Dict[str, tk.Frame]     = {}
        self._ul_filtered_units: Dict[str, List]         = {'aliados': [], 'eje': []}
        # UI state del selector de neutrales (por bando)
        self._ul_neutral_inner:      Dict[str, Optional[tk.Frame]]   = {}
        self._ul_neutral_listbox:    Dict[str, Optional[tk.Listbox]] = {}
        self._ul_neutral_count_var:  Dict[str, tk.IntVar]            = {}
        self._ul_neutral_entry_turn: Dict[str, tk.IntVar]            = {}
        self._ul_neutral_prof_var:   Dict[str, tk.IntVar]            = {}
        self._ul_neutral_acc_var:    Dict[str, tk.IntVar]            = {}

        # ── Variables de escenario ─────────────────────────────────
        self._sce_titulo      = tk.StringVar()
        self._sce_turnos      = tk.IntVar(value=6)
        self._sce_norte       = tk.StringVar(value='N')
        self._sce_despliega_1 = tk.StringVar(value='American')
        self._sce_mueve_1     = tk.StringVar(value='American')
        self._sce_faccion     = {
            'aliados': tk.StringVar(value='American'),
            'eje':     tk.StringVar(value='German')}
        self._sce_ops_rango   = {
            'aliados': tk.StringVar(value='1-2'),
            'eje':     tk.StringVar(value='1-2')}
        self._sce_cmd_pts     = {
            'aliados': tk.IntVar(value=2),
            'eje':     tk.IntVar(value=2)}
        self._sce_ruta_huida  = {
            'aliados': tk.StringVar(value='S'),
            'eje':     tk.StringVar(value='N')}
        # Text widgets — se asignan en _build_scenario_form
        self._sce_descripcion:    Optional[tk.Text] = None
        self._sce_victoria:       Optional[tk.Text] = None
        self._sce_despliegue:     Dict[str, Optional[tk.Text]] = {
            'aliados': None, 'eje': None}
        self._sce_alt_despliegue: Dict[str, Optional[tk.Text]] = {
            'aliados': None, 'eje': None}

        self._setup_window()
        self._build_ui()
        self._load_units()
        self._tick()
        self._log('SISTEMA INICIALIZADO')
        self._status('ESPERANDO ÓRDENES', 'ok')

    # ── Window ─────────────────────────────────────────────────────

    def _setup_window(self):
        self.root.title('CREADOR DE ESCENARIOS — Tactical Hex Wargame')
        self.root.configure(bg=C['bg'])
        self.root.geometry('1480x880')
        self.root.minsize(1100, 700)

    # ── UI construction ────────────────────────────────────────────

    def _build_ui(self):
        self._build_header()
        body = tk.PanedWindow(
            self.root, orient='horizontal', bg=C['bg'],
            sashwidth=5, sashrelief='flat', sashpad=1, handlesize=0)
        body.pack(fill='both', expand=True, padx=4, pady=(0, 4))

        left = tk.Frame(body, bg=C['panel'],
                        highlightbackground=C['border'], highlightthickness=1)
        body.add(left, minsize=200, width=215)
        self._build_left(left)

        center = tk.Frame(body, bg=C['asm'],
                          highlightbackground=C['border'], highlightthickness=1)
        body.add(center, minsize=380)
        self._build_assembly(center)

        right = tk.Frame(body, bg=C['canvas'],
                         highlightbackground=C['border'], highlightthickness=1)
        body.add(right, minsize=340, width=540)
        self._build_right(right)

        self._build_statusbar()

    # ── Header ─────────────────────────────────────────────────────

    def _build_header(self):
        hdr = tk.Frame(self.root, bg=C['bg'],
                       highlightbackground=C['border'], highlightthickness=1)
        hdr.pack(fill='x', padx=4, pady=(4, 2))
        tk.Label(hdr, text='▌ CREADOR DE ESCENARIOS ▐',
                 fg=C['bright'], bg=C['bg'], font=MFXL).pack(
                     side='left', padx=10, pady=5)
        self._clock_lbl = tk.Label(hdr, text='', fg=C['dim'], bg=C['bg'], font=MF)
        self._clock_lbl.pack(side='right', padx=10)
        tk.Label(hdr, text='▓ SCREAMING EAGLES v1.0 ▓',
                 fg=C['dim'], bg=C['bg'], font=MFSM).pack(side='right', padx=10)

    # ── Status bar ─────────────────────────────────────────────────

    def _build_statusbar(self):
        sb = tk.Frame(self.root, bg=C['bg'],
                      highlightbackground=C['border'], highlightthickness=1)
        sb.pack(fill='x', padx=4, pady=(0, 4))
        self._status_dot = tk.Label(sb, text='●', fg=C['green'], bg=C['bg'], font=MF)
        self._status_dot.pack(side='left', padx=(6, 2))
        self._status_lbl = tk.Label(sb, text='SISTEMA LISTO',
                                    fg=C['green'], bg=C['bg'], font=MFB)
        self._status_lbl.pack(side='left')
        self._info_lbl = tk.Label(sb, text='', fg=C['dim'], bg=C['bg'], font=MF)
        self._info_lbl.pack(side='right', padx=10)

    # ── LEFT PANEL ─────────────────────────────────────────────────

    def _build_left(self, parent):
        scv = tk.Canvas(parent, bg=C['panel'], bd=0, highlightthickness=0)
        vsb = tk.Scrollbar(parent, orient='vertical', command=scv.yview,
                           bg=C['panel'], troughcolor=C['bg'])
        scv.configure(yscrollcommand=vsb.set)
        vsb.pack(side='right', fill='y')
        scv.pack(side='left', fill='both', expand=True)
        inner = tk.Frame(scv, bg=C['panel'])
        win_id = scv.create_window((0, 0), window=inner, anchor='nw')
        inner.bind('<Configure>', lambda e: (
            scv.configure(scrollregion=scv.bbox('all')),
            scv.itemconfig(win_id, width=scv.winfo_width())))
        scv.bind('<Configure>', lambda e: scv.itemconfig(win_id, width=e.width))
        scv.bind('<MouseWheel>',
                 lambda e: scv.yview_scroll(int(-e.delta / 120), 'units'))
        self._build_map_list(inner)
        hsep(inner).pack(fill='x', padx=6, pady=4)
        self._build_log_section(inner)

    def _build_map_list(self, parent):
        sec_hdr(parent, 'MAPAS DISPONIBLES')
        self._cards_container = tk.Frame(parent, bg=C['panel'])
        self._cards_container.pack(fill='x', padx=6)
        self._no_maps_lbl = ml(
            self._cards_container,
            'Sin mapas cargados.\nUsa el botón de abajo.',
            color=C['dim'], bg=C['panel'], font=MFSM, justify='center')
        self._no_maps_lbl.pack(pady=8)
        hsep(parent).pack(fill='x', padx=6, pady=6)
        mb(parent, '+ CARGAR CSV', self._action_load_csv,
           color=C['dim'], w=24).pack(padx=6, pady=2, fill='x')

    def _build_log_section(self, parent):
        sec_hdr(parent, 'REGISTRO')
        bg_f = tk.Frame(parent, bg=C['bg'],
                        highlightbackground=C['border'], highlightthickness=1)
        bg_f.pack(fill='x', padx=6, pady=2)
        self._log_text = tk.Text(
            bg_f, height=8, width=24, bg=C['bg'], fg=C['dim'],
            font=MFSM, relief='flat', bd=0, state='disabled',
            wrap='word', insertbackground=C['green'])
        self._log_text.pack(padx=4, pady=4)

    # ── CENTER PANEL ───────────────────────────────────────────────

    def _build_assembly(self, parent):
        bar = tk.Frame(parent, bg=C['asm'])
        bar.pack(fill='x', padx=4, pady=(4, 2))
        ml(bar, '▶ ZONA DE ENSAMBLAJE', color=C['bright'],
           bg=C['asm'], font=MFB).pack(side='left')
        ml(bar, 'Arrastra mapa → grid  |  Clic tarjeta → clic celda  |  ⊞ → opciones',
           color=C['dim'], bg=C['asm'], font=MFSM).pack(side='right', padx=4)
        ctrl = tk.Frame(parent, bg=C['asm'])
        ctrl.pack(fill='x', padx=4, pady=2)
        for txt, cmd, col in [
            ('+FILA',  lambda: self._asm.add_row(),    C['dim']),
            ('-FILA',  lambda: self._asm.remove_row(), C['dim']),
            ('+COL',   lambda: self._asm.add_col(),    C['dim']),
            ('-COL',   lambda: self._asm.remove_col(), C['dim']),
        ]:
            mb(ctrl, txt, cmd, color=col, w=6).pack(side='left', padx=2)
        hsep(parent).pack(fill='x', padx=4, pady=(2, 0))
        asm_frame = tk.Frame(parent, bg=C['asm'])
        asm_frame.pack(fill='both', expand=True, padx=4, pady=4)
        self._asm = AssemblyGrid(asm_frame, self)
        hsep(parent).pack(fill='x', padx=4)
        btns = tk.Frame(parent, bg=C['asm'])
        btns.pack(fill='x', padx=4, pady=6)
        mb(btns, '[ ENSAMBLAR ]',    self._action_assemble,
           color=C['bright'], w=14).pack(side='left', padx=2)
        mb(btns, '[ EXPORTAR CSV ]', self._action_export_csv,
           color=C['amber'],  w=15).pack(side='left', padx=2)
        mb(btns, '[ LIMPIAR ]',      self._action_clear_assembly,
           color=C['red'],    w=10).pack(side='left', padx=2)

    # ══════════════════════════════════════════════════════════════
    # RIGHT PANEL — tres pestañas: VIS | ESCENARIO | UNIDADES
    # ══════════════════════════════════════════════════════════════

    def _build_right(self, parent):
        # ── Barra de pestañas ─────────────────────────────────────
        tab_bar = tk.Frame(parent, bg=C['bg'],
                           highlightbackground=C['border'], highlightthickness=1)
        tab_bar.pack(fill='x', padx=2, pady=(2, 0))

        self._tab_frames: Dict[str, tk.Frame] = {}
        self._tab_btns:   Dict[str, tk.Button] = {}

        for tid, label, bg in [
            ('vis', 'VISUALIZADOR', C['canvas']),
            ('sce', 'ESCENARIO',   C['panel']),
            ('uni', 'UNIDADES',    C['panel']),
        ]:
            btn = tk.Button(
                tab_bar, text=label,
                command=lambda t=tid: self._show_tab(t),
                bg=C['btn'], fg=C['dim'], font=MFB,
                relief='flat', bd=0, cursor='hand2', padx=8, pady=3,
                activeforeground=C['bright'], activebackground=C['btn_hi'],
                highlightthickness=0)
            btn.pack(side='left', padx=1, pady=2)
            self._tab_btns[tid] = btn

            frame = tk.Frame(parent, bg=bg)
            self._tab_frames[tid] = frame

        self._build_vis_tab(self._tab_frames['vis'])
        self._build_scenario_tab(self._tab_frames['sce'])
        self._build_units_tab(self._tab_frames['uni'])
        self._show_tab('vis')

    def _show_tab(self, tab_id: str):
        for tid, frame in self._tab_frames.items():
            if tid == tab_id:
                frame.pack(fill='both', expand=True)
            else:
                frame.pack_forget()
        for tid, btn in self._tab_btns.items():
            if tid == tab_id:
                btn.config(fg=C['bright'], bg=C['frame'])
            else:
                btn.config(fg=C['dim'], bg=C['btn'])

    # ── Pestaña VISUALIZADOR ──────────────────────────────────────

    def _build_vis_tab(self, parent):
        self._build_vis_canvas(parent)
        hsep(parent).pack(fill='x', padx=4, pady=2)
        self._build_hex_inspector(parent)
        hsep(parent).pack(fill='x', padx=4, pady=2)
        self._build_vis_options(parent)

    def _build_vis_canvas(self, parent):
        bar = tk.Frame(parent, bg=C['canvas'])
        bar.pack(fill='x', padx=4, pady=(4, 0))
        self._vis_title = ml(bar, 'VISUALIZACIÓN', color=C['dim'],
                             bg=C['canvas'], font=MFB)
        self._vis_title.pack(side='left')
        self._plot_frame = tk.Frame(parent, bg=C['canvas'])
        self._plot_frame.pack(fill='both', expand=True, padx=4, pady=2)
        self._placeholder = tk.Label(
            self._plot_frame,
            text='\n\n\n▓▓▓  SIN DATOS  ▓▓▓\n\n'
                 'Seleccione un mapa\no configure y ensamble\nel grid central',
            fg=C['dim'], bg=C['canvas'], font=MFB, justify='center')
        self._placeholder.pack(expand=True)

    def _build_hex_inspector(self, parent):
        sec_hdr(parent, 'INSPECTOR DE HEX', bg=C['canvas'])
        insp = tk.Frame(parent, bg=C['frame'],
                        highlightbackground=C['border'], highlightthickness=1)
        insp.pack(fill='x', padx=6, pady=2)
        self._insp_vars: Dict[str, tk.StringVar] = {}
        for key, default in [
            ('COORD',   '—'), ('TERRENO', '—'),
            ('ELEVAC',  '—'), ('SETOS',   '—'),
        ]:
            row = tk.Frame(insp, bg=C['frame'])
            row.pack(fill='x', padx=6, pady=1)
            ml(row, f'{key:<8}:', color=C['dim'],
               bg=C['frame'], font=MFSM).pack(side='left')
            v = tk.StringVar(value=default)
            self._insp_vars[key] = v
            ml(row, textvariable=v, bg=C['frame'], font=MFSM).pack(side='left')
        ml(insp, 'Haz clic en un hex para inspeccionarlo',
           color=C['dim'], bg=C['frame'],
           font=('Courier New', 7)).pack(padx=4, pady=(0, 4))

    def _build_vis_options(self, parent):
        sec_hdr(parent, 'OPCIONES DE VISTA', bg=C['canvas'])
        opts = tk.Frame(parent, bg=C['canvas'])
        opts.pack(fill='x', padx=8, pady=2)
        self._show_coords = tk.BooleanVar(value=True)
        self._show_legend = tk.BooleanVar(value=True)
        for var, label in [(self._show_coords, 'COORDENADAS'),
                           (self._show_legend, 'LEYENDA')]:
            tk.Checkbutton(
                opts, text=label, variable=var,
                command=self._redraw_current,
                bg=C['canvas'], fg=C['green'], font=MFSM,
                activebackground=C['canvas'], activeforeground=C['bright'],
                selectcolor=C['frame'], relief='flat', bd=0
            ).pack(anchor='w')
        mb(parent, '[ GUARDAR IMAGEN PNG ]', self._action_save_image,
           color=C['dim'], w=24).pack(padx=6, pady=6, fill='x')

    # ── Pestaña ESCENARIO ─────────────────────────────────────────

    def _build_scenario_tab(self, parent):
        inner, _ = _scrollable(parent, bg=C['panel'])
        self._build_scenario_form(inner)

    def _build_scenario_form(self, p):
        """Construye el formulario completo del escenario."""
        bg = C['panel']

        def lbl_row(txt):
            f = tk.Frame(p, bg=bg)
            f.pack(fill='x', padx=6, pady=(2, 0))
            ml(f, txt, color=C['dim'], font=MFSM, bg=bg).pack(side='left')
            return f

        # ── Datos generales ───────────────────────────────────────
        sec_hdr(p, 'DATOS GENERALES', bg=bg)

        # Título
        r = lbl_row('TÍTULO DEL ESCENARIO:')
        _entry(r, self._sce_titulo).pack(side='left', fill='x', expand=True, padx=4)

        # Turnos + Norte
        r = tk.Frame(p, bg=bg)
        r.pack(fill='x', padx=6, pady=2)
        ml(r, 'TURNOS:', color=C['dim'], font=MFSM, bg=bg).pack(side='left')
        _spinbox(r, self._sce_turnos, lo=1, hi=30).pack(side='left', padx=(2, 14))
        ml(r, 'NORTE GEOGRÁFICO:', color=C['dim'], font=MFSM, bg=bg).pack(side='left')
        om = tk.OptionMenu(r, self._sce_norte, *COMPASS_DIRS)
        style_om(om, C['amber']); om.config(width=3); om.pack(side='left', padx=2)

        # Despliega / Mueve primero
        r = tk.Frame(p, bg=bg)
        r.pack(fill='x', padx=6, pady=2)
        ml(r, 'DESPLIEGA 1.º:', color=C['dim'], font=MFSM, bg=bg).pack(side='left')
        om = tk.OptionMenu(r, self._sce_despliega_1, *FACTION_LABELS)
        style_om(om, C['green']); om.config(width=9); om.pack(side='left', padx=(2, 10))
        ml(r, 'MUEVE 1.º:', color=C['dim'], font=MFSM, bg=bg).pack(side='left')
        om = tk.OptionMenu(r, self._sce_mueve_1, *FACTION_LABELS)
        style_om(om, C['green']); om.config(width=9); om.pack(side='left', padx=2)

        # Descripción histórica
        sec_hdr(p, 'DESCRIPCIÓN HISTÓRICA', bg=bg)
        self._sce_descripcion = _text_box(p, height=4)

        # Condiciones de victoria
        sec_hdr(p, 'CONDICIONES DE VICTORIA', bg=bg)
        self._sce_victoria = _text_box(p, height=3)

        # ── Sección por bando ─────────────────────────────────────
        for side, label, default_fac, default_ruta in [
            ('aliados', 'ALIADOS', 'American', 'S'),
            ('eje',     'EJE',     'German',   'N'),
        ]:
            tk.Frame(p, height=2, bg=C['border']).pack(fill='x', padx=6, pady=(14, 0))
            tk.Label(p, text=f'▓ {label}', fg=C['amber'], bg=bg,
                     font=MFL).pack(anchor='w', padx=8, pady=(4, 0))

            # Facción del bando
            r = lbl_row('FACCIÓN:')
            om = tk.OptionMenu(r, self._sce_faccion[side], *FACTION_LABELS)
            style_om(om, C['green']); om.config(width=9); om.pack(side='left', padx=2)

            # Ops Range + CPs
            r = tk.Frame(p, bg=bg)
            r.pack(fill='x', padx=6, pady=2)
            ml(r, 'OPS. RANGE:', color=C['dim'], font=MFSM, bg=bg).pack(side='left')
            _entry(r, self._sce_ops_rango[side], w=6).pack(
                side='left', padx=(2, 12))
            ml(r, 'CMD. POINTS:', color=C['dim'], font=MFSM, bg=bg).pack(side='left')
            _spinbox(r, self._sce_cmd_pts[side], lo=0, hi=10, w=3).pack(
                side='left', padx=2)

            # Ruta de huida
            r = lbl_row('RUTA DE HUIDA (dirección):')
            om = tk.OptionMenu(r, self._sce_ruta_huida[side], *COMPASS_DIRS)
            style_om(om, C['amber']); om.config(width=3); om.pack(side='left', padx=2)

            # Despliegue inicial
            sec_hdr(p, f'DESPLIEGUE INICIAL — {label}', bg=bg)
            self._sce_despliegue[side] = _text_box(p, height=3)

            # Despliegue alternativo
            sec_hdr(p, f'DESPLIEGUE ALTERNATIVO — {label}', bg=bg)
            self._sce_alt_despliegue[side] = _text_box(p, height=2)

        # Padding final
        tk.Frame(p, height=20, bg=bg).pack()

    # ── Pestaña UNIDADES ──────────────────────────────────────────

    def _build_units_tab(self, parent):
        # Sub-barra ALIADOS / EJE
        bar = tk.Frame(parent, bg=C['bg'],
                       highlightbackground=C['border'], highlightthickness=1)
        bar.pack(fill='x', padx=2, pady=(2, 0))

        self._unit_side_frames: Dict[str, tk.Frame] = {}
        self._unit_side_btns:   Dict[str, tk.Button] = {}

        for side, label in [('aliados', 'ALIADOS'), ('eje', 'EJE')]:
            btn = tk.Button(
                bar, text=label,
                command=lambda s=side: self._show_unit_side(s),
                bg=C['btn'], fg=C['dim'], font=MFB,
                relief='flat', bd=0, cursor='hand2', padx=10, pady=3,
                activeforeground=C['bright'], activebackground=C['btn_hi'],
                highlightthickness=0)
            btn.pack(side='left', padx=1, pady=2)
            self._unit_side_btns[side] = btn

            frame = tk.Frame(parent, bg=C['panel'])
            self._unit_side_frames[side] = frame
            self._build_unit_selector(frame, side)

        self._show_unit_side('aliados')

    def _show_unit_side(self, side: str):
        for s, frame in self._unit_side_frames.items():
            if s == side: frame.pack(fill='both', expand=True)
            else:         frame.pack_forget()
        for s, btn in self._unit_side_btns.items():
            btn.config(fg=C['bright'] if s == side else C['dim'],
                       bg=C['frame']  if s == side else C['btn'])

    def _build_unit_selector(self, parent, side: str):
        """Selector tipo listbox: filtros → lista → fichas → añadir → asignadas."""
        # ── Filtros ─────────────────────────────────────────────────
        fbar = tk.Frame(parent, bg=C['panel'])
        fbar.pack(fill='x', padx=4, pady=(4, 2))

        ml(fbar, 'FAC:', color=C['dim'], font=MFSM).pack(side='left')
        # Opciones de facción restringidas por bando
        if side == 'aliados':
            _faction_opts = ['TODAS', 'AMERICAN', 'RUSSIAN']
            _faction_default = 'AMERICAN'
        else:  # eje
            _faction_opts = ['GERMAN']
            _faction_default = 'GERMAN'
        vf = tk.StringVar(value=_faction_default)
        self._ul_faction_var[side] = vf
        om_f = tk.OptionMenu(fbar, vf, *_faction_opts,
                             command=lambda _=None, s=side: self._ul_refresh_list(s))
        style_om(om_f)
        om_f['menu'].config(font=MFSM)
        om_f.config(width=8)
        om_f.pack(side='left', padx=2)

        ml(fbar, 'TIPO:', color=C['dim'], font=MFSM).pack(side='left', padx=(6, 0))
        vc = tk.StringVar(value='TODAS')
        self._ul_cat_var[side] = vc
        om_c = tk.OptionMenu(fbar, vc, *_CAT_LABEL_LIST,
                             command=lambda _=None, s=side: self._ul_refresh_list(s))
        style_om(om_c)
        om_c['menu'].config(font=MFSM)
        om_c.config(width=16)
        om_c.pack(side='left', padx=2)

        # ── Listbox de unidades disponibles ──────────────────────────
        lbf = tk.Frame(parent, bg=C['frame'],
                       highlightbackground=C['border'], highlightthickness=1)
        lbf.pack(fill='x', padx=4, pady=2)

        vsb = tk.Scrollbar(lbf, orient='vertical', bg=C['panel'], troughcolor=C['bg'])
        lb = tk.Listbox(
            lbf, height=7, bg=C['frame'], fg=C['bright'], font=MFSM,
            selectbackground=C['sel'], selectforeground=C['bright'],
            yscrollcommand=vsb.set, bd=0, highlightthickness=0,
            activestyle='none', exportselection=False)
        vsb.config(command=lb.yview)
        vsb.pack(side='right', fill='y')
        lb.pack(side='left', fill='x', expand=True, padx=2, pady=2)
        self._ul_listbox[side] = lb
        lb.bind('<<ListboxSelect>>', lambda e, s=side: self._ul_on_select(s))

        # ── Fila 1: cantidad + turno de entrada ──────────────────────
        ctrl1 = tk.Frame(parent, bg=C['panel'])
        ctrl1.pack(fill='x', padx=4, pady=(2, 0))

        ml(ctrl1, 'Fichas:', color=C['dim'], font=MFSM).pack(side='left')
        vcnt = tk.IntVar(value=1)
        self._ul_count_var[side] = vcnt
        _spinbox(ctrl1, vcnt, lo=1, hi=99, w=3).pack(side='left', padx=4)

        max_lbl = ml(ctrl1, '/ —', color=C['dim'], font=MFSM)
        max_lbl.pack(side='left')
        self._ul_max_lbl[side] = max_lbl

        ml(ctrl1, '  Turno entrada:', color=C['dim'], font=MFSM).pack(side='left', padx=(8, 0))
        et_var = tk.IntVar(value=1)
        self._ul_entry_turn_var[side] = et_var
        _spinbox(ctrl1, et_var, lo=1, hi=30, w=3).pack(side='left', padx=2)

        # ── Fila 2: botones añadir ────────────────────────────────────
        ctrl2 = tk.Frame(parent, bg=C['panel'])
        ctrl2.pack(fill='x', padx=4, pady=(2, 1))

        mb(ctrl2, '+ COMPLETA',
           lambda s=side: self._ul_add_unit(s, False),
           color=C['green'], w=12).pack(side='left', padx=(0, 2))

        red_btn = mb(ctrl2, '+ REDUCIDA',
                     lambda s=side: self._ul_add_unit(s, True),
                     color=C['amber'], w=12)
        red_btn.pack(side='left', padx=2)
        red_btn.config(state='disabled')
        self._ul_add_red_btn[side] = red_btn

        # ── Lista de unidades asignadas ───────────────────────────────
        hsep(parent).pack(fill='x', padx=6, pady=3)
        sec_hdr(parent, 'UNIDADES ASIGNADAS')

        inner, _ = _scrollable(parent, bg=C['panel'])
        self._ul_sel_inner[side] = inner
        ml(inner, '(ninguna unidad asignada)',
           color=C['dim'], font=MFSM, justify='center').pack(pady=10)

        # ── Objetos neutrales ─────────────────────────────────────────
        hsep(parent).pack(fill='x', padx=6, pady=3)
        sec_hdr(parent, 'OBJETOS NEUTRALES')

        lbf2 = tk.Frame(parent, bg=C['frame'],
                        highlightbackground=C['border'], highlightthickness=1)
        lbf2.pack(fill='x', padx=4, pady=2)
        vsb2 = tk.Scrollbar(lbf2, orient='vertical', bg=C['panel'], troughcolor=C['bg'])
        lb2 = tk.Listbox(
            lbf2, height=len(NEUTRAL_TYPES), bg=C['frame'], fg=C['bright'], font=MFSM,
            selectbackground=C['sel'], selectforeground=C['bright'],
            yscrollcommand=vsb2.set, bd=0, highlightthickness=0,
            activestyle='none', exportselection=False)
        vsb2.config(command=lb2.yview)
        vsb2.pack(side='right', fill='y')
        lb2.pack(side='left', fill='x', expand=True, padx=2, pady=2)
        self._ul_neutral_listbox[side] = lb2
        for nt in NEUTRAL_TYPES:
            lb2.insert('end', nt)

        nctrl = tk.Frame(parent, bg=C['panel'])
        nctrl.pack(fill='x', padx=4, pady=(2, 1))
        ml(nctrl, 'Fichas:', color=C['dim'], font=MFSM).pack(side='left')
        ncnt = tk.IntVar(value=1)
        self._ul_neutral_count_var[side] = ncnt
        _spinbox(nctrl, ncnt, lo=1, hi=99, w=3).pack(side='left', padx=4)
        ml(nctrl, '  Turno:', color=C['dim'], font=MFSM).pack(side='left', padx=(8, 0))
        net = tk.IntVar(value=1)
        self._ul_neutral_entry_turn[side] = net
        _spinbox(nctrl, net, lo=1, hi=30, w=3).pack(side='left', padx=2)
        ml(nctrl, '  Prof:', color=C['dim'], font=MFSM).pack(side='left', padx=(8, 0))
        nprof = tk.IntVar(value=0)
        self._ul_neutral_prof_var[side] = nprof
        _spinbox(nctrl, nprof, lo=0, hi=10, w=3).pack(side='left', padx=2)
        ml(nctrl, '  Acc:', color=C['dim'], font=MFSM).pack(side='left', padx=(8, 0))
        nacc = tk.IntVar(value=0)
        self._ul_neutral_acc_var[side] = nacc
        _spinbox(nctrl, nacc, lo=0, hi=10, w=3).pack(side='left', padx=2)
        mb(nctrl, '+ AÑADIR',
           lambda s=side: self._neutral_add_unit(s),
           color=C['green'], w=10).pack(side='left', padx=(8, 2))

        sec_hdr(parent, 'OBJETOS ASIGNADOS')
        ninner, _ = _scrollable(parent, bg=C['panel'])
        self._ul_neutral_inner[side] = ninner
        ml(ninner, '(ningún objeto asignado)',
           color=C['dim'], font=MFSM, justify='center').pack(pady=6)

    def _build_neutral_selector(self, parent):
        """Selector de objetos neutrales (foxholes, artillería)."""
        sec_hdr(parent, 'OBJETOS NEUTRALES')

        # Listbox con los tipos neutrales disponibles
        lbf = tk.Frame(parent, bg=C['frame'],
                       highlightbackground=C['border'], highlightthickness=1)
        lbf.pack(fill='x', padx=4, pady=4)
        vsb = tk.Scrollbar(lbf, orient='vertical', bg=C['panel'], troughcolor=C['bg'])
        lb = tk.Listbox(
            lbf, height=len(NEUTRAL_TYPES), bg=C['frame'], fg=C['bright'], font=MFSM,
            selectbackground=C['sel'], selectforeground=C['bright'],
            yscrollcommand=vsb.set, bd=0, highlightthickness=0,
            activestyle='none', exportselection=False)
        vsb.config(command=lb.yview)
        vsb.pack(side='right', fill='y')
        lb.pack(side='left', fill='x', expand=True, padx=2, pady=2)
        self._ul_neutral_listbox = lb
        for nt in NEUTRAL_TYPES:
            lb.insert('end', nt)

        # Controles de cantidad y turno
        ctrl = tk.Frame(parent, bg=C['panel'])
        ctrl.pack(fill='x', padx=4, pady=(2, 1))
        ml(ctrl, 'Fichas:', color=C['dim'], font=MFSM).pack(side='left')
        _spinbox(ctrl, self._ul_neutral_count_var, lo=1, hi=99, w=3).pack(
            side='left', padx=4)
        ml(ctrl, '  Turno:', color=C['dim'], font=MFSM).pack(side='left', padx=(8, 0))
        _spinbox(ctrl, self._ul_neutral_entry_turn, lo=1, hi=30, w=3).pack(
            side='left', padx=2)

        mb(ctrl, '+ AÑADIR',
           self._neutral_add_unit,
           color=C['green'], w=10).pack(side='left', padx=(8, 2))

        # Lista de objetos neutrales asignados
        hsep(parent).pack(fill='x', padx=6, pady=3)
        sec_hdr(parent, 'OBJETOS ASIGNADOS')
        inner, _ = _scrollable(parent, bg=C['panel'])
        self._ul_neutral_inner = inner
        ml(inner, '(ningún objeto asignado)',
           color=C['dim'], font=MFSM, justify='center').pack(pady=10)

    def _neutral_add_unit(self, side: str):
        """Añade el objeto neutral seleccionado a la lista compartida."""
        lb = self._ul_neutral_listbox.get(side)
        if lb is None:
            return
        idxs = lb.curselection()
        if not idxs:
            self._status('SELECCIONA UN TIPO DE OBJETO NEUTRAL', 'warning')
            return
        name = NEUTRAL_TYPES[idxs[0]]
        count = max(1, self._ul_neutral_count_var[side].get())
        entry_turn = max(1, self._ul_neutral_entry_turn[side].get())
        is_artillery = name.startswith('Artillería')
        prof = self._ul_neutral_prof_var[side].get() if is_artillery else 0
        acc  = self._ul_neutral_acc_var[side].get()  if is_artillery else 0
        self._selected_neutrals.append([name, count, entry_turn, prof, acc])
        self._neutral_refresh_sel_list()
        turn_suffix = f' [T{entry_turn}]' if entry_turn > 1 else ''
        pa_suffix = f' Prof{prof}/Acc{acc}' if is_artillery else ''
        self._log(f'NEUTRAL: +{count}× {name}{turn_suffix}{pa_suffix}')

    def _neutral_remove_unit(self, idx: int):
        """Elimina un objeto neutral de la lista compartida."""
        if 0 <= idx < len(self._selected_neutrals):
            del self._selected_neutrals[idx]
            self._neutral_refresh_sel_list()

    def _neutral_refresh_sel_list(self):
        """Redibuja los paneles de objetos neutrales asignados en ambos bandos."""
        for inner in self._ul_neutral_inner.values():
            if inner is None:
                continue
            for w in inner.winfo_children():
                w.destroy()
            if not self._selected_neutrals:
                ml(inner, '(ningún objeto asignado)',
                   color=C['dim'], font=MFSM, justify='center').pack(pady=6)
                continue
            for i, entry in enumerate(self._selected_neutrals):
                name, count, entry_turn = entry[0], entry[1], entry[2]
                prof = entry[3] if len(entry) > 3 else 0
                acc  = entry[4] if len(entry) > 4 else 0
                row = tk.Frame(inner, bg=C['frame'],
                               highlightbackground=C['border'], highlightthickness=1)
                row.pack(fill='x', padx=4, pady=1)
                ml(row, name, font=MFSM, bg=C['frame']).pack(side='left', padx=4, pady=2)
                ml(row, f'×{count}', color=C['amber'], font=MFSM,
                   bg=C['frame']).pack(side='left')
                if entry_turn > 1:
                    ml(row, f' T{entry_turn}', color=C['bright'], font=MFSM,
                       bg=C['frame']).pack(side='left')
                if name.startswith('Artillería'):
                    ml(row, f' P{prof}/A{acc}', color=C['green'], font=MFSM,
                       bg=C['frame']).pack(side='left')
                tk.Button(
                    row, text='✕', bg=C['btn'], fg=C['red'], font=MFSM,
                    relief='flat', bd=0, cursor='hand2', padx=6,
                    activeforeground=C['bright'], activebackground=C['btn_hi'],
                    command=lambda ii=i: self._neutral_remove_unit(ii)
                ).pack(side='right', padx=2, pady=1)
            tk.Frame(inner, height=8, bg=C['panel']).pack()

    # ══════════════════════════════════════════════════════════════
    # Selector de unidades — lógica
    # ══════════════════════════════════════════════════════════════

    def _ul_refresh_list(self, side: str):
        """Actualiza el listbox según los filtros de facción y categoría."""
        lb = self._ul_listbox.get(side)
        if lb is None:
            return
        lb.delete(0, 'end')

        units = list(self._all_units)
        # Pre-filtro por bando: aliados ven American/Russian; eje solo German
        if side == 'aliados':
            units = [u for u in units if u.faction != Faction.GERMAN]
        elif side == 'eje':
            units = [u for u in units if u.faction == Faction.GERMAN]
        f_val = self._ul_faction_var[side].get()
        c_val = self._ul_cat_var[side].get()

        if f_val != 'TODAS' and f_val in _FACTION_MAP:
            units = [u for u in units if u.faction == _FACTION_MAP[f_val]]
        if c_val != 'TODAS' and c_val in _CAT_LABEL_REV:
            cat = _CAT_LABEL_REV[c_val]
            units = [u for u in units if u.category == cat]

        # Ordenar: categoría canónica → nombre
        units = [u for u in units if u.category in _CAT_ORDER]
        units.sort(key=lambda u: (_CAT_ORDER.index(u.category), u.name))
        self._ul_filtered_units[side] = units

        for u in units:
            cat_lbl = CAT_LABELS.get(u.category, u.category.value)
            lb.insert('end', f'{u.name:<26} {cat_lbl[:10]:<10} /{u.count}')

        # Resetear max y botón reducida
        self._ul_max_lbl[side].config(text='/ —')
        self._ul_add_red_btn[side].config(state='disabled')

    def _ul_on_select(self, side: str):
        """Actualiza el spinbox y botón reducida al seleccionar una unidad."""
        lb   = self._ul_listbox[side]
        idxs = lb.curselection()
        if not idxs:
            return
        units = self._ul_filtered_units.get(side, [])
        idx   = idxs[0]
        if idx >= len(units):
            return
        u = units[idx]
        self._ul_max_lbl[side].config(text=f'/ {u.count}')
        # Limitar count al máximo de la unidad
        cnt = self._ul_count_var[side].get()
        if cnt > u.count:
            self._ul_count_var[side].set(u.count)
        # Reducida solo para unidades con cara trasera (infantería + señuelos)
        can_reduce = u.category in (
            UnitCategory.SQUAD, UnitCategory.WT_MG,
            UnitCategory.WT_MORTAR, UnitCategory.DECOY)
        self._ul_add_red_btn[side].config(
            state='normal' if can_reduce else 'disabled')

    def _ul_add_unit(self, side: str, is_reduced: bool):
        """Añade la unidad seleccionada a la lista de asignadas."""
        lb   = self._ul_listbox[side]
        idxs = lb.curselection()
        if not idxs:
            self._status('SELECCIONA UNA UNIDAD DEL LISTADO', 'warning')
            return
        units = self._ul_filtered_units.get(side, [])
        idx   = idxs[0]
        if idx >= len(units):
            return
        u     = units[idx]
        count = max(1, min(self._ul_count_var[side].get(), u.count))
        et_var = self._ul_entry_turn_var.get(side)
        entry_turn = et_var.get() if et_var else 1
        self._selected_units[side].append([u.name, is_reduced, count, entry_turn])
        self._ul_refresh_sel_list(side)
        suffix = ' (Reducida)' if is_reduced else ''
        turn_suffix = f' [T{entry_turn}]' if entry_turn > 1 else ''
        self._log(f'{side.upper()}: +{count}× {u.name}{suffix}{turn_suffix}')

    def _ul_remove_unit(self, side: str, idx: int):
        """Elimina una entrada de la lista de asignadas."""
        lst = self._selected_units[side]
        if 0 <= idx < len(lst):
            del lst[idx]
            self._ul_refresh_sel_list(side)

    def _ul_refresh_sel_list(self, side: str):
        """Redibuja el panel de unidades asignadas."""
        inner = self._ul_sel_inner.get(side)
        if inner is None:
            return
        for w in inner.winfo_children():
            w.destroy()
        entries = self._selected_units[side]
        if not entries:
            ml(inner, '(ninguna unidad asignada)',
               color=C['dim'], font=MFSM, justify='center').pack(pady=10)
            return
        for i, entry in enumerate(entries):
            name, is_red, count = entry[0], entry[1], entry[2]
            entry_turn = entry[3] if len(entry) > 3 else 1
            row = tk.Frame(inner, bg=C['frame'],
                           highlightbackground=C['border'], highlightthickness=1)
            row.pack(fill='x', padx=4, pady=1)
            suffix = ' (Red)' if is_red else ''
            ml(row, f'{name}{suffix}',
               font=MFSM, bg=C['frame']).pack(side='left', padx=4, pady=2)
            ml(row, f'×{count}',
               color=C['amber'], font=MFSM, bg=C['frame']).pack(side='left')
            if entry_turn > 1:
                ml(row, f' T{entry_turn}',
                   color=C['bright'], font=MFSM, bg=C['frame']).pack(side='left')
            tk.Button(
                row, text='✕', bg=C['btn'], fg=C['red'], font=MFSM,
                relief='flat', bd=0, cursor='hand2', padx=6,
                activeforeground=C['bright'], activebackground=C['btn_hi'],
                command=lambda s=side, ii=i: self._ul_remove_unit(s, ii)
            ).pack(side='right', padx=2, pady=1)
        tk.Frame(inner, height=8, bg=C['panel']).pack()

    # ══════════════════════════════════════════════════════════════
    # Drag-and-drop
    # ══════════════════════════════════════════════════════════════

    def on_card_press(self, event, card):
        if self._selected_card and self._selected_card is not card:
            self._selected_card.set_selected(False)
        self._selected_card = card
        card.set_selected(True)
        self._drag_start = (event.x_root, event.y_root)

    def on_card_drag(self, event, card):
        dx = abs(event.x_root - self._drag_start[0])
        dy = abs(event.y_root - self._drag_start[1])
        if dx + dy < 6: return
        if self._ghost is None:
            self._create_ghost(card.map_id, card.get_rotation())
        if self._ghost:
            self._ghost.geometry(f'+{event.x_root - 45}+{event.y_root - 22}')

    def on_card_drop(self, event, card):
        self._destroy_ghost()
        bx, by, bw, bh = self._asm.screen_bbox()
        if bx <= event.x_root <= bx + bw and by <= event.y_root <= by + bh:
            cx = event.x_root - bx
            cy = event.y_root - by
            cell = self._asm.hit_test(cx, cy)
            if cell:
                r, c = cell
                self._asm.place_map(r, c, card.map_id, card.get_rotation())
                self._log(f'COLOCADO {card.name} ROT {card.get_rotation()}° EN [{r},{c}]')
                card.set_selected(False)
                self._selected_card = None

    def _create_ghost(self, map_id, rotation):
        self._ghost = tk.Toplevel(self.root)
        self._ghost.overrideredirect(True)
        try: self._ghost.attributes('-alpha', 0.75)
        except Exception: pass
        ci = (map_id - 1) % 10 + 1
        tk.Label(
            self._ghost,
            text=f' {self._get_map_name(map_id)} \n ROT {rotation}° ',
            bg=C['btn_hi'], fg=C['bright'], font=MFB,
            highlightbackground=MAP_BORDER.get(ci, C['border']),
            highlightthickness=2).pack()

    def _destroy_ghost(self):
        if self._ghost:
            try: self._ghost.destroy()
            except Exception: pass
            self._ghost = None

    # ── Assembly cell interaction ───────────────────────────────────

    def _on_asm_cell_click(self, r, c):
        if self._selected_card:
            card = self._selected_card
            self._asm.place_map(r, c, card.map_id, card.get_rotation())
            self._log(f'COLOCADO {card.name} ROT {card.get_rotation()}° EN [{r},{c}]')
            card.set_selected(False)
            self._selected_card = None
        else:
            entry = self._asm._data.get((r, c))
            if entry:
                cx = self._asm._canvas.winfo_rootx() + c * CELL_W + CELL_W // 2
                cy = self._asm._canvas.winfo_rooty() + r * CELL_H + CELL_H // 2
                self._show_cell_menu(cx, cy, r, c)

    def _show_cell_menu(self, x_root, y_root, r, c):
        menu = tk.Menu(self.root, tearoff=0,
                       bg=C['btn'], fg=C['green'], font=MF,
                       activebackground=C['sel'], activeforeground=C['bright'],
                       bd=0, relief='flat')
        map_menu = tk.Menu(menu, tearoff=0, bg=C['btn'], fg=C['green'],
                           font=MFSM, activebackground=C['sel'])
        for mid in sorted(self._cards):
            name = self._get_map_name(mid)
            map_menu.add_command(
                label=name,
                command=lambda m=mid, rr=r, cc=c: self._set_cell_map(rr, cc, m))
        menu.add_cascade(label='▶ ASIGNAR MAPA', menu=map_menu)
        rot_menu = tk.Menu(menu, tearoff=0, bg=C['btn'], fg=C['amber'],
                           font=MFSM, activebackground=C['sel'])
        for rot in [0, 90, 180, 270]:
            rot_menu.add_command(
                label=f'  {rot}°',
                command=lambda rr=r, cc=c, ro=rot: self._set_cell_rotation(rr, cc, ro))
        menu.add_cascade(label='↻ ROTACIÓN', menu=rot_menu)
        if (r, c) in self._asm._data:
            menu.add_separator()
            menu.add_command(label='✕ ELIMINAR', foreground=C['red'],
                             command=lambda rr=r, cc=c: self._asm.clear_cell(rr, cc))
        try:    menu.tk_popup(x_root, y_root)
        finally: menu.grab_release()

    def _set_cell_map(self, r, c, map_id):
        entry = self._asm._data.get((r, c))
        self._asm.place_map(r, c, map_id, entry[1] if entry else 0)

    def _set_cell_rotation(self, r, c, rotation):
        entry = self._asm._data.get((r, c))
        if entry: self._asm.place_map(r, c, entry[0], rotation)

    # ══════════════════════════════════════════════════════════════
    # Acciones principales
    # ══════════════════════════════════════════════════════════════

    def _action_preview_map(self, map_id, filepath):
        rot  = self._get_card_rotation(map_id)
        name = self._get_map_name(map_id)
        self._status(f'CARGANDO {name}...', 'working')
        self.root.update()
        try:
            mesh = HexMesh().load_csv(filepath, name)
            if rot: mesh = mesh.rotate(rot)
            self._draw(mesh, f'{name}  ROT {rot}°  [{mesh.hex_type}]')
            self._log(f'PREVISUALIZADO: {name} ROT={rot}°')
            self._status(f'{name} VISUALIZADO', 'ok')
            self._show_tab('vis')
        except Exception as e:
            self._status(f'ERROR: {e}', 'error')
            self._log(f'ERROR: {e}')
            messagebox.showerror('Error', str(e), parent=self.root)

    def _action_load_csv(self):
        fp = filedialog.askopenfilename(
            parent=self.root,
            title='Cargar mapa CSV',
            filetypes=[('CSV', '*.csv'), ('Todos', '*.*')])
        if not fp: return
        name = os.path.splitext(os.path.basename(fp))[0].upper()
        mid  = self._next_map_id
        self._next_map_id += 1
        self._map_paths[mid] = fp
        if len(self._cards) == 0:
            self._no_maps_lbl.pack_forget()
        card = MapCard(self._cards_container, mid, name, fp, self)
        card.pack(fill='x', pady=2)
        self._cards[mid] = card
        self._log(f'MAPA CARGADO: {name} (ID={mid})')
        self._status(f'CARGADO: {name}', 'ok')

    def _action_assemble(self):
        if self._asm.is_empty():
            self._status('SIN MAPAS EN LA GRID DE ENSAMBLAJE', 'warning')
            return
        self._status('PROCESANDO ENSAMBLAJE...', 'working')
        self.root.update()
        try:
            asm    = MapAssembler()
            loaded: Dict[int, HexMesh] = {}
            for gr, gc, mid, rot in self._asm.get_entries():
                if mid not in loaded:
                    loaded[mid] = HexMesh().load_csv(
                        self._get_map_filepath(mid), self._get_map_name(mid))
                # Extraer número del nombre de archivo (ej. "Map15.csv" → 15)
                fname = os.path.basename(self._get_map_filepath(mid))
                m = re.search(r'\d+', fname)
                map_num = int(m.group()) if m else mid
                asm.add_map(loaded[mid], grid_row=gr, grid_col=gc, rotation=rot, map_id=map_num)
            self._current_mesh = asm.assemble()
            n = len(self._asm.get_entries())
            self._draw(self._current_mesh, 'MAPA ENSAMBLADO')
            self._update_info(self._current_mesh)
            self._log(f'ENSAMBLADOS: {n} MAPAS → {len(self._current_mesh.hexes)} HEXES')
            self._status(
                f'ENSAMBLAJE COMPLETADO — {len(self._current_mesh.hexes)} HEXES', 'ok')
            self._show_tab('vis')
        except Exception as e:
            self._status(f'ERROR EN ENSAMBLAJE: {e}', 'error')
            self._log(f'ERROR: {e}')
            messagebox.showerror('Error de ensamblaje', str(e), parent=self.root)

    def _action_export_csv(self):
        if self._current_mesh is None:
            self._status('SIN MAPA ENSAMBLADO — ENSAMBLA PRIMERO', 'warning')
            return
        fp = filedialog.asksaveasfilename(
            parent=self.root,
            title='Exportar escenario CSV',
            defaultextension='.csv',
            filetypes=[('CSV', '*.csv'), ('Todos', '*.*')],
            initialfile='escenario.csv')
        if not fp: return
        try:
            with open(fp, 'w', newline='', encoding='utf-8') as f:
                # Sección ESCENARIO
                for line in self._get_scenario_csv_lines():
                    f.write(line + '\n')
                # Sección UNIDADES
                for line in self._get_units_csv_lines():
                    f.write(line + '\n')
                # Sección MAPA
                f.write('[MAPA]\n')
                self._write_map_section(f)
            self._log(f'ESCENARIO EXPORTADO: {os.path.basename(fp)}')
            self._status(f'EXPORTADO: {os.path.basename(fp)}', 'ok')
        except Exception as e:
            self._status(f'ERROR AL EXPORTAR: {e}', 'error')
            messagebox.showerror('Error de exportación', str(e), parent=self.root)

    def _action_clear_assembly(self):
        self._asm.clear_all()
        self._clear_visualization()
        self._log('GRID DE ENSAMBLAJE LIMPIADA')
        self._status('GRID LIMPIADA', 'ok')

    def _action_save_image(self):
        if self._current_fig is None:
            self._status('SIN IMAGEN — VISUALIZA PRIMERO', 'warning')
            return
        fp = filedialog.asksaveasfilename(
            parent=self.root, title='Guardar imagen',
            defaultextension='.png',
            filetypes=[('PNG', '*.png'), ('SVG', '*.svg'), ('Todos', '*.*')],
            initialfile='mapa.png')
        if not fp: return
        try:
            self._current_fig.savefig(fp, dpi=150, bbox_inches='tight',
                                      facecolor=C['canvas'])
            self._log(f'IMAGEN GUARDADA: {os.path.basename(fp)}')
            self._status(f'IMAGEN GUARDADA: {os.path.basename(fp)}', 'ok')
        except Exception as e:
            self._status(f'ERROR AL GUARDAR IMAGEN: {e}', 'error')
            messagebox.showerror('Error', str(e), parent=self.root)

    # ── Exportación: construcción de secciones CSV ─────────────────

    def _txt(self, widget: Optional[tk.Text]) -> str:
        """Lee un Text widget y escapa saltos de línea para CSV."""
        if widget is None: return ''
        return widget.get('1.0', 'end-1c').replace('\n', '\\n').strip()

    def _get_scenario_csv_lines(self) -> List[str]:
        lines = [
            '[ESCENARIO]',
            f'Titulo;{self._sce_titulo.get()}',
            f'Turnos;{self._sce_turnos.get()}',
            f'Norte;{self._sce_norte.get()}',
            f'Despliega_primero;{self._sce_despliega_1.get()}',
            f'Mueve_primero;{self._sce_mueve_1.get()}',
            f'Descripcion;{self._txt(self._sce_descripcion)}',
            f'Victoria;{self._txt(self._sce_victoria)}',
            '',
        ]
        for side, section in [('aliados', 'ALIADOS'), ('eje', 'EJE')]:
            lines += [
                f'[{section}]',
                f'Faccion;{self._sce_faccion[side].get()}',
                f'Ops_rango;{self._sce_ops_rango[side].get()}',
                f'Puntos_comando;{self._sce_cmd_pts[side].get()}',
                f'Ruta_huida;{self._sce_ruta_huida[side].get()}',
                f'Despliegue_inicial;{self._txt(self._sce_despliegue[side])}',
                f'Despliegue_alternativo;{self._txt(self._sce_alt_despliegue[side])}',
                '',
            ]
        return lines

    def _get_units_csv_lines(self) -> List[str]:
        lines = []
        for side, section in [('aliados', 'UNIDADES_ALIADOS'),
                               ('eje',    'UNIDADES_EJE')]:
            lines.append(f'[{section}]')
            lines.append('Tipo;Categoria;Reducida;Fichas_max;Fichas_escenario;Turno_entrada')
            for entry in self._selected_units.get(side, []):
                unit_name, is_red, count = entry[0], entry[1], entry[2]
                entry_turn = entry[3] if len(entry) > 3 else 1
                u = next((x for x in self._all_units if x.name == unit_name), None)
                if u:
                    lines.append(
                        f'{u.name};{u.category.value};'
                        f'{"SI" if is_red else "NO"};{u.count};{count};{entry_turn}')
            lines.append('')
        # Sección de unidades neutrales
        lines.append('[UNIDADES_NEUTRALES]')
        lines.append('Tipo;Fichas_escenario;Turno_entrada;Prof;Acc')
        for entry in self._selected_neutrals:
            name, count, entry_turn = entry[0], entry[1], entry[2]
            prof = entry[3] if len(entry) > 3 else 0
            acc  = entry[4] if len(entry) > 4 else 0
            lines.append(f'{name};{count};{entry_turn};{prof};{acc}')
        lines.append('')
        return lines

    def _write_map_section(self, file):
        """Escribe los datos de hexes en el fichero ya abierto.

        Coordenada: si el hex tiene orig_map asignado, usa formato '5A3'
        (número de mapa + coord original). Las columnas Col y Row al final
        dan la posición global entera para que la app web pueda renderizar.
        """
        mesh = self._current_mesh
        sides = (HexMesh.FLAT_TOP_SIDES if mesh.hex_type == 'flat-top'
                 else HexMesh.POINTY_TOP_SIDES)
        header = (['Coordenada', 'Terreno', 'Elevacion', 'Upper_Level', 'Fortificacion']
                  + [f'Lado_{s}' for s in sides]
                  + ['Col', 'Row'])
        file.write(';'.join(header) + '\n')
        for (col_idx, row), hx in sorted(mesh.hexes.items()):
            if hx.orig_map and hx.orig_coord:
                coord = f'{hx.orig_map}{hx.orig_coord}'
            else:
                coord = HexMesh.col_idx_to_letter(col_idx) + str(row)
            row_d = [coord, hx.terrain, str(hx.elevation),
                     'SI' if hx.upper_level else 'NO', hx.fortification]
            for s in sides:
                row_d.append('SI' if hx.sides.get(s, False) else 'NO')
            row_d += [str(col_idx), str(row)]   # posición global para rendering
            file.write(';'.join(row_d) + '\n')

    # ── Visualización ─────────────────────────────────────────────

    def _clear_visualization(self):
        if self._mpl_cid is not None and self._current_fig is not None:
            try: self._current_fig.canvas.mpl_disconnect(self._mpl_cid)
            except Exception: pass
            self._mpl_cid = None
        if self._mpl_canvas is not None:
            try:
                self._mpl_toolbar.destroy()
                self._mpl_canvas.get_tk_widget().destroy()
            except Exception: pass
            try: plt.close(self._current_fig)
            except Exception: pass
            self._mpl_canvas  = None
            self._current_fig = None
        if self._tb_frame is not None:
            try: self._tb_frame.destroy()
            except Exception: pass
            self._tb_frame = None
        self._current_mesh = None
        self._vis_title.config(text='VISUALIZACIÓN', fg=C['dim'])
        self._info_lbl.config(text='')
        for key in self._insp_vars: self._insp_vars[key].set('—')
        if self._placeholder.winfo_exists():
            self._placeholder.pack(expand=True)

    def _draw(self, mesh: HexMesh, title: str = ''):
        if self._placeholder and self._placeholder.winfo_exists():
            self._placeholder.pack_forget()
        if self._mpl_cid is not None and self._current_fig is not None:
            try: self._current_fig.canvas.mpl_disconnect(self._mpl_cid)
            except Exception: pass
        if self._mpl_canvas is not None:
            try:
                self._mpl_toolbar.destroy()
                self._mpl_canvas.get_tk_widget().destroy()
            except Exception: pass
            try: plt.close(self._current_fig)
            except Exception: pass
            self._mpl_canvas  = None
            self._current_fig = None
        if self._tb_frame is not None:
            try: self._tb_frame.destroy()
            except Exception: pass
            self._tb_frame = None

        dc_c_min, dc_c_max, dc_r_min, dc_r_max = mesh.get_dc_bounds()
        if mesh.hex_type == 'flat-top':
            w_u = (dc_c_max - dc_c_min) * 1.5 + 3
            h_u = (dc_r_max - dc_r_min) * (SQRT3 / 2) + 3
        else:
            w_u = (dc_c_max - dc_c_min) * (SQRT3 / 2) + 3
            h_u = (dc_r_max - dc_r_min) * 1.5 + 3
        fw = min(max(w_u * 0.55, 5), 14)
        fh = min(max(h_u * 0.55, 4), 11)

        self._current_fig = Figure(figsize=(fw, fh), facecolor=C['canvas'])
        ax = self._current_fig.add_subplot(111)
        ax.set_facecolor(C['canvas'])

        viz.draw_mesh(mesh, ax=ax, title=title,
                      show_coords=self._show_coords.get(),
                      show_terrain_legend=self._show_legend.get())

        if ax.get_title():
            ax.title.set_color(C['green'])
            ax.title.set_fontfamily('monospace')
            ax.title.set_fontsize(8)

        self._current_fig.tight_layout(pad=0.4)

        self._tb_frame = tk.Frame(self._plot_frame, bg=C['canvas'])
        self._tb_frame.pack(fill='x', side='bottom')

        self._mpl_canvas = FigureCanvasTkAgg(self._current_fig, self._plot_frame)
        self._mpl_canvas.draw()
        self._mpl_toolbar = NavigationToolbar2Tk(self._mpl_canvas, self._tb_frame)
        self._mpl_toolbar.config(bg=C['canvas'])
        self._mpl_toolbar.update()
        self._mpl_canvas.get_tk_widget().pack(fill='both', expand=True)

        self._mpl_cid = self._current_fig.canvas.mpl_connect(
            'button_press_event', self._on_matplotlib_click)
        self._vis_title.config(text=title or 'VISUALIZACIÓN', fg=C['green'])
        self._update_info(mesh)

    def _redraw_current(self):
        if self._current_mesh is not None and self._current_fig is not None:
            self._draw(self._current_mesh, self._vis_title.cget('text'))

    def _on_matplotlib_click(self, event):
        if event.xdata is None or event.ydata is None: return
        if self._current_mesh is None: return
        if self._current_mesh.hex_type == 'flat-top':
            dc_c = round(event.xdata / (1.5 * HEX_SIZE))
            dc_r = round(event.ydata / ((SQRT3 / 2) * HEX_SIZE))
        else:
            dc_c = round(event.xdata / ((SQRT3 / 2) * HEX_SIZE))
            dc_r = round(event.ydata / (1.5 * HEX_SIZE))
        coord = HexMesh.double_to_coord(dc_c, dc_r)
        if coord is None: return
        hx = self._current_mesh.hexes.get(coord)
        if hx:
            coord_str = HexMesh.col_idx_to_letter(coord[0]) + str(coord[1])
            self._update_hex_inspector(hx, coord_str)

    def _update_hex_inspector(self, hx: HexData, coord_str: str):
        setos = [s for s, v in hx.sides.items() if v]
        self._insp_vars['COORD'].set(coord_str)
        self._insp_vars['TERRENO'].set(hx.terrain[:20])
        self._insp_vars['ELEVAC'].set(
            str(hx.elevation) + (' +UL' if hx.upper_level else ''))
        self._insp_vars['SETOS'].set(', '.join(setos) if setos else 'NINGUNO')

    def _update_info(self, mesh: HexMesh):
        self._current_mesh = mesh
        col_min, col_max, r_min, r_max = mesh.get_coord_bounds()
        self._info_lbl.config(
            text=(f'TIPO: {mesh.hex_type}  |  '
                  f'COLS: {HexMesh.col_idx_to_letter(col_min)}–'
                  f'{HexMesh.col_idx_to_letter(col_max)}  |  '
                  f'FILAS: {r_min}–{r_max}  |  '
                  f'HEXES: {len(mesh.hexes)}'))

    # ── Carga de unidades ──────────────────────────────────────────

    def _load_units(self):
        """Carga las unidades desde SE_Units.csv (silencioso si no existe)."""
        try:
            self._all_units = load_units(UNITS_CSV)
            # Reconstruir las listas de selección ahora que tenemos los datos
            for side in ('aliados', 'eje'):
                self._rebuild_unit_list(side)
            self._log(f'UNIDADES: {len(self._all_units)} tipos cargados')
        except Exception as e:
            self._log(f'AVISO: unidades no cargadas — {e}')

    def _rebuild_unit_list(self, side: str):
        """Popula el listbox del selector tras cargar el CSV."""
        self._ul_refresh_list(side)

    # ── Utilidades ────────────────────────────────────────────────

    def _get_map_name(self, map_id):
        card = self._cards.get(map_id)
        return card.name if card else f'MAP {map_id:02d}'

    def _get_map_filepath(self, map_id):
        return self._map_paths[map_id]

    def _get_card_rotation(self, map_id):
        card = self._cards.get(map_id)
        return card.get_rotation() if card else 0

    def _log(self, msg: str):
        ts = datetime.datetime.now().strftime('%H:%M:%S')
        self._log_text.config(state='normal')
        self._log_text.insert('1.0', f'[{ts}] {msg}\n')
        lines = int(self._log_text.index('end-1c').split('.')[0])
        if lines > 60: self._log_text.delete('61.0', 'end')
        self._log_text.config(state='disabled')

    def _status(self, msg: str, level: str = 'ok'):
        color = {'ok': C['green'], 'working': C['amber'],
                 'warning': C['amber'], 'error': C['red']}.get(level, C['green'])
        self._status_lbl.config(text=msg, fg=color)
        self._status_dot.config(fg=color)

    def _tick(self):
        now = datetime.datetime.now().strftime('%Y-%m-%d  %H:%M:%S')
        self._clock_lbl.config(text=now)
        self.root.after(1000, self._tick)


# ══════════════════════════════════════════════════════════════════════════════

def main():
    root = tk.Tk()
    MilitaryApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
