// ===================== barrio.js — el barrio como datos (en metros) =====================
// Una sola generación para todo: el visor la dibuja y la exportación la hornea para WeedJS, así lo que se ve es lo que
// se exporta. Las casas, tapiales y postes salen de un catálogo compartido (ángulos cuantizados, medidas redondeadas),
// recortado a "variedad de casas" para que entren en el atlas del juego.
const Barrio = (() => {
  // las casas se hornean en los mismos 48 rumbos que las calles (los de los autos): así quedan paralelas a su vereda
  const aIdx = (a) => World.angIdx(a), qa = (a) => World.ANG[World.angIdx(a)], Q = Math.PI / 24;
  const Wb = (w, step) => Math.max(3, Math.floor(w / step + 1e-6) * step);
  const Db = (d, deep) => deep ? (d < 6 ? 5 : d < 8 ? 7 : d < 10 ? 9 : 11) : d;
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const EN_CALLE = /^(u_valla|u_cono|c_volquete|u_contenedor|c_palomas|yy_|gd_|obra_material)/;
  // ocupación (m): lo que reserva cada cosa, para que nada se pise
  const RAD = [["k_gauchito", .9], ["k_virgen", .7], ["k_mantero", .9], ["k_pelopincho", 1.2], ["k_cucha", .6], ["k_", .35], ["b_tendedero", 1.6], ["b_mesa_patio", 1.4], ["b_arco", 1.4], ["b_bolsones", .7], ["b_pallets", .6], ["b_viejo", .45], ["b_mujer", .4], ["b_", .3], ["c_volquete", 2.2], ["c_puesto", 1.3], ["c_chori", 1.1], ["c_mesa_bar", 1], ["c_moto", .7], ["c_bici", .6], ["c_perro", .35], ["c_gato", .2], ["c_palomas", .5], ["c_buzon", .3], ["c_hidrante", .2], ["pz_monumento", 2.2], ["pz_fuente", 2.5], ["pz_calesita", 2.6], ["pz_glorieta", 3], ["pz_jacaranda", .5], ["pz_palo_borracho", .5], ["pz_", 1.2], ["plm_santarita", .7], ["plm_", .35], ["pl_", .22], ["yy_", .2], ["arbol", .4], ["u_farol", .2], ["u_semaforo", .18], ["u_cono", .14], ["u_valla", .45], ["u_contenedor", .8], ["u_campana", .5], ["u_tablero", .35], ["u_caja", .3],
    ["u_refugio", 1.2], ["u_kiosco", 1.5], ["carro_cartonero", 1.0], ["chango", .5], ["gomas", .55], ["chapas", .5], ["u_tanque", .6], ["u_banco", .9], ["u_parada", .25], ["u_cesto", .3], ["u_poste_trafo", .45], ["canasto", .35], ["cartel", .2], ["pizarra", .3], ["obra_material", .7], ["bolsas", .35], ["parrilla", .7], ["pileta", 1.4]];
  // colisión (m): sólo lo que frena un auto
  const COLR = [["k_gauchito", .6], ["k_virgen", .45], ["k_heladera", .35], ["k_cucha", .45], ["b_tendedero", .1], ["b_mesa_patio", .9], ["b_bolsones", .5], ["b_pallets", .45], ["b_tacho", .3], ["b_viejo", .25], ["b_mujer", .2], ["c_volquete", 1.6], ["c_puesto", .8], ["c_chori", .7], ["c_moto", .4], ["c_buzon", .2], ["c_hidrante", .12], ["pz_monumento", 1.6], ["pz_fuente", 2.2], ["pz_calesita", 2.2], ["pz_glorieta", 2.4], ["pz_jacaranda", .3], ["pz_palo_borracho", .35], ["pz_hamacas", .9], ["pz_pingpong", .9], ["arbol", .28], ["u_farol", .14], ["u_semaforo", .12], ["cartel", .07], ["canasto", .08], ["u_contenedor", .75], ["u_campana", .55],
    ["u_refugio", .9], ["u_kiosco", 1.1], ["carro_cartonero", .7], ["u_tanque", .45], ["u_banco", .45], ["u_parada", .08], ["u_cesto", .1], ["u_poste_trafo", .22], ["u_valla", .35], ["obra_material", .5], ["parrilla", .55], ["pileta", 1.3], ["u_tablero", .3], ["u_caja", .25]];
  const lookup = (tbl, n, d) => { for (const [p, v] of tbl) if (n.startsWith(p)) return v; return d; };
  const SH = (n) => n.startsWith("plm_") ? "sh_small" : n.startsWith("u_farol") || n.startsWith("u_poste") || n.startsWith("u_parada") ? "sh_pole" : n.startsWith("u_cesto") || n.startsWith("u_banco") || n.startsWith("u_kiosco") ? "sh_small" : n.startsWith("u_contenedor") || n.startsWith("canasto") || n.startsWith("u_campana") ? "sh_small" : null;
  // colores de autos: el juego elige el modelo y usa este color si el modelo lo tiene; "poli" = patrullero, "burnt" = chatarra
  const COLORES = [["red", 1.6], ["white", 1.6], ["black", 1.4], ["blue", 1.4], ["yellow", 1], ["poli", .4]];
  const pickW = (r, tbl) => { let t = tbl.reduce((a, b) => a + b[1], 0) * r(); for (const [n, w] of tbl) { t -= w; if (t <= 0) return n; } return tbl[0][0]; };

  function generate(SEED, C, F) {
    const W = World.generate(SEED), r = R3.rng(SEED ^ 0x5bd1e995), rx = R3.rng(SEED ^ 0x27d4eb2f);
    const rz = R3.rng(SEED ^ 0x1b873593);   // yuyos nuevos (yuyos_03): sorteo aparte, así lo demás no cambia   // rx: props nuevos (no corre el sorteo de lo demás)
    const occ = new Set(), OC = .4;
    function claim(x, y, rad) { const keys = []; for (let i = Math.floor((x - rad) / OC); i <= Math.floor((x + rad) / OC); i++) for (let j = Math.floor((y - rad) / OC); j <= Math.floor((y + rad) / OC); j++) {
        const cx = (i + .5) * OC, cy = (j + .5) * OC; if ((cx - x) ** 2 + (cy - y) ** 2 <= (rad + OC * .5) ** 2) { const k = i * 100000 + j; if (occ.has(k)) return false; keys.push(k); } }
      keys.forEach(k => occ.add(k)); return true; }
    const conGente = C.conGente !== 0, conAutos = C.conAutos !== 0;
    const PL = C.plantas ?? 1;   // cuántas plantas (1 = como antes)
    // ---- catálogo
    const cat = new Map(), objs = [];
    function want(spec) { const k = JSON.stringify(spec); let e = cat.get(k); if (!e) { e = { spec, n: 0, id: cat.size }; cat.set(k, e); } e.n++; return e; }
    function addObj(kind, spec, lot, x0, y0, phiQ, place, collider, extra = {}) { const e = want(spec); const o = { kind, e, x0, y0, phiQ, place, collider, lot, ...extra }; objs.push(o); return o; }
    // ---- registros
    const props = [], arboles = [], people = [], cables = [], cars = [], postes = [], pits = [], lineas = [];
    const VAR = {}; for (const n of Object.keys(F)) { const m = /^(.+)_([b-z])$/.exec(n); if (m && F[m[1]]) (VAR[m[1]] ||= [m[1]]).push(n); }
    function put(name, x, y, opt = {}) {
      const h = Math.abs(Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(y * 10), 19349663));
      if (VAR[name]) name = VAR[name][h % VAR[name].length];
      if (!F[name]) return null;
      if (name.startsWith("yy_") && !W.dentro(x, y)) return null;   // afuera del paredón, sin yuyos (son la mayoría de los props)
      // en la calzada sólo lo que va en la calle (vallas, conos, volquetes, contenedores); lo demás que caiga ahí (una maceta de un
      // lote de esquina, un hidrante corrido) no se pone
      if (!EN_CALLE.test(name)) { const ck = W.classify(x, y); if (ck && ck.k === "road") return null; }
      if (!opt.noClaim && !claim(x, y, opt.rad ?? lookup(RAD, name, .3))) return null;
      // face: hacia dónde mira (m del mundo). Lo que tiene vista de atrás y no mira a nada en especial mira a una diagonal
      // sacada del lugar (no del sorteo, así el resto del barrio no cambia)
      const face = opt.face || (F[name + "_atras"] ? DIAG[(h >>> 7) & 3] : null);
      const e = { f: name, x, y, flip: !!opt.flip, cr: opt.noCollide ? 0 : lookup(COLR, name, 0), sh: opt.shadow ?? SH(name), face };
      props.push(e); return e;
    }
    // árbol: un tipo procedural según la riqueza del lugar (lleva el mismo sorteo que antes, así el resto no cambia)
    // tronco pintado a la cal (blanco hasta 1,2 m): en buena parte de los árboles de vereda, más en los barrios. Sale de la
    // posición, no del sorteo, así el resto del barrio no cambia. Devuelve true siempre (va dentro de la condición de arriba)
    function calTronco(a, s) { const h = Math.abs(Math.imul(Math.round(a.x * 7), 0x27d4eb2d) ^ Math.imul(Math.round(a.y * 7), 0x165667b1)) % 1000 / 1000;
      if (h < (s.w < .5 ? .55 : .3)) a.t += "_c"; return true; }
    function arbol(x, y, flip, tipo) { const t = tipo || Arboles.pick(r, W.wealthAt(x, y), W.estilo && W.estilo.arboles); if (!claim(x, y, .4)) return null; const a = { t, x, y, flip: !!flip, cr: .28 }; arboles.push(a); return a; }
    const person = (x, y, stay) => { if (conGente && W.dentro(x, y)) people.push({ x, y, stay: !!stay }); };   // afuera del paredón no hay gente
    const at = (s, t, off) => [s.a[0] + s.dir[0] * t + s.n[0] * off, s.a[1] + s.dir[1] * t + s.n[1] * off];

    // ---- plazas: árboles en el borde y sueltos, faroles y bancos sobre los senderos, monumento o fuente en el medio,
    // juegos en un cuarto y aparatos, ping-pong o ajedrez en otro, canteros con flores, cestos y gente quieta
    function plaza(lot) {
      const P = lot.plaza, at2 = (du, dv) => [P.c[0] + P.u[0] * du + P.v[0] * dv, P.c[1] + P.u[1] * du + P.v[1] * dv];
      const pasto = (q) => { const l = W.lotAt(q[0], q[1]); return l && l.kind === "plaza"; }, sendero = (q) => { const l = W.lotAt(q[0], q[1]); return l && l.kind === "sendero"; };
      const hA = P.bA / 2 - 8.5, hB = P.bB / 2 - 8.5, rx2 = rx;
      // centro
      put(F.pz_monumento && rx2() < .55 ? "pz_monumento" : F.pz_fuente ? "pz_fuente" : "u_farol_doble", P.c[0], P.c[1], { noClaim: true, face: [0, -1] });   // el prócer mira al sur
      // árboles en el borde, cada 9 a 12 m, fuera de los senderos
      for (const [ax, len, fixed] of [[0, hA, hB], [0, hA, -hB], [1, hB, hA], [1, hB, -hA]])
        for (let t = -len + rx2.uni(1, 4); t < len; t += rx2.uni(9, 12)) { const q = ax ? at2(fixed, t) : at2(t, fixed); if (pasto(q)) {
          if (F.pz_jacaranda && rx2() < .3) put(rx2() < .6 ? "pz_jacaranda" : "pz_palo_borracho", q[0], q[1], { rad: 2 }); else arbol(q[0], q[1], rx2() < .5); } }
      // árboles sueltos en el pasto
      for (let k = 0, n = Math.round(P.bA * P.bB / 450); k < n; k++) { const q = at2(rx2.uni(-hA + 3, hA - 3), rx2.uni(-hB + 3, hB - 3)); if (pasto(q)) arbol(q[0], q[1], rx2() < .5); }
      // faroles y bancos a lo largo de los senderos (cruz y diagonales)
      const dirs = [[1, 0], [0, 1], [P.bA, P.bB], [P.bA, -P.bB]].map(([a, b]) => { const l = Math.hypot(a, b); return [a / l, b / l]; });
      for (const [a, b] of dirs) for (const sg of [1, -1]) for (let t = 10; t < Math.hypot(hA * a, hB * b) + 2; t += rx2.uni(12, 16)) {
        const side = rx2() < .5 ? 1 : -1, q0 = [a * t * sg, b * t * sg], off = 1.9;
        const qf = at2(q0[0] - b * off * side, q0[1] + a * off * side); if (pasto(qf)) put(F.u_farola_orn ? "u_farola_orn" : "u_farola", qf[0], qf[1]);
        const qb = at2(q0[0] + a * 3 * sg + b * off * side, q0[1] + b * 3 * sg - a * off * side); if (pasto(qb) && rx2() < .7) put(F.pz_banco ? (rx2() < .5 ? "pz_banco" : "u_banco") : "u_banco", qb[0], qb[1], { face: [-(qb[0] - at2(q0[0], q0[1])[0]), -(qb[1] - at2(q0[0], q0[1])[1])] });
        if (rx2() < .25) { const qc = at2(q0[0] - b * 2.4 * side, q0[1] + a * 2.4 * side); if (pasto(qc)) put("u_cesto", qc[0], qc[1]); }
      }
      // cuartos: juegos, aparatos y mesas, canteros con flores
      const cuartos = [[1, 1], [-1, 1], [1, -1], [-1, -1]].sort(() => rx2() - .5);
      const enCuarto = (cu, k, rad) => { for (let tries = 0; tries < 12; tries++) { const q = at2(cu[0] * rx2.uni(hA * .3, hA * .8), cu[1] * rx2.uni(hB * .3, hB * .8)); if (pasto(q) && claim(q[0], q[1], rad)) return q; } return null; };
      for (const n of ["pz_hamacas", "pz_tobogan", "pz_subibaja", "pz_calesita"]) { if (!F[n]) continue; const q = enCuarto(cuartos[0], n, n === "pz_calesita" ? 2.5 : 1.6); if (q) put(n, q[0], q[1], { noClaim: true }); }
      for (const n of ["pz_aparato", "pz_aparato", "pz_pingpong", "pz_ajedrez", "pz_bebedero"]) { if (!F[n]) continue; const q = enCuarto(cuartos[1], n, 1.4); if (q) put(n, q[0], q[1], { noClaim: true }); }
      for (let k = 0; k < 6; k++) { const n = rx2.pick(["pz_cantero", "plm_agapanto", "plm_lantana", "pl_boj", "plm_rosal", "plm_yuyos"]); if (!F[n]) continue; const q = enCuarto(cuartos[2 + (k & 1)], n, .9); if (q) put(n, q[0], q[1], { noClaim: true }); }
      // el pasto de la plaza: matas, trébol con flores, margaritas, manzanilla, hongos
      if (F.yy_mata) for (let k = 0, n = Math.round(P.bA * P.bB / 60); k < n; k++) { const q = at2(rz.uni(-hA + 1, hA - 1), rz.uni(-hB + 1, hB - 1));
        if (pasto(q)) put(rz.pick(["yy_cesped_margaritas", "yy_trebol_blanco", "yy_mata", "yy_manzanilla", "yy_trebol_blanco", "yy_hongos", "yy_vinagrillo"]), q[0], q[1], { rad: .2 }); }
      for (const n of ["c_palomas", "c_palomas", "c_perro", "c_perro_duerme", "c_gato"]) { if (!F[n] || rx2() > .7) continue; const q = at2(rx2.uni(-hA, hA), rx2.uni(-hB, hB)); if (n !== "c_perro" && (sendero(q) || pasto(q))) put(n, q[0], q[1], { noCollide: true }); }   // sin el perro parado (el sorteo queda igual)
      if (F.c_chori && rx2() < .6) { const q = at2(rx2.pick([-1, 1]) * (hA + 4), rx2.uni(-hB * .5, hB * .5)); put("c_chori", q[0], q[1]); }
      if (F.pz_glorieta && rx2() < .4) { const q = enCuarto(cuartos[2], "pz_glorieta", 3); if (q) put("pz_glorieta", q[0], q[1], { noClaim: true }); }
      for (let k = 0; k < Math.round(P.bA * P.bB / 900) * C.gente; k++) { const q = at2(rx2.uni(-hA, hA), rx2.uni(-hB, hB)); if (sendero(q) || pasto(q)) person(q[0], q[1], rx2() < .5); }
    }

    // ---- plaza del barrio real (polígono de OpenStreetMap, con sus senderos): árboles en el borde y sueltos, faroles y bancos
    // al costado de los senderos, juegos si es un patio de juegos (o a veces en una grande), monumento si es grande
    function plazaReal(lot) {
      const P = lot.plaza, at2 = (du, dv) => [P.c[0] + P.u[0] * du + P.v[0] * dv, P.c[1] + P.u[1] * du + P.v[1] * dv];
      const pasto = (q) => { const l = W.lotAt(q[0], q[1]); return l && l.id === lot.id; }, sendero = (q) => { const l = W.lotAt(q[0], q[1]); return l && l.kind === "sendero" && l.plaza === P; };
      const hA = P.bA / 2, hB = P.bB / 2, A = P.bA * P.bB, Q = lot.q;
      // borde: cada 8 a 12 m, 2,5 m hacia adentro
      for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 4) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        for (let t = rx.uni(2, 5); t < L - 2; t += rx.uni(8, 12)) for (const sg of [1, -1]) { const q = [a[0] + ux * t - uy * 2.6 * sg, a[1] + uy * t + ux * 2.6 * sg];
          if (!pasto(q)) continue; if (F.pz_jacaranda && rx() < .25) put(rx() < .6 ? "pz_jacaranda" : "pz_palo_borracho", q[0], q[1], { rad: 2 }); else arbol(q[0], q[1], rx() < .5); break; } }
      for (let k = 0, n = Math.round(A / 380); k < n; k++) { const q = at2(rx.uni(-hA, hA), rx.uni(-hB, hB)); if (pasto(q)) arbol(q[0], q[1], rx() < .5); }
      // senderos: faroles y bancos al costado
      for (let k = 0, n = Math.round(A / 90); k < n; k++) { const q = at2(rx.uni(-hA, hA), rx.uni(-hB, hB)); if (!sendero(q)) continue;
        const ang = rx() * 6.283, o = [Math.cos(ang), Math.sin(ang)];
        for (const d of [1.7, 2.1]) { const qq = [q[0] + o[0] * d, q[1] + o[1] * d]; if (!pasto(qq)) continue;
          const nm = rx() < .35 ? (F.u_farola_orn ? "u_farola_orn" : "u_farola") : rx() < .8 ? (F.pz_banco && rx() < .5 ? "pz_banco" : "u_banco") : "u_cesto";
          put(nm, qq[0], qq[1], nm.includes("banco") ? { face: [-o[0], -o[1]] } : {}); break; } }
      if (A > 3500 && pasto(P.c) && F.pz_monumento) put(rx() < .5 ? "pz_monumento" : F.pz_fuente ? "pz_fuente" : "pz_monumento", P.c[0], P.c[1], { face: [0, -1] });
      // juegos
      if (P.juegos || (A > 2500 && rx() < .5)) for (const n of ["pz_hamacas", "pz_tobogan", "pz_subibaja", "pz_calesita", "pz_aparato"]) { if (!F[n] || rx() < .3) continue;
        for (let tries = 0; tries < 14; tries++) { const q = at2(rx.uni(-hA * .7, hA * .7), rx.uni(-hB * .7, hB * .7)); if (pasto(q) && claim(q[0], q[1], n === "pz_calesita" ? 2.5 : 1.6)) { put(n, q[0], q[1], { noClaim: true }); break; } } }
      // pasto, bichos y gente
      if (F.yy_mata) for (let k = 0, n = Math.round(A / 55); k < n; k++) { const q = at2(rz.uni(-hA, hA), rz.uni(-hB, hB));
        if (pasto(q)) put(rz.pick(["yy_cesped_margaritas", "yy_trebol_blanco", "yy_mata", "yy_manzanilla", "yy_trebol_blanco", "yy_hongos", "yy_vinagrillo", "yy_gramilla", "yy_llanten"]), q[0], q[1], { rad: .2 }); }
      for (const n of ["c_palomas", "c_palomas", "c_perro_duerme", "c_gato"]) { if (!F[n] || rx() > .6 || A < 900) continue; const q = at2(rx.uni(-hA, hA), rx.uni(-hB, hB)); if (sendero(q) || pasto(q)) put(n, q[0], q[1], { noCollide: true }); }
      for (let k = 0; k < Math.round(A / 700) * C.gente; k++) { const q = at2(rx.uni(-hA, hA), rx.uni(-hB, hB)); if (sendero(q) || pasto(q)) person(q[0], q[1], rx() < .5); }
    }
    // ---- cancha (de OpenStreetMap): arcos en las cabeceras, pelota, pibes jugando, y las líneas pintadas (en el juego, calcos finos)
    function cancha(lot) {
      const K2 = lot.cancha, at2 = (du, dv) => [K2.c[0] + K2.u[0] * du + K2.v[0] * dv, K2.c[1] + K2.u[1] * du + K2.v[1] * dv];
      const hA = K2.bA / 2 - .6, hB = K2.bB / 2 - .6, A = K2.bA * K2.bB;
      const lin = (a, b) => lineas.push([a[0], a[1], b[0], b[1]]);
      const rect = (u0, u1, v0, v1) => { const q = [at2(u0, v0), at2(u1, v0), at2(u1, v1), at2(u0, v1)]; for (let i = 0; i < 4; i++) lin(q[i], q[(i + 1) % 4]); };
      rect(-hA, hA, -hB, hB);
      if (K2.deporte === "soccer") {
        lin(at2(0, -hB), at2(0, hB));
        const rc = Math.min(3, hB * .35); for (let k = 0; k < 16; k++) lin(at2(rc * Math.cos(k * Math.PI / 8), rc * Math.sin(k * Math.PI / 8)), at2(rc * Math.cos((k + 1) * Math.PI / 8), rc * Math.sin((k + 1) * Math.PI / 8)));
        const ar = Math.min(5, hA * .2), aw = hB * .5; for (const sg of [1, -1]) rect(sg > 0 ? hA - ar : -hA, sg > 0 ? hA : -hA + ar, -aw, aw);
        if (F.b_arco) for (const sg of [1, -1]) { const q = at2(sg * (hA - .3), 0); put("b_arco", q[0], q[1], { noClaim: true, face: [-sg * K2.u[0], -sg * K2.u[1]] }); }
        if (F.b_pelota && rx() < .8) { const q = at2(rx.uni(-hA * .5, hA * .5), rx.uni(-hB * .5, hB * .5)); put("b_pelota", q[0], q[1], { noCollide: true }); }
      }
      for (let k = 0, n = Math.min(12, Math.round(A / 45)) * C.gente; k < n; k++) { const q = at2(rx.uni(-hA * .85, hA * .85), rx.uni(-hB * .85, hB * .85)); person(q[0], q[1], false); }
    }

    // ---- paredón: cierra el área jugable (afuera el mundo sigue, sin gente ni autos andando ni yuyos). Primero se reserva su
    // línea, así nada se pone encima, y los lotes que lo cruzan quedan vacíos
    const MG = W.MG, PX0 = MG, PY0 = MG, PX1 = W.MW - MG, PY1 = W.MH - MG;
    const lados = MG > 0 ? [[PX0, PY0, PX1, PY0], [PX0, PY1, PX1, PY1], [PX0, PY0, PX0, PY1], [PX1, PY0, PX1, PY1]] : [];
    for (const [ax, ay, bx, by] of lados) { const L = Math.hypot(bx - ax, by - ay); for (let t = 0; t <= L; t += .4) claim(ax + (bx - ax) * t / L, ay + (by - ay) * t / L, .5); }
    const cruzaParedon = (lot) => { if (!MG || !lot.q) return false; let ins = 0; for (const p of lot.q) if (W.dentro(p[0], p[1])) ins++; return ins > 0 && ins < lot.q.length; };
    // El paredón va sólo sobre tierra: donde cruza una calle o una vereda, la calle está cortada con vallas (como un corte de
    // calle por obra), que también tienen colisionador. Tramos de hasta 12 m (o lo que quede entre dos calles).
    { const SEG = 12, T = .36, PASO = .5;
      for (const [ax, ay, bx, by] of lados) { const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, phi = Math.atan2(uy, ux), phiQ = qa(phi), nx = -uy, ny = ux;
        const runs = []; let cur = null;
        for (let t = 0; t <= L; t += PASO) { const tierra = !W.classify(ax + ux * t, ay + uy * t);
          if (!cur || cur.tierra !== tierra) { if (cur) cur.t1 = t; cur = { tierra, t0: t, t1: L }; runs.push(cur); } }
        let k = 0;
        for (const rn of runs) {
          if (rn.tierra) { for (let t = rn.t0; t < rn.t1 - .3; t += SEG, k++) { const w = Math.min(SEG, rn.t1 - t); if (w < .8) continue; const sx = ax + ux * t, sy = ay + uy * t;
              addObj("tapial", { t: "paredon", W: Math.round(w * 2) / 2, a: aIdx(phi), s: k % 4 }, null, sx, sy, phiQ, null,
                [[sx, sy], [sx + ux * w, sy + uy * w], [sx + ux * w + nx * T, sy + uy * w + ny * T], [sx + nx * T, sy + ny * T]]); } }
          else if (F.u_valla) for (let t = rn.t0 + .35; t < rn.t1 - .2; t += .75) put("u_valla", ax + ux * t, ay + uy * t, { noClaim: true });
        } } }

    // ---- casa de esquina con ochava (world.js arma el lote): tres rubros por rumbo, para que el catálogo no crezca de más.
    // Los bares y cafés sacan dos mesitas a la vereda de la ochava
    function esquinaLote(lot) {
      const E = lot.esquina, a = aIdx(lot.phi), rub = (a * 3 + E.rub % 3) % Houses.ESQ.length, c = E.c, S = lot.fw;
      const LP = (u, v) => [lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v, lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v];
      addObj("esquina", { t: "esquina", W: S, D: lot.ld, c, p: E.p, rub, a }, lot, lot.o[0], lot.o[1], qa(lot.phi), null, [LP(c, 0), LP(S, 0), LP(S, lot.ld), LP(0, lot.ld), LP(0, c)]);
      for (let u = .2; u < S; u += .4) for (let v = .2; v < lot.ld; v += .4) { const [x, y] = LP(u, v); occ.add(Math.floor(x / OC) * 100000 + Math.floor(y / OC)); }
      const nom = Houses.ESQ[rub][0];
      if ((nom === "BAR" || nom === "CAFE") && F.c_mesa_bar) for (const k of [-1, 1]) { const q = LP(-.9 + k * .9, -.9 - k * .9); put("c_mesa_bar", q[0], q[1], { rad: .7 }); }
      else if (nom === "ALMACEN" || nom === "KIOSCO" || nom === "VERDULERIA") { const q = LP(1.4, -1.1); put(nom === "VERDULERIA" && F.c_puesto_frutas ? "c_puesto_frutas" : "pizarra_0", q[0], q[1]); }
    }

    // ---- la fuente de la rotonda (Parque Chas: trencadís de los vecinos, 2016), con su colisionador
    for (const q of W.rotondas || []) put(F.pz_fuente_mosaico ? "pz_fuente_mosaico" : "pz_fuente", q[0], q[1], { noClaim: true, face: [0, -1] });

    // ---- casas y tapiales
    for (const lot of W.lots) {
      if (lot.kind === "sendero") continue;
      if (cruzaParedon(lot)) continue;
      if (lot.kind === "esquina") { esquinaLote(lot); continue; }
      if (lot.kind === "plaza") { if (lot.plaza.real) plazaReal(lot); else plaza(lot); continue; }
      if (lot.kind === "cancha") { cancha(lot); continue; }
      if (lot.kind === "nada") continue;
      const phiQ = qa(lot.phi);
      const LP = (u, v) => [lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v, lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v];
      const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => LP(u, v));
      if (lot.kind === "baldio") {
        if (lot.seg.type !== "pasillo") { const tk = r.pick(["tapia", "ladrillo", "alambre", "alambre"]), wq = Wb(lot.fw, 2);
          const o = LP((lot.fw - wq) / 2, 0); addObj("tapial", { t: "tapial", tk, W: wq, a: aIdx(lot.phi), s: 0 }, lot, o[0], o[1], phiQ, null, rect(0, lot.fw, 0, .25)); }
        const c = LP(lot.fw / 2, lot.ld / 2);
        if (r() < .5 * C.arboles) arbol(c[0], c[1], r() < .5);
        if (r() < .5) put("bolsas_" + r.int(0, 1), c[0] + r.uni(-2, 2), c[1] + r.uni(-2, 2));
        if (F.b_cartel_vende && rx() < .3) { const q = LP(rx.uni(1, lot.fw - 1), .6); put("b_cartel_vende", q[0], q[1]); }
        if (F.b_arco && lot.fw > 8 && lot.ld > 12 && rx() < .3) { const q = LP(lot.fw / 2, lot.ld * .7); put("b_arco", q[0], q[1], { noCollide: true }); const b = LP(lot.fw / 2 + rx.uni(-2, 2), lot.ld * .45); put("b_pelota", b[0], b[1], { noCollide: true }); }
        // yuyos del baldío: matas altas y secas, cardos, ortigas, mostacilla
        if (F.yy_seco_alto) { const n = Math.round(lot.fw * lot.ld / 14 * rx.uni(.5, 1.2));
          for (let k = 0; k < n; k++) { const q = LP(rx.uni(.4, lot.fw - .4), rx.uni(.6, lot.ld - .4));
            put(rx.pick(["yy_seco_alto", "yy_seco_alto_b", "yy_mostacilla", "yy_mostacilla_b", "yy_avena", "yy_cardo", "yy_ortiga", "yy_ortiga_c", "yy_cola_zorro", "yy_pasto_seco", "yy_gramilla"]), q[0], q[1], { rad: .25 }); } }
        // y los grandes: hinojo, juncos, sorgo de Alepo, bardana, campanilla trepando, matas con bayas
        if (F.yy_hinojo) for (let k = 0, n = Math.round(lot.fw * lot.ld / 40 * rz.uni(.5, 1.3)); k < n; k++) { const q = LP(rz.uni(.6, lot.fw - .6), rz.uni(1, lot.ld - .6));
          put(rz.pick(["yy_hinojo", "yy_junco", "yy_sorgo", "yy_bardana", "yy_arbusto_bayas", "yy_campanilla_b", "yy_rastrera", "yy_mata_seca", "yy_pasto_largo", "yy_mata", "yy_verbena"]), q[0], q[1], { rad: .35 }); }
        continue;
      }
      // edificios: sólo en lotes hondos; si no entra, casa de dos plantas
      if ((lot.kind === "edificio" || lot.kind === "petit") && lot.ld < (lot.kind === "edificio" ? 14 : 11)) lot.kind = "casa2";
      if (lot.kind === "edificio" || lot.kind === "petit") {
        const ed = lot.kind === "edificio", D = ed ? (lot.ld > 20 ? 14 : 11) : 9, wq = Math.min(lot.fw, Wb(lot.fw, 2)), o = LP((lot.fw - wq) / 2, 0);
        const p = Math.min(Math.max(1, C.pisosMax || 2), ed ? (lot.w > .75 || lot.seg.type === "ave" ? r.pick([6, 8, 10]) : r.pick([4, 6])) : r.pick([2, 3]));   // tope de pisos
        addObj("house", { t: "casa", k: lot.kind, W: wq, D, a: aIdx(lot.phi), wb: 1, v: 0, p }, lot, o[0], o[1], phiQ, { u0: 0, uw: lot.fw, v0: 0 }, rect(0, lot.fw, 0, D));
        for (let u = .2; u < lot.fw; u += .4) for (let v = -.6; v < D + 1.5; v += .4) { const [x, y] = LP(u, v); occ.add(Math.floor(x / OC) * 100000 + Math.floor(y / OC)); }
        continue;
      }
      const deep = ["casa", "casa2", "obra", "negocio", "negocio_casa", "ph"].includes(lot.kind);
      let D = lot.kind === "chalet" ? 4.6 : lot.kind === "villa" ? Math.min(lot.ld - .4, r.uni(3.6, 5.5)) : deep ? Math.max(4.2, Math.min(lot.ld - 2.5, r.uni(6, 12))) : lot.kind === "galpon" ? Math.min(lot.ld - 1, r.uni(8, 14)) : 5;
      D = lot.kind === "villa" ? (D < 4.5 ? 4 : 5) : lot.kind === "galpon" ? (D < 11 ? 9 : 12) : Db(D, deep);
      const depthTot = (lot.kind === "chalet" ? 2.6 : 0) + D, step = lot.kind === "villa" ? 1.5 : 2, wq = Math.min(lot.fw, Wb(lot.fw, step));
      const wb = lot.w < .45 ? 0 : 1, o = LP((lot.fw - wq) / 2, 0);
      // Barrio Coreano: los locales sobre Av. Carabobo tienen frente coreano (cartel en hangul)
      const co = (lot.kind === "negocio" || lot.kind === "negocio_casa") && lot.seg && /Carabobo/.test(lot.seg.nombre || "") ? { co: lot.seed % 8 }
        : lot.kind === "villa" && W.real && W.villaAt(lot.o[0], lot.o[1]) ? { al: 1 } : {};   // la 1-11-14: casillas de ladrillo de 2 a 4 pisos
      // techo de tejas en las casas de un barrio que las pide (estilo.tejas: la parte de las casas que las tiene); sale del lote
      if (W.estilo && W.estilo.tejas && (lot.kind === "casa" || lot.kind === "casa2") && (lot.seed % 1000) / 1000 < W.estilo.tejas) co.tj = 1;
      // un comercio con nombre de un barrio real (Pizzería Keops, Café Chas): su cartel y su rubro
      if (lot.cartel) { co.ct = lot.cartel; co.rb = lot.rubro; }
      addObj("house", { t: "casa", k: lot.kind, W: wq, D, a: aIdx(lot.phi), wb, v: 0, ...co }, lot, o[0], o[1], phiQ, { u0: 0, uw: lot.fw, v0: 0 }, rect(0, lot.fw, 0, depthTot));
      const occRect = (u0, u1, v0, v1) => { for (let u = u0; u < u1; u += .4) for (let v = v0; v < v1; v += .4) { const [x, y] = LP(u, v); occ.add(Math.floor(x / OC) * 100000 + Math.floor(y / OC)); } };
      occRect(.2, lot.fw, -.6, depthTot + 1.5);
      let backV = 0;
      // en lotes hondos casi siempre hay algo en el fondo (PH, otra casa, un galpón), como en las manzanas de Flores
      const pBack = (lot.w < .3 ? .65 : lot.w < .55 ? .4 : .12) * C.fondoConstr, hondo = lot.ld - depthTot > 22;
      if (lot.kind !== "villa" && lot.ld - depthTot > 8 && (r() < pBack || (hondo && rx() < .75))) {
        const bw = Wb(Math.min(lot.fw, r.uni(4, lot.fw)), 2), bu = r() < .5 ? 0 : lot.fw - bw, bd = Math.min(lot.ld - depthTot - 4, r.uni(3.8, 5.5)) < 4.6 ? 4 : 5, bv = lot.ld - bd - .3;
        const k2 = r.pick(lot.w < .3 ? ["obra", "villa", "casa"] : ["casa", "casa", "obra"]), [bx, by] = LP(bu, bv);
        addObj("house", { t: "casa", k: k2, W: bw, D: bd, a: aIdx(lot.phi), wb: Math.min(1, wb), v: 0 }, lot, bx, by, phiQ, { u0: bu, uw: bw, v0: bv }, rect(bu, bu + bw, bv, bv + bd), { back: true });
        occRect(bu, bu + bw, bv - .6, bv + bd + .5); backV = bv;
      }
      if ((backV || lot.ld) - depthTot > 3.5) { const fin = (backV || lot.ld) - .8, cerca = Math.min(fin, depthTot + 9);
        // lo del patio cerca de la casa (no perdido en el fondo de un lote de 50 m); la parrilla contra una medianera. Mismas tiradas que antes
        const pp = () => LP(r.uni(.8, lot.fw - .8), r.uni(depthTot + 2.2, cerca)), ppLado = () => { const iz = r() < .5; return LP(iz ? .7 : lot.fw - .7, r.uni(depthTot + 1.8, Math.min(fin, depthTot + 5))); };
        const ppLejos = () => LP(r.uni(.8, lot.fw - .8), r.uni(depthTot + 2.2, fin));
        if (r() < .3 * C.arboles) { const p = ppLejos(); arbol(p[0], p[1], r() < .5); }
        if (F.b_tendedero && rx() < (lot.w < .5 ? .45 : .2)) put("b_tendedero", ...pp());
        if (F.k_cucha && rx() < .18) put("k_cucha", ...ppLado());
        if (F.k_pelopincho && lot.w > .2 && lot.w < .7 && rx() < .1) put("k_pelopincho", ...pp());
        if (F.b_mesa_patio && rx() < (lot.w < .55 ? .18 : .06)) put("b_mesa_patio", ...pp());
        if (F.b_autito && lot.w < .5 && rx() < .2) put(rx.pick(["b_autito", "b_pelota", "b_perro_bebe", "b_tacho_azul", "b_sombrilla"]), ...pp());
        if (F.plm_rosal && rx() < Math.min(.95, .35 * PL)) put(rx.pick(lot.w < .3 ? ["plm_tomates", "plm_yuyos", "pl_cubierta", "plm_santarita", "plm_lantana", "plm_romero", "plm_banano", "pl_palmera", "pl_suculentas"] : ["plm_rosal", "plm_jazmin", "pl_hortensia", "plm_agapanto", "plm_santarita", "plm_lantana", "plm_romero", "pl_limonero", "plm_pindo", "pl_hibisco", "plm_strelitzia", "plm_banano", "plm_plumbago", "plm_cortadera", "pl_gomero"]), ...pp());
        if (F.plm_rosal && PL > 1 && rx() < .3 * (PL - 1)) put(rx.pick(["plm_agapanto", "pl_hortensia", "plm_lantana", "plm_jazmin", "pl_limonero", "plm_formio", "pl_malvon", "plm_santarita", "plm_banano", "pl_hibisco", "plm_strelitzia", "pl_monstera"]), ...pp());
        if ((lot.kind === "villa" || lot.w < .25) && rx() < .5) put(rx.pick(["u_tanque", "chapas", "gomas", "parrilla_tambor", "silla", "antena", "garrafa"]), ...ppLado());
        if (r() < .2) put("parrilla", ...ppLado()); if (lot.w > .3 && r() < .1) put("pileta", ...pp());
        // el fondo con pasto (el piso lo pinta desde los 13 m): matas, trébol, margaritas, algún hongo después de la lluvia
        if (F.yy_mata && fin > 14) for (let k = 0, n = rz.int(1, 4); k < n; k++) { const q = LP(rz.uni(.6, lot.fw - .6), rz.uni(13.5, fin));
          put(lot.w < .3 ? rz.pick(["yy_mata_seca", "yy_pasto_largo", "yy_rastrera", "yy_vinagrillo"]) : rz.pick(["yy_cesped_margaritas", "yy_trebol_blanco", "yy_mata", "yy_manzanilla", "yy_hongos", "yy_vinagrillo"]), q[0], q[1], { rad: .2 }); } if (r() < .08 * C.gente) { const p = pp(); person(p[0], p[1], true); } }
      const s = lot.seg, side = lot.side, mid = (lot.o[0] - s.a[0]) * s.dir[0] + (lot.o[1] - s.a[1]) * s.dir[1] + (side === 1 ? lot.fw / 2 : -lot.fw / 2);
      if (s.sw > 1) {
        const near = (dd) => at(s, mid + r.uni(-lot.fw / 3, lot.fw / 3), side * (s.hw + s.sw - dd));
        const nearX = (dd, du = 0) => at(s, mid + du, side * (s.hw + s.sw - dd));      // con rx: no corre el sorteo de las casas
        if ((lot.kind === "negocio" || lot.kind === "negocio_casa") && r() < .6) put("pizarra_" + r.int(0, 2), ...near(.9));
        if (lot.kind === "obra" && r() < .5) put("obra_material", ...near(1.1));
        // Barrio Coreano: carteles de pie, pizarras, tinajas de kimchi, cajones de repollo (todo con rx: no corre lo demás)
        if (co.co != null && F.k_co_letrero) {
          const tipo = Houses.CO[co.co % Houses.CO.length], du = () => rx.uni(-lot.fw / 3, lot.fw / 3);
          const cosas = tipo === "restaurante" ? ["k_co_letrero", "k_co_pizarra", "k_co_luz"] : tipo === "mercado" || tipo === "almacen" ? ["k_co_banner", "k_co_onggi", "k_co_repollos", "k_co_luz"]
            : tipo === "karaoke" ? ["k_co_luz", "k_co_letrero"] : ["k_co_luz", "k_co_banner", "k_co_pizarra"];
          const prueba = (n, a, b) => { for (let k = 0; k < 5; k++) if (put(n, ...nearX(rx.uni(a, b), du()))) return; };
          if (rx() < .9) prueba(rx.pick(cosas), .7, 1.1);
          if (rx() < .5) prueba(rx.pick(cosas), s.sw - .7, s.sw - .45);
          if (F.k_co_corona && rx() < .07) put("k_co_corona", ...nearX(.8, du()));
          if (F.k_co_carrito && tipo !== "iglesia" && rx() < .08) put("k_co_carrito", ...nearX(s.sw - .9, du()), { face: [-s.n[0] * side, -s.n[1] * side] });
        }
        if (r() < (lot.w < .3 ? .05 : .14)) put("canasto_" + r.int(0, 2), ...near(.45), { noClaim: true });   // pegado al frente: la casa ya reservó esa franja
        // plantas en macetas contra el frente (más en zonas ricas) y alguna Santa Rita
        if (F.pl_malvon && rx() < Math.min(.95, (.22 + .4 * lot.w) * PL)) { const n = 1 + (rx() < Math.min(.9, .4 * PL)) + (rx() < .2 * lot.w * PL) + (PL > 1.4 && rx() < .3 * (PL - 1));
          const POT = lot.kind === "villa" || lot.w < .25 ? ["pl_balde", "pl_botellas", "pl_aloe", "pl_malvon", "pl_cactus", "plm_yuyos", "pl_potus", "pl_cubierta", "plm_tomates", "pl_balde", "pl_begonias", "pl_suculentas", "pl_palmera", "pl_coleo"]
            : lot.w > .6 ? ["pl_hortensia", "pl_malvon", "pl_sansevieria", "plm_jazmin", "plm_rosal", "pl_boj", "pl_calas", "pl_limonero", "pl_ficus", "pl_helecho", "pl_lavanda", "plm_yuca", "pl_monstera", "pl_gomero", "pl_azalea", "pl_hibisco", "pl_jardinera"]
            : ["pl_malvon", "pl_potus", "pl_aloe", "pl_cactus", "pl_sansevieria", "pl_hortensia", "plm_rosal", "pl_clivia", "pl_helecho", "pl_calas", "pl_malvon", "pl_jardinera", "pl_coleo", "pl_azalea", "pl_begonias", "pl_monstera"];
          const u0 = rx.uni(-lot.fw / 3, lot.fw / 3 - .5 * n);           // en fila, pegadas al frente
          for (let k = 0; k < n; k++) put(rx.pick(POT), ...nearX(rx.uni(.22, .36), u0 + k * rx.uni(.42, .6)), { noClaim: true }); }
        // el café y la pizzería con nombre sacan sus mesitas a la vereda
        if (lot.cartel && F.c_mesa_bar && s.sw >= 1.8) for (const du of [-lot.fw / 3, 0, lot.fw / 3]) put("c_mesa_bar", ...nearX(Math.min(1.7, s.sw - .6), du), { rad: .7 });
        // vida en la vereda: mesas de bar frente a los negocios, motos y bicis estacionadas, perros y gatos
        if (F.c_mesa_bar && (lot.kind === "negocio" || lot.kind === "negocio_casa") && s.sw >= 2.6 && rx() < .3) put("c_mesa_bar", ...nearX(rx.uni(1.5, 1.8), rx.uni(-lot.fw / 4, lot.fw / 4)), { rad: .75 });
        if (F.c_moto && rx() < (lot.kind === "negocio" ? .12 : .04)) put(rx() < .6 ? "c_moto" : "c_bici", ...nearX(rx.uni(1.05, 1.3), rx.uni(-lot.fw / 3, lot.fw / 3)), { rad: .4 });
        if (F.c_perro && rx() < (lot.w < .35 ? .07 : .025)) put(rx.pick(["c_gato", "c_perro_duerme", "c_perro_duerme", "c_gato"]), ...nearX(rx.uni(.95, 1.5), rx.uni(-lot.fw / 3, lot.fw / 3)), { noCollide: true, rad: .25 });
        // kioscos y almacenes: heladera de bebidas, cajones de envases, sillas apiladas, pizarra de helados
        if (F.k_heladera && (lot.kind === "negocio" || lot.kind === "negocio_casa") && rx() < .35) put(rx.pick(["k_heladera", "k_cajones_botellas", "k_cajones_botellas", "k_sillas_pila", "k_pizarra_helado"]), ...nearX(rx.uni(1.05, 1.3), rx.uni(-lot.fw / 3, lot.fw / 3)), { rad: .3 });
        // devoción popular: el Gauchito Gil (rojo) y la Virgen, en las esquinas y frentes de los barrios pobres
        if (F.k_gauchito && lot.w < .45 && rx() < .025) put(rx() < .6 ? "k_gauchito" : "k_virgen", ...nearX(rx.uni(1.1, 1.4), rx.uni(-lot.fw / 3, lot.fw / 3)), { rad: .5 });
        if (F.k_tele && lot.w < .4 && rx() < .03) put(rx() < .5 ? "k_tele" : "k_colchon", ...nearX(rx.uni(1.05, 1.3), rx.uni(-lot.fw / 3, lot.fw / 3)), { rad: .35 });
        // vecinos en la vereda (la abuela barriendo, el abuelo con el mate) y cosas de los barrios pobres
        if (F.b_viejo_mate && lot.kind !== "galpon" && rx() < .035) put(rx() < .5 ? "b_viejo_mate" : "b_mujer_barre", ...nearX(rx.uni(1.05, 1.3), rx.uni(-lot.fw / 3, lot.fw / 3)), { rad: .35 });
        if (F.b_jaula && lot.w < .6 && rx() < .04) put("b_jaula", ...nearX(.22, rx.uni(-lot.fw / 3, lot.fw / 3)), { noClaim: true });
        if (F.b_pallets && (lot.kind === "villa" || lot.w < .25) && rx() < .15) put(rx.pick(["b_pallets", "b_tacho_azul", "b_bolsones", "b_chango_vacio", "b_bolsones"]), ...nearX(rx.uni(1.05, 1.4), rx.uni(-lot.fw / 3, lot.fw / 3)), { rad: .4 });
        if (F.c_volquete && lot.kind === "obra" && rx() < .5) { const q = at(s, mid, side * (s.hw - 1.4)), c = W.classify(q[0], q[1]); if (c && c.k === "road") put("c_volquete", q[0], q[1], { face: [s.dir[0], s.dir[1]] }); }
        if (F.plm_santarita && lot.w > .35 && rx() < .06 * PL) put("plm_santarita", ...nearX(.5, rx.uni(-lot.fw / 3, lot.fw / 3)), { noClaim: true });
        if ((lot.kind === "villa" || lot.w < .22) && rx() < .3) put(rx.pick(["garrafa", "silla", "cajones", "gomas", "chapas", "parrilla_tambor", "carro_cartonero", "chango", "silla"]), ...nearX(rx.uni(.9, 1.3), rx.uni(-lot.fw / 3, lot.fw / 3)));
        if (r() < .04) put(r.pick(["u_tablero", "u_caja_bsas"]), ...near(.4));
      }
    }
    // ---- veredas: árboles, gente, faroles, postes con cables
    // un barrio real con censo de arbolado (Parque Chas, GCBA 2017-2018): cada árbol de vereda donde está y de su especie, en
    // la vereda del tramo más cercano, sobre el cordón. Las calles se corrieron al encajarlas en los rumbos y los árboles con
    // ellas (osm_real.py); queda menos de un par de metros, que se absorbe acá
    const reales = new Map();
    if (W.arbolesReales) { const { especies, lista } = W.arbolesReales;
      for (const [x, y, e] of lista) { let best = null, bd = 4;
        for (const s of W.near(x, y)) { if (s.type === "pasillo") continue; const dx = x - s.a[0], dy = y - s.a[1], t = dx * s.dir[0] + dy * s.dir[1]; if (t < 1 || t > s.len - 1) continue;
          const off = dx * s.n[0] + dy * s.n[1], d = Math.abs(Math.abs(off) - (s.hw + .55)); if (d < bd) { bd = d; best = { s, t, side: off < 0 ? 1 : 0 }; } }
        if (!best) continue; let L = reales.get(best.s); if (!L) reales.set(best.s, L = [[], []]); L[best.side].push([best.t, especies[e]]); } }
    for (const s of W.segs) {
      if (s.type === "pasillo") { for (let t = r.uni(2, 8); t < s.len; t += r.uni(6, 14)) if (r() < .12 * C.gente) { const p = at(s, t, r.uni(-.4, .4)); person(p[0], p[1], false); } continue; }
      const crossNear = (t) => s.cross.some(c => Math.abs(t - c) < 3);
      // un árbol de vereda en t, con su cazuela y lo que crece en ella; esp: la especie (del censo), si no, la del lugar
      const plantar = (side, t, esp) => {
        const p = at(s, t, side * (s.hw + (s.cantero ? .6 : .55)));
        let av; const c = W.classify(p[0], p[1]); if (!c || c.k !== "walk" || c.s !== s) return;
        if (esp === "palo_borracho") { put("pz_palo_borracho", p[0], p[1], { rad: 1.2 }); return; }
        const tipo = esp ? esp + "_" + (Math.abs(Math.imul(Math.round(p[0] * 10), 0x2c1b3c6d) ^ Math.imul(Math.round(p[1] * 10), 0x297a2d39)) % 3) : null;
        if ((av = arbol(p[0], p[1], r() < .5, tipo)) && calTronco(av, s) && !s.cantero) {
            // cazuela: cuadrado de tierra alrededor del árbol (borde de ladrillo, de cemento o sin borde), a veces con plantas o yuyos
            const tipo = s.w < .3 ? rx.pick([2, 3, 3]) : rx.pick([1, 1, 2, 3]), conPasto = rx() < .55;
            pits.push({ x: p[0], y: p[1], ang: Math.atan2(s.dir[1], s.dir[0]), tipo, pasto: conPasto });
            if (rx() < Math.min(.95, .6 * PL)) { const q = at(s, t + rx.pick([-.32, .32]), side * (s.hw + .55 + rx.uni(-.25, .25)));
              put(rx() < Math.min(.9, .35 * PL) && s.w > .3 ? rx.pick(["plm_agapanto", "pl_boj", "plm_lantana", "plm_romero"]) : rx.pick(["yy_diente_leon", "yy_trebol", "yy_llanten", "yy_cola_zorro", "yy_ortiga_b", "yy_brotes", "yy_pasto_seco"]), q[0], q[1], { noClaim: true }); } } };
      for (const side of [1, -1]) {
        if (reales.size) { const L = reales.get(s); if (L) for (const [t, esp] of L[side > 0 ? 0 : 1]) if (!crossNear(t)) plantar(side, t, esp); }
        else if (s.sw >= 2.2) for (let t = r.uni(3, 9); t < s.len - 3; t += r.uni(7, 13)) {
          if (crossNear(t) || r() > (.3 + .55 * s.w) * C.arboles) continue; plantar(side, t, null); }
        // canteros y cazuelas: agapantos, yuyos, bojs y arbolitos con jaula cerca del cordón
        if (F.plm_agapanto && s.sw >= 1.6) for (let t = rx.uni(2, 8); t < s.len - 2; t += rx.uni(5, 13)) {
          if (crossNear(t) || rx() > Math.min(.95, (.35 + .3 * s.w) * PL)) continue; const p = at(s, t, side * (s.hw + .5)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk" || c.s !== s) continue;
          put(rx() < .06 ? "pl_jaula" : rx.pick(s.w > .55 ? ["plm_agapanto", "pl_boj", "plm_agapanto", "plm_jazmin", "plm_formio", "pl_lavanda", "plm_lantana", "plm_strelitzia", "plm_plumbago", "plm_cortadera"] : s.w < .3 ? ["plm_yuyos", "plm_yuyos", "plm_agapanto", "yy_seco_alto", "yy_mostacilla"] : ["plm_agapanto", "plm_yuyos", "pl_boj", "plm_romero", "plm_lantana", "plm_plumbago", "plm_cortadera"]), p[0], p[1]); }
        // yuyos que salen solos: junto al cordón, en las grietas de la vereda y contra las paredes (más en los barrios pobres y en las calles de tierra)
        if (F.yy_diente_leon && s.sw >= 1) { const dens = (s.mat === "tierra" ? 1.6 : s.mat === "roto" ? 1 : .45) * (1.3 - s.w);
          for (let t = rx.uni(.5, 4); t < s.len - .5; t += rx.uni(1.5, 5) / Math.max(.15, dens)) {
            if (crossNear(t)) continue; const where = rx(), off = where < .5 ? s.hw + rx.uni(.08, .3) : where < .8 ? s.hw + rx.uni(.4, s.sw - .4) : s.hw + s.sw - rx.uni(.1, .35);
            const p = at(s, t, side * off), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk") continue;
            put(where < .8 ? rx.pick(["yy_diente_leon", "yy_diente_leon_b", "yy_trebol", "yy_llanten", "yy_brotes", "yy_gramilla", "yy_grieta", "yy_pasto_seco", "yy_musgo"])
              : rx.pick(["yy_ortiga", "yy_ortiga_b", "yy_cola_zorro", "yy_avena", "yy_diente_leon", "yy_cardo", "yy_mostacilla"]), p[0], p[1], { rad: .12 }); } }
        // yuyos nuevos en la vereda: junto al cordón y contra las paredes, más en los barrios pobres y en las calles de tierra
        if (F.yy_mata && s.sw >= 1) { const dens = (s.mat === "tierra" ? 1.4 : s.mat === "roto" ? .9 : .35) * (1.3 - s.w);
          for (let t = rz.uni(.5, 6); t < s.len - .5; t += rz.uni(3, 8) / Math.max(.15, dens)) { if (crossNear(t)) continue;
            const pared = rz() < .4, p = at(s, t, side * (pared ? s.hw + s.sw - rz.uni(.1, .3) : s.hw + rz.uni(.08, .35)));
            const c = W.classify(p[0], p[1]); if (!c || c.k !== "walk") continue;
            put(pared ? rz.pick(["yy_rastrera", "yy_mata", "yy_vinagrillo", "yy_pasto_largo", "yy_trebol_blanco", "yy_mata_seca"]) : rz.pick(["yy_mata", "yy_vinagrillo", "yy_manzanilla", "yy_mata_seca", "yy_trebol_blanco", "yy_campanilla"]), p[0], p[1], { rad: .15 }); } }
        if (s.sw > 1 && r() < .7) for (let t = r.uni(2, 10); t < s.len; t += r.uni(4, 12)) if (r() < (.2 + .25 * (s.type === "ave")) * C.gente) {
          const p = at(s, t, side * (s.hw + r.uni(.4, s.sw - .3))); const c = W.classify(p[0], p[1]); if (c && c.k === "walk") person(p[0], p[1], false); }
      }
      // faroles: cada 16 a 22 m alternando vereda (en tierra alumbran las lámparas de los postes de madera)
      if (s.mat !== "tierra") for (let t = r.uni(4, 12), k = 0; t < s.len - 3; t += r.uni(16, 22) * (C.faroles ? 1 / C.faroles : 1), k++) {
        if (crossNear(t)) continue; const side = k % 2 ? 1 : -1, p = at(s, t, side * (s.hw + .35)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk") continue;
        const q = at(s, t, 0), orn = s.type !== "ave" && s.w > .55 && F.u_farola_orn;
        put(orn ? (k % 4 === 1 ? "u_farol_doble" : "u_farola_orn") : s.type === "ave" && s.w > .6 && k % 3 === 2 ? "u_farol_doble" : "u_farola", p[0], p[1], { face: [q[0] - p[0], q[1] - p[1]] }); }
      // avenidas: paradas de colectivo (con un banco al lado, a veces) cada 120 a 220 m
      if (s.type === "ave" && s.sw > 2 && F.u_parada) for (let t = rx.uni(20, 80); t < s.len - 6; t += rx.uni(120, 220)) {
        if (crossNear(t)) continue; const side = rx() < .5 ? 1 : -1, p = at(s, t, side * (s.hw + .45)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk") continue;
        put("u_parada", p[0], p[1]);
        if (F.u_banco && rx() < .6) { const b = at(s, t + 2.6, side * (s.hw + 1.3)), q = at(s, t + 2.6, 0); if (W.classify(b[0], b[1])?.k === "walk") put("u_banco", b[0], b[1], { face: [q[0] - b[0], q[1] - b[1]] }); } }
      if (s.type !== "ave" && s.sw > 1) {
        const side = rx() < .5 ? 1 : -1, phi = Math.atan2(s.dir[1], s.dir[0]), phiQ = qa(phi), luz = s.mat === "tierra" || s.mat === "roto" ? 1 : 0, pts = [], feet = [];
        for (let t = rx.uni(3, 10); t < s.len - 2; t += rx.uni(24, 32)) {
          const p = at(s, t, side * (s.hw + .3)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk" || !claim(p[0], p[1], .25)) continue;
          addObj("poste", { t: "poste", a: aIdx(phi), l: luz }, null, p[0], p[1], phiQ, null, null); feet.push(p);
          pts.push([[0, -.76, 8.18], [0, .09, 8.18], [0, .79, 8.18]].map(([lx, ly, lz]) => [p[0] + Math.cos(phiQ) * lx - Math.sin(phiQ) * ly, p[1] + Math.sin(phiQ) * lx + Math.cos(phiQ) * ly, lz]));
        }
        if (feet.length) postes.push({ a: aIdx(phi), phiQ, luz, feet });
        // cables: curvas 3D partidas en tramos rectos [x0, y0, z0, x1, y1, z1]
        const curve = (a, b, sag, n) => { let prev = a; for (let i = 1; i <= n; i++) { const t = i / n, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)];
          cables.push([prev[0], prev[1], prev[2], q[0], q[1], q[2]]); prev = q; } };
        for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < 3; k++) curve(pts[i][k], pts[i + 1][k], .9 + k * .17, 6);
        for (const cp of pts) if (rx() < .7) { const a = cp[2], sd = side * rx.uni(2, 4.5), al = rx.uni(-3, 3); curve(a, [a[0] + s.n[0] * sd + s.dir[0] * al, a[1] + s.n[1] * sd + s.dir[1] * al, rx.uni(2.6, 3.6)], .35, 4); }
      }
    }
    // ---- manchas y roturas del piso (gd_*, Gemini, vistas desde arriba): aceite donde estacionan, parches, grietas y baches en la
    // calle (más en las rotas y en los barrios pobres), frenadas antes de las esquinas, charcos, basura junto al cordón; en la
    // vereda baldosas rotas o faltantes, chicles frente a los negocios, el goteo de los aires, hojas secas y alguna rayuela.
    // Sorteo aparte (rg), así lo demás no cambia
    if (F.gd_aceite) { const rg = R3.rng(SEED ^ 0x7feb352d), gd = (n, p) => put(n, p[0], p[1], { noClaim: true, noCollide: true, shadow: null });
      const veredaDe = (s, side, t) => { for (const e of s.lots[side]) if (t >= e.t0 && t < e.t1) return e.lot; return null; };
      for (const s of W.segs) { if (s.type === "pasillo") continue;
        const crossNear = (t) => s.cross.some(c => Math.abs(t - c) < 3), pobre = 1.3 - s.w;
        if (s.mat !== "tierra") { const dens = (s.mat === "roto" ? 2 : s.mat === "adoquin" ? .5 : 1) * pobre;
          for (let t = rg.uni(2, 12); t < s.len - 2; t += rg.uni(8, 20) / Math.max(.2, dens)) { const side = rg() < .5 ? 1 : -1, q = rg();
            if (q < .38) gd(rg() < .6 ? "gd_aceite" : "gd_gotas", at(s, t, side * (s.hw - 1.1)));
            else if (q < .55) gd("gd_parche", at(s, t, side * rg.uni(.6, Math.max(.7, s.hw - 1.6))));
            else if (q < .7) gd(s.mat === "roto" || s.w < .4 ? "gd_bache" : "gd_grietas", at(s, t, side * rg.uni(.5, Math.max(.6, s.hw - 1.4))));
            else if (q < .8) gd("gd_grietas", at(s, t, side * rg.uni(.3, Math.max(.4, s.hw - .8))));
            else if (q < .9) gd("gd_basura", at(s, t, side * (s.hw - .45)));
            else if (rg() < .4) gd("gd_charco", at(s, t, side * (s.hw - rg.uni(.6, 1.6)))); }
          // frenadas antes de las esquinas, en las calles que en pantalla van más o menos horizontales
          if (Math.abs(s.dir[0]) > .85) for (const c of s.cross) if (rg() < .2 * (s.type === "ave" ? 2 : 1)) { const sg = rg() < .5 ? 1 : -1; gd("gd_frenada", at(s, c - sg * rg.uni(5, 8), -sg * laneOff(s))); }
        } else for (let t = rg.uni(2, 15); t < s.len - 2; t += rg.uni(12, 30)) gd(rg() < .6 ? "gd_charco" : "gd_bache", at(s, t, rg.uni(-s.hw * .6, s.hw * .6)));
        // vereda
        if (s.sw >= 1.4) for (const side of [1, -1]) for (let t = rg.uni(1, 8); t < s.len - 1; t += rg.uni(4, 11) / Math.max(.25, pobre)) {
          if (crossNear(t)) continue; const lot = veredaDe(s, side, t), q = rg(), ver = lot && lot.vereda, gris = ver === "gris" || ver === "cem" || ver === "vain" || ver === "vain_d";
          const pared = at(s, t, side * (s.hw + s.sw - .35)), medio = at(s, t, side * (s.hw + rg.uni(.6, Math.max(.7, s.sw - .6))));
          const ck = W.classify(medio[0], medio[1]); if (!ck || ck.k !== "walk") continue;
          if (lot && (lot.kind === "negocio" || lot.kind === "negocio_casa" || lot.kind === "esquina") && q < .35) gd("gd_chicles", medio);
          else if (q < .45 && lot && lot.kind !== "baldio") gd("gd_aire", pared);
          else if (q < .65 && gris && s.w < .7) gd(rg() < .55 ? "gd_baldosas_rotas" : "gd_pozo_vereda", medio);
          else if (q < .72) gd("gd_hojas", medio);
          else if (q < .83 && lot && (lot.kind === "casa" || lot.kind === "casa2") && s.w > .3) gd("gd_rayuela", medio);
          else if (q < .9 && s.w < .5) gd("gd_basura", medio); }
      }
      // raíces que levantan la vereda junto a los árboles de vereda
      for (const a of arboles) { const c = W.classify(a.x, a.y); if (!c || c.k !== "walk" || rg() > .35) continue;
        const s = c.s, sd = (a.x - s.a[0]) * s.n[0] + (a.y - s.a[1]) * s.n[1] >= 0 ? 1 : -1, t = (a.x - s.a[0]) * s.dir[0] + (a.y - s.a[1]) * s.dir[1];
        gd(rg() < .7 ? "gd_raices" : "gd_hojas", at(s, t + (rg() < .5 ? -1 : 1) * rg.uni(.9, 1.4), sd * (s.hw + rg.uni(.5, Math.max(.6, s.sw - .6))))); }
    }
    // ---- esquinas
    for (const it of W.inters) {
      const { s, o, p } = it; if (s.type === "pasillo" || o.type === "pasillo") continue;
      const cands = []; for (const a of [1, -1]) for (const b of [1, -1]) cands.push([p[0] + s.dir[0] * a * (o.hw + o.sw * .5) + s.n[0] * b * (s.hw + s.sw * .5), p[1] + s.dir[1] * a * (o.hw + o.sw * .5) + s.n[1] * b * (s.hw + s.sw * .5)]);
      const ok = cands.filter(q => { const c = W.classify(q[0], q[1]); return c && c.k === "walk"; });
      if (ok.length) put("cartel", ...ok[0]);
      // semáforo: el cruce queda semaforizado (los autos lo respetan en el juego) y cada uno muestra la luz de una de las dos calles
      if ((s.type === "ave" || o.type === "ave" || (s.mat === "asf" && o.mat === "asf" && s.w > .45)) && ok.length > 1) { const e1 = put("u_semaforo", ...ok[1]); if (e1) { it.sem = true; e1.cruce = it; e1.eje = 0; }
        if (ok[2]) { const e2 = put("u_semaforo", ...ok[2]); if (e2) { it.sem = true; e2.cruce = it; e2.eje = 1; } } }
      if (s.mat !== "tierra" && r() < .25 && ok[3]) put("u_campana", ...ok[3]);
      const asf = s.mat === "asf" && o.mat === "asf", ave = s.type === "ave" || o.type === "ave";
      if (F.c_buzon && asf && rx() < .08 && ok.length > 2) { const q = ok[2]; put("c_buzon", q[0] + o.dir[0] * 1.6, q[1] + o.dir[1] * 1.6); }
      if (F.c_hidrante && s.mat !== "tierra" && rx() < .12 && ok.length > 1) { const q = ok[ok.length - 1]; put("c_hidrante", q[0] - o.dir[0] * 2.2, q[1] - o.dir[1] * 2.2); }
      if (F.c_puesto_flores && ave && rx() < .18 && ok.length > 1) { const q = ok[1]; put(rx() < .5 ? "c_puesto_flores" : "c_puesto_frutas", q[0] + s.dir[0] * 3.5, q[1] + s.dir[1] * 3.5); }
      if (F.k_mantero && ave && rx() < .15 && ok.length) { const q = ok[0]; put("k_mantero", q[0] + s.dir[0] * 5, q[1] + s.dir[1] * 5); }
      if (F.k_gauchito && s.w < .35 && rx() < .06 && ok.length > 1) { const q = ok[1]; put("k_gauchito", q[0] - s.dir[0] * 1.2, q[1] - s.dir[1] * 1.2); }
      if (F.c_chori && ave && rx() < .1 && ok.length > 2) { const q = ok[ok.length - 1]; put("c_chori", q[0] + o.dir[0] * 3, q[1] + o.dir[1] * 3); }
      if (F.c_palomas && rx() < .1 && ok.length) { const q = ok[0]; put("c_palomas", q[0] + s.dir[0] * 2.5, q[1] + s.dir[1] * 2.5, { noCollide: true }); }
      if (F.u_cesto && asf && rx() < .35 && ok.length) { const q = ok[ok.length - 1]; put("u_cesto", q[0] + s.dir[0] * 1.2, q[1] + s.dir[1] * 1.2); }
      if (F.u_poste_trafo && s.mat !== "tierra" && !ave && rx() < .1 && ok.length > 1) { const q = ok[1]; put("u_poste_trafo", q[0] - s.dir[0] * 1.5, q[1] - s.dir[1] * 1.5); }
      if (F.u_kiosco && ave && rx() < .3 && ok.length) { const q = ok[0], d = (o.hw + o.sw) + 3; for (const sg of [1, -1]) { const k = [q[0] + s.dir[0] * sg * d * .5, q[1] + s.dir[1] * sg * d * .5];
        if (W.classify(k[0], k[1])?.k === "walk" && put("u_kiosco", k[0], k[1], { flip: rx() < .5 })) break; } }
    }
    // ---- autos (estacionados y circulando) y contenedores
    // dónde no se estaciona: las esquinas de cada calle (posición del cruce y cuánto despejar), paradas de colectivo e hidrantes
    const _esq = new Map();
    for (const it of W.inters) { if (it.s.type === "pasillo" || it.o.type === "pasillo") continue;
      for (const [a, b] of [[it.s, it.o], [it.o, it.s]]) { if (!_esq.has(a)) _esq.set(a, []); _esq.get(a).push([(it.p[0] - a.a[0]) * a.dir[0] + (it.p[1] - a.a[1]) * a.dir[1], b.hw + Math.max(0, b.sw) + 5 + 2.3]); } }
    const esquinas = (s) => _esq.get(s) || [];
    const paradas = props.filter(e => e.f.startsWith("u_parada")), hidrantes = props.filter(e => e.f.startsWith("c_hidrante"));
    const cerca = (L, p, d) => L.some(e => (e.x - p[0]) ** 2 + (e.y - p[1]) ** 2 < d * d);
    for (const s of W.segs) {
      if (s.type === "pasillo") continue;
      // cuántos autos entran de ancho (2,45 m cada uno, con el lugar para pasar): por la calle tienen que poder pasar dos, y sólo se
      // estaciona si entran tres (dos que pasan y uno estacionado); con cuatro, de los dos lados. En una avenida con cantero se cuenta
      // cada mano; en la de tierra, sin las zanjas
      const lanes = [], park = parkOff(s), CAR = 2.45, conMed = s.type === "ave" && s.med > .5;
      const ancho = conMed ? s.hw - s.med - .15 : 2 * (s.mat === "tierra" ? s.hw - .9 : s.hw), nCar = Math.floor(ancho / CAR + 1e-6);
      // y la ley (CABA): en las avenidas de doble mano no se estaciona (de 7 a 21, casi todo el día del juego)
      const lados = s.type === "pasaje" || s.type === "ave" ? [] : nCar >= 4 ? [1, -1] : nCar >= 3 ? [s.id % 2 ? 1 : -1] : [];
      for (const side of lados) lanes.push({ off: side * park, hd: r() < .5 ? 0 : Math.PI, p: (s.mat === "tierra" ? .06 : s.type === "ave" ? .14 : .13) * C.estacionados });
      if (s.type !== "pasaje" && (conMed ? nCar >= 1 : nCar >= 2)) { const lane = laneOff(s); lanes.push({ off: -lane, hd: 0, p: .03 * C.transito, moving: true }); lanes.push({ off: lane, hd: Math.PI, p: .03 * C.transito, moving: true }); }
      const base = Math.atan2(s.dir[1], s.dir[0]);
      for (const ln of lanes) for (let t = r.uni(2, 8); t < s.len - 5;) {
        if (r() > ln.p) { t += 3; continue; }
        const hd = base + ln.hd, p = at(s, t, ln.off), c = W.classify(p[0], p[1]);
        if (!c || c.k !== "road" || c.s !== s || s.cross.some(x => Math.abs(t - x) < 4)) { t += 2; continue; }
        // estacionado: no en la esquina (hasta 5 m después de la vereda de la calle que cruza), no en la parada del colectivo ni
        // junto a un hidrante (Ley 24.449, art. 49; Código de Tránsito de CABA)
        if (!ln.moving && (esquinas(s).some(([tc, cl]) => Math.abs(t - tc) < cl) || cerca(paradas, p, 10) || cerca(hidrantes, p, 3))) { t += 2; continue; }
        if (!ln.moving && s.mat !== "tierra" && s.w > .3 && r() < .08) { put("u_contenedor", ...p, { flip: r() < .5 }); t += 4; continue; }
        const len = 4.6, ok = [-.45, -.2, 0, .2, .45].every(k => !occ.has(Math.floor((p[0] + Math.cos(hd) * len * k) / OC) * 100000 + Math.floor((p[1] + Math.sin(hd) * len * k) / OC)));
        if (ok) { [-.45, -.2, 0, .2, .45].forEach(k => claim(p[0] + Math.cos(hd) * len * k, p[1] + Math.sin(hd) * len * k, 1.0));
          const wreck = !ln.moving && s.w < .32 && r() < .07, color = wreck ? "burnt" : pickW(r, COLORES);
          if (conAutos && (!ln.moving || W.dentro(p[0], p[1]))) cars.push({ color, x: p[0], y: p[1], hd, moving: !!ln.moving }); }   // afuera, sólo estacionados
        t += len + r.uni(1, 6);
      }
      if (s.mat === "roto") for (let t = r.uni(5, 30); t < s.len - 5; t += r.uni(25, 60)) if (r() < .5) { const p = at(s, t, r.uni(-s.hw * .5, s.hw * .5)); if (put("u_valla", ...p)) { put("u_cono", p[0] + 1, p[1] - .6); put("u_cono", p[0] - 1, p[1] - .6); } }
    }
    // ---- recorte del catálogo de casas: las claves más usadas; el resto toma la más parecida del mismo ángulo
    // en el barrio real hay más edificios y galpones (casas más grandes): menos variedad, así el atlas del juego (8192×4096) alcanza
    { const tope = Math.round(Math.max(20, C.variedad | 0) * (W.estilo && W.estilo.variedad != null ? W.estilo.variedad : W.real ? .62 : 1)), hs = [...cat.values()].filter(e => e.spec.t === "casa").sort((a, b) => b.n - a.n), keep = new Set(hs.slice(0, tope).map(e => e.id));
      hs.filter(e => e.spec.co != null).slice(0, 20).forEach(e => keep.add(e.id));   // los locales coreanos de Carabobo no se pierden en el recorte
      hs.filter(e => e.spec.ct).forEach(e => keep.add(e.id));   // ni los comercios con nombre
      const kept = hs.filter(e => keep.has(e.id));
      for (const o of objs) { if (o.e.spec.t !== "casa" || keep.has(o.e.id)) continue; const sp = o.e.spec; let best = null, bs = 1e9;
        // las casillas de la villa pueden tomar una de hasta dos rumbos de distancia (15°): en la villa nada está en escuadra, y los
        // pasillos van para todos lados (en el barrio real serían cientos de casillas distintas sólo por el rumbo)
        // la que la reemplaza tiene que entrar en el lugar: ni más ancha que el lote ni más honda que la original (si no, en las
        // esquinas en ángulo de Parque Chas la casa se come la vereda de la otra calle)
        for (const e of kept) { const q = e.spec, da = Math.min(Math.abs(q.a - sp.a), 48 - Math.abs(q.a - sp.a)); if (da > (q.k === "villa" && sp.k === "villa" ? 2 : 0)) continue;
          if (q.W > o.place.uw + .01 || q.D > sp.D + .01) continue;
          const ed = (k) => k === "edificio" || k === "petit", sc = da * 6 + (q.k === sp.k ? 0 : (q.k === "villa") !== (sp.k === "villa") || ed(q.k) || ed(sp.k) ? 50 : 4) + Math.abs((q.p || 0) - (sp.p || 0)) * 8 + Math.abs(q.W - sp.W) * .6 + (q.W > o.place.uw + .01 ? 30 : 0) + Math.abs(q.D - sp.D) * .4 + (q.wb !== sp.wb ? 1 : 0) + ((q.co != null) !== (sp.co != null) ? 12 : q.co !== sp.co ? 3 : 0) + (!q.tj !== !sp.tj ? 6 : 0) + (q.ct !== sp.ct ? 60 : 0);
          if (sc < bs) { bs = sc; best = e; } }
        if (!best || bs > 40) { keep.add(o.e.id); kept.push(o.e); continue; }
        o.e.n--; best.n++; o.e = best;
        const lot = o.lot, u = o.place.u0 + (o.place.uw - best.spec.W) / 2, v = o.place.v0; o.x0 = lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v; o.y0 = lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v; }
      // dos casas iguales pegadas en la misma cuadra se notan (cuatro "TALLER" seguidos): la segunda toma la casa del catálogo
      // más parecida que no sea igual a su vecina (mismo rumbo, que entre en el lote)
      { const fr = objs.filter(o => o.kind === "house" && !o.back && o.lot && o.lot.seg && o.place);
        const tOf = (o) => (o.lot.o[0] - o.lot.seg.a[0]) * o.lot.seg.dir[0] + (o.lot.o[1] - o.lot.seg.a[1]) * o.lot.seg.dir[1];
        fr.sort((a, b) => a.lot.seg.id - b.lot.seg.id || a.lot.side - b.lot.side || tOf(a) - tOf(b));
        const score = (q, sp) => (q.k === sp.k ? 0 : 4) + Math.abs((q.p || 0) - (sp.p || 0)) * 8 + Math.abs(q.W - sp.W) * .6 + Math.abs(q.D - sp.D) * .4 + (q.wb !== sp.wb ? 1 : 0) + ((q.co != null) !== (sp.co != null) ? 12 : q.co !== sp.co ? 3 : 0) + (!q.tj !== !sp.tj ? 6 : 0) + (q.ct !== sp.ct ? 60 : 0);
        for (let i = 1; i < fr.length; i++) { const a = fr[i - 1], o = fr[i]; if (a.lot.seg !== o.lot.seg || a.lot.side !== o.lot.side || a.e !== o.e) continue;
          const sp = o.e.spec, ed = (k) => k === "edificio" || k === "petit" || k === "villa"; if (ed(sp.k)) continue;
          let best = null, bs = 1e9; for (const e of kept) { const q = e.spec; if (e === o.e || q.a !== sp.a || ed(q.k) || q.W > o.place.uw + .01 || q.D > sp.D + .01) continue; const sc = score(q, sp); if (sc < bs) { bs = sc; best = e; } }
          if (!best || bs > 20) continue;
          o.e.n--; best.n++; o.e = best; const lot = o.lot, u = o.place.u0 + (o.place.uw - best.spec.W) / 2, v = o.place.v0;
          o.x0 = lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v; o.y0 = lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v; } }
      for (const [k, e] of [...cat]) if (e.n <= 0) cat.delete(k); }
    // cazuelas: también en el mundo (el piso del editor las dibuja), con una grilla de 2 m para buscarlas rápido
    W.pits = pits; W.pitGrid = new Map(); for (const q of pits) { const k = Math.floor(q.x / 2) + "," + Math.floor(q.y / 2); if (!W.pitGrid.has(k)) W.pitGrid.set(k, []); W.pitGrid.get(k).push(q); }
    return { W, SEED, cat, objs, props, arboles, people, cables, cars, postes, pits, lineas, claim, occ };
  }
  // la casa/tapial/poste 3D de una clave del catálogo (misma semilla en el visor y en la exportación)
  function build3D(spec) {
    const phi = World.ANG[spec.a];
    if (spec.t === "casa") return Houses.build({ kind: spec.k, W: spec.W, D: spec.D, p: spec.p, seed: 1000 + spec.v * 7919 + spec.wb * 104729 + spec.a * 31 + Math.round(spec.W * 10) * 17 + (spec.co ?? 0) * 613 + (spec.tj ?? 0) * 389 + (spec.ct ? spec.ct.length * 977 + spec.ct.charCodeAt(spec.ct.length - 1) * 131 : 0), wealth: [.25, .7][spec.wb], co: spec.co, al: spec.al, tj: spec.tj, ct: spec.ct, rb: spec.rb }, phi);
    if (spec.t === "esquina") return Houses.esquina({ W: spec.W, D: spec.D, c: spec.c, p: spec.p, rub: spec.rub, seed: 9000 + spec.rub * 7919 + spec.p * 104729 + spec.a * 31, wealth: .5 }, phi);
    if (spec.t === "paredon") return Houses.paredon(spec.W, 700 + spec.s, phi);
    if (spec.t === "tapial") return Houses.tapial(spec.W, 500 + spec.s, spec.tk, phi);
    return Houses.poste(7, phi, !!spec.l);
  }
  // Qué cuadro y qué espejo usa un prop que mira hacia (sx, sy) en pantalla (sy > 0: hacia abajo, hacia la cámara).
  // Los props de Gemini con vista de atrás (nombre + "_atras") la usan cuando miran para arriba (se alejan de la cámara).
  // MIRA: hacia qué lado mira el dibujo sin espejo, [frente, atrás] (true: a la derecha). Lo común: el frente a la
  // derecha y la espalda (girada 180°) a la izquierda; el banco de hormigón al revés; la farola LED, con el brazo a la derecha en las dos.
  const MIRA = { u_banco: [false, true], u_farola: [true, true] };
  function vista(F, name, sx, sy) {
    const atras = sy < 0 && !!F[name + "_atras"], m = MIRA[name] || [true, false], der = m[atras ? 1 : 0];
    return [atras ? name + "_atras" : name, der ? sx < 0 : sx > 0];
  }
  return { generate, build3D, Q, aIdx, vista };
})();
