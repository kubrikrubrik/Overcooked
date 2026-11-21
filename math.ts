// Small math library: column-major 4x4 matrices (WebGL convention) and vec3 tuples.

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;
export type RGB = [number, number, number];

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const scaleRGB = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s];

/** Deterministic PRNG (mulberry32) so procedural art is identical on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- vec3 ----------------
export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: Vec3): Vec3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------- mat4 ----------------
export function m4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function m4copy(out: Mat4, a: Mat4): Mat4 {
  out.set(a);
  return out;
}

export function m4mul(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** M = T * Ry * Rx * Rz * S */
export function m4compose(out: Mat4, p: Vec3, r: Vec3, s: Vec3): Mat4 {
  const [rx, ry, rz] = r;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz
  const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
  const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
  out[0] = r00 * s[0]; out[1] = r10 * s[0]; out[2] = r20 * s[0]; out[3] = 0;
  out[4] = r01 * s[1]; out[5] = r11 * s[1]; out[6] = r21 * s[1]; out[7] = 0;
  out[8] = r02 * s[2]; out[9] = r12 * s[2]; out[10] = r22 * s[2]; out[11] = 0;
  out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
  return out;
}

export const m4trs = (p: Vec3 = [0, 0, 0], r: Vec3 = [0, 0, 0], s: Vec3 | number = 1): Mat4 =>
  m4compose(m4(), p, r, typeof s === 'number' ? [s, s, s] : s);

export function m4perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function m4ortho(out: Mat4, l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

export function m4lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = vnorm(vsub(eye, target));
  const x = vnorm(vcross(up, z));
  const y = vcross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -vdot(x, eye); out[13] = -vdot(y, eye); out[14] = -vdot(z, eye); out[15] = 1;
  return out;
}

/** Inverse-transpose of the upper 3x3 (normal matrix). */
export function m3normal(out: Float32Array, m: Mat4): Float32Array {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) det = 1e-8;
  const id = 1 / det;
  out[0] = b01 * id;
  out[1] = (-a22 * a01 + a02 * a21) * id;
  out[2] = (a12 * a01 - a02 * a11) * id;
  out[3] = b11 * id;
  out[4] = (a22 * a00 - a02 * a20) * id;
  out[5] = (-a12 * a00 + a02 * a10) * id;
  out[6] = b21 * id;
  out[7] = (-a21 * a00 + a01 * a20) * id;
  out[8] = (a11 * a00 - a01 * a10) * id;
  // transpose (we computed inverse; normal matrix = transpose(inverse))
  let t = out[1]; out[1] = out[3]; out[3] = t;
  t = out[2]; out[2] = out[6]; out[6] = t;
  t = out[5]; out[5] = out[7]; out[7] = t;
  return out;
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
}

/** Project world point with a view-projection matrix -> NDC + w. */
export function project(vp: Mat4, p: Vec3): [number, number, number, number] {
  const x = p[0], y = p[1], z = p[2];
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  return [cx / cw, cy / cw, cz / cw, cw];
}
