// ===================== arboles.js — árboles procedurales (esqueleto tipo L-system en 3D, follaje en racimos) =====================
// Cada árbol se dibuja en la misma proyección oblicua del barrio (18 px/m, corrimiento K, altura × CZ) y se parte en piezas:
// el tronco (fijo) y cada rama principal con sus ramitas y su follaje (anclada en su base, para que se meza en WeedJS).
// El editor muestra el árbol armado con esas mismas piezas; la exportación las guarda en una hoja de sprites.
const Arboles = (() => {
  // Se dibujan a 1/0,6 de la densidad del barrio y se muestran al 0,6, igual que los personajes LPC del juego:
  // así hojas y personas tienen el mismo tamaño de píxel y el mismo filtrado.
  const ESCALA = .6, K = R3.K, SYN = R3.SYN, CZ = R3.CZ, SF = R3.SF / ESCALA;
  // otoño: CALVOS de los racimos ya quedaron pelados (sólo la rama) y a los demás les queda HOJAS de sus hojas; en total
  // les queda ~1/4: se ven las ramas y a través de la copa
  const CALVOS = .4, HOJAS = .4;
  // los árboles de vereda de Buenos Aires pasan los techos: la altura de cada especie, por ALTURA (la copa, más abierta), y
  // RAMAS_MAS ramas principales más que las de su especie (sin hojas, se ve el esqueleto)
  const ALTURA = 1.5, RAMAS_MAS = 1;
  // especies: colores de hoja (claro, medio, oscuro), forma y tamaño. "rico" = qué tanto aparecen en zonas ricas (0..1)
  const ESPECIES = {
    fresno:    { hojas: [[150, 196, 82], [92, 150, 58], [44, 92, 40]], alto: [4.0, 5.6], copa: 1.15, ramas: [3, 4], abre: .62, hoja: 1, rico: .5 },
    platano:   { hojas: [[164, 200, 96], [104, 160, 64], [52, 102, 44]], alto: [5.0, 6.5], copa: 1.35, ramas: [3, 5], abre: .7, hoja: 1.25, rico: .7 },
    paraiso:   { hojas: [[110, 168, 70], [60, 120, 48], [28, 72, 36]], alto: [3.4, 4.7], copa: 1.05, ramas: [3, 4], abre: .78, hoja: .9, rico: .35 },
    jacaranda: { hojas: [[196, 150, 236], [150, 104, 210], [96, 62, 150]], alto: [4.0, 5.3], copa: 1.2, ramas: [3, 4], abre: .85, hoja: 1, rico: .6, flor: true },
    tipa:      { hojas: [[214, 196, 86], [168, 158, 58], [104, 104, 40]], alto: [4.3, 5.9], copa: 1.25, ramas: [3, 5], abre: .8, hoja: .9, rico: .55 },
    otono:     { hojas: [[244, 176, 70], [214, 124, 40], [146, 72, 30]], alto: [3.7, 5.3], copa: 1.1, ramas: [3, 4], abre: .66, hoja: 1, rico: .4 },
    // propias de un barrio (sólo salen si el barrio las pide: Parque Chas). Tilo: copa redonda y tupida, verde oscuro;
    // crespón: arbolito de vereda angosta, flores rosas; ficus: copa densa y lustrosa, verde muy oscuro
    tilo:      { hojas: [[150, 186, 78], [84, 134, 52], [40, 82, 36]], alto: [4.2, 5.6], copa: 1.3, ramas: [4, 5], abre: .55, hoja: 1.15, rico: .6, propia: true },
    crespon:   { hojas: [[244, 170, 206], [212, 112, 168], [148, 64, 112]], alto: [2.8, 3.8], copa: .9, ramas: [3, 4], abre: .8, hoja: .85, rico: .5, flor: true, propia: true },
    ficus:     { hojas: [[96, 150, 74], [52, 108, 50], [24, 64, 32]], alto: [3.8, 5.0], copa: 1.35, ramas: [4, 5], abre: .6, hoja: 1.2, rico: .5, propia: true },
  };
  const VARIANTES = 3;
  const TIPOS = Object.keys(ESPECIES).flatMap(e => Array.from({ length: VARIANTES }, (_, v) => e + "_" + v));
  const TRONCO = [[150, 108, 72], [104, 72, 48], [62, 42, 30]];
  const OUT = [24, 30, 18];
  const cache = new Map();

  // elegir un tipo: en las zonas ricas más plátanos y jacarandás, en las pobres más paraísos y fresnos. pesos (opcional,
  // de un barrio real): {especie: peso}, en vez de la riqueza; sin pesos no salen las especies propias de un barrio
  function pick(r, riqueza = .5, pesos = null) {
    if (pesos) { const ks = Object.keys(pesos).filter(k => ESPECIES[k]); let t = r() * ks.reduce((a, k) => a + pesos[k], 0), e = ks[0];
      for (const k of ks) { t -= pesos[k]; if (t <= 0) { e = k; break; } } return e + "_" + r.int(0, VARIANTES - 1); }
    const ks = Object.keys(ESPECIES).filter(k => !ESPECIES[k].propia); let tot = 0; const w = ks.map(k => { const q = 1 - Math.abs(ESPECIES[k].rico - riqueza) * 1.2; tot += Math.max(.08, q); return Math.max(.08, q); });
    let t = r() * tot, e = ks[0]; for (let i = 0; i < ks.length; i++) { t -= w[i]; if (t <= 0) { e = ks[i]; break; } }
    return e + "_" + r.int(0, VARIANTES - 1);
  }

  // ---- esqueleto: tronco + ramas (recursivo, como un L-system con ángulos y largos que decaen)
  function esqueleto(tipo) {
    const [esp, v] = tipo.split("_"), E = ESPECIES[esp], r = R3.rng(0x7a3e + v * 977 + esp.length * 131 + esp.charCodeAt(0) * 17);
    const H = r.uni(E.alto[0], E.alto[1]) * ALTURA, troncoH = H * r.uni(.32, .42), segs = [], racimos = [];
    const rot = (d, ax, a) => { // Rodrigues
      const c = Math.cos(a), s = Math.sin(a), k = ax, dot = k[0] * d[0] + k[1] * d[1] + k[2] * d[2];
      return [d[0] * c + (k[1] * d[2] - k[2] * d[1]) * s + k[0] * dot * (1 - c), d[1] * c + (k[2] * d[0] - k[0] * d[2]) * s + k[1] * dot * (1 - c), d[2] * c + (k[0] * d[1] - k[1] * d[0]) * s + k[2] * dot * (1 - c)]; };
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const perp = (d) => norm(Math.abs(d[2]) < .9 ? [-d[1], d[0], 0] : [1, 0, 0]);
    // tronco en 3 tramos con algo de curva
    let p = [0, 0, 0], d = norm([r.uni(-.08, .08), r.uni(-.08, .08), 1]), rad = .16 + H * .012;
    for (let i = 0; i < 3; i++) { const L = troncoH / 3, q = [p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L]; segs.push({ a: p, b: q, r0: rad, r1: rad * .92, rama: 0 }); p = q; rad *= .92; d = norm([d[0] + r.uni(-.1, .1), d[1] + r.uni(-.1, .1), d[2]]); }
    const n = r.int(E.ramas[0], E.ramas[1]) + RAMAS_MAS, yaw0 = r() * Math.PI * 2;
    function rama(a, dir, L, rr, prof, id) {
      const b = [a[0] + dir[0] * L, a[1] + dir[1] * L, a[2] + dir[2] * L]; segs.push({ a, b, r0: rr, r1: rr * .7, rama: id });
      if (prof >= 3 || L < .7) { racimos.push({ c: b, R: (.85 + r() * .5) * E.copa, rama: id }); return; }
      if (prof >= 1 && r() < .55) racimos.push({ c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], R: (.6 + r() * .3) * E.copa, rama: id });
      const hijos = prof === 0 ? 2 + (r() < .5 ? 1 : 0) : 2, ax0 = perp(dir);
      for (let h = 0; h < hijos; h++) {
        const ax = rot(ax0, dir, (h / hijos) * Math.PI * 2 + r.uni(-.5, .5));
        let nd = norm(rot(dir, ax, r.uni(.35, .7) * (prof === 0 ? 1 : .9)));
        nd = norm([nd[0], nd[1], nd[2] + .25]);                 // las ramas buscan la luz
        rama(b, nd, L * r.uni(.62, .78), rr * .68, prof + 1, id);
      }
    }
    for (let i = 0; i < n; i++) {
      const yaw = yaw0 + (i / n) * Math.PI * 2 + r.uni(-.35, .35), pitch = E.abre * r.uni(.75, 1.15);
      const dir = norm([Math.cos(yaw) * Math.sin(pitch), Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch)]);
      const base = segs[2].a.map((x, k) => x + (segs[2].b[k] - x) * r.uni(.3, 1));
      rama(base, dir, (H - troncoH) * r.uni(.42, .55), rad * .72, 0, i + 1);
    }
    // la cima, sobre el tronco (desde y grosor: la guía que la une a él, que se ve cuando la cima pierde las hojas)
    racimos.push({ c: [p[0], p[1], p[2] + (H - troncoH) * .55], R: 1.2 * E.copa, rama: 1 + r.int(0, n - 1), cima: true, desde: p, grosor: rad * .55 });
    return { E, H, segs, racimos, n, r };
  }

  // proyección al sprite (pie del árbol = 0,0; px enteros los hace el que dibuja)
  const PX = (x, y, z) => [(x + K * y) * SF, -(y * SYN + z * CZ) * SF];
  const prof = (x, y, z) => y - z * .35;          // mayor = más lejos de la cámara (se dibuja antes)

  // ---- dibujo estilo LPC: racimos de hojas como manchas redondeadas con 4 tonos y contorno oscuro, ramas con contorno,
  // y pocos racimos (separados) para que se vea a través de la copa
  const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const PAL = {   // [contorno, muy oscuro, oscuro, medio, claro, brillo]
    fresno:    [0x14260c, 0x223f12, 0x33601a, 0x4c8624, 0x72ae34, 0xa6d458].map(hex),
    platano:   [0x18280e, 0x2a4614, 0x3e6a1e, 0x5a9028, 0x84b83c, 0xb8de64].map(hex),
    paraiso:   [0x0f1e0a, 0x1a3410, 0x274e16, 0x3a721e, 0x58982a, 0x88c048].map(hex),
    jacaranda: [0x24163c, 0x3a2662, 0x553a8c, 0x7656b4, 0x9c7ed8, 0xcab2f2].map(hex),
    tipa:      [0x2a260c, 0x454010, 0x645c18, 0x8a8024, 0xb4a836, 0xdcd266].map(hex),
    otono:     [0x2e1608, 0x4e240c, 0x783812, 0xa8541c, 0xd27e2c, 0xf2b25a].map(hex),
    tilo:      [0x13240c, 0x1f3a12, 0x2f561a, 0x467a24, 0x689e34, 0x9cc85a].map(hex),
    crespon:   [0x3a1428, 0x5c1e3e, 0x86305a, 0xb44c80, 0xdc7aa8, 0xf6b6d2].map(hex),
    ficus:     [0x0c1a0a, 0x16300f, 0x234a17, 0x346820, 0x4e8a2c, 0x78b048].map(hex),
  };
  // el contorno de cada racimo: el tono oscuro de la hoja, oscurecido un poco (no casi negro)
  for (const k in PAL) PAL[k][0] = PAL[k][2].map(v => Math.round(v * .62));
  const BARK = [0xa07a52, 0x74553a, 0x4e3824, 0x3a2818, 0x3c2a1a].map(hex);   // luz, medio, sombra, contorno, surco
  function render(tipo) {
    if (cache.has(tipo)) return cache.get(tipo);
    const { E, segs, racimos, n, r } = esqueleto(tipo), esp = tipo.split("_")[0], pal = PAL[esp] || PAL.fresno;
    // luz en pantalla: de arriba a la izquierda (como el sol del barrio visto desde la cámara)
    const LX = -.55, LY = -.6, LZ = .58;
    // elementos: tramos de rama y racimos, cada uno con su rama (0 = tronco) y su profundidad
    const el = [];
    for (const sg of segs) { const m = [(sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2, (sg.a[2] + sg.b[2]) / 2]; el.push({ t: 0, sg, rama: sg.rama, d: prof(...m) }); }
    // la cima flota sobre el tronco: con pocas hojas se vería suelta, así que una guía la une a él
    for (const c of racimos) if (c.cima) { const a = c.desde, b = c.c;
      el.push({ t: 0, sg: { a, b, r0: c.grosor, r1: c.grosor * .6, rama: c.rama }, rama: c.rama, d: prof((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2) }); }
    // un azar aparte para el otoño (el mismo para <tipo> y <tipo>_c), así el esqueleto y las hojas que quedan son los de la copa llena
    const [, vv] = tipo.split("_"), cae = R3.rng(0x0702 + vv * 977 + esp.length * 131 + esp.charCodeAt(0) * 17);
    // menos racimos y más chicos que el follaje "lleno": deja huecos entre ellos
    // follaje: cada racimo es una nube de "rosetas" (5 a 7 hojas en punta que salen de un centro), como en los árboles
    // dibujados del barrio. Las de arriba a la izquierda, más claras; las de abajo y de adentro, más oscuras.
    const LW = (() => { const v = [-.55, -.38, .74], l = Math.hypot(...v); return v.map(x => x / l); })(), Htop = Math.max(...racimos.map(c => c.c[2])) || 1;
    // otoño: a cada racimo se le sortea si ya quedó pelado, y a cada roseta si ya se cayó
    for (const c of racimos) { if (r() < .16) continue;
      const Rm = c.R * .62, N = Math.round(Rm * Rm * 34 * E.hoja), deja = cae() < CALVOS ? 0 : HOJAS;
      for (let k = 0; k < N; k++) {
        let u = r() * 2 - 1, th = r() * Math.PI * 2; const sq = Math.sqrt(1 - u * u), n3 = [sq * Math.cos(th), sq * Math.sin(th), u];
        if (n3[1] > .55 && r() < .6) continue;                                     // las de atrás casi no se ven: menos trabajo
        const rr = Rm * (.55 + r() * .45), p3 = [c.c[0] + n3[0] * rr, c.c[1] + n3[1] * rr, c.c[2] + n3[2] * rr * .85];
        const lit = n3[0] * LW[0] + n3[1] * LW[1] + n3[2] * LW[2], ao = (1 - Math.min(1, p3[2] / Htop)) * .9 + (rr < Rm * .7 ? .5 : 0);
        const tono = Math.max(1, Math.min(4, Math.round(3.3 + lit * 1.5 - ao * .8 + (r() - .5) * .6)));
        el.push({ t: 1, p: p3, tono, rama: c.rama, d: prof(...p3), n: 5 + r.int(0, 2), rot: r() * Math.PI * 2, L: (3.6 + r() * 1.6) * SF / 30, brillo: lit > .55 && r() < .6, cayo: cae() >= deja });
      } }
    el.sort((p, q) => q.d - p.d);
    // caja total
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const grow = (px, py, m) => { x0 = Math.min(x0, px - m); x1 = Math.max(x1, px + m); y0 = Math.min(y0, py - m); y1 = Math.max(y1, py + m); };
    for (const e of el) { if (e.t === 0) { for (const q of [e.sg.a, e.sg.b]) { const [px, py] = PX(...q); grow(px, py, e.sg.r0 * SF + 3); } }
      else { const [px, py] = PX(...e.p); grow(px, py, e.L * 2 + 3); } }
    x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2; x1 = Math.ceil(x1) + 2; y1 = Math.ceil(y1) + 2;
    const Wc = x1 - x0, Hc = y1 - y0;
    // una capa por rama (0 = tronco)
    const capas = Array.from({ length: n + 1 }, () => new Uint8ClampedArray(Wc * Hc * 4));
    const put = (buf, x, y, c, a = 255) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= Wc || y >= Hc) return; const i = (y * Wc + x) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a; };
    const disc = (buf, cx, cy, rad, fn) => { const R2 = rad * rad; for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      const dx = x + .5 - cx, dy = y + .5 - cy, d2 = dx * dx + dy * dy; if (d2 <= R2) fn(x, y, dx / rad, dy / rad, d2 / R2); } };
    // una hoja en punta: más ancha a un tercio del largo; contorno 1 px más oscuro, base oscura y punta más clara
    const hoja = (buf, x, y, ux, uy, len, wid, T, brilla) => { const l = Math.hypot(ux, uy); ux /= l; uy /= l; len *= l;
      const hw = (t) => t < 0 || t > 1 ? -1 : wid * Math.pow(t < .35 ? t / .35 : (1 - t) / .65, .7);
      const xa = Math.floor(Math.min(x, x + ux * len) - wid - 2), xb = Math.ceil(Math.max(x, x + ux * len) + wid + 2), ya = Math.floor(Math.min(y, y + uy * len) - wid - 2), yb = Math.ceil(Math.max(y, y + uy * len) + wid + 2);
      for (const pase of [0, 1]) for (let py = ya; py <= yb; py++) for (let px = xa; px <= xb; px++) {
        const dx = px + .5 - x, dy = py + .5 - y, t = (dx * ux + dy * uy) / len, v = Math.abs(dx * -uy + dy * ux), w = hw(t);
        if (pase === 0) { if (w >= 0 ? v <= w + 1 : (t > -1.2 / len && t < 1 + 1.2 / len && v < 1)) put(buf, px, py, pal[Math.max(0, T - 2)]); continue; }
        if (w < 0 || v > w) continue;
        let k = t < .3 ? T - 1 : T; if (t > .62 && (brilla || (dx * -uy + dy * ux) * (uy - ux) < 0)) k = T + 1; if (brilla && t > .78) k = 5;
        put(buf, px, py, pal[Math.max(1, Math.min(5, k))]); } };
    const esCorteza = (buf, x, y) => { if (x < 0 || y < 0 || x >= Wc || y >= Hc) return false; const i = (y * Wc + x) * 4; if (!buf[i + 3]) return false;
      for (let k = 0; k < 3; k++) if (buf[i] === BARK[k][0] && buf[i + 1] === BARK[k][1] && buf[i + 2] === BARK[k][2]) return true; return false; };
    for (const e of el) {
      const buf = capas[e.rama];
      if (e.t === 0) {   // rama: primero todo el contorno del tramo, después la corteza (luz de un lado, surcos a lo largo)
        const sg = e.sg, [ax, ay] = PX(...sg.a), [bx, by] = PX(...sg.b), L = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(L)), tx = (bx - ax) / (L || 1), ty = (by - ay) / (L || 1);
        const base = sg.rama === 0 && sg.a[2] === 0;
        for (const pase of [0, 1]) for (let i = 0; i <= steps; i++) { const t = i / steps, x = ax + (bx - ax) * t - x0, y = ay + (by - ay) * t - y0;
          const rad = Math.max(.7, (sg.r0 + (sg.r1 - sg.r0) * t) * SF * (base ? 1 + .4 * Math.pow(Math.max(0, 1 - t * 6), 2) : 1));
          // contorno sin la media tapa de atrás del arranque: donde una rama sale de otra no queda la raya oscura
          if (pase === 0) disc(buf, x, y, rad + 1, (px, py) => { if ((px + .5 - (ax - x0)) * tx + (py + .5 - (ay - y0)) * ty < .5) return; if (!esCorteza(buf, px, py)) put(buf, px, py, BARK[3]); });
          else disc(buf, x, y, rad, (px, py) => {
            const dx = px + .5 - x, dy = py + .5 - y, side = (dx * -ty + dy * tx) / rad;                 // -1..1 a través de la rama
            let c = side < -.45 ? BARK[0] : side > .4 ? BARK[2] : BARK[1];
            if (rad > 2.5 && ((Math.round(side * rad * .9 + 7) & 3) === 0) && ((px * 3 + py * 5) & 3)) c = BARK[4];   // surcos
            put(buf, px, py, c); }); }
      } else {           // roseta: centro oscuro y hojas en punta (contorno, cuerpo, punta clara del lado de la luz)
        // una que se cayó gasta el azar de sus hojas (el ángulo y el largo de cada una) sin pintar: las demás no cambian
        if (e.cayo) { for (let k = 0; k < 2 * e.n; k++) r(); continue; }
        const [cx, cy] = PX(...e.p), X = cx - x0, Y = cy - y0, T = e.tono;
        disc(buf, X, Y, e.L * .32, (px, py) => put(buf, px, py, pal[Math.max(0, T - 2)]));
        const hojas = []; for (let k = 0; k < e.n; k++) { const a = e.rot + k / e.n * Math.PI * 2 + (r() - .5) * .5; hojas.push(a); }
        hojas.sort((p, q) => Math.sin(p) - Math.sin(q));                             // las que apuntan hacia abajo (hacia la cámara), al final
        for (const a of hojas) hoja(buf, X, Y, Math.cos(a), Math.sin(a) * .78, e.L * (.85 + r() * .3), Math.max(1.2, e.L * .3), T, e.brillo && Math.sin(a) < .2);
      }
    }
    // tronco pintado a la cal ("<tipo>_c", árboles de vereda): la corteza del tronco, blanca hasta 1,2 m, con el borde de arriba
    // desparejo (pincelada a mano) y la cal gastada en los surcos
    if (tipo.endsWith("_c")) { const [fx, fy] = PX(0, 0, 0), c0 = capas[0], top = fy - y0 - 1.2 * CZ * SF;
      const CAL = [[240, 238, 230], [222, 220, 212], [180, 180, 176], [84, 82, 78], [200, 198, 190]];
      for (let y = Math.max(0, Math.floor(top - 3)); y < Hc; y++) for (let x = 0; x < Wc; x++) { const i = (y * Wc + x) * 4; if (!c0[i + 3]) continue;
        if (y < top + ((x * 7 + 3) % 5) - 2) continue;
        for (let k = 0; k < 5; k++) if (c0[i] === BARK[k][0] && c0[i + 1] === BARK[k][1] && c0[i + 2] === BARK[k][2]) { const c = CAL[k]; c0[i] = c[0]; c0[i + 1] = c[1]; c0[i + 2] = c[2]; break; } } }
    // piezas: recortadas a su contenido, con el ancla en la base de la rama (el tronco, en el pie)
    const bases = [[0, 0, 0]]; for (let i = 1; i <= n; i++) { const sg = segs.find(q => q.rama === i); bases.push(sg ? sg.a : [0, 0, 0]); }
    const piezas = [];
    capas.forEach((d, i) => {
      let a = 1e9, b = 1e9, e = -1, f = -1;
      for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) if (d[(y * Wc + x) * 4 + 3]) { if (x < a) a = x; if (x > e) e = x; if (y < b) b = y; if (y > f) f = y; }
      if (e < 0) return;
      // contorno (contorno.js): 1 px por fuera, que a la escala del juego mide 0,6 px de mundo (más fino que el de los personajes:
      // cada racimo ya trae su borde y con más grosor la copa quedaba recargada); en la base de una rama no, que sale de otra rama
      const T = typeof Contorno === "undefined" ? 0 : Math.max(1, Contorno.grosor(ESCALA) - 1);
      const w = e - a + 1 + 2 * T, h = f - b + 1 + 2 * T, cut = document.createElement("canvas"); cut.width = w; cut.height = h;
      const id = new ImageData(w, h); for (let y = 0; y < h - 2 * T; y++) id.data.set(d.subarray(((y + b) * Wc + a) * 4, ((y + b) * Wc + a + w - 2 * T) * 4), ((y + T) * w + T) * 4);
      const [bx, by] = PX(...bases[i]), ux = bx - x0 - a + T, uy = by - y0 - b + T;
      if (T) { const sg = segs.find(q => q.rama === i), R = i > 0 && sg ? sg.r0 * SF + T + 2 : 0;
        Contorno.aplicar(id.data, w, h, T, R ? (x, y) => (x + .5 - ux) ** 2 + (y + .5 - uy) ** 2 < R * R : null); }
      cut.getContext("2d").putImageData(id, 0, 0);
      piezas.push({ canvas: cut, i, ax: ux / w, ay: uy / h, dx: bx, dy: by, w, h, prof: prof(...bases[i]), sway: i > 0 });
    });
    // orden dentro del árbol: las ramas de atrás antes que el tronco, las de adelante después
    piezas.sort((p, q) => q.prof - p.prof || (p.i === 0 ? -1 : q.i === 0 ? 1 : 0));
    const it = piezas.findIndex(q => q.i === 0); piezas.forEach((p, k) => p.z = k - it);
    // árbol completo (para el editor): las piezas superpuestas en ese orden
    const full = document.createElement("canvas"); full.width = Wc; full.height = Hc; const fg = full.getContext("2d");
    for (const p of piezas) fg.drawImage(p.canvas, Math.round(p.dx - x0 - p.ax * p.w), Math.round(p.dy - y0 - p.ay * p.h));
    // versión a la escala del barrio (filtrada como la ve el juego), para el editor
    const vw = Math.max(1, Math.round(Wc * ESCALA)), vh = Math.max(1, Math.round(Hc * ESCALA)), vis = document.createElement("canvas"); vis.width = vw; vis.height = vh;
    const vg = vis.getContext("2d"); vg.imageSmoothingEnabled = true; vg.imageSmoothingQuality = "high"; vg.drawImage(full, 0, 0, vw, vh);
    const res = { tipo, canvas: full, ox: -x0, oy: -y0, w: Wc, h: Hc, piezas, radio: segs[0].r0, escala: ESCALA, vista: { canvas: vis, ox: -x0 * ESCALA, oy: -y0 * ESCALA, w: vw, h: vh } };
    cache.set(tipo, res); return res;
  }
  function clear() { cache.clear(); }
  return { ESPECIES, TIPOS, ESCALA, pick, render, clear };
})();
