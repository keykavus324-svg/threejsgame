export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftDown: false, rightDown: false, wheel: 0 };
    this.locked = false;
    this.forceLook = false; // fallback when the preview iframe blocks pointer lock
    this.onLockChange = null;
    this.sensitivity = 1;
    const active = () => this.locked || this.forceLook;

    addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    addEventListener('mousemove', (e) => {
      if (!active()) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    addEventListener('mousedown', (e) => {
      if (!active()) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftDown = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('wheel', (e) => { if (active()) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p?.catch) p.catch(() => { this.forceLook = true; this.onLockChange?.(true); });
      // browsers that never resolve nor reject (older implementations)
      setTimeout(() => { if (!this.locked && this.forceLook === false) this.forceLook = true; }, 900);
    } catch (e) { this.forceLook = true; }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  consume(code) { const v = this.pressed.has(code); this.pressed.delete(code); return v; }
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.leftDown = false; this.mouse.rightDown = false;
    this.mouse.wheel = 0;
  }
}
