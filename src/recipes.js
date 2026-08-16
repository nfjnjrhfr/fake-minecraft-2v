// Crafting and smelting recipes plus the grid matcher.

import * as B from './blocks.js';
import { stack } from './inventory.js';

const shaped = [];
const shapeless = [];

function S(pattern, key, result, count = 1) {
  shaped.push({ pattern, key, result, count });
}
function SL(ingredients, result, count = 1) {
  shapeless.push({ ingredients, result, count });
}

// Wood chain
SL([B.LOG], B.PLANKS, 4);
S(['#', '#'], { '#': B.PLANKS }, B.STICK, 4);
S(['##', '##'], { '#': B.PLANKS }, B.CRAFTING_TABLE, 1);
S(['###', '# #', '###'], { '#': B.COBBLESTONE }, B.FURNACE, 1);
S(['C', 'S'], { C: B.COAL, S: B.STICK }, B.TORCH, 4);
S(['##', '##'], { '#': B.STONE }, B.STONE_BRICKS, 4);
S(['###'], { '#': B.WHEAT }, B.BREAD, 1);
S(['##', '##'], { '#': B.SANDSTONE }, B.BRICKS, 4);
SL([B.SAND, B.SAND, B.SAND, B.SAND], B.SANDSTONE, 1);

// Tools: X = material, S = stick
const MATS = {
  wood: B.PLANKS,
  stone: B.COBBLESTONE,
  iron: B.IRON_INGOT,
  gold: B.GOLD_INGOT,
  diamond: B.DIAMOND,
};
for (const [mat, item] of Object.entries(MATS)) {
  const key = { X: item, S: B.STICK };
  S(['XXX', ' S ', ' S '], key, B.TOOL_IDS[`${mat}_pickaxe`]);
  S(['XX', 'XS', ' S'], key, B.TOOL_IDS[`${mat}_axe`]);
  S(['XX', 'SX', 'S '], key, B.TOOL_IDS[`${mat}_axe`]);
  S(['X', 'S', 'S'], key, B.TOOL_IDS[`${mat}_shovel`]);
  S(['X', 'X', 'S'], key, B.TOOL_IDS[`${mat}_sword`]);
}

export const SMELTING = new Map([
  [B.IRON_ORE, B.IRON_INGOT],
  [B.GOLD_ORE, B.GOLD_INGOT],
  [B.SAND, B.GLASS],
  [B.COBBLESTONE, B.STONE],
  [B.RAW_MEAT, B.COOKED_MEAT],
  [B.LOG, B.COAL],
  [B.CACTUS, B.WOOL],
]);

/** Trims empty rows/columns from a w*h grid of ids (0 = empty). */
function trim(grid, w, h) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const out = new Array(tw * th).fill(0);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) out[y * tw + x] = grid[(y + y0) * w + (x + x0)];
  }
  return { cells: out, w: tw, h: th };
}

/**
 * @param {Array} gridSlots  w*h array of stacks or null
 * @returns {{id:number,count:number}|null}
 */
export function findRecipe(gridSlots, w, h) {
  const ids = gridSlots.map((s) => (s ? s.id : 0));
  const t = trim(ids, w, h);
  if (!t) return null;

  for (const r of shaped) {
    const ph = r.pattern.length;
    const pw = Math.max(...r.pattern.map((row) => row.length));
    if (pw !== t.w || ph !== t.h) continue;
    let ok = true;
    for (let y = 0; y < ph && ok; y++) {
      for (let x = 0; x < pw && ok; x++) {
        const ch = r.pattern[y][x] || ' ';
        const want = ch === ' ' ? 0 : r.key[ch];
        if (t.cells[y * t.w + x] !== want) ok = false;
      }
    }
    if (ok) return { id: r.result, count: r.count };
  }

  const present = ids.filter((v) => v).sort((a, b) => a - b);
  for (const r of shapeless) {
    const want = [...r.ingredients].sort((a, b) => a - b);
    if (want.length !== present.length) continue;
    if (want.every((v, i) => v === present[i])) return { id: r.result, count: r.count };
  }
  return null;
}

export function consumeGrid(gridSlots) {
  for (let i = 0; i < gridSlots.length; i++) {
    const s = gridSlots[i];
    if (!s) continue;
    s.count--;
    if (s.count <= 0) gridSlots[i] = null;
  }
}

/** All recipes craftable from a flat list of available item counts. */
export function availableRecipes(counts, gridSize) {
  const out = [];
  const seen = new Set();
  const push = (id, count, need) => {
    const k = id + ':' + count;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ result: stack(id, count), need });
  };
  for (const r of shaped) {
    const ph = r.pattern.length;
    const pw = Math.max(...r.pattern.map((row) => row.length));
    if (pw > gridSize || ph > gridSize) continue;
    const need = new Map();
    for (const row of r.pattern) {
      for (const ch of row) {
        if (ch === ' ') continue;
        const id = r.key[ch];
        need.set(id, (need.get(id) || 0) + 1);
      }
    }
    let ok = true;
    for (const [id, n] of need) if ((counts.get(id) || 0) < n) ok = false;
    if (ok) push(r.result, r.count, need);
  }
  for (const r of shapeless) {
    const need = new Map();
    for (const id of r.ingredients) need.set(id, (need.get(id) || 0) + 1);
    let ok = true;
    for (const [id, n] of need) if ((counts.get(id) || 0) < n) ok = false;
    if (ok) push(r.result, r.count, need);
  }
  return out;
}
