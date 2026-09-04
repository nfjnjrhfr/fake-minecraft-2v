import { NATIVE_APPS } from './apps.js';
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
  if (openId) renderAppHeader(findApp(openId));
}

const allApps = () => [...(state?.builtins ?? []), ...(state?.installed ?? [])];
const findApp = (id) => allApps().find((a) => a.id === id) ?? null;
const sourceOf = (os) => state.sources.find((s) => s.os === os);

/* ---------------- 裝置外觀 ---------------- */
function applyDevice() {
  const { device, wallpapers } = state;
  const wp = wallpapers.find((w) => w.id === device.wallpaper) ?? wallpapers[0];
  ui.wallpaper.style.setProperty('--wp-from', wp.from);
  ui.wallpaper.style.setProperty('--wp-to', wp.to);
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
  const app = findApp(id);
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
    body.innerHTML = renderMock(app);
  }
  ui.appwin.append(body);

  showIsland(`${app.glyph}　${app.name}`);
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
    const btn = el('<button class="pill-btn ghost">移除</button>');
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
  const close = el('<button class="pill-btn ghost">完成</button>');
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
  const toggle = (key, ico, label) => {
    const node = el(`<div class="cc-toggle"><span class="cc-dot ${device[key] ? 'on' : ''}">${ico}</span>${label}</div>`);
    node.addEventListener('click', async () => {
      const res = await api('/api/device', { method: 'PATCH', body: { [key]: !device[key] } });
      setState({ ...state, device: res.device });
      renderControl();
    });
    return node;
  };

  const grid = el('<div class="cc-grid"></div>');
  const conn = el('<div class="cc-tile"></div>');
  conn.append(toggle('wifi', '📶', 'Wi‑Fi'), toggle('bluetooth', '🔵', '藍牙'), toggle('dnd', '🌜', '勿擾'));
  const look = el('<div class="cc-tile"></div>');
  look.append(toggle('darkMode', '🌓', '深色模式'));

  const slid = el(`<div class="cc-tile" style="grid-column:1/-1">
    <div class="cc-slider"><span>🔆 亮度 <b style="float:right">${device.brightness}</b></span><input type="range" min="0" max="100" value="${device.brightness}" /></div>
    <div class="cc-slider"><span>🔊 音量 <b style="float:right">${device.volume}</b></span><input type="range" min="0" max="100" value="${device.volume}" data-vol /></div>
  </div>`);
  slid.querySelectorAll('input').forEach((input) => {
    const key = input.hasAttribute('data-vol') ? 'volume' : 'brightness';
    input.addEventListener('input', async (e) => {
      const value = Number(e.target.value);
      input.previousElementSibling.querySelector('b').textContent = value;
      state.device[key] = value;
      applyDevice();
      clearTimeout(input._t);
      input._t = setTimeout(() => api('/api/device', { method: 'PATCH', body: { [key]: value } }), 200);
    });
  });

  const info = el(`<div class="cc-tile" style="grid-column:1/-1;gap:6px">
    <div style="font-size:12.5px">🌊 萬象相容層</div>
    <div style="font-size:11.5px;opacity:.75;line-height:1.6">
      ${state.sources.filter((s) => !s.builtin).map((s) => `${s.glyph}${s.enabled ? '' : '⏸'} ${s.installed}/${s.total}`).join('　')}
    </div>
    <div style="font-size:11.5px;opacity:.75">儲存空間 ${fmtSize(state.storage.usedMb)} / ${fmtSize(state.storage.totalMb)}</div>
  </div>`);

  grid.append(conn, look, slid, info);
  ui.control.replaceChildren(grid, el('<p style="text-align:center;font-size:11.5px;opacity:.6">點空白處關閉</p>'));
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
    const cards = recents.map(findApp).filter(Boolean);
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
  if (e.key === ' ') {
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
