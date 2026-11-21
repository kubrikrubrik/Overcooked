// Free (non-grid) character movement with acceleration, wall/equipment collisions,
// player-vs-player bumping, carrying, and procedural idle/walk/carry/interact animations.
import { CONFIG } from './config';
import { CharacterRig } from './characters';
import { Vec3, angleLerp, clamp, damp, lerp } from './math';
import { Particles, SHAPE } from './particles';
import type { AABB } from './KitchenManager';
import type { Anchor, Holder, Item } from './ItemManager';
import type { PlayerInput } from './TouchController';

export class Player implements Holder {
  pos: Vec3;
  vel: [number, number] = [0, 0];
  yaw: number;
  item: Item | null = null;
  readonly radius = CONFIG.player.radius;
  private phase = 0;
  private moveBlend = 0;
  private carry = 0;
  private interactT = 0;
  private squash = 0;
  private blinkT = 2;
  private time = Math.random() * 10;
  private hop = 0;
  private dustT = 0;
  private bump = 0;
  private lastSpeed = 0;
  /** seconds of "stunned" feedback after an error bonk */
  shakeT = 0;

  constructor(public id: 0 | 1, public rig: CharacterRig, spawn: { x: number; z: number }, private scale = 1.28) {
    this.pos = [spawn.x, 0, spawn.z];
    this.yaw = id === 0 ? 0.5 : -2.6;
    rig.root.setScale(scale);
    this.sync();
  }

  respawn(spawn: { x: number; z: number }): void {
    this.pos = [spawn.x, 0, spawn.z];
    this.vel = [0, 0];
    this.yaw = this.id === 0 ? 0.5 : -2.6;
    this.item = null;
  }

  anchor(): Anchor {
    const w = this.rig.hold.world;
    return { pos: [w[12], w[13], w[14]], yaw: this.yaw };
  }

  get facing(): [number, number] { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }

  interactAnim(): void { this.interactT = 1; this.squash = 0.7; }
  pickupAnim(): void { this.squash = 1; }
  celebrate(): void { this.hop = 1; }
  bonk(): void { this.shakeT = 0.3; }

  update(dt: number, inp: PlayerInput, colliders: AABB[], other: Player, fx: Particles, canMove: boolean): void {
    this.time += dt;
    const P = CONFIG.player;
    let mx = canMove ? inp.mx : 0, my = canMove ? inp.my : 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const tx = mx * P.speed, tz = my * P.speed;
    const k = damp(len > 0.05 ? 14 : 18, dt);
    this.vel[0] = lerp(this.vel[0], tx, k);
    this.vel[1] = lerp(this.vel[1], tz, k);
    if (len > 0.12) this.yaw = angleLerp(this.yaw, Math.atan2(mx, my), damp(16, dt));

    this.pos[0] += this.vel[0] * dt;
    this.pos[2] += this.vel[1] * dt;
    // collisions (2 passes)
    for (let pass = 0; pass < 2; pass++) {
      for (const b of colliders) this.pushOut(b);
      const dx = this.pos[0] - other.pos[0], dz = this.pos[2] - other.pos[2];
      const d = Math.hypot(dx, dz), min = this.radius + other.radius;
      if (d < min && d > 1e-5) {
        const push = (min - d) / 2;
        const nx = dx / d, nz = dz / d;
        this.pos[0] += nx * push; this.pos[2] += nz * push;
        other.pos[0] -= nx * push; other.pos[2] -= nz * push;
        if (pass === 0 && Math.hypot(this.vel[0], this.vel[1]) > 2.5) this.bump = 1;
      }
    }

    // ---- animation
    const speed = Math.hypot(this.vel[0], this.vel[1]);
    this.moveBlend = lerp(this.moveBlend, clamp(speed / P.speed, 0, 1), damp(12, dt));
    this.phase += speed * dt * 2.3;
    const mb = this.moveBlend;
    this.carry = lerp(this.carry, this.item ? 1 : 0, damp(14, dt));
    this.interactT = Math.max(0, this.interactT - dt * 4.5);
    this.squash = Math.max(0, this.squash - dt * 4);
    this.hop = Math.max(0, this.hop - dt * 1.8);
    this.bump = Math.max(0, this.bump - dt * 4);
    this.shakeT = Math.max(0, this.shakeT - dt);

    const r = this.rig;
    const s = Math.sin(this.phase * Math.PI);
    const bob = Math.abs(s) * 0.045 * mb + Math.sin(this.time * 2.2) * 0.006 * (1 - mb);
    const hopY = Math.sin(this.hop * Math.PI) * 0.35 * (this.hop > 0 ? 1 : 0);
    r.body.pos[1] = 0.1 + bob + hopY;
    r.body.rot[0] = mb * 0.14 + this.interactT * 0.18;
    const sq = Math.sin(this.squash * Math.PI) * 0.12;
    r.body.scale = [1 + sq, 1 - sq, 1 + sq];
    r.body.rot[2] = this.shakeT > 0 ? Math.sin(this.time * 60) * 0.08 : Math.sin(this.time * 1.3) * 0.015 * (1 - mb);
    r.body.rot[1] = this.hop > 0 ? (1 - this.hop) * Math.PI * 2 : 0;

    r.footL.pos[2] = s * 0.11 * mb;
    r.footR.pos[2] = -s * 0.11 * mb;
    r.footL.pos[1] = Math.max(0, Math.cos(this.phase * Math.PI)) * 0.05 * mb;
    r.footR.pos[1] = Math.max(0, -Math.cos(this.phase * Math.PI)) * 0.05 * mb;

    const swing = s * 0.7 * mb;
    const carryX = -1.25 - this.interactT * 0.35;
    const freeX = -this.interactT * 1.3;
    r.armL.rot[0] = lerp(swing + freeX, carryX, this.carry);
    r.armR.rot[0] = lerp(-swing + freeX, carryX, this.carry);
    r.armL.rot[2] = lerp(0.25, 0.08, this.carry);
    r.armR.rot[2] = lerp(-0.25, -0.08, this.carry);

    r.head.rot[0] = -mb * 0.1 + Math.sin(this.time * 1.7) * 0.03;
    r.head.rot[2] = Math.sin(this.time * 1.1) * 0.04 * (1 - mb);
    if (r.earL && r.earR) {
      r.earL.rot[0] = -0.12 - mb * 0.45 + Math.sin(this.time * 3) * 0.05 - bob * 2;
      r.earR.rot[0] = -0.5 - mb * 0.35 + Math.sin(this.time * 3 + 1) * 0.07 - bob * 2;
    }
    // blink
    this.blinkT -= dt;
    let eyeS = 1;
    if (this.blinkT < 0.12) eyeS = 0.15;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    if (this.shakeT > 0) eyeS = 0.3;
    r.eyes.scale[1] = lerp(r.eyes.scale[1], eyeS, damp(40, dt));

    // ring pulses slightly, bump flash
    const ringS = 1 + Math.sin(this.time * 4) * 0.02 + this.bump * 0.15;
    r.ring.scale = [ringS, 1, ringS];

    // dust when running / turning hard
    this.dustT -= dt;
    if (speed > P.speed * 0.6 && this.dustT <= 0) {
      this.dustT = 0.12;
      fx.emit({ pos: [this.pos[0] - this.vel[0] * 0.05, 0.06, this.pos[2] - this.vel[1] * 0.05], count: 2, color: [0.95, 0.9, 0.85], speed: 0.4, up: 0.4, size: 0.16, sizeEnd: 0.32, life: 0.45, drag: 3, alpha: 0.65 });
    }
    if (this.lastSpeed < 0.5 && speed > 2.2) {
      fx.emit({ pos: [this.pos[0], 0.05, this.pos[2]], count: 5, color: [0.96, 0.92, 0.86], speed: 1.2, up: 0.3, size: 0.14, sizeEnd: 0.3, life: 0.4, drag: 4, alpha: 0.7 });
    }
    this.lastSpeed = speed;
    void SHAPE;
    this.sync();
  }

  private pushOut(b: AABB): void {
    const r = this.radius;
    const cx = clamp(this.pos[0], b.minX, b.maxX);
    const cz = clamp(this.pos[2], b.minZ, b.maxZ);
    const dx = this.pos[0] - cx, dz = this.pos[2] - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      this.pos[0] += (dx / d) * (r - d);
      this.pos[2] += (dz / d) * (r - d);
      // kill velocity into the wall
      const nx = dx / d, nz = dz / d;
      const vn = this.vel[0] * nx + this.vel[1] * nz;
      if (vn < 0) { this.vel[0] -= vn * nx; this.vel[1] -= vn * nz; }
    } else {
      // centre inside the box: push out along the shallowest axis
      const l = this.pos[0] - b.minX, rr = b.maxX - this.pos[0], t = this.pos[2] - b.minZ, bb = b.maxZ - this.pos[2];
      const m = Math.min(l, rr, t, bb);
      if (m === l) this.pos[0] = b.minX - r; else if (m === rr) this.pos[0] = b.maxX + r;
      else if (m === t) this.pos[2] = b.minZ - r; else this.pos[2] = b.maxZ + r;
    }
  }

  sync(): void {
    this.rig.root.pos = [this.pos[0], 0, this.pos[2]];
    this.rig.root.rot[1] = this.yaw;
    this.rig.root.setScale(this.scale);
  }
}
