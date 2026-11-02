// ===================== people.js — flowfields para gente y para autos =====================
// FlowGrid: grilla de 1 m con un costo de paso por celda (0 = prohibido). Para cada destino se calcula un campo
// de distancias con Dijkstra por cubetas (algoritmo de Dial). Cada agente baja por el gradiente de su campo.
// Hay dos grillas distintas: la peatonal (la calle es carísima, sólo se cruza) y la vehicular (sólo calzada).
const FlowGrid = (GW, GH, cost, maxCost) => {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], INF = 0x7fffffff;
  let B = 64; while (B < maxCost * 1.5 + 2) B *= 2;
  const fields = [], targets = [];
  function compute(ti) {
    const N = GW * GH, dist = new Int32Array(N).fill(INF), bk = Array.from({ length: B }, () => []);
    const [tx, ty] = targets[ti], t0 = ty * GW + tx; dist[t0] = 0; bk[0].push(t0);
    let cur = 0, count = 1;
    while (count) {
      let list = bk[cur % B]; while (!list.length) { cur++; list = bk[cur % B]; }
      const i = list.pop(); count--; if (dist[i] !== cur) continue;
      const x = i % GW, y = (i / GW) | 0;
      for (let k = 0; k < 8; k++) { const nx = x + DIRS[k][0], ny = y + DIRS[k][1]; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx, c = cost[j]; if (!c) continue;
        if (k >= 4 && (!cost[y * GW + nx] || !cost[ny * GW + x])) continue;   // no cortar esquinas
        const nd = cur + (k < 4 ? c : ((c * 1.41) | 0)); if (nd < dist[j]) { dist[j] = nd; bk[nd % B].push(j); count++; } }
    }
    fields[ti] = dist;
  }
  // dirección de bajada en (x,y): promedio ponderado de los vecinos que bajan (más suave que el mejor vecino solo)
  function dir(f, x, y) {
    const d = fields[f]; if (!d) return null;
    const cx = Math.floor(x), cy = Math.floor(y); if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return null;
    const here = d[cy * GW + cx]; if (here === INF) return null;
    let vx = 0, vy = 0;
    for (let k = 0; k < 8; k++) { const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1]; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const v = d[ny * GW + nx]; if (v >= here) continue; const w = (here - v) / (k < 4 ? 1 : 1.41);
      const tx = nx + .5 - x, ty = ny + .5 - y, l = Math.hypot(tx, ty) || 1; vx += tx / l * w; vy += ty / l * w; }
    const l = Math.hypot(vx, vy); if (!l) return { arrived: true, here };
    return { x: vx / l, y: vy / l, here };
  }
  // igual que dir() pero sin crear objetos: escribe en out[0..1]; devuelve 0 = sin campo, 1 = ok, 2 = llegó
  const DX = new Int8Array([1, -1, 0, 0, 1, 1, -1, -1]), DY = new Int8Array([0, 0, 1, -1, 1, -1, 1, -1]);
  function dirInto(f, x, y, out) {
    const d = fields[f]; if (!d) return 0;
    const cx = x | 0, cy = y | 0; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return 0;
    const here = d[cy * GW + cx]; if (here === INF) return 0;
    let vx = 0, vy = 0;
    for (let k = 0; k < 8; k++) { const nx = cx + DX[k], ny = cy + DY[k]; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const v = d[ny * GW + nx]; if (v >= here) continue; const w = (here - v) * (k < 4 ? 1 : .709);
      const tx = nx + .5 - x, ty = ny + .5 - y, il = w / (Math.sqrt(tx * tx + ty * ty) || 1); vx += tx * il; vy += ty * il; }
    const l = Math.sqrt(vx * vx + vy * vy); if (!l) return 2;
    out[0] = vx / l; out[1] = vy / l; return 1;
  }
  const value = (f, x, y) => { const d = fields[f]; if (!d) return INF; const cx = Math.floor(x), cy = Math.floor(y); return (cx < 0 || cy < 0 || cx >= GW || cy >= GH) ? INF : d[cy * GW + cx]; };
  function pickTargets(n, r, ok) {
    const cand = [];
    for (let k = 0; k < 20000 && cand.length < 500; k++) { const x = r.int(2, GW - 3), y = r.int(2, GH - 3); if (ok(cost[y * GW + x], x, y)) cand.push([x, y]); }
    while (targets.length < n && cand.length) {
      let best = 0, bd = -1;
      for (let i = 0; i < cand.length; i++) { const d = targets.length ? Math.min(...targets.map(t => Math.hypot(t[0] - cand[i][0], t[1] - cand[i][1]))) : r(); if (d > bd) { bd = d; best = i; } }
      targets.push(cand.splice(best, 1)[0]);
    }
    return targets.map((t, i) => i);
  }
  return { GW, GH, cost, fields, targets, compute, dir, dirInto, value, pickTargets, INF };
};
// dibujo de depuración compartido
function flowDebugDraw(fg, g, z, cam, f, P, color) {
  if (!fg || !fg.fields[f]) return;
  const step = z >= 2 ? 1 : z >= 1 ? 2 : 4, R = Math.round(40 / Math.min(2, z) * 1.6);
  for (let y = Math.floor(cam[1] - R); y < cam[1] + R; y += step) for (let x = Math.floor(cam[0] - R); x < cam[0] + R; x += step) {
    if (x < 0 || y < 0 || x >= fg.GW || y >= fg.GH || !fg.cost[y * fg.GW + x]) continue;
    const q = fg.dir(f, x + .5, y + .5); if (!q || q.arrived) continue;
    const [x0, y0] = P(x + .5, y + .5), [x1, y1] = P(x + .5 + q.x * .7 * step, y + .5 + q.y * .7 * step); g.moveTo(x0, y0); g.lineTo(x1, y1);
  }
  g.stroke({ width: 1.2 / z, color, alpha: .85 });
  for (const [i, t] of fg.targets.entries()) { const [x, y] = P(t[0] + .5, t[1] + .5); g.circle(x, y, (i === f ? 9 : 5) / z); g.fill({ color: i === f ? 0xff1744 : 0xff8a80 }); }
}
function costDebugDraw(fg, g, z, cam, P, colors) {
  if (!fg) return; const R = Math.round(60 / Math.min(2, z));
  for (const [test, col] of colors) {
    for (let y = Math.floor(cam[1] - R); y < cam[1] + R; y++) for (let x = Math.floor(cam[0] - R); x < cam[0] + R; x++) {
      if (x < 0 || y < 0 || x >= fg.GW || y >= fg.GH) continue; const c = fg.cost[y * fg.GW + x]; if (!c || !test(c)) continue;
      const q = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)]; g.moveTo(...q[0]); for (let k = 1; k < 4; k++) g.lineTo(...q[k]); g.closePath(); }
    g.fill({ color: col, alpha: .3 });
  }
}
const pipPoly = (poly, p) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
// rasteriza la calzada de cada calle: cb(i, seg, q) por celda de 1 m dentro de la calzada (sin cantero central)
function rasterRoads(W, GW, GH, cb) {
  for (const s of W.segs) {
    const R = s.hw;
    const x0 = Math.max(0, Math.floor(Math.min(s.a[0], s.b[0]) - R)), x1 = Math.min(GW - 1, Math.ceil(Math.max(s.a[0], s.b[0]) + R));
    const y0 = Math.max(0, Math.floor(Math.min(s.a[1], s.b[1]) - R)), y1 = Math.min(GH - 1, Math.ceil(Math.max(s.a[1], s.b[1]) + R));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const q = World.segDist(s, x + .5, y + .5); if (q.d < s.hw) cb(y * GW + x, s, q); }
  }
}

// ===================== tránsito =====================
// Grilla vehicular: sólo calzada (nunca vereda, cantero central, lotes ni pasillos). Las avenidas son más baratas,
// el borde de la calzada se penaliza (los autos van por el medio de su mano). Cada auto sigue su campo y además
// corrige su posición lateral para ir por la mano derecha.
// desplazamiento del carril respecto del eje: en calles con estacionamiento a ambos lados queda un carril angosto por mano
const laneOff = (s) => s.type === "ave" ? s.med + (s.hw - s.med) * .45 : s.mat === "tierra" ? Math.max(.7, s.hw * .3) : Math.max(.95, Math.min(1.3, s.hw - 2.8));
const parkOff = (s) => s.mat === "tierra" ? s.hw - 1.6 : s.hw - .92;
const Traffic = (ctx) => {
  const { pl, V2, CFG, crowd } = ctx;
  const COST = { ave: 6, asf: 9, roto: 12, tierra: 15, borde: 8 };
  let fg = null, cars = [], pending = [], W = null, phys = null, comp = null, mainComp = -1, segAt = null, segs = null;
  const tmp = new Float32Array(2), rayA = V2(0, 0), rayB = V2(0, 0);
  const S = { active: 0, moving: 0, blocked: 0, reversing: 0, ctlMs: 0, fieldMs: 0, rays: 0 };
  const onMain = (b) => { const q = b.getPosition(), i = Math.floor(q.y) * fg.GW + Math.floor(q.x); return comp && comp[i] === mainComp; };
  function reset(world, physics, seed) {
    W = world; phys = physics; cars = []; segs = W.segs;
    const GW = Math.ceil(W.MW), GH = Math.ceil(W.MH), cost = new Uint8Array(GW * GH), best = new Float32Array(GW * GH).fill(1e9);
    segAt = new Int32Array(GW * GH).fill(-1);
    rasterRoads(W, GW, GH, (i, s, q) => {
      if (s.mat === "pasillo") return;
      if (q.d < best[i]) { best[i] = q.d; segAt[i] = s.id; }                 // calle más cercana en cada celda (para la mano derecha)
      if (s.type === "ave" && Math.abs(q.ds) < s.med + .3) return;           // cantero central: prohibido
      let c = s.type === "ave" ? COST.ave : COST[s.mat] || COST.asf;
      if (s.hw - q.d < 1.1) c += COST.borde;                                  // pegado al cordón
      cost[i] = cost[i] ? Math.min(cost[i], c) : c;
    });
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; if (!cost[i]) continue;
      const c = W.classify(x + .5, y + .5); if (!c || c.k !== "road" || c.s.mat === "pasillo" || (c.s.type === "ave" && Math.abs(c.ds) < c.s.med + .3)) cost[i] = 0; }
    comp = new Int32Array(GW * GH).fill(-1); let bestC = -1, bestN = 0, id = 0;
    for (let i = 0; i < GW * GH; i++) { if (!cost[i] || comp[i] >= 0) continue; const st = [i]; comp[i] = id; let n = 0;
      while (st.length) { const j = st.pop(); n++; const x = j % GW, y = (j / GW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue; const k = ny * GW + nx; if (cost[k] && comp[k] < 0) { comp[k] = id; st.push(k); } } }
      if (n > bestN) { bestN = n; bestC = id; } id++; }
    mainComp = bestC;
    fg = FlowGrid(GW, GH, cost, COST.tierra + COST.borde);
    pending = fg.pickTargets(Math.max(3, Math.round(CFG.v.destinosAutos)), R3.rng(seed ^ 0x68E31DA4), (c, x, y) => c && c <= COST.roto && comp[y * GW + x] === mainComp);
  }
  function prune() { for (const c of cars.slice()) if (!onMain(c.b)) remove(c.b); }
  function add(b) { const c = { b, f: -1, blocked: 0, rev: 0, revSteer: 0, stuck: 0, lost: 0, why: "", ctl: { up: 0, down: 0, steer: 0, hand: 0, rev: 0 } }; b.ai = c; cars.push(c); return c; }
  function remove(b) { const i = cars.findIndex(c => c.b === b); if (i >= 0) cars.splice(i, 1); b.ai = null; }
  // rayo de Box2D con un callback fijo (sin closures nuevos)
  let rayHit = Infinity, rayDist = 0, rayWho = null, raySelf = null;
  const rayCb = (fx, point, n, frac) => { const bb = fx.getBody(); if (bb === raySelf) return -1; if (frac * rayDist < rayHit) { rayHit = frac * rayDist; rayWho = bb; } return frac; };
  function ahead(c, len, wid, dist, ang) {
    const b = c.b, p = b.getPosition(), a = b.getAngle() + ang, fx = Math.cos(a), fy = Math.sin(a), ox = p.x + fx * (len / 2 + .2), oy = p.y + fy * (len / 2 + .2);
    rayHit = Infinity; rayDist = dist; rayWho = null; raySelf = b; S.rays++;
    rayA.x = ox; rayA.y = oy; rayB.x = ox + fx * dist; rayB.y = oy + fy * dist;
    phys.rayCast(rayA, rayB, rayCb);
    let hit = rayHit;
    const ph = crowd.blockAhead(ox, oy, fx, fy, dist, wid / 2 + .2);
    if (ph < hit) { hit = ph; c.why = "persona"; } else if (hit < Infinity) c.why = rayWho.ai ? "auto IA" : rayWho.getType() === "static" ? "fijo" : rayWho.veh ? "auto" : "otro";
    return hit;
  }
  const set = (ctl, up, down, steer, rev) => { ctl.up = up; ctl.down = down; ctl.steer = steer; ctl.rev = rev; ctl.hand = 0; return ctl; };
  // controles del auto c (escribe en c.ctl); maniobra en reversa si está trabado
  function control(c, dt, len, wid) {
    const b = c.b, v = b.getLinearVelocity(), a = b.getAngle(), sp = v.x * Math.cos(a) + v.y * Math.sin(a), ctl = c.ctl;
    if (c.rev > 0) { c.rev -= dt; return set(ctl, 0, 1, c.revSteer, 1); }
    control0(c, dt, len, wid);
    if (ctl.up && Math.abs(sp) < .4) { c.stuck += dt; if (c.stuck > 1.6) { c.stuck = 0; c.rev = 1 + Math.random() * .8; c.revSteer = -Math.sign(ctl.steer || (Math.random() - .5)); if (Math.random() < .3) c.f = -1; } }
    else c.stuck = Math.max(0, c.stuck - dt);
    return ctl;
  }
  function control0(c, dt, len, wid) {
    const b = c.b, p = b.getPosition(), ang = b.getAngle(), v = b.getLinearVelocity(), fx = Math.cos(ang), fy = Math.sin(ang), sp = v.x * fx + v.y * fy, ctl = c.ctl;
    const GW = fg.GW, ci = (p.y | 0) * GW + (p.x | 0);
    // fuera de la calzada: volver al eje de la calle registrada en esa celda (o la más cercana)
    if (ci < 0 || ci >= fg.cost.length || !fg.cost[ci]) {
      let si = ci >= 0 && ci < segAt.length ? segAt[ci] : -1;
      if (si < 0) { let bd = 1e9; for (const s of W.near(p.x, p.y)) { if (s.mat === "pasillo") continue; const dx = p.x - s.a[0], dy = p.y - s.a[1], t = Math.max(0, Math.min(s.len, dx * s.dir[0] + dy * s.dir[1])), ex = dx - s.dir[0] * t, ey = dy - s.dir[1] * t, d = ex * ex + ey * ey; if (d < bd) { bd = d; si = s.id; } } }
      if (si < 0) return set(ctl, 0, 1, 0, 0);
      const s = segs[si], dx = p.x - s.a[0], dy = p.y - s.a[1], t = Math.max(0, Math.min(s.len, dx * s.dir[0] + dy * s.dir[1]));
      let df = Math.atan2(s.a[1] + s.dir[1] * t - p.y, s.a[0] + s.dir[0] * t - p.x) - ang; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI;
      if (Math.abs(df) > 1.9) { c.rev = .8; c.revSteer = -Math.sign(df); return set(ctl, 0, 1, c.revSteer, 1); }
      return set(ctl, sp < 2.5 ? 1 : 0, 0, Math.max(-1, Math.min(1, df * 2)), 0);
    }
    const here = c.f >= 0 ? fg.value(c.f, p.x, p.y) : fg.INF;
    if (here === fg.INF || here < 120) {
      let pick = -1; const nf = fg.fields.length;
      for (let k = 0; k < 8 && pick < 0; k++) { const f = (Math.random() * nf) | 0; if (f !== c.f && fg.fields[f] && fg.value(f, p.x, p.y) !== fg.INF) pick = f; }
      if (pick < 0) { c.lost += dt; if (c.lost > 3 && pending.length === 0) remove(b); return set(ctl, 0, 1, 0, 0); }
      c.lost = 0; c.f = pick;
    }
    const look = 2 + Math.max(0, sp) * .5;
    let r = fg.dirInto(c.f, p.x + fx * look, p.y + fy * look, tmp); if (r !== 1) r = fg.dirInto(c.f, p.x, p.y, tmp);
    if (r !== 1) return set(ctl, 0, 1, 0, 0);
    let dx = tmp[0], dy = tmp[1];
    const si = segAt[ci], s = si >= 0 ? segs[si] : null;
    if (s) {                                    // mano derecha: corrige el desvío lateral en tramos derechos
      const al = dx * s.dir[0] + dy * s.dir[1];
      if (al > .75 || al < -.75) {
        const ds = (p.x - s.a[0]) * s.n[0] + (p.y - s.a[1]) * s.n[1], want = -(al >= 0 ? 1 : -1) * laneOff(s), err = Math.max(-2, Math.min(2, want - ds));
        dx += s.n[0] * err * .35; dy += s.n[1] * err * .35; const l = Math.sqrt(dx * dx + dy * dy); dx /= l; dy /= l;
      }
    }
    let diff = Math.atan2(dy, dx) - ang; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    const base = s ? (s.type === "ave" ? 45 : s.mat === "tierra" ? 18 : s.type === "pasaje" ? 15 : 30) : 20;
    let target = base / 3.6 * CFG.v.velAutos * Math.max(.3, 1 - Math.abs(diff) * .9);
    const free = Math.min(ahead(c, len, wid, 4 + sp * 1.4, 0), Math.abs(diff) > .3 ? ahead(c, len, wid, 2.5 + sp * .6, .35 * Math.sign(diff)) : Infinity);
    if (free < 1.8 + sp * .7) { target = 0; c.blocked += dt; } else c.blocked = Math.max(0, c.blocked - dt);
    if (c.blocked > 3.5) { c.blocked = 0; c.rev = 1.2 + Math.random(); c.revSteer = -Math.sign(diff || 1); if (Math.random() < .4) c.f = -1; }
    return set(ctl, sp < target ? 1 : 0, sp > target + 1.2 ? 1 : 0, Math.max(-1, Math.min(1, diff * 2.2)), 0);
  }
  function tick() {
    if (pending.length) { const t0 = performance.now(); while (pending.length && performance.now() - t0 < 8) fg.compute(pending.shift()); S.fieldMs = performance.now() - t0; } else S.fieldMs = 0;
  }
  const debugDraw = (g, z, cam, f) => flowDebugDraw(fg, g, z, cam, f, Cam.P, 0xffab40);
  const costDraw = (g, z, cam) => costDebugDraw(fg, g, z, cam, Cam.P, [[c => c === COST.ave, 0x40c4ff], [c => c === COST.asf, 0x69f0ae], [c => c === COST.roto, 0xffd740],
    [c => c === COST.tierra, 0xbcaaa4], [c => c > COST.tierra || c === COST.asf + COST.borde || c === COST.roto + COST.borde || c === COST.ave + COST.borde, 0xff5252]]);
  return { reset, add, remove, prune, control, tick, debugDraw, costDraw, S, get cars() { return cars; }, get targets() { return fg ? fg.targets : []; }, get ready() { return fg ? fg.fields.filter(Boolean).length : 0; }, get pendingN() { return pending.length; } };
};
