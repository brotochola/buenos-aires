// ===================== cam.js — proyección del juego con giro de cámara =====================
// Igual que R3 (oblicua a 30° con corrimiento K), pero rotada por el giro "yaw" alrededor del eje vertical:
//   x' =  c·x + s·y      y' = -s·x + c·y            (coordenadas de vista, metros)
//   sx = (x' + K·y')·SF   sy = -(z·CZ + y'·SYN)·SF   (px de mundo, antes de zoom y paneo)
// El giro siempre queda en múltiplos de 7,5° (los 48 ángulos de los autos) salvo durante la transición.
const Cam = (() => {
  const SF = R3.SF, K = R3.K, CZ = R3.CZ, SYN = R3.SYN, T = SYN / CZ, STEP = Math.PI / 24;
  const C = { yaw: 0, c: 1, s: 0, ax: 1, ay: 0, bx: 0, by: 1 };
  function setYaw(a) {
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    C.yaw = a; C.c = Math.cos(a); C.s = Math.sin(a);
    C.ax = (C.c - K * C.s) * SF; C.ay = (C.s + K * C.c) * SF;      // sx = ax·x + ay·y
    C.bx = SYN * C.s * SF; C.by = -SYN * C.c * SF;                 // sy = bx·x + by·y - z·CZ·SF
  }
  setYaw(0);
  const sx = (x, y) => C.ax * x + C.ay * y;
  const sy = (x, y, z = 0) => C.bx * x + C.by * y - z * CZ * SF;
  const P = (x, y, z = 0) => [C.ax * x + C.ay * y, C.bx * x + C.by * y - z * CZ * SF];
  function unPInto(px, py, out) { const yv = -py / (SF * SYN), xv = px / SF - K * yv; out[0] = C.c * xv - C.s * yv; out[1] = C.s * xv + C.c * yv; return out; }
  function unP(px, py) { const yv = -py / (SF * SYN), xv = px / SF - K * yv; return [C.c * xv - C.s * yv, C.s * xv + C.c * yv]; }
  // profundidad (m) a lo largo de la dirección de proyección: mayor = más lejos
  const depth = (x, y, z = 0) => (-K * C.c - C.s) * x + (C.c - K * C.s) * y - T * z;
  // rumbo del mundo -> rumbo en la vista
  const viewAng = (hd) => hd - C.yaw;
  const snap = (a) => Math.round(a / STEP) * STEP;
  const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  return { SF, K, CZ, SYN, T, STEP, C, setYaw, sx, sy, P, unP, unPInto, depth, viewAng, snap, wrap, get yaw() { return C.yaw; } };
})();
