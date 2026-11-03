// ===================== ground.js — piso horneado por chunks en espacio de mundo =====================
// Vista cenital a 18 px/m (fila 0 = sur): la misma textura sirve para cualquier giro de cámara.
// Sin asignaciones por píxel: cada material escribe el color en (cr, cg, cb) y classifyInto reusa un objeto.
const Ground = (() => {
  const SF = R3.SF;
  const CH = 256;
  let N = null;
  function tnoise(size, cell, r) {      // ruido tileable
    const g = Math.ceil(size / cell), grid = new Float32Array(g * g); for (let i = 0; i < grid.length; i++) grid[i] = r();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) { const fy = y / cell, iy = Math.floor(fy); let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) { const fx = x / cell, ix = Math.floor(fx); let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        const a = grid[(iy % g) * g + ix % g], b = grid[(iy % g) * g + (ix + 1) % g], c = grid[((iy + 1) % g) * g + ix % g], d = grid[((iy + 1) % g) * g + (ix + 1) % g];
        out[y * size + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty; } }
    return out;
  }
  function init(seed) {
    const r = R3.rng(seed);
    N = { a: tnoise(256, 32, r), b: tnoise(256, 8, r), c: tnoise(256, 64, r), g: new Float32Array(65536) };
    for (let i = 0; i < 65536; i++) N.g[i] = r();
  }
  const S = (nz, x, y) => nz[((y & 255) << 8) | (x & 255)];
  const hash = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const GR = [[46, 80, 40], [62, 102, 48], [80, 126, 58], [102, 150, 70], [132, 174, 86]];
  const DIRT = [[96, 72, 52], [118, 88, 62], [140, 106, 76], [160, 126, 90], [182, 150, 112]];
  let cr = 0, cg = 0, cb = 0;
  const set = (r, g, b) => { cr = r; cg = g; cb = b; };
  const mulc = (f) => { cr *= f; cg *= f; cb *= f; };
  function ramp(p, t) { t = Math.max(0, Math.min(.999, t)) * (p.length - 1); const i = t | 0, f = t - i, a = p[i], b = p[i + 1]; set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f); }

  // --- materiales (ix, iy en px de mundo a 18 px/m; u, v coords locales en m cuando aplica)
  function asphalt(ix, iy) { const v = .86 + .3 * (S(N.c, ix >> 2, iy >> 2) - .5) + .16 * (S(N.a, ix, iy) - .5) + .14 * (S(N.g, ix, iy) - .5); const sp = S(N.g, ix * 7, iy * 3);
    if (sp > .95) set(118, 116, 112); else set(70 * v, 71 * v, 76 * v); }
  function grass(ix, iy, dry = 0) { const t = .45 + (S(N.a, ix, iy) - .5) * .7 + (S(N.b, ix, iy) - .5) * .3 + (S(N.g, ix, iy) - .5) * .35; ramp(GR, t);
    if (dry > 0) { const d = Math.min(1, Math.max(0, (S(N.c, ix, iy) - .55) * 3)) * dry; set(cr + (150 - cr) * d, cg + (140 - cg) * d * .6, cb + (80 - cb) * d); }
    if (S(N.g, ix * 3, iy * 5) > .965) set(176, 204, 120); }
  function dirt(ix, iy) { const t = .5 + (S(N.a, ix, iy) - .5) * .5 + (S(N.b, ix, iy) - .5) * .3 + (S(N.g, ix, iy) - .5) * .2; const g = S(N.g, ix * 5, iy * 7);
    if (g > .97) set(196, 184, 160); else if (g < .015) set(72, 56, 44); else ramp(DIRT, t); }
  function yuyo(ix, iy) { if (S(N.c, ix, iy) > .6) dirt(ix, iy); else grass(ix, iy, .8); }
  function tiles(u, v, ix, iy, kind, dmg) {
    // u a lo largo de la calle, v hacia el lote (m)
    if (kind === "pasto") return grass(ix, iy, .4);
    if (kind === "tierra") return S(N.b, ix, iy) > .55 ? grass(ix, iy, .9) : dirt(ix, iy);
    if (kind === "cem") { const jt = (u % 1.5 + 1.5) % 1.5 < .05 || (v % 1.5 + 1.5) % 1.5 < .05; if (jt) return set(138, 136, 128);
      const f = .95 + .1 * (S(N.a, ix, iy) - .5) + ((u * 8 % 1 + 1) % 1 < .25 ? -.04 : 0); return set(190 * f, 188 * f, 180 * f); }
    const size = kind === "roja" ? .25 : .4, tu = Math.floor(u / size), tv = Math.floor(v / size), lu = u / size - tu, lv = v / size - tv, h = hash(tu * 31 + 7, tv * 17 + 3);
    let b0, b1, b2; if (kind === "roja") { b0 = 176; b1 = 86; b2 = 62; } else if (kind === "gris") { b0 = 188; b1 = 186; b2 = 178; } else { b0 = 228; b1 = 212; b2 = 168; }
    if (lu < .07 || lv < .07) return kind === "roja" ? set(212, 196, 176) : set(b0 * .74, b1 * .74, b2 * .72);
    if (dmg && h < .1) return dirt(ix, iy);
    if (dmg && h < .2) { const f = .95 + .1 * S(N.g, ix, iy); return set(176 * f, 174 * f, 166 * f); }
    let f = 1 + (h - .5) * .08 + (S(N.a, ix, iy) - .5) * .12 * (dmg ? 2 : 1);
    if (kind !== "roja") { const pu = (lu * 3) % 1, pv = (lv * 3) % 1; if (pu < .12 || pv < .12) f *= .9; else if (pu < .24 || pv < .24) f *= 1.04; }
    if (dmg && h < .3 && Math.abs(lu - lv) < .04) return set(110, 98, 76);
    set(b0 * f, b1 * f, b2 * f);
  }

  const cl = { k: 0, s: null, d: 0, t: 0, ds: 0 };
  function pixel(W, wx, wy) {
    if (wx < 0 || wy < 0 || wx > W.MW || wy > W.MH) return set(40, 46, 36);
    const ix = (wx * SF) | 0, iy = (wy * SF) | 0;
    const c = W.classifyInto(wx, wy, cl);
    if (c.k === 1) {
      const s = c.s, ds = c.ds, ad = Math.abs(ds), edge = s.hw - c.d;
      // filo del cordón (la cara vertical dependía de la cámara; ahora la cámara gira)
      if (s.sw > 0 && s.mat !== "tierra" && s.mat !== "pasillo" && edge < .07) return set(112, 110, 104);
      if (s.mat === "pasillo") return W.wealthAt(wx, wy) > .18 || S(N.b, ix, iy) > .5 ? tiles(c.t, ad, ix, iy, "cem", true) : dirt(ix, iy);
      if (s.mat === "tierra") {
        if (s.type !== "pasillo" && s.sw > 0 && edge < 1.4) {     // zanja
          if (edge < .3 || edge > 1.15) return edge < .3 ? grass(ix, iy, .6) : dirt(ix, iy);
          const w = .5 + .5 * Math.sin(ix * .3 + iy * .9); if (S(N.g, ix, iy) > .985) return set(220, 220, 210);
          return set(62 + 18 * w * .4, 76 + 14 * w * .4, 58 + 8 * w * .4);
        }
        dirt(ix, iy);
        const rut = Math.min(Math.abs(ad - 1.3), Math.abs(ad - (s.hw - 1.9)));
        if (rut < .35) mulc(.86);
        if (S(N.c, ix + 91, iy + 37) > .8 && S(N.b, ix, iy) > .35) { const w = S(N.c, ix + 91, iy + 37); return w > .83 ? set(96 + 40 * S(N.g, ix, iy), 112 + 30 * S(N.g, ix, iy), 120) : set(78, 62, 48); }
        return;
      }
      // asfalto / roto / avenida
      if (s.type === "ave" && ad < s.med) { if (s.med - ad < .15) return set(214, 210, 200); return grass(ix, iy, .3); }
      if (s.type === "ave" && ad < s.med + .12) return set(150, 148, 142);
      if (s.sw > 0 && edge < .4) { const f = .95 + .08 * S(N.g, ix, iy); return set(160 * f, 158 * f, 152 * f); }     // cordón cuneta
      asphalt(ix, iy);
      if (s.mat === "roto") {
        const ph = S(N.c, ix + 300, iy + 120), pb = S(N.b, ix + 13, iy + 77);
        if (ph > .7 && pb > .45) return ph > .76 && pb > .6 ? set(80 + 40 * S(N.g, ix, iy), 96 + 30 * S(N.g, ix, iy), 104) : dirt(ix, iy);
        if (ph > .66 && pb > .4) return set(38, 36, 36);
        if (S(N.a, ix + 50, iy + 50) > .74) mulc(.8);
        if (S(N.b, ix * 2, iy * 2) > .82 && S(N.g, ix, iy) > .5) return set(32, 32, 36);
      }
      // sendas peatonales
      for (let i = 0; i < s.cross.length; i++) if (Math.abs(c.t - s.cross[i]) < 1.5) { if ((ad + 10) % 1 < .55 && S(N.g, ix, iy) > .1) set(210, 208, 198); return; }
      if (s.type === "ave") { const lane = Math.abs(ad - (s.med + (s.hw - s.med) / 2)); if (lane < .07 && (c.t % 6) < 3) set(214, 212, 204); }
      else if (s.mat === "asf" && s.w > .3 && ad < .07 && (c.t % 5) < 2.5) { if (s.w > .6) set(230, 200, 80); else set(214, 212, 204); }
      return;
    }
    if (c.k === 2) {
      const s = c.s, dd = c.d - s.hw, sgn = c.ds >= 0 ? 1 : -1;
      if (s.mat === "tierra") { if (dd < .6) return grass(ix, iy, .7); }
      else { if (dd < .16) return set(222, 218, 208); if (dd < .2) return set(168, 164, 156); }
      let cant = s.cantero && dd < 1.0;
      if (cant) for (let i = 0; i < s.cross.length; i++) if (Math.abs(c.t - s.cross[i]) < 1.6) cant = false;
      if (cant) return grass(ix, iy, .2);
      let kind = s.w < .3 ? "tierra" : "vain", dmg = s.w < .45;
      const L = s.lots[sgn];
      for (let i = 0; i < L.length; i++) { const e = L[i]; if (c.t >= e.t0 && c.t < e.t1) { kind = e.lot.vereda; if (kind === "vain_d") { kind = "vain"; dmg = true; } break; } }
      if (kind === "roja") kind = "gris";
      return tiles(c.t, dd, ix, iy, kind, dmg);
    }
    const lot = W.lotAt(wx, wy);
    if (lot) { const k = lot.patio; if (k === "pasto") return grass(ix, iy, .3); if (k === "tierra") return S(N.b, ix, iy) > .6 ? grass(ix, iy, .8) : dirt(ix, iy);
      if (k === "yuyo") return yuyo(ix, iy); if (k === "roja") return tiles(wx, wy, ix, iy, "roja", false); return tiles(wx, wy, ix, iy, "cem", lot.w < .4); }
    const w = W.wealthAt(wx, wy);
    if (w < .3) yuyo(ix, iy); else grass(ix, iy, .5);
  }
  // chunk en espacio de mundo: fila 0 = sur. Un canvas reutilizado para el ImageData no hace falta: se crea uno por chunk (vive en la GPU).
  function bakeChunk(W, ci, cj) {
    const cv = document.createElement("canvas"); cv.width = CH; cv.height = CH;
    const g = cv.getContext("2d"), img = g.createImageData(CH, CH), d = img.data;
    for (let y = 0; y < CH; y++) { const wy = (cj * CH + y + .5) / SF;
      for (let x = 0; x < CH; x++) { const wx = (ci * CH + x + .5) / SF, i = (y * CH + x) * 4; pixel(W, wx, wy);
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255; } }
    g.putImageData(img, 0, 0); return cv;
  }
  return { init, bakeChunk, CH, get N() { return N; } };
})();
