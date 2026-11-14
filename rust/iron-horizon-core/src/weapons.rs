//! Silah verileri — fps-shooter skill'inin önerdiği gibi her özellik data
//! olarak yazılır, TTK tablosu bu tablodan üretilir. JS `systems/Loadout.js`
//! ile aynı silah ailesi; sayılar denge taslağıdır.

/// Bir silahın tam tanımı. Hepsi f64: determinizm ve sadelik.
#[derive(Debug, Clone, Copy)]
pub struct WeaponDef {
    pub id: &'static str,
    pub name: &'static str,
    pub class_name: &'static str,
    /// Mermi başına gövde hasarı (saçmalıda saçma başına).
    pub damage: f64,
    pub pellets: u32,
    /// Kafa vuruşu çarpanı.
    pub headshot_mult: f64,
    /// Saniyede atış (rpm/60).
    pub rounds_per_second: f64,
    pub semi_auto: bool,
    pub mag: u32,
    pub reload_s: f64,
    /// Kalça ateşi yarı-açı (radyan).
    pub spread_hip: f64,
    /// ADS yarı-açı (radyan).
    pub spread_ads: f64,
    /// Atış başına dikey geri tepme (radyan).
    pub recoil_vertical: f64,
    /// Atış başına yatay geri tepme dağılımı (radyan).
    pub recoil_horizontal: f64,
    /// Tam hasar menzili (m).
    pub falloff_full_m: f64,
    /// Hasarın tabana düştüğü menzil (m).
    pub falloff_end_m: f64,
    /// Azami menzilde kalan hasar oranı.
    pub falloff_floor: f64,
    pub max_range_m: f64,
    /// Tanksavar gibi mermi fiziklidir.
    pub projectile: bool,
    pub hip_fov_deg: f64,
    pub ads_fov_deg: f64,
}

pub const AR: WeaponDef = WeaponDef {
    id: "ar",
    name: "AR-12 KESTREL",
    class_name: "SALDIRI TÜFEĞİ",
    damage: 27.0,
    pellets: 1,
    headshot_mult: 2.3,
    rounds_per_second: 11.0, // 660 rpm
    semi_auto: false,
    mag: 30,
    reload_s: 1.95,
    spread_hip: 0.011,
    spread_ads: 0.0025,
    recoil_vertical: 0.0072,
    recoil_horizontal: 0.0035,
    falloff_full_m: 40.0,
    falloff_end_m: 120.0,
    falloff_floor: 0.55,
    max_range_m: 260.0,
    projectile: false,
    hip_fov_deg: 76.0,
    ads_fov_deg: 54.0,
};

pub const SMG: WeaponDef = WeaponDef {
    id: "smg",
    name: "V-9 KARTAL",
    class_name: "HAFİF MAKİNELİ TABANCA",
    damage: 19.0,
    pellets: 1,
    headshot_mult: 2.3,
    rounds_per_second: 15.0, // 900 rpm
    semi_auto: false,
    mag: 35,
    reload_s: 1.55,
    spread_hip: 0.018,
    spread_ads: 0.006,
    recoil_vertical: 0.0048,
    recoil_horizontal: 0.0024,
    falloff_full_m: 20.0,
    falloff_end_m: 70.0,
    falloff_floor: 0.5,
    max_range_m: 155.0,
    projectile: false,
    hip_fov_deg: 76.0,
    ads_fov_deg: 58.0,
};

pub const LMG: WeaponDef = WeaponDef {
    id: "lmg",
    name: "M-240 KAYA",
    class_name: "AĞIR MAKİNELİ TÜFEK",
    damage: 24.0,
    pellets: 1,
    headshot_mult: 2.1,
    rounds_per_second: 10.3, // 620 rpm
    semi_auto: false,
    mag: 100,
    reload_s: 4.1,
    spread_hip: 0.027,
    spread_ads: 0.009,
    recoil_vertical: 0.0085,
    recoil_horizontal: 0.0042,
    falloff_full_m: 45.0,
    falloff_end_m: 150.0,
    falloff_floor: 0.6,
    max_range_m: 300.0,
    projectile: false,
    hip_fov_deg: 76.0,
    ads_fov_deg: 56.0,
};

pub const SHOTGUN: WeaponDef = WeaponDef {
    id: "shotgun",
    name: "M-590 KIRICI",
    class_name: "POMPALI TÜFEK",
    damage: 14.0, // saçma başına
    pellets: 8,
    headshot_mult: 2.3,
    rounds_per_second: 1.53, // 92 rpm
    semi_auto: true,
    mag: 8,
    reload_s: 3.25,
    spread_hip: 0.055,
    spread_ads: 0.030,
    recoil_vertical: 0.030,
    recoil_horizontal: 0.014,
    falloff_full_m: 8.0,
    falloff_end_m: 45.0,
    falloff_floor: 0.15,
    max_range_m: 55.0,
    projectile: false,
    hip_fov_deg: 76.0,
    ads_fov_deg: 62.0,
};

pub const DMR: WeaponDef = WeaponDef {
    id: "dmr",
    name: "M-87 ŞAHİN",
    class_name: "KESKİN NİŞAN TÜFEĞİ",
    damage: 98.0,
    pellets: 1,
    headshot_mult: 2.3,
    rounds_per_second: 1.37, // 82 rpm
    semi_auto: true,
    mag: 8,
    reload_s: 2.8,
    spread_hip: 0.0045,
    spread_ads: 0.0002,
    recoil_vertical: 0.025,
    recoil_horizontal: 0.011,
    falloff_full_m: 80.0,
    falloff_end_m: 500.0,
    falloff_floor: 0.75,
    max_range_m: 620.0,
    projectile: false,
    hip_fov_deg: 76.0,
    ads_fov_deg: 16.0,
};

pub const LAUNCHER: WeaponDef = WeaponDef {
    id: "launcher",
    name: "RPG-29 YILDIRIM",
    class_name: "TANKSAVAR ROKET",
    damage: 0.0, // doğrudan hasar yok; görkemli saçılım hasarı fizik katmanında
    pellets: 1,
    headshot_mult: 1.0,
    rounds_per_second: 0.57, // 34 rpm
    semi_auto: true,
    mag: 1,
    reload_s: 3.3,
    spread_hip: 0.002,
    spread_ads: 0.0002,
    recoil_vertical: 0.046,
    recoil_horizontal: 0.02,
    falloff_full_m: 0.0,
    falloff_end_m: 1.0,
    falloff_floor: 1.0,
    max_range_m: 300.0,
    projectile: true,
    hip_fov_deg: 76.0,
    ads_fov_deg: 56.0,
};

pub const WEAPONS: [WeaponDef; 6] = [AR, SMG, LMG, SHOTGUN, DMR, LAUNCHER];

pub fn weapon(id: &str) -> Option<&'static WeaponDef> {
    WEAPONS.iter().find(|w| w.id == id)
}

/// ADS görünümü, nişangâh hassasiyetini FOV oranıyla küçültür:
/// tan(ads/2) / tan(hip/2). (fps-shooter skill'i, ADS sensitivity kuralı)
pub fn ads_sensitivity_factor(def: &WeaponDef) -> f64 {
    (def.ads_fov_deg.to_radians() * 0.5).tan() / (def.hip_fov_deg.to_radians() * 0.5).tan()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_finds_all_six() {
        for id in ["ar", "smg", "lmg", "shotgun", "dmr", "launcher"] {
            assert!(weapon(id).is_some(), "{id} bulunamadı");
        }
        assert!(weapon("raygun").is_none());
    }

    #[test]
    fn ads_factor_shrinks_with_zoom() {
        for w in WEAPONS {
            let f = ads_sensitivity_factor(&w);
            if w.hip_fov_deg == w.ads_fov_deg {
                assert!((f - 1.0).abs() < 1e-9);
            } else {
                assert!(f > 0.0 && f < 1.0, "{}: {f}", w.id);
            }
        }
        // DMR 76° → 16°: yaklaşık %18 (gerçek Dürbün hissi).
        let dmr = ads_sensitivity_factor(&DMR);
        assert!(dmr > 0.15 && dmr < 0.22, "dmr factor = {dmr}");
    }

    #[test]
    fn pellets_are_per_shot() {
        assert_eq!(SHOTGUN.pellets, 8);
        assert_eq!(AR.pellets, 1);
    }
}
