/** Uniform-grid spatial index: O(1) neighbour queries instead of O(n²). */
export class SpatialHash {
  constructor(cell = 8) { this.cell = cell; this.cells = new Map(); this.items = new Set(); }
  _key(x, z) { return Math.floor(x / this.cell) + ':' + Math.floor(z / this.cell); }
  clear() { this.cells.clear(); this.items.clear(); }
  insert(item, x, z) {
    const k = this._key(x, z);
    let c = this.cells.get(k);
    if (!c) { c = []; this.cells.set(k, c); }
    c.push(item); this.items.add(item);
  }
  rebuild(items, getX = o => o.pos.x, getZ = o => o.pos.z) {
    this.clear();
    for (const it of items) this.insert(it, getX(it), getZ(it));
  }
  query(x, z, radius, out = []) {
    out.length = 0;
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const c = this.cells.get((cx + i) + ':' + (cz + j));
        if (c) for (const it of c) out.push(it);
      }
    }
    return out;
  }
  nearest(x, z, radius, filter = null) {
    const c = this.query(x, z, radius);
    let best = null, bd = radius * radius;
    for (const it of c) {
      if (filter && !filter(it)) continue;
      const dx = (it.pos?.x ?? it.x) - x, dz = (it.pos?.z ?? it.z) - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
}
