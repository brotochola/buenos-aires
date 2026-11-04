#version 300 es
// piso liso del banco de pruebas de sombras: baldosas claras de 40×20 px, pintadas en la GPU como el piso del barrio
precision highp float;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D nada;
uniform float uK;
void main() {
  vec2 c = floor(vWorld / vec2(40.0, 20.0)), f = fract(vWorld / vec2(40.0, 20.0));
  float k = mod(c.x + c.y, 2.0) < 1.0 ? 0.79 : 0.76, j = (f.x < 0.03 || f.y < 0.06) ? 0.86 : 1.0;
  finalColor = vec4(vec3(k, k * 0.985, k * 0.94) * j * uK + texelFetch(nada, ivec2(0), 0).r * 0.0, 1.0);
}
