// WebAudio 合成音效（无外部音频文件）
export class Audio {
  constructor() {
    this.ctx = null; this.volume = 1; this.musicVolume = 0.5; this.noiseBuf = null; this.musicTimer = 0; this.musicOn = true;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.musicTimer = 60 + Math.random() * 120;
    } catch (e) { this.ctx = null; }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  noise(dur, freq, q, vol, type = 'bandpass', attack = 0.005, when = 0, rate = 1) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1); src.stop(t + dur + 0.05);
  }
  tone(freq, dur, vol, type = 'sine', when = 0, freqEnd = null, attack = 0.01) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // 材质参数：[频率, Q, 时长, 音量]
  mat(m) {
    switch (m) {
      case 'grass': return [2600, 0.6, 0.18, 0.35];
      case 'gravel': return [1500, 0.8, 0.2, 0.45];
      case 'sand': return [3400, 0.5, 0.22, 0.3];
      case 'wood': return [520, 2.5, 0.16, 0.55];
      case 'glass': return [3800, 3, 0.12, 0.35];
      case 'cloth': return [900, 0.4, 0.15, 0.3];
      case 'snow': return [4200, 0.4, 0.2, 0.3];
      case 'metal': return [1800, 6, 0.18, 0.4];
      case 'water': return [800, 0.5, 0.3, 0.2];
      default: return [1100, 1.2, 0.14, 0.5]; // stone
    }
  }
  step(m, vol = 1) { if (!this.ctx) return; const [f, q, d, v] = this.mat(m); this.noise(d * 0.8, f * (0.85 + Math.random() * 0.3), q, v * 0.35 * vol, 'bandpass', 0.005); }
  dig(m) { if (!this.ctx) return; const [f, q, d, v] = this.mat(m); this.noise(d * 0.7, f * (0.9 + Math.random() * 0.2), q, v * 0.3, 'bandpass', 0.003); }
  breakBlock(m) {
    if (!this.ctx) return;
    const [f, q, d, v] = this.mat(m);
    if (m === 'glass') { for (let i = 0; i < 6; i++) this.tone(2000 + Math.random() * 3000, 0.15 + Math.random() * 0.2, 0.08, 'triangle', i * 0.02); this.noise(0.3, 4000, 1, 0.3, 'highpass'); return; }
    this.noise(d * 1.6, f * 0.8, q * 0.7, v * 0.8, 'bandpass', 0.003);
    this.noise(d * 1.2, f * 1.3, q, v * 0.4, 'bandpass', 0.003, 0.03);
  }
  place(m) { if (!this.ctx) return; const [f, q, d, v] = this.mat(m); this.noise(d * 1.2, f * 0.9, q, v * 0.7, 'bandpass', 0.003); }
  play(name, opts = {}) {
    if (!this.ctx) return;
    const vol = opts.vol ?? 1;
    switch (name) {
      case 'click': this.tone(1200, 0.05, 0.2 * vol, 'square', 0, 900); break;
      case 'pop': this.tone(600 + Math.random() * 300, 0.08, 0.25 * vol, 'sine', 0, 1400); break;
      case 'hurt': this.tone(320, 0.18, 0.35 * vol, 'sawtooth', 0, 160); this.noise(0.12, 600, 1, 0.3 * vol); break;
      case 'eat': for (let i = 0; i < 3; i++) this.noise(0.07, 1500 + Math.random() * 1000, 1.5, 0.35 * vol, 'bandpass', 0.003, i * 0.07); break;
      case 'burp': this.tone(140, 0.35, 0.3 * vol, 'sawtooth', 0, 90, 0.05); break;
      case 'splash': this.noise(0.6, 1200, 0.5, 0.5 * vol, 'lowpass', 0.01); this.noise(0.4, 3000, 0.8, 0.25 * vol, 'bandpass', 0.01, 0.05); break;
      case 'swim': this.noise(0.4, 900, 0.5, 0.15 * vol, 'lowpass', 0.05); break;
      case 'fizz': this.noise(0.5, 5000, 0.5, 0.3 * vol, 'highpass', 0.01); break;
      case 'bucket': this.noise(0.3, 900, 1, 0.3 * vol, 'lowpass'); break;
      case 'fallsmall': this.noise(0.15, 500, 1, 0.4 * vol, 'lowpass'); break;
      case 'fallbig': this.noise(0.3, 300, 1, 0.6 * vol, 'lowpass'); this.tone(200, 0.2, 0.3 * vol, 'sawtooth', 0, 100); break;
      case 'attack': this.noise(0.08, 2000, 1, 0.2 * vol, 'highpass'); break;
      case 'pig': { const o = this.tone(260, 0.25, 0.25 * vol, 'sawtooth', 0, 200, 0.02); if (o) { const l = this.ctx.createOscillator(); l.frequency.value = 30; const lg = this.ctx.createGain(); lg.gain.value = 40; l.connect(lg); lg.connect(o.frequency); l.start(); l.stop(this.ctx.currentTime + 0.3); } break; }
      case 'pig_hurt': this.tone(420, 0.2, 0.3 * vol, 'sawtooth', 0, 300); break;
      case 'pig_death': this.tone(380, 0.4, 0.3 * vol, 'sawtooth', 0, 150); break;
      case 'cow': this.tone(110, 0.9, 0.3 * vol, 'sawtooth', 0, 95, 0.15); this.tone(220, 0.9, 0.1 * vol, 'sawtooth', 0, 190, 0.15); break;
      case 'cow_hurt': this.tone(160, 0.3, 0.3 * vol, 'sawtooth', 0, 120); break;
      case 'cow_death': this.tone(130, 0.6, 0.3 * vol, 'sawtooth', 0, 70); break;
      case 'sheep': { const o = this.tone(420, 0.6, 0.18 * vol, 'square', 0, 380, 0.05); if (o) { const l = this.ctx.createOscillator(); l.frequency.value = 12; const lg = this.ctx.createGain(); lg.gain.value = 25; l.connect(lg); lg.connect(o.frequency); l.start(); l.stop(this.ctx.currentTime + 0.7); } break; }
      case 'sheep_hurt': this.tone(500, 0.25, 0.2 * vol, 'square', 0, 400); break;
      case 'sheep_death': this.tone(460, 0.5, 0.2 * vol, 'square', 0, 250); break;
      case 'zombie': this.tone(85, 1.0, 0.3 * vol, 'sawtooth', 0, 70, 0.2); this.noise(1.0, 300, 1, 0.15 * vol, 'lowpass', 0.2); break;
      case 'zombie_hurt': this.tone(120, 0.3, 0.3 * vol, 'sawtooth', 0, 80); break;
      case 'zombie_death': this.tone(100, 0.8, 0.3 * vol, 'sawtooth', 0, 50); break;
      case 'levelup': [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 0.15 * vol, 'triangle', i * 0.08)); break;
    }
  }
  // 简单的环境音乐：偶尔播放一段柔和的五声音阶钢琴旋律
  updateMusic(dt) {
    if (!this.ctx || !this.musicOn || this.musicVolume <= 0) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 240 + Math.random() * 300;
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3];
    let t = 0;
    let idx = Math.floor(Math.random() * 4);
    for (let i = 0; i < 28; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(Math.random() * 5) - 2));
      const f = scale[idx] * (Math.random() < 0.2 ? 0.5 : 1);
      this.pianoNote(f, t, 0.08 * this.musicVolume);
      if (Math.random() < 0.3) this.pianoNote(f / 2, t, 0.05 * this.musicVolume);
      t += [0.5, 0.75, 1, 1.5][Math.floor(Math.random() * 4)];
    }
  }
  pianoNote(f, when, vol) {
    this.tone(f, 2.2, vol, 'triangle', when, null, 0.005);
    this.tone(f * 2, 1.2, vol * 0.3, 'sine', when, null, 0.005);
  }
}
