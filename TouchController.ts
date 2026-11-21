// Independent two-player multi-touch input on one screen.
// Left half = player 1, right half = player 2. Each half has a floating joystick
// (appears under the finger) and a big action button. Every pointer is tracked by
// pointerId from the moment it lands, so fingers never steal each other's controls,
// even if they drift across the middle. Keyboard fallback for desktop testing.

export interface PlayerInput {
  /** joystick vector, x = right, y = down the screen (towards camera); length 0..1 */
  mx: number;
  my: number;
  /** queued action presses (edge triggered) */
  presses: number;
  held: boolean;
}

interface Track {
  player: 0 | 1;
  kind: 'stick' | 'btn';
  ox: number;
  oy: number;
}

const KEYS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], act: ['Space', 'KeyF', 'KeyE'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], act: ['Enter', 'NumpadEnter', 'Slash', 'ShiftRight', 'KeyL', 'Numpad0'] },
];

export class TouchController {
  readonly inputs: [PlayerInput, PlayerInput] = [
    { mx: 0, my: 0, presses: 0, held: false },
    { mx: 0, my: 0, presses: 0, held: false },
  ];
  enabled = false;
  /** callback fired on every accepted press (for instant feedback) */
  onPress: ((player: 0 | 1) => void) | null = null;

  private layer: HTMLElement;
  private tracks = new Map<number, Track>();
  private stick: { base: HTMLElement; knob: HTMLElement; restX: number; restY: number }[] = [];
  private btn: HTMLElement[] = [];
  private btnLabel: HTMLElement[] = [];
  private btnIcon: HTMLImageElement[] = [];
  private keys = new Set<string>();
  private radius = 62;
  private lastLabel = ['', ''];

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.id = 'controls';
    parent.appendChild(this.layer);
    for (let p = 0; p < 2; p++) {
      const zone = document.createElement('div');
      zone.className = `zone zone-p${p + 1}`;
      this.layer.appendChild(zone);
      const base = document.createElement('div');
      base.className = `stick stick-p${p + 1}`;
      const knob = document.createElement('div');
      knob.className = 'knob';
      base.appendChild(knob);
      this.layer.appendChild(base);
      this.stick.push({ base, knob, restX: 0, restY: 0 });
      const b = document.createElement('div');
      b.className = `act act-p${p + 1}`;
      const icon = document.createElement('img');
      icon.alt = '';
      icon.className = 'act-icon';
      const lab = document.createElement('span');
      lab.className = 'act-label';
      lab.textContent = 'Взять';
      b.append(icon, lab);
      this.layer.appendChild(b);
      this.btn.push(b);
      this.btnLabel.push(lab);
      this.btnIcon.push(icon);
      const tag = document.createElement('div');
      tag.className = `ptag ptag-p${p + 1}`;
      tag.innerHTML = p === 0 ? '<b>1</b> Бриошь' : '<b>2</b> Зефирка';
      this.layer.appendChild(tag);
    }
    const opts = { passive: false } as AddEventListenerOptions;
    this.layer.addEventListener('pointerdown', (e) => this.down(e), opts);
    this.layer.addEventListener('pointermove', (e) => this.move(e), opts);
    this.layer.addEventListener('pointerup', (e) => this.up(e), opts);
    this.layer.addEventListener('pointercancel', (e) => this.up(e), opts);
    this.layer.addEventListener('lostpointercapture', (e) => this.up(e));
    // block iOS gestures (scroll, double-tap zoom, magnifier)
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'contextmenu']) {
      this.layer.addEventListener(ev, (e) => e.preventDefault(), opts);
    }
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    this.layout();
  }

  /** Recompute resting joystick positions after resize. */
  layout(): void {
    const w = this.layer.clientWidth || window.innerWidth, h = this.layer.clientHeight || window.innerHeight;
    const s = Math.min(1.15, Math.max(0.8, Math.min(w, h) / 760));
    this.radius = 62 * s;
    for (let p = 0; p < 2; p++) {
      const st = this.stick[p];
      st.restX = (p === 0 ? 0 : w / 2) + 120 * s;
      st.restY = h - 120 * s;
      if (!this.activeStick(p as 0 | 1)) this.placeStick(p as 0 | 1, st.restX, st.restY, false);
    }
    this.layer.style.setProperty('--ui-s', String(s));
  }

  private activeStick(p: 0 | 1): boolean {
    for (const t of this.tracks.values()) if (t.player === p && t.kind === 'stick') return true;
    return false;
  }

  private placeStick(p: 0 | 1, x: number, y: number, active: boolean) {
    const st = this.stick[p];
    st.base.style.transform = `translate(${x}px, ${y}px)`;
    st.base.classList.toggle('active', active);
    st.knob.style.transform = 'translate(0px, 0px)';
  }

  private hitButton(p: 0 | 1, x: number, y: number): boolean {
    const r = this.btn[p].getBoundingClientRect();
    const pad = 22;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (!this.enabled) return;
    const rect = this.layer.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const p: 0 | 1 = x < rect.width / 2 ? 0 : 1;
    try { this.layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.hitButton(p, e.clientX, e.clientY)) {
      this.tracks.set(e.pointerId, { player: p, kind: 'btn', ox: x, oy: y });
      this.press(p);
      return;
    }
    if (this.activeStick(p)) {
      // a second finger in the same half: treat as an action tap (generous for kids)
      this.tracks.set(e.pointerId, { player: p, kind: 'btn', ox: x, oy: y });
      this.press(p);
      return;
    }
    const half = rect.width / 2;
    const m = this.radius + 12;
    const cx = Math.min(Math.max(x, p * half + m), (p + 1) * half - m);
    const cy = Math.min(Math.max(y, rect.height * 0.3), rect.height - m);
    this.tracks.set(e.pointerId, { player: p, kind: 'stick', ox: cx, oy: cy });
    this.placeStick(p, cx, cy, true);
    this.moveStick(p, x - cx, y - cy);
  }

  private press(p: 0 | 1) {
    const inp = this.inputs[p];
    inp.presses++;
    inp.held = true;
    this.btn[p].classList.add('down');
    this.onPress?.(p);
  }

  private moveStick(p: 0 | 1, dx: number, dy: number) {
    const R = this.radius;
    const len = Math.hypot(dx, dy);
    const k = len > R ? R / len : 1;
    this.stick[p].knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    let nx = dx / R, ny = dy / R;
    const l = Math.hypot(nx, ny);
    const dead = 0.14;
    if (l < dead) { nx = 0; ny = 0; } else {
      const m = Math.min(1, (l - dead) / (1 - dead)) / l;
      nx *= m; ny *= m;
    }
    this.inputs[p].mx = nx;
    this.inputs[p].my = ny;
  }

  private move(e: PointerEvent): void {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    if (t.kind !== 'stick') return;
    const rect = this.layer.getBoundingClientRect();
    this.moveStick(t.player, e.clientX - rect.left - t.ox, e.clientY - rect.top - t.oy);
  }

  private up(e: PointerEvent): void {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    this.tracks.delete(e.pointerId);
    if (t.kind === 'stick') {
      this.inputs[t.player].mx = 0;
      this.inputs[t.player].my = 0;
      const st = this.stick[t.player];
      this.placeStick(t.player, st.restX, st.restY, false);
    } else {
      let still = false;
      for (const o of this.tracks.values()) if (o.player === t.player && o.kind === 'btn') still = true;
      if (!still) {
        this.inputs[t.player].held = false;
        this.btn[t.player].classList.remove('down');
      }
    }
  }

  private key(e: KeyboardEvent, down: boolean): void {
    let used = false;
    for (let p = 0; p < 2; p++) {
      const k = KEYS[p];
      if (k.act.includes(e.code)) {
        used = true;
        if (down && !e.repeat && this.enabled) this.press(p as 0 | 1);
        if (!down) { this.inputs[p].held = false; this.btn[p].classList.remove('down'); }
      }
      if ([...k.up, ...k.down, ...k.left, ...k.right].includes(e.code)) used = true;
    }
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (used && (e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault();
  }

  /** Merge keyboard into the per-frame input. */
  poll(): void {
    for (let p = 0; p < 2; p++) {
      if (this.activeStick(p as 0 | 1)) continue;
      const k = KEYS[p];
      const any = (c: string[]) => c.some((x) => this.keys.has(x));
      let x = (any(k.right) ? 1 : 0) - (any(k.left) ? 1 : 0);
      let y = (any(k.down) ? 1 : 0) - (any(k.up) ? 1 : 0);
      if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      this.inputs[p].mx = this.enabled ? x : 0;
      this.inputs[p].my = this.enabled ? y : 0;
    }
  }

  consumePress(p: 0 | 1): boolean {
    const inp = this.inputs[p];
    if (inp.presses > 0) { inp.presses = 0; return true; }
    return false;
  }

  setAction(p: 0 | 1, label: string, icon: string | null, valid: boolean): void {
    const key = label + '|' + (icon ?? '') + valid;
    if (this.lastLabel[p] === key) return;
    this.lastLabel[p] = key;
    this.btnLabel[p].textContent = label;
    if (icon) { this.btnIcon[p].src = icon; this.btnIcon[p].style.display = ''; } else this.btnIcon[p].style.display = 'none';
    this.btn[p].classList.toggle('idle', !valid);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.layer.classList.toggle('off', !on);
    if (!on) this.reset();
  }

  /** Release everything (focus loss, pause, orientation change). */
  reset(): void {
    for (const id of [...this.tracks.keys()]) {
      try { this.layer.releasePointerCapture(id); } catch { /* ignore */ }
    }
    this.tracks.clear();
    this.keys.clear();
    for (let p = 0; p < 2; p++) {
      const inp = this.inputs[p];
      inp.mx = inp.my = 0;
      inp.held = false;
      inp.presses = 0;
      this.btn[p].classList.remove('down');
      const st = this.stick[p];
      this.placeStick(p as 0 | 1, st.restX, st.restY, false);
    }
  }

  /** Test hook: number of live touch tracks. */
  get activeTouches(): number { return this.tracks.size; }
}
