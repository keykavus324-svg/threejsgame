//! Yürünebilirlik ızgarası: A* (octile heuristic), string-pulling yumuşatma,
//! Bresenham görüş hattı ve siper noktası seçimi. JS sürümündeki `NavGrid`'in
//! sıfır bağımlılıklı Rust karşılığı; ayrı fizik kütüphanesine ihtiyaç duymaz.

use core::cmp::Ordering;
use std::collections::BinaryHeap;

/// Bir siperin açık tarafı (birim buraya, tehdidin tersine saklanır).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoverPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Bariyerin açık tarafını gösteren birim normal (XZ düzlemi).
    pub nx: f64,
    pub nz: f64,
    pub height: f64,
}

#[derive(Debug)]
pub struct NavGrid {
    pub width: usize,
    pub height: usize,
    pub cell: f64,
    pub origin_x: f64,
    pub origin_z: f64,
    pub walk: Vec<bool>,
    pub heights: Vec<f64>,
    pub cover: Vec<CoverPoint>,
}

impl NavGrid {
    /// `walk`/`heights` satır-major; yoksa hepsi yürünebilir düz arazi.
    pub fn new(width: usize, height: usize, cell: f64, origin_x: f64, origin_z: f64) -> Self {
        let n = width * height;
        NavGrid {
            width,
            height,
            cell,
            origin_x,
            origin_z,
            walk: vec![true; n],
            heights: vec![0.0; n],
            cover: Vec::new(),
        }
    }

    pub fn idx(&self, ix: usize, iz: usize) -> usize {
        iz * self.width + ix
    }

    pub fn to_grid(&self, x: f64, z: f64) -> (isize, isize) {
        (
            ((x - self.origin_x) / self.cell).floor() as isize,
            ((z - self.origin_z) / self.cell).floor() as isize,
        )
    }

    pub fn to_world(&self, ix: usize, iz: usize) -> (f64, f64) {
        (
            self.origin_x + (ix as f64 + 0.5) * self.cell,
            self.origin_z + (iz as f64 + 0.5) * self.cell,
        )
    }

    pub fn is_walk(&self, ix: isize, iz: isize) -> bool {
        if ix < 0 || iz < 0 || ix >= self.width as isize || iz >= self.height as isize {
            return false;
        }
        self.walk[self.idx(ix as usize, iz as usize)]
    }

    /// İki nokta arasındaki ızgara hattı tamamen yürünebilir mi?
    pub fn line_clear(&self, ax: f64, az: f64, bx: f64, bz: f64) -> bool {
        let (mut x0, mut z0) = self.to_grid(ax, az);
        let (x1, z1) = self.to_grid(bx, bz);
        let dx = (x1 - x0).abs();
        let dz = -(z1 - z0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sz = if z0 < z1 { 1 } else { -1 };
        let mut err = dx + dz;
        let mut guard = 0usize;
        loop {
            if !self.is_walk(x0, z0) {
                return false;
            }
            if x0 == x1 && z0 == z1 {
                return true;
            }
            guard += 1;
            if guard > 100_000 {
                return false;
            }
            let e2 = 2 * err;
            if e2 >= dz {
                err += dz;
                x0 += sx;
            }
            if e2 <= dx {
                err += dx;
                z0 += sz;
            }
        }
    }

    /// A* yol bulma. Yol yoksa None; hedef hücresi kapalıysa 4 hücre yarıçapında
    /// en yakın açık hücreye oturur. Yol, string-pulling ile yumuşatılır.
    pub fn find_path(&self, fx: f64, fz: f64, tx: f64, tz: f64) -> Option<Vec<(f64, f64)>> {
        let (sx, sz) = self.to_grid(fx, fz);
        let (mut tx_, mut tz_) = self.to_grid(tx, tz);

        if !self.is_walk(tx_, tz_) {
            let mut best: Option<(isize, isize)> = None;
            let mut best_d = i64::MAX;
            for dz in -4isize..=4 {
                for dx in -4isize..=4 {
                    let nx = tx_ + dx;
                    let nz = tz_ + dz;
                    if self.is_walk(nx, nz) {
                        let d = (dx * dx + dz * dz) as i64;
                        if d < best_d {
                            best_d = d;
                            best = Some((nx, nz));
                        }
                    }
                }
            }
            match best {
                Some((x, z)) => {
                    tx_ = x;
                    tz_ = z;
                }
                None => return None,
            }
        }
        if !self.is_walk(sx, sz) {
            return None;
        }

        let start = self.idx(sx as usize, sz as usize);
        let goal = self.idx(tx_ as usize, tz_ as usize);
        let n = self.width * self.height;
        let mut g = vec![f64::INFINITY; n];
        let mut parent = vec![usize::MAX; n];
        let mut closed = vec![false; n];
        g[start] = 0.0;

        let mut open = BinaryHeap::new();
        open.push(Open {
            f: octile(sx, sz, tx_, tz_, self.cell),
            idx: start,
        });

        while let Some(Open { idx, .. }) = open.pop() {
            if idx == goal {
                break;
            }
            if closed[idx] {
                continue;
            }
            closed[idx] = true;
            let cx = (idx % self.width) as isize;
            let cz = (idx / self.width) as isize;
            for dz in -1isize..=1 {
                for dx in -1isize..=1 {
                    if dx == 0 && dz == 0 {
                        continue;
                    }
                    let nx = cx + dx;
                    let nz = cz + dz;
                    if !self.is_walk(nx, nz) {
                        continue;
                    }
                    // Diyagonalde duvar köşesinden kesimmeyi engelle.
                    if dx != 0 && dz != 0 && (!self.is_walk(cx + dx, cz) || !self.is_walk(cx, cz + dz)) {
                        continue;
                    }
                    let ni = self.idx(nx as usize, nz as usize);
                    if closed[ni] {
                        continue;
                    }
                    let step = if dx != 0 && dz != 0 {
                        self.cell * std::f64::consts::SQRT_2
                    } else {
                        self.cell
                    };
                    let ng = g[idx] + step;
                    if ng < g[ni] {
                        g[ni] = ng;
                        parent[ni] = idx;
                        open.push(Open {
                            f: ng + octile(nx, nz, tx_, tz_, self.cell),
                            idx: ni,
                        });
                    }
                }
            }
        }

        if g[goal].is_infinite() {
            return None;
        }

        let mut cells: Vec<(isize, isize)> = Vec::new();
        let mut cur = goal;
        loop {
            cells.push(((cur % self.width) as isize, (cur / self.width) as isize));
            if cur == start {
                break;
            }
            cur = parent[cur];
        }
        cells.reverse();

        // String-pulling: düz hattı kesebildiğimiz en uzak noktaya atla.
        let pts: Vec<(f64, f64)> = cells
            .iter()
            .map(|&(ix, iz)| self.to_world(ix as usize, iz as usize))
            .collect();
        let mut out: Vec<(f64, f64)> = Vec::new();
        let mut anchor = 0usize;
        out.push(pts[0]);
        while anchor < pts.len() - 1 {
            let mut furthest = anchor + 1;
            for j in (anchor + 1)..pts.len() {
                if self.line_clear(pts[anchor].0, pts[anchor].1, pts[j].0, pts[j].1) {
                    furthest = j;
                }
            }
            out.push(pts[furthest]);
            anchor = furthest;
        }
        Some(out)
    }

    /// Tehditten uzaklaşan (normal'i tehdit yönünü göstermeyen) ve `from`'a en
    /// yakın siperi seç. Yoksa None.
    pub fn nearest_cover(
        &self,
        from_x: f64,
        from_z: f64,
        threat_x: f64,
        threat_z: f64,
        radius: f64,
    ) -> Option<CoverPoint> {
        let dx = from_x - threat_x;
        let dz = from_z - threat_z;
        let len = (dx * dx + dz * dz).sqrt();
        let (dx, dz) = if len > 1e-6 { (dx / len, dz / len) } else { (0.0, 1.0) };

        let mut best: Option<CoverPoint> = None;
        let mut best_score = f64::NEGATIVE_INFINITY;
        for c in &self.cover {
            let ox = c.x - from_x;
            let oz = c.z - from_z;
            let dist = (ox * ox + oz * oz).sqrt();
            if dist > radius {
                continue;
            }
            // Açık yüz, tehditten kaçış yönüne bakmalı.
            let facing = c.nx * dx + c.nz * dz;
            if facing < 0.2 {
                continue;
            }
            let score = facing * 2.0 - dist * 0.12;
            if score > best_score {
                best_score = score;
                best = Some(*c);
            }
        }
        best
    }
}

fn octile(ax: isize, az: isize, bx: isize, bz: isize, cell: f64) -> f64 {
    let dx = (ax - bx).abs() as f64;
    let dz = (az - bz).abs() as f64;
    let dmax = dx.max(dz);
    let dmin = dx.min(dz);
    (dmax + (std::f64::consts::SQRT_2 - 1.0) * dmin) * cell
}

#[derive(PartialEq)]
struct Open {
    f: f64,
    idx: usize,
}

impl Eq for Open {}

impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Open {
    fn cmp(&self, other: &Self) -> Ordering {
        // Min-heap: küçük f önce. NaN panik üretmesin diye Equal'a düşür.
        other.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wall_grid() -> NavGrid {
        // 12x12, ortada x=5 sütununda boşluksuz duvar ama z=9'da geçit.
        let mut g = NavGrid::new(12, 12, 1.0, 0.0, 0.0);
        for z in 0..12 {
            if z != 9 {
                g.walk[g.idx(5, z)] = false;
            }
        }
        g
    }

    #[test]
    fn path_goes_through_gap() {
        let g = wall_grid();
        let path = g.find_path(1.5, 1.5, 10.5, 1.5).expect("yol bulunmalı");
        // Geçit z≈9 hücresinden geçmeli.
        assert!(path.iter().any(|&(_, z)| (8.0..=10.0).contains(&z)));
        assert!(path.len() >= 2);
    }

    #[test]
    fn wall_blocks_line_of_fire() {
        let g = wall_grid();
        assert!(!g.line_clear(1.0, 2.0, 10.0, 2.0));
        assert!(g.line_clear(1.0, 9.5, 10.0, 9.5));
    }

    #[test]
    fn unreachable_returns_none() {
        let mut g = NavGrid::new(8, 8, 1.0, 0.0, 0.0);
        for z in 0..8 {
            g.walk[g.idx(4, z)] = false;
        }
        assert!(g.find_path(1.0, 1.0, 6.0, 1.0).is_none());
    }

    #[test]
    fn cover_picks_threat_opposing_side() {
        let mut g = wall_grid();
        g.cover.push(CoverPoint { x: 1.0, y: 0.0, z: 1.0, nx: 0.0, nz: 1.0, height: 1.2 });
        g.cover.push(CoverPoint { x: 3.0, y: 0.0, z: 1.0, nx: 0.0, nz: -1.0, height: 1.2 });
        // Tehdit kuzeyde (z çok küçük): birim z=+2 tarafında saklanmalı.
        let c = g
            .nearest_cover(0.5, 2.0, 0.5, -5.0, 5.0)
            .expect("siper bulunmalı");
        assert!(c.nz > 0.0);
    }
}
