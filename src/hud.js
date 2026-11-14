import { clamp, formatTime } from './utils.js';
import { heightAt } from './world.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), loading: $('loading'), pause: $('pause'), end: $('end'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), killconfirm: $('killconfirm'),
      ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), wpName: $('wp-name'), wpClass: $('wp-class'),
      wpFire: $('wp-fire'), wpHint: $('wp-hint'), slot1: $('slot-1'), slot2: $('slot-2'),
      healthFill: $('health-fill'), healthNum: $('health-num'), stamina: $('stamina-fill'),
      med: $('med-count'), nade: $('nade-count'), air: $('air-count'),
      gearMed: $('gear-med'), gearAir: $('gear-air'), gearNade: $('gear-nade'),
      score: $('score'), kills: $('kills'), accuracy: $('accuracy'), rank: $('rank'),
      waveNum: $('wave-num'), waveFill: $('wave-fill'), waveSub: $('wave-sub'),
      ticketsAlly: $('tickets-ally'), ticketsEnemy: $('tickets-enemy'),
      killfeed: $('killfeed'), center: $('center-msg'), objectives: $('objectives'),
      damage: $('damage-vignette'), heal: $('heal-vignette'), scope: $('scope'),
      interact: $('interact'), vehicleHUD: $('vehicle-hud'), tankHp: $('tank-hp'),
      tankReload: $('tank-reload'), tankSpeed: $('tank-speed'),
      arrows: $('damage-arrows'), fps: $('fps-counter'), minimapCoord: $('minimap-coord'),
      loadFill: $('load-fill'), loadStep: $('load-step'),
    };
    this.canvas = $('minimap');
    this.mctx = this.canvas.getContext('2d');
    this.centerTimer = 0;
    this.msgQueue = [];
    this.miniAcc = 0;
    this.objEls = new Map();
    this.arrows = [];
    this._lastFps = 0;
  }

  // ---------------------------------------------------------------- screens
  showLoading(show, p = 0, step = '') {
    this.el.loading.classList.toggle('hidden', !show);
    if (show) {
      this.el.loadFill.style.width = (p * 100).toFixed(0) + '%';
      if (step) this.el.loadStep.textContent = step;
    }
  }
  showMenu(show) { this.el.menu.classList.toggle('hidden', !show); }
  showHUD(show) { this.el.hud.classList.toggle('hidden', !show); }
  showPause(show) { this.el.pause.classList.toggle('hidden', !show); }
  showEnd(win, stats, time, prog) {
    this.el.end.classList.remove('hidden');
    $('end-eyebrow').textContent = win ? 'GÖREV TAMAMLANDI' : 'GÖREV BAŞARISIZ';
    $('end-title').textContent = win ? 'BÖLGE GÜVENLİ' : 'HAT ÇÖKTÜ';
    $('end-title').style.color = win ? 'var(--amber-hi)' : 'var(--red)';
    $('end-text').textContent = win
      ? 'Düşman biletleri tükendi. Vadi yeniden bizim. Kalkan-9 hâlâ çalışıyor.'
      : 'Müttefik biletleri tükendi. Bir sonraki şafakta yeniden dene.';
    $('end-score').textContent = stats.score.toLocaleString('tr-TR');
    $('end-kills').textContent = stats.kills;
    $('end-heads').textContent = stats.headshots;
    $('end-acc').textContent = (stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0) + '%';
    $('end-time').textContent = formatTime(time);
    const xpEl = $('end-xp');
    if (xpEl) {
      if (prog) {
        let line = `XP <b>+${prog.xpEarned}</b> · RÜTBE <b>${prog.rank}</b> · TOPLAM XP <b>${prog.xp}</b>`;
        if (prog.leveled) line += ` · <i class="promo">TERFİ!</i>`;
        if (prog.unlocks?.length) line += ` · YENİ SİLAH: <b>${prog.unlocks.join(' · ')}</b>`;
        xpEl.innerHTML = line;
        xpEl.classList.remove('hidden');
      } else {
        xpEl.classList.add('hidden');
      }
    }
  }
  hideEnd() { this.el.end.classList.add('hidden'); }
  clear() {
    this.el.killfeed.innerHTML = '';
    this.el.arrows.innerHTML = '';
    this.el.center.classList.remove('show');
    this.centerTimer = 0;
    this.el.damage.style.opacity = '0';
    this.el.heal.style.opacity = '0';
    this.scope(false);
    this.interact(false);
  }

  // ---------------------------------------------------------------- vitals
  health(v, max) {
    const p = clamp(v / max, 0, 1);
    this.el.healthFill.style.width = (p * 100) + '%';
    this.el.healthFill.classList.toggle('low', p < .3);
    this.el.healthNum.textContent = Math.ceil(v);
  }
  stamina(v) { this.el.stamina.style.width = (v * 100) + '%'; }
  med(n) { this.el.med.textContent = n; this.el.gearMed.classList.toggle('cool', n <= 0); }
  nade(n) { this.el.nade.textContent = n; this.el.gearNade.classList.toggle('cool', n <= 0); }
  air(s) { this.el.air.textContent = s; this.el.gearAir.classList.toggle('cool', s !== 'HAZIR'); }
  score(stats) {
    this.el.score.textContent = stats.score.toLocaleString('tr-TR');
    this.el.kills.textContent = stats.kills;
    this.el.accuracy.textContent = (stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0) + '%';
  }
  rank(name, xp, rankNum) {
    if (this.el.rank) this.el.rank.textContent = `${name} · ${rankNum}`;
  }
  ammo(mag, reserve, w, slot, reloading) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoMag.classList.toggle('empty', mag <= 5);
    this.el.ammoRes.textContent = reserve;
    this.el.wpName.textContent = w.name;
    this.el.wpClass.textContent = w.cls;
    this.el.wpFire.textContent = w.fire;
    this.el.slot1.classList.toggle('active', slot === 0);
    this.el.slot2.classList.toggle('active', slot === 1);
    this.el.wpHint.textContent = reloading ? 'ŞARJÖR DEĞİŞTİRİLİYOR…' : (w.scope ? 'SAĞ TIK · DÜRBÜN   |   R · ŞARJÖR' : 'R · ŞARJÖR   |   SAĞ TIK · NİŞAN');
  }
  reloading(on) { if (on) this.el.wpHint.textContent = 'ŞARJÖR DEĞİŞTİRİLİYOR…'; }
  crosshair(spread, scoped, ads) {
    const c = this.el.crosshair;
    c.classList.toggle('scoped', !!scoped);
    const gap = ads ? 3 : 7 + spread * 24;
    c.style.setProperty('--ct', gap.toFixed(1) + 'px');
    c.style.opacity = scoped ? 0 : (.75 + spread * .25);
  }
  scope(on) { this.el.scope.classList.toggle('hidden', !on); }
  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill'); void h.offsetWidth;
    h.classList.add('show'); if (kill) h.classList.add('kill');
    if (kill) {
      const k = this.el.killconfirm;
      k.classList.remove('show'); void k.offsetWidth; k.classList.add('show');
    }
  }
  damageFlash() {
    const d = this.el.damage;
    d.style.opacity = '1';
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { d.style.opacity = '0'; }, 130);
  }
  healFlash() {
    const d = this.el.heal;
    d.style.opacity = '1';
    clearTimeout(this._healT);
    this._healT = setTimeout(() => { d.style.opacity = '0'; }, 260);
  }
  damageArrow(angle) {
    const a = document.createElement('div');
    a.className = 'dmg-arrow';
    a.style.transform = `translate(-50%,-50%) rotate(${angle}rad) translateY(-190px)`;
    this.el.arrows.appendChild(a);
    setTimeout(() => a.remove(), 1100);
  }
  kill(a, b, verb) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = `<b>${a}</b> &nbsp;›&nbsp; <i>${b}</i> &nbsp; ${verb}`;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.remove(), 5200);
  }
  center(text, sub = '', dur = 2.2) {
    this.el.center.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    this.el.center.classList.add('show');
    this.centerTimer = dur;
  }
  tickCenter(dt) {
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.el.center.classList.remove('show');
    }
  }
  interact(show, text) {
    this.el.interact.classList.toggle('hidden', !show);
    if (show) this.el.interact.querySelector('span').textContent = text;
  }
  vehicle(on) {
    this.el.vehicleHUD.classList.toggle('hidden', !on);
    if (!on) this.el.interact.classList.add('hidden');
  }
  tank(pct, speed, reload) {
    this.el.tankHp.style.width = clamp(pct, 0, 1) * 100 + '%';
    this.el.tankSpeed.textContent = Math.round(speed);
    this.el.tankReload.textContent = reload;
  }
  tickets(ally, enemy) {
    this.el.ticketsAlly.textContent = Math.ceil(ally);
    this.el.ticketsEnemy.textContent = Math.ceil(enemy);
  }
  wave(n, total, remaining, sub) {
    this.el.waveNum.textContent = 'DALGA ' + String(n).padStart(2, '0');
    this.el.waveFill.style.width = clamp(1 - remaining / Math.max(1, total), 0, 1) * 100 + '%';
    if (sub) this.el.waveSub.textContent = sub;
  }
  objective(cp, progress) {
    let e = this.objEls.get(cp.id);
    if (!e) {
      e = document.createElement('div');
      e.className = 'obj';
      e.innerHTML = `<span class="obj-letter">${cp.id}</span><span class="obj-name">${cp.name}</span><span class="obj-state">TARAFSIZ</span><span class="obj-bar"></span>`;
      this.el.objectives.appendChild(e);
      this.objEls.set(cp.id, e);
    }
    e.classList.toggle('ally', cp.owner === 'ally');
    e.classList.toggle('enemy', cp.owner === 'enemy');
    e.classList.toggle('contested', cp.contested);
    const s = e.querySelector('.obj-state');
    const bar = e.querySelector('.obj-bar');
    let label = cp.contested ? 'ÇATIŞMA' : cp.owner === 'ally' ? 'MÜTTEFİK' : cp.owner === 'enemy' ? 'DÜŞMAN' : 'TARAFSIZ';
    if (cp.mcomProgress > 0) label += ` · MCOM %${Math.round(cp.mcomProgress * 100)}`;
    s.textContent = label;
    if (bar) {
      bar.style.width = (Math.abs(progress) * 100).toFixed(0) + '%';
      bar.style.background = progress >= 0 ? 'var(--blue)' : 'var(--red)';
    }
  }
  fps(v, t) {
    if (t - this._lastFps < .5) return;
    this._lastFps = t;
    this.el.fps.textContent = Math.round(v) + ' FPS';
  }

  // ---------------------------------------------------------------- minimap
  minimap(game, dt) {
    this.miniAcc += dt;
    if (this.miniAcc < .085) return;
    this.miniAcc = 0;
    const c = this.mctx, S = 220, R = 160;
    const p = game.player.inVehicle ? game.vehicle.position : game.player.pos;
    const yaw = game.player.inVehicle ? game.vehicle.hullYaw : game.player.yaw;
    const sc = (S / 2) / R;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(10,18,18,.72)'; c.fillRect(0, 0, S, S);

    // terrain contours
    c.strokeStyle = 'rgba(160,180,150,.10)'; c.lineWidth = 1;
    for (let i = -R; i <= R; i += 20) {
      c.beginPath();
      for (let j = -R; j <= R; j += 8) {
        const x = p.x + j, z = p.z + i;
        const h = heightAt(x, z);
        const px = S / 2 + j * sc, py = S / 2 + i * sc - h * .18;
        if (j === -R) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }
    // grid
    c.strokeStyle = 'rgba(200,220,200,.08)';
    for (let i = 0; i <= S; i += 22) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(S, i); c.stroke();
    }
    // radar sweep
    const sweep = (game.time * .9) % (Math.PI * 2);
    const grad = c.createLinearGradient(S / 2, S / 2, S / 2 + Math.cos(sweep) * 110, S / 2 + Math.sin(sweep) * 110);
    grad.addColorStop(0, 'rgba(120,220,190,.16)'); grad.addColorStop(1, 'rgba(120,220,190,0)');
    c.strokeStyle = grad; c.lineWidth = 2;
    c.beginPath(); c.moveTo(S / 2, S / 2); c.lineTo(S / 2 + Math.cos(sweep) * 110, S / 2 + Math.sin(sweep) * 110); c.stroke();
    c.beginPath(); c.arc(S / 2, S / 2, 108, 0, Math.PI * 2); c.strokeStyle = 'rgba(180,200,190,.18)'; c.stroke();

    // clamp helper
    const P = (x, z) => [clamp(S / 2 + (x - p.x) * sc, 3, S - 3), clamp(S / 2 + (z - p.z) * sc, 3, S - 3)];
    // objectives
    for (const cp of game.world.capturePoints) {
      const [x, y] = P(cp.x, cp.z);
      const col = cp.owner === 'ally' ? '#6fb6ff' : cp.owner === 'enemy' ? '#ff5540' : '#f2b45a';
      c.strokeStyle = col; c.fillStyle = col + '22'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(x, y, cp.radius * sc, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = col; c.font = 'bold 10px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(cp.id, x, y);
    }
    // units
    for (const u of game.enemies.units) {
      if (!u.alive) continue;
      const [x, y] = P(u.pos.x, u.pos.z);
      c.fillStyle = u.faction === 'enemy' ? (u.heavy ? '#ff2a18' : '#ff6a52') : '#5aa9ff';
      const s = u.heavy ? 4 : 2.6;
      c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
      if (u.spotted > 0) {
        c.strokeStyle = '#ffffff'; c.lineWidth = 1.2;
        c.beginPath(); c.arc(x, y, s + 3, 0, Math.PI * 2); c.stroke();
      }
    }
    // MCOM stations
    for (const st of game.world.mcomStations || []) {
      const [x, y] = P(st.pos.x, st.pos.z);
      c.fillStyle = st.state === 'done' ? '#55e0a0' : st.state === 'active' ? '#ff4030' : '#9a4a32';
      c.fillRect(x - 3, y - 3, 6, 6);
    }
    // tank
    const [tx, ty] = P(game.vehicle.position.x, game.vehicle.position.z);
    if (!game.vehicle.destroyed) {
      c.strokeStyle = '#f2b45a'; c.lineWidth = 1.5;
      c.strokeRect(tx - 4, ty - 4, 8, 8);
    }
    // player arrow + view cone
    c.save(); c.translate(S / 2, S / 2); c.rotate(-yaw);
    c.fillStyle = 'rgba(230,245,230,.10)';
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 46, -Math.PI / 2 - .42, -Math.PI / 2 + .42); c.closePath(); c.fill();
    c.fillStyle = '#f4f7ee';
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 5); c.lineTo(0, 2); c.lineTo(-5, 5); c.closePath(); c.fill();
    c.restore();
    this.el.minimapCoord.textContent = `${Math.round(p.x).toString().padStart(3, '0')} · ${Math.round(p.z).toString().padStart(3, '0')}`;
  }
}
