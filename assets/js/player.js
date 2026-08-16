/* The player. There is no <video> element anywhere in this project — the
   "footage" is drawn frame by frame into a canvas from drawScene(t), so
   scrubbing, speed changes and looping all fall out for free. */

import { drawScene } from './scene.js';
import { formatDuration, icon } from './util.js';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const QUALITIES = ['1080p', '720p', '480p', '360p', '144p'];

export class Player {
  constructor(root, video, opts = {}) {
    this.video = video;
    this.duration = video.duration;
    this.time = 0;
    this.playing = false;
    this.speed = 1;
    this.volume = Number(localStorage.getItem('mt:volume') ?? 0.7);
    this.muted = localStorage.getItem('mt:muted') === '1';
    this.quality = localStorage.getItem('mt:quality') || '1080p';
    this.onEnded = opts.onEnded || (() => {});
    this.onTheater = opts.onTheater || (() => {});
    this.theater = opts.theater || false;
    this._lastFrame = 0;
    this._hideTimer = 0;
    this.root = root;
    this._build();
    this._bind();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this.render();
  }

  _build() {
    this.root.classList.add('player');
    this.root.tabIndex = 0;
    this.root.innerHTML = `
      <canvas class="player-canvas"></canvas>
      <div class="player-scrim"></div>
      <button class="player-bigplay" aria-label="播放">${icon('play', 42)}</button>
      <div class="player-toast" hidden></div>
      ${this.video.live ? '<div class="player-livebadge"><span></span>直播中</div>' : ''}
      <div class="player-controls">
        <div class="player-scrub" role="slider" aria-label="播放進度" tabindex="0">
          <div class="scrub-track">
            <div class="scrub-buffer"></div>
            <div class="scrub-fill"></div>
            <div class="scrub-knob"></div>
          </div>
          <div class="scrub-preview" hidden>
            <canvas width="160" height="90"></canvas>
            <span>0:00</span>
          </div>
        </div>
        <div class="player-bar">
          <button class="pbtn js-play" aria-label="播放">${icon('play')}</button>
          <button class="pbtn js-next" aria-label="下一部影片">${icon('next')}</button>
          <div class="player-volume">
            <button class="pbtn js-mute" aria-label="靜音">${icon('volume')}</button>
            <input class="vol-slider" type="range" min="0" max="1" step="0.01" aria-label="音量">
          </div>
          <span class="player-time"><span class="js-cur">0:00</span> / <span class="js-dur">0:00</span></span>
          <div class="player-spacer"></div>
          <div class="player-menu-wrap">
            <button class="pbtn js-settings" aria-label="設定">${icon('settings')}</button>
            <div class="player-menu" hidden></div>
          </div>
          <button class="pbtn js-mini" aria-label="迷你播放器">${icon('miniplayer')}</button>
          <button class="pbtn js-theater" aria-label="劇院模式">${icon('theater')}</button>
          <button class="pbtn js-fs" aria-label="全螢幕">${icon('fullscreen')}</button>
        </div>
      </div>`;

    this.canvas = this.root.querySelector('.player-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.scrub = this.root.querySelector('.player-scrub');
    this.fill = this.root.querySelector('.scrub-fill');
    this.buffer = this.root.querySelector('.scrub-buffer');
    this.preview = this.root.querySelector('.scrub-preview');
    this.previewCanvas = this.preview.querySelector('canvas');
    this.previewLabel = this.preview.querySelector('span');
    this.menu = this.root.querySelector('.player-menu');
    this.volSlider = this.root.querySelector('.vol-slider');
    this.volSlider.value = this.muted ? 0 : this.volume;
    this.root.querySelector('.js-dur').textContent = formatDuration(this.duration);
    this._syncVolumeIcon();
    this._resize();
  }

  _bind() {
    const q = (s) => this.root.querySelector(s);
    q('.js-play').addEventListener('click', () => this.toggle());
    q('.player-bigplay').addEventListener('click', () => this.toggle());
    this.canvas.addEventListener('click', () => this.toggle());
    this.canvas.addEventListener('dblclick', () => this.toggleFullscreen());
    q('.js-next').addEventListener('click', () => this.onEnded());
    q('.js-mute').addEventListener('click', () => this.setMuted(!this.muted));
    q('.js-theater').addEventListener('click', () => {
      this.theater = !this.theater;
      this.onTheater(this.theater);
      this._resize();
    });
    q('.js-fs').addEventListener('click', () => this.toggleFullscreen());
    q('.js-mini').addEventListener('click', () => {
      this.root.classList.toggle('is-mini');
      this._resize();
    });
    q('.js-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      this.menu.hidden ? this._openMenu() : this._closeMenu();
    });
    document.addEventListener('click', () => this._closeMenu());

    this.volSlider.addEventListener('input', () => {
      this.volume = Number(this.volSlider.value);
      this.muted = this.volume === 0;
      localStorage.setItem('mt:volume', String(this.volume));
      localStorage.setItem('mt:muted', this.muted ? '1' : '0');
      this._syncVolumeIcon();
    });

    // scrubbing
    const seekFromEvent = (e) => {
      const r = this.scrub.getBoundingClientRect();
      const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width;
      this.seek(Math.max(0, Math.min(1, x)) * this.duration);
    };
    let dragging = false;
    this.scrub.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.scrub.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    this.scrub.addEventListener('pointermove', (e) => {
      if (dragging) seekFromEvent(e);
      this._showPreview(e);
    });
    this.scrub.addEventListener('pointerup', (e) => {
      dragging = false;
      this.scrub.releasePointerCapture(e.pointerId);
    });
    this.scrub.addEventListener('pointerleave', () => {
      this.preview.hidden = true;
    });
    this.scrub.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.seek(this.time + 5);
      if (e.key === 'ArrowLeft') this.seek(this.time - 5);
    });

    this.root.addEventListener('mousemove', () => this._wake());
    this.root.addEventListener('mouseleave', () => {
      if (this.playing) this.root.classList.add('hide-ui');
    });
    this.root.addEventListener('keydown', (e) => this._key(e));
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this._key(e);
    });
    document.addEventListener('fullscreenchange', () => {
      const fs = document.fullscreenElement === this.root;
      this.root.classList.toggle('is-fullscreen', fs);
      this.root.querySelector('.js-fs').innerHTML = icon(fs ? 'exitFullscreen' : 'fullscreen');
      this._resize();
    });
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.root);
  }

  _key(e) {
    const keys = {
      ' ': () => this.toggle(),
      k: () => this.toggle(),
      j: () => this.seek(this.time - 10),
      l: () => this.seek(this.time + 10),
      ArrowLeft: () => this.seek(this.time - 5),
      ArrowRight: () => this.seek(this.time + 5),
      ArrowUp: () => this._nudgeVolume(0.05),
      ArrowDown: () => this._nudgeVolume(-0.05),
      m: () => this.setMuted(!this.muted),
      f: () => this.toggleFullscreen(),
      t: () => {
        this.theater = !this.theater;
        this.onTheater(this.theater);
      },
      '>': () => this._cycleSpeed(1),
      '<': () => this._cycleSpeed(-1),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
      this._wake();
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      this.seek((Number(e.key) / 10) * this.duration);
      this._wake();
    }
  }

  _nudgeVolume(d) {
    this.volume = Math.max(0, Math.min(1, this.volume + d));
    this.muted = this.volume === 0;
    this.volSlider.value = this.volume;
    localStorage.setItem('mt:volume', String(this.volume));
    this._syncVolumeIcon();
    this._toast(`音量 ${Math.round(this.volume * 100)}%`);
  }

  _cycleSpeed(dir) {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
    this._toast(`${this.speed}x`);
  }

  _syncVolumeIcon() {
    const b = this.root.querySelector('.js-mute');
    b.innerHTML = icon(this.muted || this.volume === 0 ? 'muted' : 'volume');
    this.volSlider.style.setProperty('--vol', `${(this.muted ? 0 : this.volume) * 100}%`);
  }

  _toast(msg) {
    const t = this.root.querySelector('.player-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, 900);
  }

  _openMenu() {
    this.menu.hidden = false;
    this.menu.innerHTML = `
      <button class="menu-row" data-menu="speed"><span>播放速度</span><span class="menu-val">${this.speed === 1 ? '標準' : this.speed + 'x'} ›</span></button>
      <button class="menu-row" data-menu="quality"><span>畫質</span><span class="menu-val">${this.quality} ›</span></button>
      <button class="menu-row" data-menu="captions"><span>字幕</span><span class="menu-val">中文（繁體）›</span></button>`;
    this.menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = e.target.closest('[data-menu]');
      if (!row) return;
      const kind = row.dataset.menu;
      if (kind === 'speed') this._submenu('播放速度', SPEEDS.map((s) => [s === 1 ? '標準' : `${s}x`, s]), this.speed, (v) => {
        this.speed = v;
        this._closeMenu();
      });
      if (kind === 'quality') this._submenu('畫質', QUALITIES.map((s) => [s, s]), this.quality, (v) => {
        this.quality = v;
        localStorage.setItem('mt:quality', v);
        this._closeMenu();
        this._resize();
      });
      if (kind === 'captions') this._submenu('字幕', [['關閉', 'off'], ['中文（繁體）', 'zh'], ['English', 'en']], 'zh', () => this._closeMenu());
    }, { once: true });
  }

  _submenu(title, items, current, onPick) {
    this.menu.innerHTML = `<button class="menu-row menu-head">‹ ${title}</button>` +
      items.map(([label, val]) => `<button class="menu-row" data-val="${val}">
        <span class="menu-check">${String(val) === String(current) ? icon('check', 18) : ''}</span><span>${label}</span></button>`).join('');
    this.menu.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.menu-head')) { this._openMenu(); return; }
      const row = e.target.closest('[data-val]');
      if (!row) return;
      const raw = row.dataset.val;
      onPick(isNaN(Number(raw)) ? raw : Number(raw));
    }, { once: true });
  }

  _closeMenu() {
    if (this.menu) this.menu.hidden = true;
  }

  _showPreview(e) {
    const r = this.scrub.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const t = p * this.duration;
    this.preview.hidden = false;
    this.preview.style.left = `${Math.max(84, Math.min(r.width - 84, p * r.width))}px`;
    this.previewLabel.textContent = formatDuration(t);
    drawScene(this.previewCanvas.getContext('2d'), 160, 90, t, this.video.seed, this.video.style);
  }

  _wake() {
    this.root.classList.remove('hide-ui');
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this.playing) this.root.classList.add('hide-ui');
    }, 2600);
  }

  _resize() {
    const rect = this.root.getBoundingClientRect();
    if (!rect.width) return;
    // Lower "quality" settings genuinely render fewer pixels, which is a
    // cheap way to make the setting mean something.
    const scale = { '1080p': 1, '720p': 0.72, '480p': 0.5, '360p': 0.36, '144p': 0.16 }[this.quality] ?? 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    // Clamped to the viewport as a backstop: if a host page ever lets the
    // canvas size drive layout, an unclamped value would grow every tick.
    const cw = Math.min(rect.width, window.innerWidth) * dpr;
    const ch = Math.min(rect.height, window.innerHeight) * dpr;
    this.canvas.width = Math.max(160, Math.round(cw));
    this.canvas.height = Math.max(90, Math.round(ch));
    this.render();
  }

  _loop(now) {
    const dt = this._lastFrame ? (now - this._lastFrame) / 1000 : 0;
    this._lastFrame = now;
    if (this.playing) {
      this.time += dt * this.speed;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.playing = false;
        this._syncPlayIcon();
        this.root.classList.remove('hide-ui');
        this.onEnded();
      }
      this.render();
      this._syncProgress();
    }
    this._raf = requestAnimationFrame(this._loop);
  }

  render() {
    drawScene(this.ctx, this.canvas.width, this.canvas.height, this.time, this.video.seed, this.video.style);
  }

  _syncProgress() {
    const p = (this.time / this.duration) * 100;
    this.fill.style.width = `${p}%`;
    this.buffer.style.width = `${Math.min(100, p + 12 + (Math.sin(this.time / 7) + 1) * 6)}%`;
    this.root.querySelector('.js-cur').textContent = formatDuration(this.time);
    this.scrub.setAttribute('aria-valuenow', Math.round(this.time));
  }

  _syncPlayIcon() {
    const name = this.playing ? 'pause' : 'play';
    this.root.querySelector('.js-play').innerHTML = icon(name);
    this.root.querySelector('.js-play').setAttribute('aria-label', this.playing ? '暫停' : '播放');
    this.root.classList.toggle('is-playing', this.playing);
  }

  play() {
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this._syncPlayIcon();
    this._wake();
  }

  pause() {
    this.playing = false;
    this._syncPlayIcon();
    this.root.classList.remove('hide-ui');
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.render();
    this._syncProgress();
    this._wake();
  }

  setMuted(m) {
    this.muted = m;
    if (!m && this.volume === 0) this.volume = 0.5;
    this.volSlider.value = m ? 0 : this.volume;
    localStorage.setItem('mt:muted', m ? '1' : '0');
    this._syncVolumeIcon();
    this._toast(m ? '靜音' : `音量 ${Math.round(this.volume * 100)}%`);
  }

  toggleFullscreen() {
    if (document.fullscreenElement === this.root) document.exitFullscreen();
    else this.root.requestFullscreen?.();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    clearTimeout(this._hideTimer);
  }
}
