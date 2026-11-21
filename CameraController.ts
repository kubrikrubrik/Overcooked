// Fixed high three-quarter perspective camera that auto-fits the whole kitchen to any screen,
// keeping the top band free for order cards and a margin at the bottom for thumbs.
import { Camera } from './scene';
import { Vec3, m4, m4lookAt, m4mul, m4perspective, project, vadd, vscale, lerp, damp } from './math';
import { BOUNDS, COUNTER_H } from './layout';

export class CameraController implements Camera {
  view = m4();
  proj = m4();
  viewProj = m4();
  pos: Vec3 = [0, 10, 10];
  fov = (30 * Math.PI) / 180;
  pitch = (61 * Math.PI) / 180;
  target: Vec3 = [0, 0, 0];
  distance = 20;
  aspect = 4 / 3;
  /** subtle drift toward the players' midpoint so the diorama feels alive */
  private drift: Vec3 = [0, 0, 0];
  private shake = 0;

  /** Points that must stay visible. */
  private keyPoints(): Vec3[] {
    const { minX, maxX, minZ, maxZ } = BOUNDS;
    return [
      [minX - 0.15, 0, maxZ + 0.35], [maxX + 0.15, 0, maxZ + 0.35],
      [minX - 0.1, COUNTER_H + 0.55, minZ + 0.2], [maxX + 0.1, COUNTER_H + 0.55, minZ + 0.2],
      [minX, 0, (minZ + maxZ) / 2], [maxX + 0.9, 1.5, 0],
    ];
  }

  fit(width: number, height: number, safeTop: number, safeBottom: number, safeSide: number): void {
    this.aspect = width / Math.max(1, height);
    // allowed NDC window
    const top = 1 - (safeTop / height) * 2;
    const bottom = -1 + (safeBottom / height) * 2;
    const side = 1 - (safeSide / width) * 2;
    let lo = 5, hi = 80;
    let tz = 0.2;
    for (let iter = 0; iter < 5; iter++) {
      lo = 5; hi = 80;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        this.place([0, 0, tz], mid);
        if (this.fits(top, bottom, side)) hi = mid; else lo = mid;
      }
      this.place([0, 0, tz], hi);
      // re-center vertically inside the safe window
      let minY = Infinity, maxY = -Infinity;
      for (const p of this.keyPoints()) {
        const n = project(this.viewProj, p);
        minY = Math.min(minY, n[1]);
        maxY = Math.max(maxY, n[1]);
      }
      const want = (top + bottom) / 2, have = (minY + maxY) / 2;
      tz -= (have - want) * hi * 0.3;
    }
    this.distance = hi;
    this.target = [0, 0, tz];
    this.place(this.target, this.distance);
  }

  private fits(top: number, bottom: number, side: number): boolean {
    for (const p of this.keyPoints()) {
      const n = project(this.viewProj, p);
      if (n[0] < -side || n[0] > side || n[1] > top || n[1] < bottom) return false;
    }
    return true;
  }

  place(target: Vec3, dist: number): void {
    const dir: Vec3 = [0, Math.sin(this.pitch), Math.cos(this.pitch)];
    const t = vadd(target, this.drift);
    this.pos = vadd(t, vscale(dir, dist));
    if (this.shake > 0) {
      this.pos[0] += (Math.random() - 0.5) * this.shake;
      this.pos[1] += (Math.random() - 0.5) * this.shake;
    }
    m4lookAt(this.view, this.pos, t, [0, 1, 0]);
    m4perspective(this.proj, this.fov, this.aspect, 0.5, 120);
    m4mul(this.viewProj, this.proj, this.view);
  }

  addShake(amount: number) { this.shake = Math.max(this.shake, amount); }

  update(dt: number, focus: Vec3 | null): void {
    const goal: Vec3 = focus ? [focus[0] * 0.04, 0, (focus[2] - this.target[2]) * 0.03] : [0, 0, 0];
    const k = damp(1.5, dt);
    this.drift = [lerp(this.drift[0], goal[0], k), 0, lerp(this.drift[2], goal[2], k)];
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.place(this.target, this.distance);
  }

  /** world -> CSS pixel */
  toScreen(p: Vec3, w: number, h: number): [number, number, boolean] {
    const n = project(this.viewProj, p);
    return [(n[0] * 0.5 + 0.5) * w, (1 - (n[1] * 0.5 + 0.5)) * h, n[3] > 0];
  }
}
