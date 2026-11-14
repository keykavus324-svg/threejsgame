import { clamp } from '../utils.js';

/** Anamorphic lens flare + ghost chain, drawn on a cheap 2D overlay canvas. */
export class LensFlare {
  constructor() {
    this.canvas = document.getElementById('flare-canvas');
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'flare-canvas';
      document.body.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.h = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    this.w = this.canvas.width = Math.min(innerWidth, 1920);
    this.h = this.canvas.height = Math.min(innerHeight, 1080);
  }
  /** sx, sy in [0,1] screen space; visibility 0..1; power 0..1 */
  draw(sx, sy, visibility, power = 1, tint = [255, 196, 128]) {
    const c = this.ctx, W = this.w, H = this.h;
    c.clearRect(0, 0, W, H);
    if (visibility <= .01) return;
    const x = sx * W, y = sy * H;
    const dx = W / 2 - x, dy = H / 2 - y;
    const strength = clamp(visibility * power, 0, 1);
    c.globalCompositeOperation = 'lighter';
    // horizontal anamorphic streak
    const streak = c.createLinearGradient(0, y, W, y);
    streak.addColorStop(0, 'rgba(80,140,255,0)');
    streak.addColorStop(.5, `rgba(150,190,255,${.11 * strength})`);
    streak.addColorStop(1, 'rgba(80,140,255,0)');
    c.fillStyle = streak; c.fillRect(0, y - 2.5, W, 5);
    // ghosts along the optical axis
    const ghosts = [
      [-1.15, 34, .15, [120, 170, 255]], [-.62, 16, .11, [255, 150, 110]],
      [-.28, 9, .09, [160, 220, 255]], [.22, 13, .13, [255, 190, 130]],
      [.58, 24, .10, [110, 200, 255]], [.95, 42, .07, [255, 130, 90]],
      [1.48, 20, .08, [190, 220, 255]],
    ];
    for (const [t, radius, alpha, col] of ghosts) {
      const gx = x + dx * t, gy = y + dy * t;
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, radius);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha * strength})`);
      g.addColorStop(.62, `rgba(${col[0]},${col[1]},${col[2]},${alpha * .35 * strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(gx, gy, radius, 0, Math.PI * 2); c.fill();
    }
    // halo around the sun
    const halo = c.createRadialGradient(x, y, 0, x, y, 120);
    halo.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${.28 * strength})`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = halo; c.beginPath(); c.arc(x, y, 120, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
}
