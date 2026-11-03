#!/usr/bin/env python3
"""Clean up Gemini sprite sheets into true pixel art at the game's density.

Input: a sheet on a flat magenta background + a JSON spec listing the objects
left to right with their real height in meters.  Output: one PNG per object,
re-pixelized so that 1 art pixel = 1/30 m wide and 1/26 m tall (the density of
the LPC characters and of the houses, which the game shows at scale 0.6).

  python3 herramientas/pixelar.py arte/gemini/postes_01.json

Spec example (arte/gemini/postes_01.json):
  {"img": "postes_01.png", "objs": [
     {"name": "u_led", "h": 9.0, "light": "auto"}, ...]}

Steps
  1. chroma key: magenta-ish pixels (and magenta fringe) become transparent;
  2. objects = connected blobs (dilated, so wires stay with their pole), sorted by x;
  3. art pixel size of the source is estimated from the color-change spacing;
  4. each object is resampled to its target height with a "mode" filter
     (every target pixel takes the most common palette color of its footprint),
     so edges stay hard and there's no blending;
  5. palette: the sheet is reduced to N colors first, so noise disappears;
  6. outline: any opaque pixel touching transparency that isn't already dark is
     replaced by a darker, cooler version of itself (colored outline, never black);
  7. magenta fringe left on the outline is recolored from its neighbors.
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

PXM_W, PXM_H = 30.0, 30.0 * 0.8660254   # art px per meter (width, height)


def magenta_mask(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    # pure-ish magenta, and blends of magenta with darker colors (fringe)
    mag = (r > 140) & (b > 140) & (g < 110) & (np.abs(r - b) < 90)
    # chroma test: strong magenta hue even when darker (outline blended with bg)
    chroma = np.minimum(r, b) - g
    fringe = (chroma > 70) & (np.abs(r - b) < 70) & (g < 120)
    return mag, fringe


def estimate_pixel(a, fg):
    """Art pixel size of the source: spacing of color changes (autocorrelation)."""
    f = a[..., :3].astype(float)
    best = []
    for axis in (0, 1):
        d = np.abs(np.diff(f, axis=1 - axis)).sum(-1)
        m = fg[:, 1:] & fg[:, :-1] if axis == 0 else fg[1:, :] & fg[:-1, :]
        d = (d * m)
        prof = d.sum(axis=axis)            # change strength per column (axis 0) / row (axis 1)
        prof = prof - prof.mean()
        ac = np.correlate(prof, prof, mode="full")[len(prof) - 1:]
        ac /= ac[0] + 1e-9
        lags = np.arange(len(ac))
        # first strong local max after lag 1.5
        cand = [(ac[k], k) for k in range(2, 16) if ac[k] > ac[k - 1] and ac[k] >= ac[k + 1]]
        if cand:
            v, k = max(cand)
            # sub-pixel refine with a parabola
            y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
            den = (y0 - 2 * y1 + y2)
            off = 0.5 * (y0 - y2) / den if den != 0 else 0
            best.append(k + off)
    return float(np.median(best)) if best else 4.0


def build_palette(rgb, n):
    img = Image.fromarray(rgb.reshape(1, -1, 3).astype(np.uint8))
    q = img.quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[: n * 3], dtype=float).reshape(-1, 3)
    return pal


def nearest(pal, px):
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(-1)
    return d.argmin(1)


def to_hsv_dark(c):
    """Outline color: darker and cooler version of c."""
    r, g, b = c / 255.0
    v = max(r, g, b)
    # darken strongly, push hue toward blue/purple a bit
    k = 0.32
    out = np.array([r * k + 0.035, g * k + 0.02, b * k + 0.075])
    return np.clip(out * 255, 0, 255)


def lum(c):
    return 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]


def process(spec_path):
    spec = json.load(open(spec_path))
    base = os.path.dirname(spec_path)
    src = np.array(Image.open(os.path.join(base, spec["img"])).convert("RGBA"))
    H, W = src.shape[:2]
    mag, fringe = magenta_mask(src)
    bg = mag | fringe
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=1)
    px = estimate_pixel(src, fg)
    print(f"{spec['img']}: {W}x{H}, art pixel ≈ {px:.2f} src px")

    # objects: blobs after a generous dilation (keeps wires attached), sorted left to right
    grow = ndimage.binary_dilation(fg, iterations=int(spec.get("grow", px * 3)))
    lab, n = ndimage.label(grow)
    sl = ndimage.find_objects(lab)
    blobs = []
    for i, s in enumerate(sl):
        m = (lab[s] == i + 1) & fg[s]
        if m.sum() < (px * 6) ** 2:
            continue
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = s[0].start + ys.min(), s[0].start + ys.max() + 1, s[1].start + xs.min(), s[1].start + xs.max() + 1
        blobs.append((x0, x1, y0, y1, i + 1))
    blobs.sort()
    objs = spec["objs"]
    if all("at" in o for o in objs):        # match by approximate center given in the spec
        cen = [((b[0] + b[1]) / 2, (b[2] + b[3]) / 2) for b in blobs]
        pick = []
        for o in objs:
            k = min(range(len(blobs)), key=lambda k: (cen[k][0] - o["at"][0]) ** 2 + (cen[k][1] - o["at"][1]) ** 2)
            pick.append(blobs[k])
        blobs = pick
    if len(blobs) != len(objs):
        print(f"  ! found {len(blobs)} blobs, spec lists {len(objs)}: " + ", ".join(f"[{b[0]}-{b[1]}]" for b in blobs))
    # palette from all opaque pixels of the sheet
    pal = build_palette(src[..., :3][fg], spec.get("colors", 48))

    out_dir = os.path.join(base, spec.get("out", "limpio"))
    os.makedirs(out_dir, exist_ok=True)
    res = {}
    for (x0, x1, y0, y1, li), o in zip(blobs, objs):
        if "box" in o:                       # explicit crop (e.g. a window without the wall drawn around it)
            x0, y0, x1, y1 = o["box"]
            m = fg[y0:y1, x0:x1].copy()
        else:
            m = (lab[y0:y1, x0:x1] == li) & fg[y0:y1, x0:x1]
        crop = src[y0:y1, x0:x1, :3].astype(float)
        ch, cw = crop.shape[:2]
        # target size in art px: by width ("w", m) or by height ("h", m, plus "d" = depth, m, seen from above)
        if "w" in o:
            sy = cw / (o["w"] * PXM_W)
            th = max(4, int(round(ch / sy)))
        else:
            th = max(4, int(round(o["h"] * PXM_H + o.get("d", 0) * PXM_W * 0.5)))
            sy = ch / th                                       # src px per target px
        sx = sy * o.get("sx", 1.0)                             # the source already has square art pixels
        tw = max(1, int(round(cw / sx)))
        idx = np.full((th, tw), -1, int)
        qi = nearest(pal, crop.reshape(-1, 3)).reshape(ch, cw)
        for j in range(th):
            a0 = min(ch - 1, int(round(j * sy))); a1 = min(ch, max(a0 + 1, int(round((j + 1) * sy))))
            for i in range(tw):
                b0 = min(cw - 1, int(round(i * sx))); b1 = min(cw, max(b0 + 1, int(round((i + 1) * sx))))
                mm = m[a0:a1, b0:b1]
                if mm.mean() < o.get("cover", 0.42):
                    continue
                # weight the center of the footprint more (avoids picking the outline everywhere)
                cy, cx = (a0 + a1 - 1) / 2, (b0 + b1 - 1) / 2
                yy, xx = np.mgrid[a0:a1, b0:b1]
                w = np.exp(-(((yy - cy) / max(1, (a1 - a0) * .45)) ** 2 + ((xx - cx) / max(1, (b1 - b0) * .45)) ** 2))
                vals = qi[a0:a1, b0:b1][mm]
                ww = w[mm]
                cnt = np.bincount(vals, weights=ww, minlength=len(pal))
                idx[j, i] = cnt.argmax()
        rgba = np.zeros((th, tw, 4), np.uint8)
        op = idx >= 0
        rgba[op, :3] = pal[idx[op]].astype(np.uint8)
        rgba[op, 3] = 255
        # remove isolated single pixels
        nb = ndimage.convolve(op.astype(int), np.ones((3, 3)), mode="constant") - op
        lone = op & (nb == 0)
        rgba[lone, 3] = 0
        op = rgba[..., 3] > 0
        # colored outline on the silhouette
        if o.get("outline", True):
            edge = op & ~ndimage.binary_erosion(op, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]), border_value=0)
            L = lum(rgba[..., :3].astype(float))
            for (yy, xx) in zip(*np.nonzero(edge)):
                c = rgba[yy, xx, :3].astype(float)
                if L[yy, xx] > 70:
                    rgba[yy, xx, :3] = to_hsv_dark(c).astype(np.uint8)
        # leftover magenta-looking pixels: take the mean of opaque non-magenta neighbors
        r_, g_, b_ = rgba[..., 0].astype(int), rgba[..., 1].astype(int), rgba[..., 2].astype(int)
        bad = op & (np.minimum(r_, b_) - g_ > 60) & (np.abs(r_ - b_) < 70)
        if o.get("keepMagenta"):
            bad[:] = False
        for (yy, xx) in zip(*np.nonzero(bad)):
            ys, xs = slice(max(0, yy - 1), yy + 2), slice(max(0, xx - 1), xx + 2)
            nbm = op[ys, xs] & ~bad[ys, xs]
            if nbm.any():
                rgba[yy, xx, :3] = rgba[ys, xs, :3][nbm].mean(0).astype(np.uint8)
            else:
                rgba[yy, xx, 3] = 0
        im = Image.fromarray(rgba)
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
        fn = os.path.join(out_dir, o["name"] + ".png")
        im.save(fn)
        # anchor: bottom-center of the base (spec may give "ax" as a fraction of width)
        ax = o.get("ax")
        res[o["name"]] = {"w": im.width, "h": im.height, "ox": int(round((ax if ax is not None else .5) * im.width)), "oy": im.height - 1,
                          "h_m": round(im.height / PXM_H, 2), **({k: o[k] for k in ("light", "kind") if k in o})}
        print(f"  {o['name']:22s} {cw}x{ch} src -> {im.width}x{im.height} art px")
    json.dump(res, open(os.path.join(out_dir, os.path.basename(spec_path)), "w"), indent=1)
    return res


if __name__ == "__main__":
    for p in sys.argv[1:]:
        process(p)
