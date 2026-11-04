// ===================== contorno.js — el contorno de los personajes y los autos, para todo lo demás =====================
// Los personajes LPC y los autos traen un anillo de 1 px muy oscuro alrededor de la silueta: luminosidad de 10 a 40 contra
// 60 a 200 del interior, el color del material oscurecido (casi negro en los oscuros, nunca gris claro) y alfa duro.
// El juego los muestra a 0,6 y a 1, o sea que en pantalla miden de 0,6 a 1 px de mundo.
// Las casas (R3), los árboles y los props de Gemini se muestran a otras escalas (0,6; 0,18 a 0,36), así que un contorno de
// 1 px de textura se pierde. Acá se pinta por fuera de la silueta con el grosor que hace falta en la textura para que en
// pantalla mida lo mismo: t = ceil(1 / escala a la que se muestra) (2 en casas y árboles, 3 a 6 en los props de Gemini).
const Contorno = (() => {
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = N4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  const lum = (r, g, b) => .299 * r + .587 * g + .114 * b;
  // el color del contorno: el del material, oscurecido hasta una luminosidad de 14 a 40 (como el de los LPC y los autos)
  function oscuro(r, g, b) { const L = lum(r, g, b), T = Math.max(14, Math.min(40, L * .3)), k = L > T ? T / L : 1; return [r * k, g * k, b * k]; }
  // grosor en px de textura para algo que el juego muestra a `escala`
  const grosor = (escala) => Math.max(1, Math.ceil(1 / escala - 1e-6));
  // d: RGBA de w×h (se modifica). Pinta un anillo de t px por fuera de lo opaco (alfa ≥ 128): los pasos impares en cruz y
  // los pares en las 8 direcciones (queda un octógono, no un cuadrado). Lo opaco queda con alfa 255 (borde duro).
  // evitar(x, y), opcional: true donde no va contorno (la base de una rama, que sale de otra).
  function aplicar(d, w, h, t, evitar) {
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
      const s = src[k] * 4, c = oscuro(d[s], d[s + 1], d[s + 2]), i = k * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; pintados++; }
    return pintados;
  }
  // un canvas con contorno: devuelve otro canvas t px más grande de cada lado (el dibujo corrido t px)
  function canvas(cv, t, evitar) {
    const w = cv.width + 2 * t, h = cv.height + 2 * t, out = document.createElement("canvas"); out.width = w; out.height = h;
    const g = out.getContext("2d", { willReadFrequently: true }); g.drawImage(cv, t, t);
    const id = g.getImageData(0, 0, w, h); aplicar(id.data, w, h, t, evitar && ((x, y) => evitar(x - t, y - t))); g.putImageData(id, 0, 0);
    return out;
  }
  return { aplicar, canvas, grosor, oscuro };
})();
