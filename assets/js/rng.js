/* Deterministic pseudo-randomness so every thumbnail / scene looks the same
   on every reload. Seeds are plain strings (usually a video id). */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Smooth 1-D value noise — used for terrain silhouettes and cloud drift. */
export function noise1d(seed) {
  const rng = makeRng(seed);
  const table = Array.from({ length: 256 }, rng);
  return function sample(x) {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[((i % 256) + 256) % 256];
    const b = table[(((i + 1) % 256) + 256) % 256];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}
