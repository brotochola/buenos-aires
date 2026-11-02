// ===================== bake.js — horneado offline para la escena de WeedJS =====================
// Corre en un navegador (Playwright) con config/r3d/houses/world/ground/people cargados.
// Genera el barrio con ángulos cuantizados a 15°, un catálogo de casas/tapiales/postes compartidas entre lotes,
// las posiciones de todo en coordenadas de mundo de WeedJS (= píxeles de la proyección oblicua a 18 px/m),
// los datos del piso para el shader de GPU y los flowfields estáticos.
window.bake = (opts) => {
  const t0 = performance.now();
  const SEED = opts.seed;
  CFG.v.mapW = opts.mapW; CFG.v.mapH = opts.mapH; CFG.v.cuantizar = 15;
  R3.setLight(CFG.v);
  const W = World.generate(SEED); Ground.init(SEED);
  const MW = W.MW, MH = W.MH, SF = R3.SF, K = R3.K, SYN = R3.SYN, CZ = R3.CZ;
  const Q = Math.PI / 12, qa = (a) => Math.round(a / Q) * Q, aIdx = (a) => ((Math.round(a / Q) % 24) + 24) % 24;
  const PW = (x, y, z = 0) => [(x + K * y) * SF, (MH - y) * SYN * SF - z * CZ * SF];
  const WW = Math.ceil((MW + K * MH) * SF), WH = Math.ceil(MH * SYN * SF);
  const r = R3.rng(SEED ^ 0x5bd1e995), C = CFG.v;
  const F = opts.frames;                                    // frames del atlas v4 (props, sombras, colectivo)
  const round1 = (v) => Math.round(v * 10) / 10;
  const TOL_FRANJA = opts.tolFranja || 8;                   // px: cuánto puede variar la base de la pared dentro de una franja

  // ---------- ocupación (nada se pisa)
  const occ = new Set(), OC = .4;
  function claim(x, y, rad) { const keys = []; for (let i = Math.floor((x - rad) / OC); i <= Math.floor((x + rad) / OC); i++) for (let j = Math.floor((y - rad) / OC); j <= Math.floor((y + rad) / OC); j++) {
      const cx = (i + .5) * OC, cy = (j + .5) * OC; if ((cx - x) ** 2 + (cy - y) ** 2 <= (rad + OC * .5) ** 2) { const k = i * 100000 + j; if (occ.has(k)) return false; keys.push(k); } }
    keys.forEach(k => occ.add(k)); return true; }
  const RAD = [["utree_", .4], ["u_farol", .2], ["u_semaforo", .18], ["u_cono", .14], ["u_valla", .45], ["u_contenedor", .8], ["u_campana", .5], ["u_tablero", .35], ["u_caja", .3],
    ["u_refugio", 1.2], ["canasto", .35], ["cartel", .2], ["pizarra", .3], ["obra_material", .7], ["bolsas", .35], ["parrilla", .7], ["pileta", 1.4]];
  const COLR = [["utree_", .28], ["u_farol", .14], ["u_semaforo", .12], ["cartel", .07], ["canasto", .08], ["u_contenedor", .75], ["u_campana", .55],
    ["u_refugio", .9], ["u_valla", .35], ["obra_material", .5], ["parrilla", .55], ["pileta", 1.3], ["u_tablero", .3], ["u_caja", .25]];
  const lookup = (tbl, n, d) => { for (const [p, v] of tbl) if (n.startsWith(p)) return v; return d; };
  const SH = (n) => n.startsWith("utree_") ? "sh_tree" : n.startsWith("u_farol") ? "sh_pole" : n.startsWith("u_contenedor") || n.startsWith("canasto") || n.startsWith("u_campana") ? "sh_small" : null;
  const PXM = 13.5;                                           // px por metro "promedio" para la física en pantalla (18 en x, 9 en y)

  // ---------- catálogo de objetos 3D (casas, tapiales, postes) compartidos por clave
  const cat = new Map(), objs = [];
  function catKey(spec) { return JSON.stringify(spec); }
  function want(spec) { const k = catKey(spec); let e = cat.get(k); if (!e) { e = { spec, n: 0, id: cat.size }; cat.set(k, e); } e.n++; return e; }
  const Wb = (w, step) => Math.max(3, Math.floor(w / step + 1e-6) * step);
  const Db = (d, deep) => deep ? (d < 6 ? 5 : d < 8 ? 7 : d < 10 ? 9 : 11) : d;

  // ---------- registros de salida
  const props = [], cars = [], people = [], cables = [], houses = [];
  function put(name, x, y, opt = {}) {
    if (!F[name]) return null;
    if (!opt.noClaim && !claim(x, y, opt.rad ?? lookup(RAD, name, .3))) return null;
    const [px, py] = PW(x, y), cr = opt.noCollide ? 0 : lookup(COLR, name, 0), sh = opt.shadow ?? SH(name);
    const e = { f: name, x: round1(px), y: round1(py), fl: opt.flip ? 1 : 0, r: round1(cr * PXM), sh: sh && F[sh] ? sh : null };
    props.push(e); return e;
  }
  const person = (x, y, stay) => { const [px, py] = PW(x, y); people.push([round1(px), round1(py), stay ? 1 : 0]); };
  const at = (s, t, off) => [s.a[0] + s.dir[0] * t + s.n[0] * off, s.a[1] + s.dir[1] * t + s.n[1] * off];

  // casa/tapial: guarda la instancia; la posición final se calcula al conocer el ancla del sprite
  // lot/u0/uw/v0: franja del lote donde va (para recentrar si el catálogo le asigna otro ancho)
  function addObj(kind, spec, lot, x0, y0, phiQ, place, collider) { const e = want(spec); objs.push({ kind, e, x0, y0, phiQ, place, collider, lot }); }

  // ---------- casas y tapiales
  for (const lot of W.lots) {
    const phiQ = qa(lot.phi), ux = [Math.cos(lot.phi), Math.sin(lot.phi)];
    const LP = (u, v) => [lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v, lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v];
    const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => LP(u, v));
    if (lot.kind === "baldio") {
      if (lot.seg.type !== "pasillo") { const tk = r.pick(["tapia", "ladrillo", "alambre", "alambre"]), wq = Wb(lot.fw, 2);
        const o = LP((lot.fw - wq) / 2, 0); addObj("tapial", { t: "tapial", tk, W: wq, a: aIdx(lot.phi), s: 0 }, lot, o[0], o[1], phiQ, null, rect(0, lot.fw, 0, .25)); }
      const c = LP(lot.fw / 2, lot.ld / 2);
      if (r() < .5 * C.arboles) put(r.pick(["utree_a", "utree_b", "utree_c", "utree_d"]), c[0], c[1], { flip: r() < .5 });
      if (r() < .5) put("bolsas_" + r.int(0, 1), c[0] + r.uni(-2, 2), c[1] + r.uni(-2, 2));
      continue;
    }
    const deep = ["casa", "casa2", "obra", "negocio", "negocio_casa", "ph"].includes(lot.kind);
    let D = lot.kind === "chalet" ? 4.6 : lot.kind === "villa" ? Math.min(lot.ld - .4, r.uni(3.6, 5.5)) : deep ? Math.max(4.2, Math.min(lot.ld - 2.5, r.uni(6, 12))) : lot.kind === "galpon" ? Math.min(lot.ld - 1, r.uni(8, 14)) : 5;
    D = lot.kind === "villa" ? (D < 4.5 ? 4 : 5) : lot.kind === "galpon" ? (D < 11 ? 9 : 12) : Db(D, deep);
    const depthTot = (lot.kind === "chalet" ? 2.6 : 0) + D, step = lot.kind === "villa" ? 1.5 : 2, wq = Math.min(lot.fw, Wb(lot.fw, step));
    const wb = lot.w < .45 ? 0 : 1, o = LP((lot.fw - wq) / 2, 0);
    addObj("house", { t: "casa", k: lot.kind, W: wq, D, a: aIdx(lot.phi), wb, v: 0 }, lot, o[0], o[1], phiQ, { u0: 0, uw: lot.fw, v0: 0 }, rect(0, lot.fw, 0, depthTot));
    const occRect = (u0, u1, v0, v1) => { for (let u = u0; u < u1; u += .4) for (let v = v0; v < v1; v += .4) { const [x, y] = LP(u, v); occ.add(Math.floor(x / OC) * 100000 + Math.floor(y / OC)); } };
    occRect(.2, lot.fw, -.6, depthTot + 1.5);
    let backV = 0;
    const pBack = (lot.w < .3 ? .65 : lot.w < .55 ? .4 : .12) * C.fondoConstr;
    if (lot.kind !== "villa" && lot.ld - depthTot > 8 && r() < pBack) {
      const bw = Wb(Math.min(lot.fw, r.uni(4, lot.fw)), 2), bu = r() < .5 ? 0 : lot.fw - bw, bd = Math.min(lot.ld - depthTot - 4, r.uni(3.8, 5.5)) < 4.6 ? 4 : 5, bv = lot.ld - bd - .3;
      const k2 = r.pick(lot.w < .3 ? ["obra", "villa", "casa"] : ["casa", "casa", "obra"]), [bx, by] = LP(bu, bv);
      addObj("house", { t: "casa", k: k2, W: bw, D: bd, a: aIdx(lot.phi), wb: Math.min(1, wb), v: 0 }, lot, bx, by, phiQ, { u0: bu, uw: bw, v0: bv }, rect(bu, bu + bw, bv, bv + bd));
      occRect(bu, bu + bw, bv - .6, bv + bd + .5); backV = bv;
    }
    if ((backV || lot.ld) - depthTot > 3.5) { const pp = () => LP(r.uni(.8, lot.fw - .8), r.uni(depthTot + 2.2, (backV || lot.ld) - .8));
      if (r() < .3 * C.arboles) put(r.pick(["utree_a", "utree_b", "utree_c", "utree_jaca", "utree_naranja"]), ...pp(), { flip: r() < .5 });
      if (r() < .2) put("parrilla", ...pp()); if (lot.w > .3 && r() < .1) put("pileta", ...pp()); if (r() < .08 * C.gente) { const p = pp(); person(p[0], p[1], true); } }
    const s = lot.seg, side = lot.side, mid = (lot.o[0] - s.a[0]) * s.dir[0] + (lot.o[1] - s.a[1]) * s.dir[1] + (side === 1 ? lot.fw / 2 : -lot.fw / 2);
    if (s.sw > 1) {
      const near = (dd) => at(s, mid + r.uni(-lot.fw / 3, lot.fw / 3), side * (s.hw + s.sw - dd));
      if ((lot.kind === "negocio" || lot.kind === "negocio_casa") && r() < .6) put("pizarra_" + r.int(0, 2), ...near(.9));
      if (lot.kind === "obra" && r() < .5) put("obra_material", ...near(1.1));
      if (r() < (lot.w < .3 ? .05 : .14)) put("canasto_" + r.int(0, 2), ...near(.45));
      if (r() < .04) put(r.pick(["u_tablero", "u_caja_bsas"]), ...near(.4));
    }
  }
  // ---------- veredas: árboles, gente, faroles, postes con cables
  for (const s of W.segs) {
    if (s.type === "pasillo") { for (let t = r.uni(2, 8); t < s.len; t += r.uni(6, 14)) if (r() < .12 * C.gente) { const p = at(s, t, r.uni(-.4, .4)); person(p[0], p[1], false); } continue; }
    const crossNear = (t) => s.cross.some(c => Math.abs(t - c) < 3);
    for (const side of [1, -1]) {
      if (s.sw >= 2.2) for (let t = r.uni(3, 9); t < s.len - 3; t += r.uni(7, 13)) {
        if (crossNear(t) || r() > (.3 + .55 * s.w) * C.arboles) continue; const p = at(s, t, side * (s.hw + (s.cantero ? .6 : .55)));
        const c = W.classify(p[0], p[1]); if (c && c.k === "walk" && c.s === s) put(r.pick(["utree_a", "utree_b", "utree_c", "utree_d", "utree_jaca", "utree_naranja"]), p[0], p[1], { flip: r() < .5 }); }
      if (s.sw > 1 && r() < .7) for (let t = r.uni(2, 10); t < s.len; t += r.uni(4, 12)) if (r() < (.2 + .25 * (s.type === "ave")) * C.gente) { const p = at(s, t, side * (s.hw + r.uni(.4, s.sw - .3))); const c = W.classify(p[0], p[1]); if (c && c.k === "walk") person(p[0], p[1], false); }
    }
    if (s.mat !== "tierra") for (let t = r.uni(5, 20), k = 0; t < s.len - 3; t += r.uni(26, 34), k++) {
      if (crossNear(t)) continue; const side = k % 2 ? 1 : -1, p = at(s, t, side * (s.hw + .35)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk") continue;
      const q = at(s, t, 0), sp = PW(...p), sc = PW(...q); put(s.type === "ave" || s.w > .55 ? "u_farol_doble" : "u_farola", p[0], p[1], { flip: sc[0] < sp[0] }); }
    if (s.type !== "ave" && s.sw > 1) {
      const side = r() < .5 ? 1 : -1, phi = Math.atan2(s.dir[1], s.dir[0]), phiQ = qa(phi), luz = s.mat !== "asf" ? 1 : 0, pts = [];
      for (let t = r.uni(3, 10); t < s.len - 2; t += r.uni(24, 32)) {
        const p = at(s, t, side * (s.hw + .3)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk" || !claim(p[0], p[1], .25)) continue;
        addObj("poste", { t: "poste", a: aIdx(phi), l: luz }, null, p[0], p[1], phiQ, null, null);
        pts.push([[0, -.76, 8.18], [0, .09, 8.18], [0, .79, 8.18]].map(([lx, ly, lz]) => [p[0] + Math.cos(phiQ) * lx - Math.sin(phiQ) * ly, p[1] + Math.sin(phiQ) * lx + Math.cos(phiQ) * ly, lz]));
      }
      // cables: curvas en 3D partidas en tramos rectos (cada tramo será un sprite fino)
      const curve = (a, b, sag, n) => { let prev = PW(a[0], a[1], a[2]); for (let i = 1; i <= n; i++) { const t = i / n, z = a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t);
        const q = PW(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z); cables.push([round1(prev[0]), round1(prev[1]), round1(q[0]), round1(q[1])]); prev = q; } };
      for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < 3; k++) curve(pts[i][k], pts[i + 1][k], .9 + k * .17, 6);
      for (const cp of pts) if (r() < .7) { const a = cp[2], sd = side * r.uni(2, 4.5), al = r.uni(-3, 3); curve(a, [a[0] + s.n[0] * sd + s.dir[0] * al, a[1] + s.n[1] * sd + s.dir[1] * al, r.uni(2.6, 3.6)], .35, 4); }
    }
  }
  // ---------- esquinas
  for (const it of W.inters) {
    const { s, o, p } = it; if (s.type === "pasillo" || o.type === "pasillo") continue;
    const cands = []; for (const a of [1, -1]) for (const b of [1, -1]) cands.push([p[0] + s.dir[0] * a * (o.hw + o.sw * .5) + s.n[0] * b * (s.hw + s.sw * .5), p[1] + s.dir[1] * a * (o.hw + o.sw * .5) + s.n[1] * b * (s.hw + s.sw * .5)]);
    const ok = cands.filter(q => { const c = W.classify(q[0], q[1]); return c && c.k === "walk"; });
    if (ok.length) put("cartel", ...ok[0]);
    if ((s.type === "ave" || o.type === "ave" || (s.mat === "asf" && o.mat === "asf" && s.w > .45)) && ok.length > 1) { put("u_semaforo", ...ok[1]); if (ok[2]) put("u_semaforo", ...ok[2]); }
    if (s.mat !== "tierra" && r() < .25 && ok[3]) put("u_campana", ...ok[3]);
  }
  // ---------- vehículos: rumbo en pantalla (y hacia abajo); el cuadro del sprite se elige "desaplastando" la y
  const COLORS = [["red", 1.6], ["white", 1.6], ["black", 1.4], ["blue", 1.4], ["yellow", 1], ["poli", .4]];
  const scrRot = (hd) => Math.atan2(-SYN * Math.sin(hd), Math.cos(hd) + K * Math.sin(hd));
  for (const s of W.segs) {
    if (s.type === "pasillo") continue;
    const lanes = [], park = parkOff(s);
    if (s.type !== "pasaje") for (const side of [1, -1]) lanes.push({ off: side * park, hd: r() < .5 ? 0 : Math.PI, p: (s.mat === "tierra" ? .06 : s.type === "ave" ? .14 : .13) * C.estacionados });
    if (s.type !== "pasaje") { const lane = laneOff(s); lanes.push({ off: -lane, hd: 0, p: .03 * C.transito, moving: true }); lanes.push({ off: lane, hd: Math.PI, p: .03 * C.transito, moving: true }); }
    const base = Math.atan2(s.dir[1], s.dir[0]);
    for (const ln of lanes) for (let t = r.uni(2, 8); t < s.len - 5;) {
      if (r() > ln.p) { t += 3; continue; }
      const hd = base + ln.hd, p = at(s, t, ln.off), c = W.classify(p[0], p[1]);
      if (!c || c.k !== "road" || c.s !== s || s.cross.some(x => Math.abs(t - x) < 4)) { t += 2; continue; }
      if (!ln.moving && s.mat !== "tierra" && s.w > .3 && r() < .08) { put("u_contenedor", ...p, { flip: r() < .5 }); t += 4; continue; }
      const len = 4.6, ok = [-.45, -.2, 0, .2, .45].every(k => !occ.has(Math.floor((p[0] + Math.cos(hd) * len * k) / OC) * 100000 + Math.floor((p[1] + Math.sin(hd) * len * k) / OC)));
      if (ok) { [-.45, -.2, 0, .2, .45].forEach(k => claim(p[0] + Math.cos(hd) * len * k, p[1] + Math.sin(hd) * len * k, 1.0));
        const [px, py] = PW(p[0], p[1]), wreck = !ln.moving && s.w < .32 && r() < .07;
        cars.push({ c: wreck ? "burnt" : (() => { let t2 = COLORS.reduce((a, b) => a + b[1], 0) * r(); for (const [n, w] of COLORS) { t2 -= w; if (t2 <= 0) return n; } return "red"; })(),
          x: round1(px), y: round1(py), rot: Math.round(scrRot(hd) * 1000) / 1000, m: ln.moving ? 1 : 0 }); }
      t += len + r.uni(1, 6);
    }
    if (s.mat === "roto") for (let t = r.uni(5, 30); t < s.len - 5; t += r.uni(25, 60)) if (r() < .5) { const p = at(s, t, r.uni(-s.hw * .5, s.hw * .5)); if (put("u_valla", ...p)) { put("u_cono", p[0] + 1, p[1] - .6); put("u_cono", p[0] - 1, p[1] - .6); } }
  }

  // ---------- grillas de costo en metros (igual que crowd.js / Traffic) -> flowfields estáticos en píxeles de pantalla
  const GW = Math.ceil(MW), GH = Math.ceil(MH);
  const COST = { vereda: 10, pasillo: 11, senda: 13, esquina: 40, tierra: 90, calle: 220, cantero: 30 };
  const cost = new Uint8Array(GW * GH);
  for (const s of W.segs) { if (s.sw <= 0) continue; const R = s.hw + s.sw;
    const x0 = Math.max(0, Math.floor(Math.min(s.a[0], s.b[0]) - R)), x1 = Math.min(GW - 1, Math.ceil(Math.max(s.a[0], s.b[0]) + R)), y0 = Math.max(0, Math.floor(Math.min(s.a[1], s.b[1]) - R)), y1 = Math.min(GH - 1, Math.ceil(Math.max(s.a[1], s.b[1]) + R));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const q = World.segDist(s, x + .5, y + .5); if (q.d >= s.hw && q.d < R) cost[y * GW + x] = COST.vereda; } }
  const road = new Uint8Array(GW * GH);
  rasterRoads(W, GW, GH, (i, s, q) => { let c;
    if (s.mat === "pasillo") c = COST.pasillo; else if (s.type === "ave" && Math.abs(q.ds) < s.med) c = COST.cantero; else if (s.cross.some(t => Math.abs(q.t - t) < 1.6)) c = COST.senda; else if (s.mat === "tierra") c = COST.tierra; else c = COST.calle;
    road[i] = road[i] ? Math.min(road[i], c) : c; });
  for (const it of W.inters) { if (it.s.type === "pasillo" || it.o.type === "pasillo") continue; const R = Math.max(it.s.hw, it.o.hw) + 3;
    for (let y = Math.floor(it.p[1] - R); y <= it.p[1] + R; y++) for (let x = Math.floor(it.p[0] - R); x <= it.p[0] + R; x++) { if (x < 0 || y < 0 || x >= GW || y >= GH) continue; const i = y * GW + x;
      if (road[i] > COST.esquina && Math.hypot(x + .5 - it.p[0], y + .5 - it.p[1]) < R) road[i] = COST.esquina; } }
  for (let i = 0; i < road.length; i++) if (road[i]) cost[i] = road[i];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (cost[y * GW + x] && W.lotAt(x + .5, y + .5)) cost[y * GW + x] = 0;
  const fg = FlowGrid(GW, GH, cost, COST.calle);
  { const rp = R3.rng(SEED ^ 0x51ED270B); let tries = 0, n = people.length;
    while (n < opts.people && tries++ < opts.people * 60) { const x = rp.uni(1, GW - 1), y = rp.uni(1, GH - 1), c0 = cost[(y | 0) * GW + (x | 0)];
      if (c0 !== COST.vereda && c0 !== COST.pasillo) continue; let w = c0 === COST.pasillo ? 2.6 : 1;
      const k = W.classify(x, y); if (k && k.s.type === "ave") w = 3.2; else if (k && k.s.type === "pasaje") w = .8;
      w *= 1.5 - W.wealthAt(x, y) * .8; if (rp() * 4 > w) continue; if (!claim(x, y, .3)) continue; person(x, y, false); n++; } }
  const targets = fg.pickTargets(opts.pedTargets, R3.rng(SEED ^ 0x2545F491), (c) => c === COST.vereda);
  for (const f of targets.slice()) fg.compute(f);
  const CELL = opts.cell, FW = Math.ceil(WW / CELL), FH = Math.ceil(WH / CELL);
  const unPW = (X, Y) => { const y = MH - Y / (SYN * SF); return [X / SF - K * y, y]; };
  const toScr = (dx, dy) => { const sx = dx + K * dy, sy = -SYN * dy, l = Math.hypot(sx, sy) || 1; return [Math.round(sx / l * 100) / 100, Math.round(sy / l * 100) / 100]; };
  const ffJson = (name, fn) => { const data = []; for (let j = 0; j < FH; j++) { const row = []; for (let i = 0; i < FW; i++) row.push(fn(...unPW((i + .5) * CELL, (j + .5) * CELL))); data.push(row); }
    return JSON.stringify({ name, metadata: { widthCells: FW, heightCells: FH, widthPx: FW * CELL, heightPx: FH * CELL, cellSizePx: CELL }, data }); };
  const flow = {};
  targets.forEach((tg, f) => { flow["peaton" + f] = ffJson("peaton" + f, (x, y) => { const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= GW || yi >= GH || !cost[yi * GW + xi]) return null;
    const q = fg.dir(f, x, y); if (!q || q.arrived) return null; return toScr(q.x, q.y); }); });
  // autos: cada celda de calzada apunta a lo largo de su carril (mano derecha) y tira hacia el centro del carril
  const cl = { k: 0, s: null, d: 0, t: 0, ds: 0 };
  flow.calles = ffJson("calles", (x, y) => { if (x < 0 || y < 0 || x > MW || y > MH) return null; W.classifyInto(x, y, cl); if (cl.k !== 1) return null; const s = cl.s;
    if (s.mat === "pasillo" || (s.type === "ave" && Math.abs(cl.ds) < s.med + .2)) return null;
    const fwd = cl.ds < 0 ? 1 : -1, lane = laneOff(s), off = cl.ds - (-fwd * lane), pull = Math.max(-.6, Math.min(.6, -off * .35));
    const dx = s.dir[0] * fwd + s.n[0] * pull, dy = s.dir[1] * fwd + s.n[1] * pull; return toScr(dx, dy); });

  // ---------- datos del piso para el shader (celdas de 0,5 m)
  const GC = .5, CW = Math.ceil(MW / GC), CHh = Math.ceil(MH / GC);
  const cellA = new Uint8Array(CW * CHh * 4), cellB = new Uint8Array(CW * CHh * 4);
  const TYPE = { ave: 0, calle: 1, pasaje: 2, pasillo: 3 }, MAT = { asf: 0, roto: 1, tierra: 2, pasillo: 3 };
  const VER = { tierra: 1, vain: 2, gris: 3, roja: 3, cem: 4, pasto: 5 }, PAT = { pasto: 1, tierra: 2, yuyo: 3, roja: 4, cem: 5 };
  // tabla de calles en RGBA8 (la subida de texturas float de WeedJS en WebGL no anda): 24 valores de 16 bits por calle, 12 texels
  const NS = W.segs.length, segs = new Uint8Array(NS * 12 * 4);
  const ENC = { pos: [20, 100], unit: [1, 32767.5], len: [0, 100], w: [0, 1000], int: [0, 1] };
  W.segs.forEach((s, k) => { s._gid = k; const cr = s.cross.slice(0, 8); while (cr.length < 8) cr.push(null);
    const vals = [[s.a[0], "pos"], [s.a[1], "pos"], [s.dir[0], "unit"], [s.dir[1], "unit"], [s.n[0], "unit"], [s.n[1], "unit"], [s.len, "len"], [s.hw, "w"], [Math.max(0, s.sw), "w"], [s.med || 0, "w"],
      [s.cls, "int"], [s.w, "w"], [TYPE[s.type], "int"], [MAT[s.mat], "int"], [s.cantero ? 1 : 0, "int"], [0, "int"], ...cr.map(t => [t, "pos"])];
    vals.forEach(([v, e], m) => { const [off, sc] = ENC[e]; const q = v == null ? 65535 : Math.max(0, Math.min(65534, Math.round((v + off) * sc))); segs[k * 48 + m * 2] = q & 255; segs[k * 48 + m * 2 + 1] = q >> 8; }); });
  for (let j = 0; j < CHh; j++) for (let i = 0; i < CW; i++) {
    const x = (i + .5) * GC, y = (j + .5) * GC, o = (j * CW + i) * 4;
    const gx = Math.floor(x / 20), gy = Math.floor(y / 20); const cand = [];
    for (const s of W.near(x, y)) { const q = World.segDist(s, x, y); if (q.d < s.hw + Math.max(0, s.sw) + .8) cand.push([q.d < s.hw + .4 ? 0 : 1, -s.cls, q.d, s]); }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const id = (k) => cand[k] ? cand[k][3]._gid + 1 : 0;
    const a = id(0), b = id(1), c = id(2);
    cellA[o] = a & 255; cellA[o + 1] = a >> 8; cellA[o + 2] = b & 255; cellA[o + 3] = b >> 8; cellB[o] = c & 255; cellB[o + 1] = c >> 8;
    W.classifyInto(x, y, cl);
    if (cl.k === 2) { const sgn = cl.ds >= 0 ? 1 : -1, s = cl.s; let kind = s.w < .3 ? "tierra" : "vain", dmg = s.w < .45;
      for (const e of s.lots[sgn]) if (cl.t >= e.t0 && cl.t < e.t1) { kind = e.lot.vereda; if (kind === "vain_d") { kind = "vain"; dmg = true; } break; }
      cellB[o + 2] = (VER[kind] || 2) | (dmg ? 16 : 0); }
    const lot = W.lotAt(x, y); if (lot) cellB[o + 3] = (PAT[lot.patio] || 5) | (lot.w < .4 ? 16 : 0);
  }
  const WGc = Math.ceil(MW / 10), HGc = Math.ceil(MH / 10), wealth = new Uint8Array(WGc * HGc);
  for (let j = 0; j < HGc; j++) for (let i = 0; i < WGc; i++) wealth[j * WGc + i] = Math.round(W.wealthAt(i * 10 + 5, j * 10 + 5) * 255);
  const N = Ground.N, noise = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < 65536; i++) { noise[i * 4] = Math.round(N.a[i] * 255); noise[i * 4 + 1] = Math.round(N.b[i] * 255); noise[i * 4 + 2] = Math.round(N.c[i] * 255); noise[i * 4 + 3] = Math.round(N.g[i] * 255); }

  // ---------- recorte del catálogo de casas: las claves más usadas; el resto toma la más parecida del mismo ángulo
  { const hs = [...cat.values()].filter(e => e.spec.t === "casa").sort((a, b) => b.n - a.n), keep = new Set(hs.slice(0, opts.houseBudget).map(e => e.id));
    const kept = hs.filter(e => keep.has(e.id));
    for (const o of objs) { if (o.e.spec.t !== "casa" || keep.has(o.e.id)) continue; const sp = o.e.spec; let best = null, bs = 1e9;
      for (const e of kept) { const q = e.spec; if (q.a !== sp.a) continue;
        const sc = (q.k === sp.k ? 0 : (q.k === "villa") !== (sp.k === "villa") ? 50 : 4) + Math.abs(q.W - sp.W) * .6 + (q.W > o.place.uw + .01 ? 30 : 0) + Math.abs(q.D - sp.D) * .4 + (q.wb !== sp.wb ? 1 : 0);
        if (sc < bs) { bs = sc; best = e; } }
      if (!best || bs > 40) { keep.add(o.e.id); kept.push(o.e); continue; }
      o.e.n--; best.n++; o.e = best;
      const lot = o.lot, u = o.place.u0 + (o.place.uw - best.spec.W) / 2, v = o.place.v0; o.x0 = lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v; o.y0 = lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v; }
    for (const [k, e] of [...cat]) if (e.n <= 0) cat.delete(k); }
  // ---------- render del catálogo (R3, misma luz que la versión 3D)
  const entries = [...cat.values()];
  const rendered = [];
  for (const e of entries) {
    const sp = e.spec, phi = sp.a * Q; let built, shadow = true;
    if (sp.t === "casa") built = Houses.build({ kind: sp.k, W: sp.W, D: sp.D, seed: 1000 + sp.v * 7919 + sp.wb * 104729 + sp.a * 31 + Math.round(sp.W * 10) * 17, wealth: [.25, .7][sp.wb] }, phi);
    else if (sp.t === "tapial") built = Houses.tapial(sp.W, 500 + sp.s, sp.tk, phi);
    else { built = Houses.poste(7, phi, !!sp.l); shadow = false; }
    const res = built.sc.render({ groundShadow: false }), cv = res.canvas, g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, crop = document.createElement("canvas"); crop.width = w; crop.height = h; crop.getContext("2d").drawImage(cv, -x0, -y0);
    // cajas que proyectan sombra, en coords locales (para el polígono de sombra de cada instancia)
    const casters = shadow ? built.sc.casters.filter(c => !c.noGround).map(c => ({ c: c.c, ax: c.ax, h: c.h })) : [];
    // pie: la esquina de abajo más "al frente" (menor y del mundo = mayor y de pantalla) de las cajas apoyadas en el piso
    let foot = [0, 0], fy = 1e9;
    for (const cs of built.sc.casters) { const zb = cs.c[2] - cs.h[2]; if (zb > .3) continue;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const px = cs.c[0] + sx * cs.h[0] * cs.ax[0][0] + sy * cs.h[1] * cs.ax[1][0], py = cs.c[1] + sx * cs.h[0] * cs.ax[0][1] + sy * cs.h[1] * cs.ax[1][1];
        if (py < fy - 1e-6) { fy = py; foot = [px, py]; } } }
    // franjas verticales para el ySort: en la proyección oblicua la altura sólo sube en pantalla, así que cada columna
    // del sprite es un pedazo fijo de piso y su profundidad es la base de la pared ahí (el frente de las cajas apoyadas).
    const cax = res.ax - x0, cay = res.ay - y0, base = new Float32Array(w).fill(NaN), top = new Int32Array(w).fill(-1), bot = new Int32Array(w).fill(-1);
    for (const cs of built.sc.casters) { const zb = cs.c[2] - cs.h[2]; if (zb > .3) continue;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const px = cs.c[0] + sx * cs.h[0] * cs.ax[0][0] + sy * cs.h[1] * cs.ax[1][0], py = cs.c[1] + sx * cs.h[0] * cs.ax[0][1] + sy * cs.h[1] * cs.ax[1][1];
        return [cax + (px + K * py) * SF, cay - py * SYN * SF]; });
      for (let c = 0; c < w; c++) { const xc = c + .5; let yb = -Infinity;
        for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) & 3]; if ((xc < a[0]) === (xc < b[0])) continue; yb = Math.max(yb, a[1] + (b[1] - a[1]) * (xc - a[0]) / (b[0] - a[0])); }
        if (yb > -Infinity && !(base[c] >= yb)) base[c] = yb; } }
    for (let c = 0; c < w; c++) for (let y = 0; y < h; y++) if (d[((y + y0) * cv.width + c + x0) * 4 + 3] > 8) { if (top[c] < 0) top[c] = y; bot[c] = y; }
    { let last = NaN; for (let c = 0; c < w; c++) if (isNaN(base[c])) base[c] = last; else last = base[c];       // aleros y voladizos: la columna de al lado
      last = NaN; for (let c = w - 1; c >= 0; c--) if (isNaN(base[c])) base[c] = last; else last = base[c];
      for (let c = 0; c < w; c++) if (isNaN(base[c])) base[c] = h; }
    // Cada franja se corta además en piezas de 64 px de alto: WeedJS recorta las decoraciones por un solo punto, y con piezas
    // chicas ese punto nunca queda lejos de lo que se ve (si no, al hacer zoom las paredes altas desaparecen en el borde).
    // Todo se pisa 1 px con lo vecino: con filtrado lineal y posiciones con decimales, los bordes justos dejan una raya.
    const PIEZA = 64, ANCHO = 64, opaco = (c, y) => d[((y + y0) * cv.width + c + x0) * 4 + 3] > 8;
    const strips = []; let c0 = -1, lo = 0, hi = 0;
    const cerrar = (c1) => { const a = Math.max(0, c0 - 1), z = Math.min(w, c1 + 1); let t = 1e9, b2 = -1;
      for (let c = a; c < z; c++) if (top[c] >= 0) { t = Math.min(t, top[c]); b2 = Math.max(b2, bot[c]); }
      if (b2 >= 0) { const pieces = [];
        for (let r0 = t; r0 <= b2; r0 += PIEZA) { const pa = Math.max(t, r0 - 1), pz = Math.min(b2 + 1, r0 + PIEZA + 1); let any = false;
          for (let y = pa; y < pz && !any; y++) for (let c = a; c < z; c++) if (opaco(c, y)) { any = true; break; }
          if (any) pieces.push({ t: pa, h: pz - pa }); }
        strips.push({ x: a, w: z - a, g: (lo + hi) / 2, pieces }); }
      c0 = -1; };
    for (let c = 0; c <= w; c++) {
      if (c === w || top[c] < 0) { if (c0 >= 0) cerrar(c); continue; }
      if (c0 < 0) { c0 = c; lo = hi = base[c]; continue; }
      const nlo = Math.min(lo, base[c]), nhi = Math.max(hi, base[c]);
      if (nhi - nlo > TOL_FRANJA || c - c0 >= ANCHO) { cerrar(c); c0 = c; lo = hi = base[c]; } else { lo = nlo; hi = nhi; } }
    rendered.push({ e, crop, ax: cax, ay: cay, w, h, casters, area: w * h, foot, strips });
  }
  // ---------- hojas de sprites (estantes, máx. 2048 de ancho, 200 animaciones por hoja)
  const sheets = []; let cur = null;
  const sorted = rendered.slice().sort((a, b) => b.h - a.h);
  for (const it of sorted) {
    if (!cur || cur.items.length >= 200 || cur.y + it.h > 2040) { cur = { items: [], x: 0, y: 0, rowH: 0, W: 2048 }; sheets.push(cur); }
    if (cur.x + it.w + 2 > cur.W) { cur.x = 0; cur.y += cur.rowH + 2; cur.rowH = 0; }
    if (cur.y + it.h > 2040) { cur = { items: [], x: 0, y: 0, rowH: 0, W: 2048 }; sheets.push(cur); }
    it.sx = cur.x; it.sy = cur.y; it.sheet = sheets.length - 1; cur.items.push(it); cur.x += it.w + 2; cur.rowH = Math.max(cur.rowH, it.h);
  }
  const sheetOut = sheets.map((sh, si) => {
    const Hs = sh.y + sh.rowH, cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, Hs); const g = cv.getContext("2d");
    const frames = {}, animations = {};
    for (const it of sh.items) { g.drawImage(it.crop, it.sx, it.sy);
      it.strips.forEach((s, k) => s.pieces.forEach((q, j) => { const nm = "o" + it.e.id + "_" + k + "_" + j;
        frames[nm] = { frame: { x: it.sx + s.x, y: it.sy + q.t, w: s.w, h: q.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: s.w, h: q.h }, sourceSize: { w: s.w, h: q.h } };
        animations[nm] = [nm]; })); }
    return { name: "obj" + si, png: cv.toDataURL("image/png"), json: JSON.stringify({ frames, animations, meta: { image: "obj" + si + ".png", size: { w: 2048, h: cv.height }, scale: 1 } }) };
  });
  const byId = new Map(rendered.map(it => [it.e.id, it]));
  // franjas de cada sprite del catálogo, relativas al pie: [dx (borde izquierdo), dy (base de la pared = y de orden),
  // piezas: [[cx, cy], ...] = centro de cada pieza respecto del borde izquierdo y la base]
  const franjas = {}, r2 = (v) => Math.round(v * 100) / 100;
  for (const it of rendered) { const axF = it.ax + (it.foot[0] + K * it.foot[1]) * SF, ayF = it.ay - it.foot[1] * SYN * SF;
    franjas["o" + it.e.id] = it.strips.map(s => [r2(s.x - axF), r2(s.g - ayF), s.pieces.map(q => [r2(s.w / 2), r2(q.t + q.h / 2 - s.g)])]); }
  // ---------- instancias: posición del pie (esquina más al frente en pantalla) y ancla del sprite
  const SUN = R3.SUN;
  for (const o of objs) {
    const it = byId.get(o.e.id), fdx = it.foot[0], fdy = it.foot[1], foot = [o.x0 + fdx, o.y0 + fdy];
    const [fx, fy] = PW(foot[0], foot[1]);
    const ax = it.ax + (fdx + K * fdy) * SF, ay = it.ay - fdy * SYN * SF;
    const rec = { o: it.sheet, a: "o" + o.e.id, x: round1(fx), y: round1(fy), ax: Math.round(ax / it.w * 10000) / 10000, ay: Math.round(ay / it.h * 10000) / 10000, k: o.kind };
    if (o.collider) rec.col = o.collider.map(([x, y]) => { const q = PW(x, y); return [round1(q[0] - fx), round1(q[1] - fy)]; });
    else rec.r = round1(.15 * PXM);
    // sombra al piso: casco convexo de todas las cajas proyectadas por el sol
    if (it.casters.length) { const pts = [];
      for (const cs of it.casters) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = [0, 1, 2].map(k => cs.c[k] + sx * cs.h[0] * cs.ax[0][k] + sy * cs.h[1] * cs.ax[1][k] + sz * cs.h[2] * cs.ax[2][k]);
        const tt = Math.max(0, p[2]) / Math.max(.05, SUN[2]); const q = PW(o.x0 + p[0] - SUN[0] * tt, o.y0 + p[1] - SUN[1] * tt); pts.push([q[0] - fx, q[1] - fy]); }
      rec.sh = R3.hull(pts).map(([x, y]) => [round1(x), round1(y)]); }
    houses.push(rec);
  }
  // ---------- props: hoja con los cuadros usados del atlas v4 (anclas incluidas)
  const used = new Set(); for (const p of props) { used.add(p.f); if (p.sh) used.add(p.sh); } ["sh_person", "sh_car_h"].forEach(n => used.add(n));
  const pframes = {}, panims = {}, anchors = {};
  for (const n of used) { const f = F[n]; pframes[n] = { frame: { x: f.x, y: f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } }; panims[n] = [n]; anchors[n] = [f.ox / f.w, f.oy / f.h]; }
  const area = rendered.reduce((a, b) => a + b.area, 0);
  return {
    meta: { nFranjas: houses.reduce((a, h) => a + franjas[h.a].length, 0), nPiezas: houses.reduce((a, h) => a + franjas[h.a].reduce((x, s) => x + s[2].length, 0), 0), seed: SEED, MW, MH, WW, WH, SF, K, SYN, CZ, GC, CW, CH: CHh, WG: WGc, HG: HGc, NS, CELL, pedTargets: targets.length, sheets: sheetOut.length, anchors, PXM },
    world: { houses, props, cars, people, cables, franjas }, sheets: sheetOut, props: JSON.stringify({ frames: pframes, animations: panims, meta: { image: "props.png", scale: 1 } }), flow,
    ground: { cellA: b64(cellA), cellB: b64(cellB), wealth: b64(wealth), noise: b64(noise), segs: b64(segs) },
    stats: { franjas: rendered.reduce((a, b) => a + b.strips.length, 0), piezas: rendered.reduce((a, b) => a + b.strips.reduce((x, s) => x + s.pieces.length, 0), 0), byType: entries.reduce((m, e) => (m[e.spec.t] = (m[e.spec.t] || 0) + 1, m), {}), areaByType: rendered.reduce((m, it) => (m[it.e.spec.t] = (m[it.e.spec.t] || 0) + it.area, m), {}), catalog: entries.length, instances: objs.length, areaPx: area, props: props.length, cars: cars.length, people: people.length, cables: cables.length, segs: NS, lots: W.lots.length, ms: Math.round(performance.now() - t0) },
  };
  function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }
};
