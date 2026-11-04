#!/usr/bin/env python3
"""Datos abiertos de la Ciudad (GCBA) al JSON de herramientas/osm_real.py, para cuando la API de OpenStreetMap no está a mano.

Lee tres archivos del portal data.buenosaires.gob.ar (no se guardan en el repo, pesan 100 MB):
  - Red vial (callejero): red-vial-CABA.geojson, un LineString por cuadra con su nombre oficial, tipo (calle, avenida,
    pasaje) y jerarquía (vía troncal, distribuidora principal o complementaria, local);
  - Arbolado público lineal (censo 2017-2018): arbolado_lineal.csv, cada árbol de vereda con su especie y su altura;
  - Arbolado en espacios verdes: arbolado_verdes.csv, cada árbol de plaza con el nombre de su plaza (de ahí salen las
    plazoletas: la manzana que encierra a sus árboles).

y escribe editor/recursos/osm_<barrio>.json en el formato de osm_real.py (origen, ways, rels, nodes en metros). Los
árboles van como nodos natural=tree con la especie del juego (editor/js/arboles.js) y la altura del censo.

Uso: python3 herramientas/gcba_osm.py --barrio parquechas --red red-vial-CABA.geojson --arbolado arbolado_lineal.csv
                                       --verdes arbolado_verdes.csv
"""
import csv, json, math, re, sys
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union

BARRIOS = {
    # Parque Chas: origen cerca de la esquina de seis (Victorica, Ávalos, Gándara), radio de lo que se baja
    "parquechas": dict(ORIGEN=(-34.5858, -58.4788), R=900, OUT="editor/recursos/osm_parquechas.json", PUNTOS=[
        # la fuente de la esquina de seis, en la rotonda (trencadís de los vecinos, 2016): el nodo de la red vial
        (-34.5825, -58.47925, {"amenity": "fountain", "name": "Fuente de Parque Chas", "rotonda": "si"}),
        # Pizzería Keops, Gándara 2699 (puntoclick.com.ar), en la esquina de seis
        (-34.5823155, -58.4790348, {"amenity": "restaurant", "cuisine": "pizza", "name": "Pizzería Keops", "addr:street": "Gándara"}),
        # Café Chas, Ávalos 1554, en la esquina con Gándara frente a la fuente (Google Maps). Keops y el café son edificios de las
        # esquinas de la fuente (ESQUINAS en osm_real.py): acá sólo quedan anotados
        (-34.5825312, -58.4795314, {"amenity": "cafe", "name": "Café Chas", "addr:street": "Ávalos"}),
    ]),
}

# especie del censo (nombre científico, por prefijo) -> especie del juego. Lo que no está acá es un fresno, que es la mitad
# de los árboles de vereda de la Ciudad; las palmeras no tienen dibujo y no van
ESPECIE = [
    ("Fraxinus", "fresno"), ("Platanus", "platano"), ("Ficus", "ficus"), ("Ligustrum", "ficus"), ("Persea", "ficus"),
    ("Citrus", "ficus"), ("Eriobotrya", "ficus"), ("Brachychiton", "ficus"), ("Magnolia", "ficus"), ("Melia", "paraiso"),
    ("Ailanthus", "paraiso"), ("Erythrina", "paraiso"), ("Lagerstroemia", "crespon"), ("Tilia", "tilo"),
    ("Jacaranda", "jacaranda"), ("Handroanthus", "jacaranda"), ("Tabebuia", "jacaranda"), ("Liquidambar", "otono"),
    ("Ginkgo", "otono"), ("Acer saccharinum", "otono"), ("Tipuana", "tipa"), ("Tecoma", "tipa"), ("Peltophorum", "tipa"),
    ("Ceiba", "palo_borracho"), ("Syagrus", None), ("Washingtonia", None), ("Phoenix", None), ("Butia", None),
]


def especie(cient):
    for pre, e in ESPECIE:
        if cient.startswith(pre): return e
    return "fresno"


TILDES = {"GANDARA": "Gándara", "AVALOS": "Ávalos", "BERLIN": "Berlín", "CADIZ": "Cádiz", "TREVERIS": "Tréveris",
          "DUBLIN": "Dublín", "SOFIA": "Sofía", "TURIN": "Turín", "NAPOLES": "Nápoles", "MOSCU": "Moscú", "QUIROS": "Quirós",
          "BALLIVIAN": "Ballivián", "CHORROARIN": "Chorroarín", "ALVAREZ": "Álvarez", "OLAZABAL": "Olazábal",
          "BENJAMIN": "Benjamín", "ANDRES": "Andrés", "EXODO": "Éxodo", "HECTOR": "Héctor", "FELIX": "Félix",
          "JUJENO": "Jujeño", "MALAVER": "Malaver", "COPENHAGUE": "Copenhague", "CRAMER": "Cramer"}
TITULOS = {"GENERAL", "GRAL.", "DR.", "DR", "CAP.", "TTE.", "PRES.", "ING.", "CNEL.", "PBRO.", "ALTE."}
MINUS = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "E"}


def palabra(w, primera):
    if w in TILDES: return TILDES[w]
    if w in MINUS and not primera: return w.lower()
    return w[:1] + w[1:].lower()


def nombre(n):
    """'VICTORICA, BENJAMIN, GENERAL, AV.' -> 'Av. Victorica'; 'DE LOS INCAS AV.' -> 'Av. de los Incas'"""
    n = (n or "").strip()
    if not n: return ""
    av = bool(re.search(r"\bAV\.?$", n)) or ", AV." in n
    n = re.sub(r",?\s*AV\.?$", "", n).strip()
    partes = [p.strip() for p in n.split(",") if p.strip()]
    partes = [p for p in partes if p.upper() not in TITULOS and not p.upper().startswith(("TTE.", "GRAL"))]
    if len(partes) >= 2 and av: partes = [partes[0]]   # avenida con nombre de persona: el apellido (Av. Victorica, Av. Beiro)
    elif len(partes) >= 2: partes = [partes[1], partes[0]]   # calle con nombre de persona: nombre y apellido
    ws = " ".join(partes).split()
    s = " ".join(palabra(w, i == 0) for i, w in enumerate(ws))
    return ("Av. " + s[:1].lower() + s[1:] if ws[0] in MINUS else "Av. " + s) if av else s


def via(pr):
    """tipo y jerarquía del callejero -> etiquetas highway de OSM (lo que osm_real.py entiende)"""
    tipo, jer = pr.get("tipo_c") or "", pr.get("red_jerarq") or ""
    if tipo == "SENDERO": return {"highway": "footway"}
    if tipo == "PASAJE": return {"highway": "living_street"}
    if "TRONCAL" in jer or "PRINCIPAL" in jer: return {"highway": "secondary", "lanes": "4"}
    if "COMPLEMENTARIA" in jer or tipo == "AVENIDA": return {"highway": "tertiary"}
    return {"highway": "residential"}


def main():
    a = sys.argv
    arg = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    B = BARRIOS[arg("--barrio", "parquechas")]
    LAT0, LON0 = B["ORIGEN"]
    KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540
    M = lambda lon, lat: [round((lon - LON0) * KX, 1), round((lat - LAT0) * KY, 1)]
    R = B["R"]
    cerca = lambda p: abs(p[0]) < R and abs(p[1]) < R

    red = json.load(open(arg("--red")))
    ways, lineas = [], []
    for f in red["features"]:
        g = f["geometry"]
        if g["type"] != "LineString": continue
        p = [M(*q[:2]) for q in g["coordinates"]]
        if not any(cerca(q) for q in p): continue
        pr = f["properties"]
        t = via(pr); n = nombre(pr.get("nomoficial"))
        if n: t["name"] = n
        ways.append({"id": int(pr["id"]), "t": t, "p": p})
        if t["highway"] != "footway": lineas.append(LineString(p))
    print("cuadras", len(ways))

    # plazoletas: la manzana (cara del callejero) que encierra a los árboles de cada espacio verde
    caras = list(polygonize(unary_union(lineas)))
    verdes = {}
    for r in csv.DictReader(open(arg("--verdes"), encoding="utf-8", errors="replace")):
        try: q = M(float(r["long"]), float(r["lat"]))
        except ValueError: continue
        if cerca(q): verdes.setdefault(r["espacio_ve"], []).append(q)
    nid = 9_000_000_000
    for n, qs in verdes.items():
        c = Point(sum(q[0] for q in qs) / len(qs), sum(q[1] for q in qs) / len(qs))
        cara = next((f for f in caras if f.contains(c)), None)
        if cara is None or cara.area > 15000: print("  plaza sin manzana:", n, round(cara.area) if cara else None); continue
        nn = nombre(n)
        nom = ("Plaza " if cara.area > 6000 else "Plazoleta ") + nn
        p = [[round(x, 1), round(y, 1)] for x, y in cara.exterior.coords]
        ways.append({"id": nid, "t": {"leisure": "park", "name": nom}, "p": p}); nid += 1
        print("  ", nom, round(cara.area), "m²")

    # árboles de vereda del censo
    nodes, cuenta = [], {}
    for r in csv.DictReader(open(arg("--arbolado"), encoding="utf-8", errors="replace")):
        try: q = M(float(r["long"]), float(r["lat"]))
        except ValueError: continue
        if not cerca(q): continue
        e = especie(r["nombre_cientifico"] or "")
        if e is None: continue
        try: h = round(float(r["altura_arbol"]))
        except ValueError: h = 0
        nodes.append({"id": int(r["nro_registro"]) + 8_000_000_000, "t": {"natural": "tree", "especie": e, "altura": h}, "x": q})
        cuenta[e] = cuenta.get(e, 0) + 1
    print("árboles", len(nodes), sorted(cuenta.items(), key=lambda kv: -kv[1]))
    # lugares del barrio que no están en los datos de la Ciudad (fuentes, comercios con nombre)
    for k, (lat, lon, t) in enumerate(B.get("PUNTOS", [])):
        nodes.append({"id": 7_000_000_000 + k, "t": t, "x": M(lon, lat)})
    out = {"origen": [LAT0, LON0], "fuente": "GCBA, data.buenosaires.gob.ar: red vial, arbolado público lineal y arbolado en espacios verdes",
           "ways": ways, "rels": [], "nodes": nodes}
    json.dump(out, open(B["OUT"], "w"), ensure_ascii=False, separators=(",", ":"))
    print(B["OUT"])


if __name__ == "__main__":
    main()
