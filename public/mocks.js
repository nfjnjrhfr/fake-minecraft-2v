import { esc, tint } from './util.js';

/**
 * 相容層執行畫面。
 *
 * 外來 App 的介面由各自 runtime 轉譯後交給 OmniUI 繪製；這裡依照 App 的介面型態
 * （feed / chat / player …）渲染對應的畫面骨架 —— 這是相容層的模擬渲染，
 * 不是真的在跑 dex 或 PE 執行檔。
 */

/** 由 App id 產生穩定的偽隨機序列，讓每個 App 的畫面長得不一樣但每次都一致 */
function seeded(id) {
  let h = 2166136261;
  for (const ch of id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (min, max) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return min + (Math.abs(h) % (max - min + 1));
  };
}

const line = (w, extra = '') => `<div class="mock-line" style="width:${w}%;${extra}"></div>`;

const KIND = {
  feed(app, rnd) {
    const cards = Array.from({ length: 3 }, () => `
      <article class="mock-card">
        <div class="mock-row">
          <div class="mock-av"></div>
          <div style="flex:1;display:grid;gap:6px">${line(rnd(45, 70))}${line(rnd(25, 40), 'opacity:.6')}</div>
          <span class="mock-sub">${rnd(1, 23)} 分鐘前</span>
        </div>
        <div class="mock-img" style="height:${rnd(88, 132)}px"></div>
        <div class="mock-row" style="gap:14px">
          <span class="mock-sub">♡ ${rnd(20, 980)}</span>
          <span class="mock-sub">💬 ${rnd(2, 88)}</span>
          <span class="mock-sub">↗ 分享</span>
        </div>
      </article>`).join('');
    return `<div class="mock">
      <div class="mock-row"><h3 class="mock-title">${esc(app.name)}</h3><span class="mock-pill" style="margin-left:auto">推薦</span><span class="mock-pill">追蹤中</span></div>
      ${cards}</div>`;
  },

  chat(app, rnd) {
    const msgs = ['在嗎？剛把檔案傳給你了', '收到，我看一下', '這版把相容層的權限對映補完了', '👍 那我這邊直接測 Android 那條路徑'];
    return `<div class="mock">
      <div class="mock-row"><div class="mock-av"></div><div><div class="mock-title">工作群組</div><div class="mock-sub">${rnd(3, 12)} 人 · 線上</div></div></div>
      <div style="display:grid;gap:9px;margin-top:4px">
        ${msgs.map((m, i) => `<div class="bubble ${i % 2 ? 'me' : ''}">${esc(m)}</div>`).join('')}
      </div>
      <div class="mock-row" style="margin-top:6px">
        <div class="field" style="flex:1;color:#8d99ae;font-size:13px">傳送訊息…</div>
        <div class="mock-pill">＋</div>
      </div>
    </div>`;
  },

  player(app, rnd) {
    const tracks = ['前奏 · Intro', '海潮 · Tide', '夜航 · Nightfall', '回聲 · Echoes'];
    return `<div class="mock">
      <div class="mock-img" style="height:180px;border-radius:18px"></div>
      <div><div class="mock-title">${esc(app.name)} 精選輯</div><div class="mock-sub">${esc(app.category)} · ${rnd(8, 42)} 個項目</div></div>
      <div class="progress"><i></i></div>
      <div class="mock-row" style="justify-content:center;gap:26px;font-size:22px">⏮ <span style="font-size:30px">⏸</span> ⏭</div>
      <div style="display:grid;gap:2px">
        ${tracks.map((t, i) => `<div class="list-item" style="padding:10px 0"><span class="mock-sub" style="width:18px">${i + 1}</span><div class="grow"><div class="t" style="font-size:13px">${esc(t)}</div></div><span class="mock-sub">${rnd(2, 5)}:${String(rnd(10, 59))}</span></div>`).join('')}
      </div>
    </div>`;
  },

  tool(app, rnd) {
    return `<div class="mock">
      <div class="mock-row" style="gap:6px;flex-wrap:wrap">
        ${['選取', '筆刷', '形狀', '文字', '圖層'].map((t, i) => `<span class="mock-pill" ${i === 1 ? 'style="background:linear-gradient(160deg,var(--c1),var(--c2))"' : ''}>${t}</span>`).join('')}
      </div>
      <div class="mock-card" style="height:230px;position:relative;overflow:hidden">
        <svg viewBox="0 0 200 160" style="position:absolute;inset:0;width:100%;height:100%">
          <circle cx="${rnd(50, 90)}" cy="60" r="34" fill="var(--c1)" opacity=".7" />
          <rect x="${rnd(80, 110)}" y="70" width="62" height="62" rx="12" fill="var(--c2)" opacity=".85" />
          <path d="M20 140 Q 70 ${rnd(80, 110)} 180 130" stroke="#fff" stroke-width="2.5" fill="none" opacity=".6" />
        </svg>
      </div>
      <div class="mock-row"><span class="mock-sub">畫布 1920×1080</span><span class="mock-sub" style="margin-left:auto">縮放 ${rnd(60, 140)}%</span></div>
      <div class="mock-btn">匯出</div>
    </div>`;
  },

  doc(app, rnd) {
    return `<div class="mock">
      <div class="mock-card" style="background:rgba(255,255,255,.94);color:#1a1c22;padding:18px;display:grid;gap:9px">
        <div style="font-size:16px;font-weight:700">${esc(app.name)} 文件</div>
        ${Array.from({ length: 9 }, (_, i) => `<div class="mock-line" style="width:${i === 4 ? 62 : rnd(78, 100)}%;background:rgba(20,22,28,.13)"></div>`).join('')}
        <div style="height:70px;border-radius:8px;background:linear-gradient(140deg,var(--c1),var(--c2));opacity:.75"></div>
        ${Array.from({ length: 4 }, () => `<div class="mock-line" style="width:${rnd(70, 98)}%;background:rgba(20,22,28,.13)"></div>`).join('')}
      </div>
      <div class="mock-row"><span class="mock-sub">第 1 / ${rnd(3, 24)} 頁</span><span class="mock-sub" style="margin-left:auto">已自動儲存</span></div>
    </div>`;
  },

  stats(app, rnd) {
    const bars = Array.from({ length: 7 }, () => rnd(22, 100));
    return `<div class="mock">
      <div class="grid3" style="grid-template-columns:repeat(3,1fr)">
        ${['本週', '平均', '目標'].map((t) => `<div class="mock-card" style="aspect-ratio:auto;padding:10px;gap:2px"><div class="mock-sub">${t}</div><div style="font-size:19px;font-weight:700">${rnd(12, 96)}</div></div>`).join('')}
      </div>
      <div class="mock-card">
        <div class="mock-sub">近 7 日</div>
        <div class="bars">${bars.map((b) => `<i style="height:${b}%"></i>`).join('')}</div>
        <div class="mock-row" style="justify-content:space-between">${['一', '二', '三', '四', '五', '六', '日'].map((d) => `<span class="mock-sub">${d}</span>`).join('')}</div>
      </div>
      <div class="mock-card"><div class="mock-row"><span class="mock-title">總計</span><span class="mock-title" style="margin-left:auto">${rnd(120, 9800).toLocaleString()}</span></div>${line(72)}</div>
    </div>`;
  },

  map(app, rnd) {
    return `<div class="mock" style="padding:0">
      <div style="position:relative;height:330px;background:linear-gradient(160deg,#1d2b3a,#0f1a24)">
        <svg viewBox="0 0 200 300" style="position:absolute;inset:0;width:100%;height:100%">
          ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 45}" x2="200" y2="${i * 45 + rnd(-14, 14)}" stroke="rgba(255,255,255,.09)" stroke-width="7" />`).join('')}
          ${Array.from({ length: 5 }, (_, i) => `<line x1="${i * 45}" y1="0" x2="${i * 45 + rnd(-14, 14)}" y2="300" stroke="rgba(255,255,255,.07)" stroke-width="6" />`).join('')}
          <path d="M30 270 L 70 180 L 120 150 L 160 60" stroke="var(--c1)" stroke-width="5" fill="none" stroke-linecap="round" />
          <circle cx="30" cy="270" r="7" fill="#fff" />
          <circle cx="160" cy="60" r="8" fill="var(--c1)" stroke="#fff" stroke-width="2.5" />
        </svg>
        <div class="field" style="position:absolute;top:12px;left:12px;right:12px;width:auto;background:rgba(20,22,30,.8);font-size:13px;color:#93a0b6">搜尋地點</div>
      </div>
      <div class="mock-card" style="margin:12px">
        <div class="mock-row"><span class="mock-title">建議路線</span><span class="mock-pill" style="margin-left:auto">${rnd(8, 46)} 分鐘</span></div>
        <div class="mock-sub">${rnd(2, 18)}.${rnd(0, 9)} 公里 · 路況順暢</div>
        <div class="mock-btn">開始導航</div>
      </div>
    </div>`;
  },

  photo(app, rnd) {
    const cell = () => `<div style="background:linear-gradient(${rnd(20, 340)}deg,var(--c1),var(--c2));opacity:${(rnd(60, 100) / 100).toFixed(2)}"></div>`;
    return `<div class="mock">
      <div class="mock-row"><h3 class="mock-title">${esc(app.name)}</h3><span class="mock-sub" style="margin-left:auto">${rnd(120, 4800)} 個項目</span></div>
      <div class="grid3">${Array.from({ length: 12 }, cell).join('')}</div>
      <div class="mock-row" style="gap:6px;flex-wrap:wrap">${['原圖', '鮮豔', '黑白', '柔光', '復古'].map((t) => `<span class="mock-pill">${t}</span>`).join('')}</div>
    </div>`;
  },

  panel(app, rnd) {
    const items = [['連線', true], ['自動同步', true], ['背景執行', false], ['通知', true]];
    return `<div class="mock">
      <div class="mock-card">
        <div class="mock-row"><span class="mock-title">${esc(app.name)}</span><span class="mock-pill" style="margin-left:auto">已連線 ${rnd(2, 9)} 台</span></div>
        <div class="mock-sub">${esc(app.category)} · 最後同步 ${rnd(1, 30)} 分鐘前</div>
      </div>
      ${items.map(([t, on]) => `<div class="mock-card"><div class="toggle-row"><span style="font-size:13.5px">${t}</span><span class="switch ${on ? 'on' : ''}" style="margin-left:auto"></span></div></div>`).join('')}
    </div>`;
  },

  code(app, rnd) {
    return `<div class="mock" style="padding:0">
      <div class="mock-row" style="padding:10px 14px;gap:6px;border-bottom:1px solid rgba(255,255,255,.08)">
        <span class="mock-pill" style="background:linear-gradient(160deg,var(--c1),var(--c2))">main.c</span>
        <span class="mock-pill">omni.h</span>
        <span class="mock-sub" style="margin-left:auto">UTF-8 · LF</span>
      </div>
      <pre class="code"><span class="c">// 由 ${esc(app.en)} 於相容層中開啟</span>
<span class="k">#include</span> <span class="s">&lt;omniui.h&gt;</span>

<span class="k">int</span> <span class="f">main</span>(<span class="k">void</span>) {
  omni_window *w = <span class="f">omni_create</span>(<span class="s">"${esc(app.name)}"</span>);
  <span class="f">omni_bridge_attach</span>(w, BRIDGE_AUTO);
  <span class="k">return</span> <span class="f">omni_run</span>(w);
}</pre>
      <div class="mock-row" style="padding:8px 14px;border-top:1px solid rgba(255,255,255,.08)">
        <span class="mock-sub">第 ${rnd(1, 40)} 行</span><span class="mock-sub" style="margin-left:auto">0 個問題</span>
      </div>
    </div>`;
  },

  game(app, rnd) {
    return `<div class="mock" style="min-height:100%;align-content:center;justify-items:center;text-align:center;background:radial-gradient(120% 70% at 50% 20%,var(--c1),#05070c 70%)">
      <div style="font-size:46px">${app.glyph}</div>
      <h3 style="font-size:22px;letter-spacing:2px">${esc(app.name)}</h3>
      <div class="mock-sub">存檔 ${rnd(1, 3)} · 進度 ${rnd(10, 96)}%</div>
      <div class="mock-btn" style="min-width:170px;margin-top:10px">繼續遊戲</div>
      <div class="mock-pill">新遊戲</div>
      <div class="mock-pill">設定</div>
    </div>`;
  },
};

export function renderMock(app) {
  const rnd = seeded(app.id);
  const build = KIND[app.kind] ?? KIND.panel;
  return `<div style="${tint(app)};min-height:100%">${build(app, rnd)}</div>`;
}

export function runtimeStats(app) {
  const rnd = seeded(app.id + 'r');
  return { nodes: rnd(320, 4200), fps: rnd(56, 60), ram: rnd(48, 420) };
}
