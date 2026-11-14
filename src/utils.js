// Small math / noise toolbox shared by every subsystem.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (r, a, b) => a + r() * (b - a);
export const randInt = (r, a, b) => Math.floor(a + r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const TAU = Math.PI * 2;

export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function fbm(x, y, octaves = 5, seed = 1, lac = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, tot = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * f, y * f, seed + i * 131) * amp;
    tot += amp; amp *= gain; f *= lac;
  }
  return sum / tot;
}

export function ridged(x, y, octaves = 4, seed = 7) {
  let sum = 0, amp = 1, tot = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, seed + i * 71) * 2 - 1);
    sum += n * n * amp; tot += amp; amp *= .5; f *= 2;
  }
  return sum / tot;
}

/** A compact deterministic noise field used by canvas texture generators. */
export function noiseField(size, seed, octaves = 5, scale = 6) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = fbm(x / size * scale, y / size * scale, octaves, seed);
    }
  }
  return out;
}

export function shortestAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}
