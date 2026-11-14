# Blender asset kiti — DEMİR UFUK

`make_assets.py` oyunun "sanat departmanı"dır. Hiçbir hazır mesh kullanılmaz; her şey
`bpy` primitifleri, bevel, özel mesh ve prosedürel NumPy dokularıyla üretilir.

## Çalıştırma

```bash
# Masaüstünde / sunucuda tam Blender ile
blender -b -P blender/make_assets.py

# Veya Python içinde Blender modülü (bpy) ile
python -m pip install bpy==4.5.16
python blender/make_assets.py
```

Çıktılar:

| Dosya | İçerik |
|---|---|
| `IRON_HORIZON_KIT.blend` | 25 asset'in ızgaraya dizildiği, güneş + dolgu ışığı + kamera içeren showroom sahnesi |
| `../public/assets/*.glb` | Oyunun kullandığı 25 ayrı glTF 2.0 binary dosyası (dokular gömülü) |

## Asset listesi

| GLB | Parça | Not |
|---|---|---|
| `soldier_enemy.glb` / `soldier_ally.glb` | 115 | `Hips / Torso / Head / ArmL / ArmR / LegL / LegR / Weapon` pivotları; runtime'da yürüyüş, nişan alma ve ölüm animasyonu |
| `rifle.glb` | 56 | AR-12 Kestrel: alıcı, namlu, ray dişleri, optik, şarjör, dipçik, el feneri, sapan halkaları. Oyuncunun viewmodel'i + askerlerin silahı |
| `tank.glb` | 148 | Kalkan-9: `Hull / Turret / Gun / RoofMG` pivotları, 60 palet baklası, 12 yol tekeri, ERA blokları, kupolalar, anten |
| `apc.glb` | 47 | ZPT-16 zırhlı personel taşıyıcı: eğimli alın plakası, tekerlek seti, tavan tareti + makineli tüfek — konvoy düşmanının ağır birimi |
| `wpn_smg.glb` / `wpn_lmg.glb` / `wpn_shotgun.glb` / `wpn_sniper.glb` / `wpn_launcher.glb` | 15 / 27 / 16 / 21 / 9 | V-9 Kartal, M-240 Kaya, M-590 Kırıcı, M-87 Şahin, RPG-29 Yıldırım |
| `rocket.glb` | 8 | RPG-29 roketi: motor, savaş başlığı, 4 dengeleyici kanat |
| `mcom.glb` | 11 | MCOM veri istasyonu: kaide, gövde, ekran + tuş takımı, sinyal mastı — bölge kontrolünde uplink şarjı |
| `ruin_wall.glb` | 21 | Yıkık beton duvar: 6 donatılı slab + 9 enkaz bloğu |
| `bridge.glb` | 78 | Tek açıklıklı konvoy köprüsü: 2 kafes sırası, 17 tabliye, 9 makas |
| `bunker.glb` | 53 | Beton duvarlar, filizlenmiş inşaat demiri, mazgal, zırhlı kapı, kum torbası revetmanı |
| `watchtower.glb` | 51 | Çapraz gergili kule, merdiven, kabin, projektör, gergi telleri, işaret feneri |
| `container.glb` | 80 | 26 oluklu nervürlü konteyner, kapı kilit çubukları, köşe dökümleri |
| `heli_wreck.glb` | 18 | Eğilmiş düşmüş helikopter: burun, kokpit camı, kuyruk, rotor, kızaklar |
| `antenna.glb` | 36 | 17 m kafes kule + çanak + kırmızı fener |
| `crate / barrel / sandbags / barrier / burnt_tree / flag` | 6–21 | Saha detayları |

## Dokular

`build_textures()` NumPy ile 256² üretir ve Blender imajına paketler:

- **T_ARMOR_*** — zırh çeliği: boya aşınması, pas lekeleri, çizikler + roughness + normal
- **T_CONCRETE_*** — agrega, leke, kılcal çatlak + roughness + normal
- **T_CAMO_*** — dijital benekli kamuflaj
- **T_WOOD / T_CANVAS / T_CONTAINER / T_RUBBER** — kasa, kum torbası, konteyner, lastik

glTF export bunları otomatik olarak GLB içine gömer; Three.js tarafında ekstra dosya gerekmez.

## runtime bake

Blender'dan gelen 50–150 küçük obje doğrudan kullanılsaydı sahne binlerce draw call'a
çıkardı. `src/assets.js` içindeki `bake()` her klonu malzeme başına tek mesh'e birleştirir;
`AssetKit.getRig()` isimli pivotları (eklemler, taret, top) korur. Ortak isimlere Blender'ın
eklediği `.001` ve glTF'nin `.` temizlemesi `canonicalName()` ile normalize edilir.

## Headless notu

Bu repo, X11/GL kütüphanesi bulunmayan bir konteynerde `bpy` PyPI wheel'i ile üretildi.
Eksik `libXrender / libXfixes / libXi / libxkbcommon / libSM / libICE / libGL` için boş
shim `.so` dosyaları derlendi (hiçbiri background modunda çağrılmaz). Normal Blender
kurulumunda buna gerek yoktur.
