// 实体物理：AABB 碰撞（按 MC 顺序 Y→X→Z 裁剪）、液体检测
import { BLOCKS, SOLID, isWater, isLava, HEIGHT } from './registry.js';

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
    if (b.shape === 'cactus') out.push([x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 15 / 16, z + 15 / 16]);
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
  const sdx = dx, sdz = dz;
  collectBoxes(world, Math.min(b[0], b[0] + dx), Math.min(b[1], b[1] + dy), Math.min(b[2], b[2] + dz), Math.max(b[3], b[3] + dx), Math.max(b[4], b[4] + dy), Math.max(b[5], b[5] + dz), boxes);
  for (const o of boxes) dy = clipY(b, o, dy);
  b[1] += dy; b[4] += dy;
  for (const o of boxes) dx = clipX(b, o, dx);
  b[0] += dx; b[3] += dx;
  for (const o of boxes) dz = clipZ(b, o, dz);
  b[2] += dz; b[5] += dz;
  e.pos.x = (b[0] + b[3]) / 2; e.pos.y = b[1]; e.pos.z = (b[2] + b[5]) / 2;
  e.collidedH = sdx !== dx || sdz !== dz;
  e.collidedV = oy !== dy;
  e.onGround = oy !== dy && oy < 0;
  if (sdx !== dx) e.vel.x = 0;
  if (sdz !== dz) e.vel.z = 0;
  if (oy !== dy) e.vel.y = 0;
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
