// 方块 / 物品 / 合成配方注册表（主线程与 Worker 共用，不能依赖 DOM）
export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA = 62;

// ---------------- 纹理 tile ----------------
export const TILES = [];
const tileIndex = new Map();
export function tile(name) {
  if (!tileIndex.has(name)) { tileIndex.set(name, TILES.length); TILES.push(name); }
  return tileIndex.get(name);
}

// ---------------- 方块 ----------------
export const BLOCKS = new Array(256).fill(null);
export const B = {};
// 预计算的快速查询表（Worker 网格化时使用）
export const OPAQUE = new Uint8Array(256);     // 完整不透明立方体（遮挡相邻面，AO）
export const SOLID = new Uint8Array(256);      // 有碰撞
export const LIGHT_OPACITY = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const SHAPE = new Uint8Array(256);      // 0 无 1 方块 2 交叉 3 火把 4 液体 5 仙人掌 6 墙上火把
export const RENDER = new Uint8Array(256);     // 0 不透明 1 镂空 2 半透明
export const FACE_TILES = new Int16Array(256 * 6); // +x -x +y -y +z -z
export const SHAPES = { NONE: 0, CUBE: 1, CROSS: 2, TORCH: 3, LIQUID: 4, CACTUS: 5, WALL_TORCH: 6, MODEL: 7 };
// 非完整方块的模型：MODELS[id] = [{ b:[x0,y0,z0,x1,y1,z1](世界朝向, 0..1), t:[6 个 tile，按世界面 +x -x +y -y +z -z], rot }]
export const MODELS = new Array(256).fill(null);
// 碰撞箱 / 选择框（0..1 方块坐标）；null 表示完整方块（或无碰撞，取决于 SOLID）
export const COLLIDE = new Array(256).fill(null);
export const SELECT = new Array(256).fill(null);

function defBlock(id, key, p) {
  const d = Object.assign({
    id, key, name: key, hardness: 1, tool: null, tier: -1, requiresTool: false,
    solid: true, opaque: true, render: 'opaque', shape: 'cube', light: 0, sound: 'stone',
    replaceable: false, gravity: false, liquid: null, level: 0, drops: undefined,
    tab: 'building', item: id, interact: null, needsSupport: null, flammable: false,
  }, p);
  if (d.resistance === undefined) d.resistance = d.hardness < 0 ? 3600000 : d.hardness;
  if (d.lightOpacity === undefined) d.lightOpacity = d.opaque ? 15 : 0;
  const t = d.tex || {};
  const all = t.all;
  const side = t.side || all, top = t.top || all, bottom = t.bottom || t.top || all;
  // 朝向：front 面
  const faces = [t.px || side, t.nx || side, top, bottom, t.pz || side, t.nz || side];
  for (let f = 0; f < 6; f++) FACE_TILES[id * 6 + f] = faces[f] ? tile(faces[f]) : 0;
  d.icon = t.icon || top || side;
  BLOCKS[id] = d; B[key] = id;
  OPAQUE[id] = d.opaque ? 1 : 0;
  SOLID[id] = d.solid ? 1 : 0;
  LIGHT_OPACITY[id] = d.lightOpacity;
  LIGHT_EMIT[id] = d.light;
  SHAPE[id] = SHAPES[d.shape.toUpperCase()] ?? 1;
  RENDER[id] = d.render === 'cutout' ? 1 : d.render === 'translucent' ? 2 : 0;
  return d;
}

defBlock(0, 'air', { name: '空气', solid: false, opaque: false, shape: 'none', replaceable: true, hardness: 0, item: 0 });
defBlock(1, 'stone', { name: '石头', tex: { all: 'stone' }, hardness: 1.5, tool: 'pickaxe', tier: 0, requiresTool: true, drops: 'cobblestone' });
defBlock(2, 'grass_block', { name: '草方块', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', sound: 'grass', drops: 'dirt' });
defBlock(3, 'dirt', { name: '泥土', tex: { all: 'dirt' }, hardness: 0.5, tool: 'shovel', sound: 'gravel' });
defBlock(4, 'cobblestone', { name: '圆石', tex: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(5, 'oak_planks', { name: '橡木木板', tex: { all: 'oak_planks' }, hardness: 2, tool: 'axe', sound: 'wood', flammable: true });
defBlock(6, 'bedrock', { name: '基岩', tex: { all: 'bedrock' }, hardness: -1 });
defBlock(7, 'sand', { name: '沙子', tex: { all: 'sand' }, hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
defBlock(8, 'gravel', { name: '沙砾', tex: { all: 'gravel' }, hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true, drops: (r) => (r() < 0.1 ? 'flint' : 'gravel') });
defBlock(9, 'oak_log', { name: '橡木原木', tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
defBlock(10, 'oak_leaves', { name: '橡树树叶', tex: { all: 'oak_leaves' }, hardness: 0.2, tool: 'hoe', opaque: false, render: 'cutout', lightOpacity: 1, sound: 'grass', tab: 'deco',
  drops: (r) => { const x = r(); return x < 0.05 ? 'oak_sapling' : x < 0.07 ? 'stick' : x < 0.075 ? 'apple' : null; } });
defBlock(11, 'birch_log', { name: '白桦原木', tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
defBlock(12, 'birch_leaves', { name: '白桦树叶', tex: { all: 'birch_leaves' }, hardness: 0.2, tool: 'hoe', opaque: false, render: 'cutout', lightOpacity: 1, sound: 'grass', tab: 'deco',
  drops: (r) => { const x = r(); return x < 0.05 ? 'birch_sapling' : x < 0.07 ? 'stick' : null; } });
defBlock(13, 'spruce_log', { name: '云杉原木', tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
defBlock(14, 'spruce_leaves', { name: '云杉树叶', tex: { all: 'spruce_leaves' }, hardness: 0.2, tool: 'hoe', opaque: false, render: 'cutout', lightOpacity: 1, sound: 'grass', tab: 'deco',
  drops: (r) => { const x = r(); return x < 0.05 ? 'spruce_sapling' : x < 0.07 ? 'stick' : null; } });
defBlock(15, 'coal_ore', { name: '煤矿石', tex: { all: 'coal_ore' }, hardness: 3, tool: 'pickaxe', tier: 0, requiresTool: true, drops: 'coal' });
defBlock(16, 'iron_ore', { name: '铁矿石', tex: { all: 'iron_ore' }, hardness: 3, tool: 'pickaxe', tier: 1, requiresTool: true });
defBlock(17, 'gold_ore', { name: '金矿石', tex: { all: 'gold_ore' }, hardness: 3, tool: 'pickaxe', tier: 2, requiresTool: true });
defBlock(18, 'diamond_ore', { name: '钻石矿石', tex: { all: 'diamond_ore' }, hardness: 3, tool: 'pickaxe', tier: 2, requiresTool: true, drops: 'diamond' });
defBlock(19, 'redstone_ore', { name: '红石矿石', tex: { all: 'redstone_ore' }, hardness: 3, tool: 'pickaxe', tier: 2, requiresTool: true, drops: (r) => ['redstone', 4 + Math.floor(r() * 2)] });
defBlock(20, 'glass', { name: '玻璃', tex: { all: 'glass' }, hardness: 0.3, opaque: false, render: 'cutout', sound: 'glass', drops: null });
defBlock(21, 'sandstone', { name: '砂岩', tex: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_bottom' }, hardness: 0.8, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(22, 'snowy_grass_block', { name: '覆雪草方块', tex: { top: 'snow', side: 'grass_side_snowed', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', sound: 'snow', drops: 'dirt' });
defBlock(23, 'snow_block', { name: '雪块', tex: { all: 'snow' }, hardness: 0.2, tool: 'shovel', requiresTool: true, tier: 0, sound: 'snow', drops: (r) => ['snowball', 4] });
defBlock(24, 'ice', { name: '冰', tex: { all: 'ice' }, hardness: 0.5, tool: 'pickaxe', opaque: false, render: 'translucent', lightOpacity: 1, sound: 'glass', drops: null, slippery: 0.98 });
defBlock(25, 'cactus', { name: '仙人掌', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_bottom' }, hardness: 0.4, opaque: false, render: 'cutout', shape: 'cactus', sound: 'cloth', tab: 'deco', needsSupport: 'cactus' });
defBlock(26, 'short_grass', { name: '草', tex: { all: 'short_grass' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', replaceable: true, tab: 'deco', needsSupport: 'soil', drops: (r) => (r() < 0.125 ? ['wheat_seeds', 1] : null) });
defBlock(27, 'dandelion', { name: '蒲公英', tex: { all: 'dandelion' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', tab: 'deco', needsSupport: 'soil' });
defBlock(28, 'poppy', { name: '虞美人', tex: { all: 'poppy' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', tab: 'deco', needsSupport: 'soil' });
defBlock(29, 'dead_bush', { name: '枯萎的灌木', tex: { all: 'dead_bush' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', replaceable: true, tab: 'deco', needsSupport: 'sand', drops: (r) => ['stick', Math.floor(r() * 3)] });
defBlock(30, 'torch', { name: '火把', tex: { all: 'torch' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'torch', light: 14, sound: 'wood', tab: 'deco', needsSupport: 'below' });
defBlock(31, 'crafting_table', { name: '工作台', tex: { top: 'crafting_table_top', side: 'crafting_table_side', px: 'crafting_table_front', nz: 'crafting_table_front', bottom: 'oak_planks' }, hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'crafting', tab: 'deco' });
defBlock(32, 'bricks', { name: '砖块', tex: { all: 'bricks' }, hardness: 2, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(33, 'stone_bricks', { name: '石砖', tex: { all: 'stone_bricks' }, hardness: 1.5, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(34, 'obsidian', { name: '黑曜石', tex: { all: 'obsidian' }, hardness: 50, tool: 'pickaxe', tier: 3, requiresTool: true });
defBlock(35, 'birch_planks', { name: '白桦木板', tex: { all: 'birch_planks' }, hardness: 2, tool: 'axe', sound: 'wood' });
defBlock(36, 'spruce_planks', { name: '云杉木板', tex: { all: 'spruce_planks' }, hardness: 2, tool: 'axe', sound: 'wood' });
defBlock(37, 'white_wool', { name: '白色羊毛', tex: { all: 'white_wool' }, hardness: 0.8, sound: 'cloth', tab: 'deco' });
defBlock(38, 'bookshelf', { name: '书架', tex: { top: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', drops: null, tab: 'deco' });
defBlock(39, 'clay', { name: '黏土块', tex: { all: 'clay' }, hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: (r) => ['clay_ball', 4] });
defBlock(40, 'oak_sapling', { name: '橡树树苗', tex: { all: 'oak_sapling' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', tab: 'deco', needsSupport: 'soil', sapling: 'oak' });
defBlock(41, 'birch_sapling', { name: '白桦树苗', tex: { all: 'birch_sapling' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', tab: 'deco', needsSupport: 'soil', sapling: 'birch' });
defBlock(42, 'spruce_sapling', { name: '云杉树苗', tex: { all: 'spruce_sapling' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', tab: 'deco', needsSupport: 'soil', sapling: 'spruce' });
defBlock(43, 'iron_block', { name: '铁块', tex: { all: 'iron_block' }, hardness: 5, tool: 'pickaxe', tier: 1, requiresTool: true, sound: 'metal' });
defBlock(44, 'gold_block', { name: '金块', tex: { all: 'gold_block' }, hardness: 3, tool: 'pickaxe', tier: 2, requiresTool: true, sound: 'metal' });
defBlock(45, 'diamond_block', { name: '钻石块', tex: { all: 'diamond_block' }, hardness: 5, tool: 'pickaxe', tier: 2, requiresTool: true, sound: 'metal' });
defBlock(46, 'coal_block', { name: '煤炭块', tex: { all: 'coal_block' }, hardness: 5, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(47, 'mossy_cobblestone', { name: '苔石', tex: { all: 'mossy_cobblestone' }, hardness: 2, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(48, 'glowstone', { name: '荧石', tex: { all: 'glowstone' }, hardness: 0.3, light: 15, sound: 'glass', tab: 'deco' });
defBlock(49, 'red_wool', { name: '红色羊毛', tex: { all: 'red_wool' }, hardness: 0.8, sound: 'cloth', tab: 'deco' });
defBlock(50, 'yellow_wool', { name: '黄色羊毛', tex: { all: 'yellow_wool' }, hardness: 0.8, sound: 'cloth', tab: 'deco' });
defBlock(51, 'lime_wool', { name: '黄绿色羊毛', tex: { all: 'lime_wool' }, hardness: 0.8, sound: 'cloth', tab: 'deco' });
defBlock(52, 'blue_wool', { name: '蓝色羊毛', tex: { all: 'blue_wool' }, hardness: 0.8, sound: 'cloth', tab: 'deco' });
defBlock(53, 'black_wool', { name: '黑色羊毛', tex: { all: 'black_wool' }, hardness: 0.8, sound: 'cloth', tab: 'deco' });
defBlock(54, 'smooth_stone', { name: '平滑石头', tex: { all: 'smooth_stone' }, hardness: 2, tool: 'pickaxe', tier: 0, requiresTool: true });
defBlock(55, 'pumpkin', { name: '南瓜', tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood', tab: 'deco' });


// 爆炸抗性（Java 版数值；未列出的与硬度相同）
for (const [k, r] of Object.entries({ stone: 6, cobblestone: 6, mossy_cobblestone: 6, stone_bricks: 6, bricks: 6, smooth_stone: 6, oak_planks: 3, birch_planks: 3, spruce_planks: 3,
  iron_block: 6, gold_block: 6, diamond_block: 6, coal_block: 6, obsidian: 1200, bedrock: 3600000, glass: 0.3, crafting_table: 2.5 })) BLOCKS[B[k]].resistance = r;

// ---------------- 方块模型工具 ----------------
// 绕 Y 轴旋转一步（+z → -x → -z → +x），局部像素坐标 (x,z) → (16-z, x)
const ROT_FACE = [4, 5, 2, 3, 1, 0]; // 局部面 → 旋转一步后的世界面（+x→+z, -x→-z, +z→-x, -z→+x）
function rotBox(b, r) {
  let [x0, y0, z0, x1, y1, z1] = b;
  for (let i = 0; i < r; i++) { const nx0 = 16 - z1, nx1 = 16 - z0; z0 = x0; z1 = x1; x0 = nx0; x1 = nx1; }
  return [x0, y0, z0, x1, y1, z1];
}
function rotTiles(t, r) {
  let cur = t.slice();
  for (let i = 0; i < r; i++) { const n = new Array(6); for (let f = 0; f < 6; f++) n[ROT_FACE[f]] = cur[f]; cur = n; }
  return cur;
}
// boxes: [{ b:[像素], t: 字符串 | [6 个局部面 tile 名] | {top,bottom,side,...} }]
function faceNames(t) {
  if (typeof t === 'string') return [t, t, t, t, t, t];
  if (Array.isArray(t)) return t;
  const side = t.side || t.all, top = t.top || t.all, bottom = t.bottom || t.top || t.all;
  return [t.px || side, t.nx || side, top, bottom, t.pz || side, t.nz || side];
}
function setModel(id, boxes, rot = 0, collide, select) {
  MODELS[id] = boxes.map((bx) => ({
    b: rotBox(bx.b, rot).map((v) => v / 16),
    t: rotTiles(faceNames(bx.t).map((n) => (n ? tile(n) : -1)), rot),
    rot,
  }));
  const toUnits = (list) => list.map((b) => rotBox(b, rot).map((v) => v / 16));
  COLLIDE[id] = collide === null ? [] : toUnits(collide || boxes.map((x) => x.b));
  SELECT[id] = toUnits(select || boxes.map((x) => x.b));
}

// 朝向方块：furnace(4 朝向) / lit furnace / chest。front 面朝向：0:+z(南) 1:-x(西) 2:-z(北) 3:+x(东)
export const FACING_DIRS = [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]];
const facingKey = ['pz', 'nx', 'nz', 'px'];
function defFacing(baseId, key, name, frontTex, sideTex, topTex, extra) {
  for (let f = 0; f < 4; f++) {
    const tex = { side: sideTex, top: topTex, bottom: topTex };
    tex[facingKey[f]] = frontTex;
    tex.icon = topTex;
    defBlock(baseId + f, f === 0 ? key : key + '_' + f, Object.assign({ name, tex, facing: f, baseKey: key, item: extra.itemBase ?? baseId }, extra));
  }
}
defFacing(100, 'furnace', '熔炉', 'furnace_front', 'furnace_side', 'furnace_top', { hardness: 3.5, tool: 'pickaxe', tier: 0, requiresTool: true, interact: 'furnace', tab: 'deco' });
defFacing(104, 'lit_furnace', '熔炉', 'furnace_front_on', 'furnace_side', 'furnace_top', { hardness: 3.5, tool: 'pickaxe', tier: 0, requiresTool: true, interact: 'furnace', light: 13, itemBase: 100, drops: 'furnace', tab: null });
defFacing(108, 'chest', '箱子', 'chest_front', 'chest_side', 'chest_top', { hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'chest', tab: 'deco' });
// 墙上火把：朝向表示火把倚靠的墙在哪个方向
for (let f = 0; f < 4; f++) defBlock(112 + f, 'wall_torch_' + f, { name: '火把', tex: { all: 'torch' }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'wall_torch', light: 14, sound: 'wood', facing: f, item: 30, drops: 'torch', tab: null, needsSupport: 'wall' });

// ---------------- 1.x 新内容：耕地、土径、小麦、蜘蛛网、钟、床、台阶、楼梯、门 ----------------
defBlock(56, 'dirt_path', { name: '土径', tex: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' }, hardness: 0.65, tool: 'shovel', sound: 'gravel', opaque: false, shape: 'model', lightOpacity: 15, drops: 'dirt' });
setModel(56, [{ b: [0, 0, 0, 16, 15, 16], t: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' } }]);
defBlock(57, 'farmland', { name: '耕地', tex: { top: 'farmland_top', side: 'dirt', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', sound: 'gravel', opaque: false, shape: 'model', lightOpacity: 15, drops: 'dirt', tab: null });
setModel(57, [{ b: [0, 0, 0, 16, 15, 16], t: { top: 'farmland_top', side: 'dirt', bottom: 'dirt' } }]);
for (let a = 0; a < 8; a++) {
  defBlock(58 + a, 'wheat_' + a, { name: '小麦', tex: { all: 'wheat_stage_' + a }, hardness: 0, solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'grass', tab: null, item: 0, age: a, crop: true, needsSupport: 'farmland',
    drops: a === 7 ? (r) => [['wheat', 1], ['wheat_seeds', 1 + [0, 1, 2].reduce((n) => n + (r() < 0.5714 ? 1 : 0), 0)]] : 'wheat_seeds' });
}
defBlock(66, 'cobweb', { name: '蜘蛛网', tex: { all: 'cobweb' }, hardness: 4, tool: 'sword', solid: false, opaque: false, render: 'cutout', shape: 'cross', sound: 'cloth', tab: 'deco', web: true, resistance: 4,
  drops: (r, tool) => (tool && tool.type === 'sword' ? 'string' : null) });
for (let f = 0; f < 4; f++) {
  defBlock(f === 0 ? 67 : 116 + f - 1, f === 0 ? 'bell' : 'bell_' + f, { name: '钟', tex: { all: 'gold_block', icon: 'gold_block' }, hardness: 5, tool: 'pickaxe', sound: 'metal', opaque: false, shape: 'model', lightOpacity: 0, facing: f, baseKey: 'bell', item: 67, tab: f === 0 ? 'deco' : null, interact: 'bell', resistance: 5 });
  setModel(f === 0 ? 67 : 116 + f - 1, [
    { b: [0, 0, 6, 2, 16, 10], t: 'stone' }, { b: [14, 0, 6, 16, 16, 10], t: 'stone' }, { b: [2, 13, 7, 14, 15, 9], t: 'spruce_log' },
    { b: [5, 6, 5, 11, 13, 11], t: 'bell_body' }, { b: [4, 4, 4, 12, 6, 12], t: 'bell_body' },
  ], f, [[0, 0, 6, 2, 16, 10], [14, 0, 6, 16, 16, 10], [4, 4, 4, 12, 13, 12]]);
}
export const BELL_IDS = [67, 116, 117, 118];
// 床：68 + 颜色*8 + 朝向*2 + (床头?1:0)；朝向为玩家放置时的视线方向，床头位于朝向一侧
export const BED_COLORS = [['red', '红色'], ['white', '白色']];
BED_COLORS.forEach(([c, cn], ci) => {
  for (let f = 0; f < 4; f++) for (let head = 0; head < 2; head++) {
    const id = 68 + ci * 8 + f * 2 + head;
    const part = head ? 'head' : 'foot';
    defBlock(id, `${c}_bed_${part}_${f}`, { name: `${cn}的床`, tex: { all: `bed_${c}_${part}_top`, icon: `bed_${c}_${part}_top` }, hardness: 0.2, sound: 'wood', opaque: false, shape: 'model', lightOpacity: 0,
      facing: f, bed: { color: c, head: !!head }, tab: null, item: 0, drops: `${c}_bed`, interact: 'bed', resistance: 0.2 });
    const legZ = head ? 13 : 0; // 床腿在外侧的两角
    const endT = `bed_${c}_${part}_end`, sideT = `bed_${c}_${part}_side`;
    setModel(id, [
      { b: [0, 3, 0, 16, 9, 16], t: [sideT, sideT, `bed_${c}_${part}_top`, 'oak_planks', head ? endT : sideT, head ? sideT : endT] },
      { b: [0, 0, legZ, 3, 3, legZ + 3], t: 'bed_leg' }, { b: [13, 0, legZ, 16, 3, legZ + 3], t: 'bed_leg' },
    ], f, [[0, 0, 0, 16, 9, 16]], [[0, 0, 0, 16, 9, 16]]);
  }
});
export function isBed(id) { return id >= 68 && id <= 83; }

// 台阶 / 楼梯材料
export const SS_MATS = [
  { key: 'oak', name: '橡木', base: 'oak_planks', slab: '橡木台阶', stairs: '橡木楼梯', hardness: 2, resistance: 3, tool: 'axe', sound: 'wood', tier: -1, requiresTool: false },
  { key: 'birch', name: '白桦木', base: 'birch_planks', slab: '白桦木台阶', stairs: '白桦木楼梯', hardness: 2, resistance: 3, tool: 'axe', sound: 'wood', tier: -1, requiresTool: false },
  { key: 'spruce', name: '云杉木', base: 'spruce_planks', slab: '云杉木台阶', stairs: '云杉木楼梯', hardness: 2, resistance: 3, tool: 'axe', sound: 'wood', tier: -1, requiresTool: false },
  { key: 'cobblestone', name: '圆石', base: 'cobblestone', slab: '圆石台阶', stairs: '圆石楼梯', hardness: 2, resistance: 6, tool: 'pickaxe', sound: 'stone', tier: 0, requiresTool: true },
  { key: 'stone', name: '石', base: 'stone', slab: '石台阶', stairs: '石楼梯', hardness: 2, resistance: 6, tool: 'pickaxe', sound: 'stone', tier: 0, requiresTool: true, stairHardness: 1.5 },
  { key: 'stone_brick', name: '石砖', base: 'stone_bricks', slab: '石砖台阶', stairs: '石砖楼梯', hardness: 2, resistance: 6, tool: 'pickaxe', sound: 'stone', tier: 0, requiresTool: true, stairHardness: 1.5 },
  { key: 'sandstone', name: '砂岩', base: 'sandstone', slab: '砂岩台阶', stairs: '砂岩楼梯', hardness: 2, resistance: 6, tool: 'pickaxe', sound: 'stone', tier: 0, requiresTool: true, stairHardness: 0.8, stairRes: 0.8 },
  { key: 'brick', name: '红砖', base: 'bricks', slab: '红砖台阶', stairs: '红砖楼梯', hardness: 2, resistance: 6, tool: 'pickaxe', sound: 'stone', tier: 0, requiresTool: true },
];
const FACE_NAMES = (key) => { const b = BLOCKS[B[key]]; const t = b.tex || {}; const side = t.side || t.all, top = t.top || t.all, bottom = t.bottom || t.top || t.all; return { side, top, bottom }; };
// 台阶：135 + m*3 + (0 下半 / 1 上半 / 2 双层)
export const SLAB_BASE = 135, STAIRS_BASE = 159;
SS_MATS.forEach((m, mi) => {
  const fn = FACE_NAMES(m.base);
  const common = { hardness: m.hardness, resistance: m.resistance, tool: m.tool, sound: m.sound, tier: m.tier, requiresTool: m.requiresTool, flammable: m.sound === 'wood' };
  const id0 = SLAB_BASE + mi * 3;
  defBlock(id0, `${m.key}_slab`, Object.assign({ name: m.slab, tex: { ...fn, icon: fn.top }, opaque: false, shape: 'model', lightOpacity: 15, slab: { mat: mi, half: 0 } }, common));
  setModel(id0, [{ b: [0, 0, 0, 16, 8, 16], t: fn }]);
  defBlock(id0 + 1, `${m.key}_slab_top`, Object.assign({ name: m.slab, tex: { ...fn, icon: fn.top }, opaque: false, shape: 'model', lightOpacity: 15, slab: { mat: mi, half: 1 }, item: id0, tab: null }, common));
  setModel(id0 + 1, [{ b: [0, 8, 0, 16, 16, 16], t: fn }]);
  defBlock(id0 + 2, `${m.key}_slab_double`, Object.assign({ name: m.slab, tex: { ...fn }, slab: { mat: mi, half: 2 }, item: id0, tab: null, drops: [`${m.key}_slab`, 2] }, common));
  // 楼梯：159 + m*8 + 上下*4 + 朝向（朝向 = 玩家视线方向，高的一侧在朝向方向）
  for (let half = 0; half < 2; half++) for (let f = 0; f < 4; f++) {
    const id = STAIRS_BASE + mi * 8 + half * 4 + f;
    defBlock(id, half === 0 && f === 0 ? `${m.key}_stairs` : `${m.key}_stairs_${half}_${f}`, Object.assign({}, common, {
      name: m.stairs, tex: { ...fn, icon: fn.top }, opaque: false, shape: 'model', lightOpacity: 15, facing: f, stairs: { mat: mi, half }, item: STAIRS_BASE + mi * 8,
      tab: half === 0 && f === 0 ? 'building' : null, hardness: m.stairHardness ?? m.hardness, resistance: m.stairRes ?? m.resistance }));
    // 局部朝向 +z（南）：下半台阶 + 南半部分的上层
    const slabBox = half ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
    const stepBox = half ? [0, 0, 8, 16, 8, 16] : [0, 8, 8, 16, 16, 16];
    setModel(id, [{ b: slabBox, t: fn }, { b: stepBox, t: fn }], f);
  }
});
export function slabInfo(id) { const b = BLOCKS[id]; return b && b.slab; }
// 门：223 + 上半*16 + 打开*8 + 铰链右*4 + 朝向
export const DOOR_BASE = 223;
export function doorId(upper, open, right, f) { return DOOR_BASE + (upper ? 16 : 0) + (open ? 8 : 0) + (right ? 4 : 0) + f; }
export function isDoor(id) { return id >= DOOR_BASE && id < DOOR_BASE + 32; }
export function doorState(id) { const k = id - DOOR_BASE; return { upper: !!(k & 16), open: !!(k & 8), right: !!(k & 4), facing: k & 3 }; }
{
  // Java DoorBlock.getShape：S_AABB z0-3、N_AABB z13-16、W_AABB x13-16、E_AABB x0-3
  const AABB = { S: [0, 0, 0, 16, 16, 3], N: [0, 0, 13, 16, 16, 16], W: [13, 0, 0, 16, 16, 16], E: [0, 0, 0, 3, 16, 16] };
  const shape = (f, open, right) => {
    const dir = ['S', 'W', 'N', 'E'][f];
    if (!open) return { S: 'S', W: 'W', N: 'N', E: 'E' }[dir];
    return { E: right ? 'N' : 'S', S: right ? 'E' : 'W', W: right ? 'S' : 'N', N: right ? 'W' : 'E' }[dir];
  };
  for (let up = 0; up < 2; up++) for (let open = 0; open < 2; open++) for (let right = 0; right < 2; right++) for (let f = 0; f < 4; f++) {
    const id = doorId(up, open, right, f);
    const tx = up ? 'oak_door_top' : 'oak_door_bottom';
    defBlock(id, up || open || right || f ? `oak_door_${up}${open}${right}${f}` : 'oak_door_block', { name: '橡木门', tex: { all: tx, icon: tx }, hardness: 3, resistance: 3, tool: 'axe', sound: 'wood', opaque: false, shape: 'model', lightOpacity: 0,
      door: { upper: !!up, open: !!open, right: !!right, facing: f }, tab: null, item: 0, drops: up ? null : 'oak_door', interact: 'door' });
    const box = AABB[shape(f, open, right)];
    setModel(id, [{ b: box, t: tx }]);
  }
}

// 液体：水源 120，流动 121-127(等级1-7)，下落 128；岩浆源 130，流动 131-133，下落 134
defBlock(120, 'water', { name: '水', tex: { all: 'water' }, hardness: 100, solid: false, opaque: false, render: 'translucent', shape: 'liquid', liquid: 'water', level: 0, lightOpacity: 1, replaceable: true, sound: 'water', tab: null, item: 0 });
for (let l = 1; l <= 7; l++) defBlock(120 + l, 'flowing_water_' + l, { name: '水', tex: { all: 'water' }, hardness: 100, solid: false, opaque: false, render: 'translucent', shape: 'liquid', liquid: 'water', level: l, lightOpacity: 1, replaceable: true, tab: null, item: 0 });
defBlock(128, 'falling_water', { name: '水', tex: { all: 'water' }, hardness: 100, solid: false, opaque: false, render: 'translucent', shape: 'liquid', liquid: 'water', level: 8, lightOpacity: 1, replaceable: true, tab: null, item: 0 });
defBlock(130, 'lava', { name: '岩浆', tex: { all: 'lava' }, hardness: 100, solid: false, opaque: false, render: 'opaque', shape: 'liquid', liquid: 'lava', level: 0, light: 15, lightOpacity: 0, replaceable: true, tab: null, item: 0 });
for (let l = 1; l <= 3; l++) defBlock(130 + l, 'flowing_lava_' + l, { name: '岩浆', tex: { all: 'lava' }, hardness: 100, solid: false, opaque: false, render: 'opaque', shape: 'liquid', liquid: 'lava', level: l, light: 15, lightOpacity: 0, replaceable: true, tab: null, item: 0 });
defBlock(134, 'falling_lava', { name: '岩浆', tex: { all: 'lava' }, hardness: 100, solid: false, opaque: false, render: 'opaque', shape: 'liquid', liquid: 'lava', level: 8, light: 15, lightOpacity: 0, replaceable: true, tab: null, item: 0 });

export const WATER = 120, LAVA = 130;
export function isWater(id) { return id >= 120 && id <= 128; }
export function isLava(id) { return id >= 130 && id <= 134; }
export function isLiquid(id) { return id >= 120 && id <= 134 && BLOCKS[id] !== null; }
export const MAX_LEVEL = { water: 7, lava: 3 };
export function liquidId(type, level) {
  const base = type === 'water' ? 120 : 130;
  if (level === 8) return type === 'water' ? 128 : 134;
  return base + level;
}

// 破坏裂纹
for (let i = 0; i < 10; i++) tile('destroy_' + i);
// 拉弓动画与特效粒子
for (let i = 0; i < 3; i++) tile('item_bow_pulling_' + i);
tile('fx_explosion'); tile('fx_smoke'); tile('fx_lightning');

// ---------------- 物品 ----------------
export const ITEMS = new Map(); // id -> def
export const I = {}; // key -> id
for (const b of BLOCKS) {
  if (!b || b.id === 0) continue;
  if (b.item !== b.id) continue;
  if (b.liquid) continue;
  ITEMS.set(b.id, { id: b.id, key: b.baseKey || b.key, name: b.name, block: b.id, maxStack: 64, icon: b.icon, isBlock: true, tab: b.tab, shape: b.shape });
  I[b.baseKey || b.key] = b.id;
}
function defItem(id, key, name, p = {}) {
  const d = Object.assign({ id, key, name, maxStack: 64, icon: key, isBlock: false, tab: 'materials' }, p);
  tile('item_' + d.icon);
  ITEMS.set(id, d); I[key] = id;
  return d;
}
defItem(256, 'stick', '木棍', { fuel: 100 });
defItem(257, 'coal', '煤炭', { fuel: 1600 });
defItem(258, 'charcoal', '木炭', { fuel: 1600 });
defItem(259, 'iron_ingot', '铁锭');
defItem(260, 'gold_ingot', '金锭');
defItem(261, 'diamond', '钻石');
defItem(262, 'redstone', '红石粉');
defItem(263, 'flint', '燧石');
defItem(264, 'apple', '苹果', { food: [4, 2.4], tab: 'food' });
defItem(265, 'porkchop', '生猪排', { food: [3, 1.8], tab: 'food' });
defItem(266, 'cooked_porkchop', '熟猪排', { food: [8, 12.8], tab: 'food' });
defItem(267, 'beef', '生牛肉', { food: [3, 1.8], tab: 'food' });
defItem(268, 'cooked_beef', '牛排', { food: [8, 12.8], tab: 'food' });
defItem(269, 'mutton', '生羊肉', { food: [2, 1.2], tab: 'food' });
defItem(270, 'cooked_mutton', '熟羊肉', { food: [6, 9.6], tab: 'food' });
defItem(271, 'rotten_flesh', '腐肉', { food: [4, 0.8], tab: 'food' });
defItem(272, 'leather', '皮革');
defItem(273, 'clay_ball', '黏土球');
defItem(274, 'brick', '红砖');
defItem(275, 'snowball', '雪球', { maxStack: 16 });
defItem(276, 'bucket', '桶', { maxStack: 16, tab: 'tools', bucket: 'empty' });
defItem(277, 'water_bucket', '水桶', { maxStack: 1, tab: 'tools', bucket: 'water' });
defItem(278, 'lava_bucket', '岩浆桶', { maxStack: 1, tab: 'tools', bucket: 'lava', fuel: 20000 });
defItem(279, 'bread', '面包', { food: [5, 6], tab: 'food' });
defItem(280, 'compass', '指南针', { tab: null });

defItem(281, 'bow', '弓', { maxStack: 1, tab: 'combat', durability: 384, bow: true, fuel: 300 });
defItem(282, 'arrow', '箭', { tab: 'combat' });
defItem(283, 'string', '线');
defItem(284, 'feather', '羽毛');
defItem(285, 'gunpowder', '火药');
defItem(286, 'bone', '骨头');
defItem(287, 'bone_meal', '骨粉', { boneMeal: true });
defItem(288, 'wheat_seeds', '小麦种子', { block: 58, plant: 'farmland' });
defItem(289, 'wheat', '小麦');
defItem(290, 'chicken', '生鸡肉', { food: [2, 1.2], tab: 'food' });
defItem(291, 'cooked_chicken', '熟鸡肉', { food: [6, 7.2], tab: 'food' });
defItem(292, 'oak_door', '橡木门', { block: DOOR_BASE, tab: 'building', placeDoor: true, fuel: 200 });
defItem(293, 'red_bed', '红色的床', { block: 68, tab: 'deco', maxStack: 1, placeBed: 0 });
defItem(294, 'white_bed', '白色的床', { block: 76, tab: 'deco', maxStack: 1, placeBed: 1 });
for (let i = DOOR_BASE; i < DOOR_BASE + 32; i++) BLOCKS[i].item = 292;
for (let i = 68; i < 84; i++) BLOCKS[i].item = i < 76 ? 293 : 294;
for (let i = 58; i < 66; i++) BLOCKS[i].item = 288;

// ---------------- 盔甲（Java 版：护甲值、盔甲韧性、耐久 = 基础 × 部位系数）----------------
export const ARMOR_SLOTS = [
  { key: 'helmet', name: '头盔', mult: 11 }, { key: 'chestplate', name: '胸甲', mult: 16 },
  { key: 'leggings', name: '护腿', mult: 15 }, { key: 'boots', name: '靴子', mult: 13 },
];
export const ARMOR_MATS = [
  { key: 'leather', base: 5, def: [1, 3, 2, 1], tough: 0, names: ['皮革帽子', '皮革外套', '皮革裤子', '皮革靴子'], color: 0xa0653a, ingredient: 'leather' },
  { key: 'chainmail', base: 15, def: [2, 5, 4, 1], tough: 0, names: ['锁链头盔', '锁链胸甲', '锁链护腿', '锁链靴子'], color: 0x8a8a90, ingredient: null },
  { key: 'iron', base: 15, def: [2, 6, 5, 2], tough: 0, names: ['铁头盔', '铁胸甲', '铁护腿', '铁靴子'], color: 0xd8d8d8, ingredient: 'iron_ingot' },
  { key: 'golden', base: 7, def: [2, 5, 3, 1], tough: 0, names: ['金头盔', '金胸甲', '金护腿', '金靴子'], color: 0xf2d23a, ingredient: 'gold_ingot' },
  { key: 'diamond', base: 33, def: [3, 8, 6, 3], tough: 2, names: ['钻石头盔', '钻石胸甲', '钻石护腿', '钻石靴子'], color: 0x4ee2da, ingredient: 'diamond' },
];
ARMOR_MATS.forEach((m, mi) => ARMOR_SLOTS.forEach((sl, si) => {
  const key = `${m.key}_${sl.key}`;
  defItem(320 + mi * 4 + si, key, m.names[si], { maxStack: 1, tab: 'combat', icon: key, durability: m.base * sl.mult,
    armor: { slot: si, defense: m.def[si], toughness: m.tough, material: m.key, color: m.color } });
}));
// Java：伤害 × (1 - min(20, max(护甲/5, 护甲 - 4×伤害/(韧性+8))) / 25)
export function armorReduce(damage, defense, toughness) {
  const f = Math.min(20, Math.max(defense / 5, defense - (4 * damage) / (toughness + 8)));
  return damage * (1 - f / 25);
}
export function durabilityOf(d) { return d ? (d.tool ? d.tool.durability : d.durability || 0) : 0; }

export const MATERIALS = [
  { key: 'wooden', name: '木', speed: 2, tier: 0, durability: 59, fuel: 200, dmg: { sword: 4, axe: 7, pickaxe: 2, shovel: 2.5 }, axeSpeed: 0.8 },
  { key: 'stone', name: '石', speed: 4, tier: 1, durability: 131, dmg: { sword: 5, axe: 9, pickaxe: 3, shovel: 3.5 }, axeSpeed: 0.8 },
  { key: 'iron', name: '铁', speed: 6, tier: 2, durability: 250, dmg: { sword: 6, axe: 9, pickaxe: 4, shovel: 4.5 }, axeSpeed: 0.9 },
  { key: 'golden', name: '金', speed: 12, tier: 0, durability: 32, dmg: { sword: 4, axe: 7, pickaxe: 2, shovel: 2.5 }, axeSpeed: 1.0 },
  { key: 'diamond', name: '钻石', speed: 8, tier: 3, durability: 1561, dmg: { sword: 7, axe: 9, pickaxe: 5, shovel: 5.5 }, axeSpeed: 1.0 },
];
export const TOOL_TYPES = [
  { key: 'pickaxe', name: '镐', attackSpeed: 1.2 },
  { key: 'axe', name: '斧', attackSpeed: 0 },
  { key: 'shovel', name: '锹', attackSpeed: 1.0 },
  { key: 'sword', name: '剑', attackSpeed: 1.6 },
];
MATERIALS.forEach((m, mi) => TOOL_TYPES.forEach((t, ti) => {
  const key = `${m.key}_${t.key}`;
  defItem(300 + mi * 4 + ti, key, `${m.name}${t.name}`, {
    maxStack: 1, tab: t.key === 'sword' ? 'combat' : 'tools', icon: key,
    tool: { type: t.key, speed: m.speed, tier: m.tier, durability: m.durability, damage: m.dmg[t.key], attackSpeed: t.key === 'axe' ? m.axeSpeed : t.attackSpeed, material: m.key },
    fuel: m.key === 'wooden' ? 200 : undefined,
  });
}));

// 锄（Java：攻击伤害 1，攻速 木1 石2 铁3 金1 钻石4）
MATERIALS.forEach((m, mi) => {
  const key = `${m.key}_hoe`;
  defItem(340 + mi, key, `${m.name}锄`, { maxStack: 1, tab: 'tools', icon: key, fuel: m.key === 'wooden' ? 200 : undefined,
    tool: { type: 'hoe', speed: m.speed, tier: m.tier, durability: m.durability, damage: 1, attackSpeed: [1, 2, 3, 1, 4][mi], material: m.key } });
});

export function itemDef(id) { return ITEMS.get(id); }
export function maxStack(id) { const d = ITEMS.get(id); return d ? d.maxStack : 64; }
export function itemName(id) { const d = ITEMS.get(id); return d ? d.name : '?'; }
export function idOf(key) { return I[key] ?? B[key]; }

// 燃料（tick）
export const FUEL = new Map();
for (const [id, d] of ITEMS) if (d.fuel) FUEL.set(id, d.fuel);
for (const k of ['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'birch_planks', 'spruce_planks', 'crafting_table', 'chest', 'bookshelf']) FUEL.set(I[k], 300);
for (const k of ['oak_sapling', 'birch_sapling', 'spruce_sapling']) FUEL.set(I[k], 100);
FUEL.set(I.coal_block, 16000);
FUEL.set(I.white_wool, 100);

// 熔炼
export const SMELTING = new Map([
  [I.cobblestone, I.stone], [I.stone, I.smooth_stone], [I.sand, I.glass], [I.iron_ore, I.iron_ingot], [I.gold_ore, I.gold_ingot],
  [I.oak_log, I.charcoal], [I.birch_log, I.charcoal], [I.spruce_log, I.charcoal],
  [I.porkchop, I.cooked_porkchop], [I.beef, I.cooked_beef], [I.mutton, I.cooked_mutton],
  [I.clay_ball, I.brick], [I.diamond_ore, I.diamond], [I.coal_ore, I.coal], [I.redstone_ore, I.redstone], [I.chicken, I.cooked_chicken],
]);

// ---------------- 合成配方 ----------------
// 标签：#planks #log #coals
export const TAGS = {
  planks: [I.oak_planks, I.birch_planks, I.spruce_planks],
  coals: [I.coal, I.charcoal],
  logs: [I.oak_log, I.birch_log, I.spruce_log],
  wool: [I.white_wool, I.red_wool, I.yellow_wool, I.lime_wool, I.blue_wool, I.black_wool],
};
export const RECIPES = [];
function shaped(pattern, keys, result, count = 1) {
  RECIPES.push({ type: 'shaped', pattern, keys, result: idOf(result), count });
}
function shapeless(ingredients, result, count = 1) {
  RECIPES.push({ type: 'shapeless', ingredients, result: idOf(result), count });
}
shapeless(['oak_log'], 'oak_planks', 4);
shapeless(['birch_log'], 'birch_planks', 4);
shapeless(['spruce_log'], 'spruce_planks', 4);
shaped(['P', 'P'], { P: '#planks' }, 'stick', 4);
shaped(['PP', 'PP'], { P: '#planks' }, 'crafting_table');
shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace');
shaped(['PPP', 'P P', 'PPP'], { P: '#planks' }, 'chest');
shaped(['C', 'S'], { C: '#coals', S: 'stick' }, 'torch', 4);
shaped(['I I', ' I '], { I: 'iron_ingot' }, 'bucket');
shaped(['SS', 'SS'], { S: 'sand' }, 'sandstone');
shaped(['SS', 'SS'], { S: 'stone' }, 'stone_bricks', 4);
shaped(['BB', 'BB'], { B: 'brick' }, 'bricks');
shaped(['CC', 'CC'], { C: 'clay_ball' }, 'clay');
shaped(['SS', 'SS'], { S: 'snowball' }, 'snow_block');
for (const [blk, ing] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['coal_block', 'coal']]) {
  shaped(['XXX', 'XXX', 'XXX'], { X: ing }, blk);
  shapeless([blk], ing, 9);
}
const toolMats = { wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [m, ing] of Object.entries(toolMats)) {
  shaped(['MMM', ' S ', ' S '], { M: ing, S: 'stick' }, `${m}_pickaxe`);
  shaped(['MM', 'MS', ' S'], { M: ing, S: 'stick' }, `${m}_axe`);
  shaped(['M', 'S', 'S'], { M: ing, S: 'stick' }, `${m}_shovel`);
  shaped(['M', 'M', 'S'], { M: ing, S: 'stick' }, `${m}_sword`);
}

// 台阶 ×6、楼梯 ×4
for (const m of SS_MATS) {
  shaped(['XXX'], { X: m.base }, `${m.key}_slab`, 6);
  shaped(['X  ', 'XX ', 'XXX'], { X: m.base }, `${m.key}_stairs`, 4);
}
shaped(['PP', 'PP', 'PP'], { P: 'oak_planks' }, 'oak_door', 3);
shaped(['WWW', 'PPP'], { W: 'red_wool', P: '#planks' }, 'red_bed');
shaped(['WWW', 'PPP'], { W: 'white_wool', P: '#planks' }, 'white_bed');
shaped([' TS', 'T S', ' TS'], { T: 'stick', S: 'string' }, 'bow');
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);
shaped(['SS', 'SS'], { S: 'string' }, 'white_wool');
shaped(['WWW'], { W: 'wheat' }, 'bread');
shapeless(['bone'], 'bone_meal', 3);
for (const m of ARMOR_MATS) {
  if (!m.ingredient) continue; // 锁链盔甲在 Java 版中无法合成
  shaped(['XXX', 'X X'], { X: m.ingredient }, `${m.key}_helmet`);
  shaped(['X X', 'XXX', 'XXX'], { X: m.ingredient }, `${m.key}_chestplate`);
  shaped(['XXX', 'X X', 'X X'], { X: m.ingredient }, `${m.key}_leggings`);
  shaped(['X X', 'X X'], { X: m.ingredient }, `${m.key}_boots`);
}
for (const [m, ing] of Object.entries(toolMats)) shaped(['MM', ' S', ' S'], { M: ing, S: 'stick' }, `${m}_hoe`);

function ingMatch(spec, id) {
  if (!spec) return id === 0;
  if (spec.startsWith('#')) return TAGS[spec.slice(1)].includes(id);
  return idOf(spec) === id;
}
// grid: 数组 (w*h) 的物品 id（0 = 空）
export function matchRecipe(grid, w, h) {
  // 计算包围盒
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const ids = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = grid[y * w + x];
    if (id) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); ids.push(id); }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (ids.length !== r.ingredients.length) continue;
      const pool = [...ids];
      let ok = true;
      for (const ing of r.ingredients) {
        const i = pool.findIndex((id) => ingMatch(ing, id));
        if (i < 0) { ok = false; break; }
        pool.splice(i, 1);
      }
      if (ok) return r;
    } else {
      const ph = r.pattern.length, pw = Math.max(...r.pattern.map((s) => s.length));
      if (pw !== bw || ph !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < ph && ok; y++) for (let x = 0; x < pw && ok; x++) {
          const ch = r.pattern[y][mirror ? pw - 1 - x : x] || ' ';
          const id = grid[(minY + y) * w + (minX + x)];
          const spec = ch === ' ' ? null : r.keys[ch];
          if (!ingMatch(spec, id)) ok = false;
        }
        if (ok) return r;
      }
    }
  }
  return null;
}

// ---------------- 挖掘 ----------------
// 返回每 tick 的破坏进度（>=1 立即破坏）
export function canHarvest(block, tool) {
  if (!block.requiresTool) return true;
  return !!tool && tool.type === block.tool && tool.tier >= block.tier;
}
export function digSpeed(block, tool) {
  if (block.hardness < 0) return 0;
  if (block.hardness === 0) return 1;
  let speed = 1;
  if (tool) {
    if (block.web && (tool.type === 'sword')) speed = 15;
    else if (tool.type === block.tool) speed = tool.speed;
    else if (tool.type === 'sword' && block.tool === 'hoe') speed = 1.5;
  }
  return speed / block.hardness / (canHarvest(block, tool) && (!block.web || (tool && tool.type === 'sword')) ? 30 : 100);
}

// 创造模式物品栏分类
export const CREATIVE_TABS = [
  { key: 'building', name: '建筑方块', icon: 'bricks' },
  { key: 'deco', name: '装饰性方块', icon: 'poppy' },
  { key: 'tools', name: '工具', icon: 'iron_axe' },
  { key: 'combat', name: '战斗用品', icon: 'golden_sword' },
  { key: 'food', name: '食物', icon: 'apple' },
  { key: 'materials', name: '原材料', icon: 'stick' },
  { key: 'search', name: '搜索物品', icon: 'compass' },
  { key: 'inventory', name: '生存模式物品栏', icon: 'chest' },
];
