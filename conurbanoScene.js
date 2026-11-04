// ===================== conurbanoScene.js — el barrio del conurbano en WeedJS =====================
// Mundo de WeedJS = píxeles de la proyección oblicua (18 px/m de ancho, 9 px/m de profundidad), igual que littleCity.
// Todo el barrio sale del editor de barrios (editor/): exportás el zip y su carpeta `barrio/` va al lado de este archivo.
//   piso       -> capa worldRect con un shader que pinta calles/veredas/patios en la GPU (shaders/piso.frag)
//   casas      -> entidades estáticas con su sprite horneado + colisionador poligonal + sombra (malla)
//   gente      -> miles de personas LPC (se ajusta sola a lo que aguante el aparato) siguiendo flowfields estáticos con costos (cruzan, no caminan por la calle)
//   autos      -> Box2D (patrón de carScene/littleCity), IA por el flowfield de carriles; V para manejar
// ---------- el barrio exportado por el editor: barrio/ (el inventado) o carabobo/ (el real: Av. Carabobo al 1500 y la villa 1-11-14).
// barrios.js junta los meta de los dos (herramientas/barrios.js) y lo importan todos los hilos. Cuál se juega lo dice ?barrio=… en la
// URL de esta escena (index.html la arma así); en los workers import.meta.url es esa misma URL, así todos los hilos eligen el mismo.
// META.atlas lo pone herramientas/hornear_atlas.js cuando hay atlas pre-horneado en <carpeta>/atlas/ (si no, el juego lo arma al cargar)
import { BARRIOS } from './barrios.js';
// autos: modelos, colores y medidas que hornea herramientas/hornear_autos.js (img/autos/)
import { AUTOS, CHATARRA } from './img/autos/autos.js';
import { APOYO } from './img/autos/apoyo.js';
const DIR = (() => { try { const b = new URL(import.meta.url).searchParams.get('barrio'); return b && BARRIOS[b] ? b : 'barrio'; } catch (e) { return 'barrio'; } })();
const META = BARRIOS[DIR] || BARRIOS[Object.keys(BARRIOS)[0]];
const BARRIO = new URL('./' + DIR + '/', import.meta.url).href;

const { Scene, GameObject, Component, SharedResource, RigidBody, Collider, CollisionListener, SpriteRenderer, MeshRenderer, Transform,
  Camera, Keyboard, Mouse, NavGrid, Layer, LAYER_KIND, BLEND_MODES, SpriteSheetRegistry, LightEmitter, ShadowCaster, Sun, enums, rng, dot2 } = WEED;
// todas las luces del barrio: blanco amarillento de ciudad (~3000 K)
const LUZ = 0xffdcaa;
const { ShapeType } = enums;

const NLPC = 19, NPED = META.peatones, PXM = META.PXM;

// ---------- cuánta gente. ?gente=N la fija; si no, arranca según el aparato y se ajusta sola mirando los fps de los workers
// (los lugares se sortean en las veredas: las celdas con dirección del flowfield "veredas" del barrio)
const Q = new URLSearchParams(typeof globalThis.location?.search === 'string' ? globalThis.location.search : '');
const NAV = globalThis.navigator || {}, HC = NAV.hardwareConcurrency || 4;
const MOVIL = /Android|iPhone|iPad|Mobile/i.test(NAV.userAgent || '') || (NAV.maxTouchPoints > 1 && /Macintosh/.test(NAV.userAgent || ''));
const GENTE_FIJA = Q.has('gente') ? Math.max(100, Math.min(23000, Q.get('gente') | 0)) : 0;
const GENTE_MAX = GENTE_FIJA ? GENTE_FIJA + 50 : (MOVIL ? 14000 : 23000);   // pool (con algo de margen para pruebas)
const GENTE_INICIAL = GENTE_FIJA || (MOVIL ? (HC >= 8 ? 6000 : 3500) : 10000);
// campos que sigue la gente: los destinos del editor + "veredas" (vuelta manzana). Cada tanto cambian de campo.
const PED_FIELDS = Array.from({ length: NPED }, (_, i) => 'peaton' + i).concat(['veredas']), NCAMPOS = PED_FIELDS.length;
// qué tan común es cada modelo (p). rico/pobre: más en zonas ricas o pobres. solo: 'm' sólo circulando, 'e' sólo estacionado.
// min: cuántos circulan como mínimo (los especiales no dependen de la suerte). drive: empuje (los pesados arrancan más lento).
// El patrullero sale del color 'poli' del editor y la chatarra de 'burnt'.
const MODELOS = {
  hatch: { p: 16, pobre: 1 }, sedan: { p: 13 }, pickup: { p: 9 }, utilitario: { p: 6 }, compacto: { p: 6 }, suv: { p: 5, rico: 1 },
  rural: { p: 4, pobre: 1 }, monovolumen: { p: 4 }, micro: { p: 3, pobre: 1 }, taxi: { p: 3 }, jeep: { p: 2 }, coupe: { p: 2 },
  lujo: { p: 2, rico: 1 }, deportivo: { p: 1.5, rico: 1 }, muscle: { p: 1 }, superauto: { p: .5, rico: 1 }, limusina: { p: .5, rico: 1 },
  camion: { p: 3.5, min: 2, drive: 300 }, volcador: { p: 2, min: 2, solo: 'm', drive: 270 }, colectivo: { p: 2.5, min: 4, solo: 'm', drive: 270 },
  ambulancia: { p: 1, min: 2, solo: 'm' }, casarodante: { p: 1, solo: 'e' },
};
// colores del editor -> colores de las hojas (si el modelo tiene ese color, se usa; si no, uno de los suyos)
const COLOR_EDITOR = { red: 'rojo', white: 'blanco', black: 'negro', blue: 'azul', yellow: 'amarillo' };
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
    minSteerFactor: Float32Array, maxSteerSpeed: Float32Array, lastKey: Int16Array,
    hl: Float32Array, hw: Float32Array,   // medio largo y medio ancho del colisionador (px): la IA y la gente miran el tamaño de cada vehículo
    ha: Float32Array, hb: Float32Array,   // medio largo y medio ancho de la huella en el piso, en px del dibujo (18 px/m, piso aplastado a AUTO_S)
    faro: Int32Array,                     // la entidad Faro que lleva adelante (-1: sin luces)
    // estado de la IA: en componentes (no en campos del objeto), porque una entidad puede pasar de un worker de lógica a otro
    sx: Float32Array, sy: Float32Array, sr: Float32Array, lx: Float32Array, ly: Float32Array, stuck: Float32Array, libre: Float32Array, parado: Float32Array };
}

// ---------- casas, tapiales y postes (sprites horneados con R3)
// La entidad sólo lleva el colisionador y la luz de la ventana. El dibujo va en franjas verticales (Decoration), cada una
// con su y de orden en la base de la pared de esa columna: así el ySort sabe qué tapa a qué aunque la casa esté girada.
export class Casa extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, LightEmitter];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    if (c.col) {
      const p = c.col; let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
      const pts = area >= 0 ? p : p.slice().reverse(), flat = [];
      for (const q of pts) flat.push(q[0], q[1]);
      if (!this.collider.makePolygon(flat)) { this.collider.shapeType = ShapeType.Circle; this.collider.radius = 6; }
    } else { this.collider.shapeType = ShapeType.Circle; this.collider.radius = c.r || 3; }
    this.collider.visualRange = 260;
    // las piezas del dibujo cuelgan de la casa (WeedJS ≥ ff32c939): cada franja vertical del sprite se ordena en la base de su
    // pared (sortOffsetY = base de la franja − y de la casa) y cada pieza se recorta por su propio centro
    if (c.fr) { const e = c.e || 1;
      for (let k = 0; k < c.fr.length; k++) { const [fx, fy, p] = c.fr[k];
        for (let j = 0; j < p.length; j++) this.addDecoration(c.t + k + '_' + j, fx + p[j][0], fy + p[j][1], e, e, j, { anchorX: .5, anchorY: .5, sortOffsetY: fy }); } }
    // las casas no alumbran; los postes de madera con lámpara (calles de tierra y villas) sí
    const L = this.lightEmitter, on = c.k === 'poste' && !!c.l;
    L.lightColor = LUZ; L.height = 0; L.glowHeightOffset = 7 * META.CZ * META.SF; L.hasGlowSprite = on ? .5 : 0;
    L.lightIntensity = on ? 1500 : 0; L.active = on ? 1 : 0; this.collider.visualRange = on ? 260 : this.collider.visualRange;
  }
}
// una franja vertical de una casa: la entidad está en la base de la pared (de ahí sale su y de orden) y lleva colgadas las
// piezas de 64 px como decoraciones, que se ordenan con la y del padre pero se recortan cada una por su propio centro
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
// dónde están las lámparas de cada farol, como fracción del cuadro exportado (medidas a ojo; de atrás quedan en el mismo lugar)
const LAMPARAS = { u_farola: [[.65, .09]], u_farola_orn: [[.5, .2]], u_farol_doble: [[.17, .27], [.77, .18]] };
// árboles, faroles, semáforos, contenedores… (lo que frena un auto); lo demás va como Decoration
export class Prop extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster, LightEmitter];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    this.setSprite('props', c.f, 0);
    const an = META.anclas[c.f]; this.spriteRenderer.anchorX = an[0]; this.spriteRenderer.anchorY = an[1];
    const e = (META.escalas && META.escalas[c.f]) || 1;      // props HD: dibujados a 30 px/m, se muestran a 0.6
    this.setScale(c.fl ? -e : e, e);
    this.collider.shapeType = ShapeType.Circle; this.collider.radius = Math.max(1.5, c.r);
    this.collider.visualRange = 200;
    this.shadowCaster.heightMultiplier = .8;
    const L = this.lightEmitter, top = this.spriteRenderer.originalHeight * an[1] * e;
    const f = c.f.endsWith('_atras') ? c.f.slice(0, -6) : c.f;   // vista de atrás: el mismo objeto
    if (f.startsWith('u_farol')) {            // farol: charco de luz en la vereda + brillo en la lámpara
      L.lightColor = LUZ; L.height = 0; L.glowHeightOffset = top * (f === 'u_farola' ? .97 : .88);
      L.lightIntensity = f === 'u_farol_doble' ? 2600 : f === 'u_farola' ? 2200 : 1800; L.hasGlowSprite = .55; L.active = 1;
      this.collider.visualRange = 260;        // alcance para las sombras que proyecta su luz
      // brillo en cada lámpara, en la capa 'noche' (aditiva, se prende al bajar el sol): un centro chico y un halo
      const ls = LAMPARAS[f] || null, sw = this.spriteRenderer.originalWidth * e, sh = this.spriteRenderer.originalHeight * e;
      if (ls) for (const [fx, fy] of ls) { const dx = (fx - an[0]) * sw * (c.fl ? -1 : 1), dy = (fy - an[1]) * sh;
        this.addDecoration('_lightGradient', dx, dy, .26, .26, 1, { tint: 0xfff2d0, alpha: 1, anchorX: .5, anchorY: .5, layer: 'noche' });
        this.addDecoration('_lightGradient', dx, dy, .8, .8, 1, { tint: LUZ, alpha: .5, anchorX: .5, anchorY: .5, layer: 'noche' }); }
    } else {
      L.lightIntensity = 0; L.active = 0;
      // semáforo: sin luz al piso, sólo un punto de color en la lámpara (el gradiente de WeedJS, en una capa aditiva);
      // de atrás (u_semaforo_atras) no se ven las luces
      if (c.f === 'u_semaforo') { const rojo = rng() < .5; this.addDecoration('_lightGradient', 0, -top * (rojo ? .87 : .7), .35, .35, 0, { tint: rojo ? 0xff3b30 : 0x36d96b, alpha: .85, anchorX: .5, anchorY: .5, layer: 'brillos' }); }
    }
  }
}

// árbol del editor: el tronco es el sprite; cada rama (con sus hojas) es una decoración colgada, anclada en su base, que se mece.
// El orden dentro del árbol viene en las piezas (las ramas de atrás antes que el tronco).
const ARB_ESCALA = .6;
export class Arbol extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    const T = c.tipo, fl = c.fl ? -1 : 1, E = T.escala || ARB_ESCALA;   // el tipo viaja en la config: la escena lo lee en el hilo principal
    this.collider.shapeType = ShapeType.Circle; this.collider.radius = Math.max(2, c.r || 3); this.collider.visualRange = 200;
    for (const p of T.piezas) {
      if (p[5] === 0) { this.setSprite('arboles', p[0], 0); this.spriteRenderer.anchorX = fl > 0 ? p[3] : 1 - p[3]; this.spriteRenderer.anchorY = p[4]; this.setScale(E * fl, E); continue; }
      this.addDecoration('arboles_' + p[0], p[1] * fl, p[2], E * fl, E, p[5], { anchorX: p[3], anchorY: p[4], sway: !!p[6], swayAmplitude: .022 + rng() * .02, swayFrequency: .45 + rng() * .4 });
    }
  }
}
// ---------- gente
const _v = { x: 0, y: 0 }, _w = { x: 0, y: 0 };
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
    this.collider.radius = 4.5; this.collider.visualRange = 52;
    const p = this.personaComp;
    p.campo = (rng() * NCAMPOS) | 0; p.quieta = c.quieta ? 1 : 0; p.estado = 0; p.timer = rng() * 4; p.vel = 17 + rng() * 9; p.cara = 2;
    this.shadowCaster.heightMultiplier = 1.2;
    this._anim = -1;
  }
  tick(dtRatio, dt) {
    const i = this.index, P = PersonaComp, dts = (dt || 33) / 1000;
    let vx = RigidBody.vx[i], vy = RigidBody.vy[i];
    if (!P.quieta[i]) {
      P.timer[i] -= dts;
      if (P.estado[i] === 0) { if (P.timer[i] <= 0) { P.estado[i] = 1; P.timer[i] = 15 + rng() * 45; } }
      else {
        NavGrid.requestVectorFromStaticFlowfield(PED_FIELDS[P.campo[i]], this.x, this.y, _v);
        if ((_v.x === 0 && _v.y === 0) || P.timer[i] <= 0) {        // llegó, no hay camino o se cansó: pausa y otro campo
          P.estado[i] = 0; P.timer[i] = 1 + rng() * 7; P.campo[i] = (rng() * NCAMPOS) | 0;
        } else {
          // ¿lo que tengo adelante es calle? Entonces mirar si vienen autos: si viene uno, esperar en el cordón
          let espera = false;
          NavGrid.requestVectorFromStaticFlowfield('calles', this.x + _v.x * 22, this.y + _v.y * 14, _w);
          if (_w.x !== 0 || _w.y !== 0) for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (!AutoComp.active[j] || !Transform.active[j]) continue;
            const cvx = RigidBody.vx[j], cvy = RigidBody.vy[j], cs2 = cvx * cvx + cvy * cvy; if (cs2 < 400) continue;
            const dx = this.x - Transform.x[j], dy = this.y - Transform.y[j], d2 = dx * dx + dy * dy; if (d2 > 26000) continue;
            const encima = AutoComp.hl[j] + 2; if (dx * cvx + dy * cvy > 0 || d2 < encima * encima) { espera = true; break; } }     // se acerca, o está encima
          const sp = espera ? 0 : P.vel[i];
          this.addAcceleration((_v.x * sp - vx) * 6, (_v.y * sp - vy) * 6);
        }
      }
      // separación y esquivar autos (vecinos de la grilla espacial)
      let sx = 0, sy = 0; const mx = this.x, my = this.y;
      for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (!Transform.active[j]) continue;
        const dx = mx - Transform.x[j], dy = my - Transform.y[j], d2 = dx * dx + dy * dy;
        if (AutoComp.active[j]) { const ra = AutoComp.hl[j] + 22, r2 = ra * ra; if (d2 < r2 && d2 > 1) { const f = (r2 - d2) / r2; sx += dx / Math.sqrt(d2) * f * 3; sy += dy / Math.sqrt(d2) * f * 3; } continue; }
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

// ---------- autos (Box2D, patrón de carScene; el cuadro del sprite sale del rumbo de pantalla)
const _h = { frontX: 0, frontY: 0, rightX: 0, rightY: 0 };
const _vista = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
const _keys = new Map(), _keys0 = [];
function angleKeys(sheet) {
  let k = _keys.get(sheet); if (k) return k;
  const names = SpriteSheetRegistry.getAnimationNames(sheet) || [], base = names.map(n => ({ n, a: parseFloat(n), f: 0 })).filter(o => !isNaN(o.a));
  // las hojas sólo traen los rumbos que miran a la derecha: los que faltan son esos mismos espejados (rumbo 180° - a)
  const hay = new Set(base.map(o => (o.a % 360 + 360) % 360)), todos = base.slice();
  for (const o of base) { const m = ((180 - o.a) % 360 + 360) % 360; if (!hay.has(m)) { hay.add(m); todos.push({ n: o.n, a: m, f: 1 }); } }
  k = todos.map(o => ({ n: o.n, c: Math.cos(o.a * Math.PI / 180), s: Math.sin(o.a * Math.PI / 180), f: o.f }));
  _keys.set(sheet, k); return k;
}
// Los autos del paquete están dibujados con el piso aplastado a 0,7 (hornear_autos.js: S), no a SYN como el barrio. Su huella
// en el piso (un rectángulo de 2a × 2b px girado θ) se ve en pantalla como un paralelogramo a lo largo del rumbo de pantalla φ,
// con tan θ = tan φ / S: largo 2a·√(cos²θ + S²·sen²θ), y el mismo área (4ab·S). El colisionador es un rectángulo con ese largo
// y ese área: se rehace cuando el auto cambia de cuadro (cada 7,5°), y la masa (= área) no cambia.
const AUTO_S = .7;
function huellaAuto(A, i, c, s, out) {   // A: la clase AutoComp (sus arreglos), i: el índice
  const th = Math.atan2(Math.abs(s) / AUTO_S, Math.abs(c)), ct = Math.cos(th), st = Math.sin(th);
  const a = A.ha[i], b = A.hb[i], L = 2 * a * Math.sqrt(ct * ct + AUTO_S * AUTO_S * st * st);
  out[0] = L; out[1] = 4 * a * b * AUTO_S / L; return out;
}
const _huella = [0, 0];
// el ancla de cada cuadro (herramientas/apoyo_autos.py): los cuadros terminan en la rueda más baja, así el auto se ordena
// donde toca el piso y no tapa a los árboles y a la gente que tiene adelante
const _apoyo = new Map();
function apoyoDe(sheet) { let t = _apoyo.get(sheet); if (t === undefined) { t = APOYO[sheet.slice(5)] || null; _apoyo.set(sheet, t); } return t; }
// la luz de los faros: el LightEmitter alumbra desde el punto de su entidad, así que va en una entidad aparte que el auto
// lleva delante (Auto.tick); los dos brillos de los faros van pegados al auto, en la capa 'noche'
const LUZ_FARO = 0xfff0d0;
export class Faro extends GameObject {
  static components = [LightEmitter];
  onSpawned(c = {}) { const L = this.lightEmitter; L.lightColor = LUZ_FARO; L.height = 0; L.hasGlowSprite = 0; L.lightIntensity = c.i || 700; L.active = 1; }
}
export class Auto extends GameObject {
  static deriveSpeed = true;
  static components = [RigidBody, Collider, CollisionListener, SpriteRenderer, ShadowCaster, LightEmitter, AutoComp];
  onSpawned(c = {}) {
    // cada cuadro de las hojas está centrado en el punto donde el vehículo apoya en el piso
    this.setSpritesheet('auto_' + (c.hoja || 'hatch_rojo')); this.setAnimation('0');
    this.spriteRenderer.anchorX = .5; this.spriteRenderer.anchorY = .5;
    this.spriteRenderer.inheritTransformRotation = 0; this.spriteRenderer.spriteRotation = 0;
    const A = this.autoComp;
    A.driveForce = c.drive ?? 340; A.lateralFriction = 8; A.turnTorque = 10; A.minSteerSpeed = 8; A.minSteerFactor = .5; A.maxSteerSpeed = 140; A.lastKey = -1;
    A.ha = (c.largo || 4.4) * 9; A.hb = (c.ancho || 1.8) * 9;
    const rot = c.rot || 0, [largo, ancho] = huellaAuto(AutoComp, this.index, Math.cos(rot), Math.sin(rot), _huella); A.hl = largo / 2; A.hw = ancho / 2;
    this.collider.shapeType = ShapeType.Box; this.collider.width = largo; this.collider.height = ancho; this.collider.radius = 0;
    this.collider.friction = .3; this.collider.visualRange = 160;
    this.rigidBody.static = c.fijo ? 1 : 0; this.rigidBody.linearDamping = 1; this.rigidBody.angularDamping = 3;
    this.setFixedRotation(0);
    this.rotation = c.rot || 0;
    A.active = 1;
    this.shadowCaster.heightMultiplier = .55;
    const L = this.lightEmitter; L.lightIntensity = 0; L.active = 0;
    A.faro = -1;
    if (c.faros) {   // los dos brillos son las decoraciones 0 y 1 del auto (_frame las pone en los faros)
      const f = Faro.spawn({ x: c.x, y: c.y }); A.faro = f ? f.index : -1;
      for (let k = 0; k < 2; k++) this.addDecoration('_lightGradient', 0, 0, .18, .18, 1, { tint: LUZ_FARO, alpha: .9, anchorX: .5, anchorY: .5, offsetY: -8, layer: 'noche' });
    }
    this._frame();
  }
  onDespawned() { const A = this.autoComp; A.active = 0; if (A.faro >= 0) { GameObject.despawn(A.faro); A.faro = -1; } }
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
  // los 48 rumbos están dibujados en ángulos de pantalla (como en carScene): el rumbo de pantalla va directo,
  // y no cambia de cuadro hasta pasar la mitad del paso (sin titileo). Los que miran a la izquierda son espejos (flipX).
  _frame() {
    const i = this.index, c = Transform.rotC ? Transform.rotC[i] : 1, s = Transform.rotS ? Transform.rotS[i] : 0;
    const sid = SpriteRenderer.spritesheetId[i], ks = sid ? angleKeys(SpriteSheetRegistry.getSpritesheetName(sid)) : _keys0; if (!ks.length) return;
    const last = AutoComp.lastKey[i]; if (last >= 0 && c * ks[last].c + s * ks[last].s >= Math.cos(Math.PI / ks.length)) return;
    let best = 0, bd = -2; for (let k = 0; k < ks.length; k++) { const d = c * ks[k].c + s * ks[k].s; if (d > bd) { bd = d; best = k; } }
    if (last !== best) { AutoComp.lastKey[i] = best; const k = ks[best]; this.setAnimation(k.n); this.flipX = k.f === 1;
      const ap = apoyoDe(SpriteSheetRegistry.getSpritesheetName(sid) || ''); this.spriteRenderer.anchorY = (ap && ap[k.n]) || .5;
      // el colisionador, a la medida de la huella con este rumbo; los brillos de los faros, en el frente de la huella
      const [L, W] = huellaAuto(AutoComp, i, k.c, k.s, _huella);
      if (Math.abs(L * .5 - AutoComp.hl[i]) > .5 || Math.abs(W * .5 - AutoComp.hw[i]) > .5) { this.collider.width = L; this.collider.height = W; AutoComp.hl[i] = L * .5; AutoComp.hw[i] = W * .5; }
      if (AutoComp.faro[i] >= 0 && this.getAttachedDecorationCount() >= 2) for (let q = 0; q < 2; q++) { const d = this.getAttachedDecoration(q); if (d) { d.localX = L * .5 - 2; d.localY = (q ? .3 : -.3) * W; } } }
  }
  tick() { const i = this.index; if (!Transform.active[i]) return; this._friction(); this._frame();
    const f = AutoComp.faro[i];   // la luz de los faros, delante del auto
    if (f >= 0) { GameObject.getHeadingAxes(i, _h); const d = AutoComp.hl[i] + 18; Transform.x[f] = Transform.x[i] + _h.frontX * d; Transform.y[f] = Transform.y[i] + _h.frontY * d; } }
}
export class AutoEstacionado extends Auto {}
export class Chatarra extends Auto {}

// IA: sigue el flowfield de carriles (mano derecha), frena por gente y autos adelante (patrón de littleCity)
const _probe = [[0, 0], [0, 8], [0, -8], [16, 0], [-16, 0], [0, 16], [0, -16], [24, 0], [-24, 0], [24, 12], [24, -12], [-24, 12], [-24, -12], [0, 24], [0, -24], [48, 0], [-48, 0], [36, 24], [-36, 24], [36, -24], [-36, -24]];
export class AutoIA extends Auto {
  onSpawned(c = {}) { super.onSpawned(c); const A = this.autoComp, rot = c.rot || 0;
    A.lx = Math.cos(rot); A.ly = Math.sin(rot); A.stuck = 0; A.libre = 0; A.parado = 0; A.sx = c.x; A.sy = c.y; A.sr = rot; }
  // el carril bajo el auto; si el auto se salió (cortó una esquina, se subió a la vereda), el carril más cercano de alrededor
  // y un empujón hacia él, así vuelve a la calle en vez de seguir paralelo por la vereda
  _sample(x, y) { for (let k = 0; k < _probe.length; k++) { NavGrid.requestVectorFromStaticFlowfield('calles', x + _probe[k][0], y + _probe[k][1], _v);
      if (_v.x * _v.x + _v.y * _v.y >= .01) { if (k) { const ox = _probe[k][0], oy = _probe[k][1], l = Math.hypot(ox, oy), m = Math.hypot(_v.x, _v.y); _v.x = _v.x / m + ox / l * 1.3; _v.y = _v.y / m + oy / l * 1.3; } return true; } } return false; }
  tick(dtRatio, dt) {
    super.tick();
    const i = this.index;
    const dts = (dt || 16) / 1000;
    if (this.x < 0 || this.y < 0 || this.x > META.WW || this.y > META.WH) { _v.x = META.WW / 2 - this.x; _v.y = META.WH / 2 - this.y; }   // se fue del mapa: volver
    else if (this._sample(this.x, this.y)) { AutoComp.lx[i] = _v.x; AutoComp.ly[i] = _v.y; } else { _v.x = AutoComp.lx[i]; _v.y = AutoComp.ly[i]; }
    const l2 = _v.x * _v.x + _v.y * _v.y; if (l2 < .01) return;
    const inv = 1 / Math.sqrt(l2), nx = _v.x * inv, ny = _v.y * inv, fx = this.forwardX, fy = this.forwardY;
    const cross = fx * ny - fy * nx, align = fx * nx + fy * ny;
    let turn = Math.max(-1, Math.min(1, cross * 2)) * .8, fwd = align > .15 ? .5 : RigidBody.speed[i] < 30 ? .25 : 0;   // desalineado: sólo avanza despacito para poder girar
    // ¿alguien adelante en el carril?
    // trabado más de 5 s (dos autos que se frenan mutuamente en un cruce): 3 s sin mirar a los demás
    const A = AutoComp;
    if (RigidBody.speed[i] < 10) { A.stuck[i] += dts; A.parado[i] += dts;
      if (A.stuck[i] > 5) { A.stuck[i] = 0; A.libre[i] = 3; } } else { A.stuck[i] = 0; A.parado[i] = 0; }
    // parado más de 12 s (se metió en un lote, quedó contra un poste): fuera de cámara, vuelve a su carril de salida
    if (A.parado[i] > 12 && !this.isOnScreen) { A.parado[i] = 0; this.x = A.sx[i]; this.y = A.sy[i]; this.rotation = A.sr[i];
      RigidBody.vx[i] = 0; RigidBody.vy[i] = 0; A.lx[i] = Math.cos(A.sr[i]); A.ly[i] = Math.sin(A.sr[i]); return; }
    if (A.libre[i] > 0) A.libre[i] -= dts;
    let brake = 0, steer = 0;
    if (A.libre[i] <= 0) for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (!Transform.active[j] || j === i) continue;
      const isCar = AutoComp.active[j] === 1, isPerson = !isCar && PersonaComp.vel[j] > 0; if (!isCar && !isPerson) continue;
      // alcance y ancho del carril según el tamaño de los dos (con dos autos chicos, ~95 y ~22 px)
      const dx = Transform.x[j] + RigidBody.vx[j] * .2 - this.x, dy = Transform.y[j] + RigidBody.vy[j] * .2 - this.y, ahead = dx * fx + dy * fy, reach = isCar ? A.hl[i] + A.hl[j] + 35 : A.hl[i] + 40;
      if (ahead <= 8 || ahead > reach) continue; const side = fx * dy - fy * dx, as = Math.abs(side), corr = isCar ? A.hw[i] + A.hw[j] - 2 : A.hw[i] + 4; if (as > corr) continue;
      const u = (1 - ahead / reach) * (.4 + .6 * (1 - as / corr)); if (u > brake) brake = u; if (isCar) steer += (side >= 0 ? -1 : 1) * u; }   // a la gente se la espera, no se la esquiva (si no, el auto se sube a la vereda)
    if (brake > 0) { turn = Math.max(-1, Math.min(1, turn * (1 - brake * .6) + Math.max(-1, Math.min(1, steer)) * .8)); fwd *= 1 - brake;
      if (brake > .6) { const k = 1 - (brake - .6) * .25; RigidBody.vx[i] *= k; RigidBody.vy[i] *= k; } }   // frena, no da marcha atrás
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

// ---------- qué vehículo es cada auto del barrio. El editor da lugar, rumbo, si circula y un color ('poli' = patrullero, 'burnt' = chatarra).
// El modelo sale por peso y por la riqueza de la zona. Uno más largo que el lugar del editor (4,6 × 1,8 m) queda sólo si su caja
// no pisa a otro auto o a un prop con colisionador que la caja del editor no pisaba (en px de mundo, como los colisionadores de Box2D).
function riqueza(x, y) {
  const wy = META.MH - y / (META.SF * META.SYN), wx = x / META.SF - META.K * wy;
  return PisoData.wealth[Math.max(0, Math.min(META.HG - 1, (wy / 10) | 0)) * META.WG + Math.max(0, Math.min(META.WG - 1, (wx / 10) | 0))] / 255;
}
// dos cajas orientadas { x, y, c, s (cos/sin del rumbo), hl, hw }: ¿se pisan? (ejes separadores)
function sePisan(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [nx, ny] of [[a.c, a.s], [-a.s, a.c], [b.c, b.s], [-b.s, b.c]]) {
    const ra = a.hl * Math.abs(nx * a.c + ny * a.s) + a.hw * Math.abs(ny * a.c - nx * a.s), rb = b.hl * Math.abs(nx * b.c + ny * b.s) + b.hw * Math.abs(ny * b.c - nx * b.s);
    if (Math.abs(dx * nx + dy * ny) >= ra + rb) return false;
  }
  return true;
}
function elegirModelos(autos, props) {
  const PX = META.PXM, M = .3 * PX, CELDA = 160, grilla = new Map(), cajas = [], LUGAR = { hl: 2.3 * PX + M, hw: .9 * PX + M / 2 };
  const agregar = (b) => { const k = Math.floor(b.x / CELDA) * 4096 + Math.floor(b.y / CELDA); let l = grilla.get(k); if (!l) grilla.set(k, l = []); l.push(cajas.length); cajas.push(b); };
  for (const c of autos) agregar({ x: c.x, y: c.y, c: Math.cos(c.rot || 0), s: Math.sin(c.rot || 0), hl: 2.3 * PX, hw: .9 * PX });
  for (const p of props) if (p.r > 0) agregar({ x: p.x, y: p.y, c: 1, s: 0, hl: p.r, hw: p.r });
  const entra = (i, hl, hw) => {
    const a = cajas[i], b = { x: a.x, y: a.y, c: a.c, s: a.s, hl: hl + M, hw: hw + M / 2 }, l = { x: a.x, y: a.y, c: a.c, s: a.s, hl: LUGAR.hl, hw: LUGAR.hw };
    if (b.hl <= l.hl && b.hw <= l.hw) return true;
    const cx = Math.floor(a.x / CELDA), cy = Math.floor(a.y / CELDA);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++)
      for (const j of grilla.get(gx * 4096 + gy) || []) if (j !== i && sePisan(b, cajas[j]) && !sePisan(l, cajas[j])) return false;
    return true;
  };
  const hoja = (m, c) => { const cs = AUTOS[m].colores; if (!cs) return m; const ce = COLOR_EDITOR[c]; return m + '_' + (cs.includes(ce) ? ce : cs[(rng() * cs.length) | 0]); };
  const chatarras = Object.keys(CHATARRA), elegido = [];
  // primero los mínimos: autos circulando al azar donde el modelo entre
  const libres = []; autos.forEach((c, i) => { if (c.m && c.c !== 'burnt' && c.c !== 'poli') libres.push(i); });
  for (let k = libres.length - 1; k > 0; k--) { const j = (rng() * (k + 1)) | 0, t = libres[k]; libres[k] = libres[j]; libres[j] = t; }
  for (const [m, o] of Object.entries(MODELOS)) for (let k = 0, n = 0; k < libres.length && n < (o.min || 0); k++) {
    const i = libres[k], d = AUTOS[m]; if (elegido[i] || !entra(i, d.largo * PX / 2, d.ancho * PX / 2)) continue;
    elegido[i] = m; cajas[i].hl = d.largo * PX / 2; cajas[i].hw = d.ancho * PX / 2; n++;
  }
  return autos.map((c, i) => {
    if (c.c === 'burnt') { const h = chatarras[(rng() * chatarras.length) | 0], d = CHATARRA[h]; return { hoja: h, largo: d.largo, ancho: Math.min(d.ancho, 1.9) }; }
    let m = c.c === 'poli' ? 'policia' : elegido[i] || null;
    if (!m) {
      const rq = riqueza(c.x, c.y), cand = Object.keys(MODELOS).filter(k => !MODELOS[k].solo || MODELOS[k].solo === (c.m ? 'm' : 'e'));
      const peso = cand.map(k => { const o = MODELOS[k]; return o.p * (o.rico ? .2 + 2.5 * rq : o.pobre ? 1.5 - rq : 1); });
      while (cand.length && !m) {
        let t = rng() * peso.reduce((a, b) => a + b, 0), k = 0; while (k < cand.length - 1 && (t -= peso[k]) > 0) k++;
        const d = AUTOS[cand[k]]; if (entra(i, d.largo * PX / 2, d.ancho * PX / 2)) m = cand[k]; else { cand.splice(k, 1); peso.splice(k, 1); }
      }
      m = m || 'hatch';
    }
    const d = AUTOS[m]; cajas[i].hl = d.largo * PX / 2; cajas[i].hw = d.ancho * PX / 2;
    return { hoja: hoja(m, c.c), largo: d.largo, ancho: d.ancho, drive: MODELOS[m]?.drive };
  });
}

// ---------- escena
const SHEETS = {};
for (let i = 0; i < META.hojasCasas; i++) SHEETS['casas' + i] = { json: BARRIO + 'img/casas' + i + '.json', png: BARRIO + 'img/casas' + i + '.png' };
SHEETS.props = { json: BARRIO + 'img/props.json', png: BARRIO + 'img/props.png' };
SHEETS.arboles = { json: BARRIO + 'img/arboles.json', png: BARRIO + 'img/arboles.png' };
for (let i = 0; i < NLPC; i++) SHEETS['lpc' + i] = { json: 'img/lpc/civil1.json', png: 'img/lpc/c' + i + '.png', excludeAnimations: LPC_EXCLUDE };
for (const [m, a] of Object.entries(AUTOS)) for (const c of a.colores || ['']) { const h = c ? m + '_' + c : m; SHEETS['auto_' + h] = { json: 'img/autos/' + h + '.json', png: 'img/autos/' + h + '.png' }; }
for (const h in CHATARRA) SHEETS['auto_' + h] = { json: 'img/autos/' + h + '.json', png: 'img/autos/' + h + '.png' };
const FLOW = { calles: BARRIO + 'ff_calles.json' }; PED_FIELDS.forEach(n => FLOW[n] = BARRIO + 'ff_' + n + '.json');
const f32 = (v) => ({ value: v, type: 'f32' });
const PACK = typeof globalThis.location?.search === 'string' && new URLSearchParams(globalThis.location.search).has('empaquetar');

export class ConurbanoScene extends Scene {
  static config = {
    worldWidth: META.WW, worldHeight: META.WH, seed: 7,
    // atlas de hasta 8192×4096 (128 MB de video): casas con más detalle + personajes + autos
    assets: { maxAtlasWidth: 8192, maxAtlasHeight: 4096 },
    spatial: { cellSize: 64, maxNeighbors: 48, maxEntitiesPerCell: 192, numberOfSpatialWorkers: HC >= 6 ? 2 : 1 },
    logic: { numberOfLogicWorkers: HC >= 8 ? 3 : 2, staggeredUpdates: true },
    physics: { gravity: { x: 0, y: 0 }, sleeping: true, subStepCount: 0, commandRingCapacity: 65536, numberOfPhysicsWorkers: HC >= 8 ? 4 : 2 },
    particle: { maxParticles: 500, decals: false },
    // piezas de casas y árboles, props (y sus sombras), cables y líneas de canchas
    decoration: { maxDecorations: META.nPiezas + META.nPiezasArboles + 2 * META.nProps + META.nArboles + META.nCables + (META.nLineas || 0) + 2500, maxAttachedDecorationsPerEntity: 255 },
    renderer: { backend: 'webgl', ySort: true, maxMeshVerts: 12000, maxMeshIndices: 0 },
    // las casas son decoraciones: que no se desvanezcan al alejar
    preRender: { startFadingDecorationsAtZoom: .2, hideDecorationsAtZoom: .1, cullingRatio: .3 },
    lighting: {
      enabled: true, lightGlow: 'add', baseAmbient: .1, maxLights: 1024,
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
          { name: 'segs', format: 'rgba8unorm', size: { width: 12, height: META.NS } }, { name: 'pits', format: 'rgba8unorm', size: { width: META.PW || 1, height: META.PH || 1 } }],
        uniforms: { uMW: f32(META.MW), uMH: f32(META.MH), uK: f32(META.K), uSF: f32(META.SF), uSYN: f32(META.SYN), uGC: f32(META.GC), uCW: f32(META.CW), uCH: f32(META.CH), uWG: f32(META.WG), uHG: f32(META.HG), uPW: f32(META.PW || 1), uPH: f32(META.PH || 1) } } },
      // manchas, roturas y basura del piso (gd_*): arriba del piso, debajo de las sombras
      manchas: { zIndex: 1.4, ySorting: false, maxItems: Math.max(6000, META.nProps + (META.nLineas || 0)) },
      sombrasCasas: { kind: LAYER_KIND.MESH, zIndex: 1.5 },
      sombras: { zIndex: 1.6, ySorting: false, maxItems: Math.max(3000, META.nProps + META.nArboles) },
      cables: { zIndex: 3.5, ySorting: false, maxItems: Math.max(4000, META.nCables + 500) },
      // aditivas de verdad (WeedJS compone las capas de sprites con shader.containerBlend, no con blendMode)
      brillos: { zIndex: 5.5, blendMode: BLEND_MODES.ADD, shader: { containerBlend: BLEND_MODES.ADD }, ySorting: false, maxItems: 1000 },
      // brillos de faroles y faros: se prenden al bajar el sol (update)
      noche: { zIndex: 5.6, blendMode: BLEND_MODES.ADD, shader: { containerBlend: BLEND_MODES.ADD }, ySorting: false, maxItems: 2000 },
    },
  };
  // atlas pre-horneado (herramientas/hornear_atlas.js): el celu no tiene que decodificar y empaquetar ~60 imágenes al arrancar
  // (con ?empaquetar en la URL se arma en el navegador, para volver a hornearlo después de cambiar los sprites)
  static assets = { ...(PACK || !META.atlas ? {} : { bigAtlas: { json: BARRIO + 'atlas/bigAtlas.json', png: BARRIO + 'atlas/bigAtlas.png' } }), spritesheets: SHEETS, flowfields: FLOW };
  static sharedResources = [
    [PisoData, { cellA: { type: Uint8Array, length: META.CW * META.CH * 4 }, cellB: { type: Uint8Array, length: META.CW * META.CH * 4 },
      wealth: { type: Uint8Array, length: META.WG * META.HG }, noise: { type: Uint8Array, length: 256 * 256 * 4 }, segs: { type: Uint8Array, length: META.NS * 48 }, pits: { type: Uint8Array, length: (META.PW || 1) * (META.PH || 1) * 4 } }],
    [Estado, { manejando: { type: Int32Array, length: 1, mailbox: true } }],
  ];
  static entities = [[Casa, META.nCasas + 8], [SombraCasa, META.nCasas + 8], [Arbol, META.nArboles + 8], [Prop, META.nProps + 64], [Persona, GENTE_MAX], [AutoIA, Math.max(8, META.nAutos)], [AutoEstacionado, Math.max(8, META.nAutos)], [Chatarra, 64], [AutoJugador, 1], [Faro, Math.max(8, META.nAutos) + 1]];

  async preload() {
    // ---- piso: datos horneados -> memoria compartida -> texturas del shader
    const bin = await (await fetch(BARRIO + 'piso.bin')).arrayBuffer(), u8 = new Uint8Array(bin), parts = META.pisoPartes;
    PisoData.cellA.set(u8.subarray(parts.cellA[0], parts.cellA[0] + parts.cellA[1]));
    PisoData.cellB.set(u8.subarray(parts.cellB[0], parts.cellB[0] + parts.cellB[1]));
    PisoData.wealth.set(u8.subarray(parts.wealth[0], parts.wealth[0] + parts.wealth[1]));
    PisoData.noise.set(u8.subarray(parts.noise[0], parts.noise[0] + parts.noise[1]));
    PisoData.segs.set(u8.subarray(parts.segs[0], parts.segs[0] + parts.segs[1]));
    if (parts.pits) PisoData.pits.set(u8.subarray(parts.pits[0], parts.pits[0] + parts.pits[1]));
    const L = Layer.get('piso');
    L.updateTexture('cellA', PisoData.cellA); L.updateTexture('cellB', PisoData.cellB); L.updateTexture('wealth', PisoData.wealth);
    L.updateTexture('noiseT', PisoData.noise); L.updateTexture('segs', PisoData.segs); if (parts.pits) L.updateTexture('pits', PisoData.pits);
    // ---- objetos
    const w = await (await fetch(BARRIO + 'mundo.json')).json();
    const { Decoration } = WEED;
    for (const h of w.casas) { Casa.spawn({ x: h.x, y: h.y, col: h.col, r: h.r, k: h.k, l: h.l, fr: w.franjas[h.a], t: 'casas' + h.o + '_' + h.a + '_', e: META.escalaCasas || 1 });
      if (h.sh) SombraCasa.spawn({ x: h.x, y: h.y, sh: h.sh }); }
    for (const p of w.props) {
      if (p.sh && !(p.r > 0)) { const a = META.anclas[p.sh]; Decoration.spawn({ x: p.x, y: p.y, texture: 'props_' + p.sh, anchorX: a[0], anchorY: a[1], alpha: .45, layer: 'sombras' }); }
      if (p.r > 0) Prop.spawn({ x: p.x, y: p.y, f: p.f, r: p.r, fl: p.fl });
      else { const a = META.anclas[p.f], e = (META.escalas && META.escalas[p.f]) || 1, mece = p.f.startsWith('plm_') || p.f.startsWith('yy_');   // plantas que se mecen (skew: la base queda fija)
        Decoration.spawn({ x: p.x, y: p.y, texture: 'props_' + p.f, anchorX: a[0], anchorY: a[1], scaleX: p.fl ? -e : e, scaleY: e,
          ...(mece ? { swaySkew: 1, swayAmplitude: .05 + rng() * .05, swayFrequency: .5 + rng() * .6 } : {}),
          ...(p.f.startsWith('gd_') ? { layer: 'manchas' } : {}) }); }   // manchas y roturas: pegadas al piso, debajo de todo
    }
    const ash = META.anclas.sh_tree;
    for (const a of w.arboles) { Arbol.spawn({ x: a.x, y: a.y, fl: a.fl, r: a.r, tipo: w.arbolTipos[a.t] }); if (ash) Decoration.spawn({ x: a.x, y: a.y, texture: 'props_sh_tree', anchorX: ash[0], anchorY: ash[1], alpha: .4, layer: 'sombras' }); }
    for (const c of w.cables) { const dx = c[2] - c[0], dy = c[3] - c[1], L2 = Math.hypot(dx, dy);
      Decoration.spawn({ x: c[0], y: c[1], texture: '_white', anchorX: 0, anchorY: .5, scaleX: L2 / 8, scaleY: 1 / 8, rotation: Math.atan2(dy, dx), tint: 0x17171b, alpha: .85, layer: 'cables' }); }
    // líneas pintadas de las canchas: finas, pegadas al piso
    for (const c of (w.lineas || [])) { const dx = c[2] - c[0], dy = c[3] - c[1], L2 = Math.sqrt(dx * dx + dy * dy);
      Decoration.spawn({ x: c[0], y: c[1], texture: '_white', anchorX: 0, anchorY: .5, scaleX: (L2 + 1) / 8, scaleY: 1.5 / 8, rotation: Math.atan2(dy, dx), tint: 0xf2f2ea, alpha: .8, layer: 'manchas' }); }
    // lugares para la gente: puntos al azar que caen en una vereda (el flowfield "veredas" tiene dirección ahí)
    const NG = 23000, gx = new Float32Array(NG), gy = new Float32Array(NG); let ng = 0;
    for (let k = 0; k < NG * 40 && ng < NG; k++) { const x = rng() * META.WW, y = rng() * META.WH; NavGrid.requestVectorFromStaticFlowfield('veredas', x, y, _v);
      if (_v.x !== 0 || _v.y !== 0) { gx[ng] = x; gy[ng] = y; ng++; } }
    this._gx = gx.subarray(0, ng); this._gy = gy.subarray(0, ng); this._gq = new Uint8Array(ng);
    const NG_ = ng;
    this._gCur = 0; this.gente = 0; this.genteMax = Math.min(GENTE_MAX, NG_); this.genteFija = !!GENTE_FIJA;
    this.sumarGente(Math.min(GENTE_INICIAL, this.genteMax), false);
    // ?prueba=x,y[,prop];x,y… pone props fijos donde se pida (para revisar a mano el orden de dibujo)
    if (Q.get('prueba')) for (const t of Q.get('prueba').split(';')) { const [x, y, f] = t.split(','); if (f === 'p') Persona.spawn({ x: +x, y: +y, quieta: 1 }); else Prop.spawn({ x: +x, y: +y, f: f || 'u_farola', r: 1 }); }
    let first = null;
    const modelos = elegirModelos(w.autos, w.props);
    w.autos.forEach((c, i) => {
      const md = modelos[i];
      if (c.c === 'burnt') Chatarra.spawn({ x: c.x, y: c.y, rot: c.rot, ...md, fijo: 1 });
      else if (c.m) { AutoIA.spawn({ x: c.x, y: c.y, rot: c.rot, ...md, faros: 1 }); if (!first) first = c; }
      else AutoEstacionado.spawn({ x: c.x, y: c.y, rot: c.rot, ...md });
    });
    // tu auto: arranca en el punto de inicio del barrio (en el real, Av. Carabobo al 1500) o en el centro del mapa, en el carril del
    // auto con IA más cercano
    const [ix, iy] = META.inicio || [META.WW / 2, META.WH / 2];
    let best = first, bd = 1e18; for (const c of w.autos) if (c.m) { const d = (c.x - ix) ** 2 + (c.y - iy) ** 2; if (d < bd) { bd = d; best = c; } }
    if (best) { AutoJugador.spawn({ x: best.x + 30, y: best.y + 2, rot: best.rot, hoja: 'hatch_rojo', largo: AUTOS.hatch.largo, ancho: AUTOS.hatch.ancho, drive: 300, faros: 1 }); this._spawnCar = best; }
    this.focusX = best ? best.x : META.WW / 2; this.focusY = best ? best.y : META.WH / 2;
  }

  // ---------- cantidad de gente: altas y bajas fuera de cámara para que no se note
  sumarGente(n, fueraDeCamara = true) {
    const NG = this._gx.length; let hechos = 0;
    for (let tries = 0; hechos < n && tries < n * 4 && this.gente < this.genteMax; tries++) {
      const k = this._gCur; this._gCur = (this._gCur + 1) % NG;
      const x = this._gx[k], y = this._gy[k];
      if (fueraDeCamara && Camera.isOnScreen(x, y, 120)) continue;
      if (Persona.spawn({ x, y, quieta: this._gq[k] })) { this.gente++; hechos++; }
    }
    return hechos;
  }
  quitarGente(n) {
    const A = Transform.active, X = Transform.x, Y = Transform.y; let hechos = 0;
    for (let i = Persona.startIndex + Persona.poolSize - 1; i >= Persona.startIndex && hechos < n; i--) {
      if (A[i] !== 1 || Camera.isOnScreen(X[i], Y[i], 120)) continue;
      if (Persona.despawn(i)) { this.gente--; hechos++; }
    }
    return hechos;
  }
  // fps reales: el peor entre el render y los workers (espacial, física, lógica, preRender), promediando cada uno en una ventana
  // de 2 s (las lecturas sueltas saltan mucho). El hilo principal casi no trabaja, así que su fps no dice nada.
  medirFps() {
    const fr = this.views && this.views.frameRate; if (!fr) return;
    if (!this._fIdx) { const S = this.config.spatial.numberOfSpatialWorkers, L = this.numberOfLogicWorkers, idx = [S];
      if (!Q.has('ignorarRender')) idx.push(S + 1);
      for (let i = 0; i < S; i++) idx.push(i); for (let i = 0; i <= L; i++) idx.push(S + 3 + i);
      this._fIdx = idx; this._fSum = new Float64Array(idx.length); this._fN = new Uint32Array(idx.length); }
    for (let k = 0; k < this._fIdx.length; k++) { const f = fr[this._fIdx[k] * 16]; if (f > 1) { this._fSum[k] += Math.min(f, 70); this._fN[k]++; } }
  }
  cerrarVentana() {
    let m = 1e9; if (this._fSum) for (let k = 0; k < this._fSum.length; k++) { if (this._fN[k]) m = Math.min(m, this._fSum[k] / this._fN[k]); this._fSum[k] = 0; this._fN[k] = 0; }
    return m < 1e9 ? m : (this.mainFPS || 60);
  }
  // se ajusta durante el primer minuto: sube de a 10 % mientras sobre, baja de a 12 % si no da; después sólo baja si se arrastra
  afinarGente() {
    const t = performance.now(); if (!this._gT0) { this._gT0 = t; this._gT = t + 3000; }
    if (t < this._gIgn) { this.cerrarVentana(); return; }          // recién cambió la cantidad: esperar a que se asiente
    this.medirFps(); if (t < this._gT) return; this._gT = t + 2000;
    this.fps = this.cerrarVentana();
    if (this.genteFija || this._quieto) return;
    // si sacar gente no mejoró nada, el cuello de botella es otro (la GPU con la luz, por ejemplo): devolverla y dejar de tocar
    if (this._antes) { const a = this._antes; this._antes = null;
      if (this.fps < a.fps + 3) { this.sumarGente(a.gente - this.gente); this._quieto = true; return; } }
    const temprano = t - this._gT0 < 75000;
    if (this.fps < (temprano ? 46 : 36) && this.gente > 600) { this._antes = { fps: this.fps, gente: this.gente };
      this.quitarGente(Math.max(150, this.gente * .12 | 0)); this._techo = this.gente; this._gIgn = t + 1000; this._gT = t + 3000; }
    else if (temprano && this.fps > 55 && this.gente < this.genteMax && !(this._techo && this.gente >= this._techo * .92)) {
      this.sumarGente(Math.max(200, this.gente * .1 | 0)); this._gIgn = t + 1000; this._gT = t + 3000; }
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
  // La vista entera adentro del mapa, que en pantalla es un paralelogramo (cada px hacia arriba corre K/SYN px a la derecha):
  // así la cámara nunca muestra el borde del mundo. El área jugable está más adentro, detrás del paredón (META.MG m de margen).
  limitarVista() {
    const vb = Camera.getViewportBounds(_vista), z = Camera.zoom || 1, cw = vb.width * z, ch = vb.height * z;   // el lienzo, en px de pantalla
    if (!(cw > 0 && ch > 0)) return;
    const S = META.SF, MWp = META.MW * S, Kp = META.K * S * META.MH, kk = META.K / META.SYN;
    this.zoomT = Math.max(this.zoomT, ch / META.WH, (cw + kk * ch) / MWp);   // que entre la vista entera
    const hw = cw / (2 * this.zoomT), hh = ch / (2 * this.zoomT);
    this.focusY = Math.max(hh, Math.min(META.WH - hh, this.focusY));
    const lo = Kp - kk * (this.focusY - hh) + hw, hi = MWp + Kp - kk * (this.focusY + hh) - hw;
    this.focusX = lo <= hi ? Math.max(lo, Math.min(hi, this.focusX)) : (lo + hi) / 2;
  }

  // cámara libre en el hilo principal: arrastrar, pellizcar, rueda, WASD/flechas
  update(dtRatio = 1) {
    this.afinarGente();
    // las sombras horneadas (casas, calcos) se desvanecen con el sol
    const si = Math.max(0, Math.min(1, (Sun.intensity || 0) * 1.4 - .2)), Ls = Layer.get('sombrasCasas'), Ld = Layer.get('sombras');
    if (Ls && Math.abs(Ls.alpha - si) > .02) Ls.alpha = si; if (Ld && Math.abs(Ld.alpha - si) > .02) Ld.alpha = si;
    const Ln = Layer.get('noche'), no = Math.max(0, Math.min(1, 1.15 - si * 1.4)); if (Ln && Math.abs(Ln.alpha - no) > .02) Ln.alpha = no;
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
    this.limitarVista();
    Camera.targetZoom = this.zoomT;
    Camera.follow(this.focusX, this.focusY, .35, dtRatio);
  }
}
