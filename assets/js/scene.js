/* Procedural blocky scenes.
   Every video "plays" by rendering one of these into a canvas as a pure
   function of (time, seed) — which is what makes scrubbing work: seeking to
   0:42 just draws frame t=42, no buffering, no video files in the repo. */

import { makeRng, noise1d } from './rng.js';

const BLOCKS_ACROSS = 40;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function mixHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const out = pa.map((c, i) => Math.round(lerp(c, pb[i], clamp(t, 0, 1))));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

/* Blocks are drawn with a lighter top face and a darker right face so the flat
   rectangles read as cubes without any real 3-D maths. */
function block(ctx, x, y, s, color, shade = 0.18) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = `rgba(255,255,255,${shade})`;
  ctx.fillRect(x, y, s, Math.max(1, s * 0.18));
  ctx.fillStyle = `rgba(0,0,0,${shade * 0.9})`;
  ctx.fillRect(x + s - Math.max(1, s * 0.18), y, Math.max(1, s * 0.18), s);
}

function speckle(ctx, x, y, s, rng, color, n = 3) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const px = x + Math.floor(rng() * 4) * (s / 4);
    const py = y + Math.floor(rng() * 4) * (s / 4);
    ctx.fillRect(px, py, s / 4, s / 4);
  }
}

/* ---------------------------------------------------------------- overworld */

const SKY_DAY = '#79b8ff';
const SKY_DUSK = '#f0895a';
const SKY_NIGHT = '#0b1030';

function overworld(ctx, w, h, t, seed, opts = {}) {
  const rng = makeRng(seed + ':ow');
  const terrain = noise1d(seed + ':terrain');
  const s = w / BLOCKS_ACROSS;
  const phase = opts.static ? 0.25 : (t / 90) % 1; // full day cycle every 90s
  const sun = Math.sin(phase * Math.PI * 2);
  const night = clamp(-sun * 1.6, 0, 1);
  const dusk = clamp(1 - Math.abs(sun) * 2.4, 0, 1);

  let sky = mixHex(SKY_DAY, SKY_NIGHT, night);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  if (dusk > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(0,0,0,0)`);
    g.addColorStop(1, mixHex(SKY_DUSK, '#ffd08a', 0.3));
    ctx.globalAlpha = dusk * 0.75;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // stars
  if (night > 0.05) {
    ctx.globalAlpha = night;
    const srng = makeRng(seed + ':stars');
    for (let i = 0; i < 60; i++) {
      const sx = Math.floor(srng() * BLOCKS_ACROSS) * s;
      const sy = Math.floor(srng() * (h * 0.55) / s) * s;
      ctx.fillStyle = srng() > 0.7 ? '#ffffff' : '#c9d6ff';
      ctx.fillRect(sx, sy, s * 0.35, s * 0.35);
    }
    ctx.globalAlpha = 1;
  }

  // sun / moon riding an arc across the sky
  const bodyX = w * (0.5 + 0.42 * Math.cos((phase + 0.5) * Math.PI * 2));
  const bodyY = h * 0.62 - Math.sin(phase * Math.PI * 2) * h * 0.5;
  const isSun = sun >= 0;
  ctx.fillStyle = isSun ? '#fff2a8' : '#e8ecf5';
  ctx.fillRect(bodyX - s, bodyY - s, s * 2.4, s * 2.4);
  if (!isSun) {
    ctx.fillStyle = mixHex(SKY_DAY, SKY_NIGHT, night);
    ctx.fillRect(bodyX - s * 0.2, bodyY - s * 0.8, s * 1.2, s * 1.6);
  }

  // parallax clouds
  ctx.fillStyle = `rgba(255,255,255,${0.85 - night * 0.55})`;
  const crng = makeRng(seed + ':cloud');
  for (let i = 0; i < 5; i++) {
    const cy = Math.floor(crng() * 5 + 1) * s;
    const len = 3 + Math.floor(crng() * 5);
    const speed = 6 + crng() * 8;
    let cx = ((crng() * w + t * speed) % (w + len * s)) - len * s;
    for (let b = 0; b < len; b++) ctx.fillRect(cx + b * s, cy, s, s);
    ctx.fillRect(cx + s, cy - s, (len - 2) * s, s);
  }

  // far hills, then the ground the player walks on
  const scroll = opts.static ? 0 : t * 1.6;
  for (let layer = 0; layer < 2; layer++) {
    const depth = layer === 0 ? 0.45 : 1;
    const base = h * (layer === 0 ? 0.62 : 0.72);
    const grass = layer === 0 ? mixHex('#4b7a2b', sky, 0.35) : '#5aa832';
    const dirt = layer === 0 ? mixHex('#6b4b2a', sky, 0.35) : '#8a5a33';
    for (let x = -1; x <= BLOCKS_ACROSS + 1; x++) {
      const wx = x + scroll * depth * 0.25;
      const hgt = Math.round(terrain(wx * 0.12 + layer * 40) * (layer === 0 ? 4 : 3));
      const top = base - hgt * s;
      const px = x * s - ((scroll * depth * 0.25 * s) % s);
      block(ctx, px, top, s, grass, 0.14);
      for (let y = top + s; y < h; y += s) {
        const brng = makeRng(`${seed}:${x}:${y}:${layer}`);
        block(ctx, px, y, s, y > top + s * 3 ? '#6f6f6f' : dirt, 0.1);
        if (brng() > 0.88) speckle(ctx, px, y, s, brng, 'rgba(0,0,0,0.18)', 2);
      }
      // trees on the near layer only
      if (layer === 1) {
        const trng = makeRng(`${seed}:tree:${Math.floor(wx)}`);
        if (trng() > 0.86) {
          const th = 3 + Math.floor(trng() * 2);
          for (let k = 0; k < th; k++) block(ctx, px, top - (k + 1) * s, s, '#6b4a24', 0.12);
          for (let ly = -1; ly <= 1; ly++) {
            for (let lx = -2; lx <= 2; lx++) {
              if (Math.abs(lx) === 2 && ly === 1) continue;
              block(ctx, px + lx * s, top - (th + 1 + ly) * s, s, '#3f7d1e', 0.16);
            }
          }
        }
      }
    }
    if (layer === 0) {
      ctx.fillStyle = `rgba(${night > 0.5 ? '10,14,40' : '160,200,255'},0.22)`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // the little guy, bobbing as he "walks". Stacked head→body→legs so his feet
  // land exactly on the block he is standing on.
  if (opts.player !== false) {
    const bob = Math.abs(Math.sin(t * 4)) * s * 0.18;
    const px = w * 0.32;
    const groundTop = h * 0.72 - Math.round(terrain((w * 0.32 / s + scroll * 0.25) * 0.12 + 40) * 3) * s;
    const py = groundTop - s * 3.8 + bob;
    const swing = Math.sin(t * 4) * s * 0.2;
    ctx.fillStyle = '#c98d63'; ctx.fillRect(px, py, s * 1.2, s * 1.2);                      // head
    ctx.fillStyle = '#5c3b21'; ctx.fillRect(px, py, s * 1.2, s * 0.3);                      // hair
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(px + s * 0.2, py + s * 0.55, s * 0.25, s * 0.2);
    ctx.fillRect(px + s * 0.75, py + s * 0.55, s * 0.25, s * 0.2);
    ctx.fillStyle = '#2f6fb0'; ctx.fillRect(px + s * 0.1, py + s * 1.2, s, s * 1.4);        // body
    ctx.fillStyle = '#c98d63'; ctx.fillRect(px + s * 1.0, py + s * 1.3 + swing, s * 0.35, s * 1.1);
    ctx.fillStyle = '#3a3f8a';                                                              // legs
    ctx.fillRect(px + s * 0.1, py + s * 2.6, s * 0.42, s * 1.2 - swing * 0.5);
    ctx.fillRect(px + s * 0.68, py + s * 2.6, s * 0.42, s * 1.2 + swing * 0.5);
  }

  if (opts.rain) {
    ctx.strokeStyle = 'rgba(190,210,255,0.5)';
    ctx.lineWidth = Math.max(1, s * 0.1);
    for (let i = 0; i < 70; i++) {
      const rx = (rng() * w + t * 40) % w;
      const ry = (rng() * h + t * 700) % h;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - s * 0.2, ry + s * 0.9); ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------- nether */

function nether(ctx, w, h, t, seed) {
  const s = w / BLOCKS_ACROSS;
  const rng = makeRng(seed + ':nether');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#4a0d0d');
  g.addColorStop(1, '#8f1f0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // netherrack ceiling
  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    const drop = 1 + Math.round(noise1d(seed + ':ceil')(x * 0.3) * 3);
    for (let y = 0; y < drop; y++) {
      const brng = makeRng(`${seed}:c:${x}:${y}`);
      block(ctx, x * s, y * s, s, '#6e2626', 0.12);
      speckle(ctx, x * s, y * s, s, brng, 'rgba(0,0,0,0.25)', 2);
    }
  }

  // lava lake with a slow rolling surface
  const lavaTop = h * 0.74;
  ctx.fillStyle = '#ff7a18';
  ctx.fillRect(0, lavaTop, w, h - lavaTop);
  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    const wave = Math.sin(t * 1.6 + x * 0.5) * s * 0.25;
    ctx.fillStyle = mixHex('#ffb43d', '#ff5f00', (Math.sin(t * 2 + x) + 1) / 2);
    ctx.fillRect(x * s, lavaTop + wave, s, s * 0.8);
  }
  const glow = ctx.createLinearGradient(0, lavaTop - h * 0.25, 0, lavaTop);
  glow.addColorStop(0, 'rgba(255,120,0,0)');
  glow.addColorStop(1, `rgba(255,150,30,${0.35 + Math.sin(t * 2) * 0.08})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, lavaTop - h * 0.25, w, h * 0.25);

  // netherrack platforms
  for (let i = 0; i < 3; i++) {
    const px = Math.floor(rng() * (BLOCKS_ACROSS - 8)) * s;
    const py = lavaTop - (2 + Math.floor(rng() * 3)) * s;
    const len = 4 + Math.floor(rng() * 5);
    for (let b = 0; b < len; b++) {
      block(ctx, px + b * s, py, s, '#7a2b2b', 0.12);
      block(ctx, px + b * s, py + s, s, '#5e2020', 0.1);
    }
  }

  // ghast drifting past
  const gx = ((t * 22) % (w + 8 * s)) - 4 * s;
  const gy = h * 0.3 + Math.sin(t * 0.9) * s * 1.5;
  ctx.fillStyle = '#e8e2e2';
  ctx.fillRect(gx, gy, s * 4, s * 4);
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(gx + s * 0.8, gy + s * 1.3, s * 0.7, s * 0.5);
  ctx.fillRect(gx + s * 2.5, gy + s * 1.3, s * 0.7, s * 0.5);
  ctx.fillRect(gx + s * 1.4, gy + s * 2.4, s * 1.2, s * 0.6);
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(gx + s * (0.4 + i * 0.8), gy + s * 4, s * 0.5, s * (1 + Math.sin(t * 3 + i) * 0.4));
  }

  // embers
  ctx.fillStyle = '#ffd27a';
  for (let i = 0; i < 40; i++) {
    const ex = (rng() * w + Math.sin(t + i) * s) % w;
    const ey = h - ((rng() * h + t * 30 * (0.5 + rng())) % h);
    ctx.globalAlpha = 0.3 + rng() * 0.5;
    ctx.fillRect(ex, ey, s * 0.22, s * 0.22);
  }
  ctx.globalAlpha = 1;
}

/* --------------------------------------------------------------------- cave */

function cave(ctx, w, h, t, seed) {
  const s = w / BLOCKS_ACROSS;
  ctx.fillStyle = '#0b0b0e';
  ctx.fillRect(0, 0, w, h);
  const floor = noise1d(seed + ':cavef');
  const roof = noise1d(seed + ':caver');

  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    const fh = 3 + Math.round(floor(x * 0.25) * 4);
    const rh = 2 + Math.round(roof(x * 0.22) * 4);
    for (let y = 0; y < rh; y++) {
      const brng = makeRng(`${seed}:r:${x}:${y}`);
      block(ctx, x * s, y * s, s, '#3c3c42', 0.08);
      speckle(ctx, x * s, y * s, s, brng, 'rgba(0,0,0,0.3)', 2);
    }
    for (let y = 0; y < fh; y++) {
      const py = h - (y + 1) * s;
      const brng = makeRng(`${seed}:f:${x}:${y}`);
      block(ctx, x * s, py, s, '#45454c', 0.08);
      const r = brng();
      if (r > 0.93) speckle(ctx, x * s, py, s, brng, '#5ad7d7', 4);      // diamond
      else if (r > 0.88) speckle(ctx, x * s, py, s, brng, '#f2c14e', 4); // gold
      else if (r > 0.8) speckle(ctx, x * s, py, s, brng, '#c98d63', 4);  // copper
      else speckle(ctx, x * s, py, s, brng, 'rgba(0,0,0,0.28)', 2);
    }
  }

  // torchlight pooling on the walls, flickering
  const torches = [0.2, 0.5, 0.78];
  torches.forEach((tx, i) => {
    const flick = 0.82 + Math.sin(t * 9 + i * 2) * 0.1 + Math.sin(t * 23 + i) * 0.05;
    const cx = w * tx;
    const cy = h * 0.52;
    const rg = ctx.createRadialGradient(cx, cy, s * 0.5, cx, cy, s * 9 * flick);
    rg.addColorStop(0, 'rgba(255,190,90,0.55)');
    rg.addColorStop(0.5, 'rgba(255,150,60,0.14)');
    rg.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - s * 10, cy - s * 10, s * 20, s * 20);
    ctx.fillStyle = '#6b4a24';
    ctx.fillRect(cx, cy, s * 0.4, s * 1.6);
    ctx.fillStyle = '#ffcf5c';
    ctx.fillRect(cx - s * 0.1, cy - s * 0.5, s * 0.6, s * 0.6);
  });

  // creeper lurking in the dark, breathing in and out of visibility
  const vis = clamp(Math.sin(t * 0.5) * 0.5 + 0.5, 0.12, 0.95);
  const cx = w * 0.66;
  const cy = h * 0.55;
  ctx.globalAlpha = vis;
  ctx.fillStyle = '#4f9e46';
  ctx.fillRect(cx, cy, s * 2, s * 2);
  ctx.fillStyle = '#0d1a0d';
  ctx.fillRect(cx + s * 0.3, cy + s * 0.5, s * 0.5, s * 0.5);
  ctx.fillRect(cx + s * 1.2, cy + s * 0.5, s * 0.5, s * 0.5);
  ctx.fillRect(cx + s * 0.7, cy + s * 1.1, s * 0.6, s * 0.7);
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------- redstone */

function redstone(ctx, w, h, t, seed) {
  const s = w / BLOCKS_ACROSS;
  const rng = makeRng(seed + ':rs');
  // Per-build variation, otherwise every redstone contraption looks alike.
  const palette = [['#5a5a62', '#63636b'], ['#6d6a60', '#78756b'], ['#8e8e96', '#9a9aa2']][Math.floor(rng() * 3)];
  const lampCount = 4 + Math.floor(rng() * 4);
  const pistonCount = 2 + Math.floor(rng() * 3);
  const repeaterGap = 6 + Math.floor(rng() * 4);
  const floorRow = 0.52 + rng() * 0.16;
  const speed = 0.9 + rng() * 0.9;

  ctx.fillStyle = '#1b1c22';
  ctx.fillRect(0, 0, w, h);

  // smooth-stone floor
  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    for (let y = Math.floor(h * floorRow / s); y < h / s + 1; y++) {
      block(ctx, x * s, y * s, s, (x + y) % 2 ? palette[0] : palette[1], 0.07);
    }
  }

  const floorTop = Math.floor(h * floorRow / s) * s;
  const pulse = (t * speed) % 1;

  // dust line, lighting up left-to-right like a signal travelling
  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    const lit = clamp(1 - Math.abs(x / BLOCKS_ACROSS - pulse) * 9, 0, 1);
    ctx.fillStyle = mixHex('#5a1010', '#ff2d2d', lit);
    ctx.fillRect(x * s, floorTop - s * 0.18, s, s * 0.18);
    if (lit > 0.4) {
      ctx.fillStyle = `rgba(255,60,60,${lit * 0.25})`;
      ctx.fillRect(x * s - s, floorTop - s * 2, s * 3, s * 2);
    }
  }

  // repeaters
  for (let i = 0; i * repeaterGap + 6 < BLOCKS_ACROSS; i++) {
    const bx = 6 + i * repeaterGap;
    const rx = bx * s;
    const lit = clamp(1 - Math.abs(bx / BLOCKS_ACROSS - pulse) * 9, 0, 1);
    ctx.fillStyle = '#9a9aa2';
    ctx.fillRect(rx, floorTop - s * 0.3, s, s * 0.3);
    ctx.fillStyle = lit > 0.4 ? '#ff4d4d' : '#5a1010';
    ctx.fillRect(rx + s * 0.15, floorTop - s * 0.5, s * 0.2, s * 0.2);
  }

  // lamps blinking in sequence
  const lampGap = (BLOCKS_ACROSS - 6) / lampCount;
  for (let i = 0; i < lampCount; i++) {
    const lx = (3 + i * lampGap) * s;
    const on = Math.sin(t * 2 - i * 0.7) > 0;
    block(ctx, lx, floorTop - s * 3, s * 1.6, on ? '#ffd98a' : '#4a4436', 0.12);
    if (on) {
      const rg = ctx.createRadialGradient(lx + s * 0.8, floorTop - s * 2.2, s * 0.3, lx + s * 0.8, floorTop - s * 2.2, s * 5);
      rg.addColorStop(0, 'rgba(255,215,140,0.35)');
      rg.addColorStop(1, 'rgba(255,215,140,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(lx - s * 4, floorTop - s * 7, s * 10, s * 10);
    }
  }

  // pistons firing
  for (let i = 0; i < pistonCount; i++) {
    const px = (8 + i * (24 / pistonCount)) * s;
    const ext = clamp(Math.sin(t * 3 - i) * 2, 0, 1);
    block(ctx, px, floorTop - s * 5, s * 1.4, '#7d6a4a', 0.12);
    ctx.fillStyle = '#c8b58c';
    ctx.fillRect(px + s * 0.1, floorTop - s * 5 - ext * s, s * 1.2, s * 0.5 + ext * s);
  }
}

/* -------------------------------------------------------------------- build */

function build(ctx, w, h, t, seed) {
  const s = w / BLOCKS_ACROSS;
  const rng = makeRng(seed + ':build');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8fc9f2');
  g.addColorStop(1, '#dbeeff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const groundTop = h * 0.78;
  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    block(ctx, x * s, groundTop, s, '#5aa832', 0.14);
    for (let y = groundTop + s; y < h; y += s) block(ctx, x * s, y, s, '#8a5a33', 0.1);
  }

  // a castle that assembles itself over the clip's length
  const left = 5 + Math.floor(rng() * 5);
  const right = BLOCKS_ACROSS - 4 - Math.floor(rng() * 6);
  const towerH = 7 + Math.floor(rng() * 4);
  const wallBase = 4 + Math.floor(rng() * 3);
  const towerGap = 5 + Math.floor(rng() * 4);
  const stones = [['#8d8d95', '#a2a2aa'], ['#a89274', '#bda884'], ['#7f8a99', '#93a0af']][Math.floor(rng() * 3)];

  const plan = [];
  for (let x = left; x < right; x++) {
    const isTower = x === left || x === right - 1 || (x - left) % towerGap === 0;
    const wallH = x === left || x === right - 1 ? towerH : (isTower ? towerH - 1 : wallBase);
    for (let y = 0; y < wallH; y++) plan.push([x, y]);
  }
  plan.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const progress = clamp((t % 30) / 24, 0, 1);
  const built = Math.floor(plan.length * progress);
  for (let i = 0; i < built; i++) {
    const [bx, by] = plan[i];
    block(ctx, bx * s, groundTop - (by + 1) * s, s, (bx + by) % 3 === 0 ? stones[0] : stones[1], 0.12);
  }
  // the block currently being placed, with a little placement flash
  if (built < plan.length) {
    const [bx, by] = plan[built];
    ctx.globalAlpha = 0.5 + Math.sin(t * 12) * 0.3;
    block(ctx, bx * s, groundTop - (by + 1) * s, s, '#ffffff', 0.2);
    ctx.globalAlpha = 1;
  }

  // scaffolding clouds
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 4; i++) {
    const cy = Math.floor(rng() * 4 + 1) * s;
    const len = 3 + Math.floor(rng() * 4);
    const cx = ((rng() * w + t * 5) % (w + len * s)) - len * s;
    for (let b = 0; b < len; b++) ctx.fillRect(cx + b * s, cy, s, s);
  }
}

/* -------------------------------------------------------------------- ocean */

function ocean(ctx, w, h, t, seed) {
  const s = w / BLOCKS_ACROSS;
  const rng = makeRng(seed + ':ocean');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1b6fa8');
  g.addColorStop(1, '#052744');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // god rays
  for (let i = 0; i < 5; i++) {
    const rx = w * (0.1 + i * 0.2) + Math.sin(t * 0.4 + i) * s * 2;
    ctx.fillStyle = `rgba(180,225,255,${0.05 + Math.sin(t + i) * 0.02})`;
    ctx.beginPath();
    ctx.moveTo(rx, 0); ctx.lineTo(rx + s * 2, 0); ctx.lineTo(rx + s * 6, h); ctx.lineTo(rx, h);
    ctx.fill();
  }

  // seabed
  const bed = noise1d(seed + ':bed');
  for (let x = 0; x < BLOCKS_ACROSS; x++) {
    const hgt = 2 + Math.round(bed(x * 0.3) * 3);
    for (let y = 0; y < hgt; y++) {
      block(ctx, x * s, h - (y + 1) * s, s, y === hgt - 1 ? '#c8bb8a' : '#9c8f63', 0.1);
    }
    if (makeRng(`${seed}:kelp:${x}`)() > 0.82) {
      const kh = 3 + Math.floor(makeRng(`${seed}:kh:${x}`)() * 4);
      for (let k = 0; k < kh; k++) {
        const sway = Math.sin(t * 1.5 + k * 0.5 + x) * s * 0.3;
        block(ctx, x * s + sway, h - (hgt + k + 1) * s, s * 0.8, '#3d8b4a', 0.14);
      }
    }
  }

  // fish
  for (let i = 0; i < 7; i++) {
    const speed = 12 + rng() * 25;
    const fy = h * (0.15 + rng() * 0.5);
    const fx = ((rng() * w + t * speed) % (w + s * 4)) - s * 2;
    const col = ['#f5a623', '#e8e8e8', '#5ad7d7', '#d95555'][Math.floor(rng() * 4)];
    ctx.fillStyle = col;
    ctx.fillRect(fx, fy + Math.sin(t * 3 + i) * s * 0.3, s * 1.1, s * 0.7);
    ctx.fillRect(fx - s * 0.4, fy + s * 0.15 + Math.sin(t * 3 + i) * s * 0.3, s * 0.4, s * 0.4);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(fx + s * 0.75, fy + s * 0.2 + Math.sin(t * 3 + i) * s * 0.3, s * 0.18, s * 0.18);
  }

  // bubbles
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 30; i++) {
    const bx = rng() * w + Math.sin(t + i) * s * 0.4;
    const by = h - ((rng() * h + t * 25) % h);
    ctx.fillRect(bx, by, s * 0.25, s * 0.25);
  }
}

export const SCENES = { overworld, nether, cave, redstone, build, ocean };

export function drawScene(ctx, w, h, t, seed, style, opts = {}) {
  const fn = SCENES[style] || overworld;
  ctx.save();
  fn(ctx, w, h, Math.max(0, t), seed, opts);
  ctx.restore();
}

/* Thumbnails are just frame 0-ish of the same scene, plus the big blocky
   caption every Minecraft thumbnail on the internet seems to be legally
   required to have. */
export function drawThumbnail(canvas, video) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  drawScene(ctx, w, h, video.thumbTime ?? 12, video.seed, video.style, { static: false });

  if (video.overlay) {
    const fs = Math.round(h * 0.19);
    ctx.font = `900 ${fs}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = w / 2;
    const ty = h * 0.24;
    ctx.lineWidth = Math.max(3, fs * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(video.overlay, tx, ty);
    ctx.fillStyle = video.overlayColor || '#ffe14d';
    ctx.fillText(video.overlay, tx, ty);
  }
}
