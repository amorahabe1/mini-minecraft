// 游戏主控：渲染循环（20 TPS + 插值）、输入、交互（挖掘/放置/使用）、实体、存档、命令
import * as THREE from 'three';
import { BLOCKS, B, I, ITEMS, TILES, FACE_TILES, SOLID, OPAQUE, HEIGHT, SEA, isLiquid, isWater, isLava, liquidId, canHarvest, digSpeed, idOf, itemName, maxStack, FACING_DIRS } from './registry.js';
import { hashSeed } from './noise.js';
import { BIOME, BIOME_NAMES } from './worldgen.js';
import { World } from './world.js';
import { createTextureArray, createChunkMaterials, Sky, BlockHighlight, ItemModels, brightness } from './render.js';
import { buildTextures, tileCanvases, buildIcons } from './textures.js';
import { entityBox, boxCollides } from './physics.js';
import { Mob, ItemEntity, FallingBlock, Particles } from './entities.js';
import { Audio } from './audio.js';
import * as Store from './storage.js';
import { CraftGrid, newFurnace, newChest, furnaceTick, cloneStack } from './inventory.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Hand, createPlayerModel, animatePlayerModel, previewCanvas } from './hand.js';

const TICK = 50;
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DEATH_MSG = { fall: '从高处摔了下来', lava: '试图在岩浆里游泳', drown: '淹死了', mob: '被僵尸杀死了', starve: '饿死了', suffocate: '在墙里窒息而亡', void: '掉出了这个世界', fire: '被烧死了', kill: '死了' };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'w' + Date.now().toString(16) + Math.random().toString(16).slice(2));

// 方块的选取包围盒（局部坐标）
function blockBox(id, includeLiquid) {
  const b = BLOCKS[id];
  if (!b) return null;
  if (b.liquid) return includeLiquid ? [0, 0, 0, 1, 0.9, 1] : null;
  switch (b.shape) {
    case 'none': return null;
    case 'cross': return [0.1, 0, 0.1, 0.9, 0.8, 0.9];
    case 'torch': return [0.4, 0, 0.4, 0.6, 0.6, 0.6];
    case 'wall_torch': { const d = [[0, 1], [-1, 0], [0, -1], [1, 0]][b.facing]; const cx = 0.5 + d[0] * 0.34, cz = 0.5 + d[1] * 0.34; return [cx - 0.15, 0.2, cz - 0.15, cx + 0.15, 0.8, cz + 0.15]; }
    case 'cactus': return [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16];
    default: return [0, 0, 0, 1, 1, 1];
  }
}
function rayBox(o, d, bx) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < bx[i] || o[i] > bx[i + 3]) return null; continue; }
    let t1 = (bx[i] - o[i]) / d[i], t2 = (bx[i + 3] - o[i]) / d[i];
    let s = -1; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const n = [0, 0, 0]; if (axis >= 0) n[axis] = sign;
  return { t: Math.max(0, tmin), n };
}

class Game {
  constructor() {
    window.__game = this;
    this.settings = Store.loadSettings();
    this.CraftGrid = CraftGrid;
    this.audio = new Audio();
    this.inWorld = false; this.paused = true; this.loading = false;
    this.keys = new Set();
    this.daylight = 1; this.darken = 0; this.time = 0;
    this.entities = [];
    this.tiles = new Map();
    this.perspective = 0; this.hudHidden = false; this.showDebug = false;
    this.mouse = { left: false, right: false };
    this.fps = 0; this.frames = 0; this.fpsT = 0;
    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement; this.canvas.id = 'game';
    document.body.prepend(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    // 纹理
    this.tilesData = buildTextures();
    this.tileCv = tileCanvases(this.tilesData);
    this.texArray = createTextureArray(this.tilesData);
    this.materials = createChunkMaterials(this.texArray);
    this.icons = buildIcons(this.tileCv);
    this.itemModels = new ItemModels(this.tilesData, this.tileCv);
    this.skyScene = new THREE.Scene();
    this.sky = new Sky(this.skyScene, this.scene);
    this.highlight = new BlockHighlight(this.scene, this.texArray);
    this.particles = new Particles(this.scene, this.itemModels);
    this.hand = new Hand(this.itemModels);
    this.playerModel = createPlayerModel(); this.playerModel.visible = false; this.scene.add(this.playerModel);
    this.player = new Player(this);
    this.ui = new UI(this);
    this.ui.setIcons(this.icons, this.tileCv);
    this.ui.dirtURL = this.tileCv[TILES.indexOf('dirt')].toDataURL();
    this.ui.stoneURL = this.tileCv[TILES.indexOf('stone')].toDataURL();
    this.ui.setHudVisible(false);
    this.bindInput();
    this.applySettings();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', (e) => { if (this.inWorld) { this.saveWorld(); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.inWorld) this.saveWorld(); });
    this.last = performance.now(); this.acc = 0;
    this.ui.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- 设置 ----------------
  applySettings() {
    const s = this.settings;
    Store.saveSettings(s);
    if (this.world) this.world.renderDistance = s.renderDistance;
    this.audio.setVolume(s.volume / 100);
    this.audio.musicVolume = s.music / 100;
    this.materials.setAll('uGamma', s.gamma / 100);
    this.ui.updateScale();
  }
  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
  }
  toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    document.documentElement.requestFullscreen().then(() => {
      // 全屏时锁定键盘，防止 Ctrl+W 等快捷键关闭页面
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyT', 'KeyN', 'KeyR', 'Space', 'Tab', 'F1', 'F3', 'F5']).catch(() => {});
    }).catch(() => {});
  }

  // ---------------- 世界管理 ----------------
  listWorlds() { return Store.listWorlds(); }
  async deleteWorld(id) { await Store.deleteWorld(id); }
  async renameWorld(w) { const m = await Store.loadWorldMeta(w.id); if (m) { m.name = w.name; await Store.saveWorldMeta(m); } }
  async createWorld(name, seedText, mode) {
    let seed;
    if (!seedText) seed = (Math.random() * 2 ** 31) | 0;
    else if (/^-?\d+$/.test(seedText)) seed = Number(seedText) | 0;
    else seed = hashSeed(seedText);
    const meta = { id: uid(), name, seed, seedText: seedText || String(seed), mode, created: Date.now(), lastPlayed: Date.now(), time: 0, player: null, tiles: [] };
    await Store.saveWorldMeta(meta);
    this.startWorld(meta, true);
  }
  async loadWorld(id) {
    const meta = await Store.loadWorldMeta(id);
    if (meta) this.startWorld(meta, false);
  }
  findSpawn(gen) {
    for (let r = 0; r < 64; r++) {
      for (let i = 0; i < Math.max(1, r * 8); i++) {
        const a = (i / Math.max(1, r * 8)) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r * 16), z = Math.round(Math.sin(a) * r * 16);
        const c = gen.column(x, z);
        if (c.h > SEA + 1 && c.biome !== BIOME.OCEAN && c.biome !== BIOME.DEEP_OCEAN && c.biome !== BIOME.MOUNTAINS) return { x: x + 0.5, z: z + 0.5 };
      }
    }
    return { x: 0.5, z: 0.5 };
  }
  async startWorld(meta, fresh) {
    this.ui.showLoading('正在生成世界…', 0);
    if (this.world) this.disposeWorld();
    this.meta = meta;
    this.world = new World(this, meta.seed, this.materials);
    this.world.renderDistance = this.settings.renderDistance;
    this.world.store = new Store.WorldStore(meta.id);
    try { this.world.savedKeys = new Set(await this.world.store.savedChunkKeys()); } catch (e) { this.world.savedKeys = new Set(); }
    this.scene.add(this.world.group);
    this.time = meta.time || 0;
    this.tiles = new Map((meta.tiles || []).map((t) => [t.k, t.v]));
    const p = this.player = new Player(this);
    p.mode = meta.mode || 'survival';
    if (meta.player) p.load(meta.player);
    else {
      const s = this.findSpawn(this.world.gen);
      p.spawn = { x: s.x, y: 100, z: s.z, fresh: true };
      p.pos.set(s.x, 100, s.z); p.prevPos.copy(p.pos);
      p.mode = meta.mode;
      if (p.mode === 'survival') { /* 生存模式：空手开局，与 MC 一致 */ }
    }
    this.entities = [];
    this.hand.setItem(0);
    this.loading = true; this.paused = true; this.inWorld = true;
    this.loadStart = performance.now();
    this.needPlace = !meta.player;
    this.autosave = 0;
    this.spawnTimer = 0;
  }
  finishLoading() {
    const p = this.player;
    if (this.needPlace) {
      const s = this.safeSpot(Math.floor(p.spawn.x), Math.floor(p.spawn.z));
      p.spawn = { x: s.x + 0.5, y: s.y, z: s.z + 0.5 };
      p.pos.set(p.spawn.x, p.spawn.y, p.spawn.z); p.prevPos.copy(p.pos);
      this.spawnInitialMobs();
    }
    this.loading = false;
    this.ui.hideMenu();
    this.ui.setHudVisible(!this.hudHidden);
    this.ui.addMessage(this.needPlace ? '欢迎来到新世界！按 E 打开物品栏，T 打开聊天，Esc 暂停。' : '世界已载入。');
    this.paused = false;
    this.showClickHint();
  }
  // 在 (x,z) 附近找一个脚下实心、头顶两格空气的位置
  safeSpot(x0, z0) {
    const w = this.world;
    const ok = (x, z) => {
      if (!w.isLoaded(x, z)) return -1;
      const y = w.topSolidY(x, z) + 1;
      if (y <= 0) return -1;
      const g = w.getBlock(x, y - 1, z), a = w.getBlock(x, y, z), b = w.getBlock(x, y + 1, z);
      if (isLiquid(g) || (a > 0 && (SOLID[a] || isLiquid(a))) || (b > 0 && (SOLID[b] || isLiquid(b)))) return -1;
      return y;
    };
    for (let r = 0; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const y = ok(x0 + dx, z0 + dz);
      if (y > 0) return { x: x0 + dx, y, z: z0 + dz };
    }
    return { x: x0, y: w.topY(x0, z0) + 1, z: z0 };
  }
  disposeWorld() {
    if (this.ui.isOpen()) this.ui.close(true);
    for (const e of this.entities) if (e.object) this.scene.remove(e.object);
    this.entities = [];
    this.scene.remove(this.world.group);
    this.world.dispose();
    this.world = null;
    this.highlight.hide();
  }
  async saveWorld() {
    if (!this.world || !this.meta || this.loading) return;
    const m = this.meta;
    m.time = this.time; m.lastPlayed = Date.now(); m.mode = this.player.mode;
    m.player = this.player.toJSON();
    m.tiles = [...this.tiles].map(([k, v]) => ({ k, v }));
    const jobs = [Store.saveWorldMeta(m)];
    for (const c of this.world.modifiedChunks()) {
      const k = c.cx + ',' + c.cz;
      this.world.savedKeys.add(k);
      jobs.push(this.world.store.saveChunk(k, c));
    }
    try { await Promise.all(jobs); } catch (e) { console.error('保存失败', e); }
  }
  async saveAndQuit() {
    this.ui.showLoading('正在保存世界…', 0.5);
    await this.saveWorld();
    this.disposeWorld();
    this.inWorld = false; this.paused = true; this.loading = false;
    this.ui.setHudVisible(false);
    this.hideClickHint();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showTitle();
  }

  // ---------------- 指针锁定 / 暂停 ----------------
  lock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { const r2 = this.canvas.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => this.showClickHint()); });
    } catch (e) { this.showClickHint(); }
  }
  unlock() { this.expectUnlock = true; if (document.pointerLockElement) document.exitPointerLock(); }
  showClickHint() {
    if (!this.inWorld || this.loading) return;
    let h = document.getElementById('clickHint');
    if (!h) { h = document.createElement('div'); h.id = 'clickHint'; h.className = 'txt'; h.textContent = '点击屏幕继续游戏'; document.body.appendChild(h); }
    h.classList.remove('hidden');
  }
  hideClickHint() { const h = document.getElementById('clickHint'); if (h) h.classList.add('hidden'); }
  resume() {
    this.ui.hideMenu();
    if (this.ui.isOpen()) this.ui.close(true);
    this.paused = false;
    this.lock();
    this.hideClickHint();
  }
  pause() {
    if (!this.inWorld || this.loading || this.player.dead) return;
    this.paused = true;
    this.keys.clear(); this.mouse.left = this.mouse.right = false;
    this.ui.showPause();
    this.hideClickHint();
    this.saveWorld();
  }
  onScreenClosed() {
    this.hideClickHint();
    setTimeout(() => {
      if (this.inWorld && !this.paused && !this.ui.isOpen() && !this.ui.chatOpen && !this.player.dead) this.lock();
    }, 40);
  }
  get locked() { return document.pointerLockElement === this.canvas; }

  // ---------------- 输入 ----------------
  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) { this.hideClickHint(); return; }
      this.keys.clear(); this.mouse.left = this.mouse.right = false;
      if (this.ui.chatOpen) {
        const inp = document.getElementById('chatInput');
        if (inp) setTimeout(() => inp.focus(), 0);
      }
      if (this.expectUnlock) { this.expectUnlock = false; return; }
      // 用户按 Esc 解除锁定
      if (this.inWorld && !this.loading && !this.paused && !this.ui.isOpen() && !this.ui.chatOpen && !this.player.dead) this.pause();
    });
    document.addEventListener('pointerlockerror', () => this.showClickHint());
    this.canvas.addEventListener('mousedown', (e) => {
      this.audio.init();
      if (!this.inWorld || this.loading) return;
      if (!this.locked) { if (!this.paused && !this.ui.isOpen()) this.lock(); return; }
      e.preventDefault();
      if (e.button === 0) { this.mouse.left = true; this.pressLeft = true; }
      else if (e.button === 2) { this.mouse.right = true; this.pressRight = true; }
      else if (e.button === 1) this.pickBlock();
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; else if (e.button === 2) this.mouse.right = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.paused) return;
      const s = this.settings.sensitivity / 200;
      const f = s * 0.6 + 0.2, k = f * f * f * 8 * 0.15 * Math.PI / 180;
      let dx = e.movementX, dy = e.movementY;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return; // 浏览器偶发的异常跳变
      const p = this.player;
      p.yaw -= dx * k;
      p.pitch -= dy * k * (this.settings.invertY ? -1 : 1);
      p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p.pitch));
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked || this.paused || this.ui.isOpen()) return;
      const inv = this.player.inventory;
      inv.selected = (inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
    }, { passive: true });
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') this.sprintTap = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
  }
  onKeyDown(e) {
    if (!this.inWorld || this.loading) return;
    const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (isInput && e.code !== 'Escape') return;
    const code = e.code;
    const inGame = this.locked && !this.paused;
    if (['F1', 'F3', 'F5', 'Tab', 'Space'].includes(code) || (inGame && (e.ctrlKey || e.altKey))) e.preventDefault();
    if (this.ui.isOpen()) {
      if (!isInput && this.ui.screenKey(e)) { e.preventDefault(); return; }
      if (code === 'KeyE' || code === 'Escape') { e.preventDefault(); this.ui.close(); }
      return;
    }
    if (this.ui.chatOpen) {
      if (code === 'Escape') { e.preventDefault(); this.ui.closeChat(); this.resume(); }
      return;
    }
    if (this.player.dead || this.paused) return;
    if (!this.locked) {
      if (code === 'Escape') this.pause();
      else if (code === 'KeyE') this.ui.open('inventory');
      else if (code === 'KeyT' || code === 'Slash' || code === 'Enter') { e.preventDefault(); this.ui.openChat(code === 'Slash' ? '/' : ''); }
      return;
    }
    const now = performance.now();
    if (!e.repeat) {
      if (code === 'KeyW') { if (now - (this.lastW || 0) < 350) this.sprintTap = true; this.lastW = now; }
      if (code === 'Space' && this.player.mayFly) {
        if (now - (this.lastSpace || 0) < 350) { this.player.flying = !this.player.flying; this.lastSpace = 0; } else this.lastSpace = now;
      }
    }
    this.keys.add(code);
    if (e.repeat && code !== 'KeyQ') return;
    if (/^Digit[1-9]$/.test(code)) this.player.inventory.selected = +code.slice(5) - 1;
    else if (code === 'KeyE') { this.unlock(); this.ui.open('inventory'); }
    else if (code === 'KeyQ') this.dropHeld(e.ctrlKey);
    else if (code === 'KeyT' || code === 'Slash' || code === 'Enter') { e.preventDefault(); this.unlock(); this.ui.openChat(code === 'Slash' ? '/' : ''); }
    else if (code === 'F1') { this.hudHidden = !this.hudHidden; this.ui.setHudVisible(!this.hudHidden); }
    else if (code === 'F3') { this.showDebug = !this.showDebug; this.ui.syncChrome(); }
    else if (code === 'F5') this.perspective = (this.perspective + 1) % 3;
  }
  input() {
    const k = this.keys;
    return {
      forward: k.has('KeyW'), back: k.has('KeyS'), left: k.has('KeyA'), right: k.has('KeyD'),
      jump: k.has('Space'), sneak: k.has('ShiftLeft') || k.has('ShiftRight'),
      sprint: k.has('ControlLeft') || k.has('ControlRight'), sprintTap: this.sprintTap,
    };
  }

  // ---------------- 射线检测 ----------------
  eyePos() { const p = this.player; return new THREE.Vector3(p.pos.x, p.pos.y + p.eyeHeight(), p.pos.z); }
  lookDir() {
    const p = this.player;
    return new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
  }
  raycast(maxDist, includeLiquid = false) {
    const o = this.eyePos(), d = this.lookDir();
    const w = this.world;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    for (let i = 0; i < 200; i++) {
      const id = w.getBlock(x, y, z);
      if (id > 0) {
        const bb = blockBox(id, includeLiquid);
        if (bb) {
          const hit = rayBox(oa, da, [x + bb[0], y + bb[1], z + bb[2], x + bb[3], y + bb[4], z + bb[5]]);
          if (hit && hit.t <= maxDist) return { x, y, z, id, n: hit.n, t: hit.t };
        }
      }
      const t = Math.min(tmx, tmy, tmz);
      if (t > maxDist) break;
      if (tmx === t) { x += sx; tmx += tdx; } else if (tmy === t) { y += sy; tmy += tdy; } else { z += sz; tmz += tdz; }
    }
    return null;
  }
  raycastEntity(maxDist) {
    const o = this.eyePos(), d = this.lookDir();
    let best = null, bt = maxDist;
    for (const e of this.entities) {
      if (!(e instanceof Mob) || e.dead) continue;
      const b = entityBox(e);
      const h = rayBox([o.x, o.y, o.z], [d.x, d.y, d.z], [b[0] - 0.1, b[1] - 0.1, b[2] - 0.1, b[3] + 0.1, b[4] + 0.1, b[5] + 0.1]);
      if (h && h.t < bt) { bt = h.t; best = e; }
    }
    return best ? { e: best, t: bt } : null;
  }
  reach() { return this.player.mode === 'creative' ? 5 : 4.5; }

  // ---------------- 交互 ----------------
  heldTool() { const h = this.player.inventory.held(); const d = h && ITEMS.get(h.id); return d && d.tool ? d.tool : null; }
  swing() { const p = this.player; if (!p.swinging || p.swingTicks >= 3 || p.swingTicks < 0) { p.swingTicks = -1; p.swinging = true; } }
  interactTick() {
    const p = this.player;
    if (p.dead) return;
    const reach = this.reach();
    const blockHit = this.raycast(reach);
    const entHit = this.raycastEntity(p.mode === 'creative' ? 5 : 3);
    const target = entHit && (!blockHit || entHit.t < blockHit.t) ? { entity: entHit.e } : blockHit;
    this.target = target;
    if (this.destroyDelay > 0) this.destroyDelay--;
    if (this.useDelay > 0) this.useDelay--;
    // 左键
    if (this.pressLeft) {
      this.pressLeft = false;
      if (target && target.entity) { this.attack(target.entity); }
      else if (!target) this.swing();
      else if (p.mode === 'creative') { this.creativeBreak(target); this.destroyDelay = 5; }
    }
    if (this.mouse.left && target && !target.entity && !p.usingItem) {
      if (p.mode === 'creative') {
        if (this.destroyDelay <= 0) { this.creativeBreak(target); this.destroyDelay = 5; }
      } else this.continueBreak(target);
    } else this.resetBreak();
    // 右键
    if (this.pressRight) { this.pressRight = false; this.useItem(target); this.useDelay = 4; }
    else if (this.mouse.right && !p.usingItem && this.useDelay <= 0) { this.useItem(target); this.useDelay = 4; }
    // 进食
    if (p.usingItem) {
      const h = p.inventory.held();
      if (!this.mouse.right || !h || h.id !== p.usingId) { p.usingItem = false; }
      else {
        p.useTicks++;
        if (p.useTicks > 7 && p.useTicks % 4 === 0) this.audio.play('eat');
        if (p.useTicks >= 32) {
          p.eat(h.id); this.audio.play('burp');
          if (p.mode === 'survival') p.inventory.consumeHeld(1);
          p.usingItem = false; this.useDelay = 4;
        }
      }
    }
  }
  resetBreak() {
    if (this.breaking) { this.breaking = null; this.highlight.setCrack(0, 0, 0, -1); }
  }
  continueBreak(t) {
    const p = this.player;
    if (this.destroyDelay > 0) return;
    const b = BLOCKS[t.id];
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.id !== t.id) {
      this.breaking = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0, ticks: 0 };
    }
    const br = this.breaking;
    let sp = digSpeed(b, this.heldTool());
    if (p.eyeInWater) sp /= 5;
    if (!p.onGround && !p.flying) sp /= 5;
    br.progress += sp; br.ticks++;
    this.swing();
    if (br.ticks % 4 === 1) { this.audio.dig(b.sound); this.particles.hit(t.x, t.y, t.z, t.n, FACE_TILES[t.id * 6 + 2]); }
    if (br.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z, t.id, true);
      this.breaking = null; this.highlight.setCrack(0, 0, 0, -1);
      this.destroyDelay = 5;
    } else this.highlight.setCrack(t.x, t.y, t.z, Math.floor(br.progress * 10));
  }
  creativeBreak(t) {
    const tool = this.heldTool();
    this.swing();
    if (tool && tool.type === 'sword') return; // 创造模式下手持剑无法破坏方块
    this.breakBlock(t.x, t.y, t.z, t.id, false);
  }
  breakBlock(x, y, z, id, survival) {
    const b = BLOCKS[id];
    if (b.hardness < 0 && survival) return;
    if (id === B.bedrock && survival) return;
    this.world.setBlock(x, y, z, 0);
    this.audio.breakBlock(b.sound);
    this.particles.blockBreak(x, y, z, FACE_TILES[id * 6 + 0], 1);
    if (survival) {
      const tool = this.heldTool();
      if (canHarvest(b, tool)) this.dropBlockItems(x, y, z, id, tool);
      else this.dropTileContents(x, y, z);
      if (tool && b.hardness > 0) this.damageHeld(1);
      this.player.addExhaustion(0.005);
    } else this.dropTileContents(x, y, z, true);
    // 冰块被破坏后变成水
    if (id === B.ice && survival) { const below = this.world.getBlock(x, y - 1, z); if (below > 0 && (SOLID[below] || isLiquid(below))) this.world.setBlock(x, y, z, B.water ?? 120); }
  }
  damageHeld(n) {
    const p = this.player;
    if (p.mode !== 'survival') return;
    if (p.inventory.damageHeld(n)) { this.audio.play('fallsmall'); this.ui.addMessage('工具损坏了！'); }
  }
  attack(mob) {
    const p = this.player;
    const tool = this.heldTool();
    let dmg = tool ? tool.damage : 1;
    const cd = p.attackCooldownProgress();
    dmg *= 0.2 + cd * cd * 0.8;
    const crit = cd > 0.9 && p.fallDistance > 0 && !p.onGround && !p.inWater && !p.sprinting;
    if (crit) dmg *= 1.5;
    p.lastAttackTicks = 0;
    this.swing();
    if (mob.hurt(dmg, 'player', p)) {
      this.audio.play('attack');
      if (p.sprinting && cd > 0.9) { mob.knockback(0.5, -Math.sin(p.yaw), -Math.cos(p.yaw)); p.vel.x *= 0.6; p.vel.z *= 0.6; p.sprinting = false; }
      if (crit) for (let i = 0; i < 6; i++) this.particles.hit(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 1), Math.floor(mob.pos.z), [0, 1, 0], TILES.indexOf('destroy_9'));
      if (tool) this.damageHeld(tool.type === 'sword' ? 1 : 2);
    }
    p.addExhaustion(0.1);
  }
  useItem(t) {
    const p = this.player, w = this.world;
    const held = p.inventory.held();
    const d = held && ITEMS.get(held.id);
    // 打开容器
    if (t && !t.entity && !p.sneaking) {
      const b = BLOCKS[t.id];
      if (b.interact) { this.swing(); this.openContainer(t.x, t.y, t.z, b); return; }
    }
    if (!held) return;
    // 食物
    if (d.food) {
      if (p.canEat()) { p.usingItem = true; p.usingId = held.id; p.useTicks = 0; }
      return;
    }
    // 桶
    if (d.bucket) {
      if (d.bucket === 'empty') {
        const lt = this.raycast(this.reach(), true);
        if (lt && isLiquid(lt.id) && BLOCKS[lt.id].level === 0) {
          w.setBlock(lt.x, lt.y, lt.z, 0);
          this.audio.play('bucket'); this.swing();
          const filled = isWater(lt.id) ? I.water_bucket : I.lava_bucket;
          if (p.mode === 'survival') {
            if (held.count === 1) p.inventory.slots[p.inventory.selected] = { id: filled, count: 1, dmg: 0 };
            else { held.count--; const left = p.inventory.add({ id: filled, count: 1, dmg: 0 }); if (left) this.dropStack({ id: filled, count: 1 }); }
          }
        }
        return;
      }
      if (!t || t.entity) return;
      let px = t.x, py = t.y, pz = t.z;
      if (!BLOCKS[t.id].replaceable) { px += t.n[0]; py += t.n[1]; pz += t.n[2]; }
      const cur = w.getBlock(px, py, pz);
      if (cur < 0 || (cur > 0 && !BLOCKS[cur].replaceable && !isLiquid(cur))) return;
      if (cur > 0 && !isLiquid(cur)) this.dropBlockItems(px, py, pz, cur, null);
      w.setBlock(px, py, pz, d.bucket === 'water' ? 120 : 130);
      this.audio.play('bucket'); this.swing();
      if (p.mode === 'survival') p.inventory.slots[p.inventory.selected] = { id: I.bucket, count: 1, dmg: 0 };
      return;
    }
    // 放置方块
    if (d.isBlock && t && !t.entity) this.placeBlock(t, held, d);
  }
  placeBlock(t, held, d) {
    const p = this.player, w = this.world;
    const tb = BLOCKS[t.id];
    let x = t.x, y = t.y, z = t.z, n = t.n;
    if (!(tb.replaceable && !tb.liquid)) { x += n[0]; y += n[1]; z += n[2]; }
    if (y < 0 || y >= HEIGHT) return;
    const cur = w.getBlock(x, y, z);
    if (cur < 0 || (cur > 0 && !BLOCKS[cur].replaceable)) return;
    let id = d.block;
    const nb = BLOCKS[id];
    // 火把：侧面 → 墙上火把；底面不可放置
    if (id === B.torch) {
      if (n[1] < 0 && t.id !== cur) return;
      if (n[1] === 0 && (n[0] || n[2])) {
        // 墙在法线反方向
        const wx = -n[0], wz = -n[2];
        const f = [[0, 1], [-1, 0], [0, -1], [1, 0]].findIndex(([a, b]) => a === wx && b === wz);
        id = 112 + f;
      }
    }
    // 朝向方块：正面朝向玩家
    if (nb.facing !== undefined && nb.baseKey) {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      let best = 0, bd = -2;
      FACING_DIRS.forEach((v, i) => { const dd = v[0] * fx + v[2] * fz; if (dd > bd) { bd = dd; best = i; } });
      id = nb.id + best;
    }
    const b = BLOCKS[id];
    if (b.needsSupport && !w.hasSupport(x, y, z, b)) return;
    // 不能放进实体内
    if (b.solid) {
      const box = [x, y, z, x + 1, y + 1, z + 1];
      const hits = (e) => { const eb = entityBox(e); return eb[0] < box[3] && eb[3] > box[0] && eb[1] < box[4] && eb[4] > box[1] && eb[2] < box[5] && eb[5] > box[2]; };
      if (hits(p)) return;
      for (const e of this.entities) if (e instanceof Mob && !e.dead && hits(e)) return;
    }
    if (cur > 0 && isLiquid(cur) && (b.shape === 'cross' || b.shape === 'torch' || b.shape === 'wall_torch')) return;
    w.setBlock(x, y, z, id);
    if (b.gravity) w.schedule(x, y, z, 2);
    this.audio.place(b.sound);
    this.swing();
    if (p.mode === 'survival') p.inventory.consumeHeld(1);
  }
  openContainer(x, y, z, b) {
    const k = x + ',' + y + ',' + z;
    this.unlock();
    if (b.interact === 'crafting') { this.ui.open('crafting'); return; }
    let te = this.tiles.get(k);
    if (!te) { te = b.interact === 'furnace' ? newFurnace() : newChest(); this.tiles.set(k, te); }
    this.ui.open(b.interact, te);
  }
  pickBlock() {
    const t = this.raycast(this.reach());
    if (!t || t.entity) return;
    const b = BLOCKS[t.id];
    const id = b.item;
    if (!id || !ITEMS.has(id)) return;
    const inv = this.player.inventory;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === id) { inv.selected = i; return; }
    if (this.player.mode !== 'creative') {
      const i = inv.slots.findIndex((s, j) => j >= 9 && s && s.id === id);
      if (i >= 0) { const tmp = inv.slots[inv.selected]; inv.slots[inv.selected] = inv.slots[i]; inv.slots[i] = tmp; }
      return;
    }
    let slot = inv.selected;
    if (inv.slots[slot]) { const e = inv.slots.findIndex((s, j) => j < 9 && !s); if (e >= 0) slot = e; }
    inv.slots[slot] = { id, count: 1, dmg: 0 }; inv.selected = slot;
  }
  dropHeld(all) {
    const p = this.player, inv = p.inventory, h = inv.held();
    if (!h) return;
    const n = all ? h.count : 1;
    this.dropStack({ id: h.id, count: n, dmg: h.dmg || 0 });
    h.count -= n; if (h.count <= 0) inv.slots[inv.selected] = null;
    this.swing();
  }
  dropStack(stack) {
    if (!stack || !this.world) return;
    const p = this.player;
    const e = new ItemEntity(this, p.pos.x, p.pos.y + p.eyeHeight() - 0.3, p.pos.z, cloneStack(stack), 40);
    const d = this.lookDir();
    e.vel.set(d.x * 0.3 + (Math.random() - 0.5) * 0.02, d.y * 0.3 + 0.1, d.z * 0.3 + (Math.random() - 0.5) * 0.02);
    this.addEntity(e);
  }

  // ---------------- 世界回调 ----------------
  onBlockChanged(x, y, z, old, id) {
    if (old > 0 && BLOCKS[old].key.endsWith('_log')) this.world.onLogRemoved(x, y, z);
    if (old > 0 && BLOCKS[old].interact && BLOCKS[old].interact !== 'crafting' && !(id > 0 && BLOCKS[id].interact === BLOCKS[old].interact)) {
      this.dropTileContents(x, y, z);
    }
  }
  dropTileContents(x, y, z, silent) {
    const k = x + ',' + y + ',' + z;
    const te = this.tiles.get(k);
    if (!te) return;
    this.tiles.delete(k);
    if (silent && this.player.mode === 'creative') return;
    const items = te.type === 'furnace' ? [te.input, te.fuel, te.output] : te.items;
    for (const s of items) if (s) this.spawnItem(x + 0.5, y + 0.5, z + 0.5, cloneStack(s));
    if (this.ui.screen && this.ui.screen.data === te) this.ui.close();
  }
  dropBlockItems(x, y, z, id, tool) {
    const b = BLOCKS[id];
    this.dropTileContents(x, y, z);
    if (!b || b.liquid) return;
    let drops = b.drops, out = [];
    if (drops === undefined) { if (b.item) out.push([b.item, 1]); }
    else if (drops === null) { /* 无掉落 */ }
    else {
      let r = typeof drops === 'function' ? drops(Math.random, tool) : drops;
      if (r === null || r === undefined) r = [];
      const list = Array.isArray(r) && (Array.isArray(r[0]) || typeof r[0] === 'object') ? r : [r];
      for (const it of list) {
        if (!it) continue;
        if (Array.isArray(it)) out.push([typeof it[0] === 'number' ? it[0] : idOf(it[0]), it[1]]);
        else out.push([typeof it === 'number' ? it : idOf(it), 1]);
      }
    }
    for (const [iid, n] of out) if (iid && n > 0 && ITEMS.has(iid)) this.spawnItem(x + 0.5, y + 0.3, z + 0.5, { id: iid, count: n, dmg: 0 });
  }
  spawnItem(x, y, z, stack, delay = 10) {
    if (!this.world) return;
    const e = new ItemEntity(this, x, y, z, { id: stack.id, count: stack.count, dmg: stack.dmg || 0 }, delay);
    this.addEntity(e);
    return e;
  }
  spawnFallingBlock(x, y, z, id) { this.addEntity(new FallingBlock(this, x, y, z, id)); }
  playSoundAt(name, x, y, z) {
    const p = this.player.pos; const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    if (d < 16) this.audio.play(name, { vol: 1 - d / 16 });
  }
  addEntity(e) { this.entities.push(e); if (e.object) this.scene.add(e.object); }
  swingMob(m) { m.swingT = 0.6; }
  onChunkLoaded() {}
  onChunkUnloaded(c) {
    for (const e of this.entities) {
      if ((Math.floor(e.pos.x) >> 4) === c.cx && (Math.floor(e.pos.z) >> 4) === c.cz) e.removed = true;
    }
  }
  onPlayerHurt() { this.audio.play('hurt'); }
  onPlayerDeath(source) {
    const p = this.player;
    if (p.mode === 'survival') {
      for (let i = 0; i < 36; i++) { const s = p.inventory.slots[i]; if (s) { const e = this.spawnItem(p.pos.x, p.pos.y + 1, p.pos.z, s, 40); e.vel.set((Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5); } }
      p.inventory.clear();
    }
    if (this.ui.isOpen()) this.ui.close(true);
    this.ui.closeChat();
    this.unlock();
    this.ui.showDeath('玩家' + (DEATH_MSG[source] || '死了'));
    this.ui.addMessage('玩家' + (DEATH_MSG[source] || '死了'));
  }
  respawn() {
    const p = this.player;
    p.reset();
    const sx = Math.floor(p.spawn.x), sz = Math.floor(p.spawn.z);
    let x = p.spawn.x, y = p.spawn.y, z = p.spawn.z;
    if (this.world.isLoaded(sx, sz)) { const s = this.safeSpot(sx, sz); x = s.x + 0.5; y = s.y; z = s.z + 0.5; }
    p.pos.set(x, y, z); p.prevPos.copy(p.pos);
    this.paused = false;
    this.lock();
  }
  setMode(mode) {
    const p = this.player;
    p.mode = mode;
    if (mode === 'survival') p.flying = false;
    if (mode === 'creative') { p.health = p.maxHealth; p.food = 20; }
    this.ui.addMessage('已将游戏模式设为' + (mode === 'creative' ? '创造模式' : '生存模式'));
  }

  // ---------------- 聊天 / 命令 ----------------
  chat(text) {
    if (!text.startsWith('/')) { this.ui.addMessage('<玩家> ' + text); return; }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const p = this.player;
    const num = (s, base) => (s && s.startsWith('~') ? base + (Number(s.slice(1)) || 0) : Number(s));
    try {
      switch (cmd) {
        case 'gamemode': case 'gm': {
          const m = { creative: 'creative', c: 'creative', 1: 'creative', survival: 'survival', s: 'survival', 0: 'survival' }[args[0]];
          if (!m) throw new Error('用法：/gamemode creative|survival');
          this.setMode(m); break;
        }
        case 'time': {
          if (args[0] === 'set' || args[0] === 'add') {
            const v = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 }[args[1]] ?? Number(args[1]);
            if (isNaN(v)) throw new Error('用法：/time set day|night|<数值>');
            this.time = args[0] === 'set' ? v : this.time + v;
            this.ui.addMessage('已将时间设为 ' + Math.floor(this.time % 24000));
          } else if (args[0] === 'query') this.ui.addMessage('当前时间：' + Math.floor(this.time % 24000));
          else throw new Error('用法：/time set day|night|<数值>');
          break;
        }
        case 'tp': case 'teleport': {
          const x = num(args[0], p.pos.x), y = num(args[1], p.pos.y), z = num(args[2], p.pos.z);
          if ([x, y, z].some(isNaN)) throw new Error('用法：/tp x y z');
          p.pos.set(x, y, z); p.prevPos.copy(p.pos); p.vel.set(0, 0, 0); p.fallDistance = 0;
          this.ui.addMessage(`已将玩家传送至 ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`); break;
        }
        case 'give': {
          const key = args[0]; const n = Math.max(1, Math.min(6400, Number(args[1]) || 1));
          let id = idOf(key?.replace('minecraft:', ''));
          if (id === undefined) { for (const [iid, d] of ITEMS) if (d.name === key) id = iid; }
          if (id === undefined || !ITEMS.has(id)) throw new Error('未知的物品：' + key);
          let left = n; while (left > 0) { const c = Math.min(left, maxStack(id)); const r = p.inventory.add({ id, count: c, dmg: 0 }); if (r) this.dropStack({ id, count: r }); left -= c; }
          this.audio.play('pop');
          this.ui.addMessage(`已将 [${itemName(id)}] × ${n} 给予玩家`); break;
        }
        case 'seed': this.ui.addMessage('种子：[' + this.meta.seed + ']'); break;
        case 'kill': p.hurt(1000, 'kill'); if (p.mode === 'creative') { p.health = 0; p.die('kill'); } break;
        case 'spawn': this.respawn(); this.ui.addMessage('已传送到出生点'); break;
        case 'setworldspawn': case 'spawnpoint': p.spawn = { x: p.pos.x, y: p.pos.y, z: p.pos.z }; this.ui.addMessage('已设置出生点'); break;
        case 'summon': {
          const kind = (args[0] || '').replace('minecraft:', '');
          if (!['pig', 'cow', 'sheep', 'zombie'].includes(kind)) throw new Error('可召唤：pig, cow, sheep, zombie');
          const d = this.lookDir();
          this.addEntity(new Mob(this, kind, p.pos.x + d.x * 3, p.pos.y + 0.5, p.pos.z + d.z * 3)); break;
        }
        case 'clear': p.inventory.clear(); this.ui.addMessage('已清空物品栏'); break;
        case 'help': this.ui.addMessage('命令：/gamemode, /time set, /tp, /give, /summon, /seed, /kill, /spawn, /spawnpoint, /clear'); break;
        default: throw new Error('未知的命令：' + cmd + '，输入 /help 查看帮助');
      }
    } catch (e) { this.ui.addMessage('§ ' + e.message); }
  }

  // ---------------- 生物生成 ----------------
  mobCounts() { let passive = 0, hostile = 0; for (const e of this.entities) if (e instanceof Mob) { if (e.hostile) hostile++; else passive++; } return { passive, hostile }; }
  spawnInitialMobs() {
    const p = this.player;
    for (let i = 0; i < 6; i++) this.trySpawnPassive(p.pos.x + (Math.random() - 0.5) * 60, p.pos.z + (Math.random() - 0.5) * 60);
  }
  trySpawnPassive(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const w = this.world;
    if (!w.isLoaded(x, z)) return false;
    const y = w.topSolidY(x, z);
    if (y < 0 || w.getBlock(x, y, z) !== B.grass_block) return false;
    if (w.getBlock(x, y + 1, z) !== 0 && !(BLOCKS[w.getBlock(x, y + 1, z)]?.replaceable && !isLiquid(w.getBlock(x, y + 1, z)))) return false;
    const kinds = ['pig', 'cow', 'sheep'];
    const kind = kinds[Math.floor(Math.random() * 3)];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ox = x + Math.floor((Math.random() - 0.5) * 6), oz = z + Math.floor((Math.random() - 0.5) * 6);
      if (!w.isLoaded(ox, oz)) continue;
      const oy = w.topSolidY(ox, oz);
      if (w.getBlock(ox, oy, oz) !== B.grass_block) continue;
      const m = new Mob(this, kind, ox + 0.5, oy + 1, oz + 0.5);
      if (boxCollides(w, entityBox(m))) continue;
      this.addEntity(m);
    }
    return true;
  }
  spawnTick() {
    const p = this.player, w = this.world;
    // 远处生物消失
    for (const e of this.entities) {
      if (!(e instanceof Mob)) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (e.hostile && (d > 128 || (d > 32 && Math.random() < 1 / 800))) e.removed = true;
      if (!e.hostile && d > 160) e.removed = true;
    }
    if (++this.spawnTimer % 20) return;
    const { passive, hostile } = this.mobCounts();
    const ang = Math.random() * Math.PI * 2, dist = 24 + Math.random() * 40;
    const x = p.pos.x + Math.cos(ang) * dist, z = p.pos.z + Math.sin(ang) * dist;
    if (passive < 10 && Math.random() < 0.08 && this.daylight > 0.5) this.trySpawnPassive(x, z);
    if (hostile < 8) {
      const bx = Math.floor(x), bz = Math.floor(z);
      if (!w.isLoaded(bx, bz)) return;
      // 随机高度（地表或洞穴）
      const top = w.topSolidY(bx, bz);
      const y = Math.random() < 0.5 ? top + 1 : 5 + Math.floor(Math.random() * Math.max(1, top - 5));
      const below = w.getBlock(bx, y - 1, bz), a = w.getBlock(bx, y, bz), a2 = w.getBlock(bx, y + 1, bz);
      if (!(below > 0 && OPAQUE[below]) || a !== 0 || a2 !== 0) return;
      const l = w.lightAt(bx, y, bz);
      const eff = Math.max(l.block, l.sky - Math.round(this.darken * 15));
      if (eff > 7 || l.block > 0) return;
      if (Math.hypot(bx - p.pos.x, y - p.pos.y, bz - p.pos.z) < 24) return;
      this.addEntity(new Mob(this, 'zombie', bx + 0.5, y, bz + 0.5));
    }
  }

  // ---------------- 主循环 ----------------
  tick() {
    const p = this.player, w = this.world;
    this.time++;
    // 天空（tick 中更新亮度，供逻辑使用）
    const prevMode = p.mode;
    p.tick(this.input());
    if (p.mode !== prevMode) {}
    if (p.swinging) { p.swingTicks++; if (p.swingTicks >= 6) { p.swinging = false; p.swingTicks = 0; } }
    this.interactTick();
    // 实体
    for (const e of this.entities) {
      if (e.removed) continue;
      const cx = Math.floor(e.pos.x), cz = Math.floor(e.pos.z);
      if (!w.isLoaded(cx, cz)) continue;
      e.tick();
      // 拾取掉落物
      if (e instanceof ItemEntity && !p.dead && e.pickupDelay <= 0 && !e.removed) {
        const pb = entityBox(p), eb = entityBox(e);
        if (eb[0] < pb[3] + 1 && eb[3] > pb[0] - 1 && eb[1] < pb[4] + 0.5 && eb[4] > pb[1] - 0.5 && eb[2] < pb[5] + 1 && eb[5] > pb[2] - 1) {
          const left = p.inventory.add(e.stack);
          if (left < e.stack.count) this.audio.play('pop', { vol: 0.6 });
          if (!left) e.removed = true; else e.stack.count = left;
        }
      }
      // 掉落物合并
      if (e instanceof ItemEntity && !e.removed && e.age % 10 === 0) {
        for (const o of this.entities) {
          if (o === e || o.removed || !(o instanceof ItemEntity) || o.stack.id !== e.stack.id || (o.stack.dmg || 0) !== (e.stack.dmg || 0)) continue;
          if (Math.abs(o.pos.x - e.pos.x) < 0.8 && Math.abs(o.pos.y - e.pos.y) < 0.5 && Math.abs(o.pos.z - e.pos.z) < 0.8 && o.stack.count + e.stack.count <= maxStack(e.stack.id)) { e.stack.count += o.stack.count; o.removed = true; }
        }
      }
    }
    // 生物之间的推挤
    for (const e of this.entities) {
      if (!(e instanceof Mob) || e.removed) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz), min = (e.width + p.width) / 2;
      if (d < min && d > 1e-4 && Math.abs(e.pos.y - p.pos.y) < 1.8) { const k = (min - d) * 0.05 / d; e.vel.x += dx * k * 4; e.vel.z += dz * k * 4; p.vel.x -= dx * k; p.vel.z -= dz * k; }
    }
    this.entities = this.entities.filter((e) => { if (e.removed && e.object) this.scene.remove(e.object); return !e.removed; });
    this.spawnTick();
    // 方块刻 & 随机刻
    w.processTicks();
    w.randomTicks(p.pos.x, p.pos.z);
    // 熔炉
    for (const [k, te] of this.tiles) {
      if (te.type !== 'furnace') continue;
      if (furnaceTick(te)) {
        const [x, y, z] = k.split(',').map(Number);
        const id = w.getBlock(x, y, z);
        if (id >= 100 && id <= 107) w.setBlock(x, y, z, te.burn > 0 ? 104 + ((id - 100) % 4) : 100 + ((id - 100) % 4), { update: false });
      }
    }
    if (this.ui.screen) this.ui.refresh();
    const h = p.inventory.held();
    this.hand.tick(h ? h.id + ':' + p.inventory.selected : 'e' + p.inventory.selected);
    if (++this.autosave >= 600) { this.autosave = 0; this.saveWorld(); }
  }
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
    this.frames++; this.fpsT += dt; if (this.fpsT >= 1) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    try { this.update(dt); } catch (e) { console.error(e); }
  }
  update(dt) {
    const r = this.renderer;
    if (!this.inWorld || !this.world) {
      r.setClearColor(0x000000); r.clear();
      return;
    }
    const p = this.player, w = this.world;
    w.update(p.pos.x, p.pos.z);
    if (this.loading) {
      const prog = w.readyAround(p.pos.x, p.pos.z, 2);
      this.ui.showLoading(this.needPlace ? '正在生成地形…' : '正在载入世界…', prog);
      const near = w.readyAround(p.pos.x, p.pos.z, 1);
      if (near >= 1 && (prog >= 1 || performance.now() - this.loadStart > 12000)) this.finishLoading();
      else { r.setClearColor(0x000000); r.clear(); return; }
    }
    if (!this.paused) {
      this.acc += dt * 1000;
      let n = 0;
      while (this.acc >= TICK && n < 10) { this.tick(); this.acc -= TICK; n++; }
      if (n >= 10) this.acc = 0;
    }
    const alpha = Math.min(1, this.acc / TICK);
    this.render(alpha, dt);
    this.audio.updateMusic(dt);
    this.ui.updateHUD();
    if (this.showDebug && (this.frames % 10 === 0)) this.updateDebug();
  }
  render(alpha, dt) {
    const p = this.player, w = this.world, cam = this.camera, r = this.renderer;
    const pos = p.renderPos(alpha, new THREE.Vector3());
    // 潜行时视线高度平滑
    p.renderEye = p.renderEye === undefined ? p.eyeHeight() : p.renderEye + (p.eyeHeight() - p.renderEye) * Math.min(1, dt * 15);
    const eye = new THREE.Vector3(pos.x, pos.y + p.renderEye, pos.z);
    // 天空
    const ptime = this.time + alpha;
    this.sky.update(ptime % 24000, eye, this.settings.clouds, p.eyeInWater || p.eyeInLava);
    this.daylight = this.sky.daylight; this.darken = this.sky.darken;
    // 视角
    cam.rotation.set(p.pitch, p.yaw, 0);
    cam.position.copy(eye);
    const bobMat = new THREE.Matrix4();
    if (this.perspective === 0) {
      // 视角摇晃（MC applyBobbing）
      if (this.settings.viewBobbing && !p.flying) {
        const dw = p.distWalked - p.prevDistWalked;
        const f1 = -(p.distWalked + dw * alpha);
        const f2 = p.prevBob + (p.bob - p.prevBob) * alpha;
        const tx = Math.sin(f1 * Math.PI) * f2 * 0.5, ty = -Math.abs(Math.cos(f1 * Math.PI) * f2);
        const rz = Math.sin(f1 * Math.PI) * f2 * 3 * Math.PI / 180, rx = Math.abs(Math.cos(f1 * Math.PI - 0.2) * f2) * 5 * Math.PI / 180;
        bobMat.makeTranslation(tx, ty, 0).multiply(new THREE.Matrix4().makeRotationZ(rz)).multiply(new THREE.Matrix4().makeRotationX(rx));
        cam.updateMatrix();
        // 将摇晃作为相机局部变换（反向作用于世界）
        const m = new THREE.Matrix4().compose(cam.position, cam.quaternion, new THREE.Vector3(1, 1, 1));
        m.multiply(bobMat.clone().invert());
        m.decompose(cam.position, cam.quaternion, new THREE.Vector3());
      }
      // 受伤摇晃
      if (p.hurtTime > 0) {
        let f = (p.hurtTime - alpha) / 10; f = Math.sin(f * f * f * f * Math.PI);
        cam.rotateZ(-f * 14 * Math.PI / 180 * 0.5);
      }
      this.playerModel.visible = false;
    } else {
      // 第三人称
      const back = this.perspective === 1 ? 1 : -1;
      const d = this.lookDir().multiplyScalar(-back);
      let dist = 4;
      // 碰撞检测：后退距离被方块限制
      for (let t = 0.1; t <= 4; t += 0.1) {
        const q = eye.clone().addScaledVector(d, t);
        const b = w.getBlock(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z));
        if (b > 0 && OPAQUE[b]) { dist = Math.max(0.2, t - 0.3); break; }
      }
      cam.position.copy(eye).addScaledVector(d, dist);
      if (this.perspective === 2) cam.rotation.set(-p.pitch, p.yaw + Math.PI, 0);
      this.playerModel.visible = true;
      p.limbSwing = p.limbSwing || 0;
      p.swingAnim = p.swinging ? Math.sin((Math.max(0, p.swingTicks) + alpha) / 6 * Math.PI) : 0;
      const l = w.lightAt(Math.floor(pos.x), Math.floor(pos.y + 1), Math.floor(pos.z));
      animatePlayerModel(this.playerModel, p, alpha, brightness(l.sky, l.block, this.darken, this.settings.gamma / 100));
    }
    // FOV
    let fov = this.settings.fov * (p.prevFovMod + (p.fovMod - p.prevFovMod) * alpha);
    if (p.eyeInWater) fov *= 60 / 70;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // 雾 / 着色器
    const rd = this.settings.renderDistance * 16;
    let fogColor = this.sky.fogColor.clone(), near = rd * 0.55, far = rd - 2;
    if (p.eyeInWater) { const l = w.lightAt(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)); const k = Math.max(0.15, brightness(l.sky, l.block, this.darken, 0.5)); fogColor = new THREE.Color(0.02, 0.06, 0.35).multiplyScalar(k * 1.4); near = -8; far = 22; }
    else if (p.eyeInLava) { fogColor = new THREE.Color(0.6, 0.1, 0); near = -0.5; far = 2; }
    else if (eye.y < SEA - 20) { const l = w.lightAt(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)); if (l.sky < 8) fogColor.multiplyScalar(Math.max(0.15, l.sky / 8)); }
    const m = this.materials;
    m.setAll('uFogColor', fogColor); m.setAll('uFogNear', near); m.setAll('uFogFar', far);
    m.setAll('uDarken', this.darken); m.setAll('uTime', this.time / 20);
    r.setClearColor(fogColor, 1);
    // 选择框
    const t = this.target;
    if (t && !t.entity && !p.dead) this.highlight.show(t.x, t.y, t.z, t.id); else this.highlight.hide();
    // 实体
    for (const e of this.entities) if (e.object && e.updateObject) e.updateObject(alpha, cam);
    this.particles.update(dt, cam, w);
    r.clear();
    r.render(this.skyScene, cam);
    r.render(this.scene, cam);
    // 第一人称手
    if (this.perspective === 0 && !this.hudHidden && !p.dead && !this.ui.hideHand) {
      const h = p.inventory.held();
      this.hand.setItem(h ? h.id : 0);
      const swing = p.swinging ? Math.min(1, (Math.max(0, p.swingTicks) + alpha) / 6) : 0;
      const l = w.lightAt(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
      const br = brightness(l.sky, l.block, this.darken, this.settings.gamma / 100);
      const eating = p.usingItem ? p.useTicks + alpha : 0;
      const hb = new THREE.Matrix4();
      if (this.settings.viewBobbing && !p.flying) {
        const dw = p.distWalked - p.prevDistWalked, f1 = -(p.distWalked + dw * alpha), f2 = p.prevBob + (p.bob - p.prevBob) * alpha;
        hb.makeTranslation(Math.sin(f1 * Math.PI) * f2 * 0.5, -Math.abs(Math.cos(f1 * Math.PI) * f2), 0);
      }
      this.hand.update(cam.aspect, alpha, swing, br, eating, hb);
      r.clearDepth();
      r.render(this.hand.scene, this.hand.camera);
    }
  }
  updateDebug() {
    const p = this.player, w = this.world;
    const x = Math.floor(p.pos.x), y = Math.floor(p.pos.y), z = Math.floor(p.pos.z);
    const yawDeg = ((-p.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180; // MC 约定：0 南, 90 西, 180 北
    const mcYaw = ((yawDeg + 180 + 540) % 360) - 180;
    const dirs = ['南 (朝向 +Z)', '西 (朝向 -X)', '北 (朝向 -Z)', '东 (朝向 +X)'];
    const fi = Math.round(((mcYaw % 360) + 360) % 360 / 90) % 4;
    const l = w.lightAt(x, y, z);
    const t = this.target;
    const loaded = [...w.chunks.values()].filter((c) => c.blocks).length;
    const meshed = [...w.chunks.values()].filter((c) => c.solid || c.trans).length;
    const info = this.renderer.info;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const paint = (id, lines) => {
      document.getElementById(id).innerHTML = lines.map((l) => (l ? `<span>${esc(l)}</span>` : '<br>')).join('\n');
    };
    paint('debug', [
      `Mini Minecraft 网页复刻版 (${this.fps} fps)`,
      `区块：已加载 ${loaded}，已渲染 ${meshed}，渲染距离 ${this.settings.renderDistance}`,
      `实体：${this.entities.length}`,
      '',
      `XYZ: ${p.pos.x.toFixed(3)} / ${p.pos.y.toFixed(5)} / ${p.pos.z.toFixed(3)}`,
      `方块: ${x} ${y} ${z}`,
      `区块: ${x & 15} ${y & 15} ${z & 15} 位于 ${x >> 4} ${y >> 4} ${z >> 4}`,
      `朝向: ${dirs[fi]} (${mcYaw.toFixed(1)} / ${(-p.pitch * 180 / Math.PI).toFixed(1)})`,
      `光照: ${Math.max(l.block, l.sky)} (天空 ${l.sky}，方块 ${l.block})`,
      `生物群系: ${BIOME_NAMES[w.biomeAt(x, z)] || '?'}`,
      `时间: 第 ${Math.floor(this.time / 24000)} 天 ${Math.floor(this.time % 24000)}`,
      `种子: ${this.meta.seed}`,
      `模式: ${p.mode === 'creative' ? '创造' : '生存'}${p.flying ? '（飞行）' : ''}${p.sprinting ? ' 疾跑' : ''}${p.sneaking ? ' 潜行' : ''}`,
    ]);
    paint('debugR', [
      `WebGL2 · Three.js r${THREE.REVISION}`,
      `${window.innerWidth}x${window.innerHeight}`,
      `绘制调用: ${info.render.calls}`,
      `三角形: ${info.render.triangles}`,
      `Worker: ${w.workers.length}`,
      '',
      t && !t.entity ? `目标方块: ${t.x}, ${t.y}, ${t.z}` : '',
      t && !t.entity ? `${BLOCKS[t.id].key}（${BLOCKS[t.id].name}）` : t && t.entity ? `目标实体: ${t.entity.def.name}` : '',
    ]);
  }
  playerPreviewCanvas() { return previewCanvas(); }
}

// 启动
function boot() {
  try { new Game(); }
  catch (e) {
    console.error(e);
    document.body.innerHTML = `<div style="color:#fff;padding:2em;font-family:sans-serif">无法启动游戏：${e.message}<br>请使用支持 WebGL2 的现代浏览器（Chrome / Edge / Firefox / Safari 15+）。</div>`;
  }
}
boot();
