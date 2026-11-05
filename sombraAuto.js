// ===================== sombraAuto.js — las sombras de volumen de los autos y de las casas =====================
// La sombra que hace WeedJS con un ShadowCaster es el sprite dado vuelta desde el pie y estirado hacia donde va la sombra: sirve
// para lo que está parado (gente, árboles, postes). Un auto o una casa vistos desde arriba son volúmenes: acá se arman como
// mallas con una altura por vértice (cajaAuto, volumenSombra) para la capa sunProjected de WeedJS, que corre cada vértice
// según su altura y el sol de cada cuadro, igual que el sol corre el punto a esa altura en el sprite de un ShadowCaster.
// Así casas, autos, gente y árboles proyectan para el mismo lado y con el mismo largo, y la capa (alphaBySun 'shadow') les da
// la misma oscuridad. La usan conurbanoScene.js y el banco de pruebas sombrasScene.js.

// los autos del paquete están dibujados con el piso aplastado a S (hornear_autos.js), a 18 px/m: una altura de h m se ve
// de h·18·√(1−S²) px
export const AUTO_S = .7, AUTO_PXM = 18, AUTO_CZ = Math.sqrt(1 - AUTO_S * AUTO_S);
// alto de cada modelo (m) y cuánto se achica el techo respecto de la huella (la cabina de un auto es más chica que la caja)
const ALTO = { colectivo: [3, .96], camion: [2.7, .95], volcador: [2.8, .95], casarodante: [2.9, .95], ambulancia: [2.5, .93], utilitario: [2, .9],
  monovolumen: [1.75, .85], suv: [1.75, .85], jeep: [1.85, .85], pickup: [1.8, .8], micro: [1.45, .8], limusina: [1.45, .8], policia: [1.5, .78],
  taxi: [1.45, .78], deportivo: [1.2, .75], superauto: [1.15, .75], quemado: [1.3, .78], abandonado: [1.35, .78] };
// [alto en px de pantalla, achique del techo] de una hoja ('hatch_rojo', 'quemado_sedan', 'policia'…)
export function altoAuto(hoja) {
  const m = String(hoja || '').split('_')[0], a = ALTO[m] || [1.45, .78];
  return [a[0] * AUTO_PXM * AUTO_CZ, a[1]];
}
const _x = new Float64Array(8), _y = new Float64Array(8);

// ---------- la sombra de un auto como volumen (capa sunProjected de WeedJS)
// La caja del auto: la huella a altura 0 y el techo (la huella achicada a k, centrada) a la altura del auto. La placa corre el
// techo con el sol en cada cuadro, así que la malla sólo cambia cuando el auto gira: la huella en el piso aplastado depende del
// rumbo. out (Float32Array de 16): los 8 vértices (x, y) en coordenadas locales del auto (girado rc, rs); CAJA_T, sus
// triángulos (techo y cuatro costados: el piso queda tapado por ellos); cajaAlturas(alto), las alturas de los 8.
export const CAJA_T = [4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
export function cajaAlturas(alto) { return [0, 0, 0, 0, alto, alto, alto, alto]; }
export function cajaAuto(out, rc, rs, ha, hb, k) {
  const n2 = rc * rc + rs * rs; if (!(n2 > 1e-6)) { rc = 1; rs = 0; } else { const l = Math.sqrt(n2); rc /= l; rs /= l; }
  const th = Math.atan2(rs, AUTO_S * rc), ct = Math.cos(th), st = Math.sin(th);
  const ux = ha * ct, uy = ha * AUTO_S * st, vx = -hb * st, vy = hb * AUTO_S * ct;
  _x[0] = ux + vx; _y[0] = uy + vy; _x[1] = ux - vx; _y[1] = uy - vy; _x[2] = -ux - vx; _y[2] = -uy - vy; _x[3] = -ux + vx; _y[3] = -uy + vy;
  for (let q = 0; q < 4; q++) { _x[q + 4] = _x[q] * k; _y[q + 4] = _y[q] * k; }
  for (let q = 0; q < 8; q++) { const x = _x[q], y = _y[q]; out[q * 2] = x * rc + y * rs; out[q * 2 + 1] = -x * rs + y * rc; }
  return out;
}

const MAXP = 256;   // puntos por casa, como mucho

// ---------- la sombra de una casa como volumen (capa sunProjected de WeedJS)
// La sombra de antes era la envolvente de los puntos corridos por el sol, y eso es exactamente la sombra del volumen convexo que
// encierra los puntos (x, y del piso que tienen debajo, y su altura). Acá se arma ese volumen una sola vez, al cargar: la placa
// corre cada vértice h · Sun.shadowLengthRatio · (Sun.shadowDirX, Sun.shadowDirY) en cada cuadro, lo mismo que el sol le hace al
// punto a esa altura en el sprite de un ShadowCaster, y lo que pintan sus caras es la sombra, con el sol que haya.
// P: x, y, z (m) desde off, n puntos; kz: px de pantalla por m de altura. V recibe x, y, h (px) de cada vértice usado y T los
// triángulos (índices locales), sin las caras del piso: con los tres vértices a altura 0 quedan debajo del dibujo de la casa.
// Devuelve cuántos vértices escribió (y deja en volumenSombra.nt cuántos índices); 0 si los puntos no encierran volumen.
// Envolvente incremental: corre al cargar (unas 5 000 casas de hasta 32 puntos), no en cada cuadro.
export function volumenSombra(P, off, n, kz, V, T) {
  volumenSombra.nt = 0;
  if (n > MAXP) n = MAXP;
  if (n < 4) return 0;
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  let ext = 0;
  for (let q = 0; q < n; q++) { const k = (off + q) * 3; X[q] = P[k]; Y[q] = P[k + 1]; Z[q] = Math.max(0, P[k + 2]) * kz;
    ext = Math.max(ext, Math.abs(X[q] - X[0]), Math.abs(Y[q] - Y[0]), Math.abs(Z[q] - Z[0])); }
  const eps = 1e-6 * Math.max(1, ext);
  // el tetraedro de arranque: el punto más a la izquierda, el más lejano a él, el más lejano a esa recta y el más lejano a ese plano
  let a = 0; for (let q = 1; q < n; q++) if (X[q] < X[a]) a = q;
  let b = -1, bd = 0; for (let q = 0; q < n; q++) { const d = (X[q] - X[a]) ** 2 + (Y[q] - Y[a]) ** 2 + (Z[q] - Z[a]) ** 2; if (d > bd) { bd = d; b = q; } }
  if (b < 0 || bd < eps * eps) return 0;
  const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a];
  let c = -1, cd = 0; for (let q = 0; q < n; q++) { const wx = X[q] - X[a], wy = Y[q] - Y[a], wz = Z[q] - Z[a];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx, d = cx * cx + cy * cy + cz * cz; if (d > cd) { cd = d; c = q; } }
  if (c < 0 || Math.sqrt(cd) < eps * Math.sqrt(bd)) return 0;
  const cara = (i, j, k) => { const ax = X[j] - X[i], ay = Y[j] - Y[i], az = Z[j] - Z[i], bx = X[k] - X[i], by = Y[k] - Y[i], bz = Z[k] - Z[i];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    return { i, j, k, nx, ny, nz, d: nx * X[i] + ny * Y[i] + nz * Z[i], viva: true }; };
  const base = cara(a, b, c);
  let e = -1, ed = 0; for (let q = 0; q < n; q++) { const d = Math.abs(base.nx * X[q] + base.ny * Y[q] + base.nz * Z[q] - base.d); if (d > ed) { ed = d; e = q; } }
  if (e < 0 || ed < eps) return 0;   // plano: no hay volumen
  const mx = (X[a] + X[b] + X[c] + X[e]) / 4, my = (Y[a] + Y[b] + Y[c] + Y[e]) / 4, mz = (Z[a] + Z[b] + Z[c] + Z[e]) / 4;
  const afuera = (i, j, k) => { const f = cara(i, j, k); return f.nx * mx + f.ny * my + f.nz * mz - f.d > 0 ? cara(i, k, j) : f; };
  let caras = [afuera(a, b, c), afuera(a, e, b), afuera(b, e, c), afuera(c, e, a)];
  for (let p = 0; p < n; p++) {
    if (p === a || p === b || p === c || p === e) continue;
    let hay = false;
    for (const f of caras) { f.ve = f.nx * X[p] + f.ny * Y[p] + f.nz * Z[p] - f.d > eps; if (f.ve) hay = true; }
    if (!hay) continue;   // adentro (o sobre el borde)
    const bordes = new Set();
    for (const f of caras) if (f.ve) { bordes.add(f.i * 1024 + f.j); bordes.add(f.j * 1024 + f.k); bordes.add(f.k * 1024 + f.i); }
    const nuevas = [];
    for (const f of caras) {
      if (!f.ve) { nuevas.push(f); continue; }
      for (const [u, v] of [[f.i, f.j], [f.j, f.k], [f.k, f.i]]) if (!bordes.has(v * 1024 + u)) nuevas.push(cara(u, v, p));   // horizonte
    }
    caras = nuevas;
  }
  const mapa = new Int32Array(n).fill(-1); let nv = 0, nt = 0;
  for (const f of caras) {
    if (Z[f.i] < 1e-3 && Z[f.j] < 1e-3 && Z[f.k] < 1e-3) continue;   // cara del piso
    for (const q of [f.i, f.j, f.k]) { if (mapa[q] < 0) { mapa[q] = nv; V[nv * 3] = X[q]; V[nv * 3 + 1] = Y[q]; V[nv * 3 + 2] = Z[q]; nv++; } T[nt++] = mapa[q]; }
  }
  volumenSombra.nt = nt;
  return nt >= 3 ? nv : 0;
}
volumenSombra.nt = 0;
