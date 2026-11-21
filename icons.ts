// Vector icons drawn on <canvas>: used both as 3D decals (station lids) and in the HTML HUD,
// so the game speaks one visual language.

export type IconId = 'croissant' | 'raw' | 'burnt' | 'cinnamon' | 'chocolate' | 'sprinkles' | 'jam' | 'oven' | 'plate' | 'bin';

const INK = '#2b2235';

function bubble(c: CanvasRenderingContext2D, fill = '#ffffff') {
  c.beginPath();
  c.arc(64, 64, 57, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = INK;
  c.stroke();
}

function croissant(c: CanvasRenderingContext2D, fill: string, stroke: string, hi: string) {
  const bands = [-2, 2, -1, 1, 0];
  for (const k of bands) {
    const a = k * 0.52;
    const cx = 64 + 36 * Math.sin(a);
    const cy = 56 + 30 * (1 - Math.cos(a));
    const rx = 21 - Math.abs(k) * 4.5, ry = 18 - Math.abs(k) * 3.6;
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.beginPath();
    c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = stroke;
    c.stroke();
    c.beginPath();
    c.ellipse(-rx * 0.15, -ry * 0.35, rx * 0.5, ry * 0.25, 0, Math.PI * 1.1, Math.PI * 1.9);
    c.strokeStyle = hi;
    c.lineWidth = 3;
    c.stroke();
    c.restore();
  }
}

const DRAW: Record<IconId, (c: CanvasRenderingContext2D) => void> = {
  croissant: (c) => croissant(c, '#f0a841', '#8a4416', '#ffd88a'),
  raw: (c) => croissant(c, '#f6e2b8', '#b98d55', '#fff6e0'),
  burnt: (c) => croissant(c, '#4a3024', '#1e120c', '#6d4a38'),
  chocolate: (c) => {
    c.beginPath();
    c.moveTo(64, 20);
    c.bezierCurveTo(70, 38, 94, 54, 94, 76);
    c.arc(64, 76, 30, 0, Math.PI, false);
    c.bezierCurveTo(34, 54, 58, 38, 64, 20);
    c.fillStyle = '#6b341d';
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = '#2e140a';
    c.stroke();
    c.beginPath();
    c.ellipse(53, 74, 7, 13, -0.4, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,220,200,0.55)';
    c.fill();
  },
  sprinkles: (c) => {
    c.beginPath();
    c.arc(64, 64, 36, 0, Math.PI * 2);
    c.fillStyle = '#ffd3e6';
    c.fill();
    const cols = ['#ff4f9a', '#ffcf2e', '#33b8f0', '#6fd14b', '#a77bff', '#ff8a3d', '#ffffff'];
    const pts = [[46, 46, 0.4], [70, 40, -0.7], [86, 58, 0.2], [52, 66, 1.2], [74, 70, -0.3], [44, 86, -0.9], [64, 90, 0.7], [86, 82, 1.4], [60, 52, 2.2], [36, 64, 0.1]];
    pts.forEach(([x, y, a], i) => {
      c.save();
      c.translate(x, y);
      c.rotate(a);
      c.beginPath();
      c.moveTo(-8, 0);
      c.lineTo(8, 0);
      c.lineCap = 'round';
      c.lineWidth = 9;
      c.strokeStyle = INK;
      c.stroke();
      c.lineWidth = 5.5;
      c.strokeStyle = cols[i % cols.length];
      c.stroke();
      c.restore();
    });
  },
  jam: (c) => {
    c.beginPath();
    c.moveTo(64, 104);
    c.bezierCurveTo(30, 84, 26, 50, 44, 40);
    c.bezierCurveTo(54, 34, 60, 38, 64, 40);
    c.bezierCurveTo(68, 38, 74, 34, 84, 40);
    c.bezierCurveTo(102, 50, 98, 84, 64, 104);
    c.fillStyle = '#e0283f';
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = '#6e0c1b';
    c.stroke();
    c.fillStyle = '#ffe27a';
    for (const [x, y] of [[50, 58], [64, 54], [78, 58], [56, 72], [72, 72], [64, 86], [46, 70], [82, 70]]) {
      c.beginPath();
      c.ellipse(x, y, 2.4, 3.6, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#3fae4a';
    c.strokeStyle = '#1c5a25';
    c.lineWidth = 4;
    for (const a of [-0.9, 0, 0.9]) {
      c.save();
      c.translate(64, 40);
      c.rotate(a);
      c.beginPath();
      c.ellipse(0, -10, 7, 13, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }
  },
  cinnamon: (c) => {
    for (const [x, a] of [[54, -0.25], [74, 0.22]] as [number, number][]) {
      c.save();
      c.translate(x, 64);
      c.rotate(a);
      c.beginPath();
      c.roundRect(-11, -36, 22, 72, 10);
      c.fillStyle = '#b4652c';
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = '#4e2410';
      c.stroke();
      c.beginPath();
      c.ellipse(0, -36, 11, 6, 0, 0, Math.PI * 2);
      c.fillStyle = '#d99358';
      c.fill();
      c.stroke();
      c.beginPath();
      c.arc(0, -36, 3.5, 0, Math.PI * 1.6);
      c.lineWidth = 2.5;
      c.stroke();
      c.restore();
    }
  },
  oven: (c) => {
    c.beginPath();
    c.roundRect(28, 30, 72, 68, 12);
    c.fillStyle = '#d8455f';
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = INK;
    c.stroke();
    c.beginPath();
    c.roundRect(38, 50, 52, 38, 7);
    c.fillStyle = '#ffb04a';
    c.fill();
    c.lineWidth = 4;
    c.stroke();
    c.fillStyle = '#ffe9a8';
    c.beginPath();
    c.moveTo(64, 56); c.quadraticCurveTo(76, 70, 64, 82); c.quadraticCurveTo(52, 70, 64, 56);
    c.fill();
    c.fillStyle = '#ffe27a';
    for (const x of [46, 64, 82]) { c.beginPath(); c.arc(x, 40, 4.5, 0, Math.PI * 2); c.fill(); }
  },
  plate: (c) => {
    c.beginPath();
    c.arc(64, 64, 38, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = '#5aa7e0';
    c.stroke();
    c.beginPath();
    c.arc(64, 64, 24, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = '#cfd8e0';
    c.stroke();
  },
  bin: (c) => {
    c.beginPath();
    c.roundRect(40, 42, 48, 58, 8);
    c.fillStyle = '#6f8a86';
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = INK;
    c.stroke();
    c.beginPath();
    c.roundRect(34, 30, 60, 12, 5);
    c.fill();
    c.stroke();
    c.lineWidth = 4;
    for (const x of [54, 64, 74]) { c.beginPath(); c.moveTo(x, 52); c.lineTo(x, 90); c.stroke(); }
  },
};

export function iconCanvas(id: IconId, size = 128, withBubble = true): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.scale(size / 128, size / 128);
  if (withBubble) bubble(c);
  DRAW[id](c);
  return cv;
}

const urlCache = new Map<string, string>();
export function iconURL(id: IconId, withBubble = true): string {
  const k = id + (withBubble ? '1' : '0');
  let u = urlCache.get(k);
  if (!u) {
    u = iconCanvas(id, 128, withBubble).toDataURL();
    urlCache.set(k, u);
  }
  return u;
}
