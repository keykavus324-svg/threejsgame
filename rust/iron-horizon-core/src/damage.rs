//! Hasar eğrileri: menzile göre doğrusal saçılım (falloff), kafa çarpanı ve
//! saçıcının yakın temasındaki parça hasarı.

use crate::weapons::WeaponDef;

/// Merminin `dist` metredeki hasar çarpanı ∈ [falloff_floor, 1.0].
pub fn falloff(def: &WeaponDef, dist: f64) -> f64 {
    if dist <= def.falloff_full_m {
        return 1.0;
    }
    if dist >= def.falloff_end_m {
        return def.falloff_floor;
    }
    let t = (dist - def.falloff_full_m) / (def.falloff_end_m - def.falloff_full_m);
    1.0 + (def.falloff_floor - 1.0) * t
}

/// Tek mermi (saçmalıda saçma) hasarı.
pub fn damage_per_pellet(def: &WeaponDef, dist: f64, head: bool) -> f64 {
    let base = def.damage * falloff(def, dist);
    if head {
        base * def.headshot_mult
    } else {
        base
    }
}

/// Tam tetik: saçma sayısı dâhil toplam hasar.
pub fn shot_damage(def: &WeaponDef, dist: f64, head: bool) -> f64 {
    damage_per_pellet(def, dist, head) * def.pellets as f64
}

/// Patlama hasarı: doğrusal azalma + yumuşak çekirdek; kenarda sıfır.
pub fn splash_damage(max_damage: f64, radius: f64, dist: f64) -> f64 {
    if radius <= 0.0 || dist >= radius {
        return 0.0;
    }
    let t = 1.0 - dist / radius;
    // t^2'ye yakın çekirdek: kenarda hızlı eriyiş, merkezde doyum.
    max_damage * (t * (0.5 + 0.5 * t))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weapons::{AR, SHOTGUN};

    #[test]
    fn falloff_curve_shape() {
        assert_eq!(falloff(&AR, 0.0), 1.0);
        assert_eq!(falloff(&AR, 40.0), 1.0);
        assert_eq!(falloff(&AR, 120.0), AR.falloff_floor);
        assert_eq!(falloff(&AR, 999.0), AR.falloff_floor);
        let mid = falloff(&AR, 80.0);
        assert!(mid > AR.falloff_floor && mid < 1.0);
    }

    #[test]
    fn headshot_beats_body() {
        let b = damage_per_pellet(&AR, 10.0, false);
        let h = damage_per_pellet(&AR, 10.0, true);
        assert!((h - b * AR.headshot_mult).abs() < 1e-9);
    }

    #[test]
    fn shotgun_full_body_at_close_range() {
        // 8 saçma × 14 = 112 gövde — ACEMİ muharip tek tetikte düşer.
        assert!((shot_damage(&SHOTGUN, 3.0, false) - 112.0).abs() < 1e-9);
    }

    #[test]
    fn splash_fades_to_zero() {
        assert_eq!(splash_damage(100.0, 5.0, 5.0), 0.0);
        assert!(splash_damage(100.0, 5.0, 0.0) > splash_damage(100.0, 5.0, 2.5));
        assert!(splash_damage(100.0, 5.0, 0.0) <= 100.0);
    }
}
