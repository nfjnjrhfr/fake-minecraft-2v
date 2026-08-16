// Block + item registry: every id, texture mapping, physical property and drop
// table used by the world, the mesher and the survival systems.

import { T } from './atlas.js';

export const AIR = 0;
export const STONE = 1;
export const GRASS = 2;
export const DIRT = 3;
export const COBBLESTONE = 4;
export const PLANKS = 5;
export const BEDROCK = 6;
export const WATER = 7;
export const SAND = 8;
export const GRAVEL = 9;
export const LOG = 10;
export const LEAVES = 11;
export const GLASS = 12;
export const SANDSTONE = 13;
export const COAL_ORE = 14;
export const IRON_ORE = 15;
export const GOLD_ORE = 16;
export const DIAMOND_ORE = 17;
export const TORCH = 18;
export const CRAFTING_TABLE = 19;
export const FURNACE = 20;
export const FURNACE_LIT = 21;
export const SNOW = 22;
export const ICE = 23;
export const CACTUS = 24;
export const FLOWER_RED = 25;
export const FLOWER_YELLOW = 26;
export const TALL_GRASS = 27;
export const DEAD_BUSH = 28;
export const SAPLING = 29;
export const BRICKS = 30;
export const OBSIDIAN = 31;
export const GLOWSTONE = 32;
export const STONE_BRICKS = 33;
export const WOOL = 34;

// Item ids live above 255 so a single number can address both.
export const ITEM_BASE = 256;
export const STICK = 256;
export const COAL = 257;
export const IRON_INGOT = 258;
export const GOLD_INGOT = 259;
export const DIAMOND = 260;
export const APPLE = 261;
export const RAW_MEAT = 262;
export const COOKED_MEAT = 263;
export const WHEAT = 264;
export const BREAD = 265;

export const TOOL_IDS = {};
let nextToolId = 280;
for (const mat of ['wood', 'stone', 'iron', 'gold', 'diamond']) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
    TOOL_IDS[`${mat}_${kind}`] = nextToolId++;
  }
}

export const RENDER_CUBE = 0;
export const RENDER_CROSS = 1;
export const RENDER_TORCH = 2;
export const RENDER_LIQUID = 3;

export const blocks = [];

function def(id, name, opts = {}) {
  const b = {
    id,
    name,
    label: opts.label || name,
    render: opts.render ?? RENDER_CUBE,
    tiles: opts.tiles || {},
    solid: opts.solid ?? true,
    opaque: opts.opaque ?? true,      // blocks all light and hides neighbour faces
    opacity: opts.opacity ?? 15,      // light absorbed per block
    light: opts.light ?? 0,           // light emitted
    hardness: opts.hardness ?? 1,     // -1 = unbreakable
    tool: opts.tool || null,          // 'pickaxe' | 'axe' | 'shovel' | null
    tier: opts.tier ?? 0,             // tool tier required to get a drop
    drop: opts.drop === undefined ? id : opts.drop,
    dropCount: opts.dropCount || null,
    gravity: opts.gravity ?? false,
    liquid: opts.liquid ?? false,
    placeOn: opts.placeOn || null,    // ids this block may be placed on
    flammable: opts.flammable ?? false,
    fuel: opts.fuel ?? 0,             // smelting ticks when used as furnace fuel
    stackSize: 64,
  };
  blocks[id] = b;
  return b;
}

function all(t) { return { all: t }; }

def(AIR, 'air', { label: '空氣', render: -1, solid: false, opaque: false, opacity: 0, hardness: -1, drop: 0 });

def(STONE, 'stone', {
  label: '石頭', tiles: all(T.stone), hardness: 1.5, tool: 'pickaxe', tier: 1, drop: COBBLESTONE,
});
def(GRASS, 'grass_block', {
  label: '草方塊', tiles: { top: T.grassTop, bottom: T.dirt, side: T.grassSide },
  hardness: 0.6, tool: 'shovel', drop: DIRT,
});
def(DIRT, 'dirt', { label: '泥土', tiles: all(T.dirt), hardness: 0.5, tool: 'shovel' });
def(COBBLESTONE, 'cobblestone', { label: '圓石', tiles: all(T.cobble), hardness: 2, tool: 'pickaxe', tier: 1 });
def(PLANKS, 'planks', { label: '木板', tiles: all(T.planks), hardness: 2, tool: 'axe', flammable: true, fuel: 300 });
def(BEDROCK, 'bedrock', { label: '基岩', tiles: all(T.bedrock), hardness: -1, drop: 0 });
def(WATER, 'water', {
  label: '水', tiles: all(T.water), render: RENDER_LIQUID, solid: false, opaque: false,
  opacity: 2, liquid: true, hardness: -1, drop: 0,
});
def(SAND, 'sand', { label: '沙子', tiles: all(T.sand), hardness: 0.5, tool: 'shovel', gravity: true });
def(GRAVEL, 'gravel', { label: '沙礫', tiles: all(T.gravel), hardness: 0.6, tool: 'shovel', gravity: true });
def(LOG, 'log', {
  label: '原木', tiles: { top: T.logTop, bottom: T.logTop, side: T.logSide },
  hardness: 2, tool: 'axe', flammable: true, fuel: 300,
});
def(LEAVES, 'leaves', {
  label: '樹葉', tiles: all(T.leaves), opaque: false, opacity: 1, hardness: 0.2, drop: -1, flammable: true,
});
def(GLASS, 'glass', { label: '玻璃', tiles: all(T.glass), opaque: false, opacity: 0, hardness: 0.3, drop: 0 });
def(SANDSTONE, 'sandstone', {
  label: '砂岩', tiles: { top: T.sandstoneTop, bottom: T.sandstoneTop, side: T.sandstoneSide },
  hardness: 0.8, tool: 'pickaxe', tier: 1,
});
def(COAL_ORE, 'coal_ore', {
  label: '煤礦石', tiles: all(T.coalOre), hardness: 3, tool: 'pickaxe', tier: 1, drop: COAL,
});
def(IRON_ORE, 'iron_ore', { label: '鐵礦石', tiles: all(T.ironOre), hardness: 3, tool: 'pickaxe', tier: 2 });
def(GOLD_ORE, 'gold_ore', { label: '金礦石', tiles: all(T.goldOre), hardness: 3, tool: 'pickaxe', tier: 3 });
def(DIAMOND_ORE, 'diamond_ore', {
  label: '鑽石礦石', tiles: all(T.diamondOre), hardness: 3, tool: 'pickaxe', tier: 3, drop: DIAMOND,
});
def(TORCH, 'torch', {
  label: '火把', tiles: all(T.torch), render: RENDER_TORCH, solid: false, opaque: false, opacity: 0,
  light: 14, hardness: 0, placeOn: 'solid',
});
def(CRAFTING_TABLE, 'crafting_table', {
  label: '工作台', tiles: { top: T.craftingTop, bottom: T.planks, side: T.craftingSide },
  hardness: 2.5, tool: 'axe', flammable: true, fuel: 300,
});
def(FURNACE, 'furnace', {
  label: '熔爐', tiles: { top: T.furnaceTop, bottom: T.furnaceTop, side: T.furnaceSide, front: T.furnaceFront },
  hardness: 3.5, tool: 'pickaxe', tier: 1,
});
def(FURNACE_LIT, 'furnace_lit', {
  label: '熔爐', tiles: { top: T.furnaceTop, bottom: T.furnaceTop, side: T.furnaceSide, front: T.furnaceFrontLit },
  hardness: 3.5, tool: 'pickaxe', tier: 1, light: 13, drop: FURNACE,
});
def(SNOW, 'snow_block', { label: '雪塊', tiles: all(T.snow), hardness: 0.2, tool: 'shovel' });
def(ICE, 'ice', { label: '冰', tiles: all(T.ice), opaque: false, opacity: 3, hardness: 0.5, tool: 'pickaxe', drop: 0 });
def(CACTUS, 'cactus', {
  label: '仙人掌', tiles: { top: T.cactusTop, bottom: T.cactusTop, side: T.cactusSide },
  hardness: 0.4, opaque: false, opacity: 15,
});
def(FLOWER_RED, 'red_flower', {
  label: '紅花', tiles: all(T.flowerRed), render: RENDER_CROSS, solid: false, opaque: false, opacity: 0,
  hardness: 0, placeOn: 'soil',
});
def(FLOWER_YELLOW, 'yellow_flower', {
  label: '黃花', tiles: all(T.flowerYellow), render: RENDER_CROSS, solid: false, opaque: false, opacity: 0,
  hardness: 0, placeOn: 'soil',
});
def(TALL_GRASS, 'tall_grass', {
  label: '草', tiles: all(T.tallGrass), render: RENDER_CROSS, solid: false, opaque: false, opacity: 0,
  hardness: 0, drop: -1, placeOn: 'soil', flammable: true,
});
def(DEAD_BUSH, 'dead_bush', {
  label: '枯萎的灌木', tiles: all(T.deadBush), render: RENDER_CROSS, solid: false, opaque: false, opacity: 0,
  hardness: 0, drop: STICK, placeOn: 'soil',
});
def(SAPLING, 'sapling', {
  label: '樹苗', tiles: all(T.sapling), render: RENDER_CROSS, solid: false, opaque: false, opacity: 0,
  hardness: 0, placeOn: 'soil', fuel: 100,
});
def(BRICKS, 'bricks', { label: '磚塊', tiles: all(T.bricks), hardness: 2, tool: 'pickaxe', tier: 1 });
def(OBSIDIAN, 'obsidian', { label: '黑曜石', tiles: all(T.obsidian), hardness: 50, tool: 'pickaxe', tier: 4 });
def(GLOWSTONE, 'glowstone', { label: '螢石', tiles: all(T.glowstone), light: 15, hardness: 0.3 });
def(STONE_BRICKS, 'stone_bricks', { label: '石磚', tiles: all(T.stoneBricks), hardness: 1.5, tool: 'pickaxe', tier: 1 });
def(WOOL, 'wool', { label: '羊毛', tiles: all(T.wool), hardness: 0.8, flammable: true });

export const items = {};

function defItem(id, name, opts) {
  items[id] = {
    id, name, label: opts.label || name, tile: opts.tile,
    stackSize: opts.stackSize ?? 64,
    food: opts.food ?? 0,
    tool: opts.tool || null,
    tier: opts.tier ?? 0,
    speed: opts.speed ?? 1,
    damage: opts.damage ?? 1,
    durability: opts.durability ?? 0,
    fuel: opts.fuel ?? 0,
  };
  return items[id];
}

defItem(STICK, 'stick', { label: '木棒', tile: T.items.stick, fuel: 100 });
defItem(COAL, 'coal', { label: '煤炭', tile: T.items.coal, fuel: 1600 });
defItem(IRON_INGOT, 'iron_ingot', { label: '鐵錠', tile: T.items.ironIngot });
defItem(GOLD_INGOT, 'gold_ingot', { label: '金錠', tile: T.items.goldIngot });
defItem(DIAMOND, 'diamond', { label: '鑽石', tile: T.items.diamond });
defItem(APPLE, 'apple', { label: '蘋果', tile: T.items.apple, food: 4 });
defItem(RAW_MEAT, 'raw_meat', { label: '生豬排', tile: T.items.rawMeat, food: 3 });
defItem(COOKED_MEAT, 'cooked_meat', { label: '熟豬排', tile: T.items.cookedMeat, food: 8 });
defItem(WHEAT, 'wheat', { label: '小麥', tile: T.items.wheat });
defItem(BREAD, 'bread', { label: '麵包', tile: T.items.bread, food: 5 });

const MAT_STATS = {
  wood: { tier: 1, speed: 2, dur: 60, dmg: 0, fuel: 200 },
  stone: { tier: 2, speed: 4, dur: 132, dmg: 1 },
  iron: { tier: 3, speed: 6, dur: 251, dmg: 2 },
  gold: { tier: 1, speed: 12, dur: 33, dmg: 1 },
  diamond: { tier: 4, speed: 8, dur: 1562, dmg: 3 },
};
const MAT_LABEL = { wood: '木', stone: '石', iron: '鐵', gold: '金', diamond: '鑽石' };
const KIND_LABEL = { pickaxe: '鎬', axe: '斧', shovel: '鏟', sword: '劍' };

for (const [mat, stats] of Object.entries(MAT_STATS)) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
    defItem(TOOL_IDS[`${mat}_${kind}`], `${mat}_${kind}`, {
      label: `${MAT_LABEL[mat]}${KIND_LABEL[kind]}`,
      tile: T.items[`${mat}_${kind}`],
      stackSize: 1,
      tool: kind,
      tier: stats.tier,
      speed: stats.speed,
      damage: kind === 'sword' ? 3 + stats.dmg : 1 + Math.ceil(stats.dmg / 2),
      durability: stats.dur,
      fuel: mat === 'wood' ? 200 : 0,
    });
  }
}

export const isBlock = (id) => id > 0 && id < ITEM_BASE && blocks[id] !== undefined;
export const getBlock = (id) => blocks[id] || blocks[AIR];
export const getItem = (id) => items[id] || null;

export function displayName(id) {
  if (id >= ITEM_BASE) return items[id] ? items[id].label : '?';
  return blocks[id] ? blocks[id].label : '?';
}

export function iconTile(id) {
  if (id >= ITEM_BASE) return items[id] ? items[id].tile : 0;
  const b = blocks[id];
  if (!b) return 0;
  return b.tiles.side ?? b.tiles.all ?? b.tiles.top ?? 0;
}

export function stackSize(id) {
  if (id >= ITEM_BASE) return items[id] ? items[id].stackSize : 64;
  return 64;
}

export function fuelValue(id) {
  if (id >= ITEM_BASE) return items[id] ? items[id].fuel : 0;
  return blocks[id] ? blocks[id].fuel : 0;
}

/** Seconds needed to break `blockId` while holding `heldId`. */
export function breakTime(blockId, heldId) {
  const b = getBlock(blockId);
  if (b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0;
  const tool = heldId >= ITEM_BASE ? items[heldId] : null;
  let speed = 1;
  if (tool && tool.tool && tool.tool === b.tool) speed = tool.speed;
  const harvest = canHarvest(blockId, heldId);
  return (b.hardness * (harvest ? 1.5 : 5)) / speed;
}

export function canHarvest(blockId, heldId) {
  const b = getBlock(blockId);
  if (!b.tool || b.tier === 0) return true;
  const tool = heldId >= ITEM_BASE ? items[heldId] : null;
  if (!tool || tool.tool !== b.tool) return false;
  return tool.tier >= b.tier;
}

/** Returns [{id, count}] dropped when the block breaks. */
export function blockDrops(blockId, heldId, rnd) {
  const b = getBlock(blockId);
  if (!canHarvest(blockId, heldId)) return [];
  if (blockId === LEAVES) {
    const out = [];
    if (rnd() < 0.06) out.push({ id: SAPLING, count: 1 });
    if (rnd() < 0.01) out.push({ id: APPLE, count: 1 });
    return out;
  }
  if (blockId === TALL_GRASS) {
    return rnd() < 0.15 ? [{ id: WHEAT, count: 1 }] : [];
  }
  if (b.drop === 0 || b.drop === -1) return [];
  return [{ id: b.drop, count: b.dropCount ? b.dropCount(rnd) : 1 }];
}

export function isSoil(id) {
  return id === GRASS || id === DIRT || id === SAND || id === SNOW;
}

export function canPlaceOn(blockId, belowId) {
  const b = getBlock(blockId);
  if (b.placeOn === 'soil') return isSoil(belowId);
  if (b.placeOn === 'solid') return getBlock(belowId).solid;
  return true;
}
