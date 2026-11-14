import * as THREE from 'three';
import { AssetKit } from './assets.js';
import { clamp, damp, rand, shortestAngle } from './utils.js';
import { heightAt } from './world.js';

const _q = new THREE.Quaternion();

export class Vehicle {
  constructor(game) {
    this.game = game;
    this.root = game.assets.getRig('tank', ['Hull', 'Turret', 'Gun', 'RoofMG']);
    this.root.rotation.order = 'YXZ';
    this.turret = AssetKit.node(this.root, 'Turret');
    this.gun = AssetKit.node(this.root, 'Gun');
    this.roofMG = AssetKit.node(this.root, 'RoofMG');
    game.scene.add(this.root);

    this.position = new THREE.Vector3(4, 0, -54);
    this.hullYaw = Math.PI;
    this.turretYaw = 0;
    this.gunPitch = .03;
    this.speed = 0;
    this.hp = 1000; this.maxHp = 1000;
    this.destroyed = false;
    this.respawnT = 0;
    this.cooldown = 0;
    this.mgCooldown = 0;
    this.occupied = false;
    this.prompt = false;
    this._aimDir = new THREE.Vector3(0, 0, -1);
    this._camTarget = new THREE.Vector3();
    this.reset();
    game.hud.vehicle(false);
  }

  reset() {
    this.position.set(4, heightAt(4, -54), -54);
    this.hullYaw = Math.PI; this.turretYaw = 0; this.gunPitch = .03;
    this.speed = 0; this.hp = this.maxHp; this.destroyed = false;
    this.cooldown = 0; this.mgCooldown = 0; this.respawnT = 0;
    this.turretYaw = 0; this.gunPitch = .03;
    this.root.visible = true;
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.hullYaw, 0, 'YXZ');
  }

  checkInteract(player) {
    const d = Math.hypot(player.pos.x - this.position.x, player.pos.z - this.position.z);
    const show = !this.occupied && !this.destroyed && d < 6.5 && !player.dead;
    if (show !== this.prompt) {
      this.prompt = show;
      this.game.hud.interact(show, 'TANKA BİN');
    }
  }

  toggle() {
    if (this.occupied) this.exit();
    else if (this.prompt) this.enter();
  }

  enter() {
    const p = this.game.player;
    if (this.destroyed || p.dead) return;
    this.occupied = true;
    p.inVehicle = true;
    p.vmRoot.visible = false;
    this.game.audio.ui('confirm');
    this.game.audio.engine(true);
    this.game.hud.interact(false);
    this.game.hud.vehicle(true);
    this.game.hud.scope(false);
    this.game.hud.center('KALKAN-9 KONTROLDE', 'SOL TIK · ANA TOP   |   E · İN', 2.4);
    this.game.hud.kill('SİZ', 'KALKAN-9', 'komutayı aldı');
  }

  exit() {
    const p = this.game.player;
    this.occupied = false;
    p.inVehicle = false;
    p.vmRoot.visible = true;
    const side = new THREE.Vector3(-Math.cos(this.hullYaw), 0, Math.sin(this.hullYaw));
    const np = this.position.clone().addScaledVector(side, 3.6);
    p.pos.set(np.x, heightAt(np.x, np.z), np.z);
    p.vel.set(0, 0, 0); p.vy = 0;
    this.game.audio.engine(false);
    this.game.hud.vehicle(false);
    this.game.hud.center('ARAÇTAN İNİLDİ', '', 1.2);
    this.game.player.fov = 76;
  }

  takeDamage(amount) {
    if (!this.occupied || this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    this.game.hud.tank(this.hp / this.maxHp, this.speed, this.cooldown > 0 ? 'YÜKLENİYOR' : 'HAZIR');
    if (this.hp <= 0) this._destroy();
  }

  _destroy() {
    this.destroyed = true;
    this.game.effects.explosion(this.position.clone().add(new THREE.Vector3(0, 2, 0)), 2.2);
    this.game.audio.explosion(1.4);
    this.game.addShake(1.2);
    this.exit();
    this.root.visible = false;
    this.respawnT = 26;
    this.game.hud.center('KALKAN-9 İMHA EDİLDİ', 'YEDEK ARAÇ 26 SANİYE İÇİNDE', 3);
  }

  _aim() {
    this.root.updateMatrixWorld(true);
    if (this.gun) this._aimDir.set(0, 0, -1).applyQuaternion(this.gun.getWorldQuaternion(_q)).normalize();
    else this._aimDir.set(0, 0, -1);
    return this._aimDir;
  }

  muzzleWorld() {
    if (!this.gun) return this.position.clone().add(new THREE.Vector3(0, 2, 0));
    return this.gun.localToWorld(new THREE.Vector3(0, .02, -3.7));
  }

  fireMainGun() {
    if (this.cooldown > 0 || this.destroyed) return;
    this.cooldown = 3.4;
    const dir = this._aim().clone();
    const muzzle = this.muzzleWorld();
    this.game.effects.muzzleFlash(muzzle, dir, 3.2);
    this.game.effects._ring(muzzle, 2.4, 0xffd090);
    this.game.effects.shake = Math.min(1.6, this.game.effects.shake + .65);
    this.game.audio.shot('tank', 1.1, 0);
    this.game.addShake(.7);

    const ray = new THREE.Raycaster(muzzle, dir, .5, 400);
    const targets = this.game.enemies.hitboxes.concat(this.game.world.raycastMeshes);
    const hits = ray.intersectObjects(targets, false);
    const end = hits.length ? hits[0].point : muzzle.clone().addScaledVector(dir, 350);
    this.game.effects.tracer(muzzle, end, 0xfff0c0, 420);
    this.game.effects.explosion(end, 1.55);
    if (hits.length && hits[0].object.userData.destructible) {
      this.game.world.damageProp(hits[0].object, 220, this.game.player);
    }
    // shell casing smoke at the breech
    this.game.effects.smoke.spawn(muzzle, new THREE.Vector3(0, 2, 0), {
      color: [.36, .34, .31], size: 1.2, grow: 3.2, life: 2.4, alpha: .5, drag: .8,
    });
  }

  fireMG() {
    if (this.mgCooldown > 0 || this.destroyed) return;
    this.mgCooldown = .085;
    const dir = this._aim().clone();
    dir.x += rand(Math.random, -.018, .018);
    dir.y += rand(Math.random, -.018, .018);
    dir.z += rand(Math.random, -.018, .018);
    dir.normalize();
    const muzzle = this.muzzleWorld().add(new THREE.Vector3(.3, .1, 0));
    this.game.effects.muzzleFlash(muzzle, dir, .8);
    this.game.audio.enemyShot(6, 0);
    const ray = new THREE.Raycaster(muzzle, dir, .5, 240);
    const targets = this.game.enemies.hitboxes.concat(this.game.world.raycastMeshes);
    const hits = ray.intersectObjects(targets, false);
    const end = hits.length ? hits[0].point : muzzle.clone().addScaledVector(dir, 240);
    this.game.effects.tracer(muzzle, end, 0xffd090, 260);
    if (hits.length) {
      const e = hits[0].object.userData.enemy;
      if (e && e.alive) e.damage(26, !!hits[0].object.userData.head, this.game.player);
      else {
        this.game.effects.impact(hits[0].point, dir.clone().negate(), 'dirt');
        if (hits[0].object.userData.destructible) {
          this.game.world.damageProp(hits[0].object, 26, this.game.player);
        }
      }
    }
  }

  update(dt, t, input) {
    const g = this.game;
    if (this.destroyed) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.reset();
        g.hud.center('YEDEK KALKAN-9 SAHADA', '', 2);
        g.audio.radio();
      }
      return;
    }

    if (this.occupied) {
      const sens = g.settings.sensitivity * .0024;
      this.turretYaw -= input.mouse.dx * sens;
      this.gunPitch = clamp(this.gunPitch - input.mouse.dy * sens * .55, -.10, .42);
      const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      const steer = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
      const maxSpeed = throttle >= 0 ? 13 : -6;
      this.speed = damp(this.speed, throttle * maxSpeed, throttle ? 1.6 : 3.0, dt);
      if (Math.abs(this.speed) > .05) this.hullYaw += steer * dt * this.speed * .075;
      const fwd = new THREE.Vector3(-Math.sin(this.hullYaw), 0, -Math.cos(this.hullYaw));
      const np = this.position.clone().addScaledVector(fwd, this.speed * dt);
      np.y = heightAt(np.x, np.z);
      g.world.collide(np, 2.4, 2.6);
      this.position.copy(np);
      this.root.rotation.z = damp(this.root.rotation.z, -steer * .035 * Math.abs(this.speed) / 13, 5, dt);

      if (input.mouse.left) this.fireMainGun();
      if (input.mouse.right) this.fireMG();

      // third person chase camera
      const cam = g.player.camera;
      const back = new THREE.Vector3(Math.sin(this.hullYaw), 0, Math.cos(this.hullYaw));
      const want = this.position.clone().addScaledVector(back, 11.5).add(new THREE.Vector3(0, 5.4, 0));
      cam.position.lerp(want, 1 - Math.exp(-8 * dt));
      this._camTarget.copy(this.position).addScaledVector(fwd, 12).add(new THREE.Vector3(0, 2.2, 0));
      cam.lookAt(this._camTarget);
      g.player.fov = damp(g.player.fov, 70, 8, dt);
      if (Math.abs(cam.fov - g.player.fov) > .01) { cam.fov = g.player.fov; cam.updateProjectionMatrix(); }
      g.hud.interact(false);
      g.hud.crosshair(.35, false, false);
      g.hud.tank(this.hp / this.maxHp, Math.abs(this.speed) * 3.6, this.cooldown > 0 ? this.cooldown.toFixed(1) + 's' : 'HAZIR');
    } else {
      this.speed = damp(this.speed, 0, 2, dt);
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.mgCooldown = Math.max(0, this.mgCooldown - dt);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.hullYaw;
    if (this.turret) this.turret.rotation.y = this.turretYaw;
    if (this.gun) this.gun.rotation.x = this.gunPitch;
    if (this.roofMG) this.roofMG.rotation.y = Math.sin(t * .4) * .3;
  }
}
