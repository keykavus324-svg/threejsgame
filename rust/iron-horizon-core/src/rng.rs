//! Deterministik RNG: tüm platformlarda aynı diziyi üretir (platform libm'ine
//! bağımlı `rand` crate'i yerine bilinçli olarak el yazması xorshift64*).

/// Deterministik 64-bit xorshift64* sözde-rastgele üreteci.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        // 0 tohumunu anlamlı bir sabite çevir (0 yutakta sıkışır).
        let s = if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed };
        Rng(s)
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// [0, 1) aralığında f64.
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }

    /// [lo, hi) aralığında f64.
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.next_f64()
    }

    /// [lo, hi] kapalı aralıkta tam sayı (modulo yanlılığı ihmal edilebilir
    /// oyun dengesi amaçları için).
    pub fn int(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        lo + (self.next_u64() % ((hi - lo + 1) as u64)) as i64
    }

    /// Birim diskten düzgün örnek (saçılım konisi için).
    pub fn unit_disc(&mut self) -> (f64, f64) {
        let a = self.next_f64() * std::f64::consts::TAU;
        let r = self.next_f64().sqrt();
        (a.cos() * r, a.sin() * r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn f64_in_unit_range() {
        let mut r = Rng::new(7);
        for _ in 0..10_000 {
            let v = r.next_f64();
            assert!((0.0..1.0).contains(&v));
        }
    }

    #[test]
    fn unit_disc_bounded() {
        let mut r = Rng::new(99);
        for _ in 0..10_000 {
            let (x, y) = r.unit_disc();
            assert!(x * x + y * y <= 1.0 + 1e-9);
        }
    }
}
