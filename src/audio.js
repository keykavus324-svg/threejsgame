// Fully synthesised sound design — no audio files, everything generated at runtime.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = .7;
    this.ready = false;
    this._lastStep = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 7;
    comp.attack.value = .003; comp.release.value = .22;
    this.master.connect(comp); comp.connect(ctx.destination);

    // convolution reverb built from decaying noise
    const len = Math.floor(ctx.sampleRate * 2.1);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.7) * (1 - t * .3);
      }
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = buf;
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = .30;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);

    // reusable white noise
    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this.distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = i / 512 - 1;
      this.distCurve[i] = Math.tanh(x * 2.6) * .82;
    }

    this._startAmbient();
    this.ready = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, .04);
  }

  _noise(dur = .4) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = dur > 1.9;
    s.playbackRate.value = .85 + Math.random() * .3;
    return s;
  }

  _out(node, vol = 1, pan = 0, reverb = .2) {
    const g = this.ctx.createGain(); g.gain.value = vol;
    let tail = node;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      tail.connect(p); tail = p;
    }
    tail.connect(g);
    g.connect(this.master);
    if (reverb > 0) {
      const rg = this.ctx.createGain(); rg.gain.value = reverb;
      g.connect(rg); rg.connect(this.reverb);
    }
    return { gain: g, node: tail };
  }

  _tone(freq, dur, type = 'sine', vol = .2, sweepTo = null, pan = 0, reverb = .1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const { gain } = this._out(o, 0, pan, reverb);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.start(t); o.stop(t + dur + .02);
  }

  _burst({ dur = .25, vol = .5, lp = 4000, hp = 100, sweep = null, pan = 0, reverb = .25, distort = false, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this._noise(dur);
    let node = src;
    const hpf = this.ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hp;
    const lpf = this.ctx.createBiquadFilter(); lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(lp, t);
    if (sweep) lpf.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
    node.connect(hpf); hpf.connect(lpf); node = lpf;
    if (distort) {
      const ws = this.ctx.createWaveShaper(); ws.curve = this.distCurve; ws.oversample = '2x';
      node.connect(ws); node = ws;
    }
    const { gain } = this._out(node, 0, pan, reverb);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.start(t); src.stop(t + dur + .03);
  }

  // ------------------------------------------------------------------ cues
  shot(kind = 'rifle', vol = 1, pan = 0) {
    if (!this.ready) return;
    const k = kind === 'dmr' ? 1.2 : kind === 'tank' ? 2.2 : 1;
    this._burst({ dur: .13 * k, vol: .50 * vol, lp: 7500, sweep: 420, hp: 130, pan, reverb: .40, distort: true });
    this._tone(kind === 'tank' ? 62 : 132, .17 * k, 'triangle', .30 * vol, 42, pan, .12);
    this._burst({ dur: .5, vol: .12 * vol, lp: 2100, sweep: 260, hp: 200, pan, reverb: .75, delay: .012 });
    if (kind === 'tank') this._burst({ dur: 1.5, vol: .22 * vol, lp: 900, sweep: 90, hp: 40, reverb: .9 });
  }

  enemyShot(distance = 30, pan = 0) {
    const v = Math.max(.06, 1 - distance / 140);
    this.shot('rifle', v * .55, pan);
    this._burst({ dur: .42, vol: .08 * v, lp: 1200, sweep: 300, hp: 180, pan, reverb: .8, delay: .03 });
  }

  explosion(power = 1, pan = 0) {
    this._burst({ dur: 1.35, vol: .62 * Math.min(1.4, power), lp: 2600, sweep: 75, hp: 35, pan, reverb: .85, distort: true });
    this._tone(78, .85, 'sine', .42 * Math.min(1.4, power), 26, pan, .3);
    this._burst({ dur: .25, vol: .28, lp: 12000, sweep: 900, hp: 900, pan, reverb: .35 });
  }

  impact(type = 'dirt') {
    this._burst({ dur: .08, vol: .16, lp: type === 'metal' ? 8500 : 3200, sweep: 500, hp: 400, reverb: .18 });
    if (type === 'metal') this._tone(1800 + Math.random() * 900, .16, 'triangle', .09, 700, 0, .25);
  }

  hit(head = false) {
    this._tone(head ? 1250 : 880, .09, 'square', .075, head ? 1650 : 1050, 0, .05);
    if (head) this._tone(1850, .12, 'sine', .05, 2200, 0, .05);
  }

  reload(stage = 0) {
    const f = [420, 700, 300, 900][stage % 4];
    this._burst({ dur: .045, vol: .17, lp: 6000, sweep: 1200, hp: 700, reverb: .12 });
    this._tone(f, .06, 'triangle', .07, f * .6, 0, .08);
  }

  footstep(sprint = false) {
    this._burst({ dur: .11, vol: sprint ? .13 : .085, lp: 1100, sweep: 190, hp: 60, reverb: .12 });
  }

  ui(kind = 'click') {
    if (kind === 'confirm') { this._tone(520, .12, 'sine', .1, 780, 0, .1); this._tone(780, .18, 'sine', .07, 1040, 0, .1); }
    else if (kind === 'alarm') { this._tone(440, .3, 'square', .08, 300, 0, .2); }
    else this._tone(660, .05, 'square', .05, 560, 0, .03);
  }

  whizz() { this._burst({ dur: .16, vol: .1, lp: 5200, sweep: 900, hp: 1400, reverb: .3 }); }

  dryFire() { this._burst({ dur: .035, vol: .12, lp: 7000, hp: 1200, reverb: .05 }); }

  radio() {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) {
      this._burst({ dur: .09 + Math.random() * .1, vol: .055, lp: 2800, hp: 900, reverb: .2, delay: i * .14 });
    }
    this._tone(1120, .05, 'square', .035, 900, 0, 0);
  }

  engine(on = true) {
    if (!this.ready) return;
    if (on && !this._engine) {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 46;
      const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
      const lg = this.ctx.createGain(); lg.gain.value = 8;
      lfo.connect(lg); lg.connect(o.frequency);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t);
      g.gain.setTargetAtTime(.11, t, .3);
      this._engine = { o, lfo, g, f };
    } else if (!on && this._engine) {
      const { o, lfo, g } = this._engine;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, .15);
      setTimeout(() => { try { o.stop(); lfo.stop(); } catch (e) {} }, 600);
      this._engine = null;
    }
  }

  // ------------------------------------------------------------------ beds
  _startAmbient() {
    const ctx = this.ctx, t = ctx.currentTime;
    // wind
    const w = this._noise(3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const wg = ctx.createGain(); wg.gain.value = .055;
    const lfo = ctx.createOscillator(); lfo.frequency.value = .11;
    const lg = ctx.createGain(); lg.gain.value = .035;
    lfo.connect(lg); lg.connect(wg.gain);
    w.connect(lp); lp.connect(wg); wg.connect(this.master);
    w.start(t); lfo.start(t);
    // low cinematic drone
    [55, 82.4, 110].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = .017 - i * .004;
      const fl = ctx.createOscillator(); fl.frequency.value = .05 + i * .02;
      const fg = ctx.createGain(); fg.gain.value = .008;
      fl.connect(fg); fg.connect(g.gain);
      o.connect(g); g.connect(this.master);
      o.start(t); fl.start(t);
    });
    // distant artillery / thunder
    this._rumbleTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (Math.random() < .55) {
        this._burst({ dur: 1.9, vol: .075, lp: 480, sweep: 60, hp: 30, reverb: .95 });
      }
    }, 7200);
  }
}
