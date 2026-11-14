import * as THREE from 'three';
import { rand, mulberry32, TAU, clamp, damp } from '../utils.js';

/**
 * Dynamic weather: dust storm / clear dusk / rain / thunderstorm.
 * GPU-friendly LineSegments streaks that follow the camera, wind that drives
 * grass, smoke and projectiles, fog colour/exposure shifts and lightning.
 */
export class Weather {
  constructor(scene, world, effects, sky, quality = 2) {
    this.scene = scene; this.world = world; this.effects = effects; this.sky = sky;
    this.mode = 'dust';
    this.wind = 3.4;
    this.windDir = new THREE.Vector2(.82, .57).normalize();
    this.time = 0;
    this.lightningT = 8;
    this.flash = 0;
    this.quality = quality;
    this.r = mulberry32(9917);
    this.baseFog = sky.fogColor.clone();
    this.fogDensity = .0032;
    this.exposure = 1.12;

    const N = quality >= 2 ? 1500 : quality >= 1 ? 800 : 350;
    this.N = N;
    this.pos = new Float32Array(N * 6);
    this.col = new Float32Array(N * 6);
    this.seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.seed[i * 3] = rand(this.r, -70, 70);
      this.seed[i * 3 + 1] = rand(this.r, 0, 40);
      this.seed[i * 3 + 2] = rand(this.r, -70, 70);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: .42,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this._p = new THREE.Vector3();
    this.timeOfDay = 17.4;
    this.setMode('dust');
  }

  setMode(mode) {
    this.mode = mode;
    const presets = {
      clear: { wind: 1.6, density: .0021, fog: '#9a8a76', exposure: 1.18, opacity: 0 },
      dust: { wind: 4.6, density: .0038, fog: '#a68a68', exposure: 1.08, opacity: .5 },
      rain: { wind: 6.2, density: .0046, fog: '#6c727a', exposure: .94, opacity: .72 },
      storm: { wind: 9.4, density: .0062, fog: '#4e5762', exposure: .82, opacity: .85 },
    };
    const p = presets[mode] || presets.dust;
    this.wind = p.wind; this.windTarget = p.wind;
    this.fogDensity = p.density;
    this.baseFog.set(p.fog);
    this.exposure = p.exposure;
    this.mesh.material.opacity = p.opacity;
    this.mesh.visible = p.opacity > 0;
    return p;
  }

  update(dt, t, cameraPos) {
    this.time = t;
    this.wind = damp(this.wind, this.windTarget ?? this.wind, .5, dt);
    const gust = 1 + Math.sin(t * .31) * .22 + Math.sin(t * .93) * .08;
    this.gust = this.wind * gust;
    const wx = this.windDir.x * this.gust, wz = this.windDir.y * this.gust;

    if (this.mesh.visible) {
      const rain = this.mode === 'rain' || this.mode === 'storm';
      const p = this.pos, c = this.col, s = this.seed;
      const fall = rain ? 26 : 0;
      const len = rain ? .85 : .55;
      for (let i = 0; i < this.N; i++) {
        const k = i * 6;
        let x = s[i * 3] + wx * t * .35;
        let y = s[i * 3 + 1] - (rain ? (t * fall * .5) % 40 : Math.sin(t * .7 + i) * 1.2);
        let z = s[i * 3 + 2] + wz * t * .35;
        // wrap around the camera in a 140 m box
        x = ((x - cameraPos.x + 70) % 140 + 140) % 140 - 70 + cameraPos.x;
        z = ((z - cameraPos.z + 70) % 140 + 140) % 140 - 70 + cameraPos.z;
        y = ((y + 40) % 40 + 40) % 40 + cameraPos.y - 14;
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
        p[k + 3] = x + (rain ? wx * .018 : wx * len * .035);
        p[k + 4] = y - len;
        p[k + 5] = z + (rain ? wz * .018 : wz * len * .035);
        const a = rain ? .34 : .26;
        const cr = rain ? .62 : 1.0, cg = rain ? .72 : .82, cb = rain ? .88 : .56;
        c[k] = cr * a; c[k + 1] = cg * a; c[k + 2] = cb * a;
        c[k + 3] = cr * .02; c[k + 4] = cg * .02; c[k + 5] = cb * .02;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }

    // lightning
    this.flash = Math.max(0, this.flash - dt * 3.4);
    if (this.mode === 'storm') {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = 7 + Math.random() * 12;
        this.flash = .55 + Math.random() * .4;
        this.effects?._light?.(cameraPos.clone().add(new THREE.Vector3(40, 60, -20)), 160, 0xbfd4ff, .22, 300);
      }
    }
    if (this.sky) {
      const fog = this.baseFog.clone();
      if (this.flash > 0) fog.lerp(new THREE.Color(0xc9d8ff), this.flash * .45);
      this.sky.fog.color.copy(fog);
      this.sky.fog.density = damp(this.sky.fog.density, this.fogDensity, 1.2, dt);
      if (this.sky.uniforms?.uFog) this.sky.uniforms.uFog.value.copy(fog.clone().convertSRGBToLinear());
    }
  }
}
