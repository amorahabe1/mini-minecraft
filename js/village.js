// 村庄：按区域确定性生成布局（Worker 与主线程共用，只依赖种子与地形噪声，因此跨区块边界一致）
import { B, HEIGHT, SEA, doorId, SLAB_BASE, STAIRS_BASE, SS_MATS, BELL_IDS } from './registry.js';
import { BIOME } from './worldgen.js';
import { mulberry32 } from './noise.js';

export const VILLAGE_SPACING = 20; // 区块（Java 版为 34，此处更密一些便于找到）
export const VILLAGE_SEPARATION = 6;
const cache = new Map();

const ssIdx = (k) => SS_MATS.findIndex((m) => m.key === k);
const slab = (k, top) => SLAB_BASE + ssIdx(k) * 3 + (top ? 1 : 0);
const stairs = (k, f, upside) => STAIRS_BASE + ssIdx(k) * 8 + (upside ? 4 : 0) + f;
// 朝向索引：0 +z 1 -x 2 -z 3 +x；局部→世界旋转
const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
function rotXZ(x, z, r) { for (let i = 0; i < r; i++) { const nx = -z, nz = x; x = nx; z = nz; } return [x, z]; }
function rotF(f, r) { const [dx, dz] = rotXZ(DIRS[f][0], DIRS[f][1], r); return DIRS.findIndex(([a, b]) => a === dx && b === dz); }

// 区域内的村庄候选位置
export function villageAt(gen, rx, rz) {
  const k = gen.seed + ':' + rx + ',' + rz;
  if (cache.has(k)) return cache.get(k);
  const r = mulberry32((gen.seed * 31 + Math.imul(rx, 0x27d4eb2d) + Math.imul(rz, 0x165667b1) + 10387312) | 0);
  const span = VILLAGE_SPACING - VILLAGE_SEPARATION;
  const ccx = rx * VILLAGE_SPACING + Math.floor(r() * span), ccz = rz * VILLAGE_SPACING + Math.floor(r() * span);
  const x0 = ccx * 16 + 8, z0 = ccz * 16 + 8;
  const col = gen.column(x0, z0);
  let v = null;
  if ((col.biome === BIOME.PLAINS || col.biome === BIOME.DESERT) && col.h > SEA + 1 && col.h < 100) v = layout(gen, x0, z0, col, r);
  if (cache.size > 256) cache.clear();
  cache.set(k, v);
  return v;
}
// 与给定区块相交的村庄
export function villagesForChunk(gen, cx, cz) {
  const out = [];
  const rx0 = Math.floor((cx - 6) / VILLAGE_SPACING), rx1 = Math.floor((cx + 6) / VILLAGE_SPACING);
  const rz0 = Math.floor((cz - 6) / VILLAGE_SPACING), rz1 = Math.floor((cz + 6) / VILLAGE_SPACING);
  for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) {
    const v = villageAt(gen, rx, rz);
    if (!v) continue;
    const bx = cx * 16, bz = cz * 16;
    if (v.bb[0] > bx + 15 || v.bb[2] < bx || v.bb[1] > bz + 15 || v.bb[3] < bz) continue;
    out.push(v);
  }
  return out;
}
// 最近的村庄（/locate）
export function nearestVillage(gen, x, z, maxRegions = 6) {
  const rx0 = Math.floor(Math.floor(x / 16) / VILLAGE_SPACING), rz0 = Math.floor(Math.floor(z / 16) / VILLAGE_SPACING);
  let best = null, bd = Infinity;
  for (let r = 0; r <= maxRegions; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const v = villageAt(gen, rx0 + dx, rz0 + dz);
    if (!v) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function layout(gen, X, Z, col, r) {
  const desert = col.biome === BIOME.DESERT;
  const M = desert
    ? { log: B.sandstone, plank: B.sandstone, wall: B.sandstone, base: B.sandstone, floor: B.sandstone, stairs: 'sandstone', slab: 'sandstone', bed: 76 }
    : { log: B.oak_log, plank: B.oak_planks, wall: B.oak_planks, base: B.cobblestone, floor: B.oak_planks, stairs: 'oak', slab: 'oak', bed: 68 };
  const pieces = [];
  const occupied = [];
  const free = (x0, z0, x1, z1) => !occupied.some((o) => x0 <= o[2] && x1 >= o[0] && z0 <= o[3] && z1 >= o[1]);
  const v = { x: X, z: Z, y: col.h + 1, desert, pieces, beds: [], bell: null, houses: [], id: X + ',' + Z };
  // 广场：水井 + 钟
  const wy = col.h + 1;
  pieces.push({ type: 'well', x: X - 2, z: Z - 2, w: 4, d: 4, y: wy, bb: [X - 3, Z - 3, X + 2, Z + 2] });
  occupied.push([X - 3, Z - 3, X + 2, Z + 2]);
  const bellX = X + 4, bellZ = Z;
  const by = gen.column(bellX, bellZ).h + 1;
  pieces.push({ type: 'bell', x: bellX, z: bellZ, y: by, f: 1, bb: [bellX, bellZ, bellX, bellZ] });
  occupied.push([bellX - 1, bellZ - 1, bellX + 1, bellZ + 1]);
  v.bell = { x: bellX + 0.5, y: by, z: bellZ + 0.5 };
  // 道路 + 两侧建筑
  const types = ['house', 'house', 'big', 'farm', 'lamp', 'house', 'farm', 'big'];
  for (let dir = 0; dir < 4; dir++) {
    const [ddx, ddz] = [[1, 0], [0, 1], [-1, 0], [0, -1]][dir];
    const len = 18 + Math.floor(r() * 22);
    const road = { type: 'road', cells: [], bb: [Infinity, Infinity, -Infinity, -Infinity] };
    for (let i = 3; i <= len; i++) for (let w = -1; w <= 1; w++) {
      const x = X + ddx * i + (ddz ? w : 0), z = Z + ddz * i + (ddx ? w : 0);
      road.cells.push([x, z]);
      road.bb[0] = Math.min(road.bb[0], x); road.bb[1] = Math.min(road.bb[1], z); road.bb[2] = Math.max(road.bb[2], x); road.bb[3] = Math.max(road.bb[3], z);
    }
    pieces.push(road);
    // 侧向：左 / 右
    for (let i = 6; i + 4 <= len; i += 8 + Math.floor(r() * 3)) {
      for (const side of [-1, 1]) {
        if (r() < 0.2) continue;
        const type = types[Math.floor(r() * types.length)];
        const W = type === 'big' ? 7 : type === 'farm' ? 9 : type === 'lamp' ? 1 : 5;
        const D = type === 'big' ? 6 : type === 'farm' ? 7 : type === 'lamp' ? 1 : 5;
        // 建筑朝向：正面（局部 -z）朝向道路
        // 道路方向 (ddx,ddz)，侧向法线 n = side * (-ddz, ddx)
        const nx = side * -ddz, nz = side * ddx;
        // 选择旋转 r 使局部 -z 指向 -n（朝路）
        let rot = 0;
        for (let k = 0; k < 4; k++) { const [fx, fz] = rotXZ(0, -1, k); if (fx === -nx && fz === -nz) rot = k; }
        // 建筑门的位置：道路边缘外 1 格
        const doorX = X + ddx * i + nx * 3, doorZ = Z + ddz * i + nz * 3;
        const ox = Math.floor(W / 2);
        // 局部 (lx,lz) -> 世界：door 在局部 (ox, 0)
        const toW = (lx, lz) => { const [a, b] = rotXZ(lx - ox, lz, rot); return [doorX + a, doorZ + b]; };
        const c1 = toW(-1, -1), c2 = toW(W, D);
        const bb = [Math.min(c1[0], c2[0]), Math.min(c1[1], c2[1]), Math.max(c1[0], c2[0]), Math.max(c1[1], c2[1])];
        if (!free(...bb)) continue;
        const dc = gen.column(doorX, doorZ);
        if (dc.h < SEA || dc.biome === BIOME.OCEAN || dc.biome === BIOME.DEEP_OCEAN || dc.biome === BIOME.MOUNTAINS) continue;
        // 地面太陡则放弃
        const cc = gen.column(...toW(Math.floor(W / 2), Math.floor(D / 2)));
        if (Math.abs(cc.h - dc.h) > 4) continue;
        occupied.push(bb);
        const p = { type, W, D, rot, toW, y: dc.h + 1, bb, M };
        pieces.push(p);
        if (type === 'house' || type === 'big') {
          const beds = type === 'big' ? [[1, 3], [W - 2, 3]] : [[1, 2]];
          const [ix, iz] = toW(ox, 2);
          const [dx0, dz0] = toW(ox, 0), [fx0, fz0] = toW(ox, -2);
          for (const [bx, bz] of beds) { const [wx, wz] = toW(bx, bz + 1); v.beds.push({ x: wx + 0.5, y: p.y, z: wz + 0.5, door: { x: dx0 + 0.5, z: dz0 + 0.5 }, front: { x: fx0 + 0.5, z: fz0 + 0.5 }, inside: { x: ix + 0.5, z: iz + 0.5 } }); }
          v.houses.push({ x: ix + 0.5, y: p.y, z: iz + 0.5, door: toW(ox, 0) });
        }
      }
    }
  }
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pieces) { bb = [Math.min(bb[0], p.bb[0]), Math.min(bb[1], p.bb[1]), Math.max(bb[2], p.bb[2]), Math.max(bb[3], p.bb[3])]; }
  v.bb = bb; v.M = M;
  return v;
}

// 是否位于村庄建筑 / 道路范围（用于跳过树木）
export function inVillage(vs, x, z, pad = 2) {
  for (const v of vs) for (const p of v.pieces) {
    if (x >= p.bb[0] - pad && x <= p.bb[2] + pad && z >= p.bb[1] - pad && z <= p.bb[3] + pad) {
      if (p.type !== 'road') return true;
      if (p.cells.some(([a, b]) => Math.abs(a - x) <= pad && Math.abs(b - z) <= pad)) return true;
    }
  }
  return false;
}

// 把村庄写入区块。get/set 使用世界坐标，set 只写入本区块内
export function buildVillages(vs, bx, bz, blocks, idx, gen, rnd) {
  const inside = (x, z) => x >= bx && x < bx + 16 && z >= bz && z < bz + 16;
  const get = (x, y, z) => (inside(x, z) && y >= 0 && y < HEIGHT ? blocks[idx(x - bx, y, z - bz)] : -1);
  const set = (x, y, z, id) => { if (inside(x, z) && y >= 0 && y < HEIGHT) blocks[idx(x - bx, y, z - bz)] = id; };
  const soft = (id) => id === 0 || id === B.water || id === B.short_grass || id === B.dandelion || id === B.poppy || id === B.dead_bush || (id >= 10 && id <= 14 && (id & 1) === 0) || id === B.lava;
  // 地基：从 y-1 向下填充直到实心；向上清空
  const ground = (x, z, y, top, fill) => {
    if (!inside(x, z)) return;
    for (let yy = y - 1, n = 0; yy > 0 && n < 12; yy--, n++) { const c = get(x, yy, z); if (!soft(c) && n > 0) break; set(x, yy, z, n === 0 ? fill : B.cobblestone); }
    for (let yy = y; yy <= top; yy++) set(x, yy, z, 0);
  };
  for (const v of vs) {
    for (const p of v.pieces) {
      if (p.bb[0] > bx + 15 || p.bb[2] < bx || p.bb[1] > bz + 15 || p.bb[3] < bz) continue;
      if (p.type === 'road') {
        for (const [x, z] of p.cells) {
          if (!inside(x, z)) continue;
          const h = gen.column(x, z).h;
          if (h < SEA) { set(x, SEA, z, B.oak_planks); for (let yy = SEA + 1; yy < SEA + 4; yy++) set(x, yy, z, 0); continue; }
          set(x, h, z, B.dirt_path);
          if (get(x, h - 1, z) === 0) set(x, h - 1, z, B.dirt);
          for (let yy = h + 1; yy < h + 4; yy++) { const c = get(x, yy, z); if (soft(c) || c === B.oak_log) set(x, yy, z, 0); }
        }
      } else if (p.type === 'well') {
        const y = p.y;
        for (let dz = -1; dz <= p.d; dz++) for (let dx = -1; dx <= p.w; dx++) {
          const x = p.x + dx, z = p.z + dz;
          const edge = dx === -1 || dz === -1 || dx === p.w || dz === p.d;
          ground(x, z, y, y + 6, edge ? B.dirt_path : B.cobblestone);
          if (edge) continue;
          const ring = dx === 0 || dz === 0 || dx === p.w - 1 || dz === p.d - 1;
          if (!ring) { for (let yy = y - 4; yy <= y; yy++) set(x, yy, z, yy === y - 4 ? B.cobblestone : B.water); set(x, y - 1, z, B.water); }
          else {
            set(x, y, z, B.cobblestone);
            const corner = (dx === 0 || dx === p.w - 1) && (dz === 0 || dz === p.d - 1);
            if (corner) { set(x, y + 1, z, B.oak_log); set(x, y + 2, z, B.oak_log); }
          }
          set(x, y + 3, z, slab('cobblestone'));
        }
        // 井壁下方用圆石包住水
        for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) {
          const ring = dx === 0 || dz === 0 || dx === p.w - 1 || dz === p.d - 1;
          if (ring) for (let yy = y - 4; yy < y; yy++) set(p.x + dx, yy, p.z + dz, B.cobblestone);
        }
      } else if (p.type === 'bell') {
        ground(p.x, p.z, p.y, p.y + 3, B.cobblestone);
        set(p.x, p.y, p.z, BELL_IDS[p.f]);
      } else build(p, set, get, ground, rnd);
    }
  }
}

function build(p, set, get, ground, rnd) {
  const { W, D, rot, toW, y, M, type } = p;
  const at = (lx, ly, lz, id) => { const [x, z] = toW(lx, lz); set(x, y + ly, z, id); };
  const f = (lf) => rotF(lf, rot);
  if (type === 'lamp') {
    const [x, z] = toW(0, 0);
    ground(x, z, y, y + 4, B.cobblestone);
    at(0, 0, 0, B.cobblestone); at(0, 1, 0, M.log); at(0, 2, 0, M.log); at(0, 3, 0, B.torch);
    return;
  }
  // 地基与清空
  for (let lz = -1; lz <= D; lz++) for (let lx = -1; lx <= W; lx++) {
    const [x, z] = toW(lx, lz);
    const outside = lx < 0 || lz < 0 || lx >= W || lz >= D;
    ground(x, z, y, y + 8, outside ? (type === 'farm' ? B.grass_block : B.dirt_path) : (type === 'farm' ? B.dirt : M.base));
  }
  if (type === 'farm') {
    for (let lz = 0; lz < D; lz++) for (let lx = 0; lx < W; lx++) {
      const border = lx === 0 || lz === 0 || lx === W - 1 || lz === D - 1;
      if (border) { at(lx, -1, lz, B.oak_log); continue; }
      if (lx === Math.floor(W / 2)) { at(lx, -1, lz, B.water); at(lx, -2, lz, B.dirt); continue; }
      at(lx, -1, lz, B.farmland);
      const [wx, wz] = toW(lx, lz);
      const age = Math.floor(rnd(wx, wz) * 8);
      at(lx, 0, lz, B.wheat_0 + age);
    }
    return;
  }
  const H = 3; // 墙高
  const ox = Math.floor(W / 2);
  for (let lz = 0; lz < D; lz++) for (let lx = 0; lx < W; lx++) {
    const wall = lx === 0 || lz === 0 || lx === W - 1 || lz === D - 1;
    const corner = (lx === 0 || lx === W - 1) && (lz === 0 || lz === D - 1);
    at(lx, -1, lz, wall ? M.base : M.floor);
    if (!wall) continue;
    for (let ly = 0; ly < H; ly++) {
      let id = corner ? M.log : (type === 'big' && ly === 0 ? M.base : M.wall);
      // 窗户
      const midSide = (lx === 0 || lx === W - 1) && lz === Math.floor(D / 2);
      const midBack = lz === D - 1 && (lx === ox || (type === 'big' && (lx === 2 || lx === W - 3)));
      if (ly === 1 && !corner && (midSide || midBack)) id = B.glass;
      at(lx, ly, lz, id);
    }
  }
  // 门（朝向：进门方向 = 局部 +z）
  const df = f(0);
  at(ox, 0, 0, doorId(0, 0, 0, df)); at(ox, 1, 0, doorId(1, 0, 0, df));
  // 屋顶：沿 x 方向的双坡屋顶（楼梯 + 台阶）
  const rows = Math.floor(D / 2) + 1;
  for (let k = 0; k < rows; k++) {
    const zf = k - 1, zb = D - k;
    for (let lx = -1; lx <= W; lx++) {
      if (zf < zb) { at(lx, H + k, zf, stairs(M.stairs, f(0), false)); at(lx, H + k, zb, stairs(M.stairs, f(2), false)); }
      if (lx >= 0 && lx < W) for (let lz = zf + 1; lz < zb; lz++) at(lx, H + k, lz, (lz === zf + 1 || lz === zb - 1) && k > 0 ? M.plank : (k === 0 ? M.plank : 0));
    }
    if (zb - zf <= 2) break;
  }
  // 山墙封口
  for (let k = 0; k < rows; k++) for (const lx of [0, W - 1]) for (let lz = k; lz <= D - 1 - k; lz++) at(lx, H + k, lz, M.plank);
  // 屋脊
  const top = H + rows - 1;
  if (D % 2 === 1) for (let lx = -1; lx <= W; lx++) at(lx, top + 1, Math.floor(D / 2), slab(M.slab));
  // 室内：床 + 工作台 + 火把
  const beds = type === 'big' ? [1, W - 2] : [1];
  for (const bxl of beds) {
    const bf = f(0); // 床头朝局部 +z
    const base = M.bed + bf * 2;
    const bz0 = type === 'big' ? 3 : 2;
    at(bxl, 0, bz0, base); at(bxl, 0, bz0 + 1, base + 1);
  }
  if (type === 'big') at(ox, 0, D - 2, B.chest + f(2)); else at(W - 2, 0, D - 2, B.crafting_table);
  // 火把贴在背墙上（墙在局部 +z 方向）
  at(ox, 2, D - 2, 112 + f(0));
}
