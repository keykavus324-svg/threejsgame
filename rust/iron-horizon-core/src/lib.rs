//! DEMİR UFUK — saf Rust deterministik simülasyon çekirdeği.
//!
//! Kapsam (render YOK): silah verileri + hasar eğrisi, kare hızından bağımsız
//! tetik, TTK tablosu, A*/NavGrid, spatial hash, AI tepki/baskı modeli, dalga
//! yöneticisi, MCOM uplink, yıkılabilir hasar, görev/bilet orkestrasyonu ve
//! ilerleme kaydı.
//!
//! **Durum:** bu depo derleyici olmadan yazıldı; yalnızca tree-sitter ile
//! sözdizimi denetiminden geçti. Herhangi bir makinede:
//!
//! ```bash
//! cargo test
//! cargo run --bin ttk-table
//! ```

#![forbid(unsafe_code)]

pub mod ai;
pub mod damage;
pub mod destruct;
pub mod fire;
pub mod grid;
pub mod mission;
pub mod mcom;
pub mod rng;
pub mod save;
pub mod spatial;
pub mod ttk;
pub mod vec;
pub mod waves;
pub mod weapons;

pub use mission::{GameEvent, Mission, RegionOwner};
pub use weapons::WeaponDef;
