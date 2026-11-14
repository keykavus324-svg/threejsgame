//! Uniform-grid spatial hash — JS `SpatialHash`'in karşılığı. AI "en yakın"
//! sorgularını O(n²) yerine ~O(1)'e indirir.

use std::collections::HashMap;

#[derive(Debug)]
pub struct SpatialHash {
    pub cell: f64,
    points: Vec<(f64, f64)>,
    cells: HashMap<(i32, i32), Vec<usize>>,
}

impl SpatialHash {
    pub fn new(cell: f64) -> Self {
        assert!(cell > 0.0);
        SpatialHash {
            cell,
            points: Vec::new(),
            cells: HashMap::new(),
        }
    }

    pub fn clear(&mut self) {
        self.points.clear();
        self.cells.clear();
    }

    pub fn insert(&mut self, x: f64, z: f64) -> usize {
        let id = self.points.len();
        self.points.push((x, z));
        let key = self.key(x, z);
        self.cells.entry(key).or_default().push(id);
        id
    }

    pub fn rebuild(&mut self, points: &[(f64, f64)]) {
        self.clear();
        for &(x, z) in points {
            self.insert(x, z);
        }
    }

    pub fn len(&self) -> usize {
        self.points.len()
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    pub fn point(&self, id: usize) -> (f64, f64) {
        self.points[id]
    }

    fn key(&self, x: f64, z: f64) -> (i32, i32) {
        (
            (x / self.cell).floor() as i32,
            (z / self.cell).floor() as i32,
        )
    }

    /// `radius` içindeki tüm id'leri döner.
    pub fn query(&self, x: f64, z: f64, radius: f64) -> Vec<usize> {
        let r = (radius / self.cell).ceil() as i32;
        let (cx, cz) = self.key(x, z);
        let mut out = Vec::new();
        let r2 = radius * radius;
        for dz in -r..=r {
            for dx in -r..=r {
                if let Some(bucket) = self.cells.get(&(cx + dx, cz + dz)) {
                    for &id in bucket {
                        let (px, pz) = self.points[id];
                        let ddx = px - x;
                        let ddz = pz - z;
                        if ddx * ddx + ddz * ddz <= r2 {
                            out.push(id);
                        }
                    }
                }
            }
        }
        out
    }

    /// Yarıçap içinde `filter`'ı geçen en yakın id.
    pub fn nearest(
        &self,
        x: f64,
        z: f64,
        radius: f64,
        filter: impl Fn(usize) -> bool,
    ) -> Option<usize> {
        let mut best: Option<usize> = None;
        let mut best_d2 = radius * radius;
        for id in self.query(x, z, radius) {
            if !filter(id) {
                continue;
            }
            let (px, pz) = self.points[id];
            let dx = px - x;
            let dz = pz - z;
            let d2 = dx * dx + dz * dz;
            if d2 <= best_d2 {
                best_d2 = d2;
                best = Some(id);
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_respects_filter() {
        let mut h = SpatialHash::new(8.0);
        h.rebuild(&[(0.0, 0.0), (5.0, 0.0), (100.0, 100.0)]);
        // (5,0)'a en yakın ama filtreden geçen → (0,0).
        let found = h.nearest(10.0, 0.0, 20.0, |id| id == 0);
        assert_eq!(found, Some(0));
        assert_eq!(h.nearest(50.0, 50.0, 10.0, |_| true), None);
    }

    #[test]
    fn query_finds_exactly_the_cluster() {
        let mut h = SpatialHash::new(4.0);
        for i in 0..10 {
            h.insert(i as f64 * 1.5, 0.0);
        }
        h.insert(500.0, 500.0);
        let near = h.query(0.0, 0.0, 5.0);
        assert!(near.contains(&0));
        assert!(!near.contains(&10));
        assert!(near.len() <= 5);
    }
}
