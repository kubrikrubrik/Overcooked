// Canvas-painted signage textures (shop sign, menu chalkboard, delivery sign, conveyor arrows).
import { iconCanvas } from './icons';

export const FONT_LOGO = '"Fredoka", "Nunito", ui-rounded, "Poppins", "Montserrat", sans-serif';
export const FONT_UI = '"Nunito", ui-rounded, "Poppins", "Montserrat", sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d')!];
}

export function shopSign(): HTMLCanvasElement {
  const [cv, c] = canvas(1024, 320);
  c.fillStyle = '#7a2235';
  c.beginPath(); c.roundRect(8, 14, 1008, 300, 70); c.fill();
  c.fillStyle = '#d8455f';
  c.beginPath(); c.roundRect(8, 6, 1008, 292, 70); c.fill();
  c.lineWidth = 14; c.strokeStyle = '#fff0d8';
  c.beginPath(); c.roundRect(30, 26, 964, 252, 54); c.stroke();
  c.lineWidth = 4; c.strokeStyle = '#e8b75a';
  c.beginPath(); c.roundRect(48, 44, 928, 216, 42); c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `700 132px ${FONT_LOGO}`;
  c.fillStyle = '#7a2235';
  c.fillText('Sweet Rush', 512, 140);
  c.fillStyle = '#fff6e6';
  c.fillText('Sweet Rush', 512, 132);
  c.font = `800 46px ${FONT_UI}`;
  c.fillStyle = '#ffe2a8';
  c.fillText('кондитерская  ·  с 1999', 512, 226);
  const ic = iconCanvas('croissant', 150, false);
  c.drawImage(ic, 40, 72, 150, 150);
  c.drawImage(ic, 834, 72, 150, 150);
  return cv;
}

export function menuBoard(): HTMLCanvasElement {
  const [cv, c] = canvas(512, 320);
  c.fillStyle = '#8f5a30';
  c.beginPath(); c.roundRect(0, 0, 512, 320, 26); c.fill();
  c.fillStyle = '#2f4a3f';
  c.beginPath(); c.roundRect(20, 20, 472, 280, 14); c.fill();
  c.textAlign = 'center';
  c.fillStyle = '#fdf6e3';
  c.font = `900 48px ${FONT_UI}`;
  c.fillText('МЕНЮ', 256, 72);
  const rows: [string, 'cinnamon' | 'chocolate' | 'sprinkles' | 'jam'][] = [
    ['с корицей', 'cinnamon'],
    ['шоколадный', 'chocolate'],
    ['шоколад + посыпка', 'sprinkles'],
    ['с вареньем', 'jam'],
  ];
  c.textAlign = 'left';
  c.font = `800 30px ${FONT_UI}`;
  rows.forEach(([t, ic], i) => {
    const y = 112 + i * 46;
    c.drawImage(iconCanvas(ic, 40, false), 52, y - 6, 40, 40);
    c.fillStyle = i % 2 ? '#ffd6e6' : '#fdf6e3';
    c.fillText(t, 104, y + 25);
  });
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(60, 94); c.lineTo(452, 94); c.stroke();
  return cv;
}

export function deliverySign(): HTMLCanvasElement {
  const [cv, c] = canvas(512, 200);
  c.fillStyle = '#2b2235';
  c.beginPath(); c.roundRect(4, 10, 504, 186, 40); c.fill();
  c.fillStyle = '#ffc93c';
  c.beginPath(); c.roundRect(4, 4, 504, 180, 40); c.fill();
  c.lineWidth = 8; c.strokeStyle = '#fff6e6';
  c.beginPath(); c.roundRect(22, 20, 468, 148, 28); c.stroke();
  c.fillStyle = '#2b2235';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `900 84px ${FONT_UI}`;
  c.fillText('ВЫДАЧА', 236, 98);
  c.beginPath();
  c.moveTo(420, 64); c.lineTo(468, 96); c.lineTo(420, 128); c.closePath();
  c.fill();
  return cv;
}

export function conveyor(): HTMLCanvasElement {
  const [cv, c] = canvas(256, 512);
  c.fillStyle = '#3b3540';
  c.fillRect(0, 0, 256, 512);
  c.fillStyle = '#2c2730';
  for (let y = 0; y < 512; y += 32) c.fillRect(0, y, 256, 6);
  c.fillStyle = '#fff6e6';
  c.strokeStyle = '#ff7d9c';
  c.lineWidth = 10;
  for (const y of [150, 340]) {
    c.beginPath();
    c.moveTo(70, y - 70); c.lineTo(186, y); c.lineTo(70, y + 70); c.closePath();
    c.fill();
    c.stroke();
  }
  return cv;
}
