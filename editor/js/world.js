// ===================== world.js — conurbano caótico en metros =====================
// Loteos (Voronoi) con grillas rotadas, avenidas diagonales, pasajes, villas con pasillos, riqueza variable.
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

    // ---------- loteos (Voronoi por recorte de semiplanos)
    const seeds = [];
    const minSep = Math.sqrt(MW * MH / C.loteos) * .7;
    for (let i = 0; i < C.loteos; i++) { let p, ok, tries = 0;
      do { p = [r.uni(30, MW - 30), r.uni(30, MH - 30)]; ok = seeds.every(s => Math.hypot(s.p[0] - p[0], s.p[1] - p[1]) > minSep); } while (!ok && ++tries < 60);
      seeds.push({ p }); }
    let villas = 0;
    const districts = seeds.map((s, i) => {
      let poly = [[0, 0], [MW, 0], [MW, MH], [0, MH]];
      for (const o of seeds) { if (o === s) continue;
        const m = [(s.p[0] + o.p[0]) / 2, (s.p[1] + o.p[1]) / 2], n = [o.p[0] - s.p[0], o.p[1] - s.p[1]];
        poly = clip(poly, (q) => (q[0] - m[0]) * n[0] + (q[1] - m[1]) * n[1]); }
      const w = wealthAt(s.p[0], s.p[1]);
      let type = "loteo";
      if (w < C.umbralVilla && villas < C.villasMax && r() < .75) { type = "villa"; villas++; }
      const dz = C.desorden * Math.PI / 180, theta = snapA((r() < C.diagonal ? Math.PI / 4 : 0) + r.uni(-dz, dz) * (r() < .5 ? 1 : .35));
      return { i, p: s.p, poly, w, type, theta,
        bA: C.manzana * (w < .35 ? r.uni(55, 85) : r.uni(75, 110)), bB: C.manzana * (w < .35 ? r.uni(30, 55) : r.uni(40, 90)) };
    });

    // ---------- calles
    const segs = [];
    const addSeg = (a, b, type, d, extra = {}) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 6) return null;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w = wealthAt(mid[0], mid[1]);
      let mat;
      if (type === "ave") mat = w < .3 && r() < .4 ? "roto" : "asf";
      else if (type === "pasillo") mat = "pasillo";
      else mat = w < .28 ? pickW(r, [["tierra", 6 * C.tierra], ["roto", 3.5], ["asf", .6]]) : w < .52 ? pickW(r, [["asf", 4.5], ["roto", 4], ["tierra", 1.4 * C.tierra]]) : pickW(r, [["asf", 8.5], ["roto", 1.5]]);
      if (type === "pasaje" && mat === "asf" && r() < .4) mat = w < .5 ? "tierra" : "roto";
      const hw = { ave: C.avenida / 2, calle: C.calle / 2 * (extra.ancha ? 1.25 : 1), pasaje: C.pasaje / 2, pasillo: C.pasillo / 2 }[type];
      let sw = { ave: C.vereda * 1.45, calle: C.vereda * (w < .3 ? .8 : 1), pasaje: C.vereda * (w < .4 ? .45 : .56), pasillo: 0 }[type];
      if (mat === "tierra" && type !== "pasillo") sw = Math.max(sw, 2.6);
      const s = { id: segs.length, a, b, len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], type, mat, hw, sw, w, cls: CLS[type],
        med: type === "ave" ? Math.min(hw - 2.5, C.cantCentral / 2) : 0, cantero: type !== "pasillo" && mat !== "tierra" && sw >= 2.5 && r() < (w < .35 ? .45 : .85), cross: [], lots: { 1: [], "-1": [] }, district: d };
      s.n = [-s.dir[1], s.dir[0]];
      segs.push(s); return s;
    };
    // avenidas (2–3, diagonales con curvas suaves)
    const nAve = C.avenidas;
    for (let k = 0; k < nAve; k++) {
      const side = r.int(0, 3); let p = side === 0 ? [r.uni(0, MW), -10] : side === 1 ? [MW + 10, r.uni(0, MH)] : side === 2 ? [r.uni(0, MW), MH + 10] : [-10, r.uni(0, MH)];
      const target = [MW / 2 + r.uni(-220, 220), MH / 2 + r.uni(-150, 150)];
      let ang = Math.atan2(target[1] - p[1], target[0] - p[0]);
      for (let step = 0; step < 30; step++) {
        const L = r.uni(70, 120); ang += r.uni(-.18, .18);
        const q = [p[0] + Math.cos(snapA(ang)) * L, p[1] + Math.sin(snapA(ang)) * L];
        addSeg(p, q, "ave", null); p = q;
        if (p[0] < -20 || p[0] > MW + 20 || p[1] < -20 || p[1] > MH + 20) break;
      }
    }
    // bordes de loteo (cada arista una vez)
    const seen = new Set();
    for (const d of districts) for (let i = 0; i < d.poly.length; i++) {
      const a = d.poly[i], b = d.poly[(i + 1) % d.poly.length];
      const onBorder = (q) => q[0] < .5 || q[1] < .5 || q[0] > MW - .5 || q[1] > MH - .5;
      if (onBorder(a) && onBorder(b) && (Math.abs(a[0] - b[0]) < .5 || Math.abs(a[1] - b[1]) < .5)) continue;
      const key = [a, b].map(q => q.map(v => Math.round(v)).join(",")).sort().join("|"); if (seen.has(key)) continue; seen.add(key);
      // un poco de curva/quiebre en los bordes largos
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 120 && r() < .5) { const m = [(a[0] + b[0]) / 2 + r.uni(-8, 8), (a[1] + b[1]) / 2 + r.uni(-8, 8)]; addSeg(a, m, "calle", d, { ancha: r() < .3 }); addSeg(m, b, "calle", d, { ancha: r() < .3 }); }
      else addSeg(a, b, "calle", d, { ancha: r() < .3 });
    }
    // grillas internas
    for (const d of districts) {
      if (d.type === "villa") continue;
      const u = [Math.cos(d.theta), Math.sin(d.theta)], v = [-u[1], u[0]];
      const proj = d.poly.map(q => [q[0] * u[0] + q[1] * u[1], q[0] * v[0] + q[1] * v[1]]);
      const [umin, umax] = [Math.min(...proj.map(p => p[0])), Math.max(...proj.map(p => p[0]))], [vmin, vmax] = [Math.min(...proj.map(p => p[1])), Math.max(...proj.map(p => p[1]))];
      // líneas paralelas a u (separadas bB) y a v (separadas bA)
      for (const [dirv, other, step, lo, hi] of [[u, v, d.bB, vmin, vmax], [v, u, d.bA, umin, umax]]) {
        let off = lo + r.uni(.3, .9) * step;
        while (off < hi - 8) {
          const jitter = QA ? 0 : r.uni(-.05, .05) * (d.w < .4 ? 2 : 1);
          const dv = [dirv[0] * Math.cos(jitter) - dirv[1] * Math.sin(jitter), dirv[0] * Math.sin(jitter) + dirv[1] * Math.cos(jitter)];
          const c = [other[0] * off, other[1] * off];
          const seg = clipLine(d.poly, c, dv);
          if (seg && r() > .1) {
            let [a, b] = seg;
            if (r() < .12) { const t = r.uni(.3, .7); b = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }   // cortada
            addSeg(a, b, "calle", d);
          }
          if (r() < C.pasajes * (d.w < .4 ? 1.4 : .72)) {     // pasaje a mitad de manzana
            const c2 = [other[0] * (off + step / 2), other[1] * (off + step / 2)], s2 = clipLine(d.poly, c2, dirv);
            if (s2) { let [a, b] = s2; const t0 = r.uni(0, .4), t1 = r.uni(.6, 1); addSeg([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1], "pasaje", d); }
          }
          off += step * r.uni(.85, 1.2);
        }
      }
    }
    // villas: pasillos orgánicos
    for (const d of districts) {
      if (d.type !== "villa") continue;
      const starts = [];
      for (let i = 0; i < d.poly.length; i++) { const a = d.poly[i], b = d.poly[(i + 1) % d.poly.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = r.uni(10, 25); t < L - 8; t += r.uni(26, 42)) starts.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); }
      for (const st of starts) {
        let p = st, ang = Math.atan2(d.p[1] - p[1], d.p[0] - p[0]) + r.uni(-.5, .5);
        const walk = (p, ang, depth) => {
          for (let k = 0; k < 9; k++) {
            const L = r.uni(8, 15); ang += r.uni(-.4, .4);
            const q = [p[0] + Math.cos(snapA(ang)) * L, p[1] + Math.sin(snapA(ang)) * L];
            if (inside(d.poly, q) < 4) return;
            addSeg(p, q, "pasillo", d); p = q;
            if (depth < 1 && r() < .2) walk(p, ang + r.pick([-1, 1]) * r.uni(.9, 1.6), depth + 1);
          }
        };
        walk(p, ang, 0);
      }
      // una calle de tierra que cruza la villa
      const s2 = clipLine(d.poly, d.p, [Math.cos(d.theta), Math.sin(d.theta)]); if (s2) { const sg = addSeg(s2[0], s2[1], "calle", d); if (sg) { sg.mat = "tierra"; sg.cantero = false; sg.sw = 1.6; } }
    }

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
    return { MW, MH, segs, lots, districts, inters, classify, classifyInto, lotAt, wealthAt, near };
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
