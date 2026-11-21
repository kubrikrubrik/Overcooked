// Two original baker characters (bear "Бриошь", bunny "Зефирка") + simple critter customers.
import { GeoBuilder, sphere, capsule, cyl, torus, lathe, rcyl } from './geometry';
import { RGB, m4trs, mixRGB, hex } from './math';
import { Renderer } from './renderer';
import { Node, material } from './scene';
import { PAL } from './palette';

export interface CharacterRig {
  root: Node;
  body: Node;
  head: Node;
  eyes: Node;
  armL: Node;
  armR: Node;
  footL: Node;
  footR: Node;
  earL: Node | null;
  earR: Node | null;
  ring: Node;
  hold: Node;
}

const ELL = (rx: number, ry: number, rz: number): [number, number, number] => [rx, ry, rz];

function toque(b: GeoBuilder, y0: number) {
  // chef hat: band + puffy crown
  b.add(rcyl(0.135, 0.085, 0.02, 22), m4trs([0, y0, 0]), { color: PAL.hat, gloss: 0.2 });
  b.add(
    lathe([[0.0, 0.07], [0.13, 0.07], [0.19, 0.12], [0.215, 0.18], [0.2, 0.23], [0.15, 0.27], [0.08, 0.285], [0, 0.29]], 20),
    m4trs([0, y0, 0]),
    { color: PAL.hat, gloss: 0.15, ao: 0.15 },
  );
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    b.add(sphere(0.075, 10, 7), m4trs([Math.cos(a) * 0.12, y0 + 0.22, Math.sin(a) * 0.12]), { color: PAL.hat, gloss: 0.1 });
  }
}

function eyesGeo(spacing: number, size: number): GeoBuilder {
  const b = new GeoBuilder();
  for (const s of [-1, 1]) {
    b.add(sphere(1, 12, 8), m4trs([s * spacing, 0, 0], [0, 0, 0], ELL(size * 0.75, size, size * 0.5)), { color: PAL.black, gloss: 0.9 });
    b.add(sphere(1, 8, 6), m4trs([s * spacing - size * 0.25, size * 0.35, size * 0.4], [0, 0, 0], size * 0.32), { color: PAL.white, emissive: 0.3 });
  }
  return b;
}

function ringNode(r: Renderer, color: RGB): Node {
  const g = new GeoBuilder();
  g.add(torus(0.4, 0.045, 40, 8), m4trs([0, 0, 0], [0, 0, 0], [1, 0.35, 1]), { color });
  const ring = new Node('ring', r.mesh(g.build(), material({ unlit: true, castShadow: false, receiveShadow: false })));
  const d = new GeoBuilder();
  d.add(cyl(0.4, 0.4, 0.004, 40, true), null, { color });
  const disc = new Node('disc', r.mesh(d.build(), material({ unlit: true, transparent: true, opacity: 0.28, castShadow: false, receiveShadow: false, depthWrite: false })));
  ring.add(disc);
  ring.pos[1] = 0.025;
  return ring;
}

function torsoGeo(fur: RGB, apron: RGB, dots: boolean, jacket: RGB): GeoBuilder {
  const b = new GeoBuilder();
  b.add(sphere(1, 18, 12), m4trs([0, 0.2, 0], [0, 0, 0], ELL(0.215, 0.225, 0.195)), {
    color: (_p, _n, l) => {
      const apronFront = l[2] > 0.25 && l[1] < 0.4 && Math.abs(l[0]) < 0.85;
      const bib = l[2] > 0.45 && Math.abs(l[0]) < 0.42 && l[1] < 0.78;
      if (apronFront || bib) {
        if (dots && Math.sin(l[0] * 26) * Math.sin(l[1] * 26) > 0.72) return PAL.white;
        return apron;
      }
      if (l[1] < -0.55) return mixRGB(fur, jacket, 0.0);
      return jacket;
    },
    gloss: 0.12,
    rim: 0.25,
  });
  // collar / neckerchief in player color
  b.add(torus(0.12, 0.035, 22, 8), m4trs([0, 0.4, 0.01], [0.15, 0, 0]), { color: apron, gloss: 0.2 });
  return b;
}

function armGeo(sleeve: RGB, paw: RGB): GeoBuilder {
  const b = new GeoBuilder();
  b.add(capsule(0.055, 0.09, 10, 4), m4trs([0, -0.19, 0]), { color: sleeve, gloss: 0.1 });
  b.add(sphere(0.066, 10, 8), m4trs([0, -0.19, 0.0]), { color: paw, gloss: 0.15 });
  return b;
}

function footGeo(color: RGB, long: number): GeoBuilder {
  return new GeoBuilder().add(sphere(1, 12, 8), m4trs([0, 0.045, 0.03], [0, 0, 0], ELL(0.075, 0.05, long)), { color, gloss: 0.3 });
}

export function buildCharacter(r: Renderer, kind: 'bear' | 'bunny', color: RGB): CharacterRig {
  const root = new Node(kind);
  const body = new Node('body');
  body.pos = [0, 0.1, 0];
  root.add(body);

  const fur = kind === 'bear' ? PAL.bearFur : PAL.bunnyFur;
  const furLight = kind === 'bear' ? PAL.bearFurLight : PAL.white;
  const jacket: RGB = kind === 'bear' ? PAL.white : hex('#fff3e6');
  const M = (b: GeoBuilder) => r.mesh(b.build(), material());

  body.add(new Node('torso', M(torsoGeo(fur, color, kind === 'bunny', jacket))));
  // tail
  body.add(new Node('tail', M(new GeoBuilder().add(sphere(kind === 'bear' ? 0.055 : 0.075, 10, 8), m4trs([0, 0.1, -0.19]), { color: kind === 'bear' ? fur : PAL.white }))));

  // head
  const head = new Node('head');
  head.pos = [0, 0.4, 0];
  body.add(head);
  const hb = new GeoBuilder();
  const hr = kind === 'bear' ? 0.205 : 0.195;
  hb.add(sphere(hr, 22, 16), m4trs([0, 0.15, 0]), { color: fur, gloss: 0.12, rim: 0.3 });
  if (kind === 'bear') {
    hb.add(sphere(1, 14, 10), m4trs([0, 0.1, 0.16], [0, 0, 0], ELL(0.1, 0.075, 0.075)), { color: furLight, gloss: 0.15 });
    hb.add(sphere(1, 10, 8), m4trs([0, 0.135, 0.232], [0, 0, 0], ELL(0.04, 0.028, 0.026)), { color: PAL.black, gloss: 0.8 });
    for (const s of [-1, 1]) {
      hb.add(sphere(0.072, 12, 8), m4trs([s * 0.15, 0.3, -0.03]), { color: fur });
      hb.add(sphere(1, 10, 8), m4trs([s * 0.15, 0.3, 0.02], [0, 0, 0], ELL(0.044, 0.044, 0.02)), { color: furLight });
      hb.add(sphere(1, 10, 8), m4trs([s * 0.125, 0.085, 0.15], [0, 0, 0], ELL(0.042, 0.026, 0.02)), { color: hex('#ff8f9a') });
    }
    toque(hb, 0.27);
  } else {
    hb.add(sphere(0.05, 10, 8), m4trs([-0.04, 0.085, 0.16]), { color: PAL.white });
    hb.add(sphere(0.05, 10, 8), m4trs([0.04, 0.085, 0.16]), { color: PAL.white });
    hb.add(sphere(1, 10, 8), m4trs([0, 0.125, 0.2], [0, 0, 0], ELL(0.032, 0.024, 0.022)), { color: hex('#ff7d9c'), gloss: 0.7 });
    hb.add(rcyl(0.022, 0.03, 0.006, 8), m4trs([0, 0.025, 0.185], [Math.PI / 2 - 0.2, 0, 0], [1, 1, 0.5]), { color: PAL.white });
    for (const s of [-1, 1]) {
      hb.add(sphere(1, 10, 8), m4trs([s * 0.12, 0.08, 0.14], [0, 0, 0], ELL(0.04, 0.025, 0.02)), { color: hex('#ffa3b5') });
    }
    // kerchief band in player colour around the top of the head + knot
    hb.add(torus(0.172, 0.03, 32, 8), m4trs([0, 0.25, -0.03], [0.42, 0, 0]), { color, gloss: 0.2 });
    hb.add(sphere(0.045, 10, 8), m4trs([0.11, 0.27, -0.13]), { color });
    hb.add(sphere(1, 10, 8), m4trs([0.16, 0.24, -0.17], [0, 0, 0.6], ELL(0.05, 0.022, 0.035)), { color });
  }
  head.add(new Node('headMesh', M(hb)));

  const eyes = new Node('eyes', M(eyesGeo(kind === 'bear' ? 0.074 : 0.07, kind === 'bear' ? 0.036 : 0.04)));
  eyes.pos = [0, 0.18, 0.168];
  head.add(eyes);

  let earL: Node | null = null, earR: Node | null = null;
  if (kind === 'bunny') {
    const ear = (side: number) => {
      const b = new GeoBuilder();
      b.add(capsule(0.048, 0.2, 12, 5), m4trs([0, 0, 0], [0, 0, 0], [1, 1, 0.62]), { color: fur, rim: 0.3 });
      b.add(capsule(0.03, 0.17, 10, 4), m4trs([0, 0.025, 0.02], [0, 0, 0], [1, 1, 0.35]), { color: PAL.bunnyInner });
      const n = new Node('ear', M(b));
      n.pos = [side * 0.075, 0.3, -0.03];
      n.rot = [-0.12, 0, -side * 0.22];
      return n;
    };
    earL = ear(-1);
    earR = ear(1);
    earR.rot = [-0.5, 0, -0.5];
    head.add(earL, earR);
  }

  const sleeve = jacket;
  const paw = kind === 'bear' ? fur : PAL.bunnyFur;
  const armL = new Node('armL', M(armGeo(sleeve, paw)));
  const armR = new Node('armR', M(armGeo(sleeve, paw)));
  armL.pos = [-0.2, 0.34, 0.02];
  armR.pos = [0.2, 0.34, 0.02];
  armL.rot = [0, 0, 0.25];
  armR.rot = [0, 0, -0.25];
  body.add(armL, armR);

  const footColor = kind === 'bear' ? hex('#5a3a2a') : PAL.bunnyFur;
  const footL = new Node('footL', M(footGeo(footColor, kind === 'bunny' ? 0.12 : 0.09)));
  const footR = new Node('footR', M(footGeo(footColor, kind === 'bunny' ? 0.12 : 0.09)));
  footL.pos = [-0.09, 0, 0];
  footR.pos = [0.09, 0, 0];
  root.add(footL, footR);

  const ring = ringNode(r, color);
  root.add(ring);

  const hold = new Node('hold');
  hold.pos = [0, 0.27, 0.33];
  body.add(hold);

  return { root, body, head, eyes, armL, armR, footL, footR, earL, earR, ring, hold };
}

// ------------------------------------------------------------- customers

export interface CustomerRig { root: Node; body: Node; head: Node; }

const SPECIES = ['cat', 'dog', 'fox', 'mouse', 'duck', 'cat'] as const;

export function buildCustomer(r: Renderer, i: number): CustomerRig {
  const sp = SPECIES[i % SPECIES.length];
  const furs: Record<string, RGB> = {
    cat: hex('#8f8f9e'), dog: hex('#d9a066'), fox: hex('#f08a3c'), mouse: hex('#b9b3c2'), duck: hex('#ffd84d'),
  };
  const shirts: RGB[] = [hex('#7c6cf0'), hex('#3fbf8f'), hex('#ff8fab'), hex('#5ab4ff'), hex('#f2c14e'), hex('#e36b6b')];
  const fur = i === 5 ? hex('#3b3440') : furs[sp];
  const shirt = shirts[i % shirts.length];
  const root = new Node('customer');
  const body = new Node('cbody');
  root.add(body);
  const b = new GeoBuilder();
  b.add(sphere(1, 14, 10), m4trs([0, 0.25, 0], [0, 0, 0], ELL(0.2, 0.25, 0.18)), { color: shirt, rim: 0.2 });
  b.add(sphere(1, 10, 8), m4trs([0.09, 0.04, 0.02], [0, 0, 0], ELL(0.06, 0.045, 0.09)), { color: hex('#4a3b52') });
  b.add(sphere(1, 10, 8), m4trs([-0.09, 0.04, 0.02], [0, 0, 0], ELL(0.06, 0.045, 0.09)), { color: hex('#4a3b52') });
  body.add(new Node('cb', r.mesh(b.build(), material())));
  const head = new Node('chead');
  head.pos = [0, 0.52, 0];
  body.add(head);
  const h = new GeoBuilder();
  h.add(sphere(0.17, 16, 12), m4trs([0, 0.1, 0]), { color: fur, rim: 0.25 });
  if (sp === 'cat' || sp === 'fox') {
    for (const s of [-1, 1]) h.add(cyl(0, 0.07, 0.13, 8), m4trs([s * 0.1, 0.22, 0], [0, 0, -s * 0.25]), { color: fur });
    if (sp === 'fox') h.add(sphere(1, 10, 8), m4trs([0, 0.06, 0.13], [0, 0, 0], ELL(0.08, 0.06, 0.07)), { color: PAL.white });
  } else if (sp === 'dog') {
    for (const s of [-1, 1]) h.add(sphere(1, 10, 8), m4trs([s * 0.16, 0.08, 0], [0, 0, s * 0.3], ELL(0.05, 0.11, 0.06)), { color: hex('#8a5a36') });
    h.add(sphere(1, 10, 8), m4trs([0, 0.06, 0.14], [0, 0, 0], ELL(0.07, 0.05, 0.06)), { color: hex('#f3d6b0') });
  } else if (sp === 'mouse') {
    for (const s of [-1, 1]) h.add(sphere(1, 12, 8), m4trs([s * 0.14, 0.22, -0.02], [0, 0, 0], ELL(0.08, 0.08, 0.025)), { color: hex('#ffb3c4') });
  } else {
    h.add(sphere(1, 10, 8), m4trs([0, 0.07, 0.16], [0, 0, 0], ELL(0.08, 0.03, 0.06)), { color: hex('#ff9a3c') });
  }
  h.add(sphere(1, 8, 6), m4trs([-0.06, 0.13, 0.15], [0, 0, 0], ELL(0.02, 0.028, 0.012)), { color: PAL.black, gloss: 0.8 });
  h.add(sphere(1, 8, 6), m4trs([0.06, 0.13, 0.15], [0, 0, 0], ELL(0.02, 0.028, 0.012)), { color: PAL.black, gloss: 0.8 });
  if (i % 3 === 0) h.add(rcyl(0.13, 0.05, 0.02, 16), m4trs([0, 0.24, -0.02], [-0.2, 0, 0.2]), { color: hex('#e36b6b') });
  head.add(new Node('ch', r.mesh(h.build(), material())));
  return { root, body, head };
}
