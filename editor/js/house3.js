// ===================== house3.js — casas 3D para Three: luz horneada por texel en espacio de mundo =====================
// Toma la escena de R3 (caras con textura pintada a 18 px/m + cajas que proyectan sombra) y hornea en cada texel
// lo mismo que hacía el renderizador por software: sol + cielo + rebote, sombras por rayos contra las cajas,
// oscurecido cerca del piso y saturación. Como la luz no depende de la cámara, se hornea una sola vez y se puede girar.
// Los contornos y la oclusión de rincones (que sí dependen de la vista) se hacen en GPU en la composición.
const House3 = (() => {
  const SF = R3.SF, PAD = 2, MAXW = 2048;
  const { dot, cross, norm, hull } = R3;

  // completa lados faltantes de cajas opacas (antes no se veían; ahora la cámara gira)
  function fillBoxes(sc) {
    const byFid = new Map();
    for (const f of sc.faces) { let a = byFid.get(f.fid); if (!a) byFid.set(f.fid, a = []); a.push(f); }
    const extra = [];
    for (const c of sc.casters) {
      const fs = byFid.get(c.fid); if (!fs || fs.length >= 5 || fs.length < 2) continue;
      if (Math.min(c.h[0], c.h[1], c.h[2]) < .03) continue;
      let ok = true, col = [0, 0, 0], n = 0;
      for (const f of fs) { if (f.tri || f.both) { ok = false; break; }
        if (f.tex) { const d = f.tex.d; let a = 0, r = 0, g = 0, b = 0, k = 0; for (let i = 0; i < d.length; i += 16) { a += d[i + 3] < 128; r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
          if (a > k * .1) { ok = false; break; } col[0] += r / k; col[1] += g / k; col[2] += b / k; }
        else { col[0] += f.col[0]; col[1] += f.col[1]; col[2] += f.col[2]; } n++; }
      if (!ok) continue;
      col = col.map(v => v / n * .9);
      const ax = c.ax, h = c.h, ctr = c.c;
      // seis lados posibles (sin piso); se agrega el que falte comparando normales
      const sides = [[ax[1], 0, 1, 2], [[-ax[1][0], -ax[1][1], -ax[1][2]], 0, 1, 2], [ax[0], 1, 0, 2], [[-ax[0][0], -ax[0][1], -ax[0][2]], 1, 0, 2], [ax[2], 0, 1, 2]];
      for (const [nv] of sides) {
        if (fs.some(f => dot(f.n, nv) > .9)) continue;
        // cara centrada en ctr + nv·h, con ejes perpendiculares
        const hn = Math.abs(dot(nv, ax[0])) > .9 ? h[0] : Math.abs(dot(nv, ax[1])) > .9 ? h[1] : h[2];
        const others = [0, 1, 2].filter(i => Math.abs(dot(nv, ax[i])) < .5);
        let e1 = ax[others[0]].map(v => v * 2 * h[others[0]]), e2 = ax[others[1]].map(v => v * 2 * h[others[1]]);
        const O = [ctr[0] + nv[0] * hn - e1[0] / 2 - e2[0] / 2, ctr[1] + nv[1] * hn - e1[1] / 2 - e2[1] / 2, ctr[2] + nv[2] * hn - e1[2] / 2 - e2[2] / 2];
        let nn = norm(cross(e2, e1)); if (dot(nn, nv) < 0) { const t = e1; e1 = e2; e2 = t; nn = norm(cross(e2, e1)); }
        extra.push({ O, E1: e1, E2: e2, n: nn, col, fid: c.fid, tri: false, both: false });
      }
    }
    return extra;
  }

  // hornea { geometría (posiciones en mundo), atlas de texturas iluminadas, sombra al piso }
  function bake(built, ox, oy, opt = {}) {
    const sc = built.sc, L = R3.LIGHT, SUN = R3.SUN, SUNC = R3.SUNC, SKY = R3.SKY, BOUNCE = R3.BOUNCE;
    const faces = sc.faces.concat(fillBoxes(sc));
    // ---- casters en espacio de luz (poda)
    const e1 = norm(cross(SUN, [0, 0, 1])), e2 = cross(SUN, e1);
    const cs = sc.casters.map(c => { let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = [0, 1, 2].map(k => c.c[k] + sx * c.h[0] * c.ax[0][k] + sy * c.h[1] * c.ax[1][k] + sz * c.h[2] * c.ax[2][k]);
        const a1 = dot(p, e1), a2 = dot(p, e2); lo1 = Math.min(lo1, a1); hi1 = Math.max(hi1, a1); lo2 = Math.min(lo2, a2); hi2 = Math.max(hi2, a2); }
      return { c: c.c, ax: c.ax, h: c.h, fid: c.fid, lo1, hi1, lo2, hi2, ld: c.ax.map(a => dot(SUN, a)) }; });
    const NC = cs.length;
    // ---- tamaño de cada cara en el atlas
    const items = faces.map((f, i) => {
      let tw, th; if (f.tex) { tw = f.tex.w; th = f.tex.h; }
      else { tw = Math.max(1, Math.min(256, Math.round(Math.hypot(...f.E1) * SF))); th = Math.max(1, Math.min(256, Math.round(Math.hypot(...f.E2) * SF))); }
      return { f, i, tw, th, x: 0, y: 0 };
    });
    // ---- empaquetado en estantes
    let area = 0; for (const it of items) area += (it.tw + PAD * 2) * (it.th + PAD * 2);
    let AW = Math.max(32, Math.min(MAXW, Math.ceil(Math.sqrt(area) * 1.08 / 16) * 16));
    const order = items.slice().sort((a, b) => b.th - a.th);
    let x = 0, y = 0, rowH = 0;
    for (const it of order) { const w = it.tw + PAD * 2, h = it.th + PAD * 2; if (w > AW) AW = Math.min(4096, w); if (x + w > AW) { x = 0; y += rowH; rowH = 0; } it.x = x + PAD; it.y = y + PAD; x += w; rowH = Math.max(rowH, h); }
    const AH = Math.max(4, y + rowH);
    const img = new ImageData(AW, AH), D = img.data;
    // ---- iluminación por texel
    const P = [0, 0, 0];
    for (const it of items) {
      const f = it.f, tw = it.tw, th = it.th, t = f.tex, td = t ? t.d : null;
      let n = f.n; if (f.both && dot(n, SUN) < 0) n = [-n[0], -n[1], -n[2]];
      const ndl = Math.max(0, dot(n, SUN)), hz = .5 + .5 * n[2];
      const amb0 = L.amb * (SKY[0] * hz + BOUNCE[0] * (1 - hz)), amb1 = L.amb * (SKY[1] * hz + BOUNCE[1] * (1 - hz)), amb2 = L.amb * (SKY[2] * hz + BOUNCE[2] * (1 - hz));
      const sun0 = L.sun * ndl * SUNC[0], sun1 = L.sun * ndl * SUNC[1], sun2 = L.sun * ndl * SUNC[2];
      for (let j = 0; j < th; j++) { const v = (j + .5) / th;
        for (let i = 0; i < tw; i++) { const u = (i + .5) / tw;
          let r, g, b;
          if (td) { const ti = (j * tw + i) * 4; if (td[ti + 3] < 128) continue; r = td[ti]; g = td[ti + 1]; b = td[ti + 2]; }
          else { r = f.col[0]; g = f.col[1]; b = f.col[2]; }
          P[0] = f.O[0] + u * f.E1[0] + v * f.E2[0] + n[0] * .02; P[1] = f.O[1] + u * f.E1[1] + v * f.E2[1] + n[1] * .02; P[2] = f.O[2] + u * f.E1[2] + v * f.E2[2] + n[2] * .02;
          let shadow = false;
          if (ndl > 0) { const a1 = P[0] * e1[0] + P[1] * e1[1] + P[2] * e1[2], a2 = P[0] * e2[0] + P[1] * e2[1] + P[2] * e2[2];
            for (let k = 0; k < NC; k++) { const c = cs[k]; if (c.fid === f.fid || a1 < c.lo1 || a1 > c.hi1 || a2 < c.lo2 || a2 > c.hi2) continue;
              let tmin = 0, tmax = 1e9, ok = true;
              for (let q = 0; q < 3 && ok; q++) { const A = c.ax[q], o = (P[0] - c.c[0]) * A[0] + (P[1] - c.c[1]) * A[1] + (P[2] - c.c[2]) * A[2], dd = c.ld[q];
                if (Math.abs(dd) < 1e-9) { if (Math.abs(o) > c.h[q]) ok = false; }
                else { let t1 = (-c.h[q] - o) / dd, t2 = (c.h[q] - o) / dd; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) ok = false; } }
              if (ok) { shadow = true; break; } } }
          const ao = 1 - .2 * L.ao * Math.max(0, 1 - P[2] / .7);
          r *= (amb0 + (shadow ? 0 : sun0)) * ao; g *= (amb1 + (shadow ? 0 : sun1)) * ao; b *= (amb2 + (shadow ? 0 : sun2)) * ao;
          const l = .3 * r + .59 * g + .11 * b; r = l + (r - l) * L.sat; g = l + (g - l) * L.sat; b = l + (b - l) * L.sat;
          const o = ((it.y + j) * AW + it.x + i) * 4; D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = 255;
        } }
      // extrusión de bordes (evita que se mezclen caras vecinas al alejar)
      for (let p = 1; p <= PAD; p++) {
        for (let i = -p; i < tw + p; i++) { const ci = Math.max(0, Math.min(tw - 1, i));
          cp(D, AW, it.x + ci, it.y, it.x + i, it.y - p); cp(D, AW, it.x + ci, it.y + th - 1, it.x + i, it.y + th - 1 + p); }
        for (let j = -p; j < th + p; j++) { const cj = Math.max(0, Math.min(th - 1, j));
          cp(D, AW, it.x, it.y + cj, it.x - p, it.y + j); cp(D, AW, it.x + tw - 1, it.y + cj, it.x + tw - 1 + p, it.y + j); }
      }
    }
    // ---- geometría
    let nv = 0, ni = 0; for (const it of items) { nv += it.f.tri ? 3 : 4; ni += it.f.tri ? 3 : 6; }
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), fidA = new Float32Array(nv), idx = new Uint32Array(ni);
    let vi = 0, ii = 0;
    for (const it of items) {
      const f = it.f, u0 = it.x / AW, v0 = it.y / AH, u1 = (it.x + it.tw) / AW, v1 = (it.y + it.th) / AH, code = (f.fid * 61) % 254 + 1;
      const corners = f.tri ? [[0, 0], [1, 0], [0, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
      const base = vi;
      for (const [a, b] of corners) {
        pos[vi * 3] = f.O[0] + a * f.E1[0] + b * f.E2[0] + ox; pos[vi * 3 + 1] = f.O[1] + a * f.E1[1] + b * f.E2[1] + oy; pos[vi * 3 + 2] = f.O[2] + a * f.E1[2] + b * f.E2[2];
        uv[vi * 2] = u0 + (u1 - u0) * a; uv[vi * 2 + 1] = v0 + (v1 - v0) * b; fidA[vi] = code; vi++; }
      if (f.tri) { idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2; }
      else { idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2; idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 3; }
    }
    // ---- sombra proyectada al piso (polígonos convexos por caja, en mundo)
    let shadow = null;
    if (opt.groundShadow !== false) {
      const polys = [];
      for (const c of sc.casters) { if (c.noGround) continue; const pts = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const p = [0, 1, 2].map(k => c.c[k] + sx * c.h[0] * c.ax[0][k] + sy * c.h[1] * c.ax[1][k] + sz * c.h[2] * c.ax[2][k]);
          const tt = Math.max(0, p[2]) / Math.max(.05, SUN[2]); pts.push([p[0] - SUN[0] * tt + ox, p[1] - SUN[1] * tt + oy]); }
        const hl = hull(pts); if (hl.length >= 3) polys.push(hl); }
      let sv = 0, si = 0; for (const p of polys) { sv += p.length; si += (p.length - 2) * 3; }
      const sp = new Float32Array(sv * 3), sidx = new Uint32Array(si); let a = 0, b = 0;
      for (const p of polys) { const base = a; for (const q of p) { sp[a * 3] = q[0]; sp[a * 3 + 1] = q[1]; sp[a * 3 + 2] = .015; a++; }
        for (let k = 1; k + 1 < p.length; k++) { sidx[b++] = base; sidx[b++] = base + k; sidx[b++] = base + k + 1; } }
      shadow = { pos: sp, idx: sidx };
    }
    const canvas = document.createElement("canvas"); canvas.width = AW; canvas.height = AH; canvas.getContext("2d").putImageData(img, 0, 0);
    return { pos, uv, fid: fidA, idx, canvas, shadow, texBytes: AW * AH * 4 * 1.34, faces: items.length };
  }
  function cp(D, AW, sx, sy, dx, dy) { const s = (sy * AW + sx) * 4, d = (dy * AW + dx) * 4; D[d] = D[s]; D[d + 1] = D[s + 1]; D[d + 2] = D[s + 2]; D[d + 3] = D[s + 3]; }
  return { bake };
})();
