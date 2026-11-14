/**
 * Fixed-timestep engine core.
 * - deterministic 60 Hz simulation (fixed systems), interpolated render (frame systems)
 * - ordered system scheduler with per-system profiling
 * - frame stats, quality presets, pause / time scale
 */
export class Engine {
  constructor({ renderer = null, onFrame = null, onFixed = null } = {}) {
    this.renderer = renderer;
    this.onFrame = onFrame;
    this.onFixed = onFixed;
    this.STEP = 1 / 60;
    this.systems = [];
    this.running = false;
    this.timeScale = 1;
    this.accumulator = 0;
    this.simTime = 0;
    this.wallTime = 0;
    this.frame = 0;
    this.last = 0;
    this.profile = new Map();
    this.stats = { fps: 60, frameMs: 16.7, simSteps: 0, drawCalls: 0, triangles: 0, programs: 0 };
    this._raf = null;
    this._fpsAcc = 0; this._fpsFrames = 0;
  }

  /** fn(dt, ctx). fixed=true → runs at exactly STEP; false → runs once per rendered frame. */
  addSystem(name, fn, { fixed = false, order = 0, enabled = true } = {}) {
    this.systems.push({ name, fn, fixed, order, enabled });
    this.systems.sort((a, b) => a.order - b.order);
    this.profile.set(name, 0);
    return this;
  }

  setEnabled(name, on) {
    const s = this.systems.find(x => x.name === name);
    if (s) s.enabled = on;
  }

  _run(list, dt, ctx) {
    const t0 = performance.now();
    for (const s of list) {
      if (!s.enabled) continue;
      const a = performance.now();
      try { s.fn(dt, ctx); } catch (e) { console.error('[engine:' + s.name + ']', e); }
      this.profile.set(s.name, (this.profile.get(s.name) || 0) * .9 + (performance.now() - a) * .1);
    }
    return performance.now() - t0;
  }

  /** One engine tick. Separated from RAF so it can be driven by tests. */
  tick(dtRaw, ctx = {}) {
    const dt = Math.min(dtRaw, .1);
    this.wallTime += dt;
    this.frame++;
    this.accumulator += dt * this.timeScale;
    const fixed = this.systems.filter(s => s.fixed);
    const frame = this.systems.filter(s => !s.fixed);
    let steps = 0;
    const t0 = performance.now();
    while (this.accumulator >= this.STEP && steps < 5) {
      this.simTime += this.STEP;
      this._run(fixed, this.STEP, { ...ctx, dt: this.STEP, t: this.simTime, fixed: true, frame: this.frame });
      this.onFixed?.(this.STEP, this.simTime);
      this.accumulator -= this.STEP;
      steps++;
    }
    if (steps === 5) this.accumulator = 0; // avoid spiral of death
    const frameMs = this._run(frame, dt, { ...ctx, dt, t: ctx.t ?? this.wallTime, fixed: false, frame: this.frame, steps });
    this.onFrame?.(dt, ctx.t ?? this.wallTime);
    this.stats.simSteps = steps;
    this.stats.frameMs = performance.now() - t0;
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= .5) {
      this.stats.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0; this._fpsFrames = 0;
    }
    if (this.renderer?.info) {
      this.stats.drawCalls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.stats.programs = this.renderer.info.programs?.length || 0;
    }
    return frameMs;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.tick(dt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; if (this._raf) cancelAnimationFrame(this._raf); }

  report() {
    return [...this.profile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => `${k} ${v.toFixed(2)}ms`).join(' · ');
  }
}
