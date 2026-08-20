/**
 * 把整个应用打包成一个不依赖任何外部文件的 HTML。
 *
 * 为什么要这么做:
 *   Safari(以及 Chrome)在 file:// 下会拒绝 ES 模块的跨文件 import(CORS, origin 为 null),
 *   所以从 Finder / 文件 App 直接双击 web/index.html 会白屏。
 *   把 CSS 和所有 JS 内联进同一个 <script type="module"> 就没有任何跨文件请求了,
 *   双击能开、丢进 iCloud 能开、扔到任何静态服务器上也能开。
 *
 * 产物:
 *   index.html              仓库根目录, 双击可开, 同时也是 GitHub Pages 的首页
 *   sw.js                   根目录的 Service Worker(只在 http(s) 下生效)
 *   manifest.webmanifest    根目录的 PWA 清单
 *   icon.svg                根目录图标
 *   dist/artifact.html      去掉外层 html/head/body 的片段版本
 *
 * 用法: npm run build
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** 去掉 import / export 关键字, 让模块源码能直接拼在一个作用域里 */
function stripModuleSyntax(source) {
  return source
    // import { a, b } from './x.js';  —— 可能跨行
    .replace(/^import\s+[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    // export { a, b } from './x.js';
    .replace(/^export\s*\{[\s\S]*?\}\s*from\s+'[^']+';\s*$/gm, '')
    // export { a, b };
    .replace(/^export\s*\{[\s\S]*?\};\s*$/gm, '')
    // export const / function / class
    .replace(/^export\s+(const|let|var|function|class|async)\b/gm, '$1')
    .trim();
}

const MODULES = ['src/storage.js', 'src/playtime-timer.js', 'src/alarms.js', 'web/app.js'];

const script = MODULES
  .map((path) => `// ${'='.repeat(64)}\n// ${path}\n// ${'='.repeat(64)}\n\n${stripModuleSyntax(read(path))}`)
  .join('\n\n');

const css = read('web/styles.css').trim();
const icon = read('web/icon.svg').trim();
const iconDataUri = `data:image/svg+xml,${encodeURIComponent(icon)}`;

// 从开发版页面里取出 <main> 这一段, 保证两个版本的结构不会走偏
const html = read('web/index.html');
const bodyMatch = html.match(/<main class="app">[\s\S]*?<\/main>/);
if (!bodyMatch) throw new Error('web/index.html 里找不到 <main class="app">');
const body = bodyMatch[0];

const banner = `<!--
  游玩时间系统 —— 单文件版本, 由 npm run build 从 src/ 和 web/ 生成, 不要直接改这个文件。
  不依赖任何外部文件: 双击用 Safari / Chrome 打开即可, 也可以直接作为静态站点首页。
-->`;

// ---------------------------------------------------------------- 单文件页面

const standalone = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#1b1b23" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="游玩时间" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>游玩时间系统</title>
<link rel="icon" href="${iconDataUri}" />
<link rel="apple-touch-icon" href="${iconDataUri}" />
<link rel="manifest" href="./manifest.webmanifest" />
<style>
${css}
</style>
</head>
<body>
${banner}
${body}
<script type="module">
${script}
</script>
</body>
</html>
`;

// -------------------------------------------------------------- 片段版本

const fragment = `<title>游玩时间系统</title>
<style>
${css}
</style>
${banner}
${body}
<script type="module">
${script}
</script>
`;

// ------------------------------------------------------------------ 写出

writeFileSync(join(root, 'index.html'), standalone);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/artifact.html'), fragment);

// 根目录的 Service Worker: 缓存清单换成单文件版的资源
const sw = read('web/sw.js').replace(
  /const SHELL = \[[\s\S]*?\];/,
  "const SHELL = ['./', './index.html', './icon.svg', './manifest.webmanifest'];",
);
writeFileSync(join(root, 'sw.js'), sw);

writeFileSync(join(root, 'manifest.webmanifest'), read('web/manifest.webmanifest'));
writeFileSync(join(root, 'icon.svg'), icon + '\n');

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
console.log(`index.html          ${kb(standalone)}  (双击可开 / GitHub Pages 首页)`);
console.log(`dist/artifact.html  ${kb(fragment)}  (片段版本)`);
console.log(`sw.js / manifest.webmanifest / icon.svg  已同步到根目录`);
