// Procedural croissant (raw / golden / burnt) with layered bands, real 3D toppings and plates.
import { GeoBuilder, paramSurface, lathe, sphere, capsule, tube, Geo } from './geometry';
import { RGB, Vec3, mixRGB, rng, vnorm, vcross, vsub, m4, clamp } from './math';
import { Renderer } from './renderer';
import { Mesh, Node, material } from './scene';
import { PAL } from './palette';

interface Shape { arcHalf: number; R: number; rMax: number; bands: number; ridge: number; }
const BAKED: Shape = { arcHalf: 1.2, R: 0.25, rMax: 0.128, bands: 5, ridge: 0.24 };
const RAW: Shape = { arcHalf: 1.08, R: 0.235, rMax: 0.102, bands: 5, ridge: 0.17 };

const TAU = Math.PI * 2;

function r0At(sh: Shape, t: number) { return sh.rMax * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.72); }
function bumpAt(sh: Shape, t: number, phi: number) {
  const u = t * sh.bands + 0.17 * Math.cos(phi);
  return 0.5 - 0.5 * Math.cos(TAU * u);
}

/** Surface point of the croissant. phi: 0 = outer side, PI/2 = top, PI = inner side. */
function crPoint(sh: Shape, t: number, phi: number, inflate = 0, ridgeK = 1): Vec3 {
  const th = (t * 2 - 1) * sh.arcHalf;
  const r0 = r0At(sh, t);
  const b = bumpAt(sh, t, phi);
  const rk = sh.ridge * ridgeK;
  const r = r0 * (1 - rk + rk * Math.sqrt(b)) + inflate;
  const sx = Math.sin(th), cx = Math.cos(th);
  const S: Vec3 = [sh.R * sx, 0, -sh.R * cx + sh.R * 0.72];
  let y = r * 0.82 * Math.sin(phi);
  const flat = -0.4 * r0;
  if (y < flat) y = flat + (y - flat) * 0.12;
  const nh = Math.cos(phi) * r;
  return [S[0] + sx * nh, y + 0.4 * r0 + 0.004, S[2] - cx * nh];
}

function surfNormal(sh: Shape, t: number, phi: number, inflate: number, ridgeK: number): Vec3 {
  const e = 0.002;
  const a = crPoint(sh, t, phi - e, inflate, ridgeK), b = crPoint(sh, t, phi + e, inflate, ridgeK);
  const c = crPoint(sh, t - e, phi, inflate, ridgeK), d = crPoint(sh, t + e, phi, inflate, ridgeK);
  return vnorm(vcross(vsub(b, a), vsub(d, c)));
}

/** Build croissant body with per-vertex colors chosen by band ridge / orientation. */
function bodyGeo(sh: Shape, kind: 'raw' | 'baked' | 'burnt'): GeoBuilder {
  const nu = 28, nv = 44;
  const geo = paramSurface(nu, nv, (u, v) => crPoint(sh, v, u * TAU), true);
  const cols: RGB[] = [];
  const rand = rng(kind === 'burnt' ? 7 : 3);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const t = j / nv, phi = (i / nu) * TAU;
      const b = bumpAt(sh, t, phi);
      const top = clamp(Math.sin(phi), 0, 1);
      const bottom = clamp(-Math.sin(phi), 0, 1);
      let c: RGB;
      if (kind === 'raw') {
        c = mixRGB(PAL.doughShade, PAL.dough, 0.45 + 0.55 * Math.sqrt(b));
        c = mixRGB(c, [1, 0.95, 0.86], top * b * 0.25);
        c = mixRGB(c, PAL.doughShade, bottom * 0.5);
      } else if (kind === 'baked') {
        c = mixRGB(PAL.goldLight, PAL.goldMid, Math.pow(b, 0.6));
        c = mixRGB(c, PAL.goldDark, top * Math.pow(b, 1.4) * 0.75);
        const tipDark = Math.pow(Math.abs(t * 2 - 1), 3);
        c = mixRGB(c, PAL.goldDark, tipDark * 0.5);
        c = mixRGB(c, PAL.doughShade, bottom * 0.55);
      } else {
        c = mixRGB(PAL.burntLight, PAL.burnt, Math.pow(b, 0.5));
        c = mixRGB(c, [0.12, 0.09, 0.08], top * 0.5);
        if (rand() < 0.08) c = mixRGB(c, [0.45, 0.42, 0.4], 0.6);
      }
      cols.push(c);
    }
  }
  let k = 0;
  const gloss = kind === 'baked' ? 0.5 : kind === 'raw' ? 0.18 : 0.05;
  return new GeoBuilder().add(geo, null, { color: () => cols[k++], gloss, rim: 0.15 });
}

function glazeGeo(sh: Shape): GeoBuilder {
  const nu = 24, nv = 34;
  const t0 = 0.08, t1 = 0.92;
  const drip = (t: number, s: number) => 0.42 * Math.pow(Math.max(0, Math.sin(t * 29 + s)), 6) + 0.12 * Math.pow(Math.max(0, Math.sin(t * 13 + s * 2)), 2);
  const f = (u: number, v: number): Vec3 => {
    const t = t0 + (t1 - t0) * v;
    const lo = 0.32 - drip(t, 1.3);
    const hi = Math.PI - 0.32 + drip(t, 4.1);
    const phi = lo + (hi - lo) * u;
    const edge = Math.min(v, 1 - v) * 6;
    const inf = 0.004 + 0.011 * clamp(edge, 0, 1) * clamp(Math.min(u, 1 - u) * 8, 0.25, 1);
    return crPoint(sh, t, phi, inf, 0.5);
  };
  const geo = paramSurface(nu, nv, f, false);
  return new GeoBuilder().add(geo, null, {
    color: (_p, n) => mixRGB(PAL.choco, PAL.chocoHi, clamp(n[1], 0, 1) * 0.35),
    gloss: 0.88,
    rim: 0.2,
  });
}

function jamGeo(sh: Shape): GeoBuilder {
  const nu = 18, nv = 30;
  const t0 = 0.17, t1 = 0.83;
  const f = (u: number, v: number): Vec3 => {
    const t = t0 + (t1 - t0) * v;
    const w = 0.55 + 0.18 * Math.sin(t * 23) + 0.12 * Math.sin(t * 41 + 1);
    const phi = Math.PI / 2 - w + 2 * w * u;
    const edge = clamp(Math.min(v, 1 - v) * 5, 0, 1) * clamp(Math.min(u, 1 - u) * 6, 0, 1);
    const blob = 0.004 + 0.02 * edge * (0.8 + 0.2 * Math.sin(t * 37));
    return crPoint(sh, t, phi, blob, 0.25);
  };
  const b = new GeoBuilder().add(paramSurface(nu, nv, f, false), null, {
    color: (_p, n) => mixRGB(PAL.jam, PAL.jamHi, clamp(n[1] - 0.7, 0, 0.3) * 1.5),
    gloss: 0.95,
    rim: 0.3,
  });
  // strawberry chunks
  const rnd = rng(11);
  for (let i = 0; i < 6; i++) {
    const t = 0.25 + rnd() * 0.5, phi = Math.PI / 2 + (rnd() - 0.5) * 0.7;
    const p = crPoint(sh, t, phi, 0.022, 0.25);
    const m = m4();
    m[0] = 0.026; m[5] = 0.02; m[10] = 0.026; m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
    b.add(sphere(1, 8, 6), m, { color: mixRGB(PAL.jam, [0.6, 0.05, 0.12], 0.4), gloss: 0.9 });
  }
  return b;
}

function cinnamonGeo(sh: Shape): GeoBuilder {
  const b = new GeoBuilder();
  // cinnamon-sugar dusting: little flat specks
  const rnd = rng(21);
  const speck = sphere(1, 5, 3);
  for (let i = 0; i < 110; i++) {
    const t = 0.1 + rnd() * 0.8, phi = 0.35 + rnd() * (Math.PI - 0.7);
    const p = crPoint(sh, t, phi, 0.002, 1);
    const s = 0.006 + rnd() * 0.006;
    const m = m4();
    m[0] = s; m[5] = s * 0.5; m[10] = s; m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
    const c = rnd() < 0.2 ? PAL.icing : mixRGB(PAL.cinnamon, [0.45, 0.2, 0.08], rnd() * 0.6);
    b.add(speck, m, { color: c, gloss: 0.2 });
  }
  // icing zig-zag drizzle
  const path: Vec3[] = [];
  const k = 9;
  for (let i = 0; i < k; i++) {
    const tA = 0.15 + (i / k) * 0.7, tB = 0.15 + ((i + 1) / k) * 0.7;
    const pA = Math.PI / 2 + (i % 2 ? 0.8 : -0.8), pB = Math.PI / 2 + ((i + 1) % 2 ? 0.8 : -0.8);
    for (let s = 0; s < 8; s++) {
      const q = s / 8;
      path.push(crPoint(sh, tA + (tB - tA) * q, pA + (pB - pA) * q, 0.008, 0.6));
    }
  }
  b.add(tube(path, 0.0115, 6, true), null, { color: PAL.icing, gloss: 0.55, rim: 0.2 });
  return b;
}

function sprinklesGeo(sh: Shape, inflate: number): GeoBuilder {
  const b = new GeoBuilder();
  const rnd = rng(inflate > 0.01 ? 31 : 37);
  const cap = capsule(0.0075, 0.026, 5, 2);
  for (let i = 0; i < 70; i++) {
    const t = 0.13 + rnd() * 0.74, phi = 0.5 + rnd() * (Math.PI - 1.0);
    const p = crPoint(sh, t, phi, inflate, inflate > 0.01 ? 0.5 : 1);
    const n = surfNormal(sh, t, phi, inflate, 1);
    // random tangent
    let tg = vnorm(vcross(n, [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]));
    const bt = vcross(tg, n);
    const m = m4();
    m[0] = n[0]; m[1] = n[1]; m[2] = n[2];
    m[4] = tg[0]; m[5] = tg[1]; m[6] = tg[2];
    m[8] = bt[0]; m[9] = bt[1]; m[10] = bt[2];
    // capsule spans y 0..0.041; center it
    m[12] = p[0] - tg[0] * 0.02; m[13] = p[1] - tg[1] * 0.02; m[14] = p[2] - tg[2] * 0.02;
    tg = tg;
    b.add(cap, m, { color: PAL.sprinkles[(rnd() * PAL.sprinkles.length) | 0], gloss: 0.6 });
  }
  return b;
}

export function plateGeo(): Geo {
  return lathe(
    [
      [0, 0.004], [0.17, 0.004], [0.19, 0.0], [0.205, 0.006], [0.215, 0.02],
      [0.26, 0.038], [0.3, 0.05], [0.305, 0.056], [0.298, 0.06],
      [0.255, 0.048], [0.21, 0.032], [0.2, 0.028], [0, 0.028],
    ],
    32,
  );
}

export interface FoodMeshes {
  raw: Mesh; baked: Mesh; burnt: Mesh;
  chocolate: Mesh; jam: Mesh; cinnamon: Mesh;
  sprinklesBare: Mesh; sprinklesGlaze: Mesh;
  plate: Mesh;
}

export function buildFoodMeshes(r: Renderer): FoodMeshes {
  const mk = (b: GeoBuilder, ds = false) => r.mesh(b.build(), material({ doubleSided: ds }));
  const plate = new GeoBuilder().add(plateGeo(), null, {
    color: (_p, _n, l) => (Math.hypot(l[0], l[2]) > 0.258 && l[1] > 0.03 ? PAL.plateRim : PAL.plate),
    gloss: 0.7,
    rim: 0.1,
  });
  return {
    raw: mk(bodyGeo(RAW, 'raw')),
    baked: mk(bodyGeo(BAKED, 'baked')),
    burnt: mk(bodyGeo(BAKED, 'burnt')),
    chocolate: mk(glazeGeo(BAKED), true),
    jam: mk(jamGeo(BAKED), true),
    cinnamon: mk(cinnamonGeo(BAKED)),
    sprinklesBare: mk(sprinklesGeo(BAKED, 0.004)),
    sprinklesGlaze: mk(sprinklesGeo(BAKED, 0.017)),
    plate: mk(plate),
  };
}

/** Raw croissant mini-geometry used by the storage crate (shares the RAW shape). */
export function rawCroissantGeo(): GeoBuilder { return bodyGeo(RAW, 'raw'); }

export interface CroissantVisual {
  root: Node;
  body: Node;
  tops: { chocolate: Node; jam: Node; cinnamon: Node; sprinklesBare: Node; sprinklesGlaze: Node };
}

export function makeCroissantVisual(fm: FoodMeshes): CroissantVisual {
  const root = new Node('croissant');
  const body = new Node('body', fm.raw);
  root.add(body);
  const tops = {
    chocolate: new Node('choc', fm.chocolate),
    jam: new Node('jam', fm.jam),
    cinnamon: new Node('cin', fm.cinnamon),
    sprinklesBare: new Node('sprB', fm.sprinklesBare),
    sprinklesGlaze: new Node('sprG', fm.sprinklesGlaze),
  };
  for (const n of Object.values(tops)) { n.visible = false; body.add(n); }
  return { root, body, tops };
}
