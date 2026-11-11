// 实体：生物基类（MC 移动物理）、动物/僵尸 AI 与模型、掉落物、下落方块、粒子
import * as THREE from 'three';
import { moveEntity, liquidState, slipperiness, entityBox, isInLiquidAt, raycastBlocks, lineClear, touchesWeb } from './physics.js';
import { BLOCKS, I, B, SOLID, isLiquid, HEIGHT, isDoor, doorState, doorId, TILES } from './registry.js';
import { brightness } from './render.js';

let nextId = 1;
export class Entity {
  constructor(game, x, y, z) {
    this.game = game; this.id = nextId++;
    this.pos = new THREE.Vector3(x, y, z);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.width = 0.6; this.height = 1.8;
    this.onGround = false; this.collidedH = false; this.fallDistance = 0;
    this.inWater = false; this.inLava = false;
    this.yaw = 0; this.prevYaw = 0; this.pitch = 0;
    this.age = 0; this.dead = false; this.removed = false;
    this.object = null;
  }
  savePrev() { this.prevPos.copy(this.pos); this.prevYaw = this.yaw; }
  updateLiquid() { const s = liquidState(this.game.world, this); this.inWater = s.water; this.inLava = s.lava; if (this.inWater) this.fallDistance = 0; }
  renderPos(alpha, out) { return out.copy(this.prevPos).lerp(this.pos, alpha); }
  lightBrightness() {
    const w = this.game.world;
    const l = w.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + this.height * 0.6), Math.floor(this.pos.z));
    return brightness(l.sky, l.block, this.game.darken, this.game.settings.gamma);
  }
}

// ---------- 有生命的实体（MC 移动公式）----------
export class Living extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.maxHealth = 20; this.health = 20;
    this.hurtTime = 0; this.invulnerable = 0; this.deathTime = 0;
    this.speed = 0.1; this.jumpTicks = 0;
    this.forward = 0; this.strafe = 0; this.jumping = false; this.sneaking = false; this.sprinting = false; this.flying = false;
    this.limbSwing = 0; this.limbAmount = 0; this.prevLimbAmount = 0;
    this.airSupply = 300;
    this.stepHeight = 0.6;
    this.onLanded = (d) => this.fall(d);
  }
  fall(d) {
    if (this.inWater) return;
    const dmg = Math.ceil(d - 3);
    if (dmg > 0) this.hurt(dmg, 'fall');
  }
  // 方向：yaw 采用 three.js 约定（0 朝 -Z）
  moveRelative(strafe, forward, accel) {
    let f = strafe * strafe + forward * forward;
    if (f < 1e-4) return;
    f = Math.sqrt(f); if (f < 1) f = 1; f = accel / f;
    strafe *= f; forward *= f;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vel.x += -s * forward + c * strafe;
    this.vel.z += -c * forward - s * strafe;
  }
  travel() {
    const w = this.game.world;
    const strafe = this.strafe, forward = this.forward;
    this.inWeb = touchesWeb(w, this);
    if (this.jumping) {
      if ((this.inWater || this.inLava) && !this.flying) this.vel.y += 0.04;
      else if (this.onGround && this.jumpTicks === 0) { this.jump(); this.jumpTicks = 10; }
    } else this.jumpTicks = 0;
    if (this.jumpTicks > 0) this.jumpTicks--;

    if (this.inWater && !this.flying) {
      const y0 = this.pos.y;
      this.moveRelative(strafe, forward, 0.02);
      moveEntity(w, this, this.vel.x, this.vel.y, this.vel.z);
      this.vel.multiplyScalar(0.8);
      this.vel.y -= 0.02;
      if (this.collidedH && this.canMoveTo(this.vel.x, this.vel.y + 0.6 - this.pos.y + y0, this.vel.z)) this.vel.y = 0.3;
    } else if (this.inLava && !this.flying) {
      const y0 = this.pos.y;
      this.moveRelative(strafe, forward, 0.02);
      moveEntity(w, this, this.vel.x, this.vel.y, this.vel.z);
      this.vel.multiplyScalar(0.5);
      this.vel.y -= 0.02;
      if (this.collidedH && this.canMoveTo(this.vel.x, this.vel.y + 0.6 - this.pos.y + y0, this.vel.z)) this.vel.y = 0.3;
    } else {
      let fr = 0.91;
      if (this.onGround) fr = slipperiness(w, this) * 0.91;
      const k = 0.16277136 / (fr * fr * fr);
      let accel;
      if (this.onGround) accel = this.moveSpeed() * k;
      else accel = this.flying ? (this.sprinting ? 0.1 : 0.05) : (this.sprinting ? 0.026 : 0.02);
      this.moveRelative(strafe, forward, accel);
      fr = 0.91;
      if (this.onGround) fr = slipperiness(w, this) * 0.91;
      const vy0 = this.vel.y;
      moveEntity(w, this, this.vel.x, this.vel.y, this.vel.z);
      if (this.flying) { this.vel.y = (this.collidedV ? 0 : vy0) * 0.6; }
      else { this.vel.y -= 0.08; this.vel.y *= 0.98; }
      this.vel.x *= fr; this.vel.z *= fr;
    }
    // 肢体摆动
    const dx = this.pos.x - this.prevPos.x, dz = this.pos.z - this.prevPos.z;
    let dist = Math.sqrt(dx * dx + dz * dz) * 4; if (dist > 1) dist = 1;
    this.prevLimbAmount = this.limbAmount;
    this.limbAmount += (dist - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount;
  }
  canMoveTo(dx, dy, dz) {
    const b = entityBox(this);
    const bb = [b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz];
    const w = this.game.world;
    for (let y = Math.floor(bb[1]); y <= Math.floor(bb[4]); y++) for (let z = Math.floor(bb[2]); z <= Math.floor(bb[5]); z++) for (let x = Math.floor(bb[0]); x <= Math.floor(bb[3]); x++) {
      const id = w.getBlock(x, y, z);
      if (id < 0 || (id > 0 && (SOLID[id] || isLiquid(id)))) return false;
    }
    return true;
  }
  moveSpeed() { return this.speed * (this.sprinting ? 1.3 : 1); }
  jump() {
    this.vel.y = 0.42;
    if (this.sprinting) { this.vel.x += -Math.sin(this.yaw) * 0.2; this.vel.z += -Math.cos(this.yaw) * 0.2; }
  }
  hurt(amount, source, attacker) {
    if (this.dead || this.health <= 0) return false;
    if (this.invulnerable > 10) return false;
    amount = this.applyArmor ? this.applyArmor(amount, source) : amount;
    this.lastDamageSource = source; this.lastAttacker = attacker;
    this.health -= amount;
    this.hurtTime = 10; this.invulnerable = 20;
    if (attacker && source !== 'explosion') {
      const ax = attacker.kbFrom ? attacker.kbFrom.x : attacker.pos.x, az = attacker.kbFrom ? attacker.kbFrom.z : attacker.pos.z;
      const dx = this.pos.x - ax, dz = this.pos.z - az;
      this.knockback(0.4, dx, dz);
    }
    if (this.health <= 0) { this.health = 0; this.die(source); }
    return true;
  }
  knockback(strength, dx, dz) {
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    this.vel.x /= 2; this.vel.y /= 2; this.vel.z /= 2;
    this.vel.x += (dx / d) * strength; this.vel.z += (dz / d) * strength;
    this.vel.y += strength; if (this.vel.y > 0.4) this.vel.y = 0.4;
  }
  die() { this.dead = true; }
  baseTick() {
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
    this.updateLiquid();
    if (this.inLava) this.hurt(4, 'lava');
    // 窒息（头在方块中）
    const hx = Math.floor(this.pos.x), hy = Math.floor(this.pos.y + this.eyeHeight()), hz = Math.floor(this.pos.z);
    const hb = this.game.world.getBlock(hx, hy, hz);
    if (hb > 0 && BLOCKS[hb].opaque && !this.flying && !this.noClip) this.hurt(1, 'suffocate');
    // 溺水
    if (this.canDrown && isInLiquidAt(this.game.world, this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z, 'water')) {
      this.airSupply--;
      if (this.airSupply <= -20) { this.airSupply = 0; this.hurt(2, 'drown'); }
    } else if (this.airSupply < 300) this.airSupply = Math.min(300, this.airSupply + 4);
    if (this.pos.y < -64) this.hurt(4, 'void');
  }
  eyeHeight() { return this.height * 0.85; }
}

// ---------- 模型工具 ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseFill(g, w, h, col, v = 16) {
  const c = new THREE.Color(col);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = 1 + (Math.random() - 0.5) * v / 100;
    g.fillStyle = `rgb(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0})`;
    g.fillRect(x, y, 1, 1);
  }
}
// 立方体部件：px 单位（1/16 方块）
function part(w, h, d, faces, mats) {
  const geo = new THREE.BoxGeometry(w / 16, h / 16, d / 16);
  // faces: 颜色或纹理，顺序 +x -x +y -y +z(前) -z
  const arr = faces.map((f) => {
    const m = new THREE.MeshBasicMaterial(f && f.isTexture ? { map: f, alphaTest: 0.5, side: THREE.DoubleSide } : { color: f });
    m.userData.base = m.color.clone();
    mats.push(m); return m;
  });
  return new THREE.Mesh(geo, arr);
}
function solidTex(col, v = 14, w = 8, h = 8) { return canvasTex(w, h, (g) => noiseFill(g, w, h, col, v)); }
const TEX_CACHE = {};
function cached(k, f) { return TEX_CACHE[k] || (TEX_CACHE[k] = f()); }

export function humanoid(kind, mats) {
  const root = new THREE.Group();
  const skin = kind === 'zombie' ? 0x5a8a3a : 0xc69a7a;
  const shirt = kind === 'zombie' ? 0x2a8a8a : 0x3aa0b0;
  const pants = kind === 'zombie' ? 0x3a3a8a : 0x2e3a8a;
  const face = cached(kind + 'face', () => canvasTex(8, 8, (g) => {
    noiseFill(g, 8, 8, skin, 10);
    if (kind === 'zombie') { g.fillStyle = '#1a2a10'; g.fillRect(1, 3, 2, 2); g.fillRect(5, 3, 2, 2); g.fillStyle = '#2a4a1a'; g.fillRect(2, 6, 4, 1); }
    else {
      g.fillStyle = '#3b2513'; g.fillRect(0, 0, 8, 2); g.fillRect(0, 2, 1, 1); g.fillRect(7, 2, 1, 1);
      g.fillStyle = '#ffffff'; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
      g.fillStyle = '#4a3a9a'; g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1);
      g.fillStyle = '#8a5a4a'; g.fillRect(3, 5, 2, 1); g.fillStyle = '#5a3a2a'; g.fillRect(2, 6, 4, 1);
    }
  }));
  const hair = kind === 'zombie' ? cached('zskin', () => solidTex(skin)) : cached('hair', () => solidTex(0x3b2513));
  const side = kind === 'zombie' ? cached('zskin', () => solidTex(skin)) : cached('hside', () => canvasTex(8, 8, (g) => { noiseFill(g, 8, 8, skin, 10); g.fillStyle = '#3b2513'; g.fillRect(0, 0, 8, 3); g.fillRect(0, 3, 2, 1); }));
  const back = kind === 'zombie' ? cached('zskin', () => solidTex(skin)) : hair;
  const head = part(8, 8, 8, [side, side, hair, cached('skin' + kind, () => solidTex(skin)), face, back], mats);
  head.position.y = 28 / 16;
  const headPivot = new THREE.Group(); headPivot.position.y = 24 / 16; head.position.y = 4 / 16; headPivot.add(head);
  const shirtT = cached('shirt' + kind, () => solidTex(shirt));
  const body = part(8, 12, 4, [shirtT, shirtT, shirtT, shirtT, shirtT, shirtT], mats); body.position.y = 18 / 16;
  const armT = kind === 'zombie' ? cached('zskin', () => solidTex(skin)) : cached('arm', () => canvasTex(4, 12, (g) => { noiseFill(g, 4, 12, skin, 10); g.fillStyle = '#3aa0b0'; g.fillRect(0, 0, 4, 4); }));
  const legT = cached('pants' + kind, () => canvasTex(4, 12, (g) => { noiseFill(g, 4, 12, pants, 10); g.fillStyle = '#5a5a5a'; g.fillRect(0, 10, 4, 2); }));
  const limb = (tex, x, y) => { const p = new THREE.Group(); p.position.set(x / 16, y / 16, 0); const m = part(4, 12, 4, [tex, tex, tex, tex, tex, tex], mats); m.position.y = -6 / 16; p.add(m); return p; };
  const armR = limb(armT, -6, 22), armL = limb(armT, 6, 22), legR = limb(legT, -2, 12), legL = limb(legT, 2, 12);
  root.add(headPivot, body, armR, armL, legR, legL);
  root.userData.parts = { head: headPivot, armR, armL, legR, legL };
  if (kind === 'zombie') { armR.rotation.x = -Math.PI / 2; armL.rotation.x = -Math.PI / 2; }
  return root;
}
function quadruped(kind, mats) {
  const root = new THREE.Group();
  let bodyCol, legH, bodyW, bodyH, bodyL, headS, faceDraw, bodyY;
  if (kind === 'pig') {
    bodyCol = 0xf0a0a0; legH = 6; bodyW = 10; bodyH = 8; bodyL = 16; headS = [8, 8, 8]; bodyY = 10;
    faceDraw = (g) => { noiseFill(g, 8, 8, bodyCol, 8); g.fillStyle = '#ffffff'; g.fillRect(0, 2, 2, 1); g.fillRect(6, 2, 2, 1); g.fillStyle = '#000'; g.fillRect(1, 2, 1, 1); g.fillRect(6, 2, 1, 1); };
  } else if (kind === 'cow') {
    bodyCol = 0x4a3020; legH = 12; bodyW = 12; bodyH = 10; bodyL = 18; headS = [8, 8, 6]; bodyY = 17;
    faceDraw = (g) => { noiseFill(g, 8, 8, 0x4a3020, 10); g.fillStyle = '#e8e8e8'; g.fillRect(2, 0, 4, 4); g.fillStyle = '#000'; g.fillRect(1, 3, 1, 1); g.fillRect(6, 3, 1, 1); g.fillStyle = '#b8a090'; g.fillRect(2, 5, 4, 3); g.fillStyle = '#5a4030'; g.fillRect(2, 6, 1, 1); g.fillRect(5, 6, 1, 1); };
  } else {
    bodyCol = 0xe8e8e8; legH = 12; bodyW = 10; bodyH = 9; bodyL = 16; headS = [6, 6, 8]; bodyY = 17;
    faceDraw = (g) => { noiseFill(g, 6, 6, 0xd8c8a8, 8); g.fillStyle = '#ffffff'; g.fillRect(0, 2, 2, 1); g.fillRect(4, 2, 2, 1); g.fillStyle = '#000'; g.fillRect(1, 2, 1, 1); g.fillRect(4, 2, 1, 1); g.fillStyle = '#f0b0b0'; g.fillRect(2, 4, 2, 1); };
  }
  const bodyT = kind === 'cow'
    ? cached('cowbody', () => canvasTex(16, 16, (g) => { noiseFill(g, 16, 16, 0x4a3020, 10); g.fillStyle = '#e8e8e8'; g.fillRect(2, 3, 5, 4); g.fillRect(9, 9, 5, 5); g.fillRect(11, 1, 3, 3); }))
    : cached(kind + 'body', () => solidTex(bodyCol, kind === 'sheep' ? 6 : 12, 16, 16));
  const body = part(bodyW, bodyH, bodyL, [bodyT, bodyT, bodyT, bodyT, bodyT, bodyT], mats);
  body.position.y = bodyY / 16;
  const faceT = cached(kind + 'face', () => canvasTex(headS[0], headS[1], faceDraw));
  const headCol = kind === 'sheep' ? cached('sheephead', () => solidTex(0xd8c8a8)) : kind === 'cow' ? cached('cowhead', () => solidTex(0x4a3020)) : cached('pigbody', () => solidTex(bodyCol, 12, 16, 16));
  const headPivot = new THREE.Group();
  headPivot.position.set(0, (bodyY + 2) / 16, (bodyL / 2 + 1) / 16);
  const head = part(headS[0], headS[1], headS[2], [headCol, headCol, headCol, headCol, faceT, headCol], mats);
  head.position.set(0, 0, headS[2] / 32);
  headPivot.add(head);
  if (kind === 'pig') { const sn = part(4, 3, 1, [0xe08a8a, 0xe08a8a, 0xe08a8a, 0xe08a8a, cached('snout', () => canvasTex(4, 3, (g) => { g.fillStyle = '#f0a0a0'; g.fillRect(0, 0, 4, 3); g.fillStyle = '#8a4a4a'; g.fillRect(0, 1, 1, 1); g.fillRect(3, 1, 1, 1); })), 0xe08a8a], mats); sn.position.set(0, -1.5 / 16, (headS[2] + 1) / 16); headPivot.add(sn); }
  if (kind === 'cow') { for (const sx of [-1, 1]) { const h = part(1, 3, 1, Array(6).fill(0xd8d0b8), mats); h.position.set(sx * 4.5 / 16, 4.5 / 16, 3 / 16); headPivot.add(h); } }
  const legT = kind === 'sheep' ? cached('sheepleg', () => solidTex(0xd8c8a8)) : kind === 'cow' ? cached('cowleg', () => canvasTex(4, 12, (g) => { noiseFill(g, 4, 12, 0x4a3020, 10); g.fillStyle = '#e8e8e8'; g.fillRect(0, 8, 4, 2); g.fillStyle = '#2a2a2a'; g.fillRect(0, 10, 4, 2); })) : cached('pigleg', () => solidTex(bodyCol));
  const legs = [];
  const lx = bodyW / 2 - 2, lz = bodyL / 2 - 2;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = new THREE.Group(); p.position.set(sx * lx / 16, legH / 16, sz * lz / 16);
    const m = part(4, legH, 4, Array(6).fill(legT), mats); m.position.y = -legH / 32; p.add(m);
    root.add(p); legs.push(p);
  }
  root.add(body, headPivot);
  root.userData.parts = { head: headPivot, legs };
  if (kind === 'sheep') root.userData.wool = body;
  return root;
}

// ---------- 新生物模型（程序化纹理）----------
function texOf(k, w, h, draw) { return cached(k, () => canvasTex(w, h, draw)); }
function limbPivot(tex, w, h, d, x, y, z, mats) {
  const p = new THREE.Group(); p.position.set(x / 16, y / 16, z / 16);
  const m = part(w, h, d, Array(6).fill(tex), mats); m.position.y = -h / 32; p.add(m); return p;
}
function camo(g, w, h) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.random();
    g.fillStyle = r < 0.12 ? '#b4e4a4' : r < 0.42 ? '#5cb84c' : r < 0.8 ? '#3f9a33' : '#2a6a22';
    g.fillRect(x, y, 1, 1);
  }
}
function skeletonModel(mats) {
  const root = new THREE.Group();
  const bone = 0xc8c8c0;
  const boneT = texOf('skbone', 8, 8, (g) => noiseFill(g, 8, 8, bone, 10));
  const face = texOf('skface', 8, 8, (g) => {
    noiseFill(g, 8, 8, bone, 10);
    g.fillStyle = '#262626'; g.fillRect(1, 3, 2, 2); g.fillRect(5, 3, 2, 2); g.fillRect(3, 5, 2, 1);
    g.fillStyle = '#4a4a46'; g.fillRect(1, 6, 6, 1); g.fillStyle = '#a8a8a0'; for (let i = 1; i < 7; i += 2) g.fillRect(i, 6, 1, 1);
  });
  const headPivot = new THREE.Group(); headPivot.position.y = 24 / 16;
  const head = part(8, 8, 8, [boneT, boneT, boneT, boneT, face, boneT], mats); head.position.y = 4 / 16; headPivot.add(head);
  const rib = texOf('skrib', 8, 12, (g) => { g.clearRect(0, 0, 8, 12); g.fillStyle = '#c4c4bc'; g.fillRect(3, 0, 2, 12); for (let y = 1; y < 8; y += 2) g.fillRect(0, y, 8, 1); g.fillRect(1, 10, 6, 2); });
  const ribS = texOf('skribs', 4, 12, (g) => { g.clearRect(0, 0, 4, 12); g.fillStyle = '#acaca4'; for (let y = 1; y < 8; y += 2) g.fillRect(0, y, 4, 1); g.fillRect(0, 10, 4, 2); });
  const body = part(8, 12, 4, [ribS, ribS, boneT, boneT, rib, rib], mats); body.position.y = 18 / 16;
  const limbT = texOf('sklimb', 2, 12, (g) => noiseFill(g, 2, 12, bone, 12));
  const armR = limbPivot(limbT, 2, 12, 2, -5, 22, 0, mats), armL = limbPivot(limbT, 2, 12, 2, 5, 22, 0, mats);
  const legR = limbPivot(limbT, 2, 12, 2, -2, 12, 0, mats), legL = limbPivot(limbT, 2, 12, 2, 2, 12, 0, mats);
  root.add(headPivot, body, armR, armL, legR, legL);
  root.userData.parts = { head: headPivot, armR, armL, legR, legL };
  return root;
}
function creeperModel(mats) {
  const root = new THREE.Group();
  const skinT = texOf('crskin', 8, 8, (g) => camo(g, 8, 8));
  const bodyT = texOf('crbody', 8, 12, (g) => camo(g, 8, 12));
  const face = texOf('crface', 8, 8, (g) => { camo(g, 8, 8); g.fillStyle = '#0c0c0c'; g.fillRect(1, 2, 2, 2); g.fillRect(5, 2, 2, 2); g.fillRect(3, 4, 2, 3); g.fillRect(2, 5, 1, 3); g.fillRect(5, 5, 1, 3); });
  const headPivot = new THREE.Group(); headPivot.position.y = 18 / 16;
  const head = part(8, 8, 8, [skinT, skinT, skinT, skinT, face, skinT], mats); head.position.y = 4 / 16; headPivot.add(head);
  const body = part(8, 12, 4, Array(6).fill(bodyT), mats); body.position.y = 12 / 16;
  const legT = texOf('crleg', 4, 6, (g) => camo(g, 4, 6));
  const legs = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const p = limbPivot(legT, 4, 6, 4, sx * 2, 6, sz * 4, mats); root.add(p); legs.push(p); }
  root.add(headPivot, body);
  root.userData.parts = { head: headPivot, legs };
  return root;
}
function villagerModel(mats, desert) {
  const root = new THREE.Group();
  const skin = 0xb48a6c, robe = desert ? 0xc9a96a : 0x6e4a2a;
  const headT = texOf('vhead', 8, 10, (g) => noiseFill(g, 8, 10, skin, 8));
  const face = texOf('vface', 8, 10, (g) => {
    noiseFill(g, 8, 10, skin, 8);
    g.fillStyle = '#4a3020'; g.fillRect(1, 3, 6, 1);
    g.fillStyle = '#ffffff'; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
    g.fillStyle = '#2b7a35'; g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1);
    g.fillStyle = '#7a5040'; g.fillRect(2, 8, 4, 1);
  });
  const headPivot = new THREE.Group(); headPivot.position.y = 24 / 16;
  const head = part(8, 10, 8, [headT, headT, headT, headT, face, headT], mats); head.position.y = 5 / 16; headPivot.add(head);
  const nose = part(2, 4, 2, Array(6).fill(texOf('vnose', 2, 4, (g) => noiseFill(g, 2, 4, 0xa07a5c, 8))), mats); nose.position.set(0, 2 / 16, 5 / 16); headPivot.add(nose);
  const robeT = texOf('vrobe' + desert, 8, 18, (g) => { noiseFill(g, 8, 18, robe, 14); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 17, 8, 1); });
  const body = part(8, 18, 6, Array(6).fill(robeT), mats); body.position.y = 15 / 16;
  const armT = texOf('varm' + desert, 4, 4, (g) => noiseFill(g, 4, 4, robe, 14));
  const handT = texOf('vhand', 8, 4, (g) => noiseFill(g, 8, 4, skin, 8));
  const arms = new THREE.Group(); arms.position.set(0, 20.5 / 16, 3 / 16); arms.rotation.x = -0.75;
  const mid = part(8, 4, 4, Array(6).fill(handT), mats); mid.position.set(0, -1 / 16, 3 / 16);
  const sl = part(4, 8, 4, Array(6).fill(armT), mats); sl.position.set(-6 / 16, 1 / 16, 1 / 16);
  const sr = part(4, 8, 4, Array(6).fill(armT), mats); sr.position.set(6 / 16, 1 / 16, 1 / 16);
  arms.add(mid, sl, sr);
  const legT = texOf('vleg', 4, 12, (g) => { noiseFill(g, 4, 12, 0x4a3424, 10); g.fillStyle = '#2a2018'; g.fillRect(0, 10, 4, 2); });
  const legR = limbPivot(legT, 4, 12, 4, -2, 12, 0, mats), legL = limbPivot(legT, 4, 12, 4, 2, 12, 0, mats);
  root.add(headPivot, body, arms, legR, legL);
  root.userData.parts = { head: headPivot, legR, legL };
  return root;
}
function chickenModel(mats) {
  const root = new THREE.Group();
  const white = texOf('chw', 8, 8, (g) => noiseFill(g, 8, 8, 0xf2f2ee, 6));
  const face = texOf('chface', 4, 6, (g) => { noiseFill(g, 4, 6, 0xf2f2ee, 6); g.fillStyle = '#111'; g.fillRect(0, 1, 1, 1); g.fillRect(3, 1, 1, 1); });
  const body = part(6, 6, 8, Array(6).fill(white), mats); body.position.y = 8 / 16;
  const headPivot = new THREE.Group(); headPivot.position.set(0, 9 / 16, 4 / 16);
  const head = part(4, 6, 3, [white, white, white, white, face, white], mats); head.position.set(0, 3 / 16, 1 / 16); headPivot.add(head);
  const beak = part(4, 2, 2, Array(6).fill(0xe8a030), mats); beak.position.set(0, 3 / 16, 3.5 / 16);
  const wattle = part(2, 2, 2, Array(6).fill(0xd02020), mats); wattle.position.set(0, 1 / 16, 3 / 16);
  headPivot.add(beak, wattle);
  const wings = [];
  for (const sx of [-1, 1]) { const w = new THREE.Group(); w.position.set(sx * 3.5 / 16, 11 / 16, 0); const m = part(1, 4, 6, Array(6).fill(white), mats); m.position.y = -2 / 16; w.add(m); root.add(w); wings.push(w); }
  const legs = [];
  for (const sx of [-1, 1]) { const p = limbPivot(texOf('chleg', 1, 5, (g) => noiseFill(g, 1, 5, 0xe0a020, 8)), 1, 5, 1, sx * 1.5, 5, 0, mats); root.add(p); legs.push(p); }
  root.add(body, headPivot);
  root.userData.parts = { head: headPivot, legs, wings };
  return root;
}

// ---------- 生物 ----------
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const MOB_DEFS = {
  pig: { name: '猪', w: 0.9, h: 0.9, hp: 10, speed: 0.25, drops: () => [[I.porkchop, 1 + Math.floor(Math.random() * 3)]], sound: 'pig', hostile: false },
  cow: { name: '牛', w: 0.9, h: 1.4, hp: 10, speed: 0.2, drops: () => [[I.beef, 1 + Math.floor(Math.random() * 3)], [I.leather, Math.floor(Math.random() * 3)]], sound: 'cow', hostile: false },
  sheep: { name: '羊', w: 0.9, h: 1.3, hp: 8, speed: 0.23, drops: () => [[I.white_wool, 1], [I.mutton, 1 + Math.floor(Math.random() * 2)]], sound: 'sheep', hostile: false },
  chicken: { name: '鸡', w: 0.4, h: 0.7, hp: 4, speed: 0.25, drops: () => [[I.feather, rint(0, 2)], [I.chicken, 1]], sound: 'chicken', hostile: false },
  zombie: { name: '僵尸', w: 0.6, h: 1.95, hp: 20, speed: 0.23, drops: () => [[I.rotten_flesh, Math.floor(Math.random() * 3)]], sound: 'zombie', hostile: true },
  skeleton: { name: '骷髅', w: 0.6, h: 1.99, hp: 20, speed: 0.25, drops: () => [[I.bone, rint(0, 2)], [I.arrow, rint(0, 2)]], sound: 'skeleton', hostile: true },
  creeper: { name: '苦力怕', w: 0.6, h: 1.7, hp: 20, speed: 0.25, drops: () => [[I.gunpowder, rint(0, 2)]], sound: 'creeper', hostile: true },
  villager: { name: '村民', w: 0.6, h: 1.95, hp: 20, speed: 0.27, drops: () => [], sound: 'villager', hostile: false },
};
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
// Java BowItem.getPowerForTime
export function bowPower(ticks) { let f = ticks / 20; f = (f * f + f * 2) / 3; return Math.min(1, f); }

export class Mob extends Living {
  constructor(game, kind, x, y, z, opts = {}) {
    super(game, x, y, z);
    const d = MOB_DEFS[kind];
    this.kind = kind; this.def = d;
    this.width = d.w; this.height = d.h; this.maxHealth = this.health = d.hp; this.speed = d.speed;
    this.hostile = d.hostile;
    this.target = null; this.idle = 0; this.panic = 0; this.attackCd = 0; this.ambient = 200 + Math.random() * 400;
    this.yaw = Math.random() * Math.PI * 2;
    this.mats = [];
    this.desert = !!opts.desert;
    if (kind === 'zombie') this.object = humanoid('zombie', this.mats);
    else if (kind === 'skeleton') this.object = skeletonModel(this.mats);
    else if (kind === 'creeper') this.object = creeperModel(this.mats);
    else if (kind === 'villager') this.object = villagerModel(this.mats, this.desert);
    else if (kind === 'chicken') this.object = chickenModel(this.mats);
    else this.object = quadruped(kind, this.mats);
    this.burning = 0;
    // 苦力怕
    this.swell = 0; this.prevSwell = 0; this.swellDir = -1;
    // 骷髅
    this.seeTime = 0; this.useTicks = -1; this.attackTime = -1; this.strafeTime = -1; this.strafeCW = false; this.strafeBack = false;
    if (kind === 'skeleton') {
      this.bow = game.itemModels.create(I.bow);
      this.bow.scale.setScalar(0.7);
      this.bow.position.set(0, -10 / 16, 0.5 / 16);
      this.bow.rotation.set(0, Math.PI / 2, Math.PI * 0.75);
      this.object.userData.parts.armR.add(this.bow);
    }
    // 村民
    this.home = opts.home || null; this.village = opts.village || null; this.path = null; this.doors = []; this.stuck = 0; this.hide = 0;
    this.flap = 0; this.wingSpeed = 0;
  }
  // ---- 通用 ----
  canSee(e) {
    return lineClear(this.game.world, this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z, e.pos.x, e.pos.y + e.eyeHeight(), e.pos.z);
  }
  validTarget(p, range) {
    if (p.dead || p.mode !== 'survival') return false;
    const d = this.pos.distanceTo(p.pos);
    if (this.aggro) { if (d > range * 1.2) this.aggro = false; }
    else if (d < range && this.canSee(p)) this.aggro = true;
    return this.aggro;
  }
  steer(tx, tz, mod = 1) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    this.turnTo(Math.atan2(-dx, -dz), 0.5);
    this.forward = 1; this.aiSpeed = this.speed * mod;
    return Math.hypot(dx, dz);
  }
  turnTo(want, max) { const diff = wrapA(want - this.yaw); this.yaw += Math.max(-max, Math.min(max, diff)); }
  inSun() {
    const g = this.game;
    if (g.daylight <= 0.5 || this.inWater) return false;
    const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + this.eyeHeight()), z = Math.floor(this.pos.z);
    if (g.isRainingAt && g.isRainingAt(x, y, z)) return false;
    return g.world.lightAt(x, y, z).sky >= 15 && g.world.lightAt(x, y, z).sky >= 15;
  }
  aiTick() {
    const g = this.game, p = g.player;
    this.forward = 0; this.strafe = 0; this.jumping = false; this.aiSpeed = this.speed;
    const dxp = p.pos.x - this.pos.x, dzp = p.pos.z - this.pos.z, dp = Math.hypot(dxp, dzp);
    if (this.kind === 'creeper') this.creeperAI(p);
    else if (this.kind === 'skeleton') this.skeletonAI(p);
    else if (this.kind === 'villager') this.villagerAI(p, dp, dxp, dzp);
    else this.basicAI(p, dp, dxp, dzp);
    if (this.collidedH && this.onGround && this.forward > 0) this.jumping = true;
    if (this.inWater || this.inLava) this.jumping = Math.random() < 0.8;
    // 环境音
    if (--this.ambient <= 0) { this.ambient = 300 + Math.random() * 500; if (dp < 16 && this.kind !== 'creeper') g.audio.play(this.def.sound, { vol: Math.max(0.1, 1 - dp / 16) }); }
    // 亡灵生物白天燃烧
    if ((this.kind === 'zombie' || this.kind === 'skeleton') && this.inSun()) this.burning = Math.max(this.burning, 160);
    if (this.burning > 0) {
      this.burning--;
      if (this.inWater || (g.isRainingAt && g.isRainingAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 1), Math.floor(this.pos.z)))) this.burning = 0;
      else if (this.age % 20 === 0) this.hurt(1, 'fire');
    }
    if (this.kind === 'chicken') { this.flap += this.onGround ? -0.3 : 0.4; this.flap = Math.max(0, Math.min(1, this.flap)); this.wingSpeed += this.onGround ? 0 : 0.9; }
  }
  basicAI(p, dp, dxp, dzp) {
    const g = this.game;
    let mod = 1, tx = null, tz = null;
    if (this.hostile && !p.dead && p.mode === 'survival' && dp < 35 && Math.abs(p.pos.y - this.pos.y) < 12) {
      tx = p.pos.x; tz = p.pos.z;
      if (this.attackCd > 0) this.attackCd--;
      const reach = this.width / 2 + p.width / 2 + 0.6;
      if (dp < reach && Math.abs(p.pos.y - this.pos.y) < 1.5 && this.attackCd <= 0) {
        this.attackCd = 20;
        if (p.hurt(3, 'mob', this)) g.audio.play('hurt');
        g.swingMob(this);
      }
    } else if (this.panic > 0) {
      this.panic--; mod = 1.25;
      if (!this.target || Math.random() < 0.05) this.target = { x: this.pos.x + (Math.random() - 0.5) * 20, z: this.pos.z + (Math.random() - 0.5) * 20 };
      tx = this.target.x; tz = this.target.z;
    } else {
      if (this.idle > 0) this.idle--;
      else if (!this.target && Math.random() < 1 / 120) this.target = { x: this.pos.x + (Math.random() - 0.5) * 20, z: this.pos.z + (Math.random() - 0.5) * 20 };
      if (this.target) { tx = this.target.x; tz = this.target.z; }
      if (!this.hostile && dp < 6 && !this.target) this.lookYaw = Math.atan2(-dxp, -dzp);
    }
    if (tx !== null) {
      const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
      if (d < 0.6) { this.target = null; this.idle = 40 + Math.random() * 120; }
      else {
        this.steer(tx, tz, mod);
        if (!this.hostile) this.avoidEdges();
      }
    } else if (this.lookYaw !== undefined) this.yaw += wrapA(this.lookYaw - this.yaw) * 0.2;
  }
  avoidEdges() {
    const g = this.game;
    const ax = Math.floor(this.pos.x - Math.sin(this.yaw) * 0.9), az = Math.floor(this.pos.z - Math.cos(this.yaw) * 0.9);
    let drop = 0; for (let y = Math.floor(this.pos.y) - 1; y > Math.floor(this.pos.y) - 5; y--) { const b = g.world.getBlock(ax, y, az); if (b !== 0) break; drop++; }
    if (drop >= 4) { this.forward = 0; this.target = null; this.idle = 20; }
    const wb = g.world.getBlock(ax, Math.floor(this.pos.y), az);
    if (wb > 0 && isLiquid(wb) && !this.panic) { this.forward = 0; this.target = null; }
  }
  wander(range = 10) {
    if (this.idle > 0) { this.idle--; return; }
    if (!this.target && Math.random() < 1 / 120) this.target = { x: this.pos.x + (Math.random() - 0.5) * range * 2, z: this.pos.z + (Math.random() - 0.5) * range * 2 };
    if (this.target) {
      if (this.steer(this.target.x, this.target.z, 1) < 0.6 || Math.random() < 0.005) { this.target = null; this.forward = 0; this.idle = 40 + Math.random() * 120; }
    }
  }
  // 苦力怕：SwellGoal（3 格内开始点燃，7 格外取消，引信 30 刻，威力 3）
  creeperAI(p) {
    const g = this.game;
    const has = this.validTarget(p, 16);
    let dir = -1;
    if (has) {
      const d2 = this.pos.distanceToSquared(p.pos);
      if ((this.swell > 0 || d2 < 9) && d2 <= 49 && this.canSee(p)) dir = 1;
      if (dir < 0) this.steer(p.pos.x, p.pos.z, 1);
      else this.turnTo(Math.atan2(-(p.pos.x - this.pos.x), -(p.pos.z - this.pos.z)), 0.5);
    } else this.wander();
    this.prevSwell = this.swell;
    if (dir > 0 && this.swell === 0) g.audio.play('creeper_primed', { at: this.pos });
    this.swellDir = dir;
    this.swell = Math.max(0, Math.min(30, this.swell + dir));
    if (this.swell >= 30) {
      this.removed = true; this.dead = true; this.exploded = true;
      g.explode(this.pos.x, this.pos.y, this.pos.z, this.charged ? 6 : 3, this);
    }
  }
  // 骷髅：RangedBowAttackGoal（15 格射程，绕圈走位，拉弓 20 刻）
  skeletonAI(p) {
    const g = this.game;
    const has = this.validTarget(p, 16);
    if (!has) { this.seeTime = 0; this.useTicks = -1; this.wander(); return; }
    const d2 = this.pos.distanceToSquared(p.pos);
    const see = this.canSee(p);
    if (see !== this.prevSee) this.seeTime = 0;
    this.prevSee = see;
    this.seeTime += see ? 1 : -1;
    const want = Math.atan2(-(p.pos.x - this.pos.x), -(p.pos.z - this.pos.z));
    if (d2 <= 225 && this.seeTime >= 20) { this.strafeTime++; }
    else { this.steer(p.pos.x, p.pos.z, 1); this.strafeTime = -1; }
    if (this.strafeTime >= 20) {
      if (Math.random() < 0.3) this.strafeCW = !this.strafeCW;
      if (Math.random() < 0.3) this.strafeBack = !this.strafeBack;
      this.strafeTime = 0;
    }
    if (this.strafeTime > -1) {
      if (d2 > 225 * 0.75) this.strafeBack = false; else if (d2 < 225 * 0.25) this.strafeBack = true;
      this.forward = this.strafeBack ? -0.5 : 0.5; this.strafe = this.strafeCW ? 0.5 : -0.5;
      this.turnTo(want, 0.5);
    } else this.turnTo(want, 0.5);
    if (this.useTicks >= 0) {
      this.useTicks++;
      if (!see && this.seeTime < -60) this.useTicks = -1;
      else if (see && this.useTicks >= 20) {
        this.shootAt(p, bowPower(this.useTicks));
        this.useTicks = -1; this.attackTime = 20;
      }
    } else if (--this.attackTime <= 0 && this.seeTime >= -60) this.useTicks = 0;
  }
  shootAt(t, power) {
    const g = this.game;
    const sx = this.pos.x, sy = this.pos.y + this.eyeHeight() - 0.1, sz = this.pos.z;
    const dx = t.pos.x - sx, dy = t.pos.y + t.height / 3 - sy, dz = t.pos.z - sz;
    const dh = Math.hypot(dx, dz);
    const a = new Arrow(g, sx, sy, sz, this, { base: 2 + 0.11 * 2 + (Math.random() - 0.5) * 0.5, pickup: false });
    a.shoot(dx, dy + dh * 0.2, dz, 1.6, 6);
    g.addEntity(a);
    g.audio.play('bow_shoot', { at: this.pos });
    void power;
  }
  // 村民：白天在村庄内闲逛 / 去钟旁聚集，夜晚回家（自动开关门）
  villagerAI(p, dp, dxp, dzp) {
    const g = this.game;
    const tod = ((g.time % 24000) + 24000) % 24000;
    if (this.hide > 0) this.hide--;
    const night = (tod >= 12000 && tod < 23500) || this.hide > 0;
    if (this.panic > 0) { this.panic--; this.path = null; this.basicAI(p, dp, dxp, dzp); this.aiSpeed = this.speed * 1.4; this.openDoorsAhead(); return; }
    if (night && this.home) {
      if (!this.path || this.pathKind !== 'home') {
        const h = this.home;
        const insideNow = Math.hypot(this.pos.x - h.inside.x, this.pos.z - h.inside.z) < 2.5;
        this.path = insideNow ? [{ x: h.x, z: h.z }] : [h.front, h.door, h.inside, { x: h.x, z: h.z }];
        this.pathKind = 'home';
      }
    } else if (this.pathKind === 'home') {
      const h = this.home;
      this.path = [h.inside, h.door, h.front];
      this.pathKind = 'out';
    }
    if (this.path && this.path.length) {
      const wp = this.path[0];
      const d = this.steer(wp.x, wp.z, 1);
      if (d < 0.7) { this.path.shift(); if (!this.path.length && this.pathKind === 'home') { this.forward = 0; } }
      if (this.stuck++ > 400) { this.path.shift(); this.stuck = 0; }
      this.openDoorsAhead();
    } else if (night && this.home) {
      this.forward = 0;
    } else {
      this.stuck = 0;
      if (this.pathKind === 'out') this.pathKind = null;
      const v = this.village;
      if (this.idle > 0) { this.idle--; if (dp < 6) this.lookYaw = Math.atan2(-dxp, -dzp); if (this.lookYaw !== undefined) this.yaw += wrapA(this.lookYaw - this.yaw) * 0.2; }
      else if (!this.target && Math.random() < 1 / 100) {
        const gather = v && tod >= 9000 && tod < 11000;
        const cx = v ? (gather ? v.bell.x : v.x) : this.pos.x, cz = v ? (gather ? v.bell.z : v.z) : this.pos.z;
        const r = gather ? 4 : 18;
        this.target = { x: cx + (Math.random() - 0.5) * r * 2, z: cz + (Math.random() - 0.5) * r * 2 };
      }
      if (this.target) {
        const d = this.steer(this.target.x, this.target.z, 0.9);
        if (d < 0.8 || (this.collidedH && Math.random() < 0.02)) { this.target = null; this.forward = 0; this.idle = 60 + Math.random() * 160; }
        this.avoidEdges();
        this.openDoorsAhead();
      }
    }
    this.closeDoorsBehind();
  }
  openDoorsAhead() {
    const g = this.game, w = g.world;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const k of [0.3, 0.9]) {
      const x = Math.floor(this.pos.x + fx * k), z = Math.floor(this.pos.z + fz * k);
      for (const y of [Math.floor(this.pos.y), Math.floor(this.pos.y + 1)]) {
        const id = w.getBlock(x, y, z);
        if (id > 0 && isDoor(id)) {
          const s = doorState(id);
          const by = s.upper ? y - 1 : y;
          if (!s.open && g.setDoorOpen) { g.setDoorOpen(x, by, z, true, false); this.doors.push({ x, y: by, z, t: this.age }); }
          return;
        }
      }
    }
  }
  closeDoorsBehind() {
    const g = this.game;
    this.doors = this.doors.filter((d) => {
      if (this.age - d.t < 20) return true;
      if (Math.hypot(this.pos.x - d.x - 0.5, this.pos.z - d.z - 0.5) < 1.6) return true;
      const id = g.world.getBlock(d.x, d.y, d.z);
      if (id > 0 && isDoor(id) && doorState(id).open && g.setDoorOpen) g.setDoorOpen(d.x, d.y, d.z, false, false);
      return false;
    });
  }
  fall(d) { if (this.kind === 'chicken') return; super.fall(d); }
  moveSpeed() { const s = this.aiSpeed || this.speed; return s * s; }
  tick() {
    this.savePrev();
    this.baseTick();
    if (this.dead) { this.deathTime++; if (this.deathTime >= 20) this.remove(); this.vel.x *= 0.5; this.vel.z *= 0.5; this.vel.y -= 0.08; return; }
    this.aiTick();
    if (this.removed) return;
    // MC 中生物 moveForward=aiSpeed，地面加速度=aiSpeed*k，等效于 forward=±1、加速度=aiSpeed^2
    if (this.kind !== 'skeleton' || this.strafeTime < 0) this.forward = this.forward > 0 ? 1 : this.forward < 0 ? -1 : 0;
    this.travel();
    if (this.kind === 'chicken' && !this.onGround && this.vel.y < 0) this.vel.y *= 0.6;
  }
  hurt(amount, source, attacker) {
    const r = super.hurt(amount, source, attacker);
    if (r) {
      if (!this.hostile) { this.panic = 100; this.target = null; }
      else if (attacker === this.game.player || (attacker && attacker.shooter === this.game.player)) this.aggro = true;
      if (!this.dead) this.game.audio.play(this.def.sound + '_hurt', { at: this.pos });
    }
    return r;
  }
  die(source) {
    super.die(source);
    this.game.audio.play(this.def.sound + '_death', { at: this.pos });
    if (source !== 'void') for (const [id, n] of this.def.drops()) if (n > 0) this.game.spawnItem(this.pos.x, this.pos.y + 0.5, this.pos.z, { id, count: n });
  }
  remove() { this.removed = true; }
  updateObject(alpha, camera) {
    void camera;
    const o = this.object;
    this.renderPos(alpha, o.position);
    const yaw = this.prevYaw + wrapA(this.yaw - this.prevYaw) * alpha;
    o.rotation.set(0, yaw + Math.PI, 0);
    if (this.dead) o.rotation.z = Math.min(1, (this.deathTime + alpha) / 20) * Math.PI / 2;
    const parts = o.userData.parts;
    const swing = this.limbSwing, amt = this.limbAmount;
    const a = Math.cos(swing * 0.6662) * 1.4 * amt;
    if (parts.legs && parts.legs.length === 4) { parts.legs[0].rotation.x = a; parts.legs[3].rotation.x = a; parts.legs[1].rotation.x = -a; parts.legs[2].rotation.x = -a; }
    else if (parts.legs) { parts.legs[0].rotation.x = a; parts.legs[1].rotation.x = -a; }
    else {
      parts.legR.rotation.x = a; parts.legL.rotation.x = -a;
      if (this.kind === 'zombie') { parts.armR.rotation.x = -Math.PI / 2 + Math.sin(this.age * 0.1) * 0.05 - (this.swingT || 0); parts.armL.rotation.x = -Math.PI / 2 - Math.sin(this.age * 0.1) * 0.05 - (this.swingT || 0); if (this.swingT) this.swingT *= 0.7; }
      else if (this.kind === 'skeleton') {
        if (this.aggro) { parts.armR.rotation.set(-Math.PI / 2 - 0.1, -0.1, 0); parts.armL.rotation.set(-Math.PI / 2 + (this.useTicks >= 0 ? 0.25 : 0.1), 0.5, 0); }
        else { parts.armR.rotation.set(-a * 0.8, 0, 0.05); parts.armL.rotation.set(a * 0.8, 0, -0.05); }
      }
    }
    if (parts.wings) { const f = this.onGround ? 0 : (Math.sin(this.age * 1.6) + 1) * 0.8; parts.wings[0].rotation.z = f; parts.wings[1].rotation.z = -f; }
    // 苦力怕膨胀（Java CreeperRenderer.scale）
    if (this.kind === 'creeper') {
      let f = (this.prevSwell + (this.swell - this.prevSwell) * alpha) / 28;
      const f1 = 1 + Math.sin(f * 100) * f * 0.01;
      f = Math.max(0, Math.min(1, f)); f *= f; f *= f;
      const f2 = (1 + f * 0.4) * f1, f3 = (1 + f * 0.1) / f1;
      o.scale.set(f2, f3, f2);
    }
    // 头部看向玩家
    const pl = this.game.player;
    if (parts.head && pl) {
      const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) < 8 || this.aggro) parts.head.rotation.y = Math.max(-1, Math.min(1, wrapA(Math.atan2(-dx, -dz) - this.yaw)));
      else parts.head.rotation.y *= 0.9;
    }
    const br = this.lightBrightness();
    const hurt = this.hurtTime > 0 || this.dead;
    let white = 0;
    if (this.kind === 'creeper') { const sp = (this.prevSwell + (this.swell - this.prevSwell) * alpha) / 28; white = Math.floor(sp * 10) % 2 === 0 ? 0 : Math.max(0.5, Math.min(1, sp)); }
    for (const m of this.mats) {
      m.color.copy(m.userData.base).multiplyScalar(br);
      if (hurt) { m.color.r = Math.min(1, m.color.r * 1.0 + 0.4); m.color.g *= 0.5; m.color.b *= 0.5; }
      if (this.burning > 0) { m.color.r = Math.min(1, m.color.r + 0.25); m.color.g = Math.min(1, m.color.g + 0.08); }
      if (white) { m.color.r += (1 - m.color.r) * white; m.color.g += (1 - m.color.g) * white; m.color.b += (1 - m.color.b) * white; }
    }
    if (this.bow) this.game.itemModels.setBrightness(this.bow, br);
  }
}

// ---------- 箭（Java AbstractArrow：重力 0.05，阻力 0.99，水中 0.6）----------
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
let arrowGeo = null;
export class Arrow extends Entity {
  constructor(game, x, y, z, shooter, opts = {}) {
    super(game, x, y, z);
    this.width = 0.5; this.height = 0.5;
    this.shooter = shooter; this.base = opts.base ?? 2; this.crit = !!opts.crit; this.pickup = opts.pickup ?? true;
    this.inGround = false; this.life = 0; this.shake = 0; this.stuck = null;
    this.object = new THREE.Group();
    if (!arrowGeo) {
      const c = document.createElement('canvas'); c.width = 16; c.height = 16;
      const g = c.getContext('2d');
      g.fillStyle = '#6b4a2a'; g.fillRect(0, 7, 13, 2); g.fillStyle = '#8a6a44'; g.fillRect(0, 7, 13, 1);
      g.fillStyle = '#c8c8c8'; g.fillRect(12, 6, 3, 4); g.fillRect(15, 7, 1, 2); g.fillStyle = '#888'; g.fillRect(12, 9, 3, 1);
      g.fillStyle = '#eeeeee'; g.fillRect(0, 5, 4, 2); g.fillRect(0, 9, 4, 2); g.fillStyle = '#c03030'; g.fillRect(1, 5, 1, 1); g.fillRect(1, 10, 1, 1);
      const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
      arrowGeo = { tex: t, geo: new THREE.PlaneGeometry(0.5, 0.5) };
    }
    this.mat = new THREE.MeshBasicMaterial({ map: arrowGeo.tex, alphaTest: 0.3, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(arrowGeo.geo, this.mat);
      // 平面在 XY 内，箭头指向 +x；绕 y 旋转使其指向 -z（实体前方），两片十字交叉
      m.rotation.set(i ? Math.PI / 2 : 0, 0, 0);
      const pivot = new THREE.Group(); pivot.rotation.y = Math.PI / 2; pivot.add(m);
      this.object.add(pivot);
    }
  }
  // Java Projectile.shoot
  shoot(dx, dy, dz, velocity, inaccuracy) {
    const L = Math.hypot(dx, dy, dz) || 1;
    const v = new THREE.Vector3(dx / L + gauss() * 0.0075 * inaccuracy, dy / L + gauss() * 0.0075 * inaccuracy, dz / L + gauss() * 0.0075 * inaccuracy).multiplyScalar(velocity);
    this.vel.copy(v);
    this.updateRot(); this.prevYaw = this.yaw; this.prevPitch = this.pitch;
  }
  updateRot() { const h = Math.hypot(this.vel.x, this.vel.z); this.yaw = Math.atan2(-this.vel.x, -this.vel.z); this.pitch = Math.atan2(this.vel.y, h); }
  tick() {
    this.savePrev(); this.prevPitch = this.pitch;
    this.age++;
    const g = this.game, w = g.world;
    if (this.shake > 0) this.shake--;
    if (this.inGround) {
      const s = this.stuck;
      if (w.getBlock(s.x, s.y, s.z) !== s.id) { this.inGround = false; this.vel.set((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04); this.life = 0; }
      else { if (++this.life >= 1200) this.removed = true; return; }
    }
    this.updateLiquid();
    const v = this.vel, sp = v.length();
    const hit = raycastBlocks(w, this.pos.x, this.pos.y, this.pos.z, v.x, v.y, v.z, sp, 'collide');
    let maxT = hit ? hit.t : sp;
    // 实体碰撞
    let best = null, bestT = maxT;
    if (sp > 1e-4) {
      const dir = [v.x / sp, v.y / sp, v.z / sp];
      for (const e of g.livingEntities()) {
        if (e.dead || (e === this.shooter && this.age < 5)) continue;
        if (e === g.player && (e.mode === 'spectator' || e.dead)) continue;
        const r = e.width / 2 + 0.3;
        const box = [e.pos.x - r, e.pos.y - 0.3, e.pos.z - r, e.pos.x + r, e.pos.y + e.height + 0.3, e.pos.z + r];
        const t = rayBox([this.pos.x, this.pos.y, this.pos.z], dir, box);
        if (t !== null && t <= bestT) { bestT = t; best = e; }
      }
    }
    if (best) {
      let dmg = Math.ceil(Math.max(0, Math.min(2147483647, sp * this.base)));
      if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      this.kbFrom = { x: this.pos.x - v.x, z: this.pos.z - v.z };
      const src = 'arrow';
      if (best.hurt(dmg, src, this)) {
        // Java 箭击退：水平速度方向 0.6 * punch（无冲击附魔时仅普通受击击退）
        if (best === g.player) g.audio.play('hurt');
        g.audio.play('arrow_hit_entity', { at: this.pos });
        if (best.burning !== undefined && this.burning) best.burning = 100;
        this.removed = true; return;
      }
      // 未造成伤害：反弹
      v.multiplyScalar(-0.1); this.yaw += Math.PI;
    } else if (hit) {
      this.pos.set(this.pos.x + v.x / sp * hit.t, this.pos.y + v.y / sp * hit.t, this.pos.z + v.z / sp * hit.t);
      this.pos.x -= v.x / sp * 0.05; this.pos.y -= v.y / sp * 0.05; this.pos.z -= v.z / sp * 0.05;
      this.inGround = true; this.stuck = { x: hit.x, y: hit.y, z: hit.z, id: hit.id }; this.shake = 7; this.crit = false;
      v.set(0, 0, 0); this.life = 0;
      g.audio.play('arrow_hit', { at: this.pos });
      return;
    } else this.pos.add(v);
    this.updateRot();
    const drag = this.inWater ? 0.6 : 0.99;
    v.multiplyScalar(drag); v.y -= 0.05;
    if (this.crit && g.particles) g.particles.crit(this.pos.x, this.pos.y, this.pos.z, 1);
    if (this.pos.y < -64 || this.age > 2400) this.removed = true;
  }
  updateObject(alpha) {
    this.renderPos(alpha, this.object.position);
    const yaw = this.prevYaw + wrapA(this.yaw - this.prevYaw) * alpha;
    const pitch = (this.prevPitch ?? this.pitch) + (this.pitch - (this.prevPitch ?? this.pitch)) * alpha;
    const sh = this.shake > 0 ? -Math.sin((this.shake - alpha) * 3) * (this.shake - alpha) * 0.02 : 0;
    this.object.rotation.set(0, 0, 0);
    this.object.rotation.order = 'YXZ';
    this.object.rotation.y = yaw; this.object.rotation.x = pitch + sh;
    this.mat.color.setScalar(this.lightBrightness());
  }
}
function rayBox(o, d, b) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < b[i] || o[i] > b[i + 3]) return null; continue; }
    let a = (b[i] - o[i]) / d[i], c = (b[i + 3] - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

// ---------- 掉落物 ----------
export class ItemEntity extends Entity {
  constructor(game, x, y, z, stack, pickupDelay = 10) {
    super(game, x, y, z);
    this.stack = stack; this.width = 0.25; this.height = 0.25;
    this.pickupDelay = pickupDelay;
    this.bob = Math.random() * Math.PI * 2;
    this.object = game.itemModels.create(stack.id);
    const s = this.object.userData.isBlock ? 0.25 : 0.4;
    this.object.scale.setScalar(s);
    this.inner = this.object;
    const wrap = new THREE.Group(); wrap.add(this.object); this.object = wrap;
    this.vel.set((Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2);
  }
  tick() {
    this.savePrev();
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.updateLiquid();
    if (this.inWater) { this.vel.y += 0.02; this.vel.multiplyScalar(0.9); }
    else this.vel.y -= 0.04;
    moveEntity(this.game.world, this, this.vel.x, this.vel.y, this.vel.z);
    let f = 0.98;
    if (this.onGround) f = 0.6 * 0.98;
    this.vel.x *= f; this.vel.y *= 0.98; this.vel.z *= f;
    if (this.onGround) this.vel.y *= -0.5;
    if (this.age > 6000 || this.pos.y < -64) this.removed = true;
  }
  updateObject(alpha) {
    this.renderPos(alpha, this.object.position);
    const t = this.age + alpha;
    this.inner.position.y = Math.sin(t / 10 + this.bob) * 0.1 + 0.2;
    this.inner.rotation.y = t / 20 + this.bob;
    this.game.itemModels.setBrightness(this.inner, this.lightBrightness());
  }
}

// ---------- 下落方块 ----------
export class FallingBlock extends Entity {
  constructor(game, x, y, z, id) {
    super(game, x + 0.5, y, z + 0.5);
    this.blockId = id; this.width = 0.98; this.height = 0.98;
    this.object = game.itemModels.create(id);
    this.inner = this.object;
    this.inner.position.y = 0.5;
    const wrap = new THREE.Group(); wrap.add(this.inner); this.object = wrap;
  }
  tick() {
    this.savePrev(); this.age++;
    this.vel.y -= 0.04;
    moveEntity(this.game.world, this, 0, this.vel.y, 0);
    this.vel.y *= 0.98;
    if (this.onGround || this.age > 600) {
      const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + 0.5), z = Math.floor(this.pos.z);
      const cur = this.game.world.getBlock(x, y, z);
      if (cur === 0 || (cur > 0 && BLOCKS[cur].replaceable)) this.game.world.setBlock(x, y, z, this.blockId);
      else this.game.spawnItem(this.pos.x, this.pos.y + 0.5, this.pos.z, { id: this.blockId, count: 1 });
      this.removed = true;
    }
  }
  updateObject(alpha) {
    this.renderPos(alpha, this.object.position);
    this.game.itemModels.setBrightness(this.inner, this.lightBrightness());
  }
}

// ---------- 粒子 ----------
export class Particles {
  constructor(scene, itemModels) {
    this.scene = scene; this.im = itemModels; this.list = [];
    this.geos = new Map(); this.mats = new Map();
  }
  geo(sub) {
    if (!this.geos.has(sub)) {
      const g = new THREE.PlaneGeometry(1, 1);
      const u0 = (sub % 4) / 4, v0 = Math.floor(sub / 4) / 4;
      const uv = g.attributes.uv;
      uv.setXY(0, u0, 1 - v0); uv.setXY(1, u0 + 0.25, 1 - v0); uv.setXY(2, u0, 1 - v0 - 0.25); uv.setXY(3, u0 + 0.25, 1 - v0 - 0.25);
      this.geos.set(sub, g);
    }
    return this.geos.get(sub);
  }
  mat(tile) {
    if (!this.mats.has(tile)) this.mats.set(tile, new THREE.MeshBasicMaterial({ map: this.im.tileTexture(tile), alphaTest: 0.3, side: THREE.DoubleSide }));
    return this.mats.get(tile);
  }
  blockBreak(x, y, z, tile, bright) {
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(this.geo((Math.random() * 16) | 0), this.mat(tile));
      const s = 0.08 + Math.random() * 0.08; m.scale.setScalar(s);
      m.position.set(x + Math.random(), y + Math.random(), z + Math.random());
      const v = new THREE.Vector3(m.position.x - x - 0.5, m.position.y - y - 0.5 + 0.3, m.position.z - z - 0.5).multiplyScalar(0.15);
      this.scene.add(m);
      this.list.push({ m, v, life: 20 + Math.random() * 20 });
    }
    void bright;
  }
  hit(x, y, z, face, tile) {
    const m = new THREE.Mesh(this.geo((Math.random() * 16) | 0), this.mat(tile));
    m.scale.setScalar(0.08);
    m.position.set(x + 0.5 + face[0] * 0.55 + (face[0] ? 0 : Math.random() - 0.5), y + 0.5 + face[1] * 0.55 + (face[1] ? 0 : Math.random() - 0.5), z + 0.5 + face[2] * 0.55 + (face[2] ? 0 : Math.random() - 0.5));
    this.scene.add(m);
    this.list.push({ m, v: new THREE.Vector3(face[0] * 0.05, 0.05, face[2] * 0.05), life: 12 });
  }
  fullGeo() { return this._full || (this._full = new THREE.PlaneGeometry(1, 1)); }
  crit(x, y, z, n = 1) {
    const t = TILES.indexOf('destroy_9');
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo((Math.random() * 16) | 0), this.mat(t));
      m.scale.setScalar(0.06); m.position.set(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3);
      this.scene.add(m);
      this.list.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.03, (Math.random() - 0.5) * 0.05), life: 8, grav: 0.01 });
    }
  }
  // 爆炸：大火球 + 烟雾
  explosion(x, y, z, power) {
    const te = TILES.indexOf('fx_explosion'), ts = TILES.indexOf('fx_smoke');
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.im.tileTexture(te), transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.fullGeo(), mat);
      m.position.set(x + (Math.random() - 0.5) * power * 1.3, y + (Math.random() - 0.3) * power, z + (Math.random() - 0.5) * power * 1.3);
      m.scale.setScalar(1.2 + Math.random() * 1.5);
      this.scene.add(m);
      this.list.push({ m, v: new THREE.Vector3(0, 0.01, 0), life: 6 + Math.random() * 10, max: 16, grav: 0, grow: 1.04, fade: true, own: true, noCollide: true });
    }
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.im.tileTexture(ts), transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.fullGeo(), mat);
      const dx = Math.random() - 0.5, dy = Math.random() - 0.3, dz = Math.random() - 0.5;
      m.position.set(x + dx * power, y + dy * power, z + dz * power);
      m.scale.setScalar(0.4 + Math.random() * 0.6);
      this.scene.add(m);
      this.list.push({ m, v: new THREE.Vector3(dx * 0.15, 0.04 + Math.random() * 0.05, dz * 0.15), life: 20 + Math.random() * 30, max: 50, grav: -0.002, grow: 1.01, fade: true, own: true, drag: 0.92, noCollide: true });
    }
  }
  smoke(x, y, z) {
    const ts = TILES.indexOf('fx_smoke');
    const mat = new THREE.MeshBasicMaterial({ map: this.im.tileTexture(ts), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.fullGeo(), mat);
    m.position.set(x, y, z); m.scale.setScalar(0.25);
    this.scene.add(m);
    this.list.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.02, 0.04, (Math.random() - 0.5) * 0.02), life: 20, max: 20, grav: -0.001, fade: true, own: true, noCollide: true });
  }
  update(dt, camera, world) {
    const k = dt * 20;
    for (const p of this.list) {
      p.life -= k;
      p.v.y -= (p.grav ?? 0.04) * k;
      if (p.drag) p.v.multiplyScalar(Math.pow(p.drag, k));
      if (p.grow) p.m.scale.multiplyScalar(Math.pow(p.grow, k));
      if (p.fade) p.m.material.opacity = Math.max(0, Math.min(1, p.life / (p.max * 0.5)));
      if (p.noCollide) { p.m.position.addScaledVector(p.v, k); p.m.quaternion.copy(camera.quaternion); if (p.life <= 0) { this.scene.remove(p.m); if (p.own) p.m.material.dispose(); } continue; }
      const nx = p.m.position.x + p.v.x * k, ny = p.m.position.y + p.v.y * k, nz = p.m.position.z + p.v.z * k;
      const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (id > 0 && SOLID[id]) { p.v.multiplyScalar(0.3); p.v.y = 0; } else p.m.position.set(nx, ny, nz);
      p.m.quaternion.copy(camera.quaternion);
      if (p.life <= 0) { this.scene.remove(p.m); if (p.own) p.m.material.dispose(); }
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
}
export { MOB_DEFS };
