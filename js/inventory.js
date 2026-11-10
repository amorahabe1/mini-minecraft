// 物品栏数据模型、合成网格、熔炉逻辑
import { ITEMS, maxStack, matchRecipe, SMELTING, FUEL, I } from './registry.js';

export const cloneStack = (s) => (s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null);
export const sameItem = (a, b) => a && b && a.id === b.id && (a.dmg || 0) === (b.dmg || 0) && maxStack(a.id) > 1;

export class Inventory {
  constructor() { this.slots = new Array(36).fill(null); this.selected = 0; }
  held() { return this.slots[this.selected]; }
  // 添加物品，返回剩余数量
  add(stack) {
    let left = stack.count;
    const max = maxStack(stack.id);
    const order = [...Array(36).keys()];
    for (const i of order) {
      const s = this.slots[i];
      if (s && s.id === stack.id && max > 1 && (s.dmg || 0) === (stack.dmg || 0) && s.count < max) {
        const n = Math.min(left, max - s.count); s.count += n; left -= n; if (!left) return 0;
      }
    }
    for (const i of order) {
      if (!this.slots[i]) { const n = Math.min(left, max); this.slots[i] = { id: stack.id, count: n, dmg: stack.dmg || 0 }; left -= n; if (!left) return 0; }
    }
    return left;
  }
  count(id) { return this.slots.reduce((a, s) => a + (s && s.id === id ? s.count : 0), 0); }
  consumeHeld(n = 1) {
    const s = this.held(); if (!s) return;
    s.count -= n; if (s.count <= 0) this.slots[this.selected] = null;
  }
  // 工具耐久，返回是否损坏
  damageHeld(amount = 1) {
    const s = this.held(); if (!s) return false;
    const d = ITEMS.get(s.id); if (!d || !d.tool) return false;
    s.dmg = (s.dmg || 0) + amount;
    if (s.dmg >= d.tool.durability) { this.slots[this.selected] = null; return true; }
    return false;
  }
  toJSON() { return { slots: this.slots, selected: this.selected }; }
  load(o) { if (!o) return; this.slots = o.slots.map(cloneStack); while (this.slots.length < 36) this.slots.push(null); this.selected = o.selected || 0; }
  clear() { this.slots.fill(null); }
}

// 合成网格
export class CraftGrid {
  constructor(w) { this.w = w; this.slots = new Array(w * w).fill(null); this.result = null; this.recipe = null; }
  update() {
    const ids = this.slots.map((s) => (s ? s.id : 0));
    const r = matchRecipe(ids, this.w, this.w);
    this.recipe = r;
    this.result = r ? { id: r.result, count: r.count, dmg: 0 } : null;
  }
  consume() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s) {
        // 桶类配方返还空桶（此处配方不使用）
        s.count--; if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.update();
  }
  takeAll() { const out = this.slots.filter(Boolean); this.slots.fill(null); this.update(); return out; }
}

// 熔炉方块实体
export function newFurnace() { return { type: 'furnace', input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 }; }
export function newChest() { return { type: 'chest', items: new Array(27).fill(null) }; }
export function furnaceTick(f) {
  const wasLit = f.burn > 0;
  if (f.burn > 0) f.burn--;
  const res = f.input ? SMELTING.get(f.input.id) : undefined;
  const canSmelt = res !== undefined && res !== null && (!f.output || (f.output.id === res && f.output.count < maxStack(res)));
  if (f.burn === 0 && canSmelt && f.fuel && FUEL.has(f.fuel.id)) {
    f.burn = f.burnMax = FUEL.get(f.fuel.id);
    if (f.fuel.id === I.lava_bucket) f.fuel = { id: I.bucket, count: 1, dmg: 0 };
    else { f.fuel.count--; if (f.fuel.count <= 0) f.fuel = null; }
  }
  if (f.burn > 0 && canSmelt) {
    f.cook++;
    if (f.cook >= 200) {
      f.cook = 0;
      if (f.output) f.output.count++; else f.output = { id: res, count: 1, dmg: 0 };
      f.input.count--; if (f.input.count <= 0) f.input = null;
    }
  } else if (f.cook > 0) f.cook = Math.max(0, f.cook - 2);
  return wasLit !== (f.burn > 0);
}
