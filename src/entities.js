// Mobs (passive + hostile) and dropped-item entities.

import * as B from './blocks.js';
import { moveAABB, boxTouches, isLiquid } from './physics.js';
import { SEA_LEVEL } from './worldgen.js';
import { stack } from './inventory.js';

const GRAVITY = 28;

// Box models: [name, offsetX, offsetY, offsetZ, sizeX, sizeY, sizeZ, colorHex]
// Offsets are in blocks, relative to the entity's feet centre.
const MODELS = {
  pig: {
    w: 0.9, h: 0.9, hp: 10, speed: 1.4, drop: () => [stack(B.RAW_MEAT, 1 + ((Math.random() * 2) | 0))],
    parts: [
      ['body', 0, 0.45, 0, 0.6, 0.5, 0.9, 0xe89a9a],
      ['head', 0, 0.6, -0.6, 0.5, 0.5, 0.4, 0xf0a8a8],
      ['snout', 0, 0.55, -0.84, 0.22, 0.18, 0.12, 0xd07f7f],
      ['leg0', -0.2, 0, -0.3, 0.2, 0.28, 0.2, 0xd98d8d, 'legF'],
      ['leg1', 0.2, 0, -0.3, 0.2, 0.28, 0.2, 0xd98d8d, 'legB'],
      ['leg2', -0.2, 0, 0.3, 0.2, 0.28, 0.2, 0xd98d8d, 'legB'],
      ['leg3', 0.2, 0, 0.3, 0.2, 0.28, 0.2, 0xd98d8d, 'legF'],
    ],
  },
  cow: {
    w: 0.9, h: 1.3, hp: 10, speed: 1.2, drop: () => [stack(B.RAW_MEAT, 1 + ((Math.random() * 3) | 0))],
    parts: [
      ['body', 0, 0.72, 0, 0.7, 0.6, 1.1, 0x4a3a2c],
      ['head', 0, 0.95, -0.75, 0.5, 0.5, 0.45, 0x5b4636],
      ['snout', 0, 0.82, -1.0, 0.34, 0.24, 0.1, 0xe8dcd0],
      ['horn0', -0.25, 1.2, -0.75, 0.1, 0.1, 0.1, 0xf0eadc],
      ['horn1', 0.25, 1.2, -0.75, 0.1, 0.1, 0.1, 0xf0eadc],
      ['leg0', -0.24, 0, -0.36, 0.22, 0.45, 0.22, 0x40332a, 'legF'],
      ['leg1', 0.24, 0, -0.36, 0.22, 0.45, 0.22, 0x40332a, 'legB'],
      ['leg2', -0.24, 0, 0.36, 0.22, 0.45, 0.22, 0x40332a, 'legB'],
      ['leg3', 0.24, 0, 0.36, 0.22, 0.45, 0.22, 0x40332a, 'legF'],
    ],
  },
  sheep: {
    w: 0.9, h: 1.2, hp: 8, speed: 1.2, drop: () => [stack(B.WOOL, 1)],
    parts: [
      ['body', 0, 0.65, 0, 0.75, 0.65, 1.05, 0xeeeeee],
      ['head', 0, 0.85, -0.7, 0.4, 0.42, 0.4, 0xdcd2c8],
      ['leg0', -0.22, 0, -0.32, 0.2, 0.42, 0.2, 0xd8d8d8, 'legF'],
      ['leg1', 0.22, 0, -0.32, 0.2, 0.42, 0.2, 0xd8d8d8, 'legB'],
      ['leg2', -0.22, 0, 0.32, 0.2, 0.42, 0.2, 0xd8d8d8, 'legB'],
      ['leg3', 0.22, 0, 0.32, 0.2, 0.42, 0.2, 0xd8d8d8, 'legF'],
    ],
  },
  chicken: {
    w: 0.5, h: 0.8, hp: 4, speed: 1.1, drop: () => [stack(B.RAW_MEAT, 1)],
    parts: [
      ['body', 0, 0.32, 0, 0.34, 0.34, 0.44, 0xf2f2f2],
      ['head', 0, 0.62, -0.22, 0.22, 0.24, 0.2, 0xffffff],
      ['beak', 0, 0.62, -0.38, 0.12, 0.1, 0.12, 0xffb020],
      ['comb', 0, 0.76, -0.22, 0.06, 0.1, 0.14, 0xd83030],
      ['leg0', -0.1, 0, 0, 0.08, 0.3, 0.08, 0xffb020, 'legF'],
      ['leg1', 0.1, 0, 0, 0.08, 0.3, 0.08, 0xffb020, 'legB'],
    ],
  },
  zombie: {
    w: 0.6, h: 1.9, hp: 20, speed: 1.9, hostile: true, damage: 3,
    drop: () => (Math.random() < 0.4 ? [stack(B.IRON_INGOT, 1)] : []),
    parts: [
      ['body', 0, 0.7, 0, 0.55, 0.65, 0.28, 0x2f6b3a],
      ['head', 0, 1.4, 0, 0.5, 0.5, 0.5, 0x4a8f52],
      ['eyeL', -0.13, 1.5, -0.26, 0.1, 0.08, 0.02, 0x101010],
      ['eyeR', 0.13, 1.5, -0.26, 0.1, 0.08, 0.02, 0x101010],
      ['armL', -0.38, 0.72, -0.2, 0.2, 0.6, 0.2, 0x4a8f52, 'armF'],
      ['armR', 0.38, 0.72, -0.2, 0.2, 0.6, 0.2, 0x4a8f52, 'armF'],
      ['leg0', -0.14, 0, 0, 0.22, 0.72, 0.22, 0x2b3f6b, 'legF'],
      ['leg1', 0.14, 0, 0, 0.22, 0.72, 0.22, 0x2b3f6b, 'legB'],
    ],
  },
  skeleton: {
    w: 0.6, h: 1.9, hp: 16, speed: 2.0, hostile: true, damage: 2,
    drop: () => [stack(B.STICK, 1 + ((Math.random() * 2) | 0))],
    parts: [
      ['body', 0, 0.7, 0, 0.4, 0.65, 0.22, 0xd8d8d8],
      ['head', 0, 1.4, 0, 0.46, 0.46, 0.46, 0xe8e8e8],
      ['eyeL', -0.11, 1.48, -0.24, 0.1, 0.1, 0.02, 0x101010],
      ['eyeR', 0.11, 1.48, -0.24, 0.1, 0.1, 0.02, 0x101010],
      ['armL', -0.3, 0.72, 0, 0.14, 0.6, 0.14, 0xd0d0d0, 'armF'],
      ['armR', 0.3, 0.72, 0, 0.14, 0.6, 0.14, 0xd0d0d0, 'armF'],
      ['leg0', -0.1, 0, 0, 0.14, 0.72, 0.14, 0xc8c8c8, 'legF'],
      ['leg1', 0.1, 0, 0, 0.14, 0.72, 0.14, 0xc8c8c8, 'legB'],
    ],
  },
};

export const MOB_TYPES = MODELS;

let nextId = 1;

export class Mob {
  constructor(type, x, y, z) {
    this.id = nextId++;
    this.type = type;
    this.model = MODELS[type];
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.health = this.model.hp;
    this.onGround = false;
    this.walkTime = 0;
    this.wander = 0;
    this.hurtTime = 0;
    this.attackCd = 0;
    this.dead = false;
    this.inWater = false;
    this.age = 0;
  }

  get w() { return this.model.w; }
  get h() { return this.model.h; }

  hurt(amount) {
    this.health -= amount;
    this.hurtTime = 0.3;
    this.vy = Math.max(this.vy, 4.5);
    if (this.health <= 0) this.dead = true;
  }

  update(dt, world, game) {
    this.age += dt;
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    const player = game.player;
    const dxp = player.pos.x - this.x, dzp = player.pos.z - this.z, dyp = player.pos.y - this.y;
    const dist = Math.hypot(dxp, dyp, dzp);

    let targetSpeed = 0;
    if (this.model.hostile && dist < 22 && player.health > 0 && player.mode !== 'creative') {
      this.yaw = Math.atan2(dxp, dzp);
      targetSpeed = this.model.speed;
      if (dist < 1.4 && this.attackCd <= 0 && Math.abs(dyp) < 2) {
        player.hurt(this.model.damage, this.x, this.z);
        this.attackCd = 1.0;
      }
    } else {
      this.wander -= dt;
      if (this.wander <= 0) {
        this.wander = 2 + Math.random() * 4;
        this.moving = Math.random() < 0.6;
        this.yaw += (Math.random() - 0.5) * 3;
      }
      if (this.moving) targetSpeed = this.model.speed * 0.45;
    }

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wantX = sin * targetSpeed, wantZ = cos * targetSpeed;
    this.vx += (wantX - this.vx) * Math.min(1, dt * 8);
    this.vz += (wantZ - this.vz) * Math.min(1, dt * 8);

    this.inWater = boxTouches(world, this, this.w, this.h, isLiquid);
    this.vy -= (this.inWater ? GRAVITY * 0.28 : GRAVITY) * dt;
    if (this.inWater) { this.vy = Math.max(this.vy, -2.4); this.vy += 5.4 * dt; }

    const before = { x: this.x, z: this.z };
    const r = moveAABB(world, this, this.w, this.h, this.vx * dt, this.vy * dt, this.vz * dt);
    if (r.groundY) { this.vy = 0; this.onGround = true; } else if (r.ceiling) { this.vy = 0; }
    else this.onGround = false;

    // Step up over one-block obstacles.
    const blockedX = Math.abs(this.x - before.x) < Math.abs(this.vx * dt) * 0.4;
    const blockedZ = Math.abs(this.z - before.z) < Math.abs(this.vz * dt) * 0.4;
    if ((r.wallX || r.wallZ || blockedX || blockedZ) && this.onGround && targetSpeed > 0) {
      this.vy = 7.6;
      this.onGround = false;
    }

    this.walkTime += Math.hypot(this.x - before.x, this.z - before.z) * 6;

    // Hostiles burn away in daylight.
    if (this.model.hostile && world.isDay()) {
      const above = world.getLight(0, Math.floor(this.x), Math.floor(this.y + this.h), Math.floor(this.z));
      if (above > 12 && this.age > 3) {
        this.health -= dt * 4;
        this.burning = true;
        if (this.health <= 0) this.dead = true;
      } else this.burning = false;
    }
    if (this.y < -8) this.dead = true;
  }
}

export class ItemEntity {
  constructor(x, y, z, item) {
    this.id = nextId++;
    this.x = x; this.y = y; this.z = z;
    this.vx = (Math.random() - 0.5) * 1.6;
    this.vy = 2.2;
    this.vz = (Math.random() - 0.5) * 1.6;
    this.item = item;
    this.age = 0;
    this.dead = false;
    this.w = 0.28; this.h = 0.28;
  }
  update(dt, world, game) {
    this.age += dt;
    this.vy -= GRAVITY * 0.55 * dt;
    const inWater = world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.WATER;
    if (inWater) { this.vy += 16 * dt; this.vy = Math.min(this.vy, 1.4); }
    const r = moveAABB(world, this, this.w, this.h, this.vx * dt, this.vy * dt, this.vz * dt);
    if (r.groundY) {
      this.vy = 0;
      this.vx *= 0.72; this.vz *= 0.72;
    }
    const p = game.player;
    const d = Math.hypot(p.pos.x - this.x, p.pos.y + 0.9 - this.y, p.pos.z - this.z);
    if (this.age > 0.6 && d < 1.5 && p.health > 0) {
      const pull = 9 * dt / Math.max(0.4, d);
      this.x += (p.pos.x - this.x) * pull;
      this.y += (p.pos.y + 0.5 - this.y) * pull;
      this.z += (p.pos.z - this.z) * pull;
      if (d < 0.75) {
        if (p.inventory.canAccept(this.item)) {
          const left = p.inventory.add(this.item);
          if (left <= 0) { this.dead = true; game.sound.pickup(); }
          else this.item.count = left;
        }
      }
    }
    if (this.age > 300) this.dead = true;
    if (this.y < -8) this.dead = true;
  }
}

/** Spawns mobs around the player according to light level and time of day. */
export function trySpawn(world, game, dt) {
  game.spawnTimer = (game.spawnTimer || 0) + dt;
  if (game.spawnTimer < 2) return;
  game.spawnTimer = 0;
  const mobs = game.mobs;
  const passive = mobs.filter((m) => !m.model.hostile).length;
  const hostile = mobs.length - passive;
  const p = game.player;
  const night = !world.isDay();

  for (let attempt = 0; attempt < 12; attempt++) {
    const wantHostile = night && hostile < 14;
    const wantPassive = passive < 12;
    if (!wantHostile && !wantPassive) return;
    const hostileSpawn = wantHostile && (!wantPassive || Math.random() < 0.6);

    const ang = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 28;
    const x = Math.floor(p.pos.x + Math.cos(ang) * r);
    const z = Math.floor(p.pos.z + Math.sin(ang) * r);
    if (!world.isLoaded(x, z)) continue;
    const y = world.heightAt(x, z) + 1;
    if (y <= 2) continue;
    const ground = world.getBlock(x, y - 1, z);
    if (!B.getBlock(ground).solid) continue;
    if (world.getBlock(x, y, z) !== B.AIR || world.getBlock(x, y + 1, z) !== B.AIR) continue;
    if (y < SEA_LEVEL) continue;
    const light = Math.max(world.getLight(0, x, y, z) * (world.isDay() ? 1 : 0.2), world.getLight(1, x, y, z));

    if (hostileSpawn) {
      if (light > 7) continue;
      const type = Math.random() < 0.65 ? 'zombie' : 'skeleton';
      mobs.push(new Mob(type, x + 0.5, y, z + 0.5));
    } else {
      if (ground !== B.GRASS || light < 8) continue;
      const type = ['pig', 'cow', 'sheep', 'chicken'][(Math.random() * 4) | 0];
      const n = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) mobs.push(new Mob(type, x + 0.5 + i * 0.6, y, z + 0.5));
    }
    return;
  }
}

export function despawnFar(game) {
  const p = game.player;
  game.mobs = game.mobs.filter((m) => {
    if (m.dead) return false;
    const d = Math.hypot(m.x - p.pos.x, m.z - p.pos.z);
    return d < 90;
  });
}
