// WebGL2 renderer: sky, chunks, entities, particles, selection and hand.

import { createContext, createProgram, Mesh, createTextureFromCanvas } from './gl.js';
import * as M from './math.js';
import * as B from './blocks.js';
import { buildChunkMesh } from './mesher.js';
import { CHUNK_W, WORLD_H } from './worldgen.js';
import { tileUV, ATLAS_PX, TILE_PX, ATLAS_COLS, T } from './atlas.js';

const TERRAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec2 aLight;
layout(location=3) in float aShade;
uniform mat4 uProj, uView, uModel;
uniform float uDaylight;
out vec2 vUV;
out float vBright;
out float vDist;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;
  vUV = aUV;
  float l = max(aLight.x * uDaylight, aLight.y);
  vBright = (0.05 + 0.95 * pow(clamp(l, 0.0, 1.0), 1.25)) * aShade;
  vDist = length(eye.xyz);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vBright;
in float vDist;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform float uAlphaTest;
uniform vec3 uTint;
out vec4 outColor;
void main(){
  vec4 c = texture(uTex, vUV);
  if (c.a < uAlphaTest) discard;
  vec3 rgb = c.rgb * vBright * uTint;
  float f = clamp((vDist - uFogRange.x) / max(1.0, uFogRange.y - uFogRange.x), 0.0, 1.0);
  rgb = mix(rgb, uFogColor, f * f);
  outColor = vec4(rgb, c.a);
}`;

const SOLID_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj, uView, uModel;
out vec3 vNormal;
out float vDist;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;
  vNormal = mat3(uModel) * aNormal;
  vDist = length(eye.xyz);
}`;

const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vDist;
uniform vec4 uColor;
uniform float uLight;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
out vec4 outColor;
void main(){
  vec3 n = normalize(vNormal);
  float d = 0.62 + 0.38 * max(dot(n, normalize(vec3(0.4, 1.0, 0.25))), 0.0);
  d *= 0.35 + 0.65 * abs(n.y) * 0.4 + 0.45;
  vec3 rgb = uColor.rgb * d * uLight;
  float f = clamp((vDist - uFogRange.x) / max(1.0, uFogRange.y - uFogRange.x), 0.0, 1.0);
  rgb = mix(rgb, uFogColor, f * f);
  outColor = vec4(rgb, uColor.a);
}`;

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 1.0, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
uniform float uNight, uTime, uCamY;
out vec4 outColor;

float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(vec3(i,0.0)), b = hash(vec3(i+vec2(1.0,0.0),0.0));
  float c = hash(vec3(i+vec2(0.0,1.0),0.0)), d = hash(vec3(i+vec2(1.0,1.0),0.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ s += a*noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main(){
  vec4 p = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  float h = clamp(dir.y * 1.6 + 0.12, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.65));

  // Sun / moon glow near the horizon
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * pow(sd, 8.0) * 0.55;
  if (sd > 0.9992) col = mix(col, vec3(1.0, 0.98, 0.9), 0.95);
  float md = max(dot(dir, -uSunDir), 0.0);
  if (md > 0.9994) col = mix(col, vec3(0.92, 0.94, 1.0), 0.9 * uNight);

  // Stars
  if (uNight > 0.01 && dir.y > 0.0) {
    vec3 sp = floor(dir * 260.0);
    float st = hash(sp);
    if (st > 0.9975) col += vec3(0.9, 0.93, 1.0) * uNight * (0.5 + 0.5 * sin(uTime * 2.0 + st * 40.0));
  }

  // Clouds on a plane above the world
  if (dir.y > 0.015) {
    float t = (172.0 - uCamY) / dir.y;
    if (t > 0.0 && t < 6000.0) {
      vec2 cp = (dir.xz * t) * 0.0021 + vec2(uTime * 0.004, uTime * 0.0015);
      float c = fbm(cp * 2.4);
      float cover = smoothstep(0.52, 0.72, c);
      float fade = 1.0 - clamp(t / 2600.0, 0.0, 1.0);
      vec3 cloudCol = mix(vec3(0.55,0.58,0.66), vec3(1.0), 0.55 + 0.45*(1.0-uNight));
      col = mix(col, cloudCol * (0.35 + 0.65 * (1.0 - uNight)), cover * fade * 0.85);
    }
  }
  outColor = vec4(col, 1.0);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView, uModel;
void main(){ gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main(){ outColor = uColor; }`;

const TERRAIN_LAYOUT = [
  { loc: 0, size: 3 }, { loc: 1, size: 2 }, { loc: 2, size: 2 }, { loc: 3, size: 1 },
];
const SOLID_LAYOUT = [{ loc: 0, size: 3 }, { loc: 1, size: 3 }];

export class Renderer {
  constructor(canvas, atlas) {
    const gl = createContext(canvas);
    this.gl = gl;
    this.canvas = canvas;
    this.atlas = atlas;
    this.texture = createTextureFromCanvas(gl, atlas.canvas);
    this.terrain = createProgram(gl, TERRAIN_VS, TERRAIN_FS);
    this.solid = createProgram(gl, SOLID_VS, SOLID_FS);
    this.sky = createProgram(gl, SKY_VS, SKY_FS);
    this.line = createProgram(gl, LINE_VS, LINE_FS);

    this.proj = M.mat4();
    this.view = M.mat4();
    this.model = M.mat4();
    this.tmp = M.mat4();
    this.invVP = M.mat4();
    this.vp = M.mat4();
    this.frustum = new Float32Array(24);
    this.renderDistance = 8;

    this.quad = new Mesh(gl, [{ loc: 0, size: 2 }]);
    this.quad.upload(new Float32Array([-1, -1, 3, -1, -1, 3]), new Uint32Array([0, 1, 2]));

    this.cube = this.buildUnitCube();
    this.wire = this.buildWireCube();
    this.itemMeshes = new Map();
    this.crackMeshes = [];
    this.blockColors = this.computeBlockColors();
    this.meshBudgetMs = 6;
  }

  buildUnitCube() {
    const v = [];
    const idx = [];
    const faces = [
      [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
      [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]],
      [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
      [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
      [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
      [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]],
    ];
    let base = 0;
    for (const [n, corners] of faces) {
      for (const c of corners) v.push(c[0], c[1], c[2], n[0], n[1], n[2]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
    const m = new Mesh(this.gl, SOLID_LAYOUT);
    m.upload(new Float32Array(v), new Uint32Array(idx));
    return m;
  }

  buildWireCube() {
    const p = [];
    const e = [
      [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
      [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
    ];
    const idx = [];
    let i = 0;
    for (const s of e) { p.push(s[0], s[1], s[2], s[3], s[4], s[5]); idx.push(i++, i++); }
    const m = new Mesh(this.gl, [{ loc: 0, size: 3 }]);
    m.upload(new Float32Array(p), new Uint32Array(idx));
    return m;
  }

  /** Average colour of each block's texture, used for break particles. */
  computeBlockColors() {
    const data = this.atlas.imageData.data;
    const colors = new Map();
    for (const b of B.blocks) {
      if (!b || !b.tiles) continue;
      const t = b.tiles.side ?? b.tiles.all ?? b.tiles.top;
      if (t === undefined) continue;
      const ox = (t % ATLAS_COLS) * TILE_PX, oy = ((t / ATLAS_COLS) | 0) * TILE_PX;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          const i = ((oy + y) * ATLAS_PX + ox + x) * 4;
          if (data[i + 3] < 128) continue;
          r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
        }
      }
      if (n) colors.set(b.id, [r / n / 255, g / n / 255, bl / n / 255]);
    }
    return colors;
  }

  /** Textured cube (or billboard for items) used for drops and the hand. */
  getItemMesh(id) {
    if (this.itemMeshes.has(id)) return this.itemMeshes.get(id);
    const verts = [];
    const idx = [];
    let base = 0;
    const push = (x, y, z, u, v, shade) => { verts.push(x, y, z, u, v, 1, 1, shade); };
    // Items and non-cube blocks (torches, plants) show as flat sprites.
    const flat = id >= B.ITEM_BASE || B.getBlock(id).render !== B.RENDER_CUBE;
    if (flat) {
      const uv = tileUV(B.iconTile(id));
      for (const dir of [1, -1]) {
        const z = 0.02 * dir;
        const a = dir > 0 ? [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]] : [[.5, -.5], [-.5, -.5], [-.5, .5], [.5, .5]];
        const uu = dir > 0 ? [[uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v0], [uv.u0, uv.v0]]
          : [[uv.u1, uv.v1], [uv.u0, uv.v1], [uv.u0, uv.v0], [uv.u1, uv.v0]];
        for (let i = 0; i < 4; i++) push(a[i][0], a[i][1], z, uu[i][0], uu[i][1], 1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    } else {
      const block = B.getBlock(id);
      const faces = [
        ['side', [0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]], 0.72],
        ['side', [0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]], 0.72],
        ['side', [1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]], 0.82],
        ['side', [-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]], 0.82],
        ['top', [0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]], 1.0],
        ['bottom', [0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]], 0.55],
      ];
      const uvc = [[0, 1], [1, 1], [1, 0], [0, 0]];
      for (const [key, , corners, shade] of faces) {
        const t = block.tiles[key] ?? block.tiles.all ?? block.tiles.side ?? block.tiles.top ?? 0;
        const uv = tileUV(t);
        for (let i = 0; i < 4; i++) {
          push(corners[i][0], corners[i][1], corners[i][2],
            uv.u0 + uvc[i][0] * (uv.u1 - uv.u0), uv.v0 + uvc[i][1] * (uv.v1 - uv.v0), shade);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    const m = new Mesh(this.gl, TERRAIN_LAYOUT);
    m.upload(new Float32Array(verts), new Uint32Array(idx));
    this.itemMeshes.set(id, m);
    return m;
  }

  getCrackMesh(stage) {
    if (this.crackMeshes[stage]) return this.crackMeshes[stage];
    const uv = tileUV(T.cracks[stage]);
    const verts = [];
    const idx = [];
    const faces = [
      [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
      [[[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
      [[[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
      [[[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
      [[[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
      [[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    ];
    const uvc = [[0, 1], [1, 1], [1, 0], [0, 0]];
    let base = 0;
    for (const [corners] of faces) {
      for (let i = 0; i < 4; i++) {
        verts.push(corners[i][0], corners[i][1], corners[i][2],
          uv.u0 + uvc[i][0] * (uv.u1 - uv.u0), uv.v0 + uvc[i][1] * (uv.v1 - uv.v0), 1, 1, 1);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
    const m = new Mesh(this.gl, TERRAIN_LAYOUT);
    m.upload(new Float32Array(verts), new Uint32Array(idx));
    this.crackMeshes[stage] = m;
    return m;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  skyColors(world) {
    const t = world.time / 24000;
    const day = world.skyBrightness();
    const night = 1 - Math.min(1, (day - 0.16) / 0.5);
    // Warm the horizon around sunrise/sunset.
    const sunLow = Math.max(0, 1 - Math.abs(Math.sin(t * Math.PI * 2)) * 2.2);
    const dawn = sunLow * (1 - night * 0.4);
    const top = [
      0.05 + day * 0.30, 0.07 + day * 0.48, 0.16 + day * 0.76,
    ];
    const horizon = [
      0.08 + day * 0.62 + dawn * 0.5,
      0.10 + day * 0.74 + dawn * 0.20,
      0.20 + day * 0.90 - dawn * 0.05,
    ];
    return { top, horizon: horizon.map((v) => Math.min(1, v)), night, day };
  }

  render(game, dt) {
    const gl = this.gl;
    const world = game.world;
    const player = game.player;
    this.resize();

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const fovBase = 70 + (player.sprinting ? 6 : 0) + (player.flying ? 4 : 0);
    M.perspective(this.proj, (fovBase * Math.PI) / 180, aspect, 0.06, 900);

    const bob = player.mode === 'creative' && player.flying ? 0 : Math.sin(player.bobbing) * 0.035;
    const eyeY = player.eyeY + bob * 0.5;
    M.viewFromEuler(this.view, player.pos.x, eyeY, player.pos.z, player.yaw, player.pitch);

    M.multiply(this.vp, this.proj, this.view);
    M.frustumFromMatrix(this.vp, this.frustum);

    const sk = this.skyColors(world);
    const underwater = player.submerged;
    const fogColor = underwater ? [0.10, 0.28, 0.55] : sk.horizon;
    const far = this.renderDistance * CHUNK_W;
    const fogRange = underwater ? [1, 22] : [far * 0.55, far * 0.98];
    const tint = underwater ? [0.62, 0.78, 1.0] : [1, 1, 1];

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- sky
    if (!underwater) this.drawSky(world, sk, player, eyeY, aspect);

    // --- chunk meshes
    this.buildDirtyMeshes(game);

    const daylight = world.skyBrightness();
    const tp = this.terrain;
    gl.useProgram(tp.program);
    gl.uniformMatrix4fv(tp.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(tp.u.uView, false, this.view);
    gl.uniform1i(tp.u.uTex, 0);
    gl.uniform1f(tp.u.uDaylight, daylight);
    gl.uniform3fv(tp.u.uFogColor, fogColor);
    gl.uniform2fv(tp.u.uFogRange, fogRange);
    gl.uniform3fv(tp.u.uTint, tint);
    gl.uniform1f(tp.u.uAlphaTest, 0.5);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    const ccx = Math.floor(player.pos.x) >> 4, ccz = Math.floor(player.pos.z) >> 4;
    const visible = [];
    for (const chunk of world.chunks.values()) {
      if (!chunk.mesh) continue;
      const d = Math.max(Math.abs(chunk.cx - ccx), Math.abs(chunk.cz - ccz));
      if (d > this.renderDistance) continue;
      const x0 = chunk.cx * CHUNK_W, z0 = chunk.cz * CHUNK_W;
      if (!M.aabbInFrustum(this.frustum, x0, 0, z0, x0 + CHUNK_W, WORLD_H, z0 + CHUNK_W)) continue;
      visible.push(chunk);
    }
    visible.sort((a, b) => {
      const da = (a.cx - ccx) ** 2 + (a.cz - ccz) ** 2;
      const db = (b.cx - ccx) ** 2 + (b.cz - ccz) ** 2;
      return da - db;
    });

    let tris = 0;
    for (const chunk of visible) {
      M.identity(this.model);
      M.translate(this.model, this.model, chunk.cx * CHUNK_W, 0, chunk.cz * CHUNK_W);
      gl.uniformMatrix4fv(tp.u.uModel, false, this.model);
      chunk.mesh.solid.draw();
      tris += chunk.mesh.solid.count / 3;
    }

    // --- entities and drops
    this.drawEntities(game, daylight, fogColor, fogRange, tint);

    // --- selection + break progress
    const target = game.target;
    if (target) this.drawSelection(game, target, fogColor, fogRange, tint, daylight);

    // --- translucent chunk geometry last, back to front
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(tp.program);
    gl.uniform1f(tp.u.uAlphaTest, 0.02);
    gl.disable(gl.CULL_FACE);
    for (let i = visible.length - 1; i >= 0; i--) {
      const chunk = visible[i];
      if (!chunk.mesh.transparent.count) continue;
      M.identity(this.model);
      M.translate(this.model, this.model, chunk.cx * CHUNK_W, 0, chunk.cz * CHUNK_W);
      gl.uniformMatrix4fv(tp.u.uModel, false, this.model);
      chunk.mesh.transparent.draw();
      tris += chunk.mesh.transparent.count / 3;
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // --- first person hand / held item
    this.drawHand(game, aspect, daylight);

    game.stats.tris = tris | 0;
    game.stats.visibleChunks = visible.length;
  }

  drawSky(world, sk, player, eyeY, aspect) {
    const gl = this.gl;
    const p = this.sky;
    const rotView = M.mat4();
    M.identity(rotView);
    M.rotateX(rotView, rotView, -player.pitch);
    M.rotateY(rotView, rotView, -player.yaw);
    const vp = M.mat4();
    M.multiply(vp, this.proj, rotView);
    M.invert(this.invVP, vp);

    const t = world.time / 24000;
    const ang = t * Math.PI * 2 - Math.PI / 2;   // matches skyBrightness()
    const sun = [Math.cos(ang), Math.sin(ang), 0.22];
    const len = Math.hypot(sun[0], sun[1], sun[2]);

    gl.useProgram(p.program);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(p.u.uInvVP, false, this.invVP);
    gl.uniform3fv(p.u.uTop, sk.top);
    gl.uniform3fv(p.u.uHorizon, sk.horizon);
    gl.uniform3fv(p.u.uSunDir, [sun[0] / len, sun[1] / len, sun[2] / len]);
    gl.uniform3fv(p.u.uSunColor, [1.0, 0.86, 0.62]);
    gl.uniform1f(p.u.uNight, sk.night);
    gl.uniform1f(p.u.uTime, performance.now() / 1000);
    gl.uniform1f(p.u.uCamY, eyeY);
    this.quad.draw();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    void aspect;
  }

  buildDirtyMeshes(game) {
    const world = game.world;
    const player = game.player;
    const ccx = Math.floor(player.pos.x) >> 4, ccz = Math.floor(player.pos.z) >> 4;
    const start = performance.now();
    const candidates = [];
    for (const chunk of world.chunks.values()) {
      if (!chunk.dirty || !chunk.generated) continue;
      const d = Math.max(Math.abs(chunk.cx - ccx), Math.abs(chunk.cz - ccz));
      if (d > this.renderDistance + 1) continue;
      candidates.push([d, chunk]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [, chunk] of candidates) {
      if (performance.now() - start > this.meshBudgetMs && chunk.mesh) break;
      const data = buildChunkMesh(world, chunk);
      if (!chunk.mesh) {
        chunk.mesh = {
          solid: new Mesh(this.gl, TERRAIN_LAYOUT),
          transparent: new Mesh(this.gl, TERRAIN_LAYOUT),
          dispose() { this.solid.dispose(); this.transparent.dispose(); },
        };
      }
      chunk.mesh.solid.upload(data.solid.vertices, data.solid.indices);
      chunk.mesh.transparent.upload(data.transparent.vertices, data.transparent.indices);
      chunk.dirty = false;
      if (performance.now() - start > this.meshBudgetMs) break;
    }
  }

  drawEntities(game, daylight, fogColor, fogRange, tint) {
    const gl = this.gl;
    const world = game.world;
    const sp = this.solid;
    gl.useProgram(sp.program);
    gl.uniformMatrix4fv(sp.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(sp.u.uView, false, this.view);
    gl.uniform3fv(sp.u.uFogColor, fogColor);
    gl.uniform2fv(sp.u.uFogRange, fogRange);

    const m = this.model;
    for (const mob of game.mobs) {
      const light = Math.max(0.12, world.lightAt(Math.floor(mob.x), Math.floor(mob.y + 0.5), Math.floor(mob.z)));
      const swing = Math.sin(mob.walkTime) * 0.5;
      const hurt = mob.hurtTime > 0;
      for (const part of mob.model.parts) {
        const [, ox, oy, oz, sx, sy, sz, color, anim] = part;
        M.identity(m);
        M.translate(m, m, mob.x, mob.y, mob.z);
        M.rotateY(m, m, mob.yaw + Math.PI);
        let px = ox, py = oy + sy / 2, pz = oz;
        if (anim) {
          const dir = anim.endsWith('B') ? -1 : 1;
          const a = swing * dir * (anim.startsWith('arm') ? 0.6 : 1);
          const s = Math.sin(a), c = Math.cos(a);
          const ly = -sy / 2;              // part centre relative to its pivot
          py = oy + sy + ly * c;
          pz = oz + ly * s;
          M.translate(m, m, px, py, pz);
          M.rotateX(m, m, a);
        } else {
          M.translate(m, m, px, py, pz);
        }
        if (anim && anim.startsWith('arm')) M.rotateX(m, m, -1.4);
        M.scale(m, m, sx, sy, sz);
        gl.uniformMatrix4fv(sp.u.uModel, false, m);
        const c = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, 1];
        if (hurt) { c[0] = Math.min(1, c[0] + 0.55); c[1] *= 0.5; c[2] *= 0.5; }
        if (mob.burning) { c[0] = Math.min(1, c[0] + 0.4); c[1] = Math.min(1, c[1] + 0.15); }
        gl.uniform4fv(sp.u.uColor, c);
        gl.uniform1f(sp.u.uLight, light);
        this.cube.draw();
      }
    }

    // Particles
    if (game.particles.list.length) {
      for (const pt of game.particles.list) {
        M.identity(m);
        M.translate(m, m, pt.x, pt.y, pt.z);
        M.scale(m, m, pt.size, pt.size, pt.size);
        gl.uniformMatrix4fv(sp.u.uModel, false, m);
        gl.uniform4fv(sp.u.uColor, [pt.r, pt.g, pt.b, 1]);
        gl.uniform1f(sp.u.uLight, Math.max(0.2, world.lightAt(Math.floor(pt.x), Math.floor(pt.y), Math.floor(pt.z))));
        this.cube.draw();
      }
    }

    // Dropped items
    const tp = this.terrain;
    gl.useProgram(tp.program);
    gl.uniformMatrix4fv(tp.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(tp.u.uView, false, this.view);
    gl.uniform1f(tp.u.uDaylight, daylight);
    gl.uniform3fv(tp.u.uFogColor, fogColor);
    gl.uniform2fv(tp.u.uFogRange, fogRange);
    gl.uniform3fv(tp.u.uTint, tint);
    gl.uniform1f(tp.u.uAlphaTest, 0.5);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.disable(gl.CULL_FACE);
    for (const it of game.items) {
      const light = Math.max(0.15, world.lightAt(Math.floor(it.x), Math.floor(it.y), Math.floor(it.z)));
      M.identity(m);
      M.translate(m, m, it.x, it.y + 0.25 + Math.sin(it.age * 2.4) * 0.06, it.z);
      M.rotateY(m, m, it.age * 1.5);
      M.scale(m, m, 0.32, 0.32, 0.32);
      gl.uniformMatrix4fv(tp.u.uModel, false, m);
      gl.uniform3fv(tp.u.uTint, [tint[0] * light, tint[1] * light, tint[2] * light]);
      this.getItemMesh(it.item.id).draw();
    }
    gl.uniform3fv(tp.u.uTint, tint);
    gl.enable(gl.CULL_FACE);
  }

  drawSelection(game, target, fogColor, fogRange, tint, daylight) {
    const gl = this.gl;
    const lp = this.line;
    M.identity(this.model);
    M.translate(this.model, this.model, target.x - 0.002, target.y - 0.002, target.z - 0.002);
    M.scale(this.model, this.model, 1.004, 1.004, 1.004);
    gl.useProgram(lp.program);
    gl.uniformMatrix4fv(lp.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(lp.u.uView, false, this.view);
    gl.uniformMatrix4fv(lp.u.uModel, false, this.model);
    gl.uniform4fv(lp.u.uColor, [0, 0, 0, 0.45]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.wire.draw(gl.LINES);

    const progress = game.player.breakProgress;
    if (progress > 0.01) {
      const stage = Math.min(4, Math.floor(progress * 5));
      const tp = this.terrain;
      gl.useProgram(tp.program);
      gl.uniformMatrix4fv(tp.u.uProj, false, this.proj);
      gl.uniformMatrix4fv(tp.u.uView, false, this.view);
      gl.uniform1f(tp.u.uDaylight, daylight);
      gl.uniform3fv(tp.u.uFogColor, fogColor);
      gl.uniform2fv(tp.u.uFogRange, fogRange);
      gl.uniform3fv(tp.u.uTint, tint);
      gl.uniform1f(tp.u.uAlphaTest, 0.05);
      M.identity(this.model);
      M.translate(this.model, this.model, target.x - 0.003, target.y - 0.003, target.z - 0.003);
      M.scale(this.model, this.model, 1.006, 1.006, 1.006);
      gl.uniformMatrix4fv(tp.u.uModel, false, this.model);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      this.getCrackMesh(stage).draw();
    }
    gl.disable(gl.BLEND);
  }

  drawHand(game, aspect, daylight) {
    const gl = this.gl;
    const player = game.player;
    const held = player.inventory.held;
    const proj = M.mat4();
    M.perspective(proj, (72 * Math.PI) / 180, aspect, 0.02, 10);
    const view = M.mat4();
    M.identity(view);

    const swing = player.swingTime > 0 ? Math.sin((1 - player.swingTime / 0.22) * Math.PI) : 0;
    const m = M.mat4();
    M.identity(m);
    const light = Math.max(0.25, game.world.lightAt(
      Math.floor(player.pos.x), Math.floor(player.eyeY), Math.floor(player.pos.z)));

    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (held) {
      const isItem = held.id >= B.ITEM_BASE;
      M.translate(m, m, 0.42 - swing * 0.08, -0.38 + swing * 0.12 + Math.sin(player.bobbing) * 0.012, -0.62);
      M.rotateY(m, m, isItem ? -0.9 : -0.55);
      M.rotateX(m, m, -0.25 - swing * 0.9);
      M.rotateZ(m, m, isItem ? 0.5 : 0.1);
      M.scale(m, m, 0.26, 0.26, 0.26);
      const tp = this.terrain;
      gl.useProgram(tp.program);
      gl.uniformMatrix4fv(tp.u.uProj, false, proj);
      gl.uniformMatrix4fv(tp.u.uView, false, view);
      gl.uniformMatrix4fv(tp.u.uModel, false, m);
      gl.uniform1f(tp.u.uDaylight, daylight);
      gl.uniform3fv(tp.u.uFogColor, [0, 0, 0]);
      gl.uniform2fv(tp.u.uFogRange, [1000, 2000]);
      gl.uniform3fv(tp.u.uTint, [light, light, light]);
      gl.uniform1f(tp.u.uAlphaTest, 0.5);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.disable(gl.CULL_FACE);
      this.getItemMesh(held.id).draw();
      gl.enable(gl.CULL_FACE);
    } else {
      // Bare arm
      M.translate(m, m, 0.34 - swing * 0.06, -0.5 + swing * 0.16, -0.55);
      M.rotateY(m, m, -0.35);
      M.rotateZ(m, m, 0.5 + swing * 0.3);
      M.rotateX(m, m, -0.4 - swing * 0.8);
      M.scale(m, m, 0.16, 0.5, 0.16);
      const sp = this.solid;
      gl.useProgram(sp.program);
      gl.uniformMatrix4fv(sp.u.uProj, false, proj);
      gl.uniformMatrix4fv(sp.u.uView, false, view);
      gl.uniformMatrix4fv(sp.u.uModel, false, m);
      gl.uniform4fv(sp.u.uColor, [0.94, 0.76, 0.62, 1]);
      gl.uniform1f(sp.u.uLight, light);
      gl.uniform3fv(sp.u.uFogColor, [0, 0, 0]);
      gl.uniform2fv(sp.u.uFogRange, [1000, 2000]);
      this.cube.draw();
    }
  }
}
