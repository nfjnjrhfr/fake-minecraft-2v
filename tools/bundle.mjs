/* Inlines the CSS and the ES modules into a single self-contained HTML file.
   Run: node tools/bundle.mjs
   Outputs:
     dist/minetube.html   — full standalone page (opens straight from disk)
     dist/artifact.html   — same page without the document wrapper, for hosts
                            that supply their own <html>/<head>/<body>
   The modules have no circular imports, so "bundling" is just concatenating
   them in dependency order and dropping the import/export keywords. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const ORDER = ['rng.js', 'blocks.js', 'util.js', 'beats.js', 'hud.js', 'sfx.js', 'scene.js', 'data.js', 'player.js', 'app.js'];

const stripped = ORDER.map((f) => {
  const src = read(`assets/js/${f}`);
  return `/* ==== ${f} ==== */\n` + src
    .replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export\s+/gm, '')
    .trim();
}).join('\n\n');

const css = read('assets/css/style.css');
const html = read('index.html');

const bodyInner = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const title = html.match(/<title>([^<]*)<\/title>/)[1];
const description = html.match(/name="description" content="([^"]*)"/)[1];
// Matched line-wise: the href is a data: URI, so ">" is not a safe delimiter.
const favicon = html.match(/^<link rel="icon".*$/m)[0];

const script = `<script>\n(function () {\n'use strict';\n${stripped}\n})();\n</script>`;

mkdirSync(join(root, 'dist'), { recursive: true });

writeFileSync(join(root, 'dist/minetube.html'), `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${favicon}
<style>
${css}
</style>
</head>
<body>
${bodyInner}
${script}
</body>
</html>
`);

writeFileSync(join(root, 'dist/artifact.html'), `<title>${title}</title>
<style>
${css}
</style>
${bodyInner}
${script}
`);

console.log('wrote dist/minetube.html and dist/artifact.html');
