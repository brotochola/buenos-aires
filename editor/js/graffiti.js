// ===================== graffiti.js — las pintadas de las paredes de Buenos Aires =====================
// Relevamiento (resumen): en las paredes porteñas conviven
//   - mensajes personales en aerosol: "PATO TE AMO", "VALE CALLATE", "YA NO SALGO", "ME DA LO MISMO" (los que juntó Oscar Landi
//     en los 90), cumpleaños, perdones, nombres de parejas;
//   - barras y fútbol: "AGUANTE RIVER", el nombre del grupo de la esquina ("LOS DESCOLGADOS"); en Bajo Flores, San Lorenzo
//     (el Nuevo Gasómetro está al lado de la 1-11-14): CASLA, CICLÓN, "VOLVEMOS A BOEDO";
//   - bandas de rock y cumbia: Los Redondos, La Renga, Callejeros, Ramones, "Inocentes por ahora";
//   - pintadas "de pintor": pared blanqueada a la cal y letras grandes de imprenta en uno o dos colores (las hacen pintores,
//     no al pasar): consignas de derechos humanos ("NUNCA MÁS", "30.000 PRESENTES", "NI UNA MENOS"), del barrio
//     ("URBANIZACIÓN YA", "LA LUZ ES UN DERECHO"), del club o de la murga;
//   - poesía de pared: fondo blanco, letras negras finas, una frase corta y tierna o irónica, sin consigna política;
//   - firmas (tags) y bombas (letras gordas de dos colores con borde: plateado, amarillo, rosa) de los grafiteros;
//   - lo práctico: SE VENDE, ALQUILO, NO ESTACIONAR, NO TIRAR BASURA, un teléfono;
//   - en la villa, además, la fe de cada comunidad: Gauchito Gil, Virgen de Caacupé (paraguayos), Señor de los Milagros
//     (peruanos), y el Padre Ricciardelli, que le da nombre al barrio.
// Las frases ingeniosas y la poesía son nuestras (escritas para el juego, en porteño); las consignas y los nombres son los que
// se ven en las paredes.
//
// Graffiti.pintar(t, x0, x1, y, r, ctx) pinta una en la textura t (R3.Tex, en px) entre x0 y x1, desde y hacia abajo.
// ctx: { pobre, villa, paredon } (opcional). Usa siempre dos tiradas de r (el resto sale de su propio sorteo), así no corre lo
// que viene después en la casa. Devuelve true si entró algo.
const Graffiti = (() => {
  // ---------- frases
  const AMOR = ["PATO TE AMO", "VALE CALLATE", "YA NO SALGO", "ME DA LO MISMO", "MICA TE AMO", "VOLVE ROCIO", "JONA Y MILI", "PERDON LUCI",
    "FELIZ CUMPLE TATI", "FELIZ 15 YAMI", "TE EXTRAÑO NEGRA", "CAMI Y BRIAN 2026", "SOFI SOS MI VIDA", "MAMA TE QUIERO"];
  const FUTBOL = ["AGUANTE CASLA", "CASLA", "SAN LORENZO", "VOLVEMOS A BOEDO", "CICLON", "CUERVOS", "AGUANTE BOCA", "RIVER PLATE", "LOS PIBES DEL BAJO",
    "LA 1-11-14", "LOS DEL PASILLO", "LOS DESCOLGADOS", "LA ESQUINA DE SIEMPRE", "BARRIO RIVADAVIA"];
  const BANDAS = ["LOS REDONDOS", "LA RENGA", "CALLEJEROS", "RAMONES", "INOCENTES POR AHORA", "DAMAS GRATIS", "LOS PIOJOS", "PIBES CHORROS NO"];
  const INGENIO = ["NO PINTAR", "EL QUE LEE ES GIL", "PROHIBIDO PROHIBIR", "OTRA VEZ LUNES", "MAS MATE MENOS ODIO", "EL BONDI NO VIENE NUNCA",
    "SE BUSCA FUTURO", "VOLVE TE PERDONO EL FERNET", "FUI A COMPRAR PAN Y NO VOLVI", "DIOS ES ARGENTINO PERO NO ATIENDE ACA", "SONRIA NO LO FILMAMOS",
    "BAJO FLORES NO SE VENDE", "ACA NO SE RINDE NADIE", "LA CUADRA ES CORTA LA VIDA TAMBIEN", "MENOS PANTALLA MAS VEREDA", "TODO TIEMPO PASADO FUE ANTEAYER"];
  const SOCIAL = ["NUNCA MAS", "MEMORIA VERDAD Y JUSTICIA", "30.000 PRESENTES", "NI UNA MENOS", "URBANIZACION YA", "NI UN PIBE MENOS", "PAN TECHO Y TRABAJO",
    "TIERRA TECHO Y TRABAJO", "QUEREMOS AGUA", "LA LUZ ES UN DERECHO", "EDUCACION PUBLICA", "EL BARRIO ES NUESTRO"];
  const FE = ["GAUCHITO GIL", "VIRGEN DE CAACUPE", "SEÑOR DE LOS MILAGROS", "PADRE RICCIARDELLI PRESENTE", "CURAS VILLEROS", "VIVA PARAGUAY", "VIVA BOLIVIA", "DIOS ES FIEL"];
  const CLUB = ["SAN LORENZO DE ALMAGRO", "VOLVEMOS A BOEDO", "CASLA CAMPEON", "MURGA LOS PIBES DEL BAJO", "BAILANTA EL SABADO", "CLUB SOCIAL Y DEPORTIVO"];
  const PRACTICO = () => [["SE VENDE", "15-" + num(4) + "-" + num(4)], ["ALQUILO", "15-" + num(4) + "-" + num(4)], ["NO ESTACIONAR"], ["NO TIRAR BASURA"],
    ["NO TIRAR BASURA", "TE ESTAMOS VIENDO"], ["GUARDA CON EL PERRO"], ["CERRAJERO 24 HS"], ["VOLQUETES", "4" + num(3) + "-" + num(4)]];
  // poesía de pared: tierna o irónica, corta, en dos o tres renglones
  const POESIA = [["TE BUSQUE EN CADA ESQUINA", "Y ESTABAS EN LA OCHAVA"], ["NO HAY LUNA", "COMO LA DEL BAJO"], ["SI ME VAS A EXTRAÑAR", "EMPEZA AHORA"],
    ["LA ESPERANZA", "VIVE EN EL PASILLO"], ["SOMOS LO QUE HICIMOS", "CON LO QUE NOS TOCO"], ["AMAR ES CEBARTE", "EL MATE LAVADO", "Y SONREIR"],
    ["MIRAME", "QUE ME ESTOY YENDO"], ["TE QUIERO", "MAS QUE AL AGUINALDO"], ["EL BARRIO", "TAMBIEN SUEÑA"], ["OJALA LLUEVA", "Y SE LAVE TODO"],
    ["NO TE VAYAS", "QUE RECIEN LLEGO EL OTOÑO"], ["CUANDO NO ESTAS", "EL COLECTIVO TARDA MAS"]];
  const CREWS = ["HMK", "BSAS", "DTK", "RKS", "SKOR", "ROKE", "KAOS", "FLOR", "BAJO", "NEKO", "TUKI", "ZONA"];
  let gr = Math.random;
  const num = (n) => { let s = ""; for (let i = 0; i < n; i++) s += (gr() * 10) | 0; return s; };

  // ---------- fuente 5×7 (mayúsculas, números, Ñ y algunos signos); las tildes se escriben sin tilde, como en la pared
  const FONT = { A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01111 10000 10000 10000 10000 10000 01111",
    D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
    G: "01111 10000 10000 10011 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "11111 00100 00100 00100 00100 00100 11111",
    J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
    M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
    P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
    S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
    V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
    Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111", "Ñ": "01110 00000 10001 11001 10101 10011 10001",
    "0": "01110 10011 10101 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110", "2": "01110 10001 00001 00010 00100 01000 11111",
    "3": "11110 00001 00001 01110 00001 00001 11110", "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000", "8": "01110 10001 10001 01110 10001 10001 01110",
    "9": "01110 10001 10001 01111 00001 00010 01100", "!": "00100 00100 00100 00100 00100 00000 00100", "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 00000 00100", ",": "00000 00000 00000 00000 00000 00100 01000", "?": "01110 10001 00001 00110 00100 00000 00100",
    "+": "00000 00100 00100 11111 00100 00100 00000", "/": "00001 00010 00010 00100 01000 01000 10000", "♥": "00000 01010 11111 11111 01110 00100 00000",
    " ": "00000 00000 00000 00000 00000 00000 00000" };
  const ROWS = {}; for (const k in FONT) ROWS[k] = FONT[k].split(" ");
  const sinTilde = (s) => s.replace(/[ÁÀ]/g, "A").replace(/[ÉÈ]/g, "E").replace(/[ÍÌ]/g, "I").replace(/[ÓÒ]/g, "O").replace(/[ÚÙÜ]/g, "U");

  // ---------- pintura
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  // mancha redonda con borde suave (a: opacidad en el centro)
  function dot(t, cx, cy, rad, c, a = 1) {
    const x0 = Math.max(0, Math.floor(cx - rad - 1)), x1 = Math.min(t.w - 1, Math.ceil(cx + rad + 1)), y0 = Math.max(0, Math.floor(cy - rad - 1)), y1 = Math.min(t.h - 1, Math.ceil(cy + rad + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2), al = a * clamp(rad + .5 - d, 0, 1); if (al <= 0) continue;
      const i = (y * t.w + x) * 4; if (t.d[i + 3] < 128) continue;   // sólo sobre la pared
      t.d[i] += (c[0] - t.d[i]) * al; t.d[i + 1] += (c[1] - t.d[i + 1]) * al; t.d[i + 2] += (c[2] - t.d[i + 2]) * al; }
  }
  function box(t, x0, y0, x1, y1, c, a = 1) { for (let y = Math.max(0, y0 | 0); y < Math.min(t.h, y1 | 0); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(t.w, x1 | 0); x++) {
    const i = (y * t.w + x) * 4; if (t.d[i + 3] < 128) continue; t.d[i] += (c[0] - t.d[i]) * a; t.d[i + 1] += (c[1] - t.d[i + 1]) * a; t.d[i + 2] += (c[2] - t.d[i + 2]) * a; } }
  // chorreado: una línea que baja y se afina, con una gota al final
  function drip(t, x, y, len, c, w = 1) { for (let k = 0; k < len; k++) { const a = 1 - k / (len * 1.4); for (let j = 0; j < w; j++) dot(t, x + j, y + k, .5, c, a); } dot(t, x + (w - 1) / 2, y + len, .9, c, .7); }
  // las celdas encendidas de un renglón (escala c px, inclinación, ondulación), en px de la textura
  function celdas(txt, x, y, c, opt) { const out = []; let cx = x;
    for (let i = 0; i < txt.length; i++) { const ch = txt[i], rows = ROWS[ch] || ROWS[" "], jx = (gr() - .5) * opt.jit * c, jy = Math.sin(i * .8 + opt.fase) * opt.onda * c + (gr() - .5) * opt.jit * c;
      const sc = 1 + (gr() - .5) * opt.varia;
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (rows[gy][gx] === "1") {
        const below = gy === 6 || rows[gy + 1][gx] !== "1";
        out.push({ x: cx + jx + gx * c * sc + (6 - gy) * c * opt.incl, y: y + jy + gy * c * sc, below, ch: i, gx, gy }); }
      cx += (5 * sc + opt.esp) * c; }
    return { out, w: cx - x - opt.esp * c }; }
  const ancho = (txt, c, esp) => txt.length * (5 + esp) * c - esp * c;
  // trazo continuo: une cada celda con sus vecinas de la misma letra (derecha, abajo y diagonales) con puntos cada medio px
  function trazos(t, out, c, rad, col, a = .95) {
    const key = (p) => p.ch * 100 + p.gy * 10 + p.gx, M = new Map(out.map(p => [key(p), p]));
    for (const p of out) { dot(t, p.x + c / 2, p.y + c / 2, rad, col, a);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) { const q = M.get(p.ch * 100 + (p.gy + dy) * 10 + p.gx + dx); if (!q) continue;
        if (dx && dy && (M.has(p.ch * 100 + p.gy * 10 + p.gx + dx) || M.has(p.ch * 100 + (p.gy + dy) * 10 + p.gx))) continue;   // la esquina ya está cubierta
        const L = Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2), n = Math.max(1, Math.ceil(L / .5));
        for (let k = 1; k < n; k++) dot(t, p.x + (q.x - p.x) * k / n + c / 2, p.y + (q.y - p.y) * k / n + c / 2, rad, col, a); } } }

  // ---------- estilos
  // aerosol a mano: trazo redondo con niebla alrededor, renglones torcidos, alguna chorreada
  function aerosol(t, x0, x1, y, lineas, col, c) {
    const opt = { jit: .35, onda: .25 + gr() * .3, fase: gr() * 6, incl: (gr() - .4) * .25, varia: .12, esp: 1.1 };
    const H = 9 * c; let cy = Math.max(2, Math.min(y, t.h - lineas.length * H - 2));
    for (const l of lineas) { const w = ancho(l, c, opt.esp), sx = x0 + Math.max(0, (x1 - x0 - w - 2 * c) * (.15 + gr() * .7));
      const { out } = celdas(l, sx, cy, c, opt), rad = c * .5;
      for (const p of out) dot(t, p.x + c / 2, p.y + c / 2, rad + c * .9, col, .05);        // niebla
      trazos(t, out, c, rad, col);
      for (const p of out) if (p.below && gr() < .08) drip(t, p.x + c / 2, p.y + c, 3 + gr() * c * 4, col);
      cy += H; }
  }
  // de pintor: blanqueo a la cal (con bordes gastados) y letras de imprenta grandes, una o dos en color
  function pintor(t, x0, x1, y, lineas, cols, c) {
    const opt = { jit: 0, onda: 0, fase: 0, incl: 0, varia: 0, esp: 1.2 }, H = 9 * c, pad = c * 2;
    const w = Math.max(...lineas.map(l => ancho(l, c, opt.esp))), h = lineas.length * H - 2 * c, bx = x0 + Math.max(0, (x1 - x0 - w) / 2) - pad;
    y = Math.max(pad + 1, Math.min(y, t.h - h - pad - 2));
    const cal = [236, 234, 226];
    box(t, bx, y - pad, bx + w + 2 * pad, y + h + pad, cal, .93);
    for (let k = 0; k < 40; k++) { const ex = gr() < .5 ? bx + gr() * 3 : bx + w + 2 * pad - gr() * 3, ey = y - pad + gr() * (h + 2 * pad); dot(t, ex, ey, 1 + gr() * 2, cal, .9); }   // borde a brocha
    lineas.forEach((l, i) => { const lw = ancho(l, c, opt.esp), { out } = celdas(l, bx + pad + (w - lw) / 2, y + i * H, c, opt), col = cols[i % cols.length];
      for (const p of out) box(t, p.x + 1, p.y + 1, p.x + c + 1, p.y + c + 1, [120, 118, 112], .35);   // sombra corrida
      for (const p of out) box(t, p.x, p.y, p.x + c, p.y + c, col, .96);
      for (const p of out) if (gr() < .025) box(t, p.x, p.y, p.x + c, p.y + c, cal, .7); });          // descascarado
  }
  // poesía: fondo blanco prolijo, letras negras finas, un guion de firma
  function poesia(t, x0, x1, y, lineas, c) {
    const opt = { jit: .15, onda: 0, fase: 0, incl: 0, varia: .05, esp: 1 }, H = 9 * c, pad = c * 2;
    const w = Math.max(...lineas.map(l => ancho(l, c, opt.esp))), h = lineas.length * H + c * 2, bx = x0 + Math.max(0, (x1 - x0 - w) / 2) - pad;
    y = Math.max(pad + 1, Math.min(y, t.h - h - pad - 2));
    box(t, bx, y - pad, bx + w + 2 * pad, y + h + pad, [242, 240, 234], .95);
    lineas.forEach((l, i) => { const lw = ancho(l, c, opt.esp), { out } = celdas(l, bx + pad + (w - lw) / 2, y + i * H, c, opt);
      trazos(t, out, c, c * .42, [26, 26, 30], 1); });
    box(t, bx + w + pad - 6 * c, y + h - c, bx + w + pad, y + h - c + Math.max(1, c * .5), [26, 26, 30], 1);
  }
  // firma (tag): letras finas inclinadas que se tocan, subrayado con flecha y chorreadas
  function tag(t, x0, x1, y, col, c) {
    const n = 3 + ((gr() * 3) | 0), letras = "AEKMNRSTWYZ"; let s = ""; for (let i = 0; i < n; i++) s += letras[(gr() * letras.length) | 0];
    const opt = { jit: .6, onda: .5, fase: gr() * 6, incl: .35, varia: .3, esp: -.6 }, w = ancho(s, c, opt.esp);
    if (w > x1 - x0) return false;
    y = Math.max(2, Math.min(y, t.h - 10 * c));
    const sx = x0 + gr() * (x1 - x0 - w), { out } = celdas(s, sx, y, c, opt);
    trazos(t, out, c, c * .4, col, 1);
    const yb = y + 7.6 * c; for (let x = sx - c; x < sx + w + c; x += .7) dot(t, x, yb + Math.sin((x - sx) / w * 3) * c * .6, c * .35, col, .95);
    for (let k = 0; k < 3; k++) { const ax = sx + w + c * (1 + k * .4); dot(t, ax, yb - k * c * .5, c * .3, col, 1); dot(t, ax, yb + k * c * .5, c * .3, col, 1); }
    for (const p of out) if (p.below && gr() < .18) drip(t, p.x + c / 2, p.y + c, 2 + gr() * c * 5, col);
    return true;
  }
  // bomba (throw-up): letras gordas de un color con borde negro, brillo blanco y sombra corrida
  function bomba(t, x0, x1, y, col, c) {
    const s = CREWS[(gr() * CREWS.length) | 0], opt = { jit: .25, onda: .35, fase: gr() * 6, incl: .1, varia: .1, esp: .3 }, w = ancho(s, c, opt.esp);
    if (w + 4 * c > x1 - x0) return false;
    y = Math.max(2 * c, Math.min(y, t.h - 10 * c));
    const sx = x0 + 2 * c + gr() * (x1 - x0 - w - 4 * c), { out } = celdas(s, sx, y + c, c, opt), R = c * 1.15;
    for (const p of out) dot(t, p.x + c / 2 + c * .6, p.y + c / 2 + c * .6, R + c * .55, [30, 28, 34], 1);   // sombra 3D
    for (const p of out) dot(t, p.x + c / 2, p.y + c / 2, R + c * .55, [16, 16, 20], 1);                   // borde
    for (const p of out) dot(t, p.x + c / 2, p.y + c / 2, R, col, 1);
    for (const p of out) if (gr() < .12) dot(t, p.x + c * .3, p.y + c * .3, c * .35, [250, 250, 250], 1);   // brillos
    for (const p of out) if (p.below && gr() < .06) drip(t, p.x + c / 2, p.y + c + R, 2 + gr() * c * 3, col);
    return true;
  }
  // corazón con iniciales (aerosol)
  function corazon(t, x0, x1, y, col, c) {
    const L = "ABCDEFGJLMNPRSTV", s = L[(gr() * L.length) | 0] + "♥" + L[(gr() * L.length) | 0];
    aerosol(t, x0, x1, y, [s], col, c); return true;
  }

  // ---------- reparto de renglones
  function partir(msg, maxc) { const out = []; let cur = "";
    for (const w of msg.split(" ")) { if ((cur + " " + w).trim().length <= maxc) cur = (cur + " " + w).trim(); else { if (cur) out.push(cur); cur = w; } }
    if (cur) out.push(cur); return out.some(l => l.length > maxc) ? null : out; }
  const pick = (a) => a[(gr() * a.length) | 0];
  const AEROSOL = [[24, 24, 28], [24, 24, 28], [186, 30, 38], [36, 64, 170], [32, 120, 66], [236, 236, 232], [176, 180, 188], [120, 40, 140]];
  const BOMBA = [[200, 204, 212], [200, 204, 212], [240, 206, 60], [240, 120, 170], [110, 190, 240], [120, 220, 120], [240, 140, 50]];

  // luminosidad media de la pared donde va la pintada: en una pared clara no se pinta en blanco ni plateado (no se vería), en una
  // oscura no se pinta en negro
  function lumZona(t, x0, x1, y0, y1) { let s = 0, n = 0;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 8; i++) { const x = Math.min(t.w - 1, Math.max(0, (x0 + (x1 - x0) * (i + .5) / 8) | 0)), y = Math.min(t.h - 1, Math.max(0, (y0 + (y1 - y0) * (j + .5) / 5) | 0)), k = (y * t.w + x) * 4;
      if (t.d[k + 3] < 128) continue; s += .3 * t.d[k] + .59 * t.d[k + 1] + .11 * t.d[k + 2]; n++; }
    return n ? s / n : 128; }
  const lumC = (c) => .3 * c[0] + .59 * c[1] + .11 * c[2];
  function pintar(t, x0, x1, y, r, ctx = {}) {
    gr = R3.rng(((r() * 4294967296) ^ (r() * 65536)) >>> 0);
    const Lp = lumZona(t, x0, x1, y, Math.min(t.h, y + 40)), seVe = (c) => Math.abs(lumC(c) - Lp) > 70;
    const pickC = (lista) => { const ok = lista.filter(seVe); return pick(ok.length ? ok : lista); };
    const k = (R3.DET >= 1.5 ? 2 : 1), W = x1 - x0;
    if (W < 20 * k) return false;
    const pobre = !!(ctx.pobre || ctx.villa), villa = !!ctx.villa, pared = !!ctx.paredon;
    // qué tipo: según el lugar
    const tipos = [["aerosol", 5], ["pintor", pared ? 2.5 : pobre ? 1.6 : .8], ["poesia", pared ? 1.4 : .9], ["tag", pared ? 3 : pobre ? 2 : 2.5], ["bomba", pared ? 3 : 1],
      ["practico", pared ? .3 : 1], ["corazon", .7]];
    let tot = 0; for (const [, w] of tipos) tot += w; let q = gr() * tot, tipo = "aerosol"; for (const [n, w] of tipos) { q -= w; if (q <= 0) { tipo = n; break; } }
    // tamaños (celda de la letra en px; la letra mide 7 celdas): firmas y aerosol chicos, pintor y bombas grandes (más en el paredón)
    if (tipo === "tag") return tag(t, x0, x1, y, pickC([[24, 24, 28], [24, 24, 28], [176, 180, 188], [36, 64, 170], [186, 30, 38], [236, 236, 232]]), k * (gr() < .4 ? 1.5 : 1.1));
    if (tipo === "bomba") { if (bomba(t, x0, x1, y, pick(BOMBA), k * (pared ? 2.1 : 1.5))) return true; return tag(t, x0, x1, y, [24, 24, 28], k * 1.2); }
    if (tipo === "corazon") return corazon(t, x0, x1, y, pickC([[186, 30, 38], [24, 24, 28], [210, 60, 140], [236, 236, 232]]), 1.3 * k);
    if (tipo === "poesia") { const c = k; const p = pick(POESIA); if (Math.max(...p.map(l => ancho(l, c, 1))) + 4 * c <= W && p.length * 9 * c + 6 * c < t.h) { poesia(t, x0, x1, y, p, c); return true; } }
    if (tipo === "practico") { const p = pick(PRACTICO()), c = 1.2 * k; if (Math.max(...p.map(l => ancho(l, c, 1.1))) + 3 * c <= W && p.length * 9 * c + 4 < t.h) { aerosol(t, x0, x1, y, p, pickC([[24, 24, 28], [186, 30, 38], [36, 64, 170], [236, 236, 232]]), c); return true; } }
    if (tipo === "pintor") { const lista = villa ? SOCIAL.concat(FE, CLUB) : SOCIAL.concat(CLUB), msg = pick(lista);
      for (const c of pared ? [2 * k, 1.5 * k] : [1.5 * k, 1.2 * k]) { const lineas = partir(msg, Math.floor((W - 4 * c) / (6.2 * c))); if (lineas && lineas.length <= Math.min(3, Math.floor((t.h - 6 * c) / (9 * c)))) {
        const cols = gr() < .5 ? [pick([[30, 52, 150], [180, 28, 36], [20, 20, 24], [26, 110, 60]])] : [pick([[30, 52, 150], [20, 20, 24]]), pick([[180, 28, 36], [214, 160, 30]])];
        pintor(t, x0, x1, y, lineas, cols, c); return true; } } }
    // aerosol (lo de siempre, y lo que no entró como otra cosa)
    const lista = (villa ? AMOR.concat(FUTBOL, FUTBOL, FE, SOCIAL) : pobre ? AMOR.concat(FUTBOL, BANDAS, INGENIO, SOCIAL) : AMOR.concat(FUTBOL, BANDAS, INGENIO, INGENIO));
    for (let intento = 0; intento < 5; intento++) { const msg = sinTilde(pick(lista)), c = (gr() < .4 ? 1.5 : 1.15) * k, maxL = Math.min(3, Math.floor((t.h - 4) / (9 * c)));
      const lineas = partir(msg, Math.floor((W - 3 * c) / (6.4 * c))); if (lineas && lineas.length <= maxL) { aerosol(t, x0, x1, y, lineas, pickC(AEROSOL), c); return true; } }
    return tag(t, x0, x1, y, [24, 24, 28], 1.5 * k);
  }
  return { pintar, FRASES: { AMOR, FUTBOL, BANDAS, INGENIO, SOCIAL, FE, CLUB, POESIA } };
})();
