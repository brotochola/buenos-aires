// ===================== conurbanoScene.js — el barrio del conurbano en WeedJS =====================
// Mundo de WeedJS = píxeles de la proyección oblicua (18 px/m de ancho, 9 px/m de profundidad), igual que littleCity.
// Todo el barrio sale del editor de barrios (editor/): exportás el zip y su carpeta `barrio/` va al lado de este archivo.
//   piso       -> capa worldRect con un shader que pinta calles/veredas/patios en la GPU (shaders/piso.frag)
//   casas      -> entidades estáticas con su sprite horneado + colisionador poligonal + sombra (malla)
//   gente      -> miles de personas LPC (se ajusta sola a lo que aguante el aparato) siguiendo flowfields estáticos con costos (cruzan, no caminan por la calle)
//   autos      -> Box2D (patrón de carScene/littleCity), IA por el flowfield de carriles; V para manejar
// ---------- el barrio exportado por el editor: barrio/ (el inventado), carabobo/ (Av. Carabobo al 1500 y la villa 1-11-14) o parquechas/ (Parque Chas).
// barrios.js junta los meta de los dos (herramientas/barrios.js) y lo importan todos los hilos. Cuál se juega lo dice ?barrio=… en la
// URL de esta escena (index.html la arma así); en los workers import.meta.url es esa misma URL, así todos los hilos eligen el mismo.
// META.atlas lo pone herramientas/hornear_atlas.js cuando hay atlas pre-horneado en <carpeta>/atlas/ (si no, el juego lo arma al cargar)
import { BARRIOS } from './barrios.js';
// autos: modelos, colores y medidas que hornea herramientas/hornear_autos.js (img/autos/)
import { AUTOS, CHATARRA } from './img/autos/autos.js';
import { APOYO } from './img/autos/apoyo.js';
// la sombra de los autos al sol: la del volumen (huella + techo corrido), no el sprite dado vuelta
import { cajaAuto, CAJA_T, cajaAlturas, altoAuto, volumenSombra } from './sombraAuto.js';
const DIR = (() => { try { const b = new URL(import.meta.url).searchParams.get('barrio'); return b && BARRIOS[b] ? b : 'barrio'; } catch (e) { return 'barrio'; } })();
const META = BARRIOS[DIR] || BARRIOS[Object.keys(BARRIOS)[0]];
const BARRIO = new URL('./' + DIR + '/', import.meta.url).href;

const { Scene, GameObject, Component, SharedResource, RigidBody, Collider, CollisionListener, SpriteRenderer, MeshRenderer, Transform,
  Camera, Keyboard, Mouse, NavGrid, Layer, LAYER_KIND, BLEND_MODES, SpriteSheetRegistry, LightEmitter, LightOccluder, ShadowCaster, Sun, enums, rng, dot2 } = WEED;
// todas las luces del barrio: blanco amarillento de ciudad (~3000 K)
const LUZ = 0xffdcaa;
// la luz de la noche (lighting.sun.night): una luna azulada que WeedJS suma a la luz de la escena cuando el sol baja de 0,4
// (completa en 0,1), sin tocar Sun.intensity: las sombras del sol se apagan solas y las de los faroles no se debilitan
const LUNA = 0x5473f2, LUNA_I = .3;
// los faroles alumbran desde arriba (LightEmitter.sourceHeight): con la misma intensidad el pie quedaría oscuro
const FAROL_K = 2.2;
// lugar en el arena de mallas: los volúmenes de las casas tienen a lo sumo tantos vértices como puntos exportados (nSombraPts) y
// a lo sumo el doble de triángulos; los autos, una caja de 8 vértices y 10 triángulos
const MALLA_V = (META.nSombraPts || 0) + 8 * ((META.nAutos || 0) + 80) + 64, MALLA_I = 6 * (META.nSombraPts || 0) + 30 * ((META.nAutos || 0) + 80) + 64;
const { ShapeType } = enums;

const NLPC = 19, NPED = META.peatones, PXM = META.PXM;

// ---------- cuánta gente. ?gente=N la fija; si no, arranca según el aparato y se ajusta sola mirando los fps de los workers
// (los lugares se sortean en las veredas: las celdas con dirección del flowfield "veredas" del barrio)
// (los parámetros de la página: WEED.params, iguales en todos los hilos; en un worker, location es la del worker)
const Q = WEED.params || new URLSearchParams(typeof globalThis.location?.search === 'string' ? globalThis.location.search : '');
// la sombra del árbol es su silueta entera como textura de sombra (ShadowCaster.setTexture), y el tronco es el sprite.
// lighting.shadowTextures apaga para toda la escena un camino rápido de las sombras (E-191); medido en Parque Chas con 12 000
// personas, en dos pares, no cuesta (Pixi 5,94 / 5,44 ms sin, 5,62 / 5,29 ms con; 60 fps). ?siltex=0 vuelve a la silueta
// invisible como sprite
const SOMBRA_TEX = Q.get('siltex') !== '0';
// ?raycast=1 (prueba, sección 7 del plan): las luces de faroles, postes y autos no atraviesan las casas. WeedJS arma un
// polígono de visibilidad por luz (lighting.raycasted) con los colisionadores de las casas (LightOccluder); cada luz busca
// obstáculos hasta su Collider.visualRange, que acá es su alcance (10·√intensidad). Con esto WeedJS apaga la capa de sombras
// proyectadas (gente, árboles, postes): quedan las de volumen de casas y autos
const RAYCAST = Q.get('raycast') === '1';
const alcanceLuz = (I) => RAYCAST ? Math.ceil(10 * Math.sqrt(I)) : 0;
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
// tránsito (transito.bin y los cruces de mundo.json): velocidad máxima, zonas antes de cada esquina y semáforos
export class Transito extends SharedResource {}
// las luces de cada semáforo: índices de sus decoraciones (+1; 0 = todavía no), las pone el semáforo y las prende la escena
export class Semaforos extends SharedResource {}
export class Estado extends SharedResource {}
// las sombras de las casas: el volumen de cada una (ver volumenSombra), armado al cargar con los puntos de sus cajas de
// mundo.json. v: x, y del piso respecto del pie de la casa y altura en px de pantalla, por vértice; t: sus triángulos
export class SombrasData extends SharedResource {}

// ---------- componentes
export class PersonaComp extends Component {
  static ARRAY_SCHEMA = { campo: Uint8Array, quieta: Uint8Array, estado: Uint8Array, timer: Float32Array, vel: Float32Array, cara: Uint8Array };
}
export class AutoComp extends Component {
  static ARRAY_SCHEMA = { active: Uint8Array, driveForce: Float32Array, lateralFriction: Float32Array, turnTorque: Float32Array, minSteerSpeed: Float32Array,
    minSteerFactor: Float32Array, maxSteerSpeed: Float32Array, lastKey: Int16Array,
    hl: Float32Array, hw: Float32Array,   // medio largo y medio ancho del colisionador (px): la IA y la gente miran el tamaño de cada vehículo
    ha: Float32Array, hb: Float32Array,   // medio largo y medio ancho de la huella en el piso, en px del dibujo (18 px/m, piso aplastado a AUTO_S)
    faros: Uint8Array,                    // 1: lleva faros (su luz, corrida adelante con offsetX, y dos brillos)
    // estado de la IA: en componentes (no en campos del objeto), porque una entidad puede pasar de un worker de lógica a otro
    sx: Float32Array, sy: Float32Array, sr: Float32Array, lx: Float32Array, ly: Float32Array, stuck: Float32Array, libre: Float32Array, parado: Float32Array,
    pf: Float32Array,      // qué tan cerca de la máxima maneja (0,8 a 0,97: nadie se pasa)
    espera: Float32Array,  // segundos esperando que pase el de la derecha (a los 4 s sigue: nadie se queda trabado)
    rs: Int8Array,         // en la rotonda: por cuál calle sale (índice de META.rotondas[0].sal; -1: no está en la rotonda)
    // su sombra (cajaAuto, sombraAuto.js): alto (px), achique del techo, y con qué rumbo se armó la caja (1 en shOk si ya hay)
    shH: Float32Array, shK: Float32Array, shC: Float32Array, shS: Float32Array, shOk: Uint8Array };
}

// ---------- luces que se prenden a su hora: faroles, postes con lámpara y faros de autos
// Cada luz sortea al nacer cuándo se prende (entre las 18 y las 19) y cuándo se apaga (entre las 6 y las 7), y su tick la
// prende o la apaga con sus brillos. De día tienen que estar apagadas: su luz se sumaría a la del sol y, como la iluminación
// recorta en 1, borraría las sombras de alrededor. En un componente (no en campos del objeto): los ve cualquier hilo
export class LuzHora extends Component {
  // prende, apaga: horas; base: intensidad de su luz (0: no es una luz); on: 1 prendida, 0 apagada, 2 sin decidir;
  // ag: cuántas de sus decoraciones son brillos (las primeras), y su alfa (a0 la de las pares, a1 la de las impares)
  static ARRAY_SCHEMA = { prende: Float32Array, apaga: Float32Array, base: Float32Array, on: Uint8Array, ag: Uint8Array, a0: Float32Array, a1: Float32Array };
}
const LUZ_TICK = 30;   // cada cuántos cuadros mira la hora cada luz (con el día de 8 minutos, 1 cuadro son 0,3 minutos de juego)
// las horas de una luz fija salen de su posición (el mismo sorteo en cualquier hilo: el principal las necesita para las caras
// de las casas, ver carasFaroles); las de los autos, al azar
const _hl = [0, 0];
function horasLuz(x, y, out) { const a = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, b = Math.sin(x * 39.346 + y * 11.135) * 24634.6345;
  out[0] = 18 + (a - Math.floor(a)); out[1] = 6 + (b - Math.floor(b)); return out; }
function luzNace(go, ag, a0, a1, c) {
  const i = go.index, L = LuzHora; if (c) { horasLuz(c.x, c.y, _hl); L.prende[i] = _hl[0]; L.apaga[i] = _hl[1]; } else { L.prende[i] = 18 + rng(); L.apaga[i] = 6 + rng(); }
  L.base[i] = LightEmitter.lightIntensity[i];
  L.on[i] = 2; L.ag[i] = ag; L.a0[i] = a0; L.a1[i] = a1; luzHora(go);
}
function luzHora(go) {
  const i = go.index, L = LuzHora; if (!(L.base[i] > 0)) return;
  const h = Sun.hour, on = h >= L.prende[i] || h < L.apaga[i] ? 1 : 0; if (on === L.on[i]) return;
  L.on[i] = on; LightEmitter.active[i] = on; LightEmitter.lightIntensity[i] = on ? L.base[i] : 0;
  for (let q = 0, n = Math.min(L.ag[i], go.getAttachedDecorationCount()); q < n; q++) { const d = go.getAttachedDecoration(q); if (d) d.alpha = on ? (q & 1 ? L.a1[i] : L.a0[i]) : 0; }
}

// ---------- casas, tapiales y postes (sprites horneados con R3)
// La entidad sólo lleva el colisionador y la luz de la ventana. El dibujo va en franjas verticales (Decoration), cada una
// con su y de orden en la base de la pared de esa columna: así el ySort sabe qué tapa a qué aunque la casa esté girada.
export class Casa extends GameObject {
  static isStatic = true;
  static tickInterval = LUZ_TICK;
  static components = [RigidBody, Collider, LightEmitter, LuzHora, ...(RAYCAST ? [LightOccluder] : [])];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    // con ?raycast=1 la planta de la casa (o el tapial) tapa las luces; el poste no
    if (RAYCAST) { this.lightOccluder.maskMode = 0; this.lightOccluder.block = c.col ? 1 : 0; }
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
    L.sourceHeight = on ? 50 : 0; L.lightIntensity = on ? 1500 * FAROL_K : 0; L.active = on ? 1 : 0; this.collider.visualRange = on ? (alcanceLuz(L.lightIntensity) || 260) : this.collider.visualRange;
    luzNace(this, 0, 0, 0, c);   // el poste se prende a su hora (su brillo es el de la luz: hasGlowSprite)
  }
  tick() { luzHora(this); }
}
// una franja vertical de una casa: la entidad está en la base de la pared (de ahí sale su y de orden) y lleva colgadas las
// piezas de 64 px como decoraciones, que se ordenan con la y del padre pero se recortan cada una por su propio centro
// sombra de cada casa al piso: su volumen en la capa sunProjected 'sombrasCasas'. La malla se sube una sola vez; la placa corre
// cada vértice según su altura y el sol de cada cuadro (la misma cuenta que WeedJS usa para la sombra de la gente), y la capa
// pone la oscuridad (alphaBySun 'shadow'). Un exporte viejo (sin los puntos de las cajas) trae la sombra hecha con el sol fijo
// del editor, sin alturas: queda quieta.
export class SombraCasa extends GameObject {
  static isStatic = true;
  static components = [MeshRenderer];
  onSpawned(c = {}) {
    this.setLayer('sombrasCasas');
    this.meshRenderer.tint = 0x000000; this.meshRenderer.alpha = 1;   // negro opaco: la capa pone la oscuridad del sol
    if (c.sh) { const flat = new Float32Array(c.sh.length * 2); c.sh.forEach((q, i) => { flat[i * 2] = q[0]; flat[i * 2 + 1] = q[1]; });
      this.meshRenderer.setMesh(flat); return; }       // convexo: abanico desde el vértice 0
    const n = c.n | 0, tn = c.tn | 0, off = c.off | 0, toff = c.toff | 0; if (n < 3 || tn < 3) return;
    const V = SombrasData.v, T = SombrasData.t, xy = new Float32Array(n * 2), h = new Float32Array(n), idx = new Uint16Array(tn);
    for (let q = 0; q < n; q++) { const k = (off + q) * 3; xy[q * 2] = V[k]; xy[q * 2 + 1] = V[k + 1]; h[q] = V[k + 2]; }
    for (let q = 0; q < tn; q++) idx[q] = T[toff + q];
    this.meshRenderer.setMesh(xy, idx); this.meshRenderer.setHeights(h);
  }
}
// dónde están las lámparas de cada farol, como fracción del cuadro exportado (medidas a ojo; de atrás quedan en el mismo lugar)
// geometría plana para _lamparasTapadas: envolvente convexa, punto dentro de un polígono convexo y la y más baja en pantalla
// (la más adelante) de un polígono en una x
function envolvente(P) { const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up); }
function dentroConvexo(H, x, y) { let sg = 0; for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  if (c !== 0) { if (sg === 0) sg = c > 0 ? 1 : -1; else if ((c > 0 ? 1 : -1) !== sg) return false; } } return H.length >= 3; }
function frenteEn(H, x) { let m = -Infinity; for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length];
  if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) { if (a[0] === x) m = Math.max(m, a[1]); continue; }
  m = Math.max(m, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); } return m; }
const LAMPARAS = { u_farola: [[.65, .09]], u_farola_orn: [[.5, .2]], u_farol_doble: [[.17, .27], [.77, .18]] };
// árboles, faroles, semáforos, contenedores… (lo que frena un auto); lo demás va como Decoration
export class Prop extends GameObject {
  static isStatic = true;
  static tickInterval = LUZ_TICK;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster, LightEmitter, LuzHora];
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
      // la luz sale de la lámpara (sourceHeight, a media altura del poste: el charco queda más parejo) y por eso más fuerte
      L.sourceHeight = top * .5; L.lightIntensity = (f === 'u_farol_doble' ? 2600 : f === 'u_farola' ? 2200 : 1800) * FAROL_K; L.hasGlowSprite = .55; L.active = 1;
      this.collider.visualRange = alcanceLuz(L.lightIntensity) || 260;   // alcance para las sombras que proyecta su luz (y, con ?raycast=1, las casas que la tapan)
      // brillo en cada lámpara (se prende con la luz): un centro chico y un halo, en la capa 'noche' (aditiva, arriba de todo:
      // debajo de la luz, multiplicados por el charco, no se veían). Esa capa no se ordena con las casas: el farol que tiene su
      // lámpara detrás de una casa (c.tp, ConurbanoScene._lamparasTapadas, al cargar) va sin brillo
      const ls = c.tp ? null : LAMPARAS[f] || null, sw = this.spriteRenderer.originalWidth * e, sh = this.spriteRenderer.originalHeight * e;
      if (ls) for (const [fx, fy] of ls) { const dx = (fx - an[0]) * sw * (c.fl ? -1 : 1), dy = (fy - an[1]) * sh;
        this.addDecoration('_lightGradient', dx, dy, .26, .26, 1, { tint: 0xfff2d0, alpha: 1, anchorX: .5, anchorY: .5, layer: 'noche' });
        this.addDecoration('_lightGradient', dx, dy, .8, .8, 1, { tint: LUZ, alpha: .5, anchorX: .5, anchorY: .5, layer: 'noche' }); }
      luzNace(this, ls ? ls.length * 2 : 0, 1, .5, c);   // se prende a su hora, con sus brillos (centro y halo de cada lámpara)
    } else {
      L.lightIntensity = 0; L.active = 0; this.luzHora.base = 0;
      // semáforo: sin luz al piso, sólo un punto de color en la lámpara (el gradiente de WeedJS, en una capa aditiva);
      // de atrás (u_semaforo_atras) no se ven las luces
      // con datos de tránsito: rojo, amarillo y verde (y una tapa para la roja, que en el dibujo está prendida), pegados al semáforo
      // y apagados; la escena los prende según el ciclo de su cruce. Si no, una luz fija
      if (c.f === 'u_semaforo' && c.sk >= 0 && TR.n) { const dx = (c.fl ? -1 : 1) * .9;
        [[.862, 0xff3b30], [.773, 0xffb020], [.684, 0x36d96b], [.862, 0x241e1e]].forEach(([k, tint], q) => {
          const d = this.addDecoration('_whiteCircle', dx, -top * k, q === 3 ? .56 : .42, q === 3 ? .56 : .42, q === 3 ? 2 : 3, { tint, alpha: 0, anchorX: .5, anchorY: .5 });
          Semaforos.ids[c.sk * 4 + q] = d >= 0 ? d + 1 : 0; }); }
      else if (c.f === 'u_semaforo' && !TR.n) { const rojo = rng() < .5; this.addDecoration('_lightGradient', 0, -top * (rojo ? .87 : .7), .35, .35, 0, { tint: rojo ? 0xff3b30 : 0x36d96b, alpha: .85, anchorX: .5, anchorY: .5, layer: 'brillos' }); }
    }
  }
  tick() { luzHora(this); }
}

// árbol del editor: el tronco es el sprite; cada rama (con sus hojas) es una decoración colgada, anclada en su base, que se mece.
// El orden dentro del árbol viene en las piezas (las ramas de atrás antes que el tronco).
const ARB_ESCALA = .6, COPA_ADELANTE = 2.8 * META.SYN * META.SF;   // 2,8 m de piso, en px de mundo
export class Arbol extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    const T = c.tipo, fl = c.fl ? -1 : 1, E = T.escala || ARB_ESCALA;   // el tipo viaja en la config: la escena lo lee en el hilo principal
    this.collider.shapeType = ShapeType.Circle; this.collider.radius = Math.max(2, c.r || 3); this.collider.visualRange = 200;
    // la sombra es la de la silueta entera del árbol, porque en WeedJS las decoraciones (las ramas) no proyectan: la silueta es
    // la textura de la sombra (ShadowCaster.setTexture) y el tronco es el sprite. Con ?siltex=0, el sprite es la silueta,
    // invisible (sólo para proyectar), y el tronco es una decoración más
    const S = T.sil, TEX = SOMBRA_TEX && !!S;
    this.alpha = 1;
    if (S && !TEX) { this.setSprite('arboles', S[0], 0); this.spriteRenderer.anchorX = S[1]; this.spriteRenderer.anchorY = S[2]; this.setScale(E / S[3] * fl, E / S[3]); this.alpha = 0; }
    this.shadowCaster.heightMultiplier = S ? 1 : 0;
    if (TEX) this.shadowCaster.setTexture('arboles_' + S[0], { anchorX: S[1], anchorY: S[2], scaleX: E / S[3] * fl, scaleY: E / S[3] });
    for (const p of T.piezas) {
      if (p[5] === 0 && (!S || TEX)) { this.setSprite('arboles', p[0], 0); this.spriteRenderer.anchorX = fl > 0 ? p[3] : 1 - p[3]; this.spriteRenderer.anchorY = p[4]; this.setScale(E * fl, E); continue; }
      // las ramas de adelante (y su follaje) se ordenan casi 3 m más cerca de la cámara que el tronco: la copa está arriba y se
      // abre hacia adelante, así tapa la mesa o el banco que está debajo (si no, la silla salía encima de las hojas)
      this.addDecoration('arboles_' + p[0], p[1] * fl, p[2], E * fl, E, p[5], { anchorX: p[3], anchorY: p[4], sway: !!p[6], swayAmplitude: .022 + rng() * .02, swayFrequency: .45 + rng() * .4, sortOffsetY: p[5] > 0 ? COPA_ADELANTE : 0 });
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
    // los personajes LPC son anchos ("gorditos"): un 6 % más angostos que altos
    const s = .56 + rng() * .08; this.setScale(s * .94, s);
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
const _h = { frontX: 0, frontY: 0, rightX: 0, rightY: 0 }, _h2 = { frontX: 0, frontY: 0, rightX: 0, rightY: 0 };
// ---------- tránsito: lo que dice la ley (Ley Nacional de Tránsito 24.449, art. 41 y 51; Código de Tránsito y Transporte de CABA)
// velocidad máxima por código de la grilla (km/h): 1 tierra y pasajes 20, 2 llegando a una esquina sin semáforo 30, 3 calles 40,
// 4 avenidas 60. Semáforos: ciclo de 40 s, cada calle 17 s verde, 3 s amarillo y 20 s rojo, desfasado en cada cruce. El reloj es
// Date.now(), igual en todos los hilos, así las luces que se ven y los autos que frenan van juntos
const TR = META.transito || { W: 0, H: 0, n: 0, semAlto: 0 }, LIM = [40, 20, 30, 40, 60], CICLO = 40;
const ROT0 = (META.rotondas || [])[0] || null, TAU = Math.PI * 2;   // la rotonda del barrio (Parque Chas), si tiene
function faseSemaforo(cid, eje) { const t = ((Date.now() / 1000 + Transito.cruces[cid * 6 + 5]) % CICLO + CICLO) % CICLO;
  return eje === 0 ? (t < 17 ? 0 : t < 20 ? 1 : 2) : (t < 20 ? 2 : t < 37 ? 0 : 1); }   // 0 verde, 1 amarillo, 2 rojo
function celdaTransito(sx, sy) { if (!TR.W) return 0; const ym = META.MH - sy / (META.SYN * META.SF), xm = sx / META.SF - META.K * ym;
  if (xm < 0 || ym < 0 || xm >= TR.W || ym >= TR.H) return 0; return Transito.grid[(ym | 0) * TR.W + (xm | 0)]; }
// metros por px de pantalla en el rumbo (fx, fy): la proyección no es igual en x que en y
function metrosPorPx(fx, fy) { const dx = fx / META.SF + META.K * fy / (META.SYN * META.SF), dy = -fy / (META.SYN * META.SF); return Math.sqrt(dx * dx + dy * dy); }
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
const _huella = [0, 0], _sb = new Float32Array(16);
// el ancla de cada cuadro (herramientas/apoyo_autos.py): los cuadros terminan en la rueda más baja, así el auto se ordena
// donde toca el piso y no tapa a los árboles y a la gente que tiene adelante
const _apoyo = new Map();
function apoyoDe(sheet) { let t = _apoyo.get(sheet); if (t === undefined) { t = APOYO[sheet.slice(5)] || null; _apoyo.set(sheet, t); } return t; }
// los faros: la luz del propio auto, corrida hacia adelante (LightEmitter.offsetX gira con el auto), y dos brillos pegados al
// auto, con las entidades: delante de la carrocería si el auto mira hacia la cámara, detrás si le da la espalda, y tapados
// por lo que tenga delante (casas, árboles)
const LUZ_FARO = 0xfff0d0, FARO_ADELANTE = 18;   // px delante del frente de la huella
// las caras de las casas de noche (ConurbanoScene.carasFaroles): alcance de cada farol (m), distancia a la que su peso es la
// mitad (m), cuánto se apaga una cara que le da la espalda a todos (0..1) y cuántas piezas se tiñen por cuadro
const CARAS_R = 14, CARAS_R0 = 6, CARAS_K = Q.get('caras') === '0' ? 0 : .55, CARAS_POR_CUADRO = 20000;   // ?caras=0: sin esto, para comparar
export class Auto extends GameObject {
  static deriveSpeed = true;
  static components = [RigidBody, Collider, CollisionListener, SpriteRenderer, MeshRenderer, LightEmitter, LuzHora, AutoComp];
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
    // la sombra: su caja (MeshRenderer con alturas) en la capa sunProjected de las casas, que se compone una vez: donde pisa la
    // sombra de una casa no oscurece doble. La placa la corre con el sol; acá sólo se rehace cuando el auto gira. El sprite
    // sigue en la capa de entidades
    const [sh, sk] = altoAuto(c.hoja); A.shH = sh; A.shK = sk; A.shOk = 0;
    this.setLayer('sombrasCasas'); this.meshRenderer.tint = 0x000000; this.meshRenderer.alpha = 1;
    this._sombra(Math.cos(rot), Math.sin(rot));
    const L = this.lightEmitter; A.faros = c.faros ? 1 : 0;
    if (c.faros) {   // los dos brillos son las decoraciones 0 y 1 del auto (_frame las pone en los faros, y corre la luz)
      L.lightColor = LUZ_FARO; L.height = 0; L.hasGlowSprite = 0; L.lightIntensity = c.i || 700; L.offsetX = A.hl + FARO_ADELANTE; L.offsetY = 0; L.active = 1;
      if (RAYCAST) this.collider.visualRange = alcanceLuz(L.lightIntensity) + A.hl + FARO_ADELANTE;   // la luz está corrida adelante
      for (let k = 0; k < 2; k++) this.addDecoration('_lightGradient', 0, 0, .18, .18, 1, { tint: LUZ_FARO, alpha: .9, anchorX: .5, anchorY: .5, offsetY: -8 });
      luzNace(this, 2, .9, .9);   // los faros se prenden a su hora, con sus dos brillos
    } else { L.lightIntensity = 0; L.offsetX = 0; L.offsetY = 0; L.active = 0; this.luzHora.base = 0; }
    this._frame();
  }
  // rehace la caja de la sombra si el auto giró más de 2° desde la última vez (el sol lo pone la placa)
  _sombra(rc, rs) {
    const i = this.index, A = AutoComp;
    if (A.shOk[i] && rc * A.shC[i] + rs * A.shS[i] > .9994) return;
    A.shC[i] = rc; A.shS[i] = rs;
    cajaAuto(_sb, rc, rs, A.ha[i], A.hb[i], A.shK[i]);
    if (A.shOk[i]) this.meshRenderer.setVertices(_sb);
    else { this.meshRenderer.setMesh(_sb, CAJA_T); this.meshRenderer.setHeights(cajaAlturas(A.shH[i])); A.shOk[i] = 1; }
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
      if (AutoComp.faros[i]) { LightEmitter.offsetX[i] = L * .5 + FARO_ADELANTE;   // la luz, delante del frente de la huella
        // el brillo se ordena en la línea de pie del auto (el borde de abajo de su dibujo) más sortOffsetY: si el frente mira
        // hacia la cámara, encima de la carrocería; si no, un largo más atrás, debajo de ella (de espaldas no se ven los faros)
        const atras = k.s < -.25 ? -L : 0;
        if (this.getAttachedDecorationCount() >= 2) for (let q = 0; q < 2; q++) { const d = this.getAttachedDecoration(q); if (d) { d.localX = L * .5 - 2; d.localY = (q ? .3 : -.3) * W; d.sortOffsetY = atras; } } } }
  }
  tick() { const i = this.index; if (!Transform.active[i]) return; this._friction(); this._frame(); luzHora(this);
    if (Transform.rotC) { const rc = Transform.rotC[i], rs = Transform.rotS[i]; if (rc * rc + rs * rs > .5) this._sombra(rc, rs); } }
}
export class AutoEstacionado extends Auto {}
export class Chatarra extends Auto {}

// IA: sigue el flowfield de carriles (mano derecha), frena por gente y autos adelante (patrón de littleCity)
const _probe = [[0, 0], [0, 8], [0, -8], [16, 0], [-16, 0], [0, 16], [0, -16], [24, 0], [-24, 0], [24, 12], [24, -12], [-24, 12], [-24, -12], [0, 24], [0, -24], [48, 0], [-48, 0], [36, 24], [-36, 24], [36, -24], [-36, -24]];
export class AutoIA extends Auto {
  onSpawned(c = {}) { super.onSpawned(c); const A = this.autoComp, rot = c.rot || 0;
    A.lx = Math.cos(rot); A.ly = Math.sin(rot); A.stuck = 0; A.libre = 0; A.parado = 0; A.sx = c.x; A.sy = c.y; A.sr = rot; A.pf = .8 + rng() * .17; A.espera = 0; A.rs = -1; }
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
    // rotonda (Parque Chas): el flowfield da la vuelta en sentido antihorario; al entrar cada auto elige por cuál calle sale (no por
    // la que entró) y, llegando a ella, va a su carril de salida
    if (ROT0) { const ym = META.MH - this.y / (META.SYN * META.SF), xm = this.x / META.SF - META.K * ym, dx = xm - ROT0.mx, dy = ym - ROT0.my, d = Math.sqrt(dx * dx + dy * dy);
      if (d < ROT0.re + 1) { const S = ROT0.sal, th = Math.atan2(dy, dx);
        if (AutoComp.rs[i] < 0) { let ent = 0, be = 9;
          for (let k = 0; k < S.length; k++) { const a = Math.abs(((Math.atan2(S[k][1], S[k][0]) - th) % TAU + TAU + Math.PI) % TAU - Math.PI); if (a < be) { be = a; ent = k; } }
          AutoComp.rs[i] = (ent + 1 + ((rng() * (S.length - 1)) | 0)) % S.length; }
        const q = S[AutoComp.rs[i]], ccw = ((Math.atan2(q[1], q[0]) - th) % TAU + TAU) % TAU;
        if (ccw < .7 || ccw > TAU - .25) { const ex = ROT0.mx + q[0] * (ROT0.re + 8) + q[1] * q[2] - xm, ey = ROT0.my + q[1] * (ROT0.re + 8) - q[0] * q[2] - ym;
          _v.x = ex + META.K * ey; _v.y = -META.SYN * ey; } }
      else if (d > ROT0.re + 8) AutoComp.rs[i] = -1; }
    const l2 = _v.x * _v.x + _v.y * _v.y; if (l2 < .01) return;
    const inv = 1 / Math.sqrt(l2), nx = _v.x * inv, ny = _v.y * inv, fx = this.forwardX, fy = this.forwardY;
    const cross = fx * ny - fy * nx, align = fx * nx + fy * ny;
    let turn = Math.max(-1, Math.min(1, cross * 2)) * .8, fwd = align > .15 ? 1 : RigidBody.speed[i] < 30 ? .25 : 0;   // desalineado: sólo avanza despacito para poder girar
    // ¿alguien adelante en el carril?
    // trabado más de 5 s (dos autos que se frenan mutuamente en un cruce): 3 s sin mirar a los demás
    const A = AutoComp;
    if (RigidBody.speed[i] < 10) { A.stuck[i] += dts; A.parado[i] += dts;
      if (A.stuck[i] > 5) { A.stuck[i] = 0; A.libre[i] = 3; } } else { A.stuck[i] = 0; A.parado[i] = 0; }
    // parado más de 12 s (se metió en un lote, quedó contra un poste): fuera de cámara, vuelve a su carril de salida
    if (A.parado[i] > 12 && !this.isOnScreen) { A.parado[i] = 0; this.x = A.sx[i]; this.y = A.sy[i]; this.rotation = A.sr[i];
      RigidBody.vx[i] = 0; RigidBody.vy[i] = 0; A.lx[i] = Math.cos(A.sr[i]); A.ly[i] = Math.sin(A.sr[i]); return; }
    if (A.libre[i] > 0) A.libre[i] -= dts;
    // ---- la ley: lo que dice la grilla de tránsito un poco adelante del auto
    const ade = A.hl[i] + 10, cod = celdaTransito(this.x + fx * ade, this.y + fy * ade), zona = (cod >> 4) & 3, cid = (cod >> 6) - 1;
    const kmh = RigidBody.speed[i] * metrosPorPx(fx, fy) * 3.6, maxKmh = LIM[cod & 15] * A.pf[i];
    let alto = false;
    if (zona === 1 && cid >= 0 && cid < TR.n) {
      const C = Transito.cruces, o = cid * 6, eje = Math.abs(fx * C[o + 3] + fy * C[o + 4]) > .7 ? 0 : 1;
      if (C[o + 2] > 0) { if (faseSemaforo(cid, eje) !== 0) alto = true; }      // rojo, o amarillo: se para antes de la senda
      else {
        // esquina sin semáforo: cede el paso al que cruza desde su derecha (art. 41). Si espera más de 4 s, sigue (si todos esperan
        // al de la derecha, nadie pasa nunca)
        const rx = -fy, ry = fx;
        for (let n = 0; n < this.neighborCount && !alto; n++) { const j = this.getNeighbor(n); if (j === i || !Transform.active[j] || AutoComp.active[j] !== 1) continue;
          GameObject.getHeadingAxes(j, _h2); if (Math.abs(fx * _h2.frontX + fy * _h2.frontY) > .5) continue;            // no viene cruzado
          const dx = Transform.x[j] - this.x, dy = Transform.y[j] - this.y; if (dx * rx + dy * ry <= 0) continue;           // no viene de la derecha
          const dj = AutoComp.hl[j] + 10, cj = celdaTransito(Transform.x[j] + _h2.frontX * dj, Transform.y[j] + _h2.frontY * dj);
          if (((cj >> 6) - 1) !== cid || !((cj >> 4) & 3)) continue;                                                      // no está en esta esquina
          if ((C[o] - Transform.x[j]) * _h2.frontX + (C[o + 1] - Transform.y[j]) * _h2.frontY < 0) continue;               // ya pasó
          alto = true; }
        if (alto) { A.espera[i] += dts; if (A.espera[i] > 4) alto = false; }
      }
      // no quedarse en el medio del cruce: si el de adelante está parado del otro lado, espera antes de la senda
      if (!alto) { const reach = 22 / metrosPorPx(fx, fy);
        for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (j === i || !Transform.active[j] || AutoComp.active[j] !== 1 || RigidBody.speed[j] > 12) continue;
          const dx = Transform.x[j] - this.x, dy = Transform.y[j] - this.y, ah = dx * fx + dy * fy; if (ah < A.hl[i] + 30 || ah > reach) continue;
          if (Math.abs(fx * dy - fy * dx) < A.hw[i] + AutoComp.hw[j]) { alto = true; break; } } }
    } else A.espera[i] = 0;
    let brake = 0, steer = 0;
    if (A.libre[i] <= 0) for (let n = 0; n < this.neighborCount; n++) { const j = this.getNeighbor(n); if (!Transform.active[j] || j === i) continue;
      const isCar = AutoComp.active[j] === 1, isPerson = !isCar && PersonaComp.vel[j] > 0; if (!isCar && !isPerson) continue;
      // alcance y ancho del carril según el tamaño de los dos (con dos autos chicos, ~95 y ~22 px)
      // en la esquina, al peatón que cruza por la senda se lo ve antes y más de costado (art. 41: el peatón tiene prioridad)
      const dx = Transform.x[j] + RigidBody.vx[j] * .2 - this.x, dy = Transform.y[j] + RigidBody.vy[j] * .2 - this.y, ahead = dx * fx + dy * fy, reach = isCar ? A.hl[i] + A.hl[j] + 35 : A.hl[i] + (zona ? 70 : 40);
      if (ahead <= 8 || ahead > reach) continue; const side = fx * dy - fy * dx, as = Math.abs(side), corr = isCar ? A.hw[i] + A.hw[j] - 2 : A.hw[i] + (zona ? 16 : 4); if (as > corr) continue;
      const u = (1 - ahead / reach) * (.4 + .6 * (1 - as / corr)); if (u > brake) brake = u; if (isCar) steer += (side >= 0 ? -1 : 1) * u; }   // a la gente se la espera, no se la esquiva (si no, el auto se sube a la vereda)
    if (brake > 0) { turn = Math.max(-1, Math.min(1, turn * (1 - brake * .6) + Math.max(-1, Math.min(1, steer)) * .8)); fwd *= 1 - brake;
      if (brake > .6) { const k = 1 - (brake - .6) * .25; RigidBody.vx[i] *= k; RigidBody.vy[i] *= k; } }   // frena, no da marcha atrás
    // velocidad máxima (art. 51): acelera de menos cerca del límite y frena si se pasó; en rojo o cediendo el paso, se para
    // (los frenos van con dtRatio: frenan lo mismo por segundo a 60 o a 20 cuadros por segundo)
    if (alto) { fwd = 0; const k = Math.pow(.86, dtRatio || 1); RigidBody.vx[i] *= k; RigidBody.vy[i] *= k; }
    else if (kmh > maxKmh) { fwd = 0; if (kmh > maxKmh * 1.06) { const k = Math.pow(.97, dtRatio || 1); RigidBody.vx[i] *= k; RigidBody.vy[i] *= k; } }
    else fwd *= Math.max(.2, Math.min(1, (maxKmh - kmh) / (maxKmh * .3)));
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
for (let i = 0; i < (META.hojasCaras || 0); i++) SHEETS['caras' + i] = { json: BARRIO + 'img/caras' + i + '.json', png: BARRIO + 'img/caras' + i + '.png' };
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
    decoration: { maxDecorations: META.nPiezas + (META.nTiles || 0) + META.nPiezasArboles + 2 * META.nProps + META.nArboles + META.nCables + (META.nLineas || 0) + 8 * ((META.transito && META.transito.n) || 0) + 3000, maxAttachedDecorationsPerEntity: 255 },
    // mallas: las sombras de las casas (sus volúmenes: unos 78 mil vértices en Carabobo, más de 65 535, así que los índices van de
    // 32 bits) y las de los autos (8 cada uno)
    renderer: { backend: 'webgl', ySort: true, maxMeshVerts: MALLA_V, maxMeshIndices: MALLA_I },
    // las casas son decoraciones: que no se desvanezcan al alejar
    preRender: { startFadingDecorationsAtZoom: .2, hideDecorationsAtZoom: .1, cullingRatio: .3 },
    lighting: {
      // groundScaleY: el piso se ve aplastado a SYN (0,5), así que los charcos de luz de los faroles son elipses
      enabled: true, raycasted: RAYCAST, lightGlow: 'sprite', baseAmbient: .04, maxLights: 1024, groundScaleY: META.SYN,
      shadowsEnabled: true, maxShadowCastingLights: 16, maxShadowsPerLight: 64, maxShadowsPerEntity: 2, shadowTextures: SOMBRA_TEX,
      resolution: .25, shadowResolution: .25,
      // sol del sudoeste (igual que la luz horneada de las casas); arranca al atardecer para ver las luces enseguida
      sun: { enabled: true, angle: 135, elevation: 40, intensity: 1, color: 0xfff4e0, shadowAlpha: .5, startHour: 17.5,
        dayCycle: { enabled: true, speed: 1, dayDurationMinutes: 8 },
        night: { intensity: LUNA_I, color: LUNA, from: .4, to: .1 } },
    },
    navigation: { enabled: true, cellSize: 64 },
    layers: {
      piso: { zIndex: .5, shader: {
        fragment: { webgl: 'shaders/piso.frag' }, worldRect: { width: META.WW, height: META.WH },
        textures: [{ name: 'cellA', format: 'rgba8unorm', size: { width: META.CW, height: META.CH } }, { name: 'cellB', format: 'rgba8unorm', size: { width: META.CW, height: META.CH } },
          { name: 'wealth', format: 'r8unorm', size: { width: META.WG, height: META.HG } }, { name: 'noiseT', format: 'rgba8unorm', size: { width: 256, height: 256 } },
          { name: 'segs', format: 'rgba8unorm', size: { width: 12, height: META.NS } }, { name: 'pits', format: 'rgba8unorm', size: { width: META.PW || 1, height: META.PH || 1 } }],
        uniforms: { uMW: f32(META.MW), uMH: f32(META.MH), uK: f32(META.K), uSF: f32(META.SF), uSYN: f32(META.SYN), uGC: f32(META.GC), uCW: f32(META.CW), uCH: f32(META.CH), uWG: f32(META.WG), uHG: f32(META.HG), uPW: f32(META.PW || 1), uPH: f32(META.PH || 1),
          uRX: f32(ROT0 ? ROT0.mx : 0), uRY: f32(ROT0 ? ROT0.my : 0), uRI: f32(ROT0 ? ROT0.ri : 0), uRE: f32(ROT0 ? ROT0.re : 0) } } },
      // manchas, roturas y basura del piso (gd_*): arriba del piso, debajo de las sombras
      manchas: { zIndex: 1.4, ySorting: false, maxItems: Math.max(6000, META.nProps + (META.nLineas || 0)) },
      // las sombras de casas y autos: volúmenes en negro opaco que la placa corre con el sol (sunProjected). alphaBySun 'shadow'
      // las deja tan oscuras como la sombra de una persona y las apaga de noche; la capa se compone una sola vez, así que dos
      // sombras que se pisan no oscurecen doble
      sombrasCasas: { kind: LAYER_KIND.MESH, zIndex: 1.5, sunProjected: true },   // alphaBySun 'shadow' por defecto
      // las sombras horneadas de los objetos (sprites con su propia transparencia): se desvanecen con el sol, de 0 con
      // intensidad 0,143 a 1 con 0,857
      sombras: { zIndex: 1.6, ySorting: false, maxItems: Math.max(3000, META.nProps + META.nArboles), alphaBySun: { from: .143, to: .857 } },
      cables: { zIndex: 3.5, ySorting: false, maxItems: Math.max(4000, META.nCables + 500) },
      // aditivas de verdad (WeedJS compone las capas de sprites con shader.containerBlend, no con blendMode)
      brillos: { zIndex: 5.5, blendMode: BLEND_MODES.ADD, shader: { containerBlend: BLEND_MODES.ADD }, ySorting: false, maxItems: 1000 },
      // brillos de las lámparas de los faroles (los de los faros van con las entidades)
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
    [SombrasData, { v: { type: Float32Array, length: Math.max(3, (META.nSombraPts || 0) * 3) }, t: { type: Uint16Array, length: Math.max(3, (META.nSombraPts || 0) * 6) } }],
    [Transito, { grid: { type: Uint16Array, length: Math.max(1, TR.W * TR.H) }, cruces: { type: Float32Array, length: Math.max(6, TR.n * 6) } }],
    [Semaforos, { ids: { type: Int32Array, length: Math.max(4, (TR.nSem || 0) * 4) } }],
  ];
  static entities = [[Casa, META.nCasas + 8], [SombraCasa, META.nCasas + 8], [Arbol, META.nArboles + 8], [Prop, META.nProps + 64], [Persona, GENTE_MAX], [AutoIA, Math.max(8, META.nAutos)], [AutoEstacionado, Math.max(8, META.nAutos)], [Chatarra, 64], [AutoJugador, 1]];

  // la sombra de una casa: su volumen, de los puntos de sus cajas, va a SombrasData (la entidad lo lee desde su worker)
  _sombra(h) {
    if (h.sp && h.sp.length >= 12) { const off = this._sombraV, toff = this._sombraT, n = h.sp.length / 3;
      const nv = volumenSombra(h.sp, 0, n, META.CZ * META.SF, SombrasData.v.subarray(off * 3), SombrasData.t.subarray(toff)), tn = volumenSombra.nt;
      if (nv) { this._sombraV += nv; this._sombraT += tn; SombraCasa.spawn({ x: h.x, y: h.y, off, n: nv, toff, tn }); } }
    else if (h.sh) SombraCasa.spawn({ x: h.x, y: h.y, sh: h.sh });
  }
  // ---------- de noche, las caras de las casas que le dan la espalda a los faroles se apagan
  // La luz de WeedJS es una cuenta por píxel de pantalla: el charco de un farol aclara todo lo que se dibuja ahí, sin saber hacia
  // dónde mira cada pared. Las piezas de las caras traen del editor su normal y su altura: al cargar, cada pieza guarda cuánto le
  // llega (w) y cuánto mira (c: el coseno por 2, hasta 1; una cara de frente o de tres cuartos cuenta entera) a los faroles que
  // tiene cerca (hasta 4), y de noche su tinte se oscurece según cuánto les da la
  // espalda a los que están prendidos: tinte · (1 − K · noche · (1 − Σ w·c / Σ w)). El tinte sólo oscurece: el efecto es por
  // contraste. Los faroles son fijos y sus horas salen de su posición (horasLuz), así que el hilo principal sabe cuándo se prende
  // cada uno; los faros de los autos quedan afuera
  _carasFaroles(w) {
    const S = META.SF, K = META.K, SYN = META.SYN, MH = META.MH, CEL = CARAS_R;
    const L = []; const lamp = (x, y, hz) => { const my = MH - y / (SYN * S), mx = x / S - K * my; horasLuz(x, y, _hl); L.push([mx, my, hz, _hl[0], _hl[1]]); };
    for (const p of w.props || []) if (p.r > 0 && p.f && p.f.startsWith('u_farol')) lamp(p.x, p.y, p.f.startsWith('u_farola_orn') ? 4 : p.f.startsWith('u_farola') ? 6.5 : 5.5);
    for (const h of w.casas || []) if (h.k === 'poste' && h.l) lamp(h.x, h.y, 5);
    const n = L.length, LX = new Float32Array(n), LY = new Float32Array(n), LZ = new Float32Array(n), LP = new Float32Array(n), LA = new Float32Array(n);
    const grid = new Map(), clave = (gx, gy) => gx * 100003 + gy;
    L.forEach((l, k) => { LX[k] = l[0]; LY[k] = l[1]; LZ[k] = l[2]; LP[k] = l[3]; LA[k] = l[4];
      const g = clave(Math.floor(l[0] / CEL), Math.floor(l[1] / CEL)); let a = grid.get(g); if (!a) grid.set(g, a = []); a.push(k); });
    this._cf = { n, LX, LY, LZ, LP, LA, grid, clave, on: new Uint8Array(n).fill(2), di: [], tn: [], l: [], wv: [], wc: [], m: -1, sucio: 0 };
  }
  // los faroles cuya lámpara queda detrás de una casa: la lámpara (a la altura del farol, como en _carasFaroles) cae dentro del
  // dibujo de la casa (la envolvente de su planta y de sus puntos de sombra subidos a su altura) y el pie del farol está más
  // atrás que el frente de la casa en esa x. Los faroles no se mueven: se calcula una vez, al cargar
  _lamparasTapadas(w) {
    const KZ = META.CZ * META.SF, G = 256, grilla = new Map(), out = new Set();
    for (const h of w.casas || []) { if (!h.col || !h.sp) continue;
      const pie = h.col.map(([x, y]) => [h.x + x, h.y + y]), P = pie.slice();
      for (let i = 0; i < h.sp.length; i += 3) P.push([h.x + h.sp[i], h.y + h.sp[i + 1] - h.sp[i + 2] * KZ]);
      let x0 = Infinity, x1 = -Infinity; for (const q of pie) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; }
      const c = { pie, sil: envolvente(P), x0, x1 };
      for (let g = Math.floor(x0 / G); g <= Math.floor(x1 / G); g++) { let l = grilla.get(g); if (!l) grilla.set(g, l = []); l.push(c); } }
    for (const p of w.props || []) { if (!(p.r > 0) || !p.f || !p.f.startsWith('u_farol')) continue;
      const hz = p.f.startsWith('u_farola_orn') ? 4 : p.f.startsWith('u_farola') ? 6.5 : 5.5, hy = p.y - hz * KZ, l = grilla.get(Math.floor(p.x / G));
      if (l) for (const c of l) if (p.x >= c.x0 && p.x <= c.x1 && dentroConvexo(c.sil, p.x, hy) && p.y < frenteEn(c.pie, p.x)) { out.add(p); break; } }
    return out;
  }
  // una pieza de cara: x, y en pantalla (px de mundo); t[10..12] su normal, t[13] la altura de su centro (m)
  _caraPieza(di, sx, sy, t) {
    const F = this._cf; if (!F || !F.n) return;
    const S = META.SF, z = t[13], my = META.MH - (sy + z * META.CZ * S) / (META.SYN * S), mx = sx / S - META.K * my, nx = t[10], ny = t[11], nz = t[12];
    const gx = Math.floor(mx / CARAS_R), gy = Math.floor(my / CARAS_R), cand = [];
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++) { const a = F.grid.get(F.clave(ix, iy)); if (!a) continue;
      for (const k of a) { const dx = F.LX[k] - mx, dy = F.LY[k] - my, dz = F.LZ[k] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > CARAS_R * CARAS_R) continue;
        const d = Math.sqrt(d2) || 1, c = Math.min(1, 2 * Math.max(0, (nx * dx + ny * dy + nz * dz) / d)), wgt = 1 / (1 + d2 / (CARAS_R0 * CARAS_R0)); cand.push([wgt, k, c]); } }
    if (!cand.length) return;
    cand.sort((a, b) => b[0] - a[0]); if (cand.length > 4) cand.length = 4;
    const q = F.di.length; F.di.push(di); F.tn.push(t[7]);
    for (let j = 0; j < 4; j++) { const e = cand[j]; F.l.push(e ? e[1] : -1); F.wv.push(e ? e[0] : 0); F.wc.push(e ? e[0] * e[2] : 0); }
  }
  _carasListas() {
    const F = this._cf; if (!F) return;
    F.di = Int32Array.from(F.di); F.tn = Uint32Array.from(F.tn); F.l = Int32Array.from(F.l); F.wv = Float32Array.from(F.wv); F.wc = Float32Array.from(F.wc);
    F.cuenta = F.di.length; F.sucio = F.cuenta; F.pos = 0; F.t = 0;
  }
  // en update: cada cuarto de segundo mira la noche y qué faroles están prendidos; si algo cambió, vuelve a teñir las piezas con
  // faroles, de a CARAS_POR_CUADRO por cuadro
  carasFaroles() {
    const F = this._cf; if (!F || !F.cuenta) return;
    const ahora = Date.now();
    if (ahora - F.t >= 250) { F.t = ahora;
      const h = Sun.hour, m = Sun.nightFactor || 0; let cambio = Math.abs(m - F.m) > .03;
      for (let k = 0; k < F.n; k++) { const on = h >= F.LP[k] || h < F.LA[k] ? 1 : 0; if (on !== F.on[k]) { F.on[k] = on; cambio = true; } }
      if (cambio) { F.m = m; F.sucio = F.cuenta; F.pos = 0; } }
    if (!F.sucio) return;
    const T = WEED.DecorationComponent && WEED.DecorationComponent.tint; if (!T) return;
    const fin = Math.min(F.cuenta, F.pos + CARAS_POR_CUADRO), m = F.m;
    for (let q = F.pos; q < fin; q++) {
      let wv = 0, wc = 0; for (let j = 0; j < 4; j++) { const k = F.l[q * 4 + j]; if (k < 0 || !F.on[k]) continue; wv += F.wv[q * 4 + j]; wc += F.wc[q * 4 + j]; }
      const b = F.tn[q], f = wv > .05 ? 1 - CARAS_K * m * (1 - wc / wv) : 1;
      T[F.di[q]] = f >= .999 ? b : ((((b >> 16) & 255) * f) << 16) | ((((b >> 8) & 255) * f) << 8) | ((b & 255) * f);
    }
    F.sucio -= fin - F.pos; F.pos = fin;
  }
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
    // ---- tránsito: la grilla (velocidades, esquinas) y los cruces (con o sin semáforo, rumbo de la primera calle, desfasaje)
    if (TR.n) { const tb = await (await fetch(BARRIO + 'transito.bin')).arrayBuffer(); Transito.grid.set(new Uint16Array(tb));
      (w.cruces || []).forEach((c, k) => { for (let q = 0; q < 6; q++) Transito.cruces[k * 6 + q] = c[q]; }); }
    this._sombraV = 0; this._sombraT = 0;   // sombras de las casas: cuántos vértices y triángulos van en SombrasData
    this._sem = [];   // los semáforos: cruce, calle y número (sus luces, en Semaforos.ids)
    this._carasFaroles(w);   // los faroles, para las caras de las casas de noche (antes de armar las casas)
    if (META.skew) {
      // casas por caras (WeedJS DX-DECOSKEW): la entidad lleva el colisionador; el dibujo son piezas de caras planas, decoraciones
      // del mundo (no colgadas: la casa no se mueve, así no pasan por el paso de las colgadas cada cuadro), cada una con su
      // escala, skew, tinte de luz, y orden (sortOffsetY: la base de su columna; innerZ: el orden de pintor dentro de la casa).
      // Un solo objeto de configuración para todas: cargar no crea basura por pieza.
      const cfg = { x: 0, y: 0, texture: '', scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, tint: 0xffffff, sortOffsetY: 0, innerZ: 0, anchorX: .5, anchorY: .5 };
      for (const h of w.casas) { Casa.spawn({ x: h.x, y: h.y, col: h.col, r: h.r, k: h.k, l: h.l });
        this._sombra(h);
        const V = w.variantes[h.v];
        for (let i = 0; i < V.length; i++) { const t = V[i];
          cfg.x = h.ox + t[1]; cfg.y = h.oy + t[2]; cfg.texture = t[0]; cfg.scaleX = t[3]; cfg.scaleY = t[4]; cfg.skewX = t[5]; cfg.skewY = t[6];
          cfg.tint = t[7]; cfg.sortOffsetY = t[8]; cfg.innerZ = t[9]; const di = Decoration.spawn(cfg);
          if (t.length >= 14 && di >= 0) this._caraPieza(di, cfg.x, cfg.y, t); } }
      this._carasListas();
    } else for (const h of w.casas) { Casa.spawn({ x: h.x, y: h.y, col: h.col, r: h.r, k: h.k, l: h.l, fr: w.franjas[h.a], t: 'casas' + h.o + '_' + h.a + '_', e: META.escalaCasas || 1 });
      this._sombra(h); }
    const tapadas = this._lamparasTapadas(w); this.lamparasTapadas = tapadas.size;
    for (const p of w.props) {
      if (p.sh && !(p.r > 0)) { const a = META.anclas[p.sh]; Decoration.spawn({ x: p.x, y: p.y, texture: 'props_' + p.sh, anchorX: a[0], anchorY: a[1], alpha: .45, layer: 'sombras' }); }
      if (p.r > 0) { let sk = -1; if (p.f === 'u_semaforo' && p.cr >= 0 && this._sem.length < (TR.nSem || 0)) { sk = this._sem.length; this._sem.push({ cid: p.cr, eje: p.ej, sk, f: -1 }); }
        Prop.spawn({ x: p.x, y: p.y, f: p.f, r: p.r, fl: p.fl, sk, tp: tapadas.has(p) ? 1 : 0 }); }
      else { const a = META.anclas[p.f], e = (META.escalas && META.escalas[p.f]) || 1, mece = p.f.startsWith('plm_') || p.f.startsWith('yy_');   // plantas que se mecen (skew: la base queda fija)
        Decoration.spawn({ x: p.x, y: p.y, texture: 'props_' + p.f, anchorX: a[0], anchorY: a[1], scaleX: p.fl ? -e : e, scaleY: e,
          ...(mece ? { swaySkew: 1, swayAmplitude: .05 + rng() * .05, swayFrequency: .5 + rng() * .6 } : {}),
          ...(p.f.startsWith('gd_') ? { layer: 'manchas' } : {}) }); }   // manchas y roturas: pegadas al piso, debajo de todo
    }
    const ash = META.anclas.sh_tree;
    // la mancha horneada (una elipse fija debajo del tronco) sólo para los árboles sin silueta: los que la tienen ya proyectan
    // su sombra de verdad con el sol (ShadowCaster), y al atardecer quedaba la elipse sola debajo de cada árbol
    for (const a of w.arboles) { const T = w.arbolTipos[a.t]; Arbol.spawn({ x: a.x, y: a.y, fl: a.fl, r: a.r, tipo: T }); if (ash && !T.sil) Decoration.spawn({ x: a.x, y: a.y, texture: 'props_sh_tree', anchorX: ash[0], anchorY: ash[1], alpha: .4, layer: 'sombras' }); }
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
  // semáforos: cada cuarto de segundo, la luz de la fase de su cruce (la misma cuenta que usan los autos)
  luces() { const ahora = Date.now(); if (!this._sem || !this._sem.length || ahora - (this._lucesT || 0) < 250) return; this._lucesT = ahora;
    const { Decoration } = WEED, al = (i, v) => { const d = i >= 0 ? Decoration.get(i) : null; if (d) d.alpha = v; };
    for (const S of this._sem) { const f = faseSemaforo(S.cid, S.eje); if (f === S.f) continue; const o = S.sk * 4, ids = Semaforos.ids;
      if (!ids[o] || !ids[o + 3]) continue; S.f = f;   // el semáforo todavía no armó sus luces
      al(ids[o] - 1, f === 2 ? .95 : 0); al(ids[o + 1] - 1, f === 1 ? .95 : 0); al(ids[o + 2] - 1, f === 0 ? .95 : 0); al(ids[o + 3] - 1, f === 2 ? 0 : .95); } }
  update(dtRatio = 1) {
    this.luces();
    this.carasFaroles();
    this.afinarGente();
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
