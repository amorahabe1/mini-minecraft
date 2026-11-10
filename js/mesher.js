// 区块网格化 + 光照计算（在 Worker 中运行）
import { CHUNK, HEIGHT, OPAQUE, LIGHT_OPACITY, LIGHT_EMIT, SHAPE, RENDER, FACE_TILES, SHAPES, BLOCKS } from './registry.js';
import { hash3 } from './noise.js';

const RW = 48; // 3x3 区块区域宽度
const RSIZE = RW * RW * HEIGHT;
const rb = new Uint8Array(RSIZE);
const sky = new Uint8Array(RSIZE);
const blk = new Uint8Array(RSIZE);
const QSIZE = 1 << 20, QMASK = QSIZE - 1;
const queue = new Int32Array(QSIZE);
const ri = (x, y, z) => (y * RW + z) * RW + x;

// 液体查询表
const LIQ_TYPE = new Uint8Array(256); // 0 无 1 水 2 岩浆
const LIQ_H = new Float32Array(256);
for (let id = 0; id < 256; id++) {
  const b = BLOCKS[id];
  if (!b || !b.liquid) continue;
  LIQ_TYPE[id] = b.liquid === 'water' ? 1 : 2;
  const L = b.level;
  if (L === 0 || L === 8) LIQ_H[id] = 8 / 9;
  else LIQ_H[id] = b.liquid === 'water' ? (8 - L) / 9 : (8 - 2 * L) / 9;
}

// 六个面：轴、方向
const FACES = [];
for (const [axis, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
  const n = [0, 0, 0]; n[axis] = s;
  const b = (axis + 1) % 3, c = (axis + 2) % 3;
  let corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // 检查绕序
  const pos = corners.map(([cb, cc]) => { const p = [0, 0, 0]; p[axis] = s > 0 ? 1 : 0; p[b] = cb; p[c] = cc; return p; });
  const e1 = pos[1].map((v, i) => v - pos[0][i]), e2 = pos[2].map((v, i) => v - pos[0][i]);
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (cr[axis] * s < 0) corners = [corners[0], corners[3], corners[2], corners[1]];
  const verts = corners.map(([cb, cc]) => {
    const p = [0, 0, 0]; p[axis] = s > 0 ? 1 : 0; p[b] = cb; p[c] = cc;
    const d1 = [0, 0, 0]; d1[b] = cb ? 1 : -1;
    const d2 = [0, 0, 0]; d2[c] = cc ? 1 : -1;
    // UV
    let u, v;
    if (axis === 0) { u = s > 0 ? 1 - p[2] : p[2]; v = p[1]; }
    else if (axis === 2) { u = s > 0 ? p[0] : 1 - p[0]; v = p[1]; }
    else { u = p[0]; v = s > 0 ? 1 - p[2] : p[2]; }
    return { p, d1, d2, u, v };
  });
  const shade = axis === 1 ? (s > 0 ? 1.0 : 0.5) : axis === 2 ? 0.8 : 0.6;
  FACES.push({ axis, s, n, verts, shade });
}
const AO_CURVE = [0.45, 0.62, 0.8, 1.0];

class Buf {
  constructor() { this.pos = []; this.uv = []; this.light = []; this.idx = []; this.n = 0; }
  quad(ps, uvs, lights, flip) {
    const base = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(ps[i * 3], ps[i * 3 + 1], ps[i * 3 + 2]);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      this.light.push(lights[i * 4], lights[i * 4 + 1], lights[i * 4 + 2], lights[i * 4 + 3]);
    }
    if (flip) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.n += 4;
  }
  build() {
    const r = {
      pos: new Float32Array(this.pos), uv: new Float32Array(this.uv), light: new Uint8Array(this.light),
      idx: this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
    return r;
  }
}

function computeLight(topY) {
  sky.fill(0); blk.fill(0);
  // 天空光：自上而下
  for (let z = 0; z < RW; z++) for (let x = 0; x < RW; x++) {
    let l = 15;
    for (let y = topY; y >= 0; y--) {
      const i = ri(x, y, z);
      const op = LIGHT_OPACITY[rb[i]];
      if (op >= 15) l = 0; else if (op > 0) l = Math.max(0, l - op);
      sky[i] = l;
    }
  }
  let head = 0, tail = 0;
  for (let y = 0; y <= topY; y++) for (let z = 0; z < RW; z++) for (let x = 0; x < RW; x++) {
    const i = ri(x, y, z);
    const l = sky[i];
    if (l <= 1) continue;
    // 仅当有更暗的可传播邻居时入队
    if ((x > 0 && sky[i - 1] < l - 1 && LIGHT_OPACITY[rb[i - 1]] < 15) || (x < RW - 1 && sky[i + 1] < l - 1 && LIGHT_OPACITY[rb[i + 1]] < 15) ||
        (z > 0 && sky[i - RW] < l - 1 && LIGHT_OPACITY[rb[i - RW]] < 15) || (z < RW - 1 && sky[i + RW] < l - 1 && LIGHT_OPACITY[rb[i + RW]] < 15) ||
        (y > 0 && sky[i - RW * RW] < l - 1 && LIGHT_OPACITY[rb[i - RW * RW]] < 15)) {
      queue[tail++ & QMASK] = i;
    }
  }
  propagate(sky, head, tail, topY);
  head = 0; tail = 0;
  for (let y = 0; y <= topY; y++) for (let z = 0; z < RW; z++) for (let x = 0; x < RW; x++) {
    const i = ri(x, y, z);
    const e = LIGHT_EMIT[rb[i]];
    if (e > 0) { blk[i] = e; queue[tail++ & QMASK] = i; }
  }
  propagate(blk, head, tail, topY);
}
function propagate(arr, head, tail, topY) {
  const L2 = RW * RW;
  while (head !== tail) {
    const i = queue[head++ & QMASK];
    const l = arr[i];
    if (l <= 1) continue;
    const x = i % RW, z = ((i / RW) | 0) % RW, y = (i / L2) | 0;
    for (let k = 0; k < 6; k++) {
      let n;
      if (k === 0) { if (x === 0) continue; n = i - 1; }
      else if (k === 1) { if (x === RW - 1) continue; n = i + 1; }
      else if (k === 2) { if (z === 0) continue; n = i - RW; }
      else if (k === 3) { if (z === RW - 1) continue; n = i + RW; }
      else if (k === 4) { if (y === 0) continue; n = i - L2; }
      else { if (y >= topY) continue; n = i + L2; }
      const op = LIGHT_OPACITY[rb[n]];
      if (op >= 15) continue;
      const nl = l - (op > 1 ? op : 1);
      if (nl > arr[n]) { arr[n] = nl; queue[tail++ & QMASK] = n; }
    }
  }
}

// chunks: 长度 9 的数组，索引 (dz+1)*3+(dx+1)，中心为 4
export function meshChunk(chunks, cx, cz) {
  // 1. 复制到区域缓冲
  let topY = 0;
  for (let cz2 = 0; cz2 < 3; cz2++) for (let cx2 = 0; cx2 < 3; cx2++) {
    const src = chunks[cz2 * 3 + cx2];
    const ox = cx2 * 16, oz = cz2 * 16;
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < 16; z++) {
      const so = (y * 16 + z) * 16;
      const d = ri(ox, y, oz + z);
      if (src) {
        for (let x = 0; x < 16; x++) { const v = src[so + x]; rb[d + x] = v; if (v && y > topY) topY = y; }
      } else {
        for (let x = 0; x < 16; x++) rb[d + x] = y < 64 ? 1 : 0;
      }
    }
  }
  topY = Math.min(HEIGHT - 1, topY + 1);
  computeLight(topY);

  const solid = new Buf(), trans = new Buf();
  const get = (x, y, z) => (y < 0 ? 1 : y >= HEIGHT ? 0 : y > topY ? 0 : rb[ri(x, y, z)]);
  const skyAt = (x, y, z) => (y > topY ? 15 : y < 0 ? 0 : sky[ri(x, y, z)]);
  const blkAt = (x, y, z) => (y > topY || y < 0 ? 0 : blk[ri(x, y, z)]);
  const ps = new Float32Array(12), uvs = new Float32Array(8), ls = new Uint8Array(16);
  const tileUV = (t, u, v, k) => { uvs[k * 2] = u; uvs[k * 2 + 1] = v; };

  const wx0 = cx * 16, wz0 = cz * 16;
  const maxY = Math.min(topY, HEIGHT - 1);
  for (let y = 0; y <= maxY; y++) for (let z = 16; z < 32; z++) for (let x = 16; x < 32; x++) {
    const id = rb[ri(x, y, z)];
    if (id === 0) continue;
    const shape = SHAPE[id];
    const lx = x - 16 + wx0, lz = z - 16 + wz0; // 世界坐标
    if (shape === SHAPES.CUBE) {
      const buf = RENDER[id] === 2 ? trans : solid;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        if (ny < 0) continue;
        const nb = get(nx, ny, nz);
        if (OPAQUE[nb]) continue;
        if (nb === id && RENDER[id] !== 0) continue;
        if (RENDER[id] === 2 && RENDER[nb] === 2) continue;
        const t = FACE_TILES[id * 6 + f];
        let aoSum02 = 0, aoSum13 = 0;
        for (let k = 0; k < 4; k++) {
          const V = F.verts[k];
          ps[k * 3] = lx + V.p[0]; ps[k * 3 + 1] = y + V.p[1]; ps[k * 3 + 2] = lz + V.p[2];
          tileUV(t, V.u, V.v, k);
          const s1x = nx + V.d1[0], s1y = ny + V.d1[1], s1z = nz + V.d1[2];
          const s2x = nx + V.d2[0], s2y = ny + V.d2[1], s2z = nz + V.d2[2];
          const crx = nx + V.d1[0] + V.d2[0], cry = ny + V.d1[1] + V.d2[1], crz = nz + V.d1[2] + V.d2[2];
          const o1 = OPAQUE[get(s1x, s1y, s1z)], o2 = OPAQUE[get(s2x, s2y, s2z)], oc = OPAQUE[get(crx, cry, crz)];
          const ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
          // 平滑光照
          let sS = skyAt(nx, ny, nz), sB = blkAt(nx, ny, nz), cnt = 1;
          if (!o1) { sS += skyAt(s1x, s1y, s1z); sB += blkAt(s1x, s1y, s1z); cnt++; }
          if (!o2) { sS += skyAt(s2x, s2y, s2z); sB += blkAt(s2x, s2y, s2z); cnt++; }
          if (!oc && !(o1 && o2)) { sS += skyAt(crx, cry, crz); sB += blkAt(crx, cry, crz); cnt++; }
          ls[k * 4] = Math.round((sS / cnt) * 17); ls[k * 4 + 1] = Math.round((sB / cnt) * 17);
          ls[k * 4 + 2] = Math.round(AO_CURVE[ao] * F.shade * 255); ls[k * 4 + 3] = t;
          if (k === 0 || k === 2) aoSum02 += ao + (sS + sB) / cnt * 0.01; else aoSum13 += ao + (sS + sB) / cnt * 0.01;
        }
        buf.quad(ps, uvs, ls, aoSum02 < aoSum13);
      }
    } else if (shape === SHAPES.CROSS) {
      const t = FACE_TILES[id * 6];
      const sl = skyAt(x, y, z) * 17, bl = blkAt(x, y, z) * 17;
      const jx = (hash3(lx, 0, lz, 99) - 0.5) * 0.3, jz = (hash3(lx, 1, lz, 99) - 0.5) * 0.3;
      const a = 0.15, b = 0.85;
      const planes = [[a, a, b, b], [a, b, b, a]];
      for (const [x0, z0, x1, z1] of planes) {
        const pts = [[x0, 0, z0], [x1, 0, z1], [x1, 1, z1], [x0, 1, z0]];
        const uu = [0, 1, 1, 0], vv = [0, 0, 1, 1];
        for (let side = 0; side < 2; side++) {
          for (let k = 0; k < 4; k++) {
            const kk = side ? 3 - k : k;
            const P = pts[kk];
            ps[k * 3] = lx + P[0] + jx; ps[k * 3 + 1] = y + P[1]; ps[k * 3 + 2] = lz + P[2] + jz;
            tileUV(t, uu[kk], vv[kk], k);
            ls[k * 4] = sl; ls[k * 4 + 1] = bl; ls[k * 4 + 2] = 255; ls[k * 4 + 3] = t;
          }
          solid.quad(ps, uvs, ls, false);
        }
      }
    } else if (shape === SHAPES.TORCH || shape === SHAPES.WALL_TORCH) {
      const t = FACE_TILES[id * 6];
      const sl = skyAt(x, y, z) * 17, bl = blkAt(x, y, z) * 17;
      let dX = 0, dZ = 0, oy = 0;
      if (shape === SHAPES.WALL_TORCH) {
        const d = [[0, 1], [-1, 0], [0, -1], [1, 0]][BLOCKS[id].facing]; // 墙所在方向
        dX = d[0]; dZ = d[1]; oy = 0.2;
      }
      const tr = (px, py, pz, k) => {
        const off = 0.32 - 0.42 * py;
        ps[k * 3] = lx + px + dX * off;
        ps[k * 3 + 1] = y + py + oy;
        ps[k * 3 + 2] = lz + pz + dZ * off;
      };
      const sideQuads = [
        [[7 / 16, 0, 0], [7 / 16, 0, 1], [7 / 16, 1, 1], [7 / 16, 1, 0], 0.6],
        [[9 / 16, 0, 1], [9 / 16, 0, 0], [9 / 16, 1, 0], [9 / 16, 1, 1], 0.6],
        [[1, 0, 7 / 16], [0, 0, 7 / 16], [0, 1, 7 / 16], [1, 1, 7 / 16], 0.8],
        [[0, 0, 9 / 16], [1, 0, 9 / 16], [1, 1, 9 / 16], [0, 1, 9 / 16], 0.8],
      ];
      const uu = [0, 1, 1, 0], vv = [0, 0, 1, 1];
      for (const q of sideQuads) {
        for (let k = 0; k < 4; k++) {
          const P = q[k];
          tr(P[0], P[1], P[2], k);
          tileUV(t, uu[k], vv[k], k);
          ls[k * 4] = sl; ls[k * 4 + 1] = bl; ls[k * 4 + 2] = Math.round(q[4] * 255); ls[k * 4 + 3] = t;
        }
        solid.quad(ps, uvs, ls, false);
      }
      // 顶面
      const top = [[7 / 16, 10 / 16, 9 / 16], [9 / 16, 10 / 16, 9 / 16], [9 / 16, 10 / 16, 7 / 16], [7 / 16, 10 / 16, 7 / 16]];
      const tu = [7 / 16, 9 / 16, 9 / 16, 7 / 16], tv = [6 / 16, 6 / 16, 8 / 16, 8 / 16];
      for (let k = 0; k < 4; k++) {
        const P = top[k];
        tr(P[0], P[1], P[2], k);
        tileUV(t, tu[k], 1 - tv[k], k);
        ls[k * 4] = sl; ls[k * 4 + 1] = bl; ls[k * 4 + 2] = 255; ls[k * 4 + 3] = t;
      }
      solid.quad(ps, uvs, ls, false);
    } else if (shape === SHAPES.CACTUS) {
      const inset = 1 / 16;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        const nb = get(nx, ny, nz);
        if (F.axis === 1 && (nb === id || OPAQUE[nb])) continue;
        const t = FACE_TILES[id * 6 + f];
        const sl = skyAt(F.axis === 1 ? nx : x, F.axis === 1 ? ny : y, F.axis === 1 ? nz : z);
        const bl = blkAt(F.axis === 1 ? nx : x, F.axis === 1 ? ny : y, F.axis === 1 ? nz : z);
        for (let k = 0; k < 4; k++) {
          const V = F.verts[k];
          const p = [...V.p];
          if (F.axis !== 1) p[F.axis] = F.s > 0 ? 1 - inset : inset;
          ps[k * 3] = lx + p[0]; ps[k * 3 + 1] = y + p[1]; ps[k * 3 + 2] = lz + p[2];
          tileUV(t, V.u, V.v, k);
          ls[k * 4] = Math.max(sl, skyAt(x, y, z)) * 17; ls[k * 4 + 1] = Math.max(bl, blkAt(x, y, z)) * 17; ls[k * 4 + 2] = Math.round(F.shade * 255); ls[k * 4 + 3] = t;
        }
        solid.quad(ps, uvs, ls, false);
      }
    } else if (shape === SHAPES.LIQUID) {
      const lt = LIQ_TYPE[id];
      const buf = lt === 1 ? trans : solid;
      const t = FACE_TILES[id * 6];
      const aboveSame = LIQ_TYPE[get(x, y + 1, z)] === lt;
      // 角高度
      const cornerH = (ccx, ccz) => {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
          const qx = x + ccx + dx, qz = z + ccz + dz;
          if (LIQ_TYPE[get(qx, y + 1, qz)] === lt) return 1;
          const q = get(qx, y, qz);
          if (LIQ_TYPE[q] === lt) { const hh = LIQ_H[q]; if (BLOCKS[q].level === 0) { sum += hh * 10; n += 10; } else { sum += hh; n++; } }
          else if (!SOLIDLIKE(q)) { n++; }
        }
        return n ? sum / n : LIQ_H[id];
      };
      const h00 = aboveSame ? 1 : cornerH(0, 0), h10 = aboveSame ? 1 : cornerH(1, 0), h11 = aboveSame ? 1 : cornerH(1, 1), h01 = aboveSame ? 1 : cornerH(0, 1);
      const hAt = (px, pz) => (px ? (pz ? h11 : h10) : (pz ? h01 : h00));
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        if (ny < 0) continue;
        const nb = get(nx, ny, nz);
        if (LIQ_TYPE[nb] === lt) continue;
        if (OPAQUE[nb] && !(f === 2 && !aboveSame)) continue;
        if (f === 2 && aboveSame) continue;
        if (f === 2 && OPAQUE[nb]) continue;
        const sl = Math.max(skyAt(nx, ny, nz), skyAt(x, y, z)) * 17, bl = Math.max(blkAt(nx, ny, nz), blkAt(x, y, z)) * 17;
        for (let k = 0; k < 4; k++) {
          const V = F.verts[k];
          let py = V.p[1];
          if (py === 1) py = hAt(V.p[0], V.p[2]);
          ps[k * 3] = lx + V.p[0]; ps[k * 3 + 1] = y + py - (f === 2 ? 0.001 : 0); ps[k * 3 + 2] = lz + V.p[2];
          tileUV(t, V.u, F.axis === 1 ? V.v : py, k);
          ls[k * 4] = sl; ls[k * 4 + 1] = bl; ls[k * 4 + 2] = Math.round(F.shade * 255); ls[k * 4 + 3] = t;
        }
        buf.quad(ps, uvs, ls, false);
      }
    }
  }

  // 中心区块光照（主线程用于实体亮度、刷怪等）
  const light = new Uint8Array(16 * 16 * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const s = skyAt(x + 16, y, z + 16), b = blkAt(x + 16, y, z + 16);
    light[(y * 16 + z) * 16 + x] = (s << 4) | b;
  }
  return { solid: solid.build(), trans: trans.build(), light };
}
function SOLIDLIKE(id) { return OPAQUE[id] === 1; }
