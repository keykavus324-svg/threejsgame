import * as THREE from 'three';
import { groundTextures, grassSprite, bulletHole, detailTextures } from './textures.js';
import { fbm, ridged, smoothstep, clamp, mulberry32, rand, randInt, TAU, lerp } from './utils.js';
import { AssetKit } from './assets.js';
import { FOG_COLOR } from './sky.js';

export const MAP_SIZE = 340;
const SEG = 190;

export const CAPTURE_DEFS = [
  { id: 'A', name: 'KIRIK KULE', x: -64, z: -46, radius: 13 },
  { id: 'B', name: 'HANGAR 7', x: 2, z: 6, radius: 14 },
  { id: 'C', name: 'GEÇİT', x: 68, z: 54, radius: 13 },
];

const CRATERS = [];
{
  const r = mulberry32(90210);
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU, d = 12 + r() * 105;
    CRATERS.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 3.5 + r() * 6.5, depth: .55 + r() * 1.5 });
  }
}

/** Deterministic terrain height; also used for grounding every actor. */
export function heightAt(x, z) {
  const dist = Math.hypot(x, z);
  let h = (fbm(x * .011 + 12, z * .011 + 8, 5, 3) - .5) * 11;
  h += (ridged(x * .0055 + 3, z * .0055 + 7, 4, 9) - .5) * 5.2;
  const flat = smoothstep(28, 108, dist);
  h *= .28 + .72 * flat;
  h += smoothstep(108, 178, dist) * 21;          // valley walls
  h += Math.sin(x * .026) * Math.cos(z * .021) * .6;

  // crushed road corridors
  const road1 = Math.abs(z - (-.16 * x + 12 + Math.sin(x * .034) * 9));
  const road2 = Math.abs(x - (-.1 * z - 38 + Math.sin(z * .04) * 7));
  const road = Math.min(road1, road2);
  const roadBlend = 1 - smoothstep(3.5, 11, road);
  h = lerp(h, h * .22 + .05, roadBlend * .85);

  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r * 1.35) {
      const t = d / c.r;
      const bowl = -c.depth * Math.pow(Math.max(0, 1 - t * t), 2);
      const rim = c.depth * .28 * Math.exp(-Math.pow((t - 1.0) * 5.2, 2));
      h += bowl + rim;
    }
  }
  return h;
}

function roadFactor(x, z) {
  const road1 = Math.abs(z - (-.16 * x + 12 + Math.sin(x * .034) * 9));
  const road2 = Math.abs(x - (-.1 * z - 38 + Math.sin(z * .04) * 7));
  return 1 - smoothstep(3.5, 12, Math.min(road1, road2));
}

export class World {
  constructor(scene, assets, effects, quality = 2) {
    this.scene = scene;
    this.assets = assets;
    this.effects = effects;
    this.quality = quality;
    this.colliders = [];
    this.raycastMeshes = [];
    this.capturePoints = [];
    this.mcomStations = [];
    this.propHits = [];
    this.destructibles = [];
    this.spawnPoints = [];
    this.allySpawnPoints = [];
    this.dynamicLights = [];
    this.flags = [];
    this.time = 0;
    this.group = new THREE.Group();
    this.group.name = 'WORLD';
    scene.add(this.group);

    this._buildTerrain();
    this._buildScatter();
    this._buildProps();
    this._buildCapturePoints();
    this._buildAtmosphere();
  }

  // ---------------------------------------------------------------- terrain
  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const macro = fbm(x * .017 + 3, z * .017 + 5, 4, 21);
      const road = roadFactor(x, z);
      let scorch = 0;
      for (const cr of CRATERS) {
        const d = Math.hypot(x - cr.x, z - cr.z);
        if (d < cr.r * 1.3) scorch = Math.max(scorch, 1 - d / (cr.r * 1.3));
      }
      const bright = .68 + macro * .55 - scorch * .35;
      c.setRGB(
        (0.98 + road * .08) * bright,
        (0.96 - macro * .06 + road * .02) * bright,
        (0.88 - macro * .10 - road * .05) * bright
      );
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const t = groundTextures(this.quality >= 2 ? 768 : 512);
    this.groundMat = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      normalScale: new THREE.Vector2(.85, .85),
      vertexColors: true, roughness: 1, metalness: 0,
      envMapIntensity: .35, dithering: true,
    });
    this._installSplatShader();
    const terrain = new THREE.Mesh(geo, this.groundMat);
    terrain.name = 'TERRAIN';
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.terrain = terrain;
    this.raycastMeshes.push(terrain);

    // scorched blast patches lying on the ground
    const decalMat = new THREE.MeshBasicMaterial({
      map: bulletHole(), transparent: true, depthWrite: false, opacity: .55,
      polygonOffset: true, polygonOffsetFactor: -2, color: 0x2a221b,
    });
    const decGeo = new THREE.PlaneGeometry(1, 1);
    decGeo.rotateX(-Math.PI / 2);
    const N = this.quality >= 2 ? 140 : 60;
    const decals = new THREE.InstancedMesh(decGeo, decalMat, N);
    const r = mulberry32(771);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const cr = CRATERS[i % CRATERS.length];
      const a = r() * TAU, d = r() * cr.r * 1.5;
      const x = cr.x + Math.cos(a) * d, z = cr.z + Math.sin(a) * d;
      p.set(x, heightAt(x, z) + .02, z);
      q.setFromEuler(new THREE.Euler(0, r() * TAU, 0));
      const sc = 1 + r() * 4.5; s.set(sc, 1, sc);
      m.compose(p, q, s); decals.setMatrixAt(i, m);
    }
    decals.instanceMatrix.needsUpdate = true;
    decals.frustumCulled = false;
    this.group.add(decals);
  }

  /** CPU-baked 4-channel biome weights (grass / sand / rock / scorch). */
  _buildSplat(S = 512) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) {
      const z = (j / (S - 1) - .5) * MAP_SIZE;
      for (let i = 0; i < S; i++) {
        const x = (i / (S - 1) - .5) * MAP_SIZE;
        const h = heightAt(x, z);
        const slope = Math.hypot(heightAt(x + 2, z) - h, heightAt(x, z + 2) - h) / 2;
        const macro = fbm(x * .018 + 40, z * .018 + 40, 4, 77);
        const road = roadFactor(x, z);
        let grass = clamp((macro - .42) * 3.2, 0, 1) * (1 - road * .9) * clamp(1 - slope * 1.5, 0, 1);
        let sand = clamp((.52 - macro) * 2.6, 0, 1) * .75 + road * .95;
        let rock = clamp((slope - .16) * 2.6, 0, 1) + clamp((h - 9) / 20, 0, 1) * .65;
        let scorch = 0;
        for (const cr of CRATERS) {
          const d = Math.hypot(x - cr.x, z - cr.z);
          if (d < cr.r * 1.25) scorch = Math.max(scorch, 1 - d / (cr.r * 1.25));
        }
        const sum = Math.max(.001, grass + sand + rock);
        grass /= sum; sand /= sum; rock /= sum;
        const k = (j * S + i) * 4;
        img.data[k] = grass * 255;
        img.data[k + 1] = sand * 255;
        img.data[k + 2] = rock * 255;
        img.data[k + 3] = scorch * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** 4-layer material blend + slope triplanar + parallax-ish detail on the ground. */
  _installSplatShader() {
    const det = detailTextures(this.quality >= 2 ? 256 : 128);
    const splat = this._buildSplat(this.quality >= 2 ? 512 : 256);
    this.groundMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tGrass: { value: det.grass }, tSand: { value: det.sand },
        tRock: { value: det.rock }, tMud: { value: det.mud },
        tSplat: { value: splat }, uMapSize: { value: MAP_SIZE },
      });
      sh.vertexShader = 'varying vec3 vWPosT; varying vec3 vWNorT;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', /* glsl */`
        #include <worldpos_vertex>
        vWPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNorT = normalize(mat3(modelMatrix) * objectNormal);
      `);
      sh.fragmentShader = /* glsl */`
        uniform sampler2D tGrass, tSand, tRock, tMud, tSplat;
        uniform float uMapSize;
        varying vec3 vWPosT; varying vec3 vWNorT;
      ` + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', /* glsl */`
        #include <map_fragment>
        vec2 spUv = clamp(vWPosT.xz / uMapSize + 0.5, vec2(0.001), vec2(0.999));
        vec4 sp = texture2D(tSplat, spUv);
        float slope = 1.0 - clamp(normalize(vWNorT).y, 0.0, 1.0);
        vec2 uA = vWPosT.xz * 0.085;
        vec2 uT = vec2(vWPosT.x + vWPosT.z, vWPosT.y) * 0.085;
        vec2 uRock = mix(uA, uT, smoothstep(0.26, 0.62, slope));
        vec3 cG = texture2D(tGrass, uA).rgb;
        vec3 cS = texture2D(tSand, uA * 0.72).rgb;
        vec3 cR = texture2D(tRock, uRock).rgb;
        vec3 cM = texture2D(tMud, uA * 1.35).rgb;
        float sum = max(0.001, sp.r + sp.g + sp.b);
        vec3 biome = (cG * sp.r + cS * sp.g + cR * sp.b) / sum;
        biome = mix(biome, cM, clamp(sp.a * 0.65, 0.0, 0.65));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.32 + biome * 0.92, 0.80);
        diffuseColor.rgb *= 1.0 - sp.a * 0.42;
      `);
      this.groundMat.userData.shader = sh;
    };
    this.groundMat.customProgramCacheKey = () => 'iron-horizon-splat-v2';
  }

  // ---------------------------------------------------------------- scatter
  _crossedGrassGeometry() {
    const g = new THREE.BufferGeometry();
    const v = [], uv = [], idx = [];
    const quads = [
      [[-.32, 0, 0], [.32, 0, 0], [.32, .9, 0], [-.32, .9, 0]],
      [[0, 0, -.32], [0, 0, .32], [0, .9, .32], [0, .9, -.32]],
    ];
    for (const q of quads) {
      const o = v.length / 3;
      for (const p of q) v.push(...p);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  _buildScatter() {
    const r = mulberry32(20261114);
    const qGrass = this.quality >= 3 ? 22000 : this.quality >= 2 ? 12000 : this.quality >= 1 ? 6000 : 2200;
    const grassMat = new THREE.MeshLambertMaterial({
      map: grassSprite(), transparent: true, alphaTest: .38, side: THREE.DoubleSide,
      color: 0xb9bd84, depthWrite: true,
    });
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.32 + instanceMatrix[3].z * 0.27;
          float sway = sin(uTime * 1.7 + phase) * 0.11 + sin(uTime * 3.1 + phase * 2.0) * 0.035;
          transformed.x += sway * position.y * position.y;
          transformed.z += sway * 0.55 * position.y * position.y;
        #endif
      `);
      grassMat.userData.shader = sh;
    };
    const grass = new THREE.InstancedMesh(this._crossedGrassGeometry(), grassMat, qGrass);
    grass.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < qGrass; i++) {
      const x = rand(r, -155, 155), z = rand(r, -155, 155);
      if (roadFactor(x, z) > .6 && r() > .18) { // keep roads clearer
        s.set(0, 0, 0); m.compose(p.set(x, 0, z), q.identity(), s); grass.setMatrixAt(i, m); continue;
      }
      p.set(x, heightAt(x, z) - .04, z);
      q.setFromEuler(new THREE.Euler(0, r() * TAU, 0));
      const sc = .55 + r() * 1.15; s.set(sc, sc * (.7 + r() * .8), sc);
      m.compose(p, q, s); grass.setMatrixAt(i, m);
      const tone = .55 + r() * .5;
      col.setRGB(tone * .78, tone * .88, tone * .48);
      grass.setColorAt(i, col);
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.group.add(grass);
    this.grass = grass;
    this.grassShader = grassMat;

    // rocks
    const nRocks = this.quality >= 2 ? 950 : 400;
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8878, roughness: .96, metalness: .02, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, nRocks);
    rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false;
    for (let i = 0; i < nRocks; i++) {
      const x = rand(r, -158, 158), z = rand(r, -158, 158);
      p.set(x, heightAt(x, z) - .12, z);
      q.setFromEuler(new THREE.Euler(r() * 3, r() * TAU, r() * 3));
      const sc = .14 + Math.pow(r(), 2.4) * 1.7;
      s.set(sc * (1 + r() * .5), sc * (.5 + r() * .6), sc * (1 + r() * .5));
      m.compose(p, q, s); rocks.setMatrixAt(i, m);
      const t = .55 + r() * .5;
      col.setRGB(t, t * .96, t * .85);
      rocks.setColorAt(i, col);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.group.add(rocks);

    // scattered battlefield debris (splintered planks, shell fragments, bricks)
    const nDeb = this.quality >= 2 ? 700 : 250;
    const debGeo = new THREE.BoxGeometry(1, 1, 1);
    const debMat = new THREE.MeshStandardMaterial({ color: 0x4a4237, roughness: .95, metalness: .1 });
    const deb = new THREE.InstancedMesh(debGeo, debMat, nDeb);
    deb.castShadow = true; deb.receiveShadow = true; deb.frustumCulled = false;
    for (let i = 0; i < nDeb; i++) {
      const cr = CRATERS[randInt(r, 0, CRATERS.length - 1)];
      const a = r() * TAU, d = rand(r, 0, cr.r * 3.5);
      const x = cr.x + Math.cos(a) * d, z = cr.z + Math.sin(a) * d;
      p.set(x, heightAt(x, z) + .06, z);
      q.setFromEuler(new THREE.Euler(r() * 3, r() * TAU, r() * 3));
      s.set(.1 + r() * .7, .04 + r() * .18, .08 + r() * .5);
      m.compose(p, q, s); deb.setMatrixAt(i, m);
    }
    deb.instanceMatrix.needsUpdate = true;
    this.group.add(deb);
  }

  // ---------------------------------------------------------------- props
  /** Physics/NavGrid compatibility: the world owns the height function. */
  heightAt(x, z) { return heightAt(x, z); }

  addCollider(x, y, z, w, h, d) {
    const col = {
      minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
      minY: y, maxY: y + h, broken: false,
    };
    this.colliders.push(col);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.worldSolid = true;
    mesh.userData.collider = col;
    col.mesh = mesh;
    this.group.add(mesh);
    this.raycastMeshes.push(mesh);
    this.propHits.push(mesh);
    return col;
  }

  place(name, x, z, rot = 0, scale = 1, collider = null) {
    let g;
    if (name === 'tank') g = this.assets.getRig(name, ['Hull', 'Turret', 'Gun', 'RoofMG']);
    else if (name === 'apc') g = this.assets.getRig(name, ['Hull', 'Turret', 'Gun']);
    else if (name === 'flag' || name === 'mcom') g = this.assets.get(name);
    else g = this.assets.getStatic(name);
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = rot;
    g.scale.setScalar(scale);
    this.group.add(g);
    if (collider) {
      const [w, h, d] = collider.map(v => v * scale);
      g.userData.collider = this.addCollider(x, heightAt(x, z), z, w, h, d);
      g.userData.collider.group = g;
    }
    return g;
  }

  /** Register a visible prop + its collider as destructible cover. */
  breakable(name, x, z, rot, scale, collider, hp = 90, label = 'SİPER') {
    const g = this.place(name, x, z, rot, scale, collider);
    const col = g.userData.collider;
    if (!col) return g;
    const d = {
      group: g, collider: col, hp, maxHp: hp, label,
      pos: new THREE.Vector3(x, heightAt(x, z), z),
      mission: false,
    };
    col.destructible = d;
    col.mesh.userData.destructible = d;
    this.destructibles.push(d);
    return g;
  }

  /** Bullet / explosion damage against destructible cover. */
  damageProp(target, amount, source = null) {
    const d = target?.userData?.destructible || target?.destructible || null;
    if (!d || d.hp <= 0) return false;
    d.hp -= amount;
    if (d.hp > 0) {
      this.effects.impact?.(d.pos.clone().add(new THREE.Vector3(0, .7, 0)), new THREE.Vector3(0, 1, 0), 'dirt');
      return true;
    }
    d.hp = 0;
    d.collider.broken = true;
    d.collider.mesh.layers.disable(0);
    d.collider.mesh.userData.ignoreRay = true;
    d.group.visible = false;
    this.effects.explosion?.(d.pos.clone().add(new THREE.Vector3(0, .6, 0)), .32);
    if (this.nav) this.nav.invalidateCollider(d.collider);
    this.scene.userData.bus?.emit?.('prop:broken', { destructible: d, source });
    return true;
  }

  damagePropsInRadius(pos, radius, damage, source = null) {
    let hits = 0;
    for (const d of this.destructibles) {
      if (d.hp <= 0) continue;
      const dist = Math.hypot(d.pos.x - pos.x, d.pos.z - pos.z);
      if (dist > radius) continue;
      if (this.damageProp(d.collider.mesh, damage * (1 - dist / radius * .6), source)) hits++;
    }
    return hits;
  }

  _buildProps() {
    const r = mulberry32(4242);
    const P = (...a) => this.place(...a);
    const B = (...a) => this.breakable(...a);

    // ---- objective A: shattered radar hill
    P('watchtower', -64, -46, .4, 1, [4.2, 9.2, 4.2]);
    P('antenna', -78, -57, .2, .9, [2.2, 15, 2.2]);
    P('bunker', -48, -58, .6, 1, [7, 3.4, 7]);
    B('container', -80, -34, .3, 1, [2.6, 2.6, 6.2], 260, 'KONTEYNER');
    B('container', -80, -27, .32, 1, [2.6, 2.6, 6.2], 260, 'KONTEYNER');
    for (let i = 0; i < 5; i++) B('sandbags', -72 + i * 5.4, -68 + Math.sin(i) * 2, r() * .4, 1, [6, 1.2, 1], 80, 'KUM TORBASI');
    for (let i = 0; i < 8; i++) B('crate', -58 + r() * 20, -34 + r() * 18, r() * TAU, .8 + r() * .4, [.9, .9, .9], 45, 'KASA');

    // ---- objective B: hangar 7 / central depot
    P('bunker', 2, 20, 0, 1.25, [8.8, 4.2, 8.8]);
    B('container', -12, 4, .12, 1, [2.6, 2.6, 6.2], 260, 'KONTEYNER');
    B('container', -12, -2.5, .1, 1, [2.6, 2.6, 6.2], 260, 'KONTEYNER');
    B('container', 15, 2, Math.PI / 2, 1, [6.2, 2.6, 2.6], 260, 'KONTEYNER');
    B('container', 15, 8.2, -Math.PI / 2, 1, [6.2, 2.6, 2.6], 260, 'KONTEYNER');
    B('container', -19, 10, .2, 1, [2.6, 2.6, 6.2], 260, 'KONTEYNER');
    const stacked = P('container', -19, 10, .2, 1, null);
    stacked.position.y += 2.62;
    for (let i = 0; i < 10; i++) B('barrel', -4 + r() * 22, -12 + r() * 28, r() * TAU, 1, [.6, .9, .6], 30, 'VARİL');
    for (let i = 0; i < 12; i++) B('crate', -6 + r() * 24, -14 + r() * 30, r() * TAU, .8 + r() * .5, [.9, .9, .9], 45, 'KASA');
    for (let i = 0; i < 6; i++) B('sandbags', -18 + i * 5.5, 30 + r() * 3, 0, 1, [6, 1.2, 1], 80, 'KUM TORBASI');

    // ---- objective C: the pass / anti-tank line
    P('watchtower', 82, 68, -.5, .85, [3.6, 8, 3.6]);
    for (let i = 0; i < 9; i++) {
      const x = 52 + i * 4.3, z = 44 + Math.sin(i * .7) * 5;
      B('barrier', x, z, r() * .2, 1, [1.3, 1.5, 1.3], 70, 'BETON BARİYER');
    }
    for (let i = 0; i < 6; i++) B('sandbags', 50 + i * 6, 64 + Math.sin(i) * 2, .1, 1, [6, 1.2, 1], 80, 'KUM TORBASI');
    P('heli_wreck', 88, 34, 1.1, 1, [8, 3, 8]);
    const hx = 88, hz = 34;
    this.effects.addFire(hx + 1.5, heightAt(hx, hz) + 1.2, hz, 1.4);
    this.effects.smokeEmitter(new THREE.Vector3(hx + 1.5, heightAt(hx, hz) + 1.4, hz), 1.2, 0x2b2a28);

    // ---- wrecked armour as scenery (the drivable one is separate)
    const wreck1 = P('tank', -28, -8, 1.9, 1, null);
    wreck1.rotation.z = .08;
    const turret = AssetKit.node(wreck1, 'Turret');
    if (turret) turret.rotation.y = .85;
    const gun = AssetKit.node(wreck1, 'Gun');
    if (gun) gun.rotation.x = -.13;
    this.addCollider(-28, heightAt(-28, -8), -8, 3.6, 2.7, 6.8);
    this.effects.smokeEmitter(new THREE.Vector3(-28, heightAt(-28, -8) + 2.6, -8), .55, 0x33322f);

    const wreck2 = P('tank', 44, -52, -1.2, 1, null);
    this.addCollider(44, heightAt(44, -52), -52, 3.6, 2.7, 6.8);
    this.effects.addFire(44, heightAt(44, -52) + 2.1, -52, .8);

    // ---- battlefield dressing spread over the valley
    for (let i = 0; i < 34; i++) {
      const a = r() * TAU, d = 35 + r() * 115;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (CAPTURE_DEFS.some(c => Math.hypot(c.x - x, c.z - z) < 20)) continue;
      const k = r();
      if (k < .36) P('burnt_tree', x, z, r() * TAU, .7 + r() * .9, null);
      else if (k < .58) P('crate', x, z, r() * TAU, .8 + r() * .5, null);
      else if (k < .72) P('barrel', x, z, r() * TAU, 1, null);
      else if (k < .84) P('barrier', x, z, r() * TAU, .7 + r() * .4, null);
      else P('sandbags', x, z, r() * TAU, .8, null);
    }
    // burnt forest line
    for (let i = 0; i < 26; i++) {
      const x = -145 + i * 11 + r() * 6, z = -120 + Math.sin(i * .55) * 22 + r() * 9;
      P('burnt_tree', x, z, r() * TAU, .8 + r() * 1.3, null);
    }
    // smoke / fire columns
    const fires = [[-96, 22], [26, -74], [-8, 74], [112, -14], [60, 96]];
    for (const [x, z] of fires) {
      this.effects.smokeEmitter(new THREE.Vector3(x, heightAt(x, z) + .6, z), .55 + r() * .5, 0x35322f);
      if (r() > .45) this.effects.addFire(x, heightAt(x, z) + .3, z, .5 + r() * .5);
    }

    // barbed wire coils (procedural, not from Blender)
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x54524a, roughness: .7, metalness: .65 });
    for (let i = 0; i < 16; i++) {
      const cp = CAPTURE_DEFS[i % 3];
      const a = r() * TAU, d = cp.radius + 5 + r() * 7;
      const x = cp.x + Math.cos(a) * d, z = cp.z + Math.sin(a) * d;
      const coil = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(1.15 + k * .13, .035, 5, 18), wireMat);
        t.rotation.set(Math.PI / 2 + r() * .2, r() * TAU, 0);
        t.position.set(k * .28, .25 + k * .06, 0);
        coil.add(t);
      }
      coil.position.set(x, heightAt(x, z), z);
      coil.rotation.y = r() * TAU;
      this.group.add(coil);
    }

    // spawn rings at the valley rim
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      this.spawnPoints.push(new THREE.Vector3(Math.cos(a) * 96, 0, Math.sin(a) * 96));
    }
    this.allySpawnPoints = [
      new THREE.Vector3(-18, 0, -48), new THREE.Vector3(18, 0, -46),
      new THREE.Vector3(-8, 0, -38), new THREE.Vector3(10, 0, -56),
    ];
  }

  // ---------------------------------------------------------------- objectives
  _buildCapturePoints() {
    for (const def of CAPTURE_DEFS) {
      const y = heightAt(def.x, def.z);
      const flag = this.place('flag', def.x, def.z, 0, 1, null);
      const station = this.place('mcom', def.x + 4.8, def.z + 3.6, .35, 1, [1.2, 2.9, 1.0]);
      const beacon = AssetKit.node(station, 'Beacon');
      if (beacon?.material) beacon.material = beacon.material.clone();
      const stationLight = new THREE.PointLight(0xff4030, 2.2, 13, 2);
      stationLight.position.set(def.x + 4.8, y + 3.05, def.z + 3.6);
      this.group.add(stationLight);
      this.mcomStations.push({
        id: def.id, cp: def, group: station, beacon, light: stationLight,
        pos: new THREE.Vector3(def.x + 4.8, y, def.z + 3.6),
        state: 'idle', progress: 0,
      });
      const cloth = AssetKit.node(flag, 'Cloth');
      if (cloth?.material) cloth.material = cloth.material.clone();
      this.flags.push({ node: cloth, phase: Math.random() * TAU });

      const ringGeo = new THREE.RingGeometry(def.radius - .35, def.radius, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffb45a, transparent: true, opacity: .55, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(def.x, y + .09, def.z);
      this.group.add(ring);

      const discGeo = new THREE.CircleGeometry(def.radius, 48);
      discGeo.rotateX(-Math.PI / 2);
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
        color: 0xffb45a, transparent: true, opacity: .055, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      disc.position.set(def.x, y + .07, def.z);
      this.group.add(disc);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.3, 2.4, 22, 16, 1, true),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(0xffb45a) }, uTime: { value: 0 } },
          vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uTime;
            void main(){ float a = (1.0-vUv.y)*0.13*(0.7+0.3*sin(uTime*2.0+vUv.x*12.0));
            gl_FragColor=vec4(uColor,a); }`,
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        })
      );
      beam.position.set(def.x, y + 11, def.z);
      this.group.add(beam);

      const light = new THREE.PointLight(0xffb45a, 9, 26, 2);
      light.position.set(def.x, y + 5, def.z);
      this.group.add(light);
      this.dynamicLights.push({ light, base: 9, phase: Math.random() * TAU });

      this.capturePoints.push({
        ...def, y, pos: new THREE.Vector3(def.x, y, def.z), flag, cloth,
        ring, disc, beam, light, owner: 'neutral', progress: 0, contested: false,
      });
    }
  }

  setCaptureOwner(cp, owner) {
    cp.owner = owner;
    const c = owner === 'ally' ? 0x6fb6ff : owner === 'enemy' ? 0xff5540 : 0xffb45a;
    cp.ring.material.color.setHex(c);
    cp.disc.material.color.setHex(c);
    cp.beam.material.uniforms.uColor.value.setHex(c);
    cp.light.color.setHex(c);
    const cloth = cp.cloth;
    if (cloth?.material?.color) cloth.material.color.setHex(owner === 'ally' ? 0x2b5da8 : 0x8b1d16);
  }

  setMcomState(station, state) {
    station.state = state;
    const c = state === 'active' ? 0xff4030 : state === 'done' ? 0x55e0a0 : 0x9a4a32;
    station.light.color.setHex(c);
    if (station.beacon?.material?.color) station.beacon.material.color.setHex(c);
    if (station.beacon?.material?.emissive) station.beacon.material.emissive.setHex(c);
  }

  // ---------------------------------------------------------------- atmosphere
  _buildAtmosphere() {
    // floating dust / embers
    const N = this.quality >= 2 ? 1100 : 450;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    const r = mulberry32(31337);
    this.dustVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(r, -150, 150);
      pos[i * 3 + 1] = rand(r, .5, 26);
      pos[i * 3 + 2] = rand(r, -150, 150);
      const warm = r();
      col[i * 3] = .8 + warm * .2; col[i * 3 + 1] = .55 + warm * .35; col[i * 3 + 2] = .3 + warm * .3;
      size[i] = 1 + r() * 3.4;
      this.dustVel[i * 3] = rand(r, -.4, .9);
      this.dustVel[i * 3 + 1] = rand(r, -.05, .22);
      this.dustVel[i * 3 + 2] = rand(r, -.5, .5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; varying vec3 vC; varying float vF;
        void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
        vF=clamp(1.0-(-mv.z)/260.0,0.0,1.0);
        gl_PointSize=aSize*(190.0/max(-mv.z,1.0)); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vF;
        void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p);
        float a=smoothstep(0.5,0.08,d)*0.55*vF; gl_FragColor=vec4(vC,a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.dust = points;
    this.dustGeo = g;

    // blinking obstruction beacons
    const beacons = [[-78, -57, 16], [82, 68, 11]];
    for (const [x, z, h] of beacons) {
      const l = new THREE.PointLight(0xff2a18, 0, 12, 2);
      l.position.set(x, heightAt(x, z) + h, z);
      this.group.add(l);
      this.dynamicLights.push({ light: l, base: 0, blink: true });
    }
  }

  /** Circle-vs-AABB push-out for player and AI. */
  collide(pos, radius = .45, height = 1.8) {
    for (const b of this.colliders) {
      if (b.broken) continue;
      if (pos.y + height < b.minY || pos.y > b.maxY) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
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
    const half = MAP_SIZE / 2 - 4;
    pos.x = clamp(pos.x, -half, half);
    pos.z = clamp(pos.z, -half, half);
  }

  update(dt, t) {
    this.time = t;
    if (this.grassShader?.userData.shader) this.grassShader.userData.shader.uniforms.uTime.value = t;
    for (const f of this.flags) {
      if (!f.node) continue;
      f.node.rotation.z = Math.sin(t * 1.35 + f.phase) * .09;
      f.node.rotation.x = Math.sin(t * .9 + f.phase) * .05;
      f.node.scale.x = 1 + Math.sin(t * 2.2 + f.phase) * .035;
    }
    for (const d of this.dynamicLights) {
      d.light.intensity = d.blink
        ? (Math.sin(t * 3.2) > .4 ? 14 : .4)
        : d.base * (.85 + Math.sin(t * 1.7 + (d.phase || 0)) * .12);
    }
    for (const cp of this.capturePoints) {
      cp.beam.material.uniforms.uTime.value = t;
      cp.ring.material.opacity = .35 + Math.sin(t * 2 + cp.x) * .16 + (cp.contested ? .25 : 0);
      cp.ring.rotation.y = t * .05;
    }
    for (const s of this.mcomStations) {
      const pulse = s.state === 'active' ? 3.5 + Math.sin(t * 7) * 2.8 : s.state === 'done' ? 1.6 : .35;
      s.light.intensity = pulse;
      if (s.beacon) s.beacon.scale.setScalar(1 + Math.sin(t * 4 + s.pos.x) * (s.state === 'active' ? .16 : .03));
    }
    // drifting dust
    const p = this.dustGeo.attributes.position;
    const arr = p.array, v = this.dustVel;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += v[i] * dt; arr[i + 1] += v[i + 1] * dt; arr[i + 2] += v[i + 2] * dt;
      if (arr[i] > 155) arr[i] = -155;
      if (arr[i + 2] > 155) arr[i + 2] = -155;
      if (arr[i + 1] > 28) arr[i + 1] = .5;
    }
    p.needsUpdate = true;
  }
}
