// Order queue: spawns orders during the shift, ticks patience, expires them, matches deliveries.
import { CONFIG, RecipeId } from './config';
import { RecipeManager } from './RecipeManager';

export interface Order {
  id: number;
  recipe: RecipeId;
  patience: number;
  left: number;
  reward: number;
  /** set when leaving the queue (for card exit animation) */
  done: 'served' | 'expired' | null;
}

export interface OrderEvents {
  added(o: Order): void;
  expired(o: Order): void;
}

export class OrderManager {
  orders: Order[] = [];
  private nextId = 1;
  private timer = 0;

  constructor(private recipes: RecipeManager, private ev: OrderEvents) {}

  reset(): void {
    this.orders = [];
    this.timer = CONFIG.orders.firstDelay;
    this.recipes.reset();
  }

  spawn(recipe?: RecipeId): Order {
    const id = recipe ?? this.recipes.pick(this.orders.map((o) => o.recipe));
    const o: Order = {
      id: this.nextId++,
      recipe: id,
      patience: CONFIG.orders.patience[id],
      left: CONFIG.orders.patience[id],
      reward: CONFIG.orders.reward[id],
      done: null,
    };
    this.orders.push(o);
    this.ev.added(o);
    return o;
  }

  update(dt: number, elapsed: number, remaining: number): void {
    for (const o of [...this.orders]) {
      o.left -= dt;
      if (o.left <= 0) {
        o.done = 'expired';
        this.orders.splice(this.orders.indexOf(o), 1);
        this.ev.expired(o);
      }
    }
    this.timer -= dt;
    const n = this.orders.length;
    if (n === 0 && this.timer > CONFIG.orders.emptyDelay) this.timer = CONFIG.orders.emptyDelay;
    // second order arrives quickly at the start so both players have work
    if (n < CONFIG.orders.max && this.timer <= 0 && remaining > 12) {
      this.spawn();
      const { intervalMin: a, intervalMax: b } = CONFIG.orders;
      // a little faster as the shift goes on
      const ramp = Math.min(1, elapsed / 150);
      this.timer = (a + Math.random() * (b - a)) * (1 - 0.25 * ramp);
      if (elapsed < 10 && this.orders.length < 2) this.timer = 4;
    }
  }

  /** Find the order this dish fulfils (most urgent first). */
  match(recipe: RecipeId | null): Order | null {
    if (!recipe) return null;
    let best: Order | null = null;
    for (const o of this.orders) if (o.recipe === recipe && (!best || o.left < best.left)) best = o;
    return best;
  }

  serve(o: Order): void {
    o.done = 'served';
    const i = this.orders.indexOf(o);
    if (i >= 0) this.orders.splice(i, 1);
    if (this.orders.length === 0) this.timer = Math.min(this.timer, 2);
  }
}
