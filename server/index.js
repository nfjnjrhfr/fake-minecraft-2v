import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Db, rootDir } from './db.js';
import { HttpError, defaultState, routes } from './api.js';

const PUBLIC_DIR = path.join(rootDir, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern[i].startsWith(':')) {
        params[pattern[i].slice(1)] = parts[i];
      } else if (pattern[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, '請求內容過大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '請求內容不是合法的 JSON');
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, relative);
  // 防止路徑穿越（../../etc/passwd）
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 找不到頁面');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

export function createApp(db = new Db(undefined, defaultState)) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: '方法不被允許' });
        return;
      }
      serveStatic(req, res, pathname);
      return;
    }

    try {
      const match = matchRoute(req.method, pathname);
      if (!match) throw new HttpError(404, '介面不存在');

      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJsonBody(req);

      const result = await match.route.handler({
        db,
        params: match.params,
        query: Object.fromEntries(url.searchParams),
        body,
      });
      sendJson(res, result.status, result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error('[server] 未處理的錯誤:', err);
      sendJson(res, 500, { error: '伺服器內部錯誤' });
    }
  });
  server.db = db;
  return server;
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  const db = new Db(undefined, defaultState);
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => {
    console.log(`潮汐 OS 模擬器已啟動：http://localhost:${port}`);
  });
}
