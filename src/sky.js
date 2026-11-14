import * as THREE from 'three';
import { mulberry32, TAU, clamp, lerp, smoothstep } from './utils.js';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.235, -0.75).normalize();
export const FOG_COLOR = new THREE.Color('#9a8a76');

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSun, uMoon, uFog, uHorizon, uLow, uZenith, uSunTint;
  uniform float uTime, uCloud, uNight, uSunPower;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int i=0;i<6;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(uHorizon, uLow, smoothstep(0.0, 0.16, h));
    col = mix(col, uZenith, smoothstep(0.10, 0.78, h));

    float sd = max(dot(d, uSun), 0.0);
    col += uSunTint * pow(sd, 7.0) * 0.62 * uSunPower;
    col += uSunTint * pow(sd, 90.0) * 1.45 * uSunPower;
    float disc = smoothstep(0.99925, 0.99965, sd);
    col += vec3(1.0, 0.90, 0.72) * disc * 2.6 * uSunPower;

    // moon at night
    float md = max(dot(d, uMoon), 0.0);
    col += vec3(0.62,0.72,0.95) * smoothstep(0.9992,0.9997,md) * uNight * 1.4;
    col += vec3(0.35,0.45,0.75) * pow(md, 180.0) * uNight * 0.5;

    // two independently drifting cloud decks
    vec2 cp = d.xz / (max(d.y, 0.055) + 0.28) * 0.55;
    cp += vec2(uTime * 0.0035, uTime * 0.0016);
    float base = fbm(cp * 1.6);
    float detail = fbm(cp * 4.2 + base * 1.2);
    float high = fbm(cp * 0.7 + 11.0);
    float cover = smoothstep(0.46, 0.75, base * 0.66 + detail * 0.38 + high * 0.12) * uCloud;
    cover *= smoothstep(-0.02, 0.16, d.y) * (1.0 - smoothstep(0.72, 0.98, d.y));
    vec3 cloudDark = mix(vec3(0.20,0.205,0.225), vec3(0.055,0.065,0.10), uNight);
    vec3 cloudLit = mix(vec3(0.98,0.72,0.47), vec3(0.72,0.76,0.88), uNight);
    float lit = pow(sd, 3.0) * 0.85 + 0.18;
    vec3 cloudCol = mix(cloudDark, cloudLit, clamp(lit,0.0,1.0));
    cloudCol += uSunTint * pow(sd, 24.0) * cover * 0.9;
    col = mix(col, cloudCol, cover * 0.90);

    // aerial perspective toward the horizon
    col = mix(col, uFog, smoothstep(0.16, -0.08, d.y) * 0.88);
    float star = step(0.9986, hash(floor(d.xz * 900.0 + d.y * 300.0)));
    col += vec3(0.55,0.65,0.85) * star * smoothstep(0.35,0.9,d.y) * (1.0-cover) * uNight;
    col = pow(max(col, vec3(0.0)), vec3(0.94));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const PALETTES = {
  night: { h: [.05, .07, .13], l: [.04, .06, .12], z: [.008, .013, .035], fog: [.10, .12, .17], sun: [.35, .48, .78] },
  dawn: { h: [.78, .40, .24], l: [.43, .36, .38], z: [.09, .13, .22], fog: [.55, .42, .34], sun: [1.0, .52, .24] },
  day: { h: [.55, .64, .74], l: [.38, .50, .66], z: [.10, .24, .48], fog: [.62, .66, .70], sun: [1.0, .95, .86] },
  dusk: { h: [.76, .46, .28], l: [.46, .41, .40], z: [.075, .125, .205], fog: [.60, .54, .46], sun: [1.0, .60, .30] },
};
const mixArr = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export function createSky(scene, quality = 2) {
  const uniforms = {
    uSun: { value: SUN_DIR.clone() },
    uMoon: { value: SUN_DIR.clone().negate() },
    uFog: { value: FOG_COLOR.clone().convertSRGBToLinear() },
    uHorizon: { value: new THREE.Vector3(...PALETTES.dusk.h) },
    uLow: { value: new THREE.Vector3(...PALETTES.dusk.l) },
    uZenith: { value: new THREE.Vector3(...PALETTES.dusk.z) },
    uSunTint: { value: new THREE.Vector3(...PALETTES.dusk.sun) },
    uTime: { value: 0 },
    uCloud: { value: .78 },
    uNight: { value: 0 },
    uSunPower: { value: 1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    })
  );
  sky.name = 'SKY_DOME';
  sky.renderOrder = -1000;
  scene.add(sky);

  const fog = new THREE.FogExp2(FOG_COLOR.clone(), .0032);
  scene.fog = fog;

  const hemi = new THREE.HemisphereLight(0x9fb8d0, 0x40382c, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc184, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(150);
  sun.castShadow = true;
  const shadowSize = quality >= 3 ? 4096 : quality >= 2 ? 3072 : 1536;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -72; sun.shadow.camera.right = 72;
  sun.shadow.camera.top = 72; sun.shadow.camera.bottom = -72;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.00028;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = quality >= 2 ? 2.0 : 1;
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x6e90b8, 0.55);
  fill.position.set(60, 70, 90); scene.add(fill);
  const bounce = new THREE.AmbientLight(0x353a3a, 0.32); scene.add(bounce);

  // distant ridge silhouettes
  const r = mulberry32(8123);
  const ridges = new THREE.Group();
  for (let ring = 0; ring < 2; ring++) {
    const radius = 360 + ring * 130, segs = 96, pos = [], heights = [];
    for (let i = 0; i < segs; i++) {
      const a = i / segs * TAU;
      heights.push(12 + Math.sin(a * 7 + ring) * 8 + Math.sin(a * 17 + ring * 3) * 6 + r() * 11 + ring * 10);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * TAU, a1 = (i + 1) / segs * TAU;
      const h0 = heights[i], h1 = heights[(i + 1) % segs];
      pos.push(
        Math.cos(a0) * radius, -6, Math.sin(a0) * radius,
        Math.cos(a1) * radius, -6, Math.sin(a1) * radius,
        Math.cos(a0) * radius, h0, Math.sin(a0) * radius,
        Math.cos(a1) * radius, -6, Math.sin(a1) * radius,
        Math.cos(a1) * radius, h1, Math.sin(a1) * radius,
        Math.cos(a0) * radius, h0, Math.sin(a0) * radius
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: ring === 0 ? 0x4a4a4a : 0x5c5f66, fog: true, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    ridges.add(mesh);
  }
  scene.add(ridges);

  const api = {
    sky, sun, hemi, fill, bounce, uniforms, fog, fogColor: FOG_COLOR.clone(),
    timeOfDay: 17.4, exposure: 1.12,
    update(t) { uniforms.uTime.value = t; },
    setQuality(q) { sun.castShadow = q >= 1; },

    /** Hour-of-day in [0,24): drives sun vector, palette, fog, exposure. */
    setTime(hour) {
      api.timeOfDay = hour;
      const phase = (hour - 6) / 12 * Math.PI;           // sunrise→sunset
      const elev = Math.sin(phase);
      const az = phase;
      const dir = new THREE.Vector3(
        Math.cos(az) * .78,
        Math.max(-.28, elev) * .92,
        -.35 - Math.sin(az * .6) * .35
      ).normalize();
      SUN_DIR.copy(dir);
      uniforms.uSun.value.copy(dir);
      uniforms.uMoon.value.copy(dir).negate();
      const e = clamp(elev, -.3, 1);
      const night = 1 - smoothstep(-.06, .16, e);
      let pal;
      if (night > .5) pal = PALETTES.night;
      else if (e < .28) pal = hour < 12 ? PALETTES.dawn : PALETTES.dusk;
      else pal = PALETTES.day;
      const blend = smoothstep(.18, .72, e);
      const from = hour < 12 ? PALETTES.dawn : PALETTES.dusk;
      uniforms.uHorizon.value.set(...mixArr(from.h, pal.h, blend));
      uniforms.uLow.value.set(...mixArr(from.l, pal.l, blend));
      uniforms.uZenith.value.set(...mixArr(from.z, pal.z, blend));
      uniforms.uSunTint.value.set(...mixArr(from.sun, pal.sun, blend));
      uniforms.uNight.value = night;
      uniforms.uSunPower.value = clamp(.15 + e * 1.05, .1, 1.25);
      uniforms.uCloud.value = .55 + .25 * (1 - night);
      sun.color.setRGB(...(hour < 12 && e < .3 ? [1, .55, .28] : [1, .76 + e * .2, .55 + e * .35]));
      sun.intensity = clamp(.25 + e * 3.1, .2, 3.4);
      hemi.intensity = clamp(.32 + e * 1.05, .3, 1.35);
      fill.intensity = clamp(.2 + e * .45, .18, .7);
      bounce.intensity = .18 + e * .2;
      api.exposure = lerp(.86, 1.16, clamp(.3 + e * .7, 0, 1));
      const fc = mixArr(from.fog, pal.fog, blend);
      api.fogColor.setRGB(fc[0], fc[1], fc[2]);
      fog.color.copy(api.fogColor);
      uniforms.uFog.value.copy(api.fogColor.clone().convertSRGBToLinear());
      return api;
    },

    /** Tight, high-resolution shadow volume that follows the player. */
    setShadowFocus(focus, radius = 72) {
      sun.position.copy(focus).addScaledVector(SUN_DIR, 150);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      const c = sun.shadow.camera;
      if (c.left !== -radius) {
        c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
        c.updateProjectionMatrix();
      }
    },
  };
  api.setTime(17.4);
  return api;
}
