#!/usr/bin/env python3
"""Repinta hojas de autos sin Gemini, cuadro por cuadro, para que todos los rumbos queden iguales.

  python3 herramientas/repintar_autos.py taxi_ba        -> img/autos/taxi_ba.png/json (desde taxi)

Taxi de Buenos Aires: carrocería negra y techo amarillo. El techo se encuentra solo: es la parte del color de la carrocería
que queda encerrada por los vidrios (no toca el borde de la silueta) después de cortar los parantes finos con una erosión.
"""
import json, sys, os, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), "..")


def hsv(a):
    f = a[..., :3].astype(float) / 255
    mx, mn = f.max(-1), f.min(-1)
    v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    h = np.zeros_like(v); d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, s, v


def taxi_ba(src="taxi", out="taxi_ba"):
    j = json.load(open(os.path.join(ROOT, "img/autos", src + ".json")))
    im = np.array(Image.open(os.path.join(ROOT, "img/autos", src + ".png")).convert("RGBA")).astype(float)
    res = im.copy()
    for n, fr in j["frames"].items():
        f = fr["frame"]; x0, y0, w, h = f["x"], f["y"], f["w"], f["h"]
        a = im[y0:y0 + h, x0:x0 + w]
        H, S, V = hsv(a)
        op = a[..., 3] > 0
        body = op & (H > 15) & (H < 65) & (S > .4) & (V > .3)
        sil = op & ~ndimage.binary_erosion(op, iterations=2)                    # borde de la silueta
        er = ndimage.binary_erosion(body, structure=np.ones((3, 3)))
        lab, nn = ndimage.label(er)
        roof = np.zeros_like(body)
        for k in range(1, nn + 1):
            comp = lab == k
            if not (ndimage.binary_dilation(comp, iterations=2) & sil).any() and comp.sum() > 4:
                roof |= comp
        roof = ndimage.binary_dilation(roof, iterations=1) & body
        L = (.3 * a[..., 0] + .59 * a[..., 1] + .11 * a[..., 2]) / 255
        blk = body & ~roof
        # negro brillante: luminancia comprimida, un poco azulado; los brillos quedan
        k = np.clip(L * .55 + .02, 0, 1)
        for c, t in enumerate([.92, .95, 1.08]):
            a[..., c] = np.where(blk, np.clip(k * 255 * t, 0, 255), a[..., c])
        # techo amarillo taxi
        yl = np.clip(L * 1.25, 0, 1.15)
        for c, base in enumerate([255, 206, 32]):
            a[..., c] = np.where(roof, np.clip(base * yl, 0, 255), a[..., c])
        res[y0:y0 + h, x0:x0 + w] = a
    Image.fromarray(res.astype(np.uint8)).save(os.path.join(ROOT, "img/autos", out + ".png"))
    s = json.dumps(j).replace(src + "_", out + "_").replace('"' + src + '.png"', '"' + out + '.png"')
    open(os.path.join(ROOT, "img/autos", out + ".json"), "w").write(s)
    print("img/autos/" + out)


if __name__ == "__main__":
    {"taxi_ba": taxi_ba}[sys.argv[1]]()
