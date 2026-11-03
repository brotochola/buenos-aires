#!/usr/bin/env python3
"""Pack the Gemini props (arte/gemini/achicado/*.png: Gemini's drawings shrunk 2x by herramientas/achicar.py)
into the editor's HD props sheet.

  python3 herramientas/armar_hd.py

Reads arte/hd.json: {"escala": 0.6, "frames": {"<game name>": "<cleaned png name>", ...}}
and the specs arte/gemini/*.json (for the depth "d" of each object, which sets the anchor:
the anchor sits at the center of the footprint, d/2 m above the bottom edge in the oblique view).

Writes editor/recursos/hd_props.png and editor/recursos/hd_props.js
  const HD_ASSETS = {"escala": 0.6, "frames": {name: {x, y, w, h, ox, oy}}};
Frames are in art px (30 px/m); the editor and the game draw them at `escala`.
"""
import json, os, glob
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
ART = os.path.join(ROOT, "arte")
PXM_W = 30.0

cfg = json.load(open(os.path.join(ART, "hd.json")))
# per-object metadata written by achicar.py: size, k (what the game still scales), depth d (m)
PROPS = os.path.join(ART, "gemini", "achicado")
info = {}
for sp in glob.glob(os.path.join(PROPS, "*.json")):
    info.update(json.load(open(sp)))

items = []
for name, src in cfg["frames"].items():
    im = Image.open(os.path.join(PROPS, src + ".png")).convert("RGBA")
    k, d = info[src]["k"], info[src].get("d", 0.3)
    oy = max(0, im.height - 1 - int(round(d * PXM_W * 0.5 * 0.5 / k)))   # anchor: center of the footprint (d/2 m deep)
    items.append((name, im, im.width // 2, oy, k))

# shelf packing, tallest first, 2 px gap
W = 2048
items.sort(key=lambda t: -t[1].height)
x = y = rowh = 0
pos = {}
for name, im, ox, oy, k in items:
    if x + im.width > W:
        x, y, rowh = 0, y + rowh + 2, 0
    pos[name] = (x, y)
    x += im.width + 2
    rowh = max(rowh, im.height)
H = y + rowh
sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
frames = {}
for name, im, ox, oy, k in items:
    px, py = pos[name]
    sheet.paste(im, (px, py))
    frames[name] = {"x": px, "y": py, "w": im.width, "h": im.height, "ox": ox, "oy": oy, "e": round(cfg["escala"] * k, 4)}
out = os.path.join(ROOT, "editor", "recursos")
sheet.save(os.path.join(out, "hd_props.png"), optimize=True)
with open(os.path.join(out, "hd_props.js"), "w") as f:
    f.write("// props HD (Gemini, limpiados a 30 px/m con herramientas/pixelar.py; armado con herramientas/armar_hd.py)\n")
    f.write("const HD_ASSETS = " + json.dumps({"escala": cfg["escala"], "frames": dict(sorted(frames.items()))}) + ";\n")
print(f"hd_props.png {W}x{H}, {len(frames)} frames")


# ---------- facade decals (front elevation, 30 px/m): every arte/gemini/limpio/fd_*.png -> editor/recursos/fachada.png/js
dec = sorted(glob.glob(os.path.join(ART, "gemini", "limpio", "fd_*.png")))   # blit stretches them to their size on the wall
ims = [(os.path.basename(f)[:-4], Image.open(f).convert("RGBA")) for f in dec]
ims.sort(key=lambda t: -t[1].height)
x = y = rowh = 0; W = 1024; pos = {}
for n, im in ims:
    if x + im.width > W:
        x, y, rowh = 0, y + rowh + 1, 0
    pos[n] = (x, y); x += im.width + 1; rowh = max(rowh, im.height)
sheet = Image.new("RGBA", (W, y + rowh), (0, 0, 0, 0)); frames = {}
for n, im in ims:
    sheet.paste(im, pos[n]); frames[n] = {"x": pos[n][0], "y": pos[n][1], "w": im.width, "h": im.height}
sheet.save(os.path.join(out, "fachada.png"), optimize=True)
with open(os.path.join(out, "fachada.js"), "w") as f:
    f.write("// piezas de fachada (Gemini, vista frontal a 30 px/m): R3 las pega en las caras de las casas (Tex.blit)\n")
    f.write("const FACHADA = " + json.dumps({"frames": dict(sorted(frames.items()))}) + ";\n")
print(f"fachada.png {W}x{y + rowh}, {len(frames)} piezas")
