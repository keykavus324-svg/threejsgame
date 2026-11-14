/** Versioned localStorage persistence with an in-memory fallback (headless/tests). */
const KEY = 'iron-horizon-v2';
const DEFAULTS = {
  settings: { difficulty: 1, quality: 2, sensitivity: 1, volume: .7, fov: 76, timeOfDay: 17.4, weather: 'dust' },
  progression: { xp: 0, rank: 1, kills: 0, wins: 0, matches: 0, bestScore: 0, unlocked: ['ar', 'smg'] },
  loadout: { class: 'assault', weapon: 'ar', attachment: 'red_dot' },
};

export class Save {
  constructor() {
    this.mem = null;
    this.data = this._load();
  }
  _store() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }
  _load() {
    const s = this._store();
    if (!s) { this.mem = JSON.parse(JSON.stringify(DEFAULTS)); return this.mem; }
    try {
      const raw = JSON.parse(s.getItem(KEY) || 'null');
      if (!raw || raw.v !== 2) throw new Error('old');
      return {
        settings: { ...DEFAULTS.settings, ...raw.settings },
        progression: { ...DEFAULTS.progression, ...raw.progression },
        loadout: { ...DEFAULTS.loadout, ...raw.loadout },
      };
    } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  flush() {
    const s = this._store();
    if (s) { try { s.setItem(KEY, JSON.stringify({ v: 2, ...this.data })); } catch {} }
    else this.mem = this.data;
  }
  patch(section, values) { Object.assign(this.data[section], values); this.flush(); }
  addXp(amount) {
    const p = this.data.progression;
    p.xp += amount;
    const ranks = [0, 500, 1400, 3000, 5600, 9500, 15000, 23000, 34000, 50000];
    let r = 1;
    for (let i = 1; i < ranks.length; i++) if (p.xp >= ranks[i]) r = i + 1;
    const up = r > p.rank;
    p.rank = r;
    const unlocks = { 2: 'dmr', 3: 'lmg', 4: 'shotgun', 5: 'launcher' };
    const newly = [];
    for (const [rank, weapon] of Object.entries(unlocks)) {
      if (r >= +rank && !p.unlocked.includes(weapon)) { p.unlocked.push(weapon); newly.push(weapon); }
    }
    this.flush();
    this.lastUnlocks = newly;
    return up;
  }
  get rankName() {
    return ['ER', 'ONBAŞI', 'ÇAVUŞ', 'BAŞÇAVUŞ', 'ASTEĞMEN', 'TEĞMEN', 'ÜSTEĞMEN', 'YÜZBAŞI', 'BİNBAYI', 'ALBAY'][this.data.progression.rank - 1] || 'ALBAY';
  }
}
