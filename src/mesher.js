// Turns a chunk's voxels into GPU-ready geometry with ambient occlusion and
// smooth (per-vertex) light sampling. Opaque and translucent parts are split.

import * as B from './blocks.js';
import { CHUNK_W, WORLD_H } from './worldgen.js';
import { tileUV } from './atlas.js';

// Corner order is CCW seen from outside the block.
const FACES = [
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], axis: 0, t: [2, 1], shade: 0.78, key: 'side' },
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], axis: 0, t: [2, 1], shade: 0.78, key: 'side' },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], axis: 1, t: [0, 2], shade: 0.55, key: 'bottom' },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], axis: 1, t: [0, 2], shade: 1.0, key: 'top' },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], axis: 2, t: [0, 1], shade: 0.68, key: 'side' },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], axis: 2, t: [0, 1], shade: 0.68, key: 'side' },
];
const UVT = [[0, 1], [1, 1], [1, 0], [0, 0]];
const AO_LEVELS = [0.42, 0.62, 0.82, 1.0];

const FLOATS_PER_VERTEX = 8; // x,y,z, u,v, sky, block, shade

class Builder {
  constructor() {
    this.data = new Float32Array(4096 * FLOATS_PER_VERTEX);
    this.len = 0;
    this.indices = new Uint32Array(6144);
    this.ilen = 0;
    this.vcount = 0;
  }
  growVertices() {
    const d = new Float32Array(this.data.length * 2);
    d.set(this.data);
    this.data = d;
  }
  growIndices() {
    const d = new Uint32Array(this.indices.length * 2);
    d.set(this.indices);
    this.indices = d;
  }
  vertex(x, y, z, u, v, sky, blk, shade) {
    if (this.len + FLOATS_PER_VERTEX > this.data.length) this.growVertices();
    const d = this.data;
    let i = this.len;
    d[i++] = x; d[i++] = y; d[i++] = z; d[i++] = u; d[i++] = v;
    d[i++] = sky; d[i++] = blk; d[i++] = shade;
    this.len = i;
    return this.vcount++;
  }
  quad(flip) {
    if (this.ilen + 6 > this.indices.length) this.growIndices();
    const b = this.vcount - 4;
    const ind = this.indices;
    let i = this.ilen;
    if (flip) {
      ind[i++] = b + 1; ind[i++] = b + 2; ind[i++] = b + 3;
      ind[i++] = b + 1; ind[i++] = b + 3; ind[i++] = b + 0;
    } else {
      ind[i++] = b + 0; ind[i++] = b + 1; ind[i++] = b + 2;
      ind[i++] = b + 0; ind[i++] = b + 2; ind[i++] = b + 3;
    }
    this.ilen = i;
  }
  result() {
    return {
      vertices: this.data.subarray(0, this.len),
      indices: this.indices.subarray(0, this.ilen),
      count: this.ilen,
    };
  }
}

function tileFor(block, faceKey, faceIndex) {
  const t = block.tiles;
  if (faceKey === 'top' && t.top !== undefined) return t.top;
  if (faceKey === 'bottom' && t.bottom !== undefined) return t.bottom;
  if (t.front !== undefined && faceIndex === 4) return t.front;
  if (t.side !== undefined) return t.side;
  return t.all ?? t.top ?? 0;
}

export function buildChunkMesh(world, chunk) {
  const solid = new Builder();
  const trans = new Builder();
  const bx = chunk.cx * CHUNK_W;
  const bz = chunk.cz * CHUNK_W;
  const blocks = chunk.blocks;

  // Local accessors that fall back to the world for out-of-chunk samples.
  const getId = (x, y, z) => {
    if (y < 0 || y >= WORLD_H) return B.AIR;
    if (x >= 0 && x < CHUNK_W && z >= 0 && z < CHUNK_W) return blocks[(y << 8) | (z << 4) | x];
    return world.getBlock(bx + x, y, bz + z);
  };
  const getSky = (x, y, z) => {
    if (y < 0) return 0;
    if (y >= WORLD_H) return 15;
    if (x >= 0 && x < CHUNK_W && z >= 0 && z < CHUNK_W) return chunk.light[(y << 8) | (z << 4) | x] >> 4;
    return world.getLight(0, bx + x, y, bz + z);
  };
  const getBl = (x, y, z) => {
    if (y < 0 || y >= WORLD_H) return 0;
    if (x >= 0 && x < CHUNK_W && z >= 0 && z < CHUNK_W) return chunk.light[(y << 8) | (z << 4) | x] & 15;
    return world.getLight(1, bx + x, y, bz + z);
  };
  const isOpaque = (x, y, z) => B.getBlock(getId(x, y, z)).opaque;

  for (let y = 0; y < WORLD_H; y++) {
    for (let z = 0; z < CHUNK_W; z++) {
      for (let x = 0; x < CHUNK_W; x++) {
        const id = blocks[(y << 8) | (z << 4) | x];
        if (id === B.AIR) continue;
        const block = B.getBlock(id);
        if (block.render === B.RENDER_CROSS) {
          emitCross(solid, x, y, z, block, getSky(x, y, z), getBl(x, y, z));
          continue;
        }
        if (block.render === B.RENDER_TORCH) {
          emitTorch(solid, x, y, z, block);
          continue;
        }
        const liquid = block.render === B.RENDER_LIQUID;
        const out = liquid || id === B.GLASS || id === B.ICE ? trans : solid;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
          const nid = getId(nx, ny, nz);
          const nb = B.getBlock(nid);
          if (nb.opaque) continue;
          if (nid === id && (liquid || id === B.LEAVES || id === B.GLASS || id === B.ICE)) continue;
          if (liquid && nb.liquid) continue;

          const uv = tileUV(tileFor(block, face.key, f));
          const topLiquid = liquid && face.n[1] === 1;
          const shrink = liquid && getId(x, y + 1, z) !== id ? 0.12 : 0;

          const ao = [0, 0, 0, 0];
          const skyL = [0, 0, 0, 0];
          const blkL = [0, 0, 0, 0];
          const [ta, tb] = face.t;
          for (let c = 0; c < 4; c++) {
            const corner = face.v[c];
            const s1 = corner[ta] === 1 ? 1 : -1;
            const s2 = corner[tb] === 1 ? 1 : -1;
            const o1 = [0, 0, 0]; o1[ta] = s1;
            const o2 = [0, 0, 0]; o2[tb] = s2;
            const px = nx, py = ny, pz = nz;
            const aX = px + o1[0], aY = py + o1[1], aZ = pz + o1[2];
            const bX = px + o2[0], bY = py + o2[1], bZ = pz + o2[2];
            const cX = px + o1[0] + o2[0], cY = py + o1[1] + o2[1], cZ = pz + o1[2] + o2[2];
            const sa = isOpaque(aX, aY, aZ) ? 1 : 0;
            const sb = isOpaque(bX, bY, bZ) ? 1 : 0;
            const sc = isOpaque(cX, cY, cZ) ? 1 : 0;
            ao[c] = (sa && sb) ? 0 : 3 - (sa + sb + sc);

            let ls = getSky(px, py, pz), lb = getBl(px, py, pz), n = 1;
            if (!sa) { ls += getSky(aX, aY, aZ); lb += getBl(aX, aY, aZ); n++; }
            if (!sb) { ls += getSky(bX, bY, bZ); lb += getBl(bX, bY, bZ); n++; }
            if (!sc && !(sa && sb)) { ls += getSky(cX, cY, cZ); lb += getBl(cX, cY, cZ); n++; }
            skyL[c] = ls / n / 15;
            blkL[c] = lb / n / 15;
          }

          for (let c = 0; c < 4; c++) {
            const corner = face.v[c];
            let vy = y + corner[1];
            if (topLiquid || (liquid && corner[1] === 1)) vy -= shrink;
            out.vertex(
              x + corner[0], vy, z + corner[2],
              uv.u0 + UVT[c][0] * (uv.u1 - uv.u0),
              uv.v0 + UVT[c][1] * (uv.v1 - uv.v0),
              skyL[c], blkL[c],
              AO_LEVELS[ao[c]] * face.shade);
          }
          out.quad(ao[0] + ao[2] > ao[1] + ao[3]);
        }
      }
    }
  }

  return { solid: solid.result(), transparent: trans.result() };
}

function emitCross(out, x, y, z, block, sky, blk) {
  const uv = tileUV(block.tiles.all);
  const s = sky / 15, b = blk / 15;
  const d = 0.1464; // sqrt(2)/2 inset so the X fits the block
  const planes = [
    [[d, 0, d], [1 - d, 0, 1 - d]],
    [[1 - d, 0, d], [d, 0, 1 - d]],
  ];
  for (const [p0, p1] of planes) {
    for (let side = 0; side < 2; side++) {
      const a = side === 0 ? p0 : p1;
      const c = side === 0 ? p1 : p0;
      out.vertex(x + a[0], y, z + a[2], uv.u0, uv.v1, s, b, 1);
      out.vertex(x + c[0], y, z + c[2], uv.u1, uv.v1, s, b, 1);
      out.vertex(x + c[0], y + 1, z + c[2], uv.u1, uv.v0, s, b, 1);
      out.vertex(x + a[0], y + 1, z + a[2], uv.u0, uv.v0, s, b, 1);
      out.quad(false);
    }
  }
}

function emitTorch(out, x, y, z, block) {
  const uv = tileUV(block.tiles.all);
  const du = (uv.u1 - uv.u0) / 16, dv = (uv.v1 - uv.v0) / 16;
  const u0 = uv.u0 + du * 7, u1 = uv.u0 + du * 9;
  const vTop = uv.v0 + dv * 6, vBot = uv.v1;
  const x0 = x + 7 / 16, x1 = x + 9 / 16;
  const z0 = z + 7 / 16, z1 = z + 9 / 16;
  const y0 = y, y1 = y + 10 / 16;
  const s = 1, b = 1;
  const side = [
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
  ];
  for (const q of side) {
    out.vertex(q[0][0], q[0][1], q[0][2], u0, vBot, s, b, 1);
    out.vertex(q[1][0], q[1][1], q[1][2], u1, vBot, s, b, 1);
    out.vertex(q[2][0], q[2][1], q[2][2], u1, vTop, s, b, 1);
    out.vertex(q[3][0], q[3][1], q[3][2], u0, vTop, s, b, 1);
    out.quad(false);
  }
  // Flame cap
  const fu0 = uv.u0 + du * 6, fu1 = uv.u0 + du * 10;
  const fv0 = uv.v0 + du * 0, fv1 = uv.v0 + dv * 6;
  out.vertex(x0, y1, z1, fu0, fv1, s, b, 1);
  out.vertex(x1, y1, z1, fu1, fv1, s, b, 1);
  out.vertex(x1, y1, z0, fu1, fv0, s, b, 1);
  out.vertex(x0, y1, z0, fu0, fv0, s, b, 1);
  out.quad(false);
}
