// Terrain generation: continents, biomes, caves, ores and surface decoration.

import { Perlin, mulberry32, hash2i } from './noise.js';
import * as B from './blocks.js';

export const CHUNK_W = 16;
export const WORLD_H = 128;
export const SEA_LEVEL = 62;

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, MOUNTAIN: 5, SNOWY: 6,
};
export const BIOME_NAME = ['海洋', '沙灘', '平原', '森林', '沙漠', '山地', '雪原'];

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.pCont = new Perlin(seed + 1);
    this.pHill = new Perlin(seed + 2);
    this.pMount = new Perlin(seed + 3);
    this.pTemp = new Perlin(seed + 4);
    this.pHum = new Perlin(seed + 5);
    this.pCaveA = new Perlin(seed + 6);
    this.pCaveB = new Perlin(seed + 7);
    this.pCheese = new Perlin(seed + 8);
    this.pOre = [new Perlin(seed + 9), new Perlin(seed + 10), new Perlin(seed + 11), new Perlin(seed + 12)];
    this.pDirt = new Perlin(seed + 13);
  }

  heightAt(x, z) {
    const cont = this.pCont.fbm2(x * 0.0015, z * 0.0015, 4);
    const hill = this.pHill.fbm2(x * 0.011, z * 0.011, 4) * 6;
    let mfac = this.pMount.fbm2(x * 0.0031, z * 0.0031, 3);
    mfac = Math.max(0, mfac - 0.08) * 1.4;
    const ridge = Math.abs(this.pMount.fbm2(x * 0.0062 + 40, z * 0.0062 - 17, 4));
    const mountain = mfac * mfac * (1 - ridge) * 62;
    let h = SEA_LEVEL + cont * 26 + hill + mountain;
    if (h < SEA_LEVEL) h = SEA_LEVEL - (SEA_LEVEL - h) * 0.75; // flatter ocean floors
    return Math.max(3, Math.min(WORLD_H - 8, Math.round(h)));
  }

  biomeAt(x, z, h) {
    const temp = this.pTemp.fbm2(x * 0.0009 + 500, z * 0.0009 - 500, 3);
    const hum = this.pHum.fbm2(x * 0.0011 - 800, z * 0.0011 + 800, 3);
    if (h < SEA_LEVEL - 1) return BIOME.OCEAN;
    if (h > SEA_LEVEL + 34) return BIOME.MOUNTAIN;
    if (h <= SEA_LEVEL + 2) return BIOME.BEACH;
    if (temp < -0.32) return BIOME.SNOWY;
    if (temp > 0.22 && hum < -0.02) return BIOME.DESERT;
    if (hum > 0.12) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  isCave(x, y, z) {
    if (y < 4 || y > 100) return false;
    const a = this.pCaveA.noise3(x * 0.021, y * 0.038, z * 0.021);
    const b = this.pCaveB.noise3(x * 0.021, y * 0.038, z * 0.021);
    if (a * a + b * b < 0.0016) return true;
    if (y < 46) {
      const c = this.pCheese.fbm3(x * 0.035, y * 0.06, z * 0.035, 3);
      if (c > 0.56) return true;
    }
    return false;
  }

  oreAt(x, y, z) {
    if (y <= 16 && this.pOre[3].noise3(x * 0.13, y * 0.13, z * 0.13) > 0.80) return B.DIAMOND_ORE;
    if (y <= 32 && this.pOre[2].noise3(x * 0.12, y * 0.12, z * 0.12) > 0.79) return B.GOLD_ORE;
    if (y <= 64 && this.pOre[1].noise3(x * 0.10, y * 0.10, z * 0.10) > 0.74) return B.IRON_ORE;
    if (y <= 96 && this.pOre[0].noise3(x * 0.09, y * 0.09, z * 0.09) > 0.70) return B.COAL_ORE;
    return 0;
  }

  /** Fills a chunk's block array. `place` writes blocks that may cross borders. */
  generateChunk(chunk, place) {
    const bx = chunk.cx * CHUNK_W;
    const bz = chunk.cz * CHUNK_W;
    const blocks = chunk.blocks;
    const heights = chunk.genHeight;
    const biomes = chunk.genBiome;

    for (let lz = 0; lz < CHUNK_W; lz++) {
      for (let lx = 0; lx < CHUNK_W; lx++) {
        const wx = bx + lx, wz = bz + lz;
        const h = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, h);
        heights[lz * CHUNK_W + lx] = h;
        biomes[lz * CHUNK_W + lx] = biome;

        const dirtDepth = 3 + Math.round(this.pDirt.noise2(wx * 0.08, wz * 0.08) * 2);
        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          const i = (y << 8) | (lz << 4) | lx;
          let id = B.AIR;
          if (y <= 1 || (y === 2 && hash2i(wx, wz * 31 + y, this.seed) < 0.6)) {
            id = B.BEDROCK;
          } else if (y <= h) {
            const depth = h - y;
            id = B.STONE;
            if (biome === BIOME.DESERT) {
              if (depth < 4) id = B.SAND;
              else if (depth < 8) id = B.SANDSTONE;
            } else if (biome === BIOME.OCEAN || biome === BIOME.BEACH) {
              if (depth < 4) id = (biome === BIOME.OCEAN && depth === 0 && h < SEA_LEVEL - 6
                && this.pDirt.noise2(wx * 0.2, wz * 0.2) > 0.3) ? B.GRAVEL : B.SAND;
            } else if (biome === BIOME.MOUNTAIN) {
              if (h > 96) id = depth === 0 ? B.SNOW : B.STONE;
              else if (depth === 0) id = B.GRASS;
              else if (depth < dirtDepth) id = B.DIRT;
            } else if (biome === BIOME.SNOWY) {
              if (depth === 0) id = B.SNOW;
              else if (depth < dirtDepth) id = B.DIRT;
            } else {
              if (depth === 0) id = h < SEA_LEVEL ? B.DIRT : B.GRASS;
              else if (depth < dirtDepth) id = B.DIRT;
            }
            if (id === B.STONE) {
              const ore = this.oreAt(wx, y, wz);
              if (ore) id = ore;
            }
            if (y > 2 && this.isCave(wx, y, wz)) id = y < 11 ? B.AIR : B.AIR;
          } else if (y <= SEA_LEVEL) {
            id = B.WATER;
          }
          blocks[i] = id;
        }
        // A cave that broke the surface leaves the top block floating; tidy it up.
        if (h > SEA_LEVEL) {
          const topIdx = (h << 8) | (lz << 4) | lx;
          if (blocks[topIdx] === B.AIR) {
            for (let y = h - 1; y > 2; y--) {
              const i = (y << 8) | (lz << 4) | lx;
              if (blocks[i] !== B.AIR) {
                if (blocks[i] === B.STONE && biome !== BIOME.MOUNTAIN && biome !== BIOME.DESERT) {
                  blocks[i] = B.GRASS;
                }
                break;
              }
            }
          }
        }
      }
    }
    this.decorate(chunk, place);
  }

  decorate(chunk, place) {
    const bx = chunk.cx * CHUNK_W;
    const bz = chunk.cz * CHUNK_W;
    const rnd = mulberry32((Math.imul(chunk.cx, 341873128) ^ Math.imul(chunk.cz, 132897987) ^ this.seed) >>> 0);

    const topOf = (lx, lz) => {
      const h = chunk.genHeight[lz * CHUNK_W + lx];
      return h;
    };

    const treeCounts = {
      [BIOME.FOREST]: 9, [BIOME.PLAINS]: 1, [BIOME.MOUNTAIN]: 1,
      [BIOME.SNOWY]: 3, [BIOME.DESERT]: 0, [BIOME.BEACH]: 0, [BIOME.OCEAN]: 0,
    };

    // Trees
    const attempts = 14;
    for (let i = 0; i < attempts; i++) {
      const lx = (rnd() * CHUNK_W) | 0;
      const lz = (rnd() * CHUNK_W) | 0;
      const biome = chunk.genBiome[lz * CHUNK_W + lx];
      const density = treeCounts[biome] ?? 0;
      if (rnd() > density / attempts) continue;
      const h = topOf(lx, lz);
      if (h < SEA_LEVEL + 1) continue;
      const ground = chunk.blocks[(h << 8) | (lz << 4) | lx];
      if (ground !== B.GRASS && ground !== B.SNOW && ground !== B.DIRT) continue;
      if (chunk.blocks[((h + 1) << 8) | (lz << 4) | lx] !== B.AIR) continue;
      if (biome === BIOME.SNOWY) this.spruce(bx + lx, h + 1, bz + lz, rnd, place);
      else this.oak(bx + lx, h + 1, bz + lz, rnd, place);
    }

    // Cacti + dead bushes
    for (let i = 0; i < 10; i++) {
      const lx = (rnd() * CHUNK_W) | 0, lz = (rnd() * CHUNK_W) | 0;
      if (chunk.genBiome[lz * CHUNK_W + lx] !== BIOME.DESERT) continue;
      const h = topOf(lx, lz);
      if (h < SEA_LEVEL + 1) continue;
      if (chunk.blocks[(h << 8) | (lz << 4) | lx] !== B.SAND) continue;
      if (rnd() < 0.35) {
        const tall = 2 + ((rnd() * 2) | 0);
        for (let y = 1; y <= tall; y++) place(bx + lx, h + y, bz + lz, B.CACTUS);
      } else if (rnd() < 0.4) {
        place(bx + lx, h + 1, bz + lz, B.DEAD_BUSH);
      }
    }

    // Grass and flowers
    for (let i = 0; i < 90; i++) {
      const lx = (rnd() * CHUNK_W) | 0, lz = (rnd() * CHUNK_W) | 0;
      const biome = chunk.genBiome[lz * CHUNK_W + lx];
      if (biome === BIOME.OCEAN || biome === BIOME.DESERT || biome === BIOME.BEACH) continue;
      const h = topOf(lx, lz);
      if (h < SEA_LEVEL + 1) continue;
      const idx = (h << 8) | (lz << 4) | lx;
      if (chunk.blocks[idx] !== B.GRASS) continue;
      if (chunk.blocks[((h + 1) << 8) | (lz << 4) | lx] !== B.AIR) continue;
      const r = rnd();
      const density = biome === BIOME.PLAINS ? 0.55 : biome === BIOME.FOREST ? 0.4 : 0.2;
      if (r > density) continue;
      if (r < density * 0.08) place(bx + lx, h + 1, bz + lz, B.FLOWER_RED);
      else if (r < density * 0.16) place(bx + lx, h + 1, bz + lz, B.FLOWER_YELLOW);
      else place(bx + lx, h + 1, bz + lz, B.TALL_GRASS);
    }
  }

  oak(x, y, z, rnd, place) {
    const height = 4 + ((rnd() * 3) | 0);
    for (let i = 0; i < height; i++) place(x, y + i, z, B.LOG);
    const top = y + height;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= -1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < 0) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && (rnd() < 0.55 || dy === 1)) continue;
          place(x + dx, top + dy, z + dz, B.LEAVES);
        }
      }
    }
  }

  spruce(x, y, z, rnd, place) {
    const height = 6 + ((rnd() * 4) | 0);
    for (let i = 0; i < height; i++) place(x, y + i, z, B.LOG);
    let r = 2;
    for (let dy = height - 1; dy >= 2; dy--) {
      const radius = ((height - dy) % 4 === 0) ? r : Math.max(1, r - 1);
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
          place(x + dx, y + dy, z + dz, B.LEAVES);
        }
      }
      if ((height - dy) % 4 === 3) r = r === 2 ? 1 : 2;
    }
    place(x, y + height, z, B.LEAVES);
    place(x, y + height - 1, z, B.LEAVES);
  }
}
