// Item stacks, the player inventory and container (furnace) state.

import { stackSize, getItem, ITEM_BASE } from './blocks.js';

export function stack(id, count = 1, dmg = 0) {
  return { id, count, dmg };
}

export function sameItem(a, b) {
  return a && b && a.id === b.id && a.dmg === b.dmg;
}

export function maxDurability(id) {
  const it = id >= ITEM_BASE ? getItem(id) : null;
  return it ? it.durability : 0;
}

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.selected = 0;
  }

  get held() { return this.slots[this.selected]; }
  get heldId() { return this.slots[this.selected] ? this.slots[this.selected].id : 0; }

  /** Adds a stack, merging where possible. Returns the count that did not fit. */
  add(s) {
    let left = s.count;
    const max = stackSize(s.id);
    if (max > 1) {
      for (let i = 0; i < this.slots.length && left > 0; i++) {
        const cur = this.slots[i];
        if (cur && cur.id === s.id && cur.dmg === s.dmg && cur.count < max) {
          const take = Math.min(max - cur.count, left);
          cur.count += take;
          left -= take;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, left);
        this.slots[i] = stack(s.id, take, s.dmg);
        left -= take;
      }
    }
    return left;
  }

  canAccept(s) {
    const max = stackSize(s.id);
    for (const cur of this.slots) {
      if (!cur) return true;
      if (cur.id === s.id && cur.dmg === s.dmg && cur.count < max) return true;
    }
    return false;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Removes n of an item; returns how many were actually removed. */
  remove(id, n) {
    let left = n;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return n - left;
  }

  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    return true;
  }

  /** Applies tool wear; breaks the tool when durability runs out. */
  damageSelected(amount = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    const max = maxDurability(s.id);
    if (!max) return false;
    s.dmg += amount;
    if (s.dmg >= max) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  serialize() {
    return this.slots.map((s) => (s ? [s.id, s.count, s.dmg] : 0));
  }

  load(data) {
    this.slots = this.slots.map((_, i) => {
      const d = data[i];
      return d ? stack(d[0], d[1], d[2] || 0) : null;
    });
  }
}

export class Furnace {
  constructor() {
    this.input = null;
    this.fuel = null;
    this.output = null;
    this.burnTime = 0;     // ticks of fuel left
    this.burnTotal = 0;
    this.cookTime = 0;     // ticks of progress on the current item
  }
  get lit() { return this.burnTime > 0; }
}
