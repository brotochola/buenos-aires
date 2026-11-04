// ===================== sombrasScene.js — banco de pruebas de las sombras (sombras.html) =====================
// Piso liso y claro, el sol quieto a la hora que se elija, y una grilla de cosas que proyectan: autos de varios modelos en
// todos los rumbos, gente LPC y árboles del editor (con su silueta). Sirve para ver cómo dibuja WeedJS las sombras del sol
// (ShadowCaster) sin el resto del barrio encima. ?hora=15 · ?sa=.3 (shadowAlpha) · ?zoom=1.6 · ?barrio=parquechas (árboles)
import { BARRIOS } from './barrios.js';
import { AUTOS, CHATARRA } from './img/autos/autos.js';
import { APOYO } from './img/autos/apoyo.js';
import { sombraAuto, altoAuto } from './sombraAuto.js';

const { Scene, GameObject, RigidBody, Collider, SpriteRenderer, MeshRenderer, ShadowCaster, SpriteSheetRegistry, Camera, Mouse, Keyboard, Sun, Decoration, LAYER_KIND, enums } = WEED;
const { ShapeType } = enums;
const Q = new URLSearchParams(typeof globalThis.location?.search === 'string' ? globalThis.location.search : '');
const DIR = (() => { try { const b = new URL(import.meta.url).searchParams.get('barrio'); return b && BARRIOS[b] ? b : 'parquechas'; } catch (e) { return 'parquechas'; } })();
const META = BARRIOS[DIR];
const BARRIO = new URL('./' + DIR + '/', import.meta.url).href;
const u = (p) => new URL(p, import.meta.url).href;

const AUTOS_MED = Object.fromEntries(Object.entries({ ...AUTOS, ...CHATARRA }).map(([m, d]) => [m.split('_')[0], [d.largo, d.ancho]]));
const PISO_SHADER = (() => { try { return new URL(import.meta.url).searchParams.get('piso') === 'shader'; } catch (e) { return false; } })();
const VIEJO = Q.get('autos') === 'viejo';   // ?autos=viejo: la sombra de antes (ShadowCaster del sprite)
const _sb = new Float32Array(16);
export const MODELOS = ['hatch_rojo', 'pickup_blanco', 'colectivo_azul', 'camion_rojo', 'policia', 'sedan_blanco'];
export const RUMBOS = 16;                       // rumbos de pantalla por fila (cada 22,5°)
const WW = 2400, WH = 1600, PASO = 130, FILA = 120, X0 = 140, Y0 = 220;

// las mismas cuentas que el juego (conurbanoScene.js): el cuadro sale del rumbo de pantalla, los que miran a la izquierda son espejos
const _keys = new Map();
function angleKeys(sheet) {
  let k = _keys.get(sheet); if (k) return k;
  const names = SpriteSheetRegistry.getAnimationNames(sheet) || [], base = names.map(n => ({ n, a: parseFloat(n), f: 0 })).filter(o => !isNaN(o.a));
  const hay = new Set(base.map(o => (o.a % 360 + 360) % 360)), todos = base.slice();
  for (const o of base) { const m = ((180 - o.a) % 360 + 360) % 360; if (!hay.has(m)) { hay.add(m); todos.push({ n: o.n, a: m, f: 1 }); } }
  k = todos.map(o => ({ n: o.n, c: Math.cos(o.a * Math.PI / 180), s: Math.sin(o.a * Math.PI / 180), f: o.f }));
  _keys.set(sheet, k); return k;
}

export class CocheP extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, MeshRenderer, ShadowCaster];
  onSpawned(c = {}) {
    this.rigidBody.static = 1;
    this.collider.shapeType = ShapeType.Circle; this.collider.radius = 4; this.collider.visualRange = 160;
    this.rotation = c.rot;
    const hoja = 'auto_' + c.hoja; this.setSpritesheet(hoja);
    this.spriteRenderer.anchorX = .5; this.spriteRenderer.inheritTransformRotation = 0; this.spriteRenderer.spriteRotation = 0;
    const ks = angleKeys(hoja), cc = Math.cos(c.rot), ss = Math.sin(c.rot); let best = 0, bd = -2;
    for (let k = 0; k < ks.length; k++) { const d = cc * ks[k].c + ss * ks[k].s; if (d > bd) { bd = d; best = k; } }
    const k = ks[best]; this.setAnimation(k.n); this.flipX = k.f === 1;
    const ap = APOYO[c.hoja]; this.spriteRenderer.anchorY = (ap && ap[k.n]) || .5;
    this.shadowCaster.heightMultiplier = VIEJO ? .55 : 0;
    this._hoja = c.hoja; this._rot = c.rot; this._dx = NaN; this._dy = NaN; this._mesh = false;
    if (!VIEJO) { this.setLayer('sombrasCasas'); this.meshRenderer.tint = 0x000000; this.meshRenderer.alpha = .3; this.sombra(); }
  }
  // la huella del auto (del modelo: medio largo y medio ancho a 9 px por metro) y el techo corrido por el sol
  sombra() {
    const d = AUTOS_MED[this._hoja.split('_')[0]] || [4.4, 1.8], [h, k] = altoAuto(this._hoja), r = Sun.shadowLengthRatio * h;
    const dx = Sun.shadowDirX * r, dy = Sun.shadowDirY * r;
    if (Math.abs(dx - this._dx) + Math.abs(dy - this._dy) < .5) return;
    this._dx = dx; this._dy = dy;
    sombraAuto(_sb, Math.cos(this._rot), Math.sin(this._rot), d[0] * 9, d[1] * 9, dx, dy, k);
    if (this._mesh) this.meshRenderer.setVertices(_sb); else { this.meshRenderer.setMesh(_sb); this._mesh = true; }
  }
  tick() { if (!VIEJO) this.sombra(); }
}
export class GenteP extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster];
  onSpawned(c = {}) {
    this.rigidBody.static = 1; this.collider.shapeType = ShapeType.Circle; this.collider.radius = 3; this.collider.visualRange = 60;
    this.setSpritesheet('lpc0'); this.setAnimation(c.anim || 'idle_down');
    this.spriteRenderer.anchorX = .5; this.spriteRenderer.anchorY = .93; this.setScale(.6 * .94, .6);
    this.shadowCaster.heightMultiplier = 1.2;
  }
}
// el árbol igual que en el juego: silueta invisible que proyecta, piezas (tronco y ramas) como decoraciones
export class ArbolP extends GameObject {
  static isStatic = true;
  static components = [RigidBody, Collider, SpriteRenderer, ShadowCaster];
  onSpawned(c = {}) {
    this.rigidBody.static = 1; this.collider.shapeType = ShapeType.Circle; this.collider.radius = 3; this.collider.visualRange = 200;
    const T = c.tipo, E = T.escala || .6, S = T.sil, fl = c.fl ? -1 : 1;
    if (S) { this.setSprite('arboles', S[0], 0); this.spriteRenderer.anchorX = S[1]; this.spriteRenderer.anchorY = S[2]; this.setScale(E / S[3] * fl, E / S[3]); this.alpha = c.verSil ? .5 : 0; }
    this.shadowCaster.heightMultiplier = S ? 1 : 0;
    for (const p of T.piezas) this.addDecoration('arboles_' + p[0], p[1] * fl, p[2], E * fl, E, p[5], { anchorX: p[3], anchorY: p[4], sortOffsetY: p[5] > 0 ? 25 : 0, ...(c.mece ? { sway: !!p[6], swayAmplitude: .03, swayFrequency: .6 } : {}) });
  }
}

export class SombrasScene extends Scene {
  static config = {
    worldWidth: WW, worldHeight: WH, seed: 3,
    renderer: { backend: 'webgl', ySort: true, maxMeshVerts: 4000, maxMeshIndices: 0 },
    physics: { gravity: { x: 0, y: 0 } },
    decoration: { maxDecorations: 4000, maxAttachedDecorationsPerEntity: 64 },
    lighting: {
      enabled: true, lightGlow: 'add', baseAmbient: .1, maxLights: 64,
      shadowsEnabled: true, maxShadowCastingLights: 16, maxShadowsPerLight: 64, maxShadowsPerEntity: 2,
      resolution: .25, shadowResolution: .25,
      sun: { enabled: true, angle: 135, elevation: 40, intensity: 1, color: 0xfff4e0, shadowAlpha: .5, startHour: 15, dayCycle: { enabled: false } },
    },
    // ?piso=shader: el piso como el del barrio (capa worldRect con shader), para ver si las sombras del sol caen sobre él
    layers: { ...(PISO_SHADER ? { piso: { zIndex: .5, shader: { fragment: { webgl: 'pruebas/sombras/piso.frag' }, worldRect: { width: WW, height: WH },
      textures: [{ name: 'nada', format: 'r8unorm', size: { width: 4, height: 4 } }], uniforms: { uK: { value: 1, type: 'f32' } } } } } : {}), sombrasCasas: { kind: LAYER_KIND.MESH, zIndex: 1.5 }, fondo: { zIndex: .5, ySorting: false, maxItems: 4000 }, sombras: { zIndex: 1.6, ySorting: false, maxItems: 2000 }, rotulos: { zIndex: 6, ySorting: false, maxItems: 400 } },
  };
  static assets = { spritesheets: {
    arboles: { json: BARRIO + 'img/arboles.json', png: BARRIO + 'img/arboles.png' },
    props: { json: BARRIO + 'img/props.json', png: BARRIO + 'img/props.png' },
    lpc0: { json: u('./img/lpc/civil1.json'), png: u('./img/lpc/c3.png') },
    ...Object.fromEntries(MODELOS.map(m => ['auto_' + m, { json: u('./img/autos/' + m + '.json'), png: u('./img/autos/' + m + '.png') }])),
  } };
  static entities = [[CocheP, MODELOS.length * RUMBOS + 8], [GenteP, 32], [ArbolP, 16]];

  async preload() {
    // piso: baldosas claras de 80×40 (dos tonos, en damero) para ver bien la forma de cada sombra; chicas porque las
    // decoraciones se recortan por su punto
    if (!PISO_SHADER) for (let y = 20; y < WH; y += 40) for (let x = 40; x < WW; x += 80)
      Decoration.spawn({ x, y, texture: '_white', anchorX: .5, anchorY: .5, scaleX: 79 / 8, scaleY: 39 / 8, tint: ((x / 80 | 0) + (y / 40 | 0)) & 1 ? 0xc9c4b8 : 0xc2bdb1, layer: 'fondo' });
    // autos: una fila por modelo, un rumbo de pantalla por columna (0° = mira a la derecha, 90° = hacia abajo)
    MODELOS.forEach((m, f) => { for (let r = 0; r < RUMBOS; r++) CocheP.spawn({ x: X0 + r * PASO, y: Y0 + f * FILA, hoja: m, rot: r * Math.PI * 2 / RUMBOS }); });
    // gente y árboles abajo de los autos
    const yG = Y0 + MODELOS.length * FILA + 40;
    for (let i = 0; i < 8; i++) GenteP.spawn({ x: X0 + i * 60, y: yG, anim: ['idle_down', 'idle_left', 'idle_up', 'idle_right'][i % 4] });
    try {
      const w = await (await fetch(BARRIO + 'mundo.json')).json(), tipos = Object.keys(w.arbolTipos).filter(t => !t.endsWith('_c')).slice(0, 6), ash = (w && META.anclas.sh_tree) || null;
      tipos.forEach((t, i) => { const x = X0 + 600 + i * 260, y = yG + 260; ArbolP.spawn({ x, y, tipo: w.arbolTipos[t], verSil: Q.has('silueta'), fl: i & 1, mece: Q.has('mece') });
        if (Q.has('viejas') && ash) Decoration.spawn({ x, y, texture: 'props_sh_tree', anchorX: ash[0], anchorY: ash[1], alpha: .4, layer: 'sombras' }); });
    } catch (e) { console.error('árboles', e); }
  }
  create() {
    this.hora = +(Q.get('hora') || 15); Sun.setTimeOfDay(this.hora);
    if (Q.has('sa')) Sun.shadowAlpha = +Q.get('sa');
    this.fx = +(Q.get('x') || WW / 2); this.fy = +(Q.get('y') || 560); this.zoomT = +(Q.get('zoom') || 1);
    Camera.setZoom(this.zoomT); Camera.centerOn(this.fx, this.fy);
    window.__sombras = this;
  }
  ir(x, y, z) { this.fx = x; this.fy = y; if (z) this.zoomT = z; }
  setHora(h) { this.hora = ((h % 24) + 24) % 24; Sun.setTimeOfDay(this.hora); if (Q.has('sa')) Sun.shadowAlpha = +Q.get('sa'); return this.hora; }
  update(dtRatio = 1) {
    const z = Camera.zoom || 1;
    if (Mouse.count === 1) { const cx = Mouse.canvasXAt(0), cy = Mouse.canvasYAt(0);
      if (this._drag) { this.fx -= (cx - this._drag[0]) / z; this.fy -= (cy - this._drag[1]) / z; } this._drag = [cx, cy]; }
    else this._drag = null;
    if (Mouse.wheel) this.zoomT = Math.max(.3, Math.min(6, this.zoomT * Math.exp(-Mouse.wheel * .0012)));
    const pan = 12 / z * dtRatio;
    if (Keyboard.a || Keyboard.arrowleft) this.fx -= pan; if (Keyboard.d || Keyboard.arrowright) this.fx += pan;
    if (Keyboard.w || Keyboard.arrowup) this.fy -= pan; if (Keyboard.s || Keyboard.arrowdown) this.fy += pan;
    Camera.setZoom(this.zoomT); Camera.centerOn(this.fx, this.fy);
  }
}
