// ===================== world.js — conurbano caótico en metros =====================
// Loteos (Voronoi) agrupados en familias de grilla, avenidas rectas, pasajes de una cuadra, villas con pasillos, riqueza variable;
// la red se limpia como grafo (esquinas de 3 o 4, sin callejones sin salida).
const World = (() => {
  const { rng, vnoise } = R3;
  const CLS = { ave: 4, calle: 3, pasaje: 2, pasillo: 1 };
  // los 48 rumbos de pantalla de los autos (cada 7,5°) pasados a ángulos del mundo (proyección oblicua: x + K·y, −SYN·y)
  const TAU = 2 * Math.PI, ANG = (() => { const o = []; for (let k = 0; k < 48; k++) { const a = k * Math.PI / 24, dy = -Math.sin(a) / R3.SYN, dx = Math.cos(a) + R3.K * Math.sin(a) / R3.SYN;
    o.push(((Math.atan2(dy, dx) % TAU) + TAU) % TAU); } return o.sort((a, b) => a - b); })();
  const angDist = (a, b) => Math.abs((((a - b) % TAU) + 1.5 * TAU) % TAU - Math.PI);
  const angIdx = (t) => { let b = 0, bd = 9; for (let i = 0; i < 48; i++) { const d = angDist(t, ANG[i]); if (d < bd) { bd = d; b = i; } } return b; };
  const snapAng = (t) => ANG[angIdx(t)];
  const PAIRS = []; for (let i = 0; i < 48; i++) { const j = angIdx(ANG[i] + Math.PI / 2); if (angDist(ANG[j], ANG[i] + Math.PI / 2) < 1.6 * Math.PI / 180) PAIRS.push([ANG[i], ANG[j]]); }

  function generate(seed) {
    // el mundo es el área jugable (mapW × mapH) más el margen de cada lado: ciudad del otro lado del paredón que la cierra.
    // Con "barrio real" el mapa sale de OpenStreetMap (REAL, de herramientas/osm_real.py): calles, villa, plazas y canchas
    // de verdad, con su propio tamaño
    const C = CFG.v, RM = C.real && typeof REAL !== "undefined" ? REAL : null;
    const MG = RM ? RM.MG : Math.max(0, C.margen || 0), MW = RM ? RM.MW : C.mapW + 2 * MG, MH = RM ? RM.MH : C.mapH + 2 * MG, r = rng(seed);
    const dentro = (x, y) => x >= MG && y >= MG && x <= MW - MG && y <= MH - MG;
    // ---------- riqueza (0 = pobre, 1 = acomodado)
    const WG = Math.ceil(MW / 10), HG = Math.ceil(MH / 10), n1 = vnoise(WG, HG, Math.max(2, Math.round(C.zonaRiqueza / 10)), r), n2 = vnoise(WG, HG, 6, r);
    let wealthAt = (x, y) => { const gx = Math.max(0, Math.min(WG - 1, (x / 10) | 0)), gy = Math.max(0, Math.min(HG - 1, (y / 10) | 0)), k = gy * WG + gx;
      return Math.max(0, Math.min(1, (n1[k] - .5) * C.contraste + (n2[k] - .5) * .5 + .5 + C.sesgo)); };
    let fams = [], big = -1, villaBlocks = [], villaAt = () => false, villaKey = () => -1, districts = [], raw = [], red = [], zona = () => 0;
    if (RM) ({ wealthAt, villaBlocks, villaAt, districts, red, zona } = real(RM, MW, MH, n1, n2, WG, HG));
    else {

    // ---------- zonas y grillas
    // Las calles sólo van en los 48 rumbos de pantalla que tienen los autos (cada 7,5°), pasados al mundo (ANG). Cada grilla usa
    // un par de esos rumbos que queda casi en escuadra en el mundo (PAIRS, error < 1,6°), así los autos van derechos en las dos
    // direcciones y las casas, que se hornean en esos mismos rumbos, quedan paralelas a su calle.
    // En un mapa chico hay una sola grilla (como Flores); en uno grande, zonas de loteos de distintas épocas separadas por rectas
    // (también en esos rumbos), que son avenidas o calles.
    const dz = C.desorden * Math.PI / 180, nF = Math.max(1, Math.min(4, Math.round(MW * MH * (C.loteos / 15) / 200000)));
    const regions = [{ poly: [[0, 0], [MW, 0], [MW, MH], [0, MH]] }], cortes = [];
    while (regions.length < nF) {
      regions.sort((a, b) => polyArea(b.poly) - polyArea(a.poly)); const R = regions.shift();
      const xs = R.poly.map(q => q[0]), ys = R.poly.map(q => q[1]), bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      const p = [(Math.max(...xs) + Math.min(...xs)) / 2 + r.uni(-.15, .15) * bw, (Math.max(...ys) + Math.min(...ys)) / 2 + r.uni(-.15, .15) * bh];
      const ang = snapAng((bw > bh ? Math.PI / 2 : 0) + r.uni(-.45, .45)), d = [Math.cos(ang), Math.sin(ang)], n = [-d[1], d[0]];
      const A = clip(R.poly, q => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1]), Bp = clip(R.poly, q => -((q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1]));
      const s = clipLine(R.poly, p, d); if (!s || A.length < 3 || Bp.length < 3) { regions.push(R); break; }
      cortes.push(s); regions.push({ poly: A }, { poly: Bp });
    }
    fams = regions.map((R, i) => {
      const want = r.uni(-dz, dz) + (r() < C.diagonal ? Math.PI / 4 : 0); let best = PAIRS[0], bd = 9;
      for (const [a, b] of PAIRS) { const dd = Math.abs((((a - want) % Math.PI) + 1.5 * Math.PI) % Math.PI - Math.PI / 2); if (dd < bd) { bd = dd; best = [a, b]; } }
      const c = centroid(R.poly), w = wealthAt(c[0], c[1]), cuadrada = w > .5 ? r() < .7 : r() < .3;       // cuadras cuadradas (CABA) o alargadas (conurbano)
      const bA = C.manzana * (cuadrada ? r.uni(96, 112) : r.uni(105, 135)), bB = C.manzana * (cuadrada ? bA / C.manzana * r.uni(.94, 1.04) : r.uni(55, 72));
      const u = [Math.cos(best[0]), Math.sin(best[0])], v = [Math.cos(best[1]), Math.sin(best[1])];
      const f = { i, c, poly: R.poly, w, theta: best[0], thetaV: best[1], bA, bB, oA: r.uni(0, bA), oB: r.uni(0, bB), u, v, nu: [-u[1], u[0]], nv: [-v[1], v[0]] };
      // esquina de la manzana: cruce de la línea V número i (q·nv = oA + i·bA) con la línea U número j (q·nu = oB + j·bB)
      const det = f.nu[0] * f.nv[1] - f.nu[1] * f.nv[0];
      f.corner = (i, j) => { const a = f.oB + j * f.bB, b = f.oA + i * f.bA; return [(a * f.nv[1] - b * f.nu[1]) / det, (b * f.nu[0] - a * f.nv[0]) / det]; };
      const pv = R.poly.map(q => q[0] * f.nv[0] + q[1] * f.nv[1]), pu = R.poly.map(q => q[0] * f.nu[0] + q[1] * f.nu[1]);
      f.i0 = Math.floor((Math.min(...pv) - f.oA) / bA) - 1; f.i1 = Math.ceil((Math.max(...pv) - f.oA) / bA) + 1;
      f.j0 = Math.floor((Math.min(...pu) - f.oB) / bB) - 1; f.j1 = Math.ceil((Math.max(...pu) - f.oB) / bB) + 1;
      f.block = (i, j) => { const q = [f.corner(i, j), f.corner(i + 1, j), f.corner(i + 1, j + 1), f.corner(i, j + 1)]; return polyArea(q) < 0 ? q.reverse() : q; };
      return f;
    });
    big = fams.reduce((a, f) => polyArea(f.poly) > polyArea(a.poly) ? f : a, fams[0]).i;

    // ---------- villas: grupos de manzanas enteras en las zonas más pobres, rodeadas de calles comunes (como la 1-11-14)
    const villaOf = new Map();
    { const cand = [];
      for (const f of fams) for (let i = f.i0; i < f.i1; i++) for (let j = f.j0; j < f.j1; j++) {
        const q = f.block(i, j), c = centroid(q);
        if (q.some(p => p[0] < 6 || p[1] < 6 || p[0] > MW - 6 || p[1] > MH - 6) || q.some(p => inside(f.poly, p) < 3)) continue;
        cand.push({ f, i, j, q, c, w: wealthAt(c[0], c[1]) }); }
      const key = (b) => b.f.i + ":" + b.i + ":" + b.j, byKey = new Map(cand.map(b => [key(b), b]));
      const seedsV = cand.filter(b => b.w < C.umbralVilla).sort((a, b) => a.w - b.w);
      let nV = 0;
      for (const s of seedsV) {
        if (nV >= C.villasMax) break; if (villaOf.has(key(s))) continue;
        if ([...villaOf.keys()].some(k => { const b = byKey.get(k); return Math.hypot(b.c[0] - s.c[0], b.c[1] - s.c[1]) < 2.5 * (s.f.bA + s.f.bB); })) continue;
        const target = Math.max(2, Math.round(r.uni(2, 4.5) * Math.sqrt(MW * MH / 163000))), grupo = [s]; villaOf.set(key(s), nV);
        for (let g = 0; g < grupo.length && grupo.length < target; g++) { const b = grupo[g];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => r() - .5)) { const o = byKey.get(b.f.i + ":" + (b.i + di) + ":" + (b.j + dj));
            if (o && !villaOf.has(key(o)) && o.w < C.umbralVilla + .14 && grupo.length < target) { villaOf.set(key(o), nV); grupo.push(o); } } }
        nV++;
      }
      for (const [k, id] of villaOf) { const b = byKey.get(k); villaBlocks.push({ i: villaBlocks.length, p: b.c, poly: b.q, w: b.w, type: "villa", villa: id, theta: b.f.theta, bA: b.f.bA, bB: b.f.bB, fam: b.f }); }
    }
    villaAt = (x, y) => villaBlocks.some(b => inside(b.poly, [x, y]) > 0);
    villaKey = (f, i, j) => villaOf.has(f.i + ":" + i + ":" + j) ? villaOf.get(f.i + ":" + i + ":" + j) : -1;
    // zonas (para el editor y los loteos): primero las manzanas de villa, después las zonas de cada grilla
    districts = villaBlocks.concat(fams.map(f => ({ i: villaBlocks.length + f.i, p: f.c, poly: f.poly, w: f.w, type: "loteo", fam: f, theta: f.theta, bA: f.bA, bB: f.bB })));

    // ---------- calles: primero en crudo, cuadra por cuadra; después se limpian como red (esquinas de 3 o 4, sin callejones)
    const add = (a, b, type, d, extra = {}) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 4) raw.push({ a, b, type, d, ...extra }); };
    for (const s of cortes) add(s[0], s[1], Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 150 ? "ave" : "calle", null, { ancha: true, borde: true });
    const aveEvery = [r.int(4, 6), r.int(4, 6)], aveOff = [r.int(0, 5), r.int(0, 5)], esAve = (f, axis, k) => f.i === big && C.avenidas > axis &&
      ((k - aveOff[axis]) % aveEvery[axis] + aveEvery[axis]) % aveEvery[axis] === 0;
    for (const f of fams) {
      const piece = (a, b, type, extra) => { const c = clipSeg(f.poly, a, b); if (c) add(c[0], c[1], type, f, extra); };
      // cuadras de las líneas U (j fijo, entre las líneas V i e i+1) y de las líneas V (i fijo, entre j y j+1)
      for (let j = f.j0; j <= f.j1; j++) for (let i = f.i0; i < f.i1; i++) {
        const va = villaKey(f, i, j - 1), vb = villaKey(f, i, j), adentro = va >= 0 && va === vb;
        piece(f.corner(i, j), f.corner(i + 1, j), adentro ? "pasaje" : esAve(f, 0, j) ? "ave" : "calle", adentro ? { tierra: true } : {}); }
      for (let i = f.i0; i <= f.i1; i++) for (let j = f.j0; j < f.j1; j++) {
        const va = villaKey(f, i - 1, j), vb = villaKey(f, i, j), adentro = va >= 0 && va === vb;
        piece(f.corner(i, j), f.corner(i, j + 1), adentro ? "pasaje" : esAve(f, 1, i) ? "ave" : "calle", adentro ? { tierra: true } : {}); }
      // pasajes a mitad de manzana, de una calle a la de enfrente (más en los barrios pobres)
      for (let i = f.i0; i < f.i1; i++) for (let j = f.j0; j < f.j1; j++) {
        if (villaKey(f, i, j) >= 0) continue; const c = centroid(f.block(i, j)), w = wealthAt(c[0], c[1]);
        if (r() > C.pasajes * (w < .4 ? 1.1 : .5) * .35) continue;
        const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        if (r() < .5) piece(mid(f.corner(i, j), f.corner(i, j + 1)), mid(f.corner(i + 1, j), f.corner(i + 1, j + 1)), "pasaje", {});
        else piece(mid(f.corner(i, j), f.corner(i + 1, j)), mid(f.corner(i, j + 1), f.corner(i + 1, j + 1)), "pasaje", {});
      }
    }
    // villas: en cada manzana, pasillos en dos familias de líneas que serpentean y se cruzan; terminan en la calle de alrededor
    for (const d of villaBlocks) {
      const a0 = d.theta + r.uni(-.3, .3);
      for (const ang of [a0, a0 + Math.PI / 2 + r.uni(-.25, .25)]) {
        const u = [Math.cos(ang), Math.sin(ang)], v = [-u[1], u[0]], pu = d.poly.map(q => q[0] * u[0] + q[1] * u[1]), pv = d.poly.map(q => q[0] * v[0] + q[1] * v[1]);
        const u0 = Math.min(...pu) - 5, u1 = Math.max(...pu) + 5;
        for (let off = Math.min(...pv) + r.uni(6, 14); off < Math.max(...pv) - 5; off += r.uni(13, 22)) {
          let prev = null, prevIn = false, lat = 0;
          for (let t = u0; t <= u1 + 1; t += r.uni(8, 13)) {
            lat = Math.max(-5, Math.min(5, lat + r.uni(-2.2, 2.2)));
            const q = [u[0] * t + v[0] * (off + lat), u[1] * t + v[1] * (off + lat)], qIn = inside(d.poly, q) > 0;
            if (prev && (qIn || prevIn)) { const c = clipSeg(d.poly, prev, q); if (c) add(c[0], c[1], "pasillo", d); }
            prev = q; prevIn = qIn;
          }
        }
      }
    }

    // ---------- limpieza de la red: grafo plano, reglas de Buenos Aires, y vuelta a segmentos rectos
    red = limpiarRed(raw, MW, MH);
    }

    // ---------- plazas: una manzana cada 5 o 6 cuadras (la más cercana a cada punto de una grilla gruesa)
    // ---------- segmentos definitivos
    const segs = [];
    const addSeg = (a, b, type, d, extra = {}) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 3) return null;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w = wealthAt(mid[0], mid[1]);
      let mat;
      if (type === "ave") mat = w < .3 && r() < .4 ? "roto" : "asf";
      else if (type === "pasillo") mat = "pasillo";
      else if (extra.real && w >= .25) mat = type === "pasaje" && r() < .3 ? "roto" : pickW(r, [["asf", 7], ["roto", 2.5]]);   // en la Capital las calles son de asfalto (o de adoquín)
      else mat = w < .28 ? pickW(r, [["tierra", 6 * C.tierra], ["roto", 3.5], ["asf", .6]]) : w < .52 ? pickW(r, [["asf", 4.5], ["roto", 4], ["tierra", 1.4 * C.tierra]]) : pickW(r, [["asf", 8.5], ["roto", 1.5]]);
      if (type === "pasaje" && mat === "asf" && r() < .4) mat = w < .5 ? "tierra" : "roto";
      if (extra.tierra) mat = "tierra";
      else if (type === "calle" && mat !== "tierra" && w > .34 && r() < .38 * (C.adoquines ?? 1)) mat = "adoquin";      // calles de adoquines, como en Flores
      const hw = extra.hwR ?? { ave: C.avenida / 2, calle: C.calle / 2 * (extra.ancha ? 1.25 : 1), pasaje: C.pasaje / 2, pasillo: C.pasillo / 2 }[type];
      let sw = { ave: C.vereda * 1.45, calle: C.vereda * (w < .3 ? .8 : 1), pasaje: C.vereda * (w < .4 ? .45 : .56), pasillo: 0 }[type];
      if (mat === "tierra" && type !== "pasillo") sw = Math.max(sw, extra.tierra ? 1.6 : 2.6);
      const s = { id: segs.length, a, b, len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], type, mat, hw, sw, w, cls: CLS[type],
        med: type === "ave" ? Math.max(0, Math.min(hw - 2.5, extra.medR ?? C.cantCentral / 2)) : 0, nombre: extra.nombre || "", cantero: type !== "pasillo" && mat !== "tierra" && sw >= 2.5 && r() < (w < .35 ? .45 : .85), cross: [], lots: { 1: [], "-1": [] }, district: d };
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
      const crossOn = (a, b) => { if (((a.mat === "asf" || a.mat === "adoquin") && a.w > .42 && b.type !== "pasaje" || a.type === "ave") && b.type !== "pasillo") { const t = ((p[0] - a.a[0]) * a.dir[0] + (p[1] - a.a[1]) * a.dir[1]); const cl = b.hw + b.sw + 1.4; a.cross.push(t - cl, t + cl); } };
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
    if (C.plazas !== 0 && !RM) {
      const f = fams[big], step = r.int(5, 6), pi = r.int(0, step - 1), pj = r.int(0, step - 1);
      const cands = [];
      for (let i = f.i0; i < f.i1; i++) for (let j = f.j0; j < f.j1; j++) {
        const q = f.block(i, j), c = centroid(q);
        if (q.some(p => p[0] < 4 || p[1] < 4 || p[0] > MW - 4 || p[1] > MH - 4) || q.some(p => inside(f.poly, p) < 1) || villaKey(f, i, j) >= 0) continue;
        // las cuatro cuadras que la rodean tienen que ser calles
        const lados = [[0, 1], [1, 2], [2, 3], [3, 0]].filter(([a, b]) => { const m = [(q[a][0] + q[b][0]) / 2, (q[a][1] + q[b][1]) / 2], k = classify(m[0], m[1]); return k && k.k === "road"; }).length;
        if (lados < 4) continue;
        cands.push({ i, j, q, c, en: ((i - pi) % step + step) % step === 0 && ((j - pj) % step + step) % step === 0 });
      }
      let elegidas = cands.filter(c => c.en);
      if (!elegidas.length && cands.length) elegidas = [cands.reduce((a, b) => Math.hypot(b.c[0] - MW / 2, b.c[1] - MH / 2) < Math.hypot(a.c[0] - MW / 2, a.c[1] - MH / 2) ? b : a)];
      for (const pz of elegidas) {
        const id = lots.length, w = wealthAt(pz.c[0], pz.c[1]);
        const lot = { id, q: pz.q, o: pz.q[0], ux: f.u, nOut: f.v, fw: f.bA, ld: f.bB, seg: null, side: 1, w, kind: "plaza", phi: f.theta, seed: (r() * 1e9) | 0, vereda: "vain", patio: "pasto",
          plaza: { c: pz.c, u: f.u, v: f.v, bA: f.bA, bB: f.bB } };
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
    // ---------- barrio real: plazas (con sus senderos de OSM, o en cruz si no tienen) y canchas, antes que los lotes
    if (RM) {
      const stampPoly = (poly, id) => { let n = 0; const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
        for (let y = Math.max(0, Math.floor(Math.min(...ys) * LR)); y <= Math.min(LH - 1, Math.ceil(Math.max(...ys) * LR)); y++)
          for (let x = Math.max(0, Math.floor(Math.min(...xs) * LR)); x <= Math.min(LW - 1, Math.ceil(Math.max(...xs) * LR)); x++) {
            const wx = (x + .5) / LR, wy = (y + .5) / LR; if (lotGrid[y * LW + x] >= 0 || inside(poly, [wx, wy]) <= 0 || classify(wx, wy)) continue;
            lotGrid[y * LW + x] = id; n++; }
        return n; };
      const unstamp = (id) => { for (let i = 0; i < lotGrid.length; i++) if (lotGrid[i] === id) lotGrid[i] = -1; };
      const parques = RM.parques.map(p => ({ ...p })).concat(RM.juegos.map(j => ({ n: "", p: j.p, juegos: true })));
      for (const pk of parques) {
        if (Math.abs(polyArea(pk.p)) < 150) continue;
        const ob = obb(pk.p), w = wealthAt(ob.c[0], ob.c[1]), id = lots.length;
        const lot = { id, q: pk.p, o: pk.p[0], ux: ob.u, nOut: ob.v, fw: ob.bA, ld: ob.bB, seg: null, side: 1, w, kind: "plaza", phi: Math.atan2(ob.u[1], ob.u[0]), seed: (r() * 1e9) | 0,
          vereda: "vain", patio: "pasto", plaza: { ...ob, real: true, juegos: !!pk.juegos }, nombre: pk.n || "" };
        lots.push(lot);
        if (stampPoly(pk.p, id) < 120) { unstamp(id); lot.kind = "nada"; continue; }
        plazas.push(lot);
        const sid = lots.length, sendero = { ...lot, id: sid, kind: "sendero", patio: "roja", plaza: lot.plaza }; lots.push(sendero);
        let n = 0; const W2 = 1.15;
        for (const sd of RM.senderos) for (let k = 0; k + 1 < sd.length; k++) { const a = sd[k], b = sd[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let t = 0; t <= L; t += .25) { const px = a[0] + (b[0] - a[0]) * t / L, py = a[1] + (b[1] - a[1]) * t / L;
            for (let y = Math.floor((py - W2) * LR); y <= Math.ceil((py + W2) * LR); y++) for (let x = Math.floor((px - W2) * LR); x <= Math.ceil((px + W2) * LR); x++) {
              if (x < 0 || y < 0 || x >= LW || y >= LH || lotGrid[y * LW + x] !== id) continue;
              if (Math.hypot((x + .5) / LR - px, (y + .5) / LR - py) < W2) { lotGrid[y * LW + x] = sid; n++; } } } }
        // sin senderos en el mapa: los de siempre (cruz y rotonda), si la plaza es grande
        if (!n && ob.bA * ob.bB > 1400) for (let i = 0; i < lotGrid.length; i++) { if (lotGrid[i] !== id) continue;
          const wx = ((i % LW) + .5) / LR, wy = (Math.floor(i / LW) + .5) / LR, du = (wx - ob.c[0]) * ob.u[0] + (wy - ob.c[1]) * ob.u[1], dv = (wx - ob.c[0]) * ob.v[0] + (wy - ob.c[1]) * ob.v[1], rr = Math.hypot(du, dv);
          if (Math.abs(rr - 6) < 1.1 || (rr > 5 && (Math.abs(du) < 1.1 || Math.abs(dv) < 1.1))) lotGrid[i] = sid; }
      }
      for (const ch of RM.canchas) {
        const A = Math.abs(polyArea(ch.p)); if (A < 90) continue;
        const ob = obb(ch.p), w = wealthAt(ob.c[0], ob.c[1]), id = lots.length, villa = villaAt(ob.c[0], ob.c[1]);
        const patio = ch.s === "soccer" ? (A > 2500 ? "pasto" : villa ? "tierra" : "sint") : "cem";
        const lot = { id, q: ch.p, o: ch.p[0], ux: ob.u, nOut: ob.v, fw: ob.bA, ld: ob.bB, seg: null, side: 1, w, kind: "cancha", phi: Math.atan2(ob.u[1], ob.u[0]), seed: (r() * 1e9) | 0,
          vereda: "vain", patio, cancha: { ...ob, deporte: ch.s } };
        lots.push(lot);
        if (stampPoly(ch.p, id) < 60) { unstamp(id); lot.kind = "nada"; }
      }
    }
    // ---------- esquinas con ochava: en cada esquina de manzana casi en escuadra (no en la villa ni en la plaza), un lote cuadrado
    // de 10 m con la casa de esquina; los lotes de las dos calles empiezan después. Marco: la calle de adelante es la que deja a la
    // otra del lado izquierdo (x = 0), así la ochava siempre queda en la esquina (0, 0) del lote. Sin sorteos: sale del lugar.
    if (C.ochavas !== 0) for (const it of inters) {
      const { s, o, p } = it;
      if ([s, o].some(q => q.type === "pasillo" || q.type === "pasaje" || q.mat === "tierra")) continue;
      if (Math.abs(s.dir[0] * o.dir[0] + s.dir[1] * o.dir[1]) > .2) continue;
      for (const a of [1, -1]) for (const b of [1, -1]) {
        const u = [s.dir[0] * a, s.dir[1] * a], v = [s.n[0] * b, s.n[1] * b];
        if (u[0] * o.n[0] + u[1] * o.n[1] === 0) continue;
        const du = o.hw + o.sw + .05, dv = s.hw + s.sw + .05, K = [p[0] + u[0] * du + v[0] * dv, p[1] + u[1] * du + v[1] * dv];
        if (K[0] < 6 || K[1] < 6 || K[0] > MW - 6 || K[1] > MH - 6 || !dentro(K[0], K[1])) continue;
        const wq = wealthAt(K[0], K[1]); if (wq < .2) continue;
        if (villaAt(K[0] + (u[0] + v[0]) * 4, K[1] + (u[1] + v[1]) * 4)) continue;
        // una esquina de verdad: vereda de las dos calles pegada al vértice
        const ws = classify(K[0] - v[0] * .6, K[1] - v[1] * .6), wo = classify(K[0] - u[0] * .6, K[1] - u[1] * .6);
        if (!ws || !wo || ws.k !== "walk" || wo.k !== "walk") continue;
        const S = 10, ux0 = [v[1], -v[0]], frenteS = ux0[0] * u[0] + ux0[1] * u[1] > 0;
        const ux = frenteS ? u : v, nOut = frenteS ? v : u, seg = frenteS ? s : o;
        const q = quadPts(K, ux, nOut, S, S); if (!quadFree(q)) continue;
        const id = lots.length, side = nOut[0] * seg.n[0] + nOut[1] * seg.n[1] > 0 ? 1 : -1;
        const h = Math.abs(Math.imul(Math.round(K[0] * 10), 73856093) ^ Math.imul(Math.round(K[1] * 10), 19349663));
        const t0 = (K[0] - seg.a[0]) * seg.dir[0] + (K[1] - seg.a[1]) * seg.dir[1], t1 = t0 + (ux[0] * seg.dir[0] + ux[1] * seg.dir[1]) * S;
        const lot = { id, q, o: K, ux, nOut, fw: S, ld: S, seg, side, w: wq, kind: "esquina", phi: Math.atan2(ux[1], ux[0]), seed: h % 1000000007,
          vereda: wq < .45 ? "cem" : ["vain", "vain", "gris", "roja"][h % 4], patio: "cem", esquina: { c: 2.8, p: wq < .35 ? 1 : 2, rub: (h >>> 3) % 10 } };
        lots.push(lot); stamp(q, id); seg.lots[side].push({ t0: Math.min(t0, t1), t1: Math.max(t0, t1), lot });
      }
    }
    const order = segs.slice().sort((a, b) => b.cls - a.cls || r() - .5);
    for (const s of order) {
      for (const side of [1, -1]) {
        const nOut = [s.n[0] * side, s.n[1] * side], off = s.hw + s.sw + .05;
        let t = s.type === "pasillo" ? r.uni(0, 2) : r.uni(1, 4);
        while (t < s.len - 3) {
          const p = [s.a[0] + s.dir[0] * t + nOut[0] * off, s.a[1] + s.dir[1] * t + nOut[1] * off];
          // en el barrio real, los pasajes peatonales anchos de afuera de la villa (Barrio Rivadavia I) tienen casas de verdad
          const villa = (s.type === "pasillo" && !(RM && s.hw >= 1.5)) || villaAt(p[0] + nOut[0] * 3, p[1] + nOut[1] * 3);
          const w = wealthAt(p[0], p[1]);
          const F = C.frente / 8.66, fw0 = villa ? r.uni(3.6, 6) : F * (s.type === "ave" ? r.uni(7, 10.5) : w < .3 ? r.uni(5.5, 8.5) : w < .6 ? r.uni(7, 9.5) : r.uni(8.5, 13));
          // frentes en metros enteros pares (1,5 m en la villa): la casa del catálogo ocupa el lote entero, pegada a las vecinas
          // (entre medianeras, como en Buenos Aires), sin huecos de pasto entre casa y casa
          const fw = villa ? Math.max(3, Math.round(fw0 / 1.5) * 1.5) : Math.max(4, Math.round(fw0 / 2) * 2);
          if (t + fw > s.len) break;
          // marco del lote: local +y = nOut (alejándose de la calle); local x = ux (izquierda→derecha visto desde la calle)
          const ux0 = [nOut[1], -nOut[0]];
          const o = side === 1 ? p : [p[0] + s.dir[0] * fw, p[1] + s.dir[1] * fw];
          const rot = villa ? r.uni(-.1, .1) : 0;
          const uxr = [ux0[0] * Math.cos(rot) - ux0[1] * Math.sin(rot), ux0[0] * Math.sin(rot) + ux0[1] * Math.cos(rot)];
          const nOutR = [-uxr[1], uxr[0]];
          let placed = false;
          // fondo del lote: hasta la mitad de la manzana (los lotes de una calle y los de la de atrás se tocan en el medio, como en
          // Buenos Aires), medido buscando la calle de enfrente; si no hay, el fondo de siempre
          let half = 0; if (!villa) { for (let dd = 4; dd < 110; dd += 1.5) { const qx = p[0] + nOutR[0] * dd, qy = p[1] + nOutR[1] * dd;
              if (qx < 0 || qy < 0 || qx > MW || qy > MH) { half = dd; break; } const k = classify(qx, qy); if (k) { half = dd / 2 - .3; break; } } }
          const cands = villa ? [r.uni(6, 9), 5, 4] : half > 10 ? [Math.min(55, half) * C.fondo / 27, Math.min(55, half) * .75 * C.fondo / 27, C.fondo * .52, 8, 6] : [r.uni(C.fondo * .6, C.fondo), C.fondo * .52, C.fondo * .4, 8, 6];
          for (const ld of cands) {
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
      else if (RM && /Carabobo/.test(s.nombre || "")) kind = pickW(r, [["negocio", 45], ["negocio_casa", 30], ["casa2", 8], ["edificio", 14 * (C.edificios ?? 1)], ["ph", 4]]);   // Barrio Coreano: casi todo locales
      else if (RM && zona(o[0] + nOut[0] * 3, o[1] + nOut[1] * 3) === 2) kind = pickW(r, [["chalet", 4], ["casa", 3], ["casa2", 2.5], ["negocio_casa", nearEnd ? 1 : .2]]);   // complejo (Rivadavia I: casitas con jardín)
      else if (s.type === "ave") kind = pickW(r, [["negocio", 30], ["negocio_casa", 30], ["ph", 14], ["galpon", 7], ["casa2", 10], ["casa", 6], ["baldio", 3 * C.baldios], ["edificio", 22 * (C.edificios ?? 1) * (.3 + w)]]);
      else if (w < .3) kind = pickW(r, [["casa", 26], ["obra", 24], ["villa", 14], ["casa2", 8], ["negocio", nearEnd ? 18 : 6], ["galpon", 4], ["baldio", 15 * C.baldios]]);
      else if (w < .55) kind = pickW(r, [["casa", 34], ["casa2", 20], ["obra", 10], ["negocio", nearEnd ? 20 : 8], ["negocio_casa", nearEnd ? 14 : 6], ["chalet", 5], ["galpon", 3], ["baldio", 7 * C.baldios]]);
      else kind = pickW(r, [["casa", 22], ["casa2", 26], ["chalet", 28], ["ph", 4], ["negocio", nearEnd ? 12 : 4], ["negocio_casa", nearEnd ? 8 : 3], ["baldio", 2 * C.baldios],
        ["edificio", 16 * (C.edificios ?? 1) * (w - .45)], ["petit", 12 * (C.edificios ?? 1) * (w - .45)]]);
      const phi = Math.atan2(ux[1], ux[0]);   // local x -> ux ; local -y -> hacia la calle
      return { id, q, o, ux, nOut, fw, ld, seg: s, side, w, kind, phi, seed: (r() * 1e9) | 0,
        vereda: w < .3 ? pickW(r, [["tierra", 4], ["cem", 2], ["vain_d", 1.5], ["pasto", 3]]) : pickW(r, [["vain", 5], ["vain_d", 1.6], ["gris", 2.5], ["cem", 2.5], ["roja", 1], ["tierra", w < .5 ? .6 : 0]]),
        patio: kind === "baldio" ? "yuyo" : w < .3 ? pickW(r, [["tierra", 4], ["pasto", 2], ["cem", 3]]) : w < .65 ? pickW(r, [["pasto", 2.5], ["cem", 3.5], ["roja", 3]]) : pickW(r, [["pasto", 5], ["cem", 1.5], ["roja", 2]]) };
    }
    // relleno denso de villas: casillas pegadas mirando al pasillo/calle más cercano
    for (const d of villaBlocks) {
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
    // barrio real: segunda pasada, casillas más chicas en los huecos que quedaron (la 1-11-14 está pegada casa con casa)
    if (RM) for (const d of villaBlocks) {
      const xs = d.poly.map(p => p[0]), ys = d.poly.map(p => p[1]);
      for (let y = Math.min(...ys); y < Math.max(...ys); y += 2.4) for (let x = Math.min(...xs); x < Math.max(...xs); x += 2.4) {
        const p = [x + r.uni(-.8, .8), y + r.uni(-.8, .8)];
        if (inside(d.poly, p) < 1.5 || !free(p[0], p[1])) continue;
        let best = null, bd = 1e9; for (const s of near(p[0], p[1])) { const q = segDist(s, p[0], p[1]); if (q.d < bd) { bd = q.d; best = { s, q }; } }
        if (!best) continue;
        const s = best.s, side = best.q.ds >= 0 ? 1 : -1, nOut = [s.n[0] * side, s.n[1] * side];
        const rot = r.uni(-.15, .15), ux0 = [nOut[1], -nOut[0]];
        const ux = [ux0[0] * Math.cos(rot) - ux0[1] * Math.sin(rot), ux0[0] * Math.sin(rot) + ux0[1] * Math.cos(rot)], nO = [-ux[1], ux[0]];
        for (const [fw, ld] of [[r.uni(3.2, 4.2), r.uni(3.6, 4.6)], [3, 3.4]]) {
          const o = [p[0] - ux[0] * fw / 2 - nO[0] * .8, p[1] - ux[1] * fw / 2 - nO[1] * .8], q = quadPts(o, ux, nO, fw, ld);
          if (!quadFree(q)) continue;
          const id = lots.length, lot = makeLot(id, q, o, ux, nO, fw, ld, s, side, 10, wealthAt(p[0], p[1]), true, r);
          lot.inner = true; lot.kind = "villa"; lots.push(lot); stamp(q, id); break; }
      }
    }
    const lotAt = (x, y) => { const gx = (x * LR) | 0, gy = (y * LR) | 0; if (gx < 0 || gy < 0 || gx >= LW || gy >= LH) return null; const i = lotGrid[gy * LW + gx]; return i >= 0 ? lots[i] : null; };
    return { MW, MH, MG, dentro, segs, lots, districts, inters, classify, classifyInto, lotAt, wealthAt, near, raw, plazas, villaAt, zona, real: RM ? RM.nombre : null, inicio: RM ? RM.inicio : null };
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
        // los pasillos de las villas no cuentan: pueden llegar a la calle tan seguido como quieran
        const calles = (n) => [...nodes[n].e].filter(x => edges[x].type !== "pasillo").length;
        if (l >= 14 || e.type === "pasillo" || calles(e.n0) < 3 || calles(e.n1) < 3) continue;
        const arms = [...nodes[e.n0].e, ...nodes[e.n1].e].filter(x => x !== id && edges[x].type !== "pasillo");
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
  // distancia al borde del polígono (cualquiera, no hace falta que sea convexo): positiva adentro, negativa afuera
  function inside(poly, p) { let m = Infinity, c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) c = !c;
      const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2));
      const dx = p[0] - a[0] - ex * t, dy = p[1] - a[1] - ey * t; m = Math.min(m, dx * dx + dy * dy); }
    m = Math.sqrt(m); return c ? m : -m; }
  // rectángulo que mejor encierra al polígono (el de menor área con un lado paralelo a alguno de sus lados)
  function obb(poly) { let best = null;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .5) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], v = [-u[1], u[0]]; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of poly) { const pu = q[0] * u[0] + q[1] * u[1], pv = q[0] * v[0] + q[1] * v[1]; u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv); }
      const A = (u1 - u0) * (v1 - v0); if (!best || A < best.A) best = { A, u, v, u0, u1, v0, v1 }; }
    let { u, v, u0, u1, v0, v1 } = best; if (u1 - u0 < v1 - v0) { [u, v] = [v, [-u[0], -u[1]]]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; }   // u: el lado largo
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    return { c: [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv], u, v, bA: u1 - u0, bB: v1 - v0 }; }

  // ---------- barrio real: zonas (villa, complejos), riqueza y calles a partir de REAL (herramientas/osm_real.py)
  function real(RM, MW, MH, n1, n2, WG, HG) {
    const Z = new Uint8Array(MW * MH);   // zona de cada metro: 0 ciudad, 1 villa, 2 complejo de viviendas
    const fill = (poly, code) => { let y0 = Infinity, y1 = -Infinity; for (const p of poly) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(MH - 1, Math.ceil(y1)); y++) { const cy = y + .5, xs = [];
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > cy) !== (b[1] > cy)) xs.push(a[0] + (b[0] - a[0]) * (cy - a[1]) / (b[1] - a[1])); }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - .5)); x <= Math.min(MW - 1, Math.floor(xs[k + 1] - .5)); x++) if (code === 1 || !Z[y * MW + x]) Z[y * MW + x] = code; } };
    for (const c of RM.complejos) fill(c.p, 2);
    for (const v of RM.villas) if (!v.contorno) fill(v.p, 1);
    const zona = (x, y) => { const gx = x | 0, gy = y | 0; return gx < 0 || gy < 0 || gx >= MW || gy >= MH ? 0 : Z[gy * MW + gx]; };
    // Bajo Flores: barrio de trabajadores (casas, PH, comercios); la villa, pobre; los complejos (Rivadavia I), en el medio
    const wealthAt = (x, y) => { const gx = Math.max(0, Math.min(WG - 1, (x / 10) | 0)), gy = Math.max(0, Math.min(HG - 1, (y / 10) | 0)), k = gy * WG + gx, z = zona(x, y);
      if (z === 1) return Math.max(0, Math.min(.2, .08 + (n2[k] - .5) * .2));
      if (z === 2) return .32 + (n2[k] - .5) * .1;
      return Math.max(.3, Math.min(.68, .47 + (n1[k] - .5) * .3 + (n2[k] - .5) * .12)); };
    const villaAt = (x, y) => zona(x, y) === 1;
    const villaBlocks = RM.villas.filter(v => !v.contorno).map((v, i) => ({ i, p: centroid(v.p), poly: v.p, w: .08, type: "villa", villa: i, theta: 0, bA: 0, bB: 0, nombre: v.n }));
    const districts = villaBlocks.concat(RM.complejos.map((c, i) => ({ i: villaBlocks.length + i, p: centroid(c.p), poly: c.p, w: .32, type: "complejo", theta: 0, bA: 0, bB: 0, nombre: c.n })));
    const TIPOS = ["ave", "calle", "pasaje", "pasillo"];
    const red = RM.segs.map(s => ({ a: [s[0], s[1]], b: [s[2], s[3]], type: TIPOS[s[4]], d: null, nombre: s[5] >= 0 ? RM.nombres[s[5]] : "", hwR: s[6], medR: s[7],
      tierra: !!(s[8] & 1), ancha: !!(s[8] & 2), bulevar: !!(s[8] & 4), real: true }));
    return { wealthAt, villaBlocks, villaAt, districts, red, zona };
  }
  function segDist(s, x, y) { const px = x - s.a[0], py = y - s.a[1]; let t = px * s.dir[0] + py * s.dir[1]; const tc = Math.max(0, Math.min(s.len, t));
    const cx = s.a[0] + s.dir[0] * tc, cy = s.a[1] + s.dir[1] * tc, dx = x - cx, dy = y - cy; return { d: Math.hypot(dx, dy), t, ds: px * s.n[0] + py * s.n[1] }; }
  function segInter(s, o) { const d = s.dir[0] * o.dir[1] - s.dir[1] * o.dir[0]; if (Math.abs(d) < 1e-6) return null;
    const ax = o.a[0] - s.a[0], ay = o.a[1] - s.a[1], t = (ax * o.dir[1] - ay * o.dir[0]) / d, u = (ax * s.dir[1] - ay * s.dir[0]) / d;
    if (t < -1 || t > s.len + 1 || u < -1 || u > o.len + 1) return null; return [s.a[0] + s.dir[0] * t, s.a[1] + s.dir[1] * t]; }
  function polyArea(q) { let a = 0; for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p[0] * n[1] - n[0] * p[1]; } return a / 2; }
  function centroid(q) { let x = 0, y = 0; for (const p of q) { x += p[0]; y += p[1]; } return [x / q.length, y / q.length]; }
  // recorta el segmento a–b al polígono convexo (mismo sentido que el mapa); null si queda afuera o muy corto
  function clipSeg(poly, a, b) { const d = [b[0] - a[0], b[1] - a[1]]; let t0 = 0, t1 = 1;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], n = [q[1] - p[1], -(q[0] - p[0])];
      const num = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1], den = d[0] * n[0] + d[1] * n[1];
      if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; } const t = num / den; if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); }
    if ((t1 - t0) * Math.hypot(d[0], d[1]) < 1) return null; return [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]]; }
  function inQuad(q, x, y) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c > 0) s |= 1; else if (c < 0) s |= 2; } return s !== 3; }
  return { generate, segDist, pickW, ANG, angIdx, snapAng };
})();
