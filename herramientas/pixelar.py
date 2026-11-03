#!/usr/bin/env python3
"""Clean up Gemini sprite sheets into true pixel art, keeping Gemini's own pixel grid.

  python3 herramientas/pixelar.py arte/gemini/<sheet>.json [...]

Input: arte/gemini/<sheet>.png (Gemini's original, 1376x768, flat magenta or cyan background) and a JSON spec:
  {"img": "<sheet>.png", "bg": "magenta"|"cyan", "objs": [
     {"name": "hd_led", "h": 9.0, "d": 0.3, "at": [x, y]},      # height and depth (m) seen in the oblique view
     {"name": "hd_banco", "w": 1.9, "at": [x, y]},               # or the width (m)
     {"name": "fd_ventana", "w": 1.2, "box": [x0, y0, x1, y1]}]} # explicit crop (e.g. without the wall around it)
  "at" / "box" are in the coordinates of the 1024-px preview ("ref": 1024); they're scaled to the real image.

Steps
  1. chroma key (magenta or cyan, plus the background-colored fringe);
  2. Gemini's pixel size and phase: color changes repeat every P px (comb over the autocorrelation of the
     edge profile; the smallest P whose score is close to the best one, so harmonics don't win);
  3. each cell of that grid becomes ONE pixel: the median color of the cell's center (no blending across cells),
     opaque if most of the cell is. That's the drawing at its own resolution: nothing is shrunk past its grid;
  4. palette: the sheet is reduced to N colors (noise goes away); isolated pixels removed;
     leftover background-colored pixels take their neighbors' color;
  5. objects = blobs on the native grid, matched to the spec by position.
Each object is saved at native resolution; its "k" says how much the game has to scale it so it measures what the
spec says at 30 px/m (the density of the LPC characters and the houses): the frame is drawn at 0.6·k.
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

PXM_W, PXM_H = 30.0, 30.0 * 0.8660254   # art px per meter at the target density (width, height)


def key_mask(a, key="magenta"):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    if key == "cyan":                        # cyan: same test with red <-> green swapped, tighter (blue flowers aren't cyan)
        r, g = g, r
        bg = (r > 170) & (b > 170) & (g < 90) & (np.abs(r - b) < 45)
        fringe = (np.minimum(r, b) - g > 90) & (np.abs(r - b) < 40) & (g < 110)
        return bg | fringe
    bg = (r > 140) & (b > 140) & (g < 110) & (np.abs(r - b) < 90)
    fringe = (np.minimum(r, b) - g > 70) & (np.abs(r - b) < 70) & (g < 120)
    return bg | fringe


def bgish(c, key):
    r, g, b = c[..., 0].astype(int), c[..., 1].astype(int), c[..., 2].astype(int)
    if key == "cyan":
        r, g = g, r
    return (np.minimum(r, b) - g > 60) & (np.abs(r - b) < 70)


def grid(a, fg, pmin=2.5, pmax=12.0):
    """Pixel size P and phase (ox, oy) of the drawing's grid."""
    f = a[..., :3].astype(float)
    res = []
    for axis in (1, 0):                      # axis 1: changes along x (per column), axis 0: along y (per row)
        d = np.abs(np.diff(f, axis=axis)).sum(-1)
        m = (fg[:, 1:] & fg[:, :-1]) if axis == 1 else (fg[1:, :] & fg[:-1, :])
        prof = (d * m).sum(axis=1 - axis)
        p = prof - prof.mean()
        ac = np.correlate(p, p, mode="full")[len(p) - 1:]
        ac = ac / (ac[0] + 1e-9)
        res.append((prof, ac))
    Ps = np.arange(pmin, pmax, 0.01)

    def comb(P):
        s = 0
        for prof, ac in res:
            ks = np.arange(1, 7) * P
            ks = ks[ks < len(ac) - 1]
            s += np.interp(ks, np.arange(len(ac)), ac).mean()
        return s
    sc = np.array([comb(P) for P in Ps])
    P = float(Ps[np.nonzero(sc >= sc.max() * 0.9)[0][0]])      # smallest period close to the best: the fundamental
    loc = (Ps > P - .3) & (Ps < P + .3)
    P = float(Ps[loc][sc[loc].argmax()])
    ph = []
    for prof, _ in res:                       # phase: where the edges line up (edge between pixel i-1 and i sits at i)
        best_o, best_s = 0.0, -1
        for o in np.arange(0, P, 0.1):
            pos = np.arange(o, len(prof) - 1, P)
            s = np.interp(pos - 1, np.arange(len(prof)), prof).sum()
            if s > best_s:
                best_s, best_o = s, float(o)
        ph.append(best_o)
    return P, ph[0], ph[1]


def process(spec_path):
    spec = json.load(open(spec_path))
    base = os.path.dirname(spec_path)
    key = spec.get("bg", "magenta")
    src = np.array(Image.open(os.path.join(base, spec["img"])).convert("RGBA"))
    H, W = src.shape[:2]
    S = W / spec.get("ref", 1024)                               # spec coordinates -> real image
    fg = ndimage.binary_opening(~key_mask(src, key), iterations=1)
    P, ox, oy = spec.get("grid") or grid(src, fg, *spec.get("rango", [2.5, 12.0]))
    nw, nh = int((W - ox) // P), int((H - oy) // P)
    print(f"{spec['img']}: {W}x{H}, Gemini pixel = {P:.2f} px (phase {ox:.1f}, {oy:.1f}) -> {nw}x{nh} native")

    # 3. one pixel per cell: median of the cell's center, opaque if most of the cell is
    rgb = src[..., :3].astype(float)
    out = np.zeros((nh, nw, 3)); alpha = np.zeros((nh, nw), bool)
    for j in range(nh):
        y0, y1 = oy + j * P, oy + (j + 1) * P
        fy0, fy1 = int(round(y0)), max(int(round(y0)) + 1, int(round(y1)))
        cy0 = int(round(y0 + P * .25)); cy1 = max(cy0 + 1, int(round(y1 - P * .25)))
        for i in range(nw):
            x0, x1 = ox + i * P, ox + (i + 1) * P
            fx0, fx1 = int(round(x0)), max(int(round(x0)) + 1, int(round(x1)))
            if fg[fy0:fy1, fx0:fx1].mean() < .5:
                continue
            cx0 = int(round(x0 + P * .25)); cx1 = max(cx0 + 1, int(round(x1 - P * .25)))
            m = fg[cy0:cy1, cx0:cx1]
            c = rgb[cy0:cy1, cx0:cx1][m] if m.any() else rgb[fy0:fy1, fx0:fx1][fg[fy0:fy1, fx0:fx1]]
            out[j, i] = np.median(c, axis=0); alpha[j, i] = True

    # 4. palette, isolated pixels, background-colored leftovers
    ncol = spec.get("colors", 96)
    q = Image.fromarray(out[alpha].reshape(1, -1, 3).astype(np.uint8)).quantize(colors=ncol, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[: ncol * 3], float).reshape(-1, 3)
    out[alpha] = pal[np.array(q).reshape(-1)]
    nb = ndimage.convolve(alpha.astype(int), np.ones((3, 3)), mode="constant") - alpha
    alpha &= ~(nb == 0)
    bad = alpha & bgish(out, key)
    for (yy, xx) in zip(*np.nonzero(bad)):
        ys, xs = slice(max(0, yy - 1), yy + 2), slice(max(0, xx - 1), xx + 2)
        ok = alpha[ys, xs] & ~bad[ys, xs]
        if ok.any():
            out[yy, xx] = out[ys, xs][ok].mean(0)
        else:
            alpha[yy, xx] = False

    # silhouette pixels still tinted by the background (blend of fondo + contorno): they become a dark outline
    edge = alpha & ~ndimage.binary_erosion(alpha)
    r_, g_, b_ = out[..., 0], out[..., 1], out[..., 2]
    tint = ((np.minimum(g_, b_) - r_) > 28) if key == "cyan" else ((np.minimum(r_, b_) - g_) > 28)
    for (yy, xx) in zip(*np.nonzero(edge & tint)):
        ys, xs = slice(max(0, yy - 1), yy + 2), slice(max(0, xx - 1), xx + 2)
        ok = alpha[ys, xs] & ~(edge[ys, xs] & tint[ys, xs])
        out[yy, xx] = (out[ys, xs][ok].mean(0) if ok.any() else out[yy, xx]) * .42
    # 5. objects
    g = spec.get("grow", 1)
    lab, n = ndimage.label(ndimage.binary_dilation(alpha, iterations=g) if g > 0 else alpha)
    blobs = []
    for k, s in enumerate(ndimage.find_objects(lab)):
        m = (lab[s] == k + 1) & alpha[s]
        if m.sum() < 12:
            continue
        ys, xs = np.nonzero(m)
        blobs.append((s[1].start + xs.min(), s[1].start + xs.max() + 1, s[0].start + ys.min(), s[0].start + ys.max() + 1, k + 1))
    out_dir = os.path.join(base, spec.get("out", "limpio"))
    os.makedirs(out_dir, exist_ok=True)
    meta = {}
    kref = None
    if "persona" in spec:                     # reference person (1.7 m = 44 px at the target density) drawn in the sheet
        ax, ay = (spec["persona"][0] * S - ox) / P, (spec["persona"][1] * S - oy) / P
        b = min(blobs, key=lambda b: ((b[0] + b[1]) / 2 - ax) ** 2 + ((b[2] + b[3]) / 2 - ay) ** 2)
        kref = 1.7 * PXM_H / (b[3] - b[2])
        print(f"  reference person {b[3] - b[2]} px tall -> k = {kref:.2f} for the whole sheet")
    for o in spec["objs"]:
        if "box" in o:
            x0, y0, x1, y1 = [int(round((v * S - (ox if k % 2 == 0 else oy)) / P)) for k, v in enumerate(o["box"])]
            m = alpha[y0:y1, x0:x1]
        else:
            ax, ay = (o["at"][0] * S - ox) / P, (o["at"][1] * S - oy) / P
            x0, x1, y0, y1, li = min(blobs, key=lambda b: ((b[0] + b[1]) / 2 - ax) ** 2 + ((b[2] + b[3]) / 2 - ay) ** 2)
            m = (lab[y0:y1, x0:x1] == li) & alpha[y0:y1, x0:x1]
        rgba = np.zeros(m.shape + (4,), np.uint8)
        rgba[..., :3] = out[y0:y1, x0:x1].astype(np.uint8); rgba[..., 3] = m * 255
        im = Image.fromarray(rgba); bb = im.getbbox(); im = im.crop(bb) if bb else im
        im.save(os.path.join(out_dir, o["name"] + ".png"))
        if kref:                              # the sheet has a reference person: every object keeps Gemini's relative size
            want = kref
        else:
            want = o["w"] * PXM_W / im.width if "w" in o else (o["h"] * PXM_H + o.get("d", 0) * PXM_W * .5) / im.height
        meta[o["name"]] = {"w": im.width, "h": im.height, "k": round(want, 4), "d": o.get("d", 0.3)}
        print(f"  {o['name']:22s} {im.width}x{im.height} native, k = {want:.2f}")
    if spec.get("uniforme"):                  # same pixel density for the whole sheet: the median k (Gemini drew them to scale)
        km = float(np.median([v["k"] for v in meta.values()]))
        for v in meta.values():
            v["k"] = round(km, 4)
        print(f"  uniform k = {km:.2f}")
    json.dump(meta, open(os.path.join(out_dir, os.path.basename(spec_path)), "w"), indent=1)
    return meta


if __name__ == "__main__":
    for p in sys.argv[1:]:
        process(p)
