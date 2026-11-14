/**
 * Class / weapon / progression definitions.
 * All viewmodels referenced here are authored in blender/make_assets.py and
 * exported as GLB; nothing is downloaded.
 */
export const WEAPONS = [
  {
    id: 'ar', name: 'AR-12 KESTREL', cls: 'SALDIRI TÜFEĞİ', fire: 'TAM OTOMATİK', model: 'rifle',
    mag: 30, reserve: 210, damage: 27, rpm: 660, auto: true,
    spread: .011, spreadADS: .0025, recoil: .0072, kick: .055, reloadTime: 1.95,
    adsFov: 54, range: 260, sound: 'rifle', muzzle: [0, .012, -.56], vmScale: 1,
  },
  {
    id: 'smg', name: 'V-9 KARTAL', cls: 'HAFİF MAKİNELİ TABANCA', fire: 'TAM OTOMATİK', model: 'wpn_smg',
    mag: 35, reserve: 245, damage: 19, rpm: 900, auto: true,
    spread: .018, spreadADS: .006, recoil: .0048, kick: .038, reloadTime: 1.55,
    adsFov: 58, range: 155, sound: 'rifle', muzzle: [0, .01, -.48], vmScale: 1.08,
  },
  {
    id: 'lmg', name: 'M-240 KAYA', cls: 'AĞIR MAKİNELİ TÜFEK', fire: 'KEMER BESLEMELİ', model: 'wpn_lmg',
    mag: 100, reserve: 300, damage: 24, rpm: 620, auto: true,
    spread: .027, spreadADS: .009, recoil: .0085, kick: .07, reloadTime: 4.1,
    adsFov: 56, range: 300, sound: 'rifle', muzzle: [0, .012, -.9], vmScale: .88,
    suppression: .22,
  },
  {
    id: 'shotgun', name: 'M-590 KIRICI', cls: 'POMPALI TÜFEK', fire: '8 SAÇMA / YARI OTOMATİK', model: 'wpn_shotgun',
    mag: 8, reserve: 48, damage: 14, pellets: 8, rpm: 92, auto: false,
    spread: .055, spreadADS: .030, recoil: .030, kick: .18, reloadTime: 3.25,
    adsFov: 62, range: 55, sound: 'dmr', muzzle: [0, .012, -.78], vmScale: .92,
  },
  {
    id: 'dmr', name: 'M-87 ŞAHİN', cls: 'KESKİN NİŞAN TÜFEĞİ', fire: 'TEK ATIŞ / DÜRBÜN', model: 'wpn_sniper',
    mag: 8, reserve: 56, damage: 98, rpm: 82, auto: false,
    spread: .0045, spreadADS: .00016, recoil: .025, kick: .145, reloadTime: 2.8,
    adsFov: 16, range: 620, sound: 'dmr', muzzle: [0, .012, -1.05], vmScale: .82,
    scope: true,
  },
  {
    id: 'launcher', name: 'RPG-29 YILDIRIM', cls: 'TANKSAVAR ROKET', fire: 'TEK ATIŞ / PATLAYICI', model: 'wpn_launcher',
    mag: 1, reserve: 6, damage: 0, rpm: 34, auto: false,
    spread: .002, spreadADS: .0002, recoil: .046, kick: .25, reloadTime: 3.3,
    adsFov: 56, range: 300, sound: 'tank', muzzle: [0, .16, -.72], vmScale: .92,
    rocket: true, rocketSpeed: 48, rocketPower: 1.25,
  },
];

export const WEAPON_INDEX = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

export const CLASSES = [
  {
    id: 'assault', name: 'SALDIRI', tag: 'ÖNCÜ / ÇOK YÖNLÜ',
    desc: 'AR-12 + V-9 · ekstra ilk yardım, hızlı koşu, dengeli mühimmat.',
    slots: ['ar', 'smg'], meds: 3, nades: 4, speed: 1.08, airCooldown: 42, reload: 1,
  },
  {
    id: 'support', name: 'DESTEK', tag: 'ATEŞ GÜCÜ / BASKI',
    desc: 'M-240 + M-590 · geniş şarjör, baskı ateşi, hızlı doldurma.',
    slots: ['lmg', 'shotgun'], meds: 2, nades: 3, speed: .97, airCooldown: 46, reload: .86,
  },
  {
    id: 'engineer', name: 'MÜHENDİS', tag: 'ZIRH / YIKIM',
    desc: 'V-9 + RPG-29 · fazla bomba, araç onarımı, roket rezervi.',
    slots: ['smg', 'launcher'], meds: 2, nades: 5, speed: 1.03, airCooldown: 50, reload: 1,
    repair: true, rocketReserve: 10,
  },
  {
    id: 'recon', name: 'KESKİN NİŞANCI', tag: 'İSTİHBARAT / HAVA',
    desc: 'M-87 + AR-12 · düşman işaretleme, kısa hava desteği süresi.',
    slots: ['dmr', 'ar'], meds: 2, nades: 2, speed: 1.02, airCooldown: 30, reload: 1,
    spot: true, adsSpeed: 1.18,
  },
];

export const CLASS_INDEX = Object.fromEntries(CLASSES.map((c, i) => [c.id, i]));

export const RANK_UNLOCK = {
  2: 'dmr', 3: 'lmg', 4: 'shotgun', 5: 'launcher',
};

export function availableSlots(cls, progression) {
  const unlocked = new Set(progression?.unlocked || ['ar', 'smg']);
  const slots = cls.slots.map(id => WEAPON_INDEX[id]).filter(i => Number.isInteger(i) && unlocked.has(WEAPONS[i].id));
  return slots.length ? slots : [WEAPON_INDEX.ar, WEAPON_INDEX.smg];
}
