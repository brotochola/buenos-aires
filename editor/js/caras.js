// ===================== caras.js — casas por caras planas con skew (WeedJS ≥ DX-DECOSKEW, PR #7) =====================
// Cada diseño del catálogo (casa, edificio, casilla, esquina, tapial, paredón, poste) se arma una sola vez en R3, sin
// rumbo y en modo kit (Houses.setKit): sus caras quedan en coordenadas de la casa y sus detalles chicos como accesorios.
// Lo que va al atlas, sin rumbo y sin repetir:
//   - las caras con dibujo propio (fachadas, medianeras, carteles…): planas, con su material, la oclusión del piso, la
//     saturación y un borde oscuro (el contorno), sin la luz del sol, en piezas de hasta 128 px de mundo;
//   - las baldosas de material (techos): una por material, compartida por todas las casas, en piezas de hasta 6 m;
//   - los accesorios (tanque, aire, antena, maceta): un sprite de R3 cada uno, compartido (los que tienen frente, por
//     octavo de vuelta);
//   - las caras de color liso no van: se dibujan con la textura blanca del motor (_white) teñida.
// Para cada rumbo en que se usa un diseño (una "variante"): qué se ve; para cada pieza su lugar, escala y skew (la cara
// plana proyectada en la vista oblicua es un paralelogramo: escala + skewX + skewY la dibujan exacta), el tinte (la luz
// de R3 para hacia dónde mira la cara en ese rumbo), el orden de pintor dentro de la casa (innerZ) y la y de orden (la
// base de su pared o de la casa en su columna, subida lo justo para no quedar detrás de una pieza de la casa que tapa).
const Caras = (() => {
  const { SF, K, SYN, CZ } = R3;
  const VIEW = R3.norm([-K, 1, -SYN / CZ]);
  const G = 1.25;   // la luz más fuerte (cara al sol, ~1,24): la textura va por G y el tinte de cada cara es L/G ≤ 1
  const len = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  const rot = (c, s, v) => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sc3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // metros → px de mundo (vector, o punto desde el origen de la casa)
  const J = (v) => [SF * (v[0] + K * v[1]), -SF * (v[2] * CZ + v[1] * SYN)];
  const hexDe = (c) => (Math.max(0, Math.min(255, Math.round(c[0]))) << 16) | (Math.max(0, Math.min(255, Math.round(c[1]))) << 8) | Math.max(0, Math.min(255, Math.round(c[2])));

  // ---------- la luz de R3 sin sombra proyectada (r3d.js render)
  function luz(n) { const S = R3.SUN, L = R3.LIGHT, ndl = Math.max(0, R3.dot(n, S)), hz = .5 + .5 * n[2];
    return [0, 1, 2].map(j => L.amb * (R3.SKY[j] * hz + R3.BOUNCE[j] * (1 - hz)) + L.sun * ndl * R3.SUNC[j]); }
  // color de R3 tras la saturación (sobre el color ya iluminado)
  function saturar(r, g, b) { const s = R3.LIGHT.sat, l = .3 * r + .59 * g + .11 * b; return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s]; }

  // ---------- texturas planas (RGBA), multiplicadas por G
  // cara con textura propia: en su espacio (u a la derecha, v hacia abajo), con AO del piso, saturación y contorno
  function textura(f) {
    // un triángulo de color liso: su color en una textura del tamaño de la cara
    const t = f.tex || (() => { const w = Math.max(1, Math.round(len(f.E1) * R3.TD)), h = Math.max(1, Math.round(len(f.E2) * R3.TD)), d = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { d[i * 4] = f.col[0]; d[i * 4 + 1] = f.col[1]; d[i * 4 + 2] = f.col[2]; d[i * 4 + 3] = 255; } return { w, h, d }; })();
    const w = t.w, h = t.h, d = new Uint8ClampedArray(w * h * 4), aoK = R3.LIGHT.ao;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + .5) / w, v = (y + .5) / h; if (f.tri && u + v > 1) continue;
      const i = (y * t.w + x) * 4; if (t.d[i + 3] < 128) continue;
      const z = f.O[2] + u * f.E1[2] + v * f.E2[2], ao = 1 - 0.2 * aoK * Math.max(0, 1 - z / 0.7), c = saturar(t.d[i] * ao, t.d[i + 1] * ao, t.d[i + 2] * ao);
      const o = (y * w + x) * 4; d[o] = c[0] * G; d[o + 1] = c[1] * G; d[o + 2] = c[2] * G; d[o + 3] = 255;
    }
    if (!f.sinContorno) contorno({ w, h, d }); return { w, h, d };
  }
  // el borde de lo opaco oscurecido como las aristas de R3
  function contorno(T) { const { w, h, d } = T, tA = Math.min(1, .7 * R3.LIGHT.outline); if (tA <= 0) return;
    const borde = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; if (!d[k * 4 + 3]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !d[(k - 1) * 4 + 3] || !d[(k + 1) * 4 + 3] || !d[(k - w) * 4 + 3] || !d[(k + w) * 4 + 3]) borde[k] = 1; }
    for (let k = 0; k < w * h; k++) if (borde[k]) { const i = k * 4, c = Contorno.oscuro(d[i], d[i + 1], d[i + 2]);
      for (let j = 0; j < 3; j++) d[i + j] = d[i + j] * (1 - tA) + c[j] * tA; } }
  // un recorte de la baldosa de un material (wq × hq m, desde la esquina), saturado y por G; sin contorno (se repite)
  function recorteMaterial(m, wq, hq) {
    const b = m.tex, w = Math.max(1, Math.min(b.w, Math.round(wq * R3.TD))), h = Math.max(1, Math.min(b.h, Math.round(hq * R3.TD))), d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * b.w + x) * 4, o = (y * w + x) * 4, c = saturar(b.d[i], b.d[i + 1], b.d[i + 2]);
      d[o] = c[0] * G; d[o + 1] = c[1] * G; d[o + 2] = c[2] * G; d[o + 3] = b.d[i + 3] < 128 ? 0 : 255; }
    return { w, h, d };
  }
  // la misma textura girada: u' = v, v' = 1 − u (un techo en un rumbo donde su eje u sale vertical en pantalla)
  function transponer(T) {
    const w = T.h, h = T.w, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (x * T.w + (T.w - 1 - y)) * 4, o = (y * w + x) * 4;
      d[o] = T.d[s]; d[o + 1] = T.d[s + 1]; d[o + 2] = T.d[s + 2]; d[o + 3] = T.d[s + 3]; }
    return { w, h, d };
  }
  function hash(T) { let a = 0x811c9dc5 ^ T.w, b = 0x9e3779b9 ^ T.h;
    for (let i = 0; i < T.d.length; i += 4) { const v = T.d[i] | T.d[i + 1] << 8 | T.d[i + 2] << 16 | T.d[i + 3] << 24;
      a = Math.imul(a ^ v, 16777619); b = Math.imul(b ^ (v >>> 3), 2246822519); }
    return (a >>> 0).toString(36) + "." + (b >>> 0).toString(36) + "." + T.w + "x" + T.h; }
  const hashD = (d) => { let a = 0x811c9dc5; for (let i = 0; i < d.length; i++) a = Math.imul(a ^ (d[i] | 0), 16777619); return a >>> 0; };

  // ---------- geometría en pantalla
  const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  function caja(P) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return [x0, y0, x1, y1]; }
  const separadas = (A, B) => A[2] <= B[0] || B[2] <= A[0] || A[3] <= B[1] || B[3] <= A[1];
  // recorte de un polígono convexo por otro (Sutherland–Hodgman)
  function recortar(P, Q) {
    const sQ = Math.sign(area(Q)) || 1; let out = P;
    for (let i = 0; i < Q.length && out.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length], inp = out; out = [];
      const lado = (p) => sQ * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
      for (let j = 0; j < inp.length; j++) { const p = inp[j], q = inp[(j + 1) % inp.length], lp = lado(p), lq = lado(q);
        if (lp >= 0) out.push(p);
        if ((lp >= 0) !== (lq >= 0)) { const t = lp / (lp - lq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } }
    return out;
  }
  // elementos de una variante: caras (polígono y profundidad en cada punto) y accesorios (su rectángulo y una profundidad)
  function elementoCara(F) { const p0 = J(F.O), a = J(F.E1), b = J(F.E2);
    const poli = F.tri ? [p0, [p0[0] + a[0], p0[1] + a[1]], [p0[0] + b[0], p0[1] + b[1]]]
      : [p0, [p0[0] + a[0], p0[1] + a[1]], [p0[0] + a[0] + b[0], p0[1] + a[1] + b[1]], [p0[0] + b[0], p0[1] + b[1]]];
    const det = a[0] * b[1] - a[1] * b[0];
    return { poli, caja: caja(poli), centro: R3.dot(add(F.O, add(sc3(F.E1, .5), sc3(F.E2, .5))), VIEW),
      prof: (s) => { if (Math.abs(det) < 1e-9) return R3.dot(F.O, VIEW); const dx = s[0] - p0[0], dy = s[1] - p0[1];
        const al = (dx * b[1] - dy * b[0]) / det, be = (a[0] * dy - a[1] * dx) / det; return R3.dot(add(F.O, add(sc3(F.E1, al), sc3(F.E2, be))), VIEW); } }; }
  // orden de pintor: "A antes que B" donde se tapan (la de atrás en su punto común), orden topológico, las lejanas primero
  function ordenPintor(E) {
    const n = E.length, antes = Array.from({ length: n }, () => []), grado = new Int32Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (separadas(E[i].caja, E[j].caja)) continue;
      const I = recortar(E[i].poli, E[j].poli); if (I.length < 3 || Math.abs(area(I)) < .5) continue;
      let cx = 0, cy = 0; for (const q of I) { cx += q[0]; cy += q[1]; } const s = [cx / I.length, cy / I.length];
      const di = E[i].prof(s), dj = E[j].prof(s); if (Math.abs(di - dj) < 1e-4) continue;
      if (di > dj) { antes[i].push(j); grado[j]++; } else { antes[j].push(i); grado[i]++; }
    }
    const orden = [], hecho = new Uint8Array(n);
    while (orden.length < n) {
      let best = -1; for (let i = 0; i < n; i++) if (!hecho[i] && grado[i] === 0 && (best < 0 || E[i].centro > E[best].centro)) best = i;
      if (best < 0) for (let i = 0; i < n; i++) if (!hecho[i] && (best < 0 || E[i].centro > E[best].centro)) best = i;   // ciclo
      hecho[best] = 1; orden.push(best); for (const j of antes[best]) grado[j]--;
    }
    const rank = new Int32Array(n); orden.forEach((i, r) => rank[i] = r); return rank;
  }
  // la base de la casa en pantalla: para cada x, la y más baja del borde de abajo de las cajas apoyadas en el piso
  function base(casters, c, s) {
    const quads = [];
    for (const cs of casters) { if (cs.c[2] - cs.h[2] > .3) continue;
      quads.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => J(rot(c, s, [cs.c[0] + sx * cs.h[0] * cs.ax[0][0] + sy * cs.h[1] * cs.ax[1][0], cs.c[1] + sx * cs.h[0] * cs.ax[0][1] + sy * cs.h[1] * cs.ax[1][1], 0])))); }
    let maxY = 0; for (const q of quads) for (const p of q) maxY = Math.max(maxY, p[1]);
    return (x) => { let y = -Infinity;
      for (const q of quads) for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) & 3]; if ((x < a[0]) === (x < b[0])) continue;
        y = Math.max(y, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); }
      return y > -Infinity ? y : maxY; };
  }

  // ---------- todo el catálogo
  // entries: las claves del catálogo (cada una con su rumbo spec.a). Devuelve { piezas: [{nombre, T, x0, y0, w, h}],
  // variantes: { id: [[cuadro, dx, dy, sx, sy, kx, ky, tinte, sortDy, innerZ], …] }, pies: { id: {foot, casters} } }
  function hornear(entries, DET, progreso = () => {}) {
    const TILE = Math.round(128 * DET), disenos = new Map(), texturas = new Map(), piezas = [], variantes = {}, pies = {};
    const st = { caras: 0, lisas: 0, material: 0, propias: 0, accesorios: 0 };
    // una textura deduplicada, cortada en piezas de hasta TILE px (más 1 px de solape): su grilla de cuadros
    function registrar(T, prefijo) {
      const hsh = hash(T); let e = texturas.get(hsh); if (e) return e;
      const id = texturas.size, grid = [];
      for (let y0 = 0; y0 < T.h; y0 += TILE) for (let x0 = 0; x0 < T.w; x0 += TILE) {
        const w = Math.min(T.w - x0, TILE + 1), h = Math.min(T.h - y0, TILE + 1);
        let algo = false; for (let y = y0; y < y0 + h && !algo; y++) for (let x = x0; x < x0 + w; x++) if (T.d[(y * T.w + x) * 4 + 3]) { algo = true; break; }
        if (!algo) continue;   // una pieza toda transparente no va (los huecos de un triángulo, de una reja)
        const nombre = prefijo + id + "_" + (x0 / TILE) + "_" + (y0 / TILE); piezas.push({ nombre, T, x0, y0, w, h }); grid.push({ nombre, x0, y0, w, h }); }
      e = { id, w: T.w, h: T.h, grid }; texturas.set(hsh, e); return e;
    }
    const BLANCO = { w: 8, h: 8, grid: [{ nombre: "_white", x0: 0, y0: 0, w: 8, h: 8 }] };
    // un accesorio: su sprite de R3 (iluminado, con contorno) por tipo y octavo de vuelta, y dónde cae su origen en él
    const sprites = new Map();
    function spriteAcc(a, oct) {
      const k = a.tipo + ":" + (a.kind || "") + ":" + (a.seed ?? "") + ":" + (a.wall ? 1 : 0) + (a.back ? 1 : 0) + (a.big ? 1 : 0) + ":" + oct;
      let e = sprites.get(k); if (e) return e;
      const res = Houses.accesorio(a, oct * Math.PI / 4).render({ groundShadow: false });
      const cv = res.canvas, d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      const T = { w: cv.width, h: cv.height, d: new Uint8ClampedArray(d) }, reg = registrar(T, "a");
      e = { reg, ax: res.ax, ay: res.ay }; sprites.set(k, e); return e;
    }
    const claveDiseno = (spec) => { const { a, ...resto } = spec; return JSON.stringify(resto); };
    Houses.setKit(true);
    try {
    entries.forEach((e, n) => {
      if (n % 16 === 0) progreso(n / entries.length);
      const kd = claveDiseno(e.spec); let D = disenos.get(kd);
      if (!D) { const B3 = Barrio.build3D({ ...e.spec, a: 0 }), s = B3.sc;
        D = { faces: s.faces.filter(f => f.both || f.n[2] > -.5), casters: s.casters, acc: s.acc || [], tex: new Map(), puertas: B3.puertas || [], frenteY: B3.frenteY || 0 }; disenos.set(kd, D); }
      const phi = World.ANG[e.spec.a], c = Math.cos(phi), s = Math.sin(phi), E = [], items = [];
      // ---- caras visibles, en piezas planas: [textura (grilla), O, E1, E2 (el paralelogramo que cubre), tinte]
      for (let fi = 0; fi < D.faces.length; fi++) { const F0 = D.faces[fi]; let n3 = rot(c, s, F0.n);
        if (R3.dot(n3, VIEW) >= -1e-4) { if (!F0.both) continue; n3 = [-n3[0], -n3[1], -n3[2]]; }
        const F = { O: rot(c, s, F0.O), E1: rot(c, s, F0.E1), E2: rot(c, s, F0.E2), tri: F0.tri, n: n3 };
        const A = J(F.E1), B = J(F.E2); if (Math.hypot(A[0], A[1]) < .5 || Math.hypot(B[0], B[1]) < .5 || Math.abs(A[0] * B[1] - A[1] * B[0]) < 1) continue;   // de canto
        st.caras++; const L = luz(n3), sub = [];
        if (!F0.tex && !F0.tri) {
          // color liso: la textura blanca del motor, teñida con el color iluminado
          st.lisas++; const col = saturar(F0.col[0] * L[0], F0.col[1] * L[1], F0.col[2] * L[2]);
          sub.push({ reg: BLANCO, O: F.O, E1: F.E1, E2: F.E2, tinte: hexDe(col), girable: false });
        } else if (F0.tex && F0.tex.mat && hashD(F0.tex.d) === F0.tex.limpia) {
          // material limpio (un techo): baldosas compartidas de hasta 6 m, cada una un recorte de medio metro en medio metro
          st.material++; const m = F0.tex.mat, Wm = len(F.E1), Hm = len(F.E2), nx = Math.max(1, Math.ceil(Wm / m.tw - .01)), ny = Math.max(1, Math.ceil(Hm / m.th - .01));
          const wq = Math.max(.5, Math.min(m.tw, Math.round(Wm / nx * 2) / 2)), hq = Math.max(.5, Math.min(m.th, Math.round(Hm / ny * 2) / 2)), mk = m.key + ":" + wq + "x" + hq;
          let T = D.tex.get(mk); if (!T) { T = recorteMaterial(m, wq, hq); D.tex.set(mk, T); }
          const tn = hexDe(L.map(v => v / G * 255));
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sub.push({ T, O: add(F.O, add(sc3(F.E1, i / nx), sc3(F.E2, j / ny))), E1: sc3(F.E1, 1 / nx), E2: sc3(F.E2, 1 / ny), tinte: tn, girable: true, clave: mk });
        } else {
          // dibujo propio: la cara entera
          st.propias++; let T = D.tex.get(fi); if (!T) { T = textura(F0); D.tex.set(fi, T); }
          sub.push({ T, O: F.O, E1: F.E1, E2: F.E2, tinte: hexDe(L.map(v => v / G * 255)), girable: !F.tri, clave: fi });
        }
        // el contorno de las caras de color liso grandes y de los techos de material (las de dibujo propio lo traen en su textura):
        // una tira de 1 px de textura por dentro de cada borde, del color de la cara llevado a su oscuro (como contorno()), con la
        // textura blanca del motor
        { const lisa = !F0.tex && !F0.tri, mat = F0.tex && F0.tex.mat && hashD(F0.tex.d) === F0.tex.limpia;
          if ((lisa && len(F0.E1) > .6 && len(F0.E2) > .6) || mat) {
            let base; if (lisa) base = saturar(F0.col[0] * L[0], F0.col[1] * L[1], F0.col[2] * L[2]);
            else { const m = F0.tex.mat; if (!m.prom) { const d = m.tex.d; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } m.prom = [r / n, g / n, b / n]; }
              const sp = saturar(m.prom[0], m.prom[1], m.prom[2]); base = [sp[0] * L[0], sp[1] * L[1], sp[2] * L[2]]; }
            const os = Contorno.oscuro(base[0], base[1], base[2]), tA = Math.min(1, .7 * R3.LIGHT.outline), tn = hexDe(base.map((v, j) => v + (os[j] - v) * tA)), th = 1 / R3.TD;
            const e1 = len(F.E1), e2 = len(F.E2), i1 = sc3(F.E1, th / e1), i2 = sc3(F.E2, th / e2), lejos1 = add(F.O, F.E1), lejos2 = add(F.O, F.E2);
            for (const [O, E1, E2] of [[F.O, F.E1, i2], [sub3(lejos2, i2), F.E1, i2], [F.O, i1, F.E2], [sub3(lejos1, i1), i1, F.E2]]) {
              // la orientación que deja escala y skew sanos (la textura blanca es igual de cualquier lado)
              const A2 = J(E1), B2 = J(E2), la = Math.hypot(A2[0], A2[1]) || 1e-9, lb = Math.hypot(B2[0], B2[1]) || 1e-9;
              const qn = Math.min(Math.abs(A2[0]) / la, Math.abs(B2[1]) / lb), qt = Math.min(Math.abs(B2[0]) / lb, Math.abs(A2[1]) / la);
              sub.push(qt > qn ? { reg: BLANCO, O: add(O, E1), E1: E2, E2: sc3(E1, -1), tinte: tn, girable: false, borde: true } : { reg: BLANCO, O, E1, E2, tinte: tn, girable: false, borde: true }); } } }
        // orientación de cada pieza: la normal (u = E1) o la traspuesta (u = E2, v = −E1), la que deja escala y skew sanos
        for (const q of sub) { if (q.reg) continue;
          const A2 = J(q.E1), B2 = J(q.E2), la = Math.hypot(A2[0], A2[1]), lb = Math.hypot(B2[0], B2[1]);
          const qn = Math.min(Math.abs(A2[0]) / la, Math.abs(B2[1]) / lb), qt = Math.min(Math.abs(B2[0]) / lb, Math.abs(A2[1]) / la);
          if (q.girable && qt > qn) { const k = "t:" + q.clave; let Tt = D.tex.get(k); if (!Tt) { Tt = transponer(q.T); D.tex.set(k, Tt); }
            q.O = add(q.O, q.E1); const e1 = q.E1; q.E1 = q.E2; q.E2 = sc3(e1, -1); q.T = Tt; }
          q.reg = registrar(q.T, "c"); }
        const el = elementoCara(F), idx = E.length; E.push(el);
        const zMin = Math.min(F.O[2], F.O[2] + F.E1[2], F.O[2] + F.E2[2], F.O[2] + F.E1[2] + F.E2[2]), pared = Math.abs(F.n[2]) < .1 && zMin <= .3;
        for (const q of sub) items.push({ el: idx, q, pared, F });
      }
      // ---- accesorios: un sprite cada uno, parado en su punto
      for (const a of D.acc) { const P = rot(c, s, [a.x, a.y, a.z]), oct = a.tipo === "tanque" || a.tipo === "maceta" ? 0 : ((Math.round(phi / (Math.PI / 4)) % 8) + 8) % 8;
        const sp = spriteAcc(a, oct), p = J(P), k = 1 / DET, x0 = p[0] - sp.ax * k, y0 = p[1] - sp.ay * k, w = sp.reg.w * k, h = sp.reg.h * k;
        const poli = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], dc = R3.dot(add(P, [0, 0, .5]), VIEW);
        st.accesorios++; const idx = E.length; E.push({ poli, caja: caja(poli), centro: dc, prof: () => dc });
        items.push({ el: idx, acc: { sp, p } }); }
      // ---- orden: innerZ por el orden de pintor; la y de orden de cada pieza, subida lo justo
      const rank = ordenPintor(E), nE = E.length, baseX = base(D.casters, c, s), tiles = [];
      for (const it of items) {
        const r = rank[it.el], iz = nE <= 250 ? r - 125 : Math.round(r * 250 / (nE - 1)) - 125;
        if (it.acc) { const { sp, p } = it.acc, k = 1 / DET, x0 = p[0] - sp.ax * k, y0 = p[1] - sp.ay * k, w = sp.reg.w * k, h = sp.reg.h * k;
          // el sprite del accesorio: el cuadro entero, anclado donde cae su origen, sin skew
          const g = sp.reg.grid[0]; if (sp.reg.grid.length !== 1) console.warn("accesorio en más de una pieza", g.nombre);
          tiles.push({ rank: r, cuadro: g.nombre, p: [x0 + w / 2, y0 + h / 2], sx: k, sy: k, kx: 0, ky: 0, tn: 0xffffff, iz, objetivo: baseX(p[0]), poli: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]] });
          continue; }
        const q = it.q, T = q.reg, A = J(q.E1), B = J(q.E2), a = [A[0] / T.w, A[1] / T.w], b = [B[0] / T.h, B[1] / T.h];
        const sx = a[0], sy = b[1], kx = b[0] / b[1], ky = a[1] / a[0];
        for (const g of T.grid) {
          const cu = g.x0 + g.w / 2, cv = g.y0 + g.h / 2, P = add(q.O, add(sc3(q.E1, cu / T.w), sc3(q.E2, cv / T.h))), p = J(P);
          let objetivo;
          if (it.pared) { const F = it.F, d = sub3(P, F.O), L1 = len(F.E1), uu = Math.max(0, Math.min(1, (d[0] * F.E1[0] + d[1] * F.E1[1] + d[2] * F.E1[2]) / (L1 * L1))), Gp = add(F.O, add(sc3(F.E1, uu), F.E2)); objetivo = J([Gp[0], Gp[1], 0])[1]; }
          else objetivo = baseX(p[0]);
          const q0 = add(q.O, add(sc3(q.E1, g.x0 / T.w), sc3(q.E2, g.y0 / T.h))), da = J(sc3(q.E1, g.w / T.w)), db = J(sc3(q.E2, g.h / T.h)), j0 = J(q0);
          tiles.push({ rank: r, cuadro: g.nombre, p, sx: g.nombre === "_white" ? A[0] / 8 : sx, sy: g.nombre === "_white" ? B[1] / 8 : sy, kx, ky, tn: q.tinte, iz, objetivo, borde: !!q.borde,
            poli: [j0, [j0[0] + da[0], j0[1] + da[1]], [j0[0] + da[0] + db[0], j0[1] + da[1] + db[1]], [j0[0] + db[0], j0[1] + db[1]]] });
        }
      }
      // la y de orden: la buscada, o la de una pieza de la casa que tapa y va antes en el orden de pintor, si es más baja
      tiles.sort((A, B) => A.rank - B.rank);
      const cajas = tiles.map(t => caja(t.poli));
      for (let i = 0; i < tiles.length; i++) { let k = tiles[i].objetivo;
        for (let j = 0; j < i; j++) { if (tiles[j].rank === tiles[i].rank || tiles[j].clave <= k || separadas(cajas[i], cajas[j])) continue;
          const I = recortar(tiles[i].poli, tiles[j].poli); if (I.length >= 3 && Math.abs(area(I)) >= .5) k = tiles[j].clave; }
        tiles[i].clave = k; }
      for (const t of tiles) if (t.borde) t.clave += .02;   // el borde, encima de su cara (misma y de orden y mismo innerZ)
      const r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 1e4) / 1e4;
      variantes[e.id] = tiles.map(t => [t.cuadro, r2(t.p[0]), r2(t.p[1]), r4(t.sx), r4(t.sy), r4(t.kx), r4(t.ky), t.tn, r2(t.clave - t.p[1]), t.iz]);
      // el pie de la casa (de donde cuelgan el colisionador y la sombra): el punto más al frente de las cajas apoyadas
      let foot = [0, 0], fy = 1e9;
      for (const cs of D.casters) { if (cs.c[2] - cs.h[2] > .3) continue;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const q = rot(c, s, [cs.c[0] + sx * cs.h[0] * cs.ax[0][0] + sy * cs.h[1] * cs.ax[1][0], cs.c[1] + sx * cs.h[0] * cs.ax[0][1] + sy * cs.h[1] * cs.ax[1][1], 0]);
          if (q[1] < fy - 1e-6) { fy = q[1]; foot = [q[0], q[1]]; } } }
      pies[e.id] = { foot, casters: D.casters.map(cs => ({ c: rot(c, s, cs.c), ax: cs.ax.map(v => rot(c, s, v)), h: cs.h, noGround: cs.noGround })),
        // las puertas del frente: de dónde a dónde (m, desde el origen de la casa) y hacia dónde es afuera
        puertas: D.puertas.map(([a, b]) => ({ a: rot(c, s, [a, D.frenteY, 0]), b: rot(c, s, [b, D.frenteY, 0]), afuera: rot(c, s, [0, -1, 0]) })) };
    });
    } finally { Houses.setKit(false); }
    return { piezas, variantes, pies, nTexturas: texturas.size, nDisenos: disenos.size, st };
  }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return { hornear, G };
})();
