# DEMİR UFUK — Rust Çekirdek (`iron-horizon-core`)

Saf Rust, **sıfır bağımlılık** deterministik simülasyon çekirdeği. Render yok;
silah/hasar/AI/dalga/MCOM/bilet/ilerleme mantığı headless çalışır ve birim
testlerle doğrulanır. Render katmanı (Bevy vb.) sonraki adım.

## Doğrulama durumu (açık dürüst kayıt)

Bu depo **derleyici olmadan** yazıldı: sandbox'ta `cargo`/`rustc` yok,
`crates.io` ve `rust-lang.org` erişilemiyor. Yapılan ve yapılmayanlar:

| Adım | Durum |
|---|---|
| `tree-sitter` Rust grameriyle sözdizimi denetimi | ✅ `python3 tools/rust_syntax_check.py` → 18/18 dosya temiz |
| A* mantığının Python çevirisiyle çapraz kontrolü | ✅ Duvar/geçit haritası: yol geçitten geçiyor |
| Atış zamanlayıcısı / falloff / XP–rütbe aritmetiğinin Python eşleniği | ✅ 12/12 kontrol (30/60/144 FPS) |
| `cargo test` | ❌ Çalıştırılamadı (derleyici yok) |
| `cargo run --bin ttk-table` | ❌ Çalıştırılamadı (derleyici yok) |

**Herhangi bir makinede (Rust ≥ 1.75):**

```bash
cd rust/iron-horizon-core
cargo test            # birim + entegrasyon testleri
cargo run --bin ttk-table   # her silah × HP(100/150/400) × bölge TTK tablosu
```

`cargo test` ilk seferde derlenir (bağımlılık yok, hızlı). Bir hata görürseniz
dosya/satırla birlikte issue açın; çekirdek küçük ve saf olduğu için düzeltmesi kolay.

## Tasarım kuralları

- **Deterministik**: özel `Rng` (xorshift64*); platform `sin/cos`'a bağımlı
  karar yok; tüm simülasyon aynı girdide aynı sonucu üretir.
- **f64**: doğruluk ve taşınabilirlik için (oyun mantığında hız darboğazı değil).
- **Sıfır unsafe** (`#![forbid(unsafe_code)]`), sıfır dış bağımlılık →
  crates.io erişimi olmayan ortamlarda bile derlenir.
- **Data-driven silahlar**: `weapons.rs` tek doğruluk kaynağı; TTK tablosu
  bundan üretilir (`ttk.rs`).

## Modüller

| Modül | İçerik |
|---|---|
| `vec.rs` | `Vec2`/`Vec3` — elle yazılmış minimal vektör |
| `rng.rs` | Deterministik xorshift64* RNG (+ birim disk saçılım örneklemesi) |
| `grid.rs` | `NavGrid`: yürünebilirlik, octile A*, string-pulling, Bresenham hattı, siper seçimi |
| `spatial.rs` | Uniform-grid spatial hash, `nearest(filter)` sorgusu |
| `weapons.rs` | 6 silah `WeaponDef`; ADS zoom hassasiyeti `tan(ads/2)/tan(hip/2)` |
| `damage.rs` | Menzil falloff'u, kafa çarpanı, saçılım hasarı |
| `fire.rs` | Kare hızından bağımsız `FireScheduler`, sönümlenen `RecoilOffset` |
| `ttk.rs` | TTK tablosu üretimi + `ttk-table` CLI'sı |
| `ai.rs` | Tepki gecikmesi (0.45 s), bastırılma birikimi/sönümü, `TakeCover` eşiği |
| `waves.rs` | 6 dalga direktörü (zorluk ölçekli kompozisyon, bilet sayacı) |
| `mcom.rs` | MCOM uplink: şarj/sönüm, tek seferlik tamamlanma |
| `destruct.rs` | Yarıçap hasarı, yeni yıkılanların id'leri |
| `mission.rs` | Görev orkestrasyonu: bilet erimesi, MCOM ödülleri, zafer/hezimet |
| `save.rs` | XP→rütbe, rütbe kilitleri (2:ŞAHİN 3:KAYA 4:KIRICI 5:RPG-29), `v3` kayıt formatı |

## Testler (ilk `cargo test`'te çalışacak)

- `fire_rate_is_frame_rate_independent` — 30/60/144 FPS, 10 s tam otomatik, ±1 mermi
- `path_goes_through_gap` / `unreachable_returns_none` — A* duvar/geçit + köşeden kesim engeli
- `suppression_forces_cover` / `reaction_delay_blocks_instant_fire` — AI insani kuralları
- `full_arc_to_completion` — 6 dalga intermission→start→clear→mission complete
- `mcom_completion_grants_tickets_and_score`, `mission_defeat_when_all_three_regions_lost`
- `roundtrip_preserves_data`, `unlocks_arrive_with_ranks` — kayıt/ilerleme

## Sonraki adımlar

1. Render katmanı: Bevy 0.20 plugin'i (`iron-horizon-render`) — bu çekirdeği
   `FixedUpdate` içinde çalıştırır; JS sürümü `public/` altında kalır.
2. Ses/partikül: bu çekirdeğe dokunmadan Bevy katmanına.
3. Denge: `cargo run --bin ttk-table` çıktısını `docs/balance.md`'ye kopyala,
   silah tablosunu oradan ayarla.
