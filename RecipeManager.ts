// Recipes are defined by the real composition of the dish: baked croissant + exact topping set.
import type { RecipeId, ToppingId } from './config';
import type { Croissant } from './ItemManager';

export interface Recipe {
  id: RecipeId;
  name: string;
  toppings: ToppingId[];
  weight: number;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  cinnamon: { id: 'cinnamon', name: 'С корицей', toppings: ['cinnamon'], weight: 1 },
  chocolate: { id: 'chocolate', name: 'Шоколадный', toppings: ['chocolate'], weight: 1 },
  choco_sprinkles: { id: 'choco_sprinkles', name: 'Шоколад + посыпка', toppings: ['chocolate', 'sprinkles'], weight: 0.9 },
  jam: { id: 'jam', name: 'С вареньем', toppings: ['jam'], weight: 1 },
};

export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

export function sameSet(a: ToppingId[], b: ToppingId[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t) => b.includes(t));
}

/** Which recipe this croissant actually is (null if it matches none). */
export function identify(c: Croissant): RecipeId | null {
  if (c.state !== 'baked') return null;
  for (const id of RECIPE_IDS) if (sameSet(RECIPES[id].toppings, c.toppings)) return id;
  return null;
}

export class RecipeManager {
  private last: RecipeId[] = [];
  /** Weighted pick that avoids long runs of the same dish. */
  pick(active: RecipeId[], rand: () => number = Math.random): RecipeId {
    const weights = RECIPE_IDS.map((id) => {
      let w = RECIPES[id].weight;
      const n = active.filter((a) => a === id).length;
      w *= n === 0 ? 1.4 : n === 1 ? 0.6 : 0.15;
      if (this.last[this.last.length - 1] === id) w *= 0.5;
      return w;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let x = rand() * sum;
    for (let i = 0; i < RECIPE_IDS.length; i++) {
      x -= weights[i];
      if (x <= 0) { this.last.push(RECIPE_IDS[i]); return RECIPE_IDS[i]; }
    }
    return RECIPE_IDS[0];
  }
  reset() { this.last = []; }
}
