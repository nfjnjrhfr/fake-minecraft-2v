/* What turns a looping background into a clip you'd actually watch: a script
   of timed events. Every beat is derived from the video's seed, so the same
   video always plays the same way — scrubbing back to 12:04 shows the same
   creeper going off — while different videos get different runs of luck. */

import { makeRng } from './rng.js';
import { block, clamp, shadowText } from './blocks.js';

/* damage is in half-hearts; heavy beats also shake the camera. */
export const BEATS = {
  creeper:  { damage: 7, shake: 1.0, flash: 0.3, lead: 3.2, chat: '苦力怕從背後貼上來了', toast: null },
  tnt:      { damage: 6, shake: 1.0, flash: 0.34, lead: 2.4, chat: 'TNT 點下去了', toast: null },
  fireball: { damage: 5, shake: 0.8, flash: 0.28, lead: 1.4, chat: '地獄幽靈發射火球', toast: null },
  lightning:{ damage: 0, shake: 0.55, flash: 0.7, lead: 0.6, chat: '雷打在旁邊那棵樹上', toast: null },
  arrow:    { damage: 3, shake: 0.25, flash: 0, lead: 1.0, chat: '骷髏射過來了', toast: null },
  lava:     { damage: 4, shake: 0.2, flash: 0.2, lead: 0.5, chat: '腳滑掉進岩漿', toast: null, tint: '#ff7a18' },
  drown:    { damage: 2, shake: 0, flash: 0, lead: 0.5, chat: '氧氣快沒了', toast: null, tint: '#1b6fa8' },
  ore:      { damage: 0, shake: 0.15, flash: 0, lead: 0.8, chat: null, toast: '挖到鑽石礦脈 ×3' },
  treasure: { damage: 0, shake: 0, flash: 0.2, lead: 1.0, chat: null, toast: '寶箱：附魔金蘋果 ×1' },
  place:    { damage: 0, shake: 0.1, flash: 0, lead: 0.6, chat: null, toast: null },
  signal:   { damage: 0, shake: 0.2, flash: 0.25, lead: 1.2, chat: '訊號通了！', toast: '電路測試通過' },
  levelup:  { damage: 0, shake: 0, flash: 0.15, lead: 0.4, chat: null, toast: null },
};

const STYLE_BEATS = {
  overworld: ['creeper', 'lightning', 'arrow', 'ore', 'levelup', 'tnt', 'place'],
  nether: ['fireball', 'lava', 'tnt', 'ore', 'levelup'],
  cave: ['ore', 'creeper', 'arrow', 'levelup', 'lava'],
  redstone: ['signal', 'place', 'tnt', 'levelup'],
  build: ['place', 'levelup', 'lightning', 'ore'],
  ocean: ['treasure', 'drown', 'ore', 'levelup'],
};

const CHAT_FILLER = [
  '這個地形我從來沒看過',
  '等一下，那邊有東西在動',
  '先回去補一下裝備',
  '我覺得這裡可以蓋個小屋',
  '天要黑了，趕快',
  '座標記一下，等等要回來',
  '這波真的很險',
  '好，冷靜，慢慢來',
];

const ACHIEVEMENTS = [
  '進度已達成！ 挖得更深',
  '進度已達成！ 鑽石！',
  '進度已達成！ 熱力四射',
  '進度已達成！ 這不是派對嗎',
  '進度已達成！ 甜蜜的家',
];

const scripts = new Map();

/* One beat every ~20-35s, plus a guaranteed headline moment placed where the
   video's own description says the interesting thing happens. */
export function scriptFor(video) {
  if (scripts.has(video.id)) return scripts.get(video.id);
  const rng = makeRng(video.id + ':script');
  const kinds = STYLE_BEATS[video.style] || STYLE_BEATS.overworld;
  const out = [];

  const peakAt = clamp((video.peak ?? 0.62) * video.duration, 8, video.duration - 6);
  const peakKind = video.peakKind || kinds[0];
  out.push({ t: peakAt, kind: peakKind, headline: true });

  // a compilation ("爆炸 100 次") wants beats stacked much closer together
  const gap = video.dense ? 7 : 18;
  const spread = video.dense ? 9 : 26;
  let t = 6 + rng() * 14;
  while (t < video.duration - 5) {
    if (Math.abs(t - peakAt) > 10) {
      out.push({ t, kind: kinds[Math.floor(rng() * kinds.length)] });
    }
    t += gap + rng() * spread;
  }
  // chatter between the action so the clip is never silent for long
  let c = 4 + rng() * 8;
  while (c < video.duration - 4) {
    out.push({ t: c, kind: 'chatter', text: CHAT_FILLER[Math.floor(rng() * CHAT_FILLER.length)] });
    c += 12 + rng() * 22;
  }

  out.sort((a, b) => a.t - b.t);
  out.forEach((b, i) => {
    b.i = i;
    b.rng = makeRng(`${video.id}:${i}`)();
  });
  scripts.set(video.id, out);
  return out;
}

export function peakTime(video) {
  return scriptFor(video).find((b) => b.headline)?.t ?? video.duration * 0.5;
}

/* Everything the HUD and the overlays need, replayed from the start of the
   clip so any seek lands on a consistent state. */
export function stateAt(script, t, video) {
  let hearts = 20;          // half-hearts
  let lastDamage = -99;
  let level = 0;
  let shake = 0;
  let flash = 0;
  let tint = null;
  let tintAmount = 0;
  const chat = [];
  let toast = null;

  for (const b of script) {
    if (b.t > t) break;
    const age = t - b.t;
    if (b.kind === 'chatter') {
      chat.push({ text: b.text, age });
      continue;
    }
    const def = BEATS[b.kind];
    if (!def) continue;

    if (def.damage) {
      // regen since the previous hit, then take the new one
      hearts = Math.min(20, hearts + Math.max(0, (b.t - lastDamage - 4)) * 0.35);
      hearts = Math.max(1, hearts - def.damage);
      lastDamage = b.t;
    }
    if (b.kind === 'levelup' || b.kind === 'ore') level += b.kind === 'ore' ? 3 : 1;
    if (def.chat) chat.push({ text: def.chat, age });
    if (def.toast) toast = { text: def.toast, age };
    if (b.kind === 'levelup') toast = { text: ACHIEVEMENTS[Math.floor(b.rng * ACHIEVEMENTS.length)], age };

    if (age < 1.2) {
      shake = Math.max(shake, def.shake * (1 - age / 1.2));
      flash = Math.max(flash, def.flash * Math.max(0, 1 - age / 0.3));
    }
    if (def.tint && age < 2.5) {
      tint = def.tint;
      tintAmount = Math.max(tintAmount, 0.35 * (1 - age / 2.5));
    }
  }

  hearts = Math.min(20, hearts + Math.max(0, (t - lastDamage - 4)) * 0.35);
  const hurt = clamp(1 - (t - lastDamage) / 0.7, 0, 1);

  return {
    hearts,
    level,
    shake,
    flash,
    tint,
    tintAmount,
    hurt,
    chat: chat.filter((c) => c.age < 11).slice(-5),
    toast: toast && toast.age < 4.5 ? toast : null,
  };
}

/* ------------------------------------------------------------- event props */

function explosion(ctx, w, h, cx, cy, age, s, rngv) {
  const p = clamp(age / 0.85, 0, 1);
  const r = s * (1 + p * 12);

  // hot core, only for the first instants
  if (p < 0.4) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1);
    g.addColorStop(0, `rgba(255,240,190,${0.95 - p * 2})`);
    g.addColorStop(0.45, `rgba(255,140,40,${0.7 - p * 1.5})`);
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4);
  }

  ctx.globalAlpha = 1 - p;
  // blocky fireball: rings of squares rather than a smooth circle
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rngv * 6;
    const rr = r * (0.5 + ((i * 37 + rngv * 100) % 55) / 100);
    const bx = cx + Math.cos(a) * rr;
    const by = cy + Math.sin(a) * rr * 0.75;
    const sz = s * (1.5 - p) * (0.6 + ((i * 13) % 40) / 60);
    const shade = i % 5;
    ctx.fillStyle = shade === 0 ? '#fff3c4' : shade === 1 ? '#ffb03d'
      : shade === 2 ? '#ff6a1a' : shade === 3 ? '#a83a12' : '#59524d';
    ctx.fillRect(bx - sz / 2, by - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;
  // debris arcing out and falling
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const d = s * (2 + i % 5) * age * 6;
    const bx = cx + Math.cos(a) * d;
    const by = cy + Math.sin(a) * d * 0.6 + age * age * s * 26;
    if (by > h) continue;
    ctx.fillStyle = i % 2 ? '#6b4a24' : '#5aa832';
    ctx.fillRect(bx, by, s * 0.5, s * 0.5);
  }
}

function creeperSprite(ctx, x, y, s, flashAmt) {
  const green = flashAmt > 0 ? `rgba(255,255,255,${flashAmt})` : null;
  ctx.fillStyle = '#4f9e46';
  ctx.fillRect(x, y, s * 2, s * 2);       // head
  ctx.fillRect(x + s * 0.35, y + s * 2, s * 1.3, s * 2.4); // body
  ctx.fillStyle = '#0d1a0d';
  ctx.fillRect(x + s * 0.3, y + s * 0.5, s * 0.5, s * 0.5);
  ctx.fillRect(x + s * 1.2, y + s * 0.5, s * 0.5, s * 0.5);
  ctx.fillRect(x + s * 0.7, y + s * 1.1, s * 0.6, s * 0.8);
  ctx.fillStyle = '#3d7a36';
  ctx.fillRect(x + s * 0.35, y + s * 4.4, s * 0.5, s * 0.6);
  ctx.fillRect(x + s * 1.15, y + s * 4.4, s * 0.5, s * 0.6);
  if (green) {
    ctx.fillStyle = green;
    ctx.fillRect(x, y, s * 2, s * 5);
  }
}

function lightningBolt(ctx, w, h, x, age, s) {
  if (age > 0.28) return;
  ctx.globalAlpha = 1 - age / 0.28;
  ctx.fillStyle = '#eaf0ff';
  let bx = x;
  for (let y = 0; y < h * 0.72; y += s) {
    bx += ((y / s) % 3 === 0 ? 1 : -1) * s * 0.5;
    ctx.fillRect(bx, y, s * 0.7, s);
  }
  ctx.globalAlpha = 1;
}

/* Draws whatever is happening right now on top of the scene. */
export function drawEvents(ctx, w, h, t, script, opts = {}) {
  const s = w / 40;
  const ground = h * (opts.ground ?? 0.72);

  for (const b of script) {
    const age = t - b.t;
    const def = BEATS[b.kind];
    if (!def) continue;
    if (age < -def.lead || age > 1.6) continue;

    const cx = w * (0.2 + b.rng * 0.6);

    if (b.kind === 'creeper') {
      if (age < 0) {
        // walks in from the right, flashing white just before it blows
        const p = 1 + age / def.lead;
        const x = w * 0.95 - (w * 0.95 - cx) * p;
        const hop = Math.abs(Math.sin(age * 7)) * s * 0.3;
        const fl = age > -1.1 ? Math.abs(Math.sin(age * 16)) * 0.85 : 0;
        creeperSprite(ctx, x, ground - s * 5 - hop, s, fl);
      } else {
        explosion(ctx, w, h, cx, ground - s * 2, age, s, b.rng);
      }
    } else if (b.kind === 'tnt') {
      if (age < 0) {
        const blink = Math.sin(age * 18) > 0;
        block(ctx, cx, ground - s, s * 1.4, blink ? '#ffffff' : '#c73b2b', 0.14);
        ctx.fillStyle = blink ? '#c73b2b' : '#ffffff';
        ctx.fillRect(cx, ground - s * 0.7, s * 1.4, s * 0.35);
      } else {
        explosion(ctx, w, h, cx + s * 0.7, ground - s, age, s * 1.2, b.rng);
      }
    } else if (b.kind === 'fireball') {
      if (age < 0) {
        const p = 1 + age / def.lead;
        const fx = w * 0.15 + (cx - w * 0.15) * p;
        const fy = h * 0.3 + (ground - s * 2 - h * 0.3) * p * p;
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(fx, fy, s, s);
        ctx.fillStyle = '#ff7a18';
        ctx.fillRect(fx - s * 0.3, fy - s * 0.3, s * 0.5, s * 0.5);
        ctx.fillRect(fx + s * 0.8, fy + s * 0.8, s * 0.5, s * 0.5);
      } else {
        explosion(ctx, w, h, cx, ground - s * 2, age, s, b.rng);
      }
    } else if (b.kind === 'lightning') {
      lightningBolt(ctx, w, h, cx, age, s);
    } else if (b.kind === 'arrow') {
      const p = clamp(1 + age / def.lead, 0, 1.3);
      const ax = w * 1.02 - w * 0.9 * p;
      const ay = h * 0.42 + p * p * s * 3;
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(ax, ay, s * 1.1, s * 0.2);
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(ax - s * 0.25, ay - s * 0.1, s * 0.3, s * 0.4);
    } else if (b.kind === 'ore') {
      // sparkles popping off a freshly broken vein
      const p = clamp((age + def.lead) / (def.lead + 1.2), 0, 1);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const d = s * 3 * p;
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = i % 2 ? '#5ad7d7' : '#ffffff';
        ctx.fillRect(cx + Math.cos(a) * d, ground - s * 3 + Math.sin(a) * d, s * 0.35, s * 0.35);
      }
      ctx.globalAlpha = 1;
    } else if (b.kind === 'treasure') {
      const p = clamp((age + def.lead) / (def.lead + 1.4), 0, 1);
      block(ctx, cx, ground - s * 1.2, s * 1.6, '#8a5a33', 0.14);
      ctx.fillStyle = '#f2c14e';
      for (let i = 0; i < 10; i++) {
        const gy = ground - s * 1.4 - p * s * (2 + i % 4);
        ctx.globalAlpha = 1 - p;
        ctx.fillRect(cx + s * (0.2 + (i % 5) * 0.3), gy, s * 0.28, s * 0.28);
      }
      ctx.globalAlpha = 1;
    } else if (b.kind === 'place' || b.kind === 'signal') {
      const p = clamp((age + def.lead) / (def.lead + 0.9), 0, 1);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = b.kind === 'signal' ? '#ff4d4d' : '#ffffff';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.fillRect(cx + Math.cos(a) * s * 2 * p, ground - s * 2 + Math.sin(a) * s * 2 * p, s * 0.3, s * 0.3);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* Full-frame overlays: hit flash, damage vignette, element tint. */
export function drawOverlays(ctx, w, h, st) {
  if (st.tint && st.tintAmount > 0.01) {
    ctx.fillStyle = st.tint;
    ctx.globalAlpha = st.tintAmount;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  if (st.hurt > 0.01) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.62);
    g.addColorStop(0, 'rgba(180,0,0,0)');
    g.addColorStop(1, `rgba(170,0,0,${0.55 * st.hurt})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (st.flash > 0.01) {
    ctx.fillStyle = `rgba(255,250,235,${st.flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/* A caption burned into the peak frame, the way a highlight clip would. */
export function drawPeakCaption(ctx, w, h, text) {
  const size = h * 0.075;
  ctx.save();
  shadowText(ctx, text, w / 2, h * 0.9, size, '#ffe14d', 'center');
  ctx.restore();
}
