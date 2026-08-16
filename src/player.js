// Player state: movement, survival stats, mining and block interaction.

import * as B from './blocks.js';
import { moveAABB, boxTouches, isLiquid } from './physics.js';
import { Inventory, stack } from './inventory.js';
import { ItemEntity } from './entities.js';

const GRAVITY = 30;
const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE = 1.62;
const SNEAK_EYE = 1.42;
const REACH = 5;

export class Player {
  constructor(spawn) {
    this.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.submerged = false;
    this.mode = 'survival';
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.health = 20;
    this.maxHealth = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.inventory = new Inventory(36);
    this.fallStart = null;
    this.hurtFlash = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.breakTarget = null;
    this.breakProgress = 0;
    this.swingTime = 0;
    this.bobbing = 0;
    this.spawnPoint = { ...spawn };
    this.attackCd = 0;
    this.eatTimer = 0;
    this.deathMessage = '';
  }

  get eyeY() { return this.pos.y + (this.sneaking ? SNEAK_EYE : EYE); }
  get width() { return WIDTH; }
  get height() { return HEIGHT; }

  lookVector() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    return { x: -cp * sy, y: sp, z: -cp * cy };
  }

  hurt(amount, fromX, fromZ) {
    if (this.mode === 'creative' || this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = 0.45;
    if (fromX !== undefined) {
      const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 6;
      this.vel.z += (dz / d) * 6;
      this.vel.y = Math.max(this.vel.y, 5);
    }
    if (this.health <= 0) this.die();
  }

  die() {
    this.health = 0;
    this.deathMessage = '你死了！';
  }

  respawn(world) {
    const s = world.findSpawn(this.spawnPoint.x | 0, this.spawnPoint.z | 0);
    this.pos = { x: s.x, y: s.y, z: s.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.health = this.maxHealth;
    this.food = 20;
    this.saturation = 5;
    this.air = 300;
    this.fallStart = null;
    this.deathMessage = '';
  }

  addExhaustion(v) {
    if (this.mode === 'creative') return;
    this.exhaustion += v;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
  }

  update(dt, input, world, game) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.swingTime = Math.max(0, this.swingTime - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.health <= 0) { this.vel.x = this.vel.z = 0; return; }

    const wasOnGround = this.onGround;
    this.sneaking = input.sneak && !this.flying;
    this.inWater = boxTouches(world, this.pos, WIDTH, HEIGHT, isLiquid);
    const eyeBlock = world.getBlock(Math.floor(this.pos.x), Math.floor(this.eyeY), Math.floor(this.pos.z));
    this.submerged = eyeBlock === B.WATER;

    // --- horizontal movement
    let fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    let str = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const len = Math.hypot(fwd, str);
    if (len > 0) { fwd /= len; str /= len; }
    if (fwd <= 0) this.sprinting = false;
    if (input.sprint && fwd > 0 && (this.food > 6 || this.mode === 'creative')) this.sprinting = true;

    let speed = 4.3;
    if (this.sprinting) speed = 5.6;
    if (this.sneaking) speed = 1.5;
    if (this.flying) speed = this.sprinting ? 22 : 11;
    if (this.inWater && !this.flying) speed *= 0.55;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw)
    const wantX = (-sy * fwd + cy * str) * speed;
    const wantZ = (-cy * fwd - sy * str) * speed;

    const control = this.onGround || this.flying ? 1 : this.inWater ? 0.5 : 0.22;
    const accel = Math.min(1, dt * (this.onGround || this.flying ? 14 : 8) * control + control * 0.02);
    this.vel.x += (wantX - this.vel.x) * accel;
    this.vel.z += (wantZ - this.vel.z) * accel;

    // --- vertical movement
    if (this.flying) {
      const up = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.vel.y += (up * speed - this.vel.y) * Math.min(1, dt * 12);
    } else if (this.inWater) {
      this.vel.y -= GRAVITY * 0.22 * dt;
      if (input.jump) this.vel.y = Math.min(this.vel.y + 22 * dt, 3.2);
      else this.vel.y = Math.max(this.vel.y, -3);
      this.vel.y *= 1 - Math.min(1, dt * 1.6);
      this.fallStart = null;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (input.jump && this.onGround) {
        this.vel.y = 8.6;
        this.onGround = false;
        this.addExhaustion(this.sprinting ? 0.8 : 0.2);
      }
    }
    this.vel.y = Math.max(this.vel.y, -60);

    // --- integrate + collide
    const before = { ...this.pos };
    let dx = this.vel.x * dt, dz = this.vel.z * dt;

    // Sneaking stops you walking off ledges.
    if (this.sneaking && this.onGround) {
      if (!this.groundAt(world, this.pos.x + dx, this.pos.z)) dx = 0;
      if (!this.groundAt(world, this.pos.x, this.pos.z + dz)) dz = 0;
    }

    const r = moveAABB(world, this.pos, WIDTH, HEIGHT, dx, this.vel.y * dt, dz);
    if (r.groundY) {
      if (!this.onGround && this.fallStart !== null) this.applyFallDamage(game);
      this.onGround = true;
      this.vel.y = 0;
    } else {
      this.onGround = false;
      if (r.ceiling) this.vel.y = Math.min(this.vel.y, 0);
    }
    if (r.wallX) this.vel.x = 0;
    if (r.wallZ) this.vel.z = 0;

    // Auto step-up onto single blocks while walking.
    if ((r.wallX || r.wallZ) && this.onGround && !this.flying) {
      const test = { ...this.pos };
      moveAABB(world, test, WIDTH, HEIGHT, 0, 0.6, 0);
      const after = { ...test };
      moveAABB(world, after, WIDTH, HEIGHT, dx, 0, dz);
      if (Math.hypot(after.x - test.x, after.z - test.z) > Math.hypot(this.pos.x - before.x, this.pos.z - before.z) + 1e-3) {
        const settled = { ...after };
        moveAABB(world, settled, WIDTH, HEIGHT, 0, -0.62, 0);
        if (settled.y >= this.pos.y - 0.01) { this.pos = settled; this.onGround = true; }
      }
    }

    if (!this.onGround && this.vel.y < 0 && !this.inWater && !this.flying) {
      if (this.fallStart === null) this.fallStart = Math.max(this.pos.y, before.y);
    } else if (this.onGround || this.inWater || this.flying) {
      this.fallStart = null;
    }
    if (this.onGround && !wasOnGround) game.sound.step(world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z)));

    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.bobbing += moved * 3.2;
    if (this.onGround && moved > 0.001) {
      this.stepDist = (this.stepDist || 0) + moved;
      if (this.stepDist > 2.2) {
        this.stepDist = 0;
        game.sound.step(world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z)));
      }
      this.addExhaustion(moved * (this.sprinting ? 0.1 : 0.01));
    }

    this.survivalTick(dt, world, game);
  }

  groundAt(world, x, z) {
    const hw = WIDTH / 2;
    const y = Math.floor(this.pos.y - 0.08);
    for (const ox of [-hw, hw]) {
      for (const oz of [-hw, hw]) {
        if (world.isSolid(Math.floor(x + ox), y, Math.floor(z + oz))) return true;
      }
    }
    return false;
  }

  applyFallDamage(game) {
    const dist = this.fallStart - this.pos.y;
    this.fallStart = null;
    if (this.mode === 'creative' || dist <= 3.2) return;
    const dmg = Math.floor(dist - 3);
    if (dmg > 0) {
      this.hurt(dmg);
      game.sound.hurt();
      if (this.health <= 0) this.deathMessage = '你摔死了';
    }
  }

  survivalTick(dt, world, game) {
    if (this.mode === 'creative') { this.health = this.maxHealth; this.food = 20; return; }

    // Breath
    if (this.submerged) {
      this.air -= dt * 60;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer = (this.drownTimer || 0) + dt;
        if (this.drownTimer > 1) {
          this.drownTimer = 0;
          this.hurt(2);
          game.sound.hurt();
          if (this.health <= 0) this.deathMessage = '你淹死了';
        }
      }
    } else {
      this.air = Math.min(300, this.air + dt * 120);
      this.drownTimer = 0;
    }

    // Contact damage from cactus
    if (boxTouches(world, this.pos, WIDTH, HEIGHT, (id) => id === B.CACTUS)) {
      this.cactusTimer = (this.cactusTimer || 0) + dt;
      if (this.cactusTimer > 0.5) { this.cactusTimer = 0; this.hurt(1); game.sound.hurt(); }
    }

    // Void
    if (this.pos.y < -5) { this.hurt(4 * dt * 10); this.deathMessage = '你掉出了世界'; }

    // Regeneration / starvation
    if (this.food >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= 3.5) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.addExhaustion(3);
      }
    } else this.regenTimer = 0;

    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        this.hurt(1);
        if (this.health <= 0) this.deathMessage = '你餓死了';
      }
    } else this.starveTimer = 0;
  }

  // --- interaction ----------------------------------------------------------

  targetBlock(world) {
    const d = this.lookVector();
    return world.raycast(this.pos.x, this.eyeY, this.pos.z, d.x, d.y, d.z, REACH);
  }

  /** Progresses mining on the targeted block; returns true when it breaks. */
  mine(dt, world, game, target) {
    if (!target) { this.breakTarget = null; this.breakProgress = 0; return false; }
    const key = `${target.x},${target.y},${target.z}`;
    if (this.breakTarget !== key) {
      this.breakTarget = key;
      this.breakProgress = 0;
    }
    if (this.mode === 'creative') {
      this.breakBlock(world, game, target);
      return true;
    }
    const time = B.breakTime(target.id, this.inventory.heldId);
    if (!isFinite(time)) return false;
    this.breakProgress += time <= 0 ? 1 : dt / time;
    this.addExhaustion(dt * 0.02);
    if (this.breakProgress >= 1) {
      this.breakBlock(world, game, target);
      this.breakProgress = 0;
      return true;
    }
    return false;
  }

  breakBlock(world, game, target) {
    const id = world.getBlock(target.x, target.y, target.z);
    if (id === B.AIR || B.getBlock(id).hardness < 0) return;
    world.setBlock(target.x, target.y, target.z, B.AIR);
    game.sound.dig(id);
    game.particles.blockBreak(target.x, target.y, target.z, id);
    if (this.mode !== 'creative') {
      const drops = B.blockDrops(id, this.inventory.heldId, Math.random);
      for (const d of drops) {
        game.items.push(new ItemEntity(target.x + 0.5, target.y + 0.3, target.z + 0.5, stack(d.id, d.count)));
      }
      const held = this.inventory.held;
      if (held && B.getItem(held.id) && B.getItem(held.id).durability) this.inventory.damageSelected(1);
    }
    // Leaves with no nearby log decay shortly after.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (world.getBlock(target.x + dx, target.y + dy, target.z + dz) === B.LEAVES) {
            world.scheduleUpdate(target.x + dx, target.y + dy, target.z + dz, 20 + ((Math.random() * 40) | 0));
          }
        }
      }
    }
  }

  place(world, game, target) {
    const held = this.inventory.held;
    if (!held) return false;
    const id = held.id;
    if (id >= B.ITEM_BASE) return false;
    if (!target) return false;
    const x = target.x + target.nx, y = target.y + target.ny, z = target.z + target.nz;
    const existing = world.getBlock(x, y, z);
    if (existing !== B.AIR && !B.getBlock(existing).liquid) return false;
    if (!B.canPlaceOn(id, world.getBlock(x, y - 1, z))) return false;
    // Don't place inside yourself.
    if (B.getBlock(id).solid && this.intersectsBlock(x, y, z)) return false;
    world.setBlock(x, y, z, id);
    game.sound.place(id);
    this.swingTime = 0.22;
    if (this.mode !== 'creative') this.inventory.consumeSelected(1);
    return true;
  }

  intersectsBlock(x, y, z) {
    const hw = WIDTH / 2 + 0.001;
    return (this.pos.x + hw > x && this.pos.x - hw < x + 1 &&
      this.pos.y + HEIGHT > y && this.pos.y < y + 1 &&
      this.pos.z + hw > z && this.pos.z - hw < z + 1);
  }

  attack(game, mobs) {
    if (this.attackCd > 0) return;
    this.attackCd = 0.32;
    this.swingTime = 0.22;
    const d = this.lookVector();
    let best = null, bestT = 4.0;
    for (const m of mobs) {
      const t = rayBox(this.pos.x, this.eyeY, this.pos.z, d.x, d.y, d.z,
        m.x - m.w / 2, m.y, m.z - m.w / 2, m.x + m.w / 2, m.y + m.h, m.z + m.w / 2);
      if (t !== null && t < bestT) { bestT = t; best = m; }
    }
    if (!best) return;
    const held = this.inventory.heldId;
    const item = B.getItem(held);
    const dmg = item && item.tool === 'sword' ? item.damage : item && item.tool ? item.damage : 1;
    best.hurt(dmg);
    game.sound.hit();
    this.addExhaustion(0.1);
    if (this.inventory.held && item && item.durability) this.inventory.damageSelected(1);
    if (best.dead) {
      for (const s of best.model.drop()) {
        game.items.push(new ItemEntity(best.x, best.y + 0.4, best.z, s));
      }
    }
  }

  eat(game) {
    const held = this.inventory.held;
    if (!held) return false;
    const item = B.getItem(held.id);
    if (!item || !item.food) return false;
    if (this.food >= 20) return false;
    this.food = Math.min(20, this.food + item.food);
    this.saturation = Math.min(this.food, this.saturation + item.food * 0.6);
    this.inventory.consumeSelected(1);
    game.sound.eat();
    return true;
  }

  serialize() {
    return {
      pos: this.pos, yaw: this.yaw, pitch: this.pitch, mode: this.mode,
      health: this.health, food: this.food, saturation: this.saturation,
      inventory: this.inventory.serialize(), selected: this.inventory.selected,
      spawnPoint: this.spawnPoint, flying: this.flying,
    };
  }

  load(d) {
    this.pos = d.pos; this.yaw = d.yaw; this.pitch = d.pitch;
    this.mode = d.mode || 'survival';
    this.health = d.health ?? 20;
    this.food = d.food ?? 20;
    this.saturation = d.saturation ?? 5;
    this.inventory.load(d.inventory || []);
    this.inventory.selected = d.selected || 0;
    this.spawnPoint = d.spawnPoint || { ...this.pos };
    this.flying = !!d.flying;
  }
}

/** Slab method ray/AABB test; returns entry distance or null. */
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
