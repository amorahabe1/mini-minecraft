// 界面：HUD、物品栏/合成/熔炉/箱子/创造模式物品栏（MC 点击规则）、菜单、聊天
import { ITEMS, maxStack, itemName, FUEL, SMELTING, CREATIVE_TABS, I, B, TILES, FACE_TILES, durabilityOf, ARMOR_SLOTS } from './registry.js';
import { cloneStack, sameItem } from './inventory.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const px = (v) => `calc(var(--s) * ${v}px)`;

function pixelIcon(draw, w = 9, h = 9) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g); return c.toDataURL();
}
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
function heartIcon(fill, half, bg = '#1e1e1e', col = '#ff1313', hi = '#ff9a9a') {
  return pixelIcon((g) => {
    const draw = (x0, y0, color, mask) => { HEART.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#' && mask(x)) { g.fillStyle = color; g.fillRect(x0 + x, y0 + y, 1, 1); } })); };
    // 外框
    g.fillStyle = bg; HEART.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') { g.fillRect(x + 1, y + 1, 1, 1); g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x, y + 2, 1, 1); g.fillRect(x + 1, y + 3, 1, 1); } }));
    g.fillStyle = '#000'; HEART.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') g.fillRect(x + 1, y + 2, 1, 1); }));
    if (fill) { draw(1, 2, col, (x) => !half || x < 3); g.fillStyle = hi; if (!half || true) g.fillRect(2, 3, 1, 1); }
    else draw(1, 2, '#3a0000', () => true);
  });
}
function foodIcon(fill, half) {
  return pixelIcon((g) => {
    const shape = ['....##', '...#ab#', '..#aab#', '.#aaa#.', '#cc##..', '#c#....', '.#.....'];
    shape.forEach((r, y) => [...r].forEach((ch, x) => {
      let c = null;
      if (ch === '#') c = '#1e1e1e';
      else if (ch === 'a') c = fill && (!half || x >= 3) ? '#b8732c' : '#3a2a1a';
      else if (ch === 'b') c = fill && (!half || x >= 3) ? '#e09a50' : '#3a2a1a';
      else if (ch === 'c') c = fill && !half ? '#f0e6d8' : (fill ? '#f0e6d8' : '#3a3a3a');
      if (c) { g.fillStyle = c; g.fillRect(x + 1, y + 1, 1, 1); }
    }));
  });
}
// HUD 护甲图标（胸甲轮廓：满 / 半 / 空）
const ARMOR_SHAPE = ['##...##', '#a#.#a#', '#aa#aa#', '.#aaa#.', '.#aaa#.', '.#aaa#.', '.#####.'];
function armorIcon(kind) {
  return pixelIcon((g) => {
    ARMOR_SHAPE.forEach((r, y) => [...r].forEach((ch, x) => {
      let c = null;
      if (ch === '#') c = '#1e1e1e';
      else if (ch === 'a') { const on = kind === 'full' || (kind === 'half' && x < 3); c = on ? (y < 2 || x === 1 ? '#f2f2f2' : '#bfc3c8') : '#3c3c3c'; }
      if (c) { g.fillStyle = c; g.fillRect(x + 1, y + 1, 1, 1); }
    }));
  });
}
// 物品栏中空盔甲槽的占位轮廓
const SLOT_SHAPES = [
  ['..####..', '.#....#.', '#......#', '#..##..#', '##....##', '........'],
  ['##....##', '#.#..#.#', '#..##..#', '.#....#.', '.#....#.', '.#....#.', '.######.'],
  ['.######.', '.#....#.', '.#.##.#.', '.#.#.##.', '.#.#.#..', '.###.#..', '.....##.'],
  ['........', '.##..##.', '.#....#.', '.#....#.', '##....##', '###..###'],
];
function slotShape(i) {
  return pixelIcon((g) => {
    const sh = SLOT_SHAPES[i], oy = Math.floor((16 - sh.length * 2) / 2);
    g.fillStyle = 'rgba(55,55,55,0.75)';
    sh.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') g.fillRect(x * 2, oy + y * 2, 2, 2); }));
  }, 16, 16);
}
function bubbleIcon(pop) {
  return pixelIcon((g) => {
    g.fillStyle = '#1e4e9e'; g.fillRect(2, 1, 5, 7); g.fillRect(1, 2, 7, 5);
    g.fillStyle = pop ? '#7aa0e0' : '#9cc4ff'; g.fillRect(2, 2, 5, 5);
    g.fillStyle = '#fff'; g.fillRect(3, 3, 1, 1);
  });
}

export class UI {
  constructor(game) {
    this.game = game;
    this.cursor = null;
    this.screen = null; // { type, bindings }
    this.drag = null;
    this.lastClick = { t: 0, slot: null };
    this.icons = new Map();
    this.creativeTab = 'building'; this.creativeScroll = 0; this.creativeSearch = '';
    this.hud = $('#hud');
    this.buildHUD();
    this.icHeart = { full: heartIcon(true, false), half: heartIcon(true, true), empty: heartIcon(false, false) };
    this.icFood = { full: foodIcon(true, false), half: foodIcon(true, true), empty: foodIcon(false, false) };
    this.icBubble = { full: bubbleIcon(false), pop: bubbleIcon(true) };
    this.icArmor = { full: armorIcon('full'), half: armorIcon('half'), empty: armorIcon('empty') };
    this.slotShapes = [0, 1, 2, 3].map(slotShape);
    this.cursorEl = el('div', '', document.body); this.cursorEl.id = 'cursorItem';
    this.tooltip = el('div', 'hidden', document.body); this.tooltip.id = 'tooltip';
    document.addEventListener('mousemove', (e) => { this.mx = e.clientX; this.my = e.clientY; this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px'; if (!this.tooltip.classList.contains('hidden')) this.placeTooltip(); });
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('resize', () => this.updateScale());
    this.updateScale();
  }
  setIcons(icons, tileCv) { this.icons = icons; this.tileCv = tileCv; }
  updateScale() {
    const auto = Math.max(1, Math.min(4, Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240))));
    const gs = this.game.settings && this.game.settings.guiScale ? Math.min(auto, this.game.settings.guiScale) : auto;
    this.scale = gs;
    document.documentElement.style.setProperty('--s', gs);
  }

  // ---------------- HUD ----------------
  buildHUD() {
    const h = this.hud;
    h.innerHTML = `
      <div id="crosshair"></div><div id="attackInd" class="hidden"><div></div></div>
      <div id="debug" class="hidden"></div><div id="debugR" class="hidden"></div>
      <div id="chat"></div>
      <div id="itemName" class="txt"></div>
      <div id="stats"><div id="armor"></div><div id="hearts"></div><div id="food"></div><div id="air"></div></div>
      <div id="actionbar" class="txt"></div>
      <div id="sleepFade" class="hidden"></div>
      <div id="hotbar"><div id="hotsel"></div></div>`;
    const hb = $('#hotbar');
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) { const s = el('div', 'hs', hb); s.style.left = px(1 + i * 20); this.hotSlots.push(s); }
    this.heartEls = []; this.foodEls = []; this.airEls = []; this.armorEls = [];
    for (let i = 0; i < 10; i++) { this.heartEls.push(el('img', '', $('#hearts'))); this.foodEls.push(el('img', '', $('#food'))); this.airEls.push(el('img', '', $('#air'))); this.armorEls.push(el('img', '', $('#armor'))); }
    this.lastHud = {};
  }
  stackHTML(s) {
    if (!s) return '';
    const d = ITEMS.get(s.id);
    let h = `<img class="icon" src="${this.icons.get(s.id) || ''}">`;
    if (s.count > 1) h += `<span class="cnt">${s.count}</span>`;
    const maxD = durabilityOf(d);
    if (maxD && s.dmg > 0) {
      const f = 1 - s.dmg / maxD;
      const col = `hsl(${Math.round(f * 120)},100%,50%)`;
      h += `<div class="dur"><div style="width:${Math.round(f * 13) / 13 * 100}%;background:${col}"></div></div>`;
    }
    return h;
  }
  updateHUD() {
    const g = this.game, p = g.player, inv = p.inventory;
    const key = inv.slots.slice(0, 9).map((s) => (s ? s.id + ':' + s.count + ':' + (s.dmg || 0) : '-')).join(',');
    if (key !== this.lastHud.hot) { this.lastHud.hot = key; for (let i = 0; i < 9; i++) this.hotSlots[i].innerHTML = this.stackHTML(inv.slots[i]); }
    if (inv.selected !== this.lastHud.sel) {
      this.lastHud.sel = inv.selected; $('#hotsel').style.left = px(-2 + inv.selected * 20);
    }
    const heldId = inv.held() ? inv.held().id : 0;
    if (heldId !== this.lastHud.held || inv.selected !== this.lastHud.sel2) {
      this.lastHud.held = heldId; this.lastHud.sel2 = inv.selected;
      if (heldId) { const n = $('#itemName'); n.textContent = itemName(heldId); n.style.opacity = 1; clearTimeout(this.nameT); this.nameT = setTimeout(() => (n.style.opacity = 0), 2000); }
      else $('#itemName').style.opacity = 0;
    }
    const survival = p.mode === 'survival';
    if (survival) {
      const ap = inv.armorPoints().armor;
      const hk = Math.ceil(p.health) + ':' + p.food + ':' + Math.ceil(p.airSupply / 30) + ':' + (p.hurtTime > 0) + ':' + ap;
      if (hk !== this.lastHud.stats) {
        this.lastHud.stats = hk;
        const hp = Math.ceil(p.health);
        const lowJitter = hp <= 4;
        for (let i = 0; i < 10; i++) {
          const v = hp - i * 2;
          this.heartEls[i].src = v >= 2 ? this.icHeart.full : v === 1 ? this.icHeart.half : this.icHeart.empty;
          this.heartEls[i].style.transform = lowJitter ? `translateY(${px(Math.round(Math.random() * 2 - 1))})` : '';
          const f = p.food - i * 2;
          this.foodEls[i].src = f >= 2 ? this.icFood.full : f === 1 ? this.icFood.half : this.icFood.empty;
        }
        // 护甲值（Java Gui.renderArmor：有护甲时显示在生命值上方）
        $('#armor').style.visibility = ap > 0 ? 'visible' : 'hidden';
        for (let i = 0; i < 10; i++) { const v = ap - i * 2; this.armorEls[i].src = v >= 2 ? this.icArmor.full : v === 1 ? this.icArmor.half : this.icArmor.empty; }
        const underwater = p.eyeInWater;
        const bubbles = Math.ceil((p.airSupply * 10) / 300);
        for (let i = 0; i < 10; i++) {
          this.airEls[i].style.visibility = underwater || p.airSupply < 300 ? (i < bubbles ? 'visible' : 'hidden') : 'hidden';
          this.airEls[i].src = this.icBubble.full;
        }
      }
    }
    // 攻击冷却指示
    const ai = $('#attackInd');
    const cd = p.attackCooldownProgress ? p.attackCooldownProgress() : 1;
    if (cd < 1 && survival) { ai.classList.remove('hidden'); ai.firstChild.style.width = Math.round(cd * 100) + '%'; } else ai.classList.add('hidden');
    this.syncChrome();
  }
  /** 按当前界面状态显示/隐藏准星、快捷栏、聊天等，避免叠在菜单或物品栏上。 */
  syncChrome() {
    const g = this.game;
    const menu = document.getElementById('menu');
    const menuOpen = !!(menu && !menu.classList.contains('hidden'));
    const death = !!document.querySelector('.death');
    const screenOpen = this.isOpen();
    const inWorld = !!(g.inWorld && !g.loading);
    const f1 = !!g.hudHidden;
    const hideShell = !inWorld || f1;
    const hidePlay = hideShell || death || screenOpen;
    const hideCenter = hidePlay || menuOpen;
    this.hud.style.display = hideShell ? 'none' : '';
    const setH = (id, hid) => { const e = document.getElementById(id); if (e) e.classList.toggle('hidden', hid); };
    setH('crosshair', hideCenter);
    setH('itemName', hideCenter);
    setH('chat', hideCenter);
    setH('hotbar', hidePlay);
    setH('stats', hidePlay || (g.player && g.player.mode !== 'survival'));
    setH('debug', hidePlay || !g.showDebug);
    setH('debugR', hidePlay || !g.showDebug);
    if (hideCenter) setH('attackInd', true);
    if (menu) menu.classList.toggle('in-game', menuOpen && inWorld && menu.classList.contains('dim'));
    this.hideHand = hideCenter;
  }
  setHudVisible(v) { this.hud.style.display = v ? '' : 'none'; this.syncChrome(); }

  // ---------------- 聊天 ----------------
  addMessage(text, actionbar) {
    if (actionbar) {
      const a = $('#actionbar'); a.textContent = text; a.style.opacity = 1;
      clearTimeout(this.abT); this.abT = setTimeout(() => (a.style.opacity = 0), 3000);
      return;
    }
    const c = $('#chat');
    const m = el('div', 'msg txt', c); m.textContent = text;
    while (c.children.length > 10) c.removeChild(c.firstChild);
    setTimeout(() => { m.style.opacity = 0; setTimeout(() => m.remove(), 1000); }, 9000);
  }
  openChat(prefix = '') {
    this.closeChat();
    const inp = el('input', '', document.body); inp.id = 'chatInput'; inp.value = prefix; inp.maxLength = 256;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = inp.value.trim(); this.closeChat(); if (v) this.game.chat(v); this.game.resume(); }
      else if (e.key === 'Escape') { this.closeChat(); this.game.resume(); }
    });
    this.chatOpen = true;
    const focusChat = () => { if (this.chatOpen && document.getElementById('chatInput') === inp) inp.focus(); };
    setTimeout(focusChat, 0);
    setTimeout(focusChat, 80);
  }
  closeChat() { const i = $('#chatInput'); if (i) i.remove(); this.chatOpen = false; }

  // ---------------- 容器界面 ----------------
  isOpen() { return !!this.screen; }
  open(type, data) {
    this.close(true);
    this.hover = null;
    this.tooltip.classList.add('hidden');
    this.screen = { type, data, bindings: [] };
    const root = el('div', '', document.body); root.id = 'screen';
    this.screen.root = root;
    if (type === 'inventory' && this.game.player.mode === 'creative') { this.screen.type = type = 'creative'; }
    if (type === 'inventory') this.buildInventory(root);
    else if (type === 'crafting') this.buildCrafting(root);
    else if (type === 'furnace') this.buildFurnace(root, data);
    else if (type === 'chest') this.buildChest(root, data);
    else if (type === 'creative') this.buildCreative(root);
    root.addEventListener('mousedown', (e) => { if (e.target === root) this.clickOutside(e); });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('wheel', (e) => { if (this.screen && this.screen.type === 'creative') { this.scrollCreative(e.deltaY > 0 ? 1 : -1); } });
    this.refresh();
    this.syncChrome();
  }
  close(silent) {
    if (!this.screen) return;
    const g = this.game, inv = g.player.inventory;
    // 合成网格物品返还
    for (const grid of [g.player.craft2, this.screen.craft3]) {
      if (!grid) continue;
      for (const s of grid.takeAll()) { const left = inv.add(s); if (left) g.dropStack({ ...s, count: left }); }
    }
    if (this.cursor) { const left = inv.add(this.cursor); if (left) g.dropStack({ ...this.cursor, count: left }); this.cursor = null; }
    this.screen.root.remove();
    this.screen = null;
    this.hover = null;
    this.tooltip.classList.add('hidden');
    this.cursorEl.innerHTML = '';
    if (!silent) g.onScreenClosed();
    this.syncChrome();
  }
  panel(root, w, h) { const p = el('div', 'panel', root); p.style.width = px(w + 4); p.style.height = px(h + 4); return p; }
  label(p, text, x, y) { const l = el('div', 'lbl', p); l.textContent = text; l.style.left = px(x); l.style.top = px(y); return l; }
  slot(p, x, y, binding, big) {
    const s = el('div', 'slot' + (big ? ' big' : ''), p);
    s.style.left = px(x - 1); s.style.top = px(y - 1);
    binding.el = s;
    this.screen.bindings.push(binding);
    s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.onSlotDown(binding, e); });
    s.addEventListener('mouseenter', () => { this.hover = binding; this.onSlotEnter(binding); this.showTooltip(binding); });
    s.addEventListener('mouseleave', () => { if (this.hover === binding) this.hover = null; this.tooltip.classList.add('hidden'); });
    return s;
  }
  invBindings(p, x0, y0, group = 'inv') {
    const inv = this.game.player.inventory;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      const i = 9 + r * 9 + c;
      this.slot(p, x0 + c * 18, y0 + r * 18, { get: () => inv.slots[i], set: (v) => (inv.slots[i] = v), group: 'main', idx: i });
    }
    for (let c = 0; c < 9; c++) this.slot(p, x0 + c * 18, y0 + 58, { get: () => inv.slots[c], set: (v) => (inv.slots[c] = v), group: 'hotbar', idx: c });
    void group;
  }
  gridBindings(p, grid, x0, y0, resultX, resultY) {
    const w = grid.w;
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
      const i = r * w + c;
      this.slot(p, x0 + c * 18, y0 + r * 18, { get: () => grid.slots[i], set: (v) => { grid.slots[i] = v; grid.update(); }, group: 'grid', grid });
    }
    this.slot(p, resultX, resultY, { get: () => grid.result, set: () => {}, result: true, group: 'result', grid, take: () => { const r = cloneStack(grid.result); grid.consume(); return r; } }, true);
  }
  buildInventory(root) {
    const p = this.panel(root, 176, 166);
    const g = this.game;
    this.armorBindings(p, [[8, 8], [8, 26], [8, 44], [8, 62]]);
    const prev = el('div', 'preview', p); prev.style.left = px(26); prev.style.top = px(8); prev.style.width = px(51); prev.style.height = px(72);
    this.screen.preview = prev.appendChild(this.game.playerPreviewCanvas());
    this.label(p, '合成', 97, 8);
    this.gridBindings(p, g.player.craft2, 98, 18, 154, 28);
    this.screen.bindings[this.screen.bindings.length - 1].el.style.left = px(150); this.screen.bindings[this.screen.bindings.length - 1].el.style.top = px(24);
    const ar = el('div', 'arrow', p); ar.style.left = px(134); ar.style.top = px(28);
    this.invBindings(p, 8, 84);
  }
  // 盔甲槽：只接受对应部位的盔甲
  armorBindings(p, pos) {
    const inv = this.game.player.inventory;
    for (let i = 0; i < 4; i++) {
      const b = { get: () => inv.armor[i], set: (v) => { const old = inv.armor[i]; inv.armor[i] = v; if (v && (!old || old.id !== v.id)) { const d = ITEMS.get(v.id); this.game.audio.play('armor_equip', { material: d.armor.material }); } }, group: 'armor', idx: i,
        accept: (s) => { const d = ITEMS.get(s.id); return !!(d && d.armor && d.armor.slot === i); } };
      const sl = this.slot(p, pos[i][0], pos[i][1], b);
      sl.classList.add('armorSlot');
      sl.style.backgroundImage = `url(${this.slotShapes[i]})`;
      sl.title = ARMOR_SLOTS[i].name;
    }
  }
  buildCrafting(root) {
    const p = this.panel(root, 176, 166);
    const grid = this.screen.craft3 = new this.game.CraftGrid(3);
    this.label(p, '合成', 28, 6);
    this.gridBindings(p, grid, 30, 17, 124, 35);
    const rb = this.screen.bindings[this.screen.bindings.length - 1].el; rb.style.left = px(120); rb.style.top = px(31);
    const ar = el('div', 'arrow', p); ar.style.left = px(90); ar.style.top = px(35);
    this.label(p, '物品栏', 8, 73);
    this.invBindings(p, 8, 84);
  }
  buildFurnace(root, te) {
    const p = this.panel(root, 176, 166);
    this.label(p, '熔炉', 75, 6);
    this.slot(p, 56, 17, { get: () => te.input, set: (v) => (te.input = v), group: 'furnaceIn' });
    this.slot(p, 56, 53, { get: () => te.fuel, set: (v) => (te.fuel = v), group: 'furnaceFuel', accept: (s) => FUEL.has(s.id) });
    this.slot(p, 112, 31, { get: () => te.output, set: (v) => (te.output = v), group: 'furnaceOut', output: true }, true);
    const fl = el('div', 'flame', p, '<div class="bg"></div><div class="fg"></div>'); fl.style.left = px(57); fl.style.top = px(37);
    const ar = el('div', 'arrow', p, '<div class="prog"><div class="arrow"></div></div>'); ar.style.left = px(80); ar.style.top = px(35);
    this.screen.flame = fl.querySelector('.fg'); this.screen.prog = ar.querySelector('.prog');
    this.label(p, '物品栏', 8, 73);
    this.invBindings(p, 8, 84);
  }
  buildChest(root, te) {
    const p = this.panel(root, 176, 166);
    this.label(p, '箱子', 8, 6);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      const i = r * 9 + c;
      this.slot(p, 8 + c * 18, 18 + r * 18, { get: () => te.items[i], set: (v) => (te.items[i] = v), group: 'chest' });
    }
    this.label(p, '物品栏', 8, 73);
    this.invBindings(p, 8, 84);
  }
  buildCreative(root) {
    const p = this.panel(root, 195, 136);
    this.screen.panel = p;
    const top = el('div', 'tabs', p); top.style.left = px(0); top.style.top = px(-32);
    for (const t of CREATIVE_TABS) {
      const tb = el('div', 'tab' + (t.key === this.creativeTab ? ' active' : ''), top);
      const id = I[t.icon] ?? I.compass ?? I.chest;
      tb.innerHTML = `<img src="${this.icons.get(id) || this.icons.get(I.chest)}">`;
      tb.title = t.name;
      tb.addEventListener('mousedown', (e) => { e.stopPropagation(); this.creativeTab = t.key; this.creativeScroll = 0; this.open('creative'); });
    }
    const tab = CREATIVE_TABS.find((t) => t.key === this.creativeTab);
    this.label(p, this.creativeTab === 'inventory' ? '物品栏' : tab.name, 8, 6);
    if (this.creativeTab === 'inventory') {
      const prev = el('div', 'preview', p); prev.style.left = px(73); prev.style.top = px(5); prev.style.width = px(32); prev.style.height = px(43);
      this.screen.preview = prev.appendChild(this.game.playerPreviewCanvas());
      this.armorBindings(p, [[54, 6], [54, 33], [108, 6], [108, 33]]);
      const inv = this.game.player.inventory;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const i = 9 + r * 9 + c; this.slot(p, 9 + c * 18, 54 + r * 18, { get: () => inv.slots[i], set: (v) => (inv.slots[i] = v), group: 'main' }); }
    } else {
      if (this.creativeTab === 'search') {
        const s = el('input', 'search', p); s.style.left = px(82); s.style.top = px(4); s.style.width = px(89); s.style.height = px(12);
        s.value = this.creativeSearch; s.placeholder = '搜索...';
        s.addEventListener('input', () => { this.creativeSearch = s.value; this.creativeScroll = 0; this.fillCreative(); });
        s.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
          e.stopPropagation();
        });
        s.addEventListener('mousedown', (e) => e.stopPropagation());
        setTimeout(() => s.focus(), 0);
      }
      this.screen.cgrid = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
        const b = { get: () => b.item ? { id: b.item, count: 1, dmg: 0 } : null, set: () => {}, creative: true, item: 0 };
        this.slot(p, 9 + c * 18, 18 + r * 18, b);
        this.screen.cgrid.push(b);
      }
      const sc = el('div', 'scroll', p); sc.style.left = px(174); sc.style.top = px(17); sc.style.width = px(14); sc.style.height = px(90);
      this.screen.knob = el('div', 'knob', sc);
      this.fillCreative();
    }
    const inv = this.game.player.inventory;
    for (let c = 0; c < 9; c++) this.slot(p, 9 + c * 18, 112, { get: () => inv.slots[c], set: (v) => (inv.slots[c] = v), group: 'hotbar' });
    const trash = this.slot(p, 173, 112, { get: () => null, set: () => {}, trash: true });
    trash.innerHTML = '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#a00;font-size:calc(var(--s)*12px)">✕</span>';
    trash.title = '销毁物品';
  }
  creativeItems() {
    const all = [...ITEMS.values()].filter((d) => d.tab);
    if (this.creativeTab === 'search') {
      const q = this.creativeSearch.trim().toLowerCase();
      return all.filter((d) => !q || d.name.toLowerCase().includes(q) || d.key.includes(q)).map((d) => d.id);
    }
    return all.filter((d) => d.tab === this.creativeTab).map((d) => d.id);
  }
  fillCreative() {
    const items = this.creativeItems();
    const rows = Math.ceil(items.length / 9);
    const maxScroll = Math.max(0, rows - 5);
    this.creativeScroll = Math.max(0, Math.min(maxScroll, this.creativeScroll));
    this.screen.cgrid.forEach((b, i) => { b.item = items[this.creativeScroll * 9 + i] || 0; });
    if (this.screen.knob) {
      const sc = this.screen.knob.parentElement;
      sc.style.display = maxScroll ? '' : 'none';
      this.screen.knob.style.top = px(maxScroll ? (this.creativeScroll / maxScroll) * 73 : 0);
    }
    this.refresh();
  }
  scrollCreative(d) { if (!this.screen.cgrid) return; this.creativeScroll += d; this.fillCreative(); }

  refresh() {
    if (!this.screen) return;
    for (const b of this.screen.bindings) {
      if (b.disabled || b.trash) continue;
      const s = b.get();
      const k = s ? s.id + ':' + s.count + ':' + (s.dmg || 0) : '';
      if (b.last !== k) { b.last = k; b.el.innerHTML = this.stackHTML(s); if (b.group === 'armor') b.el.style.backgroundImage = s ? 'none' : `url(${this.slotShapes[b.idx]})`; }
    }
    this.cursorEl.innerHTML = this.cursor ? this.stackHTML(this.cursor) : '';
    if (this.screen.preview) { const ak = this.game.player.inventory.armor.map((s) => (s ? s.id : 0)).join(','); if (ak !== this.screen.armorKey) { this.screen.armorKey = ak; this.screen.preview.redraw(); } }
    if (this.screen.type === 'furnace') {
      const te = this.screen.data;
      const f = te.burnMax ? te.burn / te.burnMax : 0;
      this.screen.flame.style.clipPath = `inset(${Math.round((1 - f) * 100)}% 0 0 0)`;
      this.screen.flame.style.display = te.burn > 0 ? '' : 'none';
      this.screen.prog.style.width = Math.round((te.cook / 200) * 100) + '%';
    }
    if (this.hover) this.showTooltip(this.hover);
  }
  showTooltip(b) {
    const s = b.get && b.get();
    if (!s || this.cursor) { this.tooltip.classList.add('hidden'); return; }
    const d = ITEMS.get(s.id);
    let h = `<div>${itemName(s.id)}</div>`;
    if (d && d.tool) h += `<div class="sub">耐久度：${d.tool.durability - (s.dmg || 0)} / ${d.tool.durability}</div><div class="sub" style="color:#5555ff">+${d.tool.damage} 攻击伤害</div>`;
    if (d && d.armor) {
      h += `<div class="sub" style="color:#aaa">${['在头部时：', '在身体上时：', '在腿部时：', '在脚部时：'][d.armor.slot]}</div><div class="sub" style="color:#5555ff">+${d.armor.defense} 盔甲值</div>`;
      if (d.armor.toughness) h += `<div class="sub" style="color:#5555ff">+${d.armor.toughness} 盔甲韧性</div>`;
      h += `<div class="sub">耐久度：${d.durability - (s.dmg || 0)} / ${d.durability}</div>`;
    }
    if (d && d.bow) h += `<div class="sub">耐久度：${d.durability - (s.dmg || 0)} / ${d.durability}</div>`;
    if (d && d.food) h += `<div class="sub">饥饿值 +${d.food[0]}</div>`;
    this.tooltip.innerHTML = h;
    this.tooltip.classList.remove('hidden');
    this.placeTooltip();
  }
  placeTooltip() {
    const tip = this.tooltip;
    let x = (this.mx || 0) + 14, y = (this.my || 0) - 20;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > window.innerWidth - 4) x = (this.mx || 0) - w - 8;
    if (y + h > window.innerHeight - 4) y = window.innerHeight - h - 4;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  // ---------- 点击逻辑 ----------
  onSlotDown(b, e) {
    const g = this.game;
    if (b.disabled) return;
    g.audio.init();
    const shift = e.shiftKey;
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    // 创造模式物品格
    if (b.creative) {
      if (this.cursor) { this.cursor = null; }
      else if (b.item) {
        if (shift) { const inv = g.player.inventory; inv.add({ id: b.item, count: maxStack(b.item), dmg: 0 }); }
        else this.cursor = { id: b.item, count: button === 1 ? 1 : maxStack(b.item), dmg: 0 };
      }
      this.refresh(); return;
    }
    if (b.trash) {
      if (shift) g.player.inventory.clear();
      this.cursor = null; this.refresh(); return;
    }
    // 中键：创造模式复制
    if (button === 2) { if (g.player.mode === 'creative' && b.get() && !this.cursor) this.cursor = { ...b.get(), count: maxStack(b.get().id) }; this.refresh(); return; }
    // 双击收集
    const now = performance.now();
    if (button === 0 && !shift && this.cursor && this.lastClick.slot === b && now - this.lastClick.t < 300) {
      this.collectAll(); this.lastClick = { t: 0, slot: null }; this.refresh(); return;
    }
    this.lastClick = { t: now, slot: b };
    if (shift) { this.quickMove(b); this.refresh(); return; }
    if (this.cursor && !b.result && !b.output) {
      this.click(b, button);
      this.drag = { button, slots: [b] };
      this.refresh();
      return;
    }
    this.click(b, button);
    this.refresh();
  }
  onSlotEnter(b) {
    if (!this.drag || !this.cursor) return;
    if (b.result || b.output || b.creative || b.trash || b.disabled) return;
    if (this.drag.slots.includes(b)) return;
    const s = b.get();
    if (s && !sameItem(s, this.cursor)) return;
    if (b.accept && !b.accept(this.cursor)) return;
    this.drag.slots.push(b);
    b.el.style.outline = `${this.scale}px solid #fff`;
  }
  onMouseUp() {
    if (!this.drag) return;
    const d = this.drag; this.drag = null;
    for (const b of d.slots) b.el.style.outline = '';
    if (d.slots.length <= 1) { this.refresh(); return; }
    const c = this.cursor; if (!c) return;
    const per = d.button === 1 ? 1 : Math.floor(c.count / d.slots.length);
    if (per < 1) { this.refresh(); return; }
    const max = maxStack(c.id);
    for (const b of d.slots) {
      if (!this.cursor || this.cursor.count <= 0) break;
      const s = b.get();
      const have = s ? s.count : 0;
      const n = Math.min(per, max - have, this.cursor.count);
      if (n <= 0) continue;
      b.set({ id: c.id, count: have + n, dmg: c.dmg || 0 });
      this.cursor.count -= n;
    }
    if (this.cursor && this.cursor.count <= 0) this.cursor = null;
    this.refresh();
  }
  click(b, button) {
    const s = b.get();
    const c = this.cursor;
    if (b.result) {
      if (!s) return;
      if (!c) { this.cursor = b.take(); }
      else if (sameItem(c, s) && c.count + s.count <= maxStack(c.id)) { const t = b.take(); c.count += t.count; }
      this.game.audio.play('click');
      return;
    }
    if (b.output) {
      if (!s) return;
      if (!c) { this.cursor = s; b.set(null); }
      else if (sameItem(c, s)) { const n = Math.min(s.count, maxStack(c.id) - c.count); c.count += n; s.count -= n; if (s.count <= 0) b.set(null); }
      return;
    }
    if (button === 0) {
      if (!c) { if (s) { this.cursor = s; b.set(null); } }
      else if (!s) { if (!b.accept || b.accept(c)) { b.set(c); this.cursor = null; } }
      else if (sameItem(s, c)) { const n = Math.min(c.count, maxStack(s.id) - s.count); s.count += n; c.count -= n; if (c.count <= 0) this.cursor = null; b.set(s); }
      else if (!b.accept || b.accept(c)) { b.set(c); this.cursor = s; }
    } else {
      if (!c) { if (s) { const half = Math.ceil(s.count / 2); this.cursor = { ...s, count: half }; s.count -= half; b.set(s.count > 0 ? s : null); } }
      else if (!s) { if (!b.accept || b.accept(c)) { b.set({ ...c, count: 1 }); c.count--; if (c.count <= 0) this.cursor = null; } }
      else if (sameItem(s, c)) { if (s.count < maxStack(s.id)) { s.count++; c.count--; b.set(s); if (c.count <= 0) this.cursor = null; } }
      else if (!b.accept || b.accept(c)) { b.set(c); this.cursor = s; }
    }
  }
  moveInto(stack, targets) {
    const max = maxStack(stack.id);
    for (const t of targets) { const s = t.get(); if (s && sameItem(s, stack) && s.count < max) { const n = Math.min(stack.count, max - s.count); s.count += n; stack.count -= n; t.set(s); if (!stack.count) return 0; } }
    for (const t of targets) { if (!t.get() && (!t.accept || t.accept(stack))) { t.set({ ...stack, count: Math.min(stack.count, max) }); stack.count -= Math.min(stack.count, max); if (!stack.count) return 0; } }
    return stack.count;
  }
  quickMove(b) {
    const sc = this.screen, all = sc.bindings;
    const grp = (...gs) => all.filter((x) => gs.includes(x.group));
    const invTargets = [...grp('hotbar').reverse(), ...grp('main').reverse()];
    if (b.result) {
      // 一次合成尽可能多
      let guard = 64;
      while (b.get() && guard--) {
        const r = cloneStack(b.get());
        const tmp = { ...r };
        const targets = [...grp('main'), ...grp('hotbar')].reverse();
        // 检查能否放下
        const free = targets.reduce((a, t) => { const s = t.get(); return a + (!s ? maxStack(r.id) : sameItem(s, r) ? maxStack(r.id) - s.count : 0); }, 0);
        if (free < r.count) break;
        b.take();
        this.moveInto(tmp, targets);
      }
      this.game.audio.play('click');
      return;
    }
    const s = b.get(); if (!s) return;
    const stack = { ...s };
    let targets;
    const t = sc.type;
    const sd = ITEMS.get(s.id);
    const armorT = sd && sd.armor ? grp('armor').filter((a) => a.idx === sd.armor.slot && !a.get()) : [];
    if (b.group === 'armor') targets = [...grp('main'), ...grp('hotbar')];
    else if ((b.group === 'main' || b.group === 'hotbar') && armorT.length && (t === 'inventory' || t === 'creative')) targets = armorT;
    else if (b.group === 'grid' || b.group === 'chest' || b.output || b.group === 'furnaceIn' || b.group === 'furnaceFuel') targets = invTargets;
    else if (t === 'chest') targets = grp('chest');
    else if (t === 'furnace') {
      if (SMELTING.has(s.id)) targets = grp('furnaceIn');
      else if (FUEL.has(s.id)) targets = grp('furnaceFuel');
      else targets = b.group === 'hotbar' ? grp('main') : grp('hotbar');
    } else if (t === 'creative') { targets = b.group === 'hotbar' ? grp('main') : grp('hotbar'); if (!targets.length) { b.set(null); return; } }
    else targets = b.group === 'hotbar' ? grp('main') : grp('hotbar');
    const left = this.moveInto(stack, targets);
    b.set(left ? { ...s, count: left } : null);
  }
  collectAll() {
    const c = this.cursor; if (!c) return;
    const max = maxStack(c.id);
    for (const b of this.screen.bindings) {
      if (c.count >= max) break;
      if (b.result || b.creative || b.trash || b.disabled) continue;
      const s = b.get();
      if (s && sameItem(s, c)) { const n = Math.min(s.count, max - c.count); c.count += n; s.count -= n; b.set(s.count ? s : null); }
    }
  }
  clickOutside(e) {
    if (!this.cursor) return;
    if (e.button === 2) { this.game.dropStack({ ...this.cursor, count: 1 }); this.cursor.count--; if (this.cursor.count <= 0) this.cursor = null; }
    else { this.game.dropStack(this.cursor); this.cursor = null; }
    this.refresh();
  }
  // 界面中的键盘操作（数字键交换、Q 丢弃）
  screenKey(e) {
    if (!this.screen || !this.hover) return false;
    const b = this.hover;
    if (/^Digit[1-9]$/.test(e.code) && !b.result && !b.creative && !b.trash) {
      const i = +e.code.slice(5) - 1; const inv = this.game.player.inventory;
      const s = b.get(), h = inv.slots[i];
      if (b.output && h) return true;
      if (b.accept && h && !b.accept(h)) return true;
      b.set(h ? cloneStack(h) : null); inv.slots[i] = s ? cloneStack(s) : null;
      this.refresh(); return true;
    }
    if (e.code === 'KeyQ' && !b.creative && !b.trash) {
      const s = b.get(); if (!s) return true;
      if (b.result) { const r = b.take(); this.game.dropStack(r); }
      else if (e.ctrlKey) { this.game.dropStack(s); b.set(null); }
      else { this.game.dropStack({ ...s, count: 1 }); s.count--; b.set(s.count ? s : null); }
      this.refresh(); return true;
    }
    return false;
  }

  // ---------------- 菜单 ----------------
  menu(cls = 'dirt') {
    let m = $('#menu');
    if (!m) { m = el('div', '', document.body); m.id = 'menu'; }
    m.className = cls; m.innerHTML = '';
    m.classList.remove('hidden');
    if (cls === 'dirt' && this.dirtURL) { m.style.backgroundImage = `linear-gradient(rgba(0,0,0,.72),rgba(0,0,0,.72)), url(${this.dirtURL})`; } else m.style.backgroundImage = '';
    this.syncChrome();
    return m;
  }
  hideMenu() { const m = $('#menu'); if (m) { m.classList.add('hidden'); m.classList.remove('in-game'); m.innerHTML = ''; } const d = $('.death'); if (d) d.remove(); this.syncChrome(); }
  button(parent, text, onclick, cls = '') {
    const b = el('button', 'btn ' + cls, parent); b.textContent = text;
    b.addEventListener('click', (e) => { e.stopPropagation(); this.game.audio.init(); this.game.audio.play('click'); onclick(b); });
    return b;
  }
  slider(parent, label, min, max, step, value, fmt, onchange) {
    const s = el('div', 'slider', parent);
    const knob = el('div', 'knob', s), lab = el('div', 'lab', s);
    let v = value;
    const upd = () => { const f = (v - min) / (max - min); knob.style.left = `calc(${f * 100}% - ${f} * var(--s) * 8px)`; lab.textContent = `${label}：${fmt(v)}`; };
    const set = (e) => { const r = s.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); v = Math.round((min + f * (max - min)) / step) * step; upd(); onchange(v); };
    s.addEventListener('mousedown', (e) => { set(e); const mv = (ev) => set(ev); const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
    upd();
    return s;
  }
  showDialog({ title, message, value, placeholder, confirmText, danger, onConfirm }) {
    const host = document.getElementById('menu') || document.body;
    const back = el('div', 'dlg-back', host);
    const box = el('div', 'dlg', back);
    el('div', 'm-h txt', box, title);
    if (message) el('div', 'txt dlg-msg', box, message);
    let input = null;
    if (value !== undefined) {
      input = el('input', '', box); input.value = value;
      if (placeholder) input.placeholder = placeholder;
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') back.remove(); });
    }
    const row = el('div', 'm-row', box);
    const ok = () => { const v = input ? input.value : true; back.remove(); if (onConfirm) onConfirm(v); };
    this.button(row, confirmText || '确定', ok, 'half' + (danger ? ' danger' : ''));
    this.button(row, '取消', () => back.remove(), 'half');
    if (input) setTimeout(() => input.focus(), 0);
  }
  titleBlock(m) {
    const t = el('div', 'm-title', m, '我的世界');
    if (this.stoneURL) t.style.backgroundImage = `url(${this.stoneURL})`;
    const splashes = ['网页版！', '纯程序生成！', '也试试方块！', '100% 原创像素！', '无限世界！', '用 Three.js 制作！', '挖矿与合成！', '小心苦力怕…其实没有！'];
    const splashText = splashes[Math.floor(Math.random() * splashes.length)];
    const sp = el('div', 'splash', t, splashText);
    if (splashText.length > 8) sp.style.fontSize = px(8);
    el('div', 'm-sub txt', m, 'MINI MINECRAFT · 网页复刻版');
  }
  showTitle() {
    const m = this.menu('dirt');
    this.titleBlock(m);
    const col = el('div', 'm-col', m); col.style.marginTop = px(40);
    this.button(col, '单人游戏', () => this.showWorlds());
    const mp = this.button(col, '多人游戏', () => {}); mp.disabled = true; mp.title = '网页版暂不支持';
    this.button(col, '操作说明', () => this.showControls(() => this.showTitle()));
    const row = el('div', 'm-row', col); row.style.marginTop = px(8);
    this.button(row, '选项...', () => this.showOptions(() => this.showTitle()), 'half');
    this.button(row, '全屏', () => this.game.toggleFullscreen(), 'half');
    el('div', 'm-foot l txt', m, 'Mini Minecraft 网页复刻版 1.0');
    el('div', 'm-foot r txt', m, '非官方作品 · 与 Mojang 无关');
  }
  async showWorlds() {
    const m = this.menu('dirt');
    el('div', 'm-h txt', m, '选择世界');
    const list = el('div', 'worldlist', m);
    const worlds = await this.game.listWorlds();
    let sel = worlds[0] ? worlds[0].id : null;
    const render = () => {
      list.innerHTML = '';
      if (!worlds.length) el('div', 'world empty', list, '还没有世界，点击“创建新的世界”开始吧！');
      for (const w of worlds) {
        const d = el('div', 'world' + (w.id === sel ? ' sel' : ''), list);
        const date = new Date(w.lastPlayed || w.created).toLocaleString('zh-CN');
        d.innerHTML = `<div>${escapeHTML(w.name)}</div><div class="g">${w.id.slice(0, 8)} (${date})</div><div class="g">${w.mode === 'creative' ? '创造模式' : '生存模式'}，种子：${escapeHTML(String(w.seedText ?? w.seed))}</div>`;
        d.addEventListener('click', () => { sel = w.id; render(); syncBtns(); });
        d.addEventListener('dblclick', () => this.game.loadWorld(w.id));
      }
    };
    const c = el('div', 'm-col', m); c.style.marginTop = px(8);
    const r1 = el('div', 'm-row', c), r2 = el('div', 'm-row', c);
    const enterBtn = this.button(r1, '进入选中的世界', () => sel && this.game.loadWorld(sel), 'half');
    this.button(r1, '创建新的世界', () => this.showCreate(), 'half');
    const delBtn = this.button(r2, '删除', () => {
      if (!sel) return;
      const w = worlds.find((x) => x.id === sel);
      this.showDialog({
        title: '删除世界',
        message: `确定要删除“${w ? w.name : ''}”吗？此操作无法撤销！`,
        confirmText: '删除',
        danger: true,
        onConfirm: async () => { await this.game.deleteWorld(sel); this.showWorlds(); },
      });
    }, 'third');
    const renBtn = this.button(r2, '重命名', () => {
      const w = worlds.find((x) => x.id === sel); if (!w) return;
      this.showDialog({
        title: '重命名世界',
        value: w.name,
        confirmText: '确定',
        onConfirm: async (n) => { const name = String(n || '').trim(); if (!name) return; w.name = name; await this.game.renameWorld(w); this.showWorlds(); },
      });
    }, 'third');
    this.button(r2, '取消', () => this.showTitle(), 'third');
    const syncBtns = () => { enterBtn.disabled = delBtn.disabled = renBtn.disabled = !sel; };
    render();
    syncBtns();
  }
  showCreate() {
    const m = this.menu('dirt');
    el('div', 'm-h txt', m, '创建新的世界');
    const c = el('div', 'm-col', m);
    const f1 = el('label', 'field', c, '世界名称'); const name = el('input', '', f1); name.value = '新的世界';
    let mode = 'survival';
    const mb = this.button(c, '', () => { mode = mode === 'survival' ? 'creative' : 'survival'; upd(); });
    const desc = el('div', 'txt field-desc', c); desc.style.fontSize = px(7); desc.style.color = '#a0a0a0';
    const upd = () => { mb.textContent = '游戏模式：' + (mode === 'survival' ? '生存' : '创造'); desc.textContent = mode === 'survival' ? '探索神秘的世界，收集资源、合成工具，注意生命值与饥饿值。' : '无限资源、自由飞行、瞬间破坏方块。'; };
    upd();
    const f2 = el('label', 'field', c, '世界生成器的种子（留空则随机）'); const seed = el('input', '', f2); seed.placeholder = '例如：12345 或任意文字';
    const r = el('div', 'm-row', c); r.style.marginTop = px(10);
    this.button(r, '创建新的世界', () => this.game.createWorld(name.value.trim() || '新的世界', seed.value.trim(), mode), 'half');
    this.button(r, '取消', () => this.showWorlds(), 'half');
    for (const i of [name, seed]) i.addEventListener('keydown', (e) => e.stopPropagation());
  }
  showOptions(back) {
    const g = this.game, s = g.settings;
    const m = this.menu(g.inWorld ? 'dim' : 'dirt');
    el('div', 'm-h txt', m, '选项');
    const grid = el('div', 'opt-grid', m);
    const sv = () => g.applySettings();
    this.slider(grid, '视野', 30, 110, 1, s.fov, (v) => (v === 70 ? '普通' : v === 110 ? '极高' : v), (v) => { s.fov = v; sv(); });
    this.slider(grid, '渲染距离', 2, 16, 1, s.renderDistance, (v) => v + ' 区块', (v) => { s.renderDistance = v; sv(); });
    this.slider(grid, '鼠标灵敏度', 10, 200, 1, s.sensitivity, (v) => (v === 100 ? '100%（默认）' : v + '%'), (v) => { s.sensitivity = v; sv(); });
    this.slider(grid, '亮度', 0, 100, 1, s.gamma, (v) => (v === 0 ? '昏暗' : v === 100 ? '明亮' : v + '%'), (v) => { s.gamma = v; sv(); });
    this.slider(grid, '主音量', 0, 100, 1, s.volume, (v) => v + '%', (v) => { s.volume = v; sv(); });
    this.slider(grid, '音乐', 0, 100, 1, s.music, (v) => (v ? v + '%' : '关'), (v) => { s.music = v; sv(); });
    const tb = (label, k) => this.button(grid, `${label}：${s[k] ? '开' : '关'}`, (b) => { s[k] = !s[k]; b.textContent = `${label}：${s[k] ? '开' : '关'}`; sv(); });
    tb('视角摇晃', 'viewBobbing');
    tb('云', 'clouds');
    tb('反转鼠标', 'invertY');
    this.button(grid, `界面尺寸：${s.guiScale || '自动'}`, (b) => { s.guiScale = (s.guiScale + 1) % 5; b.textContent = `界面尺寸：${s.guiScale || '自动'}`; sv(); this.updateScale(); });
    if (g.inWorld) {
      this.button(grid, `游戏模式：${g.player.mode === 'creative' ? '创造' : '生存'}`, (b) => { g.setMode(g.player.mode === 'creative' ? 'survival' : 'creative'); b.textContent = `游戏模式：${g.player.mode === 'creative' ? '创造' : '生存'}`; });
      this.button(grid, '操作说明', () => this.showControls(() => this.showOptions(back)));
    }
    const c = el('div', 'm-col', m); c.style.marginTop = px(12);
    this.button(c, '完成', () => { sv(); back(); });
  }
  showControls(back) {
    const g = this.game;
    const m = this.menu(g.inWorld ? 'dim' : 'dirt');
    el('div', 'm-h txt', m, '操作说明');
    const k = el('div', 'keys txt', m);
    const rows = [['W A S D', '移动'], ['鼠标', '转动视角'], ['空格', '跳跃 / 游泳上浮 / 飞行上升'], ['双击空格', '切换飞行（创造模式）'], ['左 Shift', '潜行（不会从边缘掉落）/ 飞行下降'],
      ['左 Ctrl 或 双击 W', '疾跑'], ['鼠标左键（按住）', '挖掘方块 / 攻击'], ['鼠标右键', '放置方块 / 使用物品 / 打开容器 / 进食 / 开关门 / 睡觉 / 穿戴盔甲'], ['按住右键（弓）', '拉弓，松开射箭（需要箭，创造模式除外）'], ['鼠标中键', '选取方块'],
      ['1 – 9 / 滚轮', '选择快捷栏'], ['E', '打开物品栏'], ['Q / Ctrl+Q', '丢弃物品 / 丢弃整组'], ['T 或 /', '聊天与命令'], ['F1', '隐藏界面'], ['F3', '调试信息'], ['F5', '切换视角'], ['Esc', '暂停菜单'],
      ['物品栏中', '左键拿起/放下，右键拿一半/放一个，Shift+点击快速移动，拖动均分，双击收集'],
      ['命令', '/gamemode creative|survival, /time set day|night|数值, /weather clear|rain|thunder, /tp x y z, /give 物品 数量, /summon 生物（pig cow sheep chicken zombie skeleton creeper villager lightning_bolt）, /locate village, /seed, /kill, /spawn, /help']];
    for (const [a, b] of rows) { el('b', '', k, a); el('span', '', k, b); }
    const c = el('div', 'm-col', m); c.style.marginTop = px(10);
    this.button(c, '完成', back);
  }
  showPause() {
    const m = this.menu('dim');
    el('div', 'm-h txt', m, '游戏菜单').style.marginTop = '18vh';
    const c = el('div', 'm-col', m);
    this.button(c, '回到游戏', () => this.game.resume());
    const r = el('div', 'm-row', c);
    this.button(r, '操作说明', () => this.showControls(() => this.showPause()), 'half');
    this.button(r, '全屏', () => this.game.toggleFullscreen(), 'half');
    this.button(c, '选项...', () => this.showOptions(() => this.showPause()));
    this.button(c, '保存并退回到标题画面', () => this.game.saveAndQuit());
  }
  showDeath(msg) {
    this.hideMenu();
    const d = el('div', 'death', document.body);
    el('h1', '', d, '你死了！');
    el('div', 'txt', d, msg || '').style.fontSize = px(8);
    const c = el('div', 'm-col', d); c.style.marginTop = px(20);
    this.button(c, '重生', () => { d.remove(); this.syncChrome(); this.game.respawn(); });
    this.button(c, '回到标题画面', () => { d.remove(); this.game.saveAndQuit(); });
    this.syncChrome();
  }
  // 睡觉：屏幕渐暗 + “离开床”按钮
  showSleep(on) {
    const f = $('#sleepFade');
    let b = $('#leaveBed');
    if (!on) { f.classList.add('hidden'); f.style.opacity = 0; if (b) b.remove(); return; }
    f.classList.remove('hidden'); f.style.opacity = 0;
    if (!b) { b = el('div', 'm-col', document.body); b.id = 'leaveBed'; this.button(b, '离开床', () => this.game.wakeUp()); }
  }
  setSleepFade(f) { const e = $('#sleepFade'); if (e) e.style.opacity = (f * 0.85).toFixed(3); }
  showLoading(text, prog) {
    let m = $('#menu');
    if (!m || !m.classList.contains('loading') || !m.querySelector('.lt')) { m = this.menu('dirt'); m.classList.add('loading'); el('div', 'txt lt', m); const b = el('div', 'bar', m); el('div', '', b); }
    m.querySelector('.lt').textContent = text;
    m.querySelector('.bar > div').style.width = Math.round((prog || 0) * 100) + '%';
  }
}
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
void TILES; void FACE_TILES; void B;
