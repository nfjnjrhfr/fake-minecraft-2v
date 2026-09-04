/**
 * 網頁版（Artifact）用的本機狀態層。
 *
 * 沒有伺服器可用，所以把 server/api.js 的規則搬到瀏覽器裡，狀態存在 localStorage。
 * 介面與伺服器版完全一致，前端程式碼因此可以原封不動共用。
 */
const KEY = 'tideos.device.v1';

const WALLPAPERS = [
  { id: 'aurora', name: '極光', from: '#1b2a6b', to: '#0b8f8f' },
  { id: 'dusk', name: '暮色', from: '#4a1d5e', to: '#c2455f' },
  { id: 'tide', name: '潮汐', from: '#062b45', to: '#2f8fff' },
  { id: 'graphite', name: '石墨', from: '#1a1a1f', to: '#4b5563' },
  { id: 'citrus', name: '柑橘', from: '#b45309', to: '#f6b93b' },
  { id: 'mint', name: '薄荷', from: '#064e3b', to: '#34d399' },
];

const STORAGE_TOTAL_MB = 128 * 1024;
const SYSTEM_SIZE_MB = 9_640;

/** 第一次打開時就有東西可看：iOS 與 Web 的 App 已經撈好了 */
const PRESET = ['ios', 'web'];

function defaultState() {
  return {
    device: {
      name: '潮汐 One',
      model: 'TIDE-A1',
      osVersion: '潮汐 OS 1.0（萬象）',
      wallpaper: 'aurora',
      wallpaperImage: null,
      wallpaperBlur: 0,
      wallpaperDim: 0,
      darkMode: false,
      brightness: 82,
      volume: 55,
      wifi: true,
      bluetooth: true,
      dnd: false,
    },
    runtimes: { ios: true, android: true, harmony: true, windows: false, macos: false, linux: false, web: true },
    scores: {},
    installed: CATALOG.filter((a) => PRESET.includes(a.os)).map((a) => ({ id: a.id, installedAt: new Date().toISOString() })),
    bookmarks: [
      { id: 1, title: '潮汐 OS 說明', url: 'https://omni.tide/' },
      { id: 2, title: '萬象相容層是什麼', url: 'https://omni.tide/compat' },
      { id: 3, title: '全部 App 目錄', url: 'https://omni.tide/apps' },
    ],
    history: [],
    notes: [
      {
        id: 1,
        title: '萬象相容層備忘',
        body: '在「萬象商店」裡挑一個來源作業系統，按「一鍵撈取全部」就能把該系統的 App 全部匯入桌面。\n\n關閉相容層不會刪除 App，只會讓它暫停。',
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch { /* 讀不到就當第一次開 */ }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 配額滿了通常是桌布太大，至少讓其他設定存得下去
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...data, device: { ...data.device, wallpaperImage: null } }));
    } catch { /* 真的存不下就算了，這一次的變更只存在記憶體 */ }
  }
}

const fail = (message) => { throw new Error(message); };
const nextId = (rows) => rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
const clamp = (v) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));

/* ---------------- 快照 ---------------- */
function installedApps() {
  return data.installed
    .map((row) => {
      const app = findApp(row.id);
      return app ? { ...app, installedAt: row.installedAt, active: data.runtimes[app.os] !== false } : null;
    })
    .filter(Boolean);
}

function storage() {
  const used = installedApps().reduce((sum, app) => sum + app.size, SYSTEM_SIZE_MB);
  return {
    totalMb: STORAGE_TOTAL_MB,
    usedMb: used,
    systemMb: SYSTEM_SIZE_MB,
    freeMb: STORAGE_TOTAL_MB - used,
    percent: Number(((used / STORAGE_TOTAL_MB) * 100).toFixed(1)),
  };
}

function sourceSummary() {
  const ids = new Set(data.installed.map((r) => r.id));
  return SOURCES.map((source) => {
    const apps = source.builtin ? BUILTIN_APPS : catalogFor(source.os);
    return {
      ...source,
      enabled: source.builtin ? true : data.runtimes[source.os] !== false,
      total: apps.length,
      installed: source.builtin ? apps.length : apps.filter((a) => ids.has(a.id)).length,
    };
  });
}

const snapshot = () => ({
  device: data.device,
  runtimes: data.runtimes,
  sources: sourceSummary(),
  builtins: BUILTIN_APPS,
  installed: installedApps(),
  storage: storage(),
  wallpapers: WALLPAPERS,
  scores: data.scores,
  bookmarks: data.bookmarks,
  history: data.history,
  notes: [...data.notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
});

function installOne(id) {
  const app = findApp(id);
  if (!app) fail(`找不到 App：${id}`);
  if (app.os === 'tide') fail('系統內建 App 無需安裝');
  if (data.runtimes[app.os] === false) fail(`${findSource(app.os).name} 相容層尚未啟用，請先到「設定 → 萬象相容層」開啟`);
  if (data.installed.some((row) => row.id === id)) return 'already';
  data.installed.push({ id, installedAt: new Date().toISOString() });
  return 'installed';
}

/* ---------------- 內建網站 ---------------- */
const p = (...runs) => ({ type: 'p', runs: runs.map((r) => (typeof r === 'string' ? { text: r } : r)) });
const h = (type, text) => ({ type, runs: [{ text }] });
const li = (text) => ({ type: 'li', runs: [{ text }] });
const link = (text, href) => ({ text, href });

const SITES = {
  '/': () => ({
    title: '潮汐 OS · 萬象相容層',
    blocks: [
      h('h1', '潮汐 OS 1.0（萬象）'),
      p('一台電子產品的行動作業系統。系統本身只有一套原生介面層 OmniUI，萬象相容層負責把其他七套作業系統的 App 全部撈進同一個桌面。'),
      h('h2', '可以看看'),
      p(link('萬象相容層是什麼', 'https://omni.tide/compat')),
      p(link('全部 App 目錄', 'https://omni.tide/apps')),
      h('h2', '關於這個瀏覽器'),
      p('這台裝置沒有排版引擎：網頁會先被抽成標題、段落、清單這些區塊，再交給 OmniUI 畫出來。'),
      p('你現在看到的網頁版跑在 Claude 的 Artifact 沙箱裡，沒有對外連線的權限，所以只能瀏覽這幾個內建頁面。想瀏覽真實網站，請跑本機版本（npm start）—— 那一版會由伺服端真的把網頁抓回來。'),
    ],
  }),
  '/compat': () => ({
    title: '萬象相容層',
    blocks: [
      h('h1', '萬象相容層（OmniLayer）'),
      p('每一套來源作業系統都有自己的執行期轉譯方案，把它的介面與系統呼叫翻譯成 OmniUI 看得懂的東西。'),
      ...SOURCES.filter((s) => !s.builtin).flatMap((s) => [h('h3', `${s.glyph} ${s.name}`), p(s.runtime), p(s.detail)]),
      h('h2', '暫停，不是刪除'),
      p('關閉某一套相容層時，已經撈進來的 App 會留在桌面上，只是變成暫停狀態。重新啟用就會恢復。'),
    ],
  }),
  '/apps': () => ({
    title: '全部 App 目錄',
    blocks: [
      h('h1', `全部 App 目錄（${CATALOG.length} 個）`),
      p('這是萬象相容層目前接得到的所有 App。要撈進桌面請開「萬象商店」。'),
      ...SOURCES.filter((s) => !s.builtin).flatMap((s) => [
        h('h2', `${s.glyph} ${s.name}`),
        ...catalogFor(s.os).map((a) => li(`${a.name}（${a.en}）· ${a.genre ?? a.category} · ${a.size} MB`)),
      ]),
    ],
  }),
};

function browse(input) {
  const raw = String(input ?? '').trim();
  if (!raw) fail('請輸入網址');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    fail(`看不懂這個網址：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`瀏覽器只支援 http 與 https，不支援 ${url.protocol.replace(':', '')}`);
  }
  const site = url.hostname === 'omni.tide' ? SITES[url.pathname] : null;
  if (!site) {
    fail(
      `這個網頁版跑在 Claude 的 Artifact 沙箱裡，沙箱不允許頁面對外連線，所以連不到 ${url.hostname}。`
      + '　內建頁面（omni.tide）可以瀏覽；要瀏覽真實網站，請執行本機版本 npm start，那一版會由伺服端把網頁抓回來。',
    );
  }
  const built = site();
  const page = {
    url: url.href,
    host: url.hostname,
    title: built.title,
    blocks: built.blocks,
    secure: true,
    bytes: JSON.stringify(built.blocks).length,
    fetchedAt: new Date().toISOString(),
  };
  data.history = [
    { url: page.url, title: page.title, host: page.host, at: page.fetchedAt },
    ...data.history.filter((h2) => h2.url !== page.url),
  ].slice(0, 40);
  save();
  return { page, history: data.history };
}

/* ---------------- 路由 ---------------- */
function route(path, { method = 'GET', body = {} } = {}) {
  const url = new URL(path, 'http://local');
  const q = Object.fromEntries(url.searchParams);
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const at = (i) => seg[i];

  if (url.pathname === '/api/state') return snapshot();

  if (url.pathname === '/api/catalog') {
    const ids = new Set(data.installed.map((r) => r.id));
    let apps = CATALOG;
    if (q.os) {
      if (!findSource(q.os) || q.os === 'tide') fail('未知的來源作業系統');
      apps = catalogFor(q.os);
    }
    if (q.category) {
      apps = apps.filter((a) => a.category === q.category);
      if (!apps.length) fail(`找不到分類：${q.category}`);
    }
    if (q.q) {
      const needle = q.q.toLowerCase();
      apps = apps.filter((a) => [a.name, a.en, a.category, a.genre].some((f) => String(f ?? '').toLowerCase().includes(needle)));
    }
    return {
      sources: sourceSummary(),
      apps: apps.map((a) => ({ ...a, installed: ids.has(a.id), enabled: data.runtimes[a.os] !== false })),
    };
  }

  if (url.pathname === '/api/apps/install') {
    if (installOne(body.id) === 'already') fail('這個 App 已經在裝置上了');
    save();
    return { app: findApp(body.id), state: snapshot() };
  }

  if (url.pathname === '/api/apps/install-all') {
    const targets = body.os ? [String(body.os)] : SOURCES.filter((s) => !s.builtin).map((s) => s.os);
    const category = body.category ? String(body.category) : null;
    targets.forEach((os) => {
      const source = findSource(os);
      if (!source || source.builtin) fail(`未知的來源作業系統：${os}`);
    });
    const pick = (os) => catalogFor(os).filter((app) => !category || app.category === category);
    if (category && !targets.some((os) => pick(os).length)) fail(`找不到分類：${category}`);
    if (body.os && data.runtimes[targets[0]] === false) {
      fail(`${findSource(targets[0]).name} 相容層尚未啟用，請先到「設定 → 萬象相容層」開啟`);
    }
    let installed = 0;
    let already = 0;
    const skipped = [];
    for (const os of targets) {
      if (!pick(os).length) continue;
      if (data.runtimes[os] === false) { skipped.push(findSource(os).name); continue; }
      for (const app of pick(os)) {
        if (installOne(app.id) === 'installed') installed += 1;
        else already += 1;
      }
    }
    save();
    return { installed, already, skipped, category, state: snapshot() };
  }

  if (url.pathname === '/api/apps/uninstall') {
    const app = findApp(body.id);
    if (!app) fail(`找不到 App：${body.id}`);
    if (app.os === 'tide') fail('系統內建 App 無法移除');
    const before = data.installed.length;
    data.installed = data.installed.filter((row) => row.id !== body.id);
    if (data.installed.length === before) fail('這個 App 尚未安裝');
    save();
    return { state: snapshot() };
  }

  if (url.pathname === '/api/device' && method === 'PATCH') {
    const d = data.device;
    if ('wallpaperImage' in body) {
      if (!body.wallpaperImage) {
        d.wallpaperImage = null;
        if (d.wallpaper === 'custom') d.wallpaper = WALLPAPERS[0].id;
      } else {
        if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(body.wallpaperImage)) fail('桌布必須是 png／jpeg／webp 圖片');
        if (body.wallpaperImage.length > 4_000_000) fail('這張桌布太大了，請換一張小一點的');
        d.wallpaperImage = body.wallpaperImage;
        d.wallpaper = 'custom';
      }
    }
    if ('wallpaper' in body) {
      if (body.wallpaper === 'custom') {
        if (!d.wallpaperImage) fail('還沒有選過自己的桌布');
      } else if (!WALLPAPERS.some((w) => w.id === body.wallpaper)) fail('沒有這張桌布');
      d.wallpaper = body.wallpaper;
    }
    for (const key of ['brightness', 'volume', 'wallpaperBlur', 'wallpaperDim']) {
      if (key in body) d[key] = clamp(body[key]);
    }
    for (const key of ['darkMode', 'wifi', 'bluetooth', 'dnd']) {
      if (key in body) d[key] = Boolean(body[key]);
    }
    save();
    return { device: d };
  }

  if (url.pathname === '/api/runtimes' && method === 'PATCH') {
    const source = findSource(body.os);
    if (!source) fail('未知的來源作業系統');
    if (source.builtin) fail('原生執行環境無法關閉');
    data.runtimes[body.os] = Boolean(body.enabled);
    save();
    return { state: snapshot() };
  }

  if (url.pathname === '/api/scores') {
    const app = findApp(body.id);
    if (!app) fail(`找不到 App：${body.id}`);
    if (app.kind !== 'game') fail('只有遊戲會記錄分數');
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0) fail('分數不正確');
    data.scores = data.scores ?? {};
    data.scores[body.id] = Math.max(data.scores[body.id] ?? 0, Math.round(score));
    save();
    return { scores: data.scores };
  }

  if (url.pathname === '/api/browse') return browse(body.url);

  if (url.pathname === '/api/bookmarks' && method === 'POST') {
    let href;
    try {
      href = new URL(/^[a-z][a-z0-9+.-]*:/i.test(body.url ?? '') ? body.url : `https://${body.url}`).href;
    } catch {
      fail('看不懂這個網址');
    }
    if (data.bookmarks.some((b) => b.url === href)) fail('這個網址已經在書籤裡了');
    const bookmark = { id: nextId(data.bookmarks), title: (body.title || href).slice(0, 120), url: href };
    data.bookmarks.push(bookmark);
    save();
    return { bookmark, bookmarks: data.bookmarks };
  }

  if (at(1) === 'bookmarks' && method === 'DELETE') {
    const id = Number(at(2));
    const before = data.bookmarks.length;
    data.bookmarks = data.bookmarks.filter((b) => b.id !== id);
    if (data.bookmarks.length === before) fail('找不到這個書籤');
    save();
    return { bookmarks: data.bookmarks };
  }

  if (url.pathname === '/api/history/clear') {
    data.history = [];
    save();
    return { history: [] };
  }

  if (url.pathname === '/api/notes' && method === 'GET') return { notes: snapshot().notes };

  if (url.pathname === '/api/notes' && method === 'POST') {
    const title = String(body.title ?? '').trim();
    if (!title) fail('標題不能為空');
    const note = { id: nextId(data.notes), title, body: String(body.body ?? ''), updatedAt: new Date().toISOString() };
    data.notes.push(note);
    save();
    return { note };
  }

  if (at(1) === 'notes' && method === 'PATCH') {
    const note = data.notes.find((n) => n.id === Number(at(2)));
    if (!note) fail('找不到這則備忘錄');
    if ('title' in body) {
      const title = String(body.title).trim();
      if (!title) fail('標題不能為空');
      note.title = title;
    }
    if ('body' in body) note.body = String(body.body);
    note.updatedAt = new Date().toISOString();
    save();
    return { note };
  }

  if (at(1) === 'notes' && method === 'DELETE') {
    const before = data.notes.length;
    data.notes = data.notes.filter((n) => n.id !== Number(at(2)));
    if (data.notes.length === before) fail('找不到這則備忘錄');
    save();
    return { ok: true };
  }

  if (url.pathname === '/api/reset') {
    data = defaultState();
    save();
    return { state: snapshot() };
  }

  fail(`介面不存在：${url.pathname}`);
}

globalThis.__TIDE_LOCAL_API__ = async (path, opts) => route(path, opts);
