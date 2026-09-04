import { NATIVE_APPS } from './apps.js';
import { playGame } from './games.js';
import { renderMock, runtimeStats } from './mocks.js';
import { $, api, el, esc, fmtSize, tint } from './util.js';

const PER_PAGE = 20;
const memo = {}; // App 之間保留的暫存（例如商店選到哪個來源）

const ui = {
  screen: $('#screen'),
  wallpaper: $('#wallpaper'),
  veil: $('#veil'),
  lock: $('#lock'),
  home: $('#home'),
  pages: $('#pages'),
  dots: $('#dots'),
  dock: $('#dock'),
  appwin: $('#appwin'),
  control: $('#control'),
  switcher: $('#switcher'),
  banner: $('#banner'),
  island: $('#island'),
  homebar: $('#homebar'),
};

let state = null;
let page = 0;
let openId = null;
let recents = [];
let cleanups = [];
let bannerTimer;
let islandTimer;

/* ---------------- 狀態 ---------------- */
async function reload() {
  setState(await api('/api/state'));
}

function setState(next) {
  state = next;
  applyDevice();
  renderHome();
  if (openId) renderAppHeader(deviceApp(openId));
}

const allApps = () => [...(state?.builtins ?? []), ...(state?.installed ?? [])];
const deviceApp = (id) => allApps().find((a) => a.id === id) ?? null;
const sourceOf = (os) => state.sources.find((s) => s.os === os);

/* ---------------- 裝置外觀 ---------------- */
function applyDevice() {
  const { device, wallpapers } = state;
  const custom = device.wallpaper === 'custom' && device.wallpaperImage;
  if (custom) {
    ui.wallpaper.style.backgroundImage = `url("${device.wallpaperImage}")`;
    ui.wallpaper.classList.add('photo');
  } else {
    const wp = wallpapers.find((w) => w.id === device.wallpaper) ?? wallpapers[0];
    ui.wallpaper.style.backgroundImage = 'none';
    ui.wallpaper.classList.remove('photo');
    ui.wallpaper.style.setProperty('--wp-from', wp.from);
    ui.wallpaper.style.setProperty('--wp-to', wp.to);
  }
  // 深色模式與使用者調整的模糊／變暗一起算進同一個 filter
  const blur = (device.wallpaperBlur ?? 0) * 0.18;
  const dim = (device.wallpaperDim ?? 0) / 100;
  const dark = device.darkMode ? 0.38 : 0;
  ui.wallpaper.style.filter = `blur(${blur.toFixed(1)}px) brightness(${(1 - Math.min(0.82, dim + dark)).toFixed(2)})${device.darkMode ? ' saturate(.85)' : ''}`;
  ui.screen.classList.toggle('dark', device.darkMode);
  ui.veil.style.opacity = String(Math.max(0, (85 - device.brightness) / 145));
  $('#status-wifi').style.opacity = device.wifi ? '1' : '.3';
  $('#status-net').textContent = device.dnd ? '🌜 5G' : '5G';
  $('#battery-fill').style.width = '82%';
}

/* ---------------- 狀態列 / 鎖定畫面 ---------------- */
function tickClock() {
  const now = new Date();
  const hhmm = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#status-time').textContent = hhmm;
  $('#lock-time').textContent = hhmm;
  $('#lock-date').textContent = now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' });
}

function renderLockNote() {
  const note = state.notes[0];
  const installed = state.installed.length;
  $('#lock-note').innerHTML = note
    ? `<b>📒 ${esc(note.title)}</b><br />${esc(note.body.split('\n')[0].slice(0, 46))}`
    : `<b>🌊 潮汐 OS</b><br />桌面上有 ${installed} 個從其他系統撈來的 App`;
}

/* ---------------- 桌面 ---------------- */
function renderHome() {
  renderLockNote();
  const dockIds = state.builtins.filter((a) => a.dock !== undefined).sort((a, b) => a.dock - b.dock);
  const dockSet = new Set(dockIds.map((a) => a.id));
  const gridApps = allApps().filter((a) => !dockSet.has(a.id));

  const pageCount = Math.max(1, Math.ceil(gridApps.length / PER_PAGE));
  page = Math.min(page, pageCount - 1);

  ui.pages.replaceChildren();
  for (let p = 0; p < pageCount; p += 1) {
    const sheet = el('<div class="page"></div>');
    const slice = gridApps.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    if (!slice.length) {
      sheet.append(el('<div class="empty-page">這裡還是空的。<br />打開「萬象商店」，<br />一鍵把其他系統的 App 撈進來。</div>'));
    }
    slice.forEach((app) => sheet.append(appIcon(app)));
    ui.pages.append(sheet);
  }
  ui.pages.style.transform = `translateX(${-page * 100}%)`;
  ui.pages.querySelectorAll('.page').forEach((el2) => { el2.style.transform = 'none'; });

  ui.dots.replaceChildren();
  if (pageCount > 1) {
    for (let p = 0; p < pageCount; p += 1) {
      const dot = el(`<i class="${p === page ? 'on' : ''}"></i>`);
      dot.addEventListener('click', () => { page = p; renderHome(); });
      ui.dots.append(dot);
    }
  }

  ui.dock.replaceChildren(...dockIds.map(appIcon));

  if (!ui.spotPill) {
    ui.spotPill = el('<button class="spotlight-pill">🔍 搜尋</button>');
    ui.spotPill.addEventListener('click', openSpotlight);
    ui.dock.before(ui.spotPill);
  }
}

function appIcon(app) {
  const source = sourceOf(app.os);
  const paused = app.active === false;
  const node = el(`<button class="app ${paused ? 'paused' : ''}">
    <span class="icon" style="${tint(app)}">${app.glyph}
      ${app.os === 'tide' ? '' : `<span class="badge-os" title="來自 ${esc(source?.name ?? app.os)}">${source?.glyph ?? '?'}</span>`}
    </span>
    <span class="label">${esc(app.name)}</span>
  </button>`);
  node.addEventListener('click', () => openApp(app.id));
  return node;
}

/* 桌面換頁：拖曳 */
let dragX = null;
ui.pages.addEventListener('pointerdown', (e) => { dragX = e.clientX; });
ui.pages.addEventListener('pointerup', (e) => {
  if (dragX === null) return;
  const dx = e.clientX - dragX;
  dragX = null;
  const pageCount = ui.pages.children.length;
  if (Math.abs(dx) < 40) return;
  page = Math.min(pageCount - 1, Math.max(0, page + (dx < 0 ? 1 : -1)));
  renderHome();
});

/* ---------------- App 視窗 ---------------- */
function openApp(id) {
  const app = deviceApp(id);
  if (!app) return;
  if (app.active === false) {
    const s = sourceOf(app.os);
    notify(`${app.name} 已暫停`, `${s.name} 相容層未啟用，到「設定 → 萬象相容層」開啟後才能執行`);
    return;
  }
  cleanups.forEach((fn) => fn());
  cleanups = [];
  openId = id;
  recents = [id, ...recents.filter((x) => x !== id)].slice(0, 6);

  ui.appwin.hidden = false;
  ui.appwin.classList.remove('closing');
  ui.appwin.replaceChildren();
  renderAppHeader(app);

  const body = el('<div class="app-body"></div>');
  if (app.os === 'tide') {
    body.append(NATIVE_APPS[app.id].render(ctx()));
  } else {
    const stats = runtimeStats(app);
    const s = sourceOf(app.os);
    ui.appwin.append(el(`<div class="runtime-bar">
      <span class="dot"></span>
      <span class="name">${esc(s.runtime)}</span>
      <span class="sep">${stats.nodes.toLocaleString()} 節點 · ${stats.fps} FPS · ${stats.ram} MB</span>
    </div>`));
    if (app.kind === 'game') showGameTitle(app, body);
    else body.innerHTML = renderMock(app);
  }
  ui.appwin.append(body);

  showIsland(`${app.glyph}　${app.name}`);
}

/** 遊戲的標題畫面：按下開始才真的進到遊戲 */
function showGameTitle(app, body) {
  body.innerHTML = renderMock(app);
  body.querySelector('[data-play]')?.addEventListener('click', () => {
    playGame(app, { ...ctx(), backToTitle: () => showGameTitle(app, body) }, body);
  });
}

function renderAppHeader(app) {
  if (!app) return;
  const source = sourceOf(app.os);
  const sub =
    app.os === 'tide'
      ? app.category
      : `來自 ${source.name} · ${app.genre ? `${app.genre} · ` : ''}${fmtSize(app.size)}`;
  const head = el(`<div class="app-head" style="${tint(app)}">
    <span class="mini">${app.glyph}</span>
    <div><h2>${esc(app.name)}</h2><div class="sub">${esc(sub)}</div></div>
    <div class="right"></div>
  </div>`);
  const right = head.querySelector('.right');
  if (app.os !== 'tide') {
    const btn = el('<button>移除</button>');
    btn.addEventListener('click', async () => {
      try {
        const res = await api('/api/apps/uninstall', { method: 'POST', body: { id: app.id } });
        closeApp();
        setState(res.state);
        notify(app.name, '已從裝置移除');
      } catch (err) {
        notify('移除失敗', err.message);
      }
    });
    right.append(btn);
  }
  const close = el('<button class="strong">完成</button>');
  close.addEventListener('click', closeApp);
  right.append(close);

  const existing = ui.appwin.querySelector('.app-head');
  if (existing) existing.replaceWith(head);
  else ui.appwin.prepend(head);
}

function closeApp() {
  if (!openId) return;
  cleanups.forEach((fn) => fn());
  cleanups = [];
  openId = null;
  ui.appwin.classList.add('closing');
  setTimeout(() => {
    ui.appwin.hidden = true;
    ui.appwin.replaceChildren();
    ui.appwin.classList.remove('closing');
  }, 260);
}

function ctx() {
  return {
    get state() { return state; },
    memo,
    setState,
    reload,
    notify,
    openApp,
    closeApp,
    onCleanup: (fn) => cleanups.push(fn),
  };
}

/* ---------------- 通知橫幅 / 動態島 ---------------- */
function notify(title, text) {
  ui.banner.replaceChildren(
    el(`<span class="ico">🌊</span>`),
    el(`<div class="txt"><b>${esc(title)}</b><span>${esc(text)}</span></div>`),
  );
  ui.banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { ui.banner.hidden = true; }, 3400);
}
ui.banner.addEventListener('click', () => { ui.banner.hidden = true; });

function showIsland(text) {
  ui.island.textContent = text;
  ui.island.classList.add('wide');
  clearTimeout(islandTimer);
  islandTimer = setTimeout(() => {
    ui.island.classList.remove('wide');
    ui.island.textContent = '';
  }, 1600);
}

/* ---------------- 控制中心 ---------------- */
function renderControl() {
  const { device } = state;

  const round = (key, ico, label, green = false) => {
    const node = el(`<button class="cc-dot ${device[key] ? 'on' : ''} ${green ? 'g' : ''}" title="${label}">${ico}</button>`);
    node.addEventListener('click', async () => {
      const res = await api('/api/device', { method: 'PATCH', body: { [key]: !device[key] } });
      setState({ ...state, device: res.device });
      renderControl();
    });
    return node;
  };

  // 連線模組：2×2 的圓形按鈕，跟 iOS 一樣
  const conn = el('<div class="cc-tile span2" style="height:172px;align-content:center"></div>');
  const pad = el('<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;justify-items:center"></div>');
  pad.append(round('wifi', '􀙇', 'Wi‑Fi'), round('bluetooth', '􀋎', '藍牙'), round('dnd', '🌙', '勿擾', true), round('darkMode', '🌓', '深色模式'));
  pad.querySelectorAll('.cc-dot').forEach((dot, i) => {
    if (i === 0) dot.textContent = '📶';
    if (i === 1) dot.textContent = '🔵';
  });
  conn.append(pad);

  const slider = (key, ico) => {
    const wrap = el(`<div class="cc-vert"><div class="vslider"><i></i><span>${ico}</span></div></div>`);
    const bar = wrap.querySelector('.vslider');
    const fill = wrap.querySelector('i');
    const paint = (v) => { fill.style.height = `${v}%`; };
    paint(device[key]);

    let dragging = false;
    const set = (event) => {
      const rect = bar.getBoundingClientRect();
      const value = Math.round(Math.min(100, Math.max(0, ((rect.bottom - event.clientY) / rect.height) * 100)));
      paint(value);
      state.device[key] = value;
      applyDevice();
      clearTimeout(bar._t);
      bar._t = setTimeout(() => api('/api/device', { method: 'PATCH', body: { [key]: value } }), 220);
    };
    bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); set(e); });
    bar.addEventListener('pointermove', (e) => dragging && set(e));
    bar.addEventListener('pointerup', () => { dragging = false; });
    bar.addEventListener('pointercancel', () => { dragging = false; });
    return wrap;
  };

  const grid = el('<div class="cc-grid"></div>');
  grid.append(conn, slider('brightness', '🔆'), slider('volume', '🔊'));

  const layers = state.sources.filter((s) => !s.builtin);
  const info = el(`<div class="cc-tile span4" style="grid-column:1/-1;gap:8px">
    <div style="font-size:13.5px;font-weight:600">🌊 萬象相容層</div>
    <div style="font-size:12.5px;opacity:.85;line-height:1.7">
      ${layers.map((s) => `${s.glyph}${s.enabled ? '' : '⏸'} ${s.installed}/${s.total}`).join('　')}
    </div>
    <div style="font-size:12.5px;opacity:.85">儲存空間 ${fmtSize(state.storage.usedMb)} / ${fmtSize(state.storage.totalMb)}</div>
  </div>`);
  grid.append(info);

  ui.control.replaceChildren(grid, el('<p class="cc-note">點空白處關閉</p>'));
}

/* ---------------- Spotlight 搜尋 ---------------- */
function openSpotlight() {
  const overlay = el(`<div class="spotlight">
    <input placeholder="搜尋 App" autocapitalize="off" autocomplete="off" spellcheck="false" />
    <div class="spot-results"></div>
  </div>`);
  const input = overlay.querySelector('input');
  const results = overlay.querySelector('.spot-results');

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const hits = allApps()
      .filter((app) =>
        !q || [app.name, app.en, app.category, app.genre].some((f) => String(f ?? '').toLowerCase().includes(q)),
      )
      .slice(0, 24);
    results.replaceChildren(
      ...(hits.length
        ? hits.map((app) => {
            const source = sourceOf(app.os);
            const row = el(`<button class="spot-row">
              <span class="icon" style="${tint(app)}">${app.glyph}</span>
              <span><span style="font-size:14.5px">${esc(app.name)}</span>
              <span class="sub" style="display:block">${esc(app.genre ?? app.category)}${app.os === 'tide' ? '' : ` · 來自 ${esc(source.name)}`}</span></span>
            </button>`);
            row.addEventListener('click', () => { overlay.remove(); openApp(app.id); });
            return row;
          })
        : [el('<p style="color:rgba(255,255,255,.65);text-align:center;padding:30px 0;font-size:13px">找不到 App</p>')]),
    );
  };

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.remove();
    if (e.key === 'Enter') results.querySelector('.spot-row')?.click();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  draw();
  ui.screen.append(overlay);
  setTimeout(() => input.focus(), 60);
}

function toggleControl(force) {
  const show = force ?? ui.control.hidden;
  if (show) renderControl();
  ui.control.hidden = !show;
}
ui.control.addEventListener('click', (e) => { if (e.target === ui.control) toggleControl(false); });
$('#status-right').addEventListener('click', () => toggleControl());

/* ---------------- App 切換器 ---------------- */
function toggleSwitcher(force) {
  const show = force ?? ui.switcher.hidden;
  if (show) {
    const cards = recents.map(deviceApp).filter(Boolean);
    ui.switcher.replaceChildren(
      el('<div class="card-close">點卡片切換 App · 點空白處關閉</div>'),
      ...(cards.length
        ? cards.map((app) => {
            const card = el(`<div class="card-app" style="${tint(app)}">
              <div class="cap"><span class="icon" style="${tint(app)};width:26px;height:26px;border-radius:8px;font-size:13px">${app.glyph}</span>${esc(app.name)}</div>
              <div class="body">${app.glyph}</div></div>`);
            card.addEventListener('click', () => { toggleSwitcher(false); openApp(app.id); });
            return card;
          })
        : [el('<p style="margin:auto;opacity:.6;font-size:13px">還沒有最近使用的 App</p>')]),
    );
  }
  ui.switcher.hidden = !show;
}
ui.switcher.addEventListener('click', (e) => { if (e.target === ui.switcher) toggleSwitcher(false); });

/* ---------------- 鎖定 / 解鎖 / Home 條 ---------------- */
const unlock = () => ui.lock.classList.add('away');
const lock = () => { closeApp(); toggleControl(false); toggleSwitcher(false); ui.lock.classList.remove('away'); };
ui.lock.addEventListener('click', unlock);

let lastTap = 0;
ui.homebar.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTap < 320) {
    toggleSwitcher(true);
  } else {
    if (!ui.switcher.hidden) toggleSwitcher(false);
    else if (!ui.control.hidden) toggleControl(false);
    else closeApp();
  }
  lastTap = now;
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'Escape') {
    if (!ui.switcher.hidden) toggleSwitcher(false);
    else if (!ui.control.hidden) toggleControl(false);
    else closeApp();
  }
  if (e.key === ' ' && !ui.screen.classList.contains('playing')) {
    e.preventDefault();
    ui.lock.classList.contains('away') ? lock() : unlock();
  }
});

/* ---------------- 開機 ---------------- */
tickClock();
setInterval(tickClock, 10_000);

reload()
  .then(() => {
    showIsland('🌊　潮汐 OS 已就緒');
    if (!state.installed.length) {
      setTimeout(() => notify('萬象相容層', '已接上 7 套作業系統，到「萬象商店」一鍵撈取 App'), 900);
    }
  })
  .catch((err) => {
    document.body.prepend(el(`<p style="color:#ff6b6b">無法連上系統服務：${esc(err.message)}</p>`));
  });
