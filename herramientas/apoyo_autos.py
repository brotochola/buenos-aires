#!/usr/bin/env python3
"""Car frames end at the lowest wheel, so WeedJS sorts each car where it touches the ground.

  python3 herramientas/apoyo_autos.py          (after herramientas/hornear_autos.js)

hornear_autos.js centres every frame on the point where the vehicle stands (anchor 0.5, 0.5), so each frame is as
tall below that point as above it: 7 to 22 px of transparent rows under the wheels. WeedJS sorts an entity by the
bottom edge of its frame (spriteSortFootY), so a car sorted that much in front of where it is, and covered trees and
people standing just in front of it. Here each frame's rect is cut at its lowest opaque row and its anchor is kept on
the same point: anchorY = (row of the point) / (new height). The scene sets it when the car changes frame.

Writes the frame rects back into img/autos/<sheet>.json (with "apoyo", the row of the point, so a second run is a
no-op) and img/autos/apoyo.js: APOYO[<sheet>][<animation>] = anchorY.
"""
import glob, json, os
import numpy as np
from PIL import Image

DIR = os.path.join(os.path.dirname(__file__), "..", "img", "autos")
tabla = {}
for jf in sorted(glob.glob(os.path.join(DIR, "*.json"))):
    hoja = os.path.basename(jf)[:-5]
    j = json.load(open(jf))
    if "frames" not in j:
        continue
    alpha = np.array(Image.open(os.path.join(DIR, j["meta"]["image"])).convert("RGBA"))[..., 3]
    ay = {}
    for n, f in j["frames"].items():
        r = f["frame"]
        q = f.get("apoyo", r["h"] / 2)                      # row of the point the car stands on
        a = alpha[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"]]
        rows = np.nonzero(a.max(1))[0]
        h = max(int(rows.max()) + 1 if len(rows) else r["h"], int(np.ceil(q)) + 1)
        r["h"] = h; f["sourceSize"]["h"] = h; f["spriteSourceSize"]["h"] = h; f["apoyo"] = q
        ay[n] = round(q / h, 4)
    tabla[hoja] = {anim: ay[fr[0]] for anim, fr in j.get("animations", {}).items() if fr and fr[0] in ay}
    json.dump(j, open(jf, "w"), separators=(",", ":"))
with open(os.path.join(DIR, "apoyo.js"), "w") as f:
    f.write("// generado por herramientas/apoyo_autos.py — no editar a mano\n"
            "// anchorY de cada cuadro de auto: el punto de apoyo, en cuadros que terminan en la rueda más baja\n"
            "export const APOYO = " + json.dumps(tabla, separators=(",", ":")) + ";\n")
print(f"{len(tabla)} hojas, {sum(len(v) for v in tabla.values())} cuadros")
