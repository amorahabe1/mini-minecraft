// 实体物理：AABB 碰撞（按 MC 顺序 Y→X→Z 裁剪）、液体检测
import { BLOCKS, SOLID, isWater, isLava, HEIGHT, COLLIDE, SELECT } from './registry.js';

const EPS = 1e-7;
// 收集与给定区域相交的方块碰撞箱
export function collectBoxes(world, x0, y0, z0, x1, y1, z1, out) {
  out.length = 0;
  const ix0 = Math.floor(x0), iy0 = Math.floor(y0) - 1, iz0 = Math.floor(z0);
  const ix1 = Math.floor(x1), iy1 = Math.floor(y1), iz1 = Math.floor(z1);
  for (let y = iy0; y <= iy1; y++) for (let z = iz0; z <= iz1; z++) for (let x = ix0; x <= ix1; x++) {
    if (y >= HEIGHT) continue;
    const id = world.getBlock(x, y, z);
    if (id < 0) { out.push([x, y, z, x + 1, y + 1, z + 1]); continue; } // 未加载区块视为实心
    if (id === 0 || !SOLID[id]) continue;
    const b = BLOCKS[id];
    const cb = COLLIDE[id];
    if (cb) { for (const c of cb) out.push([x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]]); }
    else if (b.shape === 'cactus') out.push([x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 15 / 16, z + 15 / 16]);
    else out.push([x, y, z, x + 1, y + 1, z + 1]);
  }
  return out;
}
const boxes = [];

export function entityBox(e) {
  const hw = e.width / 2;
  return [e.pos.x - hw, e.pos.y, e.pos.z - hw, e.pos.x + hw, e.pos.y + e.height, e.pos.z + hw];
}
function clipY(b, o, dy) {
  if (o[3] <= b[0] + EPS || o[0] >= b[3] - EPS || o[5] <= b[2] + EPS || o[2] >= b[5] - EPS) return dy;
  if (dy > 0 && o[1] >= b[4] - EPS) { const d = o[1] - b[4]; if (d < dy) dy = d; }
  else if (dy < 0 && o[4] <= b[1] + EPS) { const d = o[4] - b[1]; if (d > dy) dy = d; }
  return dy;
}
function clipX(b, o, dx) {
  if (o[4] <= b[1] + EPS || o[1] >= b[4] - EPS || o[5] <= b[2] + EPS || o[2] >= b[5] - EPS) return dx;
  if (dx > 0 && o[0] >= b[3] - EPS) { const d = o[0] - b[3]; if (d < dx) dx = d; }
  else if (dx < 0 && o[3] <= b[0] + EPS) { const d = o[3] - b[0]; if (d > dx) dx = d; }
  return dx;
}
function clipZ(b, o, dz) {
  if (o[4] <= b[1] + EPS || o[1] >= b[4] - EPS || o[3] <= b[0] + EPS || o[0] >= b[3] - EPS) return dz;
  if (dz > 0 && o[2] >= b[5] - EPS) { const d = o[2] - b[5]; if (d < dz) dz = d; }
  else if (dz < 0 && o[5] <= b[2] + EPS) { const d = o[5] - b[2]; if (d > dz) dz = d; }
  return dz;
}
function anyCollision(world, bb) {
  collectBoxes(world, bb[0], bb[1], bb[2], bb[3] - EPS, bb[4] - EPS, bb[5] - EPS, boxes);
  for (const o of boxes) if (o[0] < bb[3] - EPS && o[3] > bb[0] + EPS && o[1] < bb[4] - EPS && o[4] > bb[1] + EPS && o[2] < bb[5] - EPS && o[5] > bb[2] + EPS) return true;
  return false;
}
export function boxCollides(world, bb) { return anyCollision(world, bb); }

// 移动实体，返回实际位移；设置 onGround / collidedH / collidedV
export function moveEntity(world, e, dx, dy, dz) {
  if (e.noClip) { e.pos.x += dx; e.pos.y += dy; e.pos.z += dz; return; }
  // 蜘蛛网：移动 × (0.25, 0.05, 0.25)，并清空速度（Java makeStuckInBlock）
  if (e.inWeb) { dx *= 0.25; dy *= 0.05; dz *= 0.25; e.vel.set(0, 0, 0); e.fallDistance = 0; }
  const ox = dx, oy = dy, oz = dz;
  let b = entityBox(e);
  // 潜行防掉落
  if (e.sneaking && e.onGround && !e.flying) {
    const step = 0.05;
    const off = (bx, bz) => [b[0] + bx, b[1] - 1, b[2] + bz, b[3] + bx, b[4] - 1 + 0.001, b[5] + bz];
    const empty = (bx, bz) => !anyCollision(world, [b[0] + bx, b[1] - 1.0, b[2] + bz, b[3] + bx, b[1] - 0.0001, b[5] + bz]);
    void off;
    while (dx !== 0 && empty(dx, 0)) { if (dx < step && dx >= -step) dx = 0; else if (dx > 0) dx -= step; else dx += step; }
    while (dz !== 0 && empty(0, dz)) { if (dz < step && dz >= -step) dz = 0; else if (dz > 0) dz -= step; else dz += step; }
    while (dx !== 0 && dz !== 0 && empty(dx, dz)) {
      if (dx < step && dx >= -step) dx = 0; else if (dx > 0) dx -= step; else dx += step;
      if (dz < step && dz >= -step) dz = 0; else if (dz > 0) dz -= step; else dz += step;
    }
  }
  const sdx = dx, sdz = dz, sdy = dy;
  const b0 = b.slice();
  collectBoxes(world, Math.min(b[0], b[0] + dx), Math.min(b[1], b[1] + dy), Math.min(b[2], b[2] + dz), Math.max(b[3], b[3] + dx), Math.max(b[4], b[4] + dy), Math.max(b[5], b[5] + dz), boxes);
  for (const o of boxes) dy = clipY(b, o, dy);
  b[1] += dy; b[4] += dy;
  for (const o of boxes) dx = clipX(b, o, dx);
  b[0] += dx; b[3] += dx;
  for (const o of boxes) dz = clipZ(b, o, dz);
  b[2] += dz; b[5] += dz;
  // 自动走上台阶/楼梯（Java maxUpStep = 0.6）
  const onGroundNow = sdy !== dy && sdy < 0;
  const step = e.stepHeight || 0;
  if (step > 0 && (onGroundNow || e.onGround) && (sdx !== dx || sdz !== dz)) {
    const s = b0.slice();
    collectBoxes(world, Math.min(s[0], s[0] + sdx), s[1], Math.min(s[2], s[2] + sdz), Math.max(s[3], s[3] + sdx), s[4] + step, Math.max(s[5], s[5] + sdz), boxes);
    let up = step;
    for (const o of boxes) up = clipY(s, o, up);
    s[1] += up; s[4] += up;
    let sx = sdx; for (const o of boxes) sx = clipX(s, o, sx); s[0] += sx; s[3] += sx;
    let sz = sdz; for (const o of boxes) sz = clipZ(s, o, sz); s[2] += sz; s[5] += sz;
    collectBoxes(world, s[0], s[1] - up - 0.01, s[2], s[3], s[4], s[5], boxes);
    let down = -up; for (const o of boxes) down = clipY(s, o, down); s[1] += down; s[4] += down;
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-9) {
      for (let i = 0; i < 6; i++) b[i] = s[i];
      dx = sx; dz = sz;
      e.stepped = true;
    }
  }
  e.pos.x = (b[0] + b[3]) / 2; e.pos.y = b[1]; e.pos.z = (b[2] + b[5]) / 2;
  e.collidedH = sdx !== dx || sdz !== dz;
  const stepped = !!e.stepped; e.stepped = false;
  e.collidedV = oy !== dy || stepped;
  e.onGround = (oy !== dy && oy < 0) || stepped;
  if (sdx !== dx) e.vel.x = 0;
  if (sdz !== dz) e.vel.z = 0;
  if (oy !== dy || (stepped && e.vel.y < 0)) e.vel.y = 0;
  // 摔落距离
  if (e.onGround) {
    if (e.fallDistance > 0 && e.onLanded) e.onLanded(e.fallDistance);
    e.fallDistance = 0;
  } else if (dy < 0) e.fallDistance -= dy;
  void ox; void oz;
}

// 检测与液体相交
export function liquidState(world, e) {
  const b = entityBox(e);
  let water = false, lava = false;
  const x0 = Math.floor(b[0] + 0.001), x1 = Math.floor(b[3] - 0.001), y0 = Math.floor(b[1] + 0.4), y1 = Math.floor(b[4] - 0.4), z0 = Math.floor(b[2] + 0.001), z1 = Math.floor(b[5] - 0.001);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.getBlock(x, y, z);
    if (id <= 0) continue;
    if (isWater(id)) water = true; else if (isLava(id)) lava = true;
  }
  return { water, lava };
}
export function liquidHeight(id) {
  const b = BLOCKS[id];
  if (!b || !b.liquid) return 0;
  if (b.level === 0 || b.level === 8) return 8 / 9;
  return b.liquid === 'water' ? (8 - b.level) / 9 : (8 - 2 * b.level) / 9;
}
export function isInLiquidAt(world, x, y, z, type) {
  const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  if (id <= 0) return false;
  const b = BLOCKS[id];
  if (!b.liquid || (type && b.liquid !== type)) return false;
  const above = world.getBlock(Math.floor(x), Math.floor(y) + 1, Math.floor(z));
  const full = above > 0 && BLOCKS[above].liquid === b.liquid;
  return y < Math.floor(y) + (full ? 1 : liquidHeight(id) + 0.1);
}
export function slipperiness(world, e) {
  const id = world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y - 0.5), Math.floor(e.pos.z));
  return id > 0 && BLOCKS[id].slippery ? BLOCKS[id].slippery : 0.6;
}

// 方块射线检测（DDA）：mode 'collide' 使用碰撞箱，'select' 使用选择框。返回 {x,y,z,id,t,n}
const FULL = [[0, 0, 0, 1, 1, 1]];
export function rayBoxHit(o, d, bx) {
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
export function blockShapes(id, mode) {
  if (id <= 0) return null;
  const b = BLOCKS[id];
  if (!b || b.liquid) return null;
  if (mode === 'collide') {
    if (!SOLID[id]) return null;
    if (COLLIDE[id]) return COLLIDE[id];
    if (b.shape === 'cactus') return [[1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16]];
    return FULL;
  }
  return SELECT[id] || FULL;
}
export function raycastBlocks(world, ox, oy, oz, dx, dy, dz, maxDist, mode = 'collide') {
  const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 512; i++) {
    const id = world.getBlock(x, y, z);
    const shapes = id < 0 ? (mode === 'collide' ? FULL : null) : blockShapes(id, mode);
    if (shapes) {
      let best = null;
      for (const c of shapes) {
        const h = rayBoxHit(o, d, [x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]]);
        if (h && h.t <= maxDist && (!best || h.t < best.t)) best = h;
      }
      if (best) return { x, y, z, id, t: best.t, n: best.n };
    }
    const t = Math.min(tmx, tmy, tmz);
    if (t > maxDist) break;
    if (tmx === t) { x += sx; tmx += tdx; } else if (tmy === t) { y += sy; tmy += tdy; } else { z += sz; tmz += tdz; }
  }
  return null;
}
// 两点之间是否没有方块遮挡（视线 / 爆炸暴露度）
export function lineClear(world, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
  if (L < 1e-3) return true;
  return !raycastBlocks(world, x0, y0, z0, dx, dy, dz, L - 1e-3, 'collide');
}
// 实体是否碰到蜘蛛网
export function touchesWeb(world, e) {
  const b = entityBox(e);
  for (let y = Math.floor(b[1]); y <= Math.floor(b[4] - 1e-4); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5] - 1e-4); z++) for (let x = Math.floor(b[0]); x <= Math.floor(b[3] - 1e-4); x++) {
    const id = world.getBlock(x, y, z);
    if (id > 0 && BLOCKS[id].web) return true;
  }
  return false;
}
