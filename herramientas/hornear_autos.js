// Hornea las hojas de autos del juego (img/autos/) desde el paquete "TopDown Vehicles" v1.17 de MinZiin (CC BY 4.0, https://minzinn.itch.io/).
// node herramientas/hornear_autos.js ["D:/temp/TopDown Vehicles v1.17"]
// De cada vehículo y color toma sólo los 48 cuadros quietos (SEPARATED/*All*): uno por rumbo de pantalla, cada 7,5°. La chatarra trae 8 (cada 45°).
// Guarda sólo los que miran a la derecha (de 270° a 90°, 25 de 48): el juego dibuja los de la izquierda espejando (rumbo 180° - a).
// El espejo se ve igual que el cuadro del paquete, y además WeedJS guarda una fila por cuadro del atlas en una textura de 3 × N:
// el atlas entero tiene que tener menos cuadros que el alto máximo de textura (8192 en muchas GPUs y en Chromium headless).
// Cada cuadro se guarda centrado en el punto donde el vehículo apoya en el piso, así el ancla (0,5, 0,5) no salta de un cuadro a otro.
// (WeedJS ancla sobre el rectángulo del cuadro e ignora sourceSize; al armar el atlas recorta lo transparente, así que centrar no ocupa más atlas.)
// Escribe img/autos/<hoja>.png|json y img/autos/autos.js (largo y ancho de cada modelo, lo importan todos los hilos).
// Después: python3 herramientas/apoyo_autos.py (corta cada cuadro en la rueda más baja, para que el auto se ordene donde apoya).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const PACK = process.argv[2] || 'D:/temp/TopDown Vehicles v1.17', OUT = path.join(__dirname, '..', 'img', 'autos');

// modelo: [carpeta del paquete, colores] (sin colores = viene en uno solo). Colores del paquete -> nombre en el juego.
const COLOR = { White: 'blanco', Black: 'negro', Red: 'rojo', Blue: 'azul', Yellow: 'amarillo', Brown: 'marron' };
const MODELOS = {
  hatch: ['HATCHBACK TOPDOWN', ['White', 'Red', 'Blue']],
  sedan: ['SEDAN TOPDOWN', ['White', 'Black', 'Brown']],
  pickup: ['PICKUP TOPDOWN', ['White', 'Black', 'Red']],
  compacto: ['CIVIC TOPDOWN', ['White', 'Blue']],
  micro: ['MICRO TOPDOWN', ['Red', 'White']],
  rural: ['WAGON TOPDOWN', ['Brown', 'White']],
  coupe: ['COUPE TOPDOWN', ['Red', 'Black']],
  lujo: ['LUXURY TOPDOWN', ['Black', 'White']],
  deportivo: ['SPORT TOPDOWN', ['Red', 'Yellow']],
  superauto: ['SUPERCAR TOPDOWN', ['Yellow', 'Black']],
  muscle: ['MUSCLECAR TOPDOWN', ['Black', 'Blue']],
  jeep: ['JEEP TOP DOWN', ['Black', 'Brown']],
  suv: ['SUV TOPDOWN', ['Black', 'White']],
  monovolumen: ['MINIVAN TOPDOWN', ['White', 'Blue']],
  utilitario: ['VAN TOP DOWN', ['White', 'Blue']],
  limusina: ['LIMO TOPDOWN', ['Black', 'White']],
  camion: ['BOX TRUCK TOPDOWN', ['White', 'Red']],
  volcador: ['MEDIUM TRUCK TOPDOWN', ['Yellow', 'Red']],
  casarodante: ['CAMPER TOPDOWN', ['White', 'Brown']],
  colectivo: ['BUS TOPDOWN', ['Yellow', 'Blue']],
  ambulancia: ['AMBULANCE TOPDOWN'], policia: ['POLICE TOPDOWN'], taxi: ['TAXI TOPDOWN'],
};
// chatarra: hoja -> carpeta dentro de Wreckage/
const CHATARRA = {
  quemado_sedan: 'Burnt/Sedan', quemado_hatch: 'Burnt/HatchBack', quemado_pickup: 'Burnt/Pickup', quemado_rural: 'Burnt/Wagon',
  quemado_coupe: 'Burnt/Coupe', quemado_utilitario: 'Burnt/Van', abandonado_sedan: 'Abandoned/Sedan/White', abandonado_pickup: 'Abandoned/Pickup/Red',
};
const PX_M = 18;   // px por metro del paquete (y del juego) en horizontal
const S = .7;      // aplastamiento del piso en la vista del paquete (ajustado con los 23 modelos)

// ---------- PNG mínimo (8 bits, sin entrelazado)
function readPng(file) {
  const b = fs.readFileSync(file); let p = 8, w, h, depth, type, inter, pal, trns; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (t === 'PLTE') pal = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
  }
  if (depth !== 8 || inter) throw new Error(file + ': PNG no soportado');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0; let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (type === 6) cur.copy(out, o, s, s + 4);
      else if (type === 2) { cur.copy(out, o, s, s + 3); out[o + 3] = 255; }
      else if (type === 3) { const k = cur[s]; pal.copy(out, o, k * 3, k * 3 + 3); out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
      else { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = type === 4 ? cur[s + 1] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, data: out };
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function chunk(t, d) {
  const td = Buffer.concat([Buffer.from(t, 'latin1'), d]), l = Buffer.alloc(4), c = Buffer.alloc(4); let k = -1;
  for (let i = 0; i < td.length; i++) k = CRC[(k ^ td[i]) & 255] ^ (k >>> 8);
  l.writeUInt32BE(d.length); c.writeUInt32BE((k ^ -1) >>> 0); return Buffer.concat([l, td, c]);
}
function writePng(file, { w, h, data }) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {   // filtro Paeth en todas las filas
    const o = y * (stride + 1); raw[o] = 4;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0, up = y ? data[i - stride] : 0, c = x >= 4 && y ? data[i - stride - 4] : 0;
      const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c);
      raw[o + 1 + x] = (data[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255;
    }
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
function bbox({ w, h, data }) {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x >= x1) x1 = x + 1; if (y < y0) y0 = y; if (y >= y1) y1 = y + 1; }
  return { x0, y0, x1, y1 };
}

// ---------- huella en el piso: los cuadros van en rumbo de pantalla φ, el modelo 3D está girado θ = atan2(sen φ / S, cos φ).
// Medio ancho de cada cuadro = a|cos θ| + b|sen θ| (a, b = medio largo y medio ancho de la huella); la base del cuadro = Q + S(a|sen θ| + b|cos θ|).
function huella(cajas, paso) {
  const th = cajas.map((_, k) => { const p = k * paso * Math.PI / 180; return Math.atan2(Math.sin(p) / S, Math.cos(p)); });
  let s11 = 0, s12 = 0, s22 = 0, r1 = 0, r2 = 0;
  cajas.forEach((o, k) => { const c = Math.abs(Math.cos(th[k])), s = Math.abs(Math.sin(th[k])), e = (o.x1 - o.x0) / 2; s11 += c * c; s12 += c * s; s22 += s * s; r1 += c * e; r2 += s * e; });
  const d = s11 * s22 - s12 * s12, a = (r1 * s22 - r2 * s12) / d, b = (s11 * r2 - s12 * r1) / d;
  const Q = cajas.reduce((q, o, k) => q + o.y1 - S * (a * Math.abs(Math.sin(th[k])) + b * Math.abs(Math.cos(th[k]))), 0) / cajas.length;
  return { a, b, Q: Math.round(Q) };
}

// ---------- una hoja: cuadros centrados en el apoyo (x = mitad del cuadro del paquete, y = Q), en filas.
// La huella se mide con todos los cuadros; a la hoja van los que miran a la derecha (cos ≥ 0). El espejo gira alrededor de x = P.
function hornear(hoja, archivos, paso) {
  const ims = archivos.map(readPng), cajas = ims.map(bbox), { a, b, Q } = huella(cajas, paso), P = ims[0].w / 2;
  const fr = ims.map((im, k) => { const c = cajas[k], hx = Math.max(P - c.x0, c.x1 - P), hy = Math.max(Q - c.y0, c.y1 - Q); return { im, k, sx: P - hx, sy: Q - hy, w: hx * 2, h: hy * 2 }; })
    .filter(f => Math.cos(f.k * paso * Math.PI / 180) > -1e-6);
  const G = 2, ancho = Math.ceil(Math.sqrt(fr.reduce((s, f) => s + (f.w + G) * (f.h + G), 0)) * 1.15);
  let x = 0, y = 0, fila = 0, W = 0;
  for (const f of fr.slice().sort((p, q) => q.h - p.h)) { if (x + f.w > ancho) { x = 0; y += fila + G; fila = 0; } f.x = x; f.y = y; x += f.w + G; fila = Math.max(fila, f.h); W = Math.max(W, x); }
  const H = y + fila, img = { w: W, h: H, data: Buffer.alloc(W * H * 4) }, frames = {}, animations = {};
  for (const f of fr) {
    for (let yy = 0; yy < f.h; yy++) for (let xx = 0; xx < f.w; xx++) {
      const sx = f.sx + xx, sy = f.sy + yy; if (sx < 0 || sy < 0 || sx >= f.im.w || sy >= f.im.h) continue;
      f.im.data.copy(img.data, ((f.y + yy) * W + f.x + xx) * 4, (sy * f.im.w + sx) * 4, (sy * f.im.w + sx) * 4 + 4);
    }
    const n = hoja + '_' + String(f.k).padStart(2, '0');
    frames[n] = { frame: { x: f.x, y: f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };
    animations[String(f.k * paso)] = [n];
  }
  writePng(path.join(OUT, hoja + '.png'), img);
  fs.writeFileSync(path.join(OUT, hoja + '.json'), JSON.stringify({ frames, animations,
    meta: { app: 'herramientas/hornear_autos.js', image: hoja + '.png', format: 'RGBA8888', size: { w: W, h: H }, scale: 1, fuente: 'TopDown Vehicles v1.17, MinZiin (CC BY 4.0)' } }));
  return { largo: +(2 * a / PX_M).toFixed(2), ancho: +(2 * b / PX_M).toFixed(2), px: W * H };
}
const pngs = (dir, n) => { const f = fs.readdirSync(dir).filter(x => x.endsWith('.png') && !x.includes('-sheet')).sort().map(x => path.join(dir, x)); if (f.length !== n) throw new Error(`${dir}: ${f.length} cuadros, se esperaban ${n}`); return f; };

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
const autos = {}, chatarra = {}; let total = 0;
for (const [m, [carpeta, colores]] of Object.entries(MODELOS)) {
  let med = null;
  for (const c of colores || [null]) {
    const dir = path.join(PACK, carpeta, c || 'ALL DIRECTION', 'SEPARATED'), r = hornear(c ? m + '_' + COLOR[c] : m, pngs(dir, 48), 7.5);
    med = med || r; total += r.px;
  }
  autos[m] = { largo: med.largo, ancho: med.ancho, colores: colores ? colores.map(c => COLOR[c]) : null };
  console.log(m.padEnd(12), med.largo + ' × ' + med.ancho + ' m', colores ? colores.map(c => COLOR[c]).join(', ') : '(un color)');
}
for (const [h, carpeta] of Object.entries(CHATARRA)) { const r = hornear(h, pngs(path.join(PACK, 'Wreckage', carpeta), 8), 45); chatarra[h] = { largo: r.largo, ancho: r.ancho }; total += r.px; }
fs.writeFileSync(path.join(OUT, 'autos.js'), `// generado por herramientas/hornear_autos.js — no editar a mano
// "TopDown Vehicles" v1.17 de MinZiin (https://minzinn.itch.io/), licencia CC BY 4.0.
// Huella en el piso en metros. Hojas: img/autos/<modelo>_<color> (o <modelo> si viene en un solo color), rumbos de pantalla cada 7,5°
// (la chatarra, cada 45°), sólo los que miran a la derecha: los otros se dibujan espejados. Cada cuadro está centrado en el punto de apoyo: ancla (0,5, 0,5).
export const AUTOS = ${JSON.stringify(autos)};
export const CHATARRA = ${JSON.stringify(chatarra)};
`);
const hojas = Object.values(autos).reduce((s, a) => s + (a.colores ? a.colores.length : 1), 0), cuadros = hojas * 25 + Object.keys(chatarra).length * 5;
console.log(Object.keys(autos).length + ' modelos en ' + hojas + ' hojas, ' + Object.keys(chatarra).length + ' chatarras: ' + cuadros + ' cuadros en el atlas, ' + (total / 1e6).toFixed(1) + ' Mpx de hojas');
