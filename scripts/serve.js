/** 最小静态服务器: node scripts/serve.js [端口] */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.argv[2] ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // 重定向到 /web/ , 让页面里的相对路径(./styles.css)能正确解析
  if (url.pathname === '/' || url.pathname === '/web') {
    res.writeHead(302, { location: '/web/' }).end();
    return;
  }

  const rel = normalize(url.pathname === '/web/' ? '/web/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, rel);

  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
