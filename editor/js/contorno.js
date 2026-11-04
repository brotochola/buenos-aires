// ===================== contorno.js — el contorno de los personajes y los autos, para todo lo demás =====================
// Los personajes LPC y los autos traen un anillo de 1 px oscuro alrededor de la silueta, con alfa duro. Acá el anillo es del
// color del relleno, oscurecido un poco (no negro): así se ve el verde de un árbol, el marrón de un tronco, el ladrillo.
// El juego los muestra a 0,6 y a 1, o sea que en pantalla miden de 0,6 a 1 px de mundo.
// Las casas (R3), los árboles y los props de Gemini se muestran a otras escalas (0,6; 0,18 a 0,36), así que un contorno de
// 1 px de textura se pierde. Acá se pinta por fuera de la silueta con el grosor que hace falta en la textura para que en
// pantalla mida lo mismo: t = ceil(1 / escala a la que se muestra) (2 en casas y árboles, 3 a 6 en los props de Gemini).
const Contorno = (() => {
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = N4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  const lum = (r, g, b) => .299 * r + .587 * g + .114 * b;
  // el color del contorno: el mismo del relleno, oscurecido un poco y con algo más de color (verde oscuro en las hojas, marrón
  // oscuro en un tronco, rojo oscuro en un techo de chapa), no negro
  function oscuro(r, g, b) { const m = (r + g + b) / 3, s = 1.25, k = .52, c = (v) => Math.max(0, Math.min(255, (m + (v - m) * s) * k));
    return [c(r), c(g), c(b)]; }
  // grosor en px de textura para algo que el juego muestra a `escala`
  const grosor = (escala) => Math.max(1, Math.ceil(1 / escala - 1e-6));
  // d: RGBA de w×h (se modifica). Pinta un anillo de t px por fuera de lo opaco (alfa ≥ 128): los pasos impares en cruz y
  // los pares en las 8 direcciones (queda un octógono, no un cuadrado). Lo opaco queda con alfa 255 (borde duro).
  // evitar(x, y), opcional: true donde no va contorno (la base de una rama, que sale de otra).
  // suave (0..1, opcional): el anillo es el color del relleno llevado a su oscuro en esa medida (como el borde de las caras de
  // las casas, R3.LIGHT.outline); sin suave, el oscuro entero (personajes y autos)
  function aplicar(d, w, h, t, evitar, suave) {
    const n = w * h, src = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) if (d[k * 4 + 3] >= 128) { src[k] = k; d[k * 4 + 3] = 255; }
    if (t <= 0) return 0;
    let q = [];
    for (let k = 0; k < n; k++) { if (src[k] < 0) continue; const x = k % w, y = (k - x) / w;   // el borde de lo opaco
      for (const [ox, oy] of N8) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || src[yy * w + xx] < 0) { q.push(k); break; } } }
    const anillo = [];
    for (let s = 1; s <= t; s++) { const nb = s & 1 ? N4 : N8, nq = [];
      for (const k of q) { const x = k % w, y = (k - x) / w;
        for (const [ox, oy] of nb) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const kk = yy * w + xx; if (src[kk] >= 0) continue; src[kk] = src[k]; nq.push(kk); } }
      // el paso en cruz deja sin tocar las esquinas del frente anterior: siguen siendo frente
      for (const k of nq) anillo.push(k); q = s & 1 ? q.filter(k => { const x = k % w, y = (k - x) / w;
        for (const [ox, oy] of N8) { const xx = x + ox, yy = y + oy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx] < 0) return true; } return false; }).concat(nq) : nq; }
    let pintados = 0;
    for (const k of anillo) { const x = k % w, y = (k - x) / w; if (evitar && evitar(x, y)) continue;
      const s = src[k] * 4, c = oscuro(d[s], d[s + 1], d[s + 2]), i = k * 4, a = suave == null ? 1 : suave;
      d[i] = d[s] + (c[0] - d[s]) * a; d[i + 1] = d[s + 1] + (c[1] - d[s + 1]) * a; d[i + 2] = d[s + 2] + (c[2] - d[s + 2]) * a; d[i + 3] = 255; pintados++; }
    return pintados;
  }
  // un canvas con contorno: devuelve otro canvas t px más grande de cada lado (el dibujo corrido t px)
  function canvas(cv, t, evitar, suave) {
    const w = cv.width + 2 * t, h = cv.height + 2 * t, out = document.createElement("canvas"); out.width = w; out.height = h;
    const g = out.getContext("2d", { willReadFrequently: true }); g.drawImage(cv, t, t);
    const id = g.getImageData(0, 0, w, h); aplicar(id.data, w, h, t, evitar && ((x, y) => evitar(x - t, y - t)), suave); g.putImageData(id, 0, 0);
    return out;
  }
  return { aplicar, canvas, grosor, oscuro };
})();
