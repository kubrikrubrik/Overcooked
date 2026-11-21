// Builds the whole level art: kitchen platform, counters, stations, back facade, street outside.
// Static parts are merged into a handful of meshes; animated parts are returned as nodes.
import { GeoBuilder, PATTERN, Paint, Geo, box, rbox, lathe, sphere, cyl, rcyl, torus, plane, quad, tube, flag, capsule } from './geometry';
import { Mat4, RGB, Vec3, hex, m4trs, mixRGB, rng, clamp } from './math';
import { Renderer } from './renderer';
import { Material, Node, material } from './scene';
import { PAL } from './palette';
import { iconCanvas, IconId } from './icons';
import { conveyor, deliverySign, menuBoard, shopSign } from './signs';
import { LAYOUT, COLS, ROWS, COUNTER_H, charAt, isWalkable, tileX, tileZ, BOUNDS } from './layout';
import { CustomerRig, buildCustomer } from './characters';
import { rawCroissantGeo } from './food';
import type { ToppingId } from './config';

const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | Vec3 = 1): Mat4 => m4trs([x, y, z], [rx, ry, rz], s);

export interface OvenVisual {
  x: number;
  z: number;
  door: Node;
  glassMat: Material;
  slot: Vec3;
  dial: Node;
}

export interface KitchenVisuals {
  root: Node;
  ovens: OvenVisual[];
  storageSlots: Node[];
  toppingNodes: Record<ToppingId, Node>;
  plateStack: Node;
  bell: Node;
  customers: CustomerRig[];
  stringLights: Node;
}

const TOPPING_AT: Record<string, ToppingId> = { K: 'cinnamon', H: 'chocolate', R: 'sprinkles', J: 'jam' };
const MAT_COLORS: Record<ToppingId, RGB> = {
  cinnamon: hex('#ffd59a'),
  chocolate: hex('#b9826a'),
  sprinkles: hex('#ffc6de'),
  jam: hex('#ffb8b8'),
};

export function buildKitchenArt(r: Renderer): KitchenVisuals {
  const S = new GeoBuilder(); // opaque static
  const G = new GeoBuilder(); // glass static
  const root = new Node('level');
  const decals = new Node('decals');
  const rand = rng(42);

  const decal = (cv: HTMLCanvasElement, w: number, h: number, m: Mat4, opts: Partial<Material> = {}) => {
    const tex = r.texture(cv);
    const n = new Node('decal', r.mesh(new GeoBuilder().add(quad(w, h), null, { color: PAL.white, gloss: 0.1 }).build(), material({ texture: tex, transparent: true, depthWrite: false, castShadow: false, ...opts })));
    n.local.set(m);
    // decode m into pos/rot is not needed: use a wrapper that keeps the matrix
    const holder = new Node('decalHolder');
    holder.add(n);
    n.pos = [m[12], m[13], m[14]];
    return { n, holder };
  };
  const flatDecal = (cv: HTMLCanvasElement, size: number, x: number, y: number, z: number, ry = 0) => {
    const d = decal(cv, size, size, T(0, 0, 0));
    d.n.pos = [x, y, z];
    d.n.rot = [-Math.PI / 2, ry, 0];
    decals.add(d.n);
    return d.n;
  };
  const wallDecal = (cv: HTMLCanvasElement, w: number, h: number, x: number, y: number, z: number, ry = 0, opts: Partial<Material> = {}) => {
    const d = decal(cv, w, h, T(0, 0, 0), opts);
    d.n.pos = [x, y, z];
    d.n.rot = [0, ry, 0];
    decals.add(d.n);
    return d.n;
  };

  // ---------------------------------------------------------------- ground & platform
  const GY = -0.16;
  S.add(plane(60, 44, 1, 1), T(0, GY, 4), { color: PAL.cobble, pattern: PATTERN.COBBLE });
  // darker road band in front + curb
  S.add(plane(60, 8, 1, 1), T(0, GY + 0.004, 10.4), { color: hex('#a99c90'), pattern: PATTERN.COBBLE });
  S.add(rbox(60, 0.12, 0.25, 0.04, 1), T(0, GY + 0.04, 6.35), { color: hex('#efe4d2') });
  // platform (brick sides)
  const pw = BOUNDS.maxX - BOUNDS.minX + 0.3, pd = BOUNDS.maxZ - BOUNDS.minZ + 0.3;
  S.add(box(pw, 0.2, pd), T(0, -0.1, (BOUNDS.minZ + BOUNDS.maxZ) / 2), { color: hex('#e7a58f'), pattern: PATTERN.BRICK });
  S.add(rbox(pw + 0.08, 0.05, pd + 0.08, 0.02, 1), T(0, -0.031, (BOUNDS.minZ + BOUNDS.maxZ) / 2), { color: hex('#fff0d8') });

  // floor with baked contact-AO near counters
  const solidDist = (x: number, z: number) => {
    let d = 9;
    for (let r2 = 0; r2 < ROWS; r2++) for (let c2 = 0; c2 < COLS; c2++) {
      if (isWalkable(charAt(c2, r2))) continue;
      const cx = tileX(c2), cz = tileZ(r2);
      const dx = Math.max(Math.abs(x - cx) - 0.5, 0), dz = Math.max(Math.abs(z - cz) - 0.5, 0);
      d = Math.min(d, Math.hypot(dx, dz));
    }
    return d;
  };
  const fw = BOUNDS.maxX - BOUNDS.minX, fd = BOUNDS.maxZ - BOUNDS.minZ;
  S.add(plane(fw, fd, COLS * 4, ROWS * 4), T(0, 0.002, (BOUNDS.minZ + BOUNDS.maxZ) / 2), {
    color: (p) => {
      const d = solidDist(p[0], p[2]);
      const ao = 1 - 0.32 * (1 - clamp(d / 0.55, 0, 1));
      return [PAL.floor[0] * ao, PAL.floor[1] * ao, PAL.floor[2] * (ao * 0.97 + 0.03)];
    },
    pattern: PATTERN.FLOOR,
    gloss: 0.25,
  });
  // drain grates
  for (const [gx, gz] of [[-3, 2.5], [4.5, -1.5]]) {
    S.add(rbox(0.5, 0.02, 0.5, 0.01, 1), T(gx, 0.008, gz), { color: PAL.steelDark, gloss: 0.5 });
    for (let i = -2; i <= 2; i++) S.add(box(0.06, 0.012, 0.4), T(gx + i * 0.085, 0.016, gz), { color: hex('#3c4048') });
  }

  // ---------------------------------------------------------------- counters
  const exposed = (c: number, r2: number) => ({
    n: isWalkable(charAt(c, r2 - 1)),
    s: isWalkable(charAt(c, r2 + 1)),
    w: isWalkable(charAt(c - 1, r2)),
    e: isWalkable(charAt(c + 1, r2)),
    out_s: r2 === ROWS - 1,
  });
  const counterBase = (c: number, r2: number, body: RGB = PAL.counterBody, bodyDark: RGB = PAL.counterBodyDark, top: RGB | null = PAL.counterTop) => {
    const x = tileX(c), z = tileZ(r2);
    S.add(rbox(0.9, 0.09, 0.9, 0.02, 1), T(x, 0.045, z), { color: PAL.kick });
    S.add(rbox(0.97, 0.5, 0.97, 0.035, 1), T(x, 0.33, z), { color: body, ao: 0.3, rim: 0.05 });
    const ex = exposed(c, r2);
    const panel = (px: number, pz: number, rotY: number) => {
      S.add(rbox(0.74, 0.3, 0.03, 0.012, 1), T(px, 0.33, pz, 0, rotY), { color: bodyDark });
      S.add(rbox(0.22, 0.035, 0.035, 0.015, 1), T(px + Math.sin(rotY) * 0.02, 0.43, pz + Math.cos(rotY) * 0.02, 0, rotY), { color: PAL.brass, gloss: 0.8 });
    };
    if (ex.n) panel(x, z - 0.485, Math.PI);
    if (ex.s || ex.out_s) panel(x, z + 0.485, 0);
    if (ex.w) panel(x - 0.485, z, -Math.PI / 2);
    if (ex.e) panel(x + 0.485, z, Math.PI / 2);
    S.add(rbox(1.0, 0.035, 1.0, 0.012, 1), T(x, 0.585, z), { color: PAL.counterTrim });
    if (top) S.add(rbox(1.0, 0.04, 1.0, 0.014, 2), T(x, 0.6, z), { color: top, pattern: PATTERN.TILE, gloss: 0.5 });
    return { x, z };
  };

  const ovens: OvenVisual[] = [];
  const storageSlots: Node[] = [];
  const toppingNodes = {} as Record<ToppingId, Node>;
  let plateStack: Node = new Node('plates');
  let bell: Node = new Node('bell');
  let storageBuilt = false;
  let deliveryBuilt = false;

  for (let r2 = 0; r2 < ROWS; r2++) {
    for (let c = 0; c < COLS; c++) {
      const ch = LAYOUT[r2][c];
      const x = tileX(c), z = tileZ(r2);
      switch (ch) {
        case 'C': counterBase(c, r2); break;
        case 'd': counterBase(c, r2); cornerDecor(S, G, x, z, c, r2); break;
        case 'm': counterBase(c, r2); mixer(S, x, z); break;
        case 'K': case 'H': case 'R': case 'J': {
          const tp = TOPPING_AT[ch];
          counterBase(c, r2);
          S.add(rbox(0.86, 0.02, 0.86, 0.008, 1), T(x, COUNTER_H + 0.006, z), { color: MAT_COLORS[tp], gloss: 0.3 });
          const n = toppingContainer(r, tp);
          n.pos = [x, COUNTER_H + 0.015, z - 0.06];
          root.add(n);
          toppingNodes[tp] = n;
          flatDecal(iconCanvas(tp as IconId, 128), 0.24, x - 0.3, COUNTER_H + 0.02, z + 0.31);
          break;
        }
        case 'P': {
          counterBase(c, r2);
          S.add(rbox(0.8, 0.02, 0.8, 0.008, 1), T(x, COUNTER_H + 0.006, z), { color: hex('#bfe3ff'), gloss: 0.3 });
          plateStack = plateStackNode(r);
          plateStack.pos = [x, COUNTER_H + 0.016, z];
          root.add(plateStack);
          break;
        }
        case 'B': {
          // hollow cabinet around a chute
          S.add(rbox(0.9, 0.09, 0.9, 0.02, 1), T(x, 0.045, z), { color: PAL.kick });
          for (const [dx, dz, w, d] of [[0, -0.39, 0.97, 0.2], [0, 0.39, 0.97, 0.2], [-0.39, 0, 0.2, 0.97], [0.39, 0, 0.2, 0.97]]) {
            S.add(rbox(w, 0.5, d, 0.03, 1), T(x + dx, 0.33, z + dz), { color: PAL.counterBody, ao: 0.3 });
            S.add(box(w + 0.03, 0.035, d + 0.03), T(x + dx, 0.585, z + dz), { color: PAL.counterTrim });
          }
          S.add(rbox(0.74, 0.3, 0.03, 0.012, 1), T(x + 0.485, 0.33, z, 0, Math.PI / 2), { color: PAL.counterBodyDark });
          // top with a square chute
          const t = 0.2, hole = 0.56;
          const side = (1 - hole) / 2;
          S.add(box(1.0, 0.04, side), T(x, 0.6, z - hole / 2 - side / 2), { color: PAL.counterTop, pattern: PATTERN.TILE });
          S.add(box(1.0, 0.04, side), T(x, 0.6, z + hole / 2 + side / 2), { color: PAL.counterTop, pattern: PATTERN.TILE });
          S.add(box(side, 0.04, hole), T(x - hole / 2 - side / 2, 0.6, z), { color: PAL.counterTop, pattern: PATTERN.TILE });
          S.add(box(side, 0.04, hole), T(x + hole / 2 + side / 2, 0.6, z), { color: PAL.counterTop, pattern: PATTERN.TILE });
          S.add(box(hole, 0.02, hole), T(x, 0.12, z), { color: hex('#141016') });
          for (const [dx, dz, w, d] of [[0, -hole / 2, hole, 0.01], [0, hole / 2, hole, 0.01], [-hole / 2, 0, 0.01, hole], [hole / 2, 0, 0.01, hole]]) {
            S.add(box(w, 0.5, d), T(x + dx, 0.37, z + dz), { color: hex('#2a2630') });
          }
          S.add(torus(0.3, 0.025, 4, 4), T(x, 0.625, z, 0, Math.PI / 4, 0, [1.0, 0.6, 1.0]), { color: PAL.steel, gloss: 0.8 });
          void t;
          flatDecal(iconCanvas('bin', 128), 0.2, x + 0.38, COUNTER_H + 0.025, z + 0.38);
          break;
        }
        case 'S': {
          if (storageBuilt) break;
          storageBuilt = true;
          const cx = x + 0.5;
          storageCrate(S, cx, z);
          const geo = r.mesh(rawCroissantGeo().build(), material());
          const slots: [number, number][] = [[-0.6, -0.17], [0, -0.17], [0.6, -0.17], [-0.6, 0.2], [0, 0.2], [0.6, 0.2]];
          for (const [sx, sz] of slots) {
            const n = new Node('stock', geo);
            n.pos = [cx + sx, 0.47, z + sz];
            n.rot = [0, (rand() - 0.5) * 0.5, 0];
            root.add(n);
            storageSlots.push(n);
          }
          // lid leaning on the wall, painted with a big icon
          S.add(rbox(1.86, 0.06, 0.62, 0.02, 1), T(cx, 0.92, -3.87, 1.32, 0, 0), { color: PAL.wood, pattern: PATTERN.WOOD });
          wallDecal(iconCanvas('raw', 256), 0.5, 0.5, cx, 0.93, -3.833, 0).rot = [-0.25, 0, 0];
          wallDecal(iconCanvas('raw', 128), 0.3, 0.3, cx, 0.33, z + 0.475, 0);
          break;
        }
        case 'O': {
          const ov = oven(r, S, G, root, x, z);
          ovens.push(ov);
          break;
        }
        case 'W': {
          counterBase(c, r2, hex('#fff0d8'), hex('#ffb3c4'), null);
          if (deliveryBuilt) break;
          deliveryBuilt = true;
          const cz = z + 0.5; // spans this and next row
          S.add(rbox(1.0, 0.04, 2.0, 0.015, 2), T(x, 0.6, cz), { color: hex('#3b3540'), gloss: 0.3 });
          const cv = r.texture(conveyor());
          const belt = new Node('belt', r.mesh(new GeoBuilder().add(quad(0.92, 1.9), null, { color: PAL.white }).build(), material({ texture: cv, castShadow: false })));
          belt.pos = [x, COUNTER_H + 0.004, cz];
          belt.rot = [-Math.PI / 2, 0, 0];
          root.add(belt);
          // side rails
          for (const s of [-1, 1]) S.add(rbox(1.0, 0.06, 0.06, 0.02, 1), T(x, COUNTER_H + 0.03, cz + s * 0.97), { color: PAL.brass, gloss: 0.7 });
          // arch & sign
          for (const s of [-1, 1]) {
            S.add(rcyl(0.05, 1.45, 0.02, 12), T(x + 0.42, COUNTER_H, cz + s * 0.95), { color: hex('#7a4a2a') });
          }
          S.add(rbox(0.12, 0.12, 2.1, 0.04, 1), T(x + 0.42, COUNTER_H + 1.45, cz), { color: hex('#7a4a2a') });
          // awning slats
          for (let i = 0; i < 8; i++) {
            const zz = cz - 1.0 + (i + 0.5) * 0.25;
            S.add(box(0.75, 0.05, 0.25), T(x + 0.78, COUNTER_H + 1.42, zz, 0, 0, -0.4), { color: i % 2 ? PAL.white : PAL.awningYellow, gloss: 0.15 });
          }
          S.add(rbox(0.1, 0.06, 2.05, 0.02, 1), T(x + 1.13, COUNTER_H + 1.27, cz), { color: PAL.awningYellow });
          const sign = wallDecal(deliverySign(), 1.3, 0.5, x + 0.1, COUNTER_H + 1.78, cz + 0.02, 0);
          sign.rot = [-0.35, 0, 0];
          bell = bellNode(r);
          bell.pos = [x - 0.36, COUNTER_H, cz + 0.84];
          root.add(bell);
          break;
        }
        default: break;
      }
    }
  }

  // ---------------------------------------------------------------- facade
  facade(S, G, r, root, decals, wallDecal);

  // ---------------------------------------------------------------- outside
  outside(S, G, rand);
  const customers: CustomerRig[] = [];
  for (let i = 0; i < 5; i++) {
    const cr = buildCustomer(r, i);
    cr.root.pos = [7.35 + i * 0.85, GY, 0.0 + (i % 2 ? 0.18 : -0.12)];
    cr.root.rot = [0, -Math.PI / 2, 0];
    root.add(cr.root);
    customers.push(cr);
  }
  // seated customers at cafe tables
  for (const [i, x, z, ry] of [[5, -8.95, 0.25, Math.PI * 0.1], [2, -9.45, 3.45, -Math.PI * 0.6]] as [number, number, number, number][]) {
    const cr = buildCustomer(r, i);
    cr.root.pos = [x, GY + 0.12, z];
    cr.root.rot = [0, ry, 0];
    root.add(cr.root);
  }

  // string lights (emissive, separate so we can twinkle)
  const SL = new GeoBuilder();
  const cols = [hex('#ffe08a'), hex('#ffb3c4'), hex('#b8f0ff'), hex('#fff6d0')];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const x = BOUNDS.minX + 0.1 + t * (BOUNDS.maxX - BOUNDS.minX - 0.2);
    const y = 2.62 - Math.sin(t * Math.PI * 3) ** 2 * 0.22;
    SL.add(sphere(0.045, 8, 6), T(x, y, -3.86), { color: cols[i % 4], emissive: 0.9 });
  }
  const wire: Vec3[] = [];
  for (let i = 0; i <= 78; i++) {
    const t = i / 78;
    wire.push([BOUNDS.minX + 0.1 + t * (BOUNDS.maxX - BOUNDS.minX - 0.2), 2.66 - Math.sin(t * Math.PI * 3) ** 2 * 0.22, -3.88]);
  }
  S.add(tube(wire, 0.008, 4, false), null, { color: hex('#3a3040') });
  const stringLights = new Node('lights', r.mesh(SL.build(), material({ castShadow: false })));
  root.add(stringLights);

  const staticNode = new Node('static', r.mesh(S.build(), material()));
  const glassNode = new Node('glass', r.mesh(G.build(), material({ transparent: true, opacity: 0.38, castShadow: false, depthWrite: false })));
  root.add(staticNode, glassNode, decals);

  return { root, ovens, storageSlots, toppingNodes, plateStack, bell, customers, stringLights };
}

// =================================================================== station models

function storageCrate(S: GeoBuilder, x: number, z: number) {
  const w = 1.94, d = 0.94, h = 0.56;
  const wood: Paint = { color: PAL.wood, pattern: PATTERN.WOOD, ao: 0.25 };
  S.add(rbox(w, 0.06, d, 0.02, 1), T(x, 0.03, z), { ...wood, color: PAL.woodDark });
  S.add(rbox(w, h, 0.07, 0.02, 1), T(x, h / 2, z + d / 2 - 0.035), wood);
  S.add(rbox(w, h, 0.07, 0.02, 1), T(x, h / 2, z - d / 2 + 0.035), wood);
  S.add(rbox(0.07, h, d, 0.02, 1), T(x - w / 2 + 0.035, h / 2, z), wood);
  S.add(rbox(0.07, h, d, 0.02, 1), T(x + w / 2 - 0.035, h / 2, z), wood);
  S.add(rbox(0.07, h, d, 0.02, 1), T(x, h / 2 - 0.08, z), { ...wood, color: PAL.woodDark });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    S.add(rbox(0.11, h + 0.04, 0.11, 0.025, 1), T(x + sx * (w / 2 - 0.05), (h + 0.04) / 2, z + sz * (d / 2 - 0.05)), { color: PAL.woodDark, pattern: PATTERN.WOOD });
  }
  // burlap bed
  S.add(rbox(w - 0.14, 0.08, d - 0.14, 0.03, 2), T(x, 0.42, z), { color: PAL.burlap, ao: 0.2 });
  // metal bands on front
  for (const sx of [-0.5, 0.5]) S.add(box(0.05, h - 0.06, 0.012), T(x + sx, h / 2, z + d / 2 + 0.002), { color: PAL.steelDark, gloss: 0.6 });
  // flour sack beside the crate
}

function oven(r: Renderer, S: GeoBuilder, G: GeoBuilder, root: Node, x: number, z: number): OvenVisual {
  const body: Paint = { color: PAL.ovenBody, gloss: 0.55, rim: 0.1 };
  const fz = z + 0.45; // front plane
  // plinth with little feet
  S.add(rbox(0.96, 0.14, 0.9, 0.03, 1), T(x, 0.12, z), { color: PAL.ovenDark });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.add(cyl(0.04, 0.05, 0.06, 10), T(x + sx * 0.38, 0, z + sz * 0.34), { color: PAL.brass, gloss: 0.8 });
  // shell around the cavity
  S.add(rbox(0.96, 0.16, 0.9, 0.05, 2), T(x, 0.92, z), body);
  S.add(rbox(0.14, 0.62, 0.9, 0.04, 1), T(x - 0.41, 0.53, z), body);
  S.add(rbox(0.14, 0.62, 0.9, 0.04, 1), T(x + 0.41, 0.53, z), body);
  S.add(rbox(0.96, 0.1, 0.9, 0.03, 1), T(x, 0.24, z), body);
  S.add(box(0.7, 0.56, 0.06), T(x, 0.55, z - 0.42), { color: hex('#2a1a1a') });
  // cavity: dark walls + rack
  S.add(box(0.68, 0.01, 0.84), T(x, 0.295, z), { color: hex('#3a2626') });
  S.add(box(0.01, 0.55, 0.84), T(x - 0.34, 0.56, z), { color: hex('#2e1e1e') });
  S.add(box(0.01, 0.55, 0.84), T(x + 0.34, 0.56, z), { color: hex('#2e1e1e') });
  S.add(box(0.68, 0.01, 0.84), T(x, 0.84, z), { color: hex('#2e1e1e') });
  for (let i = -3; i <= 3; i++) S.add(box(0.012, 0.012, 0.8), T(x + i * 0.09, 0.33, z), { color: PAL.steel, gloss: 0.6 });
  // brass trims, dial, knobs on top front
  S.add(rbox(0.98, 0.04, 0.05, 0.02, 1), T(x, 0.85, fz + 0.01), { color: PAL.brass, gloss: 0.85 });
  for (const sx of [-0.28, 0.28]) S.add(rcyl(0.04, 0.04, 0.01, 12), T(x + sx, 1.0, fz - 0.1), { color: PAL.cream, gloss: 0.4 });
  // vent slots on top
  for (let i = -2; i <= 2; i++) S.add(rbox(0.07, 0.01, 0.3, 0.004, 1), T(x + i * 0.1, 1.0, z - 0.12), { color: PAL.ovenDark });
  // chimney flue to the copper hood
  S.add(cyl(0.07, 0.07, 1.0, 14), T(x, 1.0, z - 0.25), { color: PAL.copper, gloss: 0.8 });
  S.add(lathe([[0.36, 0], [0.36, 0.04], [0.18, 0.3], [0.1, 0.36], [0.1, 0.62]], 20), T(x, 1.6, z - 0.32), { color: PAL.copper, gloss: 0.85 });
  S.add(torus(0.36, 0.025, 24, 6), T(x, 1.6, z - 0.32), { color: PAL.brass, gloss: 0.9 });

  // temperature dial (animated needle)
  S.add(rcyl(0.09, 0.03, 0.01, 18), T(x, 0.98, fz + 0.01, Math.PI / 2 - 0.35, 0, 0), { color: PAL.brass, gloss: 0.8 });
  S.add(rcyl(0.075, 0.035, 0.008, 18), T(x, 0.985, fz + 0.025, Math.PI / 2 - 0.35, 0, 0), { color: PAL.cream });
  const dial = new Node('dial', r.mesh(new GeoBuilder().add(box(0.012, 0.06, 0.01), T(0, 0.03, 0), { color: hex('#d8263f') }).build(), material({ castShadow: false })));
  dial.pos = [x, 0.985, fz - 0.005];
  const dialPivot = new Node('dialPivot');
  dialPivot.pos = [x, 0.985, fz + 0.03];
  dialPivot.rot = [-0.35, 0, 0];
  dial.pos = [0, 0, 0.012];
  dialPivot.add(dial);
  root.add(dialPivot);

  // door (pivot at bottom front edge, rotates outward around X)
  const door = new Node('door');
  door.pos = [x, 0.3, fz - 0.02];
  const D = new GeoBuilder();
  const dp: Paint = { color: PAL.ovenBody, gloss: 0.55 };
  D.add(rbox(0.7, 0.1, 0.05, 0.02, 1), T(0, 0.05, 0.025), dp);
  D.add(rbox(0.7, 0.1, 0.05, 0.02, 1), T(0, 0.5, 0.025), dp);
  D.add(rbox(0.12, 0.42, 0.05, 0.02, 1), T(-0.29, 0.275, 0.025), dp);
  D.add(rbox(0.12, 0.42, 0.05, 0.02, 1), T(0.29, 0.275, 0.025), dp);
  D.add(torus(0.17, 0.018, 24, 6, Math.PI * 2), T(0, 0.275, 0.05, Math.PI / 2, 0, 0, [1.3, 1, 0.8]), { color: PAL.brass, gloss: 0.9 });
  D.add(tube([[-0.2, 0.5, 0.06], [-0.2, 0.5, 0.11], [0.2, 0.5, 0.11], [0.2, 0.5, 0.06]], 0.016, 8, true), null, { color: PAL.brass, gloss: 0.9 });
  door.add(new Node('doorFrame', r.mesh(D.build(), material())));
  const glassMat = material({ transparent: true, opacity: 0.55, emissive: [0, 0, 0], castShadow: false, depthWrite: false });
  const glass = new Node('doorGlass', r.mesh(new GeoBuilder().add(quad(0.46, 0.32), null, { color: hex('#5a3328'), gloss: 0.9 }).build(), glassMat));
  glass.pos = [0, 0.275, 0.03];
  door.add(glass);
  root.add(door);
  void G;
  return { x, z, door, glassMat, slot: [x, 0.31, z + 0.02], dial };
}

function toppingContainer(r: Renderer, t: ToppingId): Node {
  const n = new Node('topping-' + t);
  const B = new GeoBuilder();
  const Gl = new GeoBuilder();
  const rand = rng(t.length * 13);
  if (t === 'cinnamon') {
    B.add(lathe([[0, 0], [0.13, 0], [0.2, 0.05], [0.25, 0.14], [0.26, 0.16], [0.24, 0.16], [0.2, 0.07], [0, 0.07]], 28), null, {
      color: (_p, _n, l) => (l[1] > 0.1 && l[1] < 0.135 ? hex('#e07a3a') : PAL.cream), gloss: 0.6,
    });
    B.add(sphere(1, 22, 12), T(0, 0.12, 0, 0, 0, 0, [0.22, 0.08, 0.22]), {
      color: () => (rand() < 0.15 ? PAL.icing : mixRGB(PAL.cinnamon, hex('#c47a3e'), rand())), gloss: 0.1,
    });
    for (const [a, dx] of [[0.4, -0.05], [-0.3, 0.06], [1.2, 0.0]] as [number, number][]) {
      B.add(rcyl(0.026, 0.42, 0.012, 10), T(dx, 0.2, 0.0, Math.PI / 2, a, 0.18), { color: hex('#a0562a'), pattern: PATTERN.NONE });
    }
    // little shaker
    B.add(rcyl(0.05, 0.12, 0.015, 14), T(0.25, 0, 0.17), { color: PAL.white, gloss: 0.5 });
    B.add(rcyl(0.052, 0.04, 0.015, 14), T(0.25, 0.11, 0.17), { color: PAL.steel, gloss: 0.8 });
  } else if (t === 'chocolate') {
    B.add(lathe([[0, 0], [0.17, 0], [0.2, 0.02], [0.21, 0.16], [0.235, 0.18], [0.22, 0.185], [0.19, 0.17], [0.18, 0.03], [0, 0.03]], 28), null, { color: PAL.white, gloss: 0.8, rim: 0.2 });
    B.add(torus(0.212, 0.014, 28, 6), T(0, 0.1, 0), { color: hex('#e8456a'), gloss: 0.6 });
    B.add(cyl(0.19, 0.19, 0.012, 28), T(0, 0.155, 0), { color: PAL.choco, gloss: 0.95 });
    B.add(rbox(0.26, 0.04, 0.06, 0.02, 1), T(-0.33, 0.15, 0, 0, 0, 0.1), { color: PAL.woodDark, pattern: PATTERN.WOOD });
    // drips on the rim + ladle
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      B.add(capsule(0.016, 0.03 + rand() * 0.04, 6, 3), T(Math.sin(a) * 0.21, 0.09, Math.cos(a) * 0.21, Math.PI, 0, 0), { color: PAL.choco, gloss: 0.9 });
    }
    B.add(tube([[0.05, 0.12, 0.0], [0.1, 0.25, 0.05], [0.16, 0.38, 0.1]], 0.016, 8), null, { color: PAL.woodLight, pattern: PATTERN.NONE });
    B.add(sphere(1, 12, 8), T(0.05, 0.14, 0, 0, 0, 0, [0.06, 0.03, 0.05]), { color: PAL.choco, gloss: 0.95 });
  } else if (t === 'sprinkles') {
    // jar contents: lots of tiny sprinkles on the visible surface of a cylinder
    B.add(cyl(0.15, 0.15, 0.25, 22), T(0, 0.01, 0), { color: () => PAL.sprinkles[(rand() * 7) | 0], gloss: 0.4 });
    const cap = capsule(0.012, 0.03, 5, 2);
    for (let i = 0; i < 110; i++) {
      const a = rand() * Math.PI * 2;
      const onTop = i < 40;
      const rr = onTop ? Math.sqrt(rand()) * 0.14 : 0.153;
      const y = onTop ? 0.262 : 0.03 + rand() * 0.22;
      B.add(cap, T(Math.sin(a) * rr, y, Math.cos(a) * rr, rand() * 3, rand() * 3, rand() * 3), { color: PAL.sprinkles[(rand() * 7) | 0], gloss: 0.6 });
    }
    B.add(rcyl(0.18, 0.012, 0.004, 22), T(0, 0, 0), { color: hex('#e8f4ff'), gloss: 0.9 });
    // lid lying on the mat
    B.add(rcyl(0.15, 0.05, 0.02, 22), T(0.3, 0, 0.12, 0, 0, 0.1), { color: hex('#ff7aa8'), gloss: 0.5 });
    Gl.add(lathe([[0.18, 0.0], [0.185, 0.03], [0.185, 0.28], [0.15, 0.32], [0.15, 0.34]], 24), null, { color: hex('#e6f3ff'), gloss: 1 });
    // spilled sprinkles
    for (let i = 0; i < 14; i++) B.add(cap, T((rand() - 0.5) * 0.6, 0.008, 0.2 + (rand() - 0.3) * 0.2, Math.PI / 2, rand() * 3, 0), { color: PAL.sprinkles[(rand() * 7) | 0] });
  } else {
    B.add(cyl(0.155, 0.155, 0.22, 22), T(0, 0.012, 0), { color: PAL.jam, gloss: 0.6 });
    B.add(rcyl(0.18, 0.012, 0.004, 22), T(0, 0, 0), { color: hex('#ffe8ec'), gloss: 0.9 });
    // gingham cloth lid
    B.add(rcyl(0.2, 0.04, 0.015, 24), T(0, 0.27, 0), {
      color: (_p, _n, l) => ((Math.floor(l[0] * 18 + 50) + Math.floor(l[2] * 18 + 50)) % 2 ? PAL.white : hex('#e03a4a')),
    });
    B.add(torus(0.17, 0.012, 24, 6), T(0, 0.27, 0), { color: hex('#7a2a2a') });
    // strawberry on top
    B.add(sphere(1, 14, 10), T(0, 0.35, 0, 0, 0, 0, [0.065, 0.06, 0.065]), { color: PAL.jam, gloss: 0.7 });
    B.add(cyl(0, 0.065, 0.06, 14), T(0, 0.33, 0, Math.PI, 0, 0), { color: PAL.jam, gloss: 0.7 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      B.add(sphere(1, 6, 4), T(Math.sin(a) * 0.03, 0.405, Math.cos(a) * 0.03, 0, a, 0, [0.02, 0.008, 0.035]), { color: hex('#3fae4a') });
    }
    Gl.add(lathe([[0.18, 0.0], [0.185, 0.03], [0.185, 0.25], [0.17, 0.28]], 24), null, { color: hex('#ffeef2'), gloss: 1 });
  }
  n.add(new Node('c', r.mesh(B.build(), material())));
  if (Gl.vertexCount) n.add(new Node('g', r.mesh(Gl.build(), material({ transparent: true, opacity: 0.35, castShadow: false, depthWrite: false }))));
  return n;
}

function plateStackNode(r: Renderer): Node {
  const B = new GeoBuilder();
  const prof: [number, number][] = [[0, 0.004], [0.17, 0.004], [0.19, 0.0], [0.205, 0.006], [0.215, 0.02], [0.26, 0.038], [0.3, 0.05], [0.305, 0.056], [0.298, 0.06], [0.255, 0.048], [0.21, 0.032], [0.2, 0.028], [0, 0.028]];
  for (let i = 0; i < 5; i++) {
    B.add(lathe(prof, 28), T(0, i * 0.03, 0), {
      color: (_p, _n, l) => (Math.hypot(l[0], l[2]) > 0.258 && l[1] > 0.03 ? PAL.plateRim : PAL.plate), gloss: 0.7,
    });
  }
  return new Node('plates', r.mesh(B.build(), material()));
}

function bellNode(r: Renderer): Node {
  const B = new GeoBuilder();
  B.add(rcyl(0.09, 0.02, 0.006, 16), null, { color: hex('#7a4a2a') });
  B.add(lathe([[0.075, 0.02], [0.075, 0.03], [0.06, 0.07], [0.03, 0.095], [0, 0.1]], 18), null, { color: PAL.brass, gloss: 0.95 });
  B.add(sphere(0.015, 8, 6), T(0, 0.105, 0), { color: PAL.brass, gloss: 0.95 });
  return new Node('bell', r.mesh(B.build(), material()));
}

function mixer(S: GeoBuilder, x: number, z: number) {
  const pink: Paint = { color: hex('#ff8fb1'), gloss: 0.6 };
  S.add(rbox(0.36, 0.06, 0.5, 0.03, 2), T(x, COUNTER_H + 0.03, z), pink);
  S.add(rbox(0.14, 0.42, 0.14, 0.05, 2), T(x, COUNTER_H + 0.27, z - 0.18), pink);
  S.add(capsule(0.1, 0.3, 14, 6), T(x, COUNTER_H + 0.5, z - 0.22, Math.PI / 2, 0, 0), pink);
  S.add(lathe([[0, 0], [0.08, 0], [0.15, 0.06], [0.16, 0.18], [0.15, 0.19]], 20), T(x, COUNTER_H + 0.06, z + 0.05), { color: PAL.steel, gloss: 0.9 });
  S.add(cyl(0.012, 0.012, 0.12, 6), T(x, COUNTER_H + 0.32, z + 0.05), { color: PAL.steel, gloss: 0.9 });
}

function cornerDecor(S: GeoBuilder, G: GeoBuilder, x: number, z: number, c: number, r2: number) {
  const top = COUNTER_H;
  if (c === 0 && r2 === 0) {
    // potted plant
    S.add(lathe([[0, 0], [0.16, 0], [0.2, 0.26], [0.22, 0.28], [0.2, 0.3], [0, 0.29]], 20), T(x, top, z), { color: hex('#d9714e'), gloss: 0.2 });
    const rnd = rng(5);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      S.add(sphere(1, 10, 6), T(x + Math.sin(a) * 0.12, top + 0.45 + rnd() * 0.15, z + Math.cos(a) * 0.12, rnd(), a, 0.6, [0.08, 0.2, 0.05]), { color: i % 2 ? PAL.leaf : PAL.leafDark, gloss: 0.3 });
    }
  } else if (c === COLS - 1 && r2 === 0) {
    // stacked cake boxes with ribbons
    const cols = [hex('#ffb3c9'), hex('#bfe9df'), hex('#ffe08a')];
    for (let i = 0; i < 3; i++) {
      const s = 0.5 - i * 0.08;
      S.add(rbox(s, 0.2, s, 0.02, 1), T(x, top + 0.1 + i * 0.2, z, 0, i * 0.3), { color: cols[i] });
      S.add(box(s + 0.01, 0.21, 0.04), T(x, top + 0.1 + i * 0.2, z, 0, i * 0.3), { color: hex('#e8456a') });
      S.add(box(0.04, 0.21, s + 0.01), T(x, top + 0.1 + i * 0.2, z, 0, i * 0.3), { color: hex('#e8456a') });
    }
    S.add(torus(0.05, 0.02, 10, 6), T(x - 0.04, top + 0.62, z, Math.PI / 2, 0.9, 0), { color: hex('#e8456a') });
    S.add(torus(0.05, 0.02, 10, 6), T(x + 0.04, top + 0.62, z, Math.PI / 2, -0.9, 0), { color: hex('#e8456a') });
  } else if (c === 0) {
    // cookie jar + rolling pin
    S.add(cyl(0.15, 0.15, 0.22, 18), T(x, top + 0.01, z), { color: hex('#d9a066'), pattern: PATTERN.NONE });
    G.add(lathe([[0.17, 0], [0.18, 0.02], [0.18, 0.3], [0.12, 0.34]], 20), T(x, top, z), { color: hex('#eef6ff'), gloss: 1 });
    S.add(sphere(1, 12, 8), T(x, top + 0.36, z, 0, 0, 0, [0.13, 0.05, 0.13]), { color: hex('#bfe9df'), gloss: 0.6 });
    S.add(capsule(0.04, 0.4, 10, 4), T(x + 0.1, top + 0.045, z + 0.3, 0, 0, Math.PI / 2), { color: PAL.woodLight, pattern: PATTERN.WOOD });
  } else {
    // cake stand with a strawberry cake under a glass dome
    S.add(lathe([[0, 0], [0.1, 0], [0.1, 0.02], [0.03, 0.04], [0.03, 0.16], [0.26, 0.17], [0.26, 0.19], [0, 0.19]], 24), T(x, top, z), { color: PAL.white, gloss: 0.8 });
    S.add(rcyl(0.2, 0.09, 0.02, 24), T(x, top + 0.19, z), { color: hex('#ffd6e0') });
    S.add(rcyl(0.2, 0.025, 0.01, 24), T(x, top + 0.24, z), { color: PAL.cream });
    S.add(rcyl(0.18, 0.08, 0.02, 24), T(x, top + 0.26, z), { color: hex('#ffc2d1') });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      S.add(sphere(1, 8, 6), T(x + Math.sin(a) * 0.12, top + 0.36, z + Math.cos(a) * 0.12, 0, 0, 0, [0.035, 0.03, 0.035]), { color: PAL.jam, gloss: 0.8 });
    }
    G.add(lathe([[0.25, 0], [0.25, 0.24], [0.2, 0.32], [0.1, 0.36], [0.03, 0.37], [0, 0.375]], 24), T(x, top + 0.19, z), { color: hex('#eef6ff'), gloss: 1 });
  }
}

// =================================================================== facade & outside

function facade(
  S: GeoBuilder, G: GeoBuilder, r: Renderer, root: Node, decals: Node,
  wallDecal: (cv: HTMLCanvasElement, w: number, h: number, x: number, y: number, z: number, ry?: number, opts?: Partial<Material>) => Node,
) {
  void root; void decals; void r;
  const fz = -4.0;
  const W = 24;
  // structure
  S.add(box(W, 4.9, 0.5), T(0, 2.3, fz - 0.25), { color: PAL.wallPink, pattern: PATTERN.WALLPAPER });
  // tiled backsplash behind counters
  S.add(box(BOUNDS.maxX - BOUNDS.minX, 0.6, 0.02), T(0, 0.92, fz + 0.01), { color: hex('#fff6ee'), pattern: PATTERN.BRICK, gloss: 0.5 });
  // mint wainscot outside the kitchen
  for (const s of [-1, 1]) {
    const cx = s * (BOUNDS.maxX + (W / 2 - BOUNDS.maxX) / 2);
    const w = W / 2 - BOUNDS.maxX;
    S.add(box(w, 1.2, 0.04), T(cx, 0.44, fz + 0.02), { color: PAL.facadeMint });
    S.add(box(w, 0.06, 0.08), T(cx, 1.06, fz + 0.04), { color: PAL.wallCream });
  }
  // cornice + upper storey
  S.add(rbox(W, 0.22, 0.34, 0.06, 2), T(0, 2.86, fz + 0.06), { color: PAL.wallCream, rim: 0.1 });
  S.add(box(W, 2.0, 0.5), T(0, 3.95, fz + 0.02 - 0.25), { color: PAL.facadeMint });
  for (const wx of [-7.5, -4.2, -0.9, 2.4, 5.7, 9]) {
    S.add(rbox(1.1, 1.25, 0.12, 0.04, 1), T(wx, 3.75, fz - 0.03), { color: PAL.wallCream });
    S.add(box(0.86, 1.02, 0.02), T(wx, 3.75, fz + 0.035), { color: PAL.windowGlow, emissive: 0.35 });
    S.add(box(0.06, 1.02, 0.03), T(wx, 3.75, fz + 0.05), { color: PAL.wallCream });
    S.add(box(0.86, 0.06, 0.03), T(wx, 3.85, fz + 0.05), { color: PAL.wallCream });
    for (const s of [-1, 1]) S.add(rbox(0.32, 1.2, 0.05, 0.02, 1), T(wx + s * 0.72, 3.75, fz + 0.03), { color: hex('#ff8fab') });
    // flower box
    S.add(rbox(1.0, 0.16, 0.24, 0.03, 1), T(wx, 3.08, fz + 0.12), { color: PAL.wood, pattern: PATTERN.WOOD });
    const rnd = rng(Math.round(wx * 10) + 99);
    for (let i = 0; i < 9; i++) {
      S.add(sphere(0.07, 8, 6), T(wx - 0.4 + i * 0.1, 3.2 + rnd() * 0.05, fz + 0.12 + (rnd() - 0.5) * 0.1), { color: i % 3 ? PAL.leaf : [hex('#ff6f91'), hex('#ffd23f'), hex('#ffffff')][i % 3 === 0 ? (i / 3) % 3 : 0] });
    }
  }
  // roof eave
  S.add(box(W, 0.35, 1.2), T(0, 5.05, fz - 0.1, -0.45, 0, 0), { color: PAL.roof, pattern: PATTERN.ROOF });

  // shop sign (right half of the back wall)
  wallDecal(shopSign(), 3.0, 0.94, 3.3, 2.25, fz + 0.045, 0, { transparent: true });
  S.add(rbox(3.2, 1.06, 0.06, 0.05, 1), T(3.3, 2.25, fz + 0.01), { color: hex('#7a2235') });
  // chalkboard menu
  wallDecal(menuBoard(), 1.55, 0.97, -4.5, 1.86, fz + 0.03, 0);
  // shelf under the sign with jars
  S.add(rbox(4.4, 0.06, 0.34, 0.02, 1), T(3.4, 1.38, fz + 0.17), { color: PAL.wood, pattern: PATTERN.WOOD });
  for (const bx of [1.5, 3.4, 5.3]) S.add(box(0.05, 0.18, 0.3), T(bx, 1.27, fz + 0.15), { color: PAL.woodDark });
  const rnd = rng(77);
  const jarCols = [hex('#ff9fbf'), hex('#ffe08a'), hex('#9fe0d0'), hex('#c9b3ff'), hex('#ffb38a'), hex('#a6d8ff')];
  let jx = 1.4;
  let k = 0;
  while (jx < 5.4) {
    const h = 0.18 + rnd() * 0.16, rr = 0.07 + rnd() * 0.05;
    if (k % 4 === 3) {
      // stacked cups
      for (let i = 0; i < 3; i++) S.add(lathe([[0, 0], [0.05, 0], [0.065, 0.07], [0.06, 0.075], [0, 0.07]], 14), T(jx, 1.41 + i * 0.07, fz + 0.18), { color: PAL.white, gloss: 0.7 });
      jx += 0.2;
    } else {
      S.add(cyl(rr * 0.9, rr * 0.9, h * 0.8, 14), T(jx, 1.42, fz + 0.18), { color: jarCols[k % jarCols.length] });
      G.add(lathe([[rr, 0], [rr, h], [rr * 0.7, h + 0.03]], 14), T(jx, 1.41, fz + 0.18), { color: hex('#eef6ff'), gloss: 1 });
      S.add(rcyl(rr * 0.75, 0.04, 0.01, 14), T(jx, 1.41 + h + 0.02, fz + 0.18), { color: [PAL.brass, hex('#e8456a'), PAL.white][k % 3], gloss: 0.7 });
      jx += rr * 2 + 0.08;
    }
    k++;
  }
  // copper pans hanging on a rail (left of ovens)
  S.add(cyl(0.015, 0.015, 1.1, 8), T(-2.5, 2.35, fz + 0.12, 0, 0, Math.PI / 2), { color: PAL.brass, gloss: 0.9 });
  for (const [px, sc] of [[-3.4, 0.14], [-3.0, 0.12], [-2.65, 0.1]] as [number, number][]) {
    S.add(cyl(0.008, 0.008, 0.16, 6), T(px, 2.2, fz + 0.12), { color: PAL.steelDark });
    S.add(rcyl(sc, 0.05, 0.015, 18), T(px, 2.2 - sc - 0.02, fz + 0.15, Math.PI / 2, 0, 0), { color: PAL.copper, gloss: 0.9 });
  }
  // wall clock
  S.add(rcyl(0.26, 0.06, 0.02, 24), T(-1.0, 2.25, fz + 0.02, Math.PI / 2, 0, 0), { color: PAL.brass, gloss: 0.8 });
  S.add(rcyl(0.22, 0.07, 0.01, 24), T(-1.0, 2.25, fz + 0.025, Math.PI / 2, 0, 0), { color: PAL.cream });
  S.add(box(0.02, 0.15, 0.01), T(-1.0, 2.31, fz + 0.1, 0, 0, 0.6), { color: PAL.ink });
  S.add(box(0.02, 0.1, 0.01), T(-1.0, 2.28, fz + 0.1, 0, 0, -1.2), { color: PAL.ink });
  // bunting flags under the cornice
  const fcols = [hex('#ff7d9c'), hex('#ffd23f'), hex('#7fd8c4'), hex('#ffffff'), hex('#b8a3ff')];
  for (let i = 0; i < 40; i++) {
    const t = i / 39;
    const x = -9.5 + t * 19;
    const y = 2.76 - Math.sin(t * Math.PI * 5) ** 2 * 0.07;
    S.add(flag(0.2, 0.24, 0.006), T(x, y, fz + 0.24, 0.15, 0, 0), { color: fcols[i % 5] });
  }

  // shop windows & doors outside the kitchen
  for (const s of [-1, 1]) {
    const wx = s * 9.2;
    S.add(rbox(2.2, 1.7, 0.12, 0.04, 1), T(wx, 1.5, fz + 0.02), { color: PAL.wallCream });
    S.add(box(1.9, 1.4, 0.02), T(wx, 1.5, fz + 0.09), { color: PAL.windowGlow, emissive: 0.25 });
    for (const yy of [1.5]) S.add(box(1.9, 0.05, 0.03), T(wx, yy, fz + 0.1), { color: PAL.wallCream });
    S.add(box(0.05, 1.4, 0.03), T(wx, 1.5, fz + 0.1), { color: PAL.wallCream });
    // striped awning
    for (let i = 0; i < 10; i++) {
      S.add(box(0.24, 0.05, 1.0), T(wx - 1.12 + i * 0.25, 2.45, fz + 0.5, 0.45, 0, 0), { color: i % 2 ? PAL.white : PAL.awningPink });
    }
    // cakes in the window
    for (let i = 0; i < 3; i++) {
      S.add(rcyl(0.16, 0.18, 0.03, 16), T(wx - 0.55 + i * 0.55, 0.9, fz + 0.2), { color: [hex('#ffc2d1'), hex('#fff0d8'), hex('#c98b6b')][i] });
      S.add(rcyl(0.2, 0.03, 0.01, 16), T(wx - 0.55 + i * 0.55, 0.86, fz + 0.2), { color: PAL.white });
    }
    S.add(box(2.1, 0.06, 0.4), T(wx, 0.84, fz + 0.18), { color: PAL.wallCream });
  }
}

function tree(S: GeoBuilder, x: number, z: number, blossom: boolean, seed: number) {
  const GY = -0.16;
  const rnd = rng(seed);
  S.add(rbox(0.9, 0.5, 0.9, 0.04, 1), T(x, GY + 0.25, z), { color: PAL.wood, pattern: PATTERN.WOOD, ao: 0.3 });
  S.add(rbox(0.8, 0.04, 0.8, 0.02, 1), T(x, GY + 0.5, z), { color: hex('#6b4a33') });
  S.add(cyl(0.07, 0.1, 1.5, 10), T(x, GY + 0.5, z), { color: hex('#7a5235') });
  const c1 = blossom ? PAL.blossom : PAL.leaf, c2 = blossom ? PAL.blossomLight : hex('#7cc46a');
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * 0.45;
    const s = 0.38 + rnd() * 0.22;
    S.add(sphere(s, 14, 10), T(x + Math.cos(a) * rr, GY + 2.05 + (rnd() - 0.3) * 0.5, z + Math.sin(a) * rr), {
      color: (_p, n) => mixRGB(c1, c2, clamp(n[1] * 0.6 + n[0] * -0.3, 0, 1)), rim: 0.2, gloss: 0.1,
    });
  }
}

function lamp(S: GeoBuilder, x: number, z: number) {
  const GY = -0.16;
  const g = hex('#2f5a52');
  S.add(cyl(0.12, 0.16, 0.2, 12), T(x, GY, z), { color: g });
  S.add(cyl(0.045, 0.045, 2.4, 10), T(x, GY + 0.2, z), { color: g, gloss: 0.5 });
  S.add(lathe([[0, 0], [0.14, 0], [0.18, 0.3], [0.2, 0.32], [0.1, 0.42], [0, 0.45]], 12), T(x, GY + 2.55, z), { color: hex('#fff2c4'), emissive: 0.7 });
  S.add(lathe([[0.22, 0], [0.22, 0.03], [0.1, 0.14], [0.02, 0.2], [0, 0.22]], 12), T(x, GY + 2.92, z), { color: g });
}

function outside(S: GeoBuilder, G: GeoBuilder, rand: () => number) {
  const GY = -0.16;
  void G;
  // left terrace: cafe tables with umbrellas
  for (const [x, z] of [[-8.3, 0.6], [-9.1, 3.2]]) {
    S.add(cyl(0.2, 0.26, 0.04, 16), T(x, GY, z), { color: hex('#3a3542') });
    S.add(cyl(0.03, 0.03, 0.7, 8), T(x, GY, z), { color: hex('#3a3542') });
    S.add(rcyl(0.42, 0.05, 0.02, 24), T(x, GY + 0.7, z), { color: PAL.white, gloss: 0.4 });
    S.add(cyl(0.02, 0.02, 2.0, 6), T(x, GY + 0.7, z), { color: PAL.cream });
    S.add(lathe([[1.05, 0], [1.0, 0.05], [0.5, 0.32], [0.05, 0.45], [0, 0.46]], 16), T(x, GY + 2.2, z), {
      color: (_p, _n, l) => (Math.floor(((Math.atan2(l[0], l[2]) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? PAL.white : hex('#4fb3a6')),
      gloss: 0.15,
    });
    for (const a of [0.6, 3.6]) {
      const cx = x + Math.sin(a) * 0.6, cz = z + Math.cos(a) * 0.6;
      S.add(rcyl(0.18, 0.05, 0.02, 14), T(cx, GY + 0.42, cz), { color: hex('#e8456a') });
      for (const s of [0, 1, 2, 3]) S.add(cyl(0.015, 0.015, 0.42, 5), T(cx + Math.sin(s * 1.57 + 0.78) * 0.12, GY, cz + Math.cos(s * 1.57 + 0.78) * 0.12), { color: hex('#3a3542') });
      S.add(rbox(0.32, 0.3, 0.04, 0.02, 1), T(cx + Math.sin(a) * 0.15, GY + 0.62, cz + Math.cos(a) * 0.15, 0, a, 0), { color: hex('#e8456a') });
    }
  }
  tree(S, -8.1, -2.3, true, 3);
  tree(S, -10.6, 1.6, false, 8);
  tree(S, 8.3, -2.5, true, 4);
  tree(S, 10.8, 3.4, false, 9);
  lamp(S, -7.25, 4.7);
  lamp(S, 7.25, 4.7);
  lamp(S, 7.25, -3.3);
  // queue rope stanchions near the delivery hatch
  for (const xx of [7.1, 8.4, 9.7]) for (const zz of [-0.65, 0.75]) {
    S.add(cyl(0.1, 0.12, 0.04, 12), T(xx, GY, zz), { color: PAL.brass, gloss: 0.9 });
    S.add(cyl(0.025, 0.025, 0.75, 8), T(xx, GY, zz), { color: PAL.brass, gloss: 0.9 });
    S.add(sphere(0.045, 10, 8), T(xx, GY + 0.78, zz), { color: PAL.brass, gloss: 0.9 });
  }
  for (const zz of [-0.65, 0.75]) {
    const path: Vec3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const xx = 7.1 + t * 2.6;
      path.push([xx, GY + 0.72 - Math.sin(((xx - 7.1) / 1.3) * Math.PI) ** 2 * 0.16, zz]);
    }
    S.add(tube(path, 0.022, 6, false), null, { color: hex('#c8243f'), gloss: 0.4 });
  }
  // bench on the right
  S.add(rbox(1.4, 0.08, 0.45, 0.03, 1), T(8.7, GY + 0.42, 3.2), { color: PAL.wood, pattern: PATTERN.WOOD });
  S.add(rbox(1.4, 0.3, 0.06, 0.03, 1), T(8.7, GY + 0.65, 3.42, -0.15, 0, 0), { color: PAL.wood, pattern: PATTERN.WOOD });
  for (const s of [-1, 1]) S.add(rbox(0.06, 0.42, 0.4, 0.02, 1), T(8.7 + s * 0.6, GY + 0.21, 3.2), { color: hex('#3a3542') });
  // front planters along the sidewalk
  for (const px of [-4.6, -1.6, 1.4, 4.4]) {
    S.add(rbox(1.3, 0.32, 0.42, 0.04, 1), T(px, GY + 0.16, 4.75), { color: PAL.facadeMint, ao: 0.3 });
    S.add(rbox(1.36, 0.05, 0.48, 0.02, 1), T(px, GY + 0.33, 4.75), { color: PAL.wallCream });
    for (let i = 0; i < 11; i++) {
      const fx = px - 0.55 + i * 0.11;
      S.add(sphere(0.09 + rand() * 0.04, 8, 6), T(fx, GY + 0.4 + rand() * 0.06, 4.75 + (rand() - 0.5) * 0.18), { color: i % 3 === 0 ? [hex('#ff6f91'), hex('#ffd23f'), hex('#ffffff'), hex('#c9a3ff')][(i / 3) % 4] : PAL.leaf, rim: 0.2 });
    }
  }
  // crates & sacks by the back left (outside)
  S.add(rbox(0.7, 0.55, 0.6, 0.04, 1), T(-7.4, GY + 0.27, -3.2, 0, 0.2, 0), { color: PAL.wood, pattern: PATTERN.WOOD, ao: 0.3 });
  S.add(rbox(0.55, 0.45, 0.5, 0.04, 1), T(-7.3, GY + 0.77, -3.25, 0, -0.15, 0), { color: PAL.woodLight, pattern: PATTERN.WOOD, ao: 0.3 });
  S.add(sphere(1, 14, 10), T(-8.15, GY + 0.28, -3.35, 0, 0, 0, [0.32, 0.32, 0.26]), { color: PAL.burlap });
  S.add(sphere(1, 14, 10), T(-7.55, GY + 0.22, -2.55, 0, 0.5, 0.1, [0.3, 0.26, 0.24]), { color: PAL.burlap });
  // milk cans on the right back
  for (const [x, z] of [[7.4, -2.2], [7.8, -1.9]]) {
    S.add(lathe([[0, 0], [0.16, 0], [0.17, 0.35], [0.1, 0.48], [0.1, 0.56], [0.12, 0.57], [0, 0.58]], 16), T(x, GY, z), { color: PAL.steel, gloss: 0.8 });
  }
  // grass verges at far sides
  for (const s of [-1, 1]) {
    S.add(rbox(4, 0.06, 20, 0.03, 1), T(s * 14, GY + 0.03, 3), { color: PAL.grass, pattern: PATTERN.GRASS });
  }
}

export { box, sphere };
