#!/usr/bin/env node
/**
 * 網速檢測儀的本機測速伺服器：提供靜態頁面與三個測速端點。
 * 零外部相依，直接 `node server.js` 即可。
 *
 *   GET  /api/ping                 極小回應，用來量往返延遲
 *   GET  /api/download?bytes=N     串流 N 位元組的隨機資料
 *   POST /api/upload               接收並丟棄上傳內容，回報收到的位元組數
 */
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { randomFillSync } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const BLOCK = 1024 * 1024;

// 事先產生一塊隨機資料重複送出：內容隨機可避免被壓縮而虛報速度，
// 只產生一次則避免測速時 CPU 成為瓶頸。
const BLOCK_BUFFER = randomFillSync(Buffer.allocUnsafe(BLOCK));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Timing-Allow-Origin': '*',
};

/** 串流指定位元組數，並處理背壓，避免整塊塞進記憶體。 */
function streamBytes(res, total) {
  let remaining = total;

  const pump = () => {
    while (remaining > 0) {
      const size = Math.min(BLOCK, remaining);
      const chunk = size === BLOCK ? BLOCK_BUFFER : BLOCK_BUFFER.subarray(0, size);
      remaining -= size;
      if (!res.write(chunk)) {
        res.once('drain', pump);
        return;
      }
    }
    res.end();
  };

  res.on('close', () => { remaining = 0; });
  pump();
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  const target = normalize(join(ROOT, relative));

  // 擋掉 ../ 這類跳出根目錄的路徑。
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }

  if (pathname === '/api/ping') {
    res.writeHead(204, { ...cors, ...noCache }).end();
    return;
  }

  if (pathname === '/api/download') {
    const requested = Number(url.searchParams.get('bytes') ?? BLOCK);
    const bytes = Number.isFinite(requested)
      ? Math.min(Math.max(0, Math.floor(requested)), MAX_DOWNLOAD_BYTES)
      : BLOCK;
    res.writeHead(200, {
      ...cors,
      ...noCache,
      'Content-Type': 'application/octet-stream',
      'Content-Length': bytes,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    streamBytes(res, bytes);
    return;
  }

  if (pathname === '/api/upload') {
    if (req.method !== 'POST') {
      res.writeHead(405, cors).end('Method Not Allowed');
      return;
    }
    let received = 0;
    req.on('data', (chunk) => { received += chunk.length; });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      res.writeHead(200, { ...cors, ...noCache, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ bytes: received }));
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const addresses = [`http://localhost:${PORT}`];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${PORT}`);
    }
  }
  console.log('網速檢測儀已啟動：');
  for (const address of addresses) console.log(`  ${address}`);
  console.log('\n按 Ctrl+C 結束。');
});
