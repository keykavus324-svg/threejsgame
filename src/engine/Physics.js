import * as THREE from 'three';
import { clamp } from '../utils.js';

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();

/**
 * Gameplay physics: swept capsule vs. static AABBs, ballistic integration,
 * sphere overlap, raycast and damage falloff. Kept deliberately independent
 * from rendering so it also runs in the headless smoke test.
 */
export class Physics {
  constructor(world, bus) {
    this.world = world;
    this.bus = bus;
    this.gravity = -20.5;
    this.projectiles = [];
    this.substeps = 3;
  }

  /** Ground height + static collision resolution for a capsule-like actor. */
  move(pos, vel, dt, radius = .43, height = 1.75, stepHeight = .55) {
    const n = this.substeps;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      pos.x += vel.x * h;
      pos.z += vel.z * h;
      this._resolve(pos, radius, height, stepHeight);
      pos.y += vel.y * h;
      const g = this.world.heightAt(pos.x, pos.z);
      if (pos.y <= g) { pos.y = g; vel.y = 0; pos.grounded = true; }
      else pos.grounded = false;
    }
    const half = 166;
    pos.x = clamp(pos.x, -half, half);
    pos.z = clamp(pos.z, -half, half);
    return pos;
  }

  _resolve(pos, radius, height, stepHeight) {
    for (const b of this.world.colliders) {
      if (b.broken) continue;
      if (pos.y + height < b.minY || pos.y > b.maxY) continue;
      // low obstacles can be stepped over
      if (b.maxY - pos.y < stepHeight && b.maxY - pos.y > 0) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (radius - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      } else {
        const toL = pos.x - b.minX, toR = b.maxX - pos.x;
        const toB = pos.z - b.minZ, toT = b.maxZ - pos.z;
        const m = Math.min(toL, toR, toB, toT);
        if (m === toL) pos.x = b.minX - radius;
        else if (m === toR) pos.x = b.maxX + radius;
        else if (m === toB) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
  }

  /** First blocking hit against world surfaces + optional extra targets. */
  raycast(origin, dir, maxDist = 400, extra = [], skip = null) {
    _ray.set(origin, dir);
    _ray.near = .1; _ray.far = maxDist;
    const list = extra.length ? extra.concat(this.world.raycastMeshes) : this.world.raycastMeshes;
    const hits = _ray.intersectObjects(list, false);
    for (const h of hits) {
      if (skip && (h.object === skip || h.object.userData?.ignoreRay)) continue;
      if (h.distance < .35) continue;
      return h;
    }
    return null;
  }

  /** Does the segment a→b have clear line of sight through static geometry? */
  lineOfSight(a, b, padding = 1.2) {
    const dir = _v.copy(b).sub(a);
    const len = dir.length();
    if (len < .01) return true;
    dir.divideScalar(len);
    const hit = this.raycast(a, dir, len - padding);
    return !hit;
  }

  /** Integrate a ballistic projectile; returns its new position. */
  ballistic(pos, vel, dt, drag = .02, gravityScale = 1) {
    vel.y += this.gravity * gravityScale * dt;
    const d = Math.exp(-drag * dt);
    vel.multiplyScalar(d);
    pos.addScaledVector(vel, dt);
    return pos;
  }

  /** Bounce a projectile off the ground with restitution/friction. */
  bounce(pos, vel, restitution = .36, friction = .62) {
    const g = this.world.heightAt(pos.x, pos.z);
    if (pos.y <= g + .08) {
      pos.y = g + .08;
      vel.y = Math.abs(vel.y) * restitution;
      vel.x *= friction; vel.z *= friction;
      return true;
    }
    return false;
  }

  overlapSphere(center, radius, list, getPos = o => o.pos) {
    const out = [];
    const r2 = radius * radius;
    for (const o of list) {
      const p = getPos(o);
      if (!p) continue;
      const dx = p.x - center.x, dy = (p.y || 0) - center.y, dz = p.z - center.z;
      if (dx * dx + dy * dy + dz * dz < r2) out.push(o);
    }
    return out;
  }
}

export const damageFalloff = (distance, range, minMul = .45, maxMul = 1) =>
  maxMul + (minMul - maxMul) * clamp(distance / Math.max(1, range), 0, 1);

export const splashDamage = (distance, radius, base) =>
  base * Math.pow(clamp(1 - distance / Math.max(.001, radius), 0, 1), 1.35);
