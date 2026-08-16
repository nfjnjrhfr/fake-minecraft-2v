/* Event sounds, synthesised on the fly with WebAudio — no audio files, same as
   the picture. Nothing plays until the viewer presses play, which also gives
   the AudioContext the user gesture browsers require. */

let ctx = null;
let master = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setVolume(v) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v)) * 0.5;
}

function env(node, t0, attack, decay, peak = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  node.connect(g);
  g.connect(master);
  return g;
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  return buf;
}

function boom(power = 1) {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(1.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900 * power, t0);
  lp.frequency.exponentialRampToValueAtTime(90, t0 + 0.8);
  src.connect(lp);
  env(lp, t0, 0.01, 1.0, 0.9 * power);
  src.start(t0);
  src.stop(t0 + 1.2);

  // the low thump underneath
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120 * power, t0);
  osc.frequency.exponentialRampToValueAtTime(32, t0 + 0.5);
  env(osc, t0, 0.01, 0.6, 0.7 * power);
  osc.start(t0);
  osc.stop(t0 + 0.7);
}

function blip(freq, dur, type = 'square', peak = 0.25) {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  env(osc, t0, 0.005, dur, peak);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function chime(notes, gap = 0.09) {
  notes.forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.22), i * gap * 1000));
}

function hiss() {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.55);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;
  src.connect(hp);
  env(hp, t0, 0.06, 0.5, 0.35);
  src.start(t0);
  src.stop(t0 + 0.6);
}

/* Maps a scripted beat to a sound. Unknown beats stay silent on purpose. */
export function playBeat(kind) {
  if (!ensure() || ctx.state !== 'running') return;
  switch (kind) {
    case 'creeper': boom(1); break;
    case 'tnt': boom(1.15); break;
    case 'fireball': boom(0.8); break;
    case 'lightning': boom(1.3); break;
    case 'arrow': blip(880, 0.08, 'sawtooth', 0.18); break;
    case 'lava': blip(160, 0.35, 'sawtooth', 0.2); break;
    case 'drown': blip(300, 0.2, 'sine', 0.18); break;
    case 'ore': chime([880, 1175]); break;
    case 'treasure': chime([659, 880, 1319]); break;
    case 'levelup': chime([784, 988, 1319]); break;
    case 'signal': blip(1046, 0.1, 'square', 0.2); break;
    case 'place': blip(220, 0.06, 'square', 0.14); break;
    default: break;
  }
}

/* The creeper's fuse, played during the lead-in rather than on the beat. */
export function playFuse() {
  if (!ensure() || ctx.state !== 'running') return;
  hiss();
}

export function playHurt() {
  if (!ensure() || ctx.state !== 'running') return;
  blip(180, 0.16, 'square', 0.22);
}
