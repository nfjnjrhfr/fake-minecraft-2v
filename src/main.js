// Game bootstrap: input, main loop, saving and glue between systems.

import { buildAtlas } from './atlas.js';
import * as B from './blocks.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Renderer } from './renderer.js';
import { UI, tickFurnace } from './ui.js';
import { Mob, ItemEntity, trySpawn, despawnFar } from './entities.js';
import { Furnace, stack } from './inventory.js';
import { TouchControls, isTouchDevice } from './touch.js';

const SAVE_KEY = 'voxelcraft.save.v1';

// --- audio ------------------------------------------------------------------

class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  noise(dur, freq, gain, type = 'lowpass') {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start();
  }
  tone(freq, dur, gain = 0.08, type = 'square') {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }
  dig(id) {
    const b = B.getBlock(id);
    if (b.tool === 'pickaxe') this.noise(0.12, 1400, 0.22, 'bandpass');
    else if (b.tool === 'axe') this.noise(0.14, 700, 0.2);
    else this.noise(0.16, 420, 0.22);
  }
  place() { this.noise(0.09, 900, 0.18); }
  step(id) {
    const b = B.getBlock(id);
    this.noise(0.06, b.tool === 'pickaxe' ? 1100 : 500, 0.07);
  }
  hit() { this.noise(0.08, 1800, 0.14, 'bandpass'); this.tone(180, 0.06, 0.05, 'sawtooth'); }
  hurt() { this.tone(240, 0.18, 0.09, 'sawtooth'); this.tone(160, 0.22, 0.07, 'square'); }
  eat() { this.noise(0.1, 300, 0.12); }
  pickup() { this.tone(880, 0.06, 0.05, 'sine'); this.tone(1320, 0.07, 0.04, 'sine'); }
  click() { this.tone(660, 0.05, 0.05, 'sine'); }
}

// --- particles --------------------------------------------------------------

class Particles {
  constructor(game) { this.game = game; this.list = []; }
  blockBreak(x, y, z, id) {
    const col = this.game.renderer.blockColors.get(id) || [0.6, 0.6, 0.6];
    for (let i = 0; i < 14; i++) {
      this.list.push({
        x: x + Math.random(), y: y + Math.random(), z: z + Math.random(),
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3.4, vz: (Math.random() - 0.5) * 3,
        life: 0.7 + Math.random() * 0.5,
        size: 0.07 + Math.random() * 0.06,
        r: col[0] * (0.8 + Math.random() * 0.4),
        g: col[1] * (0.8 + Math.random() * 0.4),
        b: col[2] * (0.8 + Math.random() * 0.4),
      });
    }
    if (this.list.length > 400) this.list.splice(0, this.list.length - 400);
  }
  update(dt, world) {
    for (const p of this.list) {
      p.life -= dt;
      p.vy -= 22 * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (world.isSolid(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))) { p.vx *= -0.3; }
      else p.x = nx;
      if (world.isSolid(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; }
      else p.y = ny;
      if (world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))) { p.vz *= -0.3; }
      else p.z = nz;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
}

// --- game -------------------------------------------------------------------

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.atlas = buildAtlas();
    this.renderer = new Renderer(this.canvas, this.atlas);
    this.sound = new Sound();
    this.particles = new Particles(this);
    this.stats = { fps: 0, tris: 0, visibleChunks: 0 };
    this.mobs = [];
    this.items = [];
    this.furnaces = new Map();
    this.showDebug = false;
    this.paused = false;
    this.input = {
      forward: false, back: false, left: false, right: false,
      jump: false, sneak: false, sprint: false, mine: false, use: false,
    };
    this.lastSpace = 0;
    this.useCooldown = 0;
  }

  start(seed, save) {
    this.world = new World(seed);
    if (save) this.world.loadEdits(save.edits);
    const spawn = save && save.player ? save.player.pos : this.world.findSpawn(0, 0);
    this.player = new Player(spawn);
    if (save && save.player) this.player.load(save.player);
    if (save && save.time !== undefined) this.world.time = save.time;
    if (save && save.furnaces) {
      for (const [k, f] of Object.entries(save.furnaces)) {
        const fu = new Furnace();
        Object.assign(fu, f);
        this.furnaces.set(k, fu);
      }
    }
    if (!save) {
      this.player.inventory.add(stack(B.TORCH, 8));
    }
    this.ui = new UI(this, this.atlas.canvas);
    this.touch = isTouchDevice();
    if (this.touch) {
      document.body.classList.add('touch');
      this.renderer.renderDistance = 5;      // tablets have far less fill rate
      this.renderer.maxDpr = 1.25;
      this.renderer.meshBudgetMs = 4;
      this.touchControls = new TouchControls(this);
    }
    this.world.updateChunks(this.player.pos.x, this.player.pos.z, 3, 64);
    this.bindInput();
    if (this.touch) {
      this.ui.toast('左側拖曳移動 · 右側拖曳環顧 · 長按挖掘 · 輕點放置');
    } else {
      this.ui.toast('點擊畫面開始遊玩 · WASD 移動 · E 開物品欄');
      // Embedded frames often disallow pointer lock; say so instead of leaving
      // the player wondering why the mouse does nothing.
      setTimeout(() => {
        if (!this.locked) this.ui.toast('若滑鼠無法轉視角：按住左鍵拖曳畫面即可環顧四周');
      }, 4000);
    }
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  bindInput() {
    const canvas = this.canvas;
    canvas.addEventListener('click', () => {
      if (!this.ui.screen && !this.touch) this.lockPointer();
      this.sound.ensure();
    });
    // Pointer lock is unavailable in some embedded frames; fall back to
    // "hold a mouse button and drag" for looking around.
    document.addEventListener('pointerlockerror', () => { this.lockBlocked = true; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && !this.lockBlocked && !this.ui.screen) this.ui.open('pause');
    });
    document.addEventListener('mousemove', (e) => {
      if (this.touch) return;
      if (!this.locked && !(this.dragging && !this.ui.screen)) return;
      const s = 0.0022;
      let mx = e.movementX, my = e.movementY;
      if (!this.locked) {
        mx = e.clientX - (this.lastMouse ? this.lastMouse.x : e.clientX);
        my = e.clientY - (this.lastMouse ? this.lastMouse.y : e.clientY);
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
      this.player.yaw -= mx * s;
      this.player.pitch -= my * s;
      const lim = Math.PI / 2 - 0.001;
      this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.touch || this.ui.screen) return;
      if (!this.locked) {
        if (e.target !== canvas) return;
        this.dragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
      if (e.button === 0) { this.input.mine = true; this.onAttack(); }
      if (e.button === 2) { this.input.use = true; this.onUse(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (this.touch) return;
      this.dragging = false;
      this.lastMouse = null;
      if (e.button === 0) { this.input.mine = false; this.player.breakProgress = 0; }
      if (e.button === 2) this.input.use = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const inv = this.player.inventory;
      inv.selected = (inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      this.ui.showHeldLabel();
    }, { passive: true });

    document.addEventListener('keydown', (e) => this.onKey(e, true));
    document.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('beforeunload', () => this.save());
  }

  /** Requests pointer lock, tolerating frames where it is disallowed. */
  lockPointer() {
    if (this.lockBlocked || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { this.lockBlocked = true; });
    } catch { this.lockBlocked = true; }
  }

  onKey(e, down) {
    const i = this.input;
    const code = e.code;
    if (down && (code === 'KeyE' || code === 'Escape')) {
      if (this.ui.screen === 'death') return;
      if (this.ui.screen) { this.ui.close(); this.lockPointer(); }
      else if (code === 'KeyE') this.ui.open('inventory');
      else this.ui.open('pause');
      e.preventDefault();
      return;
    }
    if (this.ui.screen) return;
    switch (code) {
      case 'KeyW': i.forward = down; break;
      case 'KeyS': i.back = down; break;
      case 'KeyA': i.left = down; break;
      case 'KeyD': i.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': i.sneak = down; break;
      case 'ControlLeft': case 'ControlRight': i.sprint = down; break;
      case 'Space':
        i.jump = down;
        if (down) {
          const now = performance.now();
          if (now - this.lastSpace < 320 && this.player.mode === 'creative') {
            this.player.flying = !this.player.flying;
            this.player.vel.y = 0;
          }
          this.lastSpace = now;
        }
        break;
      case 'KeyF': if (down) this.player.eat(this); break;
      case 'KeyQ': if (down) this.dropHeld(); break;
      case 'F3': if (down) { this.showDebug = !this.showDebug; e.preventDefault(); } break;
      default:
        if (down && code.startsWith('Digit')) {
          const n = +code.slice(5);
          if (n >= 1 && n <= 9) { this.player.inventory.selected = n - 1; this.ui.showHeldLabel(); }
        }
    }
  }

  onAttack() {
    const target = this.target;
    const d = this.player.lookVector();
    // Prefer hitting a mob if one is in front of the block.
    let mobDist = Infinity;
    for (const m of this.mobs) {
      const t = rayHit(this.player, m, d);
      if (t !== null && t < mobDist) mobDist = t;
    }
    if (mobDist < (target ? target.dist : 4.2)) {
      this.player.attack(this, this.mobs);
      return;
    }
    this.player.swingTime = 0.22;
  }

  onUse() {
    const t = this.target;
    const player = this.player;
    if (t) {
      const id = t.id;
      if (id === B.CRAFTING_TABLE) { this.ui.open('crafting'); return; }
      if (id === B.FURNACE || id === B.FURNACE_LIT) {
        const key = `${t.x},${t.y},${t.z}`;
        let f = this.furnaces.get(key);
        if (!f) { f = new Furnace(); this.furnaces.set(key, f); }
        this.ui.open('furnace', f);
        return;
      }
    }
    const held = player.inventory.held;
    if (held && B.getItem(held.id) && B.getItem(held.id).food) {
      if (player.eat(this)) return;
    }
    if (player.place(this.world, this, t)) this.useCooldown = 0.22;
    else player.swingTime = 0.2;
  }

  dropHeld() {
    const inv = this.player.inventory;
    const s = inv.held;
    if (!s) return;
    const one = stack(s.id, 1, s.dmg);
    inv.consumeSelected(1);
    this.dropItem(one);
  }

  dropItem(s) {
    const p = this.player;
    const d = p.lookVector();
    const e = new ItemEntity(p.pos.x + d.x * 0.6, p.eyeY - 0.3, p.pos.z + d.z * 0.6, s);
    e.vx = d.x * 5; e.vy = d.y * 4 + 1.6; e.vz = d.z * 5;
    e.age = 0.2;
    this.items.push(e);
  }

  menuAction(action) {
    switch (action) {
      case 'resume':
        this.ui.close();
        this.lockPointer();
        break;
      case 'mode':
        this.player.mode = this.player.mode === 'creative' ? 'survival' : 'creative';
        if (this.player.mode === 'survival') this.player.flying = false;
        else this.giveCreativeKit();
        this.ui.renderScreen();
        break;
      case 'save':
        this.save();
        this.ui.toast('已儲存');
        break;
      case 'newworld':
        if (confirm('建立新世界？目前的進度會被覆蓋。')) {
          try { localStorage.removeItem(SAVE_KEY); } catch { /* storage may be blocked */ }
          location.reload();
        }
        break;
      case 'respawn':
        this.player.respawn(this.world);
        this.ui.close();
        this.lockPointer();
        break;
    }
  }

  giveCreativeKit() {
    const inv = this.player.inventory;
    const kit = [B.STONE, B.GRASS, B.PLANKS, B.LOG, B.GLASS, B.TORCH, B.COBBLESTONE, B.SAND, B.GLOWSTONE];
    for (let i = 0; i < kit.length; i++) {
      if (!inv.slots[i]) inv.slots[i] = stack(kit[i], 64);
    }
  }

  save() {
    try {
      const furnaces = {};
      for (const [k, f] of this.furnaces) {
        furnaces[k] = {
          input: f.input, fuel: f.fuel, output: f.output,
          burnTime: f.burnTime, burnTotal: f.burnTotal, cookTime: f.cookTime,
        };
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        seed: this.world.seed,
        time: this.world.time,
        edits: this.world.serializeEdits(),
        player: this.player.serialize(),
        furnaces,
      }));
    } catch (err) {
      console.warn('save failed', err);
    }
  }

  loop = (now) => {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.stats.fps = this.stats.fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

    const active = !this.ui.screen;
    if (active) this.update(dt);
    else if (this.ui.screen === 'furnace' && this.ui.furnace) {
      if (tickFurnace(this.ui.furnace, dt)) this.ui.refresh();
    }

    this.renderer.render(this, dt);
    this.ui.updateHUD();
    this.ui.updateDebug(this.showDebug);
    requestAnimationFrame(this.loop);
  };

  update(dt) {
    const world = this.world;
    const player = this.player;

    world.tick(dt);
    world.updateChunks(player.pos.x, player.pos.z, this.renderer.renderDistance, 2);

    player.update(dt, this.input, world, this);
    this.target = player.targetBlock(world);

    if (this.input.mine && player.health > 0) {
      player.swingTime = Math.max(player.swingTime, 0.12);
      player.mine(dt, world, this, this.target);
    }
    if (this.input.use) {
      this.useCooldown -= dt;
      if (this.useCooldown <= 0) {
        const held = player.inventory.held;
        if (held && held.id < B.ITEM_BASE) { this.onUse(); this.useCooldown = 0.22; }
      }
    }

    for (const m of this.mobs) m.update(dt, world, this);
    for (const it of this.items) it.update(dt, world, this);
    this.items = this.items.filter((i) => !i.dead);
    for (const m of this.mobs) {
      if (m.dead && !m.dropped) {
        m.dropped = true;
        for (const s of m.model.drop()) this.items.push(new ItemEntity(m.x, m.y + 0.4, m.z, s));
      }
    }
    despawnFar(this);
    trySpawn(world, this, dt);
    this.particles.update(dt, world);

    // Furnaces keep smelting while the world is loaded.
    for (const [key, f] of this.furnaces) {
      if (f.input || f.burnTime > 0) {
        const wasLit = f.lit;
        tickFurnace(f, dt);
        if (wasLit !== f.lit) {
          const [x, y, z] = key.split(',').map(Number);
          const cur = world.getBlock(x, y, z);
          if (cur === B.FURNACE || cur === B.FURNACE_LIT) {
            world.setBlock(x, y, z, f.lit ? B.FURNACE_LIT : B.FURNACE);
          }
        }
      }
    }

    if (player.health <= 0 && this.ui.screen !== 'death') {
      this.ui.open('death');
    }

    this.saveTimer = (this.saveTimer || 0) + dt;
    if (this.saveTimer > 30) { this.saveTimer = 0; this.save(); }
  }
}

function rayHit(player, mob, d) {
  const ox = player.pos.x, oy = player.eyeY, oz = player.pos.z;
  let tmin = 0, tmax = 5;
  const lo = [mob.x - mob.w / 2, mob.y, mob.z - mob.w / 2];
  const hi = [mob.x + mob.w / 2, mob.y + mob.h, mob.z + mob.w / 2];
  const o = [ox, oy, oz], dir = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - o[i]) / dir[i], t2 = (hi[i] - o[i]) / dir[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

// --- boot -------------------------------------------------------------------

function boot() {
  const game = new Game();
  window.game = game;
  let save = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = JSON.parse(raw);
  } catch { save = null; }

  const params = new URLSearchParams(location.search);
  let seed = save ? save.seed : (Math.random() * 2 ** 31) | 0;
  if (params.has('seed')) {
    const s = params.get('seed');
    seed = /^-?\d+$/.test(s) ? +s : hashString(s);
    save = null;
  }
  game.start(seed, save);
  document.getElementById('loading').remove();
  void Mob;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    boot();
  } catch (err) {
    console.error(err);
    const l = document.getElementById('loading');
    if (l) l.innerHTML = `<div class="err">啟動失敗：${err.message}</div>`;
  }
});
