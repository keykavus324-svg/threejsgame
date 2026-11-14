//! Dalga yöneticisi — JS `_waveLogic`'in saf Rust karşılığı, deterministik.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WavePhase {
    Intermission,
    Running,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WaveSpec {
    pub index: u32,
    pub infantry: u32,
    pub heavies: u32,
    pub snipers: u32,
    pub apc: u32,
}

impl WaveSpec {
    pub fn total(&self) -> u32 {
        self.infantry + self.heavies + self.snipers + self.apc
    }
}

/// Zorluk (0 ACEMİ, 1 MUHARİP, 2 CEHENNEM) asker sayısını ölçekler;
/// APC yalnızca 4+ dalgalarda, sniper 3+ dalgalarda, ağır 2+ dalgalarda.
pub fn wave_spec(index: u32, difficulty: u32) -> WaveSpec {
    let i = index.max(1);
    let scale = 1.0 + difficulty as f64 * 0.35;
    WaveSpec {
        index: i,
        infantry: ((5.0 + i as f64 * 2.0) * scale).round() as u32,
        heavies: if i >= 2 {
            (i as f64 * scale).round() as u32
        } else {
            0
        },
        snipers: if i >= 3 {
            ((i - 1) as f64 * scale).round() as u32
        } else {
            0
        },
        apc: if i >= 4 { i - 3 } else { 0 },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaveEvent {
    WaveStarted { index: u32, total: u32 },
    WaveCleared { index: u32 },
    MissionComplete,
}

#[derive(Debug, Clone)]
pub struct WaveDirector {
    pub wave: u32,
    pub remaining: u32,
    pub phase: WavePhase,
    pub intermission_left: f64,
    pub max_waves: u32,
    pub difficulty: u32,
}

impl WaveDirector {
    pub fn new(difficulty: u32) -> Self {
        WaveDirector {
            wave: 1,
            remaining: 0,
            phase: WavePhase::Intermission,
            intermission_left: 5.0,
            max_waves: 6,
            difficulty,
        }
    }

    pub fn step(&mut self, dt: f64) -> Option<WaveEvent> {
        match self.phase {
            WavePhase::Intermission => {
                self.intermission_left -= dt;
                if self.intermission_left <= 0.0 {
                    let spec = wave_spec(self.wave, self.difficulty);
                    let total = spec.total();
                    self.remaining = total;
                    self.phase = WavePhase::Running;
                    Some(WaveEvent::WaveStarted {
                        index: self.wave,
                        total,
                    })
                } else {
                    None
                }
            }
            WavePhase::Running => {
                if self.remaining == 0 {
                    let cleared = self.wave;
                    if self.wave >= self.max_waves {
                        return Some(WaveEvent::MissionComplete);
                    }
                    self.wave += 1;
                    self.phase = WavePhase::Intermission;
                    self.intermission_left = 11.0;
                    Some(WaveEvent::WaveCleared { index: cleared })
                } else {
                    None
                }
            }
        }
    }

    pub fn unit_killed(&mut self) {
        if self.remaining > 0 {
            self.remaining -= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specs_scale_with_difficulty() {
        let easy = wave_spec(4, 0);
        let hard = wave_spec(4, 2);
        assert!(hard.total() > easy.total());
        assert!(wave_spec(1, 0).heavies == 0);
        assert!(wave_spec(4, 0).apc >= 1);
        assert!(wave_spec(3, 0).snipers >= 1);
    }

    #[test]
    fn full_arc_to_completion() {
        let mut d = WaveDirector::new(1);
        // İlk dalga 5 s beklemeden başlamaz.
        assert_eq!(d.step(4.9), None);
        assert_eq!(
            d.step(0.2),
            Some(WaveEvent::WaveStarted { index: 1, total: d.remaining })
        );
        for wave in 1..=6u32 {
            while d.remaining > 0 {
                d.unit_killed();
            }
            let ev = d.step(0.01);
            if wave < 6 {
                assert_eq!(ev, Some(WaveEvent::WaveCleared { index: wave }));
                // İnterval dolunca sıradaki dalga başlar (total yeni kalan).
                assert_eq!(
                    d.step(11.1),
                    Some(WaveEvent::WaveStarted { index: wave + 1, total: d.remaining })
                );
            } else {
                assert_eq!(ev, Some(WaveEvent::MissionComplete));
            }
        }
    }
}
