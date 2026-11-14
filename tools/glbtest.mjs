/** Validates that every exported Blender GLB loads and bakes in Three.js. */
const mkEl = () => ({
  width: 256, height: 256, complete: true, naturalWidth: 256, naturalHeight: 256,
  _listeners: {}, addEventListener(k, f) { (this._listeners[k] ||= []).push(f); },
  removeEventListener() {}, set src(v) { this._src = v; queueMicrotask(() => (this._listeners.load || []).forEach(f => f({ target: this }))); },
  get src() { return this._src; },
});
globalThis.document = { createElementNS: () => mkEl(), createElement: () => mkEl() };
globalThis.self = globalThis;
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { AssetKit } = await import('../src/assets.js');
const fs = await import('node:fs/promises');
const path = await import('node:path');

const dir = 'public/assets';
const files = (await fs.readdir(dir)).filter(f => f.endsWith('.glb'));
const kit = new AssetKit();
const loader = new GLTFLoader();
for (const f of files) {
  const buf = await fs.readFile(path.join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  let meshes = 0, tris = 0, verts = 0;
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    verts += g.attributes.position?.count || 0;
    tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
  });
  const name = f.replace('.glb', '');
  kit.map.set(name, gltf.scene);
  const pivots = name.startsWith('soldier')
    ? ['Hips', 'Torso', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR', 'Weapon']
    : name === 'tank' ? ['Hull', 'Turret', 'Gun', 'RoofMG']
    : name === 'apc' ? ['Hull', 'Turret', 'Gun'] : [];
  const baked = pivots.length ? kit.getRig(name, pivots) : kit.getStatic(name);
  let bakedMeshes = 0, bakedTris = 0;
  baked.traverse(o => {
    if (!o.isMesh) return;
    bakedMeshes++;
    bakedTris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  const pivotsFound = pivots.filter(p => AssetKit.node(baked, p)).length;
  if (name === 'flag' && !AssetKit.node(kit.get(name), 'Cloth')) throw new Error('flag Cloth node missing');
  console.log(`${name.padEnd(16)} ${String(meshes).padStart(4)} meshes → ${String(bakedMeshes).padStart(3)} baked | ` +
    `${Math.round(tris).toString().padStart(6)} tris → ${Math.round(bakedTris).toString().padStart(6)} | pivots ${pivotsFound}/${pivots.length}`);
  if (bakedMeshes === 0) throw new Error('bake produced no meshes for ' + name);
  if (Math.abs(tris - bakedTris) > tris * .02) console.warn('  ! triangle count changed', name);
}
console.log('[glbtest] all', files.length, 'assets OK');
