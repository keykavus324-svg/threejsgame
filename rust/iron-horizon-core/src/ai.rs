//! Birim AI'sı — fps-shooter skill'inin "insani" kuralları: tespit sonrası
//! tepki gecikmesi (0.3–0.6 s), baskı altında siper, sönümlenen bastırılma.
//! Kararlar deterministiktir (aynı girdi → aynı çıktı).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiState {
    Advance,
    Spotted,
    Engaging,
    TakingCover,
}

#[derive(Debug, Clone, Copy)]
pub struct AiConfig {
    /// İlk atış öncesi tepki süresi (saniye).
    pub reaction_s: f64,
    /// Bu eşik aşılınca birim siper alır.
    pub suppression_cover: f64,
    /// Bastırılmanın saniye başı doğal sönümü.
    pub suppression_decay: f64,
    /// Bastırılmanın saniye başı eklenme hızı (ateş altındayken).
    pub suppression_gain: f64,
}

impl Default for AiConfig {
    fn default() -> Self {
        AiConfig {
            reaction_s: 0.45,
            suppression_cover: 0.6,
            suppression_decay: 0.25,
            suppression_gain: 0.8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AiIntent {
    /// Hedefe doğru ilerle.
    AdvanceTo(f64, f64),
    /// Görüşte ama tepki süresi dolmadı.
    HoldPosition,
    /// Ateş et.
    Fire,
    /// Bastırılma nedeniyle siper al.
    TakeCover,
}

#[derive(Debug, Clone)]
pub struct UnitAi {
    pub id: u64,
    pub faction: u8,
    pub x: f64,
    pub z: f64,
    pub health: f64,
    pub state: AiState,
    /// Hedef görüşte kaldığı sürece biriken süre (s).
    pub spotted_timer: f64,
    /// 0..1; yüksek değer = bastırılmış.
    pub suppression: f64,
}

impl UnitAi {
    pub fn new(id: u64, faction: u8, x: f64, z: f64) -> Self {
        UnitAi {
            id,
            faction,
            x,
            z,
            health: 100.0,
            state: AiState::Advance,
            spotted_timer: 0.0,
            suppression: 0.0,
        }
    }

    /// Bir adımlık karar. `sees_target`: görüş hattı açık ve hedef menzilde.
    /// `under_fire`: bu karede birim ateş altında. `target`: düşman konumu.
    pub fn update(
        &mut self,
        cfg: &AiConfig,
        dt: f64,
        sees_target: bool,
        under_fire: bool,
        target: Option<(f64, f64)>,
    ) -> AiIntent {
        if under_fire {
            self.suppression = (self.suppression + cfg.suppression_gain * dt).min(1.0);
        } else {
            self.suppression = (self.suppression - cfg.suppression_decay * dt).max(0.0);
        }

        if self.suppression >= cfg.suppression_cover {
            self.state = AiState::TakingCover;
            self.spotted_timer = 0.0;
            return AiIntent::TakeCover;
        }

        if sees_target {
            self.spotted_timer += dt;
            if self.spotted_timer >= cfg.reaction_s {
                self.state = AiState::Engaging;
                AiIntent::Fire
            } else {
                self.state = AiState::Spotted;
                AiIntent::HoldPosition
            }
        } else {
            // Görüş kaybolunca bilgi soğur: yarı hızda geri sayar.
            self.spotted_timer = (self.spotted_timer - dt * 0.5).max(0.0);
            self.state = AiState::Advance;
            match target {
                Some((tx, tz)) => AiIntent::AdvanceTo(tx, tz),
                None => AiIntent::HoldPosition,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reaction_delay_blocks_instant_fire() {
        let cfg = AiConfig::default();
        let mut u = UnitAi::new(1, 0, 0.0, 0.0);
        // 0.45 s tepkisi dolana kadar ateş yok.
        assert_eq!(u.update(&cfg, 0.2, true, false, Some((10.0, 0.0))), AiIntent::HoldPosition);
        assert_eq!(u.update(&cfg, 0.2, true, false, Some((10.0, 0.0))), AiIntent::HoldPosition);
        // 0.4 s sonra hâlâ... (0.2+0.2=0.4 < 0.45)
        assert_eq!(u.update(&cfg, 0.1, true, false, Some((10.0, 0.0))), AiIntent::Fire);
    }

    #[test]
    fn suppression_forces_cover() {
        let cfg = AiConfig::default();
        let mut u = UnitAi::new(2, 0, 0.0, 0.0);
        // 0.8/s kazanç; 0.6 eşiği için ~0.75 s sürekli ateş gerekir.
        for _ in 0..12 {
            u.update(&cfg, 1.0 / 12.0, true, true, Some((10.0, 0.0)));
        }
        assert_eq!(u.state, AiState::TakingCover);
        let intent = u.update(&cfg, 1.0 / 60.0, true, true, Some((10.0, 0.0)));
        assert_eq!(intent, AiIntent::TakeCover);
    }

    #[test]
    fn suppression_decays_when_safe() {
        let cfg = AiConfig::default();
        let mut u = UnitAi::new(3, 0, 0.0, 0.0);
        u.suppression = 0.5;
        for _ in 0..60 {
            u.update(&cfg, 1.0 / 30.0, false, false, Some((10.0, 0.0)));
        }
        assert!(u.suppression < 0.1);
    }
}
