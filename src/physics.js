// Axis-separated AABB collision against the voxel grid.

import * as B from './blocks.js';

const EPS = 1e-4;

/** Moves `pos` by (dx,dy,dz), resolving one axis at a time. */
export function moveAABB(world, pos, w, h, dx, dy, dz) {
  const hw = w / 2;
  const res = { groundY: false, ceiling: false, wallX: false, wallZ: false };

  // Y
  pos.y += dy;
  if (dy !== 0) {
    const hit = scan(world, pos.x - hw, pos.y, pos.z - hw, pos.x + hw, pos.y + h, pos.z + hw);
    for (const b of hit) {
      if (dy < 0 && b.y + 1 > pos.y) { pos.y = b.y + 1; res.groundY = true; }
      else if (dy > 0 && b.y < pos.y + h) { pos.y = b.y - h - EPS; res.ceiling = true; }
    }
  }
  // X
  pos.x += dx;
  if (dx !== 0) {
    const hit = scan(world, pos.x - hw, pos.y, pos.z - hw, pos.x + hw, pos.y + h, pos.z + hw);
    for (const b of hit) {
      if (dx > 0) pos.x = Math.min(pos.x, b.x - hw - EPS);
      else pos.x = Math.max(pos.x, b.x + 1 + hw + EPS);
      res.wallX = true;
    }
  }
  // Z
  pos.z += dz;
  if (dz !== 0) {
    const hit = scan(world, pos.x - hw, pos.y, pos.z - hw, pos.x + hw, pos.y + h, pos.z + hw);
    for (const b of hit) {
      if (dz > 0) pos.z = Math.min(pos.z, b.z - hw - EPS);
      else pos.z = Math.max(pos.z, b.z + 1 + hw + EPS);
      res.wallZ = true;
    }
  }
  return res;
}

function scan(world, x0, y0, z0, x1, y1, z1) {
  const out = [];
  const bx0 = Math.floor(x0 + EPS), bx1 = Math.floor(x1 - EPS);
  const by0 = Math.floor(y0 + EPS), by1 = Math.floor(y1 - EPS);
  const bz0 = Math.floor(z0 + EPS), bz1 = Math.floor(z1 - EPS);
  for (let y = by0; y <= by1; y++) {
    for (let z = bz0; z <= bz1; z++) {
      for (let x = bx0; x <= bx1; x++) {
        if (world.isSolid(x, y, z)) out.push({ x, y, z });
      }
    }
  }
  return out;
}

export function onGround(world, pos, w) {
  const hw = w / 2 - 0.02;
  const y = Math.floor(pos.y - 0.06);
  for (const dx of [-hw, hw]) {
    for (const dz of [-hw, hw]) {
      if (world.isSolid(Math.floor(pos.x + dx), y, Math.floor(pos.z + dz))) return true;
    }
  }
  return false;
}

/** True when any part of the box overlaps a block of the given id. */
export function boxTouches(world, pos, w, h, predicate) {
  const hw = w / 2;
  const bx0 = Math.floor(pos.x - hw), bx1 = Math.floor(pos.x + hw);
  const by0 = Math.floor(pos.y), by1 = Math.floor(pos.y + h);
  const bz0 = Math.floor(pos.z - hw), bz1 = Math.floor(pos.z + hw);
  for (let y = by0; y <= by1; y++) {
    for (let z = bz0; z <= bz1; z++) {
      for (let x = bx0; x <= bx1; x++) {
        if (predicate(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

export const isLiquid = (id) => B.getBlock(id).liquid;
