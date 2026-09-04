import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../server/db.js';
import { createApp } from '../server/index.js';
import { defaultState } from '../server/api.js';
import { BrowseError, assertPublicHost, decodeEntities, extract, fetchPage, isPrivateAddress, normalizeUrl } from '../server/browser.js';

/** 假的 DNS：test.example 解到公開位址，internal.example 解到內網 */
const lookup = async (hostname) =>
  hostname.includes('internal')
    ? [{ address: '10.0.0.7', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }];

const html = (body, head = '<title>測試頁</title>') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const page = (body, opts = {}) =>
  new Response(html(body), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...opts });

test('網址列輸入會被正規化，非 http(s) 一律拒絕', () => {
  assert.equal(normalizeUrl('example.com').href, 'https://example.com/');
  assert.equal(normalizeUrl('  http://a.example/b?c=1#frag ').href, 'http://a.example/b?c=1');
  for (const bad of ['file:///etc/passwd', 'ftp://a.example', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.throws(() => normalizeUrl(bad), (e) => e instanceof BrowseError && e.code === 'scheme', bad);
  }
  assert.throws(() => normalizeUrl('   '), (e) => e.code === 'empty');
});

test('內網位址一律視為不安全', () => {
  const priv = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '不是位址'];
  const pub = ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'];
  priv.forEach((ip) => assert.equal(isPrivateAddress(ip), true, `${ip} 應該被視為內網`));
  pub.forEach((ip) => assert.equal(isPrivateAddress(ip), false, `${ip} 應該是公開位址`));
});

test('主機名稱解析到內網也會被擋，IPv6 字面位址要脫掉方括號', async () => {
  await assertPublicHost('test.example', lookup);
  await assert.rejects(() => assertPublicHost('internal.example', lookup), (e) => e.code === 'blocked');
  await assert.rejects(() => assertPublicHost('[::1]', lookup), (e) => e.code === 'blocked');
  await assert.rejects(() => assertPublicHost('192.168.0.1', lookup), (e) => e.code === 'blocked');
  await assert.rejects(
    () => assertPublicHost('nowhere.example', async () => { throw new Error('ENOTFOUND'); }),
    (e) => e.code === 'dns',
  );
});

test('HTML 會被抽成可閱讀的區塊，內文連結會解成絕對網址', () => {
  const { title, blocks } = extract(
    html(`<script>bad()</script><style>p{}</style>
      <h1>作業系統</h1>
      <p>這是<a href="/about">關於頁</a>與<a href="https://other.example/x">外部連結</a>。</p>
      <ul><li>第一項</li><li>第二項</li></ul>
      <blockquote>引用一段話</blockquote>
      <pre>code here</pre>
      <p>&lt;跳脫&gt; &amp; &#65;&nbsp;實體</p>`),
    'https://test.example/docs/',
  );
  assert.equal(title, '測試頁');
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types.slice(0, 3), ['h1', 'p', 'li']);
  assert.ok(types.includes('blockquote') && types.includes('pre'));

  const para = blocks[1];
  assert.deepEqual(para.runs.map((r) => r.href ?? null), [null, 'https://test.example/about', null, 'https://other.example/x', null]);

  const joined = blocks.map((b) => b.runs.map((r) => r.text).join('')).join(' ');
  assert.ok(!joined.includes('bad()'), 'script 內容不應該出現');
  assert.ok(joined.includes('<跳脫> & A 實體'), 'HTML 實體要被還原');
});

test('巢狀容器不會被重複抽出，整頁沒有區塊時會退回純文字', () => {
  const nested = extract(html('<li><p>只有內層應該被抽出</p></li>'), 'https://test.example/');
  assert.deepEqual(nested.blocks.map((b) => b.type), ['p']);

  const table = extract(html('<table><tr><td><table><tr><td>內層儲存格</td></tr></table></td></tr></table>'), 'https://test.example/');
  assert.deepEqual(table.blocks.map((b) => b.runs[0].text), ['內層儲存格']);

  const plain = extract('<html><body><div>整站都用 div 排版</div></body></html>', 'https://test.example/');
  assert.equal(plain.blocks.length, 1);
  assert.match(plain.blocks[0].runs[0].text, /div 排版/);
});

test('正文前的導覽連結會被濾掉，文末的連結清單會保留', () => {
  const nav = Array.from({ length: 9 }, (_, i) => `<li><a href="/lang/${i}">語言 ${i}</a></li>`).join('');
  const lead = `<p>${'這是一段夠長的正文，用來當作內文的起點。'.repeat(6)}</p>`;
  const seeAlso = Array.from({ length: 8 }, (_, i) => `<li><a href="/see/${i}">參見 ${i}</a></li>`).join('');

  const { blocks } = extract(html(`<h1>標題</h1>${nav}${lead}<h2>參見</h2>${seeAlso}`), 'https://test.example/');
  const texts = blocks.map((b) => b.runs.map((r) => r.text).join(''));
  assert.equal(texts.filter((t) => t.startsWith('語言')).length, 0, '正文前的導覽連結應該被濾掉');
  assert.equal(texts.filter((t) => t.startsWith('參見 ')).length, 8, '文末的連結清單要保留');
  assert.deepEqual(blocks.slice(0, 2).map((b) => b.type), ['h1', 'p'], '標題後面直接就是正文');

  // 導覽項目太少（不到 5 個）就不動它，避免誤刪正常的短清單
  const few = extract(html(`<li><a href="/a">甲項</a></li><li><a href="/b">乙項</a></li>${lead}`), 'https://test.example/');
  assert.equal(few.blocks.filter((b) => b.type === 'li').length, 2);
});

test('decodeEntities 認得具名、十進位與十六進位實體', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&#39;&nbsp;&#x4F60;&#22909;&unknown;'), '&<>"\' 你好&unknown;');
});

test('抓取流程：正常取回、轉址、錯誤狀態、非網頁、過大', async () => {
  const ok = await fetchPage('test.example/a', {
    lookup,
    fetchImpl: async () => page('<h1>你好</h1><p>內文</p>'),
  });
  assert.equal(ok.url, 'https://test.example/a');
  assert.equal(ok.host, 'test.example');
  assert.equal(ok.secure, true);
  assert.equal(ok.title, '測試頁');
  assert.deepEqual(ok.blocks.map((b) => b.runs[0].text), ['你好', '內文']);

  // 轉址會被跟隨，最終網址以轉址後為準
  const hops = [];
  const redirected = await fetchPage('http://test.example/start', {
    lookup,
    fetchImpl: async (url) => {
      hops.push(url);
      return hops.length === 1
        ? new Response('', { status: 301, headers: { location: 'https://test.example/final' } })
        : page('<p>終點</p>');
    },
  });
  assert.deepEqual(hops, ['http://test.example/start', 'https://test.example/final']);
  assert.equal(redirected.url, 'https://test.example/final');

  await assert.rejects(
    () => fetchPage('test.example', { lookup, fetchImpl: async () => new Response('', { status: 404, statusText: 'Not Found' }) }),
    (e) => e.code === 'http' && /404/.test(e.message),
  );
  await assert.rejects(
    () => fetchPage('test.example/a.png', { lookup, fetchImpl: async () => new Response('x', { headers: { 'content-type': 'image/png' } }) }),
    (e) => e.code === 'type',
  );
  await assert.rejects(
    () => fetchPage('test.example', {
      lookup,
      fetchImpl: async () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': String(9 * 1024 * 1024) } }),
    }),
    (e) => e.code === 'too-big',
  );
});

test('轉址到內網會在轉址後再檢查一次，並且限制轉址次數', async () => {
  await assert.rejects(
    () => fetchPage('test.example', {
      lookup,
      fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1:3000/admin' } }),
    }),
    (e) => e.code === 'blocked',
    '公開網站轉址到迴環位址必須被擋下',
  );

  let n = 0;
  await assert.rejects(
    () => fetchPage('test.example', {
      lookup,
      fetchImpl: async () => new Response('', { status: 302, headers: { location: `https://test.example/${(n += 1)}` } }),
    }),
    (e) => e.code === 'redirect',
  );
});

test('連線失敗與逾時會給出可讀的訊息', async () => {
  await assert.rejects(
    () => fetchPage('test.example', { lookup, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    (e) => e.code === 'network',
  );
  await assert.rejects(
    () => fetchPage('test.example', {
      lookup,
      fetchImpl: async () => { const err = new Error('timeout'); err.name = 'TimeoutError'; throw err; },
    }),
    (e) => e.code === 'timeout' && /逾時/.test(e.message),
  );
});

/* ---------------- 走 HTTP 介面的部分 ---------------- */

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tideweb-'));
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
  try {
    await run({ call, state: async () => (await call('/api/state')).body });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('/api/browse 會擋掉內網與非 http(s) 網址', async () => {
  await withServer(async ({ call }) => {
    const blocked = await call('/api/browse', { method: 'POST', body: { url: 'http://127.0.0.1:3000/' } });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /不允許瀏覽/);

    assert.equal((await call('/api/browse', { method: 'POST', body: { url: 'file:///etc/passwd' } })).status, 400);
    assert.equal((await call('/api/browse', { method: 'POST', body: { url: '' } })).status, 400);
    assert.equal((await call('/api/browse', { method: 'POST', body: { url: 'http://192.168.0.1/' } })).status, 403);
  });
});

test('書籤可以新增、去重與刪除', async () => {
  await withServer(async ({ call, state }) => {
    const initial = (await state()).bookmarks;
    assert.ok(initial.length >= 3);
    assert.ok(initial.every((b) => b.url.startsWith('https://')));

    const added = await call('/api/bookmarks', { method: 'POST', body: { url: 'test.example/docs', title: '測試站' } });
    assert.equal(added.status, 201);
    assert.equal(added.body.bookmark.url, 'https://test.example/docs', '網址會被正規化後才存');

    // 同一個網址不會重複加入
    assert.equal((await call('/api/bookmarks', { method: 'POST', body: { url: 'https://test.example/docs' } })).status, 409);
    assert.equal((await call('/api/bookmarks', { method: 'POST', body: { url: 'ftp://x.example' } })).status, 400);

    const id = added.body.bookmark.id;
    assert.equal((await call(`/api/bookmarks/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(`/api/bookmarks/${id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await state()).bookmarks.length, initial.length);
  });
});

test('瀏覽紀錄可以清除，且回復原廠會一併清掉', async () => {
  await withServer(async ({ call, state }) => {
    assert.deepEqual((await state()).history, []);
    assert.equal((await call('/api/history/clear', { method: 'POST' })).status, 200);

    await call('/api/bookmarks', { method: 'POST', body: { url: 'a.example' } });
    await call('/api/reset', { method: 'POST' });
    const after = await state();
    assert.equal(after.bookmarks.length, 4, '回復原廠會還原成預設書籤');
    assert.deepEqual(after.history, []);
  });
});
