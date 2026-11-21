// Decides what the action button does for each player (target selection + rules),
// so the button can show a context label before it is pressed.
import { ToppingId, TOPPINGS } from './config';
import { IconId } from './icons';
import { KitchenManager, Station } from './KitchenManager';
import { Croissant, ItemManager, Plate, Item } from './ItemManager';
import { Player } from './PlayerController';
import { tileX, tileZ, COUNTER_H } from './layout';

export type Target = { kind: 'station'; st: Station } | { kind: 'player'; other: Player } | null;

export interface Action {
  label: string;
  icon: IconId | null;
  valid: boolean;
  run?: () => void;
  error?: string;
}

export interface InteractionEvents {
  picked(p: Player, item: Item, from: Station | null): void;
  placed(p: Player, item: Item, st: Station): void;
  plated(p: Player, at: Station | null): void;
  ovenIn(p: Player, st: Station): void;
  ovenOut(p: Player, st: Station, c: Croissant): void;
  topping(p: Player, st: Station, t: ToppingId, c: Croissant): void;
  binned(p: Player, st: Station, item: Item): void;
  handoff(p: Player, other: Player, item: Item): void;
  stockTaken(p: Player, st: Station): void;
  stockReturned(p: Player, st: Station): void;
  /** return true if accepted */
  deliver(p: Player, st: Station, plate: Plate): boolean;
  error(p: Player, msg: string, st: Station | null): void;
}

const TOPPING_ICON: Record<ToppingId, IconId> = { cinnamon: 'cinnamon', chocolate: 'chocolate', sprinkles: 'sprinkles', jam: 'jam' };

export class InteractionManager {
  targets: (Station | null)[] = [null, null];

  constructor(private k: KitchenManager, private items: ItemManager, private players: Player[], private ev: InteractionEvents) {}

  findTarget(p: Player): Target {
    const [fx, fz] = p.facing;
    const probeX = p.pos[0] + fx * 0.55, probeZ = p.pos[2] + fz * 0.55;
    let best: Station | null = null, bestScore = Infinity;
    for (const st of this.k.stations) {
      for (const [c, r] of st.tiles) {
        const cx = tileX(c), cz = tileZ(r);
        const dx = Math.max(Math.abs(probeX - cx) - 0.45, 0), dz = Math.max(Math.abs(probeZ - cz) - 0.45, 0);
        const d = Math.hypot(dx, dz);
        if (d > 0.42) continue;
        const tx = cx - p.pos[0], tz = cz - p.pos[2];
        const tl = Math.hypot(tx, tz) || 1;
        if (tl > 1.35) continue;
        const dot = (tx * fx + tz * fz) / tl;
        if (dot < 0.15) continue;
        const score = d + (1 - dot) * 0.3 + tl * 0.05;
        if (score < bestScore) { bestScore = score; best = st; }
      }
    }
    // hand-off to the teammate standing in front
    const other = this.players[1 - p.id];
    const ox = other.pos[0] - p.pos[0], oz = other.pos[2] - p.pos[2];
    const od = Math.hypot(ox, oz);
    if (p.item && !other.item && od < 1.05) {
      const dot = (ox * fx + oz * fz) / (od || 1);
      const score = od * 0.3 + (1 - dot) * 0.3;
      if (dot > 0.55 && score < bestScore) return { kind: 'player', other };
    }
    return best ? { kind: 'station', st: best } : null;
  }

  /** Compute (and optionally execute) the action for player p. */
  resolve(p: Player): Action {
    const t = this.findTarget(p);
    this.targets[p.id] = t && t.kind === 'station' ? t.st : null;
    const held = p.item;
    if (!t) {
      return held ? { label: 'Нести', icon: iconOf(held), valid: false } : { label: 'Взять', icon: null, valid: false };
    }
    if (t.kind === 'player') {
      const other = t.other;
      return {
        label: 'Передать', icon: iconOf(held!), valid: true,
        run: () => {
          const it = p.item!;
          p.item = null;
          other.item = it;
          this.items.give(it, other);
          this.ev.handoff(p, other, it);
        },
      };
    }
    const st = t.st;
    const I = this.items;
    switch (st.kind) {
      case 'counter': {
        const on = st.item;
        if (!held && on) return { label: 'Взять', icon: iconOf(on), valid: true, run: () => this.pickFrom(p, st) };
        if (held && !on) return { label: 'Положить', icon: iconOf(held), valid: true, run: () => this.placeOn(p, st) };
        if (held && on) {
          if (held.kind === 'plate' && !held.content && on.kind === 'croissant') {
            return { label: 'На тарелку', icon: 'plate', valid: true, run: () => { st.item = null; I.plateIt(held, on); this.ev.plated(p, st); } };
          }
          if (held.kind === 'croissant' && on.kind === 'plate' && !on.content) {
            return { label: 'На тарелку', icon: 'plate', valid: true, run: () => { p.item = null; I.plateIt(on, held); this.ev.plated(p, st); } };
          }
          return this.err(p, st, 'Тут занято');
        }
        return { label: 'Взять', icon: null, valid: false };
      }
      case 'storage': {
        if (!held) {
          if (this.k.stock <= 0) return this.err(p, st, 'Ждём поставку…');
          return {
            label: 'Тесто', icon: 'raw', valid: true,
            run: () => {
              this.k.takeStock();
              const c = I.createCroissant();
              const slot = this.k.vis.storageSlots[this.k.stock] ?? this.k.vis.storageSlots[0];
              c.node.pos = [...slot.pos];
              p.item = c;
              I.give(c, p);
              this.ev.stockTaken(p, st);
              this.ev.picked(p, c, st);
            },
          };
        }
        if (held.kind === 'croissant' && held.state === 'raw' && held.toppings.length === 0 && this.k.stock < 6) {
          return { label: 'Вернуть', icon: 'raw', valid: true, run: () => { p.item = null; I.destroy(held); this.k.returnStock(); this.ev.stockReturned(p, st); } };
        }
        return this.err(p, st, 'Сюда только тесто');
      }
      case 'oven': {
        const ov = st.oven!;
        if (!held && ov.item) {
          return {
            label: 'Достать', icon: iconOf(ov.item), valid: true,
            run: () => { const c = ov.take()!; p.item = c; I.give(c, p); this.ev.ovenOut(p, st, c); },
          };
        }
        if (held && held.kind === 'plate' && !held.content && ov.item) {
          return {
            label: 'На тарелку', icon: 'plate', valid: true,
            run: () => { const c = ov.take()!; I.plateIt(held, c); this.ev.ovenOut(p, st, c); this.ev.plated(p, st); },
          };
        }
        if (held && ov.item) return this.err(p, st, 'Духовка занята');
        if (held && held.kind === 'croissant') {
          if (held.state === 'raw') {
            return { label: 'В духовку', icon: 'oven', valid: true, run: () => { p.item = null; ov.insert(held); I.give(held, ov); this.ev.ovenIn(p, st); } };
          }
          return this.err(p, st, held.state === 'burnt' ? 'Он уже сгорел' : 'Уже испечён');
        }
        if (held && held.kind === 'plate') return this.err(p, st, 'Тарелку в духовку нельзя');
        return { label: 'Достать', icon: 'oven', valid: false };
      }
      case 'topping': {
        const tp = st.topping!;
        const c = held ? (held.kind === 'croissant' ? held : held.content) : null;
        if (!c) return held ? this.err(p, st, 'Нужен круассан') : { label: TOPPINGS[tp].name, icon: TOPPING_ICON[tp], valid: false, error: 'Нужен круассан' };
        if (c.state === 'raw') return this.err(p, st, 'Сначала испеки!');
        if (c.state === 'burnt') return this.err(p, st, 'Сгорел — в мусор');
        if (c.hasTopping(tp)) return this.err(p, st, 'Уже есть');
        if (c.toppings.length >= 2) return this.err(p, st, 'Хватит топингов');
        return { label: TOPPINGS[tp].name, icon: TOPPING_ICON[tp], valid: true, run: () => { c.addTopping(tp); st.bounce = 1; this.ev.topping(p, st, tp, c); } };
      }
      case 'plates': {
        if (!held) {
          return {
            label: 'Тарелка', icon: 'plate', valid: true,
            run: () => { const pl = I.createPlate(); pl.node.pos = [st.x, COUNTER_H + 0.15, st.z]; p.item = pl; I.give(pl, p); this.ev.picked(p, pl, st); },
          };
        }
        if (held.kind === 'croissant') {
          return {
            label: 'На тарелку', icon: 'plate', valid: true,
            run: () => {
              p.item = null;
              const pl = I.createPlate();
              pl.node.pos = [st.x, COUNTER_H + 0.1, st.z];
              I.plateIt(pl, held);
              p.item = pl;
              I.give(pl, p);
              this.ev.plated(p, st);
            },
          };
        }
        if (held.kind === 'plate' && !held.content) return { label: 'Вернуть', icon: 'plate', valid: true, run: () => { p.item = null; I.destroy(held); this.ev.placed(p, held, st); } };
        return this.err(p, st, 'Уже на тарелке');
      }
      case 'delivery': {
        if (!held) return { label: 'Выдать', icon: null, valid: false };
        if (held.kind === 'croissant') return this.err(p, st, 'Нужна тарелка');
        if (!held.content) return this.err(p, st, 'Тарелка пустая');
        return {
          label: 'Выдать', icon: iconOf(held), valid: true,
          run: () => {
            const ok = this.ev.deliver(p, st, held);
            if (ok) { p.item = null; I.destroy(held); }
          },
        };
      }
      case 'bin': {
        if (!held) return { label: 'Мусор', icon: 'bin', valid: false };
        return {
          label: 'Выбросить', icon: 'bin', valid: true,
          run: () => {
            if (held.kind === 'plate' && held.content) {
              const c = held.content;
              held.setContent(null);
              held.content = null;
              void c;
              this.ev.binned(p, st, held);
            } else {
              p.item = null;
              I.destroy(held);
              this.ev.binned(p, st, held);
            }
          },
        };
      }
      default:
        return { label: 'Взять', icon: null, valid: false };
    }
  }

  private err(p: Player, st: Station, msg: string): Action {
    return { label: msg, icon: null, valid: false, error: msg, run: () => this.ev.error(p, msg, st) };
  }

  private pickFrom(p: Player, st: Station) {
    const it = st.item!;
    st.item = null;
    p.item = it;
    this.items.give(it, p);
    this.ev.picked(p, it, st);
  }

  private placeOn(p: Player, st: Station) {
    const it = p.item!;
    p.item = null;
    st.item = it;
    this.items.give(it, st);
    this.ev.placed(p, it, st);
  }

  /** Button pressed: run the action (or report why not). */
  act(p: Player): Action {
    const a = this.resolve(p);
    if (a.run) a.run();
    else if (a.error) this.ev.error(p, a.error, this.targets[p.id]);
    return a;
  }
}

export function iconOf(it: Item): IconId {
  if (it.kind === 'plate') return it.content ? iconOf(it.content) : 'plate';
  if (it.state === 'raw') return 'raw';
  if (it.state === 'burnt') return 'burnt';
  return 'croissant';
}
