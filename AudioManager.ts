// All sound is synthesised with the Web Audio API at runtime: original SFX and an original
// bouncy café-style music loop. No audio files, nothing borrowed.

export type Sfx =
  | 'pick' | 'place' | 'oven' | 'ready' | 'warn' | 'burn' | 'choco' | 'jam' | 'shake' | 'plate'
  | 'deliver' | 'error' | 'bin' | 'order' | 'expire' | 'tick' | 'count' | 'go' | 'star' | 'restock'
  | 'handoff' | 'bump' | 'fanfare' | 'whistle' | 'click';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// 8 bars × 8 eighths, MIDI notes (0 = rest)
const MELODY = [
  [72, 0, 69, 72, 77, 0, 76, 74], [74, 0, 69, 0, 65, 67, 69, 0],
  [70, 0, 74, 70, 77, 0, 74, 72], [72, 0, 67, 0, 64, 65, 67, 0],
  [72, 0, 69, 72, 77, 0, 79, 77], [76, 0, 72, 0, 69, 0, 72, 76],
  [74, 72, 70, 0, 72, 74, 76, 0], [77, 0, 72, 0, 65, 0, 0, 0],
];
// chord roots + triad (MIDI) per bar
const CHORDS: [number, number[]][] = [
  [41, [65, 69, 72]], [38, [62, 65, 69]], [46, [65, 70, 74]], [36, [64, 67, 72]],
  [41, [65, 69, 72]], [45, [64, 69, 72]], [46, [65, 70, 74]], [41, [65, 69, 72]],
];

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  musicOn = true;
  sfxOn = true;
  private musicTimer: number | null = null;
  private step = 0;
  private nextTime = 0;
  tempo = 112;
  private lastPlay = new Map<string, number>();

  constructor() {
    try {
      const m = localStorage.getItem('sr_music');
      const s = localStorage.getItem('sr_sfx');
      if (m !== null) this.musicOn = m === '1';
      if (s !== null) this.sfxOn = s === '1';
    } catch { /* storage may be unavailable */ }
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.8;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
      this.sfxBus.connect(this.master);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
      this.musicBus.connect(this.master);
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }

  setMusic(on: boolean): void {
    this.musicOn = on;
    try { localStorage.setItem('sr_music', on ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.05);
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    try { localStorage.setItem('sr_sfx', on ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ primitives
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, opts: { to?: number; at?: number; attack?: number; bus?: AudioNode; lp?: number } = {}) {
    const c = this.ctx!;
    const t = opts.at ?? c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    const g = c.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, type: BiquadFilterType, freq: number, opts: { at?: number; to?: number; q?: number; bus?: AudioNode } = {}) {
    const c = this.ctx!;
    const t = opts.at ?? c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(opts.bus ?? this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name: Sfx): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.035) return;
    this.lastPlay.set(name, now);
    const t = now;
    switch (name) {
      case 'pick': this.tone(520, 0.12, 'sine', 0.28, { to: 980 }); break;
      case 'place': this.tone(240, 0.1, 'triangle', 0.3, { to: 130 }); this.noise(0.05, 0.12, 'lowpass', 900); break;
      case 'click': this.tone(1200, 0.04, 'square', 0.06, { lp: 3000 }); break;
      case 'oven':
        this.noise(0.32, 0.22, 'bandpass', 300, { to: 1600, q: 1.2 });
        this.tone(110, 0.14, 'triangle', 0.3, { at: t + 0.18, to: 70 });
        break;
      case 'ready':
        this.tone(1318, 0.9, 'sine', 0.22, { attack: 0.002 });
        this.tone(1760, 0.7, 'sine', 0.12, { at: t + 0.06, attack: 0.002 });
        this.tone(2637, 0.4, 'sine', 0.05, { attack: 0.002 });
        break;
      case 'warn': this.tone(880, 0.08, 'square', 0.08, { lp: 2500 }); break;
      case 'burn':
        this.noise(0.9, 0.22, 'highpass', 2500);
        this.tone(90, 0.35, 'sawtooth', 0.15, { to: 50, lp: 400 });
        break;
      case 'choco': case 'jam':
        this.noise(0.2, 0.25, 'lowpass', 1200, { to: 300 });
        this.tone(name === 'jam' ? 380 : 300, 0.18, 'sine', 0.22, { to: 120 });
        break;
      case 'shake':
        for (let i = 0; i < 4; i++) this.noise(0.05, 0.16, 'highpass', 4000, { at: t + i * 0.07 });
        break;
      case 'plate':
        this.tone(2300, 0.22, 'sine', 0.14, { attack: 0.001 });
        this.tone(3450, 0.15, 'sine', 0.07, { attack: 0.001 });
        break;
      case 'deliver':
        this.tone(1046, 0.08, 'square', 0.12, { lp: 4000 });
        this.tone(1568, 0.1, 'square', 0.12, { at: t + 0.08, lp: 4000 });
        this.tone(2093, 0.7, 'sine', 0.2, { at: t + 0.16, attack: 0.002 });
        this.noise(0.12, 0.1, 'highpass', 6000, { at: t + 0.16 });
        break;
      case 'error':
        this.tone(196, 0.18, 'sawtooth', 0.14, { lp: 900 });
        this.tone(147, 0.22, 'sawtooth', 0.14, { at: t + 0.12, lp: 900 });
        break;
      case 'bin': this.noise(0.25, 0.2, 'bandpass', 1800, { to: 300 }); this.tone(130, 0.18, 'triangle', 0.25, { at: t + 0.12, to: 70 }); break;
      case 'order': this.tone(784, 0.25, 'triangle', 0.16); this.tone(1046, 0.4, 'triangle', 0.16, { at: t + 0.12 }); break;
      case 'expire': this.tone(330, 0.3, 'sawtooth', 0.12, { to: 250, lp: 1200 }); this.tone(247, 0.55, 'sawtooth', 0.12, { at: t + 0.28, to: 180, lp: 1200 }); break;
      case 'tick': this.tone(1500, 0.05, 'square', 0.05, { lp: 3000 }); break;
      case 'count': this.tone(660, 0.18, 'square', 0.1, { lp: 2500 }); break;
      case 'go': this.tone(1320, 0.5, 'square', 0.12, { lp: 3000 }); this.tone(1980, 0.5, 'sine', 0.08); break;
      case 'star': [0, 4, 7, 12].forEach((n, i) => this.tone(mtof(84 + n), 0.3, 'sine', 0.12, { at: t + i * 0.05 })); break;
      case 'restock': this.tone(400, 0.08, 'sine', 0.1, { to: 600 }); break;
      case 'handoff': this.noise(0.15, 0.15, 'bandpass', 800, { to: 3000, q: 2 }); this.tone(700, 0.12, 'sine', 0.15, { to: 1100 }); break;
      case 'bump': this.tone(180, 0.15, 'sine', 0.2, { to: 320 }); break;
      case 'whistle': this.tone(1568, 0.25, 'sine', 0.15, { to: 2093 }); this.tone(2093, 0.4, 'sine', 0.12, { at: t + 0.25, to: 1568 }); break;
      case 'fanfare':
        [60, 64, 67, 72, 67, 72, 76].forEach((n, i) => this.tone(mtof(n + 12), i === 6 ? 0.8 : 0.18, 'square', 0.08, { at: t + i * 0.12, lp: 3000 }));
        break;
    }
  }

  // ------------------------------------------------------------------ music
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private schedule(): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    while (this.nextTime < c.currentTime + 0.15) {
      this.note(this.step, this.nextTime);
      const eighth = 60 / this.tempo / 2;
      // swing: long-short eighths
      this.nextTime += this.step % 2 === 0 ? eighth * 1.18 : eighth * 0.82;
      this.step++;
    }
  }

  private note(step: number, t: number): void {
    const bus = this.musicBus;
    const bar = Math.floor(step / 8) % 8;
    const e = step % 8;
    const [root, triad] = CHORDS[bar];
    const beat = 60 / this.tempo;
    // bass: oom-pah
    if (e === 0 || e === 4) this.tone(mtof(root), beat * 0.9, 'triangle', 0.5, { at: t, lp: 700, bus });
    if (e === 2 || e === 6) this.tone(mtof(root + 7), beat * 0.6, 'triangle', 0.34, { at: t, lp: 700, bus });
    // offbeat chord stabs
    if (e % 2 === 1) for (const n of triad) this.tone(mtof(n), 0.16, 'square', 0.035, { at: t, lp: 1800, bus });
    // melody (marimba-ish)
    const m = MELODY[bar][e];
    if (m) {
      this.tone(mtof(m + 12), 0.32, 'sine', 0.2, { at: t, bus, attack: 0.003 });
      this.tone(mtof(m + 24), 0.12, 'sine', 0.05, { at: t, bus, attack: 0.002 });
    }
    // light percussion
    this.noise(0.03, e % 2 ? 0.05 : 0.08, 'highpass', 7000, { at: t, bus });
    if (e === 0 || e === 4) this.tone(110, 0.12, 'sine', 0.35, { at: t, to: 45, bus });
    if (e === 4) this.noise(0.09, 0.09, 'bandpass', 1800, { at: t, bus });
  }
}
