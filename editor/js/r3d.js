// ===================== r3d.js — mini renderizador de sprites 3D (cámara del juego) =====================
// Mundo en metros: x = este, y = norte, z = arriba. Proyección oblicua a 30° con leve corrimiento al este:
//   sx = (x + K*y) * S      sy = -(z*cos30 + y*sin30) * S       (S = 18 px/m en el sprite final)
const R3 = (() => {
  const SF = 18, SS = 2, K = 0.16, CZ = Math.cos(Math.PI / 6), SYN = 0.5;
  // detalle: las texturas y los sprites se dibujan a SF·DET px/m (el juego los muestra a 1/DET, como a los personajes LPC).
  // DET = 1 deja todo como antes (el visor 3D del editor); la exportación sube a 5/3 (30 px/m).
  let DET = 1, TD = SF, S = TD * SS;
  function setDetalle(d) { DET = d; TD = SF * d; S = TD * SS; }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const VIEW = norm([-K, 1, -SYN / CZ]);
  let SUN = norm([-0.52, -0.62, 0.62]);
  const LIGHT = { amb: .56, sun: .66, ao: 1, sat: 1.16, outline: .82 };
  function setLight(c) { const az = c.solAz * Math.PI / 180, el = c.solEl * Math.PI / 180;
    SUN = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    LIGHT.amb = c.ambI; LIGHT.sun = c.solI; LIGHT.ao = c.ao; LIGHT.sat = c.sat; LIGHT.outline = c.contorno; }
  const SUNC = [1.08, 0.99, 0.86], SKY = [0.70, 0.78, 0.95], BOUNCE = [0.62, 0.55, 0.46];
  const proj = (x, y, z, s = SF) => [(x + K * y) * s, -(z * CZ + y * SYN) * s];

  // ---------- azar y ruido
  function rng(seed) { let a = seed >>> 0; const f = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.int = (a0, b0) => a0 + Math.floor(f() * (b0 - a0 + 1)); f.uni = (a0, b0) => a0 + f() * (b0 - a0); f.uniform = f.uni; f.pick = (arr) => arr[Math.floor(f() * arr.length)]; return f; }
  function vnoise(w, h, scale, r) {
    const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2, g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const fy = y / scale, iy = Math.floor(fy); let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) { const fx = x / scale, ix = Math.floor(fx); let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
        out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty; } }
    return out;
  }
  const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
  const mul = (c, f) => [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];
  const add = (c, d) => [clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ---------- texturas pintadas (18 px/m)
  const px = (m) => Math.round(m * TD);
  class Tex {
    constructor(wm, hm, seed, col = [200, 200, 200], a = 255) {
      this.w = Math.max(1, px(wm)); this.h = Math.max(1, px(hm));
      this.d = new Float32Array(this.w * this.h * 4); this.r = rng(seed);
      for (let i = 0; i < this.w * this.h; i++) { this.d[i * 4] = col[0]; this.d[i * 4 + 1] = col[1]; this.d[i * 4 + 2] = col[2]; this.d[i * 4 + 3] = a; }
    }
    static fromPx(w, h, seed, col = [0, 0, 0], a = 0) { const t = new Tex(0.01, 0.01, seed); t.w = w; t.h = h; t.d = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { t.d[i * 4] = col[0]; t.d[i * 4 + 1] = col[1]; t.d[i * 4 + 2] = col[2]; t.d[i * 4 + 3] = a; } return t; }
    rect(x0, y0, x1, y1, c, a = 255) { x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(this.w, x1 | 0); y1 = Math.min(this.h, y1 | 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * this.w + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a; } }
    shade(x0, y0, x1, y1, f) { x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(this.w, x1 | 0); y1 = Math.min(this.h, y1 | 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * this.w + x) * 4; this.d[i] *= f; this.d[i + 1] *= f; this.d[i + 2] *= f; } }
    tint(x0, y0, x1, y1, c, t) { x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(this.w, x1 | 0); y1 = Math.min(this.h, y1 | 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * this.w + x) * 4; for (let k = 0; k < 3; k++) this.d[i + k] += (c[k] - this.d[i + k]) * t; } }
    p(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; }
    get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
    crop(y0, y1) { y0 = Math.max(0, y0 | 0); y1 = Math.min(this.h, y1 | 0); const t = Tex.fromPx(this.w, Math.max(1, y1 - y0), 1); t.d.set(this.d.subarray(y0 * this.w * 4, y1 * this.w * 4)); t.r = this.r; return t; }
    // ---- materiales
    stucco(col, wear = 1, y0 = 0, y1 = this.h) {
      const w = this.w, h = y1 - y0; if (h <= 0) return;
      const n1 = vnoise(w, h, 14, this.r), n2 = vnoise(w, h, 3, this.r), hue = vnoise(w, h, 22, this.r), st = vnoise(w, 1, 3, this.r);
      const alt = [col[0] * 1.05, col[1] * 0.98, col[2] * 0.9];
      for (let y = 0; y < h; y++) {
        const gy = 1.04 - 0.1 * (y / h);
        for (let x = 0; x < w; x++) {
          const k = y * w + x, i = ((y + y0) * w + x) * 4;
          const t = Math.min(1, Math.max(0, (hue[k] - .35) * 1.6));
          let f = (1 + 0.035 * (n1[k] - .5) + 0.06 * (n2[k] - .5) + 0.05 * (this.r() - .5)) * gy;
          const streak = Math.max(0, (st[x] - .58) * 2.2) * Math.max(0, 1 - y / (h * .7));
          f *= 1 - 0.1 * streak * wear;
          for (let c = 0; c < 3; c++) this.d[i + c] = (col[c] + (alt[c] - col[c]) * t * .6) * f;
          this.d[i + 3] = 255;
        }
      }
    }
    brick(col = [174, 92, 62], y0 = 0, y1 = this.h, course = Math.max(3, Math.round(3 * DET)), blen = Math.max(8, Math.round(8 * DET)), mortar = [198, 186, 164]) {
      for (let y = y0; y < y1; y++) { const row = (y / course) | 0, off = (row % 2) * (blen >> 1);
        for (let x = 0; x < this.w; x++) {
          const i = (y * this.w + x) * 4, mm = (y % course) === course - 1 || ((x + off) % blen) === 0;
          let c;
          if (mm) c = mul(mortar, 0.9 + 0.12 * this.r());
          else { const bid = row * 7919 + (((x + off) / blen) | 0) * 104729, v = (Math.sin(bid * 0.001234) * 43758.5453) % 1, vv = v < 0 ? v + 1 : v;
            c = mul(col, (0.8 + 0.34 * vv) * ((y % course) === 0 ? 1.08 : 1) * (0.97 + 0.06 * this.r())); }
          this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
        } }
    }
    hueco(y0 = 0, y1 = this.h) {      // ladrillo hueco: bloques con agujeros, juntas desprolijas
      const CH = Math.max(5, Math.round(5 * DET)), CL = Math.max(12, Math.round(12 * DET)), hy0 = Math.round(CH * .25), hy1 = Math.round(CH * .6), step = Math.max(3, Math.round(3 * DET));
      for (let y = y0; y < y1; y++) { const row = (y / CH) | 0, off = (row % 2) * (CL >> 1), ly = y % CH;
        for (let x = 0; x < this.w; x++) {
          const lx = (x + off) % CL, i = (y * this.w + x) * 4;
          let c;
          if ((ly === CH - 1 || lx === 0) && this.r() < 0.92) c = mul([168, 162, 150], 0.85 + 0.25 * this.r());
          else { const bid = row * 7919 + (((x + off) / CL) | 0) * 104729, v0 = (Math.sin(bid * 0.00731) * 9341.53) % 1, v = v0 < 0 ? v0 + 1 : v0;
            c = mul([214, 124, 82], 0.82 + 0.28 * v);
            if (ly >= hy0 && ly <= hy1 && lx % step === step - 1 && lx > 1 && lx < CL - 1) c = mul(c, 0.52);
            if (ly === 0) c = mul(c, 1.08);
            if (ly === 0 && this.r() < 0.12) c = [176, 170, 158]; }
          this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
        } }
    }
    concrete(col = [170, 168, 162], wear = 1) {
      const n = vnoise(this.w, this.h, 5, this.r), g = vnoise(this.w, this.h, 8, this.r);
      for (let k = 0; k < this.w * this.h; k++) { const f = (1 + 0.08 * (n[k] - .5) + 0.06 * (this.r() - .5)) * (1 - Math.min(.14, Math.max(0, (g[k] - .5) * .4 * wear)));
        this.d[k * 4] = col[0] * f; this.d[k * 4 + 1] = col[1] * f; this.d[k * 4 + 2] = col[2] * f; this.d[k * 4 + 3] = 255; }
    }
    humidity(hm = 0.7) {
      const hh = px(hm), prof = vnoise(this.w, 1, 4, this.r);
      for (let x = 0; x < this.w; x++) { const top = this.h - hh * (0.5 + 0.5 * prof[x]);
        for (let y = Math.max(0, top | 0); y < this.h; y++) { const i = (y * this.w + x) * 4; if (this.d[i + 3] < 1) continue;
          const f = Math.abs(y - top) < 1 ? 0.82 : 0.87 - 0.06 * (y - top) / hh; this.d[i] *= f; this.d[i + 1] *= f; this.d[i + 2] *= f * 0.98; } }
    }
    runoff(depth = 0.6, amt = 1) {   // manchas que bajan desde el borde de arriba
      const hh = px(depth), st = vnoise(this.w, 1, 2, this.r);
      for (let x = 0; x < this.w; x++) { const L = hh * (0.3 + st[x] * 1.2);
        for (let y = 0; y < Math.min(this.h, L); y++) { const i = (y * this.w + x) * 4, f = 1 - 0.13 * amt * (1 - y / L); this.d[i] *= f; this.d[i + 1] *= f; this.d[i + 2] *= f; } }
    }
    peel(n = 2) {
      for (let k = 0; k < n; k++) {
        if (this.h < 16 || this.w < 16) return;
        const cx = this.r.int(6, this.w - 7), cy = this.r.int(6, this.h - 7), rw = this.r.int(5, 11), rh = this.r.int(4, 7);
        for (let y = cy - rh - 2; y < cy + rh + 2; y++) for (let x = cx - rw - 2; x < cx + rw + 2; x++) {
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const d = ((x - cx) / rw) ** 2 + ((y - cy) / rh) ** 2, wob = 0.35 * Math.sin(x * 1.7 + y * 2.3);
          if (d < 1 + wob) { const b = (y % 3 !== 2 && (x + ((y / 3) | 0) * 4) % 8 !== 0) ? [172, 90, 62] : [190, 176, 156]; this.p(x, y, mul(b, 0.85 + 0.25 * this.r())); }
          else if (d < 1.4 + wob) { const i = (y * this.w + x) * 4; this.d[i] *= 1.1; this.d[i + 1] *= 1.1; this.d[i + 2] *= 1.08; }
        }
      }
    }
    toImageData() { const a = new Uint8ClampedArray(this.w * this.h * 4); for (let i = 0; i < a.length; i++) a[i] = this.d[i]; return new ImageData(a, this.w, this.h); }
  }

  // ---------- escena
  class Scene {
    constructor() { this.faces = []; this.casters = []; this.c = 1; this.s = 0; this.tx = 0; this.ty = 0; this._id = 0; }
    setXform(phi, tx = 0, ty = 0) { this.c = Math.cos(phi); this.s = Math.sin(phi); this.tx = tx; this.ty = ty; }
    P(p) { return [this.c * p[0] - this.s * p[1] + this.tx, this.s * p[0] + this.c * p[1] + this.ty, p[2]]; }
    V(v) { return [this.c * v[0] - this.s * v[1], this.s * v[0] + this.c * v[1], v[2]]; }
    nid() { return ++this._id; }
    // cara: O arriba-izquierda vista desde afuera, E1 hacia la derecha, E2 hacia abajo
    quad(O, E1, E2, tex, opt = {}) {
      const f = { O: this.P(O), E1: this.V(E1), E2: this.V(E2), fid: opt.fid || this.nid(), tri: !!opt.tri, both: !!opt.both };
      f.n = norm(cross(f.E2, f.E1));
      if (tex instanceof Tex) f.tex = tex; else f.col = tex;
      this.faces.push(f); return f.fid;
    }
    box(x0, y0, z0, x1, y1, z1, t = {}) {
      const fid = t.fid || this.nid(), dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      if (t.front != null) this.quad([x0, y0, z1], [dx, 0, 0], [0, 0, -dz], t.front, { fid });
      if (t.back != null) this.quad([x1, y1, z1], [-dx, 0, 0], [0, 0, -dz], t.back, { fid });
      if (t.right != null) this.quad([x1, y0, z1], [0, dy, 0], [0, 0, -dz], t.right, { fid });
      if (t.left != null) this.quad([x0, y1, z1], [0, -dy, 0], [0, 0, -dz], t.left, { fid });
      if (t.top != null) this.quad([x0, y1, z1], [dx, 0, 0], [0, -dy, 0], t.top, { fid });
      if (t.cast !== false) {
        const c = this.P([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
        this.casters.push({ c, ax: [this.V([1, 0, 0]), this.V([0, 1, 0]), [0, 0, 1]], h: [dx / 2, dy / 2, dz / 2], fid });
      }
      return fid;
    }
    // ---------- render
    render(opt = {}) {
      const faces = this.faces.filter(f => f.both || dot(f.n, VIEW) < -1e-4);
      for (const f of faces) if (f.both && dot(f.n, VIEW) >= 0) f.n = [-f.n[0], -f.n[1], -f.n[2]];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const f of faces) for (const c of [f.O, [f.O[0] + f.E1[0], f.O[1] + f.E1[1], f.O[2] + f.E1[2]], [f.O[0] + f.E2[0], f.O[1] + f.E2[1], f.O[2] + f.E2[2]], [f.O[0] + f.E1[0] + f.E2[0], f.O[1] + f.E1[1] + f.E2[1], f.O[2] + f.E1[2] + f.E2[2]]]) {
        const p = proj(c[0], c[1], c[2], S); minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
      if (!isFinite(minx)) return null;
      minx = Math.floor((minx - 4) / SS) * SS; miny = Math.floor((miny - 4) / SS) * SS;
      let W = Math.ceil(maxx + 4 - minx), H = Math.ceil(maxy + 4 - miny); W += (SS - W % SS) % SS; H += (SS - H % SS) % SS;
      const N = W * H, zb = new Float32Array(N).fill(Infinity), col = new Float32Array(N * 3), fi = new Int32Array(N).fill(-1), pos = new Float32Array(N * 3);
      const J = (v) => [S * (v[0] + K * v[1]), -S * (v[2] * CZ + v[1] * SYN)];
      faces.forEach((f, idx) => {
        const a = J(f.E1), b = J(f.E2), det = a[0] * b[1] - a[1] * b[0];
        if (Math.abs(det) < 1e-6) return;
        const i00 = b[1] / det, i01 = -b[0] / det, i10 = -a[1] / det, i11 = a[0] / det;
        const s0 = proj(f.O[0], f.O[1], f.O[2], S); s0[0] -= minx; s0[1] -= miny;
        const xs = [s0[0], s0[0] + a[0], s0[0] + b[0], s0[0] + a[0] + b[0]], ys = [s0[1], s0[1] + a[1], s0[1] + b[1], s0[1] + a[1] + b[1]];
        const bx0 = Math.max(0, Math.floor(Math.min(...xs))), bx1 = Math.min(W, Math.ceil(Math.max(...xs)) + 1);
        const by0 = Math.max(0, Math.floor(Math.min(...ys))), by1 = Math.min(H, Math.ceil(Math.max(...ys)) + 1);
        const dO = dot(f.O, VIEW), dE1 = dot(f.E1, VIEW), dE2 = dot(f.E2, VIEW);
        const t = f.tex, tw = t ? t.w : 0, th = t ? t.h : 0, td = t ? t.d : null, fc = f.col;
        for (let y = by0; y < by1; y++) { const dy = y + .5 - s0[1];
          for (let x = bx0; x < bx1; x++) { const dx = x + .5 - s0[0];
            const u = i00 * dx + i01 * dy, v = i10 * dx + i11 * dy;
            if (u < 0 || u >= 1 || v < 0 || v >= 1 || (f.tri && u + v > 1)) continue;
            const k = y * W + x, d = dO + u * dE1 + v * dE2;
            if (d >= zb[k] - 1e-5) continue;
            let r, g, bb;
            if (td) { const ti = (Math.min(th - 1, (v * th) | 0) * tw + Math.min(tw - 1, (u * tw) | 0)) * 4; if (td[ti + 3] < 128) continue; r = td[ti]; g = td[ti + 1]; bb = td[ti + 2]; }
            else { r = fc[0]; g = fc[1]; bb = fc[2]; }
            zb[k] = d; col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = bb; fi[k] = idx;
            pos[k * 3] = f.O[0] + u * f.E1[0] + v * f.E2[0]; pos[k * 3 + 1] = f.O[1] + u * f.E1[1] + v * f.E2[1]; pos[k * 3 + 2] = f.O[2] + u * f.E1[2] + v * f.E2[2];
          } }
      });
      // ---- sombras: poda en espacio de luz
      const e1 = norm(cross(SUN, [0, 0, 1])), e2 = cross(SUN, e1);
      const cs = this.casters.map(c => { let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const p = [c.c[0] + sx * c.h[0] * c.ax[0][0] + sy * c.h[1] * c.ax[1][0] + sz * c.h[2] * c.ax[2][0],
                     c.c[1] + sx * c.h[0] * c.ax[0][1] + sy * c.h[1] * c.ax[1][1] + sz * c.h[2] * c.ax[2][1],
                     c.c[2] + sx * c.h[0] * c.ax[0][2] + sy * c.h[1] * c.ax[1][2] + sz * c.h[2] * c.ax[2][2]];
          const a1 = dot(p, e1), a2 = dot(p, e2); lo1 = Math.min(lo1, a1); hi1 = Math.max(hi1, a1); lo2 = Math.min(lo2, a2); hi2 = Math.max(hi2, a2); }
        return { ...c, lo1, hi1, lo2, hi2, ld: c.ax.map(a => dot(SUN, a)) }; });
      const out = new Float32Array(N * 4);
      const fid = new Int32Array(N).fill(-1);
      for (let k = 0; k < N; k++) {
        const f_ = fi[k]; if (f_ < 0) continue;
        const f = faces[f_], n = f.n; fid[k] = f.fid;
        const P = [pos[k * 3] + n[0] * .02, pos[k * 3 + 1] + n[1] * .02, pos[k * 3 + 2] + n[2] * .02];
        const ndl = Math.max(0, dot(n, SUN));
        let shadow = false;
        if (ndl > 0) { const a1 = dot(P, e1), a2 = dot(P, e2);
          for (const c of cs) { if (c.fid === f.fid || a1 < c.lo1 || a1 > c.hi1 || a2 < c.lo2 || a2 > c.hi2) continue;
            let tmin = 0, tmax = 1e9, ok = true;
            for (let j = 0; j < 3 && ok; j++) { const o = (P[0] - c.c[0]) * c.ax[j][0] + (P[1] - c.c[1]) * c.ax[j][1] + (P[2] - c.c[2]) * c.ax[j][2], dd = c.ld[j];
              if (Math.abs(dd) < 1e-9) { if (Math.abs(o) > c.h[j]) ok = false; }
              else { let t1 = (-c.h[j] - o) / dd, t2 = (c.h[j] - o) / dd; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) ok = false; } }
            if (ok) { shadow = true; break; } } }
        const hz = 0.5 + 0.5 * n[2], z = P[2];
        let L = [0, 0, 0];
        for (let j = 0; j < 3; j++) L[j] = LIGHT.amb * (SKY[j] * hz + BOUNCE[j] * (1 - hz)) + (shadow ? 0 : LIGHT.sun * ndl * SUNC[j]);
        const ao = 1 - 0.2 * LIGHT.ao * Math.max(0, 1 - z / 0.7);
        for (let j = 0; j < 3; j++) out[k * 4 + j] = col[k * 3 + j] * L[j] * ao;
        out[k * 4 + 3] = 255;
      }
      // ---- oclusión de rincones (por profundidad de pantalla)
      const occ = new Float32Array(N);
      const OFF = [[0, -3], [-3, 0], [3, 0], [0, 3], [-2, -2], [2, -2], [0, -7], [-6, -2], [6, -2]].map(([a, b]) => [Math.round(a * DET), Math.round(b * DET)]);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (fi[k] < 0) continue;
        let o = 0; for (const [ox, oy] of OFF) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const kk = yy * W + xx; if (fi[kk] >= 0 && zb[kk] < zb[k] - 0.25 && zb[kk] > zb[k] - 3) o++; }
        occ[k] = o; }
      for (let k = 0; k < N; k++) if (fi[k] >= 0 && occ[k] > 0) { const f = 1 - Math.min(0.32 * LIGHT.ao, occ[k] * 0.055 * LIGHT.ao); out[k * 4] *= f; out[k * 4 + 1] *= f; out[k * 4 + 2] *= f * 1.02; }
      // ---- realce de color (más saturación y contraste)
      for (let k = 0; k < N; k++) { if (fi[k] < 0) continue; const i = k * 4, l = 0.3 * out[i] + 0.59 * out[i + 1] + 0.11 * out[i + 2];
        for (let j = 0; j < 3; j++) out[i + j] = l + (out[i + j] - l) * LIGHT.sat; }
      // ---- contornos
      if (opt.outline !== false) {
        const OC = [46, 32, 26];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (fi[k] < 0) continue;
          let edge = 0;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + ox, yy = y + oy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) { edge = 2; break; } const kk = yy * W + xx;
            if (fi[kk] < 0) { edge = 2; break; }
            if (fid[kk] !== fid[k] && zb[kk] - zb[k] > 0.3) edge = Math.max(edge, 1); }
          if (edge) { const t = edge === 2 ? LIGHT.outline : LIGHT.outline * .6, i = k * 4; for (let j = 0; j < 3; j++) out[i + j] = out[i + j] * (1 - t) + OC[j] * t; } }
      }
      // ---- reducción 2x
      const w2 = W / SS, h2 = H / SS, img = new ImageData(w2, h2);
      for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { let r = 0, g = 0, b = 0, a = 0;
        for (let yy = 0; yy < SS; yy++) for (let xx = 0; xx < SS; xx++) { const i = ((y * SS + yy) * W + x * SS + xx) * 4, al = out[i + 3] / 255; r += out[i] * al; g += out[i + 1] * al; b += out[i + 2] * al; a += al; }
        const o = (y * w2 + x) * 4; if (a > 0) { img.data[o] = r / a; img.data[o + 1] = g / a; img.data[o + 2] = b / a; img.data[o + 3] = a / (SS * SS) * 255; } }
      const canvas = document.createElement("canvas"); canvas.width = w2; canvas.height = h2; canvas.getContext("2d").putImageData(img, 0, 0);
      const res = { canvas, ax: -minx / SS, ay: -miny / SS };
      if (opt.groundShadow) res.shadow = this.groundShadow();
      return res;
    }
    // sombra proyectada al piso (polígonos), a escala final
    groundShadow() {
      const polys = [];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const c of this.casters) { if (c.noGround) continue;
        const pts = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const p = [c.c[0] + sx * c.h[0] * c.ax[0][0] + sy * c.h[1] * c.ax[1][0] + sz * c.h[2] * c.ax[2][0],
                     c.c[1] + sx * c.h[0] * c.ax[0][1] + sy * c.h[1] * c.ax[1][1] + sz * c.h[2] * c.ax[2][1],
                     c.c[2] + sx * c.h[0] * c.ax[0][2] + sy * c.h[1] * c.ax[1][2] + sz * c.h[2] * c.ax[2][2]];
          const t = Math.max(0, p[2]) / Math.max(.05, SUN[2]), g = [p[0] - SUN[0] * t, p[1] - SUN[1] * t];
          const s = proj(g[0], g[1], 0); pts.push(s); minx = Math.min(minx, s[0]); maxx = Math.max(maxx, s[0]); miny = Math.min(miny, s[1]); maxy = Math.max(maxy, s[1]); }
        polys.push(hull(pts)); }
      if (!polys.length) return null;
      minx = Math.floor(minx) - 1; miny = Math.floor(miny) - 1;
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.ceil(maxx - minx) + 2); cv.height = Math.max(1, Math.ceil(maxy - miny) + 2);
      const g = cv.getContext("2d"); g.fillStyle = "#000";
      for (const p of polys) { g.beginPath(); p.forEach(([x, y], i) => i ? g.lineTo(x - minx, y - miny) : g.moveTo(x - minx, y - miny)); g.closePath(); g.fill(); }
      return { canvas: cv, ax: -minx, ay: -miny };
    }
  }
  function hull(P) { const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up); }

  // ---------- fuente 5x7
  const FONT = { A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01111 10000 10000 10000 10000 10000 01111",
    D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
    G: "01111 10000 10000 10011 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "11111 00100 00100 00100 00100 00100 11111",
    J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
    M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
    P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
    S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
    V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
    Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111", "0": "01110 10011 10101 10101 11001 10001 01110",
    "1": "00100 01100 00100 00100 00100 00100 01110", "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110", "6": "00110 01000 10000 11110 10001 10001 01110",
    "7": "11111 00001 00010 00100 01000 01000 01000", "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "!": "00100 00100 00100 00100 00100 00000 00100", "-": "00000 00000 00000 11111 00000 00000 00000", ".": "00000 00000 00000 00000 00000 00000 00100", " ": "00000 00000 00000 00000 00000 00000 00000" };
  const TS = () => DET >= 1.5 ? 2 : 1;
  const textW = (s, bold = true) => (s.length * (bold ? 7 : 6) - 1) * TS();
  function text(t, s, x0, y0, c, bold = true, shadow = null, wobble = 0) {
    let x = x0;
    for (const ch of s) { const rows = (FONT[ch] || FONT[" "]).split(" "), dy = wobble ? t.r.int(-wobble, wobble) : 0;
      const k = TS();
      rows.forEach((row, gy) => { for (let gx = 0; gx < 5; gx++) if (row[gx] === "1") for (const bx of bold ? [0, 1] : [0]) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        const X = x + (gx + bx) * k + a, Y = y0 + (gy + dy) * k + b; if (shadow) t.p(X + k, Y + k, shadow); t.p(X, Y, c); } });
      x += (bold ? 7 : 6) * k; }
  }
  return { SF, K, CZ, SYN, setDetalle, get DET() { return DET; }, get TD() { return TD; }, proj, norm, dot, cross, LIGHT, SUNC, SKY, BOUNCE, hull, rng, vnoise, mul, add, mix, clamp, px, Tex, Scene, text, textW, setLight, get SUN() { return SUN; } };
})();
