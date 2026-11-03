// ===================== variantesScene.js — cómo achicar los dibujos de Gemini, uno al lado del otro =====================
// Cada objeto en un bloque: Gemini tal cual (la placa de video lo achica en cada cuadro), como está hoy (pixelar.py) y
// achicado antes por 2x…8x con cuatro métodos. Todos a su tamaño real, al lado de una persona LPC.
// ?filtro=linear (el del juego hoy) | nearest | mip (linear con mipmaps). Lo arma herramientas/variantes.py.
import { VARIANTES } from './pruebas/variantes/variantes.js';

const { Scene, GameObject, SpriteRenderer, Camera, Mouse, Keyboard } = WEED;
const Q = new URLSearchParams(typeof globalThis.location?.search === 'string' ? globalThis.location.search : '');
const FILTRO = Q.get('filtro') || 'linear';
const SUELO = { pasto: 0x4f7a3a, vereda: 0x9a968c };

export class Cosa extends GameObject {
  static isStatic = true;
  static components = [SpriteRenderer];
  onSpawned(c = {}) {
    if (c.lpc) { this.setSpritesheet('lpc0'); this.setAnimation('idle_down'); this.spriteRenderer.anchorX = .5; this.spriteRenderer.anchorY = .93; this.setScale(.6, .6); return; }
    if (c.f === '_white') this.setSprite('_white'); else this.setSprite('var', c.f, 0);
    this.spriteRenderer.anchorX = c.ax ?? .5; this.spriteRenderer.anchorY = c.ay ?? 1;
    this.setScale(c.sx ?? c.s, c.sy ?? c.s);
    if (c.tint != null) this.spriteRenderer.tint = c.tint;
    if (c.capa) this.setLayer(c.capa);
  }
}

export class VariantesScene extends Scene {
  static config = {
    worldWidth: VARIANTES.WW, worldHeight: VARIANTES.WH, seed: 1,
    renderer: { backend: 'webgl', ySort: true, atlasScaleMode: FILTRO === 'nearest' ? 'nearest' : 'linear', autoGenerateMipmaps: FILTRO === 'mip' },
    decoration: { maxDecorations: 16 },
    layers: { fondo: { zIndex: .5, ySorting: false, maxItems: 64 }, rotulos: { zIndex: 6, ySorting: false, maxItems: 1200 } },
  };
  static assets = { spritesheets: {
    var: { json: new URL('./pruebas/variantes/variantes.json', import.meta.url).href, png: new URL('./pruebas/variantes/variantes.png', import.meta.url).href },
    lpc0: { json: new URL('./img/lpc/civil1.json', import.meta.url).href, png: new URL('./img/lpc/c3.png', import.meta.url).href },
  } };
  static entities = [[Cosa, 1600]];

  create() {
    for (const b of VARIANTES.blocks) {
      // el suelo del bloque: un cuadro blanco de 8 px teñido
      Cosa.spawn({ f: '_white', x: (b.x0 + b.x1) / 2, y: b.y1, sx: (b.x1 - b.x0) / 8, sy: (b.y1 - b.y0) / 8, ay: 1, tint: SUELO[b.suelo], capa: 'fondo' });
      Cosa.spawn({ f: b.label, x: b.x0 + 6, y: b.y0 + 16, s: .7, ax: 0, ay: 1, capa: 'rotulos' });
      Cosa.spawn({ lpc: 1, x: b.persona[0], y: b.persona[1] });
      for (const c of b.cells) {
        Cosa.spawn({ f: c.f, x: c.x, y: c.y, s: c.s });
        Cosa.spawn({ f: c.l, x: c.x, y: c.y + 11, s: .4, ay: 1, capa: 'rotulos' });
      }
    }
    this.i = 0; this.zoomT = 1.75; this.go(0);
    window.__variantes = this;
  }
  go(i) {
    const B = VARIANTES.blocks; this.i = (i + B.length) % B.length; const b = B[this.i];
    this.fx = (b.x0 + b.x1) / 2; this.fy = (b.y0 + b.y1) / 2;
    Camera.setZoom(this.zoomT); Camera.centerOn(this.fx, this.fy);
  }
  update(dtRatio = 1) {
    const z = Camera.zoom || 1;
    if (Mouse.count === 1) { const cx = Mouse.canvasXAt(0), cy = Mouse.canvasYAt(0);
      if (this._drag) { this.fx -= (cx - this._drag[0]) / z; this.fy -= (cy - this._drag[1]) / z; } this._drag = [cx, cy]; }
    else this._drag = null;
    if (Mouse.wheel) this.zoomT = Math.max(.5, Math.min(6, this.zoomT * Math.exp(-Mouse.wheel * .0012)));
    const pan = 12 / z * dtRatio;
    if (Keyboard.a || Keyboard.arrowleft) this.fx -= pan; if (Keyboard.d || Keyboard.arrowright) this.fx += pan;
    if (Keyboard.w || Keyboard.arrowup) this.fy -= pan; if (Keyboard.s || Keyboard.arrowdown) this.fy += pan;
    Camera.setZoom(this.zoomT); Camera.centerOn(this.fx, this.fy);
  }
}
