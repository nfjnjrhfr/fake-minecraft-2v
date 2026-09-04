import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * 瀏覽引擎：伺服端代抓網頁，抽成可閱讀的區塊後交給前端渲染（reader 模式）。
 *
 * 裝置本身沒有排版引擎，網頁不是在前端直接執行的 —— 這一層負責把 HTML
 * 變成 OmniUI 畫得出來的區塊，順便擋掉會打到內網的網址。
 */

export class BrowseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 3;
const MAX_BLOCKS = 400;
const SCAN_LIMIT = 900; // 先多收一些，濾掉導覽之後再截到 MAX_BLOCKS

/** 使用者在網址列打的東西 → 正規化的 URL */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new BrowseError('empty', '請輸入網址');

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new BrowseError('invalid', `看不懂這個網址：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowseError('scheme', `瀏覽器只支援 http 與 https，不支援 ${url.protocol.replace(':', '')}`);
  }
  if (!url.hostname) throw new BrowseError('invalid', '網址缺少主機名稱');
  url.hash = '';
  return url;
}

/** URL.hostname 對 IPv6 會保留方括號，判斷位址前要先脫掉 */
export const bareHost = (hostname) => String(hostname).replace(/^\[|\]$/g, '');

/** 內網、迴環、連線本地位址一律擋掉，避免瀏覽器變成打內網的跳板 */
export function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (version === 6) {
    const v = ip.toLowerCase().split('%')[0];
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    // ::ffff:127.0.0.1 這類 IPv4 對映位址
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // 認不出來就當成不安全
}

export async function assertPublicHost(rawHost, lookup = dns.lookup) {
  const hostname = bareHost(rawHost);
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new BrowseError('blocked', `不允許瀏覽內部位址：${hostname}`);
    return;
  }
  let records;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new BrowseError('dns', `找不到主機：${hostname}`);
  }
  if (!records.length) throw new BrowseError('dns', `找不到主機：${hostname}`);
  if (records.some((r) => isPrivateAddress(r.address))) {
    throw new BrowseError('blocked', `不允許瀏覽指向內部網路的網址：${hostname}`);
  }
}

/* ---------------- HTML → 可閱讀區塊 ---------------- */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', times: '×',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** 把一段區塊 HTML 拆成純文字與連結交錯的片段，讓內文裡的連結可以點 */
function inlineRuns(html, base) {
  const runs = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let last = 0;
  let m;
  const push = (text, href) => {
    const clean = stripTags(text);
    if (clean) runs.push(href ? { text: clean, href } : { text: clean });
  };
  while ((m = re.exec(html)) !== null) {
    push(html.slice(last, m.index));
    const hrefMatch = m[1].match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4]) : '';
    let href = null;
    try {
      const resolved = new URL(decodeEntities(raw), base);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') href = resolved.href;
    } catch { /* 相對路徑解不出來就當成純文字 */ }
    push(m[2], href);
    last = re.lastIndex;
  }
  push(html.slice(last));
  return runs;
}

const BLOCK_RE = /<(h1|h2|h3|h4|h5|h6|p|li|blockquote|pre|dd|dt|figcaption|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;

export function extract(html, baseUrl) {
  const source = String(html);
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  // 拿掉不該出現在內文的東西
  let body = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|form|select)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // 只看 <body>，避免 <head> 裡的東西混進內文
  const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) body = bodyMatch[1];

  // 有 main / article 就只取那一塊，雜訊少很多
  const main = body.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && stripTags(main[2]).length > 200) body = main[2];

  let blocks = [];
  const seen = new Set();
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(body)) !== null && blocks.length < SCAN_LIMIT) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    // 巢狀容器交給裡層處理：從開頭標籤之後重新掃描，否則同名標籤巢狀時內層會被外層吃掉
    if (/<(p|li|h1|h2|h3|h4|h5|h6|blockquote|table|td)\b/i.test(inner)) {
      BLOCK_RE.lastIndex = m.index + m[0].indexOf('>') + 1;
      continue;
    }
    const runs = inlineRuns(inner, baseUrl);
    const text = runs.map((r) => r.text).join(' ').trim();
    if (!text || text.length < 2) continue;
    const key = `${tag}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ type: tag === 'pre' ? 'pre' : tag === 'td' || tag === 'dd' || tag === 'dt' ? 'p' : tag, runs });
  }

  blocks = dropLeadingNav(blocks).slice(0, MAX_BLOCKS);

  // 整頁都抓不到區塊時（例如整站都用 div 排版），退回純文字
  if (!blocks.length) {
    const text = stripTags(body).slice(0, 4000);
    if (text) blocks.push({ type: 'p', runs: [{ text }] });
  }
  return { title, blocks };
}

const blockText = (block) => block.runs.reduce((n, run) => n + run.text.length, 0);

/**
 * 正文第一段之前的一長串「純連結項目」是導覽（側欄、語言列表、選單），濾掉。
 * 只動第一段以前的部分，所以文末的「參見」之類的連結清單不會被誤刪。
 */
function dropLeadingNav(blocks) {
  const firstParagraph = blocks.findIndex((b) => b.type === 'p' && blockText(b) >= 120);
  if (firstParagraph <= 0) return blocks;

  const isNavItem = (b) =>
    (b.type === 'li' || b.type === 'p') && b.runs.length === 1 && Boolean(b.runs[0].href) && b.runs[0].text.length < 40;

  const head = blocks.slice(0, firstParagraph);
  if (head.filter(isNavItem).length < 5) return blocks;
  return [...head.filter((b) => !isNavItem(b)), ...blocks.slice(firstParagraph)];
}

/* ---------------- 抓取 ---------------- */

async function readCapped(res) {
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml|text\/plain|application\/xml|text\/xml/i.test(type)) {
    throw new BrowseError('type', `這個網址不是網頁（${type.split(';')[0] || '未知類型'}），瀏覽器沒辦法顯示`);
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new BrowseError('too-big', '網頁太大了（超過 2 MB），沒有載入');
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) throw new BrowseError('too-big', '網頁太大了（超過 2 MB），沒有載入');
  const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

export async function fetchPage(input, options = {}) {
  const { fetchImpl = globalThis.fetch, lookup = dns.lookup } = options;
  let url = normalizeUrl(input);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url.hostname, lookup);

    let res;
    try {
      res = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (TideOS 1.0; OmniWeb) OmniUI/1.0',
        },
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new BrowseError(
        timedOut ? 'timeout' : 'network',
        timedOut ? '連線逾時，這個網站沒有在時間內回應' : `連不上這個網站：${url.hostname}`,
      );
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop === MAX_REDIRECTS) throw new BrowseError('redirect', '轉址次數太多，停止載入');
      try {
        url = normalizeUrl(new URL(res.headers.get('location'), url).href);
      } catch (err) {
        throw err instanceof BrowseError ? err : new BrowseError('redirect', '轉址目標無法解析');
      }
      continue;
    }

    if (res.status >= 400) {
      throw new BrowseError('http', `網站回應 ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    }

    const html = await readCapped(res);
    const { title, blocks } = extract(html, url.href);
    return {
      url: url.href,
      host: url.hostname,
      title: title || url.hostname,
      blocks,
      secure: url.protocol === 'https:',
      bytes: html.length,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new BrowseError('redirect', '轉址次數太多，停止載入');
}
