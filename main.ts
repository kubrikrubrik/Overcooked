import './styles.css';
import { GameManager } from './GameManager';

// iPadOS 15 Safari has no CanvasRenderingContext2D.roundRect — tiny polyfill for our icons/signs.
const C2D = CanvasRenderingContext2D.prototype as CanvasRenderingContext2D & { roundRect?: unknown };
if (typeof C2D.roundRect !== 'function') {
  (C2D as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect = function (
    this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  };
}

async function waitFonts(): Promise<void> {
  if (!document.fonts) return;
  const loads = ['700 40px Fredoka', '900 40px Nunito', '800 40px Nunito'].map((f) => document.fonts.load(f).catch(() => undefined));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1800))]);
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  await waitFonts();
  // let the loader paint before the heavy procedural build
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  try {
    const game = new GameManager(app);
    (window as unknown as { __SR: GameManager }).__SR = game;
  } catch (e) {
    console.error(e);
    const d = document.createElement('div');
    d.className = 'fatal';
    d.innerHTML = `<b>Не удалось запустить игру</b><span>${(e as Error).message}. Нужен браузер с WebGL2 (Safari 15+, Chrome 80+).</span>`;
    app.appendChild(d);
  }
  document.getElementById('loader')?.classList.add('done');
  setTimeout(() => document.getElementById('loader')?.remove(), 600);
}

void boot();
