#!/usr/bin/env python3
"""La fuente de Parque Chas (esquina de seis: Gándara, Ávalos y Victorica): la fuente de plaza de Gemini (pz_fuente) con la
piedra revestida de trencadís, el mosaico de azulejos, platos y espejos rotos que pusieron los vecinos en 2016 para los 90
años del barrio. Cada pedazo es una celda de Voronoi de 4 a 6 px con su color, con la luz del dibujo original, y pastina
gris clara entre pedazos. El agua queda como está.

  python3 herramientas/fuente_mosaico.py   (escribe arte/gemini/achicado/pz_fuente_mosaico.png y parquechas.json)
  python3 herramientas/armar_hd.py         (la suma a los props HD del editor; arte/hd.json la nombra)
"""
import colorsys, os, random
from PIL import Image

D = os.path.join(os.path.dirname(__file__), "..", "arte", "gemini", "achicado")
im = Image.open(os.path.join(D, "pz_fuente.png")).convert("RGBA")
W, H = im.size
src, out = im.load(), im.copy()
o = out.load()
rnd = random.Random(1925)
PAL = [(40, 90, 170), (60, 140, 200), (236, 236, 228), (232, 196, 60), (200, 70, 50), (60, 150, 90), (40, 170, 170),
       (230, 130, 60), (150, 60, 120), (250, 250, 250), (90, 110, 200), (200, 214, 222)]   # azulejos y loza; el espejo, casi blanco
# semillas de los pedazos (más chicos que la grilla, un poco al azar)
sem = [(x + rnd.uniform(0, 6), y + rnd.uniform(0, 4), rnd.choice(PAL)) for y in range(0, H, 4) for x in range(0, W, 6)]
grid = {}
for i, (sx, sy, _) in enumerate(sem): grid.setdefault((int(sx // 12), int(sy // 12)), []).append(i)


def pedazos(x, y):
    best = []
    for gx in range(int(x // 12) - 1, int(x // 12) + 2):
        for gy in range(int(y // 12) - 1, int(y // 12) + 2):
            for i in grid.get((gx, gy), []):
                sx, sy, _ = sem[i]; best.append(((sx - x) ** 2 + (sy - y) ** 2, i))
    best.sort()
    return best[0], best[1]


for y in range(H):
    for x in range(W):
        r, g, b, a = src[x, y]
        if a < 128: continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s >= .22 or v < .25: continue            # agua (azul), sombras y contornos: como estaban
        (d0, i0), (d1, _) = pedazos(x, y)
        luz = min(1.25, max(.45, v / .62))         # la luz del dibujo
        if d1 ** .5 - d0 ** .5 < .55:                 # pastina entre pedazos
            q = int(178 * luz); o[x, y] = (q, q, q - 6, a); continue
        c = sem[i0][2]
        o[x, y] = tuple(max(0, min(255, int(k * luz))) for k in c) + (a,)
out.save(os.path.join(D, "pz_fuente_mosaico.png"))
# su ficha para armar_hd.py (la misma escala y profundidad que la fuente original), aparte de las hojas de achicar.py
import json
ficha = json.load(open(os.path.join(D, "plaza_01.json")))["pz_fuente"]
json.dump({"pz_fuente_mosaico": ficha}, open(os.path.join(D, "parquechas.json"), "w"), indent=1)
print("pz_fuente_mosaico.png", W, H)
