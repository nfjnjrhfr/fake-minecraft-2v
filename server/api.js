import { BUILTIN_APPS, CATALOG, SOURCES, catalogFor, findApp, findSource } from './catalog.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const STORAGE_TOTAL_MB = 128 * 1024;
const SYSTEM_SIZE_MB = 9_640;

export const WALLPAPERS = [
  { id: 'aurora', name: '極光', from: '#1b2a6b', to: '#0b8f8f' },
  { id: 'dusk', name: '暮色', from: '#4a1d5e', to: '#c2455f' },
  { id: 'tide', name: '潮汐', from: '#062b45', to: '#2f8fff' },
  { id: 'graphite', name: '石墨', from: '#1a1a1f', to: '#4b5563' },
  { id: 'citrus', name: '柑橘', from: '#b45309', to: '#f6b93b' },
  { id: 'mint', name: '薄荷', from: '#064e3b', to: '#34d399' },
];

export function defaultState() {
  return {
    device: {
      name: '潮汐 One',
      model: 'TIDE-A1',
      osVersion: '潮汐 OS 1.0（萬象）',
      wallpaper: 'aurora',
      darkMode: false,
      brightness: 82,
      volume: 55,
      wifi: true,
      bluetooth: true,
      dnd: false,
    },
    // 各來源作業系統的相容層開關：關閉後該來源的 App 會被暫停，但不會被移除
    runtimes: { ios: true, android: true, harmony: true, windows: false, macos: false, linux: false, web: true },
    installed: [],
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

/* ---------------- 工具 ---------------- */

function ensureShape(db) {
  const data = db.data;
  const base = defaultState();
  data.device = { ...base.device, ...(data.device ?? {}) };
  data.runtimes = { ...base.runtimes, ...(data.runtimes ?? {}) };
  data.installed = Array.isArray(data.installed) ? data.installed : [];
  data.notes = Array.isArray(data.notes) ? data.notes : [];
  return data;
}

function installedApps(db) {
  const data = ensureShape(db);
  return data.installed
    .map((row) => {
      const app = findApp(row.id);
      if (!app) return null;
      return { ...app, installedAt: row.installedAt, active: data.runtimes[app.os] !== false };
    })
    .filter(Boolean);
}

function storage(db) {
  const used = installedApps(db).reduce((sum, app) => sum + app.size, SYSTEM_SIZE_MB);
  return {
    totalMb: STORAGE_TOTAL_MB,
    usedMb: used,
    systemMb: SYSTEM_SIZE_MB,
    freeMb: STORAGE_TOTAL_MB - used,
    percent: Number(((used / STORAGE_TOTAL_MB) * 100).toFixed(1)),
  };
}

function sourceSummary(db) {
  const data = ensureShape(db);
  const installedIds = new Set(data.installed.map((r) => r.id));
  return SOURCES.map((source) => {
    const apps = source.builtin ? BUILTIN_APPS : catalogFor(source.os);
    return {
      ...source,
      enabled: source.builtin ? true : data.runtimes[source.os] !== false,
      total: apps.length,
      installed: source.builtin ? apps.length : apps.filter((a) => installedIds.has(a.id)).length,
    };
  });
}

function snapshot(db) {
  const data = ensureShape(db);
  return {
    device: data.device,
    runtimes: data.runtimes,
    sources: sourceSummary(db),
    builtins: BUILTIN_APPS,
    installed: installedApps(db),
    storage: storage(db),
    wallpapers: WALLPAPERS,
    notes: [...data.notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  };
}

function str(value, field, { max = 4000, required = true } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text && required) throw new HttpError(400, `${field}不能為空`);
  if (text.length > max) throw new HttpError(400, `${field}不能超過 ${max} 個字`);
  return text;
}

function clamp(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field}必須是數字`);
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** 安裝單一 App，回傳 'installed' | 'already' */
function installOne(db, id) {
  const data = ensureShape(db);
  const app = findApp(id);
  if (!app) throw new HttpError(404, `找不到 App：${id}`);
  if (app.os === 'tide') throw new HttpError(400, '系統內建 App 無需安裝');
  if (data.runtimes[app.os] === false) {
    throw new HttpError(409, `${findSource(app.os).name} 相容層尚未啟用，請先到「設定 → 萬象相容層」開啟`);
  }
  if (data.installed.some((row) => row.id === id)) return 'already';
  data.installed.push({ id, installedAt: new Date().toISOString() });
  return 'installed';
}

/* ---------------- 路由 ---------------- */

export const routes = [
  {
    method: 'GET',
    path: '/api/state',
    handler: ({ db }) => ({ status: 200, body: snapshot(db) }),
  },
  {
    method: 'GET',
    path: '/api/catalog',
    handler({ db, query }) {
      const data = ensureShape(db);
      const installedIds = new Set(data.installed.map((r) => r.id));
      let apps = CATALOG;
      if (query.os) {
        if (!findSource(query.os) || query.os === 'tide') throw new HttpError(404, '未知的來源作業系統');
        apps = catalogFor(query.os);
      }
      if (query.category) {
        apps = apps.filter((a) => a.category === query.category);
        if (!apps.length) throw new HttpError(404, `找不到分類：${query.category}`);
      }
      if (query.q) {
        const q = String(query.q).toLowerCase();
        apps = apps.filter((a) =>
          [a.name, a.en, a.category].some((field) => field.toLowerCase().includes(q)),
        );
      }
      return {
        status: 200,
        body: {
          sources: sourceSummary(db),
          apps: apps.map((app) => ({
            ...app,
            installed: installedIds.has(app.id),
            enabled: data.runtimes[app.os] !== false,
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/apps/install',
    handler({ db, body }) {
      const id = str(body.id, 'App id', { max: 80 });
      const result = installOne(db, id);
      if (result === 'already') throw new HttpError(409, '這個 App 已經在裝置上了');
      db.save();
      return { status: 201, body: { app: findApp(id), state: snapshot(db) } };
    },
  },
  {
    method: 'POST',
    path: '/api/apps/install-all',
    handler({ db, body }) {
      const data = ensureShape(db);
      const targets = body.os ? [String(body.os)] : SOURCES.filter((s) => !s.builtin).map((s) => s.os);
      const category = body.category ? String(body.category) : null;

      for (const os of targets) {
        const source = findSource(os);
        if (!source || source.builtin) throw new HttpError(404, `未知的來源作業系統：${os}`);
      }
      // 指定分類時，先確認這個分類在目標來源裡真的有東西可撈
      const pick = (os) => catalogFor(os).filter((app) => !category || app.category === category);
      if (category && !targets.some((os) => pick(os).length)) {
        throw new HttpError(404, `找不到分類：${category}`);
      }
      // 只指定單一來源時，相容層沒開就直接報錯；批次撈取全部時自動略過未啟用的來源
      if (body.os && data.runtimes[targets[0]] === false) {
        throw new HttpError(409, `${findSource(targets[0]).name} 相容層尚未啟用，請先到「設定 → 萬象相容層」開啟`);
      }

      let installed = 0;
      let already = 0;
      const skipped = [];
      for (const os of targets) {
        if (!pick(os).length) continue;
        if (data.runtimes[os] === false) {
          skipped.push(findSource(os).name);
          continue;
        }
        for (const app of pick(os)) {
          if (installOne(db, app.id) === 'installed') installed += 1;
          else already += 1;
        }
      }
      db.save();
      return { status: 200, body: { installed, already, skipped, category, state: snapshot(db) } };
    },
  },
  {
    method: 'POST',
    path: '/api/apps/uninstall',
    handler({ db, body }) {
      const data = ensureShape(db);
      const id = str(body.id, 'App id', { max: 80 });
      const app = findApp(id);
      if (!app) throw new HttpError(404, `找不到 App：${id}`);
      if (app.os === 'tide') throw new HttpError(403, '系統內建 App 無法移除');
      const removed = db.remove('installed', (row) => row.id === id);
      if (!removed) throw new HttpError(404, '這個 App 尚未安裝');
      void data;
      return { status: 200, body: { state: snapshot(db) } };
    },
  },
  {
    method: 'PATCH',
    path: '/api/device',
    handler({ db, body }) {
      const data = ensureShape(db);
      const patch = {};
      if ('wallpaper' in body) {
        const id = str(body.wallpaper, '桌布', { max: 40 });
        if (!WALLPAPERS.some((w) => w.id === id)) throw new HttpError(400, '沒有這張桌布');
        patch.wallpaper = id;
      }
      if ('brightness' in body) patch.brightness = clamp(body.brightness, '亮度');
      if ('volume' in body) patch.volume = clamp(body.volume, '音量');
      for (const key of ['darkMode', 'wifi', 'bluetooth', 'dnd']) {
        if (key in body) patch[key] = Boolean(body[key]);
      }
      if ('name' in body) patch.name = str(body.name, '裝置名稱', { max: 40 });
      Object.assign(data.device, patch);
      db.save();
      return { status: 200, body: { device: data.device } };
    },
  },
  {
    method: 'PATCH',
    path: '/api/runtimes',
    handler({ db, body }) {
      const data = ensureShape(db);
      const os = str(body.os, '來源作業系統', { max: 20 });
      const source = findSource(os);
      if (!source) throw new HttpError(404, '未知的來源作業系統');
      if (source.builtin) throw new HttpError(400, '原生執行環境無法關閉');
      data.runtimes[os] = Boolean(body.enabled);
      db.save();
      return { status: 200, body: { state: snapshot(db) } };
    },
  },
  {
    method: 'GET',
    path: '/api/notes',
    handler: ({ db }) => ({ status: 200, body: { notes: snapshot(db).notes } }),
  },
  {
    method: 'POST',
    path: '/api/notes',
    handler({ db, body }) {
      const note = {
        title: str(body.title, '標題', { max: 80 }),
        body: str(body.body, '內容', { max: 20000, required: false }),
        updatedAt: new Date().toISOString(),
      };
      return { status: 201, body: { note: db.insert('notes', note) } };
    },
  },
  {
    method: 'PATCH',
    path: '/api/notes/:id',
    handler({ db, params, body }) {
      const id = Number(params.id);
      if (!Number.isInteger(id)) throw new HttpError(400, '備忘錄 id 不正確');
      if (!db.find('notes', (n) => n.id === id)) throw new HttpError(404, '找不到這則備忘錄');
      const patch = { updatedAt: new Date().toISOString() };
      if ('title' in body) patch.title = str(body.title, '標題', { max: 80 });
      if ('body' in body) patch.body = str(body.body, '內容', { max: 20000, required: false });
      return { status: 200, body: { note: db.update('notes', id, patch) } };
    },
  },
  {
    method: 'DELETE',
    path: '/api/notes/:id',
    handler({ db, params }) {
      const id = Number(params.id);
      if (!db.remove('notes', (n) => n.id === id)) throw new HttpError(404, '找不到這則備忘錄');
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/reset',
    handler({ db }) {
      db.data = defaultState();
      db.save();
      return { status: 200, body: { state: snapshot(db) } };
    },
  },
];

export { snapshot, storage, installedApps };
