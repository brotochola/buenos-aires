// ===================== crowd.js — multitud con arrays tipados (sin objetos por persona) =====================
// Estado en estructura de arrays (SoA). Grilla espacial de cubetas (lista enlazada en Int32Array) para:
//   · separación entre personas · empujón de autos · "¿hay alguien adelante?" para la IA de los autos.
// Nivel de detalle: tasa completa cerca de la cámara / en pantalla; el resto se actualiza 1 de cada LOD cuadros.
// En el bucle por cuadro no se crean objetos ni arrays (nada de presión sobre el GC).
const Crowd = (ctx) => {
  const { F, CFG } = ctx; const BB = Gfx.BB, DC = Gfx.DC;
  const SF = R3.SF, K = R3.K, SYN = R3.SYN;
  const COST = { vereda: 10, pasillo: 11, senda: 13, esquina: 40, tierra: 90, calle: 220, cantero: 30 };
  const CAP = 4096, LOD = 4, RSEP = .55, RSEP2 = RSEP * RSEP;
  const ST_IDLE = 0, ST_WALK = 1, ST_KNOCK = 2;
  // ---- estado por persona
  const X = new Float32Array(CAP), Y = new Float32Array(CAP), VX = new Float32Array(CAP), VY = new Float32Array(CAP);
  const SPD = new Float32Array(CAP), TM = new Float32Array(CAP), BUD = new Float32Array(CAP), PH = new Float32Array(CAP), AN = new Float32Array(CAP);
  const KN = new Float32Array(CAP), STK = new Float32Array(CAP), LX = new Float32Array(CAP), LY = new Float32Array(CAP), RND = new Float32Array(CAP);
  const FLD = new Int16Array(CAP), ST = new Uint8Array(CAP), CH = new Uint8Array(CAP), STAY = new Uint8Array(CAP);
  const FX = new Float32Array(CAP), FY = new Float32Array(CAP);     // hacia dónde mira (vector unitario en el mundo)
  const STAMP = new Uint32Array(CAP), VIS = new Uint8Array(CAP);
  let N = 0, frame = 0, stamp = 1;
  // ---- grilla espacial (cubetas por hash de celda de 1 m)
  const HB = 8192, HEAD = new Int32Array(HB).fill(-1), NEXT = new Int32Array(CAP).fill(-1);   // -1 = vacío (con 0 se arma un ciclo)
  const bucket = (cx, cy) => (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & (HB - 1);
  // ---- texturas precalculadas: [personaje][dirección N,O,S,E][cuadro]
  let NCH = 0; while (F[`w${NCH}_S_0`]) NCH++;
  const DIRS = "NWSE", TWa = [], TIa = [];
  for (let c = 0; c < NCH; c++) for (let d = 0; d < 4; d++) { for (let f = 0; f < 8; f++) TWa.push(BB.frame(`w${c}_${DIRS[d]}_${f + 1}`)); for (let f = 0; f < 2; f++) TIa.push(BB.frame(`i${c}_${DIRS[d]}_${f}`)); }
  const TW = Int32Array.from(TWa), TI = Int32Array.from(TIa), SHF = BB.frame("sh_person");
  let visible = true;
  let fg = null, pending = [], W = null;
  const tmp = new Float32Array(2);
  const S = { full: 0, low: 0, drawn: 0, walking: 0, onRoad: 0, knocked: 0, simMs: 0, fieldMs: 0 };

  function reset(world, colliders, seed) {
    W = world; N = 0; frame = 0; HEAD.fill(-1);
    const GW = Math.ceil(W.MW), GH = Math.ceil(W.MH), cost = new Uint8Array(GW * GH);
    for (const s of W.segs) {
      if (s.sw <= 0) continue; const R = s.hw + s.sw;
      const x0 = Math.max(0, Math.floor(Math.min(s.a[0], s.b[0]) - R)), x1 = Math.min(GW - 1, Math.ceil(Math.max(s.a[0], s.b[0]) + R));
      const y0 = Math.max(0, Math.floor(Math.min(s.a[1], s.b[1]) - R)), y1 = Math.min(GH - 1, Math.ceil(Math.max(s.a[1], s.b[1]) + R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const q = World.segDist(s, x + .5, y + .5); if (q.d >= s.hw && q.d < R) cost[y * GW + x] = COST.vereda; }
    }
    const road = new Uint8Array(GW * GH);
    rasterRoads(W, GW, GH, (i, s, q) => {
      let c;
      if (s.mat === "pasillo") c = COST.pasillo;
      else if (s.type === "ave" && Math.abs(q.ds) < s.med) c = COST.cantero;
      else if (s.cross.some(t => Math.abs(q.t - t) < 1.6)) c = COST.senda;
      else if (s.mat === "tierra") c = COST.tierra;
      else c = COST.calle;
      road[i] = road[i] ? Math.min(road[i], c) : c;
    });
    for (const it of W.inters) {
      if (it.s.type === "pasillo" || it.o.type === "pasillo") continue;
      const R = Math.max(it.s.hw, it.o.hw) + 3;
      for (let y = Math.floor(it.p[1] - R); y <= it.p[1] + R; y++) for (let x = Math.floor(it.p[0] - R); x <= it.p[0] + R; x++) {
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue; const i = y * GW + x;
        if (road[i] > COST.esquina && Math.hypot(x + .5 - it.p[0], y + .5 - it.p[1]) < R) road[i] = COST.esquina;
      }
    }
    for (let i = 0; i < road.length; i++) if (road[i]) cost[i] = road[i];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (cost[y * GW + x] && W.lotAt(x + .5, y + .5)) cost[y * GW + x] = 0;
    for (const c of colliders) {
      if (c.t === "body" || (c.t === "circ" && c.r < .45)) continue;
      const bb = c.bb;
      for (let y = Math.max(0, Math.floor(bb[1])); y <= Math.min(GH - 1, Math.floor(bb[3])); y++) for (let x = Math.max(0, Math.floor(bb[0])); x <= Math.min(GW - 1, Math.floor(bb[2])); x++) {
        const px = x + .5, py = y + .5;
        if (c.t === "circ" ? Math.hypot(px - c.c[0], py - c.c[1]) < c.r + .2 : pipPoly(c.pts, [px, py])) cost[y * GW + x] = 0;
      }
    }
    fg = FlowGrid(GW, GH, cost, COST.calle);
    pending = fg.pickTargets(Math.max(3, Math.round(CFG.v.destinos)), R3.rng(seed ^ 0x2545F491), (c) => c === COST.vereda);
  }

  function spawn(x, y, stay = false) {
    if (N >= CAP) return -1;
    const i = N++;
    X[i] = x; Y[i] = y; VX[i] = 0; VY[i] = 0; RND[i] = .9 + Math.random() * .6; SPD[i] = 1.2 * RND[i] * CFG.v.velGente;
    TM[i] = Math.random() * 6; BUD[i] = 0; PH[i] = Math.random() * 8; AN[i] = Math.random() * 4; KN[i] = 0; STK[i] = 0; LX[i] = x; LY[i] = y;
    FLD[i] = -1; ST[i] = ST_IDLE; CH[i] = (Math.random() * NCH) | 0; FX[i] = 0; FY[i] = -1; STAY[i] = stay ? 1 : 0; STAMP[i] = 0;
    return i;
  }
  // llenar hasta n personas, con más densidad en avenidas, pasillos de villa y barrios populares
  function populate(n, seed) {
    const r = R3.rng(seed ^ 0x51ED270B), GW = fg.GW, GH = fg.GH;
    let tries = 0;
    while (N < Math.min(n, CAP) && tries++ < n * 60) {
      const x = r.uni(1, GW - 1), y = r.uni(1, GH - 1), c = fg.cost[(y | 0) * GW + (x | 0)];
      if (c !== COST.vereda && c !== COST.pasillo) continue;
      let w = c === COST.pasillo ? 2.6 : 1;
      const k = W.classify(x, y); if (k && k.s.type === "ave") w = 3.2; else if (k && k.s.type === "pasaje") w = .8;
      w *= 1.5 - W.wealthAt(x, y) * .8;
      if (r() * 4 > w) continue;
      spawn(x, y, false);
    }
  }

  function rebuildHash() {
    HEAD.fill(-1);
    for (let i = 0; i < N; i++) { const b = bucket(X[i] | 0, Y[i] | 0); NEXT[i] = HEAD[b]; HEAD[b] = i; }
  }
  const costAt = (x, y) => { const cx = x | 0, cy = y | 0; return (cx < 0 || cy < 0 || cx >= fg.GW || cy >= fg.GH) ? 0 : fg.cost[cy * fg.GW + cx]; };

  function pickField(i) {
    const nf = fg.fields.length;
    for (let k = 0; k < 6; k++) { const f = (Math.random() * nf) | 0; if (f !== FLD[i] && fg.fields[f] && fg.value(f, X[i], Y[i]) !== fg.INF) { FLD[i] = f; return true; } }
    return false;
  }

  // ---- simulación: cam = centro (m), radio de tasa completa, vista en px del contenedor del mundo
  function tick(dt, camX, camY, radius, vx0, vy0, vx1, vy1) {
    const t0 = performance.now();
    if (pending.length) { const tf = performance.now(); while (pending.length && performance.now() - tf < 8) fg.compute(pending.shift()); S.fieldMs = performance.now() - tf; } else S.fieldMs = 0;
    if (!fg) return;
    frame++; stamp++;
    rebuildHash();
    const R2 = radius * radius, gw = fg.GW, cost = fg.cost;
    let full = 0, low = 0, walking = 0, onRoadN = 0, knocked = 0;
    for (let i = 0; i < N; i++) {
      let x = X[i], y = Y[i];
      // ¿en pantalla? (proyección inline, sin crear arrays)
      const sx = Cam.C.ax * x + Cam.C.ay * y, sy = Cam.C.bx * x + Cam.C.by * y;
      const inView = sx > vx0 - 40 && sx < vx1 + 40 && sy > vy0 - 10 && sy < vy1 + 60;
      VIS[i] = inView ? 1 : 0;
      const near = inView || (x - camX) * (x - camX) + (y - camY) * (y - camY) < R2;
      let h = dt;
      if (!near) { if ((i + frame) % LOD) continue; h = dt * LOD; low++; } else full++;
      AN[i] += h;
      if (STAY[i]) continue;
      const c0 = cost[(y | 0) * gw + (x | 0)], onRoad = c0 >= COST.tierra;
      let vx = VX[i], vy = VY[i];
      if (ST[i] === ST_KNOCK) {
        knocked++; KN[i] -= h; vx *= Math.max(0, 1 - h * 5); vy *= Math.max(0, 1 - h * 5);
        if (KN[i] <= 0) { ST[i] = ST_IDLE; TM[i] = .2; }
      } else if (ST[i] === ST_IDLE) {
        TM[i] -= h; vx *= .8; vy *= .8;
        if ((TM[i] <= 0 || onRoad) && fg.fields.length && pickField(i)) { ST[i] = ST_WALK; BUD[i] = 25 + Math.random() * 140; STK[i] = 0; LX[i] = x; LY[i] = y; }
        else if (TM[i] <= 0) TM[i] = 1 + Math.random() * 3;
      } else {
        walking++;
        const res = fg.dirInto(FLD[i], x, y, tmp);
        if (res !== 1 || fg.value(FLD[i], x, y) < 40 || (BUD[i] <= 0 && !onRoad)) { ST[i] = ST_IDLE; TM[i] = 2 + Math.random() * 8 * RND[i]; }
        else {
          const sp = SPD[i] * (onRoad ? 1.6 : 1);
          let tx = tmp[0] * sp, ty = tmp[1] * sp;
          // separación (sólo a tasa completa)
          if (near) {
            const cx = x | 0, cy = y | 0;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              for (let j = HEAD[bucket(cx + ox, cy + oy)]; j >= 0; j = NEXT[j]) {
                if (j === i) continue; const dx = x - X[j], dy = y - Y[j], d2 = dx * dx + dy * dy;
                if (d2 < RSEP2 && d2 > 1e-6) { const d = Math.sqrt(d2), f = (RSEP - d) / d * 2.2; tx += dx * f; ty += dy * f; }
              }
            }
          }
          const k = Math.min(1, h * 6); vx += (tx - vx) * k; vy += (ty - vy) * k;
          BUD[i] -= sp * h;
          STK[i] += h; if (STK[i] > 3) { const mx = x - LX[i], my = y - LY[i]; if (mx * mx + my * my < .36) { if (!pickField(i)) { ST[i] = ST_IDLE; TM[i] = 1; } } STK[i] = 0; LX[i] = x; LY[i] = y; }
        }
      }
      if (onRoad) onRoadN++;
      // mover con choque contra celdas bloqueadas (deslizando por eje)
      let nx = x + vx * h; if (nx < 0 || nx >= gw || !cost[(y | 0) * gw + (nx | 0)]) { nx = x; vx = 0; }
      let ny = y + vy * h; if (ny < 0 || ny >= fg.GH || !cost[(ny | 0) * gw + (nx | 0)]) { ny = y; vy = 0; }
      X[i] = nx; Y[i] = ny; VX[i] = vx; VY[i] = vy;
      const s2 = vx * vx + vy * vy;
      if (s2 > .02) { PH[i] += Math.sqrt(s2) * h;
        const inv = 1 / Math.sqrt(s2); FX[i] = vx * inv; FY[i] = vy * inv; }
    }
    S.full = full; S.low = low; S.walking = walking; S.onRoad = onRoadN; S.knocked = knocked;
    draw();
    S.simMs = performance.now() - t0;
  }

  // ---- dibujo: un sprite del pool por persona visible
  function draw() {
    let used = 0;
    if (visible) { const C = Cam.C, c = C.c, sn = C.s;
      for (let i = 0; i < N; i++) {
        if (!VIS[i]) continue;
        // dirección del sprite según hacia dónde mira, vista desde la cámara girada
        const fx = c * FX[i] + sn * FY[i], fy = -sn * FX[i] + c * FY[i], px = fx + K * fy, py = -SYN * fy;
        const dir = Math.abs(px) > Math.abs(py) * 1.15 ? (px > 0 ? 3 : 1) : (py > 0 ? 2 : 0), base = CH[i] * 4 + dir;
        const moving = ST[i] === ST_WALK && VX[i] * VX[i] + VY[i] * VY[i] > .04;
        BB.push(moving ? TW[base * 8 + (((PH[i] / .19) | 0) & 7)] : TI[base * 2 + (((AN[i] * 1.6) | 0) & 1)], X[i], Y[i], false);
        DC.push(SHF, X[i], Y[i]);
        used++;
      } }
    S.drawn = used;
  }

  // ---- autos empujan gente: arrays [x, y, ángulo, medio largo, medio ancho, vx, vy] por auto
  function pushByCars(CX, CY, CA, HL, HW, CVX, CVY, n) {
    for (let c = 0; c < n; c++) {
      const cs = Math.cos(CA[c]), sn = Math.sin(CA[c]), hl = HL[c] + .3, hw = HW[c] + .3, r = Math.max(hl, hw) + 1;
      const x0 = (CX[c] - r) | 0, x1 = (CX[c] + r) | 0, y0 = (CY[c] - r) | 0, y1 = (CY[c] + r) | 0;
      stamp++;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (let j = HEAD[bucket(cx, cy)]; j >= 0; j = NEXT[j]) {
        if (STAMP[j] === stamp) continue; STAMP[j] = stamp;
        const dx = X[j] - CX[c], dy = Y[j] - CY[c], lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
        if (lx > -hl && lx < hl && ly > -hw && ly < hw) {
          const px = hl - Math.abs(lx), py = hw - Math.abs(ly);
          let ex, ey; if (px < py) { const sg = lx > 0 ? 1 : -1; ex = cs * sg * px; ey = sn * sg * px; } else { const sg = ly > 0 ? 1 : -1; ex = -sn * sg * py; ey = cs * sg * py; }
          X[j] += ex; Y[j] += ey;
          const vv = CVX[c] * CVX[c] + CVY[c] * CVY[c];
          if (vv > 2) { VX[j] = CVX[c] * .9 + ex * 8; VY[j] = CVY[c] * .9 + ey * 8; ST[j] = ST_KNOCK; KN[j] = 1.1; }
        }
      }
    }
  }
  // ---- ¿hay alguien en el corredor delante de un auto? devuelve la distancia o Infinity
  function blockAhead(x0, y0, fx, fy, dist, halfW) {
    let best = Infinity; stamp++;
    for (let t = 0; t <= dist; t += 1) {
      const px = x0 + fx * t, py = y0 + fy * t, cx = px | 0, cy = py | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) for (let j = HEAD[bucket(cx + ox, cy + oy)]; j >= 0; j = NEXT[j]) {
        if (STAMP[j] === stamp) continue; STAMP[j] = stamp;
        const dx = X[j] - x0, dy = Y[j] - y0, pr = dx * fx + dy * fy;
        if (pr <= 0 || pr > dist || pr >= best) continue;
        const lat = dx * -fy + dy * fx; if (lat > -halfW && lat < halfW) best = pr;
      }
      if (best < Infinity) break;
    }
    return best;
  }
  function setVisible(v) { visible = v; }
  function setSpeed() { for (let i = 0; i < N; i++) SPD[i] = 1.2 * RND[i] * CFG.v.velGente; }
  // depuración: círculos de las personas visibles
  function debugBodies(g, P, z) {
    for (let i = 0; i < N; i++) { if (!VIS[i]) continue; const sx = Cam.sx(X[i], Y[i]), sy = Cam.sy(X[i], Y[i]); g.ellipse(sx, sy, .25 * SF, .25 * SF * SYN); }
    g.stroke({ width: 1.5 / z, color: 0xea80fc });
  }
  const debugDraw = (g, z, cam, f) => flowDebugDraw(fg, g, z, cam, f, Cam.P, 0x80d8ff);
  const costDraw = (g, z, cam) => costDebugDraw(fg, g, z, cam, Cam.P, [[c => c === COST.vereda, 0x69f0ae], [c => c === COST.pasillo, 0xb388ff], [c => c === COST.senda, 0xffffff],
    [c => c === COST.esquina || c === COST.cantero, 0xffd740], [c => c === COST.tierra, 0xbcaaa4], [c => c === COST.calle, 0xff5252]]);
  return { reset, spawn, populate, tick, pushByCars, blockAhead, setVisible, setSpeed, debugBodies, debugDraw, costDraw, costAt, S, COST, CAP,
    X, Y, VX, VY, ST, get count() { return N; }, get targets() { return fg ? fg.targets : []; }, get ready() { return fg ? fg.fields.filter(Boolean).length : 0; } };
};
