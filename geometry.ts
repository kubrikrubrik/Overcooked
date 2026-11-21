// Procedural geometry primitives + a builder that merges many transformed, painted
// primitives into one vertex buffer (one draw call for whole static scenery).
import { Mat4, RGB, Vec3, m3normal, transformPoint, vnorm, vcross, vsub, vlen, vadd, vscale, vdot } from './math';

export interface Geo {
  pos: number[];
  nor: number[];
  idx: number[];
  uv?: number[];
}

/** Material params baked per vertex: pattern id, gloss, emissive, rim. */
export interface Paint {
  color: RGB | ((p: Vec3, n: Vec3, local: Vec3) => RGB);
  pattern?: number;
  gloss?: number;
  emissive?: number;
  rim?: number;
  /** darken towards local bottom of the shape (fake AO), 0..1 */
  ao?: number;
}

export const PATTERN = {
  NONE: 0,
  FLOOR: 1,
  WALLPAPER: 2,
  WOOD: 3,
  COBBLE: 4,
  GRASS: 5,
  TILE: 6,
  BRICK: 7,
  ROOF: 8,
  AWNING: 9,
  WATER: 10,
} as const;

export interface GeoData {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  mat: Float32Array;
  uv: Float32Array | null;
  idx: Uint32Array;
}

// ------------------------------------------------------------------ primitives

export function box(w: number, h: number, d: number): Geo {
  const x = w / 2, y = h / 2, z = d / 2;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [], uv: number[] = [];
  const faces: [Vec3, Vec3, Vec3][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p: Vec3 = [n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b];
      pos.push(p[0] * x, p[1] * y, p[2] * z);
      nor.push(n[0], n[1], n[2]);
      uv.push((a + 1) / 2, (b + 1) / 2);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nor, idx, uv };
}

/** Rounded box via clamp-and-push. s = bevel segments per half arc. */
export function rbox(w: number, h: number, d: number, r: number, s = 3): Geo {
  const H: Vec3 = [w / 2, h / 2, d / 2];
  r = Math.min(r, H[0], H[1], H[2]);
  const I: Vec3 = [H[0] - r, H[1] - r, H[2] - r];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const coords = (axis: number): number[] => {
    const out: number[] = [];
    if (r <= 1e-6) return [-H[axis], H[axis]];
    for (let j = s; j >= 0; j--) out.push(-(I[axis] + r * Math.tan((j / s) * (Math.PI / 4))));
    for (let j = 0; j <= s; j++) out.push(I[axis] + r * Math.tan((j / s) * (Math.PI / 4)));
    return out;
  };
  const faces: { n: Vec3; ua: number; va: number; na: number; flip: boolean }[] = [
    { n: [1, 0, 0], ua: 2, va: 1, na: 0, flip: true },
    { n: [-1, 0, 0], ua: 2, va: 1, na: 0, flip: false },
    { n: [0, 1, 0], ua: 0, va: 2, na: 1, flip: true },
    { n: [0, -1, 0], ua: 0, va: 2, na: 1, flip: false },
    { n: [0, 0, 1], ua: 0, va: 1, na: 2, flip: false },
    { n: [0, 0, -1], ua: 0, va: 1, na: 2, flip: true },
  ];
  for (const f of faces) {
    const us = coords(f.ua), vs = coords(f.va);
    const base = pos.length / 3;
    for (let j = 0; j < vs.length; j++) {
      for (let i = 0; i < us.length; i++) {
        const p: Vec3 = [0, 0, 0];
        p[f.ua] = us[i];
        p[f.va] = vs[j];
        p[f.na] = H[f.na] * (f.n[f.na] as number);
        const c: Vec3 = [
          Math.max(-I[0], Math.min(I[0], p[0])),
          Math.max(-I[1], Math.min(I[1], p[1])),
          Math.max(-I[2], Math.min(I[2], p[2])),
        ];
        const dlt = vsub(p, c);
        const dl = vlen(dlt);
        const nn: Vec3 = dl > 1e-7 ? vscale(dlt, 1 / dl) : f.n;
        const q = r > 1e-6 ? vadd(c, vscale(nn, r)) : p;
        pos.push(q[0], q[1], q[2]);
        nor.push(nn[0], nn[1], nn[2]);
      }
    }
    const nu = us.length;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu, d2 = c + 1;
        if (f.flip) idx.push(a, c, b, b, c, d2);
        else idx.push(a, b, c, b, d2, c);
      }
    }
  }
  return { pos, nor, idx };
}

/**
 * Lathe a 2D profile [radius, y] around the Y axis. Profile should run bottom→top
 * (outer side) so normals face outward. Duplicate consecutive points to make a crease.
 */
export function lathe(profile: [number, number][], segs = 24, phiStart = 0, phiLen = Math.PI * 2): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [], uv: number[] = [];
  const n = profile.length;
  const pn: [number, number][] = [];
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  for (let i = 0; i < n; i++) {
    const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(n - 1, i + 1)];
    let tx: number, ty: number;
    if (i < n - 1 && same(profile[i], next)) {
      tx = profile[i][0] - prev[0]; ty = profile[i][1] - prev[1];
    } else if (i > 0 && same(profile[i], prev)) {
      tx = next[0] - profile[i][0]; ty = next[1] - profile[i][1];
    } else {
      tx = next[0] - prev[0]; ty = next[1] - prev[1];
    }
    const l = Math.hypot(tx, ty) || 1;
    pn.push([ty / l, -tx / l]);
  }
  const full = Math.abs(phiLen - Math.PI * 2) < 1e-6;
  for (let s = 0; s <= segs; s++) {
    const phi = phiStart + (s / segs) * phiLen;
    const c = Math.cos(phi), si = Math.sin(phi);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i];
      pos.push(r * si, y, r * c);
      nor.push(pn[i][0] * si, pn[i][1], pn[i][0] * c);
      uv.push(s / segs, i / (n - 1));
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < n - 1; i++) {
      if (same(profile[i], profile[i + 1])) continue;
      const a = s * n + i, b = (s + 1) * n + i;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  void full;
  return { pos, nor, idx, uv };
}

export function sphere(r: number, ws = 16, hs = 10): Geo {
  const prof: [number, number][] = [];
  for (let i = 0; i <= hs; i++) {
    const a = -Math.PI / 2 + (i / hs) * Math.PI;
    prof.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  prof[0][0] = 0; prof[hs][0] = 0;
  return lathe(prof, ws);
}

/** Cylinder from y=0 to y=h. */
export function cyl(rt: number, rb: number, h: number, segs = 20, caps = true): Geo {
  const p: [number, number][] = [];
  if (caps) p.push([0, 0], [rb, 0]);
  p.push([rb, 0], [rt, h]);
  if (caps) p.push([rt, h], [0, h]);
  return lathe(p, segs);
}

/** Cylinder with rounded top/bottom edges (soft toy look). */
export function rcyl(r: number, h: number, bevel: number, segs = 24, arcSegs = 3): Geo {
  const p: [number, number][] = [[0, 0]];
  for (let i = 0; i <= arcSegs; i++) {
    const a = -Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
    p.push([r - bevel + Math.cos(a) * bevel, bevel + Math.sin(a) * bevel]);
  }
  for (let i = 0; i <= arcSegs; i++) {
    const a = (i / arcSegs) * (Math.PI / 2);
    p.push([r - bevel + Math.cos(a) * bevel, h - bevel + Math.sin(a) * bevel]);
  }
  p.push([0, h]);
  return lathe(p, segs);
}

export function capsule(r: number, len: number, segs = 14, hs = 6): Geo {
  const p: [number, number][] = [];
  for (let i = 0; i <= hs; i++) {
    const a = -Math.PI / 2 + (i / hs) * (Math.PI / 2);
    p.push([Math.cos(a) * r, Math.sin(a) * r + r]);
  }
  for (let i = 0; i <= hs; i++) {
    const a = (i / hs) * (Math.PI / 2);
    p.push([Math.cos(a) * r, Math.sin(a) * r + r + len]);
  }
  p[0][0] = 0; p[p.length - 1][0] = 0;
  return lathe(p, segs);
}

export function torus(R: number, r: number, segR = 24, segr = 10, arc = Math.PI * 2): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segR; i++) {
    const u = (i / segR) * arc;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= segr; j++) {
      const v = (j / segr) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      pos.push((R + r * cv) * cu, r * sv, (R + r * cv) * su);
      nor.push(cv * cu, sv, cv * su);
    }
  }
  for (let i = 0; i < segR; i++) {
    for (let j = 0; j < segr; j++) {
      const a = i * (segr + 1) + j, b = a + segr + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { pos, nor, idx };
}

/** Flat plane on XZ facing +Y, centered, with optional subdivisions. */
export function plane(w: number, d: number, sx = 1, sz = 1): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [], uv: number[] = [];
  for (let j = 0; j <= sz; j++) {
    for (let i = 0; i <= sx; i++) {
      pos.push(-w / 2 + (w * i) / sx, 0, -d / 2 + (d * j) / sz);
      nor.push(0, 1, 0);
      uv.push(i / sx, j / sz);
    }
  }
  for (let j = 0; j < sz; j++) {
    for (let i = 0; i < sx; i++) {
      const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, d2 = c + 1;
      idx.push(a, c, b, b, c, d2);
    }
  }
  return { pos, nor, idx, uv };
}

/** Vertical quad facing +Z (for signs) with UVs, centered. */
export function quad(w: number, h: number): Geo {
  return {
    pos: [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0],
    nor: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uv: [0, 1, 1, 1, 1, 0, 0, 0],
    idx: [0, 1, 2, 0, 2, 3],
  };
}

/** Tube swept along a polyline path with radius function. */
export function tube(path: Vec3[], radius: number | ((t: number) => number), segs = 8, caps = true): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const n = path.length;
  const tangents: Vec3[] = path.map((_, i) => vnorm(vsub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)])));
  let up: Vec3 = Math.abs(tangents[0][1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let nrm = vnorm(vcross(tangents[0], up));
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    // parallel transport
    nrm = vnorm(vsub(nrm, vscale(t, vdot(nrm, t))));
    const bin = vcross(t, nrm);
    const rad = typeof radius === 'number' ? radius : radius(i / (n - 1));
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const dir = vadd(vscale(nrm, Math.cos(a)), vscale(bin, Math.sin(a)));
      pos.push(path[i][0] + dir[0] * rad, path[i][1] + dir[1] * rad, path[i][2] + dir[2] * rad);
      nor.push(dir[0], dir[1], dir[2]);
    }
    up = bin;
  }
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < segs; s++) {
      const a = i * (segs + 1) + s, b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (caps) {
    for (const end of [0, n - 1]) {
      const c = pos.length / 3;
      const t = tangents[end];
      const sign = end === 0 ? -1 : 1;
      pos.push(path[end][0], path[end][1], path[end][2]);
      nor.push(t[0] * sign, t[1] * sign, t[2] * sign);
      const ring = end * (segs + 1);
      for (let s = 0; s <= segs; s++) {
        const k = ring + s;
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        nor.push(t[0] * sign, t[1] * sign, t[2] * sign);
      }
      for (let s = 0; s < segs; s++) {
        if (sign < 0) idx.push(c, c + 2 + s, c + 1 + s);
        else idx.push(c, c + 1 + s, c + 2 + s);
      }
    }
  }
  return { pos, nor, idx };
}

/** Parametric surface grid; f(u,v) -> point. Normals computed numerically. Closed in u if wrapU. */
export function paramSurface(nu: number, nv: number, f: (u: number, v: number) => Vec3, wrapU = false, flip = false): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const P: Vec3[][] = [];
  for (let j = 0; j <= nv; j++) {
    const row: Vec3[] = [];
    for (let i = 0; i <= nu; i++) row.push(f(i / nu, j / nv));
    P.push(row);
  }
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = P[j][i];
      const iu0 = wrapU ? (i === 0 ? nu - 1 : i - 1) : Math.max(0, i - 1);
      const iu1 = wrapU ? (i === nu ? 1 : i + 1) : Math.min(nu, i + 1);
      const du = vsub(P[j][iu1], P[j][iu0]);
      const dv = vsub(P[Math.min(nv, j + 1)][i], P[Math.max(0, j - 1)][i]);
      let n = vnorm(vcross(du, dv));
      if (flip) n = vscale(n, -1);
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  return { pos, nor, idx };
}

/** Triangular prism / wedge pointing down (bunting flag). */
export function flag(w: number, h: number, t = 0.01): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const pts: [number, number][] = [[-w / 2, 0], [w / 2, 0], [0, -h]];
  for (const z of [t, -t]) {
    const b = pos.length / 3;
    for (const [x, y] of pts) { pos.push(x, y, z); nor.push(0, 0, z > 0 ? 1 : -1); }
    if (z > 0) idx.push(b, b + 2, b + 1); else idx.push(b, b + 1, b + 2);
  }
  return { pos, nor, idx };
}

// ------------------------------------------------------------------ builder

const tmpN = new Float32Array(9);

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  mat: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  withUV = false;

  add(g: Geo, m: Mat4 | null, paint: Paint): this {
    const base = this.pos.length / 3;
    const nm = m ? m3normal(tmpN, m) : null;
    let minY = Infinity, maxY = -Infinity;
    if (paint.ao) {
      for (let i = 1; i < g.pos.length; i += 3) { minY = Math.min(minY, g.pos[i]); maxY = Math.max(maxY, g.pos[i]); }
    }
    for (let i = 0; i < g.pos.length; i += 3) {
      const lp: Vec3 = [g.pos[i], g.pos[i + 1], g.pos[i + 2]];
      const ln: Vec3 = [g.nor[i], g.nor[i + 1], g.nor[i + 2]];
      const p = m ? transformPoint(m, lp) : lp;
      let n: Vec3 = ln;
      if (nm) n = vnorm([nm[0] * ln[0] + nm[3] * ln[1] + nm[6] * ln[2], nm[1] * ln[0] + nm[4] * ln[1] + nm[7] * ln[2], nm[2] * ln[0] + nm[5] * ln[1] + nm[8] * ln[2]]);
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      let c = typeof paint.color === 'function' ? paint.color(p, n, lp) : paint.color;
      if (paint.ao) {
        const t = maxY > minY ? (lp[1] - minY) / (maxY - minY) : 1;
        const k = 1 - paint.ao * (1 - Math.min(1, t * 2.2));
        c = [c[0] * k, c[1] * k, c[2] * k];
      }
      this.col.push(c[0], c[1], c[2]);
      this.mat.push(paint.pattern ?? 0, paint.gloss ?? 0.15, paint.emissive ?? 0, paint.rim ?? 0);
      if (g.uv) this.uv.push(g.uv[(i / 3) * 2], g.uv[(i / 3) * 2 + 1]);
      else this.uv.push(0, 0);
    }
    // detect mirrored transforms and flip winding
    let flip = false;
    if (m) {
      const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
      flip = det < 0;
    }
    for (let i = 0; i < g.idx.length; i += 3) {
      if (flip) this.idx.push(base + g.idx[i], base + g.idx[i + 2], base + g.idx[i + 1]);
      else this.idx.push(base + g.idx[i], base + g.idx[i + 1], base + g.idx[i + 2]);
    }
    return this;
  }

  get vertexCount() { return this.pos.length / 3; }

  build(): GeoData {
    return {
      pos: new Float32Array(this.pos),
      nor: new Float32Array(this.nor),
      col: new Float32Array(this.col),
      mat: new Float32Array(this.mat),
      uv: this.withUV ? new Float32Array(this.uv) : new Float32Array(this.uv),
      idx: new Uint32Array(this.idx),
    };
  }
}

/** Shortcut: one primitive with one paint -> GeoData. */
export function single(g: Geo, paint: Paint, m: Mat4 | null = null): GeoData {
  return new GeoBuilder().add(g, m, paint).build();
}
