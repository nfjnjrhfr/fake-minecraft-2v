/* Router + views. Hash-based so the whole thing works from file:// too. */

import { ALL, VIDEO_MAP, CHANNELS, CATEGORIES, commentsFor } from './data.js';
import { drawThumbnail, drawScene } from './scene.js';
import { peakTime } from './beats.js';
import { Player } from './player.js';
import {
  el, icon, formatViews, formatSubs, formatAgo, formatHours, formatDuration, formatCount, debounce,
} from './util.js';

const view = document.getElementById('view');
const state = {
  player: null,
  theater: false,
  category: '全部',
  subs: new Set(JSON.parse(localStorage.getItem('mt:subs') || '[]')),
  likes: JSON.parse(localStorage.getItem('mt:likes') || '{}'),
  saved: new Set(JSON.parse(localStorage.getItem('mt:saved') || '[]')),
  history: JSON.parse(localStorage.getItem('mt:history') || '[]'),
};

function persist() {
  localStorage.setItem('mt:subs', JSON.stringify([...state.subs]));
  localStorage.setItem('mt:likes', JSON.stringify(state.likes));
  localStorage.setItem('mt:saved', JSON.stringify([...state.saved]));
  localStorage.setItem('mt:history', JSON.stringify(state.history.slice(0, 30)));
}

/* ------------------------------------------------------------------ chrome */

function initChrome() {
  // Static chrome declares which glyph it wants; the SVG is injected here so
  // the markup stays readable.
  document.querySelectorAll('[data-icon]').forEach((n) => {
    n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon, Number(n.dataset.iconSize) || 24));
  });

  document.getElementById('menu-btn').addEventListener('click', toggleSidebar);
  document.getElementById('logo').addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '#/';
  });

  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const suggestBox = document.getElementById('suggestions');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    suggestBox.hidden = true;
    input.blur();
    location.hash = q ? `#/results/${encodeURIComponent(q)}` : '#/';
  });

  const suggest = debounce(() => {
    const q = input.value.trim().toLowerCase();
    if (!q) { suggestBox.hidden = true; return; }
    const hits = ALL
      .filter((v) => v.title.toLowerCase().includes(q) || v.channelObj.name.toLowerCase().includes(q))
      .slice(0, 8);
    if (!hits.length) { suggestBox.hidden = true; return; }
    suggestBox.innerHTML = '';
    hits.forEach((v) => {
      suggestBox.append(el('button', {
        class: 'suggestion',
        type: 'button',
        html: `${icon('search', 20)}<span>${v.title}</span>`,
        onclick: () => {
          input.value = v.title;
          suggestBox.hidden = true;
          location.hash = `#/watch/${v.id}`;
        },
      }));
    });
    suggestBox.hidden = false;
  }, 90);

  input.addEventListener('input', suggest);
  input.addEventListener('focus', suggest);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) suggestBox.hidden = true;
  });

  document.getElementById('theme-btn').addEventListener('click', () => {
    const dark = !document.documentElement.classList.contains('light');
    document.documentElement.classList.toggle('light', dark);
    localStorage.setItem('mt:theme', dark ? 'light' : 'dark');
    document.getElementById('theme-btn').innerHTML = icon(dark ? 'sun' : 'moon');
  });

  document.getElementById('scrim').addEventListener('click', () => {
    document.body.classList.remove('drawer-open');
  });

  buildSidebar();
}

function toggleSidebar() {
  if (window.innerWidth < 1000 || document.body.classList.contains('watch-mode')) {
    document.body.classList.toggle('drawer-open');
  } else {
    document.body.classList.toggle('rail');
  }
}

function buildSidebar() {
  const nav = document.getElementById('sidebar');
  const main = [
    ['home', '首頁', '#/'],
    ['shorts', 'Shorts', '#/results/搞笑'],
    ['subs', '訂閱內容', '#/subscriptions'],
  ];
  const you = [
    ['library', '你的媒體庫', '#/library'],
    ['history', '觀看紀錄', '#/history'],
    ['clock', '稍後觀看', '#/library'],
    ['like', '喜歡的影片', '#/library'],
  ];
  const explore = [
    ['trending', '發燒影片', '#/results/紅石'],
    ['gaming', '遊戲', '#/results/遊戲'],
    ['live', '直播', '#/results/直播中'],
  ];

  const section = (items, title) => el('div', { class: 'side-section' }, [
    title ? el('h3', { class: 'side-title', text: title }) : null,
    ...items.map(([ic, label, href]) => el('a', {
      class: 'side-link',
      href,
      html: `${icon(ic)}<span>${label}</span>`,
    })),
  ]);

  nav.append(section(main));
  nav.append(section(you, '你'));
  nav.append(section(explore, '探索'));

  const subsSection = el('div', { class: 'side-section' }, [
    el('h3', { class: 'side-title', text: '訂閱內容' }),
    ...Object.values(CHANNELS).map((c) => el('a', {
      class: 'side-link',
      href: `#/channel/${c.id}`,
      html: `<span class="avatar tiny" style="--c:${c.color}">${c.name[0]}</span><span>${c.name}</span>`,
    })),
  ]);
  nav.append(subsSection);
  nav.append(el('div', { class: 'side-foot' }, [
    el('p', { text: '關於  新聞  版權  聯絡我們' }),
    el('p', { text: '條款  隱私權  政策與安全' }),
    el('p', { class: 'side-copy', text: '© 2026 MineTube — 全部內容皆為虛構示範' }),
  ]));
}

/* ------------------------------------------------------------------- cards */

/* Thumbnails paint on demand and only start animating on hover, so a grid of
   24 canvases doesn't melt the CPU. */
function thumbCanvas(video, w = 336, h = 189) {
  const canvas = el('canvas', { class: 'thumb-canvas', width: w * 2, height: h * 2 });
  requestAnimationFrame(() => drawThumbnail(canvas, { ...video, seed: video.seed }));
  return canvas;
}

function attachHoverPreview(card, canvas, video) {
  let raf = 0;
  let t0 = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    drawThumbnail(canvas, video);
    card.classList.remove('previewing');
  };
  card.addEventListener('pointerenter', () => {
    if (raf) return;
    card.classList.add('previewing');
    t0 = performance.now();
    // start a few seconds before the headline moment, so the preview shows the
    // build-up and then the thing itself
    const from = Math.max(0, peakTime(video) - 3.5);
    const step = (now) => {
      const t = from + (now - t0) / 1000;
      drawScene(canvas.getContext('2d'), canvas.width, canvas.height, t, video.seed, video.style, { video });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  card.addEventListener('pointerleave', stop);
}

function videoCard(video, variant = 'grid') {
  const c = video.channelObj;
  const canvas = thumbCanvas(video, variant === 'list' ? 360 : 336, variant === 'list' ? 202 : 189);
  const stats = el('div', {
    class: 'card-sub',
    text: `${formatViews(video.views)}${video.live ? '人正在觀看' : '次觀看'}・${video.live ? '' : formatAgo(video.days)}`,
  });
  const channelLine = el('div', { class: 'card-sub card-channel-line' }, [
    // The grid card puts the avatar beside the whole block; the list card
    // tucks a small one next to the channel name, like search results do.
    variant === 'list' ? el('span', { class: 'avatar tiny', style: `--c:${c.color}`, text: c.name[0] }) : null,
    el('span', {
      class: 'card-channel',
      html: `${c.name}${c.verified ? `<span class="verified">${icon('check', 12)}</span>` : ''}`,
    }),
  ]);

  const card = el('a', { class: `card card-${variant}`, href: `#/watch/${video.id}` }, [
    el('div', { class: 'thumb' }, [
      canvas,
      el('span', {
        class: `badge ${video.live ? 'badge-live' : ''}`,
        text: video.live ? '直播中' : formatDuration(video.duration),
      }),
      el('span', { class: 'thumb-progress' }),
    ]),
    el('div', { class: 'card-body' }, [
      variant === 'grid'
        ? el('span', { class: 'avatar', style: `--c:${c.color}`, text: c.name[0] })
        : null,
      el('div', { class: 'card-meta' }, [
        el('h3', { class: 'card-title', text: video.title }),
        ...(variant === 'list'
          ? [stats, channelLine, el('p', { class: 'card-desc', text: video.desc?.split('\n')[0] || '' })]
          : [channelLine, stats]),
      ]),
      el('button', {
        class: 'card-more',
        'aria-label': '更多選項',
        html: icon('more', 20),
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); toast('已加入「稍後觀看」'); },
      }),
    ]),
  ]);
  attachHoverPreview(card, canvas, video);
  return card;
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { id: 'toast', class: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._id);
  toast._id = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ------------------------------------------------------------------- views */

function renderHome(filterCategory) {
  document.body.classList.remove('watch-mode');
  state.category = filterCategory || state.category;

  const chips = el('div', { class: 'chips' },
    CATEGORIES.map((cat) => el('button', {
      class: `chip ${cat === state.category ? 'active' : ''}`,
      text: cat,
      onclick: () => renderHome(cat),
    })));

  const list = state.category === '全部'
    ? ALL
    : ALL.filter((v) => (v.tags || []).includes(state.category));

  view.innerHTML = '';
  view.append(chips);
  view.append(el('div', { class: 'grid' },
    list.length ? list.map((v) => videoCard(v)) : [emptyState('這個分類還沒有影片')]));
}

function emptyState(msg) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-icon', html: icon('shorts', 48) }),
    el('p', { text: msg }),
  ]);
}

function renderResults(query) {
  document.body.classList.remove('watch-mode');
  const q = query.toLowerCase();
  const hits = ALL.filter((v) =>
    v.title.toLowerCase().includes(q) ||
    v.channelObj.name.toLowerCase().includes(q) ||
    (v.tags || []).some((t) => t.toLowerCase().includes(q)));

  view.innerHTML = '';
  view.append(el('div', { class: 'results-head' }, [
    el('button', { class: 'filter-btn', html: `${icon('sort', 20)}<span>篩選器</span>` }),
    el('span', { class: 'results-count', text: `約 ${hits.length} 個結果` }),
  ]));
  view.append(el('div', { class: 'results' },
    hits.length ? hits.map((v) => videoCard(v, 'list')) : [emptyState(`找不到「${query}」的結果`)]));
}

function renderChannel(id) {
  document.body.classList.remove('watch-mode');
  const c = CHANNELS[id];
  if (!c) return renderHome();
  const vids = ALL.filter((v) => v.channel === id);
  const subbed = state.subs.has(id);

  view.innerHTML = '';
  view.append(el('div', { class: 'channel' }, [
    el('div', { class: 'channel-banner', style: `--c:${c.color}` }),
    el('div', { class: 'channel-head' }, [
      el('span', { class: 'avatar xl', style: `--c:${c.color}`, text: c.name[0] }),
      el('div', { class: 'channel-info' }, [
        el('h1', { text: c.name }),
        el('div', { class: 'channel-sub', text: `${c.handle}・${formatSubs(c.subs)}・${vids.length} 部影片` }),
        el('p', { class: 'channel-desc', text: '每週更新方塊世界的各種實驗與挑戰。' }),
      ]),
      el('button', {
        class: `subscribe ${subbed ? 'subscribed' : ''}`,
        text: subbed ? '已訂閱' : '訂閱',
        onclick: (e) => {
          const on = state.subs.has(id);
          on ? state.subs.delete(id) : state.subs.add(id);
          persist();
          e.target.textContent = on ? '訂閱' : '已訂閱';
          e.target.classList.toggle('subscribed', !on);
          toast(on ? `已取消訂閱 ${c.name}` : `已訂閱 ${c.name}`);
        },
      }),
    ]),
    el('div', { class: 'channel-tabs' }, ['影片', '播放清單', '社群', '關於'].map((t, i) =>
      el('button', { class: `channel-tab ${i === 0 ? 'active' : ''}`, text: t }))),
  ]));
  view.append(el('div', { class: 'grid' }, vids.map((v) => videoCard(v))));
}

function renderCollection(title, list, emptyMsg) {
  document.body.classList.remove('watch-mode');
  view.innerHTML = '';
  view.append(el('h1', { class: 'page-title', text: title }));
  view.append(el('div', { class: 'grid' },
    list.length ? list.map((v) => videoCard(v)) : [emptyState(emptyMsg)]));
}

/* ------------------------------------------------------------------- watch */

function renderWatch(id) {
  const video = VIDEO_MAP[id];
  if (!video) return renderHome();
  document.body.classList.add('watch-mode');
  document.body.classList.remove('drawer-open');

  state.history = [id, ...state.history.filter((h) => h !== id)];
  persist();

  const c = video.channelObj;
  const related = ALL.filter((v) => v.id !== id)
    .sort((a, b) => {
      const sa = (a.channel === video.channel ? 2 : 0) + (a.tags || []).filter((t) => (video.tags || []).includes(t)).length;
      const sb = (b.channel === video.channel ? 2 : 0) + (b.tags || []).filter((t) => (video.tags || []).includes(t)).length;
      return sb - sa;
    });

  const playerBox = el('div', { class: 'player-box' });
  const liked = state.likes[id];

  const likeBtn = el('button', {
    class: `pill-btn ${liked === 1 ? 'on' : ''}`,
    html: `${icon('like', 22)}<span>${formatCount(video.likes + (liked === 1 ? 1 : 0))}</span>`,
  });
  const dislikeBtn = el('button', {
    class: `pill-btn ${liked === -1 ? 'on' : ''}`,
    html: `${icon('dislike', 22)}`,
    'aria-label': '不喜歡',
  });
  likeBtn.addEventListener('click', () => {
    state.likes[id] = liked === 1 ? 0 : 1;
    persist();
    renderWatch(id);
    toast(state.likes[id] === 1 ? '已加入「喜歡的影片」' : '已移除');
  });
  dislikeBtn.addEventListener('click', () => {
    state.likes[id] = liked === -1 ? 0 : -1;
    persist();
    renderWatch(id);
  });

  const subbed = state.subs.has(video.channel);
  const saved = state.saved.has(id);

  const descBox = el('div', { class: 'desc' }, [
    el('div', { class: 'desc-head', text: `${formatViews(video.views)}次觀看・${formatAgo(video.days)}` }),
    el('div', { class: 'desc-body', text: video.desc || '' }),
    el('button', {
      class: 'desc-toggle',
      text: '顯示更多',
      onclick: (e) => {
        const open = descBox.classList.toggle('open');
        e.target.textContent = open ? '顯示較少' : '顯示更多';
      },
    }),
  ]);

  const comments = commentsFor(id, 8);
  const commentList = el('div', { class: 'comment-list' }, comments.map(renderComment));

  const commentInput = el('div', { class: 'comment-add' }, [
    el('span', { class: 'avatar', style: '--c:#7a5cff', text: '你' }),
    el('div', { class: 'comment-add-body' }, [
      el('input', { class: 'comment-input', placeholder: '新增留言…', 'aria-label': '新增留言' }),
      el('div', { class: 'comment-actions' }, [
        el('button', { class: 'text-btn', text: '取消', onclick: (e) => { e.target.closest('.comment-add').querySelector('input').value = ''; } }),
        el('button', {
          class: 'primary-btn',
          text: '留言',
          onclick: (e) => {
            const input = e.target.closest('.comment-add').querySelector('input');
            const text = input.value.trim();
            if (!text) return;
            commentList.prepend(renderComment({ author: '你', text, likes: 0, hours: 0, replies: 0, color: '#7a5cff' }));
            input.value = '';
            toast('留言已發布');
          },
        }),
      ]),
    ]),
  ]);

  view.innerHTML = '';
  const primary = el('div', { class: 'watch-primary' }, [
    playerBox,
    el('h1', { class: 'watch-title', text: video.title }),
    el('div', { class: 'watch-actions' }, [
      el('a', { class: 'channel-row', href: `#/channel/${c.id}` }, [
        el('span', { class: 'avatar lg', style: `--c:${c.color}`, text: c.name[0] }),
        el('div', {}, [
          el('div', {
            class: 'channel-name',
            html: `${c.name}${c.verified ? `<span class="verified">${icon('check', 12)}</span>` : ''}`,
          }),
          el('div', { class: 'channel-subs', text: formatSubs(c.subs) }),
        ]),
      ]),
      el('button', {
        class: `subscribe ${subbed ? 'subscribed' : ''}`,
        text: subbed ? '已訂閱' : '訂閱',
        onclick: (e) => {
          const on = state.subs.has(video.channel);
          on ? state.subs.delete(video.channel) : state.subs.add(video.channel);
          persist();
          e.target.textContent = on ? '訂閱' : '已訂閱';
          e.target.classList.toggle('subscribed', !on);
        },
      }),
      el('div', { class: 'action-row' }, [
        el('div', { class: 'pill-group' }, [likeBtn, dislikeBtn]),
        el('button', { class: 'pill-btn', html: `${icon('share', 22)}<span>分享</span>`, onclick: () => toast('連結已複製到剪貼簿') }),
        el('button', { class: 'pill-btn', html: `${icon('download', 22)}<span>下載</span>`, onclick: () => toast('離線下載需要 Premium') }),
        el('button', {
          class: `pill-btn ${saved ? 'on' : ''}`,
          html: `${icon('save', 22)}<span>儲存</span>`,
          onclick: (e) => {
            const on = state.saved.has(id);
            on ? state.saved.delete(id) : state.saved.add(id);
            persist();
            e.currentTarget.classList.toggle('on', !on);
            toast(on ? '已從播放清單移除' : '已儲存到播放清單');
          },
        }),
        el('button', { class: 'pill-btn icon-only', html: icon('more', 22), 'aria-label': '更多' }),
      ]),
    ]),
    descBox,
    el('div', { class: 'comments' }, [
      el('div', { class: 'comments-head' }, [
        el('h2', { text: `${comments.length * 137} 則留言` }),
        el('button', { class: 'text-btn', html: `${icon('sort', 20)}<span>排序依據</span>` }),
      ]),
      commentInput,
      commentList,
    ]),
  ]);

  const upNextToggle = el('label', { class: 'autoplay' }, [
    el('span', { text: '自動播放' }),
    el('span', { class: 'switch' }, [el('input', { type: 'checkbox', checked: true }), el('span', { class: 'knob' })]),
  ]);

  const secondary = el('div', { class: 'watch-secondary' }, [
    el('div', { class: 'up-next-head' }, [el('span', { text: '接下來播放' }), upNextToggle]),
    ...related.map((v) => videoCard(v, 'compact')),
  ]);

  view.append(el('div', { class: 'watch' }, [primary, secondary]));

  state.player?.destroy();
  state.player = new Player(playerBox, video, {
    theater: state.theater,
    onTheater: (on) => {
      state.theater = on;
      document.body.classList.toggle('theater', on);
    },
    onEnded: () => {
      const auto = upNextToggle.querySelector('input').checked;
      if (auto && related[0]) location.hash = `#/watch/${related[0].id}`;
    },
  });
  document.body.classList.toggle('theater', state.theater);
  window.scrollTo(0, 0);
}

function renderComment(cm) {
  const likeBtn = el('button', {
    class: 'cm-btn',
    html: `${icon('like', 18)}<span>${cm.likes ? formatCount(cm.likes) : ''}</span>`,
  });
  likeBtn.addEventListener('click', () => {
    const on = likeBtn.classList.toggle('on');
    likeBtn.querySelector('span').textContent = formatCount(cm.likes + (on ? 1 : 0));
  });
  return el('div', { class: 'comment' }, [
    el('span', { class: 'avatar', style: `--c:${cm.color}`, text: cm.author[0] }),
    el('div', { class: 'comment-body' }, [
      el('div', { class: 'comment-head' }, [
        el('span', { class: 'cm-author', text: cm.author }),
        el('span', { class: 'cm-time', text: formatHours(cm.hours) }),
      ]),
      el('p', { class: 'cm-text', text: cm.text }),
      el('div', { class: 'cm-actions' }, [
        likeBtn,
        el('button', { class: 'cm-btn', html: icon('dislike', 18), 'aria-label': '不喜歡' }),
        el('button', { class: 'cm-btn text', text: '回覆' }),
      ]),
      cm.replies
        ? el('button', { class: 'cm-replies', text: `▾ ${cm.replies} 則回覆`, onclick: (e) => { e.target.textContent = `▾ ${cm.replies} 則回覆`; toast('回覆已收合'); } })
        : null,
    ]),
  ]);
}

/* ------------------------------------------------------------------ router */

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest.join('/') || '');

  if (head !== 'watch') {
    state.player?.destroy();
    state.player = null;
    document.body.classList.remove('theater');
  }

  switch (head) {
    case 'watch': return renderWatch(arg);
    case 'results': return renderResults(arg);
    case 'channel': return renderChannel(arg);
    case 'history':
      return renderCollection('觀看紀錄', state.history.map((h) => VIDEO_MAP[h]).filter(Boolean), '還沒有觀看紀錄');
    case 'library':
      return renderCollection('你的媒體庫', [...state.saved].map((s) => VIDEO_MAP[s]).filter(Boolean), '媒體庫是空的，去首頁儲存幾部影片吧');
    case 'subscriptions':
      return renderCollection('訂閱內容', ALL.filter((v) => state.subs.has(v.channel)), '你還沒有訂閱任何頻道');
    default: return renderHome();
  }
}

/* -------------------------------------------------------------------- boot */

// Saved choice wins; otherwise follow the host page / OS preference, falling
// back to dark the way a video site normally does.
const savedTheme = localStorage.getItem('mt:theme');
const hostTheme = document.documentElement.dataset.theme;
const prefersLight = hostTheme
  ? hostTheme === 'light'
  : window.matchMedia?.('(prefers-color-scheme: light)').matches;
if (savedTheme ? savedTheme === 'light' : prefersLight) {
  document.documentElement.classList.add('light');
}
document.getElementById('theme-btn').innerHTML =
  icon(document.documentElement.classList.contains('light') ? 'sun' : 'moon');

initChrome();
window.addEventListener('hashchange', route);
route();
