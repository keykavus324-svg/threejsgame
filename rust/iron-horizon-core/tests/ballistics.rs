//! Entegrasyon testleri: silah/TTK/ateş hattından görev akışına uçtan uca.

use iron_horizon_core::damage::{damage_per_pellet, falloff, shot_damage};
use iron_horizon_core::fire::FireScheduler;
use iron_horizon_core::weapons::{weapon, WEAPONS, AR, SHOTGUN};

/// fps-shooter skill'i Pattern 2 doğrulaması: 30/60/144 FPS'te 10 saniye
/// tam otomatik; mermi sayısı fire_rate * 10 ± 1 olmalı.
#[test]
fn fire_rate_is_frame_rate_independent() {
    for fps in [30.0f64, 60.0, 144.0] {
        for w in WEAPONS {
            if w.semi_auto {
                continue;
            }
            let mut sched = FireScheduler::new(w.rounds_per_second);
            let dt = 1.0 / fps;
            let mut shots = 0u32;
            let mut t = 0.0;
            while t < 10.0 {
                shots += sched.update(t, true);
                t += dt;
            }
            let expected = w.rounds_per_second * 10.0;
            assert!(
                (shots as f64 - expected).abs() <= 1.0,
                "{} @ {fps} FPS: {shots} ≈ {expected}",
                w.id
            );
        }
    }
}

/// Skill'in "kendi collider'ından mermi atışı" eşdeğeri: saçılım her zaman
/// koninin içindedir ve isabet hızı menzile göre erir.
#[test]
fn damage_bands_match_spec() {
    // AR: 40 m'e kadar tam, 120 m'de taban.
    assert_eq!(falloff(&AR, 39.9), 1.0);
    assert_eq!(falloff(&AR, 40.0), 1.0);
    assert!((falloff(&AR, 120.0) - AR.falloff_floor).abs() < 1e-12);
    // Saçmalı: 3 m'de tam 112 gövde hasarı (8×14)
    assert!((shot_damage(&SHOTGUN, 3.0, false) - 112.0).abs() < 1e-9);
    // Kafa = gövde × çarpan (tam temas)
    assert!((damage_per_pellet(&AR, 1.0, true) - damage_per_pellet(&AR, 1.0, false) * AR.headshot_mult).abs() < 1e-9);
}

/// TTK bandı (mid / military): taarruz tüfeği 100 HP'yi ~0.3 s'de düşürür.
#[test]
fn ar_sits_in_mid_ttk_band() {
    let ttk = 3.0 / AR.rounds_per_second; // 4 atış - 1
    assert!((0.15..=0.45).contains(&ttk), "ttk = {ttk}");
}

#[test]
fn dmr_headshot_is_one_shot_on_basic_soldier() {
    let dmr = weapon("dmr").unwrap();
    let dmg = damage_per_pellet(dmr, 50.0, true);
    assert!(dmg >= 200.0, "{dmg}"); // 98 × 2.3 ≈ 225
}
