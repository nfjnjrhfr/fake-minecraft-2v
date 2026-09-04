import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Db, rootDir } from './db.js';
import { userFromToken } from './auth.js';
import { HttpError, routes } from './api.js';
import { seed } from './seed.js';

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
        const value = Number(parts[i]);
        if (!Number.isInteger(value)) {
          ok = false;
          break;
        }
        params[pattern[i].slice(1)] = value;
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
    if (size > 1_000_000) throw new HttpError(413, '请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON');
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
  // 防止路径穿越（../../etc/passwd）
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 页面不存在');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

export function createApp(db = new Db()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: '方法不被允许' });
        return;
      }
      serveStatic(req, res, pathname);
      return;
    }

    try {
      const match = matchRoute(req.method, pathname);
      if (!match) throw new HttpError(404, '接口不存在');

      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJsonBody(req);

      const result = match.route.handler({
        db,
        token,
        user: userFromToken(db, token),
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
      console.error('[server] 未处理的错误:', err);
      sendJson(res, 500, { error: '服务器内部错误' });
    }
  });
  server.db = db;
  return server;
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  const db = new Db();
  seed(db);
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => {
    console.log(`电子产品作业系统已启动: http://localhost:${port}`);
  });
}
