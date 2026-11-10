// 玩家：生存属性（生命/饥饿/饱和度/消耗度）、飞行、疾跑、潜行、视角摇晃
import { Living } from './entities.js';
import { Inventory, CraftGrid } from './inventory.js';
import { ITEMS, BLOCKS } from './registry.js';
import { isInLiquidAt } from './physics.js';

export class Player extends Living {
  constructor(game) {
    super(game, 0, 100, 0);
    this.width = 0.6; this.height = 1.8;
    this.speed = 0.1;
    this.mode = 'survival';
    this.inventory = new Inventory();
    this.craft2 = new CraftGrid(2);
    this.food = 20; this.saturation = 5; this.exhaustion = 0; this.foodTimer = 0;
    this.canDrown = true;
    this.eyeInWater = false; this.eyeInLava = false;
    this.distWalked = 0; this.prevDistWalked = 0; this.nextStep = 1;
    this.bob = 0; this.prevBob = 0;
    this.fovMod = 1; this.prevFovMod = 1;
    this.swingTicks = 0; this.swinging = false;
    this.lastAttackTicks = 100;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this.pitch = 0; this.yaw = 0;
    this.sneakHeight = 0;
    this.wasInWater = false;
  }
  eyeHeight() { return this.sneaking && !this.flying ? 1.54 : 1.62; }
  get mayFly() { return this.mode === 'creative'; }
  addExhaustion(v) { if (this.mode === 'survival') this.exhaustion = Math.min(40, this.exhaustion + v); }
  hurt(amount, source, attacker) {
    if (this.mode === 'creative' && source !== 'void' && source !== 'kill') return false;
    if (this.dead) return false;
    const r = super.hurt(amount, source, attacker);
    if (r) { this.addExhaustion(0.1); this.game.onPlayerHurt(source); }
    return r;
  }
  fall(d) {
    if (this.flying || this.mode === 'creative') return;
    super.fall(d);
    if (d > 3) this.game.audio.play(d > 6 ? 'fallbig' : 'fallsmall');
  }
  die(source) {
    super.die(source);
    this.game.onPlayerDeath(source);
  }
  jump() {
    super.jump();
    this.addExhaustion(this.sprinting ? 0.2 : 0.05);
  }
  attackPeriod() {
    const held = this.inventory.held();
    const d = held && ITEMS.get(held.id);
    const spd = d && d.tool ? d.tool.attackSpeed : 4;
    return 20 / spd;
  }
  attackCooldownProgress() { return Math.min(1, (this.lastAttackTicks + 0.5) / this.attackPeriod()); }
  tick(input) {
    this.savePrev();
    this.prevDistWalked = this.distWalked; this.prevBob = this.bob; this.prevFovMod = this.fovMod;
    this.lastAttackTicks++;
    if (this.dead) { this.deathTime++; return; }
    this.baseTick();
    this.eyeInWater = isInLiquidAt(this.game.world, this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z, 'water');
    this.eyeInLava = isInLiquidAt(this.game.world, this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z, 'lava');
    if (this.inWater && !this.wasInWater && this.fallDistance > 0.5) this.game.audio.play('splash');
    this.wasInWater = this.inWater;

    // 输入
    let fwd = 0, str = 0;
    if (input.forward) fwd += 1; if (input.back) fwd -= 1;
    if (input.right) str += 1; if (input.left) str -= 1;
    this.sneaking = input.sneak && !this.flying;
    fwd *= 0.98; str *= 0.98;
    if (this.sneaking) { fwd *= 0.3; str *= 0.3; }
    if (this.usingItem) { fwd *= 0.2; str *= 0.2; }
    // 疾跑
    const canSprint = (this.food > 6 || this.mode === 'creative') && !this.sneaking && !this.usingItem;
    if (!this.sprinting && fwd >= 0.8 && canSprint && (input.sprint || input.sprintTap)) this.sprinting = true;
    if (this.sprinting && (fwd < 0.8 || this.collidedH || !canSprint)) this.sprinting = false;
    // 飞行
    if (!this.mayFly) this.flying = false;
    if (this.flying) {
      if (input.sneak) this.vel.y -= 0.15;
      if (input.jump) this.vel.y += 0.15;
    }
    this.forward = fwd; this.strafe = str;
    this.jumping = input.jump && !this.flying;
    const ox = this.pos.x, oz = this.pos.z, oy = this.pos.y;
    this.travel();
    if (this.flying && this.onGround) this.flying = false;
    // 统计 & 消耗
    const dx = this.pos.x - ox, dz = this.pos.z - oz, dy = this.pos.y - oy;
    const hd = Math.sqrt(dx * dx + dz * dz);
    if (this.inWater) this.addExhaustion(0.01 * Math.sqrt(dx * dx + dy * dy + dz * dz));
    else if (this.sprinting && this.onGround) this.addExhaustion(0.1 * hd);
    // 脚步声 & 视角摇晃（MC：distanceWalkedModified += 水平距离 * 0.6）
    if (this.onGround && !this.flying) {
      this.distWalked += hd * 0.6;
      if (this.distWalked > this.nextStep) {
        this.nextStep = Math.floor(this.distWalked) + 1;
        const b = this.game.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z));
        if (b > 0 && !this.sneaking) this.game.audio.step(BLOCKS[b].sound);
      }
    } else if (this.inWater && hd > 0.05 && this.age % 12 === 0) this.game.audio.play('swim');
    const targetBob = this.onGround && !this.dead ? Math.min(0.1, hd) : 0;
    this.bob += (targetBob - this.bob) * 0.4;
    // 视野修正
    let f = 1;
    if (this.flying) f *= 1.1;
    f *= ((this.sprinting ? 1.3 : 1) + 1) / 2;
    if (this.usingItem && this.usingBow) f *= 0.85;
    this.fovMod += (f - this.fovMod) * 0.5;
    this.foodTick();
  }
  foodTick() {
    if (this.mode !== 'survival') { this.food = 20; this.saturation = 5; return; }
    if (this.exhaustion > 4) { this.exhaustion -= 4; if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1); else this.food = Math.max(0, this.food - 1); }
    if (this.saturation > 0 && this.food >= 20 && this.health < this.maxHealth) {
      if (++this.foodTimer >= 10) { const f = Math.min(this.saturation, 6); this.heal(f / 6); this.addExhaustion(f); this.foodTimer = 0; }
    } else if (this.food >= 18 && this.health < this.maxHealth) {
      if (++this.foodTimer >= 80) { this.heal(1); this.addExhaustion(6); this.foodTimer = 0; }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= 80) { if (this.health > 1) this.hurt(1, 'starve'); this.foodTimer = 0; }
    } else this.foodTimer = 0;
  }
  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }
  eat(id) {
    const d = ITEMS.get(id); if (!d || !d.food) return;
    this.food = Math.min(20, this.food + d.food[0]);
    this.saturation = Math.min(this.food, this.saturation + d.food[1]);
  }
  canEat() { return this.mode === 'creative' ? false : this.food < 20; }
  reset() {
    this.health = this.maxHealth; this.food = 20; this.saturation = 5; this.exhaustion = 0; this.airSupply = 300;
    this.dead = false; this.deathTime = 0; this.fallDistance = 0; this.vel.set(0, 0, 0); this.hurtTime = 0; this.flying = false;
  }
  toJSON() {
    return { pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, pitch: this.pitch, health: this.health, food: this.food, saturation: this.saturation, exhaustion: this.exhaustion,
      air: this.airSupply, mode: this.mode, flying: this.flying, inventory: this.inventory.toJSON(), spawn: this.spawn, dead: this.dead };
  }
  load(o) {
    if (!o) return;
    this.pos.set(...o.pos); this.prevPos.copy(this.pos);
    this.yaw = o.yaw || 0; this.pitch = o.pitch || 0;
    this.health = o.health ?? 20; this.food = o.food ?? 20; this.saturation = o.saturation ?? 5; this.exhaustion = o.exhaustion || 0;
    this.airSupply = o.air ?? 300; this.mode = o.mode || 'survival'; this.flying = !!o.flying;
    this.inventory.load(o.inventory); if (o.spawn) this.spawn = o.spawn;
    if (this.health <= 0) { this.health = 20; }
  }
}
