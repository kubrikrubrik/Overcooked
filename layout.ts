// Level layout. One char = one 1×1 tile. Row 0 is the back wall, last row is nearest the camera.
//  .  floor           C  counter (place items)   S  croissant storage (2 tiles)
//  O  oven            K  cinnamon                 H  chocolate
//  R  rainbow sprinkles                           J  strawberry jam
//  P  plates          W  delivery window          B  bin
//  d  decor counter (corner)                      m  stand-mixer decor counter

export const LAYOUT = [
  'dSSCOCOCCmCCd',
  'C...........C',
  'C...........C',
  'B...........W',
  'C..CKHRJCC..W',
  'C...........C',
  'C...........C',
  'dCCCCCCCCPCCd',
];

export const COLS = LAYOUT[0].length;
export const ROWS = LAYOUT.length;
export const COUNTER_H = 0.62;

export const tileX = (c: number) => c - (COLS - 1) / 2;
export const tileZ = (r: number) => r - (ROWS - 1) / 2;

export const BOUNDS = {
  minX: tileX(0) - 0.5,
  maxX: tileX(COLS - 1) + 0.5,
  minZ: tileZ(0) - 0.5,
  maxZ: tileZ(ROWS - 1) + 0.5,
};

export function charAt(c: number, r: number): string {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return '#';
  return LAYOUT[r][c];
}

export const isWalkable = (ch: string) => ch === '.';

export const SPAWN = {
  p1: { x: tileX(2) + 0.5, z: tileZ(2) },
  p2: { x: tileX(9) + 0.5, z: tileZ(5) + 0.5 },
};
