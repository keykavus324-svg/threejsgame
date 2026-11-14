//! Entegrasyon testleri: NavGrid A*, görev akışı, kayıtlı ilerleme.

use iron_horizon_core::grid::{CoverPoint, NavGrid};
use iron_horizon_core::mission::{GameEvent, Mission, RegionOwner};
use iron_horizon_core::save::{rank_for_xp, SaveData};
use iron_horizon_core::waves::WavePhase;

fn open_map(n: usize) -> NavGrid {
    NavGrid::new(n, n, 2.0, 0.0, 0.0)
}

#[test]
fn a_star_finds_path_around_block() {
    let mut g = open_map(16);
    // 12 m duvar; sadece alt uçtan geçit.
    for y in 2..14 {
        if y == 12 {
            continue;
        }
        if let Ok(x) = usize::try_from(8usize) {
            g.walk[g.idx(x, y)] = false;
        }
    }
    let path = g
        .find_path(2.0, 2.0, 30.0, 2.0)
        .expect("yol bulunmalı");
    assert!(path.len() >= 2);
    // Son nokta hedefe yakın olmalı.
    let (lx, lz) = path[path.len() - 1];
    assert!((lx - 30.0).abs() < g.cell && (lz - 2.0).abs() < g.cell);
}

#[test]
fn a_star_returns_none_when_walled_off() {
    let mut g = open_map(10);
    for y in 0..10 {
        g.walk[g.idx(5, y)] = false;
    }
    assert!(g.find_path(1.0, 1.0, 17.0, 1.0).is_none());
}

#[test]
fn nearest_cover_prefers_side_facing_away_from_threat() {
    let mut g = open_map(16);
    g.cover.push(CoverPoint { x: 4.0, y: 0.0, z: 4.0, nx: 0.0, nz: 1.0, height: 1.1 });
    g.cover.push(CoverPoint { x: 4.0, y: 0.0, z: 6.0, nx: 0.0, nz: -1.0, height: 1.1 });
    // Tehdit z=-100'de; birim z=5'te duruyor. Açık yüzü +z olan siper seçilmeli.
    let c = g
        .nearest_cover(4.0, 5.0, 4.0, -100.0, 10.0)
        .expect("siper bulunmalı");
    assert!(c.nz > 0.0);
}

#[test]
fn mission_runs_and_ends_in_victory_when_waves_die() {
    let mut m = Mission::new(0);
    let dt = 1.0 / 60.0;
    let mut t = 0.0;
    let mut events = Vec::new();
    while t < 60.0 * 60.0 && !m.finished {
        events.extend(m.step(dt));
        t += dt;
        // Her çalışan dalgayı anında yok say (tanrı modu).
        if m.director.phase == WavePhase::Running && m.director.remaining > 0 {
            m.on_enemy_killed(m.director.remaining);
        }
    }
    assert!(m.finished, "görev bitmeliydi (t = {t})");
    assert!(events.iter().any(|e| matches!(e, GameEvent::Victory)));
}

#[test]
fn mission_defeat_when_all_three_regions_lost() {
    let mut m = Mission::new(2);
    m.regions = [RegionOwner::Enemy; 3];
    // Dalgaları dokunma: bölgeler düşman elinde kaldıkça biletler erir,
    // hezimet kaçınılmaz (~90 s). Zafer yolu bu senaryoda yoktur.
    let dt = 1.0 / 60.0;
    let mut t = 0.0;
    let mut events = Vec::new();
    while t < 120.0 && !m.finished {
        events.extend(m.step(dt));
        t += dt;
    }
    assert!(events.iter().any(|e| matches!(e, GameEvent::Defeat)));
    assert_eq!(m.ally_tickets, 0.0);
}

#[test]
fn save_progression_unlocks_launcher_at_rank_5() {
    let mut s = SaveData::default();
    let unlocked = s.add_xp(10_000);
    assert!(s.rank >= 5, "rank = {}", s.rank);
    assert!(unlocked.contains(&"launcher") || s.unlocked.iter().any(|u| u == "launcher"));
    assert_eq!(rank_for_xp(500), 2);
}
