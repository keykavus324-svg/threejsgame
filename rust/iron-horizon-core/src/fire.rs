//! Atış zamanlayıcısı — fps-shooter skill'inin Pattern 1'i (kare hızından bağımsız
//! tetik) ve geri tepme-ofset modeli (geri tepme kameraya toplanmaz, sönümlenen
//! ayrı bir ofset olarak yaşar).

use crate::rng::Rng;
use crate::vec::Vec3;

/// Tetik saati: `update()` çağrıldığında o karede ateş edilmesi gereken
/// mermi sayısını döner. Uzun duraklamada "banked shot" biriktirmez.
#[derive(Debug, Clone)]
pub struct FireScheduler {
    interval: f64,
    next_shot_at: f64,
}

impl FireScheduler {
    pub fn new(rounds_per_second: f64) -> Self {
        assert!(rounds_per_second.is_finite() && rounds_per_second > 0.0);
        FireScheduler {
            interval: 1.0 / rounds_per_second,
            next_shot_at: 0.0,
        }
    }

    pub fn rounds_per_second(&self) -> f64 {
        1.0 / self.interval
    }

    /// `now` simülasyon zamanı (saniye), `trigger_held` tetiğin durumu.
    /// Dönüş: bu karede ateş edilecek mermi sayısı (0, 1, …).
    pub fn update(&mut self, now: f64, trigger_held: bool) -> u32 {
        if !trigger_held {
            // Bırakılan tetik saati ileri çeker: tekrar basınca tek mermi.
            self.next_shot_at = now;
            return 0;
        }
        if self.next_shot_at < now - self.interval {
            // Aralık uzun süredir dolmadıysa biriktirme yapma.
            self.next_shot_at = now;
        }
        let mut shots = 0u32;
        while self.next_shot_at <= now {
            shots += 1;
            self.next_shot_at += self.interval;
        }
        shots
    }
}

/// Geri tepme, kameraya eklenen sabit ofset değil; 0'a sönen iki eksendir.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct RecoilOffset {
    pub pitch: f64,
    pub yaw: f64,
}

impl RecoilOffset {
    pub fn apply_shot(&mut self, vertical: f64, horizontal: f64, rng: &mut Rng) {
        self.pitch += vertical;
        // Yatay geri tepme tamamen deterministik RNG'den örneklenir.
        self.yaw += (rng.next_f64() * 2.0 - 1.0) * horizontal;
    }

    /// Üstel sönüm; `rate` > 0 (tipik 6–10 /s).
    pub fn recover(&mut self, dt: f64, rate: f64) {
        let k = (-rate.max(0.0) * dt).exp();
        self.pitch *= k;
        self.yaw *= k;
        if self.pitch.abs() < 1e-4 {
            self.pitch = 0.0;
        }
        if self.yaw.abs() < 1e-4 {
            self.yaw = 0.0;
        }
    }
}

/// Saçılım konisi içinde düzlem ofsetleri (sağ/yukarı, radyan).
pub fn cone_offsets(rng: &mut Rng, half_angle_rad: f64) -> (f64, f64) {
    let (rx, ry) = rng.unit_disc();
    (rx * half_angle_rad, ry * half_angle_rad)
}

/// Temel yöne sağ/yukarı ofsetleri uygulayıp normalize eder.
pub fn apply_cone(base: Vec3, right: Vec3, up: Vec3, sx: f64, sy: f64) -> Vec3 {
    (base + right * sx + up * sy).normalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semi_auto_fires_once_per_press() {
        let mut s = FireScheduler::new(9.75);
        // 0.00'da bas, 0.02'de bırak, 0.10'da tekrar bas.
        assert_eq!(s.update(0.00, true), 1);
        assert_eq!(s.update(0.02, false), 0);
        assert_eq!(s.update(0.10, true), 1);
    }

    #[test]
    fn long_pause_does_not_bank_shots() {
        let mut s = FireScheduler::new(10.0); // 100 rpm
        assert_eq!(s.update(0.0, true), 1);
        assert_eq!(s.update(0.01, false), 0);
        // 10 saniyelik boşluktan sonra tekrar: sadece 1 mermi.
        assert_eq!(s.update(10.0, true), 1);
    }

    #[test]
    fn recoil_decays_to_zero() {
        let mut r = RecoilOffset::default();
        let mut rng = Rng::new(1);
        for _ in 0..10 {
            r.apply_shot(0.01, 0.005, &mut rng);
        }
        assert!(r.pitch > 0.05);
        for _ in 0..200 {
            r.recover(1.0 / 60.0, 8.0);
        }
        assert_eq!(r, RecoilOffset::default());
    }

    #[test]
    fn cone_offsets_bounded() {
        let mut rng = Rng::new(123);
        for _ in 0..10_000 {
            let (x, y) = cone_offsets(&mut rng, 0.05);
            assert!((x * x + y * y).sqrt() <= 0.05 + 1e-12);
        }
    }
}
