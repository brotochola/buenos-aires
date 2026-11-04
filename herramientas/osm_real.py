#!/usr/bin/env python3
"""De OpenStreetMap al barrio real del editor.

Lee el JSON que se bajó de la API de OSM (editor/recursos/osm_carabobo.json: calles, usos del suelo, edificios y POIs en
metros alrededor de un origen) y escribe editor/recursos/real_carabobo.js con lo que world.js necesita para armar el
barrio de verdad en vez de las grillas inventadas:

  - la ventana jugable (girada para que la grilla de Bajo Flores quede casi derecha en pantalla) más el margen;
  - las calles, clasificadas (avenida, calle, pasaje, pasillo) y encajadas en los 48 rumbos de los autos. Cada tramo toma
    el rumbo más cercano y después se mueven los nodos por mínimos cuadrados, así las esquinas siguen siendo las mismas;
  - la villa 1-11-14 (sus manzanas), los complejos de vivienda, plazas, canchas, escuelas, industrias y comercios.

Uso: python3 herramientas/osm_real.py [--barrio carabobo|parquechas] [--png vista.png]
"""
import json, math, sys
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsqr

# cada barrio real: de dónde salen los datos, a dónde van, la ventana (centro en metros del origen del JSON, x al este,
# y al norte), el giro aproximado (se afina solo ±3°), el tamaño jugable, dónde arranca el juego y su estilo (lo que el
# editor hace distinto: tipos de casa por calle o avenida, riqueza, árboles de vereda, variedad del catálogo)
BARRIOS = {
    "carabobo": dict(SRC="editor/recursos/osm_carabobo.json", OUT="editor/recursos/real_carabobo.js", NOMBRE="Carabobo al 1500 y la villa 1-11-14",
                     # en la Capital casi no hay pasto: patios de baldosa y manzanas llenas (la villa sigue con su tierra)
                     CEN=(-304.0, 48.0), ROT=-16.0, PW=480, PH=1080, MG=40, INICIO=(-34.6411515, -58.4462075), ESTILO={"pasto": .2, "fondos": 2}, ESQUINAS=None),
    # Parque Chas (1925, Frehner y Guerrico): calles en anillos alrededor de la esquina de seis (Victorica, Ávalos, Gándara),
    # cuadrícula hacia las avenidas. Casas bajas de los años 30 a 60, PH y dúplex, alguna con tejas, lotes cortos; casi sin
    # comercio adentro; veredas angostas con árboles grandes. Las calles y las plazoletas salen del callejero de la Ciudad y
    # los árboles de vereda, uno por uno, del censo de arbolado (herramientas/gcba_osm.py): fresnos (casi la mitad),
    # plátanos, ficus, paraísos, tilos, crespones, jacarandás. "arboles" queda para las plazas
    "parquechas": dict(SRC="editor/recursos/osm_parquechas.json", OUT="editor/recursos/real_parquechas.js", NOMBRE="Parque Chas",
                       # la ventana entra los anillos y las cinco plazas del barrio (Éxodo Jujeño y Sarmiento adentro, Nobel, Chazarreta y
                       # Jamaica al sur). Giro 265,25°: tan bueno como el mejor para los rumbos de los autos (costo 53) y deja a la
                       # cámara el frente del Café Chas sobre Ávalos y el de Keops sobre Gándara (con 28,5° quedaban de espaldas)
                       CEN=(-143.0, 114.0), ROT=265.25, PW=950, PH=870, MG=40, INICIO=(-34.58218, -58.47922),
                       # vereda: la mediana del censo de arbolado (4,2 m); pasto: casi nada (patios de baldosa); fondos: manzanas llenas
                       ESTILO={"riqueza": .58, "variedad": 1.4, "tejas": .28, "vereda": 4.2, "pasto": .15, "fondos": 2.5,
                               "casas": [["casa", 30], ["casa2", 26], ["ph", 24], ["chalet", 8], ["negocio_casa", 1.2], ["negocio", .8], ["obra", 1], ["edificio", .4]],
                               "casasAvenida": [["negocio", 26], ["negocio_casa", 24], ["casa2", 16], ["ph", 14], ["edificio", 12], ["casa", 8], ["galpon", 2]],
                               "arboles": {"fresno": 30, "tilo": 16, "platano": 12, "ficus": 10, "paraiso": 10, "jacaranda": 10, "crespon": 10, "tipa": 4}},
                       # las seis esquinas de la fuente, copiadas a mano (foto 360° desde la fuente, Hernán Apaza, 2018; Keops y el Café Chas
                       # en Google Maps, 2026): rumbo de brújula de la esquina desde la fuente, el edificio, las plantas
                       ESQUINAS=[{"rumbo": 34, "tipo": "keops", "pisos": 3, "cartelEn": "Gándara"},          # Victorica y Gándara: Pizzería Keops (Gándara 2699)
                                 {"rumbo": 92, "tipo": "ladrillo", "pisos": 2},                              # Gándara y Ávalos (al este)
                                 {"rumbo": 152, "tipo": "moderno", "pisos": 2},                              # Ávalos y Victorica (al sudeste)
                                 {"rumbo": 212, "tipo": "gris", "pisos": 2},                                 # Victorica y Gándara (al sudoeste)
                                 {"rumbo": 272, "tipo": "artdeco", "pisos": 3, "redonda": True, "cafe": "Ávalos"},   # Gándara y Ávalos: Café Chas (Ávalos 1554)
                                 {"rumbo": 332, "tipo": "balaustres", "pisos": 2}]),                         # Ávalos y Victorica (al noroeste)
}
_b = sys.argv[sys.argv.index("--barrio") + 1] if "--barrio" in sys.argv else "carabobo"
CFG_B = BARRIOS[_b]
SRC, OUT, NOMBRE = CFG_B["SRC"], CFG_B["OUT"], CFG_B["NOMBRE"]
CEN = CFG_B["CEN"]
ROT_APROX = float(sys.argv[sys.argv.index("--rot") + 1]) if "--rot" in sys.argv else CFG_B["ROT"]   # se afina solo (±3°) para que las calles caigan lo más cerca posible de los rumbos; None: se busca entero
PW, PH, MG = CFG_B["PW"], CFG_B["PH"], CFG_B["MG"]
INICIO = CFG_B["INICIO"]
MW, MH = PW + 2 * MG, PH + 2 * MG
K, SYN = .16, .5           # proyección oblicua del juego (R3.K, R3.SYN)

ANG = []
for k in range(48):
    a = k * math.pi / 24
    dy, dx = -math.sin(a) / SYN, math.cos(a) + K * math.sin(a) / SYN
    ANG.append(math.atan2(dy, dx) % (2 * math.pi))
ANG.sort()


def ang_idx(t):
    t %= 2 * math.pi
    return min(range(48), key=lambda i: abs((ANG[i] - t + math.pi) % (2 * math.pi) - math.pi))


def ang_err(t):
    i = ang_idx(t)
    return abs((ANG[i] - t + math.pi) % (2 * math.pi) - math.pi)


# ---------------------------------------------------------------- polígonos
def area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def inside(poly, x, y):
    c = False
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]; bx, by = poly[(i + 1) % n]
        if (ay > y) != (by > y) and x < ax + (bx - ax) * (y - ay) / (by - ay):
            c = not c
    return c


def dp(pts, tol):
    """Douglas-Peucker"""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.sqrt(dx * dx + dy * dy) or 1e-9
    mi, md = -1, tol
    for k in range(1, len(pts) - 1):
        d = abs((pts[k][0] - a[0]) * dy - (pts[k][1] - a[1]) * dx) / L
        if d > md:
            md, mi = d, k
    if mi < 0:
        return [a, b]
    return dp(pts[:mi + 1], tol)[:-1] + dp(pts[mi:], tol)


def dp_ring(p, tol):
    """Douglas-Peucker de un anillo (sin repetir el primer punto al final)"""
    if len(p) < 4:
        return p
    m = max(range(len(p)), key=lambda k: (p[k][0] - p[0][0]) ** 2 + (p[k][1] - p[0][1]) ** 2)
    a = dp(p[:m + 1], tol)
    b = dp(p[m:] + [p[0]], tol)
    return a[:-1] + b[:-1]


def ring_from_ways(ways):
    """une vías (listas de puntos) en anillos cerrados"""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); changed = True; break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur[:-1])
    return rings


def main():
    j = json.load(open(SRC))
    W = {w["id"]: w for w in j["ways"]}

    # ------------------------------------------------ giro: el que deja las calles más cerca de los rumbos de los autos
    calles0 = [w for w in j["ways"] if w["t"].get("highway") in ("residential", "secondary", "tertiary", "living_street", "pedestrian", "unclassified")]

    def costo(rot):
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        tot = 0
        for w in calles0:
            for (x0, y0), (x1, y1) in zip(w["p"], w["p"][1:]):
                if math.hypot(x0 - CEN[0], y0 - CEN[1]) > 800: continue
                dx, dy = x1 - x0, y1 - y0
                L = math.hypot(dx, dy)
                if L < 8: continue
                tot += L * ang_err(math.atan2(s * dx + c * dy, c * dx - s * dy)) ** 2
        return tot
    rot0 = ROT_APROX if ROT_APROX is not None else min(range(-45, 46), key=costo)   # sin giro dado: el mejor grado entre -45 y 45
    ROT = min((rot0 + d / 8 for d in range(-24, 25)), key=costo)
    cr, sr = math.cos(math.radians(ROT)), math.sin(math.radians(ROT))
    print("giro", ROT, "costo", round(costo(ROT)), "(sin afinar", round(costo(rot0)), ")")

    def T(p):
        x, y = p[0] - CEN[0], p[1] - CEN[1]
        return (cr * x - sr * y + MW / 2, sr * x + cr * y + MH / 2)

    BX0, BY0, BX1, BY1 = -40, -40, MW + 40, MH + 40
    en_caja = lambda q: BX0 <= q[0] <= BX1 and BY0 <= q[1] <= BY1
    en_mundo = lambda q, m=0: -m <= q[0] <= MW + m and -m <= q[1] <= MH + m

    def poly_de(w):
        p = [T(q) for q in w["p"]]
        if len(p) > 2 and p[0] == p[-1]: p = p[:-1]
        return p

    def toca(p, m=10):
        return any(en_mundo(q, m) for q in p)

    # ------------------------------------------------ zonas
    villas, complejos, parques, canchas, escuelas, industrias, juegos = [], [], [], [], [], [], []
    for w in j["ways"]:
        t = w["t"]
        if len(w["p"]) < 4 or w["p"][0] != w["p"][-1]: continue
        p = poly_de(w)
        if not toca(p): continue
        if area(p) < 0: p = p[::-1]
        n = t.get("name", "")
        if t.get("landuse") == "residential" and n:
            if n.startswith("Manzana") or n.startswith("Sector") or n == "Barrio Polideportivo" or n.startswith("Villa"):
                villas.append({"n": n, "p": p})
            elif n.startswith("Barrio") or n.startswith("Complejo"):
                complejos.append({"n": n, "p": p})
        elif t.get("leisure") in ("park", "garden", "village_green") or t.get("landuse") in ("grass", "recreation_ground", "village_green"):
            parques.append({"n": n, "p": p, "a": abs(area(p))})
        elif t.get("leisure") == "pitch":
            canchas.append({"n": n, "p": p, "s": t.get("sport", "soccer")})
        elif t.get("leisure") == "playground":
            juegos.append({"n": n, "p": p})
        elif t.get("amenity") in ("school", "kindergarten", "college"):
            escuelas.append({"n": n, "p": p})
        elif t.get("landuse") in ("industrial",) or t.get("building") in ("warehouse", "industrial"):
            industrias.append({"n": n, "p": p})
    # la villa como relación (el contorno entero), además de sus manzanas
    for r in j["rels"]:
        if "1-11-14" in r["t"].get("name", "") or "1-11-14" in r["t"].get("alt_name", ""):
            for ring in ring_from_ways([W[ref]["p"] for ref, role in r["m"] if ref in W and role in ("outer", "")]):
                p = [T(q) for q in ring]
                if area(p) < 0: p = p[::-1]
                if toca(p): villas.append({"n": "Villa 1-11-14", "p": p, "contorno": True})
    print("villas", len(villas), "complejos", [c["n"] for c in complejos], "parques", len(parques), "canchas", len(canchas), "escuelas", len(escuelas))
    villa_polys = [v["p"] for v in villas]
    en_villa = lambda q: any(inside(p, q[0], q[1]) for p in villa_polys)
    en_parque = lambda q: any(inside(p["p"], q[0], q[1]) for p in parques)

    # ------------------------------------------------ calles: tipo y ancho
    vias = []   # {pts (mundo), typ, hw, med, name, tierra, oneway, cls}

    def lanes(t, d):
        try: return max(1, int(str(t.get("lanes", d)).split(";")[0]))
        except ValueError: return d
    for w in j["ways"]:
        t = w["t"]; hw = t.get("highway")
        if not hw or t.get("area") == "yes": continue
        pts = [T(q) for q in w["p"]]
        if not toca(pts, 30): continue
        mid = pts[len(pts) // 2]
        n = t.get("name", "")
        ow = t.get("oneway") == "yes"
        v = None
        if hw in ("primary", "secondary", "primary_link", "secondary_link") or (hw == "tertiary" and lanes(t, 2) >= 4):
            L = lanes(t, 2 if ow else 4)
            v = {"typ": "ave", "hw": round(L * 3.1 / 2 + .4, 1), "med": 0}
        elif hw in ("tertiary", "tertiary_link"):
            v = {"typ": "calle", "hw": 4.6, "ancha": 1}
        elif hw in ("residential", "unclassified", "road"):
            v = {"typ": "calle", "hw": 3.7}
        elif hw == "living_street":
            v = {"typ": "pasaje", "hw": 2.8}
        elif hw == "service":
            if t.get("service") in ("parking_aisle", "driveway", "drive-through", "emergency_access"): continue
            if en_villa(mid): v = {"typ": "pasaje", "hw": 2.3, "tierra": 1} if n else {"typ": "pasillo", "hw": 1.1}
            else: v = {"typ": "pasaje", "hw": 2.6}
        elif hw == "pedestrian":
            v = {"typ": "pasillo", "hw": 1.6}
        elif hw in ("footway", "path", "steps", "track", "cycleway"):
            if t.get("footway") in ("sidewalk", "crossing") or hw == "cycleway": continue
            if en_parque(mid) and not en_villa(mid): v = {"typ": "sendero"}
            else: v = {"typ": "pasillo", "hw": .9 if en_villa(mid) else 1.1}
        if not v: continue
        v.update({"pts": pts, "name": n, "oneway": ow, "raw": [tuple(q) for q in w["p"]]})
        vias.append(v)

    # avenidas de doble mano con cantero: dos vías de una mano con el mismo nombre. Si están cerca (< 16 m) se juntan en una
    # avenida con cantero; si están lejos (bulevar con plazoleta, como Carabobo) quedan como dos calles y la plazoleta en el medio
    def dist_pl(q, pts):
        best = 1e9
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1e-9
            u = max(0, min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / L2))
            best = min(best, math.hypot(q[0] - ax - dx * u, q[1] - ay - dy * u))
        return best
    juntadas = 0
    por_nombre = {}
    for v in vias:
        if v["typ"] in ("ave", "calle") and v["oneway"] and v["name"]: por_nombre.setdefault(v["name"], []).append(v)
    for n, L in por_nombre.items():
        for a in L:
            if a.get("muerta") or a.get("junta"): continue
            da = (a["pts"][-1][0] - a["pts"][0][0], a["pts"][-1][1] - a["pts"][0][1])
            best, bd = None, 1e9
            for b in L:
                if b is a or b.get("muerta") or b.get("junta"): continue
                db = (b["pts"][-1][0] - b["pts"][0][0], b["pts"][-1][1] - b["pts"][0][1])
                if da[0] * db[0] + da[1] * db[1] >= 0: continue
                d = sum(dist_pl(q, b["pts"]) for q in a["pts"]) / len(a["pts"])
                if d < bd: bd, best = d, b
            if best is None or bd > 40: continue
            if bd < 16:
                # centro: cada punto de a, corrido hasta la mitad hacia b
                nuevos = []
                for q in a["pts"]:
                    bq, bdd = None, 1e9
                    for (ax, ay), (bx, by) in zip(best["pts"], best["pts"][1:]):
                        dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1e-9
                        u = max(0, min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / L2))
                        c = (ax + dx * u, ay + dy * u); dd = math.hypot(q[0] - c[0], q[1] - c[1])
                        if dd < bdd: bdd, bq = dd, c
                    nuevos.append(((q[0] + bq[0]) / 2, (q[1] + bq[1]) / 2))
                carril = a["hw"] * 2 if a["typ"] == "ave" else 6.2
                a.update({"pts": nuevos, "typ": "ave", "hw": round(bd / 2 + carril / 2, 1), "med": round(max(.6, bd / 2 - carril / 2), 1), "junta": True, "raw": None})
                best["muerta"] = True; juntadas += 1
            else:
                for x in (a, best): x.update({"typ": "calle", "hw": max(3.7, min(5.2, x["hw"])), "ancha": 1, "bulevar": True})
    vias = [v for v in vias if not v.get("muerta")]
    print("avenidas juntadas", juntadas)

    # veredas dibujadas como footway sin etiqueta: un pasillo pegado y paralelo a una calle no va
    autos = [v for v in vias if v["typ"] in ("ave", "calle", "pasaje")]
    def pegado(v):
        if v["typ"] != "pasillo": return False
        cerca = 0
        for q in v["pts"]:
            if any(dist_pl(q, o["pts"]) < o["hw"] + 3.5 for o in autos): cerca += 1
        return cerca >= .7 * len(v["pts"]) and len(v["pts"]) >= 2
    antes = len(vias)
    vias = [v for v in vias if not pegado(v)]
    print("pasillos pegados a calles (veredas) afuera:", antes - len(vias))
    senderos = [v for v in vias if v["typ"] == "sendero"]
    vias = [v for v in vias if v["typ"] != "sendero"]

    # ------------------------------------------------ grafo, simplificación y encaje en los rumbos
    CL = {"ave": 4, "calle": 3, "pasaje": 2, "pasillo": 1}
    verts, vkey = [], {}

    def vid(q):
        k = (round(q[0] * 10), round(q[1] * 10))
        if k not in vkey: vkey[k] = len(verts); verts.append([q[0], q[1]])
        return vkey[k]

    def clip(pts):
        """parte la polilínea donde sale de la caja"""
        out, cur = [], []
        for a, b in zip(pts, pts[1:]):
            t0, t1 = 0, 1; dx, dy = b[0] - a[0], b[1] - a[1]; ok = True
            for p, q in ((-dx, a[0] - BX0), (dx, BX1 - a[0]), (-dy, a[1] - BY0), (dy, BY1 - a[1])):
                if p == 0:
                    if q < 0: ok = False; break
                    continue
                r = q / p
                if p < 0: t0 = max(t0, r)
                else: t1 = min(t1, r)
            if not ok or t0 >= t1:
                if cur: out.append(cur); cur = []
                continue
            A = (a[0] + dx * t0, a[1] + dy * t0); B = (a[0] + dx * t1, a[1] + dy * t1)
            if not cur: cur = [A]
            cur.append(B)
            if t1 < 1: out.append(cur); cur = []
        if cur: out.append(cur)
        return [c for c in out if len(c) >= 2]

    edges = {}   # (i, j) ordenado -> props

    def pkey(v):
        return (v["typ"], v["name"], v.get("hw"), v.get("med", 0), v.get("tierra", 0), v.get("ancha", 0))
    for v in vias:
        for part in clip(v["pts"]):
            ids = [vid(q) for q in part]
            for a, b in zip(ids, ids[1:]):
                if a == b: continue
                k = (min(a, b), max(a, b))
                if k not in edges or CL[v["typ"]] > CL[edges[k]["typ"]]: edges[k] = {"typ": v["typ"], "pk": pkey(v), "v": v}
    # vértices a menos de 1 m: el mismo
    V = np.array(verts)
    parent = list(range(len(verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    from collections import defaultdict
    cell = defaultdict(list)
    for i, (x, y) in enumerate(verts): cell[(int(x // 1), int(y // 1))].append(i)
    for i, (x, y) in enumerate(verts):
        cx, cy = int(x // 1), int(y // 1)
        for ddx in (-1, 0, 1):
            for ddy in (-1, 0, 1):
                for o in cell[(cx + ddx, cy + ddy)]:
                    if o > i and math.hypot(verts[o][0] - x, verts[o][1] - y) < 1.0: parent[find(o)] = find(i)
    E = {}
    for (a, b), pr in edges.items():
        a, b = find(a), find(b)
        if a == b: continue
        k = (min(a, b), max(a, b))
        if k not in E or CL[pr["typ"]] > CL[E[k]["typ"]]: E[k] = pr
    adj = defaultdict(list)
    for (a, b), pr in E.items(): adj[a].append((b, (a, b))); adj[b].append((a, (a, b)))
    # cadenas: entre vértices que no son de grado 2 (o donde cambia la vía)
    def nodo(i):
        if len(adj[i]) != 2: return True
        (_, e0), (_, e1) = adj[i]
        return E[e0]["pk"] != E[e1]["pk"]
    usados, cadenas = set(), []
    for i in list(adj):
        if not nodo(i): continue
        for (n, e) in adj[i]:
            if e in usados: continue
            ch, prev, cur, ee = [i], i, n, e
            usados.add(e)
            while True:
                ch.append(cur)
                if nodo(cur) or cur == i: break
                nxt = [(m, f) for (m, f) in adj[cur] if f not in usados]
                if not nxt: break
                m, f = nxt[0]; usados.add(f); prev, cur = cur, m
            cadenas.append((ch, E[e]))
    for e in E:   # anillos sueltos sin nodos
        if e not in usados:
            usados.add(e); cadenas.append(([e[0], e[1]], E[e]))
    TOL = {"ave": 2.0, "calle": 1.6, "pasaje": 1.2, "pasillo": .8}
    S = []   # aristas simplificadas: (i, j, props)
    for ch, pr in cadenas:
        pts = [(verts[k][0], verts[k][1], k) for k in ch]
        xy = [(p[0], p[1]) for p in pts]
        simp = dp_ring(xy[:-1], TOL[pr["typ"]]) + [xy[0]] if ch[0] == ch[-1] and len(ch) > 3 else dp(xy, TOL[pr["typ"]])
        ks, si = [], 0
        for q in simp:
            while (pts[si][0], pts[si][1]) != q: si += 1
            ks.append(pts[si][2])
        for a, b in zip(ks, ks[1:]):
            if a != b: S.append([a, b, pr])
    print("vértices", len(verts), "aristas", len(E), "cadenas", len(cadenas), "tramos simplificados", len(S))

    # mínimos cuadrados: cada tramo en su rumbo (fuerte), su largo a lo largo del rumbo (suave, así ninguno se achica a
    # nada ni se da vuelta) y cada vértice cerca de donde estaba (suave). Los tramos cortos que igual quedan torcidos (entre
    # dos restricciones que se pelean) se cierran en un punto y se vuelve a encajar.
    def encajar(S):
        used = sorted({k for a, b, _ in S for k in (a, b)})
        col = {k: n for n, k in enumerate(used)}
        p0 = np.array([verts[k] for k in used]).reshape(-1)
        rows, cols, vals, rhs = [], [], [], []
        WE, WV, WL = 6.0, .25, .6
        r = 0
        snap = []
        for a, b, pr in S:
            dx, dy = verts[b][0] - verts[a][0], verts[b][1] - verts[a][1]
            i = ang_idx(math.atan2(dy, dx)); th = ANG[i]; nx, ny = -math.sin(th), math.cos(th); ux, uy = math.cos(th), math.sin(th)
            snap.append(i)
            L = math.hypot(dx, dy)
            w = WE * min(1.0, max(.3, L / 6))
            ia, ib = col[a], col[b]
            for (ex, ey, ww, val) in ((nx, ny, w, 0), (ux, uy, WL, WL * (dx * ux + dy * uy))):
                for c_, v_ in ((2 * ib, ex * ww), (2 * ib + 1, ey * ww), (2 * ia, -ex * ww), (2 * ia + 1, -ey * ww)):
                    rows.append(r); cols.append(c_); vals.append(v_)
                rhs.append(val); r += 1
        for n in range(len(used)):
            for d in (0, 1):
                rows.append(r); cols.append(2 * n + d); vals.append(WV); rhs.append(WV * p0[2 * n + d]); r += 1
        A = coo_matrix((vals, (rows, cols)), shape=(r, 2 * len(used))).tocsr()
        sol = lsqr(A, np.array(rhs), x0=p0, atol=1e-10, btol=1e-10, iter_lim=20000)[0]
        for k, n in col.items(): verts[k] = [float(sol[2 * n]), float(sol[2 * n + 1])]
        mov = np.hypot(sol[0::2] - p0[0::2], sol[1::2] - p0[1::2])
        errs = []
        for (a, b, pr), i in zip(S, snap):
            dx, dy = verts[b][0] - verts[a][0], verts[b][1] - verts[a][1]
            errs.append(abs((ANG[i] - math.atan2(dy, dx) + math.pi) % (2 * math.pi) - math.pi) if math.hypot(dx, dy) > .3 else 0)
        return snap, errs, mov
    orig = {k: list(v) for k, v in enumerate(verts)}
    for vuelta in range(4):
        snap, errs, mov = encajar(S)
        malos = [n_ for n_, e in enumerate(errs) if e > math.radians(2.5)]
        print("encaje %d: movimiento medio %.2f m, máximo %.2f m; error de rumbo máx %.2f°, tramos torcidos %d" % (vuelta, mov.mean(), mov.max(), math.degrees(max(errs)), len(malos)))
        if not malos: break
        ren = {}
        def fin(k):
            while k in ren: k = ren[k]
            return k
        for n_ in malos:
            a, b, pr = S[n_]; a, b = fin(a), fin(b)
            if a == b: continue
            L = math.hypot(verts[b][0] - verts[a][0], verts[b][1] - verts[a][1])
            if L > 6: continue   # uno largo torcido: queda (se ve en el informe)
            verts[a] = [(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2]; ren[b] = a
        S = [[fin(a), fin(b), pr] for a, b, pr in S]
        S = [x for x in S if x[0] != x[1]]
        # vuelve a encajar desde la posición original (con los cierres hechos)
        for k in {k for a, b, _ in S for k in (a, b)}:
            if k not in ren.values() and k in orig: verts[k] = list(orig[k])
    for (a, b, pr), e in zip(S, errs):
        if e > math.radians(2.5): print("  queda torcido", pr["typ"], pr["v"]["name"], round(math.degrees(e)), [round(c) for c in verts[a]])

    # tramos seguidos con el mismo rumbo y la misma vía se juntan en uno
    deg = defaultdict(list)
    for n_, (a, b, pr) in enumerate(S): deg[a].append(n_); deg[b].append(n_)
    hecho, segs = set(), []
    def otro(n_, k): a, b, _ = S[n_]; return b if a == k else a
    for n_ in range(len(S)):
        if n_ in hecho: continue
        a, b, pr = S[n_]
        i = snap[n_]
        cadena = [a, b]; hecho.add(n_)
        for lado in (0, 1):
            while True:
                k = cadena[-1] if lado == 0 else cadena[0]
                if len(deg[k]) != 2: break
                m = [x for x in deg[k] if x not in hecho]
                if not m: break
                m = m[0]
                if S[m][2]["pk"] != pr["pk"] or (snap[m] % 24) != (i % 24): break
                hecho.add(m)
                if lado == 0: cadena.append(otro(m, k))
                else: cadena.insert(0, otro(m, k))
        A_, B_ = verts[cadena[0]], verts[cadena[-1]]
        if math.hypot(B_[0] - A_[0], B_[1] - A_[1]) < 1.5: continue
        segs.append((A_, B_, pr))
    print("tramos finales", len(segs))

    # lo que está entre las calles (plazas, árboles de vereda) se corre con ellas: el corrimiento de los vértices más cercanos
    # (encaje de arriba), pesado por la distancia. En las curvas de Parque Chas las calles se mueven hasta 20 m
    from scipy.spatial import cKDTree
    usados = sorted({k for a, b, _ in S for k in (a, b)} & set(orig))
    O_ = np.array([orig[k] for k in usados]); D_ = np.array([verts[k] for k in usados]) - O_
    arbol_v = cKDTree(O_)

    def mover(q):
        d, i = arbol_v.query(q, k=min(6, len(usados)))
        w = 1 / (np.asarray(d) ** 2 + 25)
        m = (D_[np.atleast_1d(i)] * np.atleast_1d(w)[:, None]).sum(0) / np.atleast_1d(w).sum()
        return (q[0] + float(m[0]), q[1] + float(m[1]))
    for p_ in parques: p_["p"] = [mover(q) for q in p_["p"]]

    # ------------------------------------------------ edificios altos y comercios (para más adelante)
    edificios = []
    for w in j["ways"]:
        t = w["t"]
        if not t.get("building") or len(w["p"]) < 4: continue
        try: lv = float(str(t.get("building:levels", "0")).split(";")[0])
        except ValueError: lv = 0
        if lv < 3 and t.get("building") not in ("apartments", "school", "church", "hospital", "warehouse", "industrial", "commercial", "retail"): continue
        p = poly_de(w)
        if not toca(p, 0) or abs(area(p)) < 60: continue
        if area(p) < 0: p = p[::-1]
        q = dp_ring(p, .8)
        if len(q) >= 3: edificios.append({"t": t.get("building"), "lv": lv, "p": q})
    pois, rotondas = [], []
    for nd in j["nodes"]:
        t = nd["t"]
        if t.get("amenity") == "fountain" and t.get("rotonda"):
            # una fuente en una rotonda (Parque Chas): el centro es el cruce más cercano, ya encajado; isla de 4,5 m de radio y
            # calzada de la rotonda hasta los 12 m
            q = mover(T(nd["x"]))
            ext = [p_ for a_, b_, _ in segs for p_ in (a_, b_)]
            c = min(ext, key=lambda p_: math.hypot(p_[0] - q[0], p_[1] - q[1]))
            if math.hypot(c[0] - q[0], c[1] - q[1]) < 12 and en_mundo(c):
                rotondas.append([round(c[0], 2), round(c[1], 2), float(t.get("rotonda:isla", 4.5)), float(t.get("rotonda:radio", 12)), t.get("name", "")])
            continue
        if not (t.get("shop") or t.get("amenity") in ("restaurant", "cafe", "bar", "fast_food", "pharmacy", "place_of_worship", "school", "bank", "fuel", "kindergarten", "community_centre")): continue
        q = T(nd["x"])
        if not en_mundo(q): continue
        q = mover(q)
        pois.append({"x": round(q[0], 1), "y": round(q[1], 1), "k": t.get("shop") or t.get("amenity"), "n": t.get("name", ""),
                     # un comercio con nombre que el editor pone en su lote (cartel y rubro: gcba_osm.py)
                     **({"cartel": t["cartel"], "rubro": t.get("rubro", ""), "calle": t.get("addr:street", "")} if t.get("cartel") else {})})

    # árboles de vereda de un censo (gcba_osm.py: natural=tree con la especie del juego y la altura): cada uno donde está
    especies, arboles = [], []
    for nd in j["nodes"]:
        t = nd["t"]
        if t.get("natural") != "tree" or not t.get("especie"): continue
        q = T(nd["x"])
        if not en_mundo(q, 30): continue
        q = mover(q)
        if not en_mundo(q, -1): continue
        if t["especie"] not in especies: especies.append(t["especie"])
        arboles.append([round(q[0], 1), round(q[1], 1), especies.index(t["especie"]), int(t.get("altura") or 0)])

    # ------------------------------------------------ salida
    R = lambda v: round(v, 1)
    simp = dp_ring
    for L_ in (villas, complejos, parques, canchas, escuelas, industrias):
        L_[:] = [x for x in L_ if len(simp(x["p"], .5)) >= 3]
    RP = lambda p: [[R(a), R(b)] for a, b in p]
    nombres = sorted({pr["v"]["name"] for _, _, pr in segs if pr["v"]["name"]})
    NI = {n: i for i, n in enumerate(nombres)}
    TIP = {"ave": 0, "calle": 1, "pasaje": 2, "pasillo": 3}
    out = {
        "nombre": NOMBRE, "carpeta": _b, **({"estilo": CFG_B["ESTILO"]} if CFG_B["ESTILO"] else {}), "rot": ROT, "cen": CEN, "PW": PW, "PH": PH, "MG": MG, "MW": MW, "MH": MH,
        "nombres": nombres,
        "inicio": [R(v) for v in T(((INICIO[1] - j["origen"][1]) * 111320 * math.cos(math.radians(j["origen"][0])), (INICIO[0] - j["origen"][0]) * 110950))],
        # tramo: [ax, ay, bx, by, tipo (0 ave, 1 calle, 2 pasaje, 3 pasillo), nombre (-1 sin), medio ancho de calzada, medio cantero, banderas (1 tierra, 2 ancha, 4 bulevar)]
        "segs": [[R(a[0]), R(a[1]), R(b[0]), R(b[1]), TIP[pr["typ"]], NI.get(pr["v"]["name"], -1), pr["v"].get("hw", 1), pr["v"].get("med", 0),
                  (1 if pr["v"].get("tierra") else 0) | (2 if pr["v"].get("ancha") else 0) | (4 if pr["v"].get("bulevar") else 0)] for a, b, pr in segs],
        "senderos": [RP(dp(v["pts"], .6)) for v in senderos],
        "villas": [{"n": v["n"], "p": RP(dp_ring(v["p"], .5)), **({"contorno": 1} if v.get("contorno") else {})} for v in villas],
        "complejos": [{"n": c["n"], "p": RP(dp_ring(c["p"], .5))} for c in complejos],
        "parques": [{"n": p["n"], "p": RP(dp_ring(p["p"], .4))} for p in parques],
        "canchas": [{"s": c["s"], "p": RP(dp_ring(c["p"], .3))} for c in canchas],
        "juegos": [{"p": RP(c["p"])} for c in juegos],
        "escuelas": [{"n": c["n"], "p": RP(dp_ring(c["p"], .5))} for c in escuelas],
        "industrias": [{"p": RP(dp_ring(c["p"], .5))} for c in industrias],
        "edificios": [{"t": e["t"], "lv": e["lv"], "p": RP(e["p"])} for e in edificios],
        "pois": pois,
        # rotonda: [x, y, radio de la isla, radio de la calzada, nombre de la fuente]
        **({"rotondas": rotondas} if rotondas else {}),
        **({"esquinas": CFG_B["ESQUINAS"]} if CFG_B.get("ESQUINAS") else {}),
        **({"especies": especies, "arboles": arboles} if arboles else {}),
    }
    with open(OUT, "w") as f:
        f.write("// generado por herramientas/osm_real.py con datos de " + (j.get("fuente") or "OpenStreetMap (© colaboradores de OpenStreetMap, ODbL)") + "\n")
        f.write("// " + NOMBRE + "\n(window.REALES = window.REALES || {})." + _b + " = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(OUT, "segs", len(out["segs"]), "nombres", len(nombres), "pois", len(pois), "edificios", len(edificios), "árboles", len(arboles), "rotondas", rotondas)

    if "--png" in sys.argv:
        from PIL import Image, ImageDraw
        sc = 1.2
        im = Image.new("RGB", (int(MW * sc), int(MH * sc)), (244, 240, 230)); d = ImageDraw.Draw(im)
        P = lambda q: (q[0] * sc, (MH - q[1]) * sc)
        for v in out["villas"]: d.polygon([P(q) for q in v["p"]], fill=(222, 196, 180) if not v.get("contorno") else None, outline=(170, 90, 60))
        for c in out["complejos"]: d.polygon([P(q) for q in c["p"]], outline=(80, 120, 220))
        for p in out["parques"]: d.polygon([P(q) for q in p["p"]], fill=(170, 215, 150))
        for c in out["canchas"]: d.polygon([P(q) for q in c["p"]], fill=(110, 180, 110))
        for e in out["escuelas"]: d.polygon([P(q) for q in e["p"]], outline=(220, 120, 0))
        for e in out["edificios"]: d.polygon([P(q) for q in e["p"]], fill=(150, 140, 160))
        for s in out["senderos"]: d.line([P(q) for q in s], fill=(200, 120, 90), width=2)
        colr = {0: (230, 140, 40), 1: (70, 70, 70), 2: (120, 120, 200), 3: (200, 60, 60)}
        for s in out["segs"]:
            d.line([P((s[0], s[1])), P((s[2], s[3]))], fill=colr[s[4]], width=max(1, int(s[6] * 2 * sc * .7)))
        d.rectangle([P((MG, MH - MG)), P((MW - MG, MG))], outline=(0, 0, 0), width=2)
        for a_ in out.get("arboles", []): d.ellipse([P((a_[0] - .8, a_[1] + .8)), P((a_[0] + .8, a_[1] - .8))], fill=(40, 140, 40))
        for s in out["segs"]:
            if s[5] >= 0 and math.hypot(s[2] - s[0], s[3] - s[1]) > 60:
                d.text(P(((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)), nombres[s[5]][:22], fill=(0, 0, 160))
        im.save(sys.argv[sys.argv.index("--png") + 1])


if __name__ == "__main__":
    main()
