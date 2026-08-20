#!/usr/bin/env node
/**
 * 把 index.html + CSS + 所有 ES 模組打包成單一 HTML 檔。
 *
 *   node build.js
 *
 * 產出：
 *   dist/speedtest.html  完整單檔，直接用瀏覽器開或丟到任何靜態主機都能用
 *   dist/artifact.html   同樣內容，但去掉 <html>/<head>/<body> 外殼，
 *                        供會自行包上外殼的發布平台使用
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// 相依順序：被 import 的排前面
const MODULES = ['src/config.js', 'src/speedtest.js', 'src/gauge.js', 'src/chart.js', 'src/main.js'];

/** 拿掉模組語法，讓多個檔案可以直接串成同一個 script。 */
const flatten = (code) => code
  .replace(/^import[\s\S]*?from\s*'[^']*';\s*$/gm, '')
  .replace(/^export\s+(?=(const|function|async|class|let))/gm, '')
  .trim();

const bundleJs = MODULES
  .map((file) => `/* ── ${file} ───────────────────────────── */\n${flatten(read(file))}`)
  .join('\n\n');

const css = read('assets/styles.css').trim();
let html = read('index.html');

// 用 replacer 函式而不是字串：內嵌的程式碼裡有 `$` 開頭的樣板語法，
// 直接當替換字串會被 String.replace 當成特殊符號解讀。
html = html.replace(
  /^\s*<link rel="stylesheet" href="assets\/styles\.css">\s*$/m,
  () => `<style>\n${css}\n</style>`,
);
html = html.replace(
  /^\s*<script type="module" src="src\/main\.js"><\/script>\s*$/m,
  () => `<script type="module">\n${bundleJs}\n</script>`,
);

// 檢查標籤本身，不是檔名字串——打包後的程式碼裡有以檔名標示區塊的註解。
if (/<link[^>]+stylesheet/.test(html) || /<script[^>]+\bsrc=/.test(html)) {
  throw new Error('打包失敗：仍有沒有內嵌的外部檔案');
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/speedtest.html'), html);

// 發布平台版：只留 <title> 與 body 內容，外殼由平台補上。
const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].trim();
writeFileSync(join(ROOT, 'dist/artifact.html'), `<title>${title}</title>\n${style}\n${body}\n`);

const kb = (file) => (readFileSync(join(ROOT, file)).length / 1024).toFixed(1);
console.log(`dist/speedtest.html  ${kb('dist/speedtest.html')} KB`);
console.log(`dist/artifact.html   ${kb('dist/artifact.html')} KB`);
