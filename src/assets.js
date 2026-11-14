import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NAMES = [
  'soldier_enemy', 'soldier_ally', 'rifle', 'tank', 'bunker', 'container',
  'watchtower', 'crate', 'barrel', 'sandbags', 'barrier', 'burnt_tree',
  'heli_wreck', 'flag', 'antenna', 'apc', 'mcom', 'ruin_wall', 'bridge',
  'wpn_smg', 'wpn_lmg', 'wpn_shotgun', 'wpn_sniper', 'wpn_launcher', 'rocket',
];

const FALLBACK_SIZE = {
  soldier_enemy: [.7, 1.8, .5], soldier_ally: [.7, 1.8, .5], rifle: [.08, .1, .7],
  tank: [3.4, 2.6, 6.6], bunker: [7, 3.4, 7], container: [2.5, 2.6, 6.1],
  watchtower: [4, 12, 4], crate: [.9, .9, .9], barrel: [.6, .9, .6],
  sandbags: [6, 1.2, .9], barrier: [1.2, 1.6, 1.2], burnt_tree: [.5, 4, .5],
  heli_wreck: [11, 3, 12], flag: [1.4, 5.4, .1], antenna: [2, 17, 2],
  apc: [2.7, 2.4, 6.0], mcom: [1.2, 3.0, 1.0], ruin_wall: [7, 3, 1],
  bridge: [16, 3, 3.4], rocket: [.12, .12, .75],
  wpn_smg: [.08, .1, .55], wpn_lmg: [.1, .14, .9], wpn_shotgun: [.09, .12, .8],
  wpn_sniper: [.1, .16, 1.1], wpn_launcher: [.14, .16, 1.0],
};

function fallback(name) {
  const g = new THREE.Group();
  g.name = 'FALLBACK_' + name;
  const s = FALLBACK_SIZE[name] || [1, 1, 1];
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(s[0], s[1], s[2]),
    new THREE.MeshStandardMaterial({ color: 0x4a544a, roughness: .9, metalness: .1 })
  );
  m.position.y = s[1] / 2;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return g;
}

function tune(m) {
  if (m.isMesh) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = true;
  }
  const list = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
  for (const mat of list) {
    if (!mat) continue;
    mat.envMapIntensity = 0.85;
    if (mat.name && mat.name.includes('Glass')) {
      mat.metalness = 0.6; mat.roughness = 0.08;
    }
    if (mat.name && mat.name.includes('Emissive')) {
      mat.emissiveIntensity = 2.6;
    }
    mat.needsUpdate = true;
  }
}

/**
 * Blender adds ".001" to duplicate object names and glTF sanitises that to
 * "001" (dots removed). Normalise both forms back to the authored pivot name.
 */
const canonicalName = (n) => (n || '').replace(/\.\d{3}$/, '').replace(/\d{3}$/, '');

/**
 * Merges a Blender hierarchy down to one draw call per material, optionally
 * preserving named pivots (joints, turret, gun) for runtime animation.
 * glTF gives us 50-150 tiny objects per model; without this a battlefield of
 * 30 soldiers + 200 props would cost thousands of draw calls.
 */
function bake(group, pivotNames = []) {
  group.updateMatrixWorld(true);
  const pivots = new Map([[group, []]]);
  if (pivotNames.length) {
    group.traverse(o => {
      if (!o.isMesh && pivotNames.includes(canonicalName(o.name)) && !pivots.has(o)) pivots.set(o, []);
    });
  }
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });

  const rel = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  for (const m of meshes) {
    let p = m.parent, pivot = group;
    while (p) {
      if (pivots.has(p)) { pivot = p; break; }
      p = p.parent;
    }
    inv.copy(pivot.matrixWorld).invert();
    rel.multiplyMatrices(inv, m.matrixWorld);
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(rel);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const buckets = pivots.get(pivot);
    let b = buckets.find(x => x.key === mat.uuid);
    if (!b) { b = { key: mat.uuid, mat, geos: [] }; buckets.push(b); }
    b.geos.push(g);
  }
  for (const m of meshes) m.parent.remove(m);
  for (const [pivot, buckets] of pivots) {
    for (const b of buckets) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      pivot.add(mesh);
    }
  }
  return group;
}

export class AssetKit {
  constructor() { this.map = new Map(); this.materials = new Map(); }

  async load(onProgress) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (url, loaded, total) => onProgress?.(loaded / Math.max(1, total), url);
    const loader = new GLTFLoader(manager);
    const jobs = NAMES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`/assets/${name}.glb`);
        gltf.scene.traverse(tune);
        this.map.set(name, gltf.scene);
      } catch (e) {
        console.warn('[assets] GLB missing, using primitive stand-in for', name, e);
        this.map.set(name, fallback(name));
      }
    });
    await Promise.all(jobs);
    return this;
  }

  /** Returns a fresh, independently transformable clone of a Blender-authored asset. */
  get(name) {
    const src = this.map.get(name);
    if (!src) return fallback(name);
    const g = src.clone(true);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /** Static prop: one draw call per material, hierarchy flattened. */
  getStatic(name) { return bake(this.get(name), []); }

  /** Animated prop: keeps the named pivots, merges everything else. */
  getRig(name, pivots) { return bake(this.get(name), pivots); }

  /** Find a named pivot inside a cloned hierarchy (e.g. Turret, Hips). */
  static node(group, name) {
    let exact = null, looseNode = null, looseMesh = null;
    group.traverse((o) => {
      if (o.name === name) { if (!exact) exact = o; return; }
      if (canonicalName(o.name) !== name) return;
      if (o.isMesh) { if (!looseMesh) looseMesh = o; }
      else if (!looseNode) looseNode = o;
    });
    return exact || looseNode || looseMesh;
  }
}
