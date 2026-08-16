/* Formatting + the icon set. Icons are inline SVG paths so the page has zero
   network requests. */

export function formatViews(n) {
  if (n >= 100_000_000) return `${Math.round(n / 100_000_000)} 億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')} 萬`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')} 千`;
  return String(n);
}

export function formatSubs(n) {
  return `${formatViews(n)}位訂閱者`;
}

export function formatAgo(days) {
  if (days === 0) return '今天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 週前`;
  if (days < 365) return `${Math.floor(days / 30)} 個月前`;
  return `${Math.floor(days / 365)} 年前`;
}

export function formatHours(h) {
  if (h < 1) return '剛剛';
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(n) {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}萬`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}千`;
  return String(n);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

const P = {
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  search: 'M20.87 20.17l-5.59-5.59A6.94 6.94 0 0016.8 10a7 7 0 10-7 7 6.94 6.94 0 004.58-1.72l5.59 5.59zM5 10a5 5 0 115 5 5 5 0 01-5-5z',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V22h2v-3.08A7 7 0 0019 12z',
  create: 'M14 13h-3v3H9.5v-3h-3v-1.5h3v-3H11v3h3zm3-6H3v12h14v-6.39l4 1.83V8.56l-4 1.83zm1 4.7l2-.92v4.44l-2-.92zM16 8v10H4V8z',
  bell: 'M10 20h4a2 2 0 01-4 0zm9-2H5v-1l1.5-1.5V11a5.5 5.5 0 014-5.3V5a1.5 1.5 0 013 0v.7a5.5 5.5 0 014 5.3v4.5L19 17z',
  home: 'M4 10.5L12 4l8 6.5V20h-6v-6h-4v6H4z',
  shorts: 'M10 14.65v-5.3L15 12zm7.77-4.33c-.77-.32-1.2-.5-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.5-4.5c1.29-.68 2.06-2.05 1.99-3.5-.07-1.42-.94-2.68-2.23-3.24z',
  subs: 'M10 18v-6l5 3zM17 3H7v1h10zm3 3H4v1h16zm2 3H2v12h20zM3 10h18v10H3z',
  library: 'M4 6H2v14a2 2 0 002 2h14v-2H4zm16-4H8a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm-8 12V6l5.5 4z',
  history: 'M11 7v5.41l3.79 3.8 1.42-1.42L13 11.59V7zm1-5a10 10 0 00-9.95 9H0l4 4 4-4H4.05A8 8 0 1112 20a7.94 7.94 0 01-5.65-2.35l-1.42 1.42A10 10 0 1012 2z',
  clock: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 18a8 8 0 118-8 8 8 0 01-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  like: 'M18.77 11h-4.23l1.52-4.94A1.54 1.54 0 0014.6 4a1.53 1.53 0 00-1.35.8L9 12v9h9.28a1.5 1.5 0 001.48-1.25l1.22-7A1.5 1.5 0 0018.77 11zM7 12H3v9h4z',
  dislike: 'M5.23 13h4.23l-1.52 4.94A1.54 1.54 0 009.4 20a1.53 1.53 0 001.35-.8L15 12V3H5.72a1.5 1.5 0 00-1.48 1.25l-1.22 7A1.5 1.5 0 005.23 13zM17 12h4V3h-4z',
  share: 'M15 5.63L20.66 12 15 18.37V15h-1a9 9 0 00-7.75 4.4A9.53 9.53 0 016 18c0-4.42 3.58-8 8-8h1zM14 8h-.28A10 10 0 004 18a10 10 0 001 4.34l.5 1.06.5-1.06A8 8 0 0114 18.5V22l9-10-9-10z',
  download: 'M17 18v1H6v-1zm-.5-6.6l-.7-.7-3.3 3.29V4h-1v9.99L8.2 10.7l-.7.7 4.5 4.5z',
  more: 'M7.5 12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  next: 'M6 5l8.5 7L6 19zm10 0h2v14h-2z',
  prev: 'M18 19l-8.5-7L18 5zM8 5H6v14h2z',
  volume: 'M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3.23v2.06a7 7 0 010 13.42v2.06a9 9 0 000-17.54z',
  muted: 'M3 9v6h4l5 5V4L7 9zm13.59 3L20 8.59 18.59 7.17 15.17 10.59 11.76 7.17 10.34 8.59 13.76 12l-3.42 3.41 1.42 1.42L15.17 13.4l3.42 3.42L20 15.41z',
  settings: 'M12 8a4 4 0 104 4 4 4 0 00-4-4zm0 6.5a2.5 2.5 0 112.5-2.5 2.5 2.5 0 01-2.5 2.5zm9.43-2.02l-.02-.96 1.72-1.34-1.9-3.3-2.03.8-.83-.48-.3-2.16h-3.8l-.3 2.16-.83.48-2.03-.8-1.9 3.3 1.72 1.34-.02.96-1.72 1.34 1.9 3.3 2.03-.8.83.48.3 2.16h3.8l.3-2.16.83-.48 2.03.8 1.9-3.3z',
  miniplayer: 'M21 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2zm-2 0H5v10h14zm-2 2h-6v5h6z',
  theater: 'M19 6H5a1 1 0 00-1 1v10a1 1 0 001 1h14a1 1 0 001-1V7a1 1 0 00-1-1zm-1 10H6V8h12z',
  fullscreen: 'M10 4H4v6h2V6h4zm4 0h6v6h-2V6h-4zM6 14H4v6h6v-2H6zm14 0h-2v4h-4v2h6z',
  exitFullscreen: 'M10 10H4V8h4V4h2zm4 0h6V8h-4V4h-2zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z',
  moon: 'M12 22a10 10 0 009.54-13.1A8 8 0 1110.9 2.46 10 10 0 1012 22z',
  sun: 'M12 7a5 5 0 105 5 5 5 0 00-5-5zm0 8a3 3 0 113-3 3 3 0 01-3 3zm-1-13h2v3h-2zm0 17h2v3h-2zM2 11h3v2H2zm17 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
  flag: 'M13 4l1 2h6v11h-7l-1-2H6v8H4V4z',
  save: 'M22 13h-4v4h-2v-4h-4v-2h4V7h2v4h4zM14 7H2v1h12zm0 3H2v1h12zM2 14h8v-1H2z',
  trending: 'M3 16l6-6 4 4 8-8v6h2V2h-8v2h6l-8 8-4-4-7 7z',
  gaming: 'M10 12H8v2H6v-2H4v-2h2V8h2v2h2zm4.5 2a1.5 1.5 0 111.5-1.5 1.5 1.5 0 01-1.5 1.5zm3-3a1.5 1.5 0 111.5-1.5 1.5 1.5 0 01-1.5 1.5zM12 5H8a6 6 0 000 12h8a6 6 0 000-12z',
  live: 'M12 8a4 4 0 104 4 4 4 0 00-4-4zm-6.36-.36l-1.42-1.42a9 9 0 000 11.56l1.42-1.42a7 7 0 010-8.72zm12.72 0a7 7 0 010 8.72l1.42 1.42a9 9 0 000-11.56z',
  sort: 'M3 6h18v2H3zm3 5h12v2H6zm3 5h6v2H9z',
};

export function icon(name, size = 24, cls = '') {
  const d = P[name] || P.more;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}
