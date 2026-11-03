// ===================== barrio.js — el barrio como datos (en metros) =====================
// Una sola generación para todo: el visor la dibuja y la exportación la hornea para WeedJS, así lo que se ve es lo que
// se exporta. Las casas, tapiales y postes salen de un catálogo compartido (ángulos cuantizados, medidas redondeadas),
// recortado a "variedad de casas" para que entren en el atlas del juego.
const Barrio = (() => {
  const Q = Math.PI / 12, qa = (a) => Math.round(a / Q) * Q, aIdx = (a) => ((Math.round(a / Q) % 24) + 24) % 24;
  const Wb = (w, step) => Math.max(3, Math.floor(w / step + 1e-6) * step);
  const Db = (d, deep) => deep ? (d < 6 ? 5 : d < 8 ? 7 : d < 10 ? 9 : 11) : d;
  // ocupación (m): lo que reserva cada cosa, para que nada se pise
  const RAD = [["plm_santarita", .7], ["plm_", .35], ["pl_", .22], ["yy_", .2], ["arbol", .4], ["u_farol", .2], ["u_semaforo", .18], ["u_cono", .14], ["u_valla", .45], ["u_contenedor", .8], ["u_campana", .5], ["u_tablero", .35], ["u_caja", .3],
    ["u_refugio", 1.2], ["u_kiosco", 1.5], ["carro_cartonero", 1.0], ["chango", .5], ["gomas", .55], ["chapas", .5], ["u_tanque", .6], ["u_banco", .9], ["u_parada", .25], ["u_cesto", .3], ["u_poste_trafo", .45], ["canasto", .35], ["cartel", .2], ["pizarra", .3], ["obra_material", .7], ["bolsas", .35], ["parrilla", .7], ["pileta", 1.4]];
  // colisión (m): sólo lo que frena un auto
  const COLR = [["arbol", .28], ["u_farol", .14], ["u_semaforo", .12], ["cartel", .07], ["canasto", .08], ["u_contenedor", .75], ["u_campana", .55],
    ["u_refugio", .9], ["u_kiosco", 1.1], ["carro_cartonero", .7], ["u_tanque", .45], ["u_banco", .45], ["u_parada", .08], ["u_cesto", .1], ["u_poste_trafo", .22], ["u_valla", .35], ["obra_material", .5], ["parrilla", .55], ["pileta", 1.3], ["u_tablero", .3], ["u_caja", .25]];
  const lookup = (tbl, n, d) => { for (const [p, v] of tbl) if (n.startsWith(p)) return v; return d; };
  const SH = (n) => n.startsWith("plm_") ? "sh_small" : n.startsWith("u_farol") || n.startsWith("u_poste") || n.startsWith("u_parada") ? "sh_pole" : n.startsWith("u_cesto") || n.startsWith("u_banco") || n.startsWith("u_kiosco") ? "sh_small" : n.startsWith("u_contenedor") || n.startsWith("canasto") || n.startsWith("u_campana") ? "sh_small" : null;
  // colores de autos (los del juego); "burnt" = chatarra quemada
  const COLORES = [["red", 1.6], ["white", 1.6], ["black", 1.4], ["blue", 1.4], ["yellow", 1], ["poli", .4]];
  const pickW = (r, tbl) => { let t = tbl.reduce((a, b) => a + b[1], 0) * r(); for (const [n, w] of tbl) { t -= w; if (t <= 0) return n; } return tbl[0][0]; };

  function generate(SEED, C, F) {
    const W = World.generate(SEED), r = R3.rng(SEED ^ 0x5bd1e995), rx = R3.rng(SEED ^ 0x27d4eb2f);   // rx: props nuevos (no corre el sorteo de lo demás)
    const occ = new Set(), OC = .4;
    function claim(x, y, rad) { const keys = []; for (let i = Math.floor((x - rad) / OC); i <= Math.floor((x + rad) / OC); i++) for (let j = Math.floor((y - rad) / OC); j <= Math.floor((y + rad) / OC); j++) {
        const cx = (i + .5) * OC, cy = (j + .5) * OC; if ((cx - x) ** 2 + (cy - y) ** 2 <= (rad + OC * .5) ** 2) { const k = i * 100000 + j; if (occ.has(k)) return false; keys.push(k); } }
      keys.forEach(k => occ.add(k)); return true; }
    const conGente = C.conGente !== 0, conAutos = C.conAutos !== 0;
    // ---- catálogo
    const cat = new Map(), objs = [];
    function want(spec) { const k = JSON.stringify(spec); let e = cat.get(k); if (!e) { e = { spec, n: 0, id: cat.size }; cat.set(k, e); } e.n++; return e; }
    function addObj(kind, spec, lot, x0, y0, phiQ, place, collider, extra = {}) { const e = want(spec); const o = { kind, e, x0, y0, phiQ, place, collider, lot, ...extra }; objs.push(o); return o; }
    // ---- registros
    const props = [], arboles = [], people = [], cables = [], cars = [], postes = [];
    const VAR = {}; for (const n of Object.keys(F)) { const m = /^(.+)_([b-z])$/.exec(n); if (m && F[m[1]]) (VAR[m[1]] ||= [m[1]]).push(n); }
    function put(name, x, y, opt = {}) {
      if (VAR[name]) { const h = Math.abs(Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(y * 10), 19349663)); name = VAR[name][h % VAR[name].length]; }
      if (!F[name]) return null;
      if (!opt.noClaim && !claim(x, y, opt.rad ?? lookup(RAD, name, .3))) return null;
      const e = { f: name, x, y, flip: !!opt.flip, cr: opt.noCollide ? 0 : lookup(COLR, name, 0), sh: opt.shadow ?? SH(name), face: opt.face || null };
      props.push(e); return e;
    }
    // árbol: un tipo procedural según la riqueza del lugar (lleva el mismo sorteo que antes, así el resto no cambia)
    function arbol(x, y, flip) { const t = Arboles.pick(r, W.wealthAt(x, y)); if (!claim(x, y, .4)) return null; const a = { t, x, y, flip: !!flip, cr: .28 }; arboles.push(a); return a; }
    const person = (x, y, stay) => { if (conGente) people.push({ x, y, stay: !!stay }); };
    const at = (s, t, off) => [s.a[0] + s.dir[0] * t + s.n[0] * off, s.a[1] + s.dir[1] * t + s.n[1] * off];

    // ---- casas y tapiales
    for (const lot of W.lots) {
      const phiQ = qa(lot.phi);
      const LP = (u, v) => [lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v, lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v];
      const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => LP(u, v));
      if (lot.kind === "baldio") {
        if (lot.seg.type !== "pasillo") { const tk = r.pick(["tapia", "ladrillo", "alambre", "alambre"]), wq = Wb(lot.fw, 2);
          const o = LP((lot.fw - wq) / 2, 0); addObj("tapial", { t: "tapial", tk, W: wq, a: aIdx(lot.phi), s: 0 }, lot, o[0], o[1], phiQ, null, rect(0, lot.fw, 0, .25)); }
        const c = LP(lot.fw / 2, lot.ld / 2);
        if (r() < .5 * C.arboles) arbol(c[0], c[1], r() < .5);
        if (r() < .5) put("bolsas_" + r.int(0, 1), c[0] + r.uni(-2, 2), c[1] + r.uni(-2, 2));
        // yuyos del baldío: matas altas y secas, cardos, ortigas, mostacilla
        if (F.yy_seco_alto) { const n = Math.round(lot.fw * lot.ld / 14 * rx.uni(.5, 1.2));
          for (let k = 0; k < n; k++) { const q = LP(rx.uni(.4, lot.fw - .4), rx.uni(.6, lot.ld - .4));
            put(rx.pick(["yy_seco_alto", "yy_seco_alto_b", "yy_mostacilla", "yy_mostacilla_b", "yy_avena", "yy_cardo", "yy_ortiga", "yy_ortiga_c", "yy_cola_zorro", "yy_pasto_seco", "yy_gramilla"]), q[0], q[1], { rad: .25 }); } }
        continue;
      }
      // edificios: sólo en lotes hondos; si no entra, casa de dos plantas
      if ((lot.kind === "edificio" || lot.kind === "petit") && lot.ld < (lot.kind === "edificio" ? 14 : 11)) lot.kind = "casa2";
      if (lot.kind === "edificio" || lot.kind === "petit") {
        const ed = lot.kind === "edificio", D = ed ? (lot.ld > 20 ? 14 : 11) : 9, wq = Math.min(lot.fw, Wb(lot.fw, 2)), o = LP((lot.fw - wq) / 2, 0);
        const p = ed ? (lot.w > .75 || lot.seg.type === "ave" ? r.pick([6, 8, 10]) : r.pick([4, 6])) : r.pick([2, 3]);
        addObj("house", { t: "casa", k: lot.kind, W: wq, D, a: aIdx(lot.phi), wb: 1, v: 0, p }, lot, o[0], o[1], phiQ, { u0: 0, uw: lot.fw, v0: 0 }, rect(0, lot.fw, 0, D));
        for (let u = .2; u < lot.fw; u += .4) for (let v = -.6; v < D + 1.5; v += .4) { const [x, y] = LP(u, v); occ.add(Math.floor(x / OC) * 100000 + Math.floor(y / OC)); }
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
        addObj("house", { t: "casa", k: k2, W: bw, D: bd, a: aIdx(lot.phi), wb: Math.min(1, wb), v: 0 }, lot, bx, by, phiQ, { u0: bu, uw: bw, v0: bv }, rect(bu, bu + bw, bv, bv + bd), { back: true });
        occRect(bu, bu + bw, bv - .6, bv + bd + .5); backV = bv;
      }
      if ((backV || lot.ld) - depthTot > 3.5) { const pp = () => LP(r.uni(.8, lot.fw - .8), r.uni(depthTot + 2.2, (backV || lot.ld) - .8));
        if (r() < .3 * C.arboles) { const p = pp(); arbol(p[0], p[1], r() < .5); }
        if (F.plm_rosal && rx() < .35) put(rx.pick(lot.w < .3 ? ["plm_tomates", "plm_yuyos", "pl_cubierta", "plm_santarita", "plm_lantana", "plm_romero"] : ["plm_rosal", "plm_jazmin", "pl_hortensia", "plm_agapanto", "plm_santarita", "plm_lantana", "plm_romero", "pl_limonero", "plm_pindo"]), ...pp());
        if ((lot.kind === "villa" || lot.w < .25) && rx() < .5) put(rx.pick(["u_tanque", "chapas", "gomas", "parrilla_tambor", "silla", "antena", "garrafa"]), ...pp());
        if (r() < .2) put("parrilla", ...pp()); if (lot.w > .3 && r() < .1) put("pileta", ...pp()); if (r() < .08 * C.gente) { const p = pp(); person(p[0], p[1], true); } }
      const s = lot.seg, side = lot.side, mid = (lot.o[0] - s.a[0]) * s.dir[0] + (lot.o[1] - s.a[1]) * s.dir[1] + (side === 1 ? lot.fw / 2 : -lot.fw / 2);
      if (s.sw > 1) {
        const near = (dd) => at(s, mid + r.uni(-lot.fw / 3, lot.fw / 3), side * (s.hw + s.sw - dd));
        const nearX = (dd, du = 0) => at(s, mid + du, side * (s.hw + s.sw - dd));      // con rx: no corre el sorteo de las casas
        if ((lot.kind === "negocio" || lot.kind === "negocio_casa") && r() < .6) put("pizarra_" + r.int(0, 2), ...near(.9));
        if (lot.kind === "obra" && r() < .5) put("obra_material", ...near(1.1));
        if (r() < (lot.w < .3 ? .05 : .14)) put("canasto_" + r.int(0, 2), ...near(.45), { noClaim: true });   // pegado al frente: la casa ya reservó esa franja
        // plantas en macetas contra el frente (más en zonas ricas) y alguna Santa Rita
        if (F.pl_malvon && rx() < .22 + .4 * lot.w) { const n = 1 + (rx() < .4) + (rx() < .2 * lot.w);
          const POT = lot.kind === "villa" || lot.w < .25 ? ["pl_balde", "pl_botellas", "pl_aloe", "pl_malvon", "pl_cactus", "plm_yuyos", "pl_potus", "pl_cubierta", "plm_tomates", "pl_balde"]
            : lot.w > .6 ? ["pl_hortensia", "pl_malvon", "pl_sansevieria", "plm_jazmin", "plm_rosal", "pl_boj", "pl_calas", "pl_limonero", "pl_ficus", "pl_helecho", "pl_lavanda", "plm_yuca"]
            : ["pl_malvon", "pl_potus", "pl_aloe", "pl_cactus", "pl_sansevieria", "pl_hortensia", "plm_rosal", "pl_clivia", "pl_helecho", "pl_calas", "pl_malvon"];
          const u0 = rx.uni(-lot.fw / 3, lot.fw / 3 - .5 * n);           // en fila, pegadas al frente
          for (let k = 0; k < n; k++) put(rx.pick(POT), ...nearX(rx.uni(.22, .36), u0 + k * rx.uni(.42, .6)), { noClaim: true }); }
        if (F.plm_santarita && lot.w > .35 && rx() < .06) put("plm_santarita", ...nearX(.5, rx.uni(-lot.fw / 3, lot.fw / 3)), { noClaim: true });
        if ((lot.kind === "villa" || lot.w < .22) && rx() < .3) put(rx.pick(["garrafa", "silla", "cajones", "gomas", "chapas", "parrilla_tambor", "carro_cartonero", "chango", "silla"]), ...nearX(rx.uni(.9, 1.3), rx.uni(-lot.fw / 3, lot.fw / 3)));
        if (r() < .04) put(r.pick(["u_tablero", "u_caja_bsas"]), ...near(.4));
      }
    }
    // ---- veredas: árboles, gente, faroles, postes con cables
    for (const s of W.segs) {
      if (s.type === "pasillo") { for (let t = r.uni(2, 8); t < s.len; t += r.uni(6, 14)) if (r() < .12 * C.gente) { const p = at(s, t, r.uni(-.4, .4)); person(p[0], p[1], false); } continue; }
      const crossNear = (t) => s.cross.some(c => Math.abs(t - c) < 3);
      for (const side of [1, -1]) {
        if (s.sw >= 2.2) for (let t = r.uni(3, 9); t < s.len - 3; t += r.uni(7, 13)) {
          if (crossNear(t) || r() > (.3 + .55 * s.w) * C.arboles) continue; const p = at(s, t, side * (s.hw + (s.cantero ? .6 : .55)));
          const c = W.classify(p[0], p[1]); if (c && c.k === "walk" && c.s === s) arbol(p[0], p[1], r() < .5); }
        // canteros y cazuelas: agapantos, yuyos, bojs y arbolitos con jaula cerca del cordón
        if (F.plm_agapanto && s.sw >= 1.6) for (let t = rx.uni(2, 8); t < s.len - 2; t += rx.uni(5, 13)) {
          if (crossNear(t) || rx() > .35 + .3 * s.w) continue; const p = at(s, t, side * (s.hw + .5)), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk" || c.s !== s) continue;
          put(rx() < .06 ? "pl_jaula" : rx.pick(s.w > .55 ? ["plm_agapanto", "pl_boj", "plm_agapanto", "plm_jazmin", "plm_formio", "pl_lavanda", "plm_lantana"] : s.w < .3 ? ["plm_yuyos", "plm_yuyos", "plm_agapanto", "yy_seco_alto", "yy_mostacilla"] : ["plm_agapanto", "plm_yuyos", "pl_boj", "plm_romero", "plm_lantana"]), p[0], p[1]); }
        // yuyos que salen solos: junto al cordón, en las grietas de la vereda y contra las paredes (más en los barrios pobres y en las calles de tierra)
        if (F.yy_diente_leon && s.sw >= 1) { const dens = (s.mat === "tierra" ? 1.6 : s.mat === "roto" ? 1 : .45) * (1.3 - s.w);
          for (let t = rx.uni(.5, 4); t < s.len - .5; t += rx.uni(1.5, 5) / Math.max(.15, dens)) {
            if (crossNear(t)) continue; const where = rx(), off = where < .5 ? s.hw + rx.uni(.08, .3) : where < .8 ? s.hw + rx.uni(.4, s.sw - .4) : s.hw + s.sw - rx.uni(.1, .35);
            const p = at(s, t, side * off), c = W.classify(p[0], p[1]); if (!c || c.k !== "walk") continue;
            put(where < .8 ? rx.pick(["yy_diente_leon", "yy_diente_leon_b", "yy_trebol", "yy_llanten", "yy_brotes", "yy_gramilla", "yy_grieta", "yy_pasto_seco", "yy_musgo"])
              : rx.pick(["yy_ortiga", "yy_ortiga_b", "yy_cola_zorro", "yy_avena", "yy_diente_leon", "yy_cardo", "yy_mostacilla"]), p[0], p[1], { rad: .12 }); } }
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
        if (F.u_banco && rx() < .6) { const b = at(s, t + 2.6, side * (s.hw + 1.3)), q = at(s, t + 2.6, 0); if (W.classify(b[0], b[1])?.k === "walk") put("u_banco", b[0], b[1], { face: [b[0] - q[0], b[1] - q[1]] }); } }
      if (s.type !== "ave" && s.sw > 1) {
        const side = rx() < .5 ? 1 : -1, phi = Math.atan2(s.dir[1], s.dir[0]), phiQ = qa(phi), luz = s.mat !== "asf" ? 1 : 0, pts = [], feet = [];
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
    // ---- esquinas
    for (const it of W.inters) {
      const { s, o, p } = it; if (s.type === "pasillo" || o.type === "pasillo") continue;
      const cands = []; for (const a of [1, -1]) for (const b of [1, -1]) cands.push([p[0] + s.dir[0] * a * (o.hw + o.sw * .5) + s.n[0] * b * (s.hw + s.sw * .5), p[1] + s.dir[1] * a * (o.hw + o.sw * .5) + s.n[1] * b * (s.hw + s.sw * .5)]);
      const ok = cands.filter(q => { const c = W.classify(q[0], q[1]); return c && c.k === "walk"; });
      if (ok.length) put("cartel", ...ok[0]);
      if ((s.type === "ave" || o.type === "ave" || (s.mat === "asf" && o.mat === "asf" && s.w > .45)) && ok.length > 1) { put("u_semaforo", ...ok[1]); if (ok[2]) put("u_semaforo", ...ok[2]); }
      if (s.mat !== "tierra" && r() < .25 && ok[3]) put("u_campana", ...ok[3]);
      const asf = s.mat === "asf" && o.mat === "asf", ave = s.type === "ave" || o.type === "ave";
      if (F.u_cesto && asf && rx() < .35 && ok.length) { const q = ok[ok.length - 1]; put("u_cesto", q[0] + s.dir[0] * 1.2, q[1] + s.dir[1] * 1.2); }
      if (F.u_poste_trafo && s.mat !== "tierra" && !ave && rx() < .1 && ok.length > 1) { const q = ok[1]; put("u_poste_trafo", q[0] - s.dir[0] * 1.5, q[1] - s.dir[1] * 1.5); }
      if (F.u_kiosco && ave && rx() < .3 && ok.length) { const q = ok[0], d = (o.hw + o.sw) + 3; for (const sg of [1, -1]) { const k = [q[0] + s.dir[0] * sg * d * .5, q[1] + s.dir[1] * sg * d * .5];
        if (W.classify(k[0], k[1])?.k === "walk" && put("u_kiosco", k[0], k[1], { flip: rx() < .5 })) break; } }
    }
    // ---- autos (estacionados y circulando) y contenedores
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
          const wreck = !ln.moving && s.w < .32 && r() < .07, color = wreck ? "burnt" : pickW(r, COLORES);
          if (conAutos) cars.push({ color, x: p[0], y: p[1], hd, moving: !!ln.moving }); }
        t += len + r.uni(1, 6);
      }
      if (s.mat === "roto") for (let t = r.uni(5, 30); t < s.len - 5; t += r.uni(25, 60)) if (r() < .5) { const p = at(s, t, r.uni(-s.hw * .5, s.hw * .5)); if (put("u_valla", ...p)) { put("u_cono", p[0] + 1, p[1] - .6); put("u_cono", p[0] - 1, p[1] - .6); } }
    }
    // ---- recorte del catálogo de casas: las claves más usadas; el resto toma la más parecida del mismo ángulo
    { const tope = Math.max(20, C.variedad | 0), hs = [...cat.values()].filter(e => e.spec.t === "casa").sort((a, b) => b.n - a.n), keep = new Set(hs.slice(0, tope).map(e => e.id));
      const kept = hs.filter(e => keep.has(e.id));
      for (const o of objs) { if (o.e.spec.t !== "casa" || keep.has(o.e.id)) continue; const sp = o.e.spec; let best = null, bs = 1e9;
        for (const e of kept) { const q = e.spec; if (q.a !== sp.a) continue;
          const ed = (k) => k === "edificio" || k === "petit", sc = (q.k === sp.k ? 0 : (q.k === "villa") !== (sp.k === "villa") || ed(q.k) || ed(sp.k) ? 50 : 4) + Math.abs((q.p || 0) - (sp.p || 0)) * 8 + Math.abs(q.W - sp.W) * .6 + (q.W > o.place.uw + .01 ? 30 : 0) + Math.abs(q.D - sp.D) * .4 + (q.wb !== sp.wb ? 1 : 0);
          if (sc < bs) { bs = sc; best = e; } }
        if (!best || bs > 40) { keep.add(o.e.id); kept.push(o.e); continue; }
        o.e.n--; best.n++; o.e = best;
        const lot = o.lot, u = o.place.u0 + (o.place.uw - best.spec.W) / 2, v = o.place.v0; o.x0 = lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v; o.y0 = lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v; }
      for (const [k, e] of [...cat]) if (e.n <= 0) cat.delete(k); }
    return { W, SEED, cat, objs, props, arboles, people, cables, cars, postes, claim, occ };
  }
  // la casa/tapial/poste 3D de una clave del catálogo (misma semilla en el visor y en la exportación)
  function build3D(spec) {
    const phi = spec.a * Q;
    if (spec.t === "casa") return Houses.build({ kind: spec.k, W: spec.W, D: spec.D, p: spec.p, seed: 1000 + spec.v * 7919 + spec.wb * 104729 + spec.a * 31 + Math.round(spec.W * 10) * 17, wealth: [.25, .7][spec.wb] }, phi);
    if (spec.t === "tapial") return Houses.tapial(spec.W, 500 + spec.s, spec.tk, phi);
    return Houses.poste(7, phi, !!spec.l);
  }
  return { generate, build3D, Q, aIdx };
})();
