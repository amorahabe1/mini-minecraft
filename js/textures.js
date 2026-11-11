// 程序化生成所有像素纹理（原创绘制，不使用任何官方素材）
import { TILES, ITEMS, BLOCKS, SHAPE, SHAPES, FACE_TILES, MODELS, ARMOR_MATS, ARMOR_SLOTS } from './registry.js';
import { mulberry32 } from './noise.js';

const S = 16;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const clamp = (v) => Math.max(0, Math.min(255, v | 0));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, f) => [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];

class Tex {
  constructor(seedStr) {
    this.d = new Uint8ClampedArray(S * S * 4);
    let h = 7; for (const ch of seedStr) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    this.r = mulberry32(h);
  }
  set(x, y, c, a = 255) { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; this.d[i] = clamp(c[0]); this.d[i + 1] = clamp(c[1]); this.d[i + 2] = clamp(c[2]); this.d[i + 3] = a; }
  get(x, y) { const i = (y * S + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  alpha(x, y) { return this.d[(y * S + x) * 4 + 3]; }
  noise(base, v = 0.12, a = 255) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, shade(base, 1 + (this.r() - 0.5) * 2 * v), a); return this; }
  palette(cols, a = 255) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, cols[Math.floor(this.r() * cols.length)], a); return this; }
  speck(col, n, size = 1) { for (let i = 0; i < n; i++) { const x = Math.floor(this.r() * S), y = Math.floor(this.r() * S); for (let k = 0; k < size; k++) this.set(x + (k % 2), y + (k >> 1), col); } return this; }
  rect(x0, y0, w, h, col, a = 255) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, col, a); return this; }
  clear() { this.d.fill(0); return this; }
  template(rows, map) {
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x]; if (ch === '.' || ch === ' ') continue;
      const c = map[ch]; if (!c) continue;
      this.set(x, y, c.length === 4 ? c : c, c[3] ?? 255);
    }
    return this;
  }
  // 根据 alpha 自动描边
  outline(col) {
    const src = new Uint8ClampedArray(this.d);
    const a = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : src[(y * S + x) * 4 + 3]);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (a(x, y)) continue;
      if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) this.set(x, y, col);
    }
    return this;
  }
}

// ---------- 方块纹理 ----------
const C = {
  stone: hex(0x7f7f7f), dirt: hex(0x8b5d3b), grass: hex(0x6aaa40), sand: hex(0xdcd1a0), gravel: hex(0x857f7c),
  oakPlank: hex(0xa8834f), birchPlank: hex(0xc9b77d), sprucePlank: hex(0x6e5131),
  oakBark: hex(0x6b5131), birchBark: hex(0xd9d6cc), spruceBark: hex(0x3b2a18),
};
function stone(t, base = C.stone) {
  t.noise(base, 0.06);
  for (let i = 0; i < 22; i++) { const x = Math.floor(t.r() * S), y = Math.floor(t.r() * S); const l = 1 + Math.floor(t.r() * 3); const c = shade(base, t.r() < 0.5 ? 0.85 : 1.12); for (let k = 0; k < l; k++) t.set(x + k, y, c); }
  return t;
}
function dirt(t) {
  t.palette([shade(C.dirt, 0.82), shade(C.dirt, 0.92), C.dirt, C.dirt, shade(C.dirt, 1.1)]);
  t.speck(shade(C.dirt, 0.66), 10); t.speck(hex(0x9c7a5e), 6);
  return t;
}
function grassTop(t, base = C.grass) {
  t.palette([shade(base, 0.82), shade(base, 0.9), base, shade(base, 1.05), shade(base, 1.12)]);
  t.speck(shade(base, 0.7), 12);
  return t;
}
function grassSide(t, top = C.grass, snowy = false) {
  dirt(t);
  for (let x = 0; x < S; x++) {
    const d = 3 + Math.floor(t.r() * 2) + (t.r() < 0.25 ? 1 : 0) + (snowy ? 1 : 0);
    for (let y = 0; y < d; y++) t.set(x, y, shade(top, 0.85 + t.r() * 0.25));
  }
  return t;
}
function cobble(t, base = C.stone) {
  // Voronoi 石块
  const pts = []; for (let i = 0; i < 11; i++) pts.push([t.r() * S, t.r() * S, 0.85 + t.r() * 0.3]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (const p of pts) for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const d = Math.hypot(x + 0.5 - p[0] - ox, y + 0.5 - p[1] - oy);
      if (d < d1) { d2 = d1; d1 = d; best = p[2]; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    let c = shade(base, best * (1 + (t.r() - 0.5) * 0.12));
    if (edge < 1.1) c = shade(base, 0.48);
    else if (edge < 2) c = shade(c, 0.8);
    else if (d1 < 2.2) c = shade(c, 1.12);
    t.set(x, y, c);
  }
  return t;
}
function planks(t, base) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const board = y >> 2;
    let c = shade(base, 0.92 + (t.r() - 0.5) * 0.1 + ((x * 7 + board * 3) % 5 === 0 ? -0.06 : 0));
    if ((y & 3) === 3) c = shade(base, 0.62);
    const seam = board % 2 === 0 ? 3 : 11;
    if (x === seam && (y & 3) !== 3) c = shade(base, 0.68);
    t.set(x, y, c);
  }
  return t;
}
function logSide(t, bark, kind) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c;
    if (kind === 'birch') {
      c = shade(bark, 0.95 + t.r() * 0.08);
    } else {
      const stripe = (x * 5 + Math.floor(t.r() * 2)) % 4 === 0;
      c = shade(bark, stripe ? 0.72 : 0.9 + t.r() * 0.18);
    }
    t.set(x, y, c);
  }
  if (kind === 'birch') {
    for (let i = 0; i < 9; i++) { const x = Math.floor(t.r() * 14), y = Math.floor(t.r() * S); const w = 1 + Math.floor(t.r() * 3); t.rect(x, y, w, 1, hex(0x2c2c2c)); }
  } else {
    for (let i = 0; i < 6; i++) { const x = Math.floor(t.r() * S), y = Math.floor(t.r() * 12); const l = 2 + Math.floor(t.r() * 4); for (let k = 0; k < l; k++) t.set(x, y + k, shade(bark, 0.6)); }
  }
  return t;
}
function logTop(t, bark, inner) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let c;
    if (d > 6.5) c = shade(bark, 0.85 + t.r() * 0.2);
    else { const ring = Math.floor(d) % 2 === 0; c = shade(inner, (ring ? 0.88 : 1.02) + (t.r() - 0.5) * 0.06); }
    t.set(x, y, c);
  }
  return t;
}
function leaves(t, base, holes = 0.22) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (t.r() < holes) { t.set(x, y, [0, 0, 0], 0); continue; }
    const v = t.r();
    t.set(x, y, shade(base, v < 0.2 ? 0.7 : v < 0.6 ? 0.9 : v < 0.9 ? 1.05 : 1.25));
  }
  return t;
}
function ore(t, color, hi) {
  stone(t);
  const n = 4 + Math.floor(t.r() * 2);
  for (let i = 0; i < n; i++) {
    const cx = 2 + Math.floor(t.r() * 11), cy = 2 + Math.floor(t.r() * 11);
    const pix = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
    for (const [dx, dy] of pix) if (t.r() < 0.8) t.set(cx + dx, cy + dy, shade(color, 0.8 + t.r() * 0.3));
    t.set(cx, cy, hi);
  }
  return t;
}
function wool(t, base) {
  t.noise(base, 0.05);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x + y * 3) % 7 === 0 || (x * 3 + y) % 9 === 0) t.set(x, y, shade(base, 0.9));
  return t;
}
function metalBlock(t, base) {
  t.noise(base, 0.03);
  for (let i = 0; i < S; i++) { t.set(i, 0, shade(base, 1.2)); t.set(0, i, shade(base, 1.2)); t.set(i, 15, shade(base, 0.7)); t.set(15, i, shade(base, 0.7)); }
  for (let i = 2; i < 6; i++) t.set(i, 2, shade(base, 1.25));
  return t;
}
function cross(t, draw) { t.clear(); draw(t); return t; }

const DRAW = {
  stone: (t) => stone(t),
  dirt: (t) => dirt(t),
  grass_top: (t) => grassTop(t),
  grass_side: (t) => grassSide(t),
  grass_side_snowed: (t) => grassSide(t, hex(0xf0f6f8), true),
  cobblestone: (t) => cobble(t),
  mossy_cobblestone: (t) => { cobble(t); for (let i = 0; i < 40; i++) { const x = Math.floor(t.r() * S), y = Math.floor(t.r() * S); t.set(x, y, shade(hex(0x5a7a35), 0.8 + t.r() * 0.4)); } },
  oak_planks: (t) => planks(t, C.oakPlank),
  birch_planks: (t) => planks(t, C.birchPlank),
  spruce_planks: (t) => planks(t, C.sprucePlank),
  bedrock: (t) => { t.palette([hex(0x2b2b2b), hex(0x555555), hex(0x777777), hex(0x404040), hex(0x1a1a1a)]); },
  sand: (t) => { t.palette([shade(C.sand, 0.93), C.sand, shade(C.sand, 1.04), shade(C.sand, 0.97)]); t.speck(shade(C.sand, 0.85), 10); },
  gravel: (t) => { t.palette([shade(C.gravel, 0.7), shade(C.gravel, 0.9), C.gravel, shade(C.gravel, 1.15), hex(0x6a5f5a), hex(0x9a9592)]); },
  oak_log: (t) => logSide(t, C.oakBark),
  oak_log_top: (t) => logTop(t, C.oakBark, hex(0xb08d57)),
  birch_log: (t) => logSide(t, C.birchBark, 'birch'),
  birch_log_top: (t) => logTop(t, C.birchBark, hex(0xd1bf88)),
  spruce_log: (t) => logSide(t, C.spruceBark),
  spruce_log_top: (t) => logTop(t, C.spruceBark, hex(0x7a5b35)),
  oak_leaves: (t) => leaves(t, hex(0x3f8a24)),
  birch_leaves: (t) => leaves(t, hex(0x6d9a46)),
  spruce_leaves: (t) => leaves(t, hex(0x3a5f3b), 0.18),
  coal_ore: (t) => ore(t, hex(0x2a2a2a), hex(0x4a4a4a)),
  iron_ore: (t) => ore(t, hex(0xd2a888), hex(0xeec9ad)),
  gold_ore: (t) => ore(t, hex(0xf2d43a), hex(0xfff6a0)),
  diamond_ore: (t) => ore(t, hex(0x4fd8dc), hex(0xc9fffd)),
  redstone_ore: (t) => ore(t, hex(0xc10000), hex(0xff3a3a)),
  glass: (t) => {
    t.clear();
    const f = hex(0xdcecf0), f2 = hex(0xa8c8d0);
    for (let i = 0; i < S; i++) { t.set(i, 0, f); t.set(0, i, f); t.set(i, 15, f2); t.set(15, i, f2); }
    for (let i = 0; i < 4; i++) { t.set(3 + i, 3 + i, f, 200); t.set(4 + i, 3 + i, f, 160); }
    t.set(11, 10, f, 200); t.set(12, 11, f, 200);
  },
  sandstone: (t) => { t.noise(hex(0xd8cb93), 0.04); for (let x = 0; x < S; x++) { t.set(x, 3, hex(0xc7b77f)); t.set(x, 11, hex(0xc7b77f)); t.set(x, 12, hex(0xe3d8a6)); } for (let y = 0; y < 3; y++) for (let x = 0; x < S; x++) t.set(x, y, shade(hex(0xe5dbab), 0.97 + t.r() * 0.06)); },
  sandstone_top: (t) => { t.noise(hex(0xdccf98), 0.05); },
  sandstone_bottom: (t) => { t.noise(hex(0xd8ca90), 0.06); t.speck(hex(0xbfae75), 14); },
  snow: (t) => { t.palette([hex(0xffffff), hex(0xf4f8fa), hex(0xeaf2f5), hex(0xffffff)]); },
  ice: (t) => { t.noise(hex(0x8eb4f2), 0.05, 190); for (let i = 0; i < 4; i++) { const x = Math.floor(t.r() * 12), y = Math.floor(t.r() * 12); for (let k = 0; k < 4; k++) t.set(x + k, y + (k >> 1), hex(0xc7dcff), 210); } },
  cactus_side: (t) => {
    t.clear();
    for (let y = 0; y < S; y++) for (let x = 1; x < 15; x++) t.set(x, y, shade(hex(0x2f7a24), (x % 4 === 1 ? 0.75 : 1) * (0.9 + t.r() * 0.2)));
    for (let i = 0; i < 10; i++) { const x = 1 + Math.floor(t.r() * 14), y = Math.floor(t.r() * S); t.set(x, y, hex(0xd8e7b8)); }
    for (let y = 0; y < S; y += 4) { t.set(0, y + 1, hex(0x1a1a1a)); t.set(15, y + 3, hex(0x1a1a1a)); }
  },
  cactus_top: (t) => { t.noise(hex(0x3f8c2e), 0.06); for (let i = 0; i < S; i++) { t.set(i, 0, hex(0x2d6a20)); t.set(0, i, hex(0x2d6a20)); t.set(i, 15, hex(0x2d6a20)); t.set(15, i, hex(0x2d6a20)); } t.rect(6, 6, 4, 4, hex(0x6fae4e)); },
  cactus_bottom: (t) => { t.noise(hex(0x9fbf6a), 0.06); },
  short_grass: (t) => cross(t, (t) => {
    for (let b = 0; b < 9; b++) {
      let x = 1 + Math.floor(t.r() * 14); const hgt = 5 + Math.floor(t.r() * 9);
      for (let k = 0; k < hgt; k++) { t.set(x, 15 - k, shade(C.grass, 0.75 + t.r() * 0.45)); if (t.r() < 0.18) x += t.r() < 0.5 ? -1 : 1; }
    }
  }),
  dandelion: (t) => cross(t, (t) => {
    for (let y = 9; y < 16; y++) t.set(7, y, hex(0x3d8a28));
    t.set(6, 12, hex(0x3d8a28)); t.set(8, 11, hex(0x3d8a28)); t.set(9, 10, hex(0x4b9a30));
    t.rect(6, 6, 3, 3, hex(0xffe23a)); t.set(7, 5, hex(0xffe23a)); t.set(5, 7, hex(0xffd21a)); t.set(9, 7, hex(0xffd21a)); t.set(7, 9, hex(0xf2b800)); t.set(7, 7, hex(0xfff3a0));
  }),
  poppy: (t) => cross(t, (t) => {
    for (let y = 8; y < 16; y++) t.set(7, y, hex(0x3d8a28));
    t.set(8, 12, hex(0x3d8a28)); t.set(9, 11, hex(0x3d8a28)); t.set(6, 13, hex(0x3d8a28));
    t.rect(5, 4, 5, 4, hex(0xe0201c)); t.rect(6, 3, 3, 1, hex(0xe0201c)); t.set(7, 5, hex(0x2a1a10)); t.set(8, 6, hex(0x2a1a10)); t.set(5, 4, hex(0xb51510)); t.set(9, 7, hex(0xb51510));
  }),
  dead_bush: (t) => cross(t, (t) => {
    const c = hex(0x8a5a24);
    const br = (x, y, dx, n) => { for (let k = 0; k < n; k++) { t.set(x, y, shade(c, 0.8 + t.r() * 0.4)); y--; if (k % 2) x += dx; } };
    br(7, 15, 0, 6); br(7, 11, -1, 6); br(8, 11, 1, 6); br(7, 13, 1, 5); br(6, 13, -1, 5);
  }),
  torch: (t) => cross(t, (t) => {
    for (let y = 6; y < 16; y++) { t.set(7, y, hex(0x8a6a3a)); t.set(8, y, hex(0x6b5028)); }
    t.set(7, 6, hex(0xffffa0)); t.set(8, 6, hex(0xffd84a)); t.set(7, 7, hex(0xffb020)); t.set(8, 7, hex(0xff9a10));
    t.set(7, 5, hex(0xffe060), 200); t.set(8, 5, hex(0xffc030), 160);
  }),
  crafting_table_top: (t) => {
    planks(t, C.oakPlank);
    const dk = hex(0x5a4128);
    for (let i = 0; i < S; i++) { t.set(i, 0, dk); t.set(0, i, dk); t.set(i, 15, dk); t.set(15, i, dk); }
    for (let i = 2; i < 14; i++) { t.set(i, 5, dk); t.set(i, 10, dk); t.set(5, i, dk); t.set(10, i, dk); }
  },
  crafting_table_side: (t) => {
    planks(t, C.oakPlank);
    t.rect(0, 0, 16, 3, shade(C.oakPlank, 0.7));
    // 锯子
    for (let x = 2; x < 9; x++) t.set(x, 7, hex(0xbdbdbd)); for (let x = 2; x < 9; x += 2) t.set(x, 8, hex(0x8a8a8a));
    t.rect(9, 6, 2, 3, hex(0x6b4a2a));
    // 锤子
    t.rect(11, 5, 3, 2, hex(0x9a9a9a)); for (let y = 7; y < 13; y++) t.set(12, y, hex(0x6b4a2a));
  },
  crafting_table_front: (t) => {
    planks(t, C.oakPlank);
    t.rect(0, 0, 16, 3, shade(C.oakPlank, 0.7));
    t.rect(3, 5, 4, 3, hex(0xa0a0a0)); for (let y = 8; y < 14; y++) t.set(4, y, hex(0x6b4a2a));
    t.rect(9, 5, 1, 8, hex(0xc8c8c8)); t.rect(8, 12, 3, 1, hex(0x6b4a2a)); t.set(9, 13, hex(0x6b4a2a));
  },
  bricks: (t) => {
    const br = hex(0x96503f), mortar = hex(0xb5a99a);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const row = y >> 2, off = row % 2 ? 4 : 0;
      const m = (y & 3) === 3 || ((x + off) & 7) === 7;
      t.set(x, y, m ? shade(mortar, 0.9 + t.r() * 0.15) : shade(br, 0.85 + t.r() * 0.3));
    }
  },
  stone_bricks: (t) => {
    stone(t, hex(0x7a7a7a));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const row = y >> 3, off = row % 2 ? 8 : 0;
      if ((y & 7) === 7 || ((x + off) & 15) === 15) t.set(x, y, hex(0x4e4e4e));
      else if ((y & 7) === 0 || ((x + off) & 15) === 0) t.set(x, y, hex(0x9a9a9a));
    }
  },
  obsidian: (t) => { t.palette([hex(0x14101e), hex(0x1b1528), hex(0x0f0b18), hex(0x261d3a)]); t.speck(hex(0x4a3a6a), 8); },
  white_wool: (t) => wool(t, hex(0xe9ecec)),
  red_wool: (t) => wool(t, hex(0xa12722)),
  yellow_wool: (t) => wool(t, hex(0xf8c527)),
  lime_wool: (t) => wool(t, hex(0x70b919)),
  blue_wool: (t) => wool(t, hex(0x35399d)),
  black_wool: (t) => wool(t, hex(0x15151a)),
  bookshelf: (t) => {
    planks(t, C.oakPlank);
    const cols = [0xa12722, 0x35399d, 0x3f7a2a, 0x8a5a24, 0x6a2a8a, 0xc9a227].map(hex);
    for (const y0 of [1, 9]) {
      t.rect(0, y0, 16, 6, hex(0x3a2a18));
      let x = 1;
      while (x < 15) { const w = 1 + Math.floor(t.r() * 2); const c = cols[Math.floor(t.r() * cols.length)]; const hh = 4 + Math.floor(t.r() * 2); t.rect(x, y0 + 6 - hh, w, hh, c); t.set(x, y0 + 6 - hh + 1, shade(c, 1.4)); x += w + (t.r() < 0.3 ? 1 : 0); }
    }
  },
  clay: (t) => { t.noise(hex(0xa0a6b4), 0.05); t.speck(hex(0x8f95a3), 12); },
  oak_sapling: (t) => cross(t, (t) => { for (let y = 9; y < 16; y++) t.set(7, y, hex(0x6b5131)); leaves(new Tex('x'), hex(0x3f8a24)); for (let i = 0; i < 40; i++) { const x = 3 + Math.floor(t.r() * 9), y = 2 + Math.floor(t.r() * 8); t.set(x, y, shade(hex(0x3f8a24), 0.7 + t.r() * 0.6)); } }),
  birch_sapling: (t) => cross(t, (t) => { for (let y = 9; y < 16; y++) t.set(7, y, hex(0xd9d6cc)); for (let i = 0; i < 40; i++) { const x = 3 + Math.floor(t.r() * 9), y = 2 + Math.floor(t.r() * 8); t.set(x, y, shade(hex(0x6d9a46), 0.7 + t.r() * 0.6)); } }),
  spruce_sapling: (t) => cross(t, (t) => { for (let y = 4; y < 16; y++) t.set(7, y, hex(0x3b2a18)); for (let y = 3; y < 13; y++) { const w = Math.floor((y - 2) / 2); for (let x = 7 - w; x <= 7 + w; x++) if (t.r() < 0.8) t.set(x, y, shade(hex(0x3a5f3b), 0.7 + t.r() * 0.6)); } }),
  iron_block: (t) => metalBlock(t, hex(0xdcdcdc)),
  gold_block: (t) => metalBlock(t, hex(0xf5d63a)),
  diamond_block: (t) => metalBlock(t, hex(0x62e0dc)),
  coal_block: (t) => { t.palette([hex(0x111111), hex(0x1c1c1c), hex(0x262626), hex(0x0a0a0a)]); },
  glowstone: (t) => { t.palette([hex(0xf9d49c), hex(0xd8a35a), hex(0xfff1c0), hex(0xb37c3b), hex(0xffe2a0)]); },
  smooth_stone: (t) => { t.noise(hex(0x9e9e9e), 0.03); for (let i = 0; i < S; i++) { t.set(i, 0, hex(0x7a7a7a)); t.set(i, 15, hex(0x7a7a7a)); t.set(0, i, hex(0x8a8a8a)); t.set(15, i, hex(0x8a8a8a)); } },
  pumpkin_side: (t) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, shade(hex(0xd9821c), (x % 4 === 0 ? 0.78 : 1) * (0.92 + t.r() * 0.12))); },
  pumpkin_top: (t) => { t.noise(hex(0xd07a18), 0.06); t.rect(6, 6, 4, 4, hex(0x6b5a2a)); t.rect(7, 7, 2, 2, hex(0x8a7a3a)); },
  furnace_side: (t) => { stone(t, hex(0x7c7c7c)); for (let i = 0; i < S; i++) { t.set(i, 0, hex(0x5a5a5a)); t.set(i, 15, hex(0x5a5a5a)); t.set(0, i, hex(0x6a6a6a)); t.set(15, i, hex(0x6a6a6a)); } },
  furnace_top: (t) => { stone(t, hex(0x8a8a8a)); for (let i = 0; i < S; i++) { t.set(i, 0, hex(0x5a5a5a)); t.set(i, 15, hex(0x5a5a5a)); t.set(0, i, hex(0x5a5a5a)); t.set(15, i, hex(0x5a5a5a)); } },
  furnace_front: (t) => { DRAW.furnace_side(t); t.rect(3, 2, 10, 4, hex(0x5a5a5a)); t.rect(4, 3, 8, 2, hex(0x8a8a8a)); t.rect(3, 8, 10, 6, hex(0x444444)); t.rect(4, 9, 8, 4, hex(0x111111)); },
  furnace_front_on: (t) => { DRAW.furnace_front(t); for (let x = 4; x < 12; x++) for (let y = 10; y < 13; y++) t.set(x, y, t.r() < 0.5 ? hex(0xffb020) : hex(0xff6a00)); t.rect(5, 9, 1, 1, hex(0xffe060)); t.rect(9, 9, 1, 1, hex(0xffe060)); },
  chest_side: (t) => { planks(t, hex(0xa2742f)); const dk = hex(0x3a2a14); for (let i = 0; i < S; i++) { t.set(i, 0, dk); t.set(i, 15, dk); t.set(0, i, dk); t.set(15, i, dk); t.set(i, 5, dk); } },
  chest_front: (t) => { DRAW.chest_side(t); t.rect(7, 3, 2, 5, hex(0x2a2a2a)); t.rect(7, 4, 2, 3, hex(0xc8c8c8)); },
  chest_top: (t) => { planks(t, hex(0xa2742f)); const dk = hex(0x3a2a14); for (let i = 0; i < S; i++) { t.set(i, 0, dk); t.set(i, 15, dk); t.set(0, i, dk); t.set(15, i, dk); } },
  water: (t) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const w = Math.sin((x + y * 0.5) * 0.8) * 0.5 + Math.sin((x * 0.3 - y) * 0.9) * 0.5;
      t.set(x, y, shade(hex(0x2f5fd0), 0.92 + w * 0.08 + t.r() * 0.05), 175);
    }
  },
  lava: (t) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const w = Math.sin(x * 0.9 + y * 0.4) + Math.sin(y * 0.7 - x * 0.3);
      const c = w > 0.8 ? hex(0xffd84a) : w > 0 ? hex(0xff9a1c) : hex(0xd8520c);
      t.set(x, y, shade(c, 0.9 + t.r() * 0.15));
    }
  },
  // ---------- 新方块 ----------
  dirt_path_top: (t) => { t.palette([hex(0x9a7a46), hex(0x8d6f3e), hex(0xa4844f), hex(0x94763f)]); t.speck(hex(0x7a5e32), 10); t.speck(hex(0xb09060), 5); },
  dirt_path_side: (t) => { dirt(t); for (let x = 0; x < S; x++) { const d = 2 + Math.floor(t.r() * 2); for (let y = 0; y < d; y++) t.set(x, y, shade(hex(0x9a7a46), 0.85 + t.r() * 0.25)); } },
  farmland_top: (t) => {
    t.palette([hex(0x5a3a20), hex(0x4e321c), hex(0x633f22), hex(0x553620)]);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { if (x % 4 === 0) t.set(x, y, hex(0x3a2412)); else if (x % 4 === 1) t.set(x, y, shade(hex(0x6e4a2a), 0.9 + t.r() * 0.2)); }
    for (let i = 0; i < S; i++) { t.set(i, 0, hex(0x40281a)); t.set(i, 15, hex(0x40281a)); }
  },
  cobweb: (t) => cross(t, (t) => {
    const c = hex(0xe8e8ec);
    for (let i = 0; i < S; i++) { t.set(i, i, c, 220); t.set(15 - i, i, c, 220); t.set(7, i, c, 200); t.set(i, 8, c, 200); }
    for (const r of [3, 6]) for (let a = 0; a < 32; a++) { const ang = a / 32 * Math.PI * 2; t.set(Math.round(7.5 + Math.cos(ang) * r), Math.round(7.5 + Math.sin(ang) * r), c, 170); }
  }),
  bell_body: (t) => { metalBlock(t, hex(0xf2c83a)); for (let x = 0; x < S; x++) t.set(x, 12, hex(0xb08a1a)); },
  bed_leg: (t) => planks(t, hex(0x7a5530)),
  oak_door_top: (t) => door(t, true),
  oak_door_bottom: (t) => door(t, false),
};
function door(t, top) {
  const base = C.oakPlank, dk = shade(base, 0.62);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = shade(base, 0.9 + (t.r() - 0.5) * 0.1 + (x % 5 === 0 ? -0.08 : 0));
    if (x === 0 || x === 15 || (top ? y === 0 : y === 15)) c = dk;
    t.set(x, y, c);
  }
  if (top) {
    // 两扇小窗
    for (const x0 of [2, 9]) { t.rect(x0, 3, 5, 5, hex(0x2a1e10)); t.rect(x0 + 1, 4, 3, 3, [184, 214, 224], 140); t.set(x0 + 1, 4, hex(0xe8f4f8)); }
    for (let x = 1; x < 15; x++) t.set(x, 10, dk);
  } else {
    for (let x = 1; x < 15; x++) { t.set(x, 2, dk); t.set(x, 9, dk); }
    for (let y = 2; y < 10; y++) { t.set(5, y, dk); t.set(10, y, dk); }
    t.rect(12, 0, 2, 2, hex(0x3a3a3a)); t.set(12, 0, hex(0x9a9a9a));
  }
}
// 小麦生长阶段 0-7
for (let a = 0; a < 8; a++) {
  DRAW['wheat_stage_' + a] = (t) => cross(t, (t) => {
    const hgt = 3 + Math.round(a * 1.6);
    const green = hex(0x4fa02a), yellow = hex(0xc8a83a);
    const col = mix(green, yellow, Math.max(0, (a - 4) / 3));
    for (const x0 of [1, 4, 7, 10, 13]) {
      let x = x0 + Math.floor(t.r() * 2);
      for (let k = 0; k < hgt; k++) { t.set(x, 15 - k, shade(col, 0.75 + t.r() * 0.4)); if (t.r() < 0.2) x += t.r() < 0.5 ? -1 : 1; }
      if (a >= 5) for (let k = 0; k < 3; k++) { t.set(x, 15 - hgt - k, shade(a === 7 ? hex(0xd8b048) : col, 0.9 + t.r() * 0.2)); t.set(x + 1, 16 - hgt - k, shade(hex(0xb08a2a), 0.9)); }
    }
  });
}
// 床
const BED_COL = { red: hex(0xb02a24), white: hex(0xe6e6e6) };
for (const c of ['red', 'white']) {
  const bc = BED_COL[c], frame = hex(0x7a5530), pillow = hex(0xf4f4f4);
  DRAW[`bed_${c}_head_top`] = (t) => { wool(t, bc); t.rect(2, 9, 12, 5, pillow); for (let x = 2; x < 14; x++) { t.set(x, 9, hex(0xd8d8d8)); t.set(x, 13, hex(0xd0d0d0)); } t.set(2, 9, bc); t.set(13, 9, bc); for (let x = 0; x < S; x++) t.set(x, 15, shade(bc, 0.75)); };
  DRAW[`bed_${c}_foot_top`] = (t) => { wool(t, bc); for (let x = 0; x < S; x++) { t.set(x, 0, shade(bc, 0.75)); t.set(x, 4, shade(bc, 1.12)); } };
  const side = (t) => { t.clear(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { if (y < 7) continue; t.set(x, y, y < 10 ? shade(bc, 0.85 + t.r() * 0.15) : shade(frame, 0.85 + t.r() * 0.2)); } };
  DRAW[`bed_${c}_head_side`] = side; DRAW[`bed_${c}_foot_side`] = side;
  DRAW[`bed_${c}_head_end`] = (t) => { side(t); for (let x = 0; x < S; x++) t.set(x, 10, shade(frame, 0.7)); };
  DRAW[`bed_${c}_foot_end`] = (t) => { side(t); for (let x = 0; x < S; x++) t.set(x, 10, shade(frame, 0.7)); };
}
DRAW.fx_explosion = (t) => { t.clear(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 7.5 - t.r() * 2) t.set(x, y, shade(hex(0xe8e8e0), 0.75 + t.r() * 0.3)); } };
DRAW.fx_smoke = (t) => { t.clear(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 7 - t.r() * 2) t.set(x, y, shade(hex(0x5a5a5a), 0.7 + t.r() * 0.4), 220); } };
DRAW.fx_lightning = (t) => { t.noise(hex(0xeef0ff), 0.02); };
// 破坏裂纹
const crackSeeds = [];
{
  const r = mulberry32(4242);
  const lines = [];
  for (let i = 0; i < 10; i++) {
    let x = 8 + (r() - 0.5) * 4, y = 8 + (r() - 0.5) * 4; const ang = r() * Math.PI * 2; const pts = [];
    for (let k = 0; k < 9; k++) { pts.push([Math.floor(x), Math.floor(y)]); x += Math.cos(ang + (r() - 0.5) * 1.2) * 1.1; y += Math.sin(ang + (r() - 0.5) * 1.2) * 1.1; }
    lines.push(pts);
  }
  crackSeeds.push(...lines);
}
for (let s = 0; s < 10; s++) {
  DRAW['destroy_' + s] = (t) => {
    t.clear();
    const n = Math.ceil(((s + 1) / 10) * crackSeeds.length);
    for (let i = 0; i < n; i++) {
      const len = Math.ceil(((s + 1) / 10) * 9);
      for (let k = 0; k < len; k++) { const [x, y] = crackSeeds[i][k]; t.set(x, y, [30, 30, 30], 190); }
    }
  };
}

// ---------- 物品图标 ----------
const OUT = hex(0x1f1f1f);
function stroke(t, x0, y0, x1, y1, col, w = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
    t.set(x, y, col); if (w > 1) t.set(x + 1, y, shade(col, 0.8));
  }
}
const MAT_COL = { wooden: hex(0x9c7a46), stone: hex(0x8a8a8a), iron: hex(0xd8d8d8), golden: hex(0xf0d040), diamond: hex(0x4ee2da) };
const HANDLE = hex(0x6b4a26);
function toolIcon(t, type, mat) {
  t.clear();
  const m = MAT_COL[mat], hi = shade(m, 1.25), dk = shade(m, 0.65);
  if (type === 'sword') {
    for (let i = 0; i < 9; i++) { t.set(5 + i, 10 - i, i % 3 === 0 ? hi : m); t.set(5 + i, 11 - i, dk); t.set(6 + i, 10 - i, m); }
    t.set(14, 1, hi); t.set(13, 1, m); t.set(14, 2, m);
    stroke(t, 2, 9, 6, 13, dk); stroke(t, 3, 9, 6, 12, m);
    stroke(t, 2, 13, 4, 11, HANDLE); t.set(1, 14, hex(0x4a3218)); t.set(2, 14, HANDLE);
  } else {
    // 木柄
    for (let i = 0; i < 10; i++) { t.set(2 + i, 13 - i, HANDLE); t.set(3 + i, 13 - i, shade(HANDLE, 0.75)); }
    if (type === 'pickaxe') {
      const arc = [[3, 3], [4, 2], [5, 2], [6, 1], [7, 1], [8, 1], [9, 1], [10, 2], [11, 2], [12, 3], [13, 4], [13, 5], [14, 6], [14, 7], [14, 8], [14, 9], [13, 10], [13, 11], [12, 12]];
      for (const [x, y] of arc) { t.set(x, y, m); t.set(x - 1, y + 1, dk); }
      for (const [x, y] of arc.slice(3, 9)) t.set(x, y, hi);
      t.set(11, 3, m); t.set(12, 4, m); t.set(10, 3, dk); t.set(12, 5, dk);
    } else if (type === 'axe') {
      const rows = { 1: [8, 10], 2: [7, 12], 3: [7, 13], 4: [8, 13], 5: [9, 13], 6: [10, 12], 7: [11, 11] };
      for (const [y, [a, b]] of Object.entries(rows)) for (let x = a; x <= b; x++) t.set(x, +y, x === b ? hi : x === a ? dk : m);
    } else if (type === 'hoe') {
      for (let x = 7; x <= 13; x++) { t.set(x, 2, x === 13 ? hi : m); t.set(x, 3, dk); }
      t.set(13, 3, m); t.set(13, 4, dk);
    } else if (type === 'shovel') {
      const rows = { 1: [11, 12], 2: [10, 13], 3: [9, 14], 4: [9, 14], 5: [9, 13], 6: [10, 12] };
      for (const [y, [a, b]] of Object.entries(rows)) for (let x = a; x <= b; x++) t.set(x, +y, x === a || +y === 6 ? dk : (x === b - 1 && +y < 4 ? hi : m));
    }
  }
  t.outline(OUT);
}
function blob(t, cx, cy, rx, ry, cols) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (d < 1) t.set(x, y, cols[Math.min(cols.length - 1, Math.floor(t.r() * cols.length * 0.6 + (x + y < cx + cy ? 0 : cols.length * 0.4)))]);
  }
}
function ingot(t, base) {
  t.clear();
  const hi = shade(base, 1.3), dk = shade(base, 0.6);
  for (let y = 6; y < 12; y++) {
    const a = 1 + (11 - y), b = a + 9;
    for (let x = a; x <= b; x++) t.set(x, y, y === 6 ? hi : y === 11 ? dk : x === b ? dk : base);
  }
  t.set(4, 8, hi); t.set(5, 8, hi);
  t.outline(OUT);
}
function meat(t, raw, fat) {
  t.clear();
  blob(t, 8, 8, 6.5, 4.5, [raw, shade(raw, 1.12), shade(raw, 0.85)]);
  for (let x = 2; x < 14; x++) { if (t.alpha(x, 4)) t.set(x, 4, fat); }
  for (let i = 0; i < 8; i++) { const x = 3 + Math.floor(t.r() * 10), y = 6 + Math.floor(t.r() * 5); if (t.alpha(x, y)) t.set(x, y, fat); }
  t.outline(shade(raw, 0.4));
}
const ITEM_DRAW = {
  stick: (t) => { t.clear(); for (let i = 0; i < 11; i++) { t.set(3 + i, 13 - i, hex(0x8a6a3a)); t.set(3 + i, 14 - i, hex(0x5a4020)); } t.outline(hex(0x2a1a0a)); },
  coal: (t) => { t.clear(); blob(t, 8, 8.5, 5.5, 5, [hex(0x2a2a2a), hex(0x3d3d3d), hex(0x1a1a1a), hex(0x555555)]); t.outline(hex(0x0a0a0a)); },
  charcoal: (t) => { t.clear(); blob(t, 8, 8.5, 5.5, 5, [hex(0x3a2e24), hex(0x4f4034), hex(0x2a2018), hex(0x5f5044)]); t.outline(hex(0x0a0a0a)); },
  iron_ingot: (t) => ingot(t, hex(0xd8d8d8)),
  gold_ingot: (t) => ingot(t, hex(0xf2d23a)),
  brick: (t) => ingot(t, hex(0xb4553a)),
  diamond: (t) => { t.clear(); t.template(['......', '.', '.', '....aaaaaaa', '...abbbbbbba', '..abcbbbbcbba', '.abbbccbbbbbba', '..abbbbbbbbba', '...abbbbbbba', '....abbbbba', '.....abbba', '......aba', '.......a'], { a: hex(0x1a8a86), b: hex(0x4ee2da), c: hex(0xd0fffb) }); },
  redstone: (t) => { t.clear(); for (let i = 0; i < 30; i++) { const x = 3 + Math.floor(t.r() * 10), y = 4 + Math.floor(t.r() * 9); t.set(x, y, t.r() < 0.3 ? hex(0xff4a4a) : hex(0xb00000)); } t.outline(hex(0x3a0000)); },
  flint: (t) => { t.clear(); t.template(['', '', '.......a', '......aba', '.....abbba', '....abcbbba', '...abbbbbba', '...abbbbbba', '....abbbba', '.....abba', '......aa'], { a: hex(0x1a1a1a), b: hex(0x3a3a3a), c: hex(0x6a6a6a) }); },
  apple: (t) => { t.clear(); blob(t, 8, 9.5, 5.5, 5, [hex(0xe0201c), hex(0xff4a3a), hex(0xb01510)]); t.set(8, 3, hex(0x5a3a1a)); t.set(8, 4, hex(0x5a3a1a)); t.set(9, 3, hex(0x3d8a28)); t.set(10, 2, hex(0x3d8a28)); t.set(6, 7, hex(0xffb0a0)); t.outline(hex(0x3a0808)); },
  porkchop: (t) => meat(t, hex(0xf09a9a), hex(0xfadadb)),
  cooked_porkchop: (t) => meat(t, hex(0xc48a5a), hex(0xe8c9a0)),
  beef: (t) => meat(t, hex(0xc8302a), hex(0xf0b0b0)),
  cooked_beef: (t) => meat(t, hex(0x7a4a28), hex(0xa06a40)),
  mutton: (t) => meat(t, hex(0xd84a4a), hex(0xf8c8c8)),
  cooked_mutton: (t) => meat(t, hex(0x9a5a3a), hex(0xc8906a)),
  rotten_flesh: (t) => meat(t, hex(0x8a6a3a), hex(0x6a8a3a)),
  leather: (t) => { t.clear(); t.rect(3, 3, 10, 10, hex(0x9a5a2a)); t.rect(2, 4, 12, 8, hex(0x9a5a2a)); for (let i = 0; i < 10; i++) t.set(3 + Math.floor(t.r() * 10), 3 + Math.floor(t.r() * 10), hex(0x7a4218)); t.set(2, 3, [0, 0, 0], 0); t.outline(hex(0x3a2008)); },
  clay_ball: (t) => { t.clear(); blob(t, 8, 8.5, 4.5, 4.2, [hex(0xa8aebc), hex(0xc0c6d4), hex(0x8a90a0)]); t.outline(hex(0x4a4e5a)); },
  snowball: (t) => { t.clear(); blob(t, 8, 8.5, 4.5, 4.5, [hex(0xffffff), hex(0xf0f6fa), hex(0xd0e0ea)]); t.outline(hex(0x7a8a9a)); },
  bread: (t) => { t.clear(); for (let y = 6; y < 12; y++) for (let x = 2; x < 14; x++) { if ((y === 6 || y === 11) && (x < 4 || x > 11)) continue; t.set(x, y, y < 8 ? hex(0xc8902a) : hex(0xe0b050)); } for (let x = 4; x < 12; x += 3) t.set(x, 7, hex(0xf0d080)); t.outline(hex(0x4a2a08)); },
  bucket: (t) => bucket(t, null),
  water_bucket: (t) => bucket(t, hex(0x2f5fd0)),
  lava_bucket: (t) => bucket(t, hex(0xff8a1c)),
  compass: (t) => {
    t.clear();
    const ring = hex(0x4a4a52), face = hex(0xd8d4c8), dark = hex(0x2a2a30), red = hex(0xc4281c), needle = hex(0xe8e8e8);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = dx * dx + dy * dy;
      if (d <= 6.8 * 6.8) t.set(x, y, d >= 5.6 * 5.6 ? ring : face);
    }
    t.set(8, 3, dark); t.set(8, 12, dark); t.set(3, 8, dark); t.set(12, 8, dark);
    t.set(8, 5, red); t.set(8, 6, red); t.set(7, 6, red); t.set(8, 7, red);
    t.set(8, 9, needle); t.set(8, 10, needle); t.set(9, 9, needle);
    t.set(8, 8, hex(0x3a3a3a));
    t.outline(hex(0x1a1a1a));
  },
};
// ---- 战斗与材料 ----
const WOOD = hex(0x8a5a2a), STR = hex(0xe8e8e8);
function bowIcon(t, pull) {
  t.clear();
  // 弓臂（左上到右下的弧）+ 弦
  const arc = [[5, 1], [6, 1], [7, 1], [8, 2], [9, 2], [10, 3], [11, 4], [12, 5], [13, 6], [13, 7], [14, 8], [14, 9], [14, 10]];
  const shift = pull; // 拉弓时弓臂往后弯
  const pts = [];
  for (const [x, y] of arc) pts.push([x, y]);
  for (const [x, y] of arc) pts.push([y, x]);
  for (const [x, y] of pts) { t.set(x - shift, y - shift, WOOD); t.set(x - shift + 1, y - shift, shade(WOOD, 0.7)); }
  t.set(9 - shift, 9 - shift, hex(0x5a3a1a)); t.set(10 - shift, 10 - shift, hex(0x5a3a1a));
  // 两端点 (4,1) 与 (1,4)，拉弓时弦中点往左上方移动
  const p0 = [4 - shift, 1 - shift], p1 = [1 - shift, 4 - shift];
  const mid = [Math.max(0, 2 - pull * 1.5), Math.max(0, 2 - pull * 1.5)];
  for (let i = 0; i <= 8; i++) {
    const a = i / 8;
    const x = a < 0.5 ? p0[0] + (mid[0] - p0[0]) * a * 2 : mid[0] + (p1[0] - mid[0]) * (a - 0.5) * 2;
    const y = a < 0.5 ? p0[1] + (mid[1] - p0[1]) * a * 2 : mid[1] + (p1[1] - mid[1]) * (a - 0.5) * 2;
    t.set(Math.round(x), Math.round(y), STR);
  }
  if (pull > 0) { // 搭在弦上的箭
    for (let i = 0; i < 7 + pull; i++) t.set(Math.round(mid[0]) + 2 + i, Math.round(mid[1]) + 2 + i, hex(0x9a7a4a));
    const hx = Math.round(mid[0]) + 9 + pull, hy = Math.round(mid[1]) + 9 + pull;
    t.set(hx, hy, hex(0xb0b0b0)); t.set(hx - 1, hy, hex(0x808080)); t.set(hx, hy - 1, hex(0x808080));
  }
  t.outline(OUT);
}
function armorIcon(t, slot, base) {
  t.clear();
  const T = [
    ['', '', '', '....aaaaaaaa', '...abbbbbbbba', '...abccccccba', '...abc....cba', '...abc....cba', '...aa......aa', ''],
    ['', '..aaa....aaa', '.abba....abba', '.abbbaaaabbba', '.abbbbbbbbbba', '..aabbbbbbaa', '....abbbbba', '....abcbcba', '....abbbbba', '....abcbcba', '....abbbbba', '....abbbbba', '....aaaaaaa'],
    ['', '', '...aaaaaaaaa', '...abbbbbbba', '...abbccbbba', '...abba.abba', '...abba.abba', '...abba.abba', '...abba.abba', '...abba.abba', '...abba.abba', '...aaaa.aaaa'],
    ['', '', '', '', '', '', '...aaa..aaa', '...aba..aba', '...aba..aba', '..abba..abba', '.abbba..abbba', '.aaaaa..aaaaa'],
  ][slot];
  t.template(T, { a: shade(base, 0.55), b: base, c: shade(base, 1.25) });
  // 高光
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = t.get(x, y); if (c[3] && c[0] === base[0] && t.r() < 0.12) t.set(x, y, shade(base, 1.15)); }
  t.outline(OUT);
}
Object.assign(ITEM_DRAW, {
  bow: (t) => bowIcon(t, 0),
  bow_pulling_0: (t) => bowIcon(t, 1),
  bow_pulling_1: (t) => bowIcon(t, 2),
  bow_pulling_2: (t) => bowIcon(t, 3),
  arrow: (t) => {
    t.clear();
    for (let i = 0; i < 10; i++) t.set(3 + i, 12 - i, hex(0x8a6a3a));
    t.set(12, 2, hex(0xd0d0d0)); t.set(13, 2, hex(0x9a9a9a)); t.set(12, 3, hex(0x9a9a9a)); t.set(13, 1, hex(0xe8e8e8)); t.set(11, 2, hex(0xb0b0b0)); t.set(12, 1, hex(0xb0b0b0));
    for (const [x, y] of [[2, 11], [3, 11], [1, 12], [2, 12], [4, 13], [4, 12], [3, 13], [2, 14]]) t.set(x, y, hex(0xf0f0f0));
    t.outline(OUT);
  },
  string: (t) => { t.clear(); let x = 3, y = 3; for (let i = 0; i < 14; i++) { t.set(x, y, STR); x += i % 3 === 2 ? 0 : 1; y += i % 3 === 1 ? 0 : 1; if (x > 12) x = 12; } for (let i = 0; i < 5; i++) t.set(9 - i, 12 + (i % 2), STR); t.outline(hex(0x6a6a6a)); },
  feather: (t) => { t.clear(); for (let i = 0; i < 11; i++) { t.set(3 + i, 13 - i, hex(0xb0b0b0)); for (let k = 1; k < Math.min(4, 1 + (i > 2 ? 3 : 1)); k++) { t.set(3 + i - k, 13 - i - k + 1, hex(0xf6f6f6)); t.set(3 + i + k, 13 - i + k - 1, hex(0xe0e0e0)); } } t.outline(hex(0x5a5a5a)); },
  gunpowder: (t) => { t.clear(); blob(t, 8, 9, 5.5, 4.5, [hex(0x5a5a5a), hex(0x6e6e6e), hex(0x404040), hex(0x858585)]); for (let i = 0; i < 12; i++) t.set(3 + Math.floor(t.r() * 10), 5 + Math.floor(t.r() * 8), t.r() < 0.5 ? hex(0x2a2a2a) : hex(0x9a9a9a)); t.outline(hex(0x1a1a1a)); },
  bone: (t) => { t.clear(); const c = hex(0xe8e4d0); for (let i = 0; i < 9; i++) { t.set(4 + i, 11 - i, c); t.set(5 + i, 11 - i, shade(c, 0.85)); } for (const [x, y] of [[2, 11], [3, 13], [2, 12], [3, 12], [4, 13], [12, 2], [13, 3], [14, 3], [13, 4], [12, 1]]) t.set(x, y, c); t.outline(hex(0x5a5440)); },
  bone_meal: (t) => { t.clear(); for (let i = 0; i < 30; i++) { const x = 4 + Math.floor(t.r() * 8), y = 5 + Math.floor(t.r() * 8); t.set(x, y, t.r() < 0.4 ? hex(0xffffff) : hex(0xd8d4c0)); } t.outline(hex(0x6a6650)); },
  wheat_seeds: (t) => { t.clear(); for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(t.r() * 9), y = 4 + Math.floor(t.r() * 8); t.set(x, y, hex(0x5aa02a)); t.set(x + 1, y + 1, hex(0x3a7a1a)); } t.outline(hex(0x1a3a0a)); },
  wheat: (t) => { t.clear(); for (const dx of [0, 2, 4]) { for (let i = 0; i < 8; i++) t.set(3 + dx + i, 14 - i, hex(0xb08a2a)); for (let k = 0; k < 4; k++) { t.set(10 + dx - k, 2 + k + dx / 2, hex(0xe0c050)); t.set(11 + dx - k, 3 + k + dx / 2, hex(0xc8a03a)); } } t.outline(hex(0x4a3a0a)); },
  chicken: (t) => meat(t, hex(0xf0c0a8), hex(0xfadad0)),
  cooked_chicken: (t) => meat(t, hex(0xc88a4a), hex(0xe8b070)),
  oak_door: (t) => { t.clear(); const b = C.oakPlank; for (let y = 1; y < 15; y++) for (let x = 4; x < 12; x++) t.set(x, y, shade(b, 0.88 + t.r() * 0.15)); t.rect(5, 2, 2, 3, hex(0x2a1e10)); t.rect(9, 2, 2, 3, hex(0x2a1e10)); for (let x = 4; x < 12; x++) t.set(x, 7, shade(b, 0.6)); t.set(10, 9, hex(0x3a3a3a)); t.outline(OUT); },
  red_bed: (t) => bedIcon(t, BED_COL.red),
  white_bed: (t) => bedIcon(t, BED_COL.white),
});
function bedIcon(t, bc) {
  t.clear();
  for (let x = 1; x < 15; x++) for (let y = 7; y < 11; y++) t.set(x, y, y < 9 ? shade(bc, 0.9 + t.r() * 0.15) : shade(hex(0x7a5530), 0.9));
  t.rect(1, 5, 4, 3, hex(0xf2f2f2)); t.rect(5, 6, 10, 1, shade(bc, 1.1));
  t.rect(1, 11, 2, 2, hex(0x5a3a1a)); t.rect(13, 11, 2, 2, hex(0x5a3a1a));
  t.outline(OUT);
}
for (const m of ARMOR_MATS) for (let si = 0; si < 4; si++) ITEM_DRAW[`${m.key}_${ARMOR_SLOTS[si].key}`] = (t) => armorIcon(t, si, hex(m.color));
function bucket(t, fill) {
  t.clear();
  const m = hex(0xb8b8b8), dk = hex(0x6a6a6a), hi = hex(0xe8e8e8);
  for (let y = 5; y < 14; y++) { const inset = Math.floor((y - 5) / 4); for (let x = 3 + inset; x <= 12 - inset; x++) t.set(x, y, x === 3 + inset ? hi : x === 12 - inset ? dk : m); }
  for (let x = 3; x <= 12; x++) { t.set(x, 4, dk); t.set(x, 5, fill || hex(0x3a3a3a)); }
  if (fill) for (let x = 4; x <= 11; x++) t.set(x, 6, shade(fill, 0.85));
  for (let x = 4; x <= 11; x++) t.set(x, 2, dk); t.set(3, 3, dk); t.set(12, 3, dk);
  t.outline(hex(0x2a2a2a));
}

// ---------- 生成 ----------
export const MISSING = [];
export function buildTextures() {
  const tiles = [];
  for (const name of TILES) {
    const t = new Tex(name);
    if (name.startsWith('item_')) {
      const key = name.slice(5);
      const m = key.match(/^(wooden|stone|iron|golden|diamond)_(pickaxe|axe|shovel|sword|hoe)$/);
      if (m) toolIcon(t, m[2], m[1]);
      else if (ITEM_DRAW[key]) ITEM_DRAW[key](t);
      else { t.noise([255, 0, 255]); MISSING.push(name); }
    } else if (DRAW[name]) DRAW[name](t);
    else { t.noise([255, 0, 255]); MISSING.push(name); }
    tiles.push(t.d);
  }
  return tiles;
}

// 每个 tile 的 canvas（用于 UI 图标/粒子）
export function tileCanvases(tiles) {
  return tiles.map((d) => {
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), S, S), 0, 0);
    return c;
  });
}

// 非完整方块（台阶、楼梯、钟…）的等距图标：逐个盒子绘制顶面、+z 面、+x 面
function isoModel(g, tileCv, boxes, size) {
  const k = size / 32;
  const list = boxes.map((bx) => ({ b: bx.b.map((v) => v * 16), t: bx.t })).sort((p, q) => (p.b[0] + p.b[3] + p.b[2] + p.b[5] + p.b[1] + p.b[4]) - (q.b[0] + q.b[3] + q.b[2] + q.b[5] + q.b[1] + q.b[4]));
  const draw = (img, m, sx, sy, sw, sh, br) => {
    if (!img || sw <= 0 || sh <= 0) return;
    const tmp = document.createElement('canvas'); tmp.width = size; tmp.height = size;
    const tg = tmp.getContext('2d'); tg.imageSmoothingEnabled = false;
    tg.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    tg.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = `rgba(0,0,0,${1 - br})`; tg.fillRect(0, 0, size, size);
    g.drawImage(tmp, 0, 0);
  };
  for (const { b, t } of list) {
    const [x0, y0, z0, x1, y1, z1] = b;
    draw(tileCv[t[4]], [0.875, 0.4375, 0, 1, 16 - 0.875 * z1, 1.5 + 0.4375 * z1], x0, 16 - y1, x1 - x0, y1 - y0, 0.8);
    draw(tileCv[t[0]], [0.875, -0.4375, 0, 1, 2 + 0.875 * x1, 8.5 + 0.4375 * x1], 16 - z1, 16 - y1, z1 - z0, y1 - y0, 0.62);
    draw(tileCv[t[2]], [0.875, 0.4375, -0.875, 0.4375, 16, 17.5 - y1], x0, z0, x1 - x0, z1 - z0, 1);
  }
}
// 物品图标（dataURL，等距方块或平面图标）
export function buildIcons(tileCv) {
  const icons = new Map();
  const size = 48;
  for (const [id, d] of ITEMS) {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    if (d.isBlock && (SHAPE[id] === SHAPES.CUBE || SHAPE[id] === SHAPES.CACTUS)) {
      const top = tileCv[FACE_TILES[id * 6 + 2]], left = tileCv[FACE_TILES[id * 6 + 4]], right = tileCv[FACE_TILES[id * 6 + 0]];
      const k = size / 32;
      const face = (img, m, br) => {
        g.save(); g.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
        g.drawImage(img, 0, 0);
        if (br < 1) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(0,0,0,${1 - br})`; g.fillRect(0, 0, 16, 16); }
        g.restore();
      };
      // 先画到临时画布避免 source-atop 影响已绘制部分
      const layer = (img, m, br) => {
        const tmp = document.createElement('canvas'); tmp.width = size; tmp.height = size;
        const tg = tmp.getContext('2d'); tg.imageSmoothingEnabled = false;
        tg.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
        tg.drawImage(img, 0, 0);
        tg.setTransform(1, 0, 0, 1, 0, 0);
        tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = `rgba(0,0,0,${1 - br})`; tg.fillRect(0, 0, size, size);
        g.drawImage(tmp, 0, 0);
      };
      void face;
      layer(top, [0.875, 0.4375, -0.875, 0.4375, 16, 1.5], 1);
      layer(left, [0.875, 0.4375, 0, 1.0, 2, 8.5], 0.8);
      layer(right, [0.875, -0.4375, 0, 1.0, 16, 15.5], 0.62);
    } else if (d.isBlock && MODELS[id]) {
      isoModel(g, tileCv, MODELS[BLOCKS[id].stairs ? id + 2 : id], size);
    } else {
      const ti = d.isBlock ? FACE_TILES[id * 6 + 4] : TILES.indexOf('item_' + d.icon);
      g.drawImage(tileCv[ti], 0, 0, S, S, 0, 0, size, size);
    }
    icons.set(id, cv.toDataURL());
  }
  return icons;
}
