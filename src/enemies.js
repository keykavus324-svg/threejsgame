import * as THREE from 'three';
import { AssetKit } from './assets.js';
import { clamp, damp, lerp, rand, randInt, TAU, shortestAngle } from './utils.js';
import { heightAt } from './world.js';

const PIVOTS = ['Hips', 'Torso', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR', 'Weapon'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

class Unit {
  constructor(mgr, faction, pos, heavy = false) {
    this.mgr = mgr;
    const game = mgr.game;
    this.faction = faction;
    this.heavy = heavy;
    this.alive = true;
    this.maxHealth = faction === 'enemy' ? (heavy ? 260 : 100) : 120;
    this.health = this.maxHealth;
    this.speed = faction === 'enemy' ? (heavy ? 2.15 : 3.15 + Math.random() * .9) : 3.35;
    this.phase = Math.random() * TAU;
    this.fireTimer = 1.2 + Math.random() * 2.2;
    this.losTimer = Math.random() * .4;
    this.hasLOS = false;
    this.deathT = 0;
    this.corpseT = 0;
    this.strafeDir = Math.random() > .5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.state = 'advance';
    this.path = []; this.pathIdx = 0; this.pathT = Math.random() * .5;
    this.suppressed = 0; this.spotted = 0;
    this.coverGoal = null; this.coverT = 0;
    this.vel = new THREE.Vector3();
    this.pos = pos.clone();
    this.yaw = Math.random() * TAU;

    this.root = game.assets.getRig(faction === 'enemy' ? 'soldier_enemy' : 'soldier_ally', PIVOTS);
    this.root.rotation.order = 'YXZ';
    if (heavy) this.root.scale.setScalar(1.16);
    this.root.position.copy(this.pos);
    game.scene.add(this.root);
    this.p = {};
    for (const n of PIVOTS) this.p[n] = AssetKit.node(this.root, n);
    if (heavy && this.p.Torso) {
      // armored plate silhouette
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(.52, .42, .14),
        new THREE.MeshStandardMaterial({ color: 0x353a31, roughness: .65, metalness: .4 })
      );
      plate.position.set(0, .16, -.24); plate.castShadow = true;
      this.p.Torso.add(plate);
    }

    // invisible collision / hit proxies
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    this.bodyHit = new THREE.Mesh(new THREE.BoxGeometry(.66, 1.16, .46), invisible);
    this.bodyHit.position.y = 1.02;
    this.bodyHit.userData.enemy = this;
    this.headHit = new THREE.Mesh(new THREE.BoxGeometry(.34, .34, .34), invisible);
    this.headHit.position.y = 1.70;
    this.headHit.userData.enemy = this;
    this.headHit.userData.head = true;
    this.root.add(this.bodyHit, this.headHit);
    if (faction === 'enemy') mgr.hitboxes.push(this.bodyHit, this.headHit);
  }

  eye() { return _v.set(this.pos.x, this.pos.y + 1.55, this.pos.z); }

  damage(amount, head = false, source = null) {
    if (!this.alive) return;
    if (this.faction !== 'enemy') {
      this.mgr.game.hud.center('DOST ATEŞİ!', 'MÜTTEFİK KUVVETLERE ATEŞ ETME', 1.2);
      this.mgr.game.addScore(-25);
      return;
    }
    if (this.spotted > 0) amount *= 1.15;
    this.health -= amount;
    this.mgr.game.effects.impact(
      new THREE.Vector3(this.pos.x, this.pos.y + (head ? 1.7 : 1.2), this.pos.z),
      new THREE.Vector3(0, .4, 1), 'flesh'
    );
    if (this.health <= 0) this.die(head, source);
  }

  die(head, source) {
    this.alive = false;
    this.deathT = 0;
    this.mgr.game.effects.impact(
      new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z), new THREE.Vector3(0, 1, 0), 'flesh'
    );
    this.mgr.hitboxes = this.mgr.hitboxes.filter(h => h !== this.bodyHit && h !== this.headHit);
    this.root.remove(this.bodyHit, this.headHit);
    if (this.faction === 'enemy') {
      const g = this.mgr.game;
      const pts = this.heavy ? 320 : (head ? 165 : 110);
      g.addScore(pts);
      if (source === g.player) {
        g.player.stats.kills++;
        if (head) g.player.stats.headshots++;
      }
      g.hud.kill('SİZ', this.heavy ? 'AĞIR MUHARİP' : 'DÜŞMAN', head ? 'kafa' : 'öldürüldü');
      g.enemyTickets = Math.max(0, g.enemyTickets - (this.heavy ? 2 : 1));
      g.audio.ui(head ? 'confirm' : 'click');
      g.bus?.emit?.('enemy:killed', { unit: this, head, source, points: pts });
    } else {
      this.mgr.game.hud.kill('DÜŞMAN', 'MÜTTEFİK', 'öldürdü');
    }
  }

  update(dt, t) {
    const g = this.mgr.game;
    if (!this.alive) {
      this.deathT += dt;
      this.corpseT += dt;
      const f = clamp(this.deathT / .8, 0, 1);
      this.root.rotation.x = (this.heavy ? 1.35 : 1.5) * (1 - Math.pow(1 - f, 3)) * this.strafeDir;
      this.root.position.y = this.pos.y - f * .12;
      if (this.p.ArmL) this.p.ArmL.rotation.x = damp(this.p.ArmL.rotation.x, .4, 4, dt);
      if (this.p.ArmR) this.p.ArmR.rotation.x = damp(this.p.ArmR.rotation.x, .4, 4, dt);
      return this.corpseT > 16;
    }

    const player = g.player;
    const targetPos = player.inVehicle ? g.vehicle.position : player.pos;
    const dx = targetPos.x - this.pos.x, dz = targetPos.z - this.pos.z;
    const distPlayer = Math.hypot(dx, dz);

    // choose goal: engage the player if close, otherwise push an objective
    let goal;
    if (this.faction === 'enemy') {
      if (distPlayer < 52) goal = targetPos;
      else {
        const cps = g.world.capturePoints;
        const cp = cps[randInt(Math.random, 0, cps.length - 1)];
        goal = cp.pos;
        if (distPlayer < 75 && Math.random() < .01) goal = targetPos;
      }
    } else {
      const foe = this.mgr.nearestEnemy(this.pos, 90);
      goal = foe ? foe.pos : (Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) > 20 ? player.pos : this.pos);
    }

    this.suppressed = Math.max(0, this.suppressed - dt);
    this.spotted = Math.max(0, this.spotted - dt);

    // line of sight (throttled) — Physics raycast when available
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = .35 + Math.random() * .25;
      const origin = this.eye().clone();
      const aim = new THREE.Vector3(targetPos.x, targetPos.y + 1.4, targetPos.z);
      if (g.physics?.lineOfSight) {
        this.hasLOS = g.physics.lineOfSight(origin, aim, 1.5);
      } else {
        const dir = aim.clone().sub(origin);
        const len = dir.length(); dir.normalize();
        const ray = new THREE.Raycaster(origin, dir, 1, len + 2);
        const hits = ray.intersectObjects(g.world.raycastMeshes, false);
        this.hasLOS = !hits.some(h => h.distance < len - 1.5);
      }
    }

    const engage = this.hasLOS && distPlayer < (this.faction === 'enemy' ? 68 : 70) && !player.dead;
    this.state = engage ? 'engage' : 'advance';
    let wishX = 0, wishZ = 0, spd = this.speed * (this.suppressed > 0 ? .55 : 1);
    const gdx = goal.x - this.pos.x, gdz = goal.z - this.pos.z;
    const gd = Math.hypot(gdx, gdz) || 1;

    if (engage) {
      const nx = dx / (distPlayer || 1), nz = dz / (distPlayer || 1);
      if (distPlayer > 30) { wishX += nx * .8; wishZ += nz * .8; }
      else if (distPlayer < 15) { wishX -= nx * .9; wishZ -= nz * .9; }
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeTimer = 1.2 + Math.random() * 2.2; this.strafeDir *= -1; }
      wishX += -nz * this.strafeDir * .72;
      wishZ += nx * this.strafeDir * .72;
      spd *= .72;
      // face the player
      const wantYaw = Math.atan2(dx, dz);
      this.yaw += shortestAngle(wantYaw - this.yaw) * Math.min(1, dt * 5);
    } else {
      // NavGrid path following when advancing (A* + string pulling)
      if (g.nav) {
        this.pathT -= dt;
        if (this.pathT <= 0 || this.pathIdx >= this.path.length) {
          this.pathT = .7 + Math.random() * .6;
          try { this.path = g.nav.findPath(this.pos, goal) || []; } catch { this.path = []; }
          this.pathIdx = 0;
        }
        while (this.pathIdx < this.path.length) {
          const wp = this.path[this.pathIdx];
          if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 2.6) this.pathIdx++;
          else break;
        }
        const wp = this.path[this.pathIdx];
        if (wp) {
          const wx = wp.x - this.pos.x, wz = wp.z - this.pos.z;
          const wl = Math.hypot(wx, wz) || 1;
          wishX = wx / wl; wishZ = wz / wl;
        } else {
          wishX = gdx / gd; wishZ = gdz / gd;
        }
      } else {
        wishX = gdx / gd; wishZ = gdz / gd;
      }
      const wantYaw = Math.atan2(wishX, wishZ);
      this.yaw += shortestAngle(wantYaw - this.yaw) * Math.min(1, dt * 4);
    }

    // seek cover when suppressed / under close fire
    if (this.coverT > 0) {
      this.coverT -= dt;
      if (this.coverGoal) {
        const cx = this.coverGoal.x - this.pos.x, cz = this.coverGoal.z - this.pos.z;
        const cl = Math.hypot(cx, cz) || 1;
        wishX = cx / cl; wishZ = cz / cl;
        spd *= .9;
        if (cl < 1.2) this.coverT = 0;
      }
    } else if (engage && distPlayer < 32 && Math.random() < .004 && g.nav) {
      const cover = g.nav.nearestCover(this.pos, targetPos, 26);
      if (cover) { this.coverGoal = cover.pos; this.coverT = 2.2; }
    }

    // separation
    for (const other of this.mgr.units) {
      if (other === this || !other.alive) continue;
      const ox = this.pos.x - other.pos.x, oz = this.pos.z - other.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 3.2 && d2 > .0001) {
        const d = Math.sqrt(d2);
        wishX += ox / d * (1 - d / 1.8) * .8;
        wishZ += oz / d * (1 - d / 1.8) * .8;
      }
    }
    const wl = Math.hypot(wishX, wishZ) || 1;
    this.vel.x = damp(this.vel.x, wishX / wl * spd, 5, dt);
    this.vel.z = damp(this.vel.z, wishZ / wl * spd, 5, dt);
    if (g.physics?.move) {
      g.physics.move(this.pos, this.vel, dt, .4, 1.8);
    } else {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = heightAt(this.pos.x, this.pos.z);
      g.world.collide(this.pos, .4, 1.8);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    // animation
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (2.1 + speed * 1.9);
    const sw = Math.sin(this.phase) * clamp(speed / 3.2, 0, 1) * .58;
    if (this.p.LegL) this.p.LegL.rotation.x = sw;
    if (this.p.LegR) this.p.LegR.rotation.x = -sw;
    const aimArm = engage ? -1.12 : -.28;
    if (this.p.ArmL) this.p.ArmL.rotation.x = damp(this.p.ArmL.rotation.x, aimArm - sw * .3, 8, dt);
    if (this.p.ArmR) this.p.ArmR.rotation.x = damp(this.p.ArmR.rotation.x, aimArm + sw * .3, 8, dt);
    if (this.p.Torso) this.p.Torso.rotation.y = Math.sin(t * .8 + this.phase) * .045;
    if (this.p.Head && engage) this.p.Head.rotation.x = damp(this.p.Head.rotation.x, .12, 5, dt);
    this.root.updateMatrixWorld(true);

    // shooting
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && engage) {
      const diff = g.settings.difficulty;
      const base = this.faction === 'ally' ? 1.35 : (this.heavy ? 1.35 : 1.85);
      this.fireTimer = base * (1 - diff * .12) * (.7 + Math.random() * .8);
      this._shoot(targetPos, distPlayer);
    }
    return false;
  }

  _shoot(targetPos, dist) {
    const g = this.mgr.game;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const muzzle = new THREE.Vector3(this.pos.x + fx * .65, this.pos.y + 1.42, this.pos.z + fz * .65);
    const diff = g.settings.difficulty;
    const accuracy = clamp(
      ((this.faction === 'ally' ? .62 : .30 + diff * .13) * (1 - dist / 190) + (this.heavy ? .08 : 0)) * (this.suppressed > 0 ? .5 : 1),
      .06, .82
    );
    const aim = new THREE.Vector3(
      targetPos.x + rand(Math.random, -.7, .7),
      targetPos.y + 1.35 + rand(Math.random, -.4, .4),
      targetPos.z + rand(Math.random, -.7, .7)
    );
    const hitPoint = aim.clone().add(new THREE.Vector3(
      rand(Math.random, -1.6, 1.6), rand(Math.random, -1.4, 1.4), rand(Math.random, -1.6, 1.6)
    ));
    const color = this.faction === 'ally' ? 0x9fd8ff : 0xff7a45;
    g.effects.tracer(muzzle, hitPoint, color, 190);
    g.effects.muzzleFlash(muzzle, new THREE.Vector3(fx, .05, fz), .7);
    const pan = clamp((this.pos.x - g.player.pos.x) / 60, -1, 1);
    g.audio.enemyShot(dist, pan);

    if (this.faction === 'enemy') {
      if (Math.random() < accuracy && !g.player.inVehicle && !g.player.dead) {
        g.player.takeDamage(this.heavy ? 15 + diff * 3 : 8 + diff * 3, this.pos);
        g.audio.whizz();
      } else if (Math.random() < .45) {
        g.audio.whizz();
      }
      if (g.player.inVehicle && Math.random() < accuracy * .6) g.vehicle.takeDamage(this.heavy ? 8 : 3);
    } else {
      const foe = this.mgr.nearestEnemy(this.pos, 85);
      if (foe && Math.random() < accuracy * .85) foe.damage(24 + Math.random() * 20, false, null);
    }
  }

  dispose(game) {
    game.scene.remove(this.root);
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.units = [];
    this.hitboxes = [];
    this.pending = [];
    this.waveTotal = 0;
    this.allyRespawn = [];
  }

  remaining() { return this.pending.length + this.units.filter(u => u.alive && u.faction === 'enemy').length; }

  spawnAllies() {
    const g = this.game;
    for (let i = 0; i < 3; i++) {
      const p = g.world.allySpawnPoints[i % g.world.allySpawnPoints.length];
      this.units.push(new Unit(this, 'ally', new THREE.Vector3(p.x + rand(Math.random, -3, 3), 0, p.z + rand(Math.random, -3, 3))));
    }
  }

  spawnWave(wave, difficulty) {
    const count = 7 + wave * 3 + difficulty * 3;
    this.waveTotal = count;
    this.pending = [];
    for (let i = 0; i < count; i++) {
      const sp = this.game.world.spawnPoints[randInt(Math.random, 0, this.game.world.spawnPoints.length - 1)];
      const a = rand(Math.random, -.25, .25);
      const pos = new THREE.Vector3(sp.x + Math.cos(a) * 8, 0, sp.z + Math.sin(a) * 8);
      pos.y = heightAt(pos.x, pos.z);
      this.pending.push({
        t: i * (wave > 3 ? .55 : .85),
        pos,
        heavy: wave >= 4 && i % 7 === 3,
      });
    }
    // reinforce allies every other wave
    if (wave % 2 === 0) {
      const aliveAllies = this.units.filter(u => u.alive && u.faction === 'ally').length;
      for (let i = aliveAllies; i < 3; i++) {
        const p = this.game.world.allySpawnPoints[i];
        this.pending.push({ t: 2 + i, pos: new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z), ally: true });
      }
    }
  }

  nearestEnemy(pos, maxDist = 999) {
    if (this.game.spatial) {
      const u = this.game.spatial.nearest(pos.x, pos.z, maxDist, x => x.alive && x.faction === 'enemy');
      if (u) return u;
    }
    let best = null, bd = maxDist;
    for (const u of this.units) {
      if (!u.alive || u.faction !== 'enemy') continue;
      const d = Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  nearestAlly(pos, maxDist = 999) {
    if (this.game.spatial) {
      const u = this.game.spatial.nearest(pos.x, pos.z, maxDist, x => x.alive && x.faction === 'ally');
      if (u) return u;
    }
    let best = null, bd = maxDist;
    for (const u of this.units) {
      if (!u.alive || u.faction !== 'ally') continue;
      const d = Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** LMG / yakın ateş baskısı: birimlerin isabetini ve hızını düşürür. */
  suppress(pos, radius, time) {
    for (const u of this.units) {
      if (!u.alive || u.faction !== 'enemy') continue;
      const d = Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z);
      if (d < radius) u.suppressed = Math.max(u.suppressed, time);
    }
  }

  damage(unit, amount, head, source) { unit.damage(amount, head, source); }

  damageInRadius(pos, radius, damage) {
    for (const u of [...this.units]) {
      if (!u.alive || u.faction !== 'enemy') continue;
      const d = Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z);
      if (d < radius) u.damage(damage * (1 - d / radius * .55), false, 'explosion');
    }
    // allied fire can hurt the player a little at point blank
    const g = this.game;
    const pd = Math.hypot(g.player.pos.x - pos.x, g.player.pos.z - pos.z);
    if (pd < radius * .35 && !g.player.inVehicle) g.player.takeDamage(12 * (1 - pd / (radius * .35)), pos);
  }

  update(dt, t) {
    const g = this.game;
    if (g.spatial) g.spatial.rebuild(this.units.filter(u => u.alive));
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.units.push(new Unit(this, p.ally ? 'ally' : 'enemy', p.pos, !!p.heavy));
        this.pending.splice(i, 1);
      }
    }
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const done = u.update(dt, t);
      if (done) { u.dispose(g); this.units.splice(i, 1); }
    }
    this._updateCapture(dt);
  }

  _updateCapture(dt) {
    const g = this.game, w = g.world;
    for (const cp of w.capturePoints) {
      let foes = 0, friends = 0;
      for (const u of this.units) {
        if (!u.alive) continue;
        if (Math.hypot(u.pos.x - cp.x, u.pos.z - cp.z) > cp.radius) continue;
        if (u.faction === 'enemy') foes++; else friends++;
      }
      const pd = Math.hypot(g.player.pos.x - cp.x, g.player.pos.z - cp.z);
      if (pd < cp.radius && !g.player.dead) friends += 2;
      const delta = friends - foes;
      cp.contested = friends > 0 && foes > 0;
      if (delta !== 0) cp.progress = clamp(cp.progress + Math.sign(delta) * dt * (.075 + Math.min(4, Math.abs(delta)) * .035), -1, 1);
      else cp.progress = damp(cp.progress, 0, .4, dt);
      const want = cp.progress >= 1 ? 'ally' : cp.progress <= -1 ? 'enemy' : null;
      if (want && want !== cp.owner) {
        w.setCaptureOwner(cp, want);
        g.hud.kill('BÖLGE ' + cp.id, want === 'ally' ? 'MÜTTEFİK' : 'DÜŞMAN', 'ele geçirdi');
        g.audio.radio();
        if (want === 'ally') g.addScore(250);
        g.bus?.emit?.('capture:changed', { cp, owner: want });
      }
      g.hud.objective(cp, cp.progress);
    }

    // MCOM uplink: holding a region charges the station; full charge = resupply.
    for (const st of w.mcomStations || []) {
      const cp = w.capturePoints.find(c => c.id === st.id);
      if (!cp) continue;
      cp.mcomProgress = st.progress;
      if (cp.owner === 'ally') {
        if (st.state !== 'done') {
          st.progress = Math.min(1, st.progress + dt * .045);
          w.setMcomState(st, st.progress >= 1 ? 'done' : 'active');
          if (st.progress >= 1) {
            g.allyTickets += 25;
            g.addScore(500);
            if (g.player) {
              g.player.airCharges = 1;
              g.player.airCooldown = 0;
              g.player.meds = Math.min(5, g.player.meds + 1);
              g.player.nades = Math.min(6, g.player.nades + 2);
              g.player.syncHUD();
            }
            g.hud.center('MCOM ' + st.id + ' BAĞLANDI', 'İKMAAL +25 BİLET · HAVA DESTEĞİ HAZIR', 3);
            g.hud.kill('MCOM ' + st.id, 'İKMAAL', 'ulaştı');
            g.audio.radio();
            g.bus?.emit?.('mcom:complete', { station: st });
          }
        }
      } else if (cp.owner === 'enemy') {
        st.progress = Math.max(0, st.progress - dt * .03);
        if (st.state === 'done') w.setMcomState(st, 'idle');
        else if (st.progress <= 0) w.setMcomState(st, 'idle');
      }
    }
  }

  clear() {
    const g = this.game;
    for (const u of this.units) u.dispose(g);
    this.units.length = 0;
    this.hitboxes.length = 0;
    this.pending.length = 0;
  }
}
