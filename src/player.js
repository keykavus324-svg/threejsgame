import * as THREE from 'three';
import { clamp, damp, lerp, rand, TAU } from './utils.js';
import { heightAt } from './world.js';
import { WEAPONS, WEAPON_INDEX, CLASSES, CLASS_INDEX, availableSlots } from './systems/Loadout.js';
import { damageFalloff } from './engine/Physics.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Player {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, camera, world, assets, effects, audio, hud, game
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.pos = new THREE.Vector3(0, 0, -58);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.vy = 0; this.grounded = true;
    this.eye = 1.66; this.crouch = 0;
    this.stamina = 1;
    this.health = 100; this.maxHealth = 100;
    this.dead = false; this.deathTimer = 0;
    this.lastDamage = -100;
    this.bob = 0; this.stepAcc = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; this.spreadHeat = 0;
    this.roll = 0;
    this.inVehicle = false;
    this.slot = 0;
    this.slotWeapons = [WEAPON_INDEX.ar, WEAPON_INDEX.smg];
    this.classDef = CLASSES[0];
    this.speedMul = 1; this.reloadMul = 1; this.airMaxCooldown = 42;
    this.ammo = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }));
    this.reloading = false; this.reloadTimer = 0; this.reloadStage = 0;
    this.nextShot = 0;
    this.ads = 0; this.wantADS = false;
    this.meds = 3; this.nades = 4; this.airCooldown = 0; this.airCharges = 1;
    this.grenades = [];
    this.rockets = [];
    this.swayX = 0; this.swayY = 0;
    this.fov = 76;
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, score: 0 };

    this._resolveClass();
    this._buildViewmodel();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 500;
    this._center = new THREE.Vector2(0, 0);
    this._muzzleLocal = new THREE.Vector3(0, .012, -.54);
    this._ejectLocal = new THREE.Vector3(.045, .01, -.02);
    this.reset();
  }

  _resolveClass() {
    const save = this.game?.save;
    const classId = save?.data?.loadout?.class || 'assault';
    const cls = CLASSES[CLASS_INDEX[classId] ?? 0] || CLASSES[0];
    const prog = save?.data?.progression;
    this.classDef = cls;
    this.slotWeapons = availableSlots(cls, prog);
    this.speedMul = cls.speed || 1;
    this.reloadMul = cls.reload || 1;
    this.airMaxCooldown = cls.airCooldown || 42;
  }

  _buildViewmodel() {
    if (!this.vmRoot) {
      this.vmRoot = new THREE.Group();
      this.vmRoot.name = 'VIEWMODEL_ROOT';
      this.camera.add(this.vmRoot);
    }
    for (const w of this.vmWeapons || []) this.vmRoot.remove(w);
    this.vmWeapons = [];

    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1a1c19, roughness: .92, metalness: .05 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x3d3228, roughness: .9 });
    const mkHand = (parent, x, y, z, rot = 0) => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(.105, .09, .15), gloveMat);
      g.add(palm);
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(.026, .035, .075), gloveMat);
        f.position.set(-.034 + i * .034, -.012, -.085);
        f.rotation.x = -.3;
        g.add(f);
      }
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(.052, .058, .20, 8), skinMat);
      wrist.rotation.x = Math.PI / 2 + .25; wrist.position.set(0, -.01, .16);
      g.add(wrist);
      g.position.set(x, y, z); g.rotation.z = rot;
      parent.add(g);
      return g;
    };

    for (let i = 0; i < 2; i++) {
      const w = WEAPONS[this.slotWeapons[i] ?? i] || WEAPONS[0];
      const g = this.assets.get(w.model);
      g.scale.setScalar(w.vmScale || 1);
      g.traverse(o => {
        if (o.isMesh) {
          o.castShadow = false; o.receiveShadow = false;
          o.renderOrder = 12;
        }
      });
      mkHand(g, .015, -.115, .12, -.18);       // trigger hand
      mkHand(g, -.01, -.095, -.26, .28);      // support hand
      this.vmRoot.add(g);
      this.vmWeapons.push(g);
    }
    this.vmWeapons[1].visible = false;
  }

  reset() {
    this._resolveClass();
    this._buildViewmodel();
    this.pos.set(0, heightAt(0, -58), -58);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = -.03;
    this.health = 100; this.dead = false; this.stamina = 1;
    this.slot = 0; this.vmWeapons.forEach((w, i) => w.visible = i === 0);
    this.ammo = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }));
    this.meds = this.classDef.meds ?? 2; this.nades = this.classDef.nades ?? 3;
    this.airCharges = 1; this.airCooldown = 0;
    this.reloading = false; this.reloadTimer = 0; this.reloadStage = 0;
    this.nextShot = 0; this.recoilPitch = 0; this.recoilYaw = 0;
    this.spreadHeat = 0; this.vmKick = 0; this.ads = 0; this.wantADS = false;
    this.lastDamage = -100; this.deathTimer = 0; this.vy = 0; this.grounded = true;
    this.swayX = 0; this.swayY = 0; this.roll = 0; this.bob = 0; this.stepAcc = 0;
    this.fov = 76;
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, score: 0 };
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades.length = 0;
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets.length = 0;
    this.syncHUD();
  }

  get weapon() { return WEAPONS[this.slotWeapons[this.slot]]; }
  get weaponIndex() { return this.slotWeapons[this.slot]; }
  get ammoState() { return this.ammo[this.slotWeapons[this.slot]]; }

  syncHUD() {
    const w = this.weapon, a = this.ammoState;
    this.hud.ammo(a.mag, a.reserve, w, this.slot, this.reloading);
    this.hud.health(this.health, this.maxHealth);
    this.hud.stamina(this.stamina);
    this.hud.med(this.meds); this.hud.nade(this.nades);
    this.hud.air(this.airCharges > 0 ? 'HAZIR' : Math.ceil(this.airCooldown) + 's');
    this.hud.score(this.stats);
  }

  // ---------------------------------------------------------------- damage
  takeDamage(amount, fromPos) {
    if (this.dead || this.inVehicle || this.game.state !== 'playing') return;
    this.health = Math.max(0, this.health - amount);
    this.lastDamage = this.game.time;
    this.hud.health(this.health, this.maxHealth);
    this.hud.damageFlash();
    if (fromPos) {
      const dx = fromPos.x - this.pos.x, dz = fromPos.z - this.pos.z;
      const worldAngle = Math.atan2(dx, -dz);
      this.hud.damageArrow(worldAngle - this.yaw);
    }
    this.audio.impact('flesh');
    if (this.health <= 0) this._die();
  }

  _die() {
    this.dead = true; this.deathTimer = 3.2;
    this.hud.center('MUHARİP KAYBEDİLDİ', 'YENİDEN KONUŞLANDIRILIYOR…', 3);
    this.hud.kill('SİSTEM', 'SİZ', 'öldü');
    this.game.onPlayerDeath();
    this.audio.explosion(.35);
    this.game.bus?.emit?.('player:death', { pos: this.pos.clone() });
  }

  respawn() {
    const sp = this.game.world.allySpawnPoints[Math.floor(Math.random() * this.game.world.allySpawnPoints.length)];
    this.pos.set(sp.x, heightAt(sp.x, sp.z), sp.z);
    this.vel.set(0, 0, 0); this.vy = 0;
    this.health = 100; this.dead = false; this.stamina = 1;
    for (let i = 0; i < WEAPONS.length; i++) {
      const a = this.ammo[i];
      a.mag = WEAPONS[i].mag;
      a.reserve = Math.max(a.reserve, Math.floor(WEAPONS[i].reserve * .45));
    }
    this.meds = Math.max(1, this.meds); this.nades = Math.max(2, this.nades);
    this.hud.center('KONUŞLANDIRILDI', 'BÖLGEYİ GERİ AL', 1.6);
    this.syncHUD();
  }

  heal() {
    if (this.dead || this.meds <= 0 || this.health >= 100) return;
    this.meds--;
    this.health = Math.min(100, this.health + 55);
    this.hud.healFlash(); this.hud.med(this.meds); this.hud.health(this.health, this.maxHealth);
    this.audio.ui('confirm');
  }

  // ---------------------------------------------------------------- actions
  switchSlot(i) {
    if (this.reloading) this.reloading = false;
    this.slot = i;
    this.vmWeapons.forEach((w, k) => w.visible = k === i);
    this.nextShot = this.game.time + .25;
    this.audio.reload(2);
    this.syncHUD();
    this.hud.reloading(false);
  }

  reload() {
    const a = this.ammoState;
    if (this.reloading || a.mag >= this.weapon.mag || a.reserve <= 0 || this.dead) return;
    this.reloading = true;
    this.reloadTimer = this.weapon.reloadTime * this.reloadMul;
    this.reloadStage = 0;
    this.audio.reload(0);
    this.hud.reloading(true);
  }

  _finishReload() {
    const a = this.ammoState, w = this.weapon;
    const need = w.mag - a.mag, take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
    this.reloading = false;
    this.hud.reloading(false);
    this.syncHUD();
  }

  throwGrenade() {
    if (this.nades <= 0 || this.dead) return;
    this.nades--; this.hud.nade(this.nades);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(.11, 1),
      new THREE.MeshStandardMaterial({ color: 0x2d3427, roughness: .75, metalness: .35 })
    );
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const start = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, .6);
    mesh.position.copy(start);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.grenades.push({ mesh, vel: dir.multiplyScalar(19).add(new THREE.Vector3(0, 6, 0)), fuse: 2.35, spin: rand(Math.random, -8, 8) });
    this.audio.reload(3);
  }

  callAirstrike() {
    if (this.airCharges <= 0 || this.dead) { this.audio.ui(); return; }
    this.airCharges = 0; this.airCooldown = this.airMaxCooldown;
    this.hud.air(Math.ceil(this.airCooldown) + 's');
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(this.camera.getWorldPosition(new THREE.Vector3()), dir);
    const hits = this.raycaster.intersectObjects(this.world.raycastMeshes, false);
    let target = hits.length ? hits[0].point : this.pos.clone().addScaledVector(dir, 60);
    target.y = heightAt(target.x, target.z) + .3;
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.effects.airstrike(target, flat, 7);
    this.audio.radio();
    this.hud.center('HAVA DESTEĞİ ONAYLANDI', 'HEDEF İŞARETLENDİ · ÇEKİL', 2.2);
    this.hud.kill('HQ', 'F/A-18', 'görevde');
  }

  _spawnRocket(muzzle, dir, w) {
    let mesh;
    try { mesh = this.assets.get('rocket'); } catch { mesh = null; }
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(.06, .06, .75, 8),
        new THREE.MeshStandardMaterial({ color: 0x6a6a5a, roughness: .5, metalness: .6 })
      );
      mesh.rotation.x = Math.PI / 2;
    }
    mesh.position.copy(muzzle);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.rockets.push({
      mesh, vel: dir.clone().multiplyScalar(w.rocketSpeed || 48),
      life: 6, power: w.rocketPower || 1.25, prev: muzzle.clone(),
    });
  }

  fire() {
    const w = this.weapon, a = this.ammoState, now = this.game.time;
    if (this.dead || this.reloading || this.inVehicle || now < this.nextShot) return;
    if (a.mag <= 0) {
      this.audio.dryFire();
      this.nextShot = now + .25;
      this.reload();
      return;
    }
    this.nextShot = now + 60 / w.rpm;
    a.mag--;
    this.stats.shots++;
    this.audio.shot(w.sound || (w.id === 'dmr' ? 'dmr' : 'rifle'), 1, 0);

    // camera / viewmodel recoil
    this.recoilPitch += w.recoil * (1 - this.ads * .45);
    this.recoilYaw += (Math.random() - .5) * w.recoil * .85;
    this.spreadHeat = Math.min(1, this.spreadHeat + (w.auto ? .16 : .34));
    this.vmKick = Math.min(.16, (this.vmKick || 0) + w.kick);
    this.game.addShake(.035 * (w.id === 'dmr' || w.rocket ? 2 : 1));

    // muzzle in world space
    const vm = this.vmWeapons[this.slot];
    this.camera.updateMatrixWorld(true);
    this.vmRoot.updateMatrixWorld(true);
    const muzzleLocal = new THREE.Vector3(...(w.muzzle || [0, .012, -.56]));
    const muzzle = vm.localToWorld(muzzleLocal.clone());
    const eject = vm.localToWorld(this._ejectLocal.clone());
    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ);
    this.effects.muzzleFlash(muzzle, fwd, w.id === 'dmr' ? 1.3 : w.rocket ? 2.2 : 1);
    this.effects.shellCasing(eject, fwd);

    if (w.rocket) {
      this._spawnRocket(muzzle, fwd, w);
      this.syncHUD();
      return;
    }

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      // ray with spread
      const spread = lerp(w.spread, w.spreadADS, this.ads) * (1 + this.spreadHeat * 2.6);
      const dir = fwd.clone();
      dir.x += (Math.random() - .5) * spread * 2;
      dir.y += (Math.random() - .5) * spread * 2;
      dir.z += (Math.random() - .5) * spread * 2;
      dir.normalize();
      this.raycaster.set(origin, dir);
      this.raycaster.far = w.range;
      const targets = this.game.enemies.hitboxes.concat(this.world.raycastMeshes);
      const hits = this.raycaster.intersectObjects(targets, false);
      const hit = hits.find(h => h.distance > .4);
      const end = hit ? hit.point : origin.clone().addScaledVector(dir, w.range);
      this.effects.tracer(muzzle, end, w.id === 'dmr' ? 0xffd9a0 : 0xffc478, 260);

      if (hit) {
        const enemy = hit.object.userData.enemy;
        if (enemy && enemy.alive) {
          const head = !!hit.object.userData.head;
          this.stats.hits++;
          const fall = damageFalloff(hit.distance, w.range);
          this.game.damageEnemy(enemy, w.damage * (head ? 2.3 : 1) * fall, head, this);
          if (this.classDef.spot) enemy.spotted = 6;
          this.effects.impact(hit.point, dir.clone().negate(), 'flesh');
          this.audio.hit(head);
          this.hud.hitmarker(enemy.health <= 0);
          if (w.suppression) this.game.enemies.suppress?.(hit.point, 9, w.suppression);
        } else {
          const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          this.effects.impact(hit.point, n, hit.object.userData.metal ? 'metal' : 'dirt');
          this.audio.impact(hit.object.userData.metal ? 'metal' : 'dirt');
          if (hit.object.userData.destructible) {
            this.world.damageProp(hit.object, w.damage * 1.2, this);
          }
          if (w.suppression) this.game.enemies.suppress?.(hit.point, 9, w.suppression);
        }
      }
    }
    this.syncHUD();
  }

  // ---------------------------------------------------------------- update
  update(dt, t, input) {
    if (this.dead) {
      this.deathTimer -= dt;
      this.camera.position.set(this.pos.x, this.pos.y + .35, this.pos.z);
      this.camera.rotation.set(-.35, this.yaw, .28, 'YXZ');
      this.vmRoot.visible = false;
      if (this.deathTimer <= 0) { this.vmRoot.visible = true; this.respawn(); }
      return;
    }
    if (this.inVehicle) {
      this.vmRoot.visible = false;
      this._updateGrenades(dt);
      this._updateRockets(dt);
      return;
    }
    this.vmRoot.visible = true;

    // ---- look
    const sens = this.game.settings.sensitivity * .0021;
    this.yaw -= input.mouse.dx * sens;
    this.pitch -= input.mouse.dy * sens;
    this.pitch = clamp(this.pitch, -1.48, 1.48);
    this.swayX = damp(this.swayX, clamp(-input.mouse.dx * .00035, -.05, .05), 9, dt);
    this.swayY = damp(this.swayY, clamp(-input.mouse.dy * .00035, -.05, .05), 9, dt);

    // ---- movement intent
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    this.wantADS = input.mouse.right && !this.reloading;
    const adsMul = this.classDef.adsSpeed || 1;
    this.ads = damp(this.ads, this.wantADS ? 1 : 0, 13 * adsMul, dt);
    const crouching = input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC');
    this.crouch = damp(this.crouch, crouching ? 1 : 0, 10, dt);
    const sprinting = input.down('ShiftLeft') && f > 0 && !this.wantADS && !crouching && this.stamina > .04;
    const targetSpeed = (crouching ? 3.1 : this.wantADS ? 3.7 : sprinting ? 9.9 : 6.3) * (this.game.settings.speed || 1) * this.speedMul;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * f + rx * s, wz = fz * f + rz * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = this.grounded ? 13 : 3.2;
    this.vel.x = damp(this.vel.x, wx * targetSpeed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * targetSpeed, accel, dt);

    if (sprinting) this.stamina = Math.max(0, this.stamina - dt * .22);
    else this.stamina = Math.min(1, this.stamina + dt * .16);

    // jump / gravity
    if (input.consume('Space') && this.grounded) {
      this.vy = 6.6; this.grounded = false; this.audio.footstep(true);
    }
    this.vy -= 19.5 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    const ground = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; this.grounded = true; }
    else this.grounded = false;
    this.world.collide(this.pos, .43, 1.75);

    // footsteps + bob
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * speed * 1.35;
    this.stepAcc += dt * speed;
    if (this.grounded && speed > 1.2 && this.stepAcc > (sprinting ? 2.05 : 2.55)) {
      this.stepAcc = 0; this.audio.footstep(sprinting);
    }
    const bobY = Math.sin(this.bob * 2) * .033 * Math.min(1, speed / 6) * (1 - this.ads * .8);
    const bobX = Math.cos(this.bob) * .026 * Math.min(1, speed / 6) * (1 - this.ads * .8);
    this.eye = damp(this.eye, 1.66 - this.crouch * .55, 10, dt);

    // recoil recovery
    this.recoilPitch = damp(this.recoilPitch, 0, 7.5, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 7.5, dt);
    this.spreadHeat = Math.max(0, this.spreadHeat - dt * (this.weapon.auto ? 1.7 : 1.1));
    this.vmKick = damp(this.vmKick || 0, 0, 11, dt);
    this.roll = damp(this.roll, -s * .022 + this.swayX * .4, 8, dt);

    const shake = this.game.shake;
    this.camera.position.set(
      this.pos.x + bobX + (Math.random() - .5) * shake * .12,
      this.pos.y + this.eye + bobY + (Math.random() - .5) * shake * .12,
      this.pos.z
    );
    this.camera.rotation.set(
      this.pitch + this.recoilPitch + (Math.random() - .5) * shake * .02,
      this.yaw + this.recoilYaw + (Math.random() - .5) * shake * .02,
      this.roll, 'YXZ'
    );
    const targetFov = lerp(76, this.weapon.adsFov, this.ads);
    this.fov = damp(this.fov, targetFov, 12, dt);
    if (Math.abs(this.camera.fov - this.fov) > .01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    const scoped = !!this.weapon.scope && this.ads > .82;
    this.hud.scope(scoped);
    this.hud.crosshair(this.spreadHeat, scoped, this.wantADS);

    // ---- viewmodel animation
    const vm = this.vmWeapons[this.slot];
    const hip = new THREE.Vector3(.185 - this.slot * .02, -.215, -.56);
    const aim = new THREE.Vector3(0, -.135, -.42);
    const base = hip.clone().lerp(aim, this.ads);
    base.x += this.swayX * (1 - this.ads * .8) + bobX * .6;
    base.y += this.swayY * (1 - this.ads * .8) + bobY * .8 + Math.sin(this.bob * 2) * .006;
    base.z += (this.vmKick || 0) * .55;
    if (sprinting) { base.y -= .14; base.z += .05; }
    vm.position.copy(base);
    const sprintTilt = sprinting ? .55 : 0;
    vm.rotation.set(
      -.02 + (this.vmKick || 0) * .9 + sprintTilt * .35 + this.swayY * 1.2,
      -.04 + this.swayX * 1.5 + sprintTilt * .5 + (1 - this.ads) * .035,
      -.025 + sprintTilt * .3 + this.roll * .6,
    );
    // reload animation: dip + roll + bolt pull
    if (this.reloading) {
      const u = 1 - this.reloadTimer / (this.weapon.reloadTime * this.reloadMul);
      const dip = Math.sin(u * Math.PI);
      vm.position.y -= dip * .18;
      vm.position.z += dip * .1;
      vm.rotation.x += dip * .45;
      vm.rotation.z -= dip * .38;
    }

    // ---- actions
    if (input.consume('KeyR')) this.reload();
    if (input.consume('Digit1') && this.slot !== 0) this.switchSlot(0);
    if (input.consume('Digit2') && this.slot !== 1) this.switchSlot(1);
    if (input.mouse.wheel !== 0) this.switchSlot(this.slot === 0 ? 1 : 0);
    if (input.consume('KeyG')) this.throwGrenade();
    if (input.consume('KeyQ')) this.callAirstrike();
    if (input.consume('KeyF')) this.heal();
    if (this.reloading) {
      this.reloadTimer -= dt;
      const stage = Math.floor((1 - this.reloadTimer / (this.weapon.reloadTime * this.reloadMul)) * 3);
      if (stage !== this.reloadStage) { this.reloadStage = stage; this.audio.reload(stage); }
      if (this.reloadTimer <= 0) this._finishReload();
    }
    if (this.weapon.auto ? input.mouse.left : (input.mouse.leftDown || input.mouse.left)) {
      if (this.weapon.auto || input.mouse.leftDown) this.fire();
    }
    this.airCooldown -= dt;
    if (this.airCooldown <= 0 && this.airCharges === 0) { this.airCharges = 1; this.hud.air('HAZIR'); this.audio.radio(); }
    else if (this.airCooldown > 0) this.hud.air(Math.ceil(this.airCooldown) + 's');

    // regeneration
    if (t - this.lastDamage > 7 && this.health < 100) {
      this.health = Math.min(100, this.health + dt * 7);
      this.hud.health(this.health, this.maxHealth);
    }
    this._updateGrenades(dt);
    this._updateRockets(dt);
    this.hud.stamina(this.stamina);
    this.game.vehicle?.checkInteract(this);
  }

  _updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 19 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += g.spin * dt; g.mesh.rotation.z += g.spin * .6 * dt;
      const gy = heightAt(g.mesh.position.x, g.mesh.position.z) + .11;
      if (g.mesh.position.y < gy) {
        g.mesh.position.y = gy;
        g.vel.y = Math.abs(g.vel.y) * .42;
        g.vel.x *= .62; g.vel.z *= .62;
      }
      if (g.fuse <= 0) {
        this.effects.grenadeBlast(g.mesh.position.clone());
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  _updateRockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.prev.copy(r.mesh.position);
      // slight gravity drop + wind drift
      r.vel.y -= 2.2 * dt;
      if (this.game.weather) {
        r.vel.x += this.game.weather.windDir.x * this.game.weather.gust * .02 * dt;
        r.vel.z += this.game.weather.windDir.y * this.game.weather.gust * .02 * dt;
      }
      r.mesh.position.addScaledVector(r.vel, dt);
      const dir = r.vel.clone().normalize();
      r.mesh.lookAt(r.mesh.position.clone().add(dir));
      this.effects.smoke.spawn(r.mesh.position, new THREE.Vector3(0, .4, 0), {
        color: [.55, .52, .48], size: .5, grow: 1.2, life: .7, alpha: .4, drag: .6,
      });

      let boom = r.life <= 0;
      const gy = heightAt(r.mesh.position.x, r.mesh.position.z) + .12;
      if (r.mesh.position.y <= gy) { r.mesh.position.y = gy; boom = true; }
      if (!boom) {
        const seg = r.mesh.position.clone().sub(r.prev);
        const len = seg.length();
        if (len > .01) {
          seg.normalize();
          this.raycaster.set(r.prev, seg);
          this.raycaster.far = len + .5;
          const targets = this.game.enemies.hitboxes.concat(this.world.raycastMeshes);
          const hits = this.raycaster.intersectObjects(targets, false);
          if (hits.length && hits[0].distance > .1) {
            r.mesh.position.copy(hits[0].point);
            boom = true;
          }
        }
      }
      if (boom) {
        const pos = r.mesh.position.clone();
        this.effects.explosion(pos, r.power);
        this.game.enemies.damageInRadius(pos, 9 * r.power, 150 * r.power);
        this.world.damagePropsInRadius(pos, 7, 200, this);
        const pd = Math.hypot(this.pos.x - pos.x, this.pos.z - pos.z);
        if (pd < 4 && !this.inVehicle) this.takeDamage(30 * (1 - pd / 4), pos);
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
  }
}
