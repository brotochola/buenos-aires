// ===================== houses.js — casas del conurbano (frente, contrafrente, medianeras) =====================
// Coordenadas locales en metros: frente sobre y=0 mirando a -y (hacia la calle), x de 0 a W, fondo hacia +y.
const Houses = (() => {
  const { Tex, Scene, rng, mul, add, mix, px, text, textW } = R3;
  const WALLS = [[222, 198, 156], [212, 182, 140], [232, 212, 174], [198, 164, 124], [226, 158, 124], [158, 190, 206], [118, 186, 176],
    [234, 226, 208], [216, 180, 108], [186, 196, 148], [108, 148, 196], [204, 118, 90], [182, 176, 166], [226, 204, 188], [168, 206, 160], [238, 222, 150],
    [240, 196, 196], [196, 222, 226], [214, 232, 196], [246, 226, 160], [232, 176, 150], [206, 190, 222], [250, 244, 232], [160, 196, 170]];
  const SHUTTER = [[44, 92, 64], [32, 82, 70], [38, 70, 104], [110, 64, 38], [52, 52, 58], [128, 40, 38]];
  const WOOD = [120, 74, 44];
  const SHOPS = [["KIOSCO", [200, 34, 34]], ["ALMACEN", [36, 120, 64]], ["VERDULERIA", [40, 128, 56]], ["CARNICERIA", [196, 32, 36]],
    ["PANADERIA", [214, 150, 70]], ["FERRETERIA", [34, 78, 160]], ["FARMACIA", [24, 96, 168]], ["PELUQUERIA", [34, 36, 46]], ["LIBRERIA", [36, 86, 168]],
    ["ROTISERIA", [214, 108, 30]], ["PIZZERIA", [186, 44, 36]], ["DESPENSA", [140, 36, 86]], ["POLLERIA", [222, 160, 40]], ["LAVADERO", [50, 140, 196]],
    ["BAR", [150, 28, 30]], ["FIAMBRERIA", [120, 40, 30]], ["CERRAJERIA", [214, 166, 30]], ["FOTOCOPIAS", [60, 64, 150]], ["VETERINARIA", [50, 140, 90]],
    ["TALLER", [36, 70, 150]], ["MERCERIA", [180, 60, 120]], ["REMIS", [30, 30, 36]], ["AUTOSERVICIO", [200, 40, 40]], ["GOMERIA", [34, 34, 40]]];
  const GOODS = { VERDULERIA: [[232, 120, 30], [214, 44, 36], [100, 170, 60], [240, 200, 50], [140, 70, 120]], CARNICERIA: [[196, 60, 56], [232, 160, 150], [240, 232, 222]],
    POLLERIA: [[240, 200, 140], [230, 170, 100]], PANADERIA: [[212, 150, 80], [232, 194, 124], [176, 108, 50]], FARMACIA: [[240, 240, 240], [60, 160, 220], [230, 80, 90]],
    LIBRERIA: [[60, 110, 200], [230, 200, 60], [220, 70, 70], [240, 240, 230]], FERRETERIA: [[196, 60, 40], [60, 100, 180], [160, 160, 160], [230, 190, 40]] };
  const PINTADAS = ["EL BARRIO ES NUESTRO", "NO AL AJUSTE", "VAMOS ARGENTINA", "AGUANTE EL BARRIO", "LOS PIBES DEL BARRIO", "TE AMO MARU",
    "PAN Y TRABAJO", "SE VENDE", "ALQUILO", "NO ESTACIONAR", "CUMBIA", "VOLVE NENA", "FELIZ CUMPLE MICA", "ACA NO SE RINDE NADIE"];
  let GF = 3.2, UF = 2.9; const PAR = 0.85;
  // frente de local de Gemini para cada rubro
  const LOC = { PANADERIA: "panaderia", CARNICERIA: "carniceria", POLLERIA: "carniceria", FIAMBRERIA: "carniceria", VERDULERIA: "verduleria", FERRETERIA: "ferreteria",
    CERRAJERIA: "ferreteria", GOMERIA: "ferreteria", TALLER: "ferreteria", KIOSCO: "kiosco", LIBRERIA: "kiosco", FOTOCOPIAS: "kiosco", FARMACIA: "farmacia", VETERINARIA: "farmacia",
    PELUQUERIA: "peluqueria", ALMACEN: "almacen", DESPENSA: "almacen", AUTOSERVICIO: "almacen", BAR: "almacen", ROTISERIA: "almacen", PIZZERIA: "panaderia", MERCERIA: "kiosco" };

  // ---------- piezas pintadas
  function glass(t, x0, y0, x1, y1, curtains = true) {
    for (let y = y0; y < y1; y++) { const f = (y - y0) / Math.max(1, y1 - y0); t.rect(x0, y, x1, y + 1, mix([108, 134, 158], [32, 42, 58], f)); }
    for (let k = 0; k < x1 - x0; k++) if (k % 11 < 3) for (let j = 0; j < 3; j++) { const yy = y0 + ((k * .8) | 0) + j; if (yy < y1) t.tint(x0 + k, yy, x0 + k + 1, yy + 1, [206, 226, 240], .5); }
    if (curtains && t.r() < .65) { const cc = t.r.pick([[236, 230, 214], [222, 200, 160], [204, 220, 232], [230, 196, 196], [200, 220, 190]]), cw = Math.max(2, ((x1 - x0) / 4) | 0);
      t.rect(x0, y0, x0 + cw, y1, mul(cc, .92)); t.rect(x1 - cw, y0, x1, y1, mul(cc, .92)); for (let x = x0; x < x0 + cw; x += 2) t.shade(x, y0, x + 1, y1, .88); }
  }
  // pieza de Gemini para cada estilo (si está cargada); si no, el dibujo procedural de siempre
  const pieza = (style, w, h) => style === "persiana" && h > px(1.8) && R3.DECALS.fd_persiana_madera ? "fd_persiana_madera" : style === "arco" ? "fd_ventana_arco" : style === "persiana" ? "fd_ventana_persiana" : style === "reja" ? "fd_ventana_reja" : style === "cerrado" ? null
    : h < px(.75) ? "fd_ventana_bano" : "fd_ventana_madera";
  function windowDecal(t, x, y, w, h, style, wall) {
    const pz = pieza(style, w, h);
    if (pz && R3.DECALS[pz]) { t.rect(x - 1, y - 1, x + w + 1, y + h + 1, mul(wall, .55)); reveal(t, x, y, w, h, wall); const rv = Math.max(2, Math.round(px(.09)));
      t.blit(pz, x + rv, y + rv + 1, w - rv * 2, h - rv - 1 + (pz === "fd_ventana_bano" ? 0 : Math.round(h * .06)));
      for (let xx = x; xx < x + w; xx += 2) t.shade(xx, y + h + 3, xx + 1, y + h + 3 + t.r.int(2, 9), .93); return; }
    if (style === "reja") style = "none";
    t.rect(x - 1, y - 1, x + w + 1, y + h + 1, mul(wall, .5)); t.rect(x, y, x + w, y + h, mul(wall, .72));
    const fr = t.r() < .65 ? [236, 232, 222] : mul(WOOD, 1.1);
    t.rect(x + 1, y + 1, x + w, y + h, fr); glass(t, x + 3, y + 3, x + w - 2, y + h - 2); t.rect(x + (w >> 1), y + 3, x + (w >> 1) + 1, y + h - 2, fr);
    t.shade(x + 1, y + 1, x + w, y + 3, .68); t.shade(x + 1, y + 1, x + 3, y + h, .76);
    if (style === "persiana") { const ph = ((h - 4) * t.r.uniform(.3, .85)) | 0; for (let yy = y + 3; yy < y + 3 + ph; yy++) t.rect(x + 3, yy, x + w - 2, yy + 1, (yy - y) % 2 ? [178, 152, 112] : [140, 116, 84]); t.rect(x - 1, y - 4, x + w + 1, y - 1, [204, 198, 186]); }
    if (style === "cerrado") { const sc = t.r.pick(SHUTTER); t.rect(x + 2, y + 2, x + w - 1, y + h - 1, sc); for (let yy = y + 3; yy < y + h - 1; yy += 2) t.shade(x + 2, yy, x + w - 1, yy + 1, .7); t.rect(x + (w >> 1), y + 2, x + (w >> 1) + 1, y + h - 1, mul(sc, .5)); }
    for (let xx = x; xx < x + w; xx += 2) t.shade(xx, y + h + 2, xx + 1, y + h + 2 + t.r.int(2, 9), .92);
  }
  // vano con espesor de pared: jamba de arriba en sombra (la luz viene de arriba a la izquierda), jamba izquierda en sombra, derecha iluminada
  function reveal(t, x, y, w, h, wall) { const rv = Math.max(2, Math.round(px(.09)));
    t.rect(x, y, x + w, y + h, mul(wall, .74)); t.rect(x, y, x + w, y + rv + 1, mul(wall, .42)); t.rect(x, y, x + rv, y + h, mul(wall, .55)); t.rect(x + w - rv, y + rv, x + w, y + h, mul(wall, .9)); }
  function doorDecal(t, x, y, w, h, kind, wall) {
    t.rect(x - 1, y - 1, x + w + 1, y + h, mul(wall, .5));
    if (R3.DECALS.fd_puerta_madera) { reveal(t, x, y, w, h, wall); const rv = Math.max(2, Math.round(px(.09))); x += rv; y += rv + 1; w -= rv * 2; h -= rv + 1; }
    const dc = kind === "madera" || !R3.DECALS.fd_puerta_chapa ? null : t.r.pick([[38, 40, 46], [34, 84, 58], [120, 36, 32], [58, 78, 110], [196, 192, 182], [30, 60, 40], [150, 150, 154], [150, 150, 154]]);
    const pz = kind === "chorizo" ? "fd_puerta_chorizo" : kind === "vidrio" ? "fd_puerta_vidrio" : kind === "madera" ? "fd_puerta_madera" : "fd_puerta_chapa";
    if (t.blit(R3.DECALS[pz] ? pz : kind === "chapa" ? "fd_puerta_chapa" : "fd_puerta_madera", x, y, w, h, dc && dc[0] !== 150 && pz === "fd_puerta_chapa" ? mul(dc, 1.25) : null)) {
      const nx = x + w + 3, cuelga = (n, wm, z) => { const d = R3.DECALS[n]; if (d && nx + px(wm) < t.w) { t.blit(n, nx, y + px(z), px(wm), Math.round(px(wm) * d.h / d.w)); return true; } return false; };
      if (t.r() < .3) cuelga("fd_numero", .18, .55); else if (t.r() < .2) cuelga("fd_azulejo_virgen", .2, .45); else if (t.r() < .3) cuelga(t.r() < .5 ? "fd_medidor" : "fd_nicho_medidor", .4, .4);
      if (t.r() < .35 && R3.DECALS.fd_farolito) { const d = R3.DECALS.fd_farolito, fw = px(.3); if (x - fw - 3 > 0) t.blit("fd_farolito", x - fw - 3, y - px(.1), fw, Math.round(fw * d.h / d.w)); }
      return; }
    if (kind === "madera") { const c = mul(WOOD, t.r.uniform(.8, 1.2)); t.rect(x, y, x + w, y + h, c);
      for (const [a0, b0, a1, b1] of [[3, 3, w - 3, (h >> 1) - 2], [3, (h >> 1) + 1, w - 3, h - 3]]) { t.rect(x + a0, y + b0, x + a1, y + b1, mul(c, .86)); t.rect(x + a0, y + b0, x + a1, y + b0 + 1, mul(c, .58)); t.rect(x + a0, y + b0, x + a0 + 1, y + b1, mul(c, .6)); t.rect(x + a0, y + b1 - 1, x + a1, y + b1, mul(c, 1.25)); }
      for (let yy = y; yy < y + h; yy += 2) t.shade(x, yy, x + w, yy + 1, .97); }
    else { const c = t.r.pick([[38, 40, 46], [34, 84, 58], [120, 36, 32], [58, 78, 110], [196, 192, 182], [30, 60, 40]]); t.rect(x, y, x + w, y + h, c);
      glass(t, x + 3, y + 3, x + w - 3, y + (h >> 1) - 1, false); for (let xx = x + 4; xx < x + w - 3; xx += 3) t.rect(xx, y + 3, xx + 1, y + (h >> 1) - 1, [22, 22, 24]); t.rect(x + 2, y + (h >> 1) + 1, x + w - 2, y + h - 2, mul(c, .86)); }
    t.shade(x, y, x + w, y + 2, .6); t.shade(x, y, x + 2, y + h, .7);
    t.p(x + w - 4, y + (h >> 1) + 2, [236, 206, 100]); t.p(x + w - 3, y + (h >> 1) + 2, [176, 146, 60]);
    const nx = x + w + 3; if (nx + 8 < t.w) { t.rect(nx, y + 6, nx + 8, y + 11, [40, 40, 46]); t.rect(nx + 1, y + 7, nx + 7, y + 10, [232, 232, 226]); for (const k of [2, 4, 6]) t.p(nx + k, y + 8, [40, 40, 46]); }
  }
  function shutterDecal(t, x, y, w, h, up = 0) {
    if (!up && t.blit("fd_persiana_local", x - 1, y - Math.round(h * .12), w + 2, h + Math.round(h * .12))) return;
    t.rect(x - 1, y - 3, x + w + 1, y, [104, 104, 102]); const top = y + ((h * up) | 0); t.rect(x, y, x + w, top, [26, 24, 24]);
    const base = t.r.pick([[150, 152, 156], [132, 134, 138], [64, 100, 140], [60, 120, 90], [176, 170, 160]]);
    for (let yy = top; yy < y + h; yy++) t.rect(x, yy, x + w, yy + 1, mul(base, [1.14, 1, .76][(yy - top) % 3]));
    t.shade(x, y, x + 2, y + h, .7); t.shade(x + w - 2, y, x + w, y + h, .8);
    for (let i = 0; i < 3; i++) { const sx = t.r.int(x, x + w - 6); t.shade(sx, top, sx + 4, y + h, .93); }
  }
  function portonDecal(t, x, y, w, h) { const c = t.r.pick([[36, 96, 66], [58, 78, 118], [126, 46, 36], [54, 54, 60], [196, 192, 182], [180, 140, 60]]);
    if (t.blit("fd_porton", x, y, w, h, c[0] === 36 ? null : mul(c, 1.2))) return;
    for (let xx = x; xx < x + w; xx++) t.rect(xx, y, xx + 1, y + h, mul(c, [1.12, 1, .8, .94][(xx - x) % 4])); t.rect(x, y, x + w, y + 2, mul(c, .6)); t.rect(x + (w >> 1), y, x + (w >> 1) + 1, y + h, mul(c, .5)); t.shade(x, y, x + 2, y + h, .7); }
  function goodsDecal(t, x0, y0, x1, y1, shop) {
    const pal = GOODS[shop] || [[220, 60, 50], [244, 206, 60], [60, 140, 220], [244, 244, 236], [80, 180, 90], [240, 140, 40]];
    t.rect(x0, y0, x1, y1, [46, 40, 36]);
    for (let yy = y0 + 1; yy < y1 - 1; yy += 5) { t.rect(x0, yy + 4, x1, yy + 5, [156, 132, 98]); for (let xx = x0 + 1; xx < x1 - 1; xx += 3) if (t.r() < .82) t.rect(xx, yy + 1, xx + 2, yy + 4, mul(t.r.pick(pal), t.r.uniform(.85, 1.1))); }
    for (let k = 0; k < x1 - x0; k++) if (k % 19 < 4) for (let j = 0; j < 4; j++) { const yy = y0 + (k >> 1) + j; if (yy < y1) t.tint(x0 + k, yy, x0 + k + 1, yy + 1, [206, 224, 236], .45); }
    t.shade(x0, y0, x1, y0 + 2, .6);
  }
  function pintada(t, x0, x1, y, r) {
    const msg = r.pick(PINTADAS), maxc = Math.max(1, ((x1 - x0) / 7) | 0); const lines = []; let cur = "";
    for (const w of msg.split(" ")) { if ((cur + " " + w).trim().length <= maxc) cur = (cur + " " + w).trim(); else { lines.push(cur); cur = w; } } lines.push(cur);
    if (lines.some(l => l.length > maxc) || lines.length > 3) return false;
    const c = r.pick([[32, 64, 168], [24, 24, 28], [186, 32, 40], [34, 120, 64], [230, 230, 230]]);
    lines.forEach((l, i) => text(t, l, x0 + ((x1 - x0 - textW(l)) >> 1), y + i * 9, c, true, null, 1)); return true;
  }
  function railingTex(wm, hm, seed, c = [28, 28, 32], gap = 4) { const t = new Tex(wm, hm, seed, [0, 0, 0], 0);
    t.rect(0, 0, t.w, 2, c); t.rect(0, t.h - 2, t.w, t.h, c); for (let x = 0; x < t.w; x += gap) t.rect(x, 0, x + 1, t.h, c); if (t.h > 14) t.rect(0, t.h >> 1, t.w, (t.h >> 1) + 1, c); return t; }
  function rejaTex(wm, hm, seed) { const t = new Tex(wm, hm, seed, [0, 0, 0], 0), c = [24, 24, 28];
    for (let x = 1; x < t.w; x += 4) t.rect(x, 0, x + 1, t.h, c); for (const y of [1, t.h >> 1, t.h - 2]) t.rect(0, y, t.w, y + 1, c); for (let x = 1; x < t.w; x += 4) { t.p(x - 1, 3, c); t.p(x + 1, 3, c); } return t; }
  // textura hecha de una pieza de Gemini (lo demás transparente), para usarla en una cara 3D (rejas, barandas de hierro)
  const decalTex = (name, wm, hm, rep = 1) => { if (!R3.DECALS[name]) return null; const t = Tex.fromPx(px(wm), px(hm), 1); const w = Math.round(t.w / rep);
    for (let k = 0; k < rep; k++) t.blit(name, k * w, 0, k === rep - 1 ? t.w - k * w : w, t.h); return t; };
  const solid = (wm, hm, c, seed, kind = "concrete") => { const t = new Tex(wm, hm, seed); if (kind === "concrete") t.concrete(c); else if (kind === "stucco") t.stucco(c); else t.rect(0, 0, t.w, t.h, c); return t; };

  // ---------- objetos
  function tank(sc, x, y, z, seed, kind = "negro") {
    const R = .55;
    if (kind === "negro") { const h = 1.15, t = new Tex(2 * R, h, seed);
      for (let xx = 0; xx < t.w; xx++) { const u = (xx + .5) / t.w * 2 - 1, f = .6 + .6 * Math.max(0, -u * .6 + Math.sqrt(Math.max(0, 1 - u * u)) * .7); t.rect(xx, 0, xx + 1, t.h, mul([52, 52, 60], f)); }
      for (const yy of [px(.35), px(.7)]) t.shade(0, yy, t.w, yy + 1, .55);
      const top = new Tex(2 * R, 2 * R, seed + 1, [0, 0, 0], 0);
      for (let yy = 0; yy < top.h; yy++) for (let xx = 0; xx < top.w; xx++) { const u = (xx + .5) / top.w * 2 - 1, v = (yy + .5) / top.h * 2 - 1; if (u * u + v * v <= 1) top.p(xx, yy, u * u + v * v > .2 ? mul([72, 72, 82], 1.15 - .25 * (u + v)) : [90, 90, 100]); }
      sc.box(x - R, y - R, z + .12, x + R, y + R, z + .12 + h, { front: t, back: t, left: t, right: t, top });
      sc.box(x - R - .1, y - R - .1, z, x + R + .1, y + R + .1, z + .12, { front: [150, 146, 138], back: [150, 146, 138], left: [130, 126, 120], right: [120, 118, 112], top: [176, 172, 164] });
    } else { const t = solid(1, .9, [188, 186, 178], seed); sc.box(x - .5, y - .5, z, x + .5, y + .5, z + .9, { front: t, back: t, left: [150, 148, 142], right: [150, 148, 142], top: [206, 204, 196] }); }
  }
  function ac(sc, x, y, z, seed, wallMounted = true, back = false) {
    const t = new Tex(.8, .55, seed, [226, 226, 222]); for (let xx = 2; xx < t.w - 4; xx += 2) t.rect(xx, 2, xx + 1, t.h - 2, [150, 150, 150]); t.rect(t.w - 6, 2, t.w - 2, t.h - 2, [120, 120, 124]);
    const y0 = back ? y : y - (wallMounted ? .3 : 0), y1 = back ? y + (wallMounted ? .3 : .3) : y + (wallMounted ? 0 : .3);
    sc.box(x, y0, z, x + .8, y1, z + .55, { front: t, back: t, left: [196, 196, 192], right: [196, 196, 192], top: [236, 236, 232] });
  }
  function antenna(sc, x, y, z) { sc.box(x, y, z, x + .05, y + .05, z + 1.9, { front: [96, 96, 102], back: [96, 96, 102], left: [80, 80, 86], right: [80, 80, 86], cast: false });
    [.8, .6, .45].forEach((w, k) => sc.box(x - w / 2, y, z + 1.7 - k * .3, x + w / 2, y + .04, z + 1.73 - k * .3, { front: [120, 120, 126], back: [120, 120, 126], top: [140, 140, 146], cast: false })); }
  function plant(sc, x, y, z, seed, big = false) {
    const r = rng(seed); sc.box(x, y, z, x + .35, y + .3, z + .3, { front: [176, 92, 56], back: [176, 92, 56], left: [140, 72, 44], right: [140, 72, 44], top: [110, 70, 50] });
    const w = big ? .65 : .45, h = big ? .75 : .45, t = new Tex(w, h, seed, [0, 0, 0], 0);
    for (let i = 0; i < t.w * t.h * .8; i++) { const xx = r.int(0, t.w - 1), yy = r.int(0, t.h - 1); if (((xx / t.w - .5) ** 2) / .25 + ((yy / t.h - .65) ** 2) / .4 < 1) t.p(xx, yy, r.pick([[56, 120, 56], [84, 150, 66], [40, 96, 48], [110, 170, 80]])); }
    if (r() < .4) t.p(t.w >> 1, 2, [226, 60, 80]);
    sc.quad([x + .175 - w / 2, y + .15, z + .3 + h], [w, 0, 0], [0, 0, -h], t, { both: true });
  }
  function clothes(sc, x0, x1, y, z, seed) {
    const r = rng(seed), t = new Tex(x1 - x0, .7, seed, [0, 0, 0], 0); t.rect(0, 0, t.w, 1, [226, 226, 226]);
    let x = 2; while (x < t.w - 6) { const c = r.pick([[214, 56, 56], [56, 112, 210], [238, 238, 230], [238, 198, 60], [86, 166, 96], [196, 116, 196], [40, 40, 52], [240, 150, 60]]), w = r.int(4, 8), h = r.int(5, 11);
      t.rect(x, 1, x + w, 1 + h, c); t.rect(x + w - 1, 1, x + w, 1 + h, mul(c, .7)); t.rect(x, 1, x + w, 2, mul(c, .8)); x += w + r.int(1, 3); }
    sc.quad([x0, y, z], [x1 - x0, 0, 0], [0, 0, -.7], t, { both: true });
    for (const xx of [x0, x1 - .05]) sc.box(xx, y, z < 3 ? 0 : z - 1.6, xx + .05, y + .05, z + .05, { front: [150, 150, 156], back: [150, 150, 156], left: [120, 120, 126], right: [120, 120, 126], cast: false });
  }
  function bush(sc, x0, x1, y, z, h, seed) {
    const r = rng(seed), t = new Tex(x1 - x0, h, seed, [0, 0, 0], 0), prof = R3.vnoise(t.w, 1, 4, r);
    for (let xx = 0; xx < t.w; xx++) { const top = ((1 - (.7 + .3 * prof[xx])) * t.h) | 0; for (let yy = top; yy < t.h; yy++) t.p(xx, yy, mul(r.pick([[64, 120, 52], [52, 104, 46], [80, 140, 60], [96, 156, 70]]), .75 + .5 * (1 - (yy - top) / Math.max(1, t.h - top)) + (r() - .5) * .3)); }
    sc.box(x0, y, z, x1, y + .5, z + h, { front: t, back: t, cast: true });
  }
  function roofTex(W, D, kind, seed) {
    const t = new Tex(W, D, seed), r = t.r;
    if (kind === "piedra") { t.stucco([214, 194, 158], .6); for (let yy = 0; yy < t.h; yy += 4) { t.shade(0, yy, t.w, yy + 1, .88); for (let xx = r.int(0, 9); xx < t.w; xx += r.int(7, 12)) t.shade(xx, yy, xx + 1, yy + 4, .86); } }
    else if (kind === "ceramico") { t.stucco(r.pick([[196, 116, 86], [206, 168, 126], [180, 96, 70]]), .4); for (let yy = 0; yy < t.h; yy += 5) t.shade(0, yy, t.w, yy + 1, .8); for (let yy = 0; yy < t.h; yy += 5) for (let xx = ((yy / 5) % 2) * 5; xx < t.w; xx += 10) t.shade(xx, yy, xx + 1, yy + 5, .82); }
    else if (kind === "membrana") { t.stucco([204, 206, 208], .9); for (let xx = 6; xx < t.w; xx += 17) { t.shade(xx, 0, xx + 1, t.h, .86); t.shade(xx + 1, 0, xx + 2, t.h, 1.06); } }
    else if (kind === "membrana_roja") { t.stucco([176, 72, 56], .9); for (let xx = 6; xx < t.w; xx += 17) { t.shade(xx, 0, xx + 1, t.h, .8); t.shade(xx + 1, 0, xx + 2, t.h, 1.08); } }
    else t.concrete([172, 170, 164], 1.3);
    if (r() < .5) { const cx = r.int(5, Math.max(6, t.w - 6)), cy = r.int(3, Math.max(4, t.h - 4)); for (let yy = 0; yy < t.h; yy++) for (let xx = 0; xx < t.w; xx++) if (((xx - cx) / 9) ** 2 + ((yy - cy) / 5) ** 2 < 1) t.shade(xx, yy, xx + 1, yy + 1, .88); }
    return t;
  }
  function chapaTex(W, D, seed, rust) {
    const t = new Tex(W, D, seed), base = t.r() < .35 ? t.r.pick([[70, 110, 170], [170, 60, 50], [70, 140, 90], [200, 170, 80]]) : [196, 198, 196];
    for (let xx = 0; xx < t.w; xx++) t.rect(xx, 0, xx + 1, t.h, mul(base, [1.12, 1.04, .95, .84, .97][xx % 5]));
    if (t.r() < .3) { const x0 = t.r.int(0, t.w - 10), w = t.r.int(10, 24); for (let xx = x0; xx < Math.min(t.w, x0 + w); xx++) t.rect(xx, 0, xx + 1, t.h, mul([186, 188, 186], [1.12, 1.04, .95, .84, .97][xx % 5])); }
    if (rust) { const a = R3.vnoise(t.w, t.h, 6, t.r), b = R3.vnoise(t.w, t.h, 2, t.r); for (let k = 0; k < t.w * t.h; k++) if (.5 * a[k] + .5 * b[k] > .64) for (let j = 0; j < 3; j++) t.d[k * 4 + j] = t.d[k * 4 + j] * .5 + [168, 96, 56][j] * .5; }
    for (let yy = 14; yy < t.h; yy += 16) t.shade(0, yy, t.w, yy + 1, .72); return t;
  }
  function wallTex(W, H, wall, finish, seed, wear = 1) {
    const t = new Tex(W, H, seed);
    if (finish === "brick") t.brick(); else if (finish === "hueco") t.hueco();
    else { t.stucco(wall, wear); t.runoff(.7, wear); if (t.r() < .55) t.peel(t.r.int(1, 3)); }
    return t;
  }

  // ---------- edificio
  // spec: {kind, W, seed, wealth}
  function build(spec, phi = 0) {
    GF = CFG.v.pb; UF = CFG.v.piso;
    if (spec.kind === "edificio") return edificio(spec, phi);
    if (spec.kind === "petit") return petit(spec, phi);
    const r = rng(spec.seed), kind = spec.kind, W = spec.W;
    const sc = new Scene(); sc.setXform(phi);
    const wall = r.pick(WALLS);
    const finish = kind === "obra" ? "hueco" : kind === "villa" ? (r() < .62 ? "hueco" : "stucco") : (r() < .14 ? "brick" : "stucco");
    // revestimientos de frente: piedra Mar del Plata (entera o hasta 1,2 m), o salpicré; muy de los 60 y 70 en el conurbano
    const rv2 = rng(spec.seed ^ 0x9e3779b9), revest = finish === "stucco" && kind !== "villa" && kind !== "galpon" ? (rv2() < .16 ? "piedra" : rv2() < .2 ? "zocalo_piedra" : rv2() < .14 ? "salpicre" : null) : null;
    const storeys = { casa: 1, chalet: 1, negocio: 1, galpon: 1, casa2: 2, negocio_casa: 2, obra: r.pick([1, 2]), ph: 3, villa: r.pick([1, 1, 1, 2, 2, 3]) }[kind];
    const D = spec.D || { casa: r.pick([4.2, 5]), chalet: 4.6, negocio: 4.2, galpon: 6, casa2: 4.6, negocio_casa: 4.6, obra: 4.2, ph: 5.2, villa: 3.6 }[kind];
    const y0 = kind === "chalet" ? 2.6 : 0, zr = GF + (storeys - 1) * UF;
    let roofKind = { chalet: "tejas", galpon: "chapa", villa: "chapa" }[kind] || r.pick(["piedra", "piedra", "membrana", "ceramico", "losa", "membrana_roja"]);
    if (kind === "casa" && r() < (spec.wealth < .35 ? .45 : .15)) roofKind = "chapa";
    if (kind === "obra") roofKind = "losa";
    const setback = (kind === "casa2" || kind === "negocio_casa") && r() < .35 ? 1.8 : 0;
    const wear = (spec.wealth < .35 ? 1.6 : spec.wealth < .6 ? 1.1 : .7) * CFG.v.desgaste;
    const flat = roofKind !== "chapa" && roofKind !== "tejas";
    const Htot = zr + (flat ? PAR : .35);
    const zt = (z) => px(Htot - z), X = (m) => px(m);
    // ---- texturas de las 4 paredes
    const ft = wallTex(W, Htot, wall, finish, spec.seed, wear);
    if (revest === "piedra") ft.piedra(0, px(Htot - (flat ? PAR : .35)));
    else if (revest === "zocalo_piedra") ft.piedra(px(Htot - 1.2), ft.h);
    else if (revest === "salpicre") { ft.salpicre(mix(wall, [236, 230, 218], .4)); ft.runoff(.5, wear * .7); }
    const bt = wallTex(W, Htot, mix(wall, [200, 196, 188], .3), finish, spec.seed + 1, wear * 1.2);
    const stx = new Tex(D, Htot, spec.seed + 3);
    if (finish === "hueco" || r() < .25) stx.hueco(); else if (r() < .5) { stx.stucco(mix(wall, [190, 186, 178], .6), wear * 1.3); stx.runoff(.8, 1.2); stx.peel(2); } else stx.brick();
    if (r() < .15 && finish !== "hueco") pintada(stx, 4, stx.w - 4, px(Htot - 2.6), r);
    { const rg = rng(spec.seed ^ 0x2f6b1d3), dg = R3.DECALS.fd_graffiti, dm = R3.DECALS.fd_mural;
      if (dg && rg() < (spec.wealth < .45 ? .35 : .1)) { const w = px(Math.min(D - .4, rg.uniform(1.6, 2.6))), h = Math.round(w * dg.h / dg.w); stx.blit("fd_graffiti", px(rg.uniform(.1, Math.max(.2, D - 2.8))), stx.h - h - px(rg.uniform(.3, .8)), w, h); }
      else if (dm && Htot > 5 && rg() < .12) { const w = px(Math.min(D - .3, rg.uniform(3, 5))), h = Math.min(px(Htot - 1), Math.round(w * dm.h / dm.w)); stx.blit("fd_mural", px(.15), stx.h - h - px(.5), w, h); } }
    // zócalos / estructura de hormigón
    for (const t of [ft, bt]) {
      if (finish !== "hueco" && !(t === ft && revest && revest !== "salpicre")) { t.rect(0, zt(.45), t.w, t.h, [122, 118, 112]); t.rect(0, zt(.45), t.w, zt(.45) + 1, [156, 152, 146]); t.humidity(1.1); }
      else { const cols = [0, t.w - px(.3)]; if (W > 7) cols.push((t.w >> 1) - px(.15));
        for (const xc of cols) { const cc = new Tex(.3, Htot, spec.seed + xc); cc.concrete([172, 170, 164]); for (let y = 0; y < t.h; y++) for (let x = 0; x < cc.w && xc + x < t.w; x++) { const i = (y * t.w + xc + x) * 4, j = (y * cc.w + x) * 4; for (let k = 0; k < 3; k++) t.d[i + k] = cc.d[j + k]; } }
        for (let s = 0; s < storeys; s++) { const zz = GF + s * UF; t.rect(0, zt(zz), t.w, zt(zz) + px(.28), [170, 168, 162]); t.shade(0, zt(zz) + px(.28), t.w, zt(zz) + px(.28) + 1, .7); } }
    }
    let shop = null; const wins = [], balconies = [];
    // ---- frente, planta baja
    if (kind === "negocio" || kind === "negocio_casa") {
      shop = SHOPS[spec.seed % SHOPS.length]; const [name] = shop;
      const dw = .95, dx = r.pick([.35, W - dw - .35]);
      const [g0, g1] = dx < W / 2 ? [dx + dw + .25, W - .35] : [.35, dx - .25];
      // frente de local de Gemini según el rubro (panadería, carnicería, verdulería...); si no hay, el dibujo de siempre

      const loc = spec.wealth < .3 && r() < .25 ? "cerrado" : LOC[name] || r.pick(["kiosco", "almacen"]);
      if (R3.DECALS["fd_local_" + loc] && W >= 3.2) { const lw = Math.min(W - .3, r.uniform(3, 4.2)), lx = (W - lw) / 2; ft.blit("fd_local_" + loc, X(lx), zt(2.55), X(lw), zt(0) - zt(2.55)); }
      else { goodsDecal(ft, X(g0), zt(2.35), X(g1), zt(.5), name); doorDecal(ft, X(dx), zt(2.25), X(dw), px(2.23), "chapa", wall); }
      if (r() < .5) ft.rect(X(.3), zt(2.57), X(W - .3), zt(2.35), [118, 120, 124]);
    } else if (kind === "galpon") {
      const gw = Math.min(W - 1.6, 4.2); shutterDecal(ft, X((W - gw) / 2), zt(3.0), X(gw), px(2.55), r.pick([0, 0, .55]));
      if (W - gw > 3) pintada(ft, 4, X((W - gw) / 2) - 3, zt(2.6), r);
    } else if (kind === "obra") {
      let i = 0; for (let xm = .6; xm < W - 1.2; xm += 2.2, i++) { if (i === 0) ft.rect(X(xm), zt(2.1), X(xm + .9), zt(0), [24, 20, 20]); else ft.rect(X(xm), zt(2.0), X(xm + 1.2), zt(.9), [24, 20, 20]); }
    } else if (kind === "villa") {
      const dx = r.uniform(.3, Math.max(.35, W - 1.3)); doorDecal(ft, X(dx), zt(2.05), X(.85), px(2.03), "chapa", wall);
      const wx = dx > W / 2 ? .4 : W - 1.5; if (wx > 0 && wx + 1 < W) { windowDecal(ft, X(wx), zt(2), X(1), px(.9), r.pick(["none", "cerrado"]), wall); wins.push([wx, 1.1, 1, .9, r() < .6, "x"]); }
    } else {
      const garage = (kind === "casa" || kind === "casa2" || kind === "ph") && W >= 7 && r() < .55;
      let free = [.35, W - .35];
      if (garage) { const gw = 2.7, gx = r() < .5 ? W - gw - .35 : .35;
        (r() < .55 ? shutterDecal : portonDecal)(ft, X(gx), zt(2.4), X(gw), px(1.95));
        free = gx < W / 2 ? [gx + gw + .3, W - .35] : [.35, gx - .3];
        if (kind === "ph") { const gx2 = gx > W / 2 ? .35 : W - gw - .35; shutterDecal(ft, X(gx2), zt(2.4), X(gw), px(1.95)); free = [Math.min(gx, gx2) + gw + .3, Math.max(gx, gx2) - .3]; } }
      const span = free[1] - free[0], dw = .95;
      const dx = span < 3.4 ? free[0] + (span - dw) / 2 : free[0] + r.pick([.3, span - dw - .3]);
      if (span > dw) { const dk = spec.wealth > .62 && r() < .45 ? r.pick(["chorizo", "vidrio"]) : r.pick(["madera", "madera", "chapa"]);
        if (dk === "chorizo") doorDecal(ft, X(dx - .1), zt(2.55), X(dw + .2), px(2.53), dk, wall); else doorDecal(ft, X(dx), zt(2.15), X(dw), px(2.13), dk, wall); }
      const style = r.pick(["postigo", "persiana", "persiana", "cerrado"]), reja = r() < (spec.wealth < .6 ? .85 : .6);
      for (const [a, b] of [[free[0], dx - .25], [dx + dw + .25, free[1]]]) { const ww = 1.25, need = ww + (style === "postigo" ? 1.4 : .2);
        if (b - a >= need) { const xm = a + (b - a - ww) / 2; windowDecal(ft, X(xm), zt(2.15), X(ww), px(1.15), style === "postigo" ? "none" : style, wall); wins.push([xm, 1, ww, 1.15, reja, style]); } }
      if (r() < (spec.wealth < .4 ? .35 : .15) && finish === "stucco") pintada(ft, 4, ft.w - 4, zt(2.95), r);
    }
    // ---- pisos altos (frente)
    for (let k = 1; k < storeys; k++) {
      const zb = GF + (k - 1) * UF;
      if (kind === "villa") { for (let xm = .4; xm < W - 1.2; xm += 2.4) windowDecal(ft, X(xm), zt(zb + 2.2), X(1), px(.95), r.pick(["reja", "cerrado", "persiana"]), wall); continue; }
      if (kind === "obra") { for (let xm = .6; xm < W - 1.3; xm += 2.4) ft.rect(X(xm), zt(zb + 2.1), X(xm + 1.2), zt(zb + .9), [24, 20, 20]); continue; }
      const n = Math.max(1, Math.floor(W / 2.8)), bal = r() < .6;
      for (let i = 0; i < n; i++) { const cx = W * (i + .5) / n;
        if (bal) windowDecal(ft, X(cx - .5), zt(zb + 2.35), X(1), px(2.1), r.pick(["persiana", "none"]), wall);
        else { windowDecal(ft, X(cx - .62), zt(zb + 2.2), X(1.25), px(1.15), r.pick(["persiana", "cerrado", "none"]), wall); wins.push([cx - .62, zb + 1.05, 1.25, 1.15, false, "x"]); } }
      if (bal) balconies.push(zb);
      if (finish !== "hueco") { ft.rect(0, zt(zb) - 2, ft.w, zt(zb) + 1, add(wall, 18)); ft.rect(0, zt(zb) + 1, ft.w, zt(zb) + 2, mul(wall, .7)); }
    }
    // ---- contrafrente (pared del fondo)
    { const dx = r.uniform(.3, Math.max(.4, W - 1.2)); doorDecal(bt, X(dx), zt(2.1), X(.85), px(2.08), r.pick(["madera", "chapa"]), wall);
      const wx = r.uniform(.3, Math.max(.4, W - 1.2)); if (Math.abs(wx - dx) > 1.3) windowDecal(bt, X(wx), zt(2.2), X(.9), px(.7), "none", wall);
      const cx = r.uniform(.3, Math.max(.4, W - .8)); if (Math.abs(cx - dx) > 1) { bt.rect(X(cx), zt(2.2), X(cx + .45), zt(1.45), [232, 232, 228]); bt.rect(X(cx + .2), zt(2.9), X(cx + .25), zt(2.2), [130, 130, 134]); }
      for (let k = 1; k < storeys; k++) { const zb = GF + (k - 1) * UF; windowDecal(bt, X(r.uniform(.4, Math.max(.5, W - 1.4))), zt(zb + 2.2), X(1), px(1), r.pick(["persiana", "cerrado"]), wall); }
    }
    // ---- plantas en las paredes (Gemini): pasto y yuyos al pie, grietas con musgo, enredaderas, jardineras bajo las ventanas,
    // Santa Rita colgando del parapeto, helechos y potus colgados junto a la puerta. Más en las casas viejas y en las de barrio.
    if (R3.DECALS.fd_hiedra) { const rp = rng(spec.seed ^ 0x51ed270b), pobre = spec.wealth < .4;
      const deco = (t, n, xm, ytop, wm, hmax) => { const d = R3.DECALS[n]; if (!d) return; let w = X(wm), h = Math.round(w * d.h / d.w); if (hmax && h > hmax) { w = Math.round(w * hmax / h); h = hmax; } t.blit(n, X(xm), ytop, w, h); };
      const piso = (t, n, xm, wm) => { const d = R3.DECALS[n]; if (!d) return; const w = X(wm), h = Math.round(w * d.h / d.w); t.blit(n, X(xm), t.h - h, w, h); };
      for (const [t, Wt, k] of [[ft, W, 1], [bt, W, .6], [stx, D, .8]]) {
        if (rp() < (pobre ? .6 : .3) * k) piso(t, "fd_pasto_pared", rp.uniform(0, Math.max(.1, Wt - 1)), rp.uniform(.7, 1.1));
        if (rp() < (pobre ? .4 : .12) * k && finish !== "hueco") deco(t, "fd_grieta", rp.uniform(.1, Math.max(.2, Wt - .8)), zt(rp.uniform(.8, 2)), rp.uniform(.4, .7));
        if (rp() < (kind === "chalet" || spec.wealth > .6 ? .22 : .1) * k) { const wm = rp.uniform(1.4, Math.min(2.6, Wt)), xm = rp() < .5 ? 0 : Wt - wm; deco(t, rp.pick(["fd_hiedra", "fd_hiedra", "fd_jazmin", "fd_mburucuya"]), xm, zt(Math.min(zr, rp.uniform(1.8, 3.2))), wm, zt(0) - zt(Math.min(zr, 3.2))); }
      }
      if (flat && rp() < .14) { const wm = rp.uniform(1.6, Math.min(2.8, W)); deco(ft, "fd_santarita", rp.uniform(0, W - wm), 0, wm, px(Htot * .45)); }
      for (const [xm, zm, ww, hh] of wins) if (zm > .5 && rp() < .22) deco(ft, "fd_jardinera", xm - .05, zt(zm) - 2, ww + .1, px(.55));
      if (rp() < .14 && kind !== "galpon") deco(ft, rp.pick(["fd_helecho_colgante", "fd_potus", "fd_estante"]), rp.uniform(.1, Math.max(.2, W - 1)), zt(2.6), .7, px(1.1));
    }
    const ftc = (z0, z1) => ft.crop(zt(z1), zt(z0)), btc = (z0, z1) => bt.crop(zt(z1), zt(z0)), stc = (z0, z1) => stx.crop(zt(z1), zt(z0));
    // ---- volumen
    const roofTop = roofTex(W, D, flat ? roofKind : "losa", spec.seed + 5);
    let py0 = y0;
    if (setback && storeys >= 2) {
      sc.box(0, y0, 0, W, y0 + D, GF, { front: ftc(0, GF), back: btc(0, GF), left: stc(0, GF), right: stc(0, GF), top: roofTex(W, D, "ceramico", spec.seed + 9) });
      sc.box(0, y0, GF, W, y0 + .15, GF + 1, { front: railingTex(W, 1, spec.seed), back: railingTex(W, 1, spec.seed), cast: false });
      const up = wallTex(W, zr - GF + PAR, wall, finish, spec.seed + 21, wear); const n = Math.max(1, Math.floor(W / 2.8));
      for (let i = 0; i < n; i++) windowDecal(up, px(W * (i + .5) / n - .5), px(PAR + .55), px(1), px(2.1), "persiana", wall);
      sc.box(0, y0 + setback, GF, W, y0 + D, zr, { front: up.crop(px(PAR), up.h), back: btc(GF, zr), left: stc(GF, zr), right: stc(GF, zr), top: roofTop });
      py0 = y0 + setback; var parFront = up.crop(0, px(PAR));
    } else {
      sc.box(0, y0, 0, W, y0 + D, zr, { front: ftc(0, zr), back: btc(0, zr), left: stc(0, zr), right: stc(0, zr), top: roofTop });
      var parFront = ftc(zr, Htot);
    }
    // ---- techo
    const cap = [228, 224, 214], inner = mix(wall, [204, 200, 192], .5);
    if (flat) {
      sc.box(0, py0, zr, W, py0 + .2, zr + PAR, { front: parFront, back: inner, top: cap, left: [150, 146, 140], right: [150, 146, 140] });
      sc.box(0, y0 + D - .2, zr, W, y0 + D, zr + PAR, { front: inner, back: btc(zr, Htot), top: cap, left: [150, 146, 140], right: [150, 146, 140] });
      sc.box(0, py0 + .2, zr, .2, y0 + D - .2, zr + PAR, { left: stc(zr, Htot), right: inner, top: cap });
      sc.box(W - .2, py0 + .2, zr, W, y0 + D - .2, zr + PAR, { right: stc(zr, Htot), left: inner, top: cap });
      sc.box(-.06, py0 - .14, zr + PAR - .04, W + .06, py0 + .2, zr + PAR + .08, { front: [236, 232, 222], top: [244, 240, 232], left: [200, 196, 188], right: [180, 176, 168] });
      sc.box(-.06, y0 + D - .2, zr + PAR - .04, W + .06, y0 + D + .14, zr + PAR + .08, { back: [226, 222, 212], top: [244, 240, 232], left: [200, 196, 188], right: [180, 176, 168] });
      if (finish !== "hueco") sc.box(-.03, py0 - .1, zr - .25, W + .03, py0, zr - .05, { front: add(wall, 16), top: add(wall, 30), left: mul(wall, .85), right: mul(wall, .8) });
    } else if (roofKind === "chapa") {
      const run = D - py0 + y0 + .45, tex = chapaTex(W, D * 1.6, spec.seed + 4, r() < .7);
      sc.quad([0, y0 + D, zr + .9], [W, 0, 0], [0, -run, -.9], tex);
      const gt = new Tex(run, .9, spec.seed + 8); if (finish === "hueco") gt.hueco(); else gt.stucco(mix(wall, [190, 186, 178], .5));
      sc.quad([W, y0 + D, zr + .9], [0, 0, -.9], [0, -(D - py0 + y0), -.9], gt, { tri: true });
      sc.quad([0, y0 + D, zr + .9], [0, -(D - py0 + y0), -.9], [0, 0, -.9], gt, { tri: true });
      sc.box(-.05, py0 - .45, zr - .12, W + .05, py0 - .4, zr + .02, { front: [84, 84, 88], right: [60, 60, 64], left: [70, 70, 74], cast: false });
      for (let i = r.int(0, 3); i > 0; i--) { const cx = r.uniform(.5, W - .8), cy = r.uniform(y0 + 1, y0 + D - 1), zz = zr + .9 * (cy - py0 + .45) / run;
        if (r() < .7) sc.box(cx, cy, zz, cx + .65, cy + .65, zz + .22, { front: [32, 32, 34], back: [32, 32, 34], right: [24, 24, 26], left: [24, 24, 26], top: [48, 48, 52] });
        else sc.box(cx, cy, zz, cx + .4, cy + .25, zz + .2, { front: [176, 92, 62], right: [140, 72, 50], top: [190, 110, 76] }); }
    } else {   // tejas
      const c = r.pick([[182, 84, 54], [170, 96, 64], [150, 72, 50]]), ridge = zr + 1.9;
      const mk = (s) => { const t = new Tex(W + .6, D / 2 + .5, s); for (let yy = 0; yy < t.h; yy++) for (let xx = 0; xx < t.w; xx++) { const lx = (xx + ((yy / 4) | 0) * 3) % 6, f = 1.12 - .07 * (yy % 4) - (lx === 0 ? .22 : 0) + (lx === 2 || lx === 3 ? .08 : 0); t.p(xx, yy, mul(c, f * (.92 + .12 * t.r()))); } return t; };
      sc.quad([-.3, y0 + D / 2, ridge], [W + .6, 0, 0], [0, -(D / 2 + .5), -(ridge - zr + .15)], mk(spec.seed + 6));
      sc.quad([W + .3, y0 + D / 2, ridge], [-(W + .6), 0, 0], [0, D / 2 + .5, -(ridge - zr + .15)], mk(spec.seed + 7));
      const gt = new Tex(D + 1, ridge - zr, spec.seed + 8); gt.stucco(wall);
      sc.quad([W, y0 + D / 2, ridge], [0, D / 2, -(ridge - zr)], [0, -(D / 2), -(ridge - zr)], gt, { tri: true });
      sc.quad([0, y0 + D / 2, ridge], [0, -D / 2, -(ridge - zr)], [0, D / 2, -(ridge - zr)], gt, { tri: true });
      sc.box(-.3, y0 - .5, zr - .2, W + .3, y0 - .45, zr - .05, { front: [232, 226, 214], right: [200, 196, 186], left: [210, 206, 196], cast: false });
    }
    // ---- relieves
    for (const [xm, zm, ww, hh, reja, st] of wins) {
      sc.box(xm - .1, y0 - .1, zm - .08, xm + ww + .1, y0, zm, { front: [232, 228, 218], top: [244, 240, 232], right: [196, 192, 184], left: [206, 202, 194] });
      if (st !== "x" && finish !== "hueco") sc.box(xm - .06, y0 - .05, zm + hh + .02, xm + ww + .06, y0, zm + hh + .13, { front: add(wall, 14), top: add(wall, 26), right: mul(wall, .8), left: mul(wall, .86) });   // dintel
      if (reja) sc.box(xm - .05, y0 - .2, zm, xm + ww + .05, y0 - .18, zm + hh + .1, { front: rejaTex(ww + .1, hh + .1, spec.seed), cast: false });
      if (st === "postigo") { const pc = r.pick(SHUTTER);
        for (const sx of [xm - ww / 2 - .05, xm + ww + .05]) { const t = new Tex(ww / 2, hh, spec.seed + 31, pc); for (let yy = 1; yy < t.h; yy += 2) t.shade(0, yy, t.w, yy + 1, .72); t.shade(0, 0, 1, t.h, .6);
          sc.box(sx, y0 - .06, zm, sx + ww / 2, y0, zm + hh, { front: t, right: mul(pc, .7), left: mul(pc, .8) }); } }
    }
    for (const zb of balconies) {
      sc.box(0, y0 - .85, zb - .02, W, y0, zb + .14, { front: [222, 218, 208], top: [236, 232, 222], right: [190, 186, 178], left: [200, 196, 188] });
      const orn = spec.wealth > .5 && r() < .6 ? decalTex("fd_balcon_hierro", W - .1, .96, Math.max(1, Math.round((W - .1) / 2))) : null;
      sc.box(.05, y0 - .85, zb + .14, W - .05, y0 - .83, zb + 1.1, { front: orn || railingTex(W - .1, .96, spec.seed), back: orn || railingTex(W - .1, .96, spec.seed), cast: false });
      for (const xx of [.05, W - .07]) sc.box(xx, y0 - .85, zb + .14, xx + .02, y0, zb + 1.1, { right: railingTex(.85, .96, spec.seed), left: railingTex(.85, .96, spec.seed), cast: false });
      for (let i = r.int(0, 3); i > 0; i--) plant(sc, r.uniform(.2, W - .6), y0 - .7, zb + .14, r.int(0, 99999));
      if (r() < .4) clothes(sc, .3, W - .3, y0 - .45, zb + 2.0, r.int(0, 99999));
    }
    if (shop) {
      const [name, scol] = shop, sw = W - .3, st = new Tex(sw, .62, spec.seed + 40); st.stucco(scol, .2);
      st.rect(0, 0, st.w, 1, add(scol, 40)); st.rect(0, st.h - 1, st.w, st.h, mul(scol, .6));
      if (textW(name) > st.w - 6) text(st, name, (st.w - textW(name, false)) >> 1, 2, [252, 250, 244], false, mul(scol, .45)); else text(st, name, (st.w - textW(name)) >> 1, 2, [252, 250, 244], true, mul(scol, .45));
      sc.box(.15, y0 - .16, 2.55, .15 + sw, y0, 3.17, { front: st, top: add(scol, 20), right: mul(scol, .6), left: mul(scol, .7) });
      // toldo sólo en algunos (desde arriba tapa la vidriera, que es lo que cuenta qué local es)
      if ((!["FARMACIA", "LAVADERO", "PELUQUERIA", "REMIS"].includes(name) || r() < .3) && r() < (R3.DECALS.fd_local_kiosco ? .35 : 1)) {
        const c2 = r.pick([[240, 236, 226], [240, 236, 226], [40, 40, 44]]), c1 = r() < .6 ? scol : r.pick([[204, 46, 40], [38, 116, 58], [36, 78, 156], [220, 120, 30]]);
        const at = new Tex(W, 1.1, spec.seed + 41); for (let xx = 0; xx < at.w; xx++) { const c = ((xx / 7) | 0) % 2 === 0 ? c1 : c2; for (let yy = 0; yy < at.h; yy++) at.p(xx, yy, mul(c, 1.04 - .18 * yy / at.h)); }
        sc.quad([-.05, y0 - .16, 2.5], [W + .1, 0, 0], [0, -1.1, -.55], at, { both: true });
        const vt = new Tex(W, .22, spec.seed + 42, [0, 0, 0], 0); for (let xx = 0; xx < vt.w; xx++) { const c = ((xx / 7) | 0) % 2 === 0 ? c1 : c2; for (let yy = 0; yy < vt.h - (xx % 7 === 0 || xx % 7 === 6 ? 2 : 0); yy++) vt.p(xx, yy, mul(c, .8)); }
        sc.quad([-.05, y0 - 1.26, 1.95], [W + .1, 0, 0], [0, 0, -.22], vt, { both: true });
        sc.casters.push({ c: sc.P([W / 2, y0 - .7, 1.7]), ax: [sc.V([1, 0, 0]), sc.V([0, 1, 0]), [0, 0, 1]], h: [W / 2, .5, .2], fid: -2 });
      }
    }
    if (["casa", "casa2", "ph", "negocio_casa"].includes(kind) && r() < .6) {
      const pxm = r.pick([.05, W - .5]), pt = new Tex(.45, 1.35, spec.seed + 50); pt.brick();
      pt.rect(px(.07), px(.3), px(.38), px(.75), [214, 214, 208]); pt.rect(px(.12), px(.38), px(.33), px(.6), [72, 94, 114]);
      sc.box(pxm, y0 - .45, 0, pxm + .45, y0 - .02, 1.35, { front: pt, top: [210, 206, 196], right: [150, 80, 56], left: [160, 86, 60] });
      sc.box(pxm + .38, y0 - .3, 1.35, pxm + .42, y0 - .26, 2.4, { front: [60, 60, 64], right: [50, 50, 54], cast: false });
    }
    if (kind === "chalet") {
      const gt = new Tex(W, y0, spec.seed + 60); gt.stucco([96, 146, 72], .3);
      for (let i = 0; i < gt.w * gt.h / 3; i++) gt.p(r.int(0, gt.w - 1), r.int(0, gt.h - 1), r.pick([[70, 120, 56], [126, 176, 90], [60, 108, 50]]));
      gt.rect((gt.w >> 1) - 9, 0, (gt.w >> 1) + 9, gt.h, [196, 190, 178]);
      sc.quad([0, y0, .02], [W, 0, 0], [0, -y0, 0], gt);
      bush(sc, .1, W / 2 - .7, y0 - .55, 0, .9, spec.seed + 61); bush(sc, W / 2 + .7, W - .1, y0 - .55, 0, .9, spec.seed + 62);
      const mw = solid(W / 2, .55, [228, 224, 212], spec.seed, "stucco");
      sc.box(0, 0, 0, W / 2 - .55, .25, .55, { front: mw, top: [240, 236, 226], right: [190, 186, 176], left: [200, 196, 186] });
      sc.box(W / 2 + .55, 0, 0, W, .25, .55, { front: mw, top: [240, 236, 226], right: [190, 186, 176], left: [200, 196, 186] });
      const rj = decalTex("fd_reja", W, .8, Math.max(1, Math.round(W / 2)));
      sc.box(0, .08, .55, W, .1, 1.35, { front: rj || rejaTex(W, .8, spec.seed), back: rj || rejaTex(W, .8, spec.seed), cast: false });
      for (const xp of [0, W / 2 - .55, W / 2 + .15, W - .4]) { const p_ = new Tex(.4, 1.5, spec.seed + 63); p_.brick(); sc.box(xp, 0, 0, xp + .4, .3, 1.5, { front: p_, top: [226, 222, 212], right: [150, 80, 56], left: [160, 86, 60] }); }
    }
    if (kind === "obra") { for (const xc of [.15, W - .3]) for (let k = 0; k < 3; k++) sc.box(xc + k * .06, y0 + .05, zr + .3, xc + k * .06 + .03, y0 + .08, zr + 1.3 + k * .15, { front: [150, 78, 46], right: [110, 56, 36], left: [120, 60, 40], cast: false });
      if (r() < .7) { const b = new Tex(1, .5, spec.seed + 70); b.hueco(); const bx = r.uniform(.2, Math.max(.3, W - 1.3)); sc.box(bx, y0 - 1, 0, bx + 1, y0 - .4, .5, { front: b, top: [208, 120, 80], right: [160, 90, 60], left: [170, 96, 64] }); } }
    // escalera de material al primer piso, contra el frente: sube de costado, peldaño a peldaño, con baranda de caño
    if (kind === "villa" && storeys >= 2 && W >= 4.2) { const n = 11, run = Math.min(3, W - 1.2) / n, dir = r() < .5 ? 1 : -1, xs = dir > 0 ? .3 : W - .3, zs = GF / n;
      const conc = new Tex(.3, GF, spec.seed + 71); conc.concrete([170, 168, 160], 1.4);
      for (let k = 0; k < n; k++) { const a = xs + dir * k * run, b = a + dir * run, x0 = Math.min(a, b), x1 = Math.max(a, b);
        sc.box(x0, y0 - .9, 0, x1, y0, (k + 1) * zs, { front: conc, top: [190, 188, 182], right: [138, 136, 130], left: [150, 148, 142] }); }
      const xe = xs + dir * n * run; sc.box(Math.min(xe, xe + dir * .9), y0 - .9, GF - .15, Math.max(xe, xe + dir * .9), y0, GF, { front: [176, 174, 168], top: [190, 188, 182], right: [138, 136, 130], left: [150, 148, 142] });
      // baranda: postes en el borde de afuera
      for (let k = 0; k <= n; k += 3) { const x = xs + dir * k * run; sc.box(x - .02, y0 - .9, k * zs, x + .02, y0 - .86, k * zs + .9, { front: [40, 40, 44], right: [30, 30, 34], left: [34, 34, 38], cast: false }); }
      const L = Math.hypot(n * run, GF), bt = new Tex(L, .06, spec.seed + 72, [40, 40, 44]);
      sc.quad([xs, y0 - .88, .9], [dir * n * run, 0, GF], [0, 0, -.06], bt, { both: true }); }
    if (r() < .3 && kind !== "obra") ac(sc, r.uniform(.2, Math.max(.3, W - 1.1)), y0, shop ? 3.3 : 2.45, spec.seed + 80);
    if (r() < .35 && !shop && kind !== "chalet") plant(sc, r.uniform(.2, Math.max(.3, W - .6)), y0 - .45, 0, spec.seed + 81, true);
    if (r() < .6) clothes(sc, .3, W - .3, y0 + D + 1.6, 1.85, spec.seed + 99);      // ropa en el patio de atrás
    if (r() < .3) ac(sc, r.uniform(.2, Math.max(.3, W - 1.1)), y0 + D, 2.3, spec.seed + 83, true, true);
    // ---- terraza: lavadero o cuartito en el fondo (muy de Buenos Aires), con su tanque arriba
    let lav = null;
    if (flat && W >= 5 && D >= 4.2 && kind !== "obra" && r() < (kind === "villa" ? .2 : .38)) {
      const lw = Math.min(W - 1, r.uniform(2.4, 3.6)), ld = Math.min(D - 1.4, r.uniform(2.2, 3)), lh = 2.3, lx = r() < .5 ? .2 : W - .2 - lw, ly = y0 + D - .2 - ld;
      const lt = wallTex(lw, lh, mix(wall, [214, 208, 196], .4), finish === "hueco" || r() < .4 ? "hueco" : "stucco", spec.seed + 120, wear * 1.3);
      doorDecal(lt, px(.3), px(.15), px(.75), px(1.95), "chapa", wall);
      if (lw > 2.6) windowDecal(lt, px(lw - 1.1), px(.5), px(.7), px(.6), "none", wall);
      const st = wallTex(ld, lh, mix(wall, [200, 196, 188], .5), "stucco", spec.seed + 121, wear * 1.4);
      sc.box(lx, ly, zr, lx + lw, ly + ld, zr + lh, { front: lt, back: st, left: st, right: st, top: roofTex(lw, ld, "losa", spec.seed + 122) });
      lav = { x: lx + lw / 2, y: ly + ld / 2, z: zr + lh };
    }
    // terraza: algo de vida (sillas de plástico, macetas, una parrilla), sólo en techos planos
    if (flat && kind !== "obra" && r() < .45) { const n = r.int(1, 3);
      for (let k = 0; k < n; k++) { const qx = r.uniform(.6, W - 1), qy = y0 + r.uniform(.6, D * .55);
        if (r() < .5) plant(sc, qx, qy, zr, spec.seed + 130 + k, r() < .4);
        else sc.box(qx, qy, zr, qx + .45, qy + .45, zr + .45, { front: [236, 236, 230], back: [236, 236, 230], left: [206, 206, 200], right: [206, 206, 200], top: [244, 244, 240] }); } }
    // ---- techo: tanque, antena, chimenea
    const roofZ = flat ? zr : zr + .5;
    if (roofKind === "tejas") tank(sc, r.uniform(.8, W - .8), y0 + D * .6, zr + 1.2, spec.seed + 90);
    else if (lav) tank(sc, lav.x, lav.y, lav.z, spec.seed + 90, r() < .85 ? "negro" : "gris");
    else tank(sc, r.uniform(.9, Math.max(1, W - .9)), y0 + D * r.uniform(.45, .7), roofZ + (flat ? .2 : .6), spec.seed + 90, r() < .85 ? "negro" : "gris");
    if (r() < .5 && roofKind !== "tejas") antenna(sc, r.uniform(.4, W - .4), y0 + D * .3, roofZ);
    if (r() < .5) { const cx = r.uniform(.3, W - .5); sc.box(cx, y0 + D * .75, roofZ, cx + .25, y0 + D * .75 + .25, roofZ + 1, { front: [160, 160, 164], back: [160, 160, 164], left: [124, 124, 128], right: [124, 124, 128], top: [120, 120, 124] }); }
    if (r() < .3 && flat) ac(sc, r.uniform(.3, Math.max(.4, W - 1.1)), y0 + D * .35, zr, spec.seed + 91, false);
    if (flat && r() < .25 && storeys === 1) clothes(sc, .4, W - .4, y0 + D * .5, zr + 1.6, spec.seed + 92);
    return { sc, storeys, depth: y0 + D, shop: shop && shop[0], height: zr };
  }

  // ---------- edificio de departamentos (zonas ricas y avenidas): planta baja con hall (y a veces local o cochera),
  // pisos con balcones corridos o ventanas, medianeras lisas, terraza con sala de máquinas y tanques.
  const CLAROS = [[236, 230, 216], [226, 220, 206], [214, 210, 202], [232, 222, 196], [206, 200, 190], [222, 214, 200], [196, 204, 210], [228, 212, 190]];
  function slidingDecal(t, x, y, w, h, frame) {        // puerta-ventana corrediza de aluminio
    t.rect(x - 1, y - 1, x + w + 1, y + h + 1, mul(frame, .55)); t.rect(x, y, x + w, y + h, frame);
    const n = w > px(2.2) ? 3 : 2, pw = (w - 2) / n;
    for (let i = 0; i < n; i++) { const a = x + 1 + Math.round(i * pw), b = x + 1 + Math.round((i + 1) * pw) - 1; glass(t, a + 1, y + 2, b - 1, y + h - 2, t.r() < .5); }
    t.shade(x, y, x + w, y + 2, .7);
  }
  function edificio(spec, phi) {
    const r = rng(spec.seed), W = spec.W, D = spec.D, n = spec.p || 6, GF2 = 3.4, UF2 = 2.8;
    const sc = new Scene(); sc.setXform(phi);
    const estilo = spec.e || r.pick(["balcones", "balcones", "ladrillo", "moderno"]);
    const wall = estilo === "ladrillo" ? [196, 120, 86] : r.pick(CLAROS), frame = r.pick([[214, 214, 210], [60, 62, 68], [150, 120, 84], [196, 196, 192]]);
    const zr = GF2 + (n - 1) * UF2, Htot = zr + 1.1, zt = (z) => px(Htot - z), X = (m) => px(m), wear = (spec.wealth < .5 ? 1 : .6) * CFG.v.desgaste;
    // frente
    const ft = new Tex(W, Htot, spec.seed); if (estilo === "ladrillo") ft.brick([182, 96, 64]); else { ft.stucco(wall, wear * .7); ft.runoff(.9, wear); }
    // planta baja: revestimiento de piedra o granito
    const pb = r.pick([[112, 110, 108], [150, 140, 128], [70, 72, 78], [180, 170, 156]]);
    ft.rect(0, zt(GF2), ft.w, ft.h, pb); for (let yy = zt(GF2); yy < ft.h; yy += px(.45)) ft.shade(0, yy, ft.w, yy + 1, .8);
    for (let xx = 0; xx < ft.w; xx += px(.9)) ft.shade(xx, zt(GF2), xx + 1, ft.h, .86);
    const hall = Math.min(2.2, W * .3), hx = r.pick([.5, (W - hall) / 2, W - hall - .5]);
    // hall: puerta vidriada de dos hojas con marco de metal y portero
    const hallG = R3.DECALS.fd_ed_hall;
    if (hallG) ft.blit("fd_ed_hall", X(hx - .2), zt(2.75), X(hall + .9), zt(0) - zt(2.75));
    else { ft.rect(X(hx) - 2, zt(2.6) - 2, X(hx + hall) + 2, ft.h, [40, 40, 44]); glass(ft, X(hx), zt(2.6), X(hx + hall), zt(.05), false); }
    if (!hallG) {
    ft.rect(X(hx + hall / 2), zt(2.6), X(hx + hall / 2) + 2, zt(.05), [40, 40, 44]); ft.rect(X(hx) - 2, zt(2.75), X(hx + hall) + 2, zt(2.6), [196, 170, 90]);
    text(ft, String(100 + (spec.seed % 3900)), X(hx + hall / 2) - (textW(String(100 + (spec.seed % 3900))) >> 1), zt(2.92), [40, 36, 30], true);
    ft.rect(X(hx + hall) + 4, zt(1.6), X(hx + hall) + 4 + px(.18), zt(1.2), [180, 180, 176]); for (let k = 0; k < 4; k++) ft.p(X(hx + hall) + 6, zt(1.55) + k * 3, [40, 40, 44]); }
    else text(ft, String(100 + (spec.seed % 3900)), X(hx + hall / 2) - (textW(String(100 + (spec.seed % 3900))) >> 1), zt(3.05), [40, 36, 30], true);
    // el resto de la planta baja: local, cochera o ventanas con reja
    const lado = hx < W / 2 ? [hx + hall + .6, W - .3] : [.3, hx - .6], lw = lado[1] - lado[0];
    let shop = null;
    if (lw > 2.5) { const que = spec.wealth > .7 && r() < .4 ? "cochera" : r() < .6 ? "local" : "ventanas";
      if (que === "cochera") { if (!ft.blit("fd_ed_cochera", X(lado[0]), zt(2.6), X(Math.min(3.4, lw)), px(2.6))) shutterDecal(ft, X(lado[0]), zt(2.5), X(Math.min(3, lw)), px(2.3)); }
      else if (que === "local") { shop = SHOPS[spec.seed % SHOPS.length]; const lc = "fd_local_" + (LOC[shop[0]] || "almacen");
        if (!ft.blit(lc, X(lado[0]), zt(2.55), X(Math.min(lw, 4.2)), zt(0) - zt(2.55))) goodsDecal(ft, X(lado[0]), zt(2.5), X(lado[1]), zt(.4), shop[0]); }
      else for (let xm = lado[0] + .3; xm + 1.3 < lado[1]; xm += 1.9) windowDecal(ft, X(xm), zt(2.3), X(1.3), px(1.3), "persiana", pb); }
    // pisos
    const bal = estilo !== "moderno" && estilo !== "ladrillo" ? true : estilo === "ladrillo" ? r() < .5 : false;
    for (let k = 1; k < n; k++) { const zb = GF2 + (k - 1) * UF2;
      if (estilo === "moderno") { ft.rect(0, zt(zb + UF2 - .25), ft.w, zt(zb + .1), [52, 66, 80]); glass(ft, 2, zt(zb + UF2 - .3), ft.w - 2, zt(zb + .15), r() < .3);
        for (let xx = X(.05); xx < ft.w; xx += X(1.35)) ft.rect(xx, zt(zb + UF2 - .25), xx + 2, zt(zb + .1), frame); }
      else if (bal) { if (R3.DECALS.fd_ed_balcon_puerta) { const m = Math.max(1, Math.floor((W - .6) / 2.8)), ww = (W - .6) / m;
          for (let i = 0; i < m; i++) ft.blit("fd_ed_balcon_puerta", X(.3 + i * ww + .1), zt(zb + 2.35), X(ww - .2), px(2.25)); }
        else slidingDecal(ft, X(.5), zt(zb + 2.3), X(W - 1.4), px(2.2), frame); }
      else { const m = Math.max(1, Math.floor(W / 2.4));
        for (let i = 0; i < m; i++) { const vx = W * (i + .5) / m - .75, g = r.pick(["fd_ed_ventana_persiana", "fd_ed_ventana_persiana", "fd_ed_ventana_cortina", "fd_ed_ventana_aire"]);
          if (!R3.DECALS[g]) windowDecal(ft, X(vx + .1), zt(zb + 2.1), X(1.3), px(1.3), r.pick(["persiana", "none", "persiana"]), wall);
          else if (g === "fd_ed_ventana_aire") ft.blit(g, X(vx - .05), zt(zb + 2.25), X(1.6), px(1.5));
          else ft.blit(g, X(vx), zt(zb + 2.2), X(1.5), px(1.3)); } }
      ft.rect(0, zt(zb) - 2, ft.w, zt(zb) + 2, estilo === "ladrillo" ? [198, 196, 190] : add(wall, 14)); ft.shade(0, zt(zb) + 2, ft.w, zt(zb) + 3, .75); }
    // medianeras y contrafrente
    const stx = new Tex(D, Htot, spec.seed + 3); if (r() < .3) stx.brick(); else { stx.stucco(mix(wall, [200, 196, 188], .5), wear * 1.3); stx.runoff(1.5, wear * 1.4); stx.humidity(1.2); }
    if (r() < .25) { const c = r.pick([[200, 40, 40], [40, 90, 170], [230, 190, 40]]), y = zt(zr - .5); stx.rect(px(1), y, stx.w - px(1), y + px(2.4), c); text(stx, r.pick(["ALQUILA", "VENDE", "FERNET", "COCA"]), px(1.4), y + px(.6), [250, 250, 245], true); }
    if (R3.DECALS.fd_ed_manchas && r() < .5) { const w = stx.w, h = Math.round(w * .6); stx.blit("fd_ed_manchas", 0, px(1.1), w, Math.min(h, stx.h - px(1.1)), mix(wall, [200, 196, 188], .5)); }
    const bt = new Tex(W, Htot, spec.seed + 1); bt.stucco(mix(wall, [196, 192, 186], .4), wear * 1.4); bt.runoff(1, 1.3);
    for (let k = 1; k < n; k++) { const zb = GF2 + (k - 1) * UF2; for (let xm = .6; xm + 1 < W; xm += 2.6) windowDecal(bt, X(xm), zt(zb + 2), X(1), px(1.1), r.pick(["persiana", "cerrado", "none"]), wall); }
    const ftc = (a, b) => ft.crop(zt(b), zt(a)), btc = (a, b) => bt.crop(zt(b), zt(a)), stc = (a, b) => stx.crop(zt(b), zt(a));
    sc.box(0, 0, 0, W, D, zr, { front: ftc(0, zr), back: btc(0, zr), left: stc(0, zr), right: stc(0, zr), top: roofTex(W, D, r.pick(["membrana", "piedra", "losa"]), spec.seed + 5) });
    // parapeto
    const cap = [230, 226, 216], inner = mix(wall, [204, 200, 192], .5), PH = 1.1;
    sc.box(0, 0, zr, W, .2, zr + PH, { front: ftc(zr, Htot), back: inner, top: cap, left: [150, 146, 140], right: [150, 146, 140] });
    sc.box(0, D - .2, zr, W, D, zr + PH, { front: inner, back: btc(zr, Htot), top: cap });
    sc.box(0, .2, zr, .2, D - .2, zr + PH, { left: stc(zr, Htot), right: inner, top: cap }); sc.box(W - .2, .2, zr, W, D - .2, zr + PH, { right: stc(zr, Htot), left: inner, top: cap });
    sc.box(-.08, -.16, zr + PH - .06, W + .08, .2, zr + PH + .1, { front: [238, 234, 224], top: [246, 242, 234], left: [204, 200, 192], right: [184, 180, 172] });
    // marquesina del hall
    sc.box(hx - .3, -1.1, 2.75, hx + hall + .3, 0, 2.95, { front: [58, 58, 62], top: [80, 80, 86], right: [44, 44, 48], left: [50, 50, 54] });
    // balcones: losa saliente + baranda (metal o vidrio) + macetas, aires y ropa
    if (bal) for (let k = 1; k < n; k++) { const zb = GF2 + (k - 1) * UF2, vidrio = estilo === "balcones" && r() < .5;
      sc.box(0, -1.2, zb - .05, W, 0, zb + .15, { front: add(wall, 10), top: [214, 210, 202], right: mul(wall, .8), left: mul(wall, .86) });
      const rt = vidrio ? (() => { const t = new Tex(W, 1, spec.seed + k, [0, 0, 0], 0); t.rect(0, 0, t.w, 2, frame); for (let xx = 0; xx < t.w; xx += px(1.4)) t.rect(xx, 0, xx + 1, t.h, frame); for (let xx = 3; xx < t.w; xx += 11) for (let j = 0; j < 4; j++) t.p(xx + j, 4 + j, [220, 236, 246]); return t; })() : railingTex(W, 1, spec.seed + k, frame.map(v => v * .4));
      const cerr = R3.DECALS.fd_ed_balcon_cerrado && r() < .18, para = !vidrio && R3.DECALS.fd_ed_parapeto && r() < .35;
      if (cerr) { const ct = decalTex("fd_ed_balcon_cerrado", W, 2.2, Math.max(1, Math.round(W / 3))); sc.box(0, -1.2, zb + .15, W, -1.18, zb + 2.35, { front: ct, back: ct, cast: false });
        sc.box(0, -1.2, zb + 2.35, W, 0, zb + 2.5, { front: add(wall, 10), top: [214, 210, 202], right: mul(wall, .8), left: mul(wall, .86) }); continue; }
      const gv = vidrio && R3.DECALS.fd_ed_baranda_vidrio ? decalTex("fd_ed_baranda_vidrio", W, 1, Math.max(1, Math.round(W / 3))) : para ? decalTex("fd_ed_parapeto", W, 1.2, Math.max(1, Math.round(W / 3))) : null;
      sc.box(0, -1.2, zb + .15, W, -1.18, zb + (para ? 1.35 : 1.15), { front: gv || rt, back: gv || rt, cast: !!para });
      for (const xx of [0, W - .03]) sc.box(xx, -1.2, zb + .15, xx + .03, 0, zb + 1.15, { right: railingTex(1.2, 1, spec.seed), left: railingTex(1.2, 1, spec.seed), cast: false });
      for (let i = r.int(0, 3); i > 0; i--) plant(sc, r.uniform(.2, W - .6), -1, zb + .15, r.int(0, 99999), r() < .4);
      if (r() < .35) ac(sc, r.uniform(.3, W - 1.1), -.35, zb + .15, r.int(0, 9999), false);
      if (r() < .06) { const c0 = r.uniform(.4, W * .5); clothes(sc, c0, c0 + Math.min(2.2, W * .4), -.7, zb + 1.9, r.int(0, 99999)); } }
    else for (let k = 1; k < n; k++) if (r() < .4) ac(sc, r.uniform(.3, W - 1.1), 0, GF2 + (k - 1) * UF2 + .3, r.int(0, 9999));
    // terraza: sala de máquinas con tanques, antenas, aire
    const mw = Math.min(3, W * .4), mx = r.uniform(.4, W - mw - .4), my = D * r.uniform(.35, .55), mt = new Tex(mw, 2.4, spec.seed + 60); mt.stucco(mix(wall, [210, 206, 198], .5), 1.2); mt.runoff(.8, 1.4);
    doorDecal(mt, px(.3), px(.4), px(.8), px(1.9), "chapa", wall);
    sc.box(mx, my, zr, mx + mw, my + 2.4, zr + 2.4, { front: mt, back: mt, left: mt, right: mt, top: roofTex(mw, 2.4, "losa", spec.seed + 61) });
    tank(sc, mx + mw * .3, my + 1.2, zr + 2.4, spec.seed + 62, "negro"); if (mw > 2) tank(sc, mx + mw * .75, my + 1.2, zr + 2.4, spec.seed + 63, "negro");
    if (r() < .7) antenna(sc, r.uniform(.4, W - .4), D * .8, zr); if (r() < .5) ac(sc, r.uniform(.3, W - 1.1), D * .2, zr, spec.seed + 64, false);
    if (shop) { const [name, scol] = shop, sw = Math.min(lw, 6), st = new Tex(sw, .55, spec.seed + 40); st.stucco(scol, .2);
      text(st, name, Math.max(1, (st.w - textW(name)) >> 1), 3, [252, 250, 244], true, mul(scol, .45));
      sc.box(lado[0], -.16, 2.6, lado[0] + sw, 0, 3.15, { front: st, top: add(scol, 20), right: mul(scol, .6), left: mul(scol, .7) }); }
    return { sc, storeys: n, depth: D, shop: shop && shop[0], height: zr };
  }

  // ---------- petit hotel / casa de estilo (zonas ricas): fachada clásica con pilastras, buñado en planta baja,
  // ventanas altas con balconcitos, cornisa con dentículos y puerta de madera de dos hojas.
  function petit(spec, phi) {
    const r = rng(spec.seed), W = spec.W, D = spec.D, n = spec.p || 2, GF2 = 3.8, UF2 = 3.4;
    const sc = new Scene(); sc.setXform(phi);
    const wall = r.pick([[226, 214, 190], [214, 206, 192], [232, 224, 206], [204, 196, 184], [222, 206, 180]]), zr = GF2 + (n - 1) * UF2, Htot = zr + 1.2;
    const zt = (z) => px(Htot - z), X = (m) => px(m);
    const ft = new Tex(W, Htot, spec.seed); ft.stucco(wall, .5);
    for (let yy = zt(GF2); yy < zt(.5); yy += px(.32)) ft.shade(0, yy, ft.w, yy + 1, .78);            // buñado
    ft.rect(0, zt(.5), ft.w, ft.h, mul(wall, .72)); ft.humidity(.5);
    const dw = 1.5, dx = r.pick([.6, W - dw - .6, (W - dw) / 2]);
    if (R3.DECALS.fd_puerta_chorizo) doorDecal(ft, X(dx), zt(2.9), X(dw), px(2.88), "chorizo", wall);
    else { doorDecal(ft, X(dx), zt(2.9), X(dw / 2), px(2.88), "madera", wall); doorDecal(ft, X(dx + dw / 2), zt(2.9), X(dw / 2), px(2.88), "madera", wall); }
    ft.rect(X(dx) - 3, zt(3.25), X(dx + dw) + 3, zt(2.9) - 2, add(wall, 18));                          // frontis
    const wins = []; const cols = Math.max(2, Math.floor(W / 2.3));
    for (let k = 0; k < n; k++) { const zb = k === 0 ? 0 : GF2 + (k - 1) * UF2, hh = k === 0 ? 2.1 : 2.4, zw = zb + (k === 0 ? .9 : .5);
      for (let i = 0; i < cols; i++) { const cx = W * (i + .5) / cols; if (k === 0 && Math.abs(cx - (dx + dw / 2)) < 1.4) continue;
        windowDecal(ft, X(cx - .55), zt(zw + hh), X(1.1), px(hh), k === 0 ? "persiana" : r.pick(["arco", "persiana", "persiana"]), wall); wins.push([cx - .55, zw, 1.1, hh, k]); } }
    const stx = new Tex(D, Htot, spec.seed + 3); stx.stucco(mix(wall, [200, 196, 188], .5), 1); stx.runoff(.8, 1);
    const bt = new Tex(W, Htot, spec.seed + 1); bt.stucco(mix(wall, [196, 192, 186], .4), 1);
    const ftc = (a, b) => ft.crop(zt(b), zt(a)), btc = (a, b) => bt.crop(zt(b), zt(a)), stc = (a, b) => stx.crop(zt(b), zt(a));
    sc.box(0, 0, 0, W, D, zr, { front: ftc(0, zr), back: btc(0, zr), left: stc(0, zr), right: stc(0, zr), top: roofTex(W, D, "piedra", spec.seed + 5) });
    // pilastras y cornisa
    const lt = add(wall, 16), dk = mul(wall, .82);
    for (const xx of [0, W - .35]) sc.box(xx, -.14, .5, xx + .35, 0, zr, { front: lt, right: dk, left: mul(wall, .88), top: lt });
    for (let k = 1; k < n; k++) { const zb = GF2 + (k - 1) * UF2; sc.box(-.04, -.12, zb - .12, W + .04, 0, zb + .05, { front: lt, top: add(wall, 26), right: dk, left: dk }); }
    const dent = new Tex(W, .22, spec.seed + 9, lt); for (let xx = 0; xx < dent.w; xx += px(.25)) dent.shade(xx, dent.h >> 1, xx + px(.12), dent.h, .7);
    sc.box(-.1, -.25, zr - .25, W + .1, 0, zr, { front: dent, top: lt, right: dk, left: dk });
    sc.box(-.18, -.42, zr, W + .18, .1, zr + .18, { front: add(wall, 22), top: add(wall, 30), right: dk, left: dk });
    const par = new Tex(W, 1, spec.seed + 11, lt); for (let xx = px(.2); xx < par.w - px(.2); xx += px(.32)) par.rect(xx, px(.25), xx + px(.12), par.h - 2, mul(wall, .55));
    sc.box(0, -.05, zr + .18, W, .15, zr + 1.2, { front: par, back: par, top: lt, left: dk, right: dk });
    // ventanas: dintel con clave y balconcito en los pisos altos
    for (const [xm, zw, ww, hh, k] of wins) {
      sc.box(xm - .12, -.08, zw + hh, xm + ww + .12, 0, zw + hh + .22, { front: add(wall, 20), top: add(wall, 30), right: dk, left: dk });
      sc.box(xm + ww / 2 - .1, -.11, zw + hh - .05, xm + ww / 2 + .1, 0, zw + hh + .28, { front: add(wall, 28), right: dk, left: dk });
      if (k > 0) { sc.box(xm - .2, -.55, zw - .1, xm + ww + .2, 0, zw + .02, { front: lt, top: add(wall, 24), right: dk, left: dk });
        const orn = decalTex("fd_balcon_hierro", ww + .36, .93);
        sc.box(xm - .18, -.55, zw + .02, xm + ww + .18, -.53, zw + .95, { front: orn || railingTex(ww + .36, .93, spec.seed + k, [30, 30, 34], 3), back: orn || railingTex(ww + .36, .93, spec.seed, [30, 30, 34], 3), cast: false });
        if (r() < .5) plant(sc, xm + r.uniform(0, ww - .35), -.45, zw + .02, r.int(0, 9999)); }
      else sc.box(xm - .1, -.1, zw - .08, xm + ww + .1, 0, zw, { front: [232, 228, 218], top: [244, 240, 232], right: [196, 192, 184], left: [206, 202, 194] }); }
    tank(sc, r.uniform(1, W - 1), D * .6, zr, spec.seed + 90, "gris");
    if (r() < .6) { const cx = r.uniform(.5, W - .8); sc.box(cx, D * .8, zr, cx + .45, D * .8 + .45, zr + 1.4, { front: [172, 96, 70], back: [172, 96, 70], right: [140, 76, 56], left: [150, 80, 60], top: [80, 70, 64] }); }
    return { sc, storeys: n, depth: D, shop: null, height: zr };
  }

  // tapial / alambrado de baldío
  function tapial(W, seed, kind, phi = 0) {
    const sc = new Scene(); sc.setXform(phi); const r = rng(seed);
    if (kind === "alambre") {
      const t = new Tex(W, 1.6, seed, [0, 0, 0], 0); for (let x = 0; x < t.w; x++) for (let y = 0; y < t.h; y++) if ((x + y) % 5 === 0 || (x - y + 500) % 5 === 0) t.p(x, y, [166, 170, 174]);
      t.rect(0, 0, t.w, 1, [140, 144, 150]); sc.box(0, 0, 0, W, .02, 1.6, { front: t, back: t, cast: false });
      for (let xp = 0; xp < W; xp += 2.4) sc.box(xp, 0, 0, xp + .12, .12, 1.75, { front: [192, 188, 178], back: [192, 188, 178], right: [150, 146, 138], left: [160, 156, 148], top: [220, 216, 206] });
      if (r() < .8) { const s = new Tex(1.2, .45, 3, [244, 232, 120]); text(s, "VENDO", 3, 1, [200, 30, 30], false); sc.box(W / 2 - .6, -.05, .7, W / 2 + .6, -.02, 1.15, { front: s, back: s }); }
    } else {
      const t = new Tex(W, 2, seed); if (kind === "ladrillo") t.brick(); else { t.stucco(r.pick(WALLS), 1.5); t.runoff(.6, 1.4); t.peel(2); t.humidity(.6); }
      if (r() < .8) pintada(t, 4, t.w - 4, px(.6), r);
      sc.box(0, 0, 0, W, .2, 2, { front: t, back: t, top: [204, 200, 190], right: [150, 146, 140], left: [160, 156, 150] });
      for (let xp = 0; xp < W - .1; xp += 3) sc.box(xp, -.05, 0, xp + .3, .25, 2.1, { front: [196, 192, 182], back: [196, 192, 182], top: [214, 210, 200], right: [150, 146, 140], left: [160, 156, 150] });
    }
    return { sc };
  }
  // paredón del borde del área jugable: revoque gastado de 3 m con pilares cada 4 m, pintadas y alambre de púas arriba
  // (como los paredones de las vías). Local: a lo largo de x, el espesor hacia +y.
  function paredon(W, seed, phi = 0) {
    const sc = new Scene(); sc.setXform(phi); const r = rng(seed), H = 3;
    const t = new Tex(W, H, seed); t.stucco(r.pick([[176, 170, 158], [196, 186, 166], [168, 160, 150], [190, 176, 150]]), 1.6); t.runoff(.9, 1.6); t.peel(3); t.humidity(.9);
    for (let x0 = 4 + r.int(0, 30); x0 < t.w - 50;) { const x1 = Math.min(t.w - 4, x0 + r.int(60, 100)); if (r() < .8) pintada(t, x0 + 8, x1 - 8, px(r.uni(.6, 1.5)), r); x0 = x1 + r.int(25, 60); }   // sin pisarse (la letra con borde es más ancha de lo que calcula pintada)
    sc.box(0, 0, 0, W, .3, H, { front: t, back: t, top: [150, 146, 138], right: [128, 124, 118], left: [138, 134, 128] });
    for (let xp = 0; xp < W - .1; xp += 4) sc.box(xp, -.06, 0, xp + .4, .36, H + .1, { front: [182, 176, 164], back: [182, 176, 164], top: [204, 198, 186], right: [140, 136, 128], left: [150, 146, 138] });
    for (let xp = .2; xp < W; xp += 2) sc.box(xp, .12, H, xp + .05, .17, H + .5, { front: [70, 66, 62], back: [70, 66, 62], right: [56, 52, 50], left: [60, 56, 52], top: [80, 76, 72], cast: false });
    for (const z of [H + .2, H + .34, H + .47]) sc.box(0, .13, z, W, .16, z + .03, { front: [96, 92, 88], back: [96, 92, 88], top: [120, 116, 110], cast: false });
    return { sc };
  }
  // poste de madera (cruceta perpendicular a la calle) — local: calle a lo largo de x
  function poste(seed, phi, luz) {
    const sc = new Scene(); sc.setXform(phi);
    const w = new Tex(.26, 8.5, seed, [112, 82, 56]); w.stucco([112, 82, 56], 1.5); for (let y = 0; y < w.h; y += 7) w.shade(0, y, w.w, y + 1, .85);
    sc.box(-.13, -.13, 0, .13, .13, 8.5, { front: w, back: w, left: w, right: w, top: [96, 70, 48] });
    sc.box(-.06, -.9, 7.9, .06, .9, 8.05, { front: [98, 72, 50], back: [98, 72, 50], left: [90, 66, 46], right: [80, 58, 40], top: [110, 82, 58] });
    for (const yy of [-.8, .05, .75]) sc.box(-.05, yy, 8.05, .05, yy + .08, 8.25, { front: [236, 236, 228], right: [200, 200, 196], left: [210, 210, 206], top: [250, 250, 246], cast: false });
    if (luz) { sc.box(-.05, -1.0, 6.8, .05, -.04, 6.9, { front: [80, 80, 84], right: [70, 70, 74], top: [100, 100, 104] });
      sc.box(-.2, -1.3, 6.62, .2, -.85, 6.85, { front: [70, 72, 78], right: [56, 58, 62], left: [60, 62, 66], top: [96, 98, 104] }); }
    return { sc, cable: [[0, -.76, 8.18], [0, .09, 8.18], [0, .79, 8.18]] };
  }
  return { build, tapial, paredon, poste, WALLS };
})();
