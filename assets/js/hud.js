/* The in-game HUD. This is what makes a canvas animation read as recorded
   gameplay rather than as a wallpaper: a hotbar, hearts that actually drop
   when something explodes, chat, and an achievement toast. */

import { clamp, shadowText } from './blocks.js';

const ITEMS = [
  { name: 'pick', count: null },
  { name: 'sword', count: null },
  { name: 'torch', count: 46 },
  { name: 'stone', count: 64 },
  { name: 'dirt', count: 38 },
  { name: 'bread', count: 12 },
  { name: 'bucket', count: null },
  { name: 'tnt', count: 7 },
  { name: 'bow', count: null },
];

function itemIcon(ctx, kind, x, y, u) {
  const px = (cx, cy, cw, ch, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + cx * u, y + cy * u, cw * u, ch * u);
  };
  switch (kind) {
    case 'pick':
      px(6, 16, 10, 3, '#8a5a33');
      px(4, 6, 14, 4, '#5ad7d7');
      px(2, 9, 4, 3, '#5ad7d7');
      px(16, 9, 4, 3, '#5ad7d7');
      break;
    case 'sword':
      px(9, 4, 4, 12, '#d8e6ea');
      px(6, 15, 10, 3, '#8a5a33');
      px(9, 18, 4, 4, '#6b4a24');
      break;
    case 'torch':
      px(9, 10, 4, 12, '#8a5a33');
      px(8, 5, 6, 6, '#ffcf5c');
      break;
    case 'stone':
      px(4, 5, 15, 15, '#8d8d95');
      px(6, 8, 4, 4, '#6f6f77');
      px(12, 13, 4, 4, '#a2a2aa');
      break;
    case 'dirt':
      px(4, 5, 15, 15, '#8a5a33');
      px(4, 5, 15, 4, '#5aa832');
      break;
    case 'bread':
      px(4, 8, 15, 9, '#c98d63');
      px(7, 6, 3, 3, '#b07a52');
      px(13, 6, 3, 3, '#b07a52');
      break;
    case 'bucket':
      px(6, 8, 11, 12, '#b9c0c7');
      px(7, 10, 9, 5, '#2f6fb0');
      break;
    case 'tnt':
      px(4, 6, 15, 13, '#c73b2b');
      px(4, 10, 15, 4, '#f0f0f0');
      px(10, 3, 3, 4, '#8a8a8a');
      break;
    case 'bow':
      px(6, 4, 3, 16, '#8a5a33');
      px(9, 3, 3, 3, '#8a5a33');
      px(9, 18, 3, 3, '#8a5a33');
      px(12, 6, 2, 12, '#e8e8e8');
      break;
  }
}

function heart(ctx, x, y, u, fill) {
  // 0 = empty container, 0.5 = half, 1 = full
  const draw = (color, half) => {
    ctx.fillStyle = color;
    const w = half ? 4 : 8;
    ctx.fillRect(x + u, y, w * u, 6 * u);
    ctx.fillRect(x, y + u, Math.min(w, 3) * u, 4 * u);
    if (!half) ctx.fillRect(x + 6 * u, y + u, 3 * u, 4 * u);
    ctx.fillRect(x + 2 * u, y + 6 * u, Math.min(w, 5) * u, 2 * u);
  };
  draw('rgba(20,10,10,0.75)', false);
  if (fill >= 1) draw('#ff3b3b', false);
  else if (fill >= 0.5) draw('#ff3b3b', true);
}

function drumstick(ctx, x, y, u, full) {
  ctx.fillStyle = full ? '#c98d63' : 'rgba(20,10,10,0.7)';
  ctx.fillRect(x + 2 * u, y, 5 * u, 5 * u);
  ctx.fillRect(x, y + 4 * u, 7 * u, 3 * u);
  ctx.fillStyle = full ? '#f0e0c0' : 'rgba(20,10,10,0.7)';
  ctx.fillRect(x + 6 * u, y + 5 * u, 3 * u, 2 * u);
}

export function drawHud(ctx, w, h, t, video, st) {
  const u = h / 260;              // one "GUI pixel"
  const slot = u * 22;
  const barW = slot * 9;
  const barX = (w - barW) / 2;
  const barY = h - slot - u * 26;   // clear of the player's control bar

  ctx.save();

  // crosshair
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(w / 2 - u * 5, h / 2 - u, u * 10, u * 2);
  ctx.fillRect(w / 2 - u, h / 2 - u * 5, u * 2, u * 10);

  // hotbar
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(barX, barY, barW, slot);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = Math.max(1, u);
  ctx.strokeRect(barX, barY, barW, slot);
  const selected = Math.floor(t / 7) % 9;
  ITEMS.forEach((item, i) => {
    const sx = barX + i * slot;
    itemIcon(ctx, item.name, sx + slot * 0.14, barY + slot * 0.14, (slot * 0.72) / 24);
    if (item.count) {
      shadowText(ctx, String(item.count), sx + slot * 0.92, barY + slot * 0.92, u * 8, '#ffffff', 'right');
    }
  });
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, u * 1.6);
  ctx.strokeRect(barX + selected * slot - u, barY - u, slot + u * 2, slot + u * 2);

  // hearts + hunger sit on the row above the hotbar
  const rowY = barY - u * 13;
  for (let i = 0; i < 10; i++) {
    heart(ctx, barX + i * u * 9, rowY, u, clamp(st.hearts / 2 - i, 0, 1));
  }
  const hunger = clamp(10 - Math.floor(t / 90), 4, 10);
  for (let i = 0; i < 10; i++) {
    drumstick(ctx, barX + barW - u * 9 - i * u * 9, rowY, u, i < hunger);
  }

  // xp bar + level
  const xpY = barY - u * 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(barX, xpY, barW, u * 2.6);
  ctx.fillStyle = '#7ddc3a';
  ctx.fillRect(barX, xpY, barW * ((t / 24) % 1), u * 2.6);
  shadowText(ctx, String(st.level), w / 2, xpY - u * 1.5, u * 9, '#7ddc3a', 'center');

  // chat log, fading out with age
  st.chat.forEach((line, i) => {
    const alpha = clamp(1 - (line.age - 8) / 3, 0, 1);
    const y = rowY - u * 16 - (st.chat.length - 1 - i) * u * 11;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const text = `<${video.channelObj?.name || 'Steve'}> ${line.text}`;
    ctx.font = `600 ${u * 9}px "Segoe UI", system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    ctx.fillRect(u * 6, y - u * 9, tw + u * 8, u * 12);
    shadowText(ctx, text, u * 10, y, u * 9, '#ffffff');
    ctx.globalAlpha = 1;
  });

  // achievement toast slides in from the top-right
  if (st.toast) {
    const p = clamp(st.toast.age / 0.4, 0, 1) * clamp((4.5 - st.toast.age) / 0.5, 0, 1);
    const tw = u * 120;
    const tx = w - tw - u * 8;
    const ty = u * 8 - (1 - p) * u * 30;
    ctx.globalAlpha = p;
    ctx.fillStyle = 'rgba(12,12,12,0.9)';
    ctx.fillRect(tx, ty, tw, u * 26);
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = Math.max(1, u * 1.4);
    ctx.strokeRect(tx, ty, tw, u * 26);
    shadowText(ctx, st.toast.text, tx + u * 8, ty + u * 17, u * 10, '#ffe14d');
    ctx.globalAlpha = 1;
  }

  // speedruns get a timer; everything else gets the F3 coordinate line
  if (video.channel === 'sp') {
    shadowText(ctx, formatTimer(t), u * 10, u * 20, u * 16, '#ffffff');
  } else {
    const x = (120 + t * 1.6).toFixed(1);
    const z = (-204 + Math.sin(t / 9) * 12).toFixed(1);
    shadowText(ctx, `XYZ: ${x} / 63 / ${z}`, u * 10, u * 16, u * 9, 'rgba(255,255,255,0.85)');
    shadowText(ctx, `${Math.round(58 + Math.sin(t) * 4)} fps`, u * 10, u * 28, u * 9, 'rgba(255,255,255,0.85)');
  }

  ctx.restore();
}

function formatTimer(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
