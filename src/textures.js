import * as THREE from 'three';
import { noiseField, clamp, fbm, mulberry32 } from './utils.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function tex(c, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Ground: dirt / scorched grass / gravel / mud with tire ruts and shell scars. */
export function groundTextures(size = 768) {
  const r = mulberry32(1337);
  const macro = noiseField(size, 11, 5, 7);
  const grain = noiseField(size, 29, 4, 46);
  const patch = noiseField(size, 53, 4, 15);
  const wet = noiseField(size, 71, 3, 9);

  const cA = canvas(size), cR = canvas(size), cN = canvas(size);
  const a = cA.getContext('2d'), ro = cR.getContext('2d'), n = cN.getContext('2d');
  const ia = a.createImageData(size, size), ir = ro.createImageData(size, size), inr = n.createImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, k = i * 4;
      const m = macro[i], g = grain[i], p = patch[i], w = wet[i];
      // three biomes blended by low frequency noise
      const dirt = [88, 74, 55], grass = [66, 76, 48], sand = [122, 105, 76], scorch = [38, 36, 33];
      const tGrass = clamp((p - .48) * 4.2, 0, 1) * clamp((m - .28) * 3, 0, 1);
      const tSand = clamp((.42 - p) * 3.6, 0, 1);
      const tScorch = clamp((w - .70) * 6, 0, 1);
      let R = dirt[0] * (1 - tGrass) + grass[0] * tGrass;
      let G = dirt[1] * (1 - tGrass) + grass[1] * tGrass;
      let B = dirt[2] * (1 - tGrass) + grass[2] * tGrass;
      R = R * (1 - tSand) + sand[0] * tSand; G = G * (1 - tSand) + sand[1] * tSand; B = B * (1 - tSand) + sand[2] * tSand;
      R = R * (1 - tScorch) + scorch[0] * tScorch; G = G * (1 - tScorch) + scorch[1] * tScorch; B = B * (1 - tScorch) + scorch[2] * tScorch;
      const variation = .58 + m * .72 + (g - .5) * .32;
      ia.data[k] = clamp(R * variation, 0, 255);
      ia.data[k + 1] = clamp(G * variation, 0, 255);
      ia.data[k + 2] = clamp(B * variation, 0, 255);
      ia.data[k + 3] = 255;
      const rough = clamp(205 + (g - .5) * 60 - w * 35, 90, 255);
      ir.data[k] = ir.data[k + 1] = ir.data[k + 2] = rough; ir.data[k + 3] = 255;
      height[i] = m * .6 + g * .35 + (1 - Math.abs(Math.sin((m + p) * 22)) * .06);
    }
  }
  a.putImageData(ia, 0, 0);
  ro.putImageData(ir, 0, 0);

  // painted-on detail: gravel speckle, tire ruts, blast scorch rings
  a.globalAlpha = .18;
  for (let i = 0; i < 3400; i++) {
    const x = r() * size, y = r() * size, s = .5 + r() * 2.1;
    a.fillStyle = r() > .5 ? '#d8c9a4' : '#1c1d19';
    a.fillRect(x, y, s, s);
  }
  a.globalAlpha = .12; a.strokeStyle = '#101210'; a.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const y0 = r() * size;
    a.beginPath(); a.moveTo(0, y0);
    for (let x = 0; x <= size; x += 24) a.lineTo(x, y0 + Math.sin(x * .014 + i) * 13 + (r() - .5) * 5);
    a.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const x = r() * size, y = r() * size, rad = 6 + r() * 26;
    const g = a.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(20,18,16,.55)'); g.addColorStop(1, 'rgba(20,18,16,0)');
    a.globalAlpha = .5; a.fillStyle = g; a.beginPath(); a.arc(x, y, rad, 0, 7); a.fill();
  }
  a.globalAlpha = 1;

  // normal from the height field
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, k = i * 4;
      const l = height[y * size + ((x - 1 + size) % size)], rr = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x], d = height[((y + 1) % size) * size + x];
      let nx = (l - rr) * 3.4, ny = (u - d) * 3.4, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      inr.data[k] = (nx / len * .5 + .5) * 255;
      inr.data[k + 1] = (ny / len * .5 + .5) * 255;
      inr.data[k + 2] = (nz / len * .5 + .5) * 255;
      inr.data[k + 3] = 255;
    }
  }
  n.putImageData(inr, 0, 0);

  return {
    map: tex(cA, { srgb: true, repeat: 26 }),
    normalMap: tex(cN, { repeat: 26 }),
    roughnessMap: tex(cR, { repeat: 26 }),
  };
}

/** Soft radial puff for smoke / dust / flash particles. */
export function softSprite(size = 128, kind = 'smoke') {
  const c = canvas(size), g = c.getContext('2d');
  const r = mulberry32(kind === 'smoke' ? 7 : kind === 'dust' ? 19 : 31);
  if (kind === 'flash') {
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,245,1)');
    grd.addColorStop(.16, 'rgba(255,225,150,.95)');
    grd.addColorStop(.42, 'rgba(255,150,50,.35)');
    grd.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
  } else {
    for (let i = 0; i < 26; i++) {
      const x = size * (.5 + (r() - .5) * .48), y = size * (.5 + (r() - .5) * .48);
      const rad = size * (.14 + r() * .30);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const a = kind === 'dust' ? .10 : .15;
      grd.addColorStop(0, `rgba(255,255,255,${a})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
    // fade out hard edges
    const mask = g.createRadialGradient(size / 2, size / 2, size * .22, size / 2, size / 2, size * .5);
    mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = mask; g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bullet / shrapnel decal with an alpha cutout. */
export function bulletHole(size = 128) {
  const c = canvas(size), g = c.getContext('2d');
  const r = mulberry32(93);
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 32);
  grd.addColorStop(0, 'rgba(6,6,6,1)'); grd.addColorStop(.35, 'rgba(18,16,14,.92)');
  grd.addColorStop(.7, 'rgba(52,46,38,.35)'); grd.addColorStop(1, 'rgba(52,46,38,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 34, 0, 7); g.fill();
  g.strokeStyle = 'rgba(12,10,9,.75)'; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const a = r() * 7, len = 18 + r() * 30;
    g.beginPath(); g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len); g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${40 + r() * 60},${36 + r() * 50},${30 + r() * 40},${.15 + r() * .35})`;
    g.fillRect(64 + (r() - .5) * 90, 64 + (r() - .5) * 90, 1 + r() * 3, 1 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Bladed grass tuft, transparent. */
export function grassSprite(size = 128) {
  const c = canvas(size), g = c.getContext('2d');
  const r = mulberry32(404);
  for (let i = 0; i < 14; i++) {
    const x = 8 + r() * (size - 16), h = size * (.42 + r() * .56);
    const w = 2 + r() * 4;
    const grd = g.createLinearGradient(0, size, 0, size - h);
    const tone = r() > .5 ? [92, 104, 58] : [122, 118, 66];
    grd.addColorStop(0, `rgba(${tone[0] * .45 | 0},${tone[1] * .45 | 0},${tone[2] * .4 | 0},1)`);
    grd.addColorStop(1, `rgba(${tone[0]},${tone[1]},${tone[2]},.95)`);
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(x - w / 2, size); g.lineTo(x + w / 2, size);
    g.lineTo(x + (r() - .5) * 18, size - h); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Tiling detail albedos for the 4-layer terrain splat shader. */
export function detailTextures(size = 256) {
  const make = (seed, palette, scale) => {
    const c = canvas(size), g = c.getContext('2d');
    const n = noiseField(size, seed, 5, scale);
    const fine = noiseField(size, seed + 77, 3, scale * 5);
    const img = g.createImageData(size, size);
    const r = mulberry32(seed * 31);
    for (let i = 0; i < size * size; i++) {
      const k = i * 4;
      const v = .58 + n[i] * .8 + (fine[i] - .5) * .3;
      const fleck = r() > .985 ? .35 : 0;
      img.data[k] = clamp(palette[0] * v + fleck * 255, 0, 255);
      img.data[k + 1] = clamp(palette[1] * v + fleck * 255, 0, 255);
      img.data[k + 2] = clamp(palette[2] * v + fleck * 255, 0, 255);
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return tex(c, { srgb: true, repeat: 1 });
  };
  return {
    grass: make(11, [78, 92, 48], 9),
    sand: make(23, [142, 121, 84], 7),
    rock: make(37, [96, 94, 88], 12),
    mud: make(51, [62, 54, 42], 8),
  };
}

/** Small emissive noise used for lens dirt / grain overlays. */
export function grainTexture(size = 256) {
  const c = canvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = mulberry32(555);
  for (let i = 0; i < size * size; i++) {
    const v = r() * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
