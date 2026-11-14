import * as THREE from 'three';
import { clamp } from '../utils.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Walkability grid + A* with string-pulling, plus tactical cover extraction. */
export class NavGrid {
  constructor(world, physics, cell = 4) {
    this.world = world;
    this.physics = physics;
    this.cell = cell;
    this.N = Math.floor(340 / cell);
    this.half = this.N * cell / 2;
    this.walk = new Uint8Array(this.N * this.N);
    this.height = new Float32Array(this.N * this.N);
    this.cover = [];
    this._g = new Float32Array(this.N * this.N);
    this._parent = new Int32Array(this.N * this.N);
    this._stamp = new Int32Array(this.N * this.N);
    this._run = 0;
  }

  idx(ix, iz) { return iz * this.N + ix; }
  toGrid(x, z) { return [clamp(Math.floor((x + this.half) / this.cell), 0, this.N - 1), clamp(Math.floor((z + this.half) / this.cell), 0, this.N - 1)]; }
  toWorld(ix, iz) { return new THREE.Vector3(ix * this.cell - this.half + this.cell / 2, 0, iz * this.cell - this.half + this.cell / 2); }

  build() {
    const { world, cell, N } = this;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = ix * cell - this.half + cell / 2, z = iz * cell - this.half + cell / 2;
        const h = world.heightAt(x, z);
        const id = this.idx(ix, iz);
        this.height[id] = h;
        // slope check against neighbours
        const hx = world.heightAt(x + cell, z), hz = world.heightAt(x, z + cell);
        const slope = Math.hypot(hx - h, hz - h) / cell;
        let w = slope < .62 && Math.abs(x) < 158 && Math.abs(z) < 158 ? 1 : 0;
        if (w) {
          for (const b of world.colliders) {
            if (b.broken || b.maxY < h + .4) continue;
            if (x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1) { w = 0; break; }
          }
        }
        this.walk[id] = w;
      }
    }
    this._buildCover();
    return this;
  }

  _buildCover() {
    this.cover.length = 0;
    for (const b of this.world.colliders) {
      if (b.broken) continue;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const rx = (b.maxX - b.minX) / 2 + 1.0, rz = (b.maxZ - b.minZ) / 2 + 1.0;
      if (b.maxY - b.minY < .6) continue;
      const pts = [[0, -rz], [0, rz], [-rx, 0], [rx, 0], [-rx, -rz], [rx, -rz], [-rx, rz], [rx, rz]];
      for (const [dx, dz] of pts) {
        const x = cx + dx, z = cz + dz;
        const [ix, iz] = this.toGrid(x, z);
        if (!this.walk[this.idx(ix, iz)]) continue;
        this.cover.push({
          pos: new THREE.Vector3(x, this.world.heightAt(x, z), z),
          normal: new THREE.Vector3(-dx, 0, -dz).normalize(),
          height: b.maxY - b.minY,
        });
      }
    }
  }

  /** Called after destructible props break so paths can route through the gap. */
  invalidateCollider(b) {
    if (b) b.broken = true;
    // cheap local update
    const min = this.toGrid(b.minX - 2, b.minZ - 2), max = this.toGrid(b.maxX + 2, b.maxZ + 2);
    for (let iz = min[1]; iz <= max[1]; iz++) {
      for (let ix = min[0]; ix <= max[0]; ix++) {
        const p = this.toWorld(ix, iz);
        const h = this.world.heightAt(p.x, p.z);
        const slope = Math.hypot(this.world.heightAt(p.x + this.cell, p.z) - h, this.world.heightAt(p.x, p.z + this.cell) - h) / this.cell;
        this.walk[this.idx(ix, iz)] = slope < .62 ? 1 : 0;
        this.height[this.idx(ix, iz)] = h;
      }
    }
  }

  /** Grid-space Bresenham visibility — much cheaper than a mesh raycast. */
  clearLine(a, b) {
    let [x0, z0] = this.toGrid(a.x, a.z), [x1, z1] = this.toGrid(b.x, b.z);
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz, guard = 0;
    while (guard++ < 400) {
      if (!this.walk[this.idx(x0, z0)]) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
    return false;
  }

  findPath(from, to) {
    const [sx, sz] = this.toGrid(from.x, from.z);
    const [tx, tz] = this.toGrid(to.x, to.z);
    const start = this.idx(sx, sz), goal = this.idx(tx, tz);
    if (!this.walk[goal]) {
      let best = -1, bd = 1e9;
      for (let iz = Math.max(0, tz - 4); iz <= Math.min(this.N - 1, tz + 4); iz++) {
        for (let ix = Math.max(0, tx - 4); ix <= Math.min(this.N - 1, tx + 4); ix++) {
          const id = this.idx(ix, iz);
          if (!this.walk[id]) continue;
          const d = (ix - sx) ** 2 + (iz - sz) ** 2;
          if (d < bd) { bd = d; best = id; }
        }
      }
      if (best < 0) return [to.clone()];
      return this._astar(start, best, from, to);
    }
    return this._astar(start, goal, from, to);
  }

  _astar(start, goal, from, to) {
    this._run++;
    const { N, walk, _g: g, _parent: par, _stamp: st } = this;
    const heap = new MinHeap();
    g[start] = 0; par[start] = -1; st[start] = this._run;
    heap.push({ id: start, f: 0 });
    const gx = goal % N, gz = (goal / N) | 0;
    const H = (id) => {
      const x = id % N, z = (id / N) | 0;
      const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
    };
    let found = false, guard = 0;
    while (heap.size && guard++ < 6000) {
      const cur = heap.pop().id;
      if (cur === goal) { found = true; break; }
      const cx = cur % N, cz = (cur / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const id = this.idx(nx, nz);
          if (!walk[id]) continue;
          if (dx && dz) {
            if (!walk[this.idx(cx + dx, cz)] || !walk[this.idx(cx, cz + dz)]) continue;
          }
          const step = (dx && dz ? 1.4142 : 1) * (1 + Math.abs(this.height[id] - this.height[cur]) * .12);
          const ng = (st[cur] === this._run ? g[cur] : 0) + step;
          if (st[id] === this._run && ng >= g[id]) continue;
          st[id] = this._run; g[id] = ng; par[id] = cur;
          heap.push({ id, f: ng + H(id) * 1.06 });
        }
      }
    }
    if (!found) return [to.clone()];
    // reconstruct
    const ids = [];
    let c = goal;
    while (c !== -1 && ids.length < 800) { ids.push(c); c = par[c]; }
    ids.reverse();
    // string pulling
    const pts = ids.map(id => this.toWorld(id % N, (id / N) | 0));
    for (const p of pts) p.y = this.world.heightAt(p.x, p.z);
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this.clearLine(pts[i], pts[j])) break;
      out.push(pts[j].clone());
      i = j;
    }
    if (!out.length) out.push(to.clone());
    out[out.length - 1] = to.clone();
    return out;
  }

  nearestCover(pos, threat, maxDist = 45) {
    let best = null, score = -1e9;
    for (const c of this.cover) {
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d > maxDist) continue;
      const tdx = threat.x - c.pos.x, tdz = threat.z - c.pos.z;
      const tl = Math.hypot(tdx, tdz) || 1;
      // cover must be between us and the threat
      const facing = (c.normal.x * tdx + c.normal.z * tdz) / tl;
      const s = facing * 3.2 - d * .06 + Math.random() * .4;
      if (s > score) { score = s; best = c; }
    }
    return best;
  }

  randomPointNear(pos, radius = 12) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
      const x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d;
      const [ix, iz] = this.toGrid(x, z);
      if (this.walk[this.idx(ix, iz)]) return new THREE.Vector3(x, this.height[this.idx(ix, iz)], z);
    }
    return pos.clone();
  }
}
