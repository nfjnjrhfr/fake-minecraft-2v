// Chunk storage, block access, flood-fill lighting, chunk streaming and
// scheduled block updates (gravity, plant growth, leaf decay).

import * as B from './blocks.js';
import { WorldGen, CHUNK_W, WORLD_H, SEA_LEVEL, BIOME, BIOME_NAME } from './worldgen.js';
import { mulberry32 } from './noise.js';

export { CHUNK_W, WORLD_H, SEA_LEVEL, BIOME, BIOME_NAME };

export const CHUNK_VOL = CHUNK_W * CHUNK_W * WORLD_H;
const idx = (x, y, z) => (y << 8) | (z << 4) | x;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOL);
    this.light = new Uint8Array(CHUNK_VOL); // high nibble = sky, low nibble = block
    this.genHeight = new Int16Array(CHUNK_W * CHUNK_W);
    this.genBiome = new Uint8Array(CHUNK_W * CHUNK_W);
    this.generated = false;
    this.lit = false;
    this.dirty = true;      // needs a mesh rebuild
    this.mesh = null;
    this.meshQueued = false;
  }
  get(x, y, z) { return this.blocks[idx(x, y, z)]; }
  set(x, y, z, id) { this.blocks[idx(x, y, z)] = id; }
  getSky(x, y, z) { return this.light[idx(x, y, z)] >> 4; }
  getBlockLight(x, y, z) { return this.light[idx(x, y, z)] & 15; }
  setSky(x, y, z, v) { const i = idx(x, y, z); this.light[i] = (this.light[i] & 15) | (v << 4); }
  setBlockLight(x, y, z, v) { const i = idx(x, y, z); this.light[i] = (this.light[i] & 0xF0) | v; }
  /** Highest non-air block in a column, used for spawning and sky checks. */
  topAt(x, z) {
    for (let y = WORLD_H - 1; y >= 0; y--) {
      const b = this.blocks[idx(x, y, z)];
      if (b !== B.AIR && b !== B.WATER) return y;
    }
    return 0;
  }
}

const SKY = 0, BLOCKLIGHT = 1;

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.gen = new WorldGen(this.seed);
    this.chunks = new Map();
    this.pending = new Map();   // structure blocks waiting for their chunk
    this.edits = new Map();     // player modifications, survive chunk unloads
    this.rnd = mulberry32(this.seed ^ 0x9e3779b9);
    this.time = 6000;           // 0..24000, 0 = sunrise
    this.tickAccum = 0;
    this.scheduled = [];        // [{x,y,z,when}] block updates
    this.addQueue = [];
    this.remQueue = [];
    this.chunkLoadQueue = [];
    this.stats = { chunks: 0, generated: 0 };
  }

  key(cx, cz) { return cx + ',' + cz; }

  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    c = new Chunk(cx, cz);
    this.chunks.set(k, c);
    this.generateChunk(c);
    return c;
  }

  generateChunk(chunk) {
    const place = (x, y, z, id) => this.setGenBlock(x, y, z, id);
    this.gen.generateChunk(chunk, place);
    chunk.generated = true;
    this.stats.generated++;

    const k = this.key(chunk.cx, chunk.cz);
    const pend = this.pending.get(k);
    if (pend) {
      for (const [i, id] of pend) chunk.blocks[i] = id;
      this.pending.delete(k);
    }
    const edits = this.edits.get(k);
    if (edits) for (const [i, id] of edits) chunk.blocks[i] = id;

    this.initLight(chunk);
    this.markNeighborsDirty(chunk.cx, chunk.cz);
    return chunk;
  }

  /** Used during generation: writes may spill into neighbouring chunks. */
  setGenBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_H) return;
    const cx = x >> 4, cz = z >> 4;
    const lx = x & 15, lz = z & 15;
    const c = this.chunks.get(this.key(cx, cz));
    const i = idx(lx, y, lz);
    if (c && c.generated) {
      if (c.blocks[i] === B.AIR || c.blocks[i] === B.LEAVES || c.blocks[i] === B.TALL_GRASS) {
        c.blocks[i] = id;
        c.dirty = true;
      }
      return;
    }
    if (c) { // being generated right now
      if (c.blocks[i] === B.AIR || c.blocks[i] === B.LEAVES) c.blocks[i] = id;
      return;
    }
    const k = this.key(cx, cz);
    let m = this.pending.get(k);
    if (!m) { m = new Map(); this.pending.set(k, m); }
    if (!m.has(i)) m.set(i, id);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_H) return B.AIR;
    const c = this.chunks.get(this.key(x >> 4, z >> 4));
    if (!c) return B.AIR;
    return c.blocks[idx(x & 15, y, z & 15)];
  }

  isLoaded(x, z) { return this.chunks.has(this.key(x >> 4, z >> 4)); }

  getLight(channel, x, y, z) {
    if (y < 0) return 0;
    if (y >= WORLD_H) return channel === SKY ? 15 : 0;
    const c = this.chunks.get(this.key(x >> 4, z >> 4));
    if (!c) return channel === SKY ? 15 : 0;
    const v = c.light[idx(x & 15, y, z & 15)];
    return channel === SKY ? (v >> 4) : (v & 15);
  }

  setLight(channel, x, y, z, level) {
    const c = this.chunks.get(this.key(x >> 4, z >> 4));
    if (!c) return;
    const i = idx(x & 15, y, z & 15);
    if (channel === SKY) c.light[i] = (c.light[i] & 15) | (level << 4);
    else c.light[i] = (c.light[i] & 0xF0) | level;
    c.dirty = true;
  }

  opacityAt(x, y, z) {
    return B.getBlock(this.getBlock(x, y, z)).opacity;
  }

  // --- lighting -------------------------------------------------------------

  initLight(chunk) {
    const bx = chunk.cx * CHUNK_W, bz = chunk.cz * CHUNK_W;
    // Seed the sky from the top of the world downward, per column.
    for (let lz = 0; lz < CHUNK_W; lz++) {
      for (let lx = 0; lx < CHUNK_W; lx++) {
        let level = 15;
        for (let y = WORLD_H - 1; y >= 0; y--) {
          const i = idx(lx, y, lz);
          const op = B.getBlock(chunk.blocks[i]).opacity;
          if (op > 0) level = Math.max(0, level - Math.max(1, op));
          if (level === 0) break;
          chunk.light[i] = (chunk.light[i] & 15) | (level << 4);
          this.addQueue.push(bx + lx, y, bz + lz, SKY);
        }
      }
    }
    // Block-light emitters.
    for (let y = 0; y < WORLD_H; y++) {
      for (let lz = 0; lz < CHUNK_W; lz++) {
        for (let lx = 0; lx < CHUNK_W; lx++) {
          const i = idx(lx, y, lz);
          const em = B.getBlock(chunk.blocks[i]).light;
          if (em > 0) {
            chunk.light[i] = (chunk.light[i] & 0xF0) | em;
            this.addQueue.push(bx + lx, y, bz + lz, BLOCKLIGHT);
          }
        }
      }
    }
    // Pull light in from already-lit neighbours.
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const n = this.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!n) continue;
      const nbx = n.cx * CHUNK_W, nbz = n.cz * CHUNK_W;
      for (let y = 0; y < WORLD_H; y++) {
        for (let t = 0; t < CHUNK_W; t++) {
          const lx = dx === -1 ? 15 : dx === 1 ? 0 : t;
          const lz = dz === -1 ? 15 : dz === 1 ? 0 : t;
          const i = idx(lx, y, lz);
          if (n.light[i] === 0) continue;
          if (n.light[i] >> 4) this.addQueue.push(nbx + lx, y, nbz + lz, SKY);
          if (n.light[i] & 15) this.addQueue.push(nbx + lx, y, nbz + lz, BLOCKLIGHT);
        }
      }
    }
    this.processLight();
    chunk.lit = true;
  }

  processLight(limit = Infinity) {
    // Removal first: darkness must clear before light refills.
    let head = 0;
    const rq = this.remQueue;
    while (head < rq.length) {
      const x = rq[head++], y = rq[head++], z = rq[head++], level = rq[head++], ch = rq[head++];
      for (let f = 0; f < 6; f++) {
        const nx = x + NX[f], ny = y + NY[f], nz = z + NZ[f];
        if (ny < 0 || ny >= WORLD_H) continue;
        if (!this.isLoaded(nx, nz)) continue;
        const nl = this.getLight(ch, nx, ny, nz);
        if (nl === 0) continue;
        const sunDown = ch === SKY && NY[f] === -1 && level === 15;
        if (nl < level || sunDown) {
          this.setLight(ch, nx, ny, nz, 0);
          rq.push(nx, ny, nz, nl, ch);
        } else if (nl >= level) {
          this.addQueue.push(nx, ny, nz, ch);
        }
      }
    }
    rq.length = 0;

    head = 0;
    const aq = this.addQueue;
    while (head < aq.length) {
      const x = aq[head++], y = aq[head++], z = aq[head++], ch = aq[head++];
      const level = this.getLight(ch, x, y, z);
      if (level <= 0) continue;
      for (let f = 0; f < 6; f++) {
        const nx = x + NX[f], ny = y + NY[f], nz = z + NZ[f];
        if (ny < 0 || ny >= WORLD_H) continue;
        if (!this.isLoaded(nx, nz)) continue;
        const op = this.opacityAt(nx, ny, nz);
        if (op >= 15) continue;
        const sunDown = ch === SKY && NY[f] === -1 && level === 15 && op === 0;
        const next = sunDown ? 15 : level - Math.max(1, op);
        if (next <= 0) continue;
        if (this.getLight(ch, nx, ny, nz) < next) {
          this.setLight(ch, nx, ny, nz, next);
          aq.push(nx, ny, nz, ch);
        }
      }
      if (head > 400000) { aq.splice(0, head); head = 0; }
    }
    aq.length = 0;
  }

  updateLightFor(x, y, z, oldId, newId) {
    const oldB = B.getBlock(oldId), newB = B.getBlock(newId);
    for (const ch of [SKY, BLOCKLIGHT]) {
      const cur = this.getLight(ch, x, y, z);
      if (cur > 0) {
        this.setLight(ch, x, y, z, 0);
        this.remQueue.push(x, y, z, cur, ch);
      }
    }
    if (newB.light > 0) {
      this.setLight(BLOCKLIGHT, x, y, z, newB.light);
      this.addQueue.push(x, y, z, BLOCKLIGHT);
    }
    // Re-seed from neighbours so light flows back into the changed cell.
    for (let f = 0; f < 6; f++) {
      const nx = x + NX[f], ny = y + NY[f], nz = z + NZ[f];
      if (ny < 0 || ny >= WORLD_H) continue;
      if (this.getLight(SKY, nx, ny, nz) > 0) this.addQueue.push(nx, ny, nz, SKY);
      if (this.getLight(BLOCKLIGHT, nx, ny, nz) > 0) this.addQueue.push(nx, ny, nz, BLOCKLIGHT);
    }
    if (y + 1 < WORLD_H && newB.opacity === 0 && this.getLight(SKY, x, y + 1, z) === 15) {
      this.setLight(SKY, x, y, z, 15);
      this.addQueue.push(x, y, z, SKY);
    }
    this.processLight();
    void oldB;
  }

  // --- block mutation -------------------------------------------------------

  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_H) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return false;
    const i = idx(x & 15, y, z & 15);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.dirty = true;
    if (record) {
      const k = this.key(cx, cz);
      let m = this.edits.get(k);
      if (!m) { m = new Map(); this.edits.set(k, m); }
      m.set(i, id);
    }
    this.updateLightFor(x, y, z, old, id);
    this.dirtyAround(x, y, z);
    this.scheduleNeighborUpdates(x, y, z);
    return true;
  }

  dirtyAround(x, y, z) {
    const lx = x & 15, lz = z & 15;
    const cx = x >> 4, cz = z >> 4;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === 15) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === 15) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) {
    const c = this.chunks.get(this.key(cx, cz));
    if (c) c.dirty = true;
  }

  markNeighborsDirty(cx, cz) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.markDirty(cx + dx, cz + dz);
  }

  scheduleNeighborUpdates(x, y, z) {
    for (let f = 0; f < 6; f++) this.scheduleUpdate(x + NX[f], y + NY[f], z + NZ[f], 1);
    this.scheduleUpdate(x, y, z, 1);
  }

  scheduleUpdate(x, y, z, delay) {
    this.scheduled.push({ x, y, z, when: this.tickCount + delay });
  }

  // --- ticking --------------------------------------------------------------

  tickCount = 0;

  tick(dt) {
    this.time = (this.time + dt * 20) % 24000; // one full day ≈ 20 minutes
    this.tickAccum += dt;
    const step = 1 / 20;
    let ticks = 0;
    while (this.tickAccum >= step && ticks < 4) {
      this.tickAccum -= step;
      this.tickCount++;
      ticks++;
      this.runScheduled();
      this.randomTicks();
    }
  }

  runScheduled() {
    if (!this.scheduled.length) return;
    const due = [];
    const rest = [];
    for (const s of this.scheduled) (s.when <= this.tickCount ? due : rest).push(s);
    this.scheduled = rest;
    for (const s of due) this.blockUpdate(s.x, s.y, s.z);
  }

  blockUpdate(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR) return;
    const b = B.getBlock(id);
    if (b.gravity) {
      const below = this.getBlock(x, y - 1, z);
      if (below === B.AIR || B.getBlock(below).liquid) {
        this.setBlock(x, y, z, B.AIR);
        this.setBlock(x, y - 1, z, id);
        this.scheduleUpdate(x, y - 1, z, 2);
        return;
      }
    }
    if (b.placeOn) {
      const below = this.getBlock(x, y - 1, z);
      if (!B.canPlaceOn(id, below)) {
        this.setBlock(x, y, z, B.AIR);
        return;
      }
    }
    if (id === B.CACTUS) {
      const below = this.getBlock(x, y - 1, z);
      if (below !== B.SAND && below !== B.CACTUS) this.setBlock(x, y, z, B.AIR);
    }
    if (id === B.GRASS) {
      const above = this.getBlock(x, y + 1, z);
      if (B.getBlock(above).opacity >= 15) this.setBlock(x, y, z, B.DIRT);
    }
  }

  randomTicks() {
    // Grass spreading and sapling growth, sampled from loaded chunks.
    let n = 0;
    for (const c of this.chunks.values()) {
      if (!c.generated || n++ > 24) break;
      for (let i = 0; i < 3; i++) {
        const lx = (this.rnd() * CHUNK_W) | 0, lz = (this.rnd() * CHUNK_W) | 0;
        const y = (this.rnd() * (WORLD_H - 2)) | 0;
        const id = c.blocks[idx(lx, y, lz)];
        const wx = c.cx * CHUNK_W + lx, wz = c.cz * CHUNK_W + lz;
        if (id === B.DIRT) {
          if (B.getBlock(this.getBlock(wx, y + 1, wz)).opacity < 15 &&
            this.getLight(SKY, wx, y + 1, wz) > 8) {
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
              if (this.getBlock(wx + dx, y + dy, wz + dz) === B.GRASS) {
                this.setBlock(wx, y, wz, B.GRASS, false);
                break;
              }
            }
          }
        } else if (id === B.SAPLING) {
          if (this.getLight(SKY, wx, y + 1, wz) >= 9 && this.rnd() < 0.25) {
            this.setBlock(wx, y, wz, B.AIR, false);
            this.gen.oak(wx, y, wz, this.rnd, (px, py, pz, bid) => {
              if (this.getBlock(px, py, pz) === B.AIR) this.setBlock(px, py, pz, bid, false);
            });
          }
        }
      }
    }
  }

  // --- streaming ------------------------------------------------------------

  /** Loads chunks around the player, a few per frame, and drops distant ones. */
  updateChunks(px, pz, radius, budget = 2) {
    const ccx = Math.floor(px) >> 4;
    const ccz = Math.floor(pz) >> 4;
    let made = 0;
    for (let r = 0; r <= radius && made < budget; r++) {
      for (let dx = -r; dx <= r && made < budget; dx++) {
        for (let dz = -r; dz <= r && made < budget; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const k = this.key(ccx + dx, ccz + dz);
          if (this.chunks.has(k)) continue;
          this.ensureChunk(ccx + dx, ccz + dz);
          made++;
        }
      }
    }
    if (this.chunks.size > (radius * 2 + 5) ** 2) {
      for (const [k, c] of this.chunks) {
        if (Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz)) > radius + 2) {
          if (c.mesh && c.mesh.dispose) c.mesh.dispose();
          this.chunks.delete(k);
        }
      }
    }
    this.stats.chunks = this.chunks.size;
  }

  // --- queries --------------------------------------------------------------

  biomeAt(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return BIOME.PLAINS;
    return c.genBiome[(z & 15) * CHUNK_W + (x & 15)];
  }

  heightAt(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return this.gen.heightAt(x, z);
    return c.topAt(x & 15, z & 15);
  }

  isSolid(x, y, z) {
    return B.getBlock(this.getBlock(x, y, z)).solid;
  }

  /** Combined light 0..1 used for shading, taking time of day into account. */
  lightAt(x, y, z) {
    const sky = this.getLight(SKY, x, y, z);
    const bl = this.getLight(BLOCKLIGHT, x, y, z);
    return Math.max(sky * this.skyBrightness(), bl) / 15;
  }

  /** 0..1 daylight factor derived from world time. */
  skyBrightness() {
    const t = this.time / 24000;
    const a = Math.sin(t * Math.PI * 2 - Math.PI / 2);
    return Math.max(0.16, Math.min(1, a * 1.6 + 0.62));
  }

  isDay() { return this.skyBrightness() > 0.55; }

  /** Voxel DDA raycast. Returns hit block + face normal, or null. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, fluidsToo = false) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / dx), tDeltaY = Math.abs(1 / dy), tDeltaZ = Math.abs(1 / dz);
    let tMaxX = ((dx > 0 ? x + 1 - ox : ox - x)) * tDeltaX;
    let tMaxY = ((dy > 0 ? y + 1 - oy : oy - y)) * tDeltaY;
    let tMaxZ = ((dz > 0 ? z + 1 - oz : oz - z)) * tDeltaZ;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && (fluidsToo || !B.getBlock(id).liquid)) {
        return { x, y, z, id, nx, ny, nz, dist: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (y < 0 || y >= WORLD_H) return null;
    }
    return null;
  }

  /** Finds solid, dry ground near x,z by walking outward in rings. */
  findSpawn(x = 8, z = 8) {
    const test = (sx, sz) => {
      this.ensureChunk(sx >> 4, sz >> 4);
      const h = this.heightAt(sx, sz);
      const ground = this.getBlock(sx, h, sz);
      if (h <= SEA_LEVEL || !B.getBlock(ground).solid) return null;
      if (this.getBlock(sx, h + 1, sz) !== B.AIR) return null;
      return { x: sx + 0.5, y: h + 1.02, z: sz + 0.5 };
    };
    const first = test(x, z);
    if (first) return first;
    for (let r = 4; r <= 320; r += 4) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const sx = Math.round(x + Math.cos(ang) * r);
        const sz = Math.round(z + Math.sin(ang) * r);
        const s = test(sx, sz);
        if (s) return s;
      }
    }
    // Last resort: stand on top of whatever is at the origin column.
    this.ensureChunk(x >> 4, z >> 4);
    return { x: x + 0.5, y: Math.max(SEA_LEVEL, this.heightAt(x, z)) + 1.02, z: z + 0.5 };
  }

  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) {
      const arr = [];
      for (const [i, id] of m) arr.push(i, id);
      out[k] = arr;
    }
    return out;
  }

  loadEdits(obj) {
    this.edits.clear();
    for (const [k, arr] of Object.entries(obj || {})) {
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      this.edits.set(k, m);
    }
  }
}

export const NX = [-1, 1, 0, 0, 0, 0];
export const NY = [0, 0, -1, 1, 0, 0];
export const NZ = [0, 0, 0, 0, -1, 1];
export const CHANNEL_SKY = SKY;
export const CHANNEL_BLOCK = BLOCKLIGHT;
