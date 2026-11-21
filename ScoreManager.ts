// Coins, speed tips, streak multiplier, penalties and the final star rating.
import { CONFIG } from './config';
import type { Order } from './OrderManager';

export interface DeliveryResult { base: number; tip: number; total: number; streak: number; }

export class ScoreManager {
  score = 0;
  streak = 0;
  bestStreak = 0;
  delivered = 0;
  expired = 0;
  mistakes = 0;
  burnt = 0;
  earnedBase = 0;
  earnedTips = 0;
  penalties = 0;

  reset(): void {
    this.score = this.streak = this.bestStreak = this.delivered = this.expired = this.mistakes = this.burnt = 0;
    this.earnedBase = this.earnedTips = this.penalties = 0;
  }

  /** Tip multiplier shown in the HUD (×1..×4). */
  get multiplier(): number { return Math.min(CONFIG.score.streakMax, Math.max(1, this.streak)); }

  deliver(o: Order): DeliveryResult {
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const speed = Math.max(0, o.left / o.patience);
    const tip = Math.round(CONFIG.score.tipMax * speed) * this.multiplier;
    const base = o.reward;
    this.score += base + tip;
    this.delivered++;
    this.earnedBase += base;
    this.earnedTips += tip;
    return { base, tip, total: base + tip, streak: this.multiplier };
  }

  private penalty(n: number): number {
    const real = Math.min(n, this.score);
    this.score -= real;
    this.penalties += n;
    return n;
  }

  expire(): number { this.expired++; this.streak = 0; return this.penalty(CONFIG.score.expirePenalty); }
  wrong(): number { this.mistakes++; this.streak = 0; return this.penalty(CONFIG.score.wrongPenalty); }
  burn(): number { this.burnt++; return this.penalty(CONFIG.score.burntPenalty); }

  get stars(): number {
    const [a, b, c] = CONFIG.stars;
    return this.score >= c ? 3 : this.score >= b ? 2 : this.score >= a ? 1 : 0;
  }
}
