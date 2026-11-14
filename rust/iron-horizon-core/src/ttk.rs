//! TTK (time-to-kill) tablosu — fps-shooter skill'inin Pattern 2'si.
//! Tablo `WEAPONS` verisinden üretilir; dengeleme tablo üzerinden yapılır.

use crate::damage::damage_per_pellet;
use crate::weapons::WEAPONS;

#[derive(Debug, Clone, PartialEq)]
pub struct TtkRow {
    pub weapon: &'static str,
    pub hp: u32,
    pub zone: &'static str,
    pub shots: u32,
    pub seconds: f64,
}

pub fn shots_to_kill(hp: u32, per_shot_damage: f64) -> u32 {
    if per_shot_damage <= 0.0 {
        return u32::MAX;
    }
    // HP sıfırlanana kadar gereken tetik; tam bölenlerde yukarı yuvarlama.
    ((hp as f64 - 1e-9) / per_shot_damage).ceil() as u32
}

pub fn ttk_seconds(hp: u32, per_shot_damage: f64, rounds_per_second: f64) -> f64 {
    let shots = shots_to_kill(hp, per_shot_damage);
    if shots == u32::MAX || shots == 0 {
        return f64::INFINITY;
    }
    (shots - 1) as f64 / rounds_per_second
}

/// Her silah × HP × bölge satırlarını üretir.
pub fn standard_table() -> Vec<TtkRow> {
    const HPS: [u32; 3] = [100, 150, 400];
    let mut rows = Vec::new();
    for w in WEAPONS {
        if w.projectile {
            // Tanksavar: saçılım hasarı fizik katmanında; TTK anlamsız.
            for hp in HPS {
                rows.push(TtkRow {
                    weapon: w.name,
                    hp,
                    zone: "splash",
                    shots: u32::MAX,
                    seconds: f64::INFINITY,
                });
            }
            continue;
        }
        for hp in HPS {
            for (zone, head) in [("body", false), ("head", true)] {
                // Yakın temas referansı (falloff yok).
                let per_shot = damage_per_pellet(&w, 0.0, head) * w.pellets as f64;
                rows.push(TtkRow {
                    weapon: w.name,
                    hp,
                    zone,
                    shots: shots_to_kill(hp, per_shot),
                    seconds: ttk_seconds(hp, per_shot, w.rounds_per_second),
                });
            }
        }
    }
    rows
}

pub fn render_table() -> String {
    let mut out = String::new();
    out.push_str("DEMİR UFUK — TTK tablosu (yakın temas, HP 100 / 150 / 400)\n");
    out.push_str("silah                 hp    bölge   atış    saniye\n");
    out.push_str("--------------------  ----- ------ ------ --------\n");
    for r in standard_table() {
        if r.shots == u32::MAX {
            out.push_str(&format!(
                "{:<20}  {:<5} {:<6} {:<6} ∞\n",
                r.weapon, r.hp, r.zone, "-"
            ));
        } else {
            out.push_str(&format!(
                "{:<20}  {:<5} {:<6} {:<6} {:.2}\n",
                r.weapon, r.hp, r.zone, r.shots, r.seconds
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shots_and_seconds_ar() {
        // 27 hasar × 11 rps: 100 HP → 4 atış → 0.27 s
        assert_eq!(shots_to_kill(100, 27.0), 4);
        assert!((ttk_seconds(100, 27.0, 11.0) - 3.0 / 11.0).abs() < 1e-12);
    }

    #[test]
    fn projectile_is_infinity() {
        assert_eq!(shots_to_kill(100, 0.0), u32::MAX);
        assert_eq!(ttk_seconds(100, 0.0, 0.57), f64::INFINITY);
    }

    #[test]
    fn table_has_rows_for_all_weapons() {
        let table = render_table();
        assert!(table.contains("AR-12 KESTREL"));
        assert!(table.contains("RPG-29 YILDIRIM"));
        assert!(standard_table().len() >= 6 * 3 * 2);
    }
}
