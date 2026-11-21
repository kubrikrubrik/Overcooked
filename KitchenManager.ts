// Turns the layout into gameplay stations + colliders, owns station state (stock, ovens, slots)
// and the target highlight frames.
import { CONFIG, ToppingId } from './config';
import { KitchenVisuals } from './kitchenArt';
import { GeoBuilder, box } from './geometry';
import { Renderer } from './renderer';
import { Node, Mesh, material, Material } from './scene';
import { RGB, Vec3, m4trs, damp, lerp } from './math';
import { LAYOUT, COLS, ROWS, COUNTER_H, tileX, tileZ, isWalkable } from './layout';
import { OvenController, OvenEvents } from './OvenController';
import type { Anchor, Holder, Item } from './ItemManager';
import { PAL } from './palette';

export type StationKind = 'counter' | 'storage' | 'oven' | 'topping' | 'plates' | 'delivery' | 'bin' | 'decor';

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; }

export class Station implements Holder {
  item: Item | null = null;
  tiles: [number, number][] = [];
  topping: ToppingId | null = null;
  oven: OvenController | null = null;
  highlights: Node[] = [];
  /** where the item sits */
  slot: Vec3;
  /** height of the highlight frame */
  hy = COUNTER_H + 0.012;
  bounce = 0;
  constructor(public kind: StationKind, public x: number, public z: number) {
    this.slot = [x, COUNTER_H + 0.005, z];
  }
  anchor(): Anchor {
    if (this.oven) return this.oven.anchor();
    return { pos: this.slot, yaw: 0 };
  }
  get center(): Vec3 { return [this.x, this.hy, this.z]; }
}

export class KitchenManager {
  stations: Station[] = [];
  tileStation: (Station | null)[][] = [];
  colliders: AABB[] = [];
  ovens: OvenController[] = [];
  storage!: Station;
  stock = CONFIG.storage.max;
  private refill = 0;
  private hlMats: Material[];
  private time = 0;

  constructor(r: Renderer, public vis: KitchenVisuals, root: Node, ovenEvents: OvenEvents) {
    // highlight frame geometry (shared)
    const fb = new GeoBuilder();
    const w = 0.96, t = 0.07, h = 0.02;
    fb.add(box(w, h, t), m4trs([0, 0, -w / 2 + t / 2]), { color: [1, 1, 1] });
    fb.add(box(w, h, t), m4trs([0, 0, w / 2 - t / 2]), { color: [1, 1, 1] });
    fb.add(box(t, h, w - 2 * t), m4trs([-w / 2 + t / 2, 0, 0]), { color: [1, 1, 1] });
    fb.add(box(t, h, w - 2 * t), m4trs([w / 2 - t / 2, 0, 0]), { color: [1, 1, 1] });
    const gpu = r.upload(fb.build());
    this.hlMats = [PAL.p1, PAL.p2, [1, 1, 1] as RGB].map((c) => material({ unlit: true, tint: c, castShadow: false, receiveShadow: false, transparent: true, opacity: 0.95, depthWrite: false }));

    let ovenIdx = 0;
    for (let r2 = 0; r2 < ROWS; r2++) {
      this.tileStation.push([]);
      for (let c = 0; c < COLS; c++) {
        const ch = LAYOUT[r2][c];
        const x = tileX(c), z = tileZ(r2);
        if (!isWalkable(ch)) this.colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 });
        let st: Station | null = null;
        switch (ch) {
          case 'C': st = new Station('counter', x, z); break;
          case 'S':
            if (!this.storage) { this.storage = new Station('storage', x + 0.5, z); this.storage.hy = 0.6; st = this.storage; }
            else { this.tileStation[r2].push(this.storage); this.storage.tiles.push([c, r2]); continue; }
            break;
          case 'O': {
            st = new Station('oven', x, z);
            st.hy = 1.02;
            const ov = new OvenController(vis.ovens[ovenIdx++], ovenEvents);
            st.oven = ov;
            this.ovens.push(ov);
            break;
          }
          case 'K': case 'H': case 'R': case 'J':
            st = new Station('topping', x, z);
            st.topping = ({ K: 'cinnamon', H: 'chocolate', R: 'sprinkles', J: 'jam' } as Record<string, ToppingId>)[ch];
            break;
          case 'P': st = new Station('plates', x, z); break;
          case 'W': {
            const prev = r2 > 0 ? this.tileStation[r2 - 1][c] : null;
            if (prev && prev.kind === 'delivery') { this.tileStation[r2].push(prev); prev.tiles.push([c, r2]); continue; }
            st = new Station('delivery', x, z);
            break;
          }
          case 'B': st = new Station('bin', x, z); st.hy = COUNTER_H + 0.03; break;
          default: break;
        }
        this.tileStation[r2].push(st);
        if (st) {
          st.tiles.push([c, r2]);
          this.stations.push(st);
        }
      }
    }
    // highlight frames per tile
    for (const st of this.stations) {
      for (const [c, r2] of st.tiles) {
        const hl = new Node('hl', new Mesh(gpu, this.hlMats[0]));
        hl.pos = [tileX(c), st.hy, tileZ(r2)];
        hl.visible = false;
        root.add(hl);
        st.highlights.push(hl);
      }
    }
  }

  /** Station currently targeted by player p -> show frame in their colour. Both -> white. */
  setHighlights(targets: (Station | null)[]): void {
    for (const st of this.stations) {
      const a = targets[0] === st, b = targets[1] === st;
      const mat = a && b ? this.hlMats[2] : a ? this.hlMats[0] : this.hlMats[1];
      for (const h of st.highlights) {
        h.visible = a || b;
        if (h.mesh) h.mesh.mat = mat;
        const s = 1 + Math.sin(this.time * 7) * 0.02;
        h.scale = [s, 1, s];
      }
    }
  }

  reset(): void {
    this.stock = CONFIG.storage.max;
    this.refill = 0;
    for (const st of this.stations) st.item = null;
    for (const o of this.ovens) o.reset();
    this.syncStock();
  }

  takeStock(): boolean {
    if (this.stock <= 0) return false;
    this.stock--;
    this.syncStock();
    return true;
  }

  returnStock(): boolean {
    if (this.stock >= CONFIG.storage.max) return false;
    this.stock++;
    this.syncStock();
    return true;
  }

  private syncStock(): void {
    this.vis.storageSlots.forEach((n, i) => (n.visible = i < this.stock));
  }

  /** returns true when a new croissant was restocked this frame */
  update(dt: number, running: boolean): boolean {
    this.time += dt;
    let restocked = false;
    if (running && this.stock < CONFIG.storage.max) {
      this.refill += dt;
      if (this.refill >= CONFIG.storage.refill) {
        this.refill = 0;
        this.stock++;
        this.syncStock();
        const n = this.vis.storageSlots[this.stock - 1];
        n.scale = [0.2, 0.2, 0.2];
        restocked = true;
      }
    } else this.refill = 0;
    for (const n of this.vis.storageSlots) {
      const k = damp(10, dt);
      n.scale = [lerp(n.scale[0], 1, k), lerp(n.scale[1], 1, k), lerp(n.scale[2], 1, k)];
    }
    for (const o of this.ovens) o.update(dt, running);
    // station bounce (topping containers jiggle when used)
    for (const st of this.stations) {
      if (st.bounce > 0) st.bounce = Math.max(0, st.bounce - dt * 3);
    }
    for (const [tp, node] of Object.entries(this.vis.toppingNodes)) {
      const st = this.stations.find((s) => s.topping === tp);
      const b = st ? st.bounce : 0;
      const k = Math.sin(b * Math.PI * 3) * b * 0.18;
      node.scale = [1 + k, 1 - k, 1 + k];
    }
    return restocked;
  }

  stationAt(c: number, r2: number): Station | null {
    if (r2 < 0 || r2 >= ROWS || c < 0 || c >= COLS) return null;
    return this.tileStation[r2][c];
  }
}
