// Renders the real 3D dishes (and the two bakers) into small transparent images for the HUD,
// so order cards show exactly what has to be built.
import { Renderer } from './renderer';
import { Node } from './scene';
import { m4, m4lookAt, m4mul, m4perspective, Vec3 } from './math';
import { Camera } from './scene';
import { FoodMeshes, makeCroissantVisual } from './food';
import { RECIPES, RECIPE_IDS } from './RecipeManager';
import type { RecipeId } from './config';
import { buildCharacter } from './characters';
import { PAL } from './palette';

function camera(eye: Vec3, target: Vec3, fovDeg: number, aspect: number): Camera {
  const view = m4lookAt(m4(), eye, target, [0, 1, 0]);
  const proj = m4perspective(m4(), (fovDeg * Math.PI) / 180, aspect, 0.05, 50);
  return { view, proj, viewProj: m4mul(m4(), proj, view), pos: eye };
}

export function renderDishIcons(r: Renderer, fm: FoodMeshes): Record<RecipeId, string> {
  const out = {} as Record<RecipeId, string>;
  const W = 200, H = 150;
  const cam = camera([0, 1.05, 0.95], [0, 0.07, 0.02], 30, W / H);
  for (const id of RECIPE_IDS) {
    const root = new Node('icon');
    const plate = new Node('plate', fm.plate);
    const v = makeCroissantVisual(fm);
    v.body.mesh = fm.baked;
    const t = RECIPES[id].toppings;
    v.tops.chocolate.visible = t.includes('chocolate');
    v.tops.jam.visible = t.includes('jam');
    v.tops.cinnamon.visible = t.includes('cinnamon');
    v.tops.sprinklesGlaze.visible = t.includes('sprinkles');
    v.root.pos = [0, 0.03, 0];
    v.root.setScale(1.22);
    plate.add(v.root);
    root.add(plate);
    out[id] = r.capture(root, cam, W, H).toDataURL();
  }
  return out;
}

export function renderPortraits(r: Renderer): [string, string] {
  const W = 240, H = 240;
  const cam = camera([0.35, 0.95, 2.4], [0, 0.62, 0], 26, W / H);
  const res: string[] = [];
  for (const kind of ['bear', 'bunny'] as const) {
    const rig = buildCharacter(r, kind, kind === 'bear' ? PAL.p1 : PAL.p2);
    rig.ring.visible = false;
    rig.root.rot = [0, 0.35, 0];
    rig.root.setScale(1.15);
    rig.armR.rot = [-2.6, 0, -0.3];
    if (rig.earR) rig.earR.rot = [-0.3, 0, -0.45];
    res.push(r.capture(rig.root, cam, W, H).toDataURL());
  }
  return [res[0], res[1]];
}
