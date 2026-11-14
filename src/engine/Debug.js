/** F3 developer overlay: engine profile, renderer stats, world/AI counters. */
export class Debug {
  constructor(engine, game) {
    this.engine = engine;
    this.game = game;
    this.visible = false;
    this.el = document.getElementById('debug-overlay');
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'debug-overlay';
      document.body.appendChild(this.el);
    }
    this.el.className = 'hidden';
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.toggle(); }
    });
  }
  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }
  update() {
    if (!this.visible) return;
    const g = this.game, s = this.engine.stats;
    const rows = [
      `IRON HORIZON · ENGINE DIAGNOSTICS`,
      `state        ${g.state}`,
      `fps          ${s.fps.toFixed(1)}   frame ${s.frameMs.toFixed(2)}ms   fixed steps ${s.simSteps}`,
      `draw calls   ${s.drawCalls}   triangles ${(s.triangles / 1000).toFixed(0)}k   programs ${s.programs}`,
      `sim time     ${g.time.toFixed(1)}s   frame ${this.engine.frame}`,
      `entities     ${g.enemies?.units.length ?? 0}   projectiles ${g.physics?.projectiles.length ?? 0}`,
      `nav cells    ${g.nav ? g.nav.N + '×' + g.nav.N : '-'}   cover ${g.nav?.cover.length ?? 0}`,
      `weather      ${g.weather?.mode ?? '-'}   wind ${g.weather?.wind.toFixed?.(1) ?? '-'}`,
      `camera       ${g.camera.position.x.toFixed(1)}, ${g.camera.position.y.toFixed(1)}, ${g.camera.position.z.toFixed(1)}`,
      ``,
      `SYSTEMS (ms)`,
      ...[...this.engine.profile.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `  ${k.padEnd(16)} ${v.toFixed(2)}`),
      ``,
      `F3 kapat · grafik: ${g.settings.quality} · zaman: ${g.settings.timeOfDay}`,
    ];
    this.el.textContent = rows.join('\n');
  }
}
