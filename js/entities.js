// 实体：生物基类（MC 移动物理）、动物/僵尸 AI 与模型、掉落物、下落方块、粒子
import * as THREE from 'three';
import { moveEntity, liquidState, slipperiness, entityBox, isInLiquidAt } from './physics.js';
import { BLOCKS, I, B, SOLID, isLiquid, HEIGHT } from './registry.js';
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
    this.health -= amount;
    this.hurtTime = 10; this.invulnerable = 20;
    if (attacker) {
      const dx = this.pos.x - attacker.pos.x, dz = this.pos.z - attacker.pos.z;
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
    const m = new THREE.MeshBasicMaterial(f && f.isTexture ? { map: f } : { color: f });
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

// ---------- 生物 ----------
const MOB_DEFS = {
  pig: { name: '猪', w: 0.9, h: 0.9, hp: 10, speed: 0.25, drops: () => [[I.porkchop, 1 + Math.floor(Math.random() * 3)]], sound: 'pig', hostile: false },
  cow: { name: '牛', w: 0.9, h: 1.4, hp: 10, speed: 0.2, drops: () => [[I.beef, 1 + Math.floor(Math.random() * 3)], [I.leather, Math.floor(Math.random() * 3)]], sound: 'cow', hostile: false },
  sheep: { name: '羊', w: 0.9, h: 1.3, hp: 8, speed: 0.23, drops: () => [[I.white_wool, 1], [I.mutton, 1 + Math.floor(Math.random() * 2)]], sound: 'sheep', hostile: false },
  zombie: { name: '僵尸', w: 0.6, h: 1.95, hp: 20, speed: 0.23, drops: () => [[I.rotten_flesh, Math.floor(Math.random() * 3)]], sound: 'zombie', hostile: true },
};
export class Mob extends Living {
  constructor(game, kind, x, y, z) {
    super(game, x, y, z);
    const d = MOB_DEFS[kind];
    this.kind = kind; this.def = d;
    this.width = d.w; this.height = d.h; this.maxHealth = this.health = d.hp; this.speed = d.speed;
    this.hostile = d.hostile;
    this.target = null; this.idle = 0; this.panic = 0; this.attackCd = 0; this.ambient = 200 + Math.random() * 400;
    this.yaw = Math.random() * Math.PI * 2;
    this.mats = [];
    this.object = kind === 'zombie' ? humanoid('zombie', this.mats) : quadruped(kind, this.mats);
    this.burning = 0;
  }
  aiTick() {
    const g = this.game, p = g.player;
    this.forward = 0; this.strafe = 0; this.jumping = false;
    let mod = 1;
    let tx = null, tz = null;
    const dxp = p.pos.x - this.pos.x, dzp = p.pos.z - this.pos.z, dp = Math.hypot(dxp, dzp);
    if (this.hostile && !p.dead && p.mode === 'survival' && dp < 35 && Math.abs(p.pos.y - this.pos.y) < 12) {
      tx = p.pos.x; tz = p.pos.z; mod = 1;
      // 攻击
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
      else if (!this.target) {
        if (Math.random() < 1 / 120) this.target = { x: this.pos.x + (Math.random() - 0.5) * 20, z: this.pos.z + (Math.random() - 0.5) * 20 };
      }
      if (this.target) { tx = this.target.x; tz = this.target.z; }
      // 看向玩家
      if (!this.hostile && dp < 6 && !this.target) this.lookYaw = Math.atan2(-dxp, -dzp);
    }
    if (tx !== null) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.6) { this.target = null; this.idle = 40 + Math.random() * 120; }
      else {
        const want = Math.atan2(-dx, -dz);
        let diff = want - this.yaw; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += Math.max(-0.5, Math.min(0.5, diff));
        this.forward = 1;
        // 避免掉下悬崖（被动生物）
        if (!this.hostile) {
          const ax = Math.floor(this.pos.x - Math.sin(this.yaw) * 0.9), az = Math.floor(this.pos.z - Math.cos(this.yaw) * 0.9);
          let drop = 0; for (let y = Math.floor(this.pos.y) - 1; y > Math.floor(this.pos.y) - 5; y--) { const b = g.world.getBlock(ax, y, az); if (b !== 0) break; drop++; }
          if (drop >= 4) { this.forward = 0; this.target = null; this.idle = 20; }
          const wb = g.world.getBlock(ax, Math.floor(this.pos.y), az);
          if (wb > 0 && isLiquid(wb) && !this.panic) { this.forward = 0; this.target = null; }
        }
      }
    } else if (this.lookYaw !== undefined) {
      let diff = this.lookYaw - this.yaw; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * 0.2;
    }
    if (this.collidedH && this.onGround && this.forward) this.jumping = true;
    if (this.inWater || this.inLava) this.jumping = Math.random() < 0.8;
    // MC: 生物移动速度 = (属性 * 修正)^2 近似
    this.aiSpeed = this.speed * mod;
    // 环境音
    if (--this.ambient <= 0) { this.ambient = 300 + Math.random() * 500; if (dp < 16) g.audio.play(this.def.sound, { vol: Math.max(0.1, 1 - dp / 16) }); }
    // 僵尸白天燃烧
    if (this.kind === 'zombie' && g.daylight > 0.5 && !this.inWater) {
      const l = g.world.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.6), Math.floor(this.pos.z));
      if (l.sky >= 15) { this.burning = 20; }
    }
    if (this.burning > 0) { this.burning--; if (this.age % 20 === 0) this.hurt(1, 'fire'); }
  }
  moveSpeed() { const s = this.aiSpeed || this.speed; return s * s; }
  tick() {
    this.savePrev();
    this.baseTick();
    if (this.dead) { this.deathTime++; if (this.deathTime >= 20) this.remove(); this.vel.x *= 0.5; this.vel.z *= 0.5; this.vel.y -= 0.08; return; }
    this.aiTick();
    // MC 中生物 moveForward=aiSpeed，地面加速度=aiSpeed*k，等效于 forward=1、加速度=aiSpeed^2
    this.forward = this.forward ? 1 : 0;
    this.travel();
  }
  hurt(amount, source, attacker) {
    const r = super.hurt(amount, source, attacker);
    if (r) {
      if (!this.hostile) { this.panic = 100; this.target = null; }
      if (!this.dead) this.game.audio.play(this.def.sound + '_hurt');
    }
    return r;
  }
  die(source) {
    super.die(source);
    this.game.audio.play(this.def.sound + '_death');
    if (source !== 'void') for (const [id, n] of this.def.drops()) if (n > 0) this.game.spawnItem(this.pos.x, this.pos.y + 0.5, this.pos.z, { id, count: n });
  }
  remove() { this.removed = true; }
  updateObject(alpha, camera) {
    const o = this.object;
    const p = this.renderPos(alpha, o.position);
    void p;
    let yaw = this.prevYaw + (this.yaw - this.prevYaw) * alpha;
    o.rotation.set(0, yaw + Math.PI, 0);
    if (this.dead) o.rotation.z = Math.min(1, (this.deathTime + alpha) / 20) * Math.PI / 2;
    const parts = o.userData.parts;
    const swing = this.limbSwing, amt = this.limbAmount;
    const a = Math.cos(swing * 0.6662) * 1.4 * amt;
    if (parts.legs) { parts.legs[0].rotation.x = a; parts.legs[3].rotation.x = a; parts.legs[1].rotation.x = -a; parts.legs[2].rotation.x = -a; }
    else {
      parts.legR.rotation.x = a; parts.legL.rotation.x = -a;
      if (this.kind === 'zombie') { parts.armR.rotation.x = -Math.PI / 2 + Math.sin(this.age * 0.1) * 0.05 - (this.swingT || 0); parts.armL.rotation.x = -Math.PI / 2 - Math.sin(this.age * 0.1) * 0.05 - (this.swingT || 0); if (this.swingT) this.swingT *= 0.7; }
    }
    // 头部看向玩家
    const pl = this.game.player;
    if (parts.head && pl) {
      const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) < 8) {
        let hy = Math.atan2(-dx, -dz) - this.yaw; while (hy > Math.PI) hy -= Math.PI * 2; while (hy < -Math.PI) hy += Math.PI * 2;
        parts.head.rotation.y = Math.max(-1, Math.min(1, hy));
      } else parts.head.rotation.y *= 0.9;
    }
    const br = this.lightBrightness();
    const hurt = this.hurtTime > 0 || this.dead;
    for (const m of this.mats) {
      m.color.copy(m.userData.base).multiplyScalar(br);
      if (hurt) { m.color.r = Math.min(1, m.color.r * 1.0 + 0.4); m.color.g *= 0.5; m.color.b *= 0.5; }
      if (this.burning > 0) { m.color.r = Math.min(1, m.color.r + 0.25); m.color.g = Math.min(1, m.color.g + 0.08); }
    }
  }
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
  update(dt, camera, world) {
    const k = dt * 20;
    for (const p of this.list) {
      p.life -= k;
      p.v.y -= 0.04 * k;
      const nx = p.m.position.x + p.v.x * k, ny = p.m.position.y + p.v.y * k, nz = p.m.position.z + p.v.z * k;
      const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (id > 0 && SOLID[id]) { p.v.multiplyScalar(0.3); p.v.y = 0; } else p.m.position.set(nx, ny, nz);
      p.m.quaternion.copy(camera.quaternion);
      if (p.life <= 0) { this.scene.remove(p.m); }
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
}
export { MOB_DEFS };
