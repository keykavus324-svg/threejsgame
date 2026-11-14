/**
 * Headless logic smoke test.
 * Runs the whole game simulation (world build, Blender-asset baking, player,
 * enemies, vehicle, effects, HUD, engine core, physics/nav/spatial/weather,
 * save progression) against a mocked DOM/canvas so that runtime reference
 * errors surface without a browser. Run: node tools/smoke.mjs
 */
const gradient = () => ({ addColorStop() {} });
const ctx2d = () => new Proxy({
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  createRadialGradient: gradient, createLinearGradient: gradient,
  measureText: () => ({ width: 10 }),
}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });

const mkEl = (tag = 'div') => {
  const e = {
    tagName: tag, width: 1280, height: 720, style: { setProperty() {}, width: '', opacity: '' },
    classList: { _s: new Set(), add(...a) { a.forEach(x => this._s.add(x)); }, remove(...a) { a.forEach(x => this._s.delete(x)); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    children: [], textContent: '', innerHTML: '', offsetWidth: 1,
    getContext: () => ctx2d(), appendChild(c) { this.children.push(c); return c; },
    prepend(c) { this.children.unshift(c); return c; }, remove() {},
    addEventListener() {}, querySelector: () => mkEl('span'),
    get lastChild() { return this.children[this.children.length - 1]; },
    get firstChild() { return this.children[0]; },
    toDataURL: () => 'data:,',
  };
  return e;
};

const els = new Map();
globalThis.document = {
  createElement: (t) => mkEl(t),
  createElementNS: (ns, t) => mkEl(t),
  getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id); },
  addEventListener() {}, pointerLockElement: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0;
globalThis.HTMLCanvasElement = function () {};

const THREE = await import('three');
const { AssetKit } = await import('../src/assets.js');
const { AudioEngine } = await import('../src/audio.js');
const { HUD } = await import('../src/hud.js');
const { Effects } = await import('../src/effects.js');
const { createSky } = await import('../src/sky.js');
const { World } = await import('../src/world.js');
const { Player } = await import('../src/player.js');
const { EnemyManager } = await import('../src/enemies.js');
const { Vehicle } = await import('../src/vehicle.js');
const { Bus } = await import('../src/engine/Bus.js');
const { Engine } = await import('../src/engine/Engine.js');
const { Physics } = await import('../src/engine/Physics.js');
const { NavGrid } = await import('../src/engine/NavGrid.js');
const { Save } = await import('../src/engine/Save.js');
const { SpatialHash } = await import('../src/engine/SpatialHash.js');
const { Weather } = await import('../src/gfx/Weather.js');
const { WEAPONS } = await import('../src/systems/Loadout.js');

// --- synthetic stand-ins for the whole 25-piece GLB kit ---
const KIT = ['soldier_enemy', 'soldier_ally', 'rifle', 'tank', 'bunker', 'container',
  'watchtower', 'crate', 'barrel', 'sandbags', 'barrier', 'burnt_tree',
  'heli_wreck', 'flag', 'antenna', 'apc', 'mcom', 'ruin_wall', 'bridge',
  'wpn_smg', 'wpn_lmg', 'wpn_shotgun', 'wpn_sniper', 'wpn_launcher', 'rocket'];

const mats = [
  new THREE.MeshStandardMaterial({ color: 0x445544, roughness: .8 }),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: .5, metalness: .6 }),
];
const pivotNames = ['Hips', 'Torso', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR', 'Weapon', 'Hull', 'Turret', 'Gun', 'RoofMG'];
function fakeAsset(name) {
  const root = new THREE.Group(); root.name = 'SCENE';
  const r = new THREE.Group(); r.name = 'ROOT_' + name.toUpperCase(); root.add(r);
  const pivots = [];
  for (const p of pivotNames) {
    if (name.startsWith('soldier') && !['Hips', 'Torso', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR', 'Weapon'].includes(p)) continue;
    if (name === 'tank' && !['Hull', 'Turret', 'Gun', 'RoofMG'].includes(p)) continue;
    if (!name.startsWith('soldier') && name !== 'tank') continue;
    const e = new THREE.Group(); e.name = p; r.add(e); pivots.push(e);
  }
  const parents = pivots.length ? pivots : [r];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3), mats[i % mats.length]);
    m.position.set((i % 3) * .2, i * .12, (i % 2) * .2);
    parents[i % parents.length].add(m);
  }
  if (name === 'flag') {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .8), mats[0]); c.name = 'Cloth'; r.add(c);
  }
  return root;
}

const assets = new AssetKit();
for (const n of KIT) assets.map.set(n, fakeAsset(n));
console.log('[smoke] fake kit', KIT.length, 'assets (coverage:', KIT.length === 25 ? 'complete' : 'INCOMPLETE', ')');

const scene = new THREE.Scene();
scene.userData.bus = null; // wired below after bus exists
const camera = new THREE.PerspectiveCamera(76, 16 / 9, .03, 1400);
const hud = new HUD();
const audio = new AudioEngine();
const sky = createSky(scene, 1);
const effects = new Effects(scene, 0);

const bus = new Bus();
const save = new Save();
const engine = new Engine();
let engineTicks = 0;
engine.addSystem('tickprobe', () => engineTicks++, { order: 99 });
const spatial = new SpatialHash(8);
scene.userData.bus = bus;

const game = {
  scene, camera, assets, hud, audio, effects, sky, bus, save, spatial, engine,
  settings: { difficulty: 1, quality: 0, sensitivity: 1, speed: 1, volume: .7, fov: 76, timeOfDay: 17.4, weather: 'dust' },
  state: 'playing', time: 0, enemyTickets: 120, allyTickets: 300,
  get shake() { return effects.shake; },
  addShake(v) { effects.shake += v; },
  addScore(n) { player.stats.score += n; },
  damageEnemy(e, a, h, s) { enemies.damage(e, a, h, s); },
  onPlayerDeath() { this.allyTickets -= 5; },
};

console.log('[smoke] building world…');
const world = new World(scene, assets, effects, 0);
game.world = world;
console.log('[smoke] terrain triangles', world.terrain.geometry.index.count / 3,
  '| props', world.group.children.length, '| colliders', world.colliders.length,
  '| raycast targets', world.raycastMeshes.length, '| destructibles', world.destructibles.length,
  '| mcom', (world.mcomStations || []).length);

const physics = new Physics(world, bus);
game.physics = physics;
const nav = new NavGrid(world, physics, 4);
nav.build();
world.nav = nav;
game.nav = nav;
console.log('[smoke] navgrid', nav.N + '×' + nav.N, '| walkable cells', nav.walk.reduce((a, v) => a + v, 0), '| cover points', nav.cover.length);

const weather = new Weather(scene, world, effects, sky, 0);
weather.setMode('dust');
game.weather = weather;
bus.on('prop:broken', ({ destructible }) => { if (destructible?.collider) nav.invalidateCollider(destructible.collider); });

const player = new Player({ scene, camera, world, assets, effects, audio, hud, game });
game.player = player;
const enemies = new EnemyManager(game);
game.enemies = enemies;
const vehicle = new Vehicle(game);
game.vehicle = vehicle;
effects.onExplosion = (pos, power) => enemies.damageInRadius(pos, 7 * power, 100 * power);

enemies.spawnAllies();
enemies.spawnWave(2, 1);

const input = {
  down: () => false, consume: () => false,
  mouse: { dx: 0, dy: 0, left: false, right: false, leftDown: false, wheel: 0 },
};
let frames = 0;
for (let i = 0; i < 180; i++) {
  const dt = 1 / 60;
  game.time += dt;
  const t = game.time;
  if (i === 20) player.fire();
  if (i === 30) player.reload();
  if (i === 40) player.throwGrenade();
  if (i === 50) player.callAirstrike();
  if (i === 60) player.switchSlot(1);
  if (i === 70) { player.fire(); }
  if (i === 90) player.takeDamage(25, new THREE.Vector3(10, 0, 10));
  if (i === 100) vehicle.enter();
  if (i === 110) { input.mouse.left = true; vehicle.fireMainGun(); vehicle.fireMG(); input.mouse.left = false; }
  if (i === 120) vehicle.exit();
  if (i === 130) { const e = enemies.units.find(u => u.alive && u.faction === 'enemy'); if (e) e.damage(500, true, player); }
  player.update(dt, t, input);
  vehicle.update(dt, t, input);
  enemies.update(dt, t);
  effects.update(dt, t);
  world.update(dt, t);
  sky.update(t);
  weather.update(dt, t, camera.position);
  hud.minimap(game, dt);
  hud.tickCenter(dt);
  engine.tick(dt, { t });
  frames++;
}
console.log('[smoke] phase 1 frames simulated', frames, '| engine ticks', engineTicks,
  '| fps', engine.stats.fps.toFixed(0), '| fixed', engine.STEP);
console.log('[smoke] units', enemies.units.length, '| hitboxes', enemies.hitboxes.length,
  '| remaining', enemies.remaining(), '| player hp', player.health.toFixed(1),
  '| score', player.stats.score, '| grenades', player.grenades.length, '| rockets', player.rockets.length);

// --- phase 2: engineer class with full unlocks → launcher path (rocket physics) ---
console.log('[smoke] phase 2 · engineer · RPG-29 YILDIRIM');
save.patch('loadout', { class: 'engineer', weapon: 'launcher' });
save.data.progression.unlocked = WEAPONS.map(w => w.id);
player.reset();
player.switchSlot(1);
let rocketFired = false, rocketSeen = 0;
for (let i = 0; i < 240; i++) {
  const dt = 1 / 60;
  game.time += dt;
  const t = game.time;
  if (i === 40) { player.fire(); rocketFired = true; }
  if (i === 41) { rocketSeen = Math.max(rocketSeen, player.rockets.length); }
  if (i === 60) { input.mouse.left = false; }
  player.update(dt, t, input);
  enemies.update(dt, t);
  effects.update(dt, t);
  world.update(dt, t);
  weather.update(dt, t, camera.position);
  engine.tick(dt, { t });
}
console.log('[smoke] rocket fired', rocketFired, '| seen in flight', rocketSeen,
  '| resolved', player.rockets.length, '| class', player.classDef.id, '| slot weapon', WEAPONS[player.slotWeapons[1]].id);

// --- progression sanity ---
const before = save.data.progression.xp;
save.addXp(600); // rank 2 threshold
console.log('[smoke] xp', before, '→', save.data.progression.xp, '| rank', save.data.progression.rank,
  '| rankName', save.rankName, '| unlocked', save.data.progression.unlocked.join(','));

console.log('[smoke] OK');
process.exit(0);
