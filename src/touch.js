// Touch controls for tablets and phones: floating movement stick on the left,
// drag-to-look on the right, hold to mine, tap to place.

const TAP_MS = 190;        // shorter than this (and barely moved) counts as a tap
const TAP_SLOP = 14;       // pixels of movement still considered a tap
const STICK_RADIUS = 52;

export function isTouchDevice() {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!hasTouch) return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // iPadOS reports itself as a Mac; a paired trackpad makes the pointer "fine",
  // but the on-screen controls are still the right call there.
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return coarse || ios;
}

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.moveId = null;
    this.lookId = null;
    this.lastJump = 0;
    this.build();
    this.bind();
  }

  build() {
    const root = document.createElement('div');
    root.id = 'touchUI';
    root.innerHTML = `
      <div class="stick"><i></i></div>
      <button class="tbtn jump" aria-label="跳躍">▲</button>
      <button class="tbtn sneak" aria-label="潛行／下降">▼</button>
      <button class="tbtn inv" aria-label="物品欄">合成</button>
      <button class="tbtn menu" aria-label="選單">☰</button>
      <div class="thint">左側拖曳＝移動　右側拖曳＝環顧　長按＝挖掘　輕點＝放置</div>
    `;
    document.getElementById('ui').appendChild(root);
    this.root = root;
    this.stick = root.querySelector('.stick');
    this.knob = root.querySelector('.stick i');
    setTimeout(() => root.querySelector('.thint').classList.add('gone'), 9000);

    const hold = (sel, on, off) => {
      const el = root.querySelector(sel);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); }, { passive: false });
      for (const ev of ['touchend', 'touchcancel']) {
        el.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); off && off(); }, { passive: false });
      }
    };
    hold('.jump', () => {
      this.game.input.jump = true;
      const now = performance.now();
      if (now - this.lastJump < 340 && this.game.player.mode === 'creative') {
        this.game.player.flying = !this.game.player.flying;
        this.game.player.vel.y = 0;
      }
      this.lastJump = now;
    }, () => { this.game.input.jump = false; });
    hold('.sneak', () => { this.game.input.sneak = true; }, () => { this.game.input.sneak = false; });
    hold('.inv', () => {
      const ui = this.game.ui;
      if (ui.screen) ui.close(); else ui.open('inventory');
    });
    hold('.menu', () => {
      const ui = this.game.ui;
      if (ui.screen) ui.close(); else ui.open('pause');
    });
  }

  bind() {
    const canvas = this.game.canvas;
    const opts = { passive: false };
    canvas.addEventListener('touchstart', (e) => this.onStart(e), opts);
    canvas.addEventListener('touchmove', (e) => this.onMove(e), opts);
    canvas.addEventListener('touchend', (e) => this.onEnd(e), opts);
    canvas.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
    // Stop the page itself from scrolling or zooming under the game.
    document.addEventListener('touchmove', (e) => {
      if (!this.game.ui.screen) e.preventDefault();
    }, opts);
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
  }

  onStart(e) {
    e.preventDefault();
    this.game.sound.ensure();
    if (this.game.ui.screen) return;
    const split = window.innerWidth * 0.44;
    for (const t of e.changedTouches) {
      if (t.clientX < split && this.moveId === null) {
        this.moveId = t.identifier;
        this.moveOrigin = { x: t.clientX, y: t.clientY };
        this.stick.classList.add('active');
        this.stick.style.left = t.clientX + 'px';
        this.stick.style.top = t.clientY + 'px';
        this.knob.style.transform = 'translate(-50%,-50%)';
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookStart = { x: t.clientX, y: t.clientY, t: performance.now() };
        this.lookLast = { x: t.clientX, y: t.clientY };
        this.lookMoved = 0;
        this.mineTimer = setTimeout(() => {
          this.game.input.mine = true;
          this.game.onAttack();
        }, TAP_MS);
      }
    }
  }

  onMove(e) {
    e.preventDefault();
    if (this.game.ui.screen) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveId) {
        const dx = t.clientX - this.moveOrigin.x;
        const dy = t.clientY - this.moveOrigin.y;
        const d = Math.hypot(dx, dy) || 1;
        const clamp = Math.min(d, STICK_RADIUS) / d;
        this.knob.style.transform =
          `translate(calc(-50% + ${dx * clamp}px), calc(-50% + ${dy * clamp}px))`;
        const nx = dx / STICK_RADIUS, ny = dy / STICK_RADIUS;
        const dead = 0.22;
        const i = this.game.input;
        i.forward = ny < -dead;
        i.back = ny > dead;
        i.left = nx < -dead;
        i.right = nx > dead;
        i.sprint = Math.hypot(nx, ny) > 0.92;
      } else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookLast.x;
        const dy = t.clientY - this.lookLast.y;
        this.lookLast = { x: t.clientX, y: t.clientY };
        this.lookMoved += Math.hypot(dx, dy);
        const s = 0.0055;
        const p = this.game.player;
        p.yaw -= dx * s;
        p.pitch -= dy * s;
        const lim = Math.PI / 2 - 0.001;
        p.pitch = Math.max(-lim, Math.min(lim, p.pitch));
      }
    }
  }

  onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveId) {
        this.moveId = null;
        this.stick.classList.remove('active');
        const i = this.game.input;
        i.forward = i.back = i.left = i.right = i.sprint = false;
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
        clearTimeout(this.mineTimer);
        const quick = performance.now() - this.lookStart.t < TAP_MS;
        if (quick && this.lookMoved < TAP_SLOP && !this.game.ui.screen) {
          this.game.onUse();
        }
        this.game.input.mine = false;
        this.game.player.breakProgress = 0;
      }
    }
  }
}
