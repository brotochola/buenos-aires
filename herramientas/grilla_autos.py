#!/usr/bin/env python3
"""Arma una grilla con los cuadros de una hoja de autos (para pedirle a Gemini que la repinte) y la vuelve a cortar.

  python3 herramientas/grilla_autos.py armar taxi            -> arte/gemini/entrada/taxi.png (+ .json con la grilla)
  python3 herramientas/grilla_autos.py cortar taxi <png de Gemini> <hoja nueva>   -> img/autos/<hoja nueva>.png/json

Grilla de 5 columnas, celdas iguales, fondo magenta, cada pixel x4 (sin suavizar) para que Gemini vea el detalle.
Al cortar, cada celda se lleva al tamaño del cuadro original (vecino más cercano sobre la grilla de Gemini) y el fondo
magenta se vuelve transparente; la hoja nueva usa el mismo json (mismos cuadros, mismas posiciones).
"""
import json, sys, os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
COLS, ESC, PAD, ASP = 7, 4, 6, 1536 / 738   # ASP: la proporción de la pestaña de Chrome donde se muestra (se sube una captura)


def armar(hoja):
    j = json.load(open(os.path.join(ROOT, "img/autos", hoja + ".json")))
    im = Image.open(os.path.join(ROOT, "img/autos", hoja + ".png")).convert("RGBA")
    names = sorted(j["frames"])
    cw = max(j["frames"][n]["frame"]["w"] for n in names) + PAD * 2
    ch = max(j["frames"][n]["frame"]["h"] for n in names) + PAD * 2
    rows = (len(names) + COLS - 1) // COLS
    # celdas tales que la grilla tenga la proporción de la pestaña (la captura que se sube es la grilla entera)
    if COLS * cw > rows * ch * ASP:
        ch = int(np.ceil(COLS * cw / ASP / rows))
    else:
        cw = int(np.ceil(rows * ch * ASP / COLS))
    g = Image.new("RGBA", (COLS * cw, rows * ch), (255, 0, 255, 255))
    for k, n in enumerate(names):
        f = j["frames"][n]["frame"]
        fr = im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
        cx, cy = (k % COLS) * cw + (cw - f["w"]) // 2, (k // COLS) * ch + (ch - f["h"]) // 2
        g.alpha_composite(fr, (cx, cy))
    g = g.convert("RGB").resize((g.width * ESC, g.height * ESC), Image.NEAREST)
    out = os.path.join(ROOT, "arte/gemini/entrada", hoja + ".png")
    g.save(out)
    json.dump({"hoja": hoja, "cw": cw, "ch": ch, "cols": COLS, "rows": rows, "names": names}, open(out[:-4] + ".json", "w"))
    print(out, g.size)


def cortar(hoja, png, nueva):
    meta = json.load(open(os.path.join(ROOT, "arte/gemini/entrada", hoja + ".json")))
    j = json.load(open(os.path.join(ROOT, "img/autos", hoja + ".json")))
    orig = Image.open(os.path.join(ROOT, "img/autos", hoja + ".png")).convert("RGBA")
    g = Image.open(png).convert("RGB")
    sx, sy = g.width / (meta["cw"] * meta["cols"]), g.height / (meta["ch"] * meta["rows"])
    a = np.array(g).astype(int)
    out = Image.new("RGBA", orig.size, (0, 0, 0, 0))
    for k, n in enumerate(meta["names"]):
        f = j["frames"][n]["frame"]
        cx, cy = (k % meta["cols"]) * meta["cw"] + (meta["cw"] - f["w"]) // 2, (k // meta["cols"]) * meta["ch"] + (meta["ch"] - f["h"]) // 2
        # muestrea el centro de cada pixel original en la imagen de Gemini
        xs = ((cx + np.arange(f["w"]) + .5) * sx).astype(int).clip(0, g.width - 1)
        ys = ((cy + np.arange(f["h"]) + .5) * sy).astype(int).clip(0, g.height - 1)
        c = a[ys][:, xs]
        r_, g_, b_ = c[..., 0], c[..., 1], c[..., 2]
        bg = (r_ > 140) & (b_ > 140) & (g_ < 110) & (np.abs(r_ - b_) < 90) | ((np.minimum(r_, b_) - g_ > 70) & (np.abs(r_ - b_) < 70))
        # la silueta es la del cuadro original (Gemini sólo repinta): alfa del original
        oa = np.array(orig.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])))[..., 3]
        rgba = np.zeros((f["h"], f["w"], 4), np.uint8)
        rgba[..., :3] = c.clip(0, 255); rgba[..., 3] = oa
        # donde Gemini dejó fondo dentro de la silueta, se queda el color original
        o3 = np.array(orig.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])))[..., :3]
        rgba[bg & (oa > 0), :3] = o3[bg & (oa > 0)]
        out.paste(Image.fromarray(rgba), (f["x"], f["y"]))
    out.save(os.path.join(ROOT, "img/autos", nueva + ".png"))
    s = json.dumps(j).replace(hoja + "_", nueva + "_").replace('"' + hoja + '.png"', '"' + nueva + '.png"')
    open(os.path.join(ROOT, "img/autos", nueva + ".json"), "w").write(s)
    print("img/autos/" + nueva, out.size)


if __name__ == "__main__":
    if sys.argv[1] == "armar":
        for h in sys.argv[2:]:
            armar(h)
    else:
        cortar(*sys.argv[2:5])
