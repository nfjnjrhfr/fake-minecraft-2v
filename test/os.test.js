import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../server/db.js';
import { createApp } from '../server/index.js';
import { defaultState } from '../server/api.js';
import { BUILTIN_APPS, CATALOG, SOURCES, catalogFor } from '../server/catalog.js';

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tideos-'));
  const db = new Db(path.join(dir, 'device.json'), defaultState);
  const server = createApp(db);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const state = async () => (await call('/api/state')).body;

  try {
    await run({ call, state, db, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('App 目錄涵蓋各個來源作業系統', () => {
  const external = SOURCES.filter((s) => !s.builtin);
  assert.equal(external.length, 7);
  assert.equal(CATALOG.length, 49);
  for (const source of external) {
    assert.ok(catalogFor(source.os).length > 0, `${source.os} 應該有 App`);
    assert.ok(source.runtime.length > 0, `${source.os} 應該有對應的執行期轉譯方案`);
  }
  // 每個 App 的 id 都以來源系統當前綴，且不重複
  assert.equal(new Set(CATALOG.map((a) => a.id)).size, CATALOG.length);
  assert.ok(CATALOG.every((a) => a.id.startsWith(`${a.os}.`)));
});

test('初始狀態只有內建 App，沒有外來 App', async () => {
  await withServer(async ({ state }) => {
    const s = await state();
    assert.equal(s.installed.length, 0);
    assert.equal(s.builtins.length, BUILTIN_APPS.length);
    assert.equal(s.device.osVersion, '潮汐 OS 1.0（萬象）');
    assert.equal(s.storage.usedMb, s.storage.systemMb);
    // 預設只開啟部分相容層
    assert.equal(s.runtimes.android, true);
    assert.equal(s.runtimes.windows, false);
  });
});

test('撈取單一 App 後會出現在桌面，並佔用儲存空間', async () => {
  await withServer(async ({ call, state }) => {
    const before = await state();
    const res = await call('/api/apps/install', { method: 'POST', body: { id: 'android.linkr' } });
    assert.equal(res.status, 201);

    const after = await state();
    assert.equal(after.installed.length, 1);
    assert.equal(after.installed[0].id, 'android.linkr');
    assert.equal(after.installed[0].os, 'android');
    assert.equal(after.installed[0].active, true);
    assert.equal(after.storage.usedMb, before.storage.usedMb + 148);
  });
});

test('重複撈取、未知 App、內建 App 都會被擋下', async () => {
  await withServer(async ({ call }) => {
    await call('/api/apps/install', { method: 'POST', body: { id: 'ios.lumo' } });
    assert.equal((await call('/api/apps/install', { method: 'POST', body: { id: 'ios.lumo' } })).status, 409);
    assert.equal((await call('/api/apps/install', { method: 'POST', body: { id: 'ios.不存在' } })).status, 404);
    assert.equal((await call('/api/apps/install', { method: 'POST', body: { id: 'settings' } })).status, 400);
  });
});

test('相容層沒啟用就不能撈取該系統的 App', async () => {
  await withServer(async ({ call }) => {
    const denied = await call('/api/apps/install', { method: 'POST', body: { id: 'windows.craftdraw' } });
    assert.equal(denied.status, 409);
    assert.match(denied.body.error, /Windows 相容層尚未啟用/);

    await call('/api/runtimes', { method: 'PATCH', body: { os: 'windows', enabled: true } });
    assert.equal((await call('/api/apps/install', { method: 'POST', body: { id: 'windows.craftdraw' } })).status, 201);
  });
});

test('一鍵撈取單一系統會把該系統的 App 全部裝上', async () => {
  await withServer(async ({ call, state }) => {
    const res = await call('/api/apps/install-all', { method: 'POST', body: { os: 'android' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.installed, catalogFor('android').length);

    const s = await state();
    assert.equal(s.installed.length, catalogFor('android').length);
    assert.ok(s.installed.every((a) => a.os === 'android'));

    // 再撈一次不會重複安裝
    const again = await call('/api/apps/install-all', { method: 'POST', body: { os: 'android' } });
    assert.equal(again.body.installed, 0);
    assert.equal(again.body.already, catalogFor('android').length);
  });
});

test('一鍵撈取全部會略過未啟用的來源，開啟後可補齊', async () => {
  await withServer(async ({ call, state }) => {
    const res = await call('/api/apps/install-all', { method: 'POST', body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.skipped.sort(), ['Linux', 'Windows', 'macOS'].sort());

    const enabledOs = ['ios', 'android', 'harmony', 'web'];
    const expected = enabledOs.reduce((n, o) => n + catalogFor(o).length, 0);
    assert.equal(res.body.installed, expected);
    assert.equal((await state()).installed.length, expected);

    // 開啟其餘三套相容層後再撈一次，就會全部到齊
    for (const o of ['windows', 'macos', 'linux']) {
      await call('/api/runtimes', { method: 'PATCH', body: { os: o, enabled: true } });
    }
    const rest = await call('/api/apps/install-all', { method: 'POST', body: {} });
    assert.equal(rest.body.skipped.length, 0);
    assert.equal((await state()).installed.length, CATALOG.length);
  });
});

test('關閉相容層只會讓 App 暫停，不會刪掉', async () => {
  await withServer(async ({ call, state }) => {
    await call('/api/apps/install-all', { method: 'POST', body: { os: 'ios' } });
    const count = (await state()).installed.length;

    await call('/api/runtimes', { method: 'PATCH', body: { os: 'ios', enabled: false } });
    const paused = await state();
    assert.equal(paused.installed.length, count, 'App 仍在裝置上');
    assert.ok(paused.installed.every((a) => a.active === false), '但全部標成暫停');
    assert.equal(paused.sources.find((s) => s.os === 'ios').enabled, false);

    await call('/api/runtimes', { method: 'PATCH', body: { os: 'ios', enabled: true } });
    assert.ok((await state()).installed.every((a) => a.active === true));
  });
});

test('原生執行環境不能關閉，未知來源會被拒絕', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/api/runtimes', { method: 'PATCH', body: { os: 'tide', enabled: false } })).status, 400);
    assert.equal((await call('/api/runtimes', { method: 'PATCH', body: { os: 'plan9', enabled: true } })).status, 404);
  });
});

test('移除 App：內建不可移除，未安裝的會回 404', async () => {
  await withServer(async ({ call, state }) => {
    await call('/api/apps/install', { method: 'POST', body: { id: 'web.boardly' } });
    assert.equal((await call('/api/apps/uninstall', { method: 'POST', body: { id: 'terminal' } })).status, 403);
    assert.equal((await call('/api/apps/uninstall', { method: 'POST', body: { id: 'web.kanflow' } })).status, 404);

    assert.equal((await call('/api/apps/uninstall', { method: 'POST', body: { id: 'web.boardly' } })).status, 200);
    assert.equal((await state()).installed.length, 0);
  });
});

test('目錄可以依來源系統與關鍵字查詢', async () => {
  await withServer(async ({ call }) => {
    const harmony = await call('/api/catalog?os=harmony');
    assert.equal(harmony.body.apps.length, catalogFor('harmony').length);
    assert.ok(harmony.body.apps.every((a) => a.os === 'harmony'));

    const search = await call('/api/catalog?q=導航');
    assert.ok(search.body.apps.length >= 2);
    assert.ok(search.body.apps.every((a) => a.category.includes('導航')));

    assert.equal((await call('/api/catalog?os=plan9')).status, 404);
  });
});

test('裝置設定會校驗並保存', async () => {
  await withServer(async ({ call, state }) => {
    const ok = await call('/api/device', { method: 'PATCH', body: { brightness: 30, darkMode: true, wallpaper: 'mint' } });
    assert.equal(ok.status, 200);
    const s = await state();
    assert.equal(s.device.brightness, 30);
    assert.equal(s.device.darkMode, true);
    assert.equal(s.device.wallpaper, 'mint');

    // 超出範圍會被夾住，未知桌布會被拒絕
    await call('/api/device', { method: 'PATCH', body: { volume: 480 } });
    assert.equal((await state()).device.volume, 100);
    assert.equal((await call('/api/device', { method: 'PATCH', body: { wallpaper: '不存在' } })).status, 400);
  });
});

test('備忘錄可以新增、修改、刪除', async () => {
  await withServer(async ({ call, state }) => {
    assert.equal((await state()).notes.length, 1);

    const created = await call('/api/notes', { method: 'POST', body: { title: '相容層待辦', body: '測 Win32Layer' } });
    assert.equal(created.status, 201);
    const id = created.body.note.id;

    await call(`/api/notes/${id}`, { method: 'PATCH', body: { body: '測 Win32Layer 的視窗摺疊' } });
    const updated = (await state()).notes.find((n) => n.id === id);
    assert.equal(updated.body, '測 Win32Layer 的視窗摺疊');

    assert.equal((await call('/api/notes', { method: 'POST', body: { title: '' } })).status, 400);
    assert.equal((await call(`/api/notes/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(`/api/notes/${id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await state()).notes.length, 1);
  });
});

test('狀態會寫進檔案，重開機後還在', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tideos-'));
  const file = path.join(dir, 'device.json');
  try {
    const first = createApp(new Db(file, defaultState));
    await new Promise((r) => first.listen(0, r));
    const port = first.address().port;
    await fetch(`http://127.0.0.1:${port}/api/apps/install-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ os: 'web' }),
    });
    await new Promise((r) => first.close(r));

    // 用同一個檔案重新開機
    const second = createApp(new Db(file, defaultState));
    await new Promise((r) => second.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${second.address().port}/api/state`);
    const state = await res.json();
    assert.equal(state.installed.length, catalogFor('web').length);
    await new Promise((r) => second.close(r));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('回復原廠設定會清空撈取的 App', async () => {
  await withServer(async ({ call, state }) => {
    await call('/api/apps/install-all', { method: 'POST', body: {} });
    await call('/api/device', { method: 'PATCH', body: { darkMode: true } });
    assert.ok((await state()).installed.length > 20);

    assert.equal((await call('/api/reset', { method: 'POST' })).status, 200);
    const s = await state();
    assert.equal(s.installed.length, 0);
    assert.equal(s.device.darkMode, false);
  });
});

test('靜態資源可取得，且拒絕路徑穿越', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('潮汐 OS'));
    assert.equal((await fetch(`${base}/os.js`)).status, 200);

    const escape = await fetch(`${base}/../server/catalog.js`, { redirect: 'manual' });
    assert.notEqual(escape.status, 200);
    assert.equal((await fetch(`${base}/api/沒這個`)).status, 404);
  });
});
