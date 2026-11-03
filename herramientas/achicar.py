#!/usr/bin/env python3
"""Shrink Gemini's drawings by a whole factor (2x, 3x, 4x...), keeping them as Gemini drew them.

  python3 herramientas/achicar.py arte/gemini/<sheet>.json [...]      (no arguments: every sheet)

pixelar.py looked for Gemini's pixel grid and took one pixel per cell. Gemini's grid is not whole (2.5, 2.83 or 3.6
px), so some rows and columns came out twice and others were lost, and the game then scaled the result by 0.6·k
again: the drawings looked broken. Here each object is cut from the original sheet and shrunk by a WHOLE factor f:
every pixel of the result is the average of an f×f block (only the drawing's pixels, never the background), so
nothing is stretched or sampled out of step, and the drawing looks like Gemini's, smaller.

f = 2 (picked by eye on variantes.html: 2x with the block average keeps Gemini's detail), or 1 for what Gemini
drew less than twice its size in the game (the calesita, the glorieta, the Gauchito sheet…): shrinking those would
make the game enlarge them back, blurred. What is left over is "k": the game draws the frame at 0.6·k so it
measures what the spec says, like before (k < 1: the GPU shrinks the rest). The spec is the same as pixelar.py's
(arte/gemini/<sheet>.json: "at" or "box", "h"/"w"/"d", "persona", "uniforme"). --factor N changes the 2.

Writes arte/gemini/achicado/<name>.png and arte/gemini/achicado/<sheet>.json ({w, h, k, d, f}).
"""
import glob, json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from pixelar import key_mask   # the same chroma key (flat magenta or cyan background and its fringe)

TARGET = 30.0                  # art px per meter (width) in the game
CZ = math.cos(math.pi / 6)     # heights are foreshortened by cos 30° in the oblique view
OUT = "achicado"
FACTOR = 2                     # the chosen shrink (variantes.html)


def whole_factor(r):
    """The whole factor f >= 1 closest to r (Gemini px per game px), in ratio."""
    lo = max(1, math.floor(r))
    return min((lo, lo + 1), key=lambda f: abs(math.log(r / f)))


def factor(r):
    """FACTOR, but never below the game's size: a drawing less than FACTOR times its size in the game shrinks by
    the largest whole factor that keeps it at least that big (1 for the calesita)."""
    return max(1, min(FACTOR, math.floor(r)))


def shrink(rgb, fg, f):
    """Average of f×f blocks over the drawing's pixels only; alpha = how much of the block is drawing."""
    h, w = fg.shape
    H, W = -(-h // f) * f, -(-w // f) * f
    # pad at the top and the left: the bottom edge (where the object stands) stays on a block boundary
    rgbp = np.zeros((H, W, 3)); fgp = np.zeros((H, W))
    rgbp[H - h:, W - w:] = rgb * fg[..., None]; fgp[H - h:, W - w:] = fg
    s = rgbp.reshape(H // f, f, W // f, f, 3).sum((1, 3))
    n = fgp.reshape(H // f, f, W // f, f).sum((1, 3))
    col = s / np.maximum(n, 1)[..., None]
    a = n / (f * f)
    a = np.where(a < 0.12, 0, np.clip(a * 1.15, 0, 1))      # a block with a speck of drawing is background
    out = np.zeros((H // f, W // f, 4), np.uint8)
    out[..., :3] = np.clip(np.round(col), 0, 255); out[..., 3] = np.round(a * 255)
    return out


def cortes(spec_path):
    """Each object of the sheet cut from Gemini's original: [(spec entry, rgb, drawing mask, Gemini px per game px)]."""
    spec = json.load(open(spec_path))
    base = os.path.dirname(spec_path)
    key = spec.get("bg", "magenta")
    src = np.array(Image.open(os.path.join(base, spec["img"])).convert("RGB"))
    H, W = src.shape[:2]
    S = W / spec.get("ref", 1024)
    fg = ndimage.binary_opening(~key_mask(src, key), iterations=1)
    # blobs: the drawing's pixels grown a little (pixelar grew one Gemini pixel, about 3 px) so one object is one blob
    # (an object can ask for more, "grow" in its own entry, when it is several pieces apart: two tomato plants)
    labels = {}

    def blobs_for(g):
        if g not in labels:
            lab, _ = ndimage.label(ndimage.binary_dilation(fg, iterations=int(round(2.5 * g))) if g > 0 else fg)
            bl = []
            for k, s in enumerate(ndimage.find_objects(lab)):
                m = (lab[s] == k + 1) & fg[s]
                if m.sum() < 60:
                    continue
                ys, xs = np.nonzero(m)
                bl.append((s[1].start + xs.min(), s[1].start + xs.max() + 1, s[0].start + ys.min(), s[0].start + ys.max() + 1, k + 1))
            labels[g] = (lab, bl)
        return labels[g]

    def near(ax, ay, g=spec.get("grow", 1)):
        lab, bl = blobs_for(g)
        return lab, min(bl, key=lambda b: ((b[0] + b[1]) / 2 - ax) ** 2 + ((b[2] + b[3]) / 2 - ay) ** 2)

    rref = None
    if "persona" in spec:                     # a person drawn in the sheet: 1.7 m tall sets the scale of the whole sheet
        _, b = near(spec["persona"][0] * S, spec["persona"][1] * S)
        rref = (b[3] - b[2]) / (1.7 * TARGET * CZ)
    cuts = []
    for o in spec["objs"]:
        if "box" in o:
            x0, y0, x1, y1 = [int(round(v * S)) for v in o["box"]]
            m = fg[y0:y1, x0:x1]
        else:
            lab, (x0, x1, y0, y1, li) = near(o["at"][0] * S, o["at"][1] * S, o.get("grow", spec.get("grow", 1)))
            m = (lab[y0:y1, x0:x1] == li) & fg[y0:y1, x0:x1]
        ys, xs = np.nonzero(m)
        if not len(ys):
            print(f"  {o['name']}: nothing there"); continue
        bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        m = m[by0:by1, bx0:bx1]
        rgb = src[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1].astype(float)
        w, h = bx1 - bx0, by1 - by0
        # Gemini px per game px: from the reference person, or from what the spec says the object measures
        r = rref or (w / (o["w"] * TARGET) if "w" in o else h / (o["h"] * TARGET * CZ + o.get("d", 0) * TARGET * .5))
        cuts.append((o, rgb, m, r))
    if spec.get("uniforme") and cuts:          # Gemini drew them to scale with each other: one factor for the sheet
        rm = float(np.median([c[3] for c in cuts]))
        cuts = [(o, rgb, m, rm) for o, rgb, m, _ in cuts]
    return cuts


def process(spec_path):
    cuts = cortes(spec_path)
    out_dir = os.path.join(os.path.dirname(spec_path), OUT)
    os.makedirs(out_dir, exist_ok=True)
    meta = {}
    for o, rgb, m, r in cuts:
        f = factor(r)
        im = Image.fromarray(shrink(rgb, m, f))
        bb = im.getbbox(); im = im.crop(bb) if bb else im
        im.save(os.path.join(out_dir, o["name"] + ".png"), optimize=True)
        k = f / r                               # what the game still scales: 0.6·k
        meta[o["name"]] = {"w": im.width, "h": im.height, "k": round(k, 4), "d": o.get("d", 0.3), "f": f}
        print(f"  {o['name']:22s} {rgb.shape[1]}x{rgb.shape[0]} / {f} -> {im.width}x{im.height}, k = {k:.2f}")
    json.dump(meta, open(os.path.join(out_dir, os.path.basename(spec_path)), "w"), indent=1)
    return meta


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--factor" in args:
        i = args.index("--factor"); FACTOR = int(args[i + 1]); del args[i:i + 2]
    paths = args or sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "arte", "gemini", "*.json")))
    for p in paths:
        print(os.path.basename(p))
        process(p)
