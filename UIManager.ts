// HTML/CSS interface: order cards, coins & timer, world-space indicators (oven bars,
// speech bubbles, floating score), start / pause / results screens, countdown.
import { CONFIG, RecipeId, TOPPINGS } from './config';
import { iconURL, IconId } from './icons';
import { RECIPES, RECIPE_IDS } from './RecipeManager';
import type { Order } from './OrderManager';
import type { OvenController } from './OvenController';
import type { ScoreManager } from './ScoreManager';
import { Vec3 } from './math';

type ToScreen = (p: Vec3) => [number, number, boolean];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export interface UIHandlers {
  start(): void;
  resume(): void;
  restart(): void;
  menu(): void;
  pause(): void;
  toggleMusic(): boolean;
  toggleSfx(): boolean;
}

interface WorldTag { el: HTMLElement; pos: () => Vec3 | null; }
interface Floater { el: HTMLElement; pos: Vec3; t: number; life: number; }

export class UIManager {
  root: HTMLElement;
  private hud: HTMLElement;
  private ordersEl: HTMLElement;
  private scoreEl: HTMLElement;
  private tipEl: HTMLElement;
  private timeEl: HTMLElement;
  private timeBar: HTMLElement;
  private timerBox: HTMLElement;
  private world: HTMLElement;
  private cards = new Map<number, { el: HTMLElement; bar: HTMLElement; order: Order }>();
  private tags: WorldTag[] = [];
  private floaters: Floater[] = [];
  private ovenEls: { wrap: HTMLElement; fill: HTMLElement; icon: HTMLElement; oven: OvenController; pos: Vec3 }[] = [];
  private stockEl: HTMLElement | null = null;
  private screens: Record<string, HTMLElement> = {};
  private countdownEl: HTMLElement;
  private dishIcons: Record<RecipeId, string> = {} as Record<RecipeId, string>;
  private shownScore = 0;
  private musicBtns: HTMLElement[] = [];
  private sfxBtns: HTMLElement[] = [];

  constructor(parent: HTMLElement, private hnd: UIHandlers) {
    this.root = parent;
    this.world = h('div', 'world');
    parent.appendChild(this.world);

    this.hud = h('div', 'hud hidden');
    parent.appendChild(this.hud);
    this.ordersEl = h('div', 'orders');
    this.hud.appendChild(this.ordersEl);

    const stats = h('div', 'stats');
    const coin = h('div', 'plate coinplate');
    coin.innerHTML = `<div class="coin"><span>¢</span></div><div class="plate-body"><b class="score">0</b><small class="tip">Чаевые ×1</small></div>`;
    const timer = h('div', 'plate timerplate');
    timer.innerHTML = `<div class="plate-body"><b class="time">4:00</b><div class="tbar"><i></i></div></div><div class="hourglass"></div>`;
    stats.append(coin, timer);
    this.hud.appendChild(stats);
    this.scoreEl = coin.querySelector('.score')!;
    this.tipEl = coin.querySelector('.tip')!;
    this.timeEl = timer.querySelector('.time')!;
    this.timeBar = timer.querySelector('.tbar i')!;
    this.timerBox = timer;

    const tools = h('div', 'tools');
    const pauseBtn = h('button', 'round', '<span class="pause-ico"></span>');
    pauseBtn.setAttribute('aria-label', 'Пауза');
    pauseBtn.addEventListener('click', () => this.hnd.pause());
    tools.append(this.soundButton('music'), this.soundButton('sfx'), pauseBtn);
    this.hud.appendChild(tools);

    this.countdownEl = h('div', 'countdown');
    parent.appendChild(this.countdownEl);

    this.buildScreens(parent);
    const rot = h('div', 'rotate', '<div class="rotate-card"><div class="phone"></div><b>Поверни планшет горизонтально</b><span>Sweet Rush рассчитан на двоих игроков с одним планшетом в альбомной ориентации.</span></div>');
    parent.appendChild(rot);
  }

  private soundButton(kind: 'music' | 'sfx'): HTMLElement {
    const b = h('button', 'round snd ' + kind, kind === 'music' ? '<span class="note">♪</span>' : '<span class="spk"></span>');
    b.setAttribute('aria-label', kind === 'music' ? 'Музыка' : 'Звуки');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = kind === 'music' ? this.hnd.toggleMusic() : this.hnd.toggleSfx();
      this.setSoundState(kind, on);
    });
    (kind === 'music' ? this.musicBtns : this.sfxBtns).push(b);
    return b;
  }

  setSoundState(kind: 'music' | 'sfx', on: boolean): void {
    for (const b of kind === 'music' ? this.musicBtns : this.sfxBtns) b.classList.toggle('muted', !on);
  }

  setDishIcons(icons: Record<RecipeId, string>, portraits: [string, string]): void {
    this.dishIcons = icons;
    const list = this.screens.start.querySelector('.menu-list')!;
    list.innerHTML = RECIPE_IDS.map((id) => `<div class="menu-item"><img src="${icons[id]}" alt=""><span>${RECIPES[id].name}</span></div>`).join('');
    const ps = this.screens.start.querySelectorAll<HTMLImageElement>('.portrait');
    ps[0].src = portraits[0];
    ps[1].src = portraits[1];
  }

  private buildScreens(parent: HTMLElement): void {
    const start = h('div', 'screen start');
    start.innerHTML = `
      <div class="start-card">
        <div class="logo"><span class="logo-main">Sweet Rush</span><span class="logo-sub">кондитерская на двоих</span></div>
        <div class="players">
          <div class="pcard p1"><img class="portrait" alt="Бриошь"><div><b>Игрок 1 · Бриошь</b><span>Левая половина экрана</span></div></div>
          <div class="how">
            <div><i class="g-stick"></i>Палец в своей половине — ходить</div>
            <div><i class="g-btn"></i>Большая кнопка — взять, положить, использовать</div>
          </div>
          <div class="pcard p2"><img class="portrait" alt="Зефирка"><div><b>Игрок 2 · Зефирка</b><span>Правая половина экрана</span></div></div>
        </div>
        <div class="route">
          <span><img src="${iconURL('raw')}" alt="">Тесто</span><em>›</em>
          <span><img src="${iconURL('oven')}" alt="">Духовка ${CONFIG.oven.bake} с</span><em>›</em>
          <span><img src="${iconURL('chocolate')}" alt="">Топинг</span><em>›</em>
          <span><img src="${iconURL('plate')}" alt="">Тарелка</span><em>›</em>
          <span class="go">Выдача</span>
        </div>
        <div class="menu-list"></div>
        <div class="start-actions">
          <button class="big go-btn">Начать смену</button>
          <div class="start-tools"></div>
        </div>
        <small class="keys">Клавиатура: игрок 1 — WASD + Пробел, игрок 2 — стрелки + Enter</small>
      </div>`;
    start.querySelector('.go-btn')!.addEventListener('click', () => this.hnd.start());
    const st = start.querySelector('.start-tools')!;
    st.append(this.soundButton('music'), this.soundButton('sfx'));
    const fs = h('button', 'round fs', '<span class="fs-ico"></span>');
    fs.setAttribute('aria-label', 'На весь экран');
    fs.addEventListener('click', () => {
      const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
        else if (d.requestFullscreen) void d.requestFullscreen().catch(() => undefined);
        else d.webkitRequestFullscreen?.();
      } catch { /* not allowed here */ }
    });
    st.appendChild(fs);
    parent.appendChild(start);

    const pause = h('div', 'screen pause hidden');
    pause.innerHTML = `<div class="panel"><h2>Пауза</h2><button class="big resume">Продолжить</button><button class="mid restart">Начать заново</button><button class="mid tomenu">В меню</button></div>`;
    pause.querySelector('.resume')!.addEventListener('click', () => this.hnd.resume());
    pause.querySelector('.restart')!.addEventListener('click', () => this.hnd.restart());
    pause.querySelector('.tomenu')!.addEventListener('click', () => this.hnd.menu());
    parent.appendChild(pause);

    const res = h('div', 'screen results hidden');
    res.innerHTML = `<div class="panel wide"><h2>Смена окончена!</h2><div class="stars"><i></i><i></i><i></i></div><div class="total"><div class="coin"><span>¢</span></div><b>0</b></div><div class="rows"></div><div class="res-actions"><button class="big again">Ещё раз</button><button class="mid tomenu">В меню</button></div></div>`;
    res.querySelector('.again')!.addEventListener('click', () => this.hnd.restart());
    res.querySelector('.tomenu')!.addEventListener('click', () => this.hnd.menu());
    parent.appendChild(res);

    this.screens = { start, pause, results: res };
  }

  show(name: 'start' | 'pause' | 'results' | null): void {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    this.hud.classList.toggle('hidden', name === 'start');
  }

  hudVisible(on: boolean) { this.hud.classList.toggle('hidden', !on); }

  // ------------------------------------------------------------------ orders
  addOrder(o: Order): void {
    const r = RECIPES[o.recipe];
    const el = h('div', 'card enter');
    const ings = [`<div class="ing base"><img src="${iconURL('croissant')}" alt=""><img class="sub" src="${iconURL('oven')}" alt=""></div>`]
      .concat(r.toppings.map((t) => `<div class="ing"><img src="${iconURL(t as IconId)}" alt="${TOPPINGS[t].name}"></div>`))
      .join('');
    el.innerHTML = `<div class="tstrip"><i></i></div><div class="dish"><img src="${this.dishIcons[o.recipe] ?? ''}" alt=""><span class="reward">${o.reward}</span></div><div class="ings">${ings}</div><div class="cname">${r.name}</div>`;
    this.ordersEl.appendChild(el);
    const bar = el.querySelector<HTMLElement>('.tstrip i')!;
    this.cards.set(o.id, { el, bar, order: o });
    setTimeout(() => el.classList.remove('enter'), 450);
  }

  removeOrder(o: Order, how: 'served' | 'expired'): void {
    const c = this.cards.get(o.id);
    if (!c) return;
    this.cards.delete(o.id);
    c.el.classList.add(how === 'served' ? 'served' : 'expired');
    setTimeout(() => c.el.remove(), 650);
  }

  clearOrders(): void {
    this.cards.forEach((c) => c.el.remove());
    this.cards.clear();
  }

  /** wrong dish: shake all cards */
  shakeOrders(): void {
    this.ordersEl.classList.remove('shake');
    void this.ordersEl.offsetWidth;
    this.ordersEl.classList.add('shake');
  }

  // ------------------------------------------------------------------ world-space
  setupWorld(ovens: OvenController[], stockPos: Vec3): void {
    this.world.innerHTML = '';
    this.ovenEls = ovens.map((o) => {
      const wrap = h('div', 'wtag oven-tag');
      wrap.innerHTML = `<div class="obar"><i></i></div><div class="oicon"></div>`;
      this.world.appendChild(wrap);
      return { wrap, fill: wrap.querySelector<HTMLElement>('.obar i')!, icon: wrap.querySelector<HTMLElement>('.oicon')!, oven: o, pos: [o.vis.x, 1.32, o.vis.z + 0.3] as Vec3 };
    });
    this.stockEl = h('div', 'wtag stock-tag');
    this.world.appendChild(this.stockEl);
    this.tags = [{ el: this.stockEl, pos: () => stockPos }];
  }

  bubble(pos: Vec3, text: string, kind: 'err' | 'info' | 'good' = 'err'): void {
    const el = h('div', `floater bubble ${kind}`, text);
    this.world.appendChild(el);
    this.floaters.push({ el, pos: [pos[0], pos[1], pos[2]], t: 0, life: 1.3 });
  }

  floatText(pos: Vec3, text: string, kind: 'plus' | 'minus' | 'tip'): void {
    const el = h('div', `floater ftext ${kind}`, text);
    this.world.appendChild(el);
    this.floaters.push({ el, pos: [pos[0], pos[1], pos[2]], t: 0, life: 1.4 });
  }

  update(dt: number, toScreen: ToScreen, score: ScoreManager, remaining: number, stock: number): void {
    // order cards
    for (const c of this.cards.values()) {
      const f = Math.max(0, c.order.left / c.order.patience);
      c.bar.style.width = `${f * 100}%`;
      c.bar.style.background = f > 0.5 ? '#5fd35a' : f > 0.25 ? '#ffc93c' : '#ff4d5e';
      c.el.classList.toggle('urgent', f < 0.25);
    }
    // score counter rolls up
    this.shownScore += (score.score - this.shownScore) * Math.min(1, dt * 10);
    if (Math.abs(score.score - this.shownScore) < 0.5) this.shownScore = score.score;
    this.scoreEl.textContent = String(Math.round(this.shownScore));
    this.tipEl.textContent = `Чаевые ×${score.multiplier}`;
    this.tipEl.classList.toggle('hot', score.multiplier > 1);
    const r = Math.max(0, Math.ceil(remaining));
    this.timeEl.textContent = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
    this.timeBar.style.width = `${(remaining / CONFIG.shiftSeconds) * 100}%`;
    this.timerBox.classList.toggle('low', remaining <= 30);

    // ovens
    for (const o of this.ovenEls) {
      const ph = o.oven.phase;
      const [x, y, vis] = toScreen(o.pos);
      o.wrap.style.transform = `translate(${x}px, ${y}px)`;
      o.wrap.style.display = vis && ph !== 'empty' ? '' : 'none';
      o.wrap.className = `wtag oven-tag ${ph}`;
      const p = o.oven.progress;
      o.fill.style.width = `${(ph === 'baking' ? p : ph === 'burnt' ? 1 : p) * 100}%`;
    }
    for (const t of this.tags) {
      const p = t.pos();
      if (!p) continue;
      const [x, y] = toScreen(p);
      t.el.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (this.stockEl) {
      this.stockEl.textContent = `×${stock}`;
      this.stockEl.classList.toggle('empty', stock === 0);
    }
    // floaters
    for (const f of [...this.floaters]) {
      f.t += dt;
      const [x, y] = toScreen(f.pos);
      const k = f.t / f.life;
      f.el.style.transform = `translate(${x}px, ${y - k * 50}px) translate(-50%, -100%) scale(${k < 0.15 ? 0.6 + k * 2.7 : 1})`;
      f.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
      if (f.t >= f.life) {
        f.el.remove();
        this.floaters.splice(this.floaters.indexOf(f), 1);
      }
    }
  }

  clearFloaters(): void {
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  countdown(text: string | null): void {
    if (text === null) { this.countdownEl.classList.remove('on'); return; }
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('on');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('on');
  }

  showResults(s: ScoreManager, onStar: (i: number) => void): void {
    const el = this.screens.results;
    el.querySelector('.total b')!.textContent = String(s.score);
    const rows: [string, string, string?][] = [
      ['Выдано заказов', String(s.delivered)],
      ['Монеты за заказы', `+${s.earnedBase}`],
      ['Чаевые за скорость и серию', `+${s.earnedTips}`],
      ['Лучшая серия', `×${Math.min(CONFIG.score.streakMax, Math.max(1, s.bestStreak))} (${s.bestStreak} подряд)`],
      ['Просрочено заказов', String(s.expired), s.expired ? 'bad' : ''],
      ['Неверные блюда', String(s.mistakes), s.mistakes ? 'bad' : ''],
      ['Сгоревшие круассаны', String(s.burnt), s.burnt ? 'bad' : ''],
      ['Штрафы', `−${s.penalties}`, s.penalties ? 'bad' : ''],
    ];
    el.querySelector('.rows')!.innerHTML = rows.map(([a, b, c]) => `<div class="row ${c ?? ''}"><span>${a}</span><b>${b}</b></div>`).join('')
      + `<div class="row goal"><span>Цели: ★ ${CONFIG.stars[0]} · ★★ ${CONFIG.stars[1]} · ★★★ ${CONFIG.stars[2]}</span></div>`;
    const stars = el.querySelectorAll('.stars i');
    stars.forEach((st) => st.classList.remove('on'));
    this.show('results');
    for (let i = 0; i < s.stars; i++) {
      setTimeout(() => { stars[i].classList.add('on'); onStar(i); }, 500 + i * 450);
    }
  }
}
