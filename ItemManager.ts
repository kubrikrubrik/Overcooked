// Items (croissant, plate) and how they follow whoever holds them, with a short toss tween.
import { FoodMeshes, CroissantVisual, makeCroissantVisual } from './food';
import { Node } from './scene';
import { Vec3, easeOutCubic, vlerp, angleLerp } from './math';
import type { ToppingId } from './config';

export type CroissantState = 'raw' | 'baked' | 'burnt';

export interface Anchor { pos: Vec3; yaw: number; }
export interface Holder { anchor(): Anchor; }

const CROISSANT_SCALE = 1.22;

export class Croissant {
  readonly kind = 'croissant' as const;
  state: CroissantState = 'raw';
  bake = 0;
  toppings: ToppingId[] = [];
  vis: CroissantVisual;
  holder: Holder | null = null;
  plate: Plate | null = null;
  /** scale pop animation 0..1 */
  pop = 0;
  /** "just applied" topping grow animation */
  topAnim = 0;
  tween = 1;
  from: Vec3 = [0, 0, 0];
  fromYaw = 0;
  constructor(private fm: FoodMeshes) {
    this.vis = makeCroissantVisual(fm);
    this.vis.root.setScale(CROISSANT_SCALE);
  }
  get node(): Node { return this.vis.root; }

  setState(s: CroissantState): void {
    this.state = s;
    this.vis.body.mesh = this.fm[s];
    this.pop = 1;
    this.refreshToppings();
  }

  hasTopping(t: ToppingId) { return this.toppings.includes(t); }

  addTopping(t: ToppingId): void {
    this.toppings.push(t);
    this.topAnim = 1;
    this.refreshToppings();
  }

  refreshToppings(): void {
    const tp = this.vis.tops;
    const has = (t: ToppingId) => this.toppings.includes(t);
    tp.chocolate.visible = has('chocolate');
    tp.jam.visible = has('jam');
    tp.cinnamon.visible = has('cinnamon');
    tp.sprinklesGlaze.visible = has('sprinkles') && (has('chocolate') || has('jam'));
    tp.sprinklesBare.visible = has('sprinkles') && !tp.sprinklesGlaze.visible;
  }
}

export class Plate {
  readonly kind = 'plate' as const;
  node: Node;
  content: Croissant | null = null;
  holder: Holder | null = null;
  tween = 1;
  from: Vec3 = [0, 0, 0];
  fromYaw = 0;
  pop = 0;
  constructor(fm: FoodMeshes) {
    this.node = new Node('plate', fm.plate);
  }
  setContent(c: Croissant | null): void {
    if (this.content) this.node.remove(this.content.node);
    this.content = c;
    if (c) {
      c.holder = null;
      c.plate = this;
      c.node.pos = [0, 0.03, 0];
      c.node.rot = [0, 0, 0];
      this.node.add(c.node);
      this.pop = 1;
    }
  }
}

export type Item = Croissant | Plate;

export class ItemManager {
  items: Item[] = [];
  constructor(private fm: FoodMeshes, private root: Node) {}

  createCroissant(): Croissant {
    const c = new Croissant(this.fm);
    this.items.push(c);
    this.root.add(c.node);
    return c;
  }

  createPlate(): Plate {
    const p = new Plate(this.fm);
    this.items.push(p);
    this.root.add(p.node);
    return p;
  }

  /** Attach to a new holder; tween from the current world position. */
  give(item: Item, holder: Holder): void {
    const wp = item.node.parent === this.root ? ([...item.node.pos] as Vec3) : item.node.worldPos();
    if (item.kind === 'croissant' && item.plate) {
      item.plate.content = null;
      item.plate.node.remove(item.node);
      item.plate = null;
      this.root.add(item.node);
      if (!this.items.includes(item)) this.items.push(item);
    }
    item.from = wp;
    item.fromYaw = item.node.rot[1];
    item.tween = 0;
    item.holder = holder;
  }

  /** Put croissant onto a plate (croissant leaves the free item list). */
  plateIt(plate: Plate, c: Croissant): void {
    this.detach(c);
    plate.setContent(c);
  }

  private detach(item: Item): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    if (item.node.parent) item.node.parent.remove(item.node);
    item.holder = null;
  }

  destroy(item: Item): void {
    if (item.kind === 'plate' && item.content) {
      item.content = null;
    }
    this.detach(item);
  }

  clear(): void {
    for (const it of [...this.items]) this.detach(it);
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.holder) {
        const a = it.holder.anchor();
        if (it.tween < 1) {
          it.tween = Math.min(1, it.tween + dt / 0.16);
          const e = easeOutCubic(it.tween);
          const p = vlerp(it.from, a.pos, e);
          p[1] += Math.sin(it.tween * Math.PI) * 0.18;
          it.node.pos = p;
          it.node.rot[1] = angleLerp(it.fromYaw, a.yaw, e);
        } else {
          it.node.pos = a.pos;
          it.node.rot[1] = a.yaw;
        }
      }
      this.animate(it, dt);
      if (it.kind === 'plate' && it.content) this.animate(it.content, dt);
    }
  }

  private animate(it: Item, dt: number) {
    if (it.pop > 0) it.pop = Math.max(0, it.pop - dt * 3.2);
    const base = it.kind === 'croissant' ? CROISSANT_SCALE : 1;
    const k = Math.sin(it.pop * Math.PI) * 0.22;
    it.node.scale = [base * (1 + k), base * (1 - k * 0.6), base * (1 + k)];
    if (it.kind === 'croissant' && it.topAnim > 0) {
      it.topAnim = Math.max(0, it.topAnim - dt * 3);
      const s = 1 + Math.sin(it.topAnim * Math.PI) * 0.15;
      it.vis.body.scale = [s, 1 + (s - 1) * 1.6, s];
    } else if (it.kind === 'croissant') {
      it.vis.body.scale = [1, 1, 1];
    }
  }
}
