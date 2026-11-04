// ===================== exportar.js — el barrio a archivos para WeedJS =====================
// Exporta el barrio que se ve (misma generación) en un zip con la carpeta `barrio/` (o `carabobo/`, el barrio real) que lee Conurbano-weed:
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
    const entries = [...B.cat.values()], SKEW = C.skew !== 0;
    let hojas = [], franjas = {}, casas = [], hojasCaras = 0, variantes = null, nTiles = 0;
    if (!SKEW) {
      const rendered = [], TOL = Math.round(8 * DET), PIEZA = Math.round(64 * DET), ANCHO = Math.round(64 * DET);
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
      let cur = null;
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

      for (const it of rendered) { const axF = it.ax + (it.foot[0] + K * it.foot[1]) * TDp, ayF = it.ay - it.foot[1] * SYN * TDp;
        franjas["o" + it.e.id] = it.strips.map(s => [r2((s.x - axF) / DET), r2((s.g - ayF) / DET), s.pieces.map(q => [r2(s.w / 2 / DET), r2((q.t + q.h / 2 - s.g) / DET)])]); }
      // ---------- 2. instancias de casas, tapiales y postes
      const byId = new Map(rendered.map(it => [it.e.id, it])), SUN = R3.SUN;
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
    } else {
      // ---------- 1'. casas por caras planas con skew (caras.js): las caras de cada diseño una sola vez, en piezas de
      // hasta 64 px de mundo, y para cada clave del catálogo (diseño + rumbo) la lista de piezas con su lugar, escala,
      // skew, tinte y orden
      let H; try { H = Caras.hornear(entries, DET, (q) => progreso("caras " + Math.round(q * 100) + " %", q * .5)); } finally { R3.setDetalle(1); }
      progreso("hojas de caras", .52); await espera();
      const lienzo = new Map(), hojasC = []; let cur = null;
      for (const pz of H.piezas.slice().sort((a, b) => b.h - a.h)) {
        if (!cur || cur.y + pz.h > 2040) { cur = { items: [], x: 0, y: 0, rowH: 0 }; hojasC.push(cur); }
        if (cur.x + pz.w + 2 > 2048) { cur.x = 0; cur.y += cur.rowH + 2; cur.rowH = 0; }
        if (cur.y + pz.h > 2040) { cur = { items: [], x: 0, y: 0, rowH: 0 }; hojasC.push(cur); }
        pz.sx = cur.x; pz.sy = cur.y; pz.hoja = hojasC.length - 1; cur.items.push(pz); cur.x += pz.w + 2; cur.rowH = Math.max(cur.rowH, pz.h);
      }
      const nombreDe = {};
      for (let si = 0; si < hojasC.length; si++) {
        const sh = hojasC[si], cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, sh.y + sh.rowH); const g = cv.getContext("2d"), frames = {};
        for (const pz of sh.items) { let src = lienzo.get(pz.T);
          if (!src) { src = document.createElement("canvas"); src.width = pz.T.w; src.height = pz.T.h; src.getContext("2d").putImageData(new ImageData(pz.T.d, pz.T.w, pz.T.h), 0, 0); lienzo.set(pz.T, src); }
          g.drawImage(src, pz.x0, pz.y0, pz.w, pz.h, pz.sx, pz.sy, pz.w, pz.h); frames[pz.nombre] = fr(pz.sx, pz.sy, pz.w, pz.h); nombreDe[pz.nombre] = "caras" + si + "_" + pz.nombre; }
        archivos.push(["img/caras" + si + ".png", await png(cv)], ["img/caras" + si + ".json", json(hoja(frames, "caras" + si + ".png", cv))]);
      }
      hojasCaras = hojasC.length; variantes = {};
      for (const id in H.variantes) variantes[id] = H.variantes[id].map(t => [nombreDe[t[0]], ...t.slice(1)]);
      console.log("caras:", H.nDisenos, "diseños,", H.nTexturas, "texturas,", H.piezas.length, "piezas en", hojasCaras, "hojas,", Object.keys(variantes).length, "variantes");
      // ---------- 2'. instancias: el origen de la casa (de ahí cuelgan las piezas), el pie (la entidad), colisionador y sombra
      const SUN = R3.SUN;
      for (const o of B.objs) {
        const V = H.pies[o.e.id], [ox, oy] = PW(o.x0, o.y0), [fx, fy] = PW(o.x0 + V.foot[0], o.y0 + V.foot[1]);
        const rec = { v: o.e.id, ox: r2(ox), oy: r2(oy), x: r1(fx), y: r1(fy), k: o.kind };
        nTiles += variantes[o.e.id].length;
        if (o.collider) rec.col = o.collider.map(([x, y]) => { const q = PW(x, y); return [r1(q[0] - fx), r1(q[1] - fy)]; });
        else rec.r = r1(.15 * 13.5);
        if (o.e.spec.t === "poste" && o.e.spec.l) rec.l = 1;
        const cts = o.e.spec.t !== "poste" ? V.casters.filter(c => !c.noGround) : [];
        if (cts.length) { const pts = [];
          for (const cs of cts) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            const p = [0, 1, 2].map(k => cs.c[k] + sx * cs.h[0] * cs.ax[0][k] + sy * cs.h[1] * cs.ax[1][k] + sz * cs.h[2] * cs.ax[2][k]);
            const tt = Math.max(0, p[2]) / Math.max(.05, SUN[2]), q = PW(o.x0 + p[0] - SUN[0] * tt, o.y0 + p[1] - SUN[1] * tt); pts.push([q[0] - fx, q[1] - fy]); }
          rec.sh = R3.hull(pts).map(([x, y]) => [r1(x), r1(y)]); }
        casas.push(rec);
      }
    }
    // ---------- 3. árboles: piezas (tronco + ramas) en una hoja, a la resolución de dibujo (el juego las muestra al 0,6)
    progreso("árboles", .62); await espera();
    // un tipo con cal ("_c") sólo agrega su tronco: las ramas son las del tipo base (mismo esqueleto)
    const tiposUsados = [...new Set(B.arboles.map(a => a.t))], arbolTipos = {}, base = (t) => t.replace(/_c$/, "");
    const aHornear = [...new Set(tiposUsados.flatMap(t => [t, base(t)]))];
    { const items = []; for (const t of aHornear) Arboles.render(t).piezas.forEach((p, k) => { if (t === base(t) || p.i === 0) items.push({ t, p, k }); });
      items.sort((a, b) => b.p.h - a.p.h); let x = 0, y = 0, rowH = 0; const pos = [];
      for (const it of items) { if (x + it.p.w > 2048) { x = 0; y += rowH + 2; rowH = 0; } pos.push([x, y]); x += it.p.w + 2; rowH = Math.max(rowH, it.p.h); }
      const cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, y + rowH); const g = cv.getContext("2d"), frames = {};
      items.forEach((it, i) => { const [px, py] = pos[i], nm = it.t + "_" + it.p.i; g.drawImage(it.p.canvas, px, py); frames[nm] = fr(px, py, it.p.w, it.p.h); });
      for (const t of tiposUsados) { const R = Arboles.render(t), E = R.escala;
        // [cuadro, dx, dy (base de la pieza respecto del pie, px de mundo), anchorX, anchorY, orden dentro del árbol, se mece]
        arbolTipos[t] = { escala: E, alto: r1(R.h * E), piezas: R.piezas.map(p => [(p.i === 0 ? t : base(t)) + "_" + p.i, r1(p.dx * E), r1(p.dy * E), r2(p.ax), r2(p.ay), p.z, p.sway ? 1 : 0]) }; }
      archivos.push(["img/arboles.png", await png(cv)], ["img/arboles.json", json(hoja(frames, "arboles.png", cv))]); }
    const arboles = B.arboles.map(a => { const [x, y] = PW(a.x, a.y); return { t: a.t, x: r1(x), y: r1(y), fl: a.flip ? 1 : 0, r: r1(a.cr * 13.5) }; });
    // ---------- 3b. tránsito (Ley 24.449 y Código de Tránsito de CABA), para que los autos del juego respeten la ley:
    // - cruces: los de calles por donde andan autos (no pasajes ni pasillos), con o sin semáforo, el rumbo de pantalla de la
    //   primera calle (para saber por cuál viene cada auto) y el desfasaje del ciclo del semáforo;
    // - transito.bin: grilla de 1 m (Uint16): velocidad máxima (bits 0-3: 1 = 20 km/h tierra y pasajes, 2 = 30 llegando a un cruce
    //   sin semáforo, 3 = 40 calles, 4 = 60 avenidas), zona (bits 4-5: 1 = antes de la senda, donde se para; 2 = el cruce y la
    //   senda, donde no) y el cruce (bits 6-15: id + 1).
    const cruces = [], scrDir = (d) => { const x = d[0] + K * d[1], y = -SYN * d[1], l = Math.hypot(x, y) || 1; return [r2(x / l), r2(y / l)]; };
    const anda = (q) => q.type === "ave" || q.type === "calle";
    for (const it of W.inters) { it._cid = -1; if (!anda(it.s) || !anda(it.o) || cruces.length >= 1022 || !W.dentro(it.p[0], it.p[1])) continue;
      if (Math.abs(it.s.dir[0] * it.o.dir[0] + it.s.dir[1] * it.o.dir[1]) > .85) continue;     // casi paralelas: no es un cruce
      const [x, y] = PW(it.p[0], it.p[1]), h = Math.abs(Math.imul(Math.round(it.p[0] * 10), 73856093) ^ Math.imul(Math.round(it.p[1] * 10), 19349663));
      it._cid = cruces.length; cruces.push([r1(x), r1(y), it.sem ? 1 : 0, ...scrDir(it.s.dir), h % 40]); }
    const TW = Math.ceil(MW), TH = Math.ceil(MH), transito = new Uint16Array(TW * TH), clT = { k: 0, s: null, d: 0, t: 0, ds: 0 };
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) { W.classifyInto(i + .5, j + .5, clT); if (clT.k !== 1) continue; const q = clT.s;
      transito[j * TW + i] = q.type === "pasillo" ? 0 : q.mat === "tierra" || q.type === "pasaje" ? 1 : q.type === "ave" ? 4 : 3; }
    for (const it of W.inters) { if (it._cid < 0) continue; const { s, o, p } = it, R = Math.max(s.hw, o.hw) + Math.max(s.sw, o.sw, 0) + 10;
      for (let j = Math.max(0, Math.floor(p[1] - R)); j < Math.min(TH, Math.ceil(p[1] + R)); j++) for (let i = Math.max(0, Math.floor(p[0] - R)); i < Math.min(TW, Math.ceil(p[0] + R)); i++) {
        const x = i + .5 - p[0], y = j + .5 - p[1], ds = Math.abs(x * s.n[0] + y * s.n[1]), dO = Math.abs(x * o.n[0] + y * o.n[1]), k = j * TW + i, v = transito[k];
        let zona = 0, lim = v & 15;
        if (ds < s.hw && dO < o.hw + Math.max(0, o.sw) + .6 || dO < o.hw && ds < s.hw + Math.max(0, s.sw) + .6) zona = 2;           // el cruce y las sendas
        else if (ds < s.hw && dO < o.hw + Math.max(0, o.sw) + 7.6 || dO < o.hw && ds < s.hw + Math.max(0, s.sw) + 7.6) zona = 1;   // los 7 m antes de la senda
        if (!zona || !lim) continue;
        const ya = (v >> 4) & 3; if (ya === 2 && zona === 1) continue;         // el cruce de al lado manda
        if (zona === 1 && !it.sem && lim > 2) lim = 2;                         // llegando a una esquina sin semáforo: 30 km/h
        transito[k] = lim | zona << 4 | (it._cid + 1) << 6; } }
    archivos.push(["transito.bin", new Uint8Array(transito.buffer)]);
    // ---------- 4. props: sólo los cuadros usados del atlas del editor
    // los que miran a algún lado: frente o atrás (los de Gemini que la tienen) y espejo, vistos desde la cámara del juego
    // (los semáforos llevan su cruce y cuál de las dos calles muestran)
    const props = B.props.map(e => { const [x, y] = PW(e.x, e.y); let fl = e.flip, f = e.f;
      if (e.face) { const s0 = PW(e.x, e.y), s1 = PW(e.x + e.face[0], e.y + e.face[1]); [f, fl] = Barrio.vista(F, e.f, s1[0] - s0[0], s1[1] - s0[1]); }
      return { f, x: r1(x), y: r1(y), fl: fl ? 1 : 0, r: r1(e.cr * 13.5), sh: e.sh && F[e.sh] ? e.sh : null, ...(e.cruce && e.cruce._cid >= 0 ? { cr: e.cruce._cid, ej: e.eje } : {}) }; });
    const anclas = {}, escalas = {}; let semAlto = 0;
    { const usados = new Set(); for (const p of props) { usados.add(p.f); if (p.sh) usados.add(p.sh); } ["sh_person", "sh_car_h", "sh_tree"].forEach(n => F[n] && usados.add(n));
      // los props HD (f.hd) van con su resolución original (30 px/m) y el juego los dibuja a f.hd.e (escalas)
      const S = (n) => F[n].hd || F[n];
      // contorno como el de los personajes y los autos (contorno.js): por fuera, con el grosor que a la escala del juego
      // (f.e, o 1) mide 1 px de mundo. Las sombras y lo que va pegado al piso, sin.
      const SIN_CONTORNO = /^(sh_|gd_|yy_grieta|yy_musgo|yy_trebol)/, cuadro = {};
      for (const n of usados) { const f = S(n), c = document.createElement("canvas"); c.width = f.w; c.height = f.h;
        c.getContext("2d").drawImage(f.img || atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        const t = SIN_CONTORNO.test(n) ? 0 : Contorno.grosor(f.e || 1); cuadro[n] = { cv: t ? Contorno.canvas(c, t) : c, t, f }; }
      const ns = [...usados].sort((a, b) => cuadro[b].cv.height - cuadro[a].cv.height); let x = 0, y = 0, rowH = 0; const pos = {};
      for (const n of ns) { const c = cuadro[n].cv; if (x + c.width > 2048) { x = 0; y += rowH + 2; rowH = 0; } pos[n] = [x, y]; x += c.width + 2; rowH = Math.max(rowH, c.height); }
      const cv = document.createElement("canvas"); cv.width = 2048; cv.height = Math.max(4, y + rowH); const g = cv.getContext("2d"), frames = {};
      // el ancla va en el centro de la base: el juego pone ahí el collider (un círculo de radio cr·13,5 px) y ordena por ahí.
      // Muchas hojas de Gemini no dicen cuánto fondo tiene el objeto (la calesita quedaba con 0,3 m y el ancla casi en el borde de
      // abajo, así que el círculo caía debajo del dibujo): lo que choca tiene de fondo por lo menos su collider, y el centro
      // de la base queda cr·SYN·SF px de juego por encima del borde de abajo
      const crDe = {}; B.props.forEach((e, i) => { if (e.cr > 0) { const f = props[i].f; crDe[f] = Math.max(crDe[f] || 0, e.cr); } });
      for (const n of ns) { const { cv: c, t, f } = cuadro[n], [px, py] = pos[n]; g.drawImage(c, px, py); frames[n] = fr(px, py, c.width, c.height);
        const oy = crDe[n] ? Math.min(f.oy, f.h - 1 - crDe[n] * SYN * SF / (f.e || 1)) : f.oy;
        anclas[n] = [r2((f.ox + t) / c.width), r2((oy + t) / c.height)];
        if (f.e) escalas[n] = f.e;
        if (n === "u_semaforo") semAlto = r1(c.height * anclas[n][1] * (f.e || 1)); }
      archivos.push(["img/props.png", await png(cv)], ["img/props.json", json(hoja(frames, "props.png", cv))]); }
    // ---------- 5. autos y cables
    const scrRot = (hd) => Math.atan2(-SYN * Math.sin(hd), Math.cos(hd) + K * Math.sin(hd));
    const autos = B.cars.map(c => { const [x, y] = PW(c.x, c.y); return { c: c.color, x: r1(x), y: r1(y), rot: Math.round(scrRot(c.hd) * 1000) / 1000, m: c.moving ? 1 : 0 }; });
    const cables = B.cables.map(c => { const a = PW(c[0], c[1], c[2]), b = PW(c[3], c[4], c[5]); return [r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]; });
    const lineas = (B.lineas || []).map(c => { const a = PW(c[0], c[1], 0), b = PW(c[2], c[3], 0); return [r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]; });
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
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const l = W.lotAt(x + .5, y + .5);
      if (l && l.kind === "sendero") { cost[y * GW + x] = COST.vereda; vereda[y * GW + x] = 1; }       // los senderos de las plazas se caminan
      else if (cost[y * GW + x] && l) { cost[y * GW + x] = 0; vereda[y * GW + x] = 0; } }
    // afuera del paredón no camina nadie (ni aparece: el juego pone a la gente donde "veredas" tiene dirección)
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!W.dentro(x + .5, y + .5)) { cost[y * GW + x] = 0; vereda[y * GW + x] = 0; }
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
    archivos.push(["ff_calles.json", ffJson("calles", (x, y) => { if (!W.dentro(x, y)) return null; W.classifyInto(x, y, cl); if (cl.k !== 1) return null; const s = cl.s;
      if (s.mat === "pasillo" || s.type === "pasaje" || (s.type === "ave" && Math.abs(cl.ds) < s.med + .2)) return null;   // los pasajes (angostos, de tierra en la villa) no son para el tránsito
      const fwd = cl.ds < 0 ? 1 : -1, lane = laneOff(s), off = cl.ds - (-fwd * lane), pull = Math.max(-.6, Math.min(.6, -off * .35));
      // calle cortada por el paredón: los últimos 14 m antes de las vallas, el carril que va hacia afuera dobla al de vuelta (giro en U)
      { let corta = false; for (let d = 3; d <= 14; d += 2.75) if (!W.dentro(x + s.dir[0] * fwd * d, y + s.dir[1] * fwd * d)) { corta = true; break; }
        if (corta) { const g = cl.ds < 0 ? 1 : -1; return toScr(s.n[0] * g + s.dir[0] * fwd * .25, s.n[1] * g + s.dir[1] * fwd * .25); } }
      return toScr(s.dir[0] * fwd + s.n[0] * pull, s.dir[1] * fwd + s.n[1] * pull); })]);
    // ---------- 7. piso (shader de WeedJS)
    progreso("piso", .86); await espera();
    const GC = .5, CW = Math.ceil(MW / GC), CHh = Math.ceil(MH / GC), cellA = new Uint8Array(CW * CHh * 4), cellB = new Uint8Array(CW * CHh * 4);
    const TYPE = { ave: 0, calle: 1, pasaje: 2, pasillo: 3 }, MAT = { asf: 0, roto: 1, tierra: 2, pasillo: 3, adoquin: 4 };
    const VER = { tierra: 1, vain: 2, gris: 3, roja: 3, cem: 4, pasto: 5 }, PAT = { pasto: 1, tierra: 2, yuyo: 3, roja: 4, cem: 5, sint: 1 };
    const NS = W.segs.length, segs = new Uint8Array(NS * 48), ENC = { pos: [20, 50], unit: [1, 32767.5], len: [0, 50], w: [0, 1000], int: [0, 1] };   // pos y len: 2 cm, hasta 1290 m
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
        // patio: el piso del lote (baldosa, cemento…) sólo en los primeros 13 m desde el frente (la casa y su patio); más al fondo,
        // pasto (tierra en los barrios pobres), como el fondo de las manzanas de Buenos Aires
        const lot = W.lotAt(x, y); if (lot) { const v = lot.nOut ? (x - lot.o[0]) * lot.nOut[0] + (y - lot.o[1]) * lot.nOut[1] : 0;
          const pat = lot.patio !== "yuyo" && lot.kind !== "plaza" && lot.kind !== "sendero" && lot.kind !== "cancha" && v > 13 ? (lot.w < .3 ? "tierra" : "pasto") : lot.patio;
          cellB[o + 3] = (PAT[pat] || 5) | (lot.w < .4 ? 16 : 0); }
      } }
    const WGc = Math.ceil(MW / 10), HGc = Math.ceil(MH / 10), wealth = new Uint8Array(WGc * HGc);
    for (let j = 0; j < HGc; j++) for (let i = 0; i < WGc; i++) wealth[j * WGc + i] = Math.round(W.wealthAt(i * 10 + 5, j * 10 + 5) * 255);
    const N = Ground.N, noise = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) { noise[i * 4] = Math.round(N.a[i] * 255); noise[i * 4 + 1] = Math.round(N.b[i] * 255); noise[i * 4 + 2] = Math.round(N.c[i] * 255); noise[i * 4 + 3] = Math.round(N.g[i] * 255); }
    // cazuelas: grilla de 2 m; por celda, una cazuela: r,g = centro dentro de la celda (0..2 m), b = ángulo (/256 vuelta), a = tipo | 4 con pasto
    const PWc = Math.ceil(MW / 2), PHc = Math.ceil(MH / 2), pits = new Uint8Array(PWc * PHc * 4);
    for (const q of (B.pits || [])) { const i = Math.floor(q.x / 2), j = Math.floor(q.y / 2); if (i < 0 || j < 0 || i >= PWc || j >= PHc) continue; const o = (j * PWc + i) * 4;
      if (pits[o + 3]) continue; pits[o] = Math.round((q.x - i * 2) / 2 * 255); pits[o + 1] = Math.round((q.y - j * 2) / 2 * 255);
      pits[o + 2] = Math.round(((q.ang / (2 * Math.PI)) % 1 + 1) % 1 * 256) & 255; pits[o + 3] = q.tipo | (q.pasto ? 4 : 0); }
    const partes = { cellA, cellB, wealth, noise, segs, pits }, offs = {}; let off = 0;
    for (const k in partes) { offs[k] = [off, partes[k].length]; off += partes[k].length; off = (off + 3) & ~3; }
    const piso = new Uint8Array(off); for (const k in partes) piso.set(partes[k], offs[k][0]);
    archivos.push(["piso.bin", piso]);
    // ---------- 8. meta y mundo
    const nFranjas = SKEW ? 0 : casas.reduce((a, h) => a + franjas[h.a].length, 0), nPiezas = SKEW ? 0 : casas.reduce((a, h) => a + franjas[h.a].reduce((x, s) => x + s[2].length, 0), 0);
    const meta = { formato: 1, escalaCasas: Math.round(1 / DET * 1e5) / 1e5, editor: "editor de barrios · Conurbano", fecha: new Date().toISOString(), seed: B.SEED, knobs: { ...C },
      MW, MH, MG: W.MG || 0, WW, WH, SF, K, SYN, CZ, GC, CW, CH: CHh, WG: WGc, HG: HGc, PW: PWc, PH: PHc, NS, CELL, PXM: 13.5, pisoPartes: offs,
      hojasCasas: hojas.length, peatones: targets.length, nCasas: casas.length, nFranjas, nPiezas, skew: SKEW ? 1 : 0, hojasCaras, nTiles, nArboles: arboles.length,
      nPiezasArboles: arboles.reduce((a, t) => a + arbolTipos[t.t].piezas.length, 0), nProps: props.length, nAutos: autos.length, nCables: cables.length, nLineas: lineas.length, anclas, escalas,
      ...(W.inicio ? { inicio: PW(W.inicio[0], W.inicio[1]).map(v => Math.round(v)), lugar: W.real } : {}),
      transito: { W: TW, H: TH, n: cruces.length, semAlto, nSem: props.filter(p => p.f === "u_semaforo" && p.cr >= 0).length } };
    archivos.push(["meta.json", json(meta)], ["meta.js", txt("// generado por el editor de barrios — no editar a mano\nexport const META = " + JSON.stringify(meta) + ";\n")], ["mundo.json", json({ casas, franjas, ...(SKEW ? { variantes } : {}), arboles, arbolTipos, props, autos, cables, lineas, cruces })]);
    progreso("zip", .98); await espera();
    // el barrio inventado va a barrio/; el real (Carabobo al 1500 y la villa 1-11-14) a carabobo/: el juego tiene los dos
    const carpeta = (W.carpeta || (W.real ? "carabobo" : "barrio")) + "/";
    const zip = await Zip.armar(archivos.map(([p, d]) => [carpeta + p, d]));
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
