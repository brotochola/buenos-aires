#!/usr/bin/env python3
"""Repinta hojas de autos sin Gemini, cuadro por cuadro, para que todos los rumbos queden iguales.

  python3 herramientas/repintar_autos.py taxi_ba        -> img/autos/taxi.png (desde arte/autos_originales/taxi.png)
  (correrlo después de herramientas/hornear_autos.js, que vuelve a escribir img/autos/ desde el paquete)

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


def taxi_ba(src="taxi", out="taxi"):
    """El techo es el pedazo de carrocería que rodea al cartel blanco de TAXI: se crece desde el cartel por la carrocería,
    con una erosión para no pasar por los parantes; si se escapa (más de 45 % de la carrocería) se erosiona más."""
    # parte siempre del original del paquete (arte/autos_originales/), así se puede correr de nuevo
    org = os.path.join(ROOT, "arte/autos_originales")
    j = json.load(open(os.path.join(org, src + ".json")))
    im = np.array(Image.open(os.path.join(org, src + ".png")).convert("RGBA")).astype(float)
    res = im.copy()
    for n, fr in j["frames"].items():
        f = fr["frame"]; x0, y0, w, h = f["x"], f["y"], f["w"], f["h"]
        a = im[y0:y0 + h, x0:x0 + w].copy()
        H, S, V = hsv(a)
        op = a[..., 3] > 0
        body = op & (((H < 70) | (H > 340)) & (S > .35) & (V > .25))
        sign = op & (S < .2) & (V > .8)
        lab, nn = ndimage.label(sign)
        if nn:
            sizes = ndimage.sum(sign, lab, range(1, nn + 1)); sign = lab == (1 + int(np.argmax(sizes)))
        seed = ndimage.binary_dilation(sign, iterations=2) & body
        roof = np.zeros_like(body)
        for it in (1, 2, 3):
            er = ndimage.binary_erosion(body, structure=ndimage.generate_binary_structure(2, 1), iterations=it) if it else body
            sd = ndimage.binary_dilation(sign, iterations=2 + it) & er
            if not sd.any(): continue
            lab, nn = ndimage.label(er); ids = set(np.unique(lab[sd])) - {0}
            cand = np.isin(lab, list(ids)); cand = ndimage.binary_dilation(cand, iterations=it) & body
            if cand.sum() < .45 * body.sum(): roof = cand; break
        if not roof.any() and sign.any():           # sin techo claro: un círculo alrededor del cartel
            ys, xs = np.nonzero(sign); cy, cx = ys.mean(), xs.mean(); r = max(3, (xs.max() - xs.min()) * 1.1)
            yy, xx = np.mgrid[0:h, 0:w]; roof = body & ((yy - cy) ** 2 + (xx - cx) ** 2 < r * r)
        L = (.3 * a[..., 0] + .59 * a[..., 1] + .11 * a[..., 2]) / 255
        blk = body & ~roof
        k = np.clip(L * .42 + .02, 0, 1)
        for c, t in enumerate([.9, .94, 1.1]):
            a[..., c] = np.where(blk, np.clip(k * 255 * t, 0, 255), a[..., c])
        yl = np.clip(.55 + L * .6, 0, 1.1)
        for c, base in enumerate([255, 204, 26]):
            a[..., c] = np.where(roof, np.clip(base * yl, 0, 255), a[..., c])
        res[y0:y0 + h, x0:x0 + w] = a
    Image.fromarray(res.astype(np.uint8)).save(os.path.join(ROOT, "img/autos", out + ".png"))
    s = json.dumps(j).replace(src + "_", out + "_").replace('"' + src + '.png"', '"' + out + '.png"')
    open(os.path.join(ROOT, "img/autos", out + ".json"), "w").write(s)
    print("img/autos/" + out)


def policia_ba(src="policia", out="policia"):
    """Patrullero de la Provincia/Ciudad de Buenos Aires: blanco y azul. Lo negro del paquete (capot, baúl, zócalos) pasa a azul;
    los vidrios, que también son oscuros, quedan azulados, como los polarizados."""
    org = os.path.join(ROOT, "arte/autos_originales")
    j = json.load(open(os.path.join(org, src + ".json")))
    a = np.array(Image.open(os.path.join(org, src + ".png")).convert("RGBA")).astype(float)
    H, S, V = hsv(a)
    op = a[..., 3] > 0
    edge = op & ~ndimage.binary_erosion(op, iterations=1)                   # el contorno queda como está
    dark = op & ~edge & (S < .4) & (V < .24)
    L = V / .24
    navy = np.stack([16 + 26 * L, 36 + 44 * L, 100 + 64 * L], -1).clip(0, 255)
    for c in range(3):
        a[..., c] = np.where(dark, navy[..., c], a[..., c])
    Image.fromarray(a.astype(np.uint8)).save(os.path.join(ROOT, "img/autos", out + ".png"))
    print("img/autos/" + out)


def colectivos_ba():
    """Colectivos con los colores de las líneas de Buenos Aires: la carrocería blanca toma el color de la línea (con su
    sombreado) y la pollera, el segundo color. Los vidrios, las ruedas y el equipo del techo quedan."""
    org = os.path.join(ROOT, "arte/autos_originales")
    for hoja, cuerpo, pollera in [("colectivo_amarillo", (246, 200, 46), (36, 132, 70)), ("colectivo_azul", (236, 226, 196), (196, 42, 40))]:
        a = np.array(Image.open(os.path.join(org, hoja + ".png")).convert("RGBA")).astype(float)
        H, S, V = hsv(a); op = a[..., 3] > 0
        edge = op & ~ndimage.binary_erosion(op, iterations=1)
        blanco = op & ~edge & (S < .16) & (V > .62)
        pol = op & ~edge & (S > .35) & (V > .2)                               # la pollera de color del paquete (naranja o azul)
        L = V
        for c in range(3):
            a[..., c] = np.where(blanco, np.clip(cuerpo[c] * (.55 + .5 * L), 0, 255), a[..., c])
            a[..., c] = np.where(pol, np.clip(pollera[c] * (.45 + .75 * L), 0, 255), a[..., c])
        Image.fromarray(a.astype(np.uint8)).save(os.path.join(ROOT, "img/autos", hoja + ".png"))
        print("img/autos/" + hoja)


if __name__ == "__main__":
    {"taxi_ba": taxi_ba, "policia_ba": policia_ba, "colectivos_ba": colectivos_ba}[sys.argv[1]]()
