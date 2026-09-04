import { api, el, esc, fmtSize, shade, tint } from './util.js';

/* ============================ 萬象商店 ============================ */
const store = {
  id: 'store',
  render(ctx) {
    const root = el('<div></div>');
    let filter = ctx.memo.storeFilter ?? 'all';
    let keyword = ctx.memo.storeKeyword ?? '';

    const draw = async () => {
      const { sources, apps } = await api(
        `/api/catalog${filter === 'all' ? '' : `?os=${filter}`}${keyword ? `${filter === 'all' ? '?' : '&'}q=${encodeURIComponent(keyword)}` : ''}`,
      );
      const external = sources.filter((s) => !s.builtin);
      const totalAll = external.reduce((n, s) => n + s.total, 0);
      const gotAll = external.reduce((n, s) => n + s.installed, 0);

      root.replaceChildren();

      // 一鍵撈取
      const hero = el(`<div class="hero">
        <h3>把其他系統的 App 全部撈進來</h3>
        <p>萬象相容層目前接上 ${external.length} 套作業系統，共 ${totalAll} 個 App，已在這台裝置上 ${gotAll} 個。
           未啟用相容層的來源會自動略過。</p>
        <button class="big-btn" ${gotAll >= totalAll ? 'disabled' : ''}>
          ${gotAll >= totalAll ? '全部都撈完了' : `一鍵撈取全部（還有 ${totalAll - gotAll} 個）`}
        </button>
      </div>`);
      hero.querySelector('button').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = '撈取中…';
        try {
          const res = await api('/api/apps/install-all', { method: 'POST', body: {} });
          ctx.setState(res.state);
          const skipped = res.skipped.length ? `，略過未啟用的 ${res.skipped.join('、')}` : '';
          ctx.notify('萬象相容層', `已撈取 ${res.installed} 個 App${skipped}`);
        } catch (err) {
          ctx.notify('撈取失敗', err.message);
        }
        await draw();
      });
      root.append(hero);

      // 來源分頁
      const tabs = el('<div class="tabs-os"></div>');
      const mk = (key, label, extra = '') => {
        const b = el(`<button class="tab-os ${filter === key ? 'on' : ''}">${label}${extra}</button>`);
        b.addEventListener('click', () => { filter = key; ctx.memo.storeFilter = key; draw(); });
        return b;
      };
      tabs.append(mk('all', '全部'));
      external.forEach((s) =>
        tabs.append(
          mk(s.os, `${s.glyph} ${s.short}`, `<span class="count">${s.installed}/${s.total}</span>${s.enabled ? '' : ' ⏸'}`),
        ),
      );
      root.append(tabs);

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

      // 單一來源時，顯示該來源的相容層資訊與整包撈取
      if (filter !== 'all') {
        const s = external.find((x) => x.os === filter);
        const card = el(`<div class="hero" style="background:linear-gradient(150deg, ${s.accent}44, rgba(255,255,255,.05))">
          <h3>${s.glyph} ${esc(s.name)} · ${s.installed}/${s.total}</h3>
          <p><strong>${esc(s.runtime)}</strong><br />${esc(s.detail)}</p>
          <button class="big-btn" ${!s.enabled || s.installed >= s.total ? 'disabled' : ''}>
            ${!s.enabled ? '相容層未啟用（到「設定」開啟）' : s.installed >= s.total ? '已全部撈取' : `撈取 ${esc(s.name)} 的全部 ${s.total} 個 App`}
          </button>
        </div>`);
        card.querySelector('button').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const res = await api('/api/apps/install-all', { method: 'POST', body: { os: filter } });
            ctx.setState(res.state);
            ctx.notify(s.name, `已撈取 ${res.installed} 個 App 到桌面`);
          } catch (err) {
            ctx.notify('撈取失敗', err.message);
          }
          await draw();
        });
        root.append(card);
      }

      // App 清單
      if (!apps.length) {
        root.append(el('<p class="section-title" style="text-align:center;padding:40px 0">找不到符合的 App</p>'));
        return;
      }
      const list = el('<div class="list"></div>');
      const bySource = new Map();
      apps.forEach((a) => bySource.set(a.os, [...(bySource.get(a.os) ?? []), a]));

      for (const [os, group] of bySource) {
        const s = external.find((x) => x.os === os);
        if (filter === 'all') list.append(el(`<div class="section-title">${s.glyph} ${esc(s.name)} · ${esc(s.runtime)}</div>`));
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
      <div class="d">${esc(app.category)} · ${fmtSize(app.size)}${app.enabled ? '' : ' · 相容層未啟用'}</div>
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
          '  ls <os>             列出某個系統可撈取的 App',
          '  install <app-id>    撈取單一 App',
          '  fetch <os|all>      撈取整個系統的全部 App',
          '  uninstall <app-id>  移除 App',
          '  open <app-id>       開啟 App',
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
      async ls(os) {
        if (!os) return '用法：ls <os>，例如 ls android';
        const { apps } = await api(`/api/catalog?os=${encodeURIComponent(os)}`);
        return apps.map((a) => `${(a.id + '                    ').slice(0, 20)} ${a.name}  ${fmtSize(a.size)}${a.installed ? '  [已安裝]' : ''}`).join('\n');
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
      async fetch(os) {
        if (!os) return '用法：fetch <os|all>，例如 fetch android';
        const res = await api('/api/apps/install-all', { method: 'POST', body: os === 'all' ? {} : { os } });
        ctx.setState(res.state);
        const skip = res.skipped.length ? `，略過 ${res.skipped.join('、')}` : '';
        return `已撈取 ${res.installed} 個 App，${res.already} 個原本就在${skip}`;
      },
      open(id) {
        if (!id) return '用法：open <app-id>';
        const app = [...ctx.state.builtins, ...ctx.state.installed].find((a) => a.id === id);
        if (!app) return `找不到 App：${id}`;
        setTimeout(() => ctx.openApp(app.id), 120);
        return `正在開啟 ${app.name}…`;
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
  [store, settings, notes, calculator, terminal, photos, clock].map((a) => [a.id, a]),
);
