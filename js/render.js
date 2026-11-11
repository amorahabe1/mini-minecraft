// 渲染：区块着色器、天空、选择框、裂纹、物品模型
import * as THREE from 'three';
import { TILES, FACE_TILES, BLOCKS, SHAPE, SHAPES, ITEMS, MODELS, SELECT } from './registry.js';
import { mulberry32 } from './noise.js';

export function lightCurve(l) { return l / (4 - 3 * l); }
// 与着色器一致的亮度（0..1）
export function brightness(sky, block, darken, gamma = 0.5) {
  const s = Math.max(0, sky / 15 - darken), b = block / 15;
  let v = Math.max(lightCurve(s), lightCurve(b));
  v = v + (Math.sqrt(v) - v) * gamma;
  return Math.max(0.04, v);
}

export function createTextureArray(tiles) {
  const n = tiles.length;
  // 镂空像素填充平均颜色，避免 mipmap 黑边
  const data = new Uint8Array(16 * 16 * 4 * n);
  tiles.forEach((d, i) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let p = 0; p < 256; p++) if (d[p * 4 + 3] > 0) { r += d[p * 4]; g += d[p * 4 + 1]; b += d[p * 4 + 2]; c++; }
    if (c) { r /= c; g /= c; b /= c; }
    for (let p = 0; p < 256; p++) {
      const o = i * 1024 + p * 4;
      if (d[p * 4 + 3] === 0) { data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 0; }
      else { data[o] = d[p * 4]; data[o + 1] = d[p * 4 + 1]; data[o + 2] = d[p * 4 + 2]; data[o + 3] = d[p * 4 + 3]; }
    }
  });
  const tex = new THREE.DataArrayTexture(data, 16, 16, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */`
in vec4 aLight;
out vec3 vUv;
out vec3 vLight;
out float vDist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = vec3(uv, floor(aLight.w * 255.0 + 0.5));
  vLight = aLight.xyz;
  vDist = length(mv.xyz);
}`;
const FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uDarken;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uGamma;
uniform float uTime;
uniform float uWater;
in vec3 vUv;
in vec3 vLight;
in float vDist;
out vec4 outColor;
float curve(float l) { return l / (4.0 - 3.0 * l); }
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  if (uWater > 0.5) uv = fract(uv + vec2(0.0, -uTime * 0.03));
  vec4 c = texture(uTex, vec3(uv, vUv.z));
  if (c.a < uAlphaTest) discard;
  float s = max(0.0, vLight.x - uDarken);
  float b = vLight.y;
  float sl = curve(s), bl = curve(b);
  vec3 light = max(vec3(sl), vec3(bl, bl * 0.9, bl * 0.75));
  light = mix(light, sqrt(light), uGamma);
  light = max(light, vec3(0.04));
  vec3 col = c.rgb * light * vLight.z;
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  outColor = vec4(mix(col, uFogColor, fog), c.a);
}`;

export function createChunkMaterials(texArray) {
  const common = () => ({
    uTex: { value: texArray }, uDarken: { value: 0 }, uFogColor: { value: new THREE.Color(0xc0d8ff) },
    uFogNear: { value: 60 }, uFogFar: { value: 90 }, uAlphaTest: { value: 0.3 }, uGamma: { value: 0.5 }, uTime: { value: 0 }, uWater: { value: 0 },
  });
  const solid = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: common() });
  const tu = common(); tu.uAlphaTest.value = 0.01;
  const trans = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: tu, transparent: true, side: THREE.DoubleSide, depthWrite: true });
  // 共享 uniforms 更新
  const setAll = (k, v) => { for (const m of [solid, trans]) { if (m.uniforms[k].value && m.uniforms[k].value.copy && v.isColor) m.uniforms[k].value.copy(v); else m.uniforms[k].value = v; } };
  return { solid, trans, setAll };
}

// ---------------- 天空 ----------------
export class Sky {
  constructor(scene, cloudScene = scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // 天空穹顶
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunrise: { value: new THREE.Vector4(0, 0, 0, 0) }, uVoid: { value: new THREE.Color(0x000000) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec4 uSunrise; uniform vec3 uVoid; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float e = d.y;
          vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.4, e));
          // 地平线附近保持与雾相同的颜色，避免一条黑带；只在极低处略微变暗
          if (e < 0.0) c = mix(uHorizon, uHorizon * 0.7, smoothstep(-0.2, -0.95, e));
          vec2 sd = normalize(uSunDir.xz + vec2(1e-4));
          float toward = max(0.0, dot(normalize(d.xz + vec2(1e-4)), sd));
          float glow = uSunrise.w * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(e - 0.05)));
          c = mix(c, uSunrise.rgb, clamp(glow, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    // 星星
    const r = mulberry32(10842);
    const pos = [];
    for (let i = 0; i < 1500; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.push(s * Math.cos(th) * 350, u * 350, s * Math.sin(th) * 350);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.celestial = new THREE.Group();
    this.celestial.add(this.stars);
    // 太阳 / 月亮
    const sunTex = this.makeSunTex(), moonTex = this.makeMoonTex();
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.sun.position.set(0, 300, 0); this.sun.rotation.x = Math.PI / 2; this.sun.renderOrder = -8;
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.moon.position.set(0, -300, 0); this.moon.rotation.x = -Math.PI / 2; this.moon.renderOrder = -8;
    this.celestial.add(this.sun, this.moon);
    this.group.add(this.celestial);
    for (const o of [this.sun, this.moon]) { o.material.depthTest = false; o.frustumCulled = false; }
    this.starMat.depthTest = false;
    // 云
    this.cloudTex = this.makeCloudTex();
    this.cloudMat = new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 2;
    cloudScene.add(this.clouds);
    this.fogColor = new THREE.Color();
    this.skyColor = new THREE.Color();
  }
  makeSunTex() {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,200,0.25)'; g.fillRect(4, 4, 24, 24);
    g.fillStyle = '#fffbe0'; g.fillRect(8, 8, 16, 16);
    g.fillStyle = '#ffffff'; g.fillRect(10, 10, 12, 12);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  makeMoonTex() {
    const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
    g.fillStyle = '#c8cad8'; g.fillRect(4, 4, 8, 8);
    g.fillStyle = '#9a9cae'; g.fillRect(5, 6, 2, 2); g.fillRect(9, 5, 1, 1); g.fillRect(8, 9, 2, 2);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  makeCloudTex() {
    const n = 128, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
    const r = mulberry32(777);
    const grid = new Float32Array(n * n);
    // 平滑值噪声
    const val = []; const G = 16; for (let i = 0; i < G * G; i++) val.push(r());
    const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const v = (a, b) => val[((b % G + G) % G) * G + ((a % G + G) % G)]; const s = (t) => t * t * (3 - 2 * t); return (v(xi, yi) * (1 - s(xf)) + v(xi + 1, yi) * s(xf)) * (1 - s(yf)) + (v(xi, yi + 1) * (1 - s(xf)) + v(xi + 1, yi + 1) * s(xf)) * s(yf); };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) grid[y * n + x] = vn(x / 8, y / 8) * 0.7 + vn(x / 4 + 50, y / 4) * 0.3;
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const on = grid[i] > 0.58; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = on ? 230 : 0; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // time: 0..24000
  update(time, camPos, showClouds, underwater, rain = 0, thunder = 0, flash = 0) {
    const f = time / 24000 - 0.25;
    let fr = f - Math.floor(f);
    const celestial = fr + ((1 - (Math.cos(fr * Math.PI) + 1) / 2) - fr) / 3;
    const a = celestial * Math.PI * 2;
    const day = Math.max(0, Math.min(1, Math.cos(a) * 2 + 0.5));
    // Java Level.updateSkyBrightness：雨 / 雷暴使天空变暗
    const wd = (1 - rain * 5 / 16) * (1 - thunder * 5 / 16);
    this.daylight = day;
    this.skyDarken = Math.floor((1 - day * wd) * 11);
    this.darken = flash > 0 ? 0 : (1 - day * wd) * 11 / 15;
    // 太阳从东(+X)升起
    this.celestial.rotation.set(0, 0, a);
    this.group.position.copy(camPos);
    const sunDir = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    this.sunDir = sunDir;
    const top = new THREE.Color(0.47, 0.65, 1.0).multiplyScalar(day);
    const horizon = new THREE.Color(0.75, 0.85, 1.0).multiplyScalar(day * 0.94 + 0.06);
    top.r = Math.max(top.r, 0.01); top.g = Math.max(top.g, 0.01); top.b = Math.max(top.b, 0.03);
    // 日出日落颜色
    const cs = Math.cos(a);
    let sr = 0;
    if (cs > -0.4 && cs < 0.4) { const v = cs / 0.4 * 0.5 + 0.5; sr = (1 - (1 - Math.sin(v * Math.PI)) * 0.99); sr *= sr; }
    this.domeMat.uniforms.uTop.value.copy(top);
    this.domeMat.uniforms.uHorizon.value.copy(horizon);
    this.domeMat.uniforms.uSunDir.value.copy(sunDir);
    this.domeMat.uniforms.uSunrise.value.set(1.0, 0.55, 0.25, sr * 0.8);
    // Java ClientLevel.getSkyColor：雨天去饱和，雷暴更暗；闪电时天空发白
    const weatherTint = (c) => {
      if (rain > 0) { const lum = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * 0.6, k = 1 - rain * 0.75; c.setRGB(c.r * k + lum * (1 - k), c.g * k + lum * (1 - k), c.b * k + lum * (1 - k)); }
      if (thunder > 0) { const lum = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * 0.2, k = 1 - thunder * 0.75; c.setRGB(c.r * k + lum * (1 - k), c.g * k + lum * (1 - k), c.b * k + lum * (1 - k)); }
      if (flash > 0) { const k = Math.min(1, flash) * 0.45; c.setRGB(c.r * (1 - k) + 0.8 * k, c.g * (1 - k) + 0.8 * k, c.b * (1 - k) + k); }
      return c;
    };
    weatherTint(top); weatherTint(horizon);
    sr *= 1 - rain;
    this.domeMat.uniforms.uTop.value.copy(top);
    this.domeMat.uniforms.uHorizon.value.copy(horizon);
    this.domeMat.uniforms.uSunrise.value.set(1.0, 0.55, 0.25, sr * 0.8);
    this.fogColor.copy(horizon);
    if (sr > 0) this.fogColor.lerp(new THREE.Color(1.0, 0.6, 0.35), sr * 0.25);
    // Java FogRenderer：雨天雾色变暗
    if (rain > 0) { const k = 1 - rain * 0.5; this.fogColor.r *= k; this.fogColor.g *= k; this.fogColor.b *= 1 - rain * 0.4; }
    if (thunder > 0) this.fogColor.multiplyScalar(1 - thunder * 0.5);
    this.skyColor.copy(top);
    this.starMat.opacity = Math.max(0, 1 - day * 1.6) * 0.9 * (1 - rain);
    this.sun.material.opacity = 1 - rain; this.moon.material.opacity = 1 - rain;
    // 云
    this.clouds.visible = showClouds && !underwater;
    const cloudScale = 12 * 128; // 每像素 12 格
    this.clouds.position.set(camPos.x, 132, camPos.z);
    this.cloudTex.offset.set((camPos.x + time * 0.05) / cloudScale, -camPos.z / cloudScale);
    this.cloudTex.repeat.set(1536 / cloudScale, 1536 / cloudScale);
    let cb = 0.15 + day * 0.85;
    cb *= (1 - rain * 0.55) * (1 - thunder * 0.4);
    this.cloudMat.color.setRGB(cb, cb, cb * 1.02);
    this.cloudMat.opacity = 0.8 + rain * 0.15;
    this.dome.visible = !underwater;
  }
}

// ---------------- 方块选择框 & 裂纹 ----------------
export class BlockHighlight {
  constructor(scene, texArray) {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.box = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    this.box.visible = false;
    scene.add(this.box);
    this.crackMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTex: { value: texArray }, uLayer: { value: 0 } },
      vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `precision highp sampler2DArray; uniform sampler2DArray uTex; uniform float uLayer; in vec2 vUv; out vec4 o; void main(){ vec4 c = texture(uTex, vec3(vUv.x, 1.0 - vUv.y, uLayer)); if (c.a < 0.1) discard; o = vec4(c.rgb, 0.65); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.crackMat);
    this.crack.visible = false;
    scene.add(this.crack);
    this.crackBase = TILES.indexOf('destroy_0');
  }
  show(x, y, z, id) {
    const b = BLOCKS[id];
    this.extra = this.extra || [];
    for (const e of this.extra) e.visible = false;
    if (SHAPE[id] === SHAPES.MODEL && SELECT[id] && SELECT[id].length) {
      const list = SELECT[id];
      list.forEach((bx, i) => {
        let o = i === 0 ? this.box : this.extra[i - 1];
        if (!o) { o = new THREE.LineSegments(this.box.geometry, this.box.material); this.box.parent.add(o); this.extra.push(o); }
        o.scale.set(bx[3] - bx[0] + 0.004, bx[4] - bx[1] + 0.004, bx[5] - bx[2] + 0.004);
        o.position.set(x + (bx[0] + bx[3]) / 2, y + (bx[1] + bx[4]) / 2, z + (bx[2] + bx[5]) / 2);
        o.visible = true;
      });
      return;
    }
    let sx = 1, sy = 1, sz = 1, ox = 0.5, oy = 0.5, oz = 0.5;
    if (b.shape === 'cross') { sx = sz = 0.8; sy = 0.8; oy = 0.4; }
    else if (b.shape === 'torch') { sx = sz = 0.3; sy = 0.62; oy = 0.31; }
    else if (b.shape === 'wall_torch') { sx = sz = 0.32; sy = 0.62; oy = 0.5; const d = [[0, 1], [-1, 0], [0, -1], [1, 0]][b.facing]; ox += d[0] * 0.33; oz += d[1] * 0.33; }
    else if (b.shape === 'cactus') { sx = sz = 0.875; }
    this.box.scale.set(sx + 0.004, sy + 0.004, sz + 0.004);
    this.box.position.set(x + ox, y + oy, z + oz);
    this.box.visible = true;
  }
  hide() { this.box.visible = false; this.crack.visible = false; if (this.extra) for (const e of this.extra) e.visible = false; }
  setCrack(x, y, z, stage) {
    if (stage < 0) { this.crack.visible = false; return; }
    this.crack.visible = true;
    this.crack.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.crackMat.uniforms.uLayer.value = this.crackBase + Math.min(9, stage);
  }
}

// ---------------- 物品模型（手持 / 掉落物）----------------
export class ItemModels {
  constructor(tiles, tileCanvases) {
    this.tiles = tiles; this.tileCv = tileCanvases;
    this.geoCache = new Map(); this.texCache = new Map();
  }
  tileTexture(t) {
    if (!this.texCache.has(t)) {
      const tex = new THREE.CanvasTexture(this.tileCv[t]);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      this.texCache.set(t, tex);
    }
    return this.texCache.get(t);
  }
  // 由像素挤出的 3D 精灵几何体（带顶点色）
  spriteGeometry(t) {
    const key = 's' + t;
    if (this.geoCache.has(key)) return this.geoCache.get(key);
    const d = this.tiles[t];
    const pos = [], col = [];
    const A = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? 0 : d[(y * 16 + x) * 4 + 3] > 20);
    const px = 1 / 16, th = 1 / 16;
    const quad = (p, c, s) => { for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...p[i]); col.push(c[0] * s, c[1] * s, c[2] * s); } };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (!A(x, y)) continue;
      const o = (y * 16 + x) * 4;
      const c = [d[o] / 255, d[o + 1] / 255, d[o + 2] / 255].map((v) => Math.pow(v, 2.2));
      const x0 = x * px - 0.5, x1 = x0 + px, y1 = 0.5 - y * px, y0 = y1 - px, zf = th / 2, zb = -th / 2;
      quad([[x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf]], c, 1);
      quad([[x1, y0, zb], [x0, y0, zb], [x0, y1, zb], [x1, y1, zb]], c, 0.8);
      if (!A(x - 1, y)) quad([[x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb]], c, 0.7);
      if (!A(x + 1, y)) quad([[x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf]], c, 0.7);
      if (!A(x, y - 1)) quad([[x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb]], c, 0.9);
      if (!A(x, y + 1)) quad([[x0, y0, zb], [x1, y0, zb], [x1, y0, zf], [x0, y0, zf]], c, 0.6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geoCache.set(key, g);
    return g;
  }
  // 创建物品对象（返回 Object3D，材质颜色可调亮度）
  create(id) {
    const d = ITEMS.get(id);
    const group = new THREE.Group();
    const mats = [];
    if (d && d.isBlock && (SHAPE[id] === SHAPES.CUBE || SHAPE[id] === SHAPES.CACTUS)) {
      const order = [0, 1, 2, 3, 4, 5]; // three BoxGeometry: +x -x +y -y +z -z
      const shades = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
      const materials = order.map((f, i) => {
        const m = new THREE.MeshBasicMaterial({ map: this.tileTexture(FACE_TILES[id * 6 + f]), transparent: BLOCKS[id].render !== 'opaque', alphaTest: 0.3 });
        m.userData.shade = shades[i]; m.color.setScalar(shades[i]); mats.push(m); return m;
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
      group.add(mesh);
      group.userData.isBlock = true;
    } else if (d && d.isBlock && SHAPE[id] === SHAPES.MODEL && MODELS[id]) {
      // 台阶 / 楼梯 / 钟等模型方块：按模型盒子生成，UV 取纹理对应区域
      const shades = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
      for (const bx of MODELS[id]) {
        const [x0, y0, z0, x1, y1, z1] = bx.b;
        const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
        geo.translate((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5, (z0 + z1) / 2 - 0.5);
        const p = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < p.count; i++) {
          const f = Math.floor(i / 4), X = p.getX(i) + 0.5, Y = p.getY(i) + 0.5, Z = p.getZ(i) + 0.5;
          if (f < 2) uv.setXY(i, f === 0 ? 1 - Z : Z, Y);
          else if (f < 4) uv.setXY(i, X, f === 2 ? 1 - Z : Z);
          else uv.setXY(i, f === 4 ? X : 1 - X, Y);
        }
        const materials = bx.t.map((t, fi) => {
          const m = new THREE.MeshBasicMaterial({ map: this.tileTexture(t < 0 ? 0 : t), alphaTest: 0.3 });
          m.userData.shade = shades[fi]; m.color.setScalar(shades[fi]); mats.push(m); return m;
        });
        group.add(new THREE.Mesh(geo, materials));
      }
      group.userData.isBlock = true;
    } else {
      const t = d && d.isBlock ? FACE_TILES[id * 6] : TILES.indexOf('item_' + (d ? d.icon : 'stick'));
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      m.userData.shade = 1; mats.push(m);
      group.add(new THREE.Mesh(this.spriteGeometry(t), m));
      group.userData.isBlock = false;
    }
    group.userData.mats = mats;
    return group;
  }
  // 以指定贴图创建物品精灵（如拉弓中的弓）
  createIcon(t) {
    const group = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.userData.shade = 1;
    group.add(new THREE.Mesh(this.spriteGeometry(t), m));
    group.userData.isBlock = false; group.userData.mats = [m];
    return group;
  }
  setBrightness(obj, b) { for (const m of obj.userData.mats) m.color.setScalar(m.userData.shade * b); }
}

// ---------------- 天气：雨 / 雪柱状粒子（Java LevelRenderer.renderSnowAndRain 风格）----------------
function weatherTex(snow) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry32(snow ? 99 : 42);
  if (!snow) {
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * 64), y = Math.floor(r() * 256), len = 10 + Math.floor(r() * 14);
      const a = 0.35 + r() * 0.4;
      g.fillStyle = `rgba(${150 + (r() * 40) | 0},${170 + (r() * 40) | 0},255,${a})`;
      for (let k = 0; k < len; k++) g.fillRect(x, (y + k) % 256, 1, 1);
    }
  } else {
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * 62), y = Math.floor(r() * 254), s = r() < 0.4 ? 2 : 1;
      g.fillStyle = `rgba(255,255,255,${0.7 + r() * 0.3})`; g.fillRect(x, y, s, s);
    }
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export class WeatherRenderer {
  constructor(scene) {
    this.R = 10;
    const max = (this.R * 2 + 1) ** 2;
    this.meshes = {};
    for (const kind of ['rain', 'snow']) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(max * 4 * 2), 2));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 4 * 4), 4));
      const idx = new Uint32Array(max * 6);
      for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.MeshBasicMaterial({ map: weatherTex(kind === 'snow'), transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, fog: false });
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5; m.visible = false;
      scene.add(m);
      this.meshes[kind] = m;
    }
    this.heights = new Map(); this.hTick = 0;
  }
  // 降水高度缓存
  height(world, x, z) {
    const k = x * 73856093 ^ z * 19349663;
    let h = this.heights.get(k);
    if (h === undefined) { h = world.topY(x, z) + 1; this.heights.set(k, h); }
    return h;
  }
  invalidate() { this.heights.clear(); }
  update(world, cam, rain, time, darken, gamma, precipAt) {
    if (rain <= 0.001) { this.meshes.rain.visible = this.meshes.snow.visible = false; return; }
    if (++this.hTick > 20) { this.hTick = 0; this.heights.clear(); }
    const cx = Math.floor(cam.x), cy = Math.floor(cam.y), cz = Math.floor(cam.z), R = this.R;
    const cnt = { rain: 0, snow: 0 };
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, z = cz + dz;
      const d2 = dx * dx + dz * dz; if (d2 > R * R) continue;
      const kind = precipAt(x, z);
      if (!kind) continue;
      const ph = this.height(world, x, z);
      let y0 = Math.max(ph, cy - R), y1 = Math.max(ph, cy + R);
      if (y0 === y1) continue;
      const mesh = this.meshes[kind], i = cnt[kind]++;
      const pos = mesh.geometry.attributes.position.array, uv = mesh.geometry.attributes.uv.array, col = mesh.geometry.attributes.color.array;
      // 四边形朝向相机
      const ox = x + 0.5 - cam.x, oz = z + 0.5 - cam.z, L = Math.hypot(ox, oz) || 1;
      const px = -oz / L * 0.5, pz = ox / L * 0.5;
      const ax = x + 0.5 - px, az = z + 0.5 - pz, bx = x + 0.5 + px, bz = z + 0.5 + pz;
      pos.set([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], i * 12);
      const seed = ((x * 3121 + x * x * 45238971 + z * z * 418711 + z * 13761) & 31);
      let v0, v1, u0 = 0, u1 = 1;
      if (kind === 'rain') {
        const sc = (time * 0.06 * 3.2 + seed) % 32;
        v0 = (y0 * 0.25 + sc) / 4; v1 = (y1 * 0.25 + sc) / 4;
        u0 = (seed % 4) / 4; u1 = u0 + 0.25;
      } else {
        const sc = -((time * 0.004 + seed) % 32);
        v0 = (y0 * 0.25 + sc) / 4; v1 = (y1 * 0.25 + sc) / 4;
        const drift = Math.sin(time * 0.01 + seed) * 0.05 + (seed % 8) / 8;
        u0 = drift; u1 = drift + 0.25;
      }
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      const l = world.lightAt(x, Math.max(ph, cy), z);
      const br = brightness(l.sky, l.block, darken, gamma);
      const alpha = ((1 - d2 / (R * R)) * 0.5 + 0.5) * rain;
      for (let k = 0; k < 4; k++) col.set([br, br, br, alpha], i * 16 + k * 4);
    }
    for (const kind of ['rain', 'snow']) {
      const m = this.meshes[kind];
      m.visible = cnt[kind] > 0;
      m.geometry.setDrawRange(0, cnt[kind] * 6);
      m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.uv.needsUpdate = true; m.geometry.attributes.color.needsUpdate = true;
    }
  }
}

// ---------------- 闪电（Java LightningBoltRenderer 风格的折线光束）----------------
export function createLightningMesh(x, y, z, seed) {
  const r = mulberry32(seed);
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8dcff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const seg = (ax, ay, az, bx, by, bz, w) => {
    const h = Math.hypot(bx - ax, by - ay, bz - az);
    const geo = new THREE.BoxGeometry(w, h, w);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.lookAt(bx, by, bz); m.rotateX(Math.PI / 2);
    group.add(m);
  };
  const bolt = (sx, sy, sz, ey, steps, width, spread) => {
    let px = sx, py = sy, pz = sz;
    const dy = (sy - ey) / steps;
    for (let i = 0; i < steps; i++) {
      const nx = i === steps - 1 && spread < 3 ? x : px + (r() - 0.5) * spread, nz = i === steps - 1 && spread < 3 ? z : pz + (r() - 0.5) * spread, ny = py - dy;
      seg(px, py, pz, nx, ny, nz, width); seg(px, py, pz, nx, ny, nz, width * 2.4);
      px = nx; py = ny; pz = nz;
    }
    return [px, py, pz];
  };
  const top = y + 128;
  bolt(x + (r() - 0.5) * 6, top, z + (r() - 0.5) * 6, y, 16, 0.18, 2.5);
  for (let b = 0; b < 3; b++) {
    const sy = y + 30 + r() * 70;
    bolt(x + (r() - 0.5) * 8, sy, z + (r() - 0.5) * 8, sy - 20 - r() * 20, 5, 0.1, 5);
  }
  group.userData.mat = mat;
  return group;
}
