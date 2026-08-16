// DOM based HUD, inventory / crafting / furnace screens and menus.

import * as B from './blocks.js';
import { stack, sameItem, maxDurability } from './inventory.js';
import { findRecipe, consumeGrid, availableRecipes, SMELTING } from './recipes.js';
import { ATLAS_COLS } from './atlas.js';
import { BIOME_NAME } from './worldgen.js';

const ICON = 32;

export class UI {
  constructor(game, atlasCanvas) {
    this.game = game;
    this.atlasURL = atlasCanvas.toDataURL();
    this.screen = null;           // null | 'inventory' | 'crafting' | 'furnace' | 'pause' | 'death'
    this.cursor = null;           // stack held by the mouse
    this.craftGrid = new Array(9).fill(null);
    this.craftSize = 2;
    this.furnace = null;
    this.el = {};
    this.messages = [];
    this.build();
  }

  build() {
    const root = document.getElementById('ui');
    root.innerHTML = `
      <div id="crosshair"></div>
      <div id="hud">
        <div id="stats">
          <div id="hearts" class="iconrow"></div>
          <div id="food" class="iconrow"></div>
        </div>
        <div id="air" class="iconrow"></div>
        <div id="hotbar"></div>
      </div>
      <div id="hotbarLabel"></div>
      <div id="toasts"></div>
      <div id="debug" class="hidden"></div>
      <div id="overlayTint"></div>
      <div id="damageFlash"></div>
      <div id="screen" class="hidden"></div>
      <div id="cursorItem" class="hidden"></div>
    `;
    this.el.hotbar = document.getElementById('hotbar');
    this.el.hearts = document.getElementById('hearts');
    this.el.food = document.getElementById('food');
    this.el.air = document.getElementById('air');
    this.el.debug = document.getElementById('debug');
    this.el.screen = document.getElementById('screen');
    this.el.cursor = document.getElementById('cursorItem');
    this.el.label = document.getElementById('hotbarLabel');
    this.el.toasts = document.getElementById('toasts');
    this.el.tint = document.getElementById('overlayTint');
    this.el.flash = document.getElementById('damageFlash');

    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot hot';
      s.dataset.index = i;
      s.innerHTML = '<div class="icon"></div><span class="count"></span><div class="durability"><i></i></div>';
      s.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.game.player.inventory.selected = i;
        this.showHeldLabel();
      });
      this.el.hotbar.appendChild(s);
    }

    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      if (this.cursor) {
        this.el.cursor.style.left = e.clientX + 'px';
        this.el.cursor.style.top = e.clientY + 'px';
      }
    });
  }

  iconStyle(id) {
    const tile = B.iconTile(id);
    const c = tile % ATLAS_COLS, r = (tile / ATLAS_COLS) | 0;
    return `background-image:url(${this.atlasURL});background-size:${ATLAS_COLS * ICON}px ${ATLAS_COLS * ICON}px;` +
      `background-position:${-c * ICON}px ${-r * ICON}px;`;
  }

  slotHTML(s) {
    if (!s) return '<div class="icon"></div><span class="count"></span><div class="durability"></div>';
    const max = maxDurability(s.id);
    const dur = max ? `<div class="durability show"><i style="width:${Math.max(0, 100 - (s.dmg / max) * 100)}%"></i></div>` : '<div class="durability"></div>';
    return `<div class="icon" style="${this.iconStyle(s.id)}"></div>` +
      `<span class="count">${s.count > 1 ? s.count : ''}</span>${dur}`;
  }

  toast(text) {
    this.messages.push({ text, t: 4 });
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 4000);
  }

  showHeldLabel() {
    const held = this.game.player.inventory.held;
    this.el.label.textContent = held ? B.displayName(held.id) : '';
    this.el.label.classList.remove('fade');
    void this.el.label.offsetWidth;
    this.el.label.classList.add('fade');
  }

  // --- HUD ------------------------------------------------------------------

  updateHUD() {
    const p = this.game.player;
    const inv = p.inventory;
    for (let i = 0; i < 9; i++) {
      const el = this.el.hotbar.children[i];
      const s = inv.slots[i];
      const sig = s ? `${s.id}:${s.count}:${s.dmg}` : '-';
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = this.slotHTML(s);
      }
      el.classList.toggle('selected', i === inv.selected);
    }

    const survival = p.mode === 'survival';
    document.getElementById('stats').style.display = survival ? '' : 'none';
    if (survival) {
      this.renderIcons(this.el.hearts, Math.ceil(p.health / 2), 10, 'heart', p.health % 2 === 1);
      this.renderIcons(this.el.food, Math.ceil(p.food / 2), 10, 'food', p.food % 2 === 1);
    }
    const airPct = p.air / 300;
    this.el.air.style.display = p.submerged && airPct < 1 ? '' : 'none';
    if (p.submerged) this.renderIcons(this.el.air, Math.ceil(airPct * 10), 10, 'bubble', false);

    this.el.tint.className = p.submerged ? 'water' : '';
    this.el.flash.style.opacity = Math.min(0.55, p.hurtFlash * 1.1);
  }

  renderIcons(container, filled, total, cls, half) {
    if (container.childElementCount !== total || container.dataset.cls !== cls) {
      container.dataset.cls = cls;
      container.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const d = document.createElement('i');
        d.className = cls;
        container.appendChild(d);
      }
    }
    for (let i = 0; i < total; i++) {
      const d = container.children[i];
      const on = i < filled;
      d.classList.toggle('on', on);
      d.classList.toggle('half', half && i === filled - 1);
    }
  }

  updateDebug(show) {
    this.el.debug.classList.toggle('hidden', !show);
    if (!show) return;
    const g = this.game;
    const p = g.player;
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    const time = Math.floor(g.world.time);
    const hh = String(Math.floor(((time / 1000) + 6) % 24)).padStart(2, '0');
    const mm = String(Math.floor((time % 1000) / 1000 * 60)).padStart(2, '0');
    this.el.debug.innerHTML = `
      <div>FPS ${g.stats.fps | 0} · 三角形 ${(g.stats.tris / 1000).toFixed(1)}k · 區塊 ${g.stats.visibleChunks}/${g.world.chunks.size}</div>
      <div>XYZ ${p.pos.x.toFixed(2)} / ${p.pos.y.toFixed(2)} / ${p.pos.z.toFixed(2)}</div>
      <div>生態域 ${BIOME_NAME[g.world.biomeAt(bx, bz)]} · 亮度 天${g.world.getLight(0, bx, by + 1, bz)} 火${g.world.getLight(1, bx, by + 1, bz)}</div>
      <div>時間 ${hh}:${mm} · ${g.world.isDay() ? '白天' : '夜晚'} · 生物 ${g.mobs.length} · 掉落物 ${g.items.length}</div>
      <div>種子 ${g.world.seed} · 模式 ${p.mode === 'creative' ? '創造' : '生存'}</div>
    `;
  }

  // --- screens --------------------------------------------------------------

  open(kind, data) {
    this.screen = kind;
    if (kind === 'crafting') { this.craftSize = 3; }
    if (kind === 'inventory') { this.craftSize = 2; }
    if (kind === 'furnace') this.furnace = data;
    this.el.screen.classList.remove('hidden');
    this.renderScreen();
    document.exitPointerLock?.();
  }

  close() {
    // Return anything still on the cursor or in the crafting grid.
    const inv = this.game.player.inventory;
    if (this.cursor) { this.dropOrGive(this.cursor); this.cursor = null; }
    for (let i = 0; i < this.craftGrid.length; i++) {
      if (this.craftGrid[i]) { this.dropOrGive(this.craftGrid[i]); this.craftGrid[i] = null; }
    }
    void inv;
    this.screen = null;
    this.furnace = null;
    this.el.screen.classList.add('hidden');
    this.el.cursor.classList.add('hidden');
  }

  dropOrGive(s) {
    const left = this.game.player.inventory.add(s);
    if (left > 0) this.game.dropItem(stack(s.id, left, s.dmg));
  }

  renderScreen() {
    if (!this.screen) return;
    const html = this.screen === 'pause' ? this.pauseHTML()
      : this.screen === 'death' ? this.deathHTML()
        : this.screen === 'furnace' ? this.furnaceHTML()
          : this.inventoryHTML();
    this.el.screen.innerHTML = html;
    this.bindScreen();
  }

  panelSlot(kind, index, s, extra = '') {
    return `<div class="slot ${extra}" data-kind="${kind}" data-index="${index}">${this.slotHTML(s)}</div>`;
  }

  inventoryHTML() {
    const inv = this.game.player.inventory;
    const n = this.craftSize;
    let grid = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * 3 + x;
        grid += this.panelSlot('craft', i, this.craftGrid[i]);
      }
    }
    const result = findRecipe(
      this.craftGrid.filter((_, i) => (i % 3) < n && Math.floor(i / 3) < n), n, n);
    const resultStack = result ? stack(result.id, result.count) : null;

    let main = '';
    for (let i = 9; i < 36; i++) main += this.panelSlot('inv', i, inv.slots[i]);
    let hot = '';
    for (let i = 0; i < 9; i++) hot += this.panelSlot('inv', i, inv.slots[i]);

    const counts = new Map();
    for (const s of inv.slots) if (s) counts.set(s.id, (counts.get(s.id) || 0) + s.count);
    const recipes = availableRecipes(counts, n)
      .map((r, i) => `<div class="recipe" data-recipe="${i}" title="${B.displayName(r.result.id)}">
          <div class="slot small">${this.slotHTML(r.result)}</div>
        </div>`).join('');
    this.recipeCache = availableRecipes(counts, n);

    return `<div class="panel">
      <div class="panel-title">${n === 3 ? '工作台' : '物品欄'}</div>
      <div class="row top">
        <div class="craft">
          <div class="grid" style="grid-template-columns:repeat(${n},44px)">${grid}</div>
          <div class="arrow">➜</div>
          ${this.panelSlot('result', 0, resultStack, 'result')}
        </div>
        <div class="recipebook">
          <div class="sub">可合成 (點擊製作)</div>
          <div class="recipes">${recipes || '<span class="dim">材料不足</span>'}</div>
        </div>
      </div>
      <div class="sub">物品欄</div>
      <div class="grid inv" style="grid-template-columns:repeat(9,44px)">${main}</div>
      <div class="grid inv hotrow" style="grid-template-columns:repeat(9,44px)">${hot}</div>
      <div class="hint">左鍵拿取／放下 · 右鍵取半／放一個 · E 或 Esc 關閉</div>
    </div>`;
  }

  furnaceHTML() {
    const f = this.furnace;
    const inv = this.game.player.inventory;
    let main = '';
    for (let i = 9; i < 36; i++) main += this.panelSlot('inv', i, inv.slots[i]);
    let hot = '';
    for (let i = 0; i < 9; i++) hot += this.panelSlot('inv', i, inv.slots[i]);
    const cook = Math.min(1, f.cookTime / 200);
    const burn = f.burnTotal ? f.burnTime / f.burnTotal : 0;
    return `<div class="panel">
      <div class="panel-title">熔爐</div>
      <div class="furnace">
        <div class="col">
          ${this.panelSlot('fin', 0, f.input)}
          <div class="flame"><i style="height:${burn * 100}%"></i></div>
          ${this.panelSlot('ffuel', 0, f.fuel)}
        </div>
        <div class="progress"><i style="width:${cook * 100}%"></i></div>
        ${this.panelSlot('fout', 0, f.output, 'result')}
      </div>
      <div class="sub">物品欄</div>
      <div class="grid inv" style="grid-template-columns:repeat(9,44px)">${main}</div>
      <div class="grid inv hotrow" style="grid-template-columns:repeat(9,44px)">${hot}</div>
      <div class="hint">上方放原料，下方放燃料（煤炭／木頭）</div>
    </div>`;
  }

  pauseHTML() {
    return `<div class="panel menu">
      <div class="panel-title">遊戲暫停</div>
      <button data-action="resume">返回遊戲</button>
      <button data-action="mode">切換模式（目前：${this.game.player.mode === 'creative' ? '創造' : '生存'}）</button>
      <button data-action="save">儲存遊戲</button>
      <button data-action="newworld">新世界</button>
      <div class="controls">
        <b>操作</b>
        <div>WASD 移動 · 空白鍵 跳躍 · Shift 潛行 · Ctrl 疾跑</div>
        <div>滑鼠左鍵 挖掘／攻擊 · 右鍵 放置／使用 · 滾輪 或 1-9 切換物品</div>
        <div>E 物品欄 · F 食用 · Q 丟棄 · F3 除錯資訊 · 雙擊空白鍵 飛行（創造）</div>
      </div>
    </div>`;
  }

  deathHTML() {
    return `<div class="panel menu death">
      <div class="panel-title">${this.game.player.deathMessage || '你死了！'}</div>
      <button data-action="respawn">重生</button>
    </div>`;
  }

  bindScreen() {
    const el = this.el.screen;
    el.querySelectorAll('button[data-action]').forEach((b) => {
      b.addEventListener('click', () => this.game.menuAction(b.dataset.action));
    });
    el.querySelectorAll('.recipe').forEach((r) => {
      r.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.craftFromBook(+r.dataset.recipe, e.shiftKey ? 8 : 1);
      });
    });
    el.querySelectorAll('.slot[data-kind]').forEach((s) => {
      s.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.slotClick(s.dataset.kind, +s.dataset.index, e.button, e.shiftKey);
      });
      s.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  craftFromBook(index, times) {
    const list = this.recipeCache || [];
    const r = list[index];
    if (!r) return;
    const inv = this.game.player.inventory;
    for (let t = 0; t < times; t++) {
      for (const [id, n] of r.need) if (inv.count(id) < n) return this.refresh();
      for (const [id, n] of r.need) inv.remove(id, n);
      const left = inv.add(stack(r.result.id, r.result.count));
      if (left > 0) this.game.dropItem(stack(r.result.id, left));
      this.game.sound.click();
    }
    this.refresh();
  }

  getSlotRef(kind, index) {
    const inv = this.game.player.inventory;
    if (kind === 'inv') return { get: () => inv.slots[index], set: (v) => { inv.slots[index] = v; } };
    if (kind === 'craft') return { get: () => this.craftGrid[index], set: (v) => { this.craftGrid[index] = v; } };
    if (kind === 'fin') return { get: () => this.furnace.input, set: (v) => { this.furnace.input = v; } };
    if (kind === 'ffuel') return { get: () => this.furnace.fuel, set: (v) => { this.furnace.fuel = v; } };
    if (kind === 'fout') return { get: () => this.furnace.output, set: (v) => { this.furnace.output = v; } };
    return null;
  }

  slotClick(kind, index, button, shift) {
    const inv = this.game.player.inventory;
    if (kind === 'result') return this.takeCraftResult(button === 2 ? 1 : shift ? 64 : 1);
    if (kind === 'fout') {
      const out = this.furnace.output;
      if (!out) return;
      const left = inv.add(out);
      this.furnace.output = left > 0 ? stack(out.id, left) : null;
      this.refresh();
      return;
    }
    const ref = this.getSlotRef(kind, index);
    if (!ref) return;
    const cur = ref.get();

    if (shift && kind === 'inv') {
      // Quick-move between hotbar and main inventory.
      if (!cur) return;
      ref.set(null);
      const target = index < 9 ? [9, 36] : [0, 9];
      let left = cur.count;
      for (let i = target[0]; i < target[1] && left > 0; i++) {
        const s = inv.slots[i];
        if (s && sameItem(s, cur) && s.count < B.stackSize(cur.id)) {
          const take = Math.min(B.stackSize(cur.id) - s.count, left);
          s.count += take; left -= take;
        }
      }
      for (let i = target[0]; i < target[1] && left > 0; i++) {
        if (!inv.slots[i]) { inv.slots[i] = stack(cur.id, left, cur.dmg); left = 0; }
      }
      if (left > 0) ref.set(stack(cur.id, left, cur.dmg));
      this.refresh();
      return;
    }

    if (button === 2) { // right click: split / drop one
      if (this.cursor) {
        if (!cur) { ref.set(stack(this.cursor.id, 1, this.cursor.dmg)); this.cursor.count--; }
        else if (sameItem(cur, this.cursor) && cur.count < B.stackSize(cur.id)) { cur.count++; this.cursor.count--; }
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (cur) {
        const half = Math.ceil(cur.count / 2);
        this.cursor = stack(cur.id, half, cur.dmg);
        cur.count -= half;
        if (cur.count <= 0) ref.set(null);
      }
    } else {
      if (this.cursor && cur && sameItem(cur, this.cursor)) {
        const max = B.stackSize(cur.id);
        const take = Math.min(max - cur.count, this.cursor.count);
        cur.count += take;
        this.cursor.count -= take;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        const tmp = this.cursor;
        this.cursor = cur;
        ref.set(tmp);
      }
    }
    this.refresh();
  }

  takeCraftResult(times) {
    const n = this.craftSize;
    const sub = this.craftGrid.filter((_, i) => (i % 3) < n && Math.floor(i / 3) < n);
    const r = findRecipe(sub, n, n);
    if (!r) return;
    const inv = this.game.player.inventory;
    for (let t = 0; t < times; t++) {
      const cur = this.craftGrid.filter((_, i) => (i % 3) < n && Math.floor(i / 3) < n);
      if (!findRecipe(cur, n, n)) break;
      const left = inv.add(stack(r.id, r.count));
      if (left > 0) { this.game.dropItem(stack(r.id, left)); }
      // Consume one of each ingredient from the real grid.
      const used = new Array(9).fill(null);
      let k = 0;
      for (let i = 0; i < 9; i++) {
        if ((i % 3) < n && Math.floor(i / 3) < n) used[i] = k++;
      }
      const flat = this.craftGrid.slice();
      for (let i = 0; i < 9; i++) {
        if (used[i] === null) continue;
        const s = flat[i];
        if (!s) continue;
        s.count--;
        if (s.count <= 0) this.craftGrid[i] = null;
      }
      this.game.sound.click();
    }
    void consumeGrid;
    this.refresh();
  }

  refresh() {
    if (!this.screen) return;
    this.renderScreen();
    if (this.cursor) {
      this.el.cursor.classList.remove('hidden');
      this.el.cursor.innerHTML = `<div class="slot">${this.slotHTML(this.cursor)}</div>`;
      this.el.cursor.style.left = (this.mouseX || 0) + 'px';
      this.el.cursor.style.top = (this.mouseY || 0) + 'px';
    } else {
      this.el.cursor.classList.add('hidden');
    }
  }
}

/** Advances a furnace by dt seconds. */
export function tickFurnace(f, dt) {
  const ticks = dt * 20;
  let changed = false;
  const recipe = f.input ? SMELTING.get(f.input.id) : undefined;
  const canOutput = recipe !== undefined &&
    (!f.output || (f.output.id === recipe && f.output.count < B.stackSize(recipe)));

  if (f.burnTime > 0) {
    f.burnTime = Math.max(0, f.burnTime - ticks);
    changed = true;
  }
  if (f.burnTime <= 0 && canOutput && f.fuel) {
    const value = B.fuelValue(f.fuel.id);
    if (value > 0) {
      f.burnTime = value;
      f.burnTotal = value;
      f.fuel.count--;
      if (f.fuel.count <= 0) f.fuel = null;
      changed = true;
    }
  }
  if (f.burnTime > 0 && canOutput) {
    f.cookTime += ticks;
    if (f.cookTime >= 200) {
      f.cookTime = 0;
      f.input.count--;
      if (f.input.count <= 0) f.input = null;
      if (f.output) f.output.count++;
      else f.output = stack(recipe, 1);
    }
    changed = true;
  } else if (f.cookTime > 0) {
    f.cookTime = Math.max(0, f.cookTime - ticks * 2);
    changed = true;
  }
  return changed;
}
