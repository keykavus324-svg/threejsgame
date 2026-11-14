# DEMİR UFUK — OPERASYON: KIRLI ŞAFAK
### Iron Horizon · procedural browser battlefield

**Three.js r187 + WebGL2** ile sıfırdan yazılmış, birinci şahıs, araçlı, dalga tabanlı bir cephe oyunu.
Tüm 3B modeller **Blender 4.5 LTS** içinde Python ile çizildi, tüm dokular, gökyüzü, sesler ve
partikül efektleri prosedürel olarak üretildi. İndirilmiş model, doku, ses veya HDR dosyası yok.

```bash
npm install
npm run dev        # http://localhost:5173  (0.0.0.0 üzerinden canlı önizleme)
npm run build      # üretim derlemesi
```

> **Not / dürüst çerçeve:** Bu ortamda "Fable 5.2" adlı bir model/araç, Blender GUI'si veya Higgsfield
> entegrasyonu yok. Bunun yerine gerçek **Blender 4.5.16 LTS** Python API'sini (`bpy`) headless
> çalıştırıp `.blend` + GLB ürettim; oyunu da **Three.js r187** ile kurdum. "AAA seviye" ve
> "Higgsfield'dan iyi" iddiaları öznel: burada bir tarayıcıda çalışan, sinematik ışıklandırmalı,
> post-processing'li, birleşik silahlı (piyade + tank + hava desteği) **eksiksiz ve oynanabilir bir
> prototip** var; konsol/PC AAA prodüksiyonu değil. Higgsfield bir video üretim platformu, yani
> kıyaslama teknik olarak farklı kategoriler arasında. Yine de görsel olarak elimden gelenin en iyisini
> yaptım: ACES ton eşleme, HDR bloom, gölgeli alçak güneş, prosedürel bulutlu gökyüzü, hacimsel sis,
> PBR dokular, film greni, kromatik sapma, lens vignette'i ve canlı partikül sistemi.

---

## Oynanış

- **6 dalga** düşman taarruzu, **3 kontrol noktası** (A / Kırık Kule, B / Hangar 7, C / Geçit) ve her bölgede bir **MCOM veri istasyonu**.
- Düşman **biletleri** tükenene veya 6. dalga püskürtülene kadar dayan. Ölmek 5 bilete mal olur;
  düşman çok bölge tutarsa müttefik biletleri zamanla erir.
- **Kalkan-9** ana muharebe tankı: sürülebilir, dönen taret, yükselen ana top, makineli tüfek.
  Ana top ve makineli tüfek yıkılabilir objeleri parçalar.
- **6 silah · 4 sınıf** (sınıflar arası silah paketleri):
  **SALDIRI** (AR-12 Kestrel + V-9 Kartal) · **DESTEK** (M-240 Kaya + M-590 Kırıcı, baskı ateşi) ·
  **MÜHENDİS** (V-9 + RPG-29 Yıldırım, roket) · **KESKİN NİŞANCI** (M-87 Şahin dürbünlü + AR-12).
  Rütbe atladıkça silahlar açılır: **2** M-87 ŞAHİN · **3** M-240 KAYA · **4** M-590 KIRICI · **5** RPG-29 YILDIRIM.
- **Yıkılabilir siper:** konteyner, kum torbası, kasa, varil, tank tuzağı — vurulunca parçalanır,
  çarpışma ve navigasyon ızgarası anında güncellenir.
- **MCOM uplink:** bölge sizdeyken istasyon şarj olur; tam şarj = +25 bilet, +500 skor, hava
  desteği ve ikmal. Bölge düşerse şarj söner.
- El bombası (şarapnel + parça hasarı), ilk yardım, **Q** ile işaretlenen hedefe F/A-18 hava desteği.
- **Baskı ateşi ve işaretleme:** LMG/shotgun yakın düşmanları bastırır; keşif sınıfı düşmanları işaretler.
- **İlerleme kaydı:** XP, rütbe, galibiyet ve en iyi skor `localStorage`'ta (`iron-horizon-v2`) saklanır.
- 3 müttefik bot, düşman keskin nişancı/piyade/ağır muharip AI'sı (NavGrid A* + siper noktaları +
  görüş hattı), örtünme, yanlama, hat kesme, ölüm animasyonu, yakın mesafe sesleri.

### Kontroller

| Tuş | İşlev | Tuş | İşlev |
|---|---|---|---|
| `W A S D` | Hareket | `Sol tık` | Ateş |
| `Shift` | Koşu | `Sağ tık` | Nişan / dürbün |
| `Ctrl` / `C` | Çömel | `R` | Şarjör |
| `Boşluk` | Zıpla | `1` / `2` / `Tekerlek` | Silah değiştir |
| `G` | El bombası | `F` | İlk yardım |
| `Q` | Hava desteği | `E` | Tanka bin / in |
| `Esc` | Duraklat | `F3` | Motor diyagnostiği (FPS, draw call, sistem maliyeti) |

**Tankta:** `W/S` ileri–geri, `A/D` palet dönüşü, fare taret + top yükselmesi, `Sol tık` ana top,
`Sağ tık` eş eksenli makineli tüfek, `E` in.

---

## Mimari

```
index.html / style.css     Askerî HUD, menüler, dürbün overlay, taktik harita, MCOM barı
src/
  main.js                 Oyun durumu, dalga/bilet mantığı, motor çatısı (frame sistemleri), döngü
  utils.js                Deterministik gürültü (fbm / ridged), matematik
  textures.js             Canvas ile zemin albedo + normal + roughness, detay dokuları, duman
  sky.js                  GLSL gökyüzü (güneş diski, 6 oktav bulut, yıldız), saat-of-day, sis, ışıklar
  world.js                340×340 m arazi, kraterler, yollar, 12k çimen, 200+ obje (yıkılabilir!),
                          AABB çarpışma, 3 kontrol noktası + MCOM istasyonları, dinamik ışıklar
  assets.js               GLTF yükleyici + malzeme başına tek draw call'a "bake" (pivotlar korunur)
  effects.js              GPU partikül katmanları, tracer, patlama, şok dalgası, dekal, hava desteği
  audio.js                WebAudio ile tamamen sentezlenen silah/patlama/adım/radyo/rüzgâr/müzik
  player.js               FPS kontrolü, prosedürel viewmodel + eller, 6 silah, roket fiziği, baskı ateşi
  enemies.js              AI: NavGrid A* yürüyüşü, siper noktaları, LOS, SpatialHash sorguları, MCOM
  vehicle.js              Sürülebilir tank, üçüncü şahıs kamera, topçu atışı, yıkılabilir objeler
  hud.js                  DOM HUD + canvas taktik radar (işaretli düşman, MCOM göstergeleri)
  post.js                 EffectComposer: AtmospherePass → bloom → gradasyon → OutputPass → FXAA
  engine/
    Bus.js                Alt sistemler arası olay veri yolu (prop kırılması, ölüm, ele geçirme)
    Engine.js             Fixed-timestep çekirdek, sıralı sistem zamanlayıcı, profil çıktısı
    SpatialHash.js        Uniform-grid yakın-komşu indeksi (O(1))
    Physics.js            Kapsül-AABB çarpışma, görüş hattı, balistik, saçılım hasarı
    NavGrid.js            85×85 yürünebilirlik ızgarası, A* + string-pulling, siper çıkarımı
    Save.js               Versiyonlu localStorage kaydı (ayarlar + rütbe/XP + loadout)
    Debug.js              F3 overlay: FPS, draw call, sistem başına ms, AI sayaçları
  gfx/
    AtmospherePass.js     Derinlik-tabanlı AO + gün ışını (god rays) + focus mesafeli DOF
    Weather.js            Toz fırtınası / açık / yağmur / şiddetli fırtına; rüzgâr, sis, şimşek
    LensFlare.js          Anamorfik streak + hayalet zinciri (2D canvas overlay)
  systems/
    Loadout.js            6 silah + 4 sınıf tanımı, rütbe kilitleri, slot çözümleme
blender/
  make_assets.py          Tüm asset'leri Blender'da modelleyen üretim hattı
  render_hero.py          Aynı asset'lerle Cycles/Nishita gün batımı dioraması + filmik post
  IRON_HORIZON_KIT.blend  Açılabilir gerçek Blender dosyası (showroom + ışıklar + kamera)
  hero.png                Gerçek Blender/Cycles render'ı (1400×800, hacimsel sis, DOF, bloom)
public/assets/*.glb        25 GLB (asker ×2, tank, APC, sığınak, konteyner, kule, kasa, varil,
                           kum torbası, tank tuzağı, yanmış ağaç, helikopter enkazı, bayrak, anten,
                           MCOM istasyonu, yıkık duvar, köprü, 5 modüler silah, roket)
public/hero.png            Yükleme / görev sonu ekranlarının arka planı
tools/
  smoke.mjs               Tarayıcısız simülasyon testi (25-asset kit, NavGrid/Physics/Save dâhil, 420 frame)
  glbtest.mjs             Her GLB'yi Three.js ile açıp bake doğrulaması (25/25)
```

### Görsel hat

- **Işık:** saat-of-day'i (varsayılan 17.4) süren alçak turuncu güneş (4096/2048 gölge haritası),
  güneş gölgesini oyuncuya odaklayan 84 m kutu (`setShadowFocus`), soğuk gökyüzü dolgusu,
  PMREM ortam yansıması, `ACESFilmicToneMapping`.
- **Atmosfer:** üstel sis, 6 oktav hareketli bulutlar, 1100 sürüklenen toz/ember, 7 duman kolonu,
  alevler, uzak tepe siluetleri, dinamik **hava** (toz/açık/yağmur/fırtına; rüzgâr, sis yoğunluğu,
  şiddetli fırtınada şimşek), anamorfik **lens flare** (güneş konumuna göre 2D overlay).
- **Post:** derinlik dokulu `AtmospherePass` (AO + gün ışını + DOF), HDR `UnrealBloom`, gölgelere
  soğuk / ışıklara sıcak split-tone, kontrast, vignette, hasar kırmızısı, kromatik sapma,
  çözünürlükten bağımsız film greni, FXAA, adaptif piksel oranı.
- **Performans:** Blender modelleri çalışma anında malzeme başına birleştirilir (asker 106 mesh →
  32, konteyner 79 → 4). Çimen/kaya/enkaz `InstancedMesh`, partiküller tek `Points` tamponu.
  Düşük FPS'te piksel oranı otomatik düşer; menüden 4 grafik kademesi seçilebilir; AI sorguları
  `SpatialHash` ile O(n)'e iner.

---

## Blender üretim hattı

`blender/make_assets.py` tek başına çalışır:

```bash
blender -b -P blender/make_assets.py
```

- NumPy ile **albedo + roughness + normal** dokuları üretir (zırh çeliği/pas, beton/çatlak,
  dijital kamuflaj, ahşap, kanvas, konteyner, kauçuk) ve bunları `.blend` içine paketler.
- 25 asset'i sıfırdan modeller: 115 parçalı eklemli asker, 56 parçalı tüfek, 148 parçalı tank,
  62 parçalı APC, sığınak, kule, konteyner, MCOM istasyonu, yıkık duvar, köprü, helikopter enkazı vb.
- Showroom sahnesini ışıkları ve kamerasıyla kaydeder → `IRON_HORIZON_KIT.blend`.
- Her asset'i ayrı GLB olarak `public/assets/` altına export eder (dokular GLB içine gömülü).

Bu depoda asset'ler, X11/GL kütüphanesi olmayan bir konteynerde `bpy==4.5.16` (PyPI) + küçük
headless shim'lerle üretildi; yani dosyalar gerçek Blender çıktısıdır, taklit değil.

---

## Doğrulama

```bash
npm run build
node tools/glbtest.mjs     # 25 GLB → yükle + bake, üçgen sayıları ve pivotlar
node tools/smoke.mjs       # tüm oyun sistemlerini 420 frame simüle et (iki faz, RPG-29 dâhil)
```

## Bilinen sınırlar

- Tarayıcı/iFrame `pointer lock` izni vermezse oyun otomatik olarak "serbest imleçle nişan" kipine
  geçer; hassasiyet yine ayarlanabilir.
- Gerçek bir AAA oyununun onlarca kişilik sanat ekibi, hareket yakalama, fizik motoru ve özel
  motoru yok; bu, tek bir depoda üretilmiş eksiksiz bir **teknoloji demosu / oynanabilir prototip**.
- Sesler sentezlendiği için kayıtlı ses kalitesi değil, düşük gecikmeli prosedürel tasarım.
- PostFX/godray/DoF ve hava durumu gerçek GPU'da görsel olarak doğrulanmadı (bu ortamda tarayıcı
  yok); mantık katmanı `tools/smoke.mjs` ile, render hattı `npm run build` + GLB bütünlüğü ile
  doğrulanır. Bundan önce gerçek bir tarayıcıda bir tur oynayın.
- Sınıf/silah kilit dengesi ve MCOM şarj hızı prototip değerleridir; denge geri bildirimine göre
  `systems/Loadout.js` ve `enemies.js` içindeki sabitlerle oynayın.

`blender/hero.png`, oyunun kendi asset'leriyle Blender Cycles'ta (Nishita gün batımı gökyüzü,
hacimsel sis, alan derinliği, 40 örnek + denoise + filmik bloom/grade) üretilmiş gerçek bir
render'dır; ekran görüntüsü değil, aynı modellerin offline ışıklandırılmış hâlidir:

```bash
blender -b -P blender/render_hero.py    # ~2 dk CPU render → blender/hero.png
```
