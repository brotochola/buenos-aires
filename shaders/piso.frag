#version 300 es
// Piso del barrio pintado en la GPU: el mismo algoritmo que ground.js (versión Pixi/Three), píxel por píxel.
// Datos: celdas de 0,5 m con hasta 3 calles candidatas + tipo de vereda y patio, tabla de calles, riqueza y ruido.
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D cellA;    // rg = calle 1 (+1), ba = calle 2 (+1)
uniform sampler2D cellB;    // rg = calle 3 (+1), b = vereda (tipo | 16 dañada), a = patio (tipo | 16 dañado)
uniform sampler2D wealth;   // riqueza, celdas de 10 m
uniform sampler2D noiseT;   // r = ruido a, g = b, b = c, a = granulado
uniform sampler2D segs;     // 12 texels RGBA8 por calle: 24 valores de 16 bits (punto fijo)
uniform sampler2D pits;     // cazuelas en celdas de 2 m: rg = centro en la celda, b = ángulo (/256 vuelta), a = tipo (1 ladrillo, 2 cemento, 3 sin borde) | 4 con pasto
uniform float uMW, uMH, uK, uSF, uSYN, uGC, uCW, uCH, uWG, uHG, uPW, uPH;

int b8(float v) { return int(v * 255.0 + 0.5); }
float NA(int x, int y) { return texelFetch(noiseT, ivec2(x & 255, y & 255), 0).r; }
float NB(int x, int y) { return texelFetch(noiseT, ivec2(x & 255, y & 255), 0).g; }
float NC(int x, int y) { return texelFetch(noiseT, ivec2(x & 255, y & 255), 0).b; }
float NG(int x, int y) { return texelFetch(noiseT, ivec2(x & 255, y & 255), 0).a; }
float hash2(int a, int b) { uint h = uint(a) * 374761393u ^ uint(b) * 668265263u; h = (h ^ (h >> 13u)) * 1274126177u; return float(h ^ (h >> 16u)) / 4294967296.0; }
float fmod_(float a, float m) { return a - m * floor(a / m); }   // como (a % m + m) % m

vec3 ramp5(vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, float t) {
  t = clamp(t, 0.0, 0.999) * 4.0; int i = int(t); float f = t - float(i);
  if (i == 0) return mix(c0, c1, f); if (i == 1) return mix(c1, c2, f); if (i == 2) return mix(c2, c3, f); return mix(c3, c4, f);
}
vec3 asphalt(int ix, int iy) {
  float v = .86 + .3 * (NC(ix >> 2, iy >> 2) - .5) + .16 * (NA(ix, iy) - .5) + .14 * (NG(ix, iy) - .5);
  if (NG(ix * 7, iy * 3) > .95) return vec3(118, 116, 112); return vec3(70, 71, 76) * v;
}
vec3 adoquin(float u, float v, int ix, int iy) {   // adoquines de granito: hileras a lo ancho, juntas oscuras
  float bw = .3, bh = .2, row = floor(v / bh), uu = u + fmod_(row, 2.0) * bw * .5, cu = floor(uu / bw), lu = uu / bw - cu, lv = v / bh - row;
  float h = hash2(int(cu) * 13 + 5, int(row) * 7 + 11);
  if (lu < .13 || lv < .17) return vec3(58, 56, 54) * (.9 + .2 * NG(ix, iy));
  float f = (1.0 + (.5 - lv) * .14 - (lu - .5) * .06) * (.94 + .1 * NA(ix, iy));
  return vec3(96.0 + 36.0 * h, 98.0 + 30.0 * h, 104.0 + 18.0 * h) * f;
}
vec3 grass(int ix, int iy, float dry) {
  float t = .45 + (NA(ix, iy) - .5) * .7 + (NB(ix, iy) - .5) * .3 + (NG(ix, iy) - .5) * .35;
  vec3 c = ramp5(vec3(46, 80, 40), vec3(62, 102, 48), vec3(80, 126, 58), vec3(102, 150, 70), vec3(132, 174, 86), t);
  if (dry > 0.0) { float d = clamp((NC(ix, iy) - .55) * 3.0, 0.0, 1.0) * dry; c = vec3(c.r + (150.0 - c.r) * d, c.g + (140.0 - c.g) * d * .6, c.b + (80.0 - c.b) * d); }
  if (NG(ix * 3, iy * 5) > .965) return vec3(176, 204, 120); return c;
}
vec3 dirt(int ix, int iy) {
  float t = .5 + (NA(ix, iy) - .5) * .5 + (NB(ix, iy) - .5) * .3 + (NG(ix, iy) - .5) * .2, g = NG(ix * 5, iy * 7);
  if (g > .97) return vec3(196, 184, 160); if (g < .015) return vec3(72, 56, 44);
  return ramp5(vec3(96, 72, 52), vec3(118, 88, 62), vec3(140, 106, 76), vec3(160, 126, 90), vec3(182, 150, 112), t);
}
vec3 yuyo(int ix, int iy) { return NC(ix, iy) > .6 ? dirt(ix, iy) : grass(ix, iy, .8); }
// kind: 1 tierra, 2 vainilla, 3 gris, 4 cemento, 5 pasto, 6 roja
vec3 tiles(float u, float v, int ix, int iy, int kind, bool dmg) {
  if (kind == 5) return grass(ix, iy, .4);
  if (kind == 1) return NB(ix, iy) > .55 ? grass(ix, iy, .9) : dirt(ix, iy);
  if (kind == 4) { bool jt = fmod_(u, 1.5) < .05 || fmod_(v, 1.5) < .05; if (jt) return vec3(138, 136, 128);
    float f = .95 + .1 * (NA(ix, iy) - .5) + (fmod_(u * 8.0, 1.0) < .25 ? -.04 : 0.0); return vec3(190, 188, 180) * f; }
  float size = kind == 6 ? .25 : .4, tu = floor(u / size), tv = floor(v / size), lu = u / size - tu, lv = v / size - tv;
  float h = hash2(int(tu) * 31 + 7, int(tv) * 17 + 3);
  vec3 base = kind == 6 ? vec3(176, 86, 62) : kind == 3 ? vec3(188, 186, 178) : vec3(228, 212, 168);
  if (lu < .07 || lv < .07) return kind == 6 ? vec3(212, 196, 176) : vec3(base.r * .74, base.g * .74, base.b * .72);
  if (dmg && h < .1) return dirt(ix, iy);
  if (dmg && h < .2) { float f = .95 + .1 * NG(ix, iy); return vec3(176, 174, 166) * f; }
  float f = 1.0 + (h - .5) * .08 + (NA(ix, iy) - .5) * .12 * (dmg ? 2.0 : 1.0);
  if (kind != 6) { float pu = fract(lu * 3.0), pv = fract(lv * 3.0); if (pu < .12 || pv < .12) f *= .9; else if (pu < .24 || pv < .24) f *= 1.04; }
  if (dmg && h < .3 && abs(lu - lv) < .04) return vec3(110, 98, 76);
  return base * f;
}
// cazuela alrededor de un árbol: cuadrado de 1,4 m alineado con la calle. Devuelve el color, o x < 0 si no hay
vec3 cazuela(float wx, float wy, int ix, int iy) {
  int gx = int(floor(wx / 2.0)), gy = int(floor(wy / 2.0));
  for (int x = gx - 1; x <= gx + 1; x++) for (int y = gy - 1; y <= gy + 1; y++) {
    if (x < 0 || y < 0 || x >= int(uPW) || y >= int(uPH)) continue;
    vec4 q = texelFetch(pits, ivec2(x, y), 0); int tp = b8(q.a); if (tp == 0) continue;
    vec2 c = vec2(float(x) * 2.0 + q.r * 2.0, float(y) * 2.0 + q.g * 2.0); float a = q.b * 6.2831853 * 255.0 / 256.0;
    vec2 d = vec2(wx, wy) - c; float cs = cos(a), sn = sin(a), lx = d.x * cs + d.y * sn, ly = -d.x * sn + d.y * cs;
    if (abs(lx) >= .7 || abs(ly) >= .7) continue;
    float edge = .7 - max(abs(lx), abs(ly)); int t = tp & 3;
    if (edge < .11 && t == 1) return vec3(150, 74, 52) * (.9 + .15 * NG(ix, iy));
    if (edge < .11 && t == 2) return vec3(172, 170, 162) * (.92 + .1 * NG(ix, iy));
    if (edge < .18) return dirt(ix, iy) * .72;
    if ((tp & 4) != 0 && NB(ix * 2, iy * 2) > .5) return grass(ix, iy, .6);
    return dirt(ix, iy);
  }
  return vec3(-1.0);
}
float wealthAt(float x, float y) { return texelFetch(wealth, ivec2(clamp(int(x / 10.0), 0, int(uWG) - 1), clamp(int(y / 10.0), 0, int(uHG) - 1)), 0).r; }

// calle candidata: devuelve d, t, ds y si es calzada (1) o vereda (2)
struct Seg { vec2 a; vec2 dir; vec2 n; float len, hw, sw, med, cls, w; int type, mat; bool cant; };
float u16(int id, int m) { vec4 t = texelFetch(segs, ivec2(m >> 1, id), 0); return (m & 1) == 0 ? float(b8(t.r) + b8(t.g) * 256) : float(b8(t.b) + b8(t.a) * 256); }
float dPos(float q) { return q / 50.0 - 20.0; }
float dUnit(float q) { return q / 32767.5 - 1.0; }
Seg loadSeg(int id) { Seg s;
  s.a = vec2(dPos(u16(id, 0)), dPos(u16(id, 1))); s.dir = vec2(dUnit(u16(id, 2)), dUnit(u16(id, 3))); s.n = vec2(dUnit(u16(id, 4)), dUnit(u16(id, 5)));
  s.len = u16(id, 6) / 50.0; s.hw = u16(id, 7) / 1000.0; s.sw = u16(id, 8) / 1000.0; s.med = u16(id, 9) / 1000.0; s.cls = u16(id, 10); s.w = u16(id, 11) / 1000.0;
  s.type = int(u16(id, 12)); s.mat = int(u16(id, 13)); s.cant = u16(id, 14) > .5; return s; }
bool nearCross(int id, float t, float r) {
  for (int m = 16; m < 24; m++) { float q = u16(id, m); if (q > 65534.5) break; if (abs(t - dPos(q)) < r) return true; }
  return false; }

vec3 pixel(float wx, float wy) {
  if (wx < 0.0 || wy < 0.0 || wx > uMW || wy > uMH) return vec3(40, 46, 36);
  int ix = int(floor(wx * uSF)), iy = int(floor(wy * uSF));
  ivec2 cc = ivec2(clamp(int(wx / uGC), 0, int(uCW) - 1), clamp(int(wy / uGC), 0, int(uCH) - 1));
  vec4 A = texelFetch(cellA, cc, 0), B = texelFetch(cellB, cc, 0);
  int ids[3]; ids[0] = b8(A.r) + b8(A.g) * 256 - 1; ids[1] = b8(A.b) + b8(A.a) * 256 - 1; ids[2] = b8(B.r) + b8(B.g) * 256 - 1;
  // clasificación exacta entre las candidatas (igual que World.classify)
  int rid = -1, wid = -1; float rk = 0.0, wk = 0.0, rd = 0.0, rt = 0.0, rds = 0.0, wd = 0.0, wt = 0.0, wds = 0.0;
  for (int k = 0; k < 3; k++) { int id = ids[k]; if (id < 0) continue; Seg s = loadSeg(id);
    vec2 p = vec2(wx, wy) - s.a; float t = dot(p, s.dir), tc = clamp(t, 0.0, s.len), d = length(vec2(wx, wy) - (s.a + s.dir * tc)), ds = dot(p, s.n);
    if (d < s.hw) { float kk = (d - s.hw) - s.cls * .01; if (rid < 0 || kk < rk) { rid = id; rk = kk; rd = d; rt = t; rds = ds; } }
    else if (s.sw > 0.0 && d < s.hw + s.sw) { float kk = d - s.hw - s.sw; if (wid < 0 || kk < wk) { wid = id; wk = kk; wd = d; wt = t; wds = ds; } } }
  if (rid >= 0) {
    Seg s = loadSeg(rid); float ad = abs(rds), edge = s.hw - rd;
    if (s.sw > 0.0 && s.mat != 2 && s.mat != 3 && edge < .07) return vec3(112, 110, 104);
    if (s.mat == 3) return wealthAt(wx, wy) > .18 || NB(ix, iy) > .5 ? tiles(rt, ad, ix, iy, 4, true) : dirt(ix, iy);
    if (s.mat == 2) {
      if (s.type != 3 && s.sw > 0.0 && edge < 1.4) {
        if (edge < .3 || edge > 1.15) return edge < .3 ? grass(ix, iy, .6) : dirt(ix, iy);
        float w = .5 + .5 * sin(float(ix) * .3 + float(iy) * .9); if (NG(ix, iy) > .985) return vec3(220, 220, 210);
        return vec3(62.0 + 18.0 * w * .4, 76.0 + 14.0 * w * .4, 58.0 + 8.0 * w * .4);
      }
      vec3 col = dirt(ix, iy);
      float rut = min(abs(ad - 1.3), abs(ad - (s.hw - 1.9))); if (rut < .35) col *= .86;
      if (NC(ix + 91, iy + 37) > .8 && NB(ix, iy) > .35) { float w = NC(ix + 91, iy + 37); return w > .83 ? vec3(96.0 + 40.0 * NG(ix, iy), 112.0 + 30.0 * NG(ix, iy), 120) : vec3(78, 62, 48); }
      return col;
    }
    if (s.type == 0 && ad < s.med) { if (s.med - ad < .15) return vec3(214, 210, 200); return grass(ix, iy, .3); }
    if (s.type == 0 && ad < s.med + .12) return vec3(150, 148, 142);
    if (s.sw > 0.0 && edge < .4) { float f = .95 + .08 * NG(ix, iy); return vec3(160, 158, 152) * f; }
    vec3 col = s.mat == 4 ? adoquin(rt, ad, ix, iy) : asphalt(ix, iy);
    if (s.mat == 1) {
      float ph = NC(ix + 300, iy + 120), pb = NB(ix + 13, iy + 77);
      if (ph > .7 && pb > .45) return ph > .76 && pb > .6 ? vec3(80.0 + 40.0 * NG(ix, iy), 96.0 + 30.0 * NG(ix, iy), 104) : dirt(ix, iy);
      if (ph > .66 && pb > .4) return vec3(38, 36, 36);
      if (NA(ix + 50, iy + 50) > .74) col *= .8;
      if (NB(ix * 2, iy * 2) > .82 && NG(ix, iy) > .5) return vec3(32, 32, 36);
    }
    if (nearCross(rid, rt, 1.5)) { if (fmod_(ad + 10.0, 1.0) < .55 && NG(ix, iy) > .1) return vec3(210, 208, 198); return col; }
    if (s.type == 0) { float lane = abs(ad - (s.med + (s.hw - s.med) / 2.0)); if (lane < .07 && fmod_(rt, 6.0) < 3.0) return vec3(214, 212, 204); }
    else if (s.mat == 0 && s.w > .3 && ad < .07 && fmod_(rt, 5.0) < 2.5) return s.w > .6 ? vec3(230, 200, 80) : vec3(214, 212, 204);
    return col;
  }
  if (wid >= 0) {
    Seg s = loadSeg(wid); float dd = wd - s.hw;
    if (s.mat == 2) { if (dd < .6) return grass(ix, iy, .7); }
    else { if (dd < .16) return vec3(222, 218, 208); if (dd < .2) return vec3(168, 164, 156); }
    vec3 cz = cazuela(wx, wy, ix, iy); if (cz.x >= 0.0) return cz;
    bool cant = s.cant && dd < 1.0 && !nearCross(wid, wt, 1.6);
    if (cant) return grass(ix, iy, .2);
    int vk = b8(B.b); int kind = vk & 15; bool dmg = (vk & 16) != 0;
    if (kind == 0) { kind = s.w < .3 ? 1 : 2; dmg = s.w < .45; }
    return tiles(wt, dd, ix, iy, kind, dmg);
  }
  int pk = b8(B.a);
  if (pk > 0) { int k = pk & 15; bool d = (pk & 16) != 0;
    if (k == 1) return grass(ix, iy, .3); if (k == 2) return NB(ix, iy) > .6 ? grass(ix, iy, .8) : dirt(ix, iy);
    if (k == 3) return yuyo(ix, iy); if (k == 4) return tiles(wx, wy, ix, iy, 6, false); return tiles(wx, wy, ix, iy, 4, d); }
  // la villa (muy pobre): contrapiso de cemento gastado y tierra entre las casillas, casi sin pasto
  float wv = wealthAt(wx, wy);
  if (wv < .15) { if (NB(ix, iy) > .5) { float f = .8 + .14 * (NA(ix, iy) - .5) + (NG(ix * 3, iy * 3) > .9 ? -.12 : 0.0); return vec3(156, 150, 140) * f; }
    return NC(ix, iy) > .78 ? grass(ix, iy, .9) : dirt(ix, iy); }
  return wv < .3 ? yuyo(ix, iy) : grass(ix, iy, .5);
}

void main() {
  float wy = uMH - vWorld.y / (uSF * uSYN), wx = vWorld.x / uSF - uK * wy;
  finalColor = vec4(pixel(wx, wy) / 255.0, 1.0);
}
