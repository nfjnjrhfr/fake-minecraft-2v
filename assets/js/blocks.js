/* Shared blocky drawing primitives, used by the scenes, the event layer and
   the HUD. Kept in its own module so those three can't form an import cycle. */

export function lerp(a, b, t) { return a + (b - a) * t; }

export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

export function mixHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const out = pa.map((c, i) => Math.round(lerp(c, pb[i], clamp(t, 0, 1))));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

/* A lighter top face and a darker right face turn a flat rect into a cube. */
export function block(ctx, x, y, s, color, shade = 0.18) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = `rgba(255,255,255,${shade})`;
  ctx.fillRect(x, y, s, Math.max(1, s * 0.18));
  ctx.fillStyle = `rgba(0,0,0,${shade * 0.9})`;
  ctx.fillRect(x + s - Math.max(1, s * 0.18), y, Math.max(1, s * 0.18), s);
}

export function speckle(ctx, x, y, s, rng, color, n = 3) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const px = x + Math.floor(rng() * 4) * (s / 4);
    const py = y + Math.floor(rng() * 4) * (s / 4);
    ctx.fillRect(px, py, s / 4, s / 4);
  }
}

/* Minecraft's UI is drawn with a hard drop shadow rather than an outline. */
export function shadowText(ctx, text, x, y, size, color = '#ffffff', align = 'left') {
  ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillText(text, x + size * 0.09, y + size * 0.09);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
