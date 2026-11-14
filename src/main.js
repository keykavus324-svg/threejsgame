import * as THREE from 'three';
import { AssetKit } from './assets.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { Effects } from './effects.js';
import { createSky, SUN_DIR } from './sky.js';
import { World, heightAt, MAP_SIZE } from './world.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Vehicle } from './vehicle.js';
import { PostFX } from './post.js';
import { Bus } from './engine/Bus.js';
import { Engine } from './engine/Engine.js';
import { Physics } from './engine/Physics.js';
import { NavGrid } from './engine/NavGrid.js';
import { Save } from './engine/Save.js';
import { Debug } from './engine/Debug.js';
import { SpatialHash } from './engine/SpatialHash.js';
import { Weather } from './gfx/Weather.js';
import { LensFlare } from './gfx/LensFlare.js';
import { WEAPONS } from './systems/Loadout.js';
import { clamp, damp } from './utils.js';

const $ = (id) => document.getElementById(id);
const weaponName = (id) => WEAPONS.find(w => w.id === id)?.name || id.toUpperCase();
const _fwd = new THREE.Vector3();
const _sp = new THREE.Vector3();
const _origin = new THREE.Vector3(0, 0, 0);

class Game {
  constructor() {
    this.canvas = $('viewport');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, alpha: false,
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, .03, 1400);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 30, 90);

    // persistent save → settings/progression/loadout (single source of truth)
    this.bus = new Bus();
    this.save = new Save();
    this.settings = Object.assign({ speed: 1 }, this.save.data.settings);
    this.spatial = new SpatialHash(8);
    this.engine = new Engine({ renderer: this.renderer });

    this.state = 'boot';
    this.time = 0;
    this.elapsed = 0;
    this.flash = 0;
    this.allyTickets = 300;
    this.enemyTickets = 0;
    this.wave = 1;
    this.waveTotal = 1;
    this.intermission = 0;
    this.waveRunning = false;
    this.stats = { score: 0, kills: 0, headshots: 0, shots: 0, hits: 0 };
    this.fpsAvg = 60;
    this.lowFpsT = 0;
    this._progT = 0;

    this.hud = new HUD();
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.assets = new AssetKit();
    this.clock = new THREE.Clock();

    this._bindUI();
    this.input.onLockChange = (locked) => this._onLockChange(locked);

    // wire the shared event bus for destructible prop breaks → nav refresh
    this.scene.userData.bus = this.bus;
    this.bus.on('prop:broken', ({ destructible }) => {
      if (destructible?.collider && this.nav) this.nav.invalidateCollider(destructible.collider);
    });

    addEventListener('resize', () => this._resize());
    this._boot();
  }

  // ------------------------------------------------------------------ setup
  _bindUI() {
    $('start-btn').addEventListener('click', () => { this.audio.init(); this.audio.ui('confirm'); this.start(); });
    $('resume-btn').addEventListener('click', () => { this.audio.ui('confirm'); this.resume(); });
    $('restart-btn').addEventListener('click', () => { this.audio.ui('confirm'); this.start(); });
    $('again-btn').addEventListener('click', () => { this.audio.ui('confirm'); this.start(); });
    $('opt-diff').addEventListener('change', e => {
      this.settings.difficulty = +e.target.value;
      this.save.patch('settings', { difficulty: this.settings.difficulty });
    });
    $('opt-quality').addEventListener('change', e => {
      this.settings.quality = +e.target.value;
      this.applyQuality();
      this.save.patch('settings', { quality: this.settings.quality });
    });
    $('opt-sens').addEventListener('input', e => {
      this.settings.sensitivity = +e.target.value / 100;
      $('sens-val').textContent = this.settings.sensitivity.toFixed(2);
    });
    $('opt-sens').addEventListener('change', () => this.save.patch('settings', { sensitivity: this.settings.sensitivity }));
    $('opt-vol').addEventListener('input', e => {
      this.settings.volume = +e.target.value / 100;
      $('vol-val').textContent = e.target.value;
      this.audio.setVolume(this.settings.volume);
    });
    $('opt-vol').addEventListener('change', () => this.save.patch('settings', { volume: this.settings.volume }));
    // reflect saved settings in the menu widgets
    $('opt-diff').value = String(this.settings.difficulty ?? 1);
    $('opt-quality').value = String(this.settings.quality ?? 2);
    $('opt-sens').value = String(Math.round((this.settings.sensitivity ?? 1) * 100));
    $('sens-val').textContent = (this.settings.sensitivity ?? 1).toFixed(2);
    $('opt-vol').value = String(Math.round((this.settings.volume ?? .7) * 100));
    $('vol-val').textContent = String(Math.round((this.settings.volume ?? .7) * 100));
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'playing') this.pause();
    });
  }

  async _boot() {
    this.hud.showLoading(true, .04, 'BLENDER 4.5 KİTİ YÜKLENİYOR…');
    this.hud.showMenu(false);
    this.hud.showHUD(false);

    // scene environment from the same procedural dusk sky (metal needs reflections)
    const q = this.settings.quality;
    this.sky = createSky(this.scene, q);
    if (this.settings.timeOfDay != null) this.sky.setTime(this.settings.timeOfDay);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(
      new THREE.SphereGeometry(20, 32, 16),
      this.sky.sky.material.clone()
    );
    envScene.add(envSky);
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envRT = pmrem.fromScene(envScene, .04, .1, 100);
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = .72;
      pmrem.dispose();
    } catch (e) { console.warn('[env] PMREM failed', e); }

    await this.assets.load((p) => this.hud.showLoading(true, .06 + p * .44, 'MODEL KİTİ · ' + Math.round((p) * 100) + '%'));
    this.hud.showLoading(true, .58, 'ARAZİ VE ATMOSFER ÜRETİLİYOR…');

    this.effects = new Effects(this.scene, q);
    this.world = new World(this.scene, this.assets, this.effects, q);
    this.hud.showLoading(true, .72, 'FİZİK VE NAVİGASYON KURULUYOR…');

    // engine-side simulation subsystems (headless-safe, deterministic)
    this.physics = new Physics(this.world, this.bus);
    this.nav = new NavGrid(this.world, this.physics, 4);
    this.nav.build();
    this.world.nav = this.nav;
    this.weather = new Weather(this.scene, this.world, this.effects, this.sky, q);
    if (this.settings.weather) this.weather.setMode(this.settings.weather);

    this.hud.showLoading(true, .84, 'MUHAREBE SİSTEMLERİ HAZIRLANIYOR…');

    this.player = new Player({
      scene: this.scene, camera: this.camera, world: this.world, assets: this.assets,
      effects: this.effects, audio: this.audio, hud: this.hud, game: this,
    });
    this.enemies = new EnemyManager(this);
    this.vehicle = new Vehicle(this);
    this.post = new PostFX(this.renderer, this.scene, this.camera, q);
    this.flare = new LensFlare();
    this.debug = new Debug(this.engine, this);

    // fixed-order frame systems, profiled and driven by the engine core
    this.engine.addSystem('gameplay', (dt, ctx) => {
      const t = ctx.t;
      const input = this.input;
      if (this.state === 'playing') {
        this.time += dt;
        if (input.consume('KeyE')) this.vehicle.toggle();
        this.player.update(dt, t, input);
        this.vehicle.update(dt, t, input);
        this.enemies.update(dt, t);
        this._waveLogic(dt);
        this._ticketLogic(dt);
        this.hud.tickCenter(dt);
        this.hud.minimap(this, dt);
      } else if (this.state === 'menu') {
        this._menuCamera(t, dt);
        this.player.vmRoot.visible = false;
        this.enemies.update(0, t);
      } else if (this.state === 'end' || this.state === 'paused' || this.state === 'boot') {
        // frozen gameplay, but keep the viewmodel state consistent
        this.player.vmRoot.visible = this.state === 'paused';
      }
    }, { order: 10 });

    this.engine.addSystem('worldfx', (dt, ctx) => {
      if (this.state === 'paused') return;
      const t = ctx.t;
      this.effects.update(dt, t);
      this.world.update(dt, t);
      this.sky.update(t);
      this.weather.update(dt, t, this.camera.position);
      this.sky.setShadowFocus(this.state === 'playing' && this.player ? this.player.pos : _origin, 84);
    }, { order: 20 });

    this.engine.addSystem('post', (dt, ctx) => {
      const t = ctx.t;
      this.flash = Math.max(0, this.flash - dt * 2.4);
      const damage = this.player ? clamp(1 - this.player.health / 100, 0, 1) * .55 : 0;
      if (this.post) {
        const tint = this.sky?.uniforms?.uSunTint?.value;
        this.post.updateFrame(t, this.camera, SUN_DIR, {
          dt,
          damage: this.state === 'playing' ? damage : 0,
          flash: this.flash,
          dof: this.player?.wantADS ? .52 : .16,
          focus: this.player?.wantADS ? 17 : 46,
          focusRange: 26,
          sunColor: tint ? [clamp(tint.x, 0, 1), clamp(tint.y, 0, 1), clamp(tint.z, 0, 1)] : [1, .7, .38],
          sunIntensity: this.sky?.sun ? clamp(this.sky.sun.intensity / 3.2, .15, 1) : 1,
          boost: this.flash * .5,
        });
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      this._drawFlare();
      this.debug?.update();
    }, { order: 30 });

    this.effects.onExplosion = (pos, power) => {
      this.enemies.damageInRadius(pos, 7.5 * power, 118 * power);
      this.audio.explosion(power);
      this.flash = Math.min(.5, this.flash + .18 * power);
    };

    this.applyQuality();
    this._refreshMenuProg();
    this._syncProgression();
    this.hud.showLoading(true, 1, 'SAHA HAZIR');
    this.audio.setVolume(this.settings.volume ?? .7);
    setTimeout(() => {
      this.hud.showLoading(false);
      this.hud.showMenu(true);
      this.state = 'menu';
    }, 420);
    this._loop();
  }

  applyQuality() {
    const q = this.settings.quality;
    const pr = q >= 3 ? Math.min(devicePixelRatio, 2) : q >= 2 ? Math.min(devicePixelRatio, 1.5) : q >= 1 ? 1 : .78;
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q >= 1;
    if (this.sky) { this.sky.sun.castShadow = q >= 1; this.sky.setQuality(q); }
    if (this.post) { this.post.setQuality(q); this.post.setSize(innerWidth, innerHeight, pr); }
  }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    const pr = this.renderer.getPixelRatio();
    this.post?.setSize(innerWidth, innerHeight, pr);
    this.flare?.resize();
  }

  // ------------------------------------------------------------------ state
  start() {
    this.state = 'playing';
    this.time = 0;
    this.allyTickets = 300;
    this.enemyTickets = 108 + this.settings.difficulty * 18;
    this.wave = 1; this.waveRunning = false; this.intermission = 5;
    this.flash = 0;
    this.enemies.clear();
    this.enemies.spawnAllies();
    this.player.reset();
    this.vehicle.reset();
    this.vehicle.occupied = false;
    this.vehicle.prompt = false;
    this.player.inVehicle = false;
    this.player.vmRoot.visible = true;
    this.audio.engine(false);
    this.hud.showMenu(false); this.hud.showPause(false); this.hud.hideEnd();
    this.hud.showHUD(true);
    this.hud.clear();
    this.hud.vehicle(false);
    this.hud.tickets(this.allyTickets, this.enemyTickets);
    this._syncProgression();
    this.hud.center('OPERASYON KIRLI ŞAFAK', 'İLK TEMAS 5s · KALKAN-9 YAKININIZDA [E] · BÖLGELERİ TUT', 4);
    this.hud.kill('HQ', 'TABUR', 'sahada');
    this.audio.init(); this.audio.radio();
    this.input.lock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showPause(true);
    this.input.unlock();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.showPause(false);
    this.input.lock();
  }
  _onLockChange(locked) {
    if (!locked && this.state === 'playing' && !this.input.forceLook) this.pause();
  }

  end(win) {
    if (this.state === 'end') return;
    this.state = 'end';
    this.input.unlock();
    this.audio.engine(false);
    this.hud.showHUD(false);
    // persist progression: XP, rank-ups, weapon unlocks
    const p = this.save.data.progression;
    const score = this.player.stats.score;
    p.kills += this.player.stats.kills;
    p.matches += 1;
    if (win) p.wins += 1;
    p.bestScore = Math.max(p.bestScore || 0, score);
    const xpEarned = Math.round(score * (win ? 1 : .45)) + (win ? 750 : 120);
    const leveled = this.save.addXp(xpEarned); // flushes + sets lastUnlocks
    const unlocks = (this.save.lastUnlocks || []).slice();
    this._refreshMenuProg();
    this._syncProgression();
    this.hud.showEnd(win, this.player.stats, this.time, {
      xp: p.xp, xpEarned, rank: this.save.rankName, rankNum: p.rank, leveled, unlocks: unlocks.map(weaponName),
    });
    const eyebrow = $('end-eyebrow');
    if (eyebrow) {
      eyebrow.textContent = unlocks.length
        ? 'TERFİ · YENİ SİLAH: ' + unlocks.map(weaponName).join(' · ')
        : win ? 'GÖREV TAMAMLANDI' : 'GÖREV BAŞARISIZ';
    }
    this.audio.ui(win ? 'confirm' : 'alarm');
  }

  // ------------------------------------------------------------------ helpers
  get shake() { return this.effects?.shake || 0; }
  addShake(v) { if (this.effects) this.effects.shake = Math.min(1.8, this.effects.shake + v); }
  addScore(n) {
    this.player.stats.score = Math.max(0, this.player.stats.score + n);
    this.hud.score(this.player.stats);
  }
  damageEnemy(enemy, amount, head, source) { this.enemies.damage(enemy, amount, head, source); }
  onPlayerDeath() { this.allyTickets = Math.max(0, this.allyTickets - 5); this.hud.tickets(this.allyTickets, this.enemyTickets); }

  _syncProgression() {
    const p = this.save?.data?.progression;
    if (!p) return;
    this.hud.rank(this.save.rankName, p.xp, p.rank);
  }

  _refreshMenuProg() {
    const el = $('menu-prog');
    if (!el || !this.save) return;
    const p = this.save.data.progression;
    const open = (p.unlocked || []).map(weaponName).join(' · ');
    el.innerHTML =
      `RÜTBE <b>${this.save.rankName}</b> · XP <b>${p.xp}</b> · GALİBİYET <b>${p.wins}/${p.matches}</b> · EN İYİ SKOR <b>${p.bestScore || 0}</b>` +
      `<small>AÇIK SİLAHLAR · ${open}</small>`;
  }

  _drawFlare() {
    if (!this.flare) return;
    _fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const d = _fwd.dot(SUN_DIR);
    if (d <= .06) { this.flare.draw(0, 0, 0, 1); return; }
    _sp.copy(SUN_DIR).multiplyScalar(220).add(this.camera.position).project(this.camera);
    const sx = _sp.x * .5 + .5, sy = -_sp.y * .5 + .5;
    const off = Math.hypot(_sp.x, _sp.y);
    const edge = clamp(1.18 - off * .42, 0, 1);
    const daylight = this.sky?.sun ? clamp(this.sky.sun.intensity / 3.2, .12, 1) : 1;
    const weatherCut = this.weather?.mode === 'storm' ? .5 : this.weather?.mode === 'rain' ? .3 : this.weather?.mode === 'dust' ? .12 : 0;
    const vis = clamp((d - .06) / .45, 0, 1) * edge * daylight * (1 - weatherCut);
    this.flare.draw(sx, sy, vis, .75 + (this.weather?.flash || 0));
  }

  _waveLogic(dt) {
    if (!this.waveRunning) {
      this.intermission -= dt;
      this.hud.wave(this.wave, this.waveTotal, 1, `YENİ DALGA ${Math.max(0, Math.ceil(this.intermission))}s · İKMAL YAP`);
      if (this.intermission <= 0) {
        this.waveRunning = true;
        this.enemies.spawnWave(this.wave, this.settings.difficulty);
        this.waveTotal = this.enemies.waveTotal;
        this.hud.center('DALGA ' + this.wave, 'DÜŞMAN TEMASI · ' + this.waveTotal + ' TEMAS', 2.4);
        this.hud.kill('HQ', 'DALGA ' + this.wave, 'başladı');
        this.audio.radio();
      }
      return;
    }
    const rem = this.enemies.remaining();
    this.hud.wave(this.wave, this.waveTotal, rem, ' Aktif temas: ' + rem);
    if (rem <= 0) {
      this.waveRunning = false;
      this.addScore(500 * this.wave);
      if (this.wave >= 6 || this.enemyTickets <= 0) { this.end(true); return; }
      this.wave++;
      this.intermission = 11;
      this.hud.center('DALGA PÜSKÜRTÜLDÜ', 'İKMAL · ' + this.player.meds + ' İLK YARDIM / ' + this.player.nades + ' BOMBA', 3);
      this.player.meds = Math.min(3, this.player.meds + 1);
      this.player.nades = Math.min(5, this.player.nades + 2);
      this.player.syncHUD();
      this.audio.ui('confirm');
    }
  }

  _ticketLogic(dt) {
    const enemyOwned = this.world.capturePoints.filter(c => c.owner === 'enemy').length;
    const allyOwned = this.world.capturePoints.filter(c => c.owner === 'ally').length;
    if (enemyOwned > allyOwned) this.allyTickets -= dt * (enemyOwned - allyOwned) * (.55 + this.settings.difficulty * .16);
    if (enemyOwned === 3) this.allyTickets -= dt * .7;
    this.hud.tickets(this.allyTickets, this.enemyTickets);
    if (this.allyTickets <= 0) this.end(false);
    if (this.enemyTickets <= 0 && !this.waveRunning && this.wave >= 3) this.end(true);
  }

  // ------------------------------------------------------------------ loop
  _loop() {
    requestAnimationFrame(() => this._loop());
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, .05);

    this.engine.tick(dt, { t: this.elapsed += dt });

    // adaptive resolution guard
    if (rawDt > 0) {
      this.fpsAvg = damp(this.fpsAvg, 1 / rawDt, 2, dt);
      if (this.state === 'playing' && this.fpsAvg < 34) {
        this.lowFpsT += dt;
        if (this.lowFpsT > 4) {
          this.lowFpsT = 0;
          const pr = Math.max(.72, this.renderer.getPixelRatio() - .18);
          this.renderer.setPixelRatio(pr);
          this.post?.setSize(innerWidth, innerHeight, pr);
        }
      } else this.lowFpsT = 0;
    }
    // progression HUD refresh (cheap, throttled)
    this._progT += rawDt;
    if (this._progT > .5) { this._progT = 0; this._syncProgression(); }
    this.hud.fps(this.fpsAvg, this.elapsed);
    this.input.endFrame();
  }

  _menuCamera(t, dt) {
    const a = t * .055;
    const r = 105 + Math.sin(t * .12) * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = 27 + Math.sin(t * .18) * 6;
    this.camera.position.set(x, y, z);
    const look = new THREE.Vector3(Math.cos(a + 1.2) * 12, 5, Math.sin(a + 1.2) * 12);
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - 62) > .05) {
      this.camera.fov = damp(this.camera.fov, 62, 2, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}

window.addEventListener('error', (e) => console.error('[IRON HORIZON]', e.message));
new Game();
