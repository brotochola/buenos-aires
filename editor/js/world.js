// ===================== world.js — conurbano caótico en metros =====================
// Loteos (Voronoi) agrupados en familias de grilla, avenidas rectas, pasajes de una cuadra, villas con pasillos, riqueza variable;
// la red se limpia como grafo (esquinas de 3 o 4, sin callejones sin salida).
const World = (() => {
  const { rng, vnoise } = R3;
  const CLS = { ave: 4, calle: 3, pasaje: 2, pasillo: 1 };

  function generate(seed) {
    const C = CFG.v, MW = C.mapW, MH = C.mapH, r = rng(seed);
    const QA = C.cuantizar > 0 ? C.cuantizar * Math.PI / 180 : 0, snapA = (a) => QA ? Math.round(a / QA) * QA : a;
    // ---------- riqueza (0 = pobre, 1 = acomodado)
    const WG = Math.ceil(MW / 10), HG = Math.ceil(MH / 10), n1 = vnoise(WG, HG, Math.max(2, Math.round(C.zonaRiqueza / 10)), r), n2 = vnoise(WG, HG, 6, r);
    const wealthAt = (x, y) => { const gx = Math.max(0, Math.min(WG - 1, (x / 10) | 0)), gy = Math.max(0, Math.min(HG - 1, (y / 10) | 0)), k = gy * WG + gx;
      return Math.max(0, Math.min(1, (n1[k] - .5) * C.contraste + (n2[k] - .5) * .5 + .5 + C.sesgo)); };

    // ---------- loteos (Voronoi) agrupados en familias de grilla
    // Cada familia es una cuadrícula (ángulo, largo y ancho de manzana, origen). Los loteos de una misma familia comparten la
    // cuadrícula, así las calles siguen derecho de un loteo al otro, como en Buenos Aires. Entre familias distintas el borde es
    // una calle o una avenida, donde las grillas topan en T (como en el conurbano, entre loteos de distintas épocas).
    const seeds = [];
    const minSep = Math.sqrt(MW * MH / C.loteos) * .7;
    for (let i = 0; i < C.loteos; i++) { let p, ok, tries = 0;
      do { p = [r.uni(30, MW - 30), r.uni(30, MH - 30)]; ok = seeds.every(s => Math.hypot(s.p[0] - p[0], s.p[1] - p[1]) > minSep); } while (!ok && ++tries < 60);
      seeds.push({ p }); }
    // familias: en un mapa chico (unas 5 × 3 cuadras) una sola grilla, como Flores; en uno grande, loteos de distintas épocas
    const dz = C.desorden * Math.PI / 180, nF = Math.max(1, Math.min(4, Math.round(MW * MH * (C.loteos / 15) / 200000)));
    const fams = [], th0 = snapA(r.uni(-dz, dz));
    for (let f = 0; f < nF; f++) {
      // centros de familia bien separados (el más lejano de los ya elegidos)
      let best = null, bd = -1; for (const s of seeds) { const d = fams.length ? Math.min(...fams.map(q => Math.hypot(q.c[0] - s.p[0], q.c[1] - s.p[1]))) : r(); if (d > bd) { bd = d; best = s.p; } }
      const theta = f === 0 ? th0 : snapA(th0 + (r() < C.diagonal ? Math.PI / 4 : r.pick([1, -1]) * r.uni(.18, .55)));
      const w = wealthAt(best[0], best[1]), cuadrada = w > .5 ? r() < .7 : r() < .3;       // cuadras cuadradas (CABA) o alargadas (conurbano)
      const bA = C.manzana * (cuadrada ? r.uni(96, 112) : r.uni(105, 135)), bB = C.manzana * (cuadrada ? bA / C.manzana * r.uni(.94, 1.04) : r.uni(55, 72));
      fams.push({ i: f, c: best, theta, bA, bB, oA: r.uni(0, bA), oB: r.uni(0, bB), u: [Math.cos(theta), Math.sin(theta)], v: [-Math.sin(theta), Math.cos(theta)] });
    }
    let villas = 0;
    const districts = seeds.map((s, i) => {
      let poly = [[0, 0], [MW, 0], [MW, MH], [0, MH]];
      for (const o of seeds) { if (o === s) continue;
        const m = [(s.p[0] + o.p[0]) / 2, (s.p[1] + o.p[1]) / 2], n = [o.p[0] - s.p[0], o.p[1] - s.p[1]];
        poly = clip(poly, (q) => (q[0] - m[0]) * n[0] + (q[1] - m[1]) * n[1]); }
      const w = wealthAt(s.p[0], s.p[1]);
      let type = "loteo";
      if (w < C.umbralVilla && villas < C.villasMax && r() < .75) { type = "villa"; villas++; }
      const fam = fams.reduce((a, f) => Math.hypot(f.c[0] - s.p[0], f.c[1] - s.p[1]) < Math.hypot(a.c[0] - s.p[0], a.c[1] - s.p[1]) ? f : a, fams[0]);
      return { i, p: s.p, poly, w, type, fam, theta: fam.theta, bA: fam.bA, bB: fam.bB };
    });

    // ---------- calles: primero en crudo (líneas), después se limpian como red (esquinas de 3 o 4, sin callejones)
    const raw = [];
    const add = (a, b, type, d, extra = {}) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 4) raw.push({ a, b, type, d, ...extra }); };
    // bordes entre loteos: sólo donde cambia la familia o empieza una villa (si no, la grilla sigue de largo)
    const seen = new Set(), owner = new Map();
    for (const d of districts) for (let i = 0; i < d.poly.length; i++) {
      const a = d.poly[i], b = d.poly[(i + 1) % d.poly.length], key = [a, b].map(q => q.map(v => Math.round(v)).join(",")).sort().join("|");
      if (!owner.has(key)) owner.set(key, []); owner.get(key).push(d); }
    for (const [key, ds] of owner) {
      if (ds.length < 2 || seen.has(key)) continue; seen.add(key);
      const [d1, d2] = ds; if (d1.fam === d2.fam && d1.type !== "villa" && d2.type !== "villa") continue;
      const [pa, pb] = key.split("|").map(t => t.split(",").map(Number)), len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      add(pa, pb, len > 150 && r() < .55 ? "ave" : "calle", d1.type === "villa" ? d1 : d2, { ancha: r() < .3, borde: true });
    }
    // grillas: las mismas líneas para todos los loteos de una familia; avenidas cada 4 a 6 cuadras en la familia más grande
    const famSize = fams.map(f => districts.filter(d => d.fam === f).length), big = famSize.indexOf(Math.max(...famSize));
    const aveEvery = [r.int(4, 6), r.int(4, 6)], aveOff = [r.int(0, 5), r.int(0, 5)];
    let nAve = 0;
    for (const d of districts) {
      if (d.type === "villa") continue;
      const f = d.fam, xs = d.poly.map(q => q[0] * f.u[0] + q[1] * f.u[1]), ys = d.poly.map(q => q[0] * f.v[0] + q[1] * f.v[1]);
      // líneas paralelas a u (en v = oB + k·bB) y paralelas a v (en u = oA + k·bA)
      for (const [axis, dirv, other, step, o0, lo, hi] of [[0, f.u, f.v, f.bB, f.oB, Math.min(...ys), Math.max(...ys)], [1, f.v, f.u, f.bA, f.oA, Math.min(...xs), Math.max(...xs)]]) {
        for (let k = Math.ceil((lo - o0) / step); o0 + k * step < hi; k++) {
          const off = o0 + k * step, c = [other[0] * off, other[1] * off], seg = clipLine(d.poly, c, dirv);
          if (!seg) continue;
          const ave = f.i === big && nAve < 99 && C.avenidas > 0 && ((k - aveOff[axis]) % aveEvery[axis] + aveEvery[axis]) % aveEvery[axis] === 0 && (axis === 0 || C.avenidas > 1);
          add(seg[0], seg[1], ave ? "ave" : "calle", d, { linea: f.i + ":" + axis + ":" + k });
          // pasaje a mitad de manzana, de una esquina a la otra (una cuadra)
          if (r() < C.pasajes * (d.w < .4 ? 1.1 : .5) * .35) {
            const off2 = off + step / 2, c2 = [other[0] * off2, other[1] * off2], s2 = clipLine(d.poly, c2, dirv);
            if (s2) { const st2 = axis === 0 ? f.bA : f.bB, oo = axis === 0 ? f.oA : f.oB, t0 = s2[0][0] * dirv[0] + s2[0][1] * dirv[1], t1 = s2[1][0] * dirv[0] + s2[1][1] * dirv[1];
              const j = Math.floor((t0 + r.uni(0, Math.max(0, t1 - t0 - st2)) - oo) / st2) + 1, a0 = Math.max(t0, oo + j * st2), a1 = Math.min(t1, oo + (j + 1) * st2);
              if (a1 - a0 > 30) add([other[0] * off2 + dirv[0] * a0, other[1] * off2 + dirv[1] * a0], [other[0] * off2 + dirv[0] * a1, other[1] * off2 + dirv[1] * a1], "pasaje", d); }
          }
        }
      }
    }
    // villas: pasillos como dos familias de líneas que serpentean y se cruzan; cada una termina en el borde de la villa,
    // que es una calle, así no quedan pasillos ciegos. Y una calle de tierra que la cruza.
    for (const d of districts) {
      if (d.type !== "villa") continue;
      const a0 = d.theta + r.uni(-.3, .3);
      for (const ang of [a0, a0 + Math.PI / 2 + r.uni(-.25, .25)]) {
        const u = [Math.cos(ang), Math.sin(ang)], v = [-u[1], u[0]], pu = d.poly.map(q => q[0] * u[0] + q[1] * u[1]), pv = d.poly.map(q => q[0] * v[0] + q[1] * v[1]);
        const u0 = Math.min(...pu) - 5, u1 = Math.max(...pu) + 5;
        for (let off = Math.min(...pv) + r.uni(6, 14); off < Math.max(...pv) - 5; off += r.uni(13, 22)) {
          // polilínea que serpentea: tramos de 8 a 13 m con un desvío lateral que se acumula poco
          let prev = null, prevIn = false, lat = 0;
          for (let t = u0; t <= u1 + 1; t += r.uni(8, 13)) {
            lat = Math.max(-5, Math.min(5, lat + r.uni(-2.2, 2.2)));
            const q = [u[0] * t + v[0] * (off + lat), u[1] * t + v[1] * (off + lat)], qIn = inside(d.poly, q) > 0;
            if (prev && (qIn || prevIn)) {
              if (qIn && prevIn) add(prev, q, "pasillo", d);
              else { const s2 = clipLine(d.poly, prev, [(q[0] - prev[0]), (q[1] - prev[1])].map((c, _, z) => c / Math.hypot(z[0], z[1])));
                if (s2) { const L = Math.hypot(q[0] - prev[0], q[1] - prev[1]), A = qIn ? s2[0] : prev, B = qIn ? q : s2[1];
                  if (Math.hypot(B[0] - A[0], B[1] - A[1]) <= L + .5) add(A, B, "pasillo", d); } }
            }
            prev = q; prevIn = qIn;
          }
        }
      }
      const s2 = clipLine(d.poly, d.p, [Math.cos(d.theta), Math.sin(d.theta)]); if (s2) add(s2[0], s2[1], "calle", d, { tierra: true });
    }

    // ---------- limpieza de la red: grafo plano, reglas de Buenos Aires, y vuelta a segmentos rectos
    const red = limpiarRed(raw, MW, MH);

    // ---------- plazas: una manzana cada 5 o 6 cuadras (la más cercana a cada punto de una grilla gruesa)
    // ---------- segmentos definitivos
    const segs = [];
    const addSeg = (a, b, type, d, extra = {}) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 3) return null;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w = wealthAt(mid[0], mid[1]);
      let mat;
      if (type === "ave") mat = w < .3 && r() < .4 ? "roto" : "asf";
      else if (type === "pasillo") mat = "pasillo";
      else mat = w < .28 ? pickW(r, [["tierra", 6 * C.tierra], ["roto", 3.5], ["asf", .6]]) : w < .52 ? pickW(r, [["asf", 4.5], ["roto", 4], ["tierra", 1.4 * C.tierra]]) : pickW(r, [["asf", 8.5], ["roto", 1.5]]);
      if (type === "pasaje" && mat === "asf" && r() < .4) mat = w < .5 ? "tierra" : "roto";
      if (extra.tierra) mat = "tierra";
      const hw = { ave: C.avenida / 2, calle: C.calle / 2 * (extra.ancha ? 1.25 : 1), pasaje: C.pasaje / 2, pasillo: C.pasillo / 2 }[type];
      let sw = { ave: C.vereda * 1.45, calle: C.vereda * (w < .3 ? .8 : 1), pasaje: C.vereda * (w < .4 ? .45 : .56), pasillo: 0 }[type];
      if (mat === "tierra" && type !== "pasillo") sw = Math.max(sw, extra.tierra ? 1.6 : 2.6);
      const s = { id: segs.length, a, b, len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], type, mat, hw, sw, w, cls: CLS[type],
        med: type === "ave" ? Math.min(hw - 2.5, C.cantCentral / 2) : 0, cantero: type !== "pasillo" && mat !== "tierra" && sw >= 2.5 && r() < (w < .35 ? .45 : .85), cross: [], lots: { 1: [], "-1": [] }, district: d };
      s.n = [-s.dir[1], s.dir[0]];
      segs.push(s); return s;
    };
    for (const e of red) addSeg(e.a, e.b, e.type, e.d, e);

    // ---------- índice espacial de calles
    const B = 16, GW = Math.ceil(MW / B) + 2, GH = Math.ceil(MH / B) + 2, buckets = Array.from({ length: GW * GH }, () => []);
    for (const s of segs) { const rad = s.hw + s.sw + 1.5;
      const x0 = Math.max(0, Math.floor((Math.min(s.a[0], s.b[0]) - rad) / B)), x1 = Math.min(GW - 1, Math.floor((Math.max(s.a[0], s.b[0]) + rad) / B));
      const y0 = Math.max(0, Math.floor((Math.min(s.a[1], s.b[1]) - rad) / B)), y1 = Math.min(GH - 1, Math.floor((Math.max(s.a[1], s.b[1]) + rad) / B));
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { // sólo buckets cerca de la recta
        const cx = (gx + .5) * B, cy = (gy + .5) * B; if (segDist(s, cx, cy).d < rad + B * .75) buckets[gy * GW + gx].push(s); } }
    const near = (x, y) => { const gx = Math.floor(x / B), gy = Math.floor(y / B); return (gx < 0 || gy < 0 || gx >= GW || gy >= GH) ? [] : buckets[gy * GW + gx]; };
    // clasificación de un punto (sin lotes)
    // igual que classify pero sin crear objetos: escribe en "o" (k: 0 nada, 1 calzada, 2 vereda) — para el horneado del piso
    function classifyInto(x, y, o) {
      let rk = 0, wk = 0, rs = null, ws = null, rd = 0, rt = 0, rds = 0, wd = 0, wt = 0, wds = 0;
      const gx = Math.floor(x / B), gy = Math.floor(y / B);
      if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) { const L = buckets[gy * GW + gx];
        for (let i = 0; i < L.length; i++) { const s = L[i];
          const px = x - s.a[0], py = y - s.a[1], t = px * s.dir[0] + py * s.dir[1], tc = t < 0 ? 0 : t > s.len ? s.len : t;
          const dx = x - (s.a[0] + s.dir[0] * tc), dy = y - (s.a[1] + s.dir[1] * tc), d = Math.sqrt(dx * dx + dy * dy), ds = px * s.n[0] + py * s.n[1];
          if (d < s.hw) { const k = (d - s.hw) - s.cls * .01; if (!rs || k < rk) { rs = s; rk = k; rd = d; rt = t; rds = ds; } }
          else if (s.sw > 0 && d < s.hw + s.sw) { const k = d - s.hw - s.sw; if (!ws || k < wk) { ws = s; wk = k; wd = d; wt = t; wds = ds; } } } }
      if (rs) { o.k = 1; o.s = rs; o.d = rd; o.t = rt; o.ds = rds; } else if (ws) { o.k = 2; o.s = ws; o.d = wd; o.t = wt; o.ds = wds; } else { o.k = 0; o.s = null; }
      return o;
    }
    function classify(x, y) {
      let road = null, rk = 0, walk = null, wk = 0;
      for (const s of near(x, y)) {
        const q = segDist(s, x, y);
        if (q.d < s.hw) { const k = (q.d - s.hw) - s.cls * .01; if (!road || k < rk) { road = { s, ...q }; rk = k; } }
        else if (s.sw > 0 && q.d < s.hw + s.sw) { const k = q.d - s.hw - s.sw; if (!walk || k < wk) { walk = { s, ...q }; wk = k; } }
      }
      if (road) return { k: "road", ...road };
      if (walk) return { k: "walk", ...walk };
      return null;
    }

    // ---------- cruces (sendas, nomencladores, semáforos)
    const inters = [];
    for (const s of segs) for (const o of segs) {
      if (o.id <= s.id || s.type === "pasillo" || o.type === "pasillo") continue;
      const p = segInter(s, o); if (!p) continue;
      inters.push({ s, o, p });
      const crossOn = (a, b) => { if ((a.mat === "asf" && a.w > .42 && b.type !== "pasaje" || a.type === "ave") && b.type !== "pasillo") { const t = ((p[0] - a.a[0]) * a.dir[0] + (p[1] - a.a[1]) * a.dir[1]); const cl = b.hw + b.sw + 1.4; a.cross.push(t - cl, t + cl); } };
      crossOn(s, o); crossOn(o, s);
    }

    // ---------- lotes a lo largo de las calles
    const LR = 2, LW = MW * LR, LH = MH * LR, lotGrid = new Int32Array(LW * LH).fill(-1);
    const lots = [];
    const free = (x, y) => { if (x < 1 || y < 1 || x > MW - 1 || y > MH - 1) return false; if (classify(x, y)) return false;
      return lotGrid[((y * LR) | 0) * LW + ((x * LR) | 0)] < 0; };
    function quadPts(o, ux, nOut, fw, ld) { return [o, [o[0] + ux[0] * fw, o[1] + ux[1] * fw], [o[0] + ux[0] * fw + nOut[0] * ld, o[1] + ux[1] * fw + nOut[1] * ld], [o[0] + nOut[0] * ld, o[1] + nOut[1] * ld]]; }
    function quadFree(q) { // muestreo cada ~0.8 m
      const [o, a, , d] = q, ux = [a[0] - o[0], a[1] - o[1]], uy = [d[0] - o[0], d[1] - o[1]], nu = Math.max(2, Math.ceil(Math.hypot(...ux) / .8)), nv = Math.max(2, Math.ceil(Math.hypot(...uy) / .8));
      const mu = .3 / Math.hypot(...ux), mv = .3 / Math.hypot(...uy);
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const u = mu + (1 - 2 * mu) * i / nu, v = mv + (1 - 2 * mv) * j / nv;
        if (!free(o[0] + ux[0] * u + uy[0] * v, o[1] + ux[1] * u + uy[1] * v)) return false; }
      return true;
    }
    function stamp(q, id) {
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      for (let y = Math.floor(Math.min(...ys) * LR); y <= Math.ceil(Math.max(...ys) * LR); y++) for (let x = Math.floor(Math.min(...xs) * LR); x <= Math.ceil(Math.max(...xs) * LR); x++) {
        if (x < 0 || y < 0 || x >= LW || y >= LH) continue; if (inQuad(q, (x + .5) / LR, (y + .5) / LR)) lotGrid[y * LW + x] = id; }
    }
    // ---------- plazas: una manzana entera cada 5 o 6 cuadras (de la grilla principal), con senderos de baldosa roja
    // en diagonal y en cruz y una rotonda en el medio. Son "lotes" sin casa: el piso los pinta (pasto y senderos) y
    // barrio.js los llena (árboles, bancos, faroles, juegos, monumento).
    const plazas = [];
    if (C.plazas !== 0) {
      const f = fams[big], step = r.int(5, 6), pi = r.int(0, step - 1), pj = r.int(0, step - 1);
      const P = (uu, vv) => [f.u[0] * uu + f.v[0] * vv, f.u[1] * uu + f.v[1] * vv];
      const cu = [[0, 0], [MW, 0], [MW, MH], [0, MH]].map(q => q[0] * f.u[0] + q[1] * f.u[1]), cv = [[0, 0], [MW, 0], [MW, MH], [0, MH]].map(q => q[0] * f.v[0] + q[1] * f.v[1]);
      const cands = [];
      for (let i = Math.floor((Math.min(...cu) - f.oA) / f.bA); f.oA + i * f.bA < Math.max(...cu); i++)
        for (let j = Math.floor((Math.min(...cv) - f.oB) / f.bB); f.oB + j * f.bB < Math.max(...cv); j++) {
          const u0 = f.oA + i * f.bA, v0 = f.oB + j * f.bB, q = [P(u0, v0), P(u0 + f.bA, v0), P(u0 + f.bA, v0 + f.bB), P(u0, v0 + f.bB)], c = P(u0 + f.bA / 2, v0 + f.bB / 2);
          if (q.some(p => p[0] < 4 || p[1] < 4 || p[0] > MW - 4 || p[1] > MH - 4)) continue;
          const d = districts.find(d => inside(d.poly, c) > 0); if (!d || d.type === "villa" || d.fam !== f) continue;
          // las cuatro cuadras que la rodean tienen que ser calles
          const lados = [[.5, 0], [1, .5], [.5, 1], [0, .5]].filter(([a, b]) => { const m = P(u0 + f.bA * a, v0 + f.bB * b), k = classify(m[0], m[1]); return k && k.k === "road"; }).length;
          if (lados < 4) continue;
          cands.push({ i, j, q, c, d, u0, v0, en: ((i - pi) % step + step) % step === 0 && ((j - pj) % step + step) % step === 0 });
        }
      let elegidas = cands.filter(c => c.en);
      if (!elegidas.length && cands.length) elegidas = [cands.reduce((a, b) => Math.hypot(b.c[0] - MW / 2, b.c[1] - MH / 2) < Math.hypot(a.c[0] - MW / 2, a.c[1] - MH / 2) ? b : a)];
      for (const pz of elegidas) {
        const id = lots.length, w = wealthAt(pz.c[0], pz.c[1]);
        const lot = { id, q: pz.q, o: pz.q[0], ux: f.u, nOut: f.v, fw: f.bA, ld: f.bB, seg: null, side: 1, w, kind: "plaza", phi: f.theta, seed: (r() * 1e9) | 0, vereda: "vain", patio: "pasto",
          plaza: { c: pz.c, u: f.u, v: f.v, bA: f.bA, bB: f.bB, u0: pz.u0, v0: pz.v0 } };
        lots.push(lot); plazas.push(lot);
        // el pasto en toda la manzana (menos las veredas de alrededor); después los senderos encima
        for (let y = Math.floor(Math.min(...pz.q.map(p => p[1])) * LR); y <= Math.ceil(Math.max(...pz.q.map(p => p[1])) * LR); y++)
          for (let x = Math.floor(Math.min(...pz.q.map(p => p[0])) * LR); x <= Math.ceil(Math.max(...pz.q.map(p => p[0])) * LR); x++) {
            if (x < 0 || y < 0 || x >= LW || y >= LH) continue; const wx = (x + .5) / LR, wy = (y + .5) / LR;
            if (!inQuad(pz.q, wx, wy) || classify(wx, wy)) continue; lotGrid[y * LW + x] = id; }
        const sid = lots.length, sendero = { ...lot, id: sid, kind: "sendero", patio: "roja", plaza: lot.plaza }; lots.push(sendero);
        const enSendero = (wx, wy) => { const du = (wx - pz.c[0]) * f.u[0] + (wx * 0 + (wy - pz.c[1])) * f.u[1], dv = (wx - pz.c[0]) * f.v[0] + (wy - pz.c[1]) * f.v[1];
          const nu = du / (f.bA / 2), nv = dv / (f.bB / 2), rr = Math.hypot(du, dv), W2 = 1.1;
          if (Math.abs(rr - 7) < W2) return true;                                         // rotonda alrededor del centro
          if (rr < 5.5) return false;                                                     // el centro (monumento o fuente) queda en pasto
          if (Math.abs(du) < W2 || Math.abs(dv) < W2) return true;                        // cruz
          const dg = Math.min(Math.abs(nu - nv), Math.abs(nu + nv)) * Math.min(f.bA, f.bB) / 2 / Math.SQRT2; return dg < W2 * .9;   // diagonales
        };
        for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) if (lotGrid[y * LW + x] === id && enSendero((x + .5) / LR, (y + .5) / LR)) lotGrid[y * LW + x] = sid;
      }
    }
    const order = segs.slice().sort((a, b) => b.cls - a.cls || r() - .5);
    for (const s of order) {
      for (const side of [1, -1]) {
        const nOut = [s.n[0] * side, s.n[1] * side], off = s.hw + s.sw + .05;
        const villa = s.type === "pasillo" || (s.district && s.district.type === "villa");
        let t = villa ? r.uni(0, 2) : r.uni(1, 4);
        while (t < s.len - 3) {
          const p = [s.a[0] + s.dir[0] * t + nOut[0] * off, s.a[1] + s.dir[1] * t + nOut[1] * off];
          const w = wealthAt(p[0], p[1]);
          const F = C.frente / 8.66, fw = villa ? r.uni(3.6, 6) : F * (s.type === "ave" ? r.uni(7, 10.5) : w < .3 ? r.uni(5.5, 8.5) : w < .6 ? r.uni(7, 9.5) : r.uni(8.5, 13));
          if (t + fw > s.len) break;
          // marco del lote: local +y = nOut (alejándose de la calle); local x = ux (izquierda→derecha visto desde la calle)
          const ux0 = [nOut[1], -nOut[0]];
          const o = side === 1 ? p : [p[0] + s.dir[0] * fw, p[1] + s.dir[1] * fw];
          const rot = villa ? r.uni(-.1, .1) : 0;
          const uxr = [ux0[0] * Math.cos(rot) - ux0[1] * Math.sin(rot), ux0[0] * Math.sin(rot) + ux0[1] * Math.cos(rot)];
          const nOutR = [-uxr[1], uxr[0]];
          let placed = false;
          for (const ld of villa ? [r.uni(6, 9), 5, 4] : [r.uni(C.fondo * .6, C.fondo), C.fondo * .52, C.fondo * .4, 8, 6]) {
            const q = quadPts(o, uxr, nOutR, fw, ld);
            if (quadFree(q)) {
              const id = lots.length;
              lots.push(makeLot(id, q, o, uxr, nOutR, fw, ld, s, side, t, w, villa, r)); stamp(q, id);
              s.lots[side].push({ t0: t, t1: t + fw, lot: lots[id] }); placed = true; break;
            }
          }
          t += placed ? fw + (villa && r() < .3 ? r.uni(.3, 1.2) : 0) : .6;
        }
      }
    }
    function makeLot(id, q, o, ux, nOut, fw, ld, s, side, t, w, villa, r) {
      const nearEnd = t < 8 || t > s.len - 18;
      let kind;
      if (villa) kind = r() < .07 * Math.min(1, C.baldios) ? "baldio" : "villa";
      else if (s.type === "ave") kind = pickW(r, [["negocio", 30], ["negocio_casa", 30], ["ph", 14], ["galpon", 7], ["casa2", 10], ["casa", 6], ["baldio", 3 * C.baldios], ["edificio", 22 * (C.edificios ?? 1) * (.3 + w)]]);
      else if (w < .3) kind = pickW(r, [["casa", 26], ["obra", 24], ["villa", 14], ["casa2", 8], ["negocio", nearEnd ? 18 : 6], ["galpon", 4], ["baldio", 15 * C.baldios]]);
      else if (w < .55) kind = pickW(r, [["casa", 34], ["casa2", 20], ["obra", 10], ["negocio", nearEnd ? 20 : 8], ["negocio_casa", nearEnd ? 14 : 6], ["chalet", 5], ["galpon", 3], ["baldio", 7 * C.baldios]]);
      else kind = pickW(r, [["casa", 22], ["casa2", 26], ["chalet", 28], ["ph", 4], ["negocio", nearEnd ? 12 : 4], ["negocio_casa", nearEnd ? 8 : 3], ["baldio", 2 * C.baldios],
        ["edificio", 16 * (C.edificios ?? 1) * (w - .45)], ["petit", 12 * (C.edificios ?? 1) * (w - .45)]]);
      const phi = Math.atan2(ux[1], ux[0]);   // local x -> ux ; local -y -> hacia la calle
      return { id, q, o, ux, nOut, fw, ld, seg: s, side, w, kind, phi, seed: (r() * 1e9) | 0,
        vereda: w < .3 ? pickW(r, [["tierra", 4], ["cem", 2], ["vain_d", 1.5], ["pasto", 3]]) : pickW(r, [["vain", 5], ["vain_d", 1.6], ["gris", 2.5], ["cem", 2.5], ["roja", 1], ["tierra", w < .5 ? .6 : 0]]),
        patio: kind === "baldio" ? "yuyo" : w < .3 ? pickW(r, [["tierra", 4], ["pasto", 3], ["cem", 1.5]]) : pickW(r, [["pasto", 5], ["cem", 2.5], ["roja", 1.5]]) };
    }
    // relleno denso de villas: casillas pegadas mirando al pasillo/calle más cercano
    for (const d of districts) {
      if (d.type !== "villa") continue;
      const xs = d.poly.map(p => p[0]), ys = d.poly.map(p => p[1]);
      for (let y = Math.min(...ys); y < Math.max(...ys); y += 3.2) for (let x = Math.min(...xs); x < Math.max(...xs); x += 3.2) {
        const p = [x + r.uni(-1, 1), y + r.uni(-1, 1)];
        if (inside(d.poly, p) < 2 || !free(p[0], p[1])) continue;
        let best = null, bd = 1e9; for (const s of near(p[0], p[1])) { const q = segDist(s, p[0], p[1]); if (q.d < bd) { bd = q.d; best = { s, q }; } }
        if (!best) for (const s of segs) { const q = segDist(s, p[0], p[1]); if (q.d < bd) { bd = q.d; best = { s, q }; } }
        if (!best || bd > 30) continue;
        const s = best.s, side = best.q.ds >= 0 ? 1 : -1, nOut = [s.n[0] * side, s.n[1] * side];
        const rot = r.uni(-.15, .15), ux0 = [nOut[1], -nOut[0]];
        const ux = [ux0[0] * Math.cos(rot) - ux0[1] * Math.sin(rot), ux0[0] * Math.sin(rot) + ux0[1] * Math.cos(rot)], nO = [-ux[1], ux[0]];
        const fw = r.uni(3.6, 5.4), ld = r.uni(4.2, 6);
        const o = [p[0] - ux[0] * fw / 2 - nO[0] * 1, p[1] - ux[1] * fw / 2 - nO[1] * 1];
        const q = quadPts(o, ux, nO, fw, ld);
        if (!quadFree(q)) continue;
        const id = lots.length, lot = makeLot(id, q, o, ux, nO, fw, ld, s, side, 10, wealthAt(p[0], p[1]), true, r);
        lot.inner = true; if (lot.kind === "baldio") lot.kind = "villa"; lots.push(lot); stamp(q, id);
      }
    }
    const lotAt = (x, y) => { const gx = (x * LR) | 0, gy = (y * LR) | 0; if (gx < 0 || gy < 0 || gx >= LW || gy >= LH) return null; const i = lotGrid[gy * LW + gx]; return i >= 0 ? lots[i] : null; };
    return { MW, MH, segs, lots, districts, inters, classify, classifyInto, lotAt, wealthAt, near, raw, plazas };
  }

  // ---------- red de calles como grafo, con las reglas de Buenos Aires y el conurbano:
  // esquinas de 3 o 4 calles, ángulos de al menos 35°, sin dos esquinas pegadas (menos de 14 m) y sin callejones sin salida
  // (una calle que termina en la nada se estira hasta la próxima, o se saca). Devuelve tramos rectos.
  function limpiarRed(raw, MW, MH) {
    const CL = { ave: 4, calle: 3, pasaje: 2, pasillo: 1 };
    const geo = (s) => { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy) || 1e-9; s.len = len; s.dir = [dx / len, dy / len]; return s; };
    const L = raw.map(s => geo({ ...s }));
    const projOn = (s, p) => { const t = (p[0] - s.a[0]) * s.dir[0] + (p[1] - s.a[1]) * s.dir[1], tc = Math.max(0, Math.min(s.len, t)), q = [s.a[0] + s.dir[0] * tc, s.a[1] + s.dir[1] * tc];
      return { t: tc, q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) }; };
    // 1) extremos que casi tocan otra calle: se pegan a ella (T exactas)
    for (const s of L) for (const end of ["a", "b"]) { let best = null, bd = 2.5;
      for (const o of L) { if (o === s) continue; const q = projOn(o, s[end]); if (q.d < bd) { bd = q.d; best = q.q; } }
      if (best) s[end] = best; }
    L.forEach(geo);
    // 2) cortes en cada cruce
    const cuts = L.map(s => [0, s.len]);
    for (let i = 0; i < L.length; i++) { const s = L[i];
      for (let j = i + 1; j < L.length; j++) { const o = L[j];
        if (Math.max(s.a[0], s.b[0]) < Math.min(o.a[0], o.b[0]) - 1 || Math.min(s.a[0], s.b[0]) > Math.max(o.a[0], o.b[0]) + 1 ||
            Math.max(s.a[1], s.b[1]) < Math.min(o.a[1], o.b[1]) - 1 || Math.min(s.a[1], s.b[1]) > Math.max(o.a[1], o.b[1]) + 1) continue;
        const d = s.dir[0] * o.dir[1] - s.dir[1] * o.dir[0]; if (Math.abs(d) < 1e-6) continue;
        const ax = o.a[0] - s.a[0], ay = o.a[1] - s.a[1], t = (ax * o.dir[1] - ay * o.dir[0]) / d, u = (ax * s.dir[1] - ay * s.dir[0]) / d;
        if (t < -.6 || t > s.len + .6 || u < -.6 || u > o.len + .6) continue;
        cuts[i].push(Math.max(0, Math.min(s.len, t))); cuts[j].push(Math.max(0, Math.min(o.len, u))); } }
    // 3) nodos (puntos a menos de 1,5 m son el mismo) y aristas
    const nodes = [], cell = new Map(), CS = 1.5;
    const nodeAt = (p) => { const gx = Math.round(p[0] / CS), gy = Math.round(p[1] / CS);
      for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (const id of cell.get(x + "," + y) || []) { const n = nodes[id]; if (Math.hypot(n.x - p[0], n.y - p[1]) < CS) return id; }
      const id = nodes.length; nodes.push({ x: p[0], y: p[1], e: new Set() }); const k = gx + "," + gy; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(id); return id; };
    const edges = [], byPair = new Map();
    const addEdge = (n0, n1, props) => { if (n0 === n1) return null; const k = Math.min(n0, n1) + "|" + Math.max(n0, n1), old = byPair.get(k);
      if (old != null && edges[old].ok) { if (CL[props.type] > edges[old].cls) Object.assign(edges[old], props, { cls: CL[props.type] }); return old; }
      const id = edges.length; edges.push({ ...props, n0, n1, cls: CL[props.type], ok: true }); nodes[n0].e.add(id); nodes[n1].e.add(id); byPair.set(k, id); return id; };
    L.forEach((s, i) => { const ts = cuts[i].sort((a, b) => a - b), ids = [];
      for (const t of ts) { const id = nodeAt([s.a[0] + s.dir[0] * t, s.a[1] + s.dir[1] * t]); if (ids[ids.length - 1] !== id) ids.push(id); }
      const props = { type: s.type, d: s.d, ancha: s.ancha, borde: s.borde, tierra: s.tierra };
      for (let k = 0; k + 1 < ids.length; k++) addEdge(ids[k], ids[k + 1], props); });
    // ayudas
    const other = (e, n) => e.n0 === n ? e.n1 : e.n0;
    const vec = (n, e) => { const a = nodes[n], b = nodes[other(e, n)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1e-9; return [dx / l, dy / l, l]; };
    const kill = (id) => { const e = edges[id]; if (!e.ok) return; e.ok = false; nodes[e.n0].e.delete(id); nodes[e.n1].e.delete(id); byPair.delete(Math.min(e.n0, e.n1) + "|" + Math.max(e.n0, e.n1)); };
    const prio = (id, n) => edges[id].cls * 1000 + Math.min(999, vec(n, edges[id])[2]);       // la calle de menor jerarquía, y entre iguales la más corta
    const borde = (n) => nodes[n].x < 3 || nodes[n].y < 3 || nodes[n].x > MW - 3 || nodes[n].y > MH - 3;
    const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    const MINA = (a, b) => (edges[a].type === "pasillo" && edges[b].type === "pasillo" ? 25 : 35) * Math.PI / 180;
    const splitAt = (id, p) => { const e = edges[id]; for (const n of [e.n0, e.n1]) if (Math.hypot(nodes[n].x - p[0], nodes[n].y - p[1]) < 3) return n;
      const h = nodes.length; nodes.push({ x: p[0], y: p[1], e: new Set() }); const props = { type: e.type, d: e.d, ancha: e.ancha, borde: e.borde, tierra: e.tierra }, n1 = e.n1;
      kill(id); addEdge(e.n0, h, props); addEdge(h, n1, props); return h; };
    for (let it = 0; it < 60; it++) {
      let ch = 0;
      // (c) esquinas pegadas: se juntan si queda una esquina de 4 como mucho; si no, se saca la calle menor
      for (let id = 0; id < edges.length; id++) { const e = edges[id]; if (!e.ok) continue; const [, , l] = vec(e.n0, e);
        if (l >= 14 || nodes[e.n0].e.size < 3 || nodes[e.n1].e.size < 3) continue;
        const arms = [...nodes[e.n0].e, ...nodes[e.n1].e].filter(x => x !== id);
        // sólo cuando la calle corta sigue derecho en las dos esquinas (dos T sobre la misma calle); si no (una esquina de polígono), se deja
        const [ux0, uy0] = vec(e.n0, e), stem = (n) => [...nodes[n].e].filter(x => x !== id && Math.abs(vec(n, edges[x])[0] * ux0 + vec(n, edges[x])[1] * uy0) <= .94);
        const sigue = (n) => [...nodes[n].e].some(x => x !== id && Math.abs(vec(n, edges[x])[0] * ux0 + vec(n, edges[x])[1] * uy0) > .97);
        if (!sigue(e.n0) || !sigue(e.n1)) continue;
        const s0 = stem(e.n0), s1 = stem(e.n1), frente = s0.length === 1 && s1.length === 1 && (() => { const a = vec(e.n0, edges[s0[0]]), b = vec(e.n1, edges[s1[0]]); return a[0] * b[0] + a[1] * b[1] < -.94; })();
        if (frente && arms.length <= 4 && !(borde(e.n0) && borde(e.n1))) {
          const keep = borde(e.n1) ? e.n1 : e.n0, gone = other(e, keep), K = nodes[keep], G = nodes[gone];
          if (!borde(keep)) { K.x = (K.x + G.x) / 2; K.y = (K.y + G.y) / 2; }
          kill(id); for (const x of [...G.e]) { const f = edges[x], props = { type: f.type, d: f.d, ancha: f.ancha, borde: f.borde, tierra: f.tierra }, far = other(f, gone); kill(x); addEdge(keep, far, props); }
        } else {
          const [ux, uy] = vec(e.n0, e), through = (n, x) => { const v = vec(n, edges[x]); return Math.abs(v[0] * ux + v[1] * uy) > .94; };
          const cand = [...nodes[e.n0].e].filter(x => x !== id && !through(e.n0, x)).map(x => [x, e.n0]).concat([...nodes[e.n1].e].filter(x => x !== id && !through(e.n1, x)).map(x => [x, e.n1]));
          if (cand.length) { cand.sort((p, q) => prio(p[0], p[1]) - prio(q[0], q[1])); kill(cand[0][0]); } else kill(id);
        }
        ch++; }
      // (b) más de 4 calles en una esquina
      for (let n = 0; n < nodes.length; n++) while (nodes[n].e.size > 4) { const a = [...nodes[n].e].sort((p, q) => prio(p, n) - prio(q, n)); kill(a[0]); ch++; }
      // (d) ángulos muy cerrados
      for (let n = 0; n < nodes.length; n++) { const a = [...nodes[n].e]; let done = false;
        for (let i = 0; i < a.length && !done; i++) for (let j = i + 1; j < a.length && !done; j++)
          if (ang(vec(n, edges[a[i]]), vec(n, edges[a[j]])) < MINA(a[i], a[j])) { kill(prio(a[i], n) < prio(a[j], n) ? a[i] : a[j]); ch++; done = true; } }
      // (a) callejones: se estiran hasta la próxima calle o se sacan
      for (let n = 0; n < nodes.length; n++) { if (nodes[n].e.size !== 1 || borde(n)) continue;
        const id = [...nodes[n].e][0], e = edges[id], v = vec(n, e), dir = [-v[0], -v[1]], p = [nodes[n].x, nodes[n].y], Lmax = e.type === "pasillo" ? 14 : 45;
        let best = null, bt = Lmax;
        for (let x = 0; x < edges.length; x++) { const f = edges[x]; if (!f.ok || x === id || f.n0 === n || f.n1 === n) continue;
          const a = nodes[f.n0], b = nodes[f.n1], fx = b.x - a.x, fy = b.y - a.y, fl = Math.hypot(fx, fy), d = dir[0] * fy - dir[1] * fx; if (Math.abs(d) < 1e-6) continue;
          const ax = a.x - p[0], ay = a.y - p[1], t = (ax * fy - ay * fx) / d, u = (ax * dir[1] - ay * dir[0]) / d;
          if (t > .5 && t < bt && u >= -.01 && u <= 1.01 && Math.abs(dir[0] * fx / fl + dir[1] * fy / fl) < Math.cos(35 * Math.PI / 180)) { bt = t; best = [x, [p[0] + dir[0] * t, p[1] + dir[1] * t]]; } }
        if (best) { const h = splitAt(best[0], best[1]); addEdge(n, h, { type: e.type, d: e.d, ancha: e.ancha, borde: e.borde, tierra: e.tierra }); }
        else kill(id);
        ch++; }
      if (!ch) break;
    }
    // si quedó algún callejón (la iteración no convergió), se poda
    for (let again = true; again;) { again = false;
      for (let n = 0; n < nodes.length; n++) if (nodes[n].e.size === 1 && !borde(n)) { kill([...nodes[n].e][0]); again = true; } }
    // componentes sueltos y chicos afuera (menos de 60 m de calle)
    const comp = new Int32Array(nodes.length).fill(-1), tot = [];
    for (let s = 0; s < nodes.length; s++) { if (comp[s] >= 0 || !nodes[s].e.size) continue; const c = tot.length; tot.push(0); const st = [s]; comp[s] = c;
      while (st.length) { const n = st.pop(); for (const x of nodes[n].e) { tot[c] += vec(n, edges[x])[2] / 2; const m = other(edges[x], n); if (comp[m] < 0) { comp[m] = c; st.push(m); } } } }
    edges.forEach((e, id) => { if (e.ok && tot[comp[e.n0]] < 60) kill(id); });
    // 4) vuelta a tramos rectos: en cada esquina se emparejan las calles que siguen derecho (mismo tipo, desvío < 6°)
    const pair = new Map();
    for (let n = 0; n < nodes.length; n++) { const a = [...nodes[n].e], c = [];
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { if (edges[a[i]].type !== edges[a[j]].type) continue;
        const dv = Math.PI - ang(vec(n, edges[a[i]]), vec(n, edges[a[j]])); if (dv < 6 * Math.PI / 180) c.push([dv, a[i], a[j]]); }
      c.sort((p, q) => p[0] - q[0]); const used = new Set();
      for (const [, i, j] of c) { if (used.has(i) || used.has(j)) continue; used.add(i); used.add(j); pair.set(n + ":" + i, j); pair.set(n + ":" + j, i); } }
    const done = new Set(), out = [];
    for (let id = 0; id < edges.length; id++) { if (!edges[id].ok || done.has(id)) continue;
      // hacia atrás hasta el principio de la cadena
      let n = edges[id].n0, e = id, guard = 0;
      while (pair.has(n + ":" + e) && guard++ < 5000) { const f = pair.get(n + ":" + e); if (f === id) break; n = other(edges[f], n); e = f; }
      const chain = [n]; let cur = e, at = n; guard = 0;
      while (guard++ < 5000) { done.add(cur); at = other(edges[cur], at); chain.push(at); const f = pair.get(at + ":" + cur); if (f == null || done.has(f)) break; cur = f; }
      const props = edges[e];
      // Douglas-Peucker (0,8 m): la cadena se parte donde dobla
      const pts = chain.map(k => [nodes[k].x, nodes[k].y]);
      const dp = (i0, i1) => { let mi = -1, md = .8; const a = pts[i0], b = pts[i1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-9;
        for (let k = i0 + 1; k < i1; k++) { const dd = Math.abs((pts[k][0] - a[0]) * dy - (pts[k][1] - a[1]) * dx) / l; if (dd > md) { md = dd; mi = k; } }
        if (mi < 0) out.push({ a: pts[i0], b: pts[i1], type: props.type, d: props.d, ancha: props.ancha, borde: props.borde, tierra: props.tierra }); else { dp(i0, mi); dp(mi, i1); } };
      dp(0, pts.length - 1); }
    return out;
  }

  // ---------- geometría
  function pickW(r, pairs) { let s = 0; for (const p of pairs) s += p[1]; let x = r() * s; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[0][0]; }
  function clip(poly, f) { const out = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
      if (fa <= 0) out.push(a); if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } } return out; }
  function clipLine(poly, c, d) { let t0 = -1e9, t1 = 1e9;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], e = [b[0] - a[0], b[1] - a[1]], n = [e[1], -e[0]];
      // interior: lado con producto cruz consistente (polígono antihorario)
      const num = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1], den = d[0] * n[0] + d[1] * n[1];
      if (Math.abs(den) < 1e-9) { if (num < 0) return null; continue; }
      const t = num / den; if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); }
    if (t1 - t0 < 10) return null; return [[c[0] + d[0] * t0, c[1] + d[1] * t0], [c[0] + d[0] * t1, c[1] + d[1] * t1]]; }
  function inside(poly, p) { let m = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], e = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...e);
      const dd = ((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) / L; m = Math.min(m, -dd); } return m; }
  function segDist(s, x, y) { const px = x - s.a[0], py = y - s.a[1]; let t = px * s.dir[0] + py * s.dir[1]; const tc = Math.max(0, Math.min(s.len, t));
    const cx = s.a[0] + s.dir[0] * tc, cy = s.a[1] + s.dir[1] * tc, dx = x - cx, dy = y - cy; return { d: Math.hypot(dx, dy), t, ds: px * s.n[0] + py * s.n[1] }; }
  function segInter(s, o) { const d = s.dir[0] * o.dir[1] - s.dir[1] * o.dir[0]; if (Math.abs(d) < 1e-6) return null;
    const ax = o.a[0] - s.a[0], ay = o.a[1] - s.a[1], t = (ax * o.dir[1] - ay * o.dir[0]) / d, u = (ax * s.dir[1] - ay * s.dir[0]) / d;
    if (t < -1 || t > s.len + 1 || u < -1 || u > o.len + 1) return null; return [s.a[0] + s.dir[0] * t, s.a[1] + s.dir[1] * t]; }
  function inQuad(q, x, y) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c > 0) s |= 1; else if (c < 0) s |= 2; } return s !== 3; }
  return { generate, segDist, pickW };
})();
