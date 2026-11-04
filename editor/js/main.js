// ===================== main.js — visor, capas, depuración, física (planck/Box2D) y manejo =====================
(async () => {
  const $ = (id) => document.getElementById(id);
  const pl = planck, V2 = pl.Vec2;
  const MOBILE = matchMedia("(pointer: coarse)").matches || innerWidth < 760;
  const loadImg = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("no cargó una imagen")); i.src = src; });
  // atlas v4 + los árboles procedurales (a la escala del barrio) en la franja libre de abajo
  const atlasImg = await (async () => { const im = await loadImg(ASSETS_PNG), cv = document.createElement("canvas"); cv.width = 2048; cv.height = 2560;
    const g = cv.getContext("2d"); g.drawImage(im, 0, 0); let x = 0, y = im.height + 2, rowH = 0;
    for (const t of Arboles.TIPOS) { const v = Arboles.render(t).vista; if (x + v.w > 2048) { x = 0; y += rowH + 2; rowH = 0; }
      g.drawImage(v.canvas, x, y); ASSETS.frames["arbol_" + t] = { x, y, w: v.w, h: v.h, ox: Math.round(v.ox), oy: Math.round(v.oy) }; x += v.w + 2; rowH = Math.max(rowH, v.h); }
    // props HD (Gemini, 30 px/m): el visor los usa achicados a la escala del barrio; el exportador copia el original (f.hd)
    if (typeof HD_ASSETS !== "undefined") { const hi = await loadImg(HD_PNG); x = 0; y += rowH + 2; rowH = 0;
      g.imageSmoothingQuality = "high";
      for (const [n, h] of Object.entries(HD_ASSETS.frames)) { const e = h.e || HD_ASSETS.escala, w = Math.ceil(h.w * e), hh = Math.ceil(h.h * e); if (x + w > 2048) { x = 0; y += rowH + 2; rowH = 0; }
        g.drawImage(hi, h.x, h.y, h.w, h.h, x, y, h.w * e, h.h * e);
        ASSETS.frames[n] = { x, y, w, h: hh, ox: Math.round(h.ox * e), oy: Math.round(h.oy * e), hd: { img: hi, ...h, e } }; x += w + 2; rowH = Math.max(rowH, hh); } }
    // piezas de fachada (Gemini): R3 las pega en las paredes al hornear las casas
    if (typeof FACHADA !== "undefined") { const fi = await loadImg(FACHADA_PNG), c2 = document.createElement("canvas"); c2.width = fi.width; c2.height = fi.height;
      const g2 = c2.getContext("2d", { willReadFrequently: true }); g2.drawImage(fi, 0, 0);
      for (const [n, f] of Object.entries(FACHADA.frames)) R3.DECALS[n] = { w: f.w, h: f.h, d: g2.getImageData(f.x, f.y, f.w, f.h).data }; }
    return cv; })();
  const F = ASSETS.frames;
  const G = Gfx.init($("stage"), atlasImg, F), cvs = G.canvas, BB = Gfx.BB, DC = Gfx.DC;
  const scr = { get width() { return innerWidth; }, get height() { return innerHeight; } };
  // "world" = transformación 2D de la pantalla (paneo + zoom) sobre la proyección girada; misma semántica que el contenedor de Pixi
  const world = { x: 0, y: 0, scale: { x: 1, set(v) { this.x = v; } } };
  const P = (x, y, z = 0) => Cam.P(x, y, z);                     // mundo (m) -> px de mundo (con giro)
  const unP = (sx, sy) => Cam.unP(sx, sy);                        // px de mundo -> mundo (z = 0)
  R3.setLight(CFG.v); Gfx.setLight(CFG.v);
  const dbg = Gfx.overlay($("stage")), dbgDyn = Gfx.overlay($("stage"));
  const LAYERS = [["ground", "Piso"], ["shadow", "Sombras al piso"], ["houses", "Casas, tapiales y postes"], ["props", "Mobiliario y props"],
    ["trees", "Árboles"], ["people", "Gente"], ["vehicles", "Autos"], ["cables", "Cables"]];
  const VIS = Object.fromEntries(LAYERS.map(([k]) => [k, true]));
  const DEBUG = [["ejes", "Ejes de calles (color = tipo)"], ["bordes", "Bordes de calzada y vereda"], ["material", "Material de calzada"], ["loteos", "Loteos y su grilla"],
    ["riqueza", "Mapa de riqueza"], ["lotes", "Lotes (color = tipo de casa)"], ["colisiones", "Colisionadores (física)"], ["ocupacion", "Grilla de ocupación (zoom ≥ 2)"],
    ["chunks", "Chunks del piso"], ["costos", "Grilla peatonal (costo de paso)"], ["flujo", "Flowfield de la gente"], ["costosAutos", "Grilla vehicular (costo de paso)"], ["flujoAutos", "Flowfield de los autos"], ["anclas", "Anclas (pie de cada sprite)"], ["cruces", "Cruces"], ["inspector", "Inspector (mouse + clic)"]];
  const DBG = Object.fromEntries(DEBUG.map(([k]) => [k, false])); DBG.inspector = true;
  const CAT = (n) => n.startsWith("utree_") || n.startsWith("arbol_") ? "trees" : n.startsWith("veh_") || n.startsWith("wreck_") ? "vehicles" : "props";

  // ---------- estado del mundo
  let W, SEED = +new URLSearchParams(location.search).get("semilla") || ((Math.random() * 1e9) | 0);   // ?semilla=N abre ese barrio
  let houses = [], chunks = new Map(), sprites = [], colliders = [], dyn = [], bakeTimes = [], yawDeps = [];
  let phys = null, city = null, player = null, driving = false;
  const crowd = Crowd({ F, CFG }), traffic = Traffic({ pl, V2, CFG, crowd });
  const PR = { gl: Gfx.gl, render: () => Gfx.render() };
  if (!window.__noPerf) Perf.init({ renderer: PR });
  let occ = new Set(); const OC = .4;
  function claim(x, y, rad) { const keys = []; for (let i = Math.floor((x - rad) / OC); i <= Math.floor((x + rad) / OC); i++) for (let j = Math.floor((y - rad) / OC); j <= Math.floor((y + rad) / OC); j++) {
      const cx = (i + .5) * OC, cy = (j + .5) * OC; if ((cx - x) ** 2 + (cy - y) ** 2 <= (rad + OC * .5) ** 2) { const k = i * 100000 + j; if (occ.has(k)) return false; keys.push(k); } }
    keys.forEach(k => occ.add(k)); return true; }
  // radio de ocupación (m): lugar que "reserva" cada cosa para que nada se pise
  const RAD = [["utree_", .4], ["u_farol", .2], ["u_semaforo", .18], ["u_bolardo", .14], ["u_cono", .14], ["u_valla", .45], ["u_contenedor", .8],
    ["u_campana", .5], ["u_tablero", .35], ["u_caja", .3], ["u_refugio", 1.2], ["canasto", .35], ["cartel", .2], ["pizarra", .3], ["obra_material", .7], ["bolsas", .35],
    ["parrilla", .7], ["pileta", 1.4], ["poste", .2], ["u_macetero", .6], ["u_baranda", .4]];
  // radio de colisión (m): sólo lo que frena un auto (tronco, poste, caño)
  const COLR = [["utree_", .28], ["u_farol", .14], ["u_semaforo", .12], ["u_bolardo", .1], ["cartel", .07], ["canasto", .08], ["u_contenedor", .75], ["u_campana", .55],
    ["u_refugio", .9], ["u_valla", .35], ["obra_material", .5], ["parrilla", .55], ["pileta", 1.3], ["u_tablero", .3], ["u_caja", .25], ["u_macetero", .55]];
  const lookup = (tbl, n, d) => { for (const [p, r] of tbl) if (n.startsWith(p)) return r; return d; };
  const SH = (n) => n.startsWith("utree_") ? "sh_tree" : n.startsWith("u_farol") ? "sh_pole" : n.startsWith("u_contenedor") || n.startsWith("canasto") || n.startsWith("u_campana") ? "sh_small" : null;

  // ---------- física
  function addStaticPoly(pts, tag) { city.createFixture(pl.Polygon(pts.map(p => V2(p[0], p[1]))), { friction: .4 }); colliders.push({ t: "poly", pts, tag, bb: bbox(pts) }); }
  function addStaticCircle(x, y, r, tag) { city.createFixture(pl.Circle(V2(x, y), r), { friction: .3 }); colliders.push({ t: "circ", c: [x, y], r, tag, bb: [x - r, y - r, x + r, y + r] }); }
  const bbox = (pts) => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  const lotRect = (lot, u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [lot.o[0] + lot.ux[0] * u + lot.nOut[0] * v, lot.o[1] + lot.ux[1] * u + lot.nOut[1] * v]);
  // medidas físicas (m) sacadas de cada sprite: largo = vista de costado, ancho = vista de frente sin espejos (18 px/m)
  const CAR = new Proxy({ bus: [7.8, 2.3] }, { get: (o, v) => o[v] || (o[v] = F[`veh_${v}_0`] ? [F[`veh_${v}_0`].w / R3.SF * .975, Math.min(1.85, F[`veh_${v}_12`].w / R3.SF * .83)] : [4.5, 1.75]) });
  const PARKED = [["sedan", 2], ["pickup", 1.6], ["van", 1.5], ["black", 1.4], ["blue", 1.4], ["red", 1.6], ["white", 1.6], ["yellow", .8], ["police", .5]];
  const MOVING = [["sedan", 2], ["pickup", 1.4], ["van", 1.2], ["black", 1.2], ["blue", 1.4], ["red", 1.6], ["white", 1.4], ["yellow", 1.4], ["police", .5]];
  // rumbo en el mundo -> rumbo en la "cámara" de los sprites de autos (con el giro de cámara y sin el corrimiento K)
  const vehPhi = (hd) => { const h = hd - Cam.yaw; return Math.atan2(Math.sin(h), Math.cos(h) + R3.K * Math.sin(h)); };
  const busOK = (hd) => { const d = ((hd * 180 / Math.PI) % 90 + 90) % 90; return d < 12 || d > 78; };
  function carBody(x, y, hd, veh, dynamic) {
    const [len, wid] = CAR[veh];
    const b = phys.createBody({ type: dynamic ? "dynamic" : "static", position: V2(x, y), angle: hd, linearDamping: 1.8, angularDamping: 3, allowSleep: true });
    b.createFixture(pl.Box(len / 2, wid / 2), { density: CFG.v.masa / (len * wid), friction: .3, restitution: .1 });
    return b;
  }
  const CARF = {}, BUSF = ["veh_bus_E", "veh_bus_N", "veh_bus_W", "veh_bus_S"];
  const carFrame = (veh, hd) => { const deg = ((vehPhi(hd) * 180 / Math.PI) % 360 + 360) % 360;
    if (veh !== "bus") { const t = CARF[veh] || (CARF[veh] = Array.from({ length: 48 }, (_, k) => `veh_${veh}_${k}`)); return t[((Math.round(-deg / 7.5) % 48) + 48) % 48]; }
    if (veh === "bus") return BUSF[Math.round(deg / 90) & 3];
    return `veh_${veh}_${((Math.round(-deg / 7.5) % 48) + 48) % 48}`; };

  // ---------- sprites del atlas (anclados en su pie, x/y en metros)
  // pie de un auto: el centro de su huella proyectada (depende del rumbo), medido desde el borde inferior del sprite
  const vehOy = (name, hd, veh) => { const ph = vehPhi(hd); return F[name].h - R3.SF * R3.SYN * (Math.abs(Math.sin(ph)) * CAR[veh][0] / 2 + Math.abs(Math.cos(ph)) * CAR[veh][1] / 2) - 1; };
  function placeSprite(s, name, x, y, flip, oy, ang) {
    BB.set(s.id, BB.frame(name), x, y, flip, oy ?? NaN); s.wx = x; s.wy = y; s.fname = name; s.flip = flip;
    if (s.sh >= 0) DC.set(s.sh, s.shName ? BB.frame(s.shName) : -1, x, y, ang ?? 0);
  }
  function put(name, x, y, opt = {}) {
    const f = F[name]; if (!f) { console.warn("falta", name); return null; }
    if (!opt.noClaim && !claim(x, y, opt.rad ?? lookup(RAD, name, .3))) return null;
    const cat = opt.cat || CAT(name), s = { id: BB.add(name, x, y, cat, !!opt.flip, opt.oy ?? NaN), cat, sh: -1, shName: null, visible: true, wx: x, wy: y, fname: name, flip: !!opt.flip };
    const sh = opt.shadow ?? SH(name); if (sh && F[sh]) { s.sh = DC.add(sh, x, y, opt.ang || 0, cat); s.shName = sh; }
    sprites.push(s);
    if (!opt.noCollide && phys) {
      const cr = lookup(COLR, name, 0); if (cr) addStaticCircle(x, y, cr, name);
    }
    return s;
  }
  // autos (y chatarra): el cuadro depende del rumbo visto desde la cámara
  function placeCar(s, veh, x, y, hd) {
    if (veh === "wreck") { const k = Math.round(-vehPhi(hd) / (Math.PI / 4)) & 7, wn = WRF[k]; placeSprite(s, wn, x, y, false, F[wn].h - 9, hd); return; }
    const fn = carFrame(veh, hd); if (fn) placeSprite(s, fn, x, y, false, vehOy(fn, hd, veh), hd);
  }
  const WRF = Array.from({ length: 8 }, (_, k) => `wreck_burnt_${k}`);
  // todo lo que depende del giro de cámara y no se actualiza solo (autos dormidos, faroles)
  function refreshYaw() {
    for (const b of dyn) if (b.sprite && b.veh) { const p = b.getPosition(); placeCar(b.sprite, b.veh, p.x, p.y, b.getAngle()); }
    for (const d of yawDeps) {
      if (d.veh) placeCar(d.s, d.veh, d.x, d.y, d.hd);
      else { const [n, fl] = Barrio.vista(F, d.f, Cam.C.ax * d.dx + Cam.C.ay * d.dy, Cam.C.bx * d.dx + Cam.C.by * d.dy);
        if (n !== d.s.fname) placeSprite(d.s, n, d.s.wx, d.s.wy, fl); else { BB.setFlip(d.s.id, fl); d.s.flip = fl; } }
    }
  }

  // ---------- objetos 3D (casas, tapiales, postes): se arman al acercarse la cámara
  // Cada uno se hornea una vez (luz y sombras en sus texturas) y queda como malla 3D: girar la cámara no re-hornea nada.
  let bakedCount = 0;
  function addBaked(kind, opt) { const o = { kind, ...opt, h3: null }; houses.push(o); return o; }
  function bake(o) {
    const t0 = performance.now(); let built;
    if (o.kind === "obj") built = Barrio.build3D(o.spec);
    else if (o.kind === "house") built = Houses.build({ kind: o.kind2 || o.lot.kind, W: o.W || o.lot.fw, D: o.D, seed: o.seed || o.lot.seed, wealth: o.lot.w }, o.lot.phi);
    else if (o.kind === "tapial") built = Houses.tapial(o.lot.fw, o.lot.seed, o.tkind, o.lot.phi);
    else built = o.built;
    if (o.kind === "postes") o.h3 = Gfx.addHouse(House3.bake(built, 0, 0, { groundShadow: false }), o.pts);
    else o.h3 = Gfx.addHouse(House3.bake(built, o.x, o.y));
    bakedCount++;
    bakeTimes.push(performance.now() - t0); if (bakeTimes.length > 60) bakeTimes.shift();
  }
  function unbake(o) { if (o.h3) { bakedCount--; Gfx.removeHouse(o.h3); o.h3 = null; } }
  function rebakeAll() { for (const o of houses) unbake(o); bkX = NaN; }

  // ---------- construir el barrio
  function build() {
    const t0 = performance.now();
    for (const o of houses) unbake(o);
    for (const [, c] of chunks) Gfx.removeChunk(c.h);
    chunks = new Map(); houses = []; bakedCount = 0; occ = new Set(); sprites = []; colliders = []; dyn = []; yawDeps = []; player = null; driving = false; updateDriveUI();
    BB.clear();
    W = World.generate(SEED); Ground.init(SEED);
    phys = new pl.World({ gravity: V2(0, 0) }); city = phys.createBody();
    for (const e of [[[0, 0], [W.MW, 0]], [[W.MW, 0], [W.MW, W.MH]], [[W.MW, W.MH], [0, W.MH]], [[0, W.MH], [0, 0]]]) city.createFixture(pl.Edge(V2(...e[0]), V2(...e[1])));
    const C = CFG.v, B = Barrio.generate(SEED, C, F), movingQ = []; occ = B.occ; lastB = B;
    // ---- casas y tapiales (del catálogo compartido que se exporta); los postes van agrupados por calle
    for (const o of B.objs) { if (o.kind === "poste") continue;
      addBaked("obj", { spec: o.e.spec, x: o.x0, y: o.y0 }); if (o.collider) addStaticPoly(o.collider, o.kind === "tapial" ? "tapial" : "casa"); }
    for (const p of B.postes) { const bp = Houses.poste(7, p.phiQ, !!p.luz); for (const f of p.feet) addStaticCircle(f[0], f[1], .15, "poste");
      addBaked("postes", { built: bp, pts: p.feet, x: p.feet[0][0], y: p.feet[0][1], x1: p.feet[p.feet.length - 1][0], y1: p.feet[p.feet.length - 1][1] }); }
    // ---- props y árboles
    // los que miran a algún lado: el cuadro (frente o atrás) y el espejo dependen del giro de la cámara
    for (const e of B.props) { let name = e.f, flip = e.flip;
      if (e.face) [name, flip] = Barrio.vista(F, e.f, Cam.C.ax * e.face[0] + Cam.C.ay * e.face[1], Cam.C.bx * e.face[0] + Cam.C.by * e.face[1]);
      const sp = put(name, e.x, e.y, { noClaim: true, flip, shadow: e.sh }); if (sp && e.face) yawDeps.push({ s: sp, f: e.f, dx: e.face[0], dy: e.face[1] }); }
    for (const a of B.arboles) put("arbol_" + a.t.replace(/_c$/, ""), a.x, a.y, { noClaim: true, flip: a.flip, shadow: "sh_tree", cat: "trees" });
    // ---- cables (tramos 3D)
    const cables = []; for (const c of B.cables) cables.push(c[0], c[1], c[2], c[3], c[4], c[5]); Gfx.setCables(cables);
    // ---- autos
    const VEH = { red: "red", white: "white", black: "black", blue: "blue", yellow: "yellow", poli: "police" };
    for (const c of B.cars) { const hd = c.hd;
      if (c.color === "burnt") { const sp = put(WRF[0], c.x, c.y, { noClaim: true, noCollide: true, shadow: "sh_car_h", ang: hd }); placeCar(sp, "wreck", c.x, c.y, hd); yawDeps.push({ s: sp, veh: "wreck", x: c.x, y: c.y, hd });
        const b = carBody(c.x, c.y, hd, "sedan", false); colliders.push({ t: "body", body: b, tag: "auto quemado" }); continue; }
      const veh = VEH[c.color] || "sedan", sp = put(carFrame(veh, hd), c.x, c.y, { noClaim: true, noCollide: true, shadow: "sh_car_h", ang: hd }); placeCar(sp, veh, c.x, c.y, hd);
      const b = carBody(c.x, c.y, hd, veh, true); b.sprite = sp; b.veh = veh; sp.body = b; dyn.push(b);
      if (c.moving) movingQ.push(b); else colliders.push({ t: "body", body: b, tag: veh }); }
    const peopleQ = B.people.map(p => [p.x, p.y, { stay: p.stay }]);
    // ---- gente: flowfields sobre calles/veredas, después ubicar a cada uno donde haya lugar
    crowd.reset(W, colliders, SEED);
    traffic.reset(W, phys, SEED); for (const b of movingQ) traffic.add(b); traffic.prune();
    for (const [x, y, opt] of peopleQ) if (claim(x, y, .3)) crowd.spawn(x, y, !!opt.stay);
    if (C.conGente !== 0) crowd.populate(C.personas, SEED);
    $("seed").textContent = SEED; bkX = NaN;
    buildStats = `generación: ${W.lots.length} lotes · ${W.segs.length} calles · ${colliders.length} colisionadores · ${dyn.length} autos dinámicos · ${crowd.count} personas · ${Math.round(performance.now() - t0)} ms`;
    dbgDirty = true;
  }
  let buildStats = "", lastB = null;
  window.__editor = { get barrio() { return lastB; }, get seed() { return SEED; }, F };

  // ---------- horneado perezoso (todo en metros del mundo; sirve para cualquier giro)
  const CHM = Gfx.CHM;
  function viewRect(m = 0) { const z = world.scale.x; return { x0: (-world.x) / z - m, y0: (-world.y) / z - m, x1: (scr.width - world.x) / z + m, y1: (scr.height - world.y) / z + m }; }
  // caja del mundo (m) que cubre la pantalla, con margen en px de pantalla
  const AABB = new Float64Array(4);
  // versión sin asignaciones de viewRect para el bucle por cuadro (un objeto fijo: usar el resultado enseguida)
  const VR = { x0: 0, y0: 0, x1: 0, y1: 0 }, UQ = new Float64Array(2);
  function viewRectS(m = 0) { const z = world.scale.x; VR.x0 = (-world.x) / z - m; VR.y0 = (-world.y) / z - m; VR.x1 = (scr.width - world.x) / z + m; VR.y1 = (scr.height - world.y) / z + m; return VR; }
  function viewAABB(m = 0) { const z = world.scale.x, vx0 = (-world.x) / z - m, vy0 = (-world.y) / z - m, vx1 = (scr.width - world.x) / z + m, vy1 = (scr.height - world.y) / z + m;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 4; k++) { const q = Cam.unPInto(k & 1 ? vx1 : vx0, k & 2 ? vy1 : vy0, UQ); if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    AABB[0] = x0; AABB[1] = y0; AABB[2] = x1; AABB[3] = y1; return AABB; }
  let pending = 0;
  let bkX = NaN, bkY = NaN, bkZ = NaN, bkYaw = NaN;
  function bakeTick() {
    if (pending === 0 && Math.abs(world.x - bkX) < 64 && Math.abs(world.y - bkY) < 64 && world.scale.x === bkZ && Cam.yaw === bkYaw) return;
    bkX = world.x; bkY = world.y; bkZ = world.scale.x; bkYaw = Cam.yaw;
    const t0 = performance.now(), budget = (driving ? 12 : 22) * (MOBILE ? .7 : 1), A = viewAABB(120), cx = (A[0] + A[2]) / 2, cy = (A[1] + A[3]) / 2;
    const need = [];
    for (let j = Math.floor(A[1] / CHM); j <= Math.floor(A[3] / CHM); j++) for (let i = Math.floor(A[0] / CHM); i <= Math.floor(A[2] / CHM); i++) {
      if ((i + 1) * CHM < -20 || j * CHM > W.MH + 20 || i * CHM > W.MW + 20 || (j + 1) * CHM < -20) continue;
      const k = i * 100000 + j; if (!chunks.has(k)) need.push([i, j, k]); }
    const M = 22, inA = (x, y) => x > A[0] - M && x < A[2] + M && y > A[1] - M && y < A[3] + M;
    for (const o of houses) { if (o.h3) continue;
      if (inA(o.x, o.y) || (o.x1 != null && inA(o.x1, o.y1))) need.push([o, Math.hypot(o.x - cx, o.y - cy)]); }
    for (const q of need) if (q.length === 3) q.push(Math.hypot((q[0] + .5) * CHM - cx, (q[1] + .5) * CHM - cy));
    // piso y casas en una sola cola por distancia al centro (así ninguno se queda sin turno)
    need.sort((a, b) => a[a.length - 1] - b[b.length - 1]);
    let done = 0;
    for (const q of need) { if (performance.now() - t0 > budget) break; done++;
      if (q.length === 4) { Perf.t(Perf.ID.piso); chunks.set(q[2], { i: q[0], j: q[1], h: Gfx.addChunk(q[0], q[1], Ground.bakeChunk(W, q[0], q[1])) }); Perf.e(Perf.ID.piso); dbgDirty = true; }
      else { Perf.t(Perf.ID.casas); bake(q[0]); Perf.e(Perf.ID.casas); } }
    pending = need.length - done;
    $("load").style.display = pending > 0 ? "block" : "none"; $("load").textContent = `armando el barrio… ${pending}`;
    const RF = (MOBILE ? 170 : 260) + Math.max(A[2] - A[0], A[3] - A[1]) / 2;
    if (bakedCount > (MOBILE ? 160 : 450)) for (const o of houses) if (o.h3 && Math.hypot(o.x - cx, o.y - cy) > RF) unbake(o);
    if (chunks.size > (MOBILE ? 110 : 400)) for (const [k, c] of chunks) if (Math.hypot((c.i + .5) * CHM - cx, (c.j + .5) * CHM - cy) > RF) { Gfx.removeChunk(c.h); chunks.delete(k); }
  }

  // ---------- manejo
  const keys = new Set();
  const DRIVE_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "]);
  function startDriving() {
    if (driving) return stopDriving();
    const v = viewRect(), [cx, cy] = unP((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2);
    // subirse al auto estacionado más cercano, o aparecer uno en la calle más cercana
    let best = null, bd = 40;
    for (const b of dyn) if (b.veh) { const p = b.getPosition(), d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = b; } }
    if (best && best.veh === "bus") best = null;
    if (!best) {
      let bs = null, bq = null, bdd = 1e9;
      for (const s of W.segs) { if (s.type === "pasillo") continue; const q = World.segDist(s, cx, cy); if (q.d < bdd) { bdd = q.d; bs = s; bq = q; } }
      if (!bs) return;
      const t = Math.max(3, Math.min(bs.len - 3, bq.t)), p = [bs.a[0] + bs.dir[0] * t - bs.n[0] * bs.hw * .4, bs.a[1] + bs.dir[1] * t - bs.n[1] * bs.hw * .4];
      const hd = Math.atan2(bs.dir[1], bs.dir[0]), sp = put(carFrame("sedan", hd), p[0], p[1], { noClaim: true, noCollide: true, shadow: "sh_car_h", ang: hd }); placeCar(sp, "sedan", p[0], p[1], hd);
      best = carBody(p[0], p[1], hd, "sedan", true); best.sprite = sp; best.veh = "sedan"; sp.body = best; dyn.push(best);
    }
    player = best; driving = true; if (player.ai) traffic.remove(player); player.setAwake(true); player.setSleepingAllowed(false);
    if (zoom < 2) setZoom(2); updateDriveUI();
  }
  function stopDriving() { driving = false; if (player) { player.setSleepingAllowed(true); player.setLinearDamping(1.8); } updateDriveUI(); }
  function updateDriveUI() { const b = $("bV"); if (b) { b.classList.toggle("on", driving); } $("drivehud").style.display = driving ? "block" : "none"; $("drivepad").style.display = driving && (MOBILE || ptrTouch) ? "block" : "none"; }
  let ptrTouch = false; window.addEventListener("pointerdown", e => { if (e.pointerType === "touch") ptrTouch = true; }, true);
  for (const el of document.querySelectorAll("#drivepad [data-k]")) {
    const k = el.dataset.k, on = (e) => { e.preventDefault(); keys.add(k); el.classList.add("on"); el.setPointerCapture?.(e.pointerId); }, off = (e) => { keys.delete(k); el.classList.remove("on"); };
    el.addEventListener("pointerdown", on); el.addEventListener("pointerup", off); el.addEventListener("pointercancel", off); el.addEventListener("pointerleave", off); }
  $("padExit").onclick = () => stopDriving();
  const MODELS_ALL = ["sedan", "pickup", "van", "black", "blue", "red", "white", "yellow", "police"];
  $("padCar").onclick = () => { if (player) setCarModel(MODELS_ALL[(MODELS_ALL.indexOf(player.veh) + 1) % MODELS_ALL.length]); };
  function setCarModel(veh) { if (!player) return; const [len, wid] = CAR[veh], f = player.getFixtureList(); player.destroyFixture(f);
    player.createFixture(pl.Box(len / 2, wid / 2), { density: CFG.v.masa / (len * wid), friction: .3, restitution: .1 }); player.veh = veh; }
  // fuerzas de un auto a partir de controles {up, down, steer (-1..1, + = izquierda), hand}
  function drive(b, ctl, dt, vmaxKmh) {
    const C = CFG.v, m = b.getMass(), v = b.getLinearVelocity(), a = b.getAngle();
    const fx = Math.cos(a), fy = Math.sin(a), rx = fy, ry = -fx;          // adelante y derecha, sin crear vectores
    const sp = v.x * fx + v.y * fy, lat = v.x * rx + v.y * ry;
    const grip = ctl.hand ? C.agarreMano : C.agarre;      // agarre: las ruedas no patinan de costado
    SV.x = -rx * lat * m * grip; SV.y = -ry * lat * m * grip; b.applyLinearImpulse(SV, b.getWorldCenter(), true);
    const vmax = vmaxKmh / 3.6;
    if (ctl.up) { if (sp < -.5) pushCar(b, fx, fy, m * C.freno); else if (sp < vmax) pushCar(b, fx, fy, m * C.acel); }
    if (ctl.down) { if (sp > .5 && !ctl.rev) pushCar(b, fx, fy, -m * C.freno); else if (sp > -vmax * .3 || ctl.rev && sp > -2.5) pushCar(b, fx, fy, -m * C.acel * .6); }
    b.setLinearDamping(C.rozamiento + (ctl.hand ? .8 : 0) + (!ctl.up && !ctl.down ? .4 : 0));
    const target = (ctl.steer || 0) * C.giro * Math.max(-1, Math.min(1, sp / 5)), av = b.getAngularVelocity();   // invertido en reversa
    b.setAngularVelocity(av + (target - av) * Math.min(1, 12 * dt));
    return sp;
  }
  function pushCar(b, fx, fy, k) { SV.x = fx * k; SV.y = fy * k; b.applyForceToCenter(SV, true); }
  const SV = V2(0, 0), PC = { up: 0, down: 0, hand: 0, steer: 0, rev: 0 };
  function playerControls() {
    PC.up = keys.has("w") || keys.has("arrowup"); PC.down = keys.has("s") || keys.has("arrowdown"); PC.hand = keys.has(" ");
    PC.steer = ((keys.has("a") || keys.has("arrowleft")) ? 1 : 0) - ((keys.has("d") || keys.has("arrowright")) ? 1 : 0); return PC;
  }
  // buffers fijos para autos activos y para el empujón de gente
  const AI_B = new Array(512), AI_C = new Array(512);
  const KCX = new Float32Array(512), KCY = new Float32Array(512), KCA = new Float32Array(512), KHL = new Float32Array(512), KHW = new Float32Array(512), KVX = new Float32Array(512), KVY = new Float32Array(512);
  const CAMW = new Float64Array(2);
  function camWorld() { const z = world.scale.x; return Cam.unPInto((scr.width / 2 - world.x) / z, (scr.height / 2 - world.y) / z, CAMW); }
  let acc = 0;
  function physTick(dt) {
    if (!phys) return;
    acc = Math.min(acc + dt, .25); let n = 0;
    const cam = camWorld(), cx = cam[0], cy = cam[1], R2 = CFG.v.radioSim ** 2;
    // IA de autos: controles una vez por cuadro; lejos de la cámara se duermen
    Perf.t(Perf.ID.flowfields); traffic.tick(); Perf.e(Perf.ID.flowfields);
    Perf.t(Perf.ID.transito);
    const TS = traffic.S; TS.rays = 0; let na = 0, moving = 0, blocked = 0, rev = 0;
    for (let k = 0, cars = traffic.cars; k < cars.length; k++) { const c = cars[k], b = c.b, q = b.getPosition();
      if ((q.x - cx) * (q.x - cx) + (q.y - cy) * (q.y - cy) > R2 || !traffic.ready) { if (b.isAwake()) { b.setSleepingAllowed(true); SV.x = 0; SV.y = 0; b.setLinearVelocity(SV); b.setAngularVelocity(0); b.setAwake(false); } continue; }
      b.setSleepingAllowed(false); b.setAwake(true); const dm = CAR[b.veh];
      AI_B[na] = b; AI_C[na] = traffic.control(c, dt, dm[0], dm[1]); na++;
      const v = b.getLinearVelocity(); if (v.x * v.x + v.y * v.y > 1) moving++; if (c.rev > 0) rev++; else if (c.blocked > 0) blocked++; }
    TS.active = na; TS.moving = moving; TS.blocked = blocked; TS.reversing = rev;
    Perf.e(Perf.ID.transito);
    Perf.t(Perf.ID.fisica);
    while (acc >= 1 / 60 && n++ < 15) {
      if (driving && player) drive(player, playerControls(), 1 / 60, CFG.v.vmax);
      for (let k = 0; k < na; k++) drive(AI_B[k], AI_C[k], 1 / 60, 60);
      phys.step(1 / 60, 8, 3); acc -= 1 / 60; }
    Perf.e(Perf.ID.fisica);
    if (driving && player) { const v = player.getLinearVelocity(), a = player.getAngle(), sp = v.x * Math.cos(a) + v.y * Math.sin(a), kmh = Math.round(Math.abs(sp) * 3.6);
      if (kmh !== lastKmh) { lastKmh = kmh; $("speed").textContent = kmh + " km/h" + (sp < -.3 ? " (R)" : ""); } }
    // gente: simulación + empujón de los autos despiertos
    Perf.t(Perf.ID.gente);
    const v = viewRectS(0);
    crowd.tick(dt, cx, cy, CFG.v.radioSim, v.x0, v.y0, v.x1, v.y1);
    let nk = 0;
    for (let k = 0; k < dyn.length && nk < 512; k++) { const b = dyn[k]; if (!b.veh || !b.isAwake()) continue; const q = b.getPosition(), vv = b.getLinearVelocity(), dm = CAR[b.veh];
      KCX[nk] = q.x; KCY[nk] = q.y; KCA[nk] = b.getAngle(); KHL[nk] = dm[0] / 2; KHW[nk] = dm[1] / 2; KVX[nk] = vv.x; KVY[nk] = vv.y; nk++; }
    crowd.pushByCars(KCX, KCY, KCA, KHL, KHW, KVX, KVY, nk);
    Perf.e(Perf.ID.gente);
    Perf.t(Perf.ID.sprites);
    for (let k = 0; k < dyn.length; k++) { const b = dyn[k]; if (!b.isAwake() || !b.sprite) continue; const p = b.getPosition();
      if (b.veh) placeCar(b.sprite, b.veh, p.x, p.y, b.getAngle());
      else placeSprite(b.sprite, b.sprite.fname, p.x, p.y, b.sprite.flip); }
    Perf.e(Perf.ID.sprites);
    if (driving && player) { const p = player.getPosition(), sx = Cam.sx(p.x, p.y), sy = Cam.sy(p.x, p.y), z = world.scale.x, k = CFG.v.camara;
      world.x += (scr.width / 2 - sx * z - world.x) * k; world.y += (scr.height / 2 - sy * z - world.y) * k; }
  }
  let lastKmh = -1;

  // ---------- depuración (dibujada en coordenadas de pantalla del mundo)
  let dbgDirty = true, dbgLast = 0, lastCam = "";
  const KIND_COL = { casa: 0x4fc3f7, casa2: 0x29b6f6, chalet: 0x81c784, negocio: 0xffb74d, negocio_casa: 0xffa726, ph: 0xba68c8, obra: 0xe57373, villa: 0xf06292, galpon: 0x90a4ae, baldio: 0xfff176 };
  const TYPE_COL = { ave: 0xff5252, calle: 0xffeb3b, pasaje: 0x40c4ff, pasillo: 0xe040fb };
  const MAT_COL = { asf: 0x9e9e9e, roto: 0xff9800, tierra: 0x8d6e63, pasillo: 0xce93d8 };
  const PL = (pts, close = true) => { const q = pts.map(p => P(p[0], p[1])); dbg.moveTo(q[0][0], q[0][1]); for (let i = 1; i < q.length; i++) dbg.lineTo(q[i][0], q[i][1]); if (close) dbg.lineTo(q[0][0], q[0][1]); };
  let hover = null, flowSel = 0;
  function drawDebug() {
    const z = world.scale.x, lw = 1.5 / z, v = viewRect(40); dbg.begin(world.x, world.y, z);
    const A = viewAABB(40), ax0 = A[0], ay0 = A[1], ax1 = A[2], ay1 = A[3];
    const inV = (bb) => !(bb[2] < ax0 - 20 || bb[0] > ax1 + 20 || bb[3] < ay0 - 20 || bb[1] > ay1 + 20);
    const segBB = (s) => [Math.min(s.a[0], s.b[0]) - s.hw - s.sw, Math.min(s.a[1], s.b[1]) - s.hw - s.sw, Math.max(s.a[0], s.b[0]) + s.hw + s.sw, Math.max(s.a[1], s.b[1]) + s.hw + s.sw];
    if (DBG.riqueza) { const step = 10 / Math.max(.5, Math.min(2, z));
      for (let y = Math.floor(ay0 / step) * step; y < ay1; y += step) for (let x = Math.floor(ax0 / step) * step; x < ax1; x += step) {
        if (x < 0 || y < 0 || x > W.MW || y > W.MH) continue; const w = W.wealthAt(x + step / 2, y + step / 2), c = (Math.round(255 * (1 - w)) << 16) | (Math.round(200 * w) << 8) | 60;
        PL([[x, y], [x + step, y], [x + step, y + step], [x, y + step]]); dbg.fill({ color: c, alpha: .35 }); } }
    if (DBG.loteos) for (const d of W.districts) { PL(d.poly); dbg.stroke({ width: 3 / z, color: d.type === "villa" ? 0xff4081 : 0xffffff, alpha: .9 });
      const u = [Math.cos(d.theta), Math.sin(d.theta)], L_ = 25; dbg.moveTo(...P(...d.p)); dbg.lineTo(...P(d.p[0] + u[0] * L_, d.p[1] + u[1] * L_)); dbg.moveTo(...P(...d.p)); dbg.lineTo(...P(d.p[0] - u[1] * L_, d.p[1] + u[0] * L_)); dbg.stroke({ width: 3 / z, color: 0x00e5ff }); }
    if (DBG.lotes) for (const lot of W.lots) { const bb = bbox(lot.q); if (!inV(bb)) continue; PL(lot.q); dbg.fill({ color: KIND_COL[lot.kind] || 0xffffff, alpha: .25 }); PL(lot.q); dbg.stroke({ width: lw, color: KIND_COL[lot.kind] || 0xffffff, alpha: .9 }); }
    for (const s of W.segs) {
      if (!inV(segBB(s))) continue;
      const off = (o) => [[s.a[0] + s.n[0] * o, s.a[1] + s.n[1] * o], [s.b[0] + s.n[0] * o, s.b[1] + s.n[1] * o]];
      if (DBG.material) { PL([...off(s.hw), ...off(-s.hw).reverse()]); dbg.fill({ color: MAT_COL[s.mat] || 0xffffff, alpha: .45 }); }
      if (DBG.bordes) { for (const o of [s.hw, -s.hw]) { PL(off(o), false); } dbg.stroke({ width: lw, color: 0xffffff, alpha: .9 });
        if (s.sw > 0) { for (const o of [s.hw + s.sw, -s.hw - s.sw]) PL(off(o), false); dbg.stroke({ width: lw, color: 0x69f0ae, alpha: .9 }); } }
      if (DBG.ejes) { PL([s.a, s.b], false); dbg.stroke({ width: 2.5 / z, color: TYPE_COL[s.type], alpha: 1 }); }
    }
    if (DBG.cruces) for (const it of W.inters) { const [x, y] = P(...it.p); dbg.circle(x, y, 4 / z); dbg.fill({ color: 0xff1744 }); }
    if (DBG.chunks) for (const [, c] of chunks) { const x = c.i * CHM, y = c.j * CHM; PL([[x, y], [x + CHM, y], [x + CHM, y + CHM], [x, y + CHM]]); dbg.stroke({ width: lw, color: 0xffff00, alpha: .6 }); }
    if (DBG.ocupacion && z >= 2) { const cell = OC;
      for (let j = Math.floor(ay0 / cell); j <= Math.floor(ay1 / cell); j++) for (let i = Math.floor(ax0 / cell); i <= Math.floor(ax1 / cell); i++)
        if (occ.has(i * 100000 + j)) { PL([[i * cell, j * cell], [(i + 1) * cell, j * cell], [(i + 1) * cell, (j + 1) * cell], [i * cell, (j + 1) * cell]]); dbg.fill({ color: 0xff00ff, alpha: .3 }); } }
    if (DBG.colisiones) for (const c of colliders) { if (c.t === "body") continue; if (!inV(c.bb)) continue;
      if (c.t === "poly") PL(c.pts); else { const [x, y] = P(...c.c); dbg.ellipse(x, y, c.r * R3.SF, c.r * R3.SF * R3.SYN); }
      dbg.stroke({ width: lw * 1.3, color: 0x00e5ff, alpha: .95 }); }
    if (DBG.anclas) {
      for (const s of sprites) { if (!s.visible || s.wx == null) continue; const [x, y] = P(s.wx, s.wy); if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
        dbg.moveTo(x - 4 / z, y); dbg.lineTo(x + 4 / z, y); dbg.moveTo(x, y - 4 / z); dbg.lineTo(x, y + 4 / z); }
      dbg.stroke({ width: lw, color: 0xff4081 });
      for (const o of houses) if (o.h3) { const [x, y] = P(o.x, o.y); dbg.circle(x, y, 3 / z); dbg.fill({ color: 0xffeb3b }); }
    }
    if (DBG.costos) crowd.costDraw(dbg, z, camCenterWorld());
    if (DBG.flujo) crowd.debugDraw(dbg, z, camCenterWorld(), flowSel % Math.max(1, crowd.targets.length));
    if (DBG.costosAutos) traffic.costDraw(dbg, z, camCenterWorld());
    if (DBG.flujoAutos) traffic.debugDraw(dbg, z, camCenterWorld(), flowSel % Math.max(1, traffic.targets.length));
    if (DBG.inspector && hover) {
      if (hover.lot) { PL(hover.lot.q); dbg.stroke({ width: 3 / z, color: 0xffeb3b }); }
      if (hover.seg) { PL([hover.seg.a, hover.seg.b], false); dbg.stroke({ width: 4 / z, color: 0xffeb3b }); }
      const [x, y] = P(hover.x, hover.y); dbg.circle(x, y, 4 / z); dbg.fill({ color: 0xffeb3b });
    }
  }
  function drawDynDebug() {
    if (!DBG.colisiones) { dbgDyn.clear(); return; }
    const z = world.scale.x, lw = 1.5 / z, v = viewRect(60); dbgDyn.begin(world.x, world.y, z);
    const drawBody = (b, col) => { const p = b.getPosition(), [sx, sy] = P(p.x, p.y); if (sx < v.x0 || sx > v.x1 || sy < v.y0 || sy > v.y1) return;
      for (let f = b.getFixtureList(); f; f = f.getNext()) { const sh = f.getShape();
        if (sh.getType() === "polygon") { const pts = sh.m_vertices.map(q => { const w = b.getWorldPoint(q); return [w.x, w.y]; }); const q = pts.map(pp => P(...pp)); dbgDyn.moveTo(...q[0]); q.slice(1).forEach(pp => dbgDyn.lineTo(...pp)); dbgDyn.lineTo(...q[0]); }
        else if (sh.getType() === "circle") { const w = b.getWorldPoint(sh.m_p), [x, y] = P(w.x, w.y); dbgDyn.ellipse(x, y, sh.m_radius * R3.SF, sh.m_radius * R3.SF * R3.SYN); } }
      dbgDyn.stroke({ width: lw * 1.3, color: col }); };
    for (const b of dyn) drawBody(b, b === player ? 0x76ff03 : b.ai ? 0x40c4ff : b.isAwake() ? 0xff9100 : 0xffcc80);
    crowd.debugBodies(dbgDyn, P, z);
    for (const c of colliders) if (c.t === "body") drawBody(c.body, 0x00e5ff);
  }

  // ---------- inspector
  cvs.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && !drag) inspectAt(e.clientX, e.clientY); });
  function inspectAt(cx, cy) {
    if (!DBG.inspector || !W) { $("insp").style.display = "none"; return; }
    const z = world.scale.x, [x, y] = unP((cx - world.x) / z, (cy - world.y) / z);
    const c = W.classify(x, y), lot = W.lotAt(x, y);
    let dist = null; for (const d of W.districts) if (pip(d.poly, [x, y])) { dist = d; break; }
    hover = { x, y, lot, seg: c ? c.s : (lot ? lot.seg : null) };
    const lines = [`<b>${x.toFixed(1)}, ${y.toFixed(1)} m</b> · riqueza ${(W.wealthAt(x, y)).toFixed(2)}`];
    if (dist) lines.push(`loteo #${dist.i} · ${dist.type} · grilla ${Math.round(dist.theta * 180 / Math.PI)}° · manzana ${dist.bA.toFixed(0)}×${dist.bB.toFixed(0)} m`);
    if (c) lines.push(`${c.k === "road" ? "calzada" : "vereda"} de <b>${c.s.type}</b> (${c.s.mat}) · calzada ${(c.s.hw * 2).toFixed(1)} m · vereda ${c.s.sw.toFixed(1)} m · rumbo ${Math.round(Math.atan2(c.s.dir[1], c.s.dir[0]) * 180 / Math.PI)}°`);
    if (lot) lines.push(`lote <b>${lot.kind}</b> · frente ${lot.fw.toFixed(1)} m · fondo ${lot.ld.toFixed(1)} m · vereda ${lot.vereda} · patio ${lot.patio} · semilla ${lot.seed}${lot.kind !== "baldio" ? (MOBILE ? ' <button id="insp3d">Ver en 3D</button>' : " · <i>clic: ver en 3D</i>") : ""}`);
    if (occ.has(Math.floor(x / OC) * 100000 + Math.floor(y / OC))) lines.push("celda ocupada");
    $("insp").innerHTML = lines.join("<br>"); $("insp").style.display = "block"; dbgDirty = true;
    const b3 = $("insp3d"); if (b3) b3.onclick = () => openLot(lot);
  }
  const openLot = (lot) => Explorer.open({ kind: lot.kind, W: lot.fw, seed: lot.seed, wealth: lot.w, ang: lot.phi });
  const pip = (poly, p) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };

  // ---------- cámara
  let zoom = 1;
  function center() { const [sx, sy] = P(W.MW / 2, W.MH / 2); world.scale.set(zoom); world.x = Math.round(scr.width / 2 - sx * zoom); world.y = Math.round(scr.height / 2 - sy * zoom); }
  function setZoom(nz, mx = scr.width / 2, my = scr.height / 2) { nz = Math.max(.25, Math.min(4, nz)); if (nz === zoom) return;
    const wx = (mx - world.x) / zoom, wy = (my - world.y) / zoom; zoom = nz; world.scale.set(zoom); world.x = Math.round(mx - wx * zoom); world.y = Math.round(my - wy * zoom); $("zoom").textContent = (+zoom.toFixed(2)) + "x"; dbgDirty = true; }
  const steps = [.25, .5, 1, 2, 3, 4], zin = () => steps.find(s => s > zoom) ?? zoom, zout = () => [...steps].reverse().find(s => s < zoom) ?? zoom;
  let drag = null, moved = 0; const ptrs = new Map(); let pinch = null;
  cvs.addEventListener("contextmenu", e => e.preventDefault());
  cvs.addEventListener("pointerdown", e => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); cvs.setPointerCapture(e.pointerId);
    if (e.pointerType === "mouse" && (e.button === 2 || e.shiftKey)) { rdrag = { x: e.clientX, y0: Cam.yaw }; pivot = camCenterWorld(); drag = null; moved = 99; return; }
    if (ptrs.size === 1) { drag = [e.clientX, e.clientY]; moved = 0; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom }; drag = null; moved = 99;
      twist = { a0: Math.atan2(b[1] - a[1], b[0] - a[0]), y0: Cam.yaw, active: false }; } });
  const endPtr = e => { ptrs.delete(e.pointerId);
    if (rdrag) { rdrag = null; yawT = Cam.snap(Cam.yaw); }
    if (ptrs.size < 2) { pinch = null; if (twist) { if (twist.active) yawT = Cam.snap(Cam.yaw); twist = null; } }
    if (drag && moved < 6 && ptrs.size === 0) {
      if (e.pointerType === "mouse") { if (DBG.inspector && hover && hover.lot && hover.lot.kind !== "baldio") openLot(hover.lot); }
      else inspectAt(e.clientX, e.clientY);
    }
    if (ptrs.size === 0) drag = null; };
  cvs.addEventListener("pointerup", endPtr); cvs.addEventListener("pointercancel", endPtr);
  cvs.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (rdrag) { applyYaw(rdrag.y0 + (e.clientX - rdrag.x) * .008); return; }
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (twist) { const an = Math.atan2(b[1] - a[1], b[0] - a[0]), da = Cam.wrap(an - twist.a0);
        if (!twist.active && Math.abs(da) > .16) { twist.active = true; twist.a0 = an; pivot = camCenterWorld(); }
        else if (twist.active) applyYaw(twist.y0 + da); }
      if (!twist || !twist.active) setZoom(Math.round(pinch.z * d / pinch.d * 20) / 20, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, true); return; }
    if (!drag || driving) return; moved += Math.abs(e.clientX - drag[0]) + Math.abs(e.clientY - drag[1]);
    world.x = Math.round(world.x + e.clientX - drag[0]); world.y = Math.round(world.y + e.clientY - drag[1]); drag = [e.clientX, e.clientY]; });
  cvs.addEventListener("wheel", e => { e.preventDefault(); setZoom(e.deltaY < 0 ? zin() : zout(), e.clientX, e.clientY); }, { passive: false });
  const camCenterWorld = () => { const v = viewRect(); return unP((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2); };
  // ---------- giro de cámara: siempre termina en múltiplos de 7,5° (los ángulos de los autos), con transición suave
  let yawT = 0, pivot = null, twist = null, rdrag = null;
  function applyYaw(a) { if (!pivot) pivot = camCenterWorld(); Cam.setYaw(a); camTo(pivot); refreshYaw(); dbgDirty = true; updateCompass(); }
  function rotateBy(steps) { yawT = Cam.snap(yawT + steps * Cam.STEP); }
  function yawTick(dt) {
    if (twist && twist.active || rdrag) return;
    const d = Cam.wrap(yawT - Cam.yaw);
    if (Math.abs(d) < 1e-6) { pivot = null; return; }
    if (driving) pivot = null;
    applyYaw(Math.abs(d) < .002 ? yawT : Cam.yaw + d * Math.min(1, dt * 11));
    if (Cam.yaw === yawT || Math.abs(Cam.wrap(yawT - Cam.yaw)) < 1e-6) pivot = null;
  }
  function updateCompass() { const deg = Math.round(((Cam.yaw * 180 / Math.PI) % 360 + 360) % 360 * 2) / 2; $("bN").textContent = "🧭 " + (deg % 360) + "°"; }
  const camTo = ([x, y]) => { const [sx, sy] = P(x, y); world.x = Math.round(scr.width / 2 - sx * zoom); world.y = Math.round(scr.height / 2 - sy * zoom); };

  // ---------- visibilidad
  function applyVis() {
    const GV = Gfx.VIS; GV.ground = VIS.ground; GV.decal = VIS.shadow; GV.hshadow = VIS.shadow && VIS.houses; GV.cable = VIS.cables;
    Gfx.groups.houses.visible = VIS.houses; Gfx.groups.postes.visible = VIS.props; GV.houses = VIS.houses || VIS.props;
    for (const c of ["trees", "props", "vehicles", "people"]) BB.cat(c, VIS[c]);
    for (const s of sprites) s.visible = VIS[s.cat];
    crowd.setVisible(VIS.people);
  }

  // ---------- panel lateral
  function buildPanel() {
    const P_ = $("panel"); P_.innerHTML = "";
    const sec = (title, open = false) => { const d = document.createElement("details"); d.open = open; d.innerHTML = `<summary>${title}</summary>`; P_.appendChild(d); return d; };
    const chk = (parent, label, get, set) => { const l = document.createElement("label"); l.className = "chk"; const i = document.createElement("input"); i.type = "checkbox"; i.checked = get();
      i.onchange = () => { set(i.checked); dbgDirty = true; }; l.appendChild(i); l.append(" " + label); parent.appendChild(l); };
    const s1 = sec("Capas", true); for (const [k, lab] of LAYERS) chk(s1, lab, () => VIS[k], (v) => { VIS[k] = v; applyVis(); });
    const s2 = sec("Depuración", true); for (const [k, lab] of DEBUG) chk(s2, lab, () => DBG[k], (v) => { DBG[k] = v; if (k === "inspector" && !v) { hover = null; $("insp").style.display = "none"; } });
    const leg = document.createElement("div"); leg.className = "legend";
    leg.innerHTML = "<b>calles</b> " + Object.entries(TYPE_COL).map(([k, c]) => `<i style="background:#${c.toString(16).padStart(6, "0")}"></i>${k}`).join(" ") +
      "<br><b>lotes</b> " + Object.entries(KIND_COL).map(([k, c]) => `<i style="background:#${c.toString(16).padStart(6, "0")}"></i>${k}`).join(" ") +
      "<br><b>peatones</b> <i style='background:#69f0ae'></i>vereda <i style='background:#fff'></i>senda <i style='background:#bcaaa4'></i>tierra <i style='background:#ff5252'></i>calzada <i style='background:#b388ff'></i>pasillo" +
      "<br><b>autos</b> <i style='background:#40c4ff'></i>avenida <i style='background:#69f0ae'></i>asfalto <i style='background:#ffd740'></i>roto <i style='background:#bcaaa4'></i>tierra <i style='background:#ff5252'></i>borde" +
      "<br><b>física</b> <i style='background:#00e5ff'></i>fijo <i style='background:#ff9100'></i>dinámico despierto <i style='background:#ffcc80'></i>dormido <i style='background:#76ff03'></i>tu auto <i style='background:#40c4ff'></i>auto con IA <i style='background:#ea80fc'></i>persona";
    s2.appendChild(leg);
    const fb = document.createElement("button"); fb.textContent = "Ver otro destino del flowfield"; fb.onclick = () => { flowSel++; if (!DBG.flujoAutos) DBG.flujo = true; dbgDirty = true; buildPanel(); }; s2.appendChild(fb);
    const groups = [...new Set(CFG.SCHEMA.map(s => s[0]))];
    for (const g of groups) {
      const d = sec("Parámetros · " + g);
      for (const k of Object.keys(CFG.meta).filter(k => CFG.meta[k].g === g)) {
        const m = CFG.meta[k], row = document.createElement("div"); row.className = "knob"; row.title = m.help || "";
        const fx = { world: "⟳", bake: "◐", live: "" }[m.fx];
        row.innerHTML = `<div class="kl"><span>${m.label} <small>${fx}</small></span><output></output></div><input type="range" min="${m.min}" max="${m.max}" step="${m.step}">`;
        const inp = row.querySelector("input"), out = row.querySelector("output");
        const show = () => out.textContent = (+CFG.v[k]).toFixed(m.step < 1 ? (m.step < .1 ? 2 : 1) : 0) + (m.unit ? " " + m.unit : "");
        inp.value = CFG.v[k]; show();
        inp.oninput = () => { CFG.v[k] = +inp.value; show(); CFG.save(); onKnob(m); };
        d.appendChild(row);
      }
    }
    const s4 = sec("Acciones", true);
    const btn = (t, f) => { const b = document.createElement("button"); b.textContent = t; b.onclick = f; s4.appendChild(b); };
    btn("Restablecer parámetros", () => { for (const k in CFG.meta) CFG.v[k] = CFG.meta[k].def; CFG.save(); R3.setLight(CFG.v); Gfx.setLight(CFG.v); buildPanel(); rebuildKeepCam(); });
    btn("Re-hornear casas", rebakeAll);
    const note = document.createElement("div"); note.className = "muted"; note.innerHTML = "⟳ regenera el barrio (misma semilla) · ◐ re-hornea las casas · sin marca: inmediato"; s4.appendChild(note);
  }
  let knobTimer = null;
  function onKnob(m) {
    if (m.fx === "live") { Gfx.setLight(CFG.v); if (m.k === "velGente") crowd.setSpeed(); if (player && m.k === "masa") setCarModel(player.veh); return; }
    if (m.fx === "bake") { R3.setLight(CFG.v); Gfx.setLight(CFG.v); clearTimeout(knobTimer); knobTimer = setTimeout(() => { rebakeAll(); if (Explorer.isOpen()) Explorer.redraw(); }, 250); return; }
    clearTimeout(knobTimer); knobTimer = setTimeout(rebuildKeepCam, 450);
  }
  function rebuildKeepCam() { const c = camCenterWorld(); build(); camTo(c); bkX = NaN; }

  // ---------- visor de atlas
  const Atlas = (() => {
    const box = $("atlas"), cv = $("atcv"), g = cv.getContext("2d"); let mode = "sprites", hoverN = null, scale = 1;
    const frames = Object.entries(ASSETS.frames);
    function draw() {
      if (mode === "sprites") {
        scale = Math.min(1, (box.clientWidth - 40) / atlasImg.width) || 1; cv.width = atlasImg.width * scale; cv.height = atlasImg.height * scale;
        g.imageSmoothingEnabled = false; g.fillStyle = "#3a3f4b"; g.fillRect(0, 0, cv.width, cv.height);
        for (let y = 0; y < cv.height; y += 16) for (let x = (y / 16 % 2) * 16; x < cv.width; x += 32) { g.fillStyle = "#444a57"; g.fillRect(x, y, 16, 16); }
        g.drawImage(atlasImg, 0, 0, cv.width, cv.height);
        for (const [n, f] of frames) { g.strokeStyle = n === hoverN ? "#ffeb3b" : "rgba(0,229,255,.45)"; g.lineWidth = n === hoverN ? 2 : 1; g.strokeRect(f.x * scale + .5, f.y * scale + .5, f.w * scale, f.h * scale);
          if (n === hoverN) { g.fillStyle = "#ff4081"; g.beginPath(); g.arc((f.x + f.ox) * scale, (f.y + f.oy) * scale, 4, 0, 7); g.fill(); } }
        const f = hoverN && ASSETS.frames[hoverN];
        $("atinfo").innerHTML = f ? `<b>${hoverN}</b> · ${f.w}×${f.h} px · ancla (${f.ox}, ${f.oy}) = punto donde apoya en el piso` : `${frames.length} frames en un PNG de ${atlasImg.width}×${atlasImg.height}. Pasá el mouse para ver cada uno.`;
      } else {
        const baked = houses.filter(o => o.h3);
        const cols = Math.max(1, Math.floor((box.clientWidth - 40) / 150)); cv.width = cols * 150; cv.height = Math.max(150, Math.ceil(baked.length / cols) * 150);
        g.fillStyle = "#3a3f4b"; g.fillRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false;
        baked.forEach((o, i) => { const c = o.h3.canvas, s = Math.min(1, 140 / Math.max(c.width, c.height)); const x = (i % cols) * 150 + (150 - c.width * s) / 2, y = Math.floor(i / cols) * 150 + (150 - c.height * s) / 2; g.drawImage(c, x, y, c.width * s, c.height * s); });
        $("atinfo").textContent = `${baked.length} objetos 3D horneados ahora (de ${houses.length}). Cada imagen es el atlas de texturas ya iluminadas de una casa (se hornea en tu navegador, se libera al alejarte).`;
      }
    }
    cv.addEventListener("mousemove", (e) => { if (mode !== "sprites") return; const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width / scale, y = (e.clientY - r.top) * cv.height / r.height / scale;
      const hit = frames.find(([, f]) => x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h); const n = hit ? hit[0] : null; if (n !== hoverN) { hoverN = n; draw(); } });
    $("atSprites").onclick = () => { mode = "sprites"; draw(); }; $("atBaked").onclick = () => { mode = "baked"; draw(); };
    $("atClose").onclick = () => box.style.display = "none";
    return { toggle() { const o = box.style.display === "block"; box.style.display = o ? "none" : "block"; if (!o) draw(); } };
  })();

  // ---------- explorador de casas 3D
  const Explorer = (() => {
    const box = $("explorer"), cv = $("excv"), g = cv.getContext("2d");
    let seed = 1234, ang = 0, auto = false, last = 0, open = false;
    function draw() {
      const kind = $("exKind").value, Wm = +$("exW").value, wealth = +$("exWealth").value;
      $("exWv").textContent = Wm.toFixed(1) + " m"; $("exAv").textContent = Math.round(((ang * 180 / Math.PI) % 360 + 360) % 360) + "°";
      const b = Houses.build({ kind, W: Wm, seed, wealth }, ang), res = b.sc.render({ groundShadow: true });
      const Z = 3, cx = cv.width / 2, cy = cv.height * .68, c = [Wm / 2, b.depth / 2];
      g.fillStyle = "#c9bd9b"; g.fillRect(0, cy - 40, cv.width, cv.height); g.fillStyle = "#5c6a4c"; g.fillRect(0, 0, cv.width, cy - 40);
      g.imageSmoothingEnabled = false;
      const off = P(-(Math.cos(ang) * c[0] - Math.sin(ang) * c[1]), -(Math.sin(ang) * c[0] + Math.cos(ang) * c[1]));
      if (res.shadow) { g.globalAlpha = CFG.v.sombraPiso; g.drawImage(res.shadow.canvas, cx + (off[0] - res.shadow.ax) * Z, cy + (off[1] - res.shadow.ay) * Z, res.shadow.canvas.width * Z, res.shadow.canvas.height * Z); g.globalAlpha = 1; }
      g.drawImage(res.canvas, cx + (off[0] - res.ax) * Z, cy + (off[1] - res.ay) * Z, res.canvas.width * Z, res.canvas.height * Z);
      $("exInfo").textContent = `${kind}${b.shop ? " · " + b.shop : ""} · ${b.storeys} piso${b.storeys > 1 ? "s" : ""} · semilla ${seed}`;
    }
    function loop(t) { if (!open) return; if (auto && t - last > 60) { ang = (ang + .06) % (Math.PI * 2); $("exA").value = ang * 180 / Math.PI; draw(); last = t; } requestAnimationFrame(loop); }
    $("exNew").onclick = () => { seed = (Math.random() * 1e9) | 0; draw(); };
    $("exKind").onchange = draw; $("exW").oninput = draw; $("exWealth").oninput = draw;
    $("exA").oninput = (e) => { ang = e.target.value * Math.PI / 180; draw(); };
    $("exAuto").onclick = () => { auto = !auto; $("exAuto").classList.toggle("on", auto); };
    $("exClose").onclick = () => { open = false; box.style.display = "none"; };
    let dragX = null; cv.addEventListener("pointerdown", e => dragX = e.clientX); window.addEventListener("pointerup", () => dragX = null);
    cv.addEventListener("pointermove", e => { if (dragX == null) return; ang += (e.clientX - dragX) * .01; dragX = e.clientX; $("exA").value = ((ang * 180 / Math.PI) % 360 + 360) % 360; draw(); });
    return { open(spec) { if (spec) { $("exKind").value = spec.kind; $("exW").value = spec.W; $("exWealth").value = spec.wealth; seed = spec.seed; ang = spec.ang || 0; $("exA").value = ((ang * 180 / Math.PI) % 360 + 360) % 360; }
        open = true; box.style.display = "flex"; draw(); requestAnimationFrame(loop); }, isOpen: () => open, redraw: draw, close() { $("exClose").onclick(); } };
  })();

  // ---------- teclado y botones
  const regen = () => { SEED = (Math.random() * 1e9) | 0; build(); center(); };
  $("bR").onclick = regen; $("bP").onclick = () => setZoom(zin()); $("bM").onclick = () => setZoom(zout());
  $("bX").onclick = () => Explorer.open(); $("bT").onclick = () => Atlas.toggle(); $("bV").onclick = startDriving;
  // exportar el barrio que se ve, para Conurbano-weed
  $("bExp").onclick = async () => {
    const b = $("bExp"); if (b.disabled || !lastB) return; b.disabled = true; const L = $("load"); L.style.display = "block";
    try { const r = await Exportar.exportar(lastB, atlasImg, F, (m) => { L.textContent = "exportando: " + m; });
      const a = document.createElement("a"); a.href = URL.createObjectURL(r.zip); a.download = (window.__editor && window.__editor.barrio && window.__editor.barrio.W.real ? window.__editor.barrio.W.carpeta : "barrio_" + SEED) + ".zip"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      window.__export = r; L.textContent = "exportado: " + Math.round(r.zip.size / 1048576 * 10) / 10 + " MB"; setTimeout(() => L.style.display = "none", 4000); }
    catch (e) { console.error(e); L.textContent = "no se pudo exportar: " + e.message; }
    b.disabled = false; };
  $("bPanel").onclick = () => $("panel").classList.toggle("hide");
  $("bRotL").onclick = () => rotateBy(-6); $("bRotR").onclick = () => rotateBy(6); $("bN").onclick = () => { yawT = 0; };
  window.addEventListener("resize", () => { Gfx.resize(); dbgDirty = true; });
  window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (e.key === "Escape") { if (Explorer.isOpen()) return Explorer.close(); if ($("atlas").style.display === "block") return Atlas.toggle(); if (driving) return stopDriving(); }
    if (Explorer.isOpen()) return;
    if (driving && DRIVE_KEYS.has(k)) { keys.add(k); e.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); return; }
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    const S_ = 120, mv = { arrowleft: [S_, 0], a: [S_, 0], arrowright: [-S_, 0], d: [-S_, 0], arrowup: [0, S_], w: [0, S_], arrowdown: [0, -S_], s: [0, -S_] }[k];
    if (mv) { world.x += mv[0]; world.y += mv[1]; e.preventDefault(); return; }
    if (k === "q") rotateBy(-1); if (k === "e") rotateBy(1);
    if (k === "r") regen(); if (k === "x") Explorer.open(); if (k === "t") Atlas.toggle(); if (k === "v") startDriving(); if (k === "p") $("bPanel").onclick();
    const MODELS = ["sedan", "pickup", "van", "black", "blue", "red", "white", "yellow", "police"];
    if (driving && k >= "1" && k <= "9") setCarModel(MODELS[+k - 1]);
    if (k === "+" || k === "=") setZoom(zin()); if (k === "-") setZoom(zout()); if (k === "c") center();
  });
  window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // ---------- bucle principal
  let fpsAcc = 0, fpsN = 0, fps = 0, slow = 0;
  const DBGKEYS = DEBUG.map(d => d[0]).filter(k => k !== "inspector");
  let lastT = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const deltaMS = Math.max(0, now - lastT); lastT = now;
    if (!W) return;
    const dt = Math.min(deltaMS, 250) / 1000; fpsAcc += dt; fpsN++;
    yawTick(dt);
    physTick(dt);
    bakeTick();
    Perf.t(Perf.ID.debug);
    let anyDbg = DBG.inspector && hover; for (let i = 0; i < DBGKEYS.length; i++) if (DBG[DBGKEYS[i]]) anyDbg = true;
    const camMoved = world.x !== dbgCamX || world.y !== dbgCamY || world.scale.x !== dbgCamZ;
    if (anyDbg && (dbgDirty || camMoved) && performance.now() - dbgLast > (driving ? 60 : 120)) { drawDebug(); dbgLast = performance.now(); dbgDirty = false; dbgCamX = world.x; dbgCamY = world.y; dbgCamZ = world.scale.x; dbgOn = true; }
    else if (anyDbg) dbg.follow(world.x, world.y, world.scale.x);
    if (!anyDbg && dbgOn) { dbg.clear(); dbgOn = false; }
    if (DBG.colisiones) drawDynDebug(); else if (dynOn) { dbgDyn.clear(); }
    dynOn = DBG.colisiones;
    Perf.e(Perf.ID.debug);
    // ---- render: cámara, sprites visibles ordenados, calcos de sombra y las pasadas de Three
    Perf.t(Perf.ID.sprites);
    Gfx.setView(world.x, world.y, world.scale.x);
    const v = viewRectS(60); Gfx.updateSprites(v.x0, v.y0, v.x1, v.y1);
    const A = viewAABB(80); Gfx.updateDecals(A[0], A[1], A[2], A[3]);
    Perf.e(Perf.ID.sprites);
    PR.render();
    Perf.frame(deltaMS);
    // indicadores (4 veces por segundo, fuera del bucle caliente)
    if (fpsAcc > .25) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; updateCounters(); $("fps").textContent = fps.toFixed(0) + " fps"; Perf.ui(); }
  }
  requestAnimationFrame(loop);
  let dbgCamX = 0, dbgCamY = 0, dbgCamZ = 0, dbgOn = false, dynOn = false;
  function updateCounters() {
    const C = Perf.C, cs = crowd.S, ts = traffic.S;
    let texBytes = 0; for (const o of houses) if (o.h3) texBytes += o.h3.bytes;
    texBytes += chunks.size * Ground.CH * Ground.CH * 4 * 1.34;
    const gi = Gfx.info;
    let awake = 0, bodies = 0; for (let b = phys.getBodyList(); b; b = b.getNext()) { bodies++; if (b.isAwake()) awake++; }
    let contacts = 0; for (let c = phys.getContactList(); c; c = c.getNext()) if (c.isTouching()) contacts++;
    C.objects = BB.count + bakedCount; C.objectsVisible = BB.drawn; C.texCount = bakedCount + chunks.size; C.texBytes = texBytes;
    C.yaw = Math.round(Cam.yaw * 180 / Math.PI * 10) / 10; C.triangles = gi.render.triangles; C.gpuGeometries = gi.memory.geometries; C.gpuTextures = gi.memory.textures;
    C.baked = bakedCount; C.housesTotal = houses.length; C.bakeAvg = bakeTimes.length ? bakeTimes.reduce((a, b) => a + b, 0) / bakeTimes.length : 0; C.chunks = chunks.size; C.pending = pending;
    C.people = crowd.count; C.peopleDrawn = cs.drawn; C.peopleFull = cs.full; C.peopleLow = cs.low; C.peopleWalking = cs.walking; C.peopleRoad = cs.onRoad; C.peopleKnock = cs.knocked;
    C.pFields = crowd.ready; C.pTargets = crowd.targets.length; C.cFields = traffic.ready; C.cTargets = traffic.targets.length;
    C.carsTotal = traffic.cars.length; C.carsActive = ts.active; C.carsMoving = ts.moving; C.carsBlocked = ts.blocked; C.carsRev = ts.reversing; C.rays = ts.rays;
    C.bodies = bodies; C.awake = awake; C.contacts = contacts; C.canvasW = cvs.width; C.canvasH = cvs.height; C.build = buildStats;
  }
  // benchmark: recorrido de cámara en óvalo por el centro del mapa, a zoom 1
  function runBench() {
    if (Perf.bench) return; if (driving) stopDriving();
    const z0 = zoom; setZoom(1); Perf.toggle(true); $("bBench").disabled = true;
    // óvalo por el mapa + giros de cámara de 45° cada 2,5 s (prueba también la transición)
    Perf.startBench(20, (t) => { const a = t * Math.PI * 2, x = W.MW / 2 + Math.cos(a) * W.MW * .3, y = W.MH / 2 + Math.sin(a) * W.MH * .3; pivot = null; camTo([x, y]); yawT = Cam.snap(Math.floor(t * 8) * Math.PI / 4); },
      () => { $("bBench").disabled = false; setZoom(z0); yawT = 0; });
  }
  $("bPerf").onclick = () => $("bPerf").classList.toggle("on", Perf.toggle());
  $("bBench").onclick = runBench;
  $("bPeaks").onclick = () => Perf.resetPeaks();
  $("bReport").onclick = async () => { const txt = Perf.report(); let ok = false; try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) {}
    if (!ok) { $("reportBox").style.display = "block"; $("reportTxt").value = txt; $("reportTxt").select(); } else { $("bReport").textContent = "¡Copiado!"; setTimeout(() => $("bReport").textContent = "Copiar reporte", 1500); } };
  $("reportClose").onclick = () => $("reportBox").style.display = "none";

  if (MOBILE) { $("panel").classList.add("hide"); zoom = 1; }
  buildPanel(); build(); center(); applyVis(); updateCompass(); $("zoom").textContent = zoom + "x";
  window.__ready = true; window.__pending = () => pending;
  window.__test = { Perf, runBench, camTo, Cam, Gfx, rotateBy, setYawT: (d) => { yawT = Cam.snap(d * Math.PI / 180); }, get houses() { return houses; }, crowd, traffic, setZoom, startDriving, keys, get player() { return player; }, DBG, VIS, applyVis, Atlas, get W() { return W; }, setDirty: () => dbgDirty = true };
})().catch(err => { console.error(err); document.getElementById("err").textContent = "Error: " + err.message; });
