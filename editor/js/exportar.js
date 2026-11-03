// ===================== exportar.js — el barrio a archivos para WeedJS =====================
// Exporta el barrio que se ve (misma generación) en un zip con la carpeta `barrio/` que lee Conurbano-weed:
//   meta.json        tamaños, proyección, hojas, cuántas franjas/piezas (para dimensionar los pools)
//   mundo.json       casas, props, árboles, autos, cables (en px de mundo de WeedJS) + catálogos de franjas y árboles
//   piso.bin         datos del shader del piso (celdas, tabla de calles, riqueza, ruido)
//   ff_*.json        flowfields estáticos de WeedJS: peatones (varios destinos), vuelta manzana (= veredas), calles
//   img/*.png|json   hojas de sprites tipo TexturePacker: casas (piezas de franjas), árboles (piezas), props
// No arma el bigAtlas: eso lo hace el juego al cargar (o se hornea para el build final, con las demás entidades).
const Exportar = (() => {
  const SF = R3.SF, K = R3.K, SYN = R3.SYN, CZ = R3.CZ;
  const espera = () => new Promise(r => setTimeout(r, 0));
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;

  async function exportar(B, atlas, F, progreso = () => {}, opts = {}) {
    const t0 = performance.now(), W = B.W, MW = W.MW, MH = W.MH, C = CFG.v;
    const PW = (x, y, z = 0) => [(x + K * y) * SF, (MH - y) * SYN * SF - z * CZ * SF];
    const WW = Math.ceil((MW + K * MH) * SF), WH = Math.ceil(MH * SYN * SF);
    const archivos = [];   // [ruta, Uint8Array]
    const txt = (s) => new TextEncoder().encode(s), json = (o) => txt(JSON.stringify(o));
    const png = async (cv) => new Uint8Array(await (await new Promise(ok => cv.toBlob(ok, "image/png"))).arrayBuffer());

    // ---------- 1. catálogo de casas, tapiales y postes: render R3 y franjas verticales
    // las casas se dibujan con más detalle (DET px por px de mundo) y el juego las muestra a 1/DET, como a los personajes LPC
    const DET = opts.detalle || 5 / 3, TDp = SF * DET; R3.setDetalle(DET);
    const entries = [...B.cat.values()], rendered = [], TOL = Math.round(8 * DET), PIEZA = Math.round(64 * DET), ANCHO = Math.round(64 * DET);
    try {
    for (let n = 0; n < entries.length; n++) {
      const e = entries[n]; if (n % 8 === 0) { progreso("casas " + n + "/" + entries.length, n / entries.length * .55); await espera(); }
      const built = Barrio.build3D(e.spec), res = built.sc.render({ groundShadow: false }), cv = res.canvas, d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
      const w = x1 - x0 + 1, h = y1 - y0 + 1, crop = document.createElement("canvas"); crop.width = w; crop.height = h; crop.getContext("2d").drawImage(cv, -x0, -y0);
      const casters = e.spec.t !== "poste" ? built.sc.casters.filter(c => !c.noGround).map(c => ({ c: c.c, ax: c.ax, h: c.h })) : [];
      let foot = [0, 0], fy = 1e9;
      for (const cs of built.sc.casters) { if (cs.c[2] - cs.h[2] > .3) continue;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const px = cs.c[0] + sx * cs.h[0] * cs.ax[0][0] + sy * cs.h[1] * cs.ax[1][0], py = cs.c[1] + sx * cs.h[0] * cs.ax[0][1] + sy * cs.h[1] * cs.ax[1][1];
          if (py < fy - 1e-6) { fy = py; foot = [px, py]; } } }
      // franjas: base de la pared por columna (frente de las cajas apoyadas en el piso)
      const cax = res.ax - x0, cay = res.ay - y0, base = new Float32Array(w).fill(NaN), top = new Int32Array(w).fill(-1), bot = new Int32Array(w).fill(-1);
      for (const cs of built.sc.casters) { if (cs.c[2] - cs.h[2] > .3) continue;
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const px = cs.c[0] + sx * cs.h[0] * cs.ax[0][0] + sy * cs.h[1] * cs.ax[1][0], py = cs.c[1] + sx * cs.h[0] * cs.ax[0][1] + sy * cs.h[1] * cs.ax[1][1];
          return [cax + (px + K * py) * TDp, cay - py * SYN * TDp]; });
        for (let c = 0; c < w; c++) { const xc = c + .5; let yb = -Infinity;
          for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) & 3]; if ((xc < a[0]) === (xc < b[0])) continue; yb = Math.max(yb, a[1] + (b[1] - a[1]) * (xc - a[0]) / (b[0] - a[0])); }
          if (yb > -Infinity && !(base[c] >= yb)) base[c] = yb; } }
      for (let c = 0; c < w; c++) for (let y = 0; y < h; y++) if (d[((y + y0) * cv.width + c + x0) * 4 + 3] > 8) { if (top[c] < 0) top[c] = y; bot[c] = y; }
      { let last = NaN; for (let c = 0; c < w; c++) if (isNaN(base[c])) base[c] = last; else last = base[c];
        last = NaN; for (let c = w - 1; c >= 0; c--) if (isNaN(base[c])) base[c] = last; else last = base[c];
        for (let c = 0; c < w; c++) if (isNaN(base[c])) base[c] = h; }
      const opaco = (c, y) => d[((y + y0) * cv.width + c + x0) * 4 + 3] > 8, strips = []; let c0 = -1, lo = 0, hi = 0;
      const cerrar = (c1) => { const a = Math.max(0, c0 - 1), z = Math.min(w, c1 + 1); let t = 1e9, b2 = -1;
        for (let c = a; c < z; c++) if (top[c] >= 0) { t = Math.min(t, top[c]); b2 = Math.max(b2, bot[c]); }
        if (b2 >= 0) { const pieces = [];
          for (let q0 = t; q0 <= b2; q0 += PIEZA) { const pa = Math.max(t, q0 - 1), pz = Math.min(b2 + 1, q0 + PIEZA + 1); let any = false;
            for (let y = pa; y < pz && !any; y++) for (let c = a; c < z; c++) if (opaco(c, y)) { any = true; break; }
            if (any) pieces.push({ t: pa, h: pz - pa }); }
          strips.push({ x: a, w: z - a, g: (lo + hi) / 2, pieces }); }
        c0 = -1; };
      for (let c = 0; c <= w; c++) {
        if (c === w || top[c] < 0) { if (c0 >= 0) cerrar(c); continue; }
        if (c0 < 0) { c0 = c; lo = hi = base[c]; continue; }
        const nlo = Math.min(lo, base[c]), nhi = Math.max(hi, base[c]);
        if (nhi - nlo > TOL || c - c0 >= ANCHO) { cerrar(c); c0 = c; lo = hi = base[c]; } else { lo = nlo; hi = nhi; } }
      rendered.push({ e, crop, ax: cax, ay: cay, w, h, casters, foot, strips });
    } } finally { R3.setDetalle(1); }
    // hojas de casas (estantes de 2048 de ancho, hasta 2040 de alto)
    progreso("hojas de casas", .58); await espera();
    const hojas = []; let cur = null;
    for (const it of rendered.slice().sort((a, b) => b.h - a.h)) {
      if (!cur || cur.y + it.h > 2040) { cur = { items: [], x: 0, y: 0, rowH: 0 }; hojas.push(cur); }
      if (cur.x + it.w + 2 > 2048) { cur.x = 0; cur.y += cur.rowH + 2; cur.rowH = 0; }
      if (cur.y + it.h > 2040) { cur = { items: [], x: 0, y: 0, rowH: 0 }; hojas.push(cur); }
      it.sx = cur.x; it.sy = cur.y; it.hoja = hojas.length - 1; cur.items.push(it); cur.x += it.w + 2; cur.rowH = Math.max(cur.rowH, it.h);
    }
    for (let si = 0; si < hojas.length; si++) {
      const sh = hojas[si], cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, sh.y + sh.rowH); const g = cv.getContext("2d"), frames = {};
      for (const it of sh.items) { g.drawImage(it.crop, it.sx, it.sy);
        it.strips.forEach((s, k) => s.pieces.forEach((q, j) => { frames["o" + it.e.id + "_" + k + "_" + j] = fr(it.sx + s.x, it.sy + q.t, s.w, q.h); })); }
      archivos.push(["img/casas" + si + ".png", await png(cv)], ["img/casas" + si + ".json", json(hoja(frames, "casas" + si + ".png", cv))]);
    }
    // catálogo de franjas, relativo al pie y en px de mundo: [dx (borde izq.), dy (base = y de orden), piezas [[cx, cy] centro respecto del borde y la base]]
    const franjas = {};
    for (const it of rendered) { const axF = it.ax + (it.foot[0] + K * it.foot[1]) * TDp, ayF = it.ay - it.foot[1] * SYN * TDp;
      franjas["o" + it.e.id] = it.strips.map(s => [r2((s.x - axF) / DET), r2((s.g - ayF) / DET), s.pieces.map(q => [r2(s.w / 2 / DET), r2((q.t + q.h / 2 - s.g) / DET)])]); }
    // ---------- 2. instancias de casas, tapiales y postes
    const byId = new Map(rendered.map(it => [it.e.id, it])), SUN = R3.SUN, casas = [];
    for (const o of B.objs) {
      const it = byId.get(o.e.id), fdx = it.foot[0], fdy = it.foot[1], [fx, fy] = PW(o.x0 + fdx, o.y0 + fdy);
      const rec = { o: it.hoja, a: "o" + o.e.id, x: r1(fx), y: r1(fy), k: o.kind };
      if (o.collider) rec.col = o.collider.map(([x, y]) => { const q = PW(x, y); return [r1(q[0] - fx), r1(q[1] - fy)]; });
      else rec.r = r1(.15 * 13.5);
      if (o.e.spec.t === "poste" && o.e.spec.l) rec.l = 1;           // poste de madera con lámpara
      if (it.casters.length) { const pts = [];
        for (const cs of it.casters) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const p = [0, 1, 2].map(k => cs.c[k] + sx * cs.h[0] * cs.ax[0][k] + sy * cs.h[1] * cs.ax[1][k] + sz * cs.h[2] * cs.ax[2][k]);
          const tt = Math.max(0, p[2]) / Math.max(.05, SUN[2]), q = PW(o.x0 + p[0] - SUN[0] * tt, o.y0 + p[1] - SUN[1] * tt); pts.push([q[0] - fx, q[1] - fy]); }
        rec.sh = R3.hull(pts).map(([x, y]) => [r1(x), r1(y)]); }
      casas.push(rec);
    }
    // ---------- 3. árboles: piezas (tronco + ramas) en una hoja, a la resolución de dibujo (el juego las muestra al 0,6)
    progreso("árboles", .62); await espera();
    const tiposUsados = [...new Set(B.arboles.map(a => a.t))], arbolTipos = {};
    { const items = []; for (const t of tiposUsados) Arboles.render(t).piezas.forEach((p, k) => items.push({ t, p, k }));
      items.sort((a, b) => b.p.h - a.p.h); let x = 0, y = 0, rowH = 0; const pos = [];
      for (const it of items) { if (x + it.p.w > 2048) { x = 0; y += rowH + 2; rowH = 0; } pos.push([x, y]); x += it.p.w + 2; rowH = Math.max(rowH, it.p.h); }
      const cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, y + rowH); const g = cv.getContext("2d"), frames = {};
      items.forEach((it, i) => { const [px, py] = pos[i], nm = it.t + "_" + it.p.i; g.drawImage(it.p.canvas, px, py); frames[nm] = fr(px, py, it.p.w, it.p.h); });
      for (const t of tiposUsados) { const R = Arboles.render(t), E = R.escala;
        // [cuadro, dx, dy (base de la pieza respecto del pie, px de mundo), anchorX, anchorY, orden dentro del árbol, se mece]
        arbolTipos[t] = { escala: E, alto: r1(R.h * E), piezas: R.piezas.map(p => [t + "_" + p.i, r1(p.dx * E), r1(p.dy * E), r2(p.ax), r2(p.ay), p.z, p.sway ? 1 : 0]) }; }
      archivos.push(["img/arboles.png", await png(cv)], ["img/arboles.json", json(hoja(frames, "arboles.png", cv))]); }
    const arboles = B.arboles.map(a => { const [x, y] = PW(a.x, a.y); return { t: a.t, x: r1(x), y: r1(y), fl: a.flip ? 1 : 0, r: r1(a.cr * 13.5) }; });
    // ---------- 4. props: sólo los cuadros usados del atlas del editor
    const props = B.props.map(e => { const [x, y] = PW(e.x, e.y); let fl = e.flip;
      if (e.face) { const s0 = PW(e.x, e.y), s1 = PW(e.x + e.face[0], e.y + e.face[1]); fl = s1[0] < s0[0]; }
      return { f: e.f, x: r1(x), y: r1(y), fl: fl ? 1 : 0, r: r1(e.cr * 13.5), sh: e.sh && F[e.sh] ? e.sh : null }; });
    const anclas = {};
    { const usados = new Set(); for (const p of props) { usados.add(p.f); if (p.sh) usados.add(p.sh); } ["sh_person", "sh_car_h", "sh_tree"].forEach(n => F[n] && usados.add(n));
      const ns = [...usados].sort((a, b) => F[b].h - F[a].h); let x = 0, y = 0, rowH = 0; const pos = {};
      for (const n of ns) { const f = F[n]; if (x + f.w > 2048) { x = 0; y += rowH + 2; rowH = 0; } pos[n] = [x, y]; x += f.w + 2; rowH = Math.max(rowH, f.h); }
      const cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, y + rowH); const g = cv.getContext("2d"), frames = {};
      for (const n of ns) { const f = F[n], [px, py] = pos[n]; g.drawImage(atlas, f.x, f.y, f.w, f.h, px, py, f.w, f.h); frames[n] = fr(px, py, f.w, f.h); anclas[n] = [r2(f.ox / f.w), r2(f.oy / f.h)]; }
      archivos.push(["img/props.png", await png(cv)], ["img/props.json", json(hoja(frames, "props.png", cv))]); }
    // ---------- 5. autos y cables
    const scrRot = (hd) => Math.atan2(-SYN * Math.sin(hd), Math.cos(hd) + K * Math.sin(hd));
    const autos = B.cars.map(c => { const [x, y] = PW(c.x, c.y); return { c: c.color, x: r1(x), y: r1(y), rot: Math.round(scrRot(c.hd) * 1000) / 1000, m: c.moving ? 1 : 0 }; });
    const cables = B.cables.map(c => { const a = PW(c[0], c[1], c[2]), b = PW(c[3], c[4], c[5]); return [r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]; });
    // ---------- 6. flowfields
    progreso("flowfields", .7); await espera();
    const GW = Math.ceil(MW), GH = Math.ceil(MH), CELL = 12, FW = Math.ceil(WW / CELL), FH = Math.ceil(WH / CELL);
    const unPW = (X, Y) => { const y = MH - Y / (SYN * SF); return [X / SF - K * y, y]; };
    const toScr = (dx, dy) => { const sx = dx + K * dy, sy = -SYN * dy, l = Math.hypot(sx, sy) || 1; return [r2(sx / l), r2(sy / l)]; };
    const ffJson = (name, fn) => { const data = []; for (let j = 0; j < FH; j++) { const row = []; for (let i = 0; i < FW; i++) row.push(fn(...unPW((i + .5) * CELL, (j + .5) * CELL))); data.push(row); }
      return json({ name, metadata: { widthCells: FW, heightCells: FH, widthPx: FW * CELL, heightPx: FH * CELL, cellSizePx: CELL }, data }); };
    // peatones: la vereda es lo más barato, pero la calle se puede cruzar por cualquier lado (sale un poco más caro)
    const COST = { vereda: 10, pasillo: 11, calle: 26, tierra: 18, cantero: 14 }, cost = new Uint8Array(GW * GH), vereda = new Uint8Array(GW * GH);
    for (const s of W.segs) { if (s.sw <= 0) continue; const R = s.hw + s.sw;
      const xa = Math.max(0, Math.floor(Math.min(s.a[0], s.b[0]) - R)), xb = Math.min(GW - 1, Math.ceil(Math.max(s.a[0], s.b[0]) + R)), ya = Math.max(0, Math.floor(Math.min(s.a[1], s.b[1]) - R)), yb = Math.min(GH - 1, Math.ceil(Math.max(s.a[1], s.b[1]) + R));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const q = World.segDist(s, x + .5, y + .5); if (q.d >= s.hw && q.d < R) { cost[y * GW + x] = COST.vereda; vereda[y * GW + x] = 1; } } }
    const road = new Uint8Array(GW * GH);
    rasterRoads(W, GW, GH, (i, s, q) => { const c = s.mat === "pasillo" ? COST.pasillo : s.type === "ave" && Math.abs(q.ds) < s.med ? COST.cantero : s.mat === "tierra" ? COST.tierra : COST.calle;
      road[i] = road[i] ? Math.min(road[i], c) : c; if (s.mat === "pasillo") vereda[i] = 1; });
    for (let i = 0; i < road.length; i++) if (road[i] && !cost[i]) cost[i] = road[i];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (cost[y * GW + x] && W.lotAt(x + .5, y + .5)) { cost[y * GW + x] = 0; vereda[y * GW + x] = 0; }
    const fg = FlowGrid(GW, GH, cost, COST.calle), nDest = Math.max(3, Math.min(10, Math.round(C.destinos || 6)));
    const targets = fg.pickTargets(nDest, R3.rng(B.SEED ^ 0x2545F491), (c) => c === COST.vereda);
    for (let f = 0; f < targets.length; f++) { progreso("flowfield de peatones " + (f + 1) + "/" + targets.length, .7 + f / targets.length * .12); await espera(); fg.compute(f);
      archivos.push(["ff_peaton" + f + ".json", ffJson("peaton" + f, (x, y) => { const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= GW || yi >= GH || !cost[yi * GW + xi]) return null;
        const q = fg.dir(f, x, y); return !q || q.arrived ? null : toScr(q.x, q.y); })]); fg.fields[f] = null; }
    // vuelta manzana: en cada vereda, a lo largo de la cuadra con la manzana a la derecha (es también la máscara de veredas)
    const cl = { k: 0, s: null, d: 0, t: 0, ds: 0 };
    archivos.push(["ff_veredas.json", ffJson("veredas", (x, y) => { const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= GW || yi >= GH || !vereda[yi * GW + xi]) return null;
      W.classifyInto(x, y, cl); if (!cl.s) return null; const sg = cl.ds >= 0 ? -1 : 1; return toScr(cl.s.dir[0] * sg, cl.s.dir[1] * sg); })]);
    // autos: a lo largo de su carril (mano derecha), tirando hacia el centro del carril
    archivos.push(["ff_calles.json", ffJson("calles", (x, y) => { if (x < 0 || y < 0 || x > MW || y > MH) return null; W.classifyInto(x, y, cl); if (cl.k !== 1) return null; const s = cl.s;
      if (s.mat === "pasillo" || (s.type === "ave" && Math.abs(cl.ds) < s.med + .2)) return null;
      const fwd = cl.ds < 0 ? 1 : -1, lane = laneOff(s), off = cl.ds - (-fwd * lane), pull = Math.max(-.6, Math.min(.6, -off * .35));
      return toScr(s.dir[0] * fwd + s.n[0] * pull, s.dir[1] * fwd + s.n[1] * pull); })]);
    // ---------- 7. piso (shader de WeedJS)
    progreso("piso", .86); await espera();
    const GC = .5, CW = Math.ceil(MW / GC), CHh = Math.ceil(MH / GC), cellA = new Uint8Array(CW * CHh * 4), cellB = new Uint8Array(CW * CHh * 4);
    const TYPE = { ave: 0, calle: 1, pasaje: 2, pasillo: 3 }, MAT = { asf: 0, roto: 1, tierra: 2, pasillo: 3 };
    const VER = { tierra: 1, vain: 2, gris: 3, roja: 3, cem: 4, pasto: 5 }, PAT = { pasto: 1, tierra: 2, yuyo: 3, roja: 4, cem: 5 };
    const NS = W.segs.length, segs = new Uint8Array(NS * 48), ENC = { pos: [20, 100], unit: [1, 32767.5], len: [0, 100], w: [0, 1000], int: [0, 1] };
    W.segs.forEach((s, k) => { s._gid = k; const cr = s.cross.slice(0, 8); while (cr.length < 8) cr.push(null);
      const vals = [[s.a[0], "pos"], [s.a[1], "pos"], [s.dir[0], "unit"], [s.dir[1], "unit"], [s.n[0], "unit"], [s.n[1], "unit"], [s.len, "len"], [s.hw, "w"], [Math.max(0, s.sw), "w"], [s.med || 0, "w"],
        [s.cls, "int"], [s.w, "w"], [TYPE[s.type], "int"], [MAT[s.mat], "int"], [s.cantero ? 1 : 0, "int"], [0, "int"], ...cr.map(t => [t, "pos"])];
      vals.forEach(([v, e], m) => { const [off, sc] = ENC[e]; const q = v == null ? 65535 : Math.max(0, Math.min(65534, Math.round((v + off) * sc))); segs[k * 48 + m * 2] = q & 255; segs[k * 48 + m * 2 + 1] = q >> 8; }); });
    for (let j = 0; j < CHh; j++) { if (j % 64 === 0) { progreso("piso " + Math.round(j / CHh * 100) + "%", .86 + j / CHh * .1); await espera(); }
      for (let i = 0; i < CW; i++) {
        const x = (i + .5) * GC, y = (j + .5) * GC, o = (j * CW + i) * 4, cand = [];
        for (const s of W.near(x, y)) { const q = World.segDist(s, x, y); if (q.d < s.hw + Math.max(0, s.sw) + .8) cand.push([q.d < s.hw + .4 ? 0 : 1, -s.cls, q.d, s]); }
        cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
        const id = (k) => cand[k] ? cand[k][3]._gid + 1 : 0, a = id(0), b = id(1), c = id(2);
        cellA[o] = a & 255; cellA[o + 1] = a >> 8; cellA[o + 2] = b & 255; cellA[o + 3] = b >> 8; cellB[o] = c & 255; cellB[o + 1] = c >> 8;
        W.classifyInto(x, y, cl);
        if (cl.k === 2) { const sgn = cl.ds >= 0 ? 1 : -1, s = cl.s; let kind = s.w < .3 ? "tierra" : "vain", dmg = s.w < .45;
          for (const e of s.lots[sgn]) if (cl.t >= e.t0 && cl.t < e.t1) { kind = e.lot.vereda; if (kind === "vain_d") { kind = "vain"; dmg = true; } break; }
          cellB[o + 2] = (VER[kind] || 2) | (dmg ? 16 : 0); }
        const lot = W.lotAt(x, y); if (lot) cellB[o + 3] = (PAT[lot.patio] || 5) | (lot.w < .4 ? 16 : 0);
      } }
    const WGc = Math.ceil(MW / 10), HGc = Math.ceil(MH / 10), wealth = new Uint8Array(WGc * HGc);
    for (let j = 0; j < HGc; j++) for (let i = 0; i < WGc; i++) wealth[j * WGc + i] = Math.round(W.wealthAt(i * 10 + 5, j * 10 + 5) * 255);
    const N = Ground.N, noise = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) { noise[i * 4] = Math.round(N.a[i] * 255); noise[i * 4 + 1] = Math.round(N.b[i] * 255); noise[i * 4 + 2] = Math.round(N.c[i] * 255); noise[i * 4 + 3] = Math.round(N.g[i] * 255); }
    const partes = { cellA, cellB, wealth, noise, segs }, offs = {}; let off = 0;
    for (const k in partes) { offs[k] = [off, partes[k].length]; off += partes[k].length; off = (off + 3) & ~3; }
    const piso = new Uint8Array(off); for (const k in partes) piso.set(partes[k], offs[k][0]);
    archivos.push(["piso.bin", piso]);
    // ---------- 8. meta y mundo
    const nFranjas = casas.reduce((a, h) => a + franjas[h.a].length, 0), nPiezas = casas.reduce((a, h) => a + franjas[h.a].reduce((x, s) => x + s[2].length, 0), 0);
    const meta = { formato: 1, escalaCasas: Math.round(1 / DET * 1e5) / 1e5, editor: "editor de barrios · Conurbano", fecha: new Date().toISOString(), seed: B.SEED, knobs: { ...C },
      MW, MH, WW, WH, SF, K, SYN, CZ, GC, CW, CH: CHh, WG: WGc, HG: HGc, NS, CELL, PXM: 13.5, pisoPartes: offs,
      hojasCasas: hojas.length, peatones: targets.length, nCasas: casas.length, nFranjas, nPiezas, nArboles: arboles.length,
      nPiezasArboles: arboles.reduce((a, t) => a + arbolTipos[t.t].piezas.length, 0), nProps: props.length, nAutos: autos.length, nCables: cables.length, anclas };
    archivos.push(["meta.json", json(meta)], ["meta.js", txt("// generado por el editor de barrios — no editar a mano\nexport const META = " + JSON.stringify(meta) + ";\n")], ["mundo.json", json({ casas, franjas, arboles, arbolTipos, props, autos, cables })]);
    progreso("zip", .98); await espera();
    const zip = await Zip.armar(archivos.map(([p, d]) => ["barrio/" + p, d]));
    progreso("listo en " + Math.round((performance.now() - t0) / 1000) + " s", 1);
    return { zip, meta, archivos };
  }
  const fr = (x, y, w, h) => ({ frame: { x, y, w, h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h } });
  const hoja = (frames, image, cv) => ({ frames, animations: Object.fromEntries(Object.keys(frames).map(k => [k, [k]])), meta: { app: "editor de barrios · Conurbano", image, size: { w: cv.width, h: cv.height }, scale: 1 } });
  return { exportar };
})();

// zip sin compresión (los PNG ya vienen comprimidos); CRC-32 estándar
const Zip = (() => {
  const T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (d) => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = T[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  // deflate con CompressionStream del navegador (los PNG se guardan tal cual)
  async function deflate(data) { const cs = new CompressionStream("deflate-raw"), w = cs.writable.getWriter(); w.write(data); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
  async function armar(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const [name, data] of files) {
      const nm = enc.encode(name), c = crc(data), comprimir = !/\.png$/.test(name) && typeof CompressionStream !== "undefined";
      const body = comprimir ? await deflate(data) : data, method = comprimir ? 8 : 0, h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, method, true); h.setUint16(12, 0x21, true); h.setUint32(14, c, true); h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, body);
      const ce = new DataView(new ArrayBuffer(46)); ce.setUint32(0, 0x02014b50, true); ce.setUint16(4, 20, true); ce.setUint16(6, 20, true); ce.setUint16(10, method, true); ce.setUint16(14, 0x21, true); ce.setUint32(16, c, true);
      ce.setUint32(20, body.length, true); ce.setUint32(24, data.length, true); ce.setUint16(28, nm.length, true); ce.setUint32(42, off, true);
      central.push(new Uint8Array(ce.buffer), nm); off += 30 + nm.length + body.length;
    }
    const cs = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cs, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }
  // leer un zip de este editor (guardado o deflate)
  async function leer(blob) {
    const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer), out = {}, dec = new TextDecoder(); let p = 0;
    while (p + 30 <= b.length && v.getUint32(p, true) === 0x04034b50) { const m = v.getUint16(p + 8, true), n = v.getUint16(p + 26, true), x = v.getUint16(p + 28, true), size = v.getUint32(p + 18, true);
      const name = dec.decode(b.subarray(p + 30, p + 30 + n)), raw = b.subarray(p + 30 + n + x, p + 30 + n + x + size);
      out[name] = m === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : raw; p += 30 + n + x + size; }
    return out;
  }
  return { armar, leer };
})();
