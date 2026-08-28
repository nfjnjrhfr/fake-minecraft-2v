// 可序列化的偽亂數產生器（mulberry32）
// 狀態只是一個 32 bit 整數，因此整個遊戲存檔可以完整重現。

export function createRng(seed) {
  return { s: (seed >>> 0) || 1 }
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0
}

export function rand(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0
  let t = rng.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// 標準常態分佈（Box-Muller）
export function gauss(rng) {
  let u = 0
  let v = 0
  while (u === 0) u = rand(rng)
  while (v === 0) v = rand(rng)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function randInt(rng, min, max) {
  return min + Math.floor(rand(rng) * (max - min + 1))
}

export function pick(rng, arr) {
  return arr[Math.floor(rand(rng) * arr.length)]
}

// 依 weight 欄位加權抽樣
export function weightedPick(rng, arr) {
  const total = arr.reduce((sum, item) => sum + (item.weight ?? 1), 0)
  let roll = rand(rng) * total
  for (const item of arr) {
    roll -= item.weight ?? 1
    if (roll <= 0) return item
  }
  return arr[arr.length - 1]
}
