// GLSL ES 3.00 shaders. Stylised "toy diorama" lighting: hemisphere ambient,
// wrapped sun light with soft PCF shadows tinted violet, Blinn specular, rim,
// up to 4 point lights, and procedural world-space surface patterns.

export const MAIN_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 aCol;
layout(location=3) in vec4 aMat;
layout(location=4) in vec2 aUV;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uViewProj;
uniform mat4 uLightVP;
out vec3 vWPos;
out vec3 vNor;
out vec3 vCol;
out vec4 vMat;
out vec2 vUV;
out vec4 vLPos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWPos = wp.xyz;
  vNor = normalize(uNormalMat * aNor);
  vCol = aCol;
  vMat = aMat;
  vUV = aUV;
  vLPos = uLightVP * vec4(wp.xyz + vNor * 0.025, 1.0);
  gl_Position = uViewProj * wp;
}
`;

export const MAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWPos;
in vec3 vNor;
in vec3 vCol;
in vec4 vMat;
in vec2 vUV;
in vec4 vLPos;
uniform vec3 uTint;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform float uUnlit;
uniform float uReceive;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uShadowTint;
uniform vec3 uCamPos;
uniform sampler2DShadow uShadow;
uniform float uShadowTexel;
uniform float uShadowOn;
uniform vec4 uPL[4];
uniform vec4 uPC[4];
uniform sampler2D uTex;
uniform float uUseTex;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }

// grout line mask: 1 inside tile, ~0 on the joints
float grout(vec2 f, float w) {
  vec2 d = min(f, 1.0 - f);
  return smoothstep(0.0, w, min(d.x, d.y));
}

vec3 pattern(float id, vec3 base, vec3 wp, vec3 n) {
  if (id < 0.5) return base;
  if (id < 1.5) { // kitchen floor: cream / caramel checker with bevelled joints
    vec2 g = vec2(wp.x + 0.5, wp.z);
    vec2 c = floor(g);
    vec2 f = fract(g);
    float chk = mod(c.x + c.y, 2.0);
    vec3 col = mix(base, base * vec3(0.93, 0.79, 0.68), chk);
    col *= 0.94 + 0.08 * hash(c);
    col *= 0.97 + 0.05 * noise(wp.xz * 6.0);
    float gr = grout(f, 0.035);
    float bev = smoothstep(0.0, 0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    col *= mix(0.72, 1.0, gr) * mix(0.93, 1.0, bev);
    return col;
  }
  if (id < 2.5) { // wallpaper stripes
    float u = (abs(n.x) > 0.5 ? wp.z : wp.x) * 4.0;
    float s = smoothstep(0.42, 0.5, abs(fract(u) - 0.5));
    vec3 col = mix(base, base * vec3(1.06, 0.93, 0.95), s);
    // small dots between stripes
    vec2 dp = vec2(fract(u) - 0.5, fract(wp.y * 4.0) - 0.5);
    col = mix(col, vec3(1.0, 0.97, 0.92), (1.0 - smoothstep(0.06, 0.09, length(dp))) * 0.6);
    return col;
  }
  if (id < 3.5) { // wood planks along the dominant horizontal axis
    vec2 q = abs(n.y) > 0.5 ? wp.xz : vec2(abs(n.x) > 0.5 ? wp.z : wp.x, wp.y);
    float plank = floor(q.y * 5.0);
    float grain = noise(vec2(q.x * 3.0, q.y * 40.0 + plank * 7.0));
    vec3 col = base * (0.88 + 0.12 * hash(vec2(plank, 3.0))) * (0.92 + 0.12 * grain);
    col *= mix(0.7, 1.0, smoothstep(0.0, 0.06, min(fract(q.y * 5.0), 1.0 - fract(q.y * 5.0))));
    return col;
  }
  if (id < 4.5) { // cobblestones
    vec2 g = wp.xz * vec2(2.2, 2.8);
    g.x += mod(floor(g.y), 2.0) * 0.5;
    vec2 c = floor(g), f = fract(g);
    vec2 d = min(f, 1.0 - f);
    float edge = smoothstep(0.0, 0.16, min(d.x * 1.3, d.y));
    vec3 col = base * (0.86 + 0.22 * hash(c));
    col = mix(base * 0.62, col, edge);
    return col * (0.95 + 0.08 * noise(wp.xz * 9.0));
  }
  if (id < 5.5) { // grass
    float v = noise(wp.xz * 3.0) * 0.6 + noise(wp.xz * 11.0) * 0.4;
    return base * (0.85 + 0.3 * v);
  }
  if (id < 6.5) { // counter top: glazed ceramic tiles (top faces only)
    if (n.y < 0.6) return base;
    vec2 g = wp.xz * 2.0;
    vec2 c = floor(g), f = fract(g);
    vec3 col = base * (0.95 + 0.08 * hash(c));
    float gr = grout(f, 0.06);
    col = mix(vec3(0.97, 0.94, 0.86), col, gr);
    // soft glaze highlight in each tile
    col *= 1.0 + 0.06 * (1.0 - length(f - 0.35) * 1.6);
    return col;
  }
  if (id < 7.5) { // brick
    vec2 q = vec2(abs(n.x) > 0.5 ? wp.z : wp.x, wp.y) * vec2(3.2, 6.4);
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 c = floor(q), f = fract(q);
    vec3 col = base * (0.85 + 0.25 * hash(c));
    return mix(vec3(0.88, 0.82, 0.74), col, grout(f, 0.07));
  }
  if (id < 8.5) { // roof tiles (scalloped rows)
    vec2 q = vec2(wp.x * 3.0, wp.y * 4.0 - wp.z * 2.0);
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 f = fract(q);
    float sc = length(vec2(f.x - 0.5, (f.y) * 0.9));
    vec3 col = base * (0.85 + 0.2 * hash(floor(q)));
    col *= mix(0.65, 1.0, smoothstep(0.55, 0.42, sc) + step(0.35, f.y) * 0.0);
    return col * mix(0.8, 1.0, f.y);
  }
  if (id < 9.5) { // awning stripes
    float u = (abs(n.z) > 0.3 || abs(n.y) > 0.3 ? wp.x : wp.z) * 3.0;
    return mix(base, vec3(1.0, 0.98, 0.94), step(0.5, fract(u)));
  }
  if (id < 10.5) { // water
    float w = noise(wp.xz * 2.0 + vec2(0.0, 0.0)) * 0.5 + noise(wp.xz * 7.0) * 0.5;
    return base * (0.85 + 0.3 * w);
  }
  return base;
}

float shadowPCF(vec4 lp) {
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float z = p.z - 0.0012;
  float t = uShadowTexel * 1.25;
  float s = texture(uShadow, vec3(p.xy, z)) * 2.0;
  s += texture(uShadow, vec3(p.xy + vec2(-t, -t), z));
  s += texture(uShadow, vec3(p.xy + vec2(t, -t), z));
  s += texture(uShadow, vec3(p.xy + vec2(-t, t), z));
  s += texture(uShadow, vec3(p.xy + vec2(t, t), z));
  s += texture(uShadow, vec3(p.xy + vec2(0.0, 2.0 * t), z));
  s += texture(uShadow, vec3(p.xy + vec2(0.0, -2.0 * t), z));
  s += texture(uShadow, vec3(p.xy + vec2(2.0 * t, 0.0), z));
  s += texture(uShadow, vec3(p.xy + vec2(-2.0 * t, 0.0), z));
  return s / 10.0;
}

void main() {
  vec3 N = normalize(vNor);
  if (!gl_FrontFacing) N = -N;
  vec3 srgb = vCol * uTint;
  float alpha = uOpacity;
  if (uUseTex > 0.5) {
    vec4 tx = texture(uTex, vUV);
    srgb *= tx.rgb;
    alpha *= tx.a;
    if (alpha < 0.02) discard;
  }
  srgb = pattern(vMat.x, srgb, vWPos, N);
  vec3 base = toLin(clamp(srgb, 0.0, 1.0));
  if (uUnlit > 0.5) {
    fragColor = vec4(pow(base + toLin(uEmissive), vec3(1.0 / 2.2)), alpha);
    return;
  }
  vec3 V = normalize(uCamPos - vWPos);
  vec3 L = uSunDir;
  float ndl = dot(N, L);
  float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  float sh = 1.0;
  if (uShadowOn > 0.5 && uReceive > 0.5) sh = shadowPCF(vLPos);
  sh = min(sh, smoothstep(-0.1, 0.2, ndl) * 0.85 + 0.15);
  vec3 hemi = mix(uGround, uSky, N.y * 0.5 + 0.5);
  vec3 amb = hemi * mix(uShadowTint, vec3(1.0), sh);
  vec3 light = amb + uSunCol * wrap * sh;
  vec3 col = base * light;
  // point lights (warm glows)
  for (int i = 0; i < 4; i++) {
    vec3 d = uPL[i].xyz - vWPos;
    float dist = length(d);
    float att = clamp(1.0 - dist / max(uPL[i].w, 0.001), 0.0, 1.0);
    att *= att;
    col += base * uPC[i].rgb * att * (0.35 + 0.65 * max(dot(N, d / max(dist, 0.001)), 0.0));
  }
  float gloss = vMat.y;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), mix(8.0, 110.0, gloss)) * gloss * 0.9 * sh;
  col += uSunCol * spec;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * (vMat.w + 0.08);
  col += uSky * rim * 0.35;
  col += base * vMat.z * 2.2 + toLin(uEmissive);
  // hue-preserving soft-knee tonemap
  float pk = max(max(col.r, col.g), col.b);
  if (pk > 0.7) {
    float mapped = 0.7 + 0.3 * (1.0 - exp(-(pk - 0.7) / 0.3));
    col *= mapped / pk;
  }
  vec3 outc = pow(col, vec3(1.0 / 2.2));
  float l = dot(outc, vec3(0.299, 0.587, 0.114));
  outc = mix(vec3(l), outc, 1.12);
  fragColor = vec4(outc, alpha);
}
`;

export const DEPTH_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }
`;

export const DEPTH_FS = /* glsl */ `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }
`;

export const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
layout(location=2) in vec3 aInfo; // size, additive, shape
uniform mat4 uViewProj;
uniform float uScale;
out vec4 vCol;
out vec2 vInfo;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = clamp(aInfo.x * uScale / gl_Position.w, 1.0, 256.0);
  vCol = aCol;
  vInfo = aInfo.yz;
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vCol;
in vec2 vInfo;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a;
  if (vInfo.y < 0.5) {            // soft puff
    float r = dot(c, c);
    if (r > 1.0) discard;
    a = smoothstep(1.0, 0.2, r);
  } else if (vInfo.y < 1.5) {     // solid dot with rim
    float r = length(c);
    if (r > 1.0) discard;
    a = smoothstep(1.0, 0.85, r);
  } else {                        // 4-point star
    vec2 q = abs(c);
    float s = q.x * q.y * 6.0 + max(q.x, q.y) * 0.55 + min(q.x, q.y);
    a = smoothstep(1.0, 0.6, s);
    if (a <= 0.0) discard;
  }
  a *= vCol.a;
  o = vec4(vCol.rgb * a, a * (1.0 - vInfo.x));
}
`;
