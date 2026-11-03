#!/usr/bin/env python3
"""Variants of Gemini's drawings for variantes.html: ways to shrink them, side by side in the real game.

  python3 herramientas/variantes.py

For each object (OBJS): Gemini's drawing as it comes (the GPU shrinks it every frame), how it is today (pixelar.py)
and the drawing shrunk beforehand by 2x, 3x, 4x, 5x, 6x and 8x with four methods (block average, nearest, bilinear,
bicubic). Every variant is drawn at the object's real size (the game's 0.6 times what is left over), next to an LPC
person. Writes pruebas/variantes/variantes.png + .json (the sheet) and variantes.js (the layout).
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from achicar import cortes, shrink

ROOT = os.path.join(os.path.dirname(__file__), "..")
GEM = os.path.join(ROOT, "arte", "gemini")
OUT = os.path.join(ROOT, "pruebas", "variantes")
SHOW = 0.6                     # the game draws art at 0.6 (30 px/m -> 18 px/m of world)

OBJS = [("plaza_01", "pz_calesita", "calesita", "pasto"), ("plaza_01", "pz_monumento", "estatua", "pasto"),
        ("plaza_01", "pz_banco", "banco de plaza", "pasto"), ("mobiliario_01", "hd_banco", "banco de hormigon", "vereda"),
        ("mobiliario_01", "hd_contenedor_a", "contenedor", "vereda"), ("mobiliario_01", "hd_kiosco", "kiosco", "vereda"),
        ("postes_01", "hd_led", "farola LED", "vereda"), ("postes_01", "hd_farola", "farola", "vereda"),
        ("postes_01", "hd_semaforo", "semaforo", "vereda"), ("plaza_01", "pz_subibaja", "subibaja", "pasto"),
        ("calle_02", "hd_volquete", "volquete", "vereda")]
METHODS = [("promedio", None), ("nearest", Image.NEAREST), ("bilinear", Image.BILINEAR), ("bicubic", Image.BICUBIC)]
FACTORS = [2, 3, 4, 5, 6, 8]

FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)


def pil_shrink(rgb, m, f, method):
    """The same padding as achicar.shrink (bottom edge on a block boundary), resampled by PIL with premultiplied alpha."""
    h, w = m.shape
    H, W = -(-h // f) * f, -(-w // f) * f
    a = np.zeros((H, W, 4), np.uint8)
    a[H - h:, W - w:, :3] = np.clip(rgb, 0, 255); a[H - h:, W - w:, 3] = m * 255
    im = Image.fromarray(a).convert("RGBa").resize((W // f, H // f), method).convert("RGBA")
    return im


def label(text):
    """White text with a dark edge, drawn at 2x (the scene shows it at half size)."""
    w = int(FONT.getlength(text)) + 8
    im = Image.new("RGBA", (w, 30), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            d.text((4 + dx, 3 + dy), text, font=FONT, fill=(20, 20, 24, 255))
    d.text((4, 3), text, font=FONT, fill=(255, 255, 255, 255))
    return im.crop(im.getbbox())


def main():
    os.makedirs(OUT, exist_ok=True)
    limpio = {}
    for f in os.listdir(os.path.join(GEM, "limpio")):
        if f.endswith(".json"):
            limpio.update(json.load(open(os.path.join(GEM, "limpio", f))))
    cuts = {}
    for sheet in sorted({o[0] for o in OBJS}):
        for o, rgb, m, r in cortes(os.path.join(GEM, sheet + ".json")):
            cuts[o["name"]] = (rgb, m, r)

    frames = {}       # name -> image
    blocks = []       # per object: rows of cells [frame, scale, label frame]
    for sheet, name, nice, suelo in OBJS:
        rgb, m, r = cuts[name]
        full = np.zeros(m.shape + (4,), np.uint8); full[..., :3] = rgb; full[..., 3] = m * 255
        frames[name + "__gemini"] = Image.fromarray(full)
        frames[name + "__hoy"] = Image.open(os.path.join(GEM, "limpio", name + ".png")).convert("RGBA")
        L = lambda t: frames.setdefault("lbl_" + t, label(t)) and "lbl_" + t
        top = [[name + "__gemini", SHOW / r, L("Gemini tal cual")],
               [name + "__hoy", SHOW * limpio[name]["k"], L("hoy (pixelar)")]]
        rows = [top]
        for meth, pm in METHODS:
            row = []
            for f in FACTORS:
                im = Image.fromarray(shrink(rgb, m, f)) if pm is None else pil_shrink(rgb, m, f, pm)
                bb = im.getbbox(); im = im.crop(bb) if bb else im
                fn = f"{name}__{meth}{f}"
                frames[fn] = im
                row.append([fn, SHOW * f / r, L(f"{meth} {f}x")])
            rows.append(row)
        blocks.append({"name": name, "label": L(nice), "suelo": suelo, "rows": rows})

    # layout in world px: each object a block, rows of cells, every cell as wide as the widest variant
    y = 40; out_blocks = []; WW = 0
    for b in blocks:
        cw = max(max(frames[c[0]].width * c[1] for row in b["rows"] for c in row) + 26, 78)
        ch = max(frames[c[0]].height * c[1] for row in b["rows"] for c in row) + 22
        cells = []; y0 = y
        for j, row in enumerate(b["rows"]):
            yb = y + 18 + (j + 1) * ch - 14            # feet of this row
            x = 70 + (cw if j == 0 else 0)             # the first row leaves room for the person
            for fr, s, lb in row:
                cells.append({"f": fr, "x": round(x + cw / 2, 1), "y": round(yb, 1), "s": round(s, 4), "l": lb})
                x += cw
            WW = max(WW, x + 40)
        y += 18 + len(b["rows"]) * ch + 30
        out_blocks.append({"name": b["name"], "label": b["label"], "suelo": b["suelo"], "x0": 40, "y0": y0, "y1": y - 20,
                           "persona": [round(70 + cw / 2, 1), round(y0 + 18 + ch - 14, 1)], "cells": cells})
    for b in out_blocks:
        b["x1"] = WW - 20
    # the world is bigger than the canvas at the lowest zoom (WeedJS clamps the zoom to canvas/world)
    layout = {"WW": max(4000, int(WW)), "WH": max(3000, int(y + 40)), "blocks": out_blocks}

    # sheet: shelf packing, 4096 wide
    names = sorted(frames, key=lambda n: -frames[n].height)
    W = 4096; x = yy = rowh = 0; pos = {}
    for n in names:
        im = frames[n]
        if x + im.width > W:
            x, yy, rowh = 0, yy + rowh + 2, 0
        pos[n] = (x, yy); x += im.width + 2; rowh = max(rowh, im.height)
    sheet = Image.new("RGBA", (W, yy + rowh), (0, 0, 0, 0)); fj = {}
    for n in names:
        im = frames[n]; sheet.paste(im, pos[n])
        fj[n] = {"frame": {"x": pos[n][0], "y": pos[n][1], "w": im.width, "h": im.height}, "rotated": False, "trimmed": False,
                 "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height}, "sourceSize": {"w": im.width, "h": im.height}}
    sheet.save(os.path.join(OUT, "variantes.png"), optimize=True)
    json.dump({"frames": fj, "animations": {n: [n] for n in names}, "meta": {"image": "variantes.png", "format": "RGBA8888", "size": {"w": W, "h": sheet.height}, "scale": 1}},
              open(os.path.join(OUT, "variantes.json"), "w"))
    with open(os.path.join(OUT, "variantes.js"), "w") as f:
        f.write("// generado por herramientas/variantes.py\nexport const VARIANTES = " + json.dumps(layout) + ";\n")
    print(f"variantes.png {W}x{sheet.height}, {len(frames)} cuadros; mundo {layout['WW']}x{layout['WH']}")


if __name__ == "__main__":
    main()
