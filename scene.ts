// Minimal scene graph: Node (transform hierarchy) + Mesh (GPU buffers + material).
import { Mat4, RGB, Vec3, m4, m4compose, m4mul } from './math';

export interface GPUMesh {
  vao: WebGLVertexArrayObject;
  count: number;
  /** local-space bounding sphere (center, radius) for sorting */
  center: Vec3;
  radius: number;
  tris: number;
}

export interface Material {
  tint: RGB;
  emissive: RGB;
  opacity: number;
  unlit: boolean;
  doubleSided: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  transparent: boolean;
  depthWrite: boolean;
  texture: WebGLTexture | null;
}

export function material(p: Partial<Material> = {}): Material {
  return {
    tint: [1, 1, 1],
    emissive: [0, 0, 0],
    opacity: 1,
    unlit: false,
    doubleSided: false,
    castShadow: true,
    receiveShadow: true,
    transparent: false,
    depthWrite: true,
    texture: null,
    ...p,
  };
}

export class Mesh {
  constructor(public gpu: GPUMesh, public mat: Material) {}
}

export class Node {
  pos: Vec3 = [0, 0, 0];
  rot: Vec3 = [0, 0, 0];
  scale: Vec3 = [1, 1, 1];
  children: Node[] = [];
  parent: Node | null = null;
  visible = true;
  mesh: Mesh | null = null;
  readonly local: Mat4 = m4();
  readonly world: Mat4 = m4();

  constructor(public name = '', mesh: Mesh | null = null) {
    this.mesh = mesh;
  }

  add(...nodes: Node[]): this {
    for (const n of nodes) {
      if (n.parent) n.parent.remove(n);
      n.parent = this;
      this.children.push(n);
    }
    return this;
  }

  remove(n: Node): void {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parent = null;
  }

  setPos(x: number, y: number, z: number): this {
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z;
    return this;
  }

  setScale(s: number | Vec3): this {
    if (typeof s === 'number') { this.scale[0] = this.scale[1] = this.scale[2] = s; }
    else { this.scale[0] = s[0]; this.scale[1] = s[1]; this.scale[2] = s[2]; }
    return this;
  }

  updateWorld(parentWorld: Mat4 | null): void {
    m4compose(this.local, this.pos, this.rot, this.scale);
    if (parentWorld) m4mul(this.world, parentWorld, this.local);
    else this.world.set(this.local);
    for (const c of this.children) c.updateWorld(this.world);
  }

  worldPos(): Vec3 {
    return [this.world[12], this.world[13], this.world[14]];
  }

  traverseVisible(fn: (n: Node) => void): void {
    if (!this.visible) return;
    fn(this);
    for (const c of this.children) c.traverseVisible(fn);
  }
}

export interface Camera {
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  pos: Vec3;
}
