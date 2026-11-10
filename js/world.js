// 世界：区块加载/卸载、Worker 池、方块读写、方块更新（液体/重力/支撑）、随机刻
import * as THREE from 'three';
import { CHUNK, HEIGHT, SEA, BLOCKS, B, OPAQUE, SOLID, LIGHT_OPACITY, LIGHT_EMIT, isLiquid, isWater, isLava, liquidId, MAX_LEVEL } from './registry.js';
import { WorldGen, placeTree, BIOME } from './worldgen.js';
import { hash3 } from './noise.js';

const key = (cx, cz) => cx + ',' + cz;
const bidx = (x, y, z) => (y * CHUNK + z) * CHUNK + x;

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = null; this.biomes = null; this.heights = null; this.light = null;
    this.state = 'loading'; // loading | ready
    this.version = 0; this.meshedVersion = -1; this.meshing = false;
    this.solid = null; this.trans = null; this.modified = false;
  }
}

export class World {
  constructor(game, seed, materials) {
    this.game = game;
    this.seed = seed;
    this.gen = new WorldGen(seed); // 主线程用于查询地表高度
    this.chunks = new Map();
    this.materials = materials;
    this.group = new THREE.Group();
    this.renderDistance = 6;
    this.scheduled = new Map(); // "x,y,z" -> tick
    this.tick = 0;
    this.savedKeys = new Set();
    this.store = null; // 存储接口
    this.jobs = []; this.inflight = 0;
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => this.onWorker(w, e.data);
      w.onerror = (e) => console.error('worker error', e.message || e);
      w.postMessage({ type: 'init', seed });
      this.workers.push(w);
    }
    this.leafChecks = [];
  }
  dispose() {
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this.disposeMeshes(c);
    this.chunks.clear();
  }

  // ---------- 方块访问 ----------
  getChunk(cx, cz) { return this.chunks.get(key(cx, cz)); }
  getBlock(x, y, z) {
    if (y < 0) return B.bedrock; if (y >= HEIGHT) return 0;
    const c = this.chunks.get(key(x >> 4, z >> 4));
    if (!c || !c.blocks) return -1;
    return c.blocks[bidx(x & 15, y, z & 15)];
  }
  isLoaded(x, z) { const c = this.chunks.get(key(x >> 4, z >> 4)); return !!(c && c.blocks); }
  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return false;
    const i = bidx(x & 15, y, z & 15);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.modified = true;
    const lightChanged = LIGHT_OPACITY[old] !== LIGHT_OPACITY[id] || LIGHT_EMIT[old] !== LIGHT_EMIT[id];
    this.markDirty(cx, cz, true);
    const lx = x & 15, lz = z & 15;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const near = (dx === -1 ? lx <= 1 : dx === 1 ? lx >= 14 : true) && (dz === -1 ? lz <= 1 : dz === 1 ? lz >= 14 : true);
      if (lightChanged || near) this.markDirty(cx + dx, cz + dz, near);
    }
    // 更新光照缓存（近似：在重新网格化前立即反映放置光源）
    if (opts.update !== false) this.notifyNeighbors(x, y, z);
    if (this.game.onBlockChanged) this.game.onBlockChanged(x, y, z, old, id);
    return true;
  }
  markDirty(cx, cz, urgent) {
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return;
    c.version++;
    c.urgent = c.urgent || urgent;
  }
  lightAt(x, y, z) {
    if (y >= HEIGHT) return { sky: 15, block: 0 };
    if (y < 0) return { sky: 0, block: 0 };
    const c = this.chunks.get(key(x >> 4, z >> 4));
    if (!c || !c.light) return { sky: 15, block: 0 };
    const v = c.light[bidx(x & 15, y, z & 15)];
    return { sky: v >> 4, block: v & 15 };
  }
  biomeAt(x, z) {
    const c = this.chunks.get(key(x >> 4, z >> 4));
    if (!c || !c.biomes) return this.gen.column(x, z).biome;
    return c.biomes[(z & 15) * 16 + (x & 15)];
  }
  topSolidY(x, z) {
    for (let y = HEIGHT - 1; y > 0; y--) { const b = this.getBlock(x, y, z); if (b > 0 && SOLID[b] && !BLOCKS[b].key.includes('leaves')) return y; }
    return -1;
  }
  topY(x, z) { for (let y = HEIGHT - 1; y > 0; y--) { const b = this.getBlock(x, y, z); if (b > 0 && (SOLID[b] || isLiquid(b))) return y; } return -1; }

  // ---------- Worker 调度 ----------
  onWorker(w, m) {
    if (m.type === 'ready') return;
    w.busy = false; this.inflight--;
    if (m.type === 'error') console.error('worker:', m.message);
    else if (m.type === 'gen') {
      const c = this.chunks.get(key(m.cx, m.cz));
      if (c && !c.blocks) {
        c.blocks = m.blocks; c.biomes = m.biomes; c.heights = m.heights; c.state = 'ready'; c.version++;
        this.onChunkLoaded(c);
      }
    } else if (m.type === 'mesh') {
      const c = this.chunks.get(key(m.cx, m.cz));
      if (c) {
        c.meshing = false;
        c.light = m.light;
        if (m.version >= c.meshedVersion) { this.applyMesh(c, m); c.meshedVersion = m.version; }
      }
    }
    this.pump();
  }
  pump() {
    for (const w of this.workers) {
      if (w.busy) continue;
      const job = this.nextJob();
      if (!job) return;
      w.busy = true; this.inflight++;
      if (job.type === 'gen') w.postMessage({ type: 'gen', cx: job.c.cx, cz: job.c.cz });
      else {
        const c = job.c;
        const arr = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
          arr.push(n && n.blocks ? n.blocks.slice() : null);
        }
        c.meshing = true; c.urgent = false;
        w.postMessage({ type: 'mesh', cx: c.cx, cz: c.cz, version: c.version, chunks: arr }, arr.filter(Boolean).map((a) => a.buffer));
      }
    }
  }
  nextJob() {
    // 优先：紧急网格（玩家修改） > 生成 > 普通网格（按距离）
    const p = this.game.player.pos;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    let best = null, bestScore = Infinity;
    for (const c of this.chunks.values()) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      const dd = (c.cx - pcx) ** 2 + (c.cz - pcz) ** 2;
      if (c.state === 'need-gen') {
        const s = 1000 + dd;
        if (s < bestScore) { bestScore = s; best = { type: 'gen', c }; }
      } else if (c.blocks && !c.meshing && c.version !== c.meshedVersion && d <= this.renderDistance) {
        if (!this.neighborsReady(c)) continue;
        const s = (c.urgent ? 0 : 1000) + dd + (c.meshedVersion < 0 ? 0 : 500);
        if (s < bestScore) { bestScore = s; best = { type: 'mesh', c }; }
      }
    }
    if (best && best.type === 'gen') best.c.state = 'loading';
    return best;
  }
  neighborsReady(c) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (!n || !n.blocks) return false;
    }
    return true;
  }
  applyMesh(c, m) {
    this.disposeMeshes(c);
    const mk = (g, mat) => {
      if (!g.idx.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
      geo.setAttribute('aLight', new THREE.BufferAttribute(g.light, 4, true));
      geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.cx * 16 + 8, 64, c.cz * 16 + 8), 68);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return mesh;
    };
    c.solid = mk(m.solid, this.materials.solid);
    c.trans = mk(m.trans, this.materials.trans);
    if (c.trans) c.trans.renderOrder = 1;
  }
  disposeMeshes(c) {
    for (const k of ['solid', 'trans']) if (c[k]) { this.group.remove(c[k]); c[k].geometry.dispose(); c[k] = null; }
  }

  async requestChunk(cx, cz) {
    const c = new Chunk(cx, cz);
    this.chunks.set(key(cx, cz), c);
    const k = key(cx, cz);
    if (this.store && this.savedKeys.has(k)) {
      c.state = 'loading';
      const data = await this.store.loadChunk(k);
      if (this.chunks.get(k) !== c) return;
      if (data) {
        c.blocks = data.blocks; c.biomes = data.biomes || new Uint8Array(256); c.heights = new Uint8Array(256);
        c.state = 'ready'; c.modified = false; c.version++;
        this.onChunkLoaded(c);
        this.pump();
        return;
      }
    }
    c.state = 'need-gen';
    this.pump();
  }
  onChunkLoaded(c) {
    // 相邻区块需要重新网格化（边界面）
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (n && n.blocks) n.version++;
    }
    if (this.game.onChunkLoaded) this.game.onChunkLoaded(c);
  }

  update(px, pz) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    const rd = this.renderDistance + 1;
    // 请求缺失区块（由近到远，螺旋）
    let requested = 0;
    for (let r = 0; r <= rd && requested < 8; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (!this.chunks.has(key(cx, cz))) { this.requestChunk(cx, cz); requested++; }
      }
    }
    // 卸载远处区块
    for (const c of this.chunks.values()) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > rd + 1) {
        if (c.modified && this.store) { this.store.saveChunk(key(c.cx, c.cz), c); this.savedKeys.add(key(c.cx, c.cz)); }
        this.disposeMeshes(c);
        this.chunks.delete(key(c.cx, c.cz));
        if (this.game.onChunkUnloaded) this.game.onChunkUnloaded(c);
      } else if (d > this.renderDistance && (c.solid || c.trans)) {
        // 超出渲染距离但保留数据
        if (c.solid) c.solid.visible = false; if (c.trans) c.trans.visible = false;
      } else {
        if (c.solid) c.solid.visible = true; if (c.trans) c.trans.visible = true;
      }
    }
    this.pump();
  }
  // 出生点附近区块是否已网格化
  readyAround(px, pz, r) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    let total = 0, ready = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      total++;
      const c = this.chunks.get(key(pcx + dx, pcz + dz));
      if (c && c.blocks && c.meshedVersion >= 0) ready++;
    }
    return ready / total;
  }
  modifiedChunks() { return [...this.chunks.values()].filter((c) => c.modified && c.blocks); }

  // ---------- 方块更新 ----------
  notifyNeighbors(x, y, z) {
    this.blockUpdate(x, y, z);
    this.blockUpdate(x + 1, y, z); this.blockUpdate(x - 1, y, z);
    this.blockUpdate(x, y + 1, z); this.blockUpdate(x, y - 1, z);
    this.blockUpdate(x, y, z + 1); this.blockUpdate(x, y, z - 1);
  }
  schedule(x, y, z, delay) {
    const k = x + ',' + y + ',' + z;
    const t = this.tick + delay;
    const cur = this.scheduled.get(k);
    if (cur === undefined || cur > t) this.scheduled.set(k, t);
  }
  blockUpdate(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id <= 0) return;
    const b = BLOCKS[id];
    if (b.liquid) { this.schedule(x, y, z, b.liquid === 'water' ? 5 : 30); return; }
    if (b.gravity) {
      const below = this.getBlock(x, y - 1, z);
      if (below === 0 || (below > 0 && (isLiquid(below) || BLOCKS[below].replaceable))) this.schedule(x, y, z, 2);
      return;
    }
    if (b.needsSupport && !this.hasSupport(x, y, z, b)) this.schedule(x, y, z, 1);
    // 水流动到旁边空气时
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = this.getBlock(x + dx, y + dy, z + dz);
      if (n > 0 && isLiquid(n)) this.schedule(x + dx, y + dy, z + dz, isWater(n) ? 5 : 30);
    }
  }
  hasSupport(x, y, z, b) {
    const below = this.getBlock(x, y - 1, z);
    if (below < 0) return true;
    switch (b.needsSupport) {
      case 'soil': return below === B.grass_block || below === B.dirt || below === B.snowy_grass_block;
      case 'sand': return below === B.sand || below === B.grass_block || below === B.dirt;
      case 'cactus': {
        if (!(below === B.sand || below === B.cactus)) return false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.getBlock(x + dx, y, z + dz); if (n > 0 && SOLID[n]) return false; }
        return true;
      }
      case 'below': return below > 0 && OPAQUE[below] === 1;
      case 'wall': {
        const d = [[0, 1], [-1, 0], [0, -1], [1, 0]][b.facing];
        const w = this.getBlock(x + d[0], y, z + d[1]);
        return w < 0 || (w > 0 && OPAQUE[w] === 1);
      }
    }
    return true;
  }
  processTicks(budget = 400) {
    this.tick++;
    if (!this.scheduled.size) return;
    const due = [];
    for (const [k, t] of this.scheduled) if (t <= this.tick) { due.push(k); if (due.length >= budget) break; }
    for (const k of due) {
      this.scheduled.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;
      this.scheduledTick(x, y, z);
    }
  }
  scheduledTick(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id <= 0) return;
    const b = BLOCKS[id];
    if (b.liquid) return this.liquidTick(x, y, z, id, b);
    if (b.gravity) {
      const below = this.getBlock(x, y - 1, z);
      if (below === 0 || (below > 0 && (isLiquid(below) || BLOCKS[below].replaceable))) {
        this.setBlock(x, y, z, 0);
        this.game.spawnFallingBlock(x, y, z, id);
      }
      return;
    }
    if (b.needsSupport && !this.hasSupport(x, y, z, b)) {
      this.setBlock(x, y, z, 0);
      this.game.dropBlockItems(x, y, z, id, null);
    }
  }
  liquidTick(x, y, z, id, b) {
    const type = b.liquid;
    const max = MAX_LEVEL[type];
    const isType = (n) => n > 0 && BLOCKS[n] && BLOCKS[n].liquid === type;
    const levelOf = (n) => (BLOCKS[n].level === 8 ? 0 : BLOCKS[n].level);
    // 岩浆与水相遇
    if (type === 'lava') {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = this.getBlock(x + dx, y + dy, z + dz);
        if (n > 0 && isWater(n)) {
          this.setBlock(x, y, z, b.level === 0 ? B.obsidian : B.cobblestone);
          this.game.playSoundAt && this.game.playSoundAt('fizz', x, y, z);
          return;
        }
      }
    }
    let level = b.level;
    if (level !== 0) {
      // 重新计算流动等级
      const above = this.getBlock(x, y + 1, z);
      let newLevel;
      if (isType(above)) newLevel = 8;
      else {
        let minL = 99, sources = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.getBlock(x + dx, y, z + dz);
          if (isType(n)) { const l = levelOf(n); if (BLOCKS[n].level === 0) sources++; if (l < minL) minL = l; }
        }
        newLevel = minL + 1;
        if (type === 'water' && sources >= 2) {
          const below = this.getBlock(x, y - 1, z);
          if (below > 0 && (SOLID[below] || (isType(below) && BLOCKS[below].level === 0))) newLevel = 0;
        }
        if (newLevel > max) newLevel = -1;
      }
      if (newLevel !== level) {
        if (newLevel < 0) { this.setBlock(x, y, z, 0); return; }
        this.setBlock(x, y, z, liquidId(type, newLevel));
        level = newLevel;
      }
    }
    // 向下流
    const below = this.getBlock(x, y - 1, z);
    if (y > 0 && below >= 0 && this.canFlowInto(below, type)) {
      if (type === 'water' && isLava(below)) { this.setBlock(x, y - 1, z, BLOCKS[below].level === 0 ? B.obsidian : B.stone); return; }
      if (below > 0 && !isLiquid(below)) this.game.dropBlockItems(x, y - 1, z, below, null);
      this.setBlock(x, y - 1, z, liquidId(type, 8));
      if (level !== 0) return;
    }
    if (below > 0 && isType(below) && level !== 0) return;
    // 水平扩散
    const spreadLevel = level === 8 ? 1 : level + 1;
    if (spreadLevel > max) return;
    // 选择最近下落方向（MC 风格），找不到则全方向
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = 99; const dist = [];
    for (const [dx, dz] of dirs) {
      const n = this.getBlock(x + dx, y, z + dz);
      if (n < 0 || !this.canFlowInto(n, type) || (isType(n) && levelOf(n) <= spreadLevel)) { dist.push(999); continue; }
      const d = this.dropDistance(x + dx, y, z + dz, type, 1, dx, dz);
      dist.push(d); if (d < best) best = d;
    }
    for (let i = 0; i < 4; i++) {
      if (dist[i] >= 999 || dist[i] !== best) continue;
      const [dx, dz] = dirs[i];
      const n = this.getBlock(x + dx, y, z + dz);
      if (type === 'water' && isLava(n)) { this.setBlock(x + dx, y, z + dz, BLOCKS[n].level === 0 ? B.obsidian : B.cobblestone); continue; }
      if (type === 'lava' && isWater(n)) { this.setBlock(x + dx, y, z + dz, B.stone); continue; }
      if (n > 0 && !isLiquid(n)) this.game.dropBlockItems(x + dx, y, z + dz, n, null);
      this.setBlock(x + dx, y, z + dz, liquidId(type, spreadLevel));
    }
  }
  canFlowInto(n, type) {
    if (n === 0) return true;
    if (n < 0) return false;
    const b = BLOCKS[n];
    if (b.liquid) return b.liquid !== type || b.level !== 0;
    if (b.solid) return false;
    return b.replaceable || b.shape === 'cross' || b.shape === 'torch' || b.shape === 'wall_torch';
  }
  dropDistance(x, y, z, type, depth, fx, fz) {
    const below = this.getBlock(x, y - 1, z);
    if (below >= 0 && this.canFlowInto(below, type)) return depth;
    if (depth >= 4) return 100;
    let best = 100;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (dx === -fx && dz === -fz) continue;
      const n = this.getBlock(x + dx, y, z + dz);
      if (n < 0 || !this.canFlowInto(n, type)) continue;
      best = Math.min(best, this.dropDistance(x + dx, y, z + dz, type, depth + 1, dx, dz));
    }
    return best;
  }

  // ---------- 随机刻 ----------
  randomTicks(px, pz) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    for (const c of this.chunks.values()) {
      if (!c.blocks || Math.abs(c.cx - pcx) > 5 || Math.abs(c.cz - pcz) > 5) continue;
      for (let s = 0; s < HEIGHT / 16; s++) for (let k = 0; k < 3; k++) {
        const lx = (Math.random() * 16) | 0, ly = s * 16 + ((Math.random() * 16) | 0), lz = (Math.random() * 16) | 0;
        const id = c.blocks[bidx(lx, ly, lz)];
        if (id === 0) continue;
        const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
        const b = BLOCKS[id];
        if (b.sapling) {
          if (Math.random() < 1 / 7) this.growTree(x, ly, z, b.sapling);
        } else if (id === B.grass_block) {
          const above = this.getBlock(x, ly + 1, z);
          if (above > 0 && OPAQUE[above]) this.setBlock(x, ly, z, B.dirt);
        } else if (id === B.dirt) {
          const above = this.getBlock(x, ly + 1, z);
          if (above === 0 || (above > 0 && !OPAQUE[above] && !isLiquid(above))) {
            const l = this.lightAt(x, ly + 1, z);
            if (l.sky >= 9) {
              for (let i = 0; i < 4; i++) {
                const dx = ((Math.random() * 3) | 0) - 1, dy = ((Math.random() * 5) | 0) - 3, dz = ((Math.random() * 3) | 0) - 1;
                if (this.getBlock(x + dx, ly + dy, z + dz) === B.grass_block) { this.setBlock(x, ly, z, B.grass_block, { update: false }); break; }
              }
            }
          }
        }
      }
    }
    // 树叶凋零检查
    const now = this.tick;
    this.leafChecks = this.leafChecks.filter((lc) => {
      if (lc.t > now) return true;
      const id = this.getBlock(lc.x, lc.y, lc.z);
      if (id > 0 && BLOCKS[id].key.endsWith('leaves') && !this.logNearby(lc.x, lc.y, lc.z)) {
        this.setBlock(lc.x, lc.y, lc.z, 0);
        this.game.dropBlockItems(lc.x, lc.y, lc.z, id, null);
      }
      return false;
    });
  }
  onLogRemoved(x, y, z) {
    for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const id = this.getBlock(x + dx, y + dy, z + dz);
      if (id > 0 && BLOCKS[id].key.endsWith('leaves')) this.leafChecks.push({ x: x + dx, y: y + dy, z: z + dz, t: this.tick + 20 + ((Math.random() * 300) | 0) });
    }
  }
  logNearby(x, y, z) {
    // 沿树叶 BFS 4 格寻找原木
    const seen = new Set([x + ',' + y + ',' + z]);
    let frontier = [[x, y, z]];
    for (let d = 0; d < 4; d++) {
      const next = [];
      for (const [a, b, c] of frontier) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = a + dx, ny = b + dy, nz = c + dz, k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue; seen.add(k);
        const id = this.getBlock(nx, ny, nz);
        if (id < 0) return true;
        if (id > 0 && BLOCKS[id].key.endsWith('_log')) return true;
        if (id > 0 && BLOCKS[id].key.endsWith('leaves')) next.push([nx, ny, nz]);
      }
      frontier = next;
    }
    return false;
  }
  growTree(x, y, z, type) {
    // 检查空间
    const h = type === 'spruce' ? 8 : 6;
    for (let i = 1; i < h; i++) { const id = this.getBlock(x, y + i, z); if (id !== 0 && !(id > 0 && BLOCKS[id].key.endsWith('leaves'))) return false; }
    this.setBlock(x, y, z, 0, { update: false });
    const r = Math.random;
    placeTree(type, x, y, z, () => r(), (px, py, pz, id, force) => {
      const cur = this.getBlock(px, py, pz);
      if (cur < 0) return;
      if (cur === 0 || (cur > 0 && BLOCKS[cur].replaceable && !isLiquid(cur)) || (force && BLOCKS[cur].key.endsWith('leaves'))) this.setBlock(px, py, pz, id, { update: false });
    });
    const below = this.getBlock(x, y - 1, z);
    if (below === B.grass_block) this.setBlock(x, y - 1, z, B.dirt, { update: false });
    return true;
  }
}
