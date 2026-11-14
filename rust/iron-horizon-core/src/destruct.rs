//! Yıkılabilir objeler — JS `world.damagePropsInRadius`'un saf hali.
//! Patlama/roket/tank topu bu listeye uygulanır; yıkılan id'ler döner ki
//! çağrı tarafı çarpışma ve NavGrid'i güncelleyebilsin.

#[derive(Debug, Clone, PartialEq)]
pub struct Destructible {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub broken: bool,
    pub label: &'static str,
}

impl Destructible {
    pub fn new(id: usize, x: f64, y: f64, z: f64, hp: f64, label: &'static str) -> Self {
        Destructible {
            id,
            x,
            y,
            z,
            hp,
            max_hp: hp,
            broken: false,
            label,
        }
    }

    pub fn health_fraction(&self) -> f64 {
        if self.max_hp <= 0.0 {
            0.0
        } else {
            (self.hp / self.max_hp).clamp(0.0, 1.0)
        }
    }
}

/// `center` etrafında `radius` içindeki sağlam objelere hasar uygular;
/// yeni yıkılanların id'lerini döner.
/// Hasar kademesi: menzilde %60'a kadar doğrusal azalır (JS ile aynı).
pub fn apply_radial_damage(
    list: &mut [Destructible],
    cx: f64,
    cy: f64,
    cz: f64,
    radius: f64,
    damage: f64,
) -> Vec<usize> {
    let mut destroyed = Vec::new();
    if radius <= 0.0 {
        return destroyed;
    }
    for d in list.iter_mut() {
        if d.broken {
            continue;
        }
        let dx = d.x - cx;
        let dy = d.y - cy;
        let dz = d.z - cz;
        let dist = (dx * dx + dy * dy + dz * dz).sqrt();
        if dist > radius {
            continue;
        }
        let falloff = 1.0 - dist / radius * 0.6;
        d.hp -= damage * falloff;
        if d.hp <= 0.0 {
            d.hp = 0.0;
            d.broken = true;
            destroyed.push(d.id);
        }
    }
    destroyed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<Destructible> {
        vec![
            Destructible::new(0, 0.0, 0.0, 0.0, 50.0, "container"),
            Destructible::new(1, 3.0, 0.0, 0.0, 50.0, "crate"),
            Destructible::new(2, 40.0, 0.0, 0.0, 50.0, "barrel"),
        ]
    }

    #[test]
    fn radius_limits_damage() {
        let mut list = sample();
        let destroyed = apply_radial_damage(&mut list, 0.0, 0.0, 0.0, 5.0, 60.0);
        assert!(destroyed.contains(&0));
        assert!(destroyed.contains(&1));
        assert!(!destroyed.contains(&2));
        assert!(list[2].hp == 50.0);
    }

    #[test]
    fn already_broken_is_not_double_counted() {
        let mut list = sample();
        let first = apply_radial_damage(&mut list, 0.0, 0.0, 0.0, 50.0, 200.0);
        let second = apply_radial_damage(&mut list, 0.0, 0.0, 0.0, 50.0, 200.0);
        assert_eq!(first.len(), 3);
        assert!(second.is_empty());
    }

    #[test]
    fn falloff_reduces_edge_damage() {
        let mut list = sample();
        // 3 m uzakta, 5 m yarıçapta: 1 - 3/5*0.6 = 0.64 çarpan.
        apply_radial_damage(&mut list, 0.0, 0.0, 0.0, 5.0, 50.0);
        assert!((list[1].hp - (50.0 - 50.0 * 0.64)).abs() < 1e-9);
    }
}
