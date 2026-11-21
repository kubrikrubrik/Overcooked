// WebGL2 renderer: shadow pass -> opaque -> transparent (sorted) -> particles.
import { GeoData } from './geometry';
import { Mat4, RGB, Vec3, m3normal, m4, m4lookAt, m4mul, m4ortho, vnorm } from './math';
import { Camera, GPUMesh, Material, Mesh, Node } from './scene';
import { DEPTH_FS, DEPTH_VS, MAIN_FS, MAIN_VS, PARTICLE_FS, PARTICLE_VS } from './shaders';
import type { Particles } from './particles';

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  prog: WebGLProgram;
  u: Uniforms;
}

export interface PointLight {
  pos: Vec3;
  radius: number;
  color: RGB;
  intensity: number;
}

export interface LightSetup {
  sunDir: Vec3;
  sunColor: RGB;
  sky: RGB;
  ground: RGB;
  shadowTint: RGB;
  /** shadow frustum: center + half extent */
  shadowCenter: Vec3;
  shadowExtent: number;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  width = 1;
  height = 1;
  pixelRatio = 1;
  maxPixelRatio = 2;
  shadowSize = 2048;
  shadowsEnabled = true;
  clearColor: RGB = [0.18, 0.16, 0.24];
  stats = { draws: 0, tris: 0 };

  private main: Program;
  private depth: Program;
  private part: Program;
  private shadowFbo: WebGLFramebuffer | null = null;
  private shadowTex: WebGLTexture | null = null;
  private lightVP: Mat4 = m4();
  private lights: LightSetup | null = null;
  pointLights: PointLight[] = [];
  private normalMat = new Float32Array(9);
  private tmp = m4();
  private dummyTex: WebGLTexture;
  private plPos = new Float32Array(16);
  private plCol = new Float32Array(16);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 недоступен в этом браузере');
    this.gl = gl;
    this.main = this.program(MAIN_VS, MAIN_FS);
    this.depth = this.program(DEPTH_VS, DEPTH_FS);
    this.part = this.program(PARTICLE_VS, PARTICLE_FS);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.dummyTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.createShadowMap(this.shadowSize);
  }

  private program(vs: string, fs: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    const u: Uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u };
  }

  createShadowMap(size: number): void {
    const gl = this.gl;
    if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
    this.shadowSize = size;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowTex = tex;
    this.shadowFbo = fbo;
  }

  upload(data: GeoData): GPUMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const attr = (loc: number, arr: Float32Array, size: number) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr(0, data.pos, 3);
    attr(1, data.nor, 3);
    attr(2, data.col, 3);
    attr(3, data.mat, 4);
    attr(4, data.uv ?? new Float32Array((data.pos.length / 3) * 2), 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    // bounding sphere
    let mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], data.pos[i + k]);
        mx[k] = Math.max(mx[k], data.pos[i + k]);
      }
    }
    if (!isFinite(mn[0])) { mn = [0, 0, 0]; mx = [0, 0, 0]; }
    const center: Vec3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const radius = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
    return { vao, count: data.idx.length, center, radius, tris: data.idx.length / 3 };
  }

  mesh(data: GeoData, mat: Material): Mesh {
    return new Mesh(this.upload(data), mat);
  }

  texture(source: TexImageSource): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return t;
  }

  setLights(l: LightSetup): void {
    this.lights = l;
    const dir = vnorm(l.sunDir);
    const c = l.shadowCenter;
    const e = l.shadowExtent;
    const eye: Vec3 = [c[0] + dir[0] * 30, c[1] + dir[1] * 30, c[2] + dir[2] * 30];
    const view = m4lookAt(m4(), eye, c, [0, 1, 0]);
    const proj = m4ortho(m4(), -e, e, -e, e, 1, 60);
    m4mul(this.lightVP, proj, view);
  }

  resize(cssW: number, cssH: number): void {
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.pixelRatio = pr;
    this.width = Math.max(1, Math.round(cssW * pr));
    this.height = Math.max(1, Math.round(cssH * pr));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
  }

  private collect(root: Node, opaque: Mesh[], opaqueNodes: Node[], trans: { n: Node; d: number }[], cam: Camera): void {
    root.traverseVisible((n) => {
      if (!n.mesh) return;
      if (n.mesh.mat.transparent) {
        const w = n.world;
        const c = n.mesh.gpu.center;
        const x = w[0] * c[0] + w[4] * c[1] + w[8] * c[2] + w[12] - cam.pos[0];
        const y = w[1] * c[0] + w[5] * c[1] + w[9] * c[2] + w[13] - cam.pos[1];
        const z = w[2] * c[0] + w[6] * c[1] + w[10] * c[2] + w[14] - cam.pos[2];
        trans.push({ n, d: x * x + y * y + z * z });
      } else {
        opaque.push(n.mesh);
        opaqueNodes.push(n);
      }
    });
  }

  private opaqueM: Mesh[] = [];
  private opaqueN: Node[] = [];
  private transN: { n: Node; d: number }[] = [];

  render(root: Node, cam: Camera, particles: Particles | null): void {
    const gl = this.gl;
    root.updateWorld(null);
    this.opaqueM.length = 0;
    this.opaqueN.length = 0;
    this.transN.length = 0;
    this.collect(root, this.opaqueM, this.opaqueN, this.transN, cam);
    this.stats.draws = 0;
    this.stats.tris = 0;

    // ---- shadow pass
    if (this.shadowsEnabled && this.shadowFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.depth.prog);
      gl.uniformMatrix4fv(this.depth.u.uLightVP, false, this.lightVP);
      gl.disable(gl.CULL_FACE);
      for (const n of this.opaqueN) {
        const m = n.mesh!;
        if (!m.mat.castShadow) continue;
        gl.uniformMatrix4fv(this.depth.u.uModel, false, n.world);
        gl.bindVertexArray(m.gpu.vao);
        gl.drawElements(gl.TRIANGLES, m.gpu.count, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---- main pass
    gl.viewport(0, 0, this.width, this.height);
    const cc = this.clearColor;
    gl.clearColor(cc[0], cc[1], cc[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const p = this.main;
    gl.useProgram(p.prog);
    const u = p.u;
    gl.uniformMatrix4fv(u.uViewProj, false, cam.viewProj);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3fv(u.uCamPos, cam.pos);
    const L = this.lights!;
    gl.uniform3fv(u.uSunDir, vnorm(L.sunDir));
    gl.uniform3fv(u.uSunCol, L.sunColor);
    gl.uniform3fv(u.uSky, L.sky);
    gl.uniform3fv(u.uGround, L.ground);
    gl.uniform3fv(u.uShadowTint, L.shadowTint);
    gl.uniform1f(u.uShadowOn, this.shadowsEnabled ? 1 : 0);
    gl.uniform1f(u.uShadowTexel, 1 / this.shadowSize);
    this.plPos.fill(0);
    this.plCol.fill(0);
    for (let i = 0; i < Math.min(4, this.pointLights.length); i++) {
      const pl = this.pointLights[i];
      this.plPos.set([pl.pos[0], pl.pos[1], pl.pos[2], pl.radius], i * 4);
      this.plCol.set([pl.color[0] * pl.intensity, pl.color[1] * pl.intensity, pl.color[2] * pl.intensity, 0], i * 4);
    }
    gl.uniform4fv(u.uPL, this.plPos);
    gl.uniform4fv(u.uPC, this.plCol);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(u.uShadow, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.uniform1i(u.uTex, 1);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const n of this.opaqueN) this.drawNode(n);

    // transparent, back to front
    if (this.transN.length) {
      this.transN.sort((a, b) => b.d - a.d);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const t of this.transN) {
        gl.depthMask(t.n.mesh!.mat.depthWrite);
        this.drawNode(t.n);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (particles) this.drawParticles(particles, cam);
  }

  private lastTex: WebGLTexture | null = null;

  private drawNode(n: Node): void {
    const gl = this.gl;
    const u = this.main.u;
    const m = n.mesh!;
    const mat = m.mat;
    gl.uniformMatrix4fv(u.uModel, false, n.world);
    gl.uniformMatrix3fv(u.uNormalMat, false, m3normal(this.normalMat, n.world));
    gl.uniform3fv(u.uTint, mat.tint);
    gl.uniform3fv(u.uEmissive, mat.emissive);
    gl.uniform1f(u.uOpacity, mat.opacity);
    gl.uniform1f(u.uUnlit, mat.unlit ? 1 : 0);
    gl.uniform1f(u.uReceive, mat.receiveShadow ? 1 : 0);
    const tex = mat.texture ?? this.dummyTex;
    if (tex !== this.lastTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      this.lastTex = tex;
    }
    gl.uniform1f(u.uUseTex, mat.texture ? 1 : 0);
    if (mat.doubleSided) gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(m.gpu.vao);
    gl.drawElements(gl.TRIANGLES, m.gpu.count, gl.UNSIGNED_INT, 0);
    if (mat.doubleSided) gl.enable(gl.CULL_FACE);
    this.stats.draws++;
    this.stats.tris += m.gpu.tris;
  }

  // ---------------- particles
  private pVao: WebGLVertexArrayObject | null = null;
  private pBuf: WebGLBuffer | null = null;
  private pCap = 0;

  private drawParticles(ps: Particles, cam: Camera): void {
    const count = ps.count;
    if (!count) return;
    const gl = this.gl;
    if (!this.pVao || this.pCap < ps.capacity) {
      this.pVao = gl.createVertexArray();
      gl.bindVertexArray(this.pVao);
      this.pBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf);
      gl.bufferData(gl.ARRAY_BUFFER, ps.capacity * 10 * 4, gl.DYNAMIC_DRAW);
      const stride = 10 * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 28);
      gl.bindVertexArray(null);
      this.pCap = ps.capacity;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ps.gpuData, 0, count * 10);
    gl.useProgram(this.part.prog);
    gl.uniformMatrix4fv(this.part.u.uViewProj, false, cam.viewProj);
    gl.uniform1f(this.part.u.uScale, this.height * cam.proj[5] * 0.5);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.pVao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Render a small scene to an image with a real alpha channel (difference matting:
   * render once on black and once on white). Used for HUD dish icons and portraits.
   */
  capture(root: Node, cam: Camera, w: number, h: number): HTMLCanvasElement {
    const prev = { w: this.width, h: this.height, cw: this.canvas.width, ch: this.canvas.height, cc: this.clearColor };
    this.canvas.width = w; this.canvas.height = h;
    this.width = w; this.height = h;
    const grab = (bg: RGB) => {
      this.clearColor = bg;
      this.render(root, cam, null);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d')!;
      c.drawImage(this.canvas, 0, 0);
      return c.getImageData(0, 0, w, h);
    };
    const black = grab([0, 0, 0]);
    const white = grab([1, 1, 1]);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const oc = out.getContext('2d')!;
    const img = oc.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const d = (white.data[i] - black.data[i] + white.data[i + 1] - black.data[i + 1] + white.data[i + 2] - black.data[i + 2]) / 3;
      const a = Math.max(0, Math.min(255, 255 - d));
      img.data[i + 3] = a;
      const k = a > 0 ? 255 / a : 0;
      img.data[i] = Math.min(255, black.data[i] * k);
      img.data[i + 1] = Math.min(255, black.data[i + 1] * k);
      img.data[i + 2] = Math.min(255, black.data[i + 2] * k);
    }
    oc.putImageData(img, 0, 0);
    this.canvas.width = prev.cw; this.canvas.height = prev.ch;
    this.width = prev.w; this.height = prev.h;
    this.clearColor = prev.cc;
    return out;
  }

  get lightMatrix(): Mat4 { return this.lightVP; }
  get tmpMat(): Mat4 { return this.tmp; }
}
