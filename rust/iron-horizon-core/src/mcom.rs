//! MCOM uplink istasyonu — JS sürümündeki "Bölge sende iken şarj olur"
//! mantığının deterministik hali. Bölge müttefik ise şarj olur (~18 s),
//! değilse sönümlenir; tam şarj görevi ödülleri tetikler.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McomState {
    Inactive,
    Charging,
    Complete,
}

#[derive(Debug, Clone)]
pub struct McomStation {
    pub id: u32,
    pub charge: f64,
    pub state: McomState,
    /// Saniyede şarj (0.055 → ~18 s).
    pub rate: f64,
    /// Saniyede sönüm.
    pub decay: f64,
}

impl McomStation {
    pub fn new(id: u32) -> Self {
        McomStation {
            id,
            charge: 0.0,
            state: McomState::Inactive,
            rate: 0.055,
            decay: 0.09,
        }
    }

    /// Bir adım. `held_by_ally`: istasyonun bölgesi müttefikte mi?
    /// Tam şarj anında `Some(())` döner (bir kez).
    pub fn step(&mut self, dt: f64, held_by_ally: bool) -> Option<()> {
        if self.state == McomState::Complete {
            return None;
        }
        if held_by_ally {
            self.state = McomState::Charging;
            self.charge += self.rate * dt;
            if self.charge >= 1.0 {
                self.charge = 1.0;
                self.state = McomState::Complete;
                return Some(());
            }
        } else {
            self.charge -= self.decay * dt;
            if self.charge <= 0.0 {
                self.charge = 0.0;
                self.state = McomState::Inactive;
            } else {
                self.state = McomState::Charging;
            }
        }
        None
    }

    pub fn charge_fraction(&self) -> f64 {
        self.charge
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn charges_and_completes_once() {
        let mut s = McomStation::new(0);
        let mut fired = 0;
        for _ in 0..2000 {
            if s.step(1.0 / 60.0, true).is_some() {
                fired += 1;
            }
        }
        assert_eq!(fired, 1);
        assert_eq!(s.state, McomState::Complete);
        // Tam şarjdan sonra tekrar tetiklenmez.
        assert!(s.step(1.0, true).is_none());
    }

    #[test]
    fn decays_when_region_lost() {
        let mut s = McomStation::new(1);
        for _ in 0..300 {
            s.step(1.0 / 60.0, true);
        }
        let half = s.charge;
        assert!(half > 0.2);
        for _ in 0..600 {
            s.step(1.0 / 60.0, false);
        }
        assert_eq!(s.state, McomState::Inactive);
        assert_eq!(s.charge, 0.0);
    }
}
