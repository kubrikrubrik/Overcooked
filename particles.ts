// CPU-simulated point-sprite particles (puffs, sparkles, crumbs, steam, coins).
import { RGB, Vec3 } from './math';

export const SHAPE = { PUFF: 0, DOT: 1, STAR: 2 } as const;

export interface EmitOpts {
  pos: Vec3;
  count: number;
  color: RGB | RGB[];
  speed?: number;
  spread?: number;       // radius of spawn
  up?: number;           // added vertical velocity
  gravity?: number;
  drag?: number;
  size?: number;
  sizeEnd?: number;
  life?: number;
  additive?: number;     // 0 = alpha blended, 1 = additive
  shape?: number;
  alpha?: number;
  dir?: Vec3;            // bias direction
}

export class Particles {
  readonly capacity: number;
  count = 0;
  readonly gpuData: Float32Array;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private maxLife: Float32Array;
  private size0: Float32Array; private size1: Float32Array;
  private grav: Float32Array; private drag: Float32Array;
  private col: Float32Array; private info: Float32Array;
  private alive = 0;

  constructor(capacity = 700) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f();
    this.size0 = f(); this.size1 = f();
    this.grav = f(); this.drag = f();
    this.col = new Float32Array(capacity * 4);
    this.info = new Float32Array(capacity * 2);
    this.gpuData = new Float32Array(capacity * 10);
  }

  emit(o: EmitOpts): void {
    const colors = Array.isArray(o.color[0]) ? (o.color as RGB[]) : [o.color as RGB];
    for (let k = 0; k < o.count; k++) {
      if (this.alive >= this.capacity) return;
      const i = this.alive++;
      const sp = o.spread ?? 0.05;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * sp;
      this.px[i] = o.pos[0] + Math.cos(a) * r;
      this.py[i] = o.pos[1] + (Math.random() - 0.5) * sp * 0.5;
      this.pz[i] = o.pos[2] + Math.sin(a) * r;
      const s = (o.speed ?? 1) * (0.4 + Math.random() * 0.6);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      let dx = Math.sin(ph) * Math.cos(th), dy = Math.abs(Math.cos(ph)), dz = Math.sin(ph) * Math.sin(th);
      if (o.dir) { dx = dx * 0.4 + o.dir[0]; dy = dy * 0.4 + o.dir[1]; dz = dz * 0.4 + o.dir[2]; }
      this.vx[i] = dx * s;
      this.vy[i] = dy * s + (o.up ?? 0);
      this.vz[i] = dz * s;
      const life = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      const size = (o.size ?? 0.15) * (0.7 + Math.random() * 0.6);
      this.size0[i] = size;
      this.size1[i] = o.sizeEnd !== undefined ? o.sizeEnd * (size / (o.size ?? 0.15)) : size;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      const c = colors[(Math.random() * colors.length) | 0];
      this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = o.alpha ?? 1;
      this.info[i * 2] = o.additive ?? 0;
      this.info[i * 2 + 1] = o.shape ?? SHAPE.PUFF;
    }
  }

  update(dt: number): void {
    let n = this.alive;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d - this.grav[i] * dt; this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.grav[i] > 0 && this.py[i] < 0.02) { this.py[i] = 0.02; this.vy[i] *= -0.3; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
    }
    this.alive = n;
    const g = this.gpuData;
    for (let i = 0; i < n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      const o = i * 10;
      g[o] = this.px[i]; g[o + 1] = this.py[i]; g[o + 2] = this.pz[i];
      const fadeIn = Math.min(1, t * 8);
      const fadeOut = Math.min(1, (1 - t) * 3);
      g[o + 3] = this.col[i * 4]; g[o + 4] = this.col[i * 4 + 1]; g[o + 5] = this.col[i * 4 + 2];
      g[o + 6] = this.col[i * 4 + 3] * fadeIn * fadeOut;
      g[o + 7] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      g[o + 8] = this.info[i * 2];
      g[o + 9] = this.info[i * 2 + 1];
    }
    this.count = n;
  }

  clear(): void { this.alive = 0; this.count = 0; }

  private copy(from: number, to: number): void {
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.info[to * 2] = this.info[from * 2]; this.info[to * 2 + 1] = this.info[from * 2 + 1];
  }
}
