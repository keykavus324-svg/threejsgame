//! Görev orkestratörü: biletler, bölgel erimesi, MCOM ödülleri, dalga olayları.
//! JS `_waveLogic` + `_ticketLogic` + MCOM mantığının saf çekirdeği;
//! render/girdi/ses bilmez, bu yüzden tamamen headless test edilebilir.

use crate::mcom::McomStation;
use crate::waves::{WaveDirector, WaveEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegionOwner {
    Neutral,
    Ally,
    Enemy,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameEvent {
    WaveStarted { index: u32, total: u32 },
    WaveCleared { index: u32 },
    FinalWaveCleared,
    McomComplete { id: u32, score: u64, tickets: f64 },
    Victory,
    Defeat,
}

#[derive(Debug, Clone)]
pub struct Mission {
    pub ally_tickets: f64,
    pub enemy_tickets: f64,
    pub regions: [RegionOwner; 3],
    pub difficulty: u32,
    pub score: u64,
    pub mcom: Vec<McomStation>,
    pub director: WaveDirector,
    pub elapsed: f64,
    pub finished: bool,
}

impl Mission {
    pub fn new(difficulty: u32) -> Self {
        Mission {
            ally_tickets: 300.0,
            enemy_tickets: 108.0 + difficulty as f64 * 18.0,
            regions: [RegionOwner::Neutral; 3],
            difficulty,
            score: 0,
            mcom: vec![McomStation::new(0), McomStation::new(1), McomStation::new(2)],
            director: WaveDirector::new(difficulty),
            elapsed: 0.0,
            finished: false,
        }
    }

    /// `dt` saniyelik simülasyon adımı; oluşan olayları döner.
    pub fn step(&mut self, dt: f64) -> Vec<GameEvent> {
        let mut events = Vec::new();
        if self.finished {
            return events;
        }
        self.elapsed += dt;

        // --- Bilet erimesi (JS: enemyOwned > allyOwned iken dt*fark*katsayı)
        let enemy_owned = self
            .regions
            .iter()
            .filter(|r| **r == RegionOwner::Enemy)
            .count() as f64;
        let ally_owned = self
            .regions
            .iter()
            .filter(|r| **r == RegionOwner::Ally)
            .count() as f64;
        if enemy_owned > ally_owned {
            self.ally_tickets -= dt * (enemy_owned - ally_owned) * (0.55 + self.difficulty as f64 * 0.16);
        }
        if enemy_owned == 3.0 {
            self.ally_tickets -= dt * 0.7;
        }

        // --- MCOM şarjı ve tamamlanma ödülleri
        for i in 0..self.mcom.len() {
            let owned = self.regions[i] == RegionOwner::Ally;
            if self.mcom[i].step(dt, owned).is_some() {
                self.ally_tickets += 25.0;
                self.score += 500;
                events.push(GameEvent::McomComplete {
                    id: i as u32,
                    score: 500,
                    tickets: 25.0,
                });
            }
        }

        // --- Dalga makinesi
        let mut final_cleared = false;
        if let Some(ev) = self.director.step(dt) {
            match ev {
                WaveEvent::WaveStarted { index, total } => {
                    events.push(GameEvent::WaveStarted { index, total });
                }
                WaveEvent::WaveCleared { index } => {
                    self.score += 500 * index as u64;
                    events.push(GameEvent::WaveCleared { index });
                }
                WaveEvent::MissionComplete => {
                    self.score += 500 * self.director.max_waves as u64;
                    final_cleared = true;
                    events.push(GameEvent::FinalWaveCleared);
                }
            }
        }

        // --- Zafer / hezimet
        if self.ally_tickets <= 0.0 {
            self.ally_tickets = 0.0;
            self.finished = true;
            events.push(GameEvent::Defeat);
        } else if self.enemy_tickets <= 0.0 || final_cleared {
            self.finished = true;
            events.push(GameEvent::Victory);
        }
        events
    }

    /// Düşman birimi öldürüldüğünde çağrılır (bilet ve dalga sayacı).
    pub fn on_enemy_killed(&mut self, count: u32) {
        for _ in 0..count {
            self.director.unit_killed();
            self.enemy_tickets = (self.enemy_tickets - 1.0).max(0.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step_until<F: Fn(&Mission) -> bool>(m: &mut Mission, max_s: f64, pred: F) -> Vec<GameEvent> {
        let dt = 1.0 / 60.0;
        let mut all = Vec::new();
        let mut t = 0.0;
        while t < max_s && !pred(m) {
            all.extend(m.step(dt));
            t += dt;
        }
        all
    }

    #[test]
    fn enemy_holding_three_regions_drains_tickets() {
        let mut m = Mission::new(2);
        m.regions = [RegionOwner::Enemy; 3];
        let before = m.ally_tickets;
        step_until(&mut m, 10.0, |_| false);
        assert!(m.ally_tickets < before - 10.0);
    }

    #[test]
    fn mcom_completion_grants_tickets_and_score() {
        let mut m = Mission::new(1);
        m.regions = [RegionOwner::Ally, RegionOwner::Neutral, RegionOwner::Neutral];
        let before_tickets = m.ally_tickets;
        let before_score = m.score;
        let events = step_until(&mut m, 25.0, |mm| mm.mcom[0].charge >= 1.0);
        // Şarj ~18 s sürer; 25 s içinde tamamlanmalı.
        assert!(events
            .iter()
            .any(|e| matches!(e, GameEvent::McomComplete { id: 0, .. })));
        assert!(m.ally_tickets > before_tickets);
        assert_eq!(m.score, before_score + 500);
    }

    #[test]
    fn defeat_event_when_tickets_run_out() {
        let mut m = Mission::new(2);
        m.regions = [RegionOwner::Enemy; 3];
        m.ally_tickets = 1.0;
        let events = step_until(&mut m, 60.0, |mm| mm.finished);
        assert!(events.iter().any(|e| matches!(e, GameEvent::Defeat)));
        assert_eq!(m.ally_tickets, 0.0);
    }

    #[test]
    fn killing_wave_advances_director() {
        let mut m = Mission::new(0);
        step_until(&mut m, 6.0, |mm| mm.director.phase == crate::waves::WavePhase::Running);
        assert_eq!(m.director.wave, 1);
        assert!(m.director.remaining > 0);
        m.on_enemy_killed(m.director.remaining);
        let events = m.step(0.01);
        assert!(events.iter().any(|e| matches!(e, GameEvent::WaveCleared { index: 1 })));
        assert!(m.score >= 500);
    }
}
