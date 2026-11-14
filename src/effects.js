import * as THREE from 'three';
import { softSprite, bulletHole } from './textures.js';
import { clamp, rand, mulberry32, TAU } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);

class ParticleLayer {
  constructor(scene, max, blending, softness) {
    this.max = max; this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.sizeVel = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.spin = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSoft: { value: softness } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA;
        void main(){
          vC=aColor; vA=aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * (330.0 / max(-mv.z,1.0)), 1.0, 420.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA; uniform float uSoft;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          float a = mix(smoothstep(0.5,0.02,d), pow(max(0.0,1.0-d*2.0),1.6), uSoft);
          a *= vA;
          if(a < 0.004) discard;
          gl_FragColor = vec4(vC, a);
        }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = g;
  }

  spawn(p, v, o) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const k = i * 3;
    this.pos[k] = p.x; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
    this.vel[k] = v.x; this.vel[k + 1] = v.y; this.vel[k + 2] = v.z;
    const c = o.color || [1, 1, 1];
    this.col[k] = c[0]; this.col[k + 1] = c[1]; this.col[k + 2] = c[2];
    this.size[i] = o.size ?? 1;
    this.sizeVel[i] = o.grow ?? 0;
    this.alpha0[i] = o.alpha ?? 1;
    this.alpha[i] = this.alpha0[i];
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.drag[i] = o.drag ?? 0.4;
    this.grav[i] = o.grav ?? 0;
    this.spin[i] = o.spin ?? 0;
  }

  update(dt, t) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      V[k] *= d; V[k + 2] *= d;
      V[k + 1] = V[k + 1] * d + this.grav[i] * dt;
      if (this.spin[i]) {
        const s = Math.sin(t * 3 + i) * this.spin[i] * dt;
        V[k] += s; V[k + 2] += Math.cos(t * 2.3 + i) * this.spin[i] * dt;
      }
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      this.size[i] = Math.max(.001, this.size[i] + this.sizeVel[i] * dt);
      const u = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.alpha0[i] * Math.min(1, u * 3.2) * Math.min(1, (1 - u) * 8 + .06);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, quality = 2) {
    this.scene = scene;
    this.quality = quality;
    this.r = mulberry32(555321);
    this.sparks = new ParticleLayer(scene, quality >= 2 ? 3000 : 1200, THREE.AdditiveBlending, 1);
    this.smoke = new ParticleLayer(scene, quality >= 2 ? 1600 : 700, THREE.NormalBlending, 0);
    this.shake = 0;
    this.time = 0;
    this.emitters = [];
    this.fires = [];
    this.flashSprites = [];
    this.rings = [];
    this.decals = [];
    this.lights = [];
    this.onExplosion = null;

    // flash sprite pool
    const flashTex = softSprite(128, 'flash');
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 0, color: 0xffe3ad,
      }));
      s.visible = false;
      scene.add(s);
      this.flashSprites.push({ sprite: s, life: 0, max: 1, size: 1 });
    }
    // shockwave ring pool
    const ringGeo = new THREE.RingGeometry(.82, 1, 40);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffb060, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false; m.rotation.x = -Math.PI / 2;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, power: 4 });
    }
    // decal pool
    const hole = bulletHole();
    const decGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(decGeo, new THREE.MeshBasicMaterial({
        map: hole, transparent: true, depthWrite: false, opacity: .8,
        polygonOffset: true, polygonOffsetFactor: -3, color: 0x2a231c,
      }));
      m.visible = false; scene.add(m);
      this.decals.push(m);
    }
    this.decalCursor = 0;
    // dynamic light pool
    for (let i = 0; i < 7; i++) {
      const l = new THREE.PointLight(0xffa050, 0, 30, 2);
      l.visible = false; scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, power: 0 });
    }
    this.lightCursor = 0;

    // tracers
    this.maxTracers = 90;
    this.tracers = Array.from({ length: this.maxTracers }, () => ({ life: 0 }));
    const tg = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(this.maxTracers * 6);
    this.tracerCol = new Float32Array(this.maxTracers * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracerMesh = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: .95,
    }));
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 5;
    scene.add(this.tracerMesh);
    this.tracerGeo = tg;

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  // -------------------------------------------------------------- emitters
  smokeEmitter(pos, rate = 1, color = 0x35322f) {
    const c = new THREE.Color(color);
    this.emitters.push({ pos: pos.clone(), rate, acc: 0, color: [c.r, c.g, c.b] });
  }

  addFire(x, y, z, scale = 1) {
    const pos = new THREE.Vector3(x, y, z);
    const light = new THREE.PointLight(0xff7a24, 0, 14 * scale, 2);
    light.position.copy(pos); this.scene.add(light);
    this.fires.push({ pos, scale, light, phase: this.r() * TAU });
  }

  // -------------------------------------------------------------- primitives
  _flash(pos, size = 2, color = 0xffe3ad, life = .09) {
    const f = this.flashSprites.find(f => f.life <= 0) || this.flashSprites[0];
    f.life = f.max = life; f.size = size;
    f.sprite.position.copy(pos);
    f.sprite.material.color.setHex(color);
    f.sprite.visible = true;
    f.sprite.scale.setScalar(size);
  }

  _light(pos, power = 20, color = 0xffa050, life = .12, range = 30) {
    const l = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    l.light.position.copy(pos);
    l.light.color.setHex(color);
    l.light.distance = range;
    l.power = power; l.life = l.max = life;
    l.light.intensity = power; l.light.visible = true;
  }

  _ring(pos, power = 4, color = 0xffb060) {
    const r = this.rings.find(x => x.life <= 0) || this.rings[0];
    r.life = r.max = .55; r.power = power;
    r.mesh.position.copy(pos); r.mesh.position.y += .12;
    r.mesh.material.color.setHex(color);
    r.mesh.visible = true;
    r.mesh.scale.setScalar(.3);
  }

  muzzleFlash(pos, dir, scale = 1) {
    this._flash(pos, .85 * scale, 0xffd08a, .055);
    this._light(pos, 13 * scale, 0xffb45c, .06, 18);
    const r = this.r;
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Vector3(
        dir.x * rand(r, 4, 16) + rand(r, -3, 3),
        dir.y * rand(r, 4, 16) + rand(r, -2, 4),
        dir.z * rand(r, 4, 16) + rand(r, -3, 3)
      );
      this.sparks.spawn(pos, v, {
        color: [1, .68 + r() * .3, .25], size: .10 + r() * .16,
        life: .10 + r() * .18, drag: 4, grav: -4, alpha: .9,
      });
    }
    this.smoke.spawn(this._tmp.copy(pos).addScaledVector(dir, .4), new THREE.Vector3(0, .8, 0), {
      color: [.32, .31, .29], size: .5, grow: 1.2, life: .65, alpha: .34, drag: 1.6,
    });
  }

  tracer(from, to, color = 0xffd08a, speed = 210) {
    const t = this.tracers.find(x => x.life <= 0);
    if (!t) return;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    t.from = from.clone(); t.dir = dir; t.len = len;
    t.head = 0; t.speed = speed; t.life = Math.max(.06, len / speed);
    t.max = t.life;
    const c = new THREE.Color(color);
    t.color = [c.r, c.g, c.b];
  }

  impact(point, normal, type = 'dirt') {
    const r = this.r;
    const n = normal || UP;
    const base = type === 'metal' ? [1, .78, .38] : type === 'flesh' ? [.75, .09, .07] : [.62, .55, .42];
    for (let i = 0; i < (type === 'metal' ? 14 : 9); i++) {
      const v = new THREE.Vector3(
        n.x * rand(r, 1, 6) + rand(r, -3, 3),
        n.y * rand(r, 1, 6) + rand(r, 0, 4),
        n.z * rand(r, 1, 6) + rand(r, -3, 3)
      );
      this.sparks.spawn(point, v, {
        color: i % 3 === 0 ? [1, .9, .65] : base,
        size: .07 + r() * .13, life: .18 + r() * .4, drag: 2.4, grav: -9,
        alpha: .95,
      });
    }
    this.smoke.spawn(point, new THREE.Vector3(n.x, .7, n.z), {
      color: type === 'flesh' ? [.36, .12, .1] : [.46, .42, .35],
      size: .35, grow: 1.5, life: .8, alpha: .4, drag: 2,
    });
    if (type === 'flesh') {
      for (let i = 0; i < 8; i++) {
        this.sparks.spawn(point, new THREE.Vector3(rand(r, -3, 3), rand(r, 1, 5), rand(r, -3, 3)), {
          color: [.6, .05, .04], size: .12, life: .5, drag: 1.5, grav: -12, alpha: .8,
        });
      }
    }
    this._decal(point, n);
    this._flash(point, .3, type === 'metal' ? 0xffdf90 : 0xffa060, .045);
  }

  _decal(point, normal) {
    const m = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    m.position.copy(point).addScaledVector(normal, .025);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.rotateZ(this.r() * TAU);
    const s = .18 + this.r() * .32;
    m.scale.set(s, s, s);
    m.visible = true;
    m.material.opacity = .85;
  }

  shellCasing(pos, dir) {
    const r = this.r;
    const v = new THREE.Vector3(-dir.z * 3 + rand(r, -1, 1), rand(r, 3, 6), dir.x * 3 + rand(r, -1, 1));
    this.sparks.spawn(pos, v, { color: [1, .72, .26], size: .10, life: .8, drag: .7, grav: -14, alpha: 1 });
  }

  explosion(pos, power = 1, opts = {}) {
    const r = this.r;
    this._flash(pos, 3.2 * power, 0xffe0a0, .14);
    this._light(pos, 85 * power, 0xffa24a, .38, 42 * power);
    this._ring(pos, 7 * power, 0xffc070);
    this.shake = Math.min(1.6, this.shake + .42 * power);
    // fireball
    for (let i = 0; i < 46 * power; i++) {
      const a = r() * TAU, e = rand(r, -.35, 1.1);
      const sp = rand(r, 2, 15) * power;
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp);
      this.sparks.spawn(pos, v, {
        color: i % 3 === 0 ? [1, .92, .55] : [1, .42 + r() * .35, .09],
        size: .35 + r() * .9 * power, life: .3 + r() * .65, drag: 2.2, grav: -3,
        alpha: .95, grow: -.35,
      });
    }
    // rolling smoke
    for (let i = 0; i < 26 * power; i++) {
      const a = r() * TAU, sp = rand(r, 1, 8) * power;
      const v = new THREE.Vector3(Math.cos(a) * sp, rand(r, 1, 7) * power, Math.sin(a) * sp);
      this.smoke.spawn(pos, v, {
        color: [.19 + r() * .12, .18 + r() * .1, .17 + r() * .09],
        size: 1.4 + r() * 2.2 * power, grow: 2.4 * power,
        life: 1.7 + r() * 2.6, alpha: .62, drag: 1.1, spin: .7,
      });
    }
    // debris chunks
    for (let i = 0; i < 20 * power; i++) {
      const a = r() * TAU, sp = rand(r, 4, 20) * power;
      this.sparks.spawn(pos, new THREE.Vector3(Math.cos(a) * sp, rand(r, 4, 16) * power, Math.sin(a) * sp), {
        color: [.36, .32, .26], size: .13 + r() * .3, life: .9 + r() * 1.2,
        drag: .5, grav: -18, alpha: .95,
      });
    }
    this.onExplosion?.(pos.clone(), power);
  }

  /** Airstrike: a string of detonations along a line. */
  airstrike(pos, dir, count = 6, onBlast = null) {
    const start = pos.clone().addScaledVector(dir, -18);
    for (let i = 0; i < count; i++) {
      const p = start.clone().addScaledVector(dir, i * 7.2);
      setTimeout(() => {
        this.explosion(p, 1.35, {});
        onBlast?.(p.clone(), 1.35);
      }, i * 145);
    }
  }

  grenadeBlast(pos) { this.explosion(pos, 1.0); }

  // -------------------------------------------------------------- update
  update(dt, t) {
    this.time = t;
    this.shake *= Math.exp(-6 * dt);
    this.sparks.update(dt, t);
    this.smoke.update(dt, t);

    // continuous smoke columns
    for (const e of this.emitters) {
      e.acc += dt * e.rate * 9;
      while (e.acc >= 1) {
        e.acc -= 1;
        const r = this.r;
        const p = this._tmp.set(e.pos.x + rand(r, -.5, .5), e.pos.y, e.pos.z + rand(r, -.5, .5));
        this.smoke.spawn(p, new THREE.Vector3(rand(r, -.7, .7), rand(r, 1.3, 3.0), rand(r, -.7, .7)), {
          color: e.color, size: 1.1 + r() * 1.4, grow: 2.1 + r() * 2,
          life: 3.5 + r() * 3.5, alpha: .30 + r() * .18, drag: .55, spin: .5,
        });
      }
    }
    // fires
    for (const f of this.fires) {
      f.light.intensity = (7 + Math.sin(t * 13 + f.phase) * 3 + Math.sin(t * 27 + f.phase) * 2) * f.scale;
      if (this.r() < dt * 26 * f.scale) {
        const p = this._tmp.set(f.pos.x + rand(this.r, -.4, .4), f.pos.y, f.pos.z + rand(this.r, -.4, .4));
        this.sparks.spawn(p, new THREE.Vector3(rand(this.r, -.5, .5), rand(this.r, 1.5, 4) * f.scale, rand(this.r, -.5, .5)), {
          color: [1, .45 + this.r() * .3, .08], size: .25 + this.r() * .5 * f.scale,
          life: .35 + this.r() * .5, drag: 2.5, grav: 2, alpha: .9, grow: -.4,
        });
        this.smoke.spawn(p, new THREE.Vector3(0, 2.4, 0), {
          color: [.26, .25, .24], size: .6, grow: 2.6, life: 2.4, alpha: .22, drag: .8,
        });
      }
    }
    // flashes
    for (const f of this.flashSprites) {
      if (f.life <= 0) { if (f.sprite.visible) f.sprite.visible = false; continue; }
      f.life -= dt;
      const u = clamp(f.life / f.max, 0, 1);
      f.sprite.material.opacity = u * u;
      f.sprite.scale.setScalar(f.size * (1 + (1 - u) * .7));
      if (f.life <= 0) f.sprite.visible = false;
    }
    // shockwaves
    for (const r of this.rings) {
      if (r.life <= 0) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.life -= dt;
      const u = clamp(r.life / r.max, 0, 1);
      const s = .4 + (1 - u) * r.power;
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = u * u * .85;
      if (r.life <= 0) r.mesh.visible = false;
    }
    // dynamic lights
    for (const l of this.lights) {
      if (l.life <= 0) { if (l.light.visible) l.light.visible = false; continue; }
      l.life -= dt;
      l.light.intensity = l.power * clamp(l.life / l.max, 0, 1) ** 2;
      if (l.life <= 0) l.light.visible = false;
    }
    // tracers
    const tp = this.tracerPos, tc = this.tracerCol;
    for (let i = 0; i < this.maxTracers; i++) {
      const tr = this.tracers[i];
      const k = i * 6;
      if (tr.life <= 0) {
        tp[k] = tp[k + 3] = 0; tp[k + 1] = tp[k + 4] = -1000; tp[k + 2] = tp[k + 5] = 0;
        for (let j = 0; j < 6; j++) tc[k + j] = 0;
        continue;
      }
      tr.life -= dt;
      tr.head = Math.min(tr.len, tr.head + tr.speed * dt);
      const tail = Math.max(0, tr.head - 5.5);
      const a = this._tmp.copy(tr.from).addScaledVector(tr.dir, tail);
      const b = this._tmp2.copy(tr.from).addScaledVector(tr.dir, tr.head);
      tp[k] = a.x; tp[k + 1] = a.y; tp[k + 2] = a.z;
      tp[k + 3] = b.x; tp[k + 4] = b.y; tp[k + 5] = b.z;
      const f = clamp(tr.life / tr.max, 0, 1) * 1.6;
      for (let j = 0; j < 2; j++) {
        const o = k + j * 3;
        tc[o] = tr.color[0] * f;
        tc[o + 1] = tr.color[1] * f;
        tc[o + 2] = tr.color[2] * f;
      }
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
  }
}
