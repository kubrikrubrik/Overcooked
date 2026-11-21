// All gameplay tuning lives here.

export type ToppingId = 'cinnamon' | 'chocolate' | 'sprinkles' | 'jam';
export type RecipeId = 'cinnamon' | 'chocolate' | 'choco_sprinkles' | 'jam';

export const CONFIG = {
  /** Shift length in seconds (3–5 min per spec). */
  shiftSeconds: 240,
  countdownSeconds: 3,

  oven: {
    /** croissant becomes golden at this many seconds */
    bake: 8,
    /** warning (risk of burning) starts here */
    warn: 9,
    /** burnt from here */
    burn: 14,
  },

  storage: {
    max: 6,
    /** seconds per +1 croissant restock */
    refill: 2.6,
  },

  orders: {
    firstDelay: 1.5,
    max: 4,
    intervalMin: 15,
    intervalMax: 22,
    /** if no orders are active, next one comes this fast */
    emptyDelay: 2.5,
    patience: { cinnamon: 75, chocolate: 75, choco_sprinkles: 90, jam: 75 } as Record<RecipeId, number>,
    reward: { cinnamon: 20, chocolate: 20, choco_sprinkles: 30, jam: 20 } as Record<RecipeId, number>,
  },

  score: {
    /** max speed tip (scaled by remaining patience), multiplied by streak */
    tipMax: 8,
    streakMax: 4,
    expirePenalty: 10,
    wrongPenalty: 5,
    burntPenalty: 10,
  },

  stars: [100, 220, 340] as [number, number, number],

  player: {
    speed: 4.1,
    accel: 30,
    radius: 0.3,
    reach: 0.95,
  },
};

export const TOPPINGS: Record<ToppingId, { name: string; color: string }> = {
  cinnamon: { name: 'Корица', color: '#b8692e' },
  chocolate: { name: 'Шоколад', color: '#5a2d1a' },
  sprinkles: { name: 'Посыпка', color: '#ff5da2' },
  jam: { name: 'Варенье', color: '#d4243f' },
};
