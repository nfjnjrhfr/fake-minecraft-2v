// Procedurally synthesized 16x16 texture atlas: no binary assets, everything
// (blocks and item icons) is drawn pixel by pixel at load time.

import { mulberry32 } from './noise.js';

export const TILE_PX = 16;
export const ATLAS_COLS = 16;
export const ATLAS_PX = TILE_PX * ATLAS_COLS;

const tileNames = [];
const drawers = [];

/** Registers a tile drawer, returns its atlas index. */
function tile(name, fn) {
  const idx = tileNames.length;
  tileNames.push(name);
  drawers.push(fn);
  return idx;
}

// --- tiny pixel helpers -----------------------------------------------------

class TileCanvas {
  constructor(data, ox, oy, seed) {
    this.data = data;
    this.ox = ox;
    this.oy = oy;
    this.rnd = mulberry32(seed);
  }
  set(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = ((this.oy + y) * ATLAS_PX + (this.ox + x)) * 4;
    this.data[i] = r | 0; this.data[i + 1] = g | 0; this.data[i + 2] = b | 0; this.data[i + 3] = a | 0;
  }
  get(x, y) {
    const i = ((this.oy + y) * ATLAS_PX + (this.ox + x)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  clear() {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) this.set(x, y, 0, 0, 0, 0);
  }
  /** Fills the tile with a base colour plus per-pixel value noise. */
  fillNoise(c, amount, mono = true) {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (mono) {
          const d = (this.rnd() - 0.5) * 2 * amount;
          this.set(x, y, c[0] + d, c[1] + d, c[2] + d);
        } else {
          this.set(x, y,
            c[0] + (this.rnd() - 0.5) * 2 * amount,
            c[1] + (this.rnd() - 0.5) * 2 * amount,
            c[2] + (this.rnd() - 0.5) * 2 * amount);
        }
      }
    }
  }
  rect(x, y, w, h, c, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c[0], c[1], c[2], a);
  }
  speckle(count, c, amount = 0) {
    for (let i = 0; i < count; i++) {
      const x = (this.rnd() * TILE_PX) | 0, y = (this.rnd() * TILE_PX) | 0;
      const d = amount ? (this.rnd() - 0.5) * 2 * amount : 0;
      this.set(x, y, c[0] + d, c[1] + d, c[2] + d);
    }
  }
  blob(cx, cy, r, c, wobble = 0.35, a = 255) {
    for (let y = -r - 1; y <= r + 1; y++) {
      for (let x = -r - 1; x <= r + 1; x++) {
        const d = Math.hypot(x, y) + (this.rnd() - 0.5) * wobble * 2;
        if (d <= r) {
          const sh = 1 - 0.18 * (d / Math.max(r, 0.001));
          this.set(cx + x, cy + y, c[0] * sh, c[1] * sh, c[2] * sh, a);
        }
      }
    }
  }
  line(x0, y0, x1, y1, c, thick = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let j = 0; j < thick; j++) this.set(x + j, y, c[0], c[1], c[2], 255);
    }
  }
  shade(x, y, f) {
    const p = this.get(x, y);
    if (p[3] === 0) return;
    this.set(x, y, p[0] * f, p[1] * f, p[2] * f, p[3]);
  }
}

// --- block tiles ------------------------------------------------------------

export const T = {};

T.stone = tile('stone', (t) => {
  t.fillNoise([124, 124, 124], 12);
  for (let i = 0; i < 10; i++) {
    const x = (t.rnd() * 16) | 0, y = (t.rnd() * 16) | 0;
    t.rect(x, y, 1 + ((t.rnd() * 2) | 0), 1, [105, 105, 105]);
  }
});

T.dirt = tile('dirt', (t) => {
  t.fillNoise([134, 96, 67], 14);
  t.speckle(28, [112, 78, 52], 8);
});

T.grassTop = tile('grass_top', (t) => {
  t.fillNoise([96, 158, 62], 16);
  t.speckle(30, [116, 176, 74], 10);
});

T.grassSide = tile('grass_side', (t) => {
  t.fillNoise([134, 96, 67], 14);
  t.speckle(20, [112, 78, 52], 8);
  for (let x = 0; x < 16; x++) {
    const h = 3 + ((t.rnd() * 3) | 0);
    for (let y = 0; y < h; y++) {
      const d = (t.rnd() - 0.5) * 24;
      t.set(x, y, 96 + d, 158 + d, 62 + d);
    }
  }
});

T.cobble = tile('cobblestone', (t) => {
  t.fillNoise([104, 104, 104], 8);
  const cells = [[1, 1, 6, 5], [8, 1, 6, 4], [1, 7, 4, 7], [6, 6, 8, 4], [6, 11, 4, 4], [11, 11, 4, 4], [11, 6, 4, 4]];
  for (const [x, y, w, h] of cells) {
    const base = 118 + (t.rnd() - 0.5) * 26;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const edge = (i === 0 || j === 0 || i === w - 1 || j === h - 1) ? 0.72 : 1;
        const d = (t.rnd() - 0.5) * 12;
        t.set(x + i, y + j, (base + d) * edge, (base + d) * edge, (base + d) * edge);
      }
    }
  }
});

T.planks = tile('planks', (t) => {
  t.fillNoise([162, 130, 78], 8);
  for (let y = 0; y < 16; y++) {
    if (y % 4 === 3) t.rect(0, y, 16, 1, [116, 90, 52]);
    else for (let x = 0; x < 16; x++) if (t.rnd() < 0.16) t.set(x, y, 146, 116, 68);
  }
  t.rect(5, 0, 1, 3, [128, 100, 58]);
  t.rect(11, 4, 1, 3, [128, 100, 58]);
  t.rect(2, 8, 1, 3, [128, 100, 58]);
});

T.bedrock = tile('bedrock', (t) => {
  t.fillNoise([70, 70, 70], 22);
  for (let i = 0; i < 14; i++) {
    const x = (t.rnd() * 14) | 0, y = (t.rnd() * 14) | 0;
    t.rect(x, y, 2, 2, [38, 38, 38]);
  }
});

T.water = tile('water', (t) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const w = Math.sin((x + y * 0.6) * 0.8) * 8 + Math.sin(x * 0.35 - y * 0.9) * 6;
      t.set(x, y, 42 + w, 92 + w, 196 + w, 190);
    }
  }
});

T.sand = tile('sand', (t) => {
  t.fillNoise([219, 207, 152], 10);
  t.speckle(24, [200, 188, 134], 6);
});

T.gravel = tile('gravel', (t) => {
  t.fillNoise([126, 122, 120], 16);
  for (let i = 0; i < 18; i++) t.blob((t.rnd() * 16) | 0, (t.rnd() * 16) | 0, 1 + t.rnd(), [150, 146, 142], 0.4);
  for (let i = 0; i < 10; i++) t.blob((t.rnd() * 16) | 0, (t.rnd() * 16) | 0, 1 + t.rnd(), [98, 94, 92], 0.4);
});

T.logSide = tile('log_side', (t) => {
  t.fillNoise([104, 78, 46], 10);
  for (let x = 0; x < 16; x++) {
    if (t.rnd() < 0.42) {
      const c = t.rnd() < 0.5 ? [84, 62, 36] : [124, 94, 56];
      const y0 = (t.rnd() * 8) | 0, len = 5 + ((t.rnd() * 10) | 0);
      for (let y = y0; y < Math.min(16, y0 + len); y++) t.set(x, y, c[0], c[1], c[2]);
    }
  }
});

T.logTop = tile('log_top', (t) => {
  t.fillNoise([160, 128, 78], 8);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const ring = Math.sin(d * 2.4) * 0.5 + 0.5;
      const v = 150 + ring * 26;
      t.set(x, y, v, v * 0.79, v * 0.48);
      if (d > 7.2) t.set(x, y, 104, 78, 46);
    }
  }
});

T.leaves = tile('leaves', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (t.rnd() < 0.14) continue; // gaps let light through
      const d = (t.rnd() - 0.5) * 40;
      t.set(x, y, 52 + d, 118 + d, 40 + d, 255);
    }
  }
});

T.glass = tile('glass', (t) => {
  t.clear();
  t.rect(0, 0, 16, 1, [206, 232, 238], 210);
  t.rect(0, 15, 16, 1, [206, 232, 238], 210);
  t.rect(0, 0, 1, 16, [206, 232, 238], 210);
  t.rect(15, 0, 1, 16, [206, 232, 238], 210);
  t.line(3, 12, 11, 4, [235, 250, 255], 1);
  t.line(6, 12, 12, 6, [225, 244, 250], 1);
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) if (t.rnd() < 0.05) t.set(x, y, 220, 240, 246, 90);
});

T.sandstoneTop = tile('sandstone_top', (t) => {
  t.fillNoise([224, 213, 160], 7);
});

T.sandstoneSide = tile('sandstone_side', (t) => {
  t.fillNoise([224, 213, 160], 7);
  for (const y of [3, 4, 9, 10, 14]) t.rect(0, y, 16, 1, [204, 192, 140]);
  t.speckle(20, [212, 200, 148], 6);
});

function oreTile(name, gem, dark) {
  return tile(name, (t) => {
    t.fillNoise([124, 124, 124], 12);
    const spots = [[4, 4, 2], [10, 6, 2], [6, 11, 2], [12, 12, 1], [2, 9, 1]];
    for (const [x, y, r] of spots) {
      t.blob(x, y, r, gem, 0.5);
      t.set(x - r, y, dark[0], dark[1], dark[2]);
      t.set(x, y + r, dark[0], dark[1], dark[2]);
    }
  });
}

T.coalOre = oreTile('coal_ore', [42, 42, 42], [18, 18, 18]);
T.ironOre = oreTile('iron_ore', [200, 160, 130], [140, 100, 76]);
T.goldOre = oreTile('gold_ore', [250, 214, 78], [190, 152, 40]);
T.diamondOre = oreTile('diamond_ore', [110, 236, 232], [60, 176, 178]);
T.redstoneOre = oreTile('redstone_ore', [222, 40, 40], [150, 20, 20]);

T.torch = tile('torch', (t) => {
  t.clear();
  t.rect(7, 8, 2, 8, [126, 94, 54]);
  t.rect(7, 7, 2, 1, [96, 70, 40]);
  t.rect(6, 4, 4, 3, [255, 190, 60]);
  t.rect(7, 3, 2, 1, [255, 232, 150]);
  t.rect(6, 6, 4, 1, [232, 140, 40]);
});

T.craftingTop = tile('crafting_table_top', (t) => {
  t.fillNoise([156, 122, 72], 8);
  t.rect(0, 0, 16, 1, [104, 80, 46]);
  t.rect(0, 15, 16, 1, [104, 80, 46]);
  t.rect(0, 0, 1, 16, [104, 80, 46]);
  t.rect(15, 0, 1, 16, [104, 80, 46]);
  for (let i = 1; i < 4; i++) {
    t.rect(i * 4, 1, 1, 14, [120, 92, 54]);
    t.rect(1, i * 4, 14, 1, [120, 92, 54]);
  }
});

T.craftingSide = tile('crafting_table_side', (t) => {
  t.fillNoise([162, 130, 78], 8);
  t.rect(0, 0, 16, 4, [126, 96, 56]);
  t.rect(0, 4, 16, 1, [96, 72, 42]);
  for (let i = 0; i < 5; i++) t.rect(2 + i * 3, 6, 2, 8, [132, 102, 60]);
  t.rect(0, 14, 16, 2, [110, 84, 50]);
});

T.furnaceFront = tile('furnace_front', (t) => {
  t.fillNoise([108, 108, 108], 10);
  t.rect(3, 6, 10, 8, [58, 58, 58]);
  t.rect(4, 9, 8, 4, [42, 42, 42]);
  t.rect(3, 5, 10, 1, [140, 140, 140]);
});

T.furnaceFrontLit = tile('furnace_front_lit', (t) => {
  t.fillNoise([108, 108, 108], 10);
  t.rect(3, 6, 10, 8, [58, 58, 58]);
  t.rect(4, 9, 8, 4, [232, 130, 30]);
  t.rect(5, 11, 6, 2, [255, 208, 90]);
  t.rect(3, 5, 10, 1, [140, 140, 140]);
});

T.furnaceSide = tile('furnace_side', (t) => {
  t.fillNoise([108, 108, 108], 10);
  t.speckle(24, [92, 92, 92], 6);
});

T.furnaceTop = tile('furnace_top', (t) => {
  t.fillNoise([112, 112, 112], 8);
  t.rect(4, 4, 8, 8, [88, 88, 88]);
  t.rect(5, 5, 6, 6, [70, 70, 70]);
});

T.snow = tile('snow', (t) => {
  t.fillNoise([246, 250, 252], 6);
  t.speckle(20, [232, 240, 246], 4);
});

T.ice = tile('ice', (t) => {
  t.fillNoise([150, 196, 244], 10);
  t.line(2, 13, 9, 3, [200, 228, 252], 1);
  t.line(8, 14, 14, 7, [200, 228, 252], 1);
  for (let i = 0; i < 6; i++) t.set((t.rnd() * 16) | 0, (t.rnd() * 16) | 0, 220, 240, 255);
});

T.cactusSide = tile('cactus_side', (t) => {
  t.fillNoise([60, 128, 56], 8);
  t.rect(0, 0, 1, 16, [42, 100, 40]);
  t.rect(15, 0, 1, 16, [42, 100, 40]);
  for (let y = 1; y < 16; y += 4) {
    t.set(3, y, 210, 214, 160); t.set(11, y + 2, 210, 214, 160);
  }
});

T.cactusTop = tile('cactus_top', (t) => {
  t.fillNoise([74, 146, 66], 8);
  t.blob(8, 8, 4, [92, 168, 80], 0.4);
});

T.bricks = tile('bricks', (t) => {
  t.fillNoise([182, 180, 176], 4); // mortar
  const brick = [158, 78, 62];
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 4 : 0;
    for (let i = -1; i < 3; i++) {
      const x = off + i * 8;
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 7; k++) {
          const d = (t.rnd() - 0.5) * 16;
          t.set(x + k, row * 4 + j, brick[0] + d, brick[1] + d, brick[2] + d);
        }
      }
    }
  }
});

T.obsidian = tile('obsidian', (t) => {
  t.fillNoise([22, 16, 34], 8);
  t.speckle(20, [58, 44, 84], 12);
  t.speckle(8, [96, 76, 132], 10);
});

T.glowstone = tile('glowstone', (t) => {
  t.fillNoise([176, 140, 78], 10);
  for (let i = 0; i < 12; i++) t.blob((t.rnd() * 16) | 0, (t.rnd() * 16) | 0, 1 + t.rnd() * 1.5, [255, 224, 140], 0.4);
});

T.stoneBricks = tile('stone_bricks', (t) => {
  t.fillNoise([122, 122, 122], 8);
  for (const y of [0, 8]) t.rect(0, y, 16, 1, [96, 96, 96]);
  t.rect(0, 7, 16, 1, [96, 96, 96]);
  t.rect(0, 15, 16, 1, [96, 96, 96]);
  t.rect(7, 1, 1, 6, [96, 96, 96]);
  t.rect(3, 9, 1, 6, [96, 96, 96]);
  t.rect(12, 9, 1, 6, [96, 96, 96]);
  t.speckle(20, [138, 138, 138], 8);
});

T.wool = tile('wool', (t) => {
  t.fillNoise([236, 236, 236], 8);
  t.speckle(40, [218, 218, 218], 6);
});

T.flowerRed = tile('flower_red', (t) => {
  t.clear();
  t.rect(7, 8, 1, 8, [62, 128, 48]);
  t.set(6, 11, 62, 128, 48); t.set(9, 10, 62, 128, 48);
  t.blob(7, 5, 3, [206, 54, 54], 0.3);
  t.set(7, 5, 250, 226, 120);
});

T.flowerYellow = tile('flower_yellow', (t) => {
  t.clear();
  t.rect(8, 8, 1, 8, [62, 128, 48]);
  t.set(7, 12, 62, 128, 48);
  t.blob(8, 5, 3, [238, 208, 60], 0.3);
  t.set(8, 5, 210, 150, 40);
});

T.tallGrass = tile('tall_grass', (t) => {
  t.clear();
  for (let i = 0; i < 7; i++) {
    const x = 1 + ((t.rnd() * 14) | 0);
    const h = 5 + ((t.rnd() * 8) | 0);
    const d = (t.rnd() - 0.5) * 30;
    for (let y = 15; y > 15 - h; y--) {
      const bend = Math.round((15 - y) * 0.22 * (t.rnd() < 0.5 ? -1 : 1));
      t.set(x + bend, y, 74 + d, 140 + d, 50 + d);
    }
  }
});

T.deadBush = tile('dead_bush', (t) => {
  t.clear();
  const c = [132, 100, 52];
  t.line(8, 15, 8, 6, c, 1);
  t.line(8, 10, 4, 6, c, 1);
  t.line(8, 12, 12, 8, c, 1);
  t.line(8, 8, 11, 4, c, 1);
});

T.sapling = tile('sapling', (t) => {
  t.clear();
  t.rect(7, 10, 1, 6, [104, 78, 46]);
  t.blob(7, 7, 3, [60, 130, 44], 0.5);
  t.blob(9, 9, 2, [72, 148, 52], 0.5);
});

// Progressive break overlay ("cracks"), drawn on top of the block being mined.
T.cracks = [];
for (let stage = 0; stage < 5; stage++) {
  T.cracks.push(tile(`destroy_${stage}`, (t) => {
    t.clear();
    const branches = 1 + stage * 2;
    for (let b = 0; b < branches; b++) {
      let x = 2 + ((t.rnd() * 12) | 0);
      let y = 2 + ((t.rnd() * 12) | 0);
      const len = 4 + stage * 2 + ((t.rnd() * 4) | 0);
      let dx = t.rnd() < 0.5 ? 1 : -1;
      let dy = t.rnd() < 0.5 ? 1 : -1;
      for (let i = 0; i < len; i++) {
        t.set(x, y, 20, 20, 20, 210);
        if (t.rnd() < 0.5) x += dx; else y += dy;
        if (t.rnd() < 0.2) dx = -dx;
        if (t.rnd() < 0.2) dy = -dy;
        x = Math.max(0, Math.min(15, x));
        y = Math.max(0, Math.min(15, y));
      }
    }
  }));
}

// --- item icons -------------------------------------------------------------

const MATERIALS = {
  wood: [154, 118, 66],
  stone: [130, 130, 130],
  iron: [216, 216, 220],
  gold: [250, 210, 70],
  diamond: [104, 232, 226],
};

function handle(t) {
  const c = [124, 92, 52];
  for (let i = 0; i < 9; i++) {
    t.set(3 + i, 12 - i, c[0], c[1], c[2]);
    t.set(4 + i, 12 - i, c[0] * 0.82, c[1] * 0.82, c[2] * 0.82);
  }
}

function toolTile(name, kind, matName) {
  return tile(name, (t) => {
    t.clear();
    const m = MATERIALS[matName];
    const dark = [m[0] * 0.72, m[1] * 0.72, m[2] * 0.72];
    if (kind === 'sword') {
      for (let i = 0; i < 10; i++) {
        t.set(4 + i, 11 - i, m[0], m[1], m[2]);
        t.set(5 + i, 11 - i, dark[0], dark[1], dark[2]);
      }
      t.set(14, 1, m[0], m[1], m[2]);
      const g = [110, 82, 46];
      t.line(2, 12, 6, 8, g, 1);
      t.set(3, 14, 92, 68, 38); t.set(2, 15, 92, 68, 38); t.set(4, 13, 92, 68, 38);
      return;
    }
    handle(t);
    if (kind === 'pickaxe') {
      const pts = [[6, 6], [7, 5], [8, 4], [9, 3], [10, 3], [11, 3], [12, 4], [13, 5], [14, 6]];
      for (const [x, y] of pts) {
        t.set(x, y, m[0], m[1], m[2]);
        t.set(x, y + 1, dark[0], dark[1], dark[2]);
      }
      t.set(10, 4, m[0], m[1], m[2]); t.set(11, 4, m[0], m[1], m[2]);
    } else if (kind === 'axe') {
      for (let y = 3; y <= 8; y++) {
        const w = y <= 5 ? 5 : 8 - y + 2;
        for (let x = 0; x < w; x++) {
          const c = x === w - 1 ? dark : m;
          t.set(9 + x, y, c[0], c[1], c[2]);
        }
      }
      t.set(8, 4, m[0], m[1], m[2]); t.set(8, 5, m[0], m[1], m[2]);
    } else if (kind === 'shovel') {
      for (let y = 3; y <= 7; y++) {
        for (let x = 9; x <= 12; x++) {
          if ((y === 3 || y === 7) && (x === 9 || x === 12)) continue;
          const c = (x === 12 || y === 7) ? dark : m;
          t.set(x, y, c[0], c[1], c[2]);
        }
      }
    }
  });
}

T.items = {};
for (const mat of ['wood', 'stone', 'iron', 'gold', 'diamond']) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
    T.items[`${mat}_${kind}`] = toolTile(`${mat}_${kind}`, kind, mat);
  }
}

T.items.stick = tile('stick', (t) => {
  t.clear();
  for (let i = 0; i < 9; i++) {
    t.set(4 + i, 12 - i, 140, 104, 58);
    t.set(5 + i, 12 - i, 112, 82, 46);
  }
});

T.items.coal = tile('coal_item', (t) => {
  t.clear();
  t.blob(8, 8, 4.4, [38, 38, 38], 0.7);
  t.blob(6, 6, 1.4, [72, 72, 72], 0.4);
});

T.items.diamond = tile('diamond_item', (t) => {
  t.clear();
  for (let y = 3; y <= 12; y++) {
    const w = y <= 7 ? y - 2 : 12 - y + 3;
    for (let x = -w; x <= w; x++) t.set(8 + x, y, 96, 226, 222);
  }
  t.rect(6, 6, 2, 2, [180, 250, 248]);
  t.rect(9, 8, 2, 2, [56, 176, 176]);
});

function ingotTile(name, c) {
  return tile(name, (t) => {
    t.clear();
    for (let y = 5; y <= 11; y++) {
      const inset = y <= 6 ? 4 : y >= 11 ? 2 : 3;
      for (let x = inset; x < 16 - inset; x++) {
        const hi = y <= 7 ? 1.15 : y >= 10 ? 0.8 : 1;
        t.set(x, y, Math.min(255, c[0] * hi), Math.min(255, c[1] * hi), Math.min(255, c[2] * hi));
      }
    }
  });
}

T.items.ironIngot = ingotTile('iron_ingot', [214, 214, 218]);
T.items.goldIngot = ingotTile('gold_ingot', [246, 206, 66]);

T.items.apple = tile('apple', (t) => {
  t.clear();
  t.blob(7, 9, 4.6, [198, 44, 42], 0.3);
  t.blob(9, 9, 3.6, [176, 32, 32], 0.3);
  t.rect(8, 3, 1, 3, [110, 78, 40]);
  t.blob(10, 4, 1.6, [72, 156, 56], 0.3);
  t.set(5, 7, 240, 130, 120);
});

T.items.rawMeat = tile('raw_meat', (t) => {
  t.clear();
  t.blob(8, 8, 5, [226, 132, 138], 0.6);
  t.blob(7, 7, 2.2, [244, 168, 172], 0.5);
  t.blob(10, 10, 1.8, [196, 96, 104], 0.5);
});

T.items.cookedMeat = tile('cooked_meat', (t) => {
  t.clear();
  t.blob(8, 8, 5, [176, 118, 62], 0.6);
  t.blob(7, 7, 2.2, [208, 152, 86], 0.5);
  t.blob(10, 10, 1.8, [138, 88, 44], 0.5);
});

T.items.bread = tile('bread', (t) => {
  t.clear();
  t.blob(8, 8, 5.2, [190, 140, 68], 0.5);
  for (let i = 0; i < 3; i++) t.line(5 + i * 2, 5, 6 + i * 2, 11, [156, 110, 52], 1);
});

T.items.wheat = tile('wheat', (t) => {
  t.clear();
  t.line(8, 15, 8, 4, [214, 190, 92], 1);
  for (let i = 0; i < 5; i++) {
    t.set(7, 5 + i * 2, 238, 214, 110);
    t.set(9, 6 + i * 2, 238, 214, 110);
  }
});

// --- atlas assembly ---------------------------------------------------------

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(ATLAS_PX, ATLAS_PX);
  for (let i = 0; i < drawers.length; i++) {
    const ox = (i % ATLAS_COLS) * TILE_PX;
    const oy = ((i / ATLAS_COLS) | 0) * TILE_PX;
    const tc = new TileCanvas(img.data, ox, oy, 1337 + i * 7919);
    tc.clear();
    drawers[i](tc);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, imageData: img, count: drawers.length, names: tileNames };
}

export function tileUV(index) {
  const inset = 0.0002;
  const c = index % ATLAS_COLS;
  const r = (index / ATLAS_COLS) | 0;
  const s = 1 / ATLAS_COLS;
  return { u0: c * s + inset, v0: r * s + inset, u1: (c + 1) * s - inset, v1: (r + 1) * s - inset };
}
