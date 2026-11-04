// ===================== sombraAuto.js — la sombra de un auto al sol =====================
// La sombra que hace WeedJS (ShadowCaster) es el sprite dado vuelta desde el pie y estirado hacia donde va la sombra: sirve
// para lo que está parado (gente, árboles, postes), pero un auto está dibujado visto desde arriba (techo y costado), así que
// su "sombra" salía como otro auto acostado, corrido para el costado. Acá la sombra es la del volumen: el piso que tapa la
// caja del auto, o sea la huella más el techo corrido por el sol (la envolvente convexa de los dos), un polígono de 8 vértices
// que el auto lleva como MeshRenderer en la capa de sombras de las casas (mismo negro, misma transparencia, se apaga de noche).
// La usan conurbanoScene.js y el banco de pruebas sombrasScene.js.

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
const _x = new Float64Array(8), _y = new Float64Array(8), _o = new Int32Array(8), _hull = new Int32Array(17);
function cr(o, a, b) { return (_x[a] - _x[o]) * (_y[b] - _y[o]) - (_y[a] - _y[o]) * (_x[b] - _x[o]); }
// out (Float32Array de 16): los 8 vértices (x, y), en coordenadas locales del auto (girado rc, rs = cos y sen del rumbo de
// pantalla). ha, hb: medio largo y medio ancho de la huella (px del dibujo). dx, dy: adónde cae el techo (px de mundo).
// k: achique del techo. Una envolvente de menos de 8 vértices repite el último (triángulos vacíos en el abanico).
export function sombraAuto(out, rc, rs, ha, hb, dx, dy, k) {
  const n2 = rc * rc + rs * rs; if (!(n2 > 1e-6)) { rc = 1; rs = 0; } else { const l = Math.sqrt(n2); rc /= l; rs /= l; }
  // rumbo verdadero θ (en el piso sin aplastar): tan θ = tan φ / S
  const th = Math.atan2(rs, AUTO_S * rc), ct = Math.cos(th), st = Math.sin(th);
  const ux = ha * ct, uy = ha * AUTO_S * st, vx = -hb * st, vy = hb * AUTO_S * ct;
  _x[0] = ux + vx; _y[0] = uy + vy; _x[1] = ux - vx; _y[1] = uy - vy; _x[2] = -ux - vx; _y[2] = -uy - vy; _x[3] = -ux + vx; _y[3] = -uy + vy;
  for (let q = 0; q < 4; q++) { _x[q + 4] = _x[q] * k + dx; _y[q + 4] = _y[q] * k + dy; }
  // envolvente convexa (cadena monótona)
  for (let q = 0; q < 8; q++) _o[q] = q;
  for (let a = 1; a < 8; a++) { const t = _o[a]; let b = a - 1; while (b >= 0 && (_x[_o[b]] > _x[t] || (_x[_o[b]] === _x[t] && _y[_o[b]] > _y[t]))) { _o[b + 1] = _o[b]; b--; } _o[b + 1] = t; }
  let m = 0;
  for (let q = 0; q < 8; q++) { const p = _o[q]; while (m >= 2 && cr(_hull[m - 2], _hull[m - 1], p) <= 0) m--; _hull[m++] = p; }
  for (let q = 6, lo = m + 1; q >= 0; q--) { const p = _o[q]; while (m >= lo && cr(_hull[m - 2], _hull[m - 1], p) <= 0) m--; _hull[m++] = p; }
  m--;   // el último repite el primero
  if (m > 8) m = 8;
  for (let q = 0; q < 8; q++) { const p = _hull[q < m ? q : m - 1], x = _x[p], y = _y[p];
    out[q * 2] = x * rc + y * rs; out[q * 2 + 1] = -x * rs + y * rc; }
  return out;
}
