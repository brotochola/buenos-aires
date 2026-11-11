// ===================== sombraAuto.js — lo que mide cada auto, para su sombra =====================
// La sombra de un auto es un VolumeShadowCaster de WeedJS: una caja que la placa gira con el auto y corre con el sol (Auto en
// conurbanoScene.js, CocheP en sombrasScene.js). Acá queda lo que sólo el juego sabe: cuánto mide de alto cada modelo y cuánto se
// achica su techo.

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
