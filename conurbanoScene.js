// ===================== conurbanoScene.js — el barrio del conurbano en WeedJS =====================
// Mundo de WeedJS = píxeles de la proyección oblicua (18 px/m de ancho, 9 px/m de profundidad), igual que littleCity.
// Todo lo horneado sale de weedbake/run_bake.js: catálogo de casas (R3), posiciones, flowfields y datos del piso.
//   piso       -> capa worldRect con un shader que pinta calles/veredas/patios en la GPU (shaders/piso.frag)
//   casas      -> entidades estáticas con su sprite horneado + colisionador poligonal + sombra (malla)
//   gente      -> 2000 personas LPC siguiendo flowfields estáticos con costos (cruzan, no caminan por la calle)
//   autos      -> Box2D (patrón de carScene/littleCity), IA por el flowfield de carriles; V para manejar
import { META } from './meta.js';

const { Scene, GameObject, Component, SharedResource, RigidBody, Collider, CollisionListener, SpriteRenderer, MeshRenderer, Transform,
  Camera, Keyboard, Mouse, NavGrid, Layer, LAYER_KIND, SpriteSheetRegistry, LightEmitter, ShadowCaster, Sun, enums, rng, dot2 } = WEED;
const { ShapeType } = enums;

const NLPC = 19, NPED = META.pedTargets, PXM = META.PXM;
const PED_FIELDS = Array.from({ length: NPED }, (_, i) => 'peaton' + i);
const CAR_SHEETS = ['red', 'white', 'black', 'blue', 'yellow', 'poli', 'burnt'];
const LPC_EXCLUDE = ['spellcast', 'thrust', 'slash', 'shoot', 'jump', 'sit', 'emote', 'run', 'combat', '1h_slash', '1h_halfslash']
  .flatMap(a => ['up', 'left', 'down', 'right'].map(d => `${a}_${d}`)).concat(['hurt', 'climb']);

// ---------- datos compartidos: piso (para el shader) y estado del juego
export class PisoData extends SharedResource {}
export class Estado extends SharedResource {}

// ---------- componentes
export class PersonaComp extends Component {
  static ARRAY_SCHEMA = { campo: Uint8Array, quieta: Uint8Array, estado: Uint8Array, timer: Float32Array, vel: Float32Array, cara: Uint8Array };
}
export class AutoComp extends Component {
  static ARRAY_SCHEMA = { active: Uint8Array, driveForce: Float32Array, lateralFriction: Float32Array, turnTorque: Float32Array, minSteerSpeed: Float32Array,
    minSteerFactor: Float32Array, maxSteerSpeed: Float32Array, lastKey: Int16Array };
}

// ---------- casas, tapiales y postes (sprites horneados con R3)
export class Casa extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, LightEmitter];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    this.setSprite('obj' + c.o, c.a, 0);
    this.spriteRenderer.anchorX = c.ax; this.spriteRenderer.anchorY = c.ay;
    if (c.col) {
      const p = c.col; let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
      const pts = area >= 0 ? p : p.slice().reverse(), flat = [];
      for (const q of pts) flat.push(q[0], q[1]);
      if (!this.collider.makePolygon(flat)) { this.collider.shapeType = ShapeType.Circle; this.collider.radius = 6; }
    } else { this.collider.shapeType = ShapeType.Circle; this.collider.radius = c.r || 3; }
    this.collider.visualRange = 260;
    // luz de las ventanas: de día se pierde en la luz del sol, de noche ilumina la vereda (como la House de predatorScene)
    const L = this.lightEmitter, on = c.k === 'house' && rng() < .4;
    L.lightColor = rng() < .8 ? 0xffd9a0 : 0xbfd4ff; L.height = 30; L.hasGlowSprite = 0;
    L.lightIntensity = on ? 220 + rng() * 260 : 0; L.active = on ? 1 : 0;
  }
}
// sombra de cada casa al piso: un polígono convexo en una capa de mallas
export class SombraCasa extends GameObject {
  static isStatic = true;
  static components = [MeshRenderer];
  onSpawned(c = {}) {
    this.setLayer('sombrasCasas');
    this.meshRenderer.tint = 0x000000; this.meshRenderer.alpha = .3;
    const flat = new Float32Array(c.sh.length * 2); c.sh.forEach((q, i) => { flat[i * 2] = q[0]; flat[i * 2 + 1] = q[1]; });
    this.meshRenderer.setMesh(flat);       // convexo: abanico desde el vértice 0
  }
}
// árboles, faroles, semáforos, contenedores… (lo que frena un auto); lo demás va como Decoration
export class Prop extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster, LightEmitter];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    this.setSprite('props', c.f, 0);
    const an = META.anchors[c.f]; this.spriteRenderer.anchorX = an[0]; this.spriteRenderer.anchorY = an[1];
    if (c.fl) this.setScale(-1, 1);
    this.collider.shapeType = ShapeType.Circle; this.collider.radius = Math.max(1.5, c.r);
    this.collider.visualRange = 200;
    this.shadowCaster.heightMultiplier = c.f.startsWith('utree_') ? 1 : .8;
    const L = this.lightEmitter, top = this.spriteRenderer.originalHeight * an[1];
    if (c.f.startsWith('u_farol')) {          // farol: charco de luz en la vereda + brillo en la lámpara
      L.lightColor = c.f === 'u_farol_doble' ? 0xfff0d0 : 0xffc880; L.height = 0; L.glowHeightOffset = top * .92;
      L.lightIntensity = c.f === 'u_farol_doble' ? 2600 : 1800; L.hasGlowSprite = .55; L.active = 1;
      this.collider.visualRange = 260;        // alcance para las sombras que proyecta su luz
    } else if (c.f === 'u_semaforo') {
      L.lightColor = rng() < .5 ? 0xff3b30 : 0x36d96b; L.height = 0; L.glowHeightOffset = top * .8;
      L.lightIntensity = 120; L.hasGlowSprite = .9; L.active = 1;
    } else { L.lightIntensity = 0; L.active = 0; }
  }
}

// ---------- gente
const _v = { x: 0, y: 0 };
const DIRN = ['up', 'left', 'down', 'right'], WALK = DIRN.map(d => 'walk_' + d), IDLE = DIRN.map(d => 'idle_' + d);
export class Persona extends GameObject {
  static deriveSpeed = true;
  static tickInterval = 2;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster, PersonaComp];
  onSpawned(c = {}) {
    this.setSpritesheet('lpc' + ((rng() * NLPC) | 0));
    this.setAnimation('idle_down');
    this.rigidBody.linearDamping = 3;
    this.setFixedRotation(1);
    this.spriteRenderer.anchorX = .5; this.spriteRenderer.anchorY = .93;
    const s = .56 + rng() * .08; this.setScale(s, s);
    this.collider.radius = 4.5; this.collider.visualRange = 80;
    const p = this.personaComp;
    p.campo = (rng() * NPED) | 0; p.quieta = c.quieta ? 1 : 0; p.estado = 0; p.timer = rng() * 4; p.vel = 17 + rng() * 9; p.cara = 2;
    this.shadowCaster.heightMultiplier = 1.2;
    this._anim = -1;
  }
  tick(dtRatio, dt) {
    const i = this.index, P = PersonaComp, dts = (dt || 33) / 1000;
    let vx = RigidBody.vx[i], vy = RigidBody.vy[i];
    if (!P.quieta[i]) {
      P.timer[i] -= dts;
      if (P.estado[i] === 0) { if (P.timer[i] <= 0) { P.estado[i] = 1; P.timer[i] = 15 + rng() * 60; } }
      else {
        NavGrid.requestVectorFromStaticFlowfield(PED_FIELDS[P.campo[i]], this.x, this.y, _v);
        if ((_v.x === 0 && _v.y === 0) || P.timer[i] <= 0) {        // llegó, no hay camino o se cansó: pausa y otro destino
          P.estado[i] = 0; P.timer[i] = 1 + rng() * 7; P.campo[i] = (rng() * NPED) | 0;
        } else {
          const sp = P.vel[i];
          this.addAcceleration((_v.x * sp - vx) * 6, (_v.y * sp - vy) * 6);
        }
      }
      // separación y esquivar autos (vecinos de la grilla espacial)
      let sx = 0, sy = 0; const mx = this.x, my = this.y;
      for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (!Transform.active[j]) continue;
        const dx = mx - Transform.x[j], dy = my - Transform.y[j], d2 = dx * dx + dy * dy;
        if (AutoComp.active[j]) { if (d2 < 2500 && d2 > 1) { const f = (2500 - d2) / 2500; sx += dx / Math.sqrt(d2) * f * 3; sy += dy / Math.sqrt(d2) * f * 3; } continue; }
        if (d2 < 100 && d2 > .01) { const f = (100 - d2) / 100; sx += dx / Math.sqrt(d2) * f; sy += dy / Math.sqrt(d2) * f; } }
      if (sx || sy) this.addAcceleration(sx * 120, sy * 120);
    }
    // animación: caminar u ocioso, dirección según la velocidad en pantalla
    const s2 = vx * vx + vy * vy;
    if (s2 > 16) { const ax = Math.abs(vx), ay = Math.abs(vy) * 2; P.cara[i] = ax > ay ? (vx > 0 ? 3 : 1) : (vy > 0 ? 2 : 0);
      const want = P.cara[i]; if (this._anim !== want) { this._anim = want; this.setAnimation(WALK[want]); } this.setAnimationSpeed(Math.sqrt(s2) * .0045); }
    else if (this._anim !== 10 + P.cara[i]) { this._anim = 10 + P.cara[i]; this.setAnimation(IDLE[P.cara[i]]); this.setAnimationSpeed(.03); }
  }
}

// ---------- autos (Box2D, patrón de carScene; el cuadro del sprite "desaplasta" la y de la pantalla)
const _h = { frontX: 0, frontY: 0, rightX: 0, rightY: 0 };
const _keys = new Map();
function angleKeys(sheet) {
  let k = _keys.get(sheet); if (k) return k;
  const names = SpriteSheetRegistry.getAnimationNames(sheet) || [];
  k = names.map(n => ({ n, a: parseFloat(n) * Math.PI / 180 })).filter(o => !isNaN(o.a)).map(o => ({ n: o.n, c: Math.cos(o.a), s: Math.sin(o.a) }));
  _keys.set(sheet, k); return k;
}
export class Auto extends GameObject {
  static deriveSpeed = true;
  static components = [RigidBody, Collider, CollisionListener, SpriteRenderer, ShadowCaster, LightEmitter, AutoComp];
  onSpawned(c = {}) {
    this._sheet = 'auto_' + (c.color || 'red');
    this.setSpritesheet(this._sheet); this.setAnimation('0');
    this.spriteRenderer.anchorX = .5; this.spriteRenderer.anchorY = .62;
    this.spriteRenderer.inheritTransformRotation = 0; this.spriteRenderer.spriteRotation = 0;
    const A = this.autoComp;
    A.driveForce = c.drive ?? 340; A.lateralFriction = 8; A.turnTorque = 10; A.minSteerSpeed = 8; A.minSteerFactor = .5; A.maxSteerSpeed = 140; A.lastKey = -1;
    this.collider.shapeType = ShapeType.Box; this.collider.width = 4.4 * PXM; this.collider.height = 1.8 * PXM; this.collider.radius = 0;
    this.collider.friction = .3; this.collider.visualRange = 160;
    this.rigidBody.static = c.fijo ? 1 : 0; this.rigidBody.linearDamping = 1; this.rigidBody.angularDamping = 3;
    this.setFixedRotation(0);
    this.rotation = c.rot || 0;
    A.active = 1;
    this.shadowCaster.heightMultiplier = .55;
    const L = this.lightEmitter, lit = !!c.faros;
    L.lightColor = 0xfff2d6; L.height = 0; L.hasGlowSprite = 0; L.lightIntensity = lit ? 500 : 0; L.active = lit ? 1 : 0;
    this._frame();
  }
  onDespawned() { this.autoComp.active = 0; }
  // agarre lateral (las ruedas no patinan de costado)
  _friction() { const i = this.index; GameObject.getHeadingAxes(i, _h);
    const lat = dot2(RigidBody.vx[i], RigidBody.vy[i], _h.rightX, _h.rightY), k = AutoComp.lateralFriction[i];
    RigidBody.ax[i] -= _h.rightX * lat * k; RigidBody.ay[i] -= _h.rightY * lat * k; }
  applyForces(fwd = 0, turn = 0) {
    const i = this.index; if (!Transform.active[i]) return;
    GameObject.getHeadingAxes(i, _h);
    const sp = dot2(RigidBody.vx[i], RigidBody.vy[i], _h.frontX, _h.frontY);
    if (fwd) { const f = AutoComp.driveForce[i] * fwd; RigidBody.ax[i] += _h.frontX * f; RigidBody.ay[i] += _h.frontY * f; }
    if (turn) { const a = Math.abs(sp); if (a >= AutoComp.minSteerSpeed[i]) { const mf = AutoComp.minSteerFactor[i], f = mf + (1 - mf) * Math.min(a / AutoComp.maxSteerSpeed[i], 1);
      RigidBody.angularAccel[i] += turn * AutoComp.turnTorque[i] * f * (sp >= 0 ? 1 : -1); } }
    if (fwd || turn) RigidBody.sleeping[i] = 0;
  }
  // rumbo en pantalla -> rumbo "real" (y desaplastada) -> el más cercano de los 48 cuadros
  _frame() {
    const i = this.index, c = Transform.rotC ? Transform.rotC[i] : 1, s = (Transform.rotS ? Transform.rotS[i] : 0) / META.SYN, l = Math.hypot(c, s) || 1;
    const ks = angleKeys(this._sheet); if (!ks.length) return;
    let best = 0, bd = -2; for (let k = 0; k < ks.length; k++) { const d = (c * ks[k].c + s * ks[k].s) / l; if (d > bd) { bd = d; best = k; } }
    if (AutoComp.lastKey[i] !== best) { AutoComp.lastKey[i] = best; this.setAnimation(ks[best].n); }
  }
  tick() { if (!Transform.active[this.index]) return; this._friction(); if (RigidBody.speed[this.index] > 2 || AutoComp.lastKey[this.index] < 0) this._frame(); }
}
export class AutoEstacionado extends Auto {}
export class Chatarra extends Auto {}

// IA: sigue el flowfield de carriles (mano derecha), frena por gente y autos adelante (patrón de littleCity)
const _probe = [[0, 0], [24, 0], [-24, 0], [0, 12], [0, -12], [24, 12], [24, -12], [-24, 12], [-24, -12], [48, 0], [-48, 0], [0, 24], [0, -24]];
export class AutoIA extends Auto {
  onSpawned(c = {}) { super.onSpawned(c); this._lx = Math.cos(c.rot || 0); this._ly = Math.sin(c.rot || 0); this._stuck = 0; }
  _sample(x, y) { for (let k = 0; k < _probe.length; k++) { NavGrid.requestVectorFromStaticFlowfield('calles', x + _probe[k][0], y + _probe[k][1], _v); if (_v.x * _v.x + _v.y * _v.y >= .01) return true; } return false; }
  tick(dtRatio, dt) {
    super.tick();
    const i = this.index;
    if (this._sample(this.x, this.y)) { this._lx = _v.x; this._ly = _v.y; } else { _v.x = this._lx; _v.y = this._ly; }
    const l2 = _v.x * _v.x + _v.y * _v.y; if (l2 < .01) return;
    const inv = 1 / Math.sqrt(l2), nx = _v.x * inv, ny = _v.y * inv, fx = this.forwardX, fy = this.forwardY;
    const cross = fx * ny - fy * nx, align = fx * nx + fy * ny;
    let turn = Math.max(-1, Math.min(1, cross * 2.5)) * .9, fwd = align > .2 ? .5 : RigidBody.speed[i] > 40 ? 0 : .45;
    // ¿alguien adelante en el carril?
    let brake = 0, steer = 0;
    for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (!Transform.active[j] || j === i) continue;
      const isCar = AutoComp.active[j] === 1, isPerson = !isCar && PersonaComp.vel[j] > 0; if (!isCar && !isPerson) continue;
      const dx = Transform.x[j] + RigidBody.vx[j] * .2 - this.x, dy = Transform.y[j] + RigidBody.vy[j] * .2 - this.y, ahead = dx * fx + dy * fy, reach = isCar ? 95 : 70;
      if (ahead <= 8 || ahead > reach) continue; const side = fx * dy - fy * dx, as = Math.abs(side), corr = isCar ? 22 : 16; if (as > corr) continue;
      const u = (1 - ahead / reach) * (.4 + .6 * (1 - as / corr)); if (u > brake) brake = u; steer += (side >= 0 ? -1 : 1) * u; }
    if (brake > 0) { turn = Math.max(-1, Math.min(1, turn * (1 - brake * .6) + Math.max(-1, Math.min(1, steer)) * .8)); fwd = brake > .8 ? -.35 : fwd * (1 - brake); }
    this.applyForces(fwd, turn);
  }
}

// el tuyo: WASD / flechas cuando Estado.manejando = 1; la cámara lo sigue
export class AutoJugador extends Auto {
  tick(dtRatio) {
    super.tick();
    if (!Estado.manejando || Estado.manejando.load(0) !== 1) return;
    const up = Keyboard.w || Keyboard.arrowup, dn = Keyboard.s || Keyboard.arrowdown;
    let fwd = up && !dn ? 1 : dn && !up ? -.6 : 0, turn = 0;
    if (Keyboard.d || Keyboard.arrowright) turn += 1; if (Keyboard.a || Keyboard.arrowleft) turn -= 1;
    if (fwd || turn) this.applyForces(fwd, turn);
    if (Keyboard[' ']) { const i = this.index; RigidBody.vx[i] *= .9; RigidBody.vy[i] *= .9; }
    Camera.followEntity(this.index, 0, .12, dtRatio);
  }
}

// ---------- escena
const SHEETS = {};
for (let i = 0; i < META.sheets; i++) SHEETS['obj' + i] = { json: 'img/obj' + i + '.json', png: 'img/obj' + i + '.png' };
SHEETS.props = { json: 'img/props.json', png: 'img/props.png' };
for (let i = 0; i < NLPC; i++) SHEETS['lpc' + i] = { json: 'img/lpc/civil1.json', png: 'img/lpc/c' + i + '.png', excludeAnimations: LPC_EXCLUDE };
for (const c of CAR_SHEETS) SHEETS['auto_' + c] = { json: 'img/cars/' + c + '.json', png: 'img/cars/' + c + '.png' };
const FLOW = { calles: 'data/ff_calles.json' }; PED_FIELDS.forEach(n => FLOW[n] = 'data/ff_' + n + '.json');
const f32 = (v) => ({ value: v, type: 'f32' });
const PACK = typeof globalThis.location?.search === 'string' && new URLSearchParams(globalThis.location.search).has('empaquetar');

export class ConurbanoScene extends Scene {
  static config = {
    worldWidth: META.WW, worldHeight: META.WH, seed: 7,
    spatial: { cellSize: 64, maxNeighbors: 96, maxEntitiesPerCell: 128, numberOfSpatialWorkers: 1 },
    logic: { numberOfLogicWorkers: 2, staggeredUpdates: true },
    physics: { gravity: { x: 0, y: 0 }, sleeping: true, subStepCount: 0, commandRingCapacity: 32768 },
    particle: { maxParticles: 500, decals: false },
    decoration: { maxDecorations: 9000 },
    renderer: { backend: 'webgl', ySort: true, maxMeshVerts: 12000, maxMeshIndices: 0 },
    preRender: { startFadingDecorationsAtZoom: .3, hideDecorationsAtZoom: .15 },
    lighting: {
      enabled: true, lightGlow: 'add', baseAmbient: .1, maxLights: 192,
      shadowsEnabled: true, maxShadowCastingLights: 16, maxShadowsPerLight: 64, maxShadowsPerEntity: 2,
      resolution: .25, shadowResolution: .25,
      // sol del sudoeste (igual que la luz horneada de las casas); arranca al atardecer para ver las luces enseguida
      sun: { enabled: true, angle: 135, elevation: 40, intensity: 1, color: 0xfff4e0, shadowAlpha: .3, startHour: 17.5,
        dayCycle: { enabled: true, speed: 1, dayDurationMinutes: 8 } },
    },
    navigation: { enabled: true, cellSize: 64 },
    layers: {
      piso: { zIndex: .5, shader: {
        fragment: { webgl: 'shaders/piso.frag' }, worldRect: { width: META.WW, height: META.WH },
        textures: [{ name: 'cellA', format: 'rgba8unorm', size: { width: META.CW, height: META.CH } }, { name: 'cellB', format: 'rgba8unorm', size: { width: META.CW, height: META.CH } },
          { name: 'wealth', format: 'r8unorm', size: { width: META.WG, height: META.HG } }, { name: 'noiseT', format: 'rgba8unorm', size: { width: 256, height: 256 } },
          { name: 'segs', format: 'rgba8unorm', size: { width: 12, height: META.NS } }],
        uniforms: { uMW: f32(META.MW), uMH: f32(META.MH), uK: f32(META.K), uSF: f32(META.SF), uSYN: f32(META.SYN), uGC: f32(META.GC), uCW: f32(META.CW), uCH: f32(META.CH), uWG: f32(META.WG), uHG: f32(META.HG) } } },
      sombrasCasas: { kind: LAYER_KIND.MESH, zIndex: 1.5 },
      sombras: { zIndex: 1.6, ySorting: false, maxItems: 3000 },
      cables: { zIndex: 3.5, ySorting: false, maxItems: 4000 },
    },
  };
  // atlas pre-horneado (herramientas/hornear_atlas.js): el celu no tiene que decodificar y empaquetar ~60 imágenes al arrancar
  // (con ?empaquetar en la URL se arma en el navegador, para volver a hornearlo después de cambiar los sprites)
  static assets = { ...(PACK ? {} : { bigAtlas: { json: 'img/baked/bigAtlas.json', png: 'img/baked/bigAtlas.png' } }), spritesheets: SHEETS, flowfields: FLOW };
  static sharedResources = [
    [PisoData, { cellA: { type: Uint8Array, length: META.CW * META.CH * 4 }, cellB: { type: Uint8Array, length: META.CW * META.CH * 4 },
      wealth: { type: Uint8Array, length: META.WG * META.HG }, noise: { type: Uint8Array, length: 256 * 256 * 4 }, segs: { type: Uint8Array, length: META.NS * 48 } }],
    [Estado, { manejando: { type: Int32Array, length: 1, mailbox: true } }],
  ];
  static entities = [[Casa, 700], [SombraCasa, 700], [Prop, 1100], [Persona, 2100], [AutoIA, 160], [AutoEstacionado, 260], [Chatarra, 40], [AutoJugador, 1]];

  async preload() {
    // ---- piso: datos horneados -> memoria compartida -> texturas del shader
    const bin = await (await fetch('data/ground.bin')).arrayBuffer(), u8 = new Uint8Array(bin), parts = META.groundParts;
    PisoData.cellA.set(u8.subarray(parts.cellA[0], parts.cellA[0] + parts.cellA[1]));
    PisoData.cellB.set(u8.subarray(parts.cellB[0], parts.cellB[0] + parts.cellB[1]));
    PisoData.wealth.set(u8.subarray(parts.wealth[0], parts.wealth[0] + parts.wealth[1]));
    PisoData.noise.set(u8.subarray(parts.noise[0], parts.noise[0] + parts.noise[1]));
    PisoData.segs.set(u8.subarray(parts.segs[0], parts.segs[0] + parts.segs[1]));
    const L = Layer.get('piso');
    L.updateTexture('cellA', PisoData.cellA); L.updateTexture('cellB', PisoData.cellB); L.updateTexture('wealth', PisoData.wealth);
    L.updateTexture('noiseT', PisoData.noise); L.updateTexture('segs', PisoData.segs);
    // ---- objetos
    const w = await (await fetch('data/world.json')).json();
    for (const h of w.houses) { Casa.spawn({ x: h.x, y: h.y, o: h.o, a: h.a, ax: h.ax, ay: h.ay, col: h.col, r: h.r, k: h.k }); if (h.sh) SombraCasa.spawn({ x: h.x, y: h.y, sh: h.sh }); }
    const { Decoration } = WEED;
    for (const p of w.props) {
      if (p.sh && !(p.r > 0)) { const a = META.anchors[p.sh]; Decoration.spawn({ x: p.x, y: p.y, texture: 'props_' + p.sh, anchorX: a[0], anchorY: a[1], alpha: .45, layer: 'sombras' }); }
      if (p.r > 0) Prop.spawn({ x: p.x, y: p.y, f: p.f, r: p.r, fl: p.fl });
      else { const a = META.anchors[p.f]; Decoration.spawn({ x: p.x, y: p.y, texture: 'props_' + p.f, anchorX: a[0], anchorY: a[1], scaleX: p.fl ? -1 : 1 }); }
    }
    for (const c of w.cables) { const dx = c[2] - c[0], dy = c[3] - c[1], L2 = Math.hypot(dx, dy);
      Decoration.spawn({ x: c[0], y: c[1], texture: '_white', anchorX: 0, anchorY: .5, scaleX: L2 / 8, scaleY: 1 / 8, rotation: Math.atan2(dy, dx), tint: 0x17171b, alpha: .85, layer: 'cables' }); }
    for (const p of w.people) Persona.spawn({ x: p[0], y: p[1], quieta: p[2] });
    let first = null;
    for (const c of w.cars) {
      if (c.c === 'burnt') Chatarra.spawn({ x: c.x, y: c.y, rot: c.rot, color: 'burnt', fijo: 1 });
      else if (c.m) { AutoIA.spawn({ x: c.x, y: c.y, rot: c.rot, color: c.c, faros: 1 }); if (!first) first = c; }
      else AutoEstacionado.spawn({ x: c.x, y: c.y, rot: c.rot, color: c.c });
    }
    // tu auto: arranca en el centro del mapa, en el carril del primer auto con IA más cercano
    let best = first, bd = 1e18; for (const c of w.cars) if (c.m) { const d = (c.x - META.WW / 2) ** 2 + (c.y - META.WH / 2) ** 2; if (d < bd) { bd = d; best = c; } }
    if (best) { AutoJugador.spawn({ x: best.x + 30, y: best.y + 2, rot: best.rot, color: 'red', drive: 300, faros: 1 }); this._spawnCar = best; }
    this.focusX = best ? best.x : META.WW / 2; this.focusY = best ? best.y : META.WH / 2;
  }

  // salta a la próxima hora: mediodía, atardecer, noche, amanecer
  nextTime() { const hs = [12, 18.6, 22, 6.2], h = Sun.hour || 12; let n = hs.find(x => x > h + .1); if (n == null) n = hs[0]; Sun.setTimeOfDay(n); return n; }
  create() {
    Camera.setFree(false);
    Camera.setZoom(1); Camera.centerOn(this.focusX, this.focusY);
    this.zoomT = 1; this._drag = null; this._lastWheel = 0;
    window.__conurbano = this;
  }
  setDriving(on) { Estado.manejando.store(on ? 1 : 0, 0); if (!on) { const g = Camera.getFollowTarget(); if (g) { this.focusX = g.x; this.focusY = g.y; } } }
  get driving() { return Estado.manejando.load(0) === 1; }
  zoomBy(f) { this.zoomT = Math.max(.25, Math.min(4, this.zoomT * f)); }

  // cámara libre en el hilo principal: arrastrar, pellizcar, rueda, WASD/flechas
  update(dtRatio = 1) {
    // las sombras horneadas (casas, calcos) se desvanecen con el sol
    const si = Math.max(0, Math.min(1, (Sun.intensity || 0) * 1.4 - .2)), Ls = Layer.get('sombrasCasas'), Ld = Layer.get('sombras');
    if (Ls && Math.abs(Ls.alpha - si) > .02) Ls.alpha = si; if (Ld && Math.abs(Ld.alpha - si) > .02) Ld.alpha = si;
    if (Keyboard.isPressed && (Keyboard.isPressed('v'))) this.setDriving(!this.driving);
    if (this.driving) { if (Mouse.count >= 2) this.zoomBy(Mouse.pinchRatio()); if (Mouse.wheel) this.zoomBy(Math.exp(-Mouse.wheel * .0012)); Camera.targetZoom = this.zoomT; return; }
    const z = Camera.zoom || 1;
    if (Mouse.count === 1) { const cx = Mouse.canvasXAt(0), cy = Mouse.canvasYAt(0);
      if (this._drag) { this.focusX -= (cx - this._drag[0]) / z; this.focusY -= (cy - this._drag[1]) / z; } this._drag = [cx, cy]; }
    else this._drag = null;
    if (Mouse.count >= 2) this.zoomBy(Mouse.pinchRatio());
    if (Mouse.wheel) this.zoomBy(Math.exp(-Mouse.wheel * .0012));
    const pan = 12 / z * dtRatio;
    if (Keyboard.a || Keyboard.arrowleft) this.focusX -= pan; if (Keyboard.d || Keyboard.arrowright) this.focusX += pan;
    if (Keyboard.w || Keyboard.arrowup) this.focusY -= pan; if (Keyboard.s || Keyboard.arrowdown) this.focusY += pan;
    this.focusX = Math.max(0, Math.min(META.WW, this.focusX)); this.focusY = Math.max(0, Math.min(META.WH, this.focusY));
    Camera.targetZoom = this.zoomT;
    Camera.follow(this.focusX, this.focusY, .35, dtRatio);
  }
}
