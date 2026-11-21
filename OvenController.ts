// One oven: holds one croissant, bakes it on a configurable timer
// (raw → golden → warning → burnt), animates door, window glow, dial and light.
import { CONFIG } from './config';
import { OvenVisual } from './kitchenArt';
import { PointLight } from './renderer';
import { Vec3, damp, lerp, clamp, easeOutBack } from './math';
import type { Croissant, Holder, Anchor } from './ItemManager';

export type OvenPhase = 'empty' | 'baking' | 'ready' | 'warning' | 'burnt';

export interface OvenEvents {
  onReady(o: OvenController): void;
  onBurn(o: OvenController): void;
  onWarnTick(o: OvenController): void;
}

export class OvenController implements Holder {
  item: Croissant | null = null;
  light: PointLight;
  private door = 0;
  private doorHold = 0;
  private glow = 0;
  private warnTick = 0;
  private time = 0;
  smokeT = 0;

  constructor(public vis: OvenVisual, private ev: OvenEvents) {
    this.light = { pos: [vis.x, 0.55, vis.z + 0.85], radius: 2.4, color: [1, 0.55, 0.2], intensity: 0 };
  }

  anchor(): Anchor {
    return { pos: this.vis.slot as Vec3, yaw: 0 };
  }

  get phase(): OvenPhase {
    const c = this.item;
    if (!c) return 'empty';
    if (c.state === 'burnt') return 'burnt';
    if (c.state === 'raw') return 'baking';
    if (c.bake >= CONFIG.oven.warn) return 'warning';
    return 'ready';
  }

  /** 0..1 progress toward golden, then 0..1 toward burnt */
  get progress(): number {
    const c = this.item;
    if (!c) return 0;
    if (c.state === 'raw') return clamp(c.bake / CONFIG.oven.bake, 0, 1);
    return clamp((c.bake - CONFIG.oven.bake) / (CONFIG.oven.burn - CONFIG.oven.bake), 0, 1);
  }

  insert(c: Croissant): void {
    this.item = c;
    this.openDoor();
  }

  take(): Croissant | null {
    const c = this.item;
    this.item = null;
    this.openDoor();
    return c;
  }

  openDoor(): void { this.doorHold = 0.45; }

  reset(): void {
    this.item = null;
    this.door = 0;
    this.doorHold = 0;
    this.glow = 0;
  }

  update(dt: number, running: boolean): void {
    this.time += dt;
    const c = this.item;
    if (c && running && c.state !== 'burnt') {
      const before = c.bake;
      c.bake += dt;
      if (c.state === 'raw' && c.bake >= CONFIG.oven.bake) {
        c.setState('baked');
        this.ev.onReady(this);
      }
      if (c.state === 'baked' && c.bake >= CONFIG.oven.warn) {
        this.warnTick -= dt;
        if (before < CONFIG.oven.warn || this.warnTick <= 0) {
          const left = CONFIG.oven.burn - c.bake;
          this.warnTick = left > 2.5 ? 0.6 : 0.3;
          this.ev.onWarnTick(this);
        }
      }
      if (c.state === 'baked' && c.bake >= CONFIG.oven.burn) {
        c.setState('burnt');
        this.ev.onBurn(this);
      }
    }
    // door
    this.doorHold -= dt;
    const doorTarget = this.doorHold > 0 ? 1 : 0;
    this.door = lerp(this.door, doorTarget, damp(doorTarget ? 18 : 9, dt));
    this.vis.door.rot[0] = easeOutBack(clamp(this.door, 0, 1)) * 1.35;
    // glow & light
    const ph = this.phase;
    let target = 0.08, col: Vec3 = [1, 0.55, 0.2];
    if (ph === 'baking') target = 0.75 + Math.sin(this.time * 5) * 0.12;
    else if (ph === 'ready') target = 0.65;
    else if (ph === 'warning') { target = 0.8 + Math.sin(this.time * 16) * 0.35; col = [1, 0.32, 0.12]; }
    else if (ph === 'burnt') { target = 0.35 + Math.sin(this.time * 3) * 0.1; col = [0.9, 0.2, 0.1]; }
    this.glow = lerp(this.glow, target, damp(8, dt));
    this.light.intensity = this.glow * 1.5;
    this.light.color = col;
    const g = this.glow;
    this.vis.glassMat.emissive = [col[0] * g * 0.9, col[1] * g * 0.9, col[2] * g * 0.6];
    this.vis.glassMat.opacity = 0.5 + g * 0.35;
    // dial needle sweeps with heat/progress
    const dialTarget = ph === 'empty' ? -1.2 : ph === 'baking' ? -1.2 + this.progress * 1.6 : 0.4 + this.progress * 1.0;
    this.vis.dial.rot[2] = lerp(this.vis.dial.rot[2], -dialTarget, damp(6, dt));
  }
}
