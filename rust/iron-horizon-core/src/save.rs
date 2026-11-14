//! İlerleme kaydı — XP eşikleri, rütbe adları, rütbe ile açılan silahlar ve
//! satır tabanlı `IRON_HORIZON_SAVE v3` formatı (harici serde bağımlılığı yok).

use core::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveError(pub String);

impl fmt::Display for SaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "save hatası: {}", self.0)
    }
}

impl std::error::Error for SaveError {}

pub const XP_THRESHOLDS: [u64; 10] = [0, 500, 1400, 3000, 5600, 9500, 15_000, 23_000, 34_000, 50_000];
pub const RANK_NAMES: [&str; 10] = [
    "ER",
    "ONBAŞI",
    "ÇAVUŞ",
    "BAŞÇAVUŞ",
    "ASTEĞMEN",
    "TEĞMEN",
    "ÜSTEĞMEN",
    "YÜZBAŞI",
    "BİNBAYI",
    "ALBAY",
];

/// Rütbe → yeni açılan silah id'leri.
pub fn unlocks_for_rank(rank: u32) -> Vec<&'static str> {
    match rank {
        2 => vec!["dmr"],
        3 => vec!["lmg"],
        4 => vec!["shotgun"],
        5 => vec!["launcher"],
        _ => Vec::new(),
    }
}

pub fn rank_for_xp(xp: u64) -> u32 {
    let mut rank = 1u32;
    for (i, &threshold) in XP_THRESHOLDS.iter().enumerate() {
        if xp >= threshold {
            rank = (i + 1) as u32;
        }
    }
    rank
}

#[derive(Debug, Clone, PartialEq)]
pub struct SaveData {
    pub xp: u64,
    pub rank: u32,
    pub kills: u64,
    pub wins: u64,
    pub matches: u64,
    pub best_score: u64,
    pub unlocked: Vec<String>,
    pub class: String,
}

impl Default for SaveData {
    fn default() -> Self {
        SaveData {
            xp: 0,
            rank: 1,
            kills: 0,
            wins: 0,
            matches: 0,
            best_score: 0,
            unlocked: vec!["ar".to_string(), "smg".to_string()],
            class: "assault".to_string(),
        }
    }
}

impl SaveData {
    pub fn rank_name(&self) -> &'static str {
        RANK_NAMES[(self.rank.clamp(1, 10) - 1) as usize]
    }

    /// XP ekle; rütbe atlandıysa yeni açılan silah id'lerini döner.
    pub fn add_xp(&mut self, amount: u64) -> Vec<&'static str> {
        self.xp = self.xp.saturating_add(amount);
        let new_rank = rank_for_xp(self.xp);
        let old_rank = self.rank;
        let mut newly: Vec<&'static str> = Vec::new();
        for rank in (old_rank + 1)..=new_rank {
            for w in unlocks_for_rank(rank) {
                if !self.unlocked.iter().any(|u| u == w) {
                    self.unlocked.push(w.to_string());
                    newly.push(w);
                }
            }
        }
        self.rank = new_rank;
        newly
    }

    pub fn serialize(&self) -> String {
        let mut s = String::new();
        s.push_str("IRON_HORIZON_SAVE v3\n");
        s.push_str(&format!("xp {}\n", self.xp));
        s.push_str(&format!("rank {}\n", self.rank));
        s.push_str(&format!("kills {}\n", self.kills));
        s.push_str(&format!("wins {}\n", self.wins));
        s.push_str(&format!("matches {}\n", self.matches));
        s.push_str(&format!("best_score {}\n", self.best_score));
        s.push_str(&format!("unlocked {}\n", self.unlocked.join(",")));
        s.push_str(&format!("class {}\n", self.class));
        s
    }

    pub fn parse(input: &str) -> Result<SaveData, SaveError> {
        let mut lines = input.lines();
        let header = lines.next().ok_or_else(|| SaveError("boş dosya".into()))?;
        if header.trim() != "IRON_HORIZON_SAVE v3" {
            return Err(SaveError(format!("bilinmeyen başlık: {header:?}")));
        }
        let mut data = SaveData::default();
        // Varsayılanı temiz başla; dosyada eksik alanlar varsayılana düşer.
        data.unlocked.clear();
        for raw in lines {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let key = parts.next().unwrap_or("");
            let value = parts.next().unwrap_or("");
            match key {
                "xp" => {
                    data.xp = value.parse().map_err(|_| SaveError(format!("xp geçersiz: {value}")))?;
                }
                "rank" => {
                    data.rank = value.parse().map_err(|_| SaveError(format!("rank geçersiz: {value}")))?;
                }
                "kills" => {
                    data.kills = value.parse().map_err(|_| SaveError(format!("kills geçersiz: {value}")))?;
                }
                "wins" => {
                    data.wins = value.parse().map_err(|_| SaveError(format!("wins geçersiz: {value}")))?;
                }
                "matches" => {
                    data.matches = value.parse().map_err(|_| SaveError(format!("matches geçersiz: {value}")))?;
                }
                "best_score" => {
                    data.best_score =
                        value.parse().map_err(|_| SaveError(format!("best_score geçersiz: {value}")))?;
                }
                "unlocked" => {
                    data.unlocked = value
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                "class" => {
                    if value.is_empty() {
                        return Err(SaveError("class boş".into()));
                    }
                    data.class = value.to_string();
                }
                _ => {
                    // İleri uyumluluk: bilinmeyen anahtarları yok say.
                }
            }
        }
        if data.unlocked.is_empty() {
            data.unlocked = SaveData::default().unlocked;
        }
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_preserves_data() {
        let mut s = SaveData::default();
        s.add_xp(600);
        s.kills = 42;
        s.wins = 3;
        s.matches = 7;
        s.best_score = 1337;
        s.class = "engineer".into();
        let text = s.serialize();
        let back = SaveData::parse(&text).expect("parse başarılı olmalı");
        assert_eq!(back, s);
    }

    #[test]
    fn unlocks_arrive_with_ranks() {
        let mut s = SaveData::default();
        assert_eq!(s.add_xp(600), vec!["dmr"]); // rank 2
        assert_eq!(s.rank, 2);
        assert_eq!(s.rank_name(), "ONBAŞI");
        let got = s.add_xp(10_000); // rank 5+
        assert!(s.rank >= 5);
        assert!(got.contains(&"lmg") && got.contains(&"shotgun") && got.contains(&"launcher"));
        // Tekrar XP eklemek aynı kilidi tekrar açmaz.
        let again = s.add_xp(1);
        assert!(again.is_empty());
    }

    #[test]
    fn bad_header_is_rejected() {
        assert!(SaveData::parse("garbage\nxp 1\n").is_err());
        assert!(SaveData::parse("").is_err());
    }

    #[test]
    fn rank_for_xp_boundaries() {
        assert_eq!(rank_for_xp(0), 1);
        assert_eq!(rank_for_xp(500), 2);
        assert_eq!(rank_for_xp(1399), 2);
        assert_eq!(rank_for_xp(1400), 3);
        assert_eq!(rank_for_xp(50_000), 10);
    }
}
