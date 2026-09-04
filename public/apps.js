import { api, el, esc, fmtSize, shade, tint } from './util.js';

/* ============================ 萬象商店 ============================ */
const store = {
  id: 'store',
  render(ctx) {
    const root = el('<div></div>');
    let osFilter = ctx.memo.storeFilter ?? 'all';
    let category = ctx.memo.storeCategory ?? null;
    let keyword = ctx.memo.storeKeyword ?? '';

    const draw = async () => {
      // 一次取回整份目錄（含已安裝狀態），來源與分類都在前端過濾，計數才會處處一致
      const { sources, apps } = await api(`/api/catalog${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`);
      const external = sources.filter((s) => !s.builtin);

      const scope = apps.filter((a) => osFilter === 'all' || a.os === osFilter);
      const categories = [...new Set(scope.map((a) => a.category))]
        .map((name) => ({ name, count: scope.filter((a) => a.category === name).length }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'));
      if (category && !categories.some((c) => c.name === category)) category = null;

      const shown = scope.filter((a) => !category || a.category === category);
      // 「一鍵撈取全部」的範圍：目前選到的分類，不受來源分頁影響
      const wide = apps.filter((a) => !category || a.category === category);
      const wideGot = wide.filter((a) => a.installed).length;
      const label = category ?? 'App';

      root.replaceChildren();

      const hero = el(`<div class="hero">
        <h3>把其他系統的${category ? esc(category) : ' App'}全部撈進來</h3>
        <p>萬象相容層接上 ${external.length} 套作業系統${category ? `，其中「${esc(category)}」共 ${wide.length} 個` : `，共 ${apps.length} 個 App`}，
           已在這台裝置上 ${wideGot} 個。未啟用相容層的來源會自動略過。</p>
        <button class="big-btn" ${wideGot >= wide.length ? 'disabled' : ''}>
          ${wideGot >= wide.length ? `全部${esc(label)}都撈完了` : `一鍵撈取全部${esc(label)}（還有 ${wide.length - wideGot} 個）`}
        </button>
      </div>`);
      hero.querySelector('button').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = '撈取中…';
        try {
          const res = await api('/api/apps/install-all', { method: 'POST', body: category ? { category } : {} });
          ctx.setState(res.state);
          const skipped = res.skipped.length ? `，略過未啟用的 ${res.skipped.join('、')}` : '';
          ctx.notify('萬象相容層', `已撈取 ${res.installed} 個${esc(label)}${skipped}`);
        } catch (err) {
          ctx.notify('撈取失敗', err.message);
        }
        await draw();
      });
      root.append(hero);

      // 來源系統分頁
      const tabs = el('<div class="tabs-os"></div>');
      const mkTab = (key, text, extra = '') => {
        const b = el(`<button class="tab-os ${osFilter === key ? 'on' : ''}">${text}${extra}</button>`);
        b.addEventListener('click', () => { osFilter = key; ctx.memo.storeFilter = key; draw(); });
        return b;
      };
      tabs.append(mkTab('all', '全部'));
      external.forEach((s) =>
        tabs.append(
          mkTab(s.os, `${s.glyph} ${s.short}`, `<span class="count">${s.installed}/${s.total}</span>${s.enabled ? '' : ' ⏸'}`),
        ),
      );
      root.append(tabs);

      // 分類分頁
      if (categories.length > 1) {
        const chips = el('<div class="tabs-os" style="padding-top:0"></div>');
        const mkChip = (name) => {
          const on = category === name || (!category && name === null);
          const count = name ? categories.find((c) => c.name === name).count : scope.length;
          const chip = el(`<button class="tab-os ${on ? 'on' : ''}" style="font-size:12px">${
            name ? esc(name) : '全部分類'
          }<span class="count">${count}</span></button>`);
          chip.addEventListener('click', () => {
            category = name;
            ctx.memo.storeCategory = name;
            draw();
          });
          return chip;
        };
        chips.append(mkChip(null), ...categories.slice(0, 8).map((c) => mkChip(c.name)));
        root.append(chips);
      }

      const search = el('<div style="padding:0 14px 8px"><input class="field" placeholder="搜尋 App 名稱或分類" /></div>');
      const input = search.querySelector('input');
      input.value = keyword;
      input.addEventListener('input', (e) => {
        keyword = e.target.value.trim();
        ctx.memo.storeKeyword = keyword;
        clearTimeout(input._t);
        input._t = setTimeout(draw, 220);
      });
      root.append(search);

      // 選定單一來源時，顯示它的相容層資訊與整包撈取
      if (osFilter !== 'all') {
        const s = external.find((x) => x.os === osFilter);
        const got = shown.filter((a) => a.installed).length;
        const card = el(`<div class="hero" style="background:linear-gradient(150deg, ${s.accent}33, rgba(127,127,127,.06))">
          <h3>${s.glyph} ${esc(s.name)}${category ? ` · ${esc(category)}` : ''} · ${got}/${shown.length}</h3>
          <p><strong>${esc(s.runtime)}</strong><br />${esc(s.detail)}</p>
          <button class="big-btn" ${!s.enabled || got >= shown.length ? 'disabled' : ''}>
            ${!s.enabled
              ? '相容層未啟用（到「設定」開啟）'
              : got >= shown.length
                ? `已全部撈取`
                : `撈取 ${esc(s.name)} 的全部 ${shown.length} 個${esc(category ?? ' App')}`}
          </button>
        </div>`);
        card.querySelector('button').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const res = await api('/api/apps/install-all', {
              method: 'POST',
              body: category ? { os: osFilter, category } : { os: osFilter },
            });
            ctx.setState(res.state);
            ctx.notify(s.name, `已撈取 ${res.installed} 個${esc(category ?? ' App')}到桌面`);
          } catch (err) {
            ctx.notify('撈取失敗', err.message);
          }
          await draw();
        });
        root.append(card);
      }

      if (!shown.length) {
        root.append(el('<p class="section-title" style="text-align:center;padding:40px 0">找不到符合的 App</p>'));
        return;
      }

      const list = el('<div class="list"></div>');
      const bySource = new Map();
      shown.forEach((a) => bySource.set(a.os, [...(bySource.get(a.os) ?? []), a]));
      for (const [os, group] of bySource) {
        const s = external.find((x) => x.os === os);
        if (osFilter === 'all') list.append(el(`<div class="section-title">${s.glyph} ${esc(s.name)} · ${esc(s.runtime)}</div>`));
        group.forEach((app) => list.append(storeRow(app, s, ctx, draw)));
      }
      root.append(list);
    };

    draw();
    return root;
  },
};

function storeRow(app, source, ctx, redraw) {
  const row = el(`<div class="list-item">
    <span class="icon" style="${tint(app)};width:44px;height:44px;border-radius:12px;font-size:21px">${app.glyph}</span>
    <div class="grow">
      <div class="t">${esc(app.name)} <span style="font-weight:400;opacity:.5;font-size:11.5px">${esc(app.en)}</span></div>
      <div class="d">${esc(app.genre ?? app.category)} · ${fmtSize(app.size)}${app.enabled ? '' : ' · 相容層未啟用'}</div>
    </div>
  </div>`);

  const btn = el(
    app.installed
      ? '<button class="pill-btn ghost">移除</button>'
      : `<button class="pill-btn" ${app.enabled ? '' : 'disabled'}>撈取</button>`,
  );
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (app.installed) {
        const res = await api('/api/apps/uninstall', { method: 'POST', body: { id: app.id } });
        ctx.setState(res.state);
        ctx.notify(app.name, '已從裝置移除');
      } else {
        const res = await api('/api/apps/install', { method: 'POST', body: { id: app.id } });
        ctx.setState(res.state);
        ctx.notify(`${source.glyph} ${app.name}`, `已透過 ${source.runtime.split(' · ')[0]} 安裝到桌面`);
      }
    } catch (err) {
      ctx.notify('操作失敗', err.message);
    }
    await redraw();
  });
  row.append(btn);
  return row;
}

/* ============================ 瀏覽器 ============================ */
const SEARCH_URL = 'https://duckduckgo.com/html/?q=';

/** 網址列輸入 → 要瀏覽的網址；看起來不像網址就丟去搜尋 */
function toTarget(input) {
  const raw = input.trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^[^\s/]+\.[^\s/]{2,}([/?#].*)?$/.test(raw) || raw.startsWith('localhost')) return raw;
  return SEARCH_URL + encodeURIComponent(raw);
}

const browser = {
  id: 'browser',
  render(ctx) {
    const session = (ctx.memo.browser ??= { stack: [], index: -1, page: null });

    const root = el(`<div style="display:flex;flex-direction:column;height:100%">
      <div style="display:flex;gap:7px;padding:10px 12px;align-items:center;border-bottom:1px solid var(--win-sep);flex:0 0 auto">
        <button class="nav-btn" data-act="back" title="上一頁">‹</button>
        <button class="nav-btn" data-act="forward" title="下一頁">›</button>
        <button class="nav-btn" data-act="reload" title="重新整理">⟳</button>
        <input class="field" style="flex:1;padding:8px 12px;font-size:13px" placeholder="搜尋或輸入網址"
               autocapitalize="off" autocomplete="off" spellcheck="false" />
        <button class="nav-btn" data-act="star" title="加入書籤">☆</button>
      </div>
      <div class="app-body" style="flex:1"></div>
    </div>`);
    const bar = root.querySelector('input');
    const view = root.querySelector('.app-body');
    const btn = (act) => root.querySelector(`[data-act="${act}"]`);

    const syncChrome = () => {
      btn('back').disabled = session.index <= 0;
      btn('forward').disabled = session.index >= session.stack.length - 1;
      btn('reload').disabled = !session.page;
      const marked = session.page && ctx.state.bookmarks.some((b) => b.url === session.page.url);
      btn('star').textContent = marked ? '★' : '☆';
      btn('star').disabled = !session.page;
      btn('star').style.color = marked ? '#f6b93b' : '';
    };

    const startPage = () => {
      view.replaceChildren();
      view.append(el(`<div class="hero" style="margin:14px">
        <h3>🧭 OmniWeb</h3>
        <p>裝置本身沒有排版引擎：網頁由系統在伺服端取回、抽成可閱讀的區塊後，
           再交給 OmniUI 畫出來。內文裡的連結一樣可以點。</p>
      </div>`));

      view.append(el('<div class="section-title">書籤</div>'));
      const marks = el('<div class="list"></div>');
      if (!ctx.state.bookmarks.length) marks.append(el('<p class="section-title">還沒有書籤</p>'));
      ctx.state.bookmarks.forEach((b) => {
        const row = el(`<div class="list-item">
          <span style="font-size:17px;width:24px;text-align:center">🔖</span>
          <div class="grow"><div class="t">${esc(b.title)}</div><div class="d">${esc(b.url)}</div></div>
        </div>`);
        row.querySelector('.grow').style.cursor = 'pointer';
        row.querySelector('.grow').addEventListener('click', () => go(b.url));
        const del = el('<button class="pill-btn ghost">移除</button>');
        del.addEventListener('click', async () => {
          const res = await api(`/api/bookmarks/${b.id}`, { method: 'DELETE' });
          ctx.setState({ ...ctx.state, bookmarks: res.bookmarks });
          startPage();
        });
        row.append(del);
        marks.append(row);
      });
      view.append(marks);

      const head = el('<div class="section-title" style="display:flex;align-items:center">最近瀏覽</div>');
      if (ctx.state.history.length) {
        const clear = el('<button class="pill-btn ghost" style="margin-left:auto;padding:3px 10px;font-size:11.5px">清除</button>');
        clear.addEventListener('click', async () => {
          const res = await api('/api/history/clear', { method: 'POST' });
          ctx.setState({ ...ctx.state, history: res.history });
          startPage();
        });
        head.append(clear);
      }
      view.append(head);

      if (!ctx.state.history.length) {
        view.append(el('<p class="section-title">還沒有瀏覽紀錄</p>'));
        return;
      }
      const hist = el('<div class="list"></div>');
      ctx.state.history.slice(0, 12).forEach((h) => {
        const row = el(`<button class="list-item">
          <span style="font-size:15px;width:24px;text-align:center">🕘</span>
          <div class="grow"><div class="t">${esc(h.title)}</div><div class="d">${esc(h.host ?? h.url)}</div></div>
          <span style="opacity:.4">›</span></button>`);
        row.addEventListener('click', () => go(h.url));
        hist.append(row);
      });
      view.append(hist);
    };

    const renderPage = (page) => {
      view.replaceChildren();
      view.scrollTop = 0;
      view.append(el(`<div class="runtime-bar">
        <span class="dot" style="background:${page.secure ? '#34d399' : '#f6b93b'};box-shadow:none"></span>
        <span class="name">${page.secure ? '🔒' : '⚠️'} ${esc(page.host)}</span>
        <span class="sep">${page.blocks.length} 個區塊 · ${(page.bytes / 1024).toFixed(0)} KB</span>
      </div>`));

      const article = el('<article class="reader"></article>');
      article.append(el(`<h1 style="font-size:21px;line-height:1.35">${esc(page.title)}</h1>`));

      const STYLE = {
        h1: 'font-size:18px;margin-top:10px', h2: 'font-size:17px;margin-top:10px',
        h3: 'font-size:15.5px;margin-top:8px', h4: 'font-size:14.5px;margin-top:6px',
        h5: 'font-size:14px', h6: 'font-size:13.5px',
        p: 'font-size:14px;line-height:1.75', li: 'font-size:14px;line-height:1.7;padding-left:14px;position:relative',
        blockquote: 'font-size:14px;line-height:1.7;padding-left:12px;border-left:3px solid var(--win-line);color:var(--win-sub)',
        pre: 'font:12px/1.7 ui-monospace,Menlo,monospace;background:#0d1017;color:#d5dbe8;padding:12px;border-radius:10px;overflow-x:auto;white-space:pre-wrap',
      };

      page.blocks.forEach((block) => {
        const tag = /^h[1-6]$/.test(block.type) ? block.type : 'div';
        const node = el(`<${tag} style="${STYLE[block.type] ?? STYLE.p}"></${tag}>`);
        if (block.type === 'li') node.append(el('<span style="position:absolute;left:0;opacity:.45">•</span>'));
        block.runs.forEach((run, i) => {
          if (i) node.append(document.createTextNode(' '));
          if (!run.href) {
            node.append(document.createTextNode(run.text));
            return;
          }
          const link = el(`<button style="color:#2f8fff;text-align:left;padding:0;text-decoration:underline;text-underline-offset:2px">${esc(run.text)}</button>`);
          link.addEventListener('click', () => go(run.href));
          node.append(link);
        });
        article.append(node);
      });
      view.append(article);
    };

    const go = async (input) => {
      const target = toTarget(String(input));
      if (!target) return;
      bar.value = target;
      bar.blur();
      view.replaceChildren(el('<p class="section-title" style="text-align:center;padding:60px 0">載入中…</p>'));
      try {
        const res = await api('/api/browse', { method: 'POST', body: { url: target } });
        session.page = res.page;
        // 從歷史往回走之後又開新頁，就把前面的分支丟掉
        session.stack = [...session.stack.slice(0, session.index + 1), res.page.url];
        session.index = session.stack.length - 1;
        bar.value = res.page.url;
        ctx.setState({ ...ctx.state, history: res.history });
        renderPage(res.page);
      } catch (err) {
        view.replaceChildren(el(`<div class="hero" style="margin:14px;background:rgba(239,68,68,.14)">
          <h3>打不開這個網頁</h3>
          <p>${esc(err.message)}</p>
        </div>`));
        session.page = null;
      }
      syncChrome();
    };

    const jump = async (delta) => {
      const next = session.index + delta;
      if (next < 0 || next >= session.stack.length) return;
      session.index = next;
      const url = session.stack[next];
      bar.value = url;
      view.replaceChildren(el('<p class="section-title" style="text-align:center;padding:60px 0">載入中…</p>'));
      try {
        const res = await api('/api/browse', { method: 'POST', body: { url } });
        session.page = res.page;
        ctx.setState({ ...ctx.state, history: res.history });
        renderPage(res.page);
      } catch (err) {
        ctx.notify('瀏覽器', err.message);
      }
      syncChrome();
    };

    btn('back').addEventListener('click', () => jump(-1));
    btn('forward').addEventListener('click', () => jump(1));
    btn('reload').addEventListener('click', () => session.page && go(session.page.url));
    btn('star').addEventListener('click', async () => {
      if (!session.page) return;
      const marked = ctx.state.bookmarks.find((b) => b.url === session.page.url);
      try {
        const res = marked
          ? await api(`/api/bookmarks/${marked.id}`, { method: 'DELETE' })
          : await api('/api/bookmarks', { method: 'POST', body: { url: session.page.url, title: session.page.title } });
        ctx.setState({ ...ctx.state, bookmarks: res.bookmarks });
        ctx.notify('瀏覽器', marked ? '已移除書籤' : '已加入書籤');
      } catch (err) {
        ctx.notify('瀏覽器', err.message);
      }
      syncChrome();
    });
    bar.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(bar.value); });

    if (session.page) {
      bar.value = session.page.url;
      renderPage(session.page);
    } else {
      startPage();
    }
    syncChrome();
    return root;
  },
};

/* ============================ 設定 ============================ */
const settings = {
  id: 'settings',
  render(ctx) {
    const root = el('<div></div>');

    const draw = () => {
      const { device, storage, sources, wallpapers, installed } = ctx.state;
      root.replaceChildren();

      root.append(el(`<div class="hero">
        <h3>${esc(device.name)}</h3>
        <p>${esc(device.osVersion)} · 型號 ${esc(device.model)}<br />
           已安裝外來 App ${installed.length} 個 · 儲存空間 ${fmtSize(storage.usedMb)} / ${fmtSize(storage.totalMb)}</p>
        <div class="bar-track"><i style="width:${storage.percent}%"></i></div>
      </div>`));

      // 萬象相容層
      root.append(el('<div class="section-title">萬象相容層 · 各來源作業系統的執行環境</div>'));
      const rt = el('<div class="list"></div>');
      sources.filter((s) => !s.builtin).forEach((s) => {
        const row = el(`<div class="list-item">
          <span style="font-size:20px;width:26px;text-align:center">${s.glyph}</span>
          <div class="grow">
            <div class="t">${esc(s.name)}</div>
            <div class="d">${esc(s.runtime)} · 已撈取 ${s.installed}/${s.total}</div>
          </div>
          <span class="switch ${s.enabled ? 'on' : ''}"></span>
        </div>`);
        row.querySelector('.switch').addEventListener('click', async () => {
          try {
            const res = await api('/api/runtimes', { method: 'PATCH', body: { os: s.os, enabled: !s.enabled } });
            ctx.setState(res.state);
            ctx.notify(s.name, s.enabled ? '相容層已關閉，該來源的 App 暫停執行' : '相容層已啟用');
            draw();
          } catch (err) {
            ctx.notify('操作失敗', err.message);
          }
        });
        rt.append(row);
      });
      root.append(rt, el('<p class="section-title" style="padding-top:4px;line-height:1.6">關閉相容層不會刪除已撈取的 App，只會讓它們在桌面上暫停。</p>'));

      // 外觀
      root.append(el('<div class="section-title">外觀</div>'));
      const look = el('<div class="list"></div>');
      const darkRow = el(`<div class="list-item"><span style="width:26px;text-align:center">🌙</span>
        <div class="grow"><div class="t">深色模式</div></div><span class="switch ${device.darkMode ? 'on' : ''}"></span></div>`);
      darkRow.querySelector('.switch').addEventListener('click', () => patch({ darkMode: !device.darkMode }));
      look.append(darkRow);

      const wpRow = el('<div style="padding:12px 16px;display:grid;gap:9px"><div class="d" style="font-size:11.5px;color:#93a0b6">桌布</div><div style="display:flex;gap:9px;flex-wrap:wrap"></div></div>');
      const swatches = wpRow.querySelector('div:last-child');
      wallpapers.forEach((w) => {
        const s = el(`<button title="${esc(w.name)}" style="width:44px;height:60px;border-radius:11px;background:linear-gradient(160deg,${w.from},${w.to});box-shadow:${
          device.wallpaper === w.id ? '0 0 0 2.5px #fff' : '0 0 0 1px rgba(255,255,255,.18)'
        }"></button>`);
        s.addEventListener('click', () => patch({ wallpaper: w.id }));
        swatches.append(s);
      });
      look.append(wpRow);
      root.append(look);

      // 顯示與聲音
      root.append(el('<div class="section-title">顯示與聲音</div>'));
      const sliders = el('<div style="padding:12px 16px;display:grid;gap:16px"></div>');
      sliders.append(slider('🔆 亮度', device.brightness, (v) => patch({ brightness: v }, true)));
      sliders.append(slider('🔊 音量', device.volume, (v) => patch({ volume: v }, true)));
      root.append(sliders);

      // 連線
      root.append(el('<div class="section-title">連線</div>'));
      const conn = el('<div class="list"></div>');
      [['wifi', '📶', 'Wi‑Fi'], ['bluetooth', '🔵', '藍牙'], ['dnd', '🌜', '勿擾模式']].forEach(([key, ico, label]) => {
        const row = el(`<div class="list-item"><span style="width:26px;text-align:center">${ico}</span>
          <div class="grow"><div class="t">${label}</div></div><span class="switch ${device[key] ? 'on' : ''}"></span></div>`);
        row.querySelector('.switch').addEventListener('click', () => patch({ [key]: !device[key] }));
        conn.append(row);
      });
      root.append(conn);

      // 回復原廠
      const reset = el('<div style="padding:20px 16px 40px"><button class="pill-btn danger" style="width:100%;padding:11px">回復原廠設定</button></div>');
      reset.querySelector('button').addEventListener('click', async () => {
        const res = await api('/api/reset', { method: 'POST' });
        ctx.setState(res.state);
        ctx.notify('潮汐 OS', '已回復原廠設定');
        draw();
      });
      root.append(reset);
    };

    const patch = async (body, quiet = false) => {
      try {
        const res = await api('/api/device', { method: 'PATCH', body });
        ctx.setState({ ...ctx.state, device: res.device });
        if (!quiet) draw();
      } catch (err) {
        ctx.notify('設定失敗', err.message);
      }
    };

    draw();
    return root;
  },
};

function slider(label, value, onInput) {
  const wrap = el(`<label style="display:grid;gap:7px"><span style="font-size:12.5px;color:#c3ccdd">${label} <b style="float:right;font-weight:600">${value}</b></span>
    <input type="range" min="0" max="100" value="${value}" /></label>`);
  const out = wrap.querySelector('b');
  wrap.querySelector('input').addEventListener('input', (e) => {
    out.textContent = e.target.value;
    onInput(Number(e.target.value));
  });
  return wrap;
}

/* ============================ 備忘錄 ============================ */
const notes = {
  id: 'notes',
  render(ctx) {
    const root = el('<div></div>');

    const list = () => {
      root.replaceChildren();
      const add = el('<div style="padding:12px 14px"><button class="big-btn">＋ 新增備忘錄</button></div>');
      add.querySelector('button').addEventListener('click', () => editor(null));
      root.append(add);

      if (!ctx.state.notes.length) {
        root.append(el('<p class="section-title" style="text-align:center;padding:40px 0">還沒有備忘錄</p>'));
        return;
      }
      const ul = el('<div class="list"></div>');
      ctx.state.notes.forEach((note) => {
        const row = el(`<button class="list-item">
          <div class="grow"><div class="t">${esc(note.title)}</div>
          <div class="d">${new Date(note.updatedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(note.body.slice(0, 30) || '無內容')}</div></div>
          <span style="opacity:.4">›</span></button>`);
        row.addEventListener('click', () => editor(note));
        ul.append(row);
      });
      root.append(ul);
    };

    const editor = (note) => {
      root.replaceChildren();
      const form = el(`<div style="padding:14px;display:grid;gap:12px">
        <input class="field" name="title" maxlength="80" placeholder="標題" value="${esc(note?.title ?? '')}" />
        <textarea class="field" name="body" rows="12" placeholder="內容">${esc(note?.body ?? '')}</textarea>
        <div style="display:flex;gap:9px">
          <button class="pill-btn" style="flex:1;padding:10px">儲存</button>
          <button class="pill-btn ghost" style="padding:10px 16px">返回</button>
          ${note ? '<button class="pill-btn danger" style="padding:10px 16px">刪除</button>' : ''}
        </div>
      </div>`);
      const [save, back, del] = form.querySelectorAll('button');

      save.addEventListener('click', async () => {
        const title = form.querySelector('[name=title]').value.trim();
        const body = form.querySelector('[name=body]').value;
        if (!title) return ctx.notify('備忘錄', '標題不能為空');
        try {
          if (note) await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { title, body } });
          else await api('/api/notes', { method: 'POST', body: { title, body } });
          await ctx.reload();
          ctx.notify('備忘錄', '已儲存');
          list();
        } catch (err) {
          ctx.notify('儲存失敗', err.message);
        }
      });
      back.addEventListener('click', list);
      del?.addEventListener('click', async () => {
        await api(`/api/notes/${note.id}`, { method: 'DELETE' });
        await ctx.reload();
        ctx.notify('備忘錄', '已刪除');
        list();
      });
      root.append(form);
    };

    list();
    return root;
  },
};

/* ============================ 計算機 ============================ */
const calculator = {
  id: 'calculator',
  render() {
    const root = el(`<div style="display:flex;flex-direction:column;height:100%;padding:14px;gap:12px">
      <output style="flex:1;display:flex;align-items:end;justify-content:end;font-size:56px;font-weight:250;letter-spacing:-2px;overflow:hidden">0</output>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px"></div>
    </div>`);
    const out = root.querySelector('output');
    const pad = root.querySelector('div');

    let current = '0';
    let previous = null;
    let op = null;
    let fresh = true;

    const show = (v) => {
      const s = String(v);
      out.textContent = s.length > 9 ? Number(v).toPrecision(7) : s;
      out.style.fontSize = s.length > 7 ? '38px' : '56px';
    };
    const compute = () => {
      const a = Number(previous);
      const b = Number(current);
      const r = { '+': a + b, '−': a - b, '×': a * b, '÷': b === 0 ? NaN : a / b }[op];
      return Number.isFinite(r) ? Math.round(r * 1e9) / 1e9 : '錯誤';
    };

    const KEYS = [
      ['AC', 'fn'], ['±', 'fn'], ['%', 'fn'], ['÷', 'op'],
      ['7'], ['8'], ['9'], ['×', 'op'],
      ['4'], ['5'], ['6'], ['−', 'op'],
      ['1'], ['2'], ['3'], ['+', 'op'],
      ['0', 'wide'], ['.'], ['=', 'op'],
    ];

    KEYS.forEach(([key, type]) => {
      const bg = type === 'op' ? '#ff9f0a' : type === 'fn' ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.12)';
      const btn = el(`<button style="${type === 'wide' ? 'grid-column:span 2;border-radius:34px;justify-content:start;padding-left:26px;' : 'border-radius:50%;'}
        aspect-ratio:${type === 'wide' ? 'auto' : '1'};background:${bg};font-size:23px;display:flex;align-items:center;justify-content:${type === 'wide' ? 'flex-start' : 'center'};
        color:${type === 'fn' ? '#111' : '#fff'}">${key}</button>`);
      btn.addEventListener('click', () => {
        if (/[0-9.]/.test(key)) {
          if (key === '.' && current.includes('.')) return;
          current = fresh ? (key === '.' ? '0.' : key) : current + key;
          fresh = false;
        } else if (key === 'AC') {
          current = '0'; previous = null; op = null; fresh = true;
        } else if (key === '±') {
          current = String(-Number(current));
        } else if (key === '%') {
          current = String(Number(current) / 100);
        } else if (key === '=') {
          if (op !== null && previous !== null) {
            current = String(compute());
            previous = null; op = null; fresh = true;
          }
        } else {
          if (op !== null && previous !== null && !fresh) current = String(compute());
          previous = current; op = key; fresh = true;
        }
        show(current);
      });
      pad.append(btn);
    });
    return root;
  },
};

/* ============================ 終端機 ============================ */
const terminal = {
  id: 'terminal',
  render(ctx) {
    const root = el(`<div style="display:flex;flex-direction:column;height:100%;background:#0a0c11">
      <pre class="code" style="flex:1;overflow:auto;white-space:pre-wrap;margin:0"></pre>
      <div style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08)">
        <span style="color:#34d399;font:12px ui-monospace,Menlo,monospace;align-self:center">tide $</span>
        <input class="field" style="flex:1;font:12px ui-monospace,Menlo,monospace;padding:7px 10px" autocapitalize="off" autocomplete="off" spellcheck="false" />
      </div>
    </div>`);
    const view = root.querySelector('pre');
    const input = root.querySelector('input');

    const write = (text) => {
      view.textContent += text + '\n';
      view.scrollTop = view.scrollHeight;
    };

    write('潮汐 OS 1.0（萬象）· OmniShell\n輸入 help 看可用指令。\n');

    const commands = {
      help: () =>
        ['可用指令：',
          '  apps                列出桌面上的 App',
          '  sources             列出所有來源作業系統與相容層狀態',
          '  ls <os> [分類]      列出某個系統可撈取的 App',
          '  install <app-id>    撈取單一 App',
          '  fetch <os|all> [分類]  撈取整包 App，例如 fetch ios 遊戲',
          '  uninstall <app-id>  移除 App',
          '  open <app-id>       開啟 App',
          '  browse <網址>       用 reader 模式抓一個網頁下來看',
          '  df                  儲存空間',
          '  uname               系統資訊',
          '  clear               清空畫面'].join('\n'),
      uname: () => {
        const d = ctx.state.device;
        return `${d.osVersion}\n裝置 ${d.name}（${d.model}）\n核心 OmniKernel 6.1 · 介面層 OmniUI`;
      },
      df: () => {
        const s = ctx.state.storage;
        return `總容量 ${fmtSize(s.totalMb)}\n已使用 ${fmtSize(s.usedMb)}（系統 ${fmtSize(s.systemMb)}）\n剩餘   ${fmtSize(s.freeMb)}（${(100 - s.percent).toFixed(1)}%）`;
      },
      apps: () => {
        const rows = [...ctx.state.builtins, ...ctx.state.installed];
        return rows.map((a) => `${(a.id + '                    ').slice(0, 20)} ${a.name}${a.active === false ? '  [暫停]' : ''}`).join('\n');
      },
      sources: () =>
        ctx.state.sources
          .map((s) => `${(s.os + '        ').slice(0, 9)} ${s.enabled ? '啟用' : '停用'}  ${s.installed}/${s.total}  ${s.runtime}`)
          .join('\n'),
      clear: () => { view.textContent = ''; return ''; },
      async ls(os, category) {
        if (!os) return '用法：ls <os> [分類]，例如 ls ios 遊戲';
        const q = `?os=${encodeURIComponent(os)}${category ? `&category=${encodeURIComponent(category)}` : ''}`;
        const { apps } = await api(`/api/catalog${q}`);
        return apps
          .map((a) => `${(a.id + '                    ').slice(0, 20)} ${a.name}  ${a.genre ?? a.category}  ${fmtSize(a.size)}${a.installed ? '  [已安裝]' : ''}`)
          .join('\n');
      },
      async install(id) {
        if (!id) return '用法：install <app-id>';
        const res = await api('/api/apps/install', { method: 'POST', body: { id } });
        ctx.setState(res.state);
        return `已撈取 ${res.app.name}`;
      },
      async uninstall(id) {
        if (!id) return '用法：uninstall <app-id>';
        const res = await api('/api/apps/uninstall', { method: 'POST', body: { id } });
        ctx.setState(res.state);
        return `已移除 ${id}`;
      },
      async fetch(os, category) {
        if (!os) return '用法：fetch <os|all> [分類]，例如 fetch ios 遊戲';
        const body = os === 'all' ? {} : { os };
        if (category) body.category = category;
        const res = await api('/api/apps/install-all', { method: 'POST', body });
        ctx.setState(res.state);
        const skip = res.skipped.length ? `，略過 ${res.skipped.join('、')}` : '';
        return `已撈取 ${res.installed} 個${category ?? ' App'}，${res.already} 個原本就在${skip}`;
      },
      open(id) {
        if (!id) return '用法：open <app-id>';
        const app = [...ctx.state.builtins, ...ctx.state.installed].find((a) => a.id === id);
        if (!app) return `找不到 App：${id}`;
        setTimeout(() => ctx.openApp(app.id), 120);
        return `正在開啟 ${app.name}…`;
      },
      async browse(...rest) {
        const url = rest.join(' ');
        if (!url) return '用法：browse <網址>，例如 browse example.com';
        const { page } = await api('/api/browse', { method: 'POST', body: { url: toTarget(url) } });
        const head = `${page.title}\n${page.url}\n${'─'.repeat(28)}`;
        const text = page.blocks
          .slice(0, 12)
          .map((b) => (b.type.startsWith('h') ? `\n## ` : '') + b.runs.map((r) => r.text + (r.href ? ' ↗' : '')).join(' '))
          .join('\n');
        return `${head}\n${text}\n${'─'.repeat(28)}\n共 ${page.blocks.length} 個區塊，完整內容請用「瀏覽器」開啟`;
      },
      echo: (...rest) => rest.join(' '),
      date: () => new Date().toLocaleString('zh-TW'),
    };

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const raw = input.value.trim();
      input.value = '';
      if (!raw) return;
      write(`tide $ ${raw}`);
      const [cmd, ...args] = raw.split(/\s+/);
      const fn = commands[cmd];
      if (!fn) {
        write(`omnishell: 找不到指令 ${cmd}（試試 help）`);
        return;
      }
      try {
        const out = await fn(...args);
        if (out) write(out);
      } catch (err) {
        write(`錯誤：${err.message}`);
      }
    });

    setTimeout(() => input.focus(), 350);
    return root;
  },
};

/* ============================ 相片 ============================ */
const photos = {
  id: 'photos',
  render() {
    const root = el('<div style="padding:12px"></div>');
    const grid = el('<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px"></div>');
    const palette = ['#2f8fff', '#34d399', '#f6b93b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];
    for (let i = 0; i < 24; i += 1) {
      const c = palette[i % palette.length];
      const cell = el(`<button style="aspect-ratio:1;border-radius:8px;background:linear-gradient(${(i * 47) % 360}deg, ${c}, ${shade(c, -0.5)})"></button>`);
      cell.addEventListener('click', () => {
        const full = el(`<div style="position:absolute;inset:0;background:#000;z-index:5;display:grid;place-items:center">
          <div style="width:86%;aspect-ratio:3/4;border-radius:16px;background:linear-gradient(${(i * 47) % 360}deg, ${c}, ${shade(c, -0.5)})"></div>
          <div style="position:absolute;bottom:56px;color:#98a4ba;font-size:12px">IMG_${String(1000 + i)}.HEIF · 4032 × 3024</div>
        </div>`);
        full.addEventListener('click', () => full.remove());
        root.append(full);
      });
      grid.append(cell);
    }
    root.append(el('<div class="section-title" style="padding:4px 2px 10px">最近項目 · 24 張</div>'), grid);
    return root;
  },
};

/* ============================ 時鐘 ============================ */
const clock = {
  id: 'clock',
  render(ctx) {
    const zones = [
      ['台北', 'Asia/Taipei'],
      ['東京', 'Asia/Tokyo'],
      ['倫敦', 'Europe/London'],
      ['紐約', 'America/New_York'],
      ['舊金山', 'America/Los_Angeles'],
    ];
    const root = el(`<div style="padding:20px 16px;display:grid;gap:18px">
      <div style="text-align:center">
        <div id="ck-main" style="font-size:60px;font-weight:200;letter-spacing:-2px">--:--:--</div>
        <div id="ck-date" style="color:#93a0b6;font-size:13px"></div>
      </div>
      <div class="list"></div>
    </div>`);
    const list = root.querySelector('.list');
    zones.forEach(([name, tz]) =>
      list.append(el(`<div class="list-item"><div class="grow"><div class="t">${name}</div><div class="d" data-off="${tz}"></div></div>
        <div style="font-size:22px;font-weight:300" data-tz="${tz}">--:--</div></div>`)),
    );

    const tick = () => {
      const now = new Date();
      root.querySelector('#ck-main').textContent = now.toLocaleTimeString('zh-TW', { hour12: false });
      root.querySelector('#ck-date').textContent = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
      root.querySelectorAll('[data-tz]').forEach((node) => {
        node.textContent = now.toLocaleTimeString('zh-TW', { timeZone: node.dataset.tz, hour: '2-digit', minute: '2-digit', hour12: false });
      });
      root.querySelectorAll('[data-off]').forEach((node) => {
        node.textContent = now.toLocaleDateString('zh-TW', { timeZone: node.dataset.off, month: 'numeric', day: 'numeric', weekday: 'short' });
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    ctx.onCleanup(() => clearInterval(timer));
    return root;
  },
};

export const NATIVE_APPS = Object.fromEntries(
  [store, browser, settings, notes, calculator, terminal, photos, clock].map((a) => [a.id, a]),
);
