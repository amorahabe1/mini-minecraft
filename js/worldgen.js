// 程序化地形生成：生物群系、洞穴、矿石、树木、植物
import { Simplex, mulberry32, hash3 } from './noise.js';
import { B, CHUNK, HEIGHT, SEA } from './registry.js';

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, SNOWY: 5, MOUNTAINS: 6, DEEP_OCEAN: 7, BIRCH_FOREST: 8 };
export const BIOME_NAMES = ['海洋', '沙滩', '平原', '森林', '沙漠', '积雪的针叶林', '山地', '深海', '桦木森林'];

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const idx = (x, y, z) => (y * CHUNK + z) * CHUNK + x;

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.nCont = new Simplex(seed);
    this.nHill = new Simplex(seed + 1);
    this.nDetail = new Simplex(seed + 2);
    this.nMount = new Simplex(seed + 3);
    this.nTemp = new Simplex(seed + 4);
    this.nHum = new Simplex(seed + 5);
    this.nCave1 = new Simplex(seed + 6);
    this.nCave2 = new Simplex(seed + 7);
    this.nCave3 = new Simplex(seed + 8);
    this.nSurf = new Simplex(seed + 9);
  }

  column(x, z) {
    const c = this.nCont.fbm2(x / 900, z / 900, 4) * 1.8 + 0.2;
    const hills = this.nHill.fbm2(x / 140, z / 140, 4);
    const detail = this.nDetail.fbm2(x / 36, z / 36, 3);
    const ridge = 1 - Math.abs(this.nMount.fbm2(x / 320, z / 320, 4) * 1.6);
    const mount = smoothstep(0.84, 0.99, ridge) * smoothstep(-0.02, 0.3, c);
    let h;
    if (c < -0.15) h = SEA + 2 + (c + 0.15) * 70;
    else h = SEA + 2 + (c + 0.15) * 22 + hills * 9 * smoothstep(-0.15, 0.1, c);
    h += detail * 2.5 + mount * 58 * (0.7 + 0.3 * hills);
    h = Math.max(4, Math.min(HEIGHT - 6, Math.floor(h)));
    const temp = this.nTemp.fbm2(x / 1100 + 300, z / 1100, 3) * 1.6;
    const hum = this.nHum.fbm2(x / 800 - 700, z / 800 + 200, 3) * 1.6;
    let biome;
    if (h < SEA - 14) biome = BIOME.DEEP_OCEAN;
    else if (h < SEA) biome = BIOME.OCEAN;
    else if (h <= SEA + 2 && c < -0.05 && mount < 0.1) biome = BIOME.BEACH;
    else if (mount > 0.3) biome = BIOME.MOUNTAINS;
    else if (temp < -0.3) biome = BIOME.SNOWY;
    else if (temp > 0.28 && hum < 0.1) biome = BIOME.DESERT;
    else if (hum > 0.25 && temp < 0.05) biome = BIOME.BIRCH_FOREST;
    else if (hum > 0.05) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    return { h, biome, temp, mount };
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const biomes = new Uint8Array(CHUNK * CHUNK);
    const heights = new Uint8Array(CHUNK * CHUNK);
    const seed = this.seed;
    const bx = cx * CHUNK, bz = cz * CHUNK;
    const cols = [];
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = bx + x, wz = bz + z;
      const col = this.column(wx, wz);
      cols.push(col);
      const { h, biome } = col;
      biomes[z * CHUNK + x] = biome;
      heights[z * CHUNK + x] = h;
      const surfN = this.nSurf.noise2(wx / 12, wz / 12);
      const dirtDepth = 3 + Math.floor((surfN + 1) * 1.2);
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = 0;
        if (y === 0) id = B.bedrock;
        else if (y < 5 && hash3(wx, y, wz, seed) < (5 - y) / 5) id = B.bedrock;
        else if (y <= h) {
          const depth = h - y;
          id = B.stone;
          if (biome === BIOME.DESERT) {
            if (depth < dirtDepth + 1) id = B.sand; else if (depth < dirtDepth + 4) id = B.sandstone;
          } else if (biome === BIOME.BEACH) {
            if (depth < dirtDepth) id = B.sand; else if (depth < dirtDepth + 2) id = B.sandstone;
          } else if (biome === BIOME.OCEAN || biome === BIOME.DEEP_OCEAN) {
            if (depth < dirtDepth - 1) id = surfN > 0.35 ? B.gravel : (surfN < -0.5 && h > SEA - 8 ? B.clay : (h > SEA - 10 ? B.sand : B.dirt));
            if (depth < dirtDepth - 1 && biome === BIOME.DEEP_OCEAN) id = surfN > 0 ? B.gravel : B.dirt;
          } else if (biome === BIOME.MOUNTAINS && h > 96) {
            if (depth === 0 && h > 104 + surfN * 4) id = B.snow_block;
          } else {
            if (depth === 0) id = biome === BIOME.SNOWY ? B.snowy_grass_block : B.grass_block;
            else if (depth < dirtDepth) id = B.dirt;
          }
          if (biome === BIOME.MOUNTAINS && h <= 96) {
            if (depth === 0) id = h > 90 && surfN > 0.3 ? B.stone : B.grass_block;
            else if (depth < dirtDepth && id !== B.stone) id = B.dirt;
            else if (depth < 3) id = B.dirt;
          }
        } else if (y <= SEA) {
          id = B.water;
          if (y === SEA && (biome === BIOME.SNOWY || (col.temp < -0.3))) id = B.ice;
        }
        blocks[idx(x, y, z)] = id;
      }
    }

    // 洞穴：意面洞穴 + 奶酪洞穴
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = bx + x, wz = bz + z;
      const h = heights[z * CHUNK + x];
      const underWater = h < SEA;
      const top = underWater ? h - 5 : h;
      for (let y = 5; y <= top; y++) {
        const i = idx(x, y, z);
        const b = blocks[i];
        if (b === 0 || b === B.bedrock || b === B.water) continue;
        const yy = y * 1.6;
        const a = this.nCave1.noise3(wx / 48, yy / 48, wz / 48);
        const c2 = this.nCave2.noise3(wx / 48, yy / 48, wz / 48);
        let carve = a * a + c2 * c2 < 0.0055 * (y < 20 ? 1.4 : 1);
        if (!carve && y < h - 6) {
          const ch = this.nCave3.noise3(wx / 64, y / 28, wz / 64);
          carve = ch > 0.62 - (y < 30 ? 0.05 : 0);
        }
        if (carve) {
          // 不要挖穿沙子导致悬空（保持简单：沙子下面变成砂岩）
          blocks[i] = y <= 10 ? B.lava : 0;
        }
      }
    }
    // 修复：挖空后，沙子悬空 -> 砂岩
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] === B.sand && i >= CHUNK * CHUNK && blocks[i - CHUNK * CHUNK] === 0) blocks[i] = B.sandstone;
      if (blocks[i] === B.gravel && i >= CHUNK * CHUNK && blocks[i - CHUNK * CHUNK] === 0) blocks[i] = B.stone;
    }

    // 矿石
    const rnd = mulberry32((seed ^ Math.imul(cx, 341873128) ^ Math.imul(cz, 132897987)) | 0);
    const vein = (id, count, size, minY, maxY, replace = B.stone) => {
      for (let n = 0; n < count; n++) {
        let x = rnd() * 16, y = minY + rnd() * (maxY - minY), z = rnd() * 16;
        const len = size;
        for (let s = 0; s < len; s++) {
          const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
          for (let k = 0; k < 2; k++) {
            const ox = ix + (k ? Math.round(rnd() * 2 - 1) : 0), oz = iz + (k ? Math.round(rnd() * 2 - 1) : 0), oy = iy + (k ? Math.round(rnd() * 2 - 1) : 0);
            if (ox >= 0 && ox < 16 && oz >= 0 && oz < 16 && oy > 0 && oy < HEIGHT) {
              const ii = idx(ox, oy, oz);
              if (blocks[ii] === replace) blocks[ii] = id;
            }
          }
          x += rnd() * 2 - 1; y += rnd() * 2 - 1; z += rnd() * 2 - 1;
        }
      }
    };
    vein(B.dirt, 6, 24, 5, 100);
    vein(B.gravel, 5, 24, 5, 100);
    vein(B.coal_ore, 18, 10, 5, 120);
    vein(B.iron_ore, 14, 7, 5, 64);
    vein(B.gold_ore, 3, 6, 5, 32);
    vein(B.redstone_ore, 6, 6, 5, 16);
    vein(B.diamond_ore, 2, 5, 5, 16);

    // 树木（考虑相邻区块延伸过来的树冠）
    const put = (x, y, z, id, force) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 0 || y >= HEIGHT) return;
      const i = idx(lx, y, lz);
      const cur = blocks[i];
      if (force ? (cur === 0 || cur === B.short_grass || cur >= 10 && cur <= 14 && (cur & 1) === 0) : cur === 0 || cur === B.short_grass) blocks[i] = id;
    };
    for (let wz = bz - 3; wz < bz + 19; wz++) for (let wx = bx - 3; wx < bx + 19; wx++) {
      const r = hash3(wx, 7, wz, seed ^ 0x51ed);
      if (r > 0.06) continue;
      const inside = wx >= bx && wx < bx + 16 && wz >= bz && wz < bz + 16;
      const col = inside ? cols[(wz - bz) * 16 + (wx - bx)] : this.column(wx, wz);
      const { h, biome } = col;
      if (h < SEA + 1 || h > 108) continue;
      let chance = 0, type = 'oak';
      const r2 = hash3(wx, 9, wz, seed ^ 0x77);
      if (biome === BIOME.FOREST) { chance = 0.045; type = r2 < 0.2 ? 'birch' : 'oak'; }
      else if (biome === BIOME.BIRCH_FOREST) { chance = 0.05; type = r2 < 0.85 ? 'birch' : 'oak'; }
      else if (biome === BIOME.PLAINS) { chance = 0.0035; }
      else if (biome === BIOME.SNOWY) { chance = 0.03; type = 'spruce'; }
      else if (biome === BIOME.MOUNTAINS) { chance = h < 96 ? 0.012 : 0; type = r2 < 0.6 ? 'spruce' : 'oak'; }
      if (r >= chance) continue;
      if (inside) {
        const g = blocks[idx(wx - bx, h, wz - bz)];
        if (g !== B.grass_block && g !== B.snowy_grass_block) continue;
      }
      placeTree(type, wx, h + 1, wz, (k) => hash3(wx, 100 + k, wz, seed), put);
      if (inside) blocks[idx(wx - bx, h, wz - bz)] = B.dirt;
    }

    // 植物
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const { h, biome } = cols[z * CHUNK + x];
      if (h + 1 >= HEIGHT) continue;
      const below = blocks[idx(x, h, z)], above = idx(x, h + 1, z);
      if (blocks[above] !== 0) continue;
      const r = hash3(bx + x, 3, bz + z, seed ^ 0x9e37);
      if (below === B.grass_block) {
        const grassChance = biome === BIOME.PLAINS ? 0.22 : biome === BIOME.MOUNTAINS ? 0.08 : 0.12;
        if (r < 0.012) blocks[above] = hash3(bx + x, 4, bz + z, seed) < 0.5 ? B.dandelion : B.poppy;
        else if (r < 0.012 + grassChance) blocks[above] = B.short_grass;
      } else if (below === B.sand && biome === BIOME.DESERT) {
        if (r < 0.006) {
          let ok = true;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nx > 15 || nz < 0 || nz > 15) { ok = false; break; }
          }
          if (ok) { const ch = 1 + Math.floor(hash3(bx + x, 5, bz + z, seed) * 3); for (let k = 0; k < ch; k++) blocks[idx(x, h + 1 + k, z)] = B.cactus; }
        } else if (r < 0.016) blocks[above] = B.dead_bush;
      }
    }
    return { blocks, biomes, heights };
  }
}

// 放置一棵树。put(x,y,z,id,force)；rand(k) 返回确定性随机数
export function placeTree(type, x, y, z, rand, put) {
  if (type === 'spruce') {
    const hgt = 7 + Math.floor(rand(0) * 3);
    const top = y + hgt;
    // 锥形树冠
    let radius = 0;
    for (let yy = top; yy >= y + 2; yy--) {
      const d = top - yy;
      radius = d === 0 ? 0 : d === 1 ? 1 : (d % 2 === 0 ? Math.min(3, 1 + (d >> 1)) - 1 : Math.min(3, 1 + (d >> 1)));
      if (d === 1) radius = 1;
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (radius > 0 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        put(x + dx, yy, z + dz, B.spruce_leaves, false);
      }
    }
    put(x, top + 1, z, B.spruce_leaves, false);
    for (let i = 0; i < hgt; i++) put(x, y + i, z, B.spruce_log, true);
    return;
  }
  const log = type === 'birch' ? B.birch_log : B.oak_log;
  const leaves = type === 'birch' ? B.birch_leaves : B.oak_leaves;
  const hgt = (type === 'birch' ? 5 : 4) + Math.floor(rand(0) * 3);
  const top = y + hgt - 1;
  let k = 1;
  for (let yy = top - 2; yy <= top + 1; yy++) {
    const r = yy <= top - 1 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r) {
        if (yy === top + 1 || rand(k++) < 0.5) continue;
      }
      put(x + dx, yy, z + dz, leaves, false);
    }
  }
  for (let i = 0; i < hgt; i++) put(x, y + i, z, log, true);
}
