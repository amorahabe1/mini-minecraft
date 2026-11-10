// 第一人称手臂/手持物品渲染（参照 MC ItemRenderer 的变换顺序）、第三人称玩家模型、物品栏人物预览
import * as THREE from 'three';
import { ITEMS } from './registry.js';
import { humanoid } from './entities.js';

const D = THREE.MathUtils.degToRad;
const SKIN = '#c69a7a', SHIRT = '#3aa0b0';

function armTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 12; const g = c.getContext('2d');
  for (let y = 0; y < 12; y++) for (let x = 0; x < 4; x++) {
    const base = y < 4 ? [58, 160, 176] : [198, 154, 122];
    const k = 1 + (Math.random() - 0.5) * 0.08;
    g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`; g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Hand {
  constructor(itemModels) {
    this.im = itemModels;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.root = new THREE.Group(); this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);
    // 手臂（模型空间：像素单位 /16，MC ModelBiped 右臂：枢轴 (-5,2,0)，方块 (-3,-2,-2) 4x12x4）
    const tex = armTexture();
    const mats = [0.6, 0.6, 1, 0.5, 0.8, 0.8].map((s) => { const m = new THREE.MeshBasicMaterial({ map: tex }); m.userData.shade = s; m.color.setScalar(s); return m; });
    const geo = new THREE.BoxGeometry(4 / 16, 12 / 16, 4 / 16);
    geo.translate((-5 - 1) / 16, (2 + 4) / 16, 0); // 枢轴 + 方块中心 (-1, 4, 0)
    this.arm = new THREE.Mesh(geo, mats); this.arm.userData.mats = mats;
    this.armObj = new THREE.Group(); this.armObj.matrixAutoUpdate = false; this.armObj.add(this.arm);
    this.root.add(this.armObj);
    this.itemObj = new THREE.Group(); this.itemObj.matrixAutoUpdate = false;
    this.root.add(this.itemObj);
    this.heldId = -1; this.model = null;
    this.equip = 1; this.prevEquip = 1; this.lastStackKey = '';
  }
  setItem(id) {
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.model) { this.itemObj.remove(this.model); this.model = null; }
    if (id) { this.model = this.im.create(id); this.itemObj.add(this.model); }
  }
  // 每 tick：装备进度（换物品时手臂下沉再抬起）
  tick(stackKey) {
    this.prevEquip = this.equip;
    if (stackKey !== this.lastStackKey) { this.equip = Math.max(0, this.equip - 0.4); if (this.equip <= 0) this.lastStackKey = stackKey; }
    else this.equip = Math.min(1, this.equip + 0.4);
  }
  update(aspect, alpha, swing, brightness, eating, bobMatrix) {
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    const equip = 1 - (this.prevEquip + (this.equip - this.prevEquip) * alpha); // MC: equippedProgress 反向
    const m = new THREE.Matrix4();
    const T = (x, y, z) => m.multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    const R = (axis, deg) => m.multiply(new THREE.Matrix4().makeRotationAxis(axis, D(deg)));
    const S = (s) => m.multiply(new THREE.Matrix4().makeScale(s, s, s));
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    if (bobMatrix) m.copy(bobMatrix);
    const sq = Math.sqrt(swing);
    const id = this.heldId;
    this.armObj.visible = !id; this.itemObj.visible = !!id;
    if (!id) {
      // renderArmFirstPerson
      const f2 = -0.3 * Math.sin(sq * Math.PI), f3 = 0.4 * Math.sin(sq * Math.PI * 2), f4 = -0.4 * Math.sin(swing * Math.PI);
      T(f2 + 0.64, f3 - 0.6 + equip * -0.6, f4 - 0.72);
      R(Y, 45);
      const f5 = Math.sin(swing * swing * Math.PI), f6 = Math.sin(sq * Math.PI);
      R(Y, f6 * 70); R(Z, f5 * -20);
      T(-1, 3.6, 3.5);
      R(Z, 120); R(X, 200); R(Y, -135);
      T(5.6, 0, 0);
      this.armObj.matrix.copy(m);
      for (const mt of this.arm.userData.mats) mt.color.setScalar(mt.userData.shade * brightness);
    } else {
      const d = ITEMS.get(id);
      if (eating > 0) {
        // 进食：上下抖动并移向中间
        const t = eating;
        const k = Math.min(1, t / 6);
        T(-0.3 * k, Math.abs(Math.cos(t / 4 * Math.PI) * 0.1) * (t > 4 ? 1 : 0), 0);
        T(0.56, -0.52 + equip * -0.6, -0.72);
        R(Y, 90 * k * 0.6); R(X, 10 * k); R(Z, 30 * k);
      } else {
        T(-0.4 * Math.sin(sq * Math.PI), 0.2 * Math.sin(sq * Math.PI * 2), -0.2 * Math.sin(swing * Math.PI));
        T(0.56, -0.52 + equip * -0.6, -0.72);
        const f = Math.sin(swing * swing * Math.PI);
        R(Y, 45 + f * -20);
        const f1 = Math.sin(sq * Math.PI);
        R(Z, f1 * -20); R(X, f1 * -80); R(Y, -45);
      }
      if (this.model && this.model.userData.isBlock) {
        R(Y, 45); S(0.4);
      } else {
        T(1.13 / 16, 3.2 / 16, 1.13 / 16);
        R(Y, -90); R(Z, 25); S(0.68);
        if (d && d.tool) { /* 手持工具与普通物品同一变换 */ }
      }
      this.itemObj.matrix.copy(m);
      if (this.model) this.im.setBrightness(this.model, brightness);
    }
  }
}

// 第三人称玩家模型
export function createPlayerModel() {
  const mats = [];
  const o = humanoid('steve', mats);
  o.userData.mats = mats;
  for (const m of mats) m.userData.base = m.color.clone();
  return o;
}
export function animatePlayerModel(o, p, alpha, br) {
  p.renderPos(alpha, o.position);
  const yaw = p.yaw;
  o.rotation.set(0, yaw + Math.PI, 0);
  const parts = o.userData.parts;
  const a = Math.cos(p.limbSwing * 0.6662) * 1.4 * p.limbAmount;
  parts.legR.rotation.x = a; parts.legL.rotation.x = -a;
  parts.armR.rotation.x = -a * 0.5 - (p.swingAnim || 0) * 1.4; parts.armL.rotation.x = a * 0.5;
  parts.head.rotation.x = p.pitch;
  o.position.y -= p.sneaking ? 0.1 : 0;
  o.rotation.x = 0;
  for (const m of o.userData.mats) { m.color.copy(m.userData.base).multiplyScalar(br); if (p.hurtTime > 0) { m.color.r = Math.min(1, m.color.r + 0.4); m.color.g *= 0.5; m.color.b *= 0.5; } }
}

// 物品栏人物预览（像素画）
export function previewCanvas() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 34; const g = c.getContext('2d');
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  r(4, 1, 8, 8, SKIN); r(4, 1, 8, 2, '#3b2513'); r(4, 3, 1, 1, '#3b2513'); r(11, 3, 1, 1, '#3b2513');
  r(5, 5, 2, 1, '#fff'); r(9, 5, 2, 1, '#fff'); r(6, 5, 1, 1, '#4a3a9a'); r(9, 5, 1, 1, '#4a3a9a'); r(7, 6, 2, 1, '#8a5a4a'); r(6, 7, 4, 1, '#5a3a2a');
  r(4, 9, 8, 12, SHIRT); r(0, 9, 4, 4, SHIRT); r(12, 9, 4, 4, SHIRT); r(0, 13, 4, 8, SKIN); r(12, 13, 4, 8, SKIN);
  r(4, 21, 8, 10, '#2e3a8a'); r(7, 23, 1, 8, '#26306e'); r(4, 31, 4, 2, '#5a5a5a'); r(8, 31, 4, 2, '#5a5a5a');
  c.style.objectFit = 'contain';
  return c;
}
