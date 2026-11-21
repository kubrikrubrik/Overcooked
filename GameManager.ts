// Owns the game loop and wires every system together.
import { CONFIG, ToppingId } from './config';
import { Renderer } from './renderer';
import { Node } from './scene';
import { Particles, SHAPE } from './particles';
import { RGB, Vec3, hex, damp, lerp } from './math';
import { buildKitchenArt, KitchenVisuals } from './kitchenArt';
import { buildCharacter } from './characters';
import { buildFoodMeshes } from './food';
import { renderDishIcons, renderPortraits } from './dishIcons';
import { PAL } from './palette';
import { iconURL } from './icons';
import { CameraController } from './CameraController';
import { TouchController } from './TouchController';
import { KitchenManager, Station } from './KitchenManager';
import { ItemManager, Croissant, Plate, Item } from './ItemManager';
import { Player } from './PlayerController';
import { InteractionManager, InteractionEvents } from './InteractionManager';
import { RecipeManager, identify } from './RecipeManager';
import { OrderManager, Order } from './OrderManager';
import { ScoreManager } from './ScoreManager';
import { UIManager } from './UIManager';
import { AudioManager } from './AudioManager';
import { OvenController } from './OvenController';
import { SPAWN, COUNTER_H } from './layout';

type State = 'menu' | 'countdown' | 'playing' | 'paused' | 'results';

const TOPPING_FX: Record<ToppingId, RGB[]> = {
  cinnamon: [hex('#b8692e'), hex('#e0a060'), hex('#fff7ea')],
  chocolate: [hex('#5a2b18'), hex('#7a3d22')],
  sprinkles: PAL.sprinkles,
  jam: [hex('#d01f3c'), hex('#ff4d63')],
};

export class GameManager implements InteractionEvents {
  renderer: Renderer;
  camera = new CameraController();
  scene = new Node('scene');
  fx = new Particles(900);
  level: KitchenVisuals;
  kitchen: KitchenManager;
  items: ItemManager;
  players: Player[];
  input: TouchController;
  interaction: InteractionManager;
  recipes = new RecipeManager();
  orders: OrderManager;
  score = new ScoreManager();
  ui: UIManager;
  audio = new AudioManager();

  state: State = 'menu';
  elapsed = 0;
  remaining = CONFIG.shiftSeconds;
  private countdownT = 0;
  private lastCount = -1;
  private lastTick = -1;
  private last = performance.now();
  private frameTimes: number[] = [];
  private qualityStep = 0;
  private time = 0;
  private customerHop: number[] = [];
  private bellWobble = 0;
  private smokeT = 0;
  private canvas: HTMLCanvasElement;
  private app: HTMLElement;
  /** test hook: run simulation without rendering */
  headlessSteps = 0;

  constructor(app: HTMLElement) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gl';
    app.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);
    this.renderer.setLights({
      sunDir: [-0.5, 1.0, 0.3],
      sunColor: hex('#fff1dc').map((v) => v * 0.85) as RGB,
      sky: [0.42, 0.44, 0.56],
      ground: [0.36, 0.29, 0.27],
      shadowTint: [0.74, 0.68, 1.08],
      shadowCenter: [0, 0, 0.5],
      shadowExtent: 11.5,
    });
    this.renderer.clearColor = hex('#7f8fb3');

    this.level = buildKitchenArt(this.renderer);
    this.scene.add(this.level.root);
    const fm = buildFoodMeshes(this.renderer);
    const itemRoot = new Node('items');
    this.scene.add(itemRoot);
    this.items = new ItemManager(fm, itemRoot);

    this.kitchen = new KitchenManager(this.renderer, this.level, this.scene, {
      onReady: (o) => this.ovenReady(o),
      onBurn: (o) => this.ovenBurn(o),
      onWarnTick: () => this.audio.play('warn'),
    });

    const bear = buildCharacter(this.renderer, 'bear', PAL.p1);
    const bunny = buildCharacter(this.renderer, 'bunny', PAL.p2);
    this.scene.add(bear.root, bunny.root);
    this.players = [new Player(0, bear, SPAWN.p1), new Player(1, bunny, SPAWN.p2)];

    this.input = new TouchController(app);
    this.input.onPress = () => this.audio.play('click');
    this.interaction = new InteractionManager(this.kitchen, this.items, this.players, this);
    this.orders = new OrderManager(this.recipes, {
      added: (o) => { this.ui.addOrder(o); this.audio.play('order'); },
      expired: (o) => this.orderExpired(o),
    });

    this.ui = new UIManager(app, {
      start: () => this.startShift(),
      resume: () => this.resume(),
      restart: () => this.startShift(),
      menu: () => this.toMenu(),
      pause: () => this.pause(),
      toggleMusic: () => { this.audio.unlock(); this.audio.setMusic(!this.audio.musicOn); return this.audio.musicOn; },
      toggleSfx: () => { this.audio.unlock(); this.audio.setSfx(!this.audio.sfxOn); return this.audio.sfxOn; },
    });
    this.ui.setSoundState('music', this.audio.musicOn);
    this.ui.setSoundState('sfx', this.audio.sfxOn);
    this.ui.setDishIcons(renderDishIcons(this.renderer, fm), renderPortraits(this.renderer));
    this.ui.setupWorld(this.kitchen.ovens, [this.kitchen.storage.x - 0.75, 0.75, this.kitchen.storage.z + 0.5]);
    this.customerHop = this.level.customers.map(() => 0);

    this.kitchen.reset();
    this.input.setEnabled(false);
    this.ui.show('start');

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.autoPause(); this.audio.suspend(); } else this.audio.resume();
    });
    window.addEventListener('blur', () => this.autoPause());
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost(); });
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ flow
  startShift(): void {
    this.audio.unlock();
    this.audio.startMusic();
    this.items.clear();
    this.kitchen.reset();
    for (const p of this.players) p.respawn(p.id === 0 ? SPAWN.p1 : SPAWN.p2);
    this.orders.reset();
    this.score.reset();
    this.ui.clearOrders();
    this.ui.clearFloaters();
    this.fx.clear();
    this.elapsed = 0;
    this.remaining = CONFIG.shiftSeconds;
    this.audio.tempo = 112;
    this.countdownT = CONFIG.countdownSeconds + 0.6;
    this.lastCount = -1;
    this.lastTick = -1;
    this.state = 'countdown';
    this.ui.show(null);
    this.input.setEnabled(true);
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.ui.show('pause');
  }

  private autoPause(): void {
    this.input.reset();
    if (this.state === 'playing' || this.state === 'countdown') this.pause();
  }

  resume(): void {
    this.audio.unlock();
    this.state = this.countdownT > 0 ? 'countdown' : 'playing';
    this.ui.show(null);
    this.input.setEnabled(true);
    this.last = performance.now();
  }

  toMenu(): void {
    this.state = 'menu';
    this.items.clear();
    this.kitchen.reset();
    this.ui.clearOrders();
    this.ui.clearFloaters();
    for (const p of this.players) p.respawn(p.id === 0 ? SPAWN.p1 : SPAWN.p2);
    this.input.setEnabled(false);
    this.ui.show('start');
  }

  private endShift(): void {
    this.state = 'results';
    this.input.setEnabled(false);
    this.audio.play('whistle');
    this.audio.tempo = 100;
    setTimeout(() => this.audio.play('fanfare'), 600);
    this.ui.countdown('Смена окончена!');
    setTimeout(() => {
      this.ui.countdown(null);
      this.ui.showResults(this.score, () => this.audio.play('star'));
    }, 1500);
  }

  private contextLost(): void {
    const d = document.createElement('div');
    d.className = 'fatal';
    d.innerHTML = '<b>Графика перезапускается…</b><span>Устройство освободило видеопамять. Обновите страницу.</span><button onclick="location.reload()">Обновить</button>';
    this.app.appendChild(d);
  }

  resize(): void {
    const w = this.app.clientWidth || window.innerWidth;
    const h = this.app.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    const portrait = h > w;
    this.app.classList.toggle('portrait', portrait);
    this.camera.fit(w, h, Math.max(92, h * 0.16), h * 0.1, w * 0.015);
    this.input.layout();
    if (portrait) this.autoPause();
  }

  // ------------------------------------------------------------------ loop
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 0.001;
    this.adaptQuality(dt);
    // fixed-ish substeps keep game time real even on slow frames
    const n = Math.ceil(dt / (1 / 30));
    for (let i = 0; i < n; i++) this.step(dt / n);
    this.updateUI(dt);
    this.draw();
  }

  /** Advance the simulation by dt seconds (also used by automated tests). */
  step(dt: number): void {
    this.time += dt;
    this.input.poll();
    const running = this.state === 'playing';
    const canMove = this.state === 'playing';

    if (this.state === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT - 0.6);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) { this.ui.countdown(String(n)); this.audio.play('count'); }
        else { this.ui.countdown('Готовим!'); this.audio.play('go'); }
      }
      if (this.countdownT <= 0) {
        this.state = 'playing';
        setTimeout(() => { if (this.state === 'playing') this.ui.countdown(null); }, 400);
      }
    }

    for (const p of this.players) {
      const inp = this.input.inputs[p.id];
      if (running && this.input.consumePress(p.id)) {
        const a = this.interaction.act(p);
        if (a.valid) p.interactAnim();
      } else if (!running) inp.presses = 0;
    }
    this.players[0].update(dt, this.input.inputs[0], this.kitchen.colliders, this.players[1], this.fx, canMove);
    this.players[1].update(dt, this.input.inputs[1], this.kitchen.colliders, this.players[0], this.fx, canMove);

    // context labels + highlights
    for (const p of this.players) {
      const a = this.interaction.resolve(p);
      this.input.setAction(p.id, a.label, a.icon ? iconURL(a.icon) : null, a.valid);
    }
    this.kitchen.setHighlights(this.state === 'menu' ? [null, null] : this.interaction.targets);

    if (this.kitchen.update(dt, running)) this.audio.play('restock');
    this.items.update(dt);

    if (running) {
      this.elapsed += dt;
      this.remaining -= dt;
      this.orders.update(dt, this.elapsed, this.remaining);
      const sec = Math.ceil(this.remaining);
      if (this.remaining <= 10 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; this.audio.play('tick'); }
      if (this.remaining <= 30) this.audio.tempo = 128;
      if (this.remaining <= 0) { this.remaining = 0; this.endShift(); }
    }

    this.ambient(dt);
    const mid: Vec3 = [(this.players[0].pos[0] + this.players[1].pos[0]) / 2, 0, (this.players[0].pos[2] + this.players[1].pos[2]) / 2];
    this.camera.update(dt, this.state === 'menu' ? null : mid);
    this.fx.update(dt);
  }

  private updateUI(dt: number): void {
    const w = this.app.clientWidth || window.innerWidth, h = this.app.clientHeight || window.innerHeight;
    this.ui.update(dt, (p) => this.camera.toScreen(p, w, h), this.score, this.remaining, this.kitchen.stock);
  }

  private draw(): void {
    this.renderer.pointLights = this.kitchen.ovens.map((o) => o.light);
    this.renderer.render(this.scene, this.camera, this.fx);
  }

  private ambient(dt: number): void {
    // oven smoke / heat shimmer
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12;
      for (const o of this.kitchen.ovens) {
        const ph = o.phase;
        const top: Vec3 = [o.vis.x, 1.05, o.vis.z + 0.15];
        if (ph === 'burnt') this.fx.emit({ pos: top, count: 2, color: [[0.25, 0.22, 0.24], [0.4, 0.38, 0.4]], speed: 0.3, up: 1.2, size: 0.35, sizeEnd: 0.9, life: 1.6, drag: 0.8, alpha: 0.75 });
        else if (ph === 'warning') this.fx.emit({ pos: top, count: 1, color: [0.75, 0.72, 0.72], speed: 0.2, up: 1.0, size: 0.25, sizeEnd: 0.6, life: 1.1, drag: 1, alpha: 0.55 });
        else if (ph === 'baking' && Math.random() < 0.3) this.fx.emit({ pos: top, count: 1, color: [1, 0.95, 0.9], speed: 0.1, up: 0.7, size: 0.18, sizeEnd: 0.4, life: 0.9, drag: 1, alpha: 0.3 });
      }
      for (const p of this.players) {
        const it = p.item;
        const c = it ? (it.kind === 'croissant' ? it : it.content) : null;
        if (c && c.state === 'burnt' && Math.random() < 0.5) {
          const a = p.anchor();
          this.fx.emit({ pos: [a.pos[0], a.pos[1] + 0.15, a.pos[2]], count: 1, color: [0.3, 0.27, 0.3], speed: 0.1, up: 0.8, size: 0.2, sizeEnd: 0.5, life: 1, drag: 1, alpha: 0.6 });
        }
      }
    }
    // customers idle & celebrate
    this.level.customers.forEach((c, i) => {
      this.customerHop[i] = Math.max(0, this.customerHop[i] - dt * 2);
      const hop = Math.sin(this.customerHop[i] * Math.PI) * 0.4;
      c.body.pos[1] = Math.abs(Math.sin(this.time * 2 + i * 1.3)) * 0.02 + hop;
      c.head.rot[2] = Math.sin(this.time * 1.4 + i) * 0.08;
      c.head.rot[0] = this.customerHop[i] > 0 ? -0.3 : Math.sin(this.time * 0.9 + i * 2) * 0.05;
    });
    this.bellWobble = Math.max(0, this.bellWobble - dt * 2.5);
    this.level.bell.rot[2] = Math.sin(this.bellWobble * 30) * this.bellWobble * 0.4;
    // twinkle string lights
    const tw = 0.85 + Math.sin(this.time * 2.1) * 0.15;
    this.level.stringLights.mesh!.mat.tint = [tw, tw, tw];
    void damp; void lerp;
  }

  private adaptQuality(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 45 && this.qualityStep < 4) {
      this.qualityStep++;
      const r = this.renderer;
      if (this.qualityStep === 1) r.maxPixelRatio = 1.5;
      else if (this.qualityStep === 2) r.maxPixelRatio = 1.25;
      else if (this.qualityStep === 3) r.createShadowMap(1024);
      else r.maxPixelRatio = 1;
      this.resize();
    }
  }

  // ------------------------------------------------------------------ events
  private itemPos(st: Station | null, p: Player): Vec3 {
    return st ? [st.x, COUNTER_H + 0.3, st.z] : p.anchor().pos;
  }

  picked(p: Player, item: Item): void {
    p.pickupAnim();
    this.audio.play('pick');
    const a = p.anchor().pos;
    this.fx.emit({ pos: [a[0], a[1] + 0.1, a[2]], count: 5, color: [1, 1, 1], speed: 1.2, up: 0.6, size: 0.08, life: 0.35, shape: SHAPE.STAR, additive: 1, alpha: 0.9 });
    void item;
  }

  placed(p: Player, _item: Item, st: Station): void {
    this.audio.play('place');
    this.fx.emit({ pos: [st.x, COUNTER_H + 0.05, st.z], count: 5, color: [1, 0.97, 0.92], speed: 0.8, up: 0.2, size: 0.12, sizeEnd: 0.25, life: 0.35, drag: 4, alpha: 0.6 });
    void p;
  }

  plated(p: Player, st: Station | null): void {
    this.audio.play('plate');
    const pos = this.itemPos(st, p);
    this.fx.emit({ pos, count: 6, color: [[1, 1, 1], [0.6, 0.85, 1]], speed: 1.3, up: 0.5, size: 0.09, life: 0.4, shape: SHAPE.STAR, additive: 1 });
  }

  ovenIn(p: Player, st: Station): void {
    this.audio.play('oven');
    this.fx.emit({ pos: [st.x, 0.6, st.z + 0.55], count: 6, color: [1, 0.8, 0.5], speed: 0.6, up: 0.8, size: 0.2, sizeEnd: 0.4, life: 0.6, alpha: 0.4 });
    void p;
  }

  ovenOut(p: Player, st: Station, c: Croissant): void {
    this.audio.play('oven');
    if (c.state === 'baked') this.fx.emit({ pos: [st.x, 0.8, st.z + 0.6], count: 8, color: [[1, 0.85, 0.4], [1, 1, 1]], speed: 1.4, up: 0.8, size: 0.1, life: 0.6, shape: SHAPE.STAR, additive: 1 });
    void p;
  }

  topping(p: Player, st: Station, t: ToppingId, c: Croissant): void {
    this.audio.play(t === 'chocolate' ? 'choco' : t === 'jam' ? 'jam' : 'shake');
    const a = p.anchor().pos;
    const cols = TOPPING_FX[t];
    this.fx.emit({ pos: [st.x, COUNTER_H + 0.35, st.z], count: 14, color: cols, speed: 1.6, up: 1.4, size: t === 'sprinkles' || t === 'cinnamon' ? 0.06 : 0.1, life: 0.6, gravity: 5, shape: SHAPE.DOT, dir: [(a[0] - st.x) * 1.2, 0.6, (a[2] - st.z) * 1.2] });
    this.fx.emit({ pos: [a[0], a[1] + 0.12, a[2]], count: 10, color: cols, speed: 0.9, up: 0.5, size: t === 'sprinkles' ? 0.06 : 0.09, life: 0.5, gravity: 4, shape: SHAPE.DOT });
    this.fx.emit({ pos: [a[0], a[1] + 0.2, a[2]], count: 5, color: [1, 1, 0.9], speed: 1, up: 0.6, size: 0.09, life: 0.45, shape: SHAPE.STAR, additive: 1 });
    void c;
  }

  binned(p: Player, st: Station): void {
    this.audio.play('bin');
    this.fx.emit({ pos: [st.x, COUNTER_H + 0.1, st.z], count: 8, color: [0.85, 0.85, 0.82], speed: 0.9, up: 0.9, size: 0.14, sizeEnd: 0.3, life: 0.5, alpha: 0.6 });
    void p;
  }

  handoff(p: Player, other: Player): void {
    this.audio.play('handoff');
    other.pickupAnim();
    p.interactAnim();
    const a = other.anchor().pos;
    this.fx.emit({ pos: a, count: 8, color: [[1, 1, 1], PAL.p1, PAL.p2], speed: 1.2, up: 0.5, size: 0.09, life: 0.45, shape: SHAPE.STAR, additive: 1 });
  }

  stockTaken(): void { /* pick sound comes from picked() */ }
  stockReturned(p: Player): void { this.audio.play('place'); void p; }

  deliver(p: Player, st: Station, plate: Plate): boolean {
    const c = plate.content!;
    const id = identify(c);
    const order = this.orders.match(id);
    const pos: Vec3 = [st.x, 1.3, st.z + 0.5];
    if (!order) {
      const pen = this.score.wrong();
      this.ui.shakeOrders();
      const msg = c.state === 'raw' ? 'Он же сырой!' : c.state === 'burnt' ? 'Сгоревший не возьмут!' : c.toppings.length === 0 ? 'Нужен топинг!' : 'Такого заказа нет!';
      this.ui.bubble(p.anchor().pos, msg, 'err');
      this.ui.floatText(pos, `−${pen}`, 'minus');
      this.audio.play('error');
      p.bonk();
      this.camera.addShake(0.08);
      return false;
    }
    const res = this.score.deliver(order);
    this.orders.serve(order);
    this.ui.removeOrder(order, 'served');
    this.ui.floatText(pos, `+${res.base}`, 'plus');
    if (res.tip > 0) setTimeout(() => this.ui.floatText([pos[0], pos[1] + 0.35, pos[2]], `чаевые +${res.tip}`, 'tip'), 250);
    this.audio.play('deliver');
    this.bellWobble = 1;
    p.celebrate();
    const i = Math.floor(Math.random() * Math.min(3, this.customerHop.length));
    this.customerHop[0] = 1;
    this.customerHop[i] = 1;
    this.fx.emit({ pos: [st.x + 0.3, 1.0, st.z + 0.5], count: 18, color: [[1, 0.84, 0.25], [1, 0.95, 0.6]], speed: 2.4, up: 2.2, size: 0.13, life: 0.9, gravity: 5, shape: SHAPE.DOT });
    this.fx.emit({ pos: [st.x, 1.0, st.z + 0.5], count: 10, color: [[1, 1, 1], [1, 0.9, 0.5]], speed: 1.8, up: 1, size: 0.12, life: 0.6, shape: SHAPE.STAR, additive: 1 });
    return true;
  }

  error(p: Player, msg: string): void {
    this.audio.play('error');
    this.ui.bubble(p.anchor().pos, msg, 'err');
    p.bonk();
  }

  private orderExpired(o: Order): void {
    const pen = this.score.expire();
    this.ui.removeOrder(o, 'expired');
    const d = this.kitchen.stations.find((s) => s.kind === 'delivery')!;
    this.ui.floatText([d.x, 1.5, d.z + 0.5], `−${pen}`, 'minus');
    this.audio.play('expire');
  }

  private ovenReady(o: OvenController): void {
    this.audio.play('ready');
    this.fx.emit({ pos: [o.vis.x, 0.9, o.vis.z + 0.6], count: 12, color: [[1, 0.85, 0.35], [1, 1, 1]], speed: 1.6, up: 1.2, size: 0.12, life: 0.8, shape: SHAPE.STAR, additive: 1 });
  }

  private ovenBurn(o: OvenController): void {
    const pen = this.score.burn();
    this.audio.play('burn');
    this.camera.addShake(0.1);
    this.ui.floatText([o.vis.x, 1.5, o.vis.z + 0.4], `сгорел −${pen}`, 'minus');
    this.fx.emit({ pos: [o.vis.x, 0.8, o.vis.z + 0.5], count: 16, color: [[0.2, 0.18, 0.2], [0.35, 0.32, 0.34]], speed: 1.2, up: 1.5, size: 0.4, sizeEnd: 1, life: 1.4, drag: 1.2, alpha: 0.8 });
  }
}

